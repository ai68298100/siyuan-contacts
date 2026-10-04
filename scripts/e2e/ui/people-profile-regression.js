import { mount, unmount } from "svelte";
import { projectionFixture } from "./organization-projection-regression.js";
import { bindPeopleProfileStorage, loadPersonRelationshipLabels, savePersonRelationshipLabels } from "../../../src/services/people-profiles";
import { loadRelationshipLabelStore, RELATIONSHIP_LABEL_STORAGE_KEY } from "../../../src/data/person-relationship-labels";
import { bindSelfIdentityStorage } from "../../../src/data/self-identity";
import { listContacts } from "../../../src/services/contacts";
import { applyPeopleFilters, EMPTY_PEOPLE_FILTER } from "../../../src/domain/people-filters";
import { normalizeSavedViews } from "../../../src/domain/saved-views";
import { buildBriefingMarkdown } from "../../../src/domain/briefing-export";
import { DEFAULT_VIEW_PREFERENCES } from "../../../src/domain/preferences";
import { exportMigrationBundle, importMigrationBundle, previewMigrationImport } from "../../../src/services/migration-bundle";
import RelationshipLabels from "../../../src/components/people/RelationshipLabels.svelte";
import PeopleView from "../../../src/components/people/PeopleView.svelte";

function profileFixture(kernel, settings) {
    const state = projectionFixture(kernel, settings);
    state.selfDocId = "20261004000000-self001";
    state.people.push({ docId: state.selfDocId, itemId: "20261004000000-selfrow", name: "隔离本人" });
    state.store.set("contacts-settings.json", settings);
    state.store.set("self-identity.json", { schemaVersion: 1, selfDocId: state.selfDocId, selfItemId: "20261004000000-selfrow", createdAt: "2026-10-04" });
    bindSelfIdentityStorage(state.plugin);
    state.unreachableDocIds = new Set();
    state.mappingOverrides = new Map();
    state.badBindingMap = false;
    state.badDocumentRows = false;
    const originalHandler = kernel.handler;
    kernel.handler = async (route, body) => {
        if (route === "/api/av/getAttributeViewItemIDsByBoundIDs") {
            if (state.badBindingMap) return [];
            return Object.fromEntries(body.blockIDs.flatMap((docId) => {
                const people = state.people.filter((person) => person.docId === docId);
                return people.length === 1 ? [[docId, state.mappingOverrides.get(docId) ?? people[0].itemId]] : [];
            }));
        }
        if (route === "/api/query/sql" && /\btype\s*=\s*'d'/.test(body.stmt)) {
            const docId = body.stmt.match(/\bid\s*=\s*'([^']+)'/)?.[1];
            if (docId) {
                if (state.failReadDocId === docId) throw new Error("人物文档读取失败");
                if (state.badDocumentRows) return [{ invalid: true }];
                const person = state.people.find((entry) => entry.docId === docId);
                const content = person?.name ?? (docId === state.orgDocId ? "测试单位" : undefined);
                return content !== undefined && !state.unreachableDocIds.has(docId)
                    ? [{ id: docId, content, box: settings.notebookId, hpath: `/${content}`, path: `/${docId}.sy` }] : [];
            }
        }
        return originalHandler(route, body);
    };
    return state;
}

