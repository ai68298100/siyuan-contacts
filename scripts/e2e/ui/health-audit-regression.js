import { mount, unmount, tick } from "svelte";
import ReviewReportDialog from "../../../src/components/dashboard/ReviewReportDialog.svelte";
import SettingsView from "../../../src/components/SettingsView.svelte";
import { DEFAULT_VIEW_PREFERENCES } from "../../../src/domain/preferences";
import { auditWorkspaceData, auditWorkspaceDataReport, retryFailedHealthAuditModules } from "../../../src/services/health-audit";
import { FIELD_SPECS } from "../../../src/domain/fields";
import { kernel } from "./siyuan-mock.js";
import "../../../src/index.scss";

const personDocId = "20261004000000-person1";
const selfDocId = "20261004000000-self001";
const selfItemId = "20261004000000-row0001";
const orgDocId = "20261004000000-org0001";
const settings = {
    schemaVersion: 1, notebookName: "隔离体检", notebookId: "20261004000000-book001",
    hostDocId: "20261004000000-host001", dbBlockId: "20261004000000-block01", avId: "20261004000000-view001",
    initializedAt: "2026-10-04T00:00:00Z", fieldMap: Object.fromEntries(FIELD_SPECS.map((field) => [field.key, field.key])),
};

function personRow(docId = personDocId, itemId = "row-health-1", name = "体检联系人") {
    return { id: itemId, cells: [{ valueType: "block", value: { type: "block", keyID: "name", block: { id: docId, content: name } } }] };
}

function fixtureState() {
    const state = {
        rows: [personRow()],
        failRoster: false,
        files: new Map(),
        readFailures: new Map(),
        reads: [], writes: [], calls: [],
    };
    state.plugin = {
        loadData: async (key) => {
            state.reads.push(key);
            if (state.readFailures.has(key)) return state.readFailures.get(key)();
            return structuredClone(state.files.get(key) ?? "");
        },
        saveData: async (key) => { state.writes.push(key); throw new Error("只读体检不允许写入"); },
    };
    kernel.handler = async (route, body) => {
        state.calls.push(route);
        if (route === "/api/av/renderAttributeView") {
            if (state.failRoster) throw new Error("权限不足，名册读取被拒绝");
            return { view: { columns: FIELD_SPECS.map((field) => ({ id: field.key, name: field.nameZh, type: field.type })), rows: structuredClone(state.rows) } };
        }
        if (route === "/api/query/sql") {
            if (body.stmt.includes("GROUP BY root_id")) return [{ root_id: orgDocId, ial: '{: custom-lvct-org="1"}', markerCount: 1 }];
            return [{ id: orgDocId, content: "隔离组织", hpath: "/隔离组织", box: settings.notebookId }];
        }
        throw new Error(`体检禁止请求 ${route}`);
    };
    return state;
}

function event(person = personDocId) {
    return { id: "event-1", personDocId: person, occurredAt: 1, localDate: "2020-01-01", source: "manual" };
}

function followUp(person = personDocId) {
    return { id: "follow-1", personDocId: person, title: "保持联系", dueDate: "2026-10-04", status: "open", createdAt: 1, updatedAt: 1 };
}

