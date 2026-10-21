import assert from "node:assert/strict";
import test from "node:test";
import {
    addProjectToStore,
    emptyPersonProjectsStore,
    findPeopleByProject,
    newProjectId,
    normalizePersonProjectsStore,
    normalizePersonProjectsStoreForWrite,
    removeProjectFromStore,
    updateProjectInStore,
    validatePersonProject,
    MAX_PROJECTS_PER_PERSON,
    type PersonProjectItem,
} from "../src/domain/projects.ts";
import { StoreIntegrityError } from "../src/domain/store-integrity.ts";
import {
    addPersonProject,
    findCollaboratorsByProject,
    loadPersonProjects,
    loadPersonProjectsStoreStrict,
    removePersonProject,
    updatePersonProject,
    PERSON_PROJECTS_STORAGE_KEY,
} from "../src/data/projects.ts";
import type { Plugin } from "siyuan";

const personDocId = "20261019000000-doc0001";

function mockProject(partial: Partial<PersonProjectItem> = {}): PersonProjectItem {
    return {
        id: "20261020000000-proj001",
        personDocId,
        title: "Q4 战略复盘",
        docId: "20261020000000-sdoc001",
        status: "active",
        role: "核心成员",
        note: "主导架构重构",
        createdAt: 1700000000000,
        updatedAt: 1700000000000,
        ...partial,
    };
}

test("E-37 project: validatePersonProject 校验与边界防御", () => {
    const valid = mockProject();
    assert.deepEqual(validatePersonProject(valid), []);

    // 标题为空或超长
    assert.ok(validatePersonProject({ ...valid, title: "" }).some((e) => e.includes("不能为空")));
    assert.ok(validatePersonProject({ ...valid, title: "长".repeat(81) }).some((e) => e.includes("不能超过 80")));

    // 人物文档 ID 非法
    assert.ok(validatePersonProject({ ...valid, personDocId: "invalid" }).some((e) => e.includes("文档 ID 无效")));

    // 关联文档 ID 非法
    assert.ok(validatePersonProject({ ...valid, docId: "bad-doc" }).some((e) => e.includes("关联文档 ID 无效")));

    // 角色超长
    assert.ok(validatePersonProject({ ...valid, role: "角".repeat(41) }).some((e) => e.includes("不能超过 40")));
});

test("E-37 project: add/update/remove 与单人 30 项上限保护", () => {
    let store = emptyPersonProjectsStore();

    // 新增
    const p1 = mockProject({ id: "p1", title: "开源插件研发" });
    const p2 = mockProject({ id: "p2", title: "技术研讨会", status: "completed" });
    store = addProjectToStore(store, p1);
    store = addProjectToStore(store, p2);
    assert.equal(store.projects[personDocId].length, 2);

    // 更新
    store = updateProjectInStore(store, personDocId, "p1", { role: "发起人", status: "completed" });
    const updated = store.projects[personDocId].find((p) => p.id === "p1");
    assert.equal(updated?.role, "发起人");
    assert.equal(updated?.status, "completed");

    // 移除
    store = removeProjectFromStore(store, personDocId, "p2");
    assert.equal(store.projects[personDocId].length, 1);
    assert.equal(store.projects[personDocId][0].id, "p1");

    // 单人上限保护
    for (let i = 1; i < MAX_PROJECTS_PER_PERSON; i++) {
        store = addProjectToStore(store, mockProject({ id: `fill-${i}`, title: `项目 ${i}` }));
    }
    assert.equal(store.projects[personDocId].length, MAX_PROJECTS_PER_PERSON);
    assert.throws(() => addProjectToStore(store, mockProject({ id: "overflow", title: "超额" })), /最多关联 30 个/);
});

test("E-37 project: findPeopleByProject 按项目名称或关联文档反查参与人", () => {
    let store = emptyPersonProjectsStore();
    const docA = "20261019000000-doc0001";
    const docB = "20261019000000-doc0002";
    const projectDocId = "20261020000000-sdoc001";

    store = addProjectToStore(store, mockProject({ id: "p1", personDocId: docA, title: "年度财报分析", docId: projectDocId }));
    store = addProjectToStore(store, mockProject({ id: "p2", personDocId: docB, title: "年度财报分析", role: "审计", docId: undefined }));

    // 按标题反查
    const byTitle = findPeopleByProject(store, { title: "年度财报分析" });
    assert.equal(byTitle.length, 2);
    assert.ok(byTitle.some((item) => item.personDocId === docA));
    assert.ok(byTitle.some((item) => item.personDocId === docB));

    // 按文档 ID 反查
    const byDoc = findPeopleByProject(store, { docId: projectDocId });
    assert.equal(byDoc.length, 1);
    assert.equal(byDoc[0].personDocId, docA);
});

test("E-37 project 数据层：存储闭环、严格读写与坏数据拒绝", async () => {
    const memory = new Map<string, unknown>();
    const plugin = {
        async loadData(key: string) {
            return memory.has(key) ? structuredClone(memory.get(key)) : null;
        },
        async saveData(key: string, value: unknown) {
            memory.set(key, structuredClone(value));
        },
    } as unknown as Plugin;

    // 初始状态为空
    assert.deepEqual(await loadPersonProjects(plugin, personDocId), []);

    // 新增两个项目
    const p1 = mockProject({ id: "20261020000000-p01", title: "AI Agent 研发" });
    const p2 = mockProject({ id: "20261020000000-p02", title: "人脉知识图谱" });
    await addPersonProject(plugin, p1);
    await addPersonProject(plugin, p2);

    const loaded = await loadPersonProjects(plugin, personDocId);
    assert.equal(loaded.length, 2);

    // 更新
    await updatePersonProject(plugin, personDocId, p1.id, { role: "技术负责人" });
    const afterUpdate = await loadPersonProjects(plugin, personDocId);
    assert.equal(afterUpdate.find((p) => p.id === p1.id)?.role, "技术负责人");

    // 反查
    const collabs = await findCollaboratorsByProject(plugin, { title: "AI Agent 研发" });
    assert.equal(collabs.length, 1);
    assert.equal(collabs[0].personDocId, personDocId);

    // 移除
    await removePersonProject(plugin, personDocId, p2.id);
    const afterRemove = await loadPersonProjects(plugin, personDocId);
    assert.equal(afterRemove.length, 1);
    assert.equal(afterRemove[0].id, p1.id);

    // 坏数据严格拒绝
    memory.set(PERSON_PROJECTS_STORAGE_KEY, { schemaVersion: 999, projects: {} });
    await assert.rejects(() => loadPersonProjectsStoreStrict(plugin), StoreIntegrityError);
});
