import { mount, unmount, tick } from "svelte";
import OrgProjectionRepair from "../../../src/components/org/OrgProjectionRepair.svelte";
import SettingsView from "../../../src/components/SettingsView.svelte";
import PersonDetail from "../../../src/components/people/PersonDetail.svelte";
import Workbench from "../../../src/components/Workbench.svelte";
import OrgManagerDialog from "../../../src/components/org/OrgManagerDialog.svelte";
import { previewOrganizationProjections, repairOrganizationProjection, ORG_PROJECTION_CHECKPOINT_STORAGE_KEY } from "../../../src/services/org-projections";
import { ORG_MEMBERSHIP_STORAGE_KEY, addOrgMembership, updateOrgMembership, loadOrgMembershipStore } from "../../../src/data/org-membership";
import { saveOrganizationMember, editOrganizationMember, deleteOrganizationMember, replaceOrganizationMemberWithProjection } from "../../../src/services/org-member-writes";
import { listPersonOrgMemberships, listOrganizationsWithMembers, listOrganizationMembersPage } from "../../../src/services/org";
import { listContacts } from "../../../src/services/contacts";
import { bindSelfIdentityStorage } from "../../../src/data/self-identity";
import { DEFAULT_VIEW_PREFERENCES } from "../../../src/domain/preferences";
import { ORGANIZATION_MEMBERS_ATTR, PERSON_ORGANIZATIONS_ATTR } from "../../../src/domain/org-projections";
import { kernelConfig } from "../../../src/api/client";
import { emitDataChanged } from "../../../src/libs/data-events";