export async function runHealthAuditRegression({ test, assert, fixture, until, button }) {
    await test("AG-P0-012 五模块成功与合法未发现，严格零写入", async () => {
        const state = fixtureState();
        const report = await auditWorkspaceDataReport(state.plugin, settings);
        assert(Object.keys(report.modules).length === 5 && Object.values(report.modules).every((module) => module.state === "success"), "五模块未分别成功");
        assert(report.modules.roster.presence === "found" && report.modules.interactions.readStatus === "not_found", "成功与未发现混淆");
        assert(report.modules.followUps.readStatus === "not_found" && report.modules.selfIdentity.readStatus === "not_found", "首次空库不是合法未发现");
        assert(state.writes.length === 0 && report.writes === 0, "只读体检写入");
    });

    await test("AG-P0-012 权限读取失败与依赖未知分别报告，旧数组入口拒绝假空态", async () => {
        const state = fixtureState();
        state.failRoster = true;
        state.files.set("interaction-events.json", { schemaVersion: 1, events: [event()], tombstones: [] });
        state.readFailures.set("follow-ups.json", () => { throw new Error("权限不足"); });
        const report = await auditWorkspaceDataReport(state.plugin, settings);
        assert(report.modules.roster.state === "failed" && report.modules.roster.readStatus === "read_failed", "名册权限故障未报告");
        assert(report.modules.followUps.readStatus === "read_failed", "带 JSON 文件名的权限错误被误判坏 JSON");
        assert(report.modules.interactions.state === "unknown" && report.modules.interactions.readStatus === "verified", "已读取互动的归属未知被冒充成功或坏库");
        let incomplete;
        try { await auditWorkspaceData(state.plugin, settings); } catch (error) { incomplete = error; }
        assert(incomplete?.report?.modules.roster.state === "failed" && incomplete.message.includes("名册"), "兼容入口没有附带模块失败报告");
        assert(state.writes.length === 0, "权限故障期间写入");
    });

    await test("AG-P0-012 实际挂起读取超时，晚响应不改写报告", async () => {
        const state = fixtureState();
        let finishRead;
        state.readFailures.set("follow-ups.json", () => new Promise((resolve) => { finishRead = resolve; }));
        const report = await auditWorkspaceDataReport(state.plugin, settings, { timeoutMs: 50 });
        assert(report.modules.followUps.state === "unknown" && report.modules.followUps.readStatus === "timed_out", "挂起读取冒充空库");
        const before = JSON.stringify(report);
        finishRead({ schemaVersion: 1, items: [] });
        await new Promise((resolve) => setTimeout(resolve, 20));
        assert(JSON.stringify(report) === before && state.writes.length === 0, "晚响应修改旧报告或写入");
    });

    await test("AG-P0-012 坏 JSON、未知 schema 和坏条目逐模块拒绝，原库不变", async () => {
        for (const [key, module, value] of [
            ["interaction-events.json", "interactions", "{broken"],
            ["follow-ups.json", "followUps", { schemaVersion: 2, items: [] }],
            ["org-membership.json", "organizationMembers", { schemaVersion: 1, memberships: [{ id: "bad" }] }],
            ["self-identity.json", "selfIdentity", { schemaVersion: 2 }],
        ]) {
            const state = fixtureState();
            state.files.set(key, value);
            const report = await auditWorkspaceDataReport(state.plugin, settings);
            assert(report.modules[module].state === "failed" && report.modules[module].readStatus === "bad_json", `${module} 坏库伪装未发现`);
            assert(JSON.stringify(state.files.get(key)) === JSON.stringify(value) && state.writes.length === 0, "坏原库被覆盖");
        }
    });

    await test("AG-P0-012 本人排除普通完整度和提醒，指向本人的关系不算悬空", async () => {
        const state = fixtureState();
        state.rows.push(personRow(selfDocId, selfItemId, "我自己"));
        state.rows[0].cells.push({ valueType: "relation", value: { type: "relation", keyID: "related", relation: { blockIDs: [selfItemId] } } });
        state.files.set("self-identity.json", { schemaVersion: 1, selfDocId, selfItemId, createdAt: "2026-10-04" });
        state.files.set("interaction-events.json", { schemaVersion: 1, events: [event(selfDocId)], tombstones: [] });
        state.files.set("follow-ups.json", { schemaVersion: 1, items: [followUp(selfDocId)] });
        const report = await auditWorkspaceDataReport(state.plugin, settings);
        assert(report.issues.every((issue) => !issue.itemIds.includes(selfItemId)), "本人进入普通体检");
        assert(!report.issues.some((issue) => ["danglingRelation", "longInactive", "unreachableFollowUp", "orphanInteraction"].includes(issue.kind)), "合法本人引用被误判");
        assert(state.writes.length === 0, "本人核查写入");
    });

    await test("AG-P0-012 仅重读失败模块，重算依赖未知，保留已核实模块与上次问题", async () => {
        const state = fixtureState();
        state.files.set("interaction-events.json", { schemaVersion: 1, events: [event("20261004000000-gone001")], tombstones: [] });
        const first = await auditWorkspaceDataReport(state.plugin, settings);
        state.readFailures.set("interaction-events.json", () => { throw new Error("权限不足"); });
        const failed = await auditWorkspaceDataReport(state.plugin, settings, { previous: first });
        assert(failed.modules.interactions.stale && failed.modules.interactions.issues[0].kind === "orphanInteraction", "故障吞掉上次已核实问题");
        state.readFailures.delete("interaction-events.json");
        const readCount = state.reads.length;
        const callCount = state.calls.length;
        const retried = await retryFailedHealthAuditModules(state.plugin, settings, failed);
        assert(state.reads.slice(readCount).join() === "interaction-events.json" && state.calls.length === callCount, "重试重读了成功模块");
        assert(retried.modules.interactions.state === "success" && failed.modules.interactions.state === "failed", "重试污染旧报告");
        state.readFailures.set("self-identity.json", () => { throw new Error("权限不足"); });
        const identityFailed = await auditWorkspaceDataReport(state.plugin, settings);
        assert(identityFailed.modules.roster.state === "unknown", "未知本人被按无本人统计");
        state.readFailures.delete("self-identity.json");
        const identityReadCount = state.reads.length;
        const restored = await retryFailedHealthAuditModules(state.plugin, settings, identityFailed);
        assert(state.reads.slice(identityReadCount).join() === "self-identity.json" && restored.modules.roster.state === "success", "身份重试没有用旧名册重新核实范围");
        assert(state.writes.length === 0, "重试产生写入");
    });

    await test("AG-P0-012 组织成员孤儿、重复历史与异常期间可定位，本人身份失配单列", async () => {
        const state = fixtureState();
        const membership = { id: "20261004000000-member1", orgDocId, personDocId, department: "", title: "", status: "former", joinedOn: "2026-09-01", leftOn: "2026-08-01" };
        state.files.set("org-membership.json", { schemaVersion: 1, memberships: [
            membership,
            { ...membership, id: "20261004000000-member2" },
            { ...membership, id: "20261004000000-member3", orgDocId: "20261004000000-gone001", personDocId: "20261004000000-gone002" },
        ] });
        state.files.set("self-identity.json", { schemaVersion: 1, selfDocId: personDocId, selfItemId, createdAt: "2026-10-04" });
        const report = await auditWorkspaceDataReport(state.plugin, settings);
        assert(report.modules.organizationMembers.issues.length >= 3, "组织异常未逐类报告");
        assert(report.modules.organizationMembers.issues.some((issue) => issue.kind === "orphanOrganizationMember" && issue.repair.targetIds.includes("20261004000000-member3")), "孤儿成员未定位记录");
        assert(report.modules.selfIdentity.issues[0]?.kind === "unreachableSelfIdentity", "本人身份行失配未单列");
        assert(state.writes.length === 0 && report.issues.every((issue) => issue.repair.writes === 0), "组织/身份核查改写数据");
    });

    await test("AG-P0-012 体检页面显示失败和未知，修复预览列目标与影响且零写入", async () => {
        const state = fixtureState();
        state.files.set("interaction-events.json", "{broken");
        state.readFailures.set("follow-ups.json", () => new Promise(() => {}));
        const component = mount(ReviewReportDialog, { target: fixture, props: {
            buildAuditReport: () => auditWorkspaceDataReport(state.plugin, settings, { timeoutMs: 50 }),
            retryFailedAuditModules: (report) => retryFailedHealthAuditModules(state.plugin, settings, report),
        } });
        try {
            await until(() => fixture.textContent.includes("未知 · 超时"), "模块状态未显示");
            assert(fixture.textContent.includes("失败 · 坏 JSON") && !fixture.textContent.includes("所有模块均已核实，未发现资料质量问题"), "页面故障冒充空态");
            button("预览修复范围").click();
            await until(() => fixture.textContent.includes("修复预览："), "修复预览未打开");
            assert(fixture.textContent.includes("row-health-1") && fixture.textContent.includes("确认前写入数：0"), "未展示目标或零写入边界");
            state.files.delete("interaction-events.json");
            const before = state.reads.length;
            button("只重试失败模块").click();
            await until(() => !fixture.textContent.includes("失败 · 坏 JSON"), "失败模块未恢复");
            assert(state.reads.slice(before).join() === "interaction-events.json" && fixture.textContent.includes("未知 · 超时"), "UI重试扩大范围或清除了未知状态");
            assert(state.writes.length === 0, "预览或UI重试写入");
        } finally { await unmount(component); }
    });

    await test("AG-P0-012 设置页接入五模块，保留旧问题，失败重试不扩大范围", async () => {
        const state = fixtureState();
        const facade = {
            settings, viewPreferences: DEFAULT_VIEW_PREFERENCES,
            runHealthAuditReport: (previous) => auditWorkspaceDataReport(state.plugin, settings, { previous }),
            retryFailedHealthAuditModules: (previous) => retryFailedHealthAuditModules(state.plugin, settings, previous),
            loadExportSummary: async () => ({ people: 1, interactions: 0 }),
        };
        let focus;
        const component = mount(SettingsView, { target: fixture, props: {
            facade, settings, preferences: DEFAULT_VIEW_PREFERENCES,
            onSettingsUpdated: () => {}, onPreferencesUpdated: () => {}, onBack: () => {},
            onOpenPeople: (value) => { focus = value; },
        } });
        try {
            button("数据与字段").click();
            await until(() => fixture.textContent.includes("运行资料体检"), "设置页体检入口未显示");
            button("运行资料体检").click();
            await until(() => fixture.querySelectorAll("[data-health-module]").length === 5, "设置页未接入五模块报告");
            button("查看这 1 人").click();
            assert(focus?.itemIds[0] === "row-health-1", "体检查看混淆人物行与文档 ID");
            state.failRoster = true;
            button("重新核实全部模块").click();
            await until(() => fixture.textContent.includes("上次已核实问题"), "重新体检失败丢失旧问题");
            assert(!fixture.textContent.includes("所有模块均已核实，未发现资料质量问题"), "设置页读取失败显示正常空态");
            state.failRoster = false;
            const reads = state.reads.length;
            button("只重试失败模块").click();
            await until(() => !fixture.textContent.includes("失败 · 读取失败"), "设置页失败重试未恢复");
            assert(state.reads.length === reads && state.writes.length === 0, "设置页重试重读成功 JSON 模块或产生写入");
        } finally { await unmount(component); }
    });

    await test("AG-P0-012 交往回顾初次读取错误只显示错误态，恢复后才能显示报表", async () => {
        let failRead = true;
        const component = mount(ReviewReportDialog, { target: fixture, props: {
            buildReport: async () => {
                if (failRead) throw new Error("互动读取失败");
                return { total: 0, contactedPeople: 0, activities: 0, delta: 0, topPeople: [], entries: [], bySource: { manual: 0, diary: 0, api: 0 } };
            },
        } });
        try {
            await until(() => fixture.textContent.includes("交往回顾读取失败"), "回顾未显示错误态");
            assert(!fixture.textContent.includes("选择区间后生成报表") && !fixture.querySelector(".lvct-review__hero"), "读取错误被当作区间空态");
            failRead = false;
            button("重试读取报表").click();
            await until(() => fixture.querySelector(".lvct-review__hero"), "重试后未显示报表");
            assert(!fixture.textContent.includes("读取失败"), "旧错误未清除");
            await tick();
        } finally { await unmount(component); }
    });
}
