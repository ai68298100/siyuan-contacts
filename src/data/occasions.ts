/**
 * E-30 群体活动与场合实体存储（插件自管 JSON）：Web Lock 临界区 + 写后回读。
 * 键：occasions.json
 */

import type { Plugin } from "siyuan";
import { loadJson, loadJsonStrict, saveJsonVerified, withStoreLock } from "./storage.ts";
import {
    addOccasionToStore,
    mergeOccasionStore,
    normalizeOccasionStore,
    normalizeOccasionStoreForWrite,
    removeOccasionFromStore,
    updateOccasionInStore,
} from "../domain/occasion-cluster.ts";
import type { OccasionEntity, OccasionStore } from "../domain/occasion-cluster.ts";

export const OCCASIONS_STORAGE_KEY = "occasions.json";

/** 容错读取（展示使用） */
export async function loadOccasionStore(plugin: Plugin): Promise<OccasionStore> {
    return normalizeOccasionStore(await loadJson(plugin, OCCASIONS_STORAGE_KEY));
}

/** 严格读取（写前检查使用） */
export async function loadOccasionStoreStrict(plugin: Plugin): Promise<OccasionStore> {
    return normalizeOccasionStoreForWrite(await loadJsonStrict(plugin, OCCASIONS_STORAGE_KEY));
}

/** 列出所有场合实体（按发生日期倒序） */
export async function listOccasionEntities(plugin: Plugin): Promise<OccasionEntity[]> {
    const store = await loadOccasionStore(plugin);
    return [...store.occasions].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
}

/** 保存或新增一条场合实体并落盘 */
export async function saveOccasionEntity(
    plugin: Plugin,
    occasion: OccasionEntity,
): Promise<OccasionEntity[]> {
    return withStoreLock(OCCASIONS_STORAGE_KEY, async () => {
        const store = normalizeOccasionStoreForWrite(await loadJsonStrict(plugin, OCCASIONS_STORAGE_KEY));
        const updated = addOccasionToStore(store, occasion);
        await saveJsonVerified(plugin, OCCASIONS_STORAGE_KEY, updated);
        return updated.occasions;
    });
}

/** 更新一条场合实体并落盘 */
export async function updateOccasionEntity(
    plugin: Plugin,
    occasionId: string,
    patch: Partial<Omit<OccasionEntity, "id" | "createdAt">>,
): Promise<OccasionEntity[]> {
    return withStoreLock(OCCASIONS_STORAGE_KEY, async () => {
        const store = normalizeOccasionStoreForWrite(await loadJsonStrict(plugin, OCCASIONS_STORAGE_KEY));
        const updated = updateOccasionInStore(store, occasionId, patch);
        await saveJsonVerified(plugin, OCCASIONS_STORAGE_KEY, updated);
        return updated.occasions;
    });
}

/** 移除一条场合实体并落盘 */
export async function removeOccasionEntity(
    plugin: Plugin,
    occasionId: string,
): Promise<OccasionEntity[]> {
    return withStoreLock(OCCASIONS_STORAGE_KEY, async () => {
        const store = normalizeOccasionStoreForWrite(await loadJsonStrict(plugin, OCCASIONS_STORAGE_KEY));
        const updated = removeOccasionFromStore(store, occasionId);
        await saveJsonVerified(plugin, OCCASIONS_STORAGE_KEY, updated);
        return updated.occasions;
    });
}

/** 迁移合并群体活动与场合实体（现状优先） */
export async function mergeOccasionsStore(
    plugin: Plugin,
    incoming: OccasionStore,
): Promise<{ merged: number; skipped: number }> {
    return withStoreLock(OCCASIONS_STORAGE_KEY, async () => {
        const current = normalizeOccasionStoreForWrite(await loadJsonStrict(plugin, OCCASIONS_STORAGE_KEY));
        const { store: updated, merged, skipped } = mergeOccasionStore(current, incoming);
        if (merged > 0) {
            await saveJsonVerified(plugin, OCCASIONS_STORAGE_KEY, updated);
        }
        return { merged, skipped };
    });
}