export async function runPeopleProfileRegression({ test, assert, kernel, settings, fixture, until, button }) {
    await test("三项资料实际服务：成员分类与本人称谓共用名册投影，历史/归档不冒充当前", async () => {
        const state = profileFixture(kernel, settings);
        let editor = await loadPersonRelationshipLabels(state.plugin, settings, state.personDocId);
        const record = await savePersonRelationshipLabels(state.plugin, settings, state.personDocId, editor.selfDocId, ["朋友", "同学"], editor.record);
        bindPeopleProfileStorage(state.plugin);
        try {
            const roster = await listContacts(settings);
            const person = roster.find((entry) => entry.docId === state.personDocId);
            assert(person.profile.affiliations.value.work[0].orgDocId === state.orgDocId && person.profile.relationship.labels.join() === "朋友,同学", "名册投影未接通三项事实");
            assert(applyPeopleFilters(roster, {}, { ...EMPTY_PEOPLE_FILTER, workQuery: "研发", relationshipLabel: "同学" }).length === 1, "分类与称谓组合过滤不一致");
            const briefing = buildBriefingMarkdown({ person, timeline: [], followUps: [], relatedNames: [], coAttendance: [], limit: 0, generatedAt: "测试" });
            assert(briefing.includes("工作单位") && briefing.includes("朋友、同学") && briefing.includes("测试单位"), "简报丢失共用快照");
            const queries = normalizeSavedViews([{ id: "test", name: "学校与朋友", query: { search: "", group: "", tags: [], tagMatch: "all", recentFrom: "", recentTo: "", neverContacted: false, sort: "name", workQuery: "研发", educationQuery: "大学", relationshipLabel: "同学" } }]);
            assert(queries[0].query.workQuery === "研发" && queries[0].query.relationshipLabel === "同学", "保存视图丢失资料规则");
            state.archived = true;
            const archived = (await listContacts(settings)).find((entry) => entry.docId === state.personDocId);
            assert(archived.profile.affiliations.value.work.length === 0 && archived.profile.affiliations.value.history.length === 1, "归档组织仍显示当前单位");
            state.store.set(RELATIONSHIP_LABEL_STORAGE_KEY, { schemaVersion: 8, labels: [] });
            const unknown = (await listContacts(settings)).find((entry) => entry.docId === state.personDocId);
            assert(unknown.profile.relationship.state === "unknown" && unknown.profile.affiliations.state === "known", "称谓故障被当空或污染其他来源");
            assert(record.selfDocId === state.selfDocId, "称谓本人参照丢失");
        } finally { bindPeopleProfileStorage(undefined); }
    });

    await test("三项资料实际写入：本人换绑/并发编辑拒绝旧草稿，明确清空与未知回读幂等", async () => {
        const state = profileFixture(kernel, settings);
        const first = await savePersonRelationshipLabels(state.plugin, settings, state.personDocId, state.selfDocId, ["朋友"], null);
        const second = await savePersonRelationshipLabels(state.plugin, settings, state.personDocId, state.selfDocId, ["同学"], first);
        let rejected = false;
        try { await savePersonRelationshipLabels(state.plugin, settings, state.personDocId, state.selfDocId, ["旧草稿"], first); } catch { rejected = true; }
        assert(rejected && (await loadRelationshipLabelStore(state.plugin)).labels[0].labels[0] === "同学", "过期称谓覆盖并发修改");
        const cleared = await savePersonRelationshipLabels(state.plugin, settings, state.personDocId, state.selfDocId, [], second);
        assert(cleared.id === first.id && cleared.labels.length === 0, "清空删除组合身份");
        const writes = state.jsonWrites.length;
        await savePersonRelationshipLabels(state.plugin, settings, state.personDocId, state.selfDocId, [], first);
        assert(state.jsonWrites.length === writes, "重复目标重写称谓");
        state.store.get("self-identity.json").selfDocId = state.personDocId;
        rejected = false;
        try { await savePersonRelationshipLabels(state.plugin, settings, state.personDocId, state.selfDocId, ["转移"], cleared); } catch { rejected = true; }
        assert(rejected && state.jsonWrites.length === writes, "换绑后转移旧参照");
        state.store.get("self-identity.json").selfDocId = state.selfDocId;
        const originalLoad = state.plugin.loadData;
        state.plugin.loadData = async (key) => {
            if (key === RELATIONSHIP_LABEL_STORAGE_KEY && state.jsonWrites.length > writes) throw new Error("称谓写后读取失败");
            return originalLoad(key);
        };
        let unknown;
        try { await savePersonRelationshipLabels(state.plugin, settings, state.personDocId, state.selfDocId, ["朋友"], cleared); } catch (error) { unknown = error; }
        assert(unknown?.name === "MigrationWriteUnknownError", "写后失败没有保留未知");
        state.plugin.loadData = originalLoad;
        const verified = await loadPersonRelationshipLabels(state.plugin, settings, state.personDocId);
        assert(verified.record.labels[0] === "朋友" && state.jsonWrites.length === writes + 1, "核实未知重写称谓");
    });

    await test("三项资料真实可达性：失效文档、错绑与坏形状均停止写入和恢复", async () => {
        for (const fault of ["deleted", "mapping", "bad_map", "bad_document"]) {
            const state = profileFixture(kernel, settings);
            if (fault === "deleted") state.unreachableDocIds.add(state.personDocId);
            if (fault === "mapping") state.mappingOverrides.set(state.personDocId, "20261004000000-other01");
            if (fault === "bad_map") state.badBindingMap = true;
            if (fault === "bad_document") state.badDocumentRows = true;
            let rejected = false;
            try { await savePersonRelationshipLabels(state.plugin, settings, state.personDocId, state.selfDocId, ["朋友"], null); }
            catch { rejected = true; }
            assert(rejected && state.jsonWrites.length === 0, `${fault} 仍保存称谓`);
            const restored = await importMigrationBundle(state.plugin, JSON.stringify({
                schemaVersion: 1, storageKey: "lvct-migration-bundle", modules: { relationshipLabels: { schemaVersion: 1, labels: [{
                    id: "20261004000000-label01", selfDocId: state.selfDocId, personDocId: state.personDocId,
                    labels: ["朋友"], createdAt: 1, updatedAt: 1,
                }] } },
            }));
            assert(restored.modules.every((module) => module.merged === 0) && restored.retryBundle
                && (restored.failed.length > 0 || restored.issues.some((issue) => issue.reason === "unreachable"))
                && state.jsonWrites.length === 0 && state.documentWrites.length === 0, `${fault} 恢复被当成功或发出写入`);
        }
    });

    await test("三项资料迁移：十一模块保留称谓参照和空值，冲突/其他本人留待核实", async () => {
        const state = profileFixture(kernel, settings);
        const record = await savePersonRelationshipLabels(state.plugin, settings, state.personDocId, state.selfDocId, ["朋友"], null);
        const exported = await exportMigrationBundle(state.plugin);
        assert(previewMigrationImport(exported).find((entry) => entry.key === "relationshipLabels").count === 1, "称谓未进迁移预览");
        const parsed = JSON.parse(exported);
        const text = JSON.stringify({ schemaVersion: 1, storageKey: parsed.storageKey, modules: { relationshipLabels: parsed.modules.relationshipLabels } });
        const cleared = await savePersonRelationshipLabels(state.plugin, settings, state.personDocId, state.selfDocId, [], record);
        const conflict = await importMigrationBundle(state.plugin, text);
        assert(conflict.issues[0].selfDocId === state.selfDocId && (await loadRelationshipLabelStore(state.plugin)).labels[0].labels.length === 0, "旧包复活明确清空");
        state.store.delete(RELATIONSHIP_LABEL_STORAGE_KEY);
        const restored = await importMigrationBundle(state.plugin, text);
        assert(restored.failed.length === 0 && restored.issues.length === 0 && (await loadRelationshipLabelStore(state.plugin)).labels[0].id === record.id, "原本人参照未恢复");
        state.store.delete(RELATIONSHIP_LABEL_STORAGE_KEY);
        state.store.delete("self-identity.json");
        const missing = await importMigrationBundle(state.plugin, text);
        assert(missing.issues[0].reason === "unreachable" && missing.retryBundle && !state.store.has(RELATIONSHIP_LABEL_STORAGE_KEY), "无本人自动搬移称谓");
        assert(cleared.id === record.id && state.documentWrites.length === 0, "称谓写进组织文档");
    });

    await test("三项资料界面：称谓保存、取消/未知只读核实、失败与草稿保护", async () => {
        const state = profileFixture(kernel, settings);
        let changes = 0;
        const component = mount(RelationshipLabels, { target: fixture, props: {
            personDocId: state.personDocId,
            onLoad: (docId) => loadPersonRelationshipLabels(state.plugin, settings, docId),
            onSave: (docId, selfDocId, labels, expected) => savePersonRelationshipLabels(state.plugin, settings, docId, selfDocId, labels, expected),
            onChanged: () => changes++,
        } });
        try {
            await until(() => fixture.querySelector("input"), "称谓表单未读取");
            const input = fixture.querySelector("input");
            input.value = "朋友、同学";
            input.dispatchEvent(new Event("input", { bubbles: true }));
            await until(() => !button("保存称谓").disabled, "称谓修改未启用");
            button("保存称谓").click();
            await until(() => fixture.textContent.includes("称谓已保存并核实"), "称谓结果未显示");
            assert(document.activeElement?.textContent.includes("称谓已保存并核实") && changes === 1, "结果焦点或刷新未完成");
            input.value = "未保存";
            input.dispatchEvent(new Event("input", { bubbles: true }));
            await until(() => !button("保存称谓").disabled, "草稿未变更");
            const savedRecord = JSON.stringify(state.store.get(RELATIONSHIP_LABEL_STORAGE_KEY));
            button("取消称谓草稿").click();
            await until(() => fixture.querySelector("input")?.value === "朋友、同学", "取消没有恢复原值");
            assert(state.jsonWrites.length === 1 && JSON.stringify(state.store.get(RELATIONSHIP_LABEL_STORAGE_KEY)) === savedRecord, "取消产生写入或修改已保存记录");
        } finally { await unmount(component); }
    });

    await test("三项资料联系人界面：卡片/表格和筛选使用同一快照，来源故障可重读", async () => {
        const state = profileFixture(kernel, settings);
        await savePersonRelationshipLabels(state.plugin, settings, state.personDocId, state.selfDocId, ["同学"], null);
        bindPeopleProfileStorage(state.plugin);
        const component = mount(PeopleView, { target: fixture, props: {
            settings, preferences: { ...DEFAULT_VIEW_PREFERENCES, peopleView: "table", tableColumns: ["org", "school", "relationship"] },
            revision: 0, initialSort: "name", loadRecentInteractions: async () => ({}), onOpenDetail() {},
            onPreferencesChange: async (next) => next,
        } });
        try {
            await until(() => fixture.querySelector("tbody")?.textContent.includes("同学"), "表格没有共用称谓投影");
            assert(fixture.querySelector("tbody").textContent.includes("测试单位"), "表格没有单位投影");
            button("更多筛选").click();
            await until(() => fixture.querySelector("input[maxlength='200']"), "资料筛选未出现");
            const query = fixture.querySelector("input[maxlength='200']");
            query.value = "不存在的单位";
            query.dispatchEvent(new Event("input", { bubbles: true }));
            await until(() => fixture.textContent.includes("工作单位：不存在的单位"), "生效条件未显示");
            assert(!fixture.querySelector("tbody"), "单位筛选没有重新求值");
        } finally { await unmount(component); bindPeopleProfileStorage(undefined); }
    });
}