export function projectionFixture(kernel, settings) {
    const orgDocId = "20261004000000-org0001";
    const personDocId = "20261004000000-person1";
    const state = {
        orgDocId, personDocId, archived: false, sections: new Map(), documentWrites: [], jsonWrites: [],
        duplicateDocId: "", failReadDocId: "", rejectDocId: "", skipWrite: false,
        loseResponse: false, failReadAfterWrite: false, checkpointReadFailure: false,
        userBody: "用户的任职笔记与其他链接", onWrite: null, failMembershipReadAfterSave: false,
        people: [{ docId: personDocId, itemId: "20261004000000-item001", name: "同名人物" }],
        store: new Map([[ORG_MEMBERSHIP_STORAGE_KEY, { schemaVersion: 1, memberships: [{
            id: "20261004000000-member1", orgDocId, personDocId, status: "active", affiliationKind: "work",
            joinedOn: "2025-01-01", leftOn: "", department: "研发", title: "工程师",
        }] }]]),
    };
    state.plugin = {
        loadData: async (key) => {
            if (state.failMembershipReadAfterSave && key === ORG_MEMBERSHIP_STORAGE_KEY && state.jsonWrites.some((write) => write.key === key)) throw new Error("成员写后读取失败");
            if (state.checkpointReadFailure && key === ORG_PROJECTION_CHECKPOINT_STORAGE_KEY && state.jsonWrites.length) throw new Error("断点写后读取失败");
            return structuredClone(state.store.get(key) ?? "");
        },
        saveData: async (key, value) => {
            state.jsonWrites.push({ key, value: structuredClone(value) });
            state.store.set(key, structuredClone(value));
        },
    };
    bindSelfIdentityStorage(state.plugin);
    state.key = (docId, attrName) => `${docId}/${attrName}`;
    state.section = (docId) => state.sections.get(state.key(docId, docId === orgDocId ? ORGANIZATION_MEMBERS_ATTR : PERSON_ORGANIZATIONS_ATTR));
    state.membership = () => state.store.get(ORG_MEMBERSHIP_STORAGE_KEY).memberships[0];
    kernel.handler = async (route, body) => {
        if (route === "/api/av/renderAttributeView") return { view: { columns: [], rows: state.people.map((person) => ({
            id: person.itemId, cells: [{ valueType: "block", value: {
                keyID: "name", type: "block", block: { id: person.docId, content: person.name },
            } }],
        })) } };
        if (route === "/api/sqlite/flushTransaction") return null;
        if (route === "/api/query/sql") {
            if (body.stmt.includes("GROUP BY root_id")) return [{ root_id: orgDocId, ial: `{: custom-lvct-org="${state.archived ? "archived" : "1"}"}`, markerCount: 1 }];
            if (body.stmt.includes("id IN")) return [{ id: orgDocId, content: "测试单位", hpath: "/测试单位", box: settings.notebookId }];
            if (body.stmt.includes("AND type = 'd'")) {
                const docId = body.stmt.match(/WHERE id = '([^']+)'/)?.[1];
                return docId === orgDocId || state.people.some((person) => person.docId === docId) ? [{ id: docId }] : [];
            }
            const docId = body.stmt.match(/root_id = '([^']+)'/)?.[1];
            if (state.failReadDocId === docId || state.failReadAfterWrite && state.documentWrites.length) throw new Error("投影读取失败");
            if (state.duplicateDocId === docId) return [
                { id: "20261004000000-dup0001", markdown: "重复一" }, { id: "20261004000000-dup0002", markdown: "重复二" },
            ];
            const attrName = body.stmt.match(/(custom-lvct-(?:members|orgs))=/)?.[1];
            const section = state.sections.get(state.key(docId, attrName));
            return section ? [structuredClone(section)] : [];
        }
        if (["/api/block/insertBlock", "/api/block/updateBlock", "/api/block/deleteBlock"].includes(route)) {
            const entry = [...state.sections.entries()].find(([, section]) => section.id === body.id);
            const docId = body.parentID ?? entry?.[0].split("/")[0];
            if (state.rejectDocId === docId) throw new Error("内核明确拒绝此文档修复");
            state.documentWrites.push({ route, body: structuredClone(body) });
            const id = body.id ?? `20261004000000-bl${String(state.documentWrites.length).padStart(5, "0")}`;
            if (!state.skipWrite) {
                if (route === "/api/block/deleteBlock") state.sections.delete(entry[0]);
                else {
                    const attrName = body.data.match(/(custom-lvct-(?:members|orgs))=/)?.[1];
                    state.sections.set(state.key(docId, attrName), { id, markdown: body.data });
                }
            }
            state.onWrite?.();
            if (state.loseResponse) return new Promise(() => {});
            return route === "/api/block/insertBlock" ? [{ doOperations: [{ id, action: "insert" }] }] : null;
        }
        throw new Error(`组织投影夹具拒绝 ${route}`);
    };
    state.facade = {
        previewOrganizationProjections: () => previewOrganizationProjections(state.plugin, settings),
        repairOrganizationProjection: (preview, retryKey) => repairOrganizationProjection(state.plugin, settings, preview, retryKey),
        listContacts: () => listContacts(settings),
        listOrganizations: () => listOrganizationsWithMembers(state.plugin),
        listOrganizationMembersPage: (docId, options) => listOrganizationMembersPage(state.plugin, settings, docId, options),
        listPersonOrgMemberships: (docId) => listPersonOrgMemberships(state.plugin, docId),
        addOrganizationMember: (orgDocId, personDocId, extra) => saveOrganizationMember(state.plugin, settings, { ...extra, orgDocId, personDocId }),
        updateOrganizationMember: (id, patch, expected) => editOrganizationMember(state.plugin, settings, id, patch, expected),
        removeOrganizationMember: (id, expected) => deleteOrganizationMember(state.plugin, settings, id, expected),
        listCommonOrgBackground: async () => [], listPersonExchanges: async () => [], listPersonAliases: async () => [],
        listPersonFollowUps: async () => [], loadPersonInsights: async () => ({ timeline: [], coAttendance: [], totalEvents: 0 }),
        getPersonCadence: async () => null, listTemplates: async () => [], loadSelfIdentity: async () => null,
        loadRecentInteractions: async () => new Map(), openOrgManagerDialog: () => {},
    };
    return state;
}

