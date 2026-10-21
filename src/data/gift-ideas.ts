/**
 * E-26 礼物点子与偏好存储（插件自管 JSON）：Web Lock 临界区 + 写后回读。
 * 键：gift-ideas.json
 */

import type { Plugin } from "siyuan";
import { loadJson, loadJsonStrict, saveJsonVerified, withStoreLock } from "./storage.ts";
import {
    addGiftIdeaToStore,
    deriveGiftInteractionEvent,
    mergeGiftIdeaStore,
    normalizeGiftIdeaStore,
    normalizeGiftIdeaStoreForWrite,
    removeGiftIdeaFromStore,
    updateGiftIdeaInStore,
} from "../domain/gift-ideas.ts";
import type { GiftIdeaItem, GiftIdeaStore } from "../domain/gift-ideas.ts";
import { appendInteractionBatch, removeInteractionsByExternalRef } from "./interactions.ts";

export const GIFT_IDEAS_STORAGE_KEY = "gift-ideas.json";

/** 容错读取（展示使用） */
export async function loadGiftIdeaStore(plugin: Plugin): Promise<GiftIdeaStore> {
    return normalizeGiftIdeaStore(await loadJson(plugin, GIFT_IDEAS_STORAGE_KEY));
}

/** 严格读取（写前检查使用） */
export async function loadGiftIdeaStoreStrict(plugin: Plugin): Promise<GiftIdeaStore> {
    return normalizeGiftIdeaStoreForWrite(await loadJsonStrict(plugin, GIFT_IDEAS_STORAGE_KEY));
}

/** 读取指定人物的礼物点子与喜好偏好列表 */
export async function loadPersonGiftIdeas(plugin: Plugin, personDocId: string): Promise<GiftIdeaItem[]> {
    const store = await loadGiftIdeaStore(plugin);
    return store.ideas[personDocId] ? [...store.ideas[personDocId]] : [];
}

/** 为指定人物新增一条点子或偏好并落盘 */
export async function addPersonGiftIdea(
    plugin: Plugin,
    item: GiftIdeaItem,
): Promise<GiftIdeaItem[]> {
    return withStoreLock(GIFT_IDEAS_STORAGE_KEY, async () => {
        const store = normalizeGiftIdeaStoreForWrite(await loadJsonStrict(plugin, GIFT_IDEAS_STORAGE_KEY));
        const updated = addGiftIdeaToStore(store, item);
        await saveJsonVerified(plugin, GIFT_IDEAS_STORAGE_KEY, updated);
        return updated.ideas[item.personDocId] ? [...updated.ideas[item.personDocId]] : [];
    });
}

/** 更新指定人物的某条点子或偏好并落盘，状态变更为 given 时自动同步时间线互动事件 */
export async function updatePersonGiftIdea(
    plugin: Plugin,
    personDocId: string,
    ideaId: string,
    patch: Partial<Omit<GiftIdeaItem, "id" | "personDocId" | "createdAt">>,
    options?: { syncInteraction?: boolean },
): Promise<GiftIdeaItem[]> {
    return withStoreLock(GIFT_IDEAS_STORAGE_KEY, async () => {
        const store = normalizeGiftIdeaStoreForWrite(await loadJsonStrict(plugin, GIFT_IDEAS_STORAGE_KEY));
        const list = store.ideas[personDocId] ?? [];
        const previous = list.find((item) => item.id === ideaId);
        const updated = updateGiftIdeaInStore(store, personDocId, ideaId, patch);
        await saveJsonVerified(plugin, GIFT_IDEAS_STORAGE_KEY, updated);

        const currentItem = updated.ideas[personDocId]?.find((item) => item.id === ideaId);
        if (options?.syncInteraction !== false) {
            // 状态流转为已送出（given）：自动派生并写入时间线互动事件
            if (currentItem && currentItem.status === "given" && previous?.status !== "given") {
                const event = deriveGiftInteractionEvent(currentItem);
                await appendInteractionBatch(plugin, [event]);
            } else if (previous?.status === "given" && currentItem?.status !== "given") {
                // 状态从 given 撤回：自动清理对应的互动事件
                try {
                    await removeInteractionsByExternalRef(plugin, personDocId, ideaId);
                } catch {
                    // 容错忽略
                }
            }
        }

        return updated.ideas[personDocId] ? [...updated.ideas[personDocId]] : [];
    });
}

/** 移除指定人物的某条点子或偏好并落盘，若已送出则同步清理时间线互动事件 */
export async function removePersonGiftIdea(
    plugin: Plugin,
    personDocId: string,
    ideaId: string,
): Promise<GiftIdeaItem[]> {
    return withStoreLock(GIFT_IDEAS_STORAGE_KEY, async () => {
        const store = normalizeGiftIdeaStoreForWrite(await loadJsonStrict(plugin, GIFT_IDEAS_STORAGE_KEY));
        const list = store.ideas[personDocId] ?? [];
        const target = list.find((item) => item.id === ideaId);
        const updated = removeGiftIdeaFromStore(store, personDocId, ideaId);
        await saveJsonVerified(plugin, GIFT_IDEAS_STORAGE_KEY, updated);

        // 如果被删除的点子已送出，同步清理对应的互动事件
        if (target?.status === "given") {
            try {
                await removeInteractionsByExternalRef(plugin, personDocId, ideaId);
            } catch {
                // 容错忽略
            }
        }

        return updated.ideas[personDocId] ? [...updated.ideas[personDocId]] : [];
    });
}

/** 迁移合并礼物点子与偏好存储（现状优先） */
export async function mergeGiftIdeasStore(
    plugin: Plugin,
    incoming: GiftIdeaStore,
): Promise<{ merged: number; skipped: number }> {
    return withStoreLock(GIFT_IDEAS_STORAGE_KEY, async () => {
        const current = normalizeGiftIdeaStoreForWrite(await loadJsonStrict(plugin, GIFT_IDEAS_STORAGE_KEY));
        const { store: updated, merged, skipped } = mergeGiftIdeaStore(current, incoming);
        if (merged > 0) {
            await saveJsonVerified(plugin, GIFT_IDEAS_STORAGE_KEY, updated);
        }
        return { merged, skipped };
    });
}
