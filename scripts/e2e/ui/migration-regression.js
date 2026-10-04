import { exportMigrationBundle, importMigrationBundle, previewMigrationImport } from "../../../src/services/migration-bundle";
import { createExchangeRecord, loadExchangeStore } from "../../../src/data/exchanges";
import { createPersonAlias, deletePersonAlias, loadPersonAliasStore, mergePersonAliasStore } from "../../../src/data/person-aliases";
import { DEFAULT_VIEW_PREFERENCES } from "../../../src/domain/preferences";
import SettingsView from "../../../src/components/SettingsView.svelte";
import { mount, unmount } from "svelte";
import { projectionFixture } from "./organization-projection-regression.js";
import { addOrgMembership, loadOrgMembershipStore, mergeOrgMembershipStore, removeOrgMembership, ORG_MEMBERSHIP_STORAGE_KEY } from "../../../src/data/org-membership";

function memoryStore(initial = []) {
    const files = new Map(initial);
    const state = { files, writes: [], failReadsAfterSave: false, failKey: null };
    state.plugin = {
        loadData: async (key) => {
            if (state.failReadsAfterSave && state.failKey === key && state.writes.includes(key)) throw new Error("迁移回读注入失败");
            return structuredClone(files.get(key) ?? "");
        },
        saveData: async (key, value) => {
            state.writes.push(key);
            files.set(key, structuredClone(value));
        },
    };
    return state;
}

function exchangeInput(personDocId, requestId) {
    return { requestId, personDocId, kind: "money", direction: "receivable", description: "隔离迁移餐费", amount: 36,
        occurredOn: "2026-10-04" };
}

function bundle(modules) {
    return JSON.stringify({ schemaVersion: 1, storageKey: "lvct-migration-bundle", modules });
}

