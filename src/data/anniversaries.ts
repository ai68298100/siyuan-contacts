/**
 * E-36 重要日期与周年纪念日存储层（插件自管 JSON）：Web Lock 临界区 + 写后回读。
 * 键：person-anniversaries.json
 */

import type { Plugin } from "siyuan";
import { loadJson, loadJsonStrict, saveJsonVerified, withStoreLock } from "./storage.ts";
import {
    addAnniversaryToStore,
    normalizeAnniversaryStore,
    normalizeAnniversaryStoreForWrite,
    removeAnniversaryFromStore,
    updateAnniversaryInStore,
    upcomingAnniversaries,
    type AnniversaryItem,
    type AnniversaryProjection,
    type AnniversaryStore,
} from "../domain/anniversaries.ts";

export const ANNIVERSARIES_STORAGE_KEY = "person-anniversaries.json";

/** 容错读取（展示使用） */
export async function loadAnniversaryStore(plugin: Plugin): Promise<AnniversaryStore> {
    return normalizeAnniversaryStore(await loadJson(plugin, ANNIVERSARIES_STORAGE_KEY));
}

/** 严格读取（写前检查与健康巡检使用） */
export async function loadAnniversaryStoreStrict(plugin: Plugin): Promise<AnniversaryStore> {
    return normalizeAnniversaryStoreForWrite(await loadJsonStrict(plugin, ANNIVERSARIES_STORAGE_KEY));
}

/** 读取指定人物的纪念日列表 */
export async function loadPersonAnniversaries(plugin: Plugin, personDocId: string): Promise<AnniversaryItem[]> {
    const store = await loadAnniversaryStore(plugin);
    return store.anniversaries[personDocId] ? [...store.anniversaries[personDocId]] : [];
}

/** 为指定人物新增一条纪念日并落盘 */
export async function addPersonAnniversary(
    plugin: Plugin,
    item: AnniversaryItem,
): Promise<AnniversaryItem[]> {
    return withStoreLock(ANNIVERSARIES_STORAGE_KEY, async () => {
        const store = normalizeAnniversaryStoreForWrite(await loadJsonStrict(plugin, ANNIVERSARIES_STORAGE_KEY));
        const updated = addAnniversaryToStore(store, item);
        await saveJsonVerified(plugin, ANNIVERSARIES_STORAGE_KEY, updated);
        return updated.anniversaries[item.personDocId] ? [...updated.anniversaries[item.personDocId]] : [];
    });
}

/** 更新指定人物的某条纪念日并落盘 */
export async function updatePersonAnniversary(
    plugin: Plugin,
    personDocId: string,
    annivId: string,
    patch: Partial<Omit<AnniversaryItem, "id" | "personDocId" | "createdAt">>,
): Promise<AnniversaryItem[]> {
    return withStoreLock(ANNIVERSARIES_STORAGE_KEY, async () => {
        const store = normalizeAnniversaryStoreForWrite(await loadJsonStrict(plugin, ANNIVERSARIES_STORAGE_KEY));
        const updated = updateAnniversaryInStore(store, personDocId, annivId, patch);
        await saveJsonVerified(plugin, ANNIVERSARIES_STORAGE_KEY, updated);
        return updated.anniversaries[personDocId] ? [...updated.anniversaries[personDocId]] : [];
    });
}

/** 移除指定人物的某条纪念日并落盘 */
export async function removePersonAnniversary(
    plugin: Plugin,
    personDocId: string,
    annivId: string,
): Promise<AnniversaryItem[]> {
    return withStoreLock(ANNIVERSARIES_STORAGE_KEY, async () => {
        const store = normalizeAnniversaryStoreForWrite(await loadJsonStrict(plugin, ANNIVERSARIES_STORAGE_KEY));
        const updated = removeAnniversaryFromStore(store, personDocId, annivId);
        await saveJsonVerified(plugin, ANNIVERSARIES_STORAGE_KEY, updated);
        return updated.anniversaries[personDocId] ? [...updated.anniversaries[personDocId]] : [];
    });
}

/** 列举全库即将到来的周年纪念日（供首页行动面板或提醒使用） */
export async function listUpcomingAnniversaries(
    plugin: Plugin,
    windowDays: number = 30,
    now: Date = new Date(),
): Promise<AnniversaryProjection[]> {
    const store = await loadAnniversaryStore(plugin);
    const allItems: AnniversaryItem[] = [];
    for (const list of Object.values(store.anniversaries)) {
        if (Array.isArray(list)) allItems.push(...list);
    }
    return upcomingAnniversaries(allItems, windowDays, now);
}