export async function runOrganizationProjectionRegression({ test, assert, kernel, settings, fixture, until, button }) {
    await test("组织双链实际服务：只读预览零写入，双向逐项修复且重复核实零重写", async () => {
        const state = projectionFixture(kernel, settings);
        const facts = JSON.stringify(state.store.get(ORG_MEMBERSHIP_STORAGE_KEY));
        const preview = await state.facade.previewOrganizationProjections();
        assert(preview.targets.length === 2 && preview.targets.every((target) => target.state === "missing"), "未返回双向缺失投影");
        assert(state.jsonWrites.length === 0 && state.documentWrites.length === 0, "只读预览发起写入");
        for (const target of preview.targets) {
            const result = await state.facade.repairOrganizationProjection(preview, target.retryKey);
            assert(result.status === "applied", "修复未通过文档回读核实");
        }
        assert(state.section(state.orgDocId).markdown.includes(state.personDocId) && state.section(state.personDocId).markdown.includes(state.orgDocId), "稳定 ID 双链缺失");
        const writes = state.documentWrites.length;
        for (const target of preview.targets) assert((await state.facade.repairOrganizationProjection(preview, target.retryKey)).status === "unchanged", "重复核实未报告一致");
        assert(state.documentWrites.length === writes && JSON.stringify(state.store.get(ORG_MEMBERSHIP_STORAGE_KEY)) === facts, "重复写文档或修改成员事实");
    });

    await test("组织双链实际服务：成员、锚点或原段落在预览后变化，过期修复零覆盖", async () => {
        for (const changed of ["source", "anchor", "block"]) {
            const state = projectionFixture(kernel, settings);
            const preview = await state.facade.previewOrganizationProjections();
            const target = preview.targets[0];
            let nextSettings = settings;
            if (changed === "source") state.membership().title = "新职位";
            if (changed === "anchor") nextSettings = { ...settings, avId: "20261004000000-other01" };
            if (changed === "block") state.sections.set(state.key(target.docId, target.attrName), { id: "20261004000000-old0001", markdown: "刚修改的原段落" });
            let error;
            try { await repairOrganizationProjection(state.plugin, nextSettings, preview, target.retryKey); } catch (cause) { error = cause; }
            assert(error && state.documentWrites.length === 0 && state.jsonWrites.length === 0, `${changed} 变化仍覆盖文档`);
        }
    });

    await test("组织双链实际服务：单项明确拒绝可续做，其他文档仍可独立修复且保留事实", async () => {
        const state = projectionFixture(kernel, settings);
        const facts = JSON.stringify(state.store.get(ORG_MEMBERSHIP_STORAGE_KEY));
        const preview = await state.facade.previewOrganizationProjections();
        state.rejectDocId = state.orgDocId;
        const orgTarget = preview.targets.find((target) => target.docId === state.orgDocId);
        const personTarget = preview.targets.find((target) => target.docId === state.personDocId);
        assert((await state.facade.repairOrganizationProjection(preview, orgTarget.retryKey)).status === "failed", "明确拒绝未隔离");
        assert((await state.facade.repairOrganizationProjection(preview, personTarget.retryKey)).status === "applied", "其他文档被失败目标阻塞");
        state.rejectDocId = "";
        assert((await state.facade.repairOrganizationProjection(preview, orgTarget.retryKey)).status === "applied", "明确拒绝无法安全续做");
        assert(JSON.stringify(state.store.get(ORG_MEMBERSHIP_STORAGE_KEY)) === facts, "投影补偿修改成员事实");
    });

    await test("组织双链实际服务：离职或归档清除当前段落，保留历史、组织身份与用户正文", async () => {
        for (const history of ["former", "archived"]) {
            const state = projectionFixture(kernel, settings);
            const initial = await state.facade.previewOrganizationProjections();
            for (const target of initial.targets) await state.facade.repairOrganizationProjection(initial, target.retryKey);
            if (history === "former") { state.membership().status = "former"; state.membership().leftOn = "2026-09-30"; }
            else state.archived = true;
            const facts = JSON.stringify(state.store.get(ORG_MEMBERSHIP_STORAGE_KEY));
            const preview = await state.facade.previewOrganizationProjections();
            assert(preview.targets.every((target) => target.markdown === "" && target.state === "different"), "历史或归档仍生成当前投影");
            for (const target of preview.targets) assert((await state.facade.repairOrganizationProjection(preview, target.retryKey)).status === "applied", "旧当前投影未删除");
            assert(state.sections.size === 0 && state.userBody === "用户的任职笔记与其他链接" && JSON.stringify(state.store.get(ORG_MEMBERSHIP_STORAGE_KEY)) === facts, "清除段落损坏历史或正文");
            assert(state.documentWrites.slice(-2).every((write) => write.route === "/api/block/deleteBlock"), "清理越过插件标记段落");
        }
    });

    await test("组织双链实际服务：重复标记、人物不可达与读取故障均未知，禁止写空", async () => {
        for (const problem of ["duplicate", "orphan", "read"]) {
            const state = projectionFixture(kernel, settings);
            if (problem === "duplicate") state.duplicateDocId = state.personDocId;
            if (problem === "orphan") state.membership().personDocId = "20261004000000-missing";
            if (problem === "read") state.failReadDocId = state.personDocId;
            const preview = await state.facade.previewOrganizationProjections();
            const unknown = preview.targets.find((target) => target.state === "unknown");
            assert(unknown, "坏目标未显示未知");
            let error;
            try { await state.facade.repairOrganizationProjection(preview, unknown.retryKey); } catch (cause) { error = cause; }
            assert(error && state.documentWrites.length === 0 && state.jsonWrites.length === 0, "未知目标被清空或覆盖");
        }
    });

    await test("组织双链实际服务：code=0 未应用持久保留断点，重新预览或重新打开不重复追加", async () => {
        const state = projectionFixture(kernel, settings);
        state.skipWrite = true;
        const preview = await state.facade.previewOrganizationProjections();
        const target = preview.targets[0];
        assert((await state.facade.repairOrganizationProjection(preview, target.retryKey)).status === "unknown", "未应用请求被当成成功");
        const restartedPlugin = { ...state.plugin };
        const restarted = await previewOrganizationProjections(restartedPlugin, settings);
        assert(restarted.targets.find((entry) => entry.retryKey === target.retryKey).state === "unknown", "重开丢失未知断点");
        assert((await state.facade.repairOrganizationProjection(preview, target.retryKey)).status === "unknown" && state.documentWrites.length === 1, "重复发送未核实追加请求");
        state.sections.set(state.key(target.docId, target.attrName), { id: "20261004000000-late001", markdown: `${target.markdown}\n{: ${target.attrName}="1"}` });
        const verified = await state.facade.previewOrganizationProjections();
        const verifiedTarget = verified.targets.find((entry) => entry.retryKey === target.retryKey);
        assert(verifiedTarget.state === "unchanged" && verifiedTarget.checkpointPending, "迟到应用未提供只读收口");
        assert((await state.facade.repairOrganizationProjection(verified, target.retryKey)).status === "unchanged" && state.documentWrites.length === 1, "断点收口重写文档");
        assert(state.store.get(ORG_PROJECTION_CHECKPOINT_STORAGE_KEY).operations[0].state === "verified", "断点未持久收口");
    });

    await test("组织双链实际服务：响应丢失且回读失败保持未知，恢复后只读核实原请求", async () => {
        const state = projectionFixture(kernel, settings);
        const preview = await state.facade.previewOrganizationProjections();
        state.loseResponse = true;
        state.failReadAfterWrite = true;
        const previousTimeout = kernelConfig.timeoutMs;
        kernelConfig.timeoutMs = 50;
        try {
            assert((await state.facade.repairOrganizationProjection(preview, preview.targets[0].retryKey)).status === "unknown", "响应丢失被误报成功");
            state.loseResponse = false;
            state.failReadAfterWrite = false;
            const next = await state.facade.previewOrganizationProjections();
            assert((await state.facade.repairOrganizationProjection(next, preview.targets[0].retryKey)).status === "unchanged" && state.documentWrites.length === 1, "恢复核实重复写入");
        } finally { kernelConfig.timeoutMs = previousTimeout; }
    });

    await test("组织双链实际服务：损坏事实或断点拒绝预览，写前断点回读失败零内核请求", async () => {
        for (const key of [ORG_MEMBERSHIP_STORAGE_KEY, ORG_PROJECTION_CHECKPOINT_STORAGE_KEY]) {
            const state = projectionFixture(kernel, settings);
            state.store.set(key, { schemaVersion: 999 });
            let error;
            try { await state.facade.previewOrganizationProjections(); } catch (cause) { error = cause; }
            assert(error && state.jsonWrites.length === 0 && state.documentWrites.length === 0, "损坏来源或断点被覆盖");
        }
        const state = projectionFixture(kernel, settings);
        const preview = await state.facade.previewOrganizationProjections();
        state.checkpointReadFailure = true;
        const result = await state.facade.repairOrganizationProjection(preview, preview.targets[0].retryKey);
        assert(result.status === "unknown" && state.documentWrites.length === 0 && state.store.has(ORG_PROJECTION_CHECKPOINT_STORAGE_KEY), "断点未核实仍发内核请求或丢失断点");
    });

    await test("组织双链实际服务：写后事实变化报告未知，不回滚事实或重放旧投影", async () => {
        const state = projectionFixture(kernel, settings);
        const preview = await state.facade.previewOrganizationProjections();
        state.onWrite = () => { state.membership().title = "并发的新职位"; };
        const result = await state.facade.repairOrganizationProjection(preview, preview.targets[0].retryKey);
        assert(result.status === "unknown" && state.membership().title === "并发的新职位" && state.documentWrites.length === 1, "写后来源变化被隐藏或回滚");
        let error;
        try { await state.facade.repairOrganizationProjection(preview, preview.targets[0].retryKey); } catch (cause) { error = cause; }
        assert(error && state.documentWrites.length === 1, "旧预览重放旧投影");
    });

    await test("组织双链界面：设置入口先只读，焦点到核对结果，取消零写入，广播后需重新预览", async () => {
        const state = projectionFixture(kernel, settings);
        const component = mount(SettingsView, { target: fixture, props: {
            facade: state.facade, settings, preferences: structuredClone(DEFAULT_VIEW_PREFERENCES),
            onSettingsUpdated: () => {}, onPreferencesUpdated: () => {}, onBack: () => {},
        } });
        try {
            button("数据与字段").click();
            await until(() => fixture.querySelector(".lvct-org-projection"), "设置未显示组织双链入口");
            button("只读核对组织双链").click();
            await until(() => fixture.textContent.includes("已核对文档数"), "没有展示差异");
            assert(document.activeElement?.getAttribute("role") === "status" && fixture.textContent.includes(state.orgDocId), "核对焦点或稳定文档 ID 缺失");
            button("取消预览").click();
            await tick();
            assert(!fixture.textContent.includes("已核对文档数") && state.documentWrites.length === 0 && state.jsonWrites.length === 0, "取消预览写入文档或断点");
            button("只读核对组织双链").click();
            await until(() => fixture.textContent.includes("已核对文档数"), "重新预览未显示");
            emitDataChanged();
            await until(() => fixture.textContent.includes("来源或结果需重新核实"), "来源广播没有使预览过期");
            assert(button("确认修复或核实此段落").disabled, "过期预览仍可修复");
        } finally { await unmount(component); }
    });

    await test("组织双链界面：核对期间阻止关闭与切区，卸载后迟到结果不污染新界面", async () => {
        const state = projectionFixture(kernel, settings);
        const preview = await state.facade.previewOrganizationProjections();
        let releasePreview;
        let backCalls = 0;
        const facade = { ...state.facade, previewOrganizationProjections: () => new Promise((resolve) => { releasePreview = resolve; }) };
        const component = mount(SettingsView, { target: fixture, props: {
            facade, settings, preferences: structuredClone(DEFAULT_VIEW_PREFERENCES),
            onSettingsUpdated: () => {}, onPreferencesUpdated: () => {}, onBack: () => { backCalls += 1; },
        } });
        try {
            button("数据与字段").click();
            await until(() => fixture.querySelector(".lvct-org-projection"), "设置入口未显示");
            button("只读核对组织双链").click();
            await until(() => button("通用").disabled, "核对期间仍可切换分区");
            button("← 返回工作台").click();
            await tick();
            assert(backCalls === 0, "核对期间关闭守卫失效");
        } finally { await unmount(component); }
        fixture.replaceChildren();
        const next = mount(OrgProjectionRepair, { target: fixture, props: { facade: state.facade } });
        try {
            releasePreview(preview);
            await tick();
            await tick();
            assert(!fixture.textContent.includes("已核对文档数") && state.documentWrites.length === 0, "迟到结果污染新组件或写入文档");
        } finally { await unmount(next); }
    });

    await test("成员维护实际存储：并发重复添加返回原 ID，离职重入保留历史，恢复冲突零写", async () => {
        const state = projectionFixture(kernel, settings);
        state.store.set(ORG_MEMBERSHIP_STORAGE_KEY, { schemaVersion: 1, memberships: [] });
        const input = { orgDocId: state.orgDocId, personDocId: state.personDocId, affiliationKind: "education", joinedOn: "2024-02-29" };
        const [first, second] = await Promise.all([addOrgMembership(state.plugin, input), addOrgMembership(state.plugin, input)]);
        assert(first.id === second.id && state.jsonWrites.length === 1 && first.affiliationKind === "education", "并发创建多条当前成员");
        await updateOrgMembership(state.plugin, first.id, { status: "former", leftOn: "2025-01-01" });
        const reentered = await addOrgMembership(state.plugin, { ...input, joinedOn: "2026-01-01", affiliationKind: "work" });
        assert(reentered.id !== first.id && (await loadOrgMembershipStore(state.plugin)).memberships.length === 2, "重新加入覆盖历史记录");
        const writes = state.jsonWrites.length;
        let error;
        try { await updateOrgMembership(state.plugin, first.id, { status: "active", leftOn: "" }); } catch (cause) { error = cause; }
        assert(error && state.jsonWrites.length === writes, "恢复与当前记录冲突仍写入");
        for (const joinedOn of ["2026-02-29", "2026-04-31"]) {
            error = null;
            try { await addOrgMembership(state.plugin, { ...input, joinedOn }); } catch (cause) { error = cause; }
            assert(error && state.jsonWrites.length === writes, "非法日历日期仍保存");
        }
    });

    await test("成员维护实际服务：稳定组织/人物身份，分类与双方投影报告，失败后只补段落", async () => {
        const state = projectionFixture(kernel, settings);
        state.store.set(ORG_MEMBERSHIP_STORAGE_KEY, { schemaVersion: 1, memberships: [] });
        state.rejectDocId = state.personDocId;
        const report = await saveOrganizationMember(state.plugin, settings, { orgDocId: state.orgDocId, personDocId: state.personDocId, affiliationKind: "education" });
        assert(report.fact === "verified" && report.membership.affiliationKind === "education"
            && report.projections.some((result) => result.status === "failed") && report.projections.some((result) => result.status === "applied"), "事实与部分投影结果未分离");
        const factWrites = state.jsonWrites.filter((write) => write.key === ORG_MEMBERSHIP_STORAGE_KEY).length;
        state.rejectDocId = "";
        const preview = await state.facade.previewOrganizationProjections();
        const target = preview.targets.find((entry) => entry.docId === state.personDocId);
        await state.facade.repairOrganizationProjection(preview, target.retryKey);
        assert(state.jsonWrites.filter((write) => write.key === ORG_MEMBERSHIP_STORAGE_KEY).length === factWrites, "投影补偿重写成员事实");
        const repeated = await saveOrganizationMember(state.plugin, settings, { orgDocId: state.orgDocId, personDocId: state.personDocId, affiliationKind: "work" });
        assert(repeated.membership.id === report.membership.id && repeated.membership.affiliationKind === "education", "重复添加覆盖原记录或分类");
        const writes = state.jsonWrites.length;
        let error;
        try { await saveOrganizationMember(state.plugin, settings, { orgDocId: state.personDocId, personDocId: state.orgDocId }); } catch (cause) { error = cause; }
        assert(error && state.jsonWrites.length === writes, "传反身份仍登记成员");
        state.archived = true;
        error = null;
        try { await saveOrganizationMember(state.plugin, settings, { orgDocId: state.orgDocId, personDocId: state.personDocId }); } catch (cause) { error = cause; }
        assert(error && state.jsonWrites.length === writes, "已归档组织仍登记当前成员");
    });

    await test("成员维护实际服务：事实回读未知不发文档请求，恢复读取后复用原成员", async () => {
        const state = projectionFixture(kernel, settings);
        state.store.set(ORG_MEMBERSHIP_STORAGE_KEY, { schemaVersion: 1, memberships: [] });
        state.failMembershipReadAfterSave = true;
        let error;
        try { await state.facade.addOrganizationMember(state.orgDocId, state.personDocId, { affiliationKind: "work" }); } catch (cause) { error = cause; }
        assert(error && state.documentWrites.length === 0, "成员事实未核实仍发文档请求");
        const id = state.membership().id;
        state.failMembershipReadAfterSave = false;
        const report = await state.facade.addOrganizationMember(state.orgDocId, state.personDocId, { affiliationKind: "work" });
        assert(report.membership.id === id && (await loadOrgMembershipStore(state.plugin)).memberships.length === 1, "未知保存恢复新增成员");
    });

    await test("成员维护实际服务：离职与恢复双向一致，接替保留旧历史并核实三个文档", async () => {
        const state = projectionFixture(kernel, settings);
        const id = state.membership().id;
        await editOrganizationMember(state.plugin, settings, id, { status: "former", leftOn: "2026-09-30" });
        assert(state.membership().status === "former" && state.sections.size === 0, "离职未保留历史或仍保留当前双链");
        const restored = await editOrganizationMember(state.plugin, settings, id, { status: "active", leftOn: "" });
        assert(restored.membership.id === id && restored.projections.every((result) => ["applied", "unchanged"].includes(result.status)), "恢复创建新身份或双链未知");
        const successorDocId = "20261004000000-person2";
        state.people.push({ docId: successorDocId, itemId: "20261004000000-item002", name: "同名人物" });
        const replaced = await replaceOrganizationMemberWithProjection(state.plugin, settings, { formerId: id, personDocId: successorDocId,
            leftOn: "2026-10-01", joinedOn: "2026-10-02", affiliationKind: "education" });
        const memberships = (await loadOrgMembershipStore(state.plugin)).memberships;
        assert(memberships.length === 2 && memberships[0].status === "former" && replaced.membership.affiliationKind === "education", "接替丢失历史或分类");
        assert(replaced.projections.length === 3 && replaced.projections.every((result) => ["applied", "unchanged"].includes(result.status)), "接替未核实原人物/接替人物/组织三个目标");
        assert(!state.section(state.personDocId) && state.section(state.orgDocId).markdown.includes(successorDocId), "旧人物双链未移除或按同名写错人");
    });

    await test("成员维护工作台：人物侧正确传组织和人物 ID，former 可再入，分类与部分完成可见", async () => {
        const state = projectionFixture(kernel, settings);
        state.membership().status = "former";
        state.membership().leftOn = "2026-03-01";
        state.rejectDocId = state.personDocId;
        const component = mount(Workbench, { target: fixture, props: { facade: state.facade, settings,
            preferences: structuredClone(DEFAULT_VIEW_PREFERENCES), initialView: "people", isMobile: false,
            onPreferencesUpdated: () => {}, onOpenPersonDoc: () => {},
        } });
        try {
            await until(() => fixture.querySelector(".lvct-person-card"), "工作台人物卡片未出现");
            fixture.querySelector(".lvct-person-card").click();
            await until(() => fixture.querySelector('[aria-label="选择要加入的组织"]')?.options.length === 2, "former 阻止重新加入");
            const select = fixture.querySelector('[aria-label="选择要加入的组织"]');
            select.value = state.orgDocId;
            select.dispatchEvent(new Event("change", { bubbles: true }));
            const classification = fixture.querySelector('[aria-label="归属分类"]');
            classification.value = "education";
            classification.dispatchEvent(new Event("change", { bubbles: true }));
            await tick();
            button("添加归属").click();
            await until(() => fixture.textContent.includes("成员事实已保存并核实"), "人物入口未保存或身份参数传反");
            assert(fixture.textContent.includes("部分双链尚未核实") && state.store.get(ORG_MEMBERSHIP_STORAGE_KEY).memberships.length === 2, "部分完成或历史不可见");
            const current = state.store.get(ORG_MEMBERSHIP_STORAGE_KEY).memberships.find((entry) => entry.status === "active");
            assert(current.orgDocId === state.orgDocId && current.personDocId === state.personDocId && current.affiliationKind === "education", "工作台传反 ID 或未写分类");
        } finally { await unmount(component); }
    });

    await test("成员维护人物界面：读取失败不冒充空归属，重读恢复；移除先确认且取消零写", async () => {
        const state = projectionFixture(kernel, settings);
        const contact = (await listContacts(settings))[0];
        let fail = true;
        let removes = 0;
        const component = mount(PersonDetail, { target: fixture, props: {
            settings, person: contact, onClose: () => {}, onChanged: () => {}, onDeleted: () => {}, onNavigate: () => {},
            onOpenPersonDoc: () => {}, onRecord: async () => {}, onLoadInsights: async () => ({ timeline: [], coAttendance: [], totalEvents: 0 }),
            onLoadOrgMemberships: async () => { if (fail) throw new Error("隔离读取失败"); return listPersonOrgMemberships(state.plugin, contact.docId); },
            onRemoveOrgMembership: async (id) => { removes += 1; return deleteOrganizationMember(state.plugin, settings, id); },
        } });
        try {
            await until(() => fixture.textContent.includes("组织归属读取失败"), "读取错误未显示");
            assert(!fixture.textContent.includes("未加入任何组织"), "读取故障冒充空归属");
            fail = false;
            button("重新读取归属").click();
            await until(() => fixture.querySelector('[aria-label^="移除归属"]'), "重读未恢复");
            fixture.querySelector('[aria-label^="移除归属"]').click();
            await until(() => fixture.querySelector('[aria-label="确认移除这段成员历史"]'), "缺少删除影响确认");
            const removalRow = fixture.querySelector('[aria-label="确认移除这段成员历史"]').closest(".lvct-detail__timeline-row");
            assert(removalRow.scrollWidth <= removalRow.clientWidth + 1, "成员移除确认横向溢出");
            assert(removes === 0 && state.jsonWrites.length === 0, "只查看确认即删除成员");
            button("取消").click();
            await tick();
            assert(removes === 0 && state.jsonWrites.length === 0, "取消仍写入");
            fixture.querySelector('[aria-label^="移除归属"]').click();
            await tick();
            button("确认移除这段成员历史").click();
            await until(() => removes === 1 && fixture.textContent.includes("成员事实已保存并核实"), "确认未删除原记录");
            assert((await loadOrgMembershipStore(state.plugin)).memberships.length === 0, "删除仍留下原记录");
        } finally { await unmount(component); }
    });

    await test("成员维护组织界面：分类、结束与恢复沿用原成员 ID，结果焦点和历史候选可核对", async () => {
        const state = projectionFixture(kernel, settings);
        const id = state.membership().id;
        const component = mount(OrgManagerDialog, { target: fixture, props: { facade: state.facade, onClose: () => {} } });
        const change = (node, value) => { node.value = value; node.dispatchEvent(new Event(node.tagName === "SELECT" ? "change" : "input", { bubbles: true })); };
        try {
            await until(() => fixture.querySelector(".lvct-org-manager__member"), "组织成员未显示");
            button("编辑").click();
            await tick();
            const edit = fixture.querySelector(".lvct-org-manager__member-edit");
            assert(edit.scrollWidth <= edit.clientWidth + 1, "成员编辑表单横向溢出");
            change(edit.querySelector('[aria-label="归属分类"]'), "education");
            change(edit.querySelector('[aria-label="状态"]'), "former");
            change(edit.querySelector('[aria-label="离开日期"]'), "2026-09-30");
            await tick();
            button("保存").click();
            await until(() => state.membership().status === "former" && fixture.querySelector(".lvct-org-membership-result"), "结束成员未保存");
            await until(() => !fixture.querySelector(".lvct-org-manager__member-edit"), "保存后表单未结束");
            assert(state.membership().id === id && state.membership().affiliationKind === "education", "结束成员更换身份或丢失分类");
            assert(document.activeElement?.classList.contains("lvct-org-membership-result"), "结果焦点未落到事实与投影报告");
            const addPicker = fixture.querySelector('[aria-label="选择要添加的联系人"]');
            addPicker.click();
            await until(() => fixture.querySelector(".lvct-picker__panel"), "历史成员候选器未打开");
            assert(fixture.querySelectorAll(".lvct-picker__option").length === 1, "历史成员不能再次加入");
            fixture.querySelector(".lvct-picker__search")?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
            await tick();
            button("编辑").click();
            await tick();
            const restore = fixture.querySelector(".lvct-org-manager__member-edit");
            change(restore.querySelector('[aria-label="状态"]'), "active");
            change(restore.querySelector('[aria-label="离开日期"]'), "");
            await tick();
            button("保存").click();
            await until(() => state.membership().status === "active" && !fixture.querySelector(".lvct-org-manager__member-edit"), "原期间恢复失败");
            assert(state.membership().id === id && state.store.get(ORG_MEMBERSHIP_STORAGE_KEY).memberships.length === 1, "恢复新增了成员记录");
            button("移除").click();
            await tick();
            const removePreview = fixture.querySelector('[aria-label="确认移除这段成员历史"]');
            const removeRow = removePreview.closest(".lvct-org-manager__member");
            assert(removeRow.scrollWidth <= removeRow.clientWidth + 1, "组织侧移除确认横向溢出");
            button("取消", removePreview).click();
            await tick();
            assert(state.store.get(ORG_MEMBERSHIP_STORAGE_KEY).memberships.length === 1, "取消移除丢失成员");
        } finally { await unmount(component); }
    });

    await test("成员维护组织界面：广播重读保持筛选，编辑草稿不会被外部更新覆盖", async () => {
        const state = projectionFixture(kernel, settings);
        const component = mount(OrgManagerDialog, { target: fixture, props: { facade: state.facade, onClose: () => {} } });
        try {
            await until(() => fixture.querySelector(".lvct-org-manager__member"), "组织成员未显示");
            const search = fixture.querySelector('input[type="search"]');
            search.value = "研发";
            search.dispatchEvent(new Event("input", { bubbles: true }));
            await until(() => fixture.textContent.includes("1 条记录"), "筛选未完成");
            await updateOrgMembership(state.plugin, state.membership().id, { title: "外部更新职位" });
            emitDataChanged();
            await until(() => fixture.textContent.includes("外部更新职位"), "广播未重读当前事实");
            assert(search.value === "研发", "广播清空成员筛选");
            button("编辑").click();
            await tick();
            const title = fixture.querySelector('.lvct-org-manager__member-edit [aria-label="职位"]');
            title.value = "本地编辑草稿";
            title.dispatchEvent(new Event("input", { bubbles: true }));
            await updateOrgMembership(state.plugin, state.membership().id, { title: "另一外部更新" });
            emitDataChanged();
            await until(() => fixture.textContent.includes("成员或组织有新变化"), "编辑期间缺少刷新提示");
            assert(title.value === "本地编辑草稿", "外部更新覆盖编辑草稿");
            const writes = state.jsonWrites.length;
            button("保存").click();
            await until(() => fixture.textContent.includes("成员记录在预览后变化"), "过期编辑未停止保存");
            assert(title.value === "本地编辑草稿" && state.membership().title === "另一外部更新" && state.jsonWrites.length === writes, "过期草稿覆盖外部事实");
        } finally { await unmount(component); }
    });
}