export async function runMigrationRegression({ test, assert, person, settings, kernel, fixture, until, button }) {
    await test("迁移实际服务：完整模块覆盖、账本历史与别名墓碑往返，旧十/九/六模块仍可导入", async () => {
        const source = memoryStore();
        const open = await createExchangeRecord(source.plugin, exchangeInput(person.docId, "20261004000000-ex00001"));
        source.files.set("exchange-records.json", { schemaVersion: 1, records: [
            open, { ...open, id: "20261004000000-ex00002", status: "settled", settledOn: "2026-10-04" },
            { ...open, id: "20261004000000-ex00003", status: "cancelled" },
        ] });
        const active = await createPersonAlias(source.plugin, person.docId, "测试老张");
        const removed = await createPersonAlias(source.plugin, person.docId, "测试张同学");
        await deletePersonAlias(source.plugin, removed.id);
        const exported = await exportMigrationBundle(source.plugin);
        const parsed = JSON.parse(exported);
        assert(Object.keys(parsed.modules).length === 11 && parsed.coverage.length === 16, "覆盖矩阵或模块遗漏");
        assert(parsed.coverage.some((entry) => entry.key === "org-projection-checkpoints.json" && entry.status === "excluded")
            && parsed.coverage.some((entry) => entry.key === "organization-operations.json" && entry.status === "excluded")
            && !Object.values(parsed.modules).some((module) => module?.operations), "本工作区投影请求被跨库重放");
        assert(parsed.coverage.filter((entry) => entry.status === "pending").length === 0, "成员模块尚未纳入覆盖");
        const before = source.writes.length;
        const preview = previewMigrationImport(exported);
        assert(source.writes.length === before && preview.find((module) => module.key === "exchanges").count === 3, "预览写入或历史计数错误");
        assert(preview.find((module) => module.key === "aliases").tombstones === 1, "删除标记未预览");
        const target = memoryStore([["contacts-settings.json", settings]]);
        const restored = await importMigrationBundle(target.plugin, exported);
        assert(restored.failed.length === 0 && restored.issues.length === 0, "正常恢复出现失败");
        assert(JSON.stringify(await loadExchangeStore(target.plugin)) === JSON.stringify(parsed.modules.exchanges), "账本往返丢失历史");
        assert((await loadPersonAliasStore(target.plugin)).aliases[0].id === active.id, "别名稳定 ID 丢失");
        assert((await loadPersonAliasStore(target.plugin)).tombstones.includes(removed.id), "墓碑丢失");
        const again = await importMigrationBundle(target.plugin, exported);
        assert(again.modules.filter((module) => ["exchanges", "aliases"].includes(module.key)).every((module) => module.merged === 0), "重复恢复新增事实");
        delete parsed.modules.relationshipLabels;
        const oldTen = await importMigrationBundle(target.plugin, JSON.stringify(parsed));
        assert(oldTen.failed.length === 0, "旧十模块包不兼容");
        delete parsed.modules.orgMemberships;
        const oldNine = await importMigrationBundle(target.plugin, JSON.stringify(parsed));
        assert(oldNine.failed.length === 0, "旧九模块包不兼容");
        delete parsed.modules.exchanges;
        delete parsed.modules.aliases;
        delete parsed.modules.selfIdentity;
        const old = await importMigrationBundle(memoryStore().plugin, JSON.stringify(parsed));
        assert(old.failed.length === 0 && !old.retryBundle, "旧六模块包不兼容");
    });

    await test("迁移实际服务：不可达与冲突可定位、独立模块继续，重试包仅保留未完成模块", async () => {
        const source = memoryStore();
        const original = await createExchangeRecord(source.plugin, exchangeInput(person.docId, "20261004000000-ex00001"));
        const orphan = { ...original, id: "20261004000000-ex00002", personDocId: "20261004000000-orphan1" };
        const target = memoryStore([["contacts-settings.json", settings], ["exchange-records.json", { schemaVersion: 1, records: [{ ...original, status: "cancelled" }] }]]);
        const result = await importMigrationBundle(target.plugin, bundle({
            exchanges: { schemaVersion: 1, records: [original, orphan] },
            registry: { schemaVersion: 1, registeredAt: { [person.docId]: "2026-10-04" } },
        }));
        assert(result.issues.length === 2 && result.issues.some((entry) => entry.id === orphan.id && entry.reason === "unreachable"), "冲突/不可达未定位");
        assert((await loadExchangeStore(target.plugin)).records[0].status === "cancelled", "旧包覆盖当前取消状态");
        assert(target.files.get("person-registry.json").registeredAt[person.docId] === "2026-10-04", "失败阻断独立模块");
        assert(Object.keys(JSON.parse(result.retryBundle).modules).join() === "exchanges", "重试包重复成功模块");
        const noAnchor = await importMigrationBundle(memoryStore().plugin, bundle({ exchanges: { schemaVersion: 1, records: [original] } }));
        assert(noAnchor.failed[0].message.includes("重绑") && noAnchor.failed[0].status === "failed", "无法确认名册冒充空名册");
    });

    await test("迁移实际服务：未知写后核实不重复、坏模块预览零写入、坏当前库不覆盖", async () => {
        const source = memoryStore();
        const record = await createExchangeRecord(source.plugin, exchangeInput(person.docId, "20261004000000-ex00001"));
        const text = bundle({ exchanges: { schemaVersion: 1, records: [record] } });
        const target = memoryStore([["contacts-settings.json", settings]]);
        target.failKey = "exchange-records.json";
        target.failReadsAfterSave = true;
        const unknown = await importMigrationBundle(target.plugin, text);
        assert(unknown.failed.length === 1 && unknown.failed[0].status === "unknown" && unknown.retryBundle, "未核实写入报成功/普通失败");
        const savedWrites = target.writes.length;
        target.failReadsAfterSave = false;
        const verified = await importMigrationBundle(target.plugin, unknown.retryBundle);
        assert(verified.failed.length === 0 && !verified.retryBundle && target.writes.length === savedWrites, "核实重试重复写入");
        assert((await loadExchangeStore(target.plugin)).records.length === 1, "未知结果重试产生两条事实");
        for (const module of [{ schemaVersion: 2, records: [] }, { schemaVersion: 1, records: [record, { id: "bad" }] }]) {
            let rejected = false;
            try { previewMigrationImport(bundle({ exchanges: module })); } catch { rejected = true; }
            assert(rejected && target.writes.length === savedWrites, "坏包预览未停止或产生写入");
        }
        const damaged = { schemaVersion: 7, records: [] };
        target.files.set("exchange-records.json", damaged);
        const failed = await importMigrationBundle(target.plugin, text);
        assert(failed.failed[0].status === "failed" && target.writes.length === savedWrites, "坏库写入或误报未知");
        assert(JSON.stringify(target.files.get("exchange-records.json")) === JSON.stringify(damaged), "坏原库被污染");
    });

    await test("迁移实际服务：别名墓碑与并发新增互斥合并，不复活、不丢并发事实", async () => {
        const state = memoryStore();
        const deleted = await createPersonAlias(state.plugin, person.docId, "迁移旧称呼");
        const old = await loadPersonAliasStore(state.plugin);
        await deletePersonAlias(state.plugin, deleted.id);
        await Promise.all([
            mergePersonAliasStore(state.plugin, old, new Set([person.docId])),
            createPersonAlias(state.plugin, person.docId, "迁移新称呼"),
        ]);
        const result = await loadPersonAliasStore(state.plugin);
        assert(result.aliases.length === 1 && result.aliases[0].alias === "迁移新称呼" && result.tombstones.includes(deleted.id), "旧包复活或覆盖并发新增");
    });

    await test("成员迁移实际服务：归档组织、分类和多段历史往返，仅保存事实零文档写入", async () => {
        const state = projectionFixture(kernel, settings);
        state.archived = true;
        state.store.set("contacts-settings.json", settings);
        const active = { ...state.membership() };
        state.store.set(ORG_MEMBERSHIP_STORAGE_KEY, { schemaVersion: 1, memberships: [active,
            { ...active, id: "20261004000000-member2", status: "former", leftOn: "2025-06-01", affiliationKind: "education" },
            { ...active, id: "20261004000000-member3", status: "former", leftOn: "2025-08-01" },
        ], tombstones: ["20261004000000-member4"] });
        const exported = await exportMigrationBundle(state.plugin);
        const before = state.jsonWrites.length;
        const preview = previewMigrationImport(exported).find((module) => module.key === "orgMemberships");
        assert(preview.count === 3 && preview.tombstones === 1 && state.jsonWrites.length === before, "成员只读预览丢失历史或删除标记");
        const source = JSON.stringify(await loadOrgMembershipStore(state.plugin));
        state.store.delete(ORG_MEMBERSHIP_STORAGE_KEY);
        const restored = await importMigrationBundle(state.plugin, exported);
        assert(restored.failed.length === 0 && restored.issues.length === 0, "归档组织恢复被拒绝");
        assert(JSON.stringify(await loadOrgMembershipStore(state.plugin)) === source && state.archived && state.documentWrites.length === 0, "成员历史丢失、自动解档或写文档");
        const writes = state.jsonWrites.length;
        await importMigrationBundle(state.plugin, bundle({ orgMemberships: JSON.parse(source) }));
        assert(state.jsonWrites.length === writes, "重复成员恢复写入");
    });

    await test("成员迁移实际服务：同名不映射、双方孤儿与当前冲突可定位，权限未知不当空", async () => {
        const state = projectionFixture(kernel, settings);
        state.store.set("contacts-settings.json", settings);
        const original = { ...state.membership() };
        const result = await importMigrationBundle(state.plugin, bundle({ orgMemberships: { schemaVersion: 1, memberships: [
            { ...original, title: "旧职位" },
            { ...original, id: "20261004000000-member2", status: "former", personDocId: "20261004000000-person2" },
            { ...original, id: "20261004000000-member3", status: "former", orgDocId: "20261004000000-org0002" },
            { ...original, id: "20261004000000-member4", personDocId: state.orgDocId },
        ] }, registry: { schemaVersion: 1, registeredAt: { [state.personDocId]: "2026-10-04" } } }));
        assert(result.issues.length === 4 && result.issues.every((entry) => entry.orgDocId && entry.personDocId), "成员冲突或双方 ID 未报告");
        assert((await loadOrgMembershipStore(state.plugin)).memberships[0].title === original.title && state.store.has("person-registry.json"), "覆盖现状或阻断独立模块");
        state.store.delete(ORG_MEMBERSHIP_STORAGE_KEY);
        state.people.push({ ...state.people[0], itemId: "20261004000000-item002" });
        const duplicate = await importMigrationBundle(state.plugin, bundle({ orgMemberships: { schemaVersion: 1, memberships: [original] } }));
        assert(duplicate.issues[0]?.reason === "unreachable" && !state.store.has(ORG_MEMBERSHIP_STORAGE_KEY), "重复人物绑定被集合折叠后恢复");
        kernel.handler = async () => { throw new Error("组织核实权限失败"); };
        const failed = await importMigrationBundle(state.plugin, bundle({ orgMemberships: { schemaVersion: 1, memberships: [original] } }));
        assert(failed.failed[0]?.status === "failed" && failed.retryBundle && !state.store.has(ORG_MEMBERSHIP_STORAGE_KEY), "读取失败伪装空组织");
    });

    await test("成员迁移实际服务：写后未知只核实、坏包零写入，坏当前库不覆盖", async () => {
        const state = projectionFixture(kernel, settings);
        state.store.set("contacts-settings.json", settings);
        const original = { ...state.membership() };
        state.store.delete(ORG_MEMBERSHIP_STORAGE_KEY);
        const text = bundle({ orgMemberships: { schemaVersion: 1, memberships: [original] } });
        state.failMembershipReadAfterSave = true;
        const unknown = await importMigrationBundle(state.plugin, text);
        assert(unknown.failed[0]?.status === "unknown" && unknown.retryBundle && state.documentWrites.length === 0, "未知报告丢失或重放文档");
        const writes = state.jsonWrites.length;
        state.failMembershipReadAfterSave = false;
        const verified = await importMigrationBundle(state.plugin, unknown.retryBundle);
        assert(verified.failed.length === 0 && state.jsonWrites.length === writes, "核实重试重复写成员");
        for (const module of [{ schemaVersion: 2, memberships: [] }, { schemaVersion: 1, memberships: [original], tombstones: [original.id] },
            { schemaVersion: 1, memberships: [original, { ...original, id: "20261004000000-member2" }] }]) {
            let rejected = false;
            try { await importMigrationBundle(state.plugin, bundle({ orgMemberships: module })); } catch { rejected = true; }
            assert(rejected && state.jsonWrites.length === writes, "坏成员包产生写入");
        }
        const damaged = { schemaVersion: 8, memberships: [] };
        state.store.set(ORG_MEMBERSHIP_STORAGE_KEY, damaged);
        const failed = await importMigrationBundle(state.plugin, text);
        assert(failed.failed[0]?.status === "failed" && state.jsonWrites.length === writes && JSON.stringify(state.store.get(ORG_MEMBERSHIP_STORAGE_KEY)) === JSON.stringify(damaged), "坏成员原库被覆盖");
    });

    await test("成员迁移实际存储：删除标记跨旧包不复活，锁内合并不丢并发加入", async () => {
        const state = projectionFixture(kernel, settings);
        const original = { ...state.membership() };
        const old = await loadOrgMembershipStore(state.plugin);
        await removeOrgMembership(state.plugin, original.id);
        await Promise.all([
            mergeOrgMembershipStore(state.plugin, old, new Set([state.personDocId]), new Set([state.orgDocId])),
            addOrgMembership(state.plugin, { orgDocId: state.orgDocId, personDocId: state.personDocId, title: "新期间" }),
        ]);
        const result = await loadOrgMembershipStore(state.plugin);
        assert(result.memberships.length === 1 && result.memberships[0].id !== original.id && result.tombstones.includes(original.id), "已删历史复活或并发加入丢失");
        const before = state.jsonWrites.length;
        const tombPreview = previewMigrationImport(bundle({ orgMemberships: { schemaVersion: 1, memberships: [], tombstones: [original.id] } }));
        assert(tombPreview[0].count === 0 && tombPreview[0].tombstones === 1 && state.jsonWrites.length === before, "纯删除标记包被遗漏");
    });

    await test("迁移设置页：范围说明、删除标记和未知模块重试入口保留", async () => {
        const source = memoryStore();
        const record = await createExchangeRecord(source.plugin, exchangeInput(person.docId, "20261004000000-ex00001"));
        const target = memoryStore([["contacts-settings.json", settings]]);
        target.failKey = "exchange-records.json";
        target.failReadsAfterSave = true;
        const component = mount(SettingsView, { target: fixture, props: {
            settings, preferences: DEFAULT_VIEW_PREFERENCES,
            facade: {
                checkSettingsHealth: async () => ({ ok: true, issues: [] }),
                loadExportSummary: async () => ({ people: 1, interactions: 0 }),
                loadReminderDismissals: async () => [],
                previewMigrationImport: async (text) => previewMigrationImport(text),
                importMigrationBundle: (text) => importMigrationBundle(target.plugin, text),
            }, onSettingsUpdated() {}, onPreferencesUpdated() {}, onBack() {},
        } });
        try {
            button("数据与字段").click();
            await until(() => fixture.querySelector("#lvct-migration-bundle"), "未显示迁移入口");
            assert(fixture.textContent.includes("本人身份按原文档 ID 核实当前绑定") && fixture.textContent.includes("组织成员含任职分类、离职历史及删除标记"), "迁移范围未显示");
            const transfer = new DataTransfer();
            transfer.items.add(new File([bundle({ exchanges: { schemaVersion: 1, records: [record] } })], "migration.json", { type: "application/json" }));
            const fileInput = fixture.querySelector("#lvct-migration-bundle");
            fileInput.files = transfer.files;
            fileInput.dispatchEvent(new Event("change", { bubbles: true }));
            await until(() => fixture.textContent.includes("往来账本：1 条"), "新模块预览未显示");
            assert(target.writes.length === 0, "预览产生写入");
            button("确认恢复（现状优先合并）").click();
            await until(() => fixture.textContent.includes("迁移恢复待核实"), "未知被当成全部恢复成功");
            target.failReadsAfterSave = false;
            const before = target.writes.length;
            button("核实并重试未完成模块").click();
            await until(() => fixture.textContent.includes("迁移恢复完成"), "核实重试未完成");
            assert(target.writes.length === before, "UI重试重复写已保存模块");
        } finally {
            await unmount(component);
        }
    });
}
