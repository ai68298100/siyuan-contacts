/**
 * E-33 联系人回收站存储（插件自管 JSON）：Web Lock 临界区 + 写后回读。
 * 键：trash-bin.json
 */

import type { Plugin } from "siyuan";
import { loadJson, loadJsonStrict, saveJsonVerified, withStoreLock } from "./storage.ts";
import {
    addTrashEntry,
    createTrashEntry,
    normalizeTrashStore,
    normalizeTrashStoreForWrite,
    pruneExpiredTrash,
    removeTrashEntry,
} from "../domain/trash.ts";
import type { TrashContactEntry, TrashStore } from "../domain/trash.ts";
import type { ContactSummary } from "../domain/person.ts";

export const TRASH_STORAGE_KEY = "trash-bin.json";

/** 容错读取（展示使用） */
export async function loadTrashStore(plugin: Plugin): Promise<TrashStore> {
    return normalizeTrashStore(await loadJson(plugin, TRASH_STORAGE_KEY));
}

/** 严格读取（写前检查使用） */
export async function loadTrashStoreStrict(plugin: Plugin): Promise<TrashStore> {
    return normalizeTrashStoreForWrite(await loadJsonStrict(plugin, TRASH_STORAGE_KEY));
}

/** 列出回收站条目（自动剔除已过期项，按移除时间倒序） */
export async function listTrashEntries(plugin: Plugin): Promise<TrashContactEntry[]> {
    const store = await loadTrashStore(plugin);
    return pruneExpiredTrash(store).entries;
}

/** 把一次联系人移除写入回收站缓冲（同一人物去重，保留最新快照） */
export async function pushTrashEntry(
    plugin: Plugin,
    person: ContactSummary,
): Promise<TrashContactEntry[]> {
    return withStoreLock(TRASH_STORAGE_KEY, async () => {
        const now = Date.now();
        const store = normalizeTrashStoreForWrite(await loadJsonStrict(plugin, TRASH_STORAGE_KEY));
        const updated = addTrashEntry(store, createTrashEntry(person, now), now);
        await saveJsonVerified(plugin, TRASH_STORAGE_KEY, updated);
        return updated.entries;
    });
}

/** 从回收站移除一条记录（恢复成功或用户显式清空时使用） */
export async function dropTrashEntry(plugin: Plugin, entryId: string): Promise<TrashContactEntry[]> {
    return withStoreLock(TRASH_STORAGE_KEY, async () => {
        const store = normalizeTrashStoreForWrite(await loadJsonStrict(plugin, TRASH_STORAGE_KEY));
        const updated = removeTrashEntry(store, entryId);
        await saveJsonVerified(plugin, TRASH_STORAGE_KEY, updated);
        return updated.entries;
    });
}

/** 清空回收站（仅删除缓冲记录，不动人物文档） */
export async function clearTrashBin(plugin: Plugin): Promise<void> {
    await withStoreLock(TRASH_STORAGE_KEY, async () => {
        normalizeTrashStoreForWrite(await loadJsonStrict(plugin, TRASH_STORAGE_KEY));
        await saveJsonVerified(plugin, TRASH_STORAGE_KEY, { schemaVersion: 1 as const, entries: [] });
    });
}
