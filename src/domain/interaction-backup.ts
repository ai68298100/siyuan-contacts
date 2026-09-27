import { appendEvent, normalizeInteractionStore, normalizeInteractionStoreForWrite } from "./interactions.ts";
import type { InteractionStore } from "./interactions";

export interface InteractionImportSummary {
    added: number;
    skipped: number;
    removed: number;
    tombstonesAdded: number;
}

export function parseInteractionBackup(text: string): InteractionStore {
    let raw: unknown;
    try { raw = JSON.parse(text); } catch { throw new Error("备份不是有效的 JSON 文件"); }
    if (raw === null || typeof raw !== "object" || (raw as { schemaVersion?: unknown }).schemaVersion !== 1) {
        throw new Error("备份格式或版本不兼容");
    }
    const envelope = raw as Record<string, unknown>;
    return normalizeInteractionStoreForWrite(Object.hasOwn(envelope, "rawStore") ? envelope.rawStore : raw);
}

/** 现有记录优先，双方墓碑先合并，避免备份复活已删除事件。 */
export function mergeInteractionBackup(current: InteractionStore, incoming: InteractionStore): {
    store: InteractionStore; summary: InteractionImportSummary;
} {
    const tombstones = [...new Set([...current.tombstones, ...incoming.tombstones])];
    let store = normalizeInteractionStore({ ...current, tombstones });
    const removed = current.events.length - store.events.length;
    let added = 0;
    let skipped = 0;
    for (const event of incoming.events) {
        const next = appendEvent(store, event);
        if (next === store) skipped += 1;
        else added += 1;
        store = next;
    }
    return { store, summary: { added, skipped, removed, tombstonesAdded: tombstones.length - new Set(current.tombstones).size } };
}
