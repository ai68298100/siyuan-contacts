/**
 * E-37 人物协作项目存储层（插件自管 JSON）：Web Lock 临界区 + 写后回读。
 * 键：person-projects.json
 */

import type { Plugin } from "siyuan";
import { loadJson, loadJsonStrict, saveJsonVerified, withStoreLock } from "./storage.ts";
import {
    addProjectToStore,
    findPeopleByProject,
    normalizePersonProjectsStore,
    normalizePersonProjectsStoreForWrite,
    removeProjectFromStore,
    updateProjectInStore,
    type PersonProjectItem,
    type PersonProjectsStore,
    type ProjectStatus,
} from "../domain/projects.ts";

export const PERSON_PROJECTS_STORAGE_KEY = "person-projects.json";

/** 容错读取（展示使用） */
export async function loadPersonProjectsStore(plugin: Plugin): Promise<PersonProjectsStore> {
    return normalizePersonProjectsStore(await loadJson(plugin, PERSON_PROJECTS_STORAGE_KEY));
}

/** 严格读取（写前检查使用） */
export async function loadPersonProjectsStoreStrict(plugin: Plugin): Promise<PersonProjectsStore> {
    return normalizePersonProjectsStoreForWrite(await loadJsonStrict(plugin, PERSON_PROJECTS_STORAGE_KEY));
}

/** 读取指定人物的协作项目列表 */
export async function loadPersonProjects(plugin: Plugin, personDocId: string): Promise<PersonProjectItem[]> {
    const store = await loadPersonProjectsStore(plugin);
    return store.projects[personDocId] ? [...store.projects[personDocId]] : [];
}

/** 为指定人物新增项目协作并落盘 */
export async function addPersonProject(
    plugin: Plugin,
    item: PersonProjectItem,
): Promise<PersonProjectItem[]> {
    return withStoreLock(PERSON_PROJECTS_STORAGE_KEY, async () => {
        const store = normalizePersonProjectsStoreForWrite(await loadJsonStrict(plugin, PERSON_PROJECTS_STORAGE_KEY));
        const updated = addProjectToStore(store, item);
        await saveJsonVerified(plugin, PERSON_PROJECTS_STORAGE_KEY, updated);
        return updated.projects[item.personDocId] ? [...updated.projects[item.personDocId]] : [];
    });
}

/** 更新指定人物的某条项目协作并落盘 */
export async function updatePersonProject(
    plugin: Plugin,
    personDocId: string,
    projectId: string,
    patch: Partial<Omit<PersonProjectItem, "id" | "personDocId" | "createdAt">>,
): Promise<PersonProjectItem[]> {
    return withStoreLock(PERSON_PROJECTS_STORAGE_KEY, async () => {
        const store = normalizePersonProjectsStoreForWrite(await loadJsonStrict(plugin, PERSON_PROJECTS_STORAGE_KEY));
        const updated = updateProjectInStore(store, personDocId, projectId, patch);
        await saveJsonVerified(plugin, PERSON_PROJECTS_STORAGE_KEY, updated);
        return updated.projects[personDocId] ? [...updated.projects[personDocId]] : [];
    });
}

/** 移除指定人物的某条项目协作并落盘 */
export async function removePersonProject(
    plugin: Plugin,
    personDocId: string,
    projectId: string,
): Promise<PersonProjectItem[]> {
    return withStoreLock(PERSON_PROJECTS_STORAGE_KEY, async () => {
        const store = normalizePersonProjectsStoreForWrite(await loadJsonStrict(plugin, PERSON_PROJECTS_STORAGE_KEY));
        const updated = removeProjectFromStore(store, personDocId, projectId);
        await saveJsonVerified(plugin, PERSON_PROJECTS_STORAGE_KEY, updated);
        return updated.projects[personDocId] ? [...updated.projects[personDocId]] : [];
    });
}

/** 按项目名称或关联思源文档 ID 反查协作团队成员名单 */
export async function findCollaboratorsByProject(
    plugin: Plugin,
    matcher: { title?: string; docId?: string },
): Promise<Array<{ personDocId: string; role?: string; status: ProjectStatus; title: string }>> {
    const store = await loadPersonProjectsStore(plugin);
    return findPeopleByProject(store, matcher);
}
