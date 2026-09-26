/**
 * 互动事件存储（插件自管 JSON）：Web Lock 临界区 + 写后回读 + 读时归一。
 * 键：interaction-events.json（契约见 docs/DATA-CONTRACT.md §3）。
 */
import type { Plugin } from "siyuan";
import { loadJson, saveJsonVerified, withStoreLock } from "./storage";
import { appendEvent, emptyStore, normalizeInteractionStore, toLocalDateKey } from "../domain/interactions";
import type { InteractionEvent, InteractionStore } from "../domain/interactions";
import { newNodeId } from "../api/client";

export const INTERACTION_STORAGE_KEY = "interaction-events.json";

export async function loadInteractionStore(plugin: Plugin): Promise<InteractionStore> {
    return normalizeInteractionStore(await loadJson(plugin, INTERACTION_STORAGE_KEY));
}

export interface RecordInteractionInput {
    personDocId: string;
    note?: string;
    source?: InteractionEvent["source"];
    externalRef?: string;
    occurredAt?: number;
}

/** 追加一条互动事件；幂等（重复 source+externalRef 或同 id 静默跳过） */
export async function recordInteraction(plugin: Plugin, input: RecordInteractionInput): Promise<InteractionStore> {
    return withStoreLock(INTERACTION_STORAGE_KEY, async () => {
        const store = await loadInteractionStore(plugin);
        const occurredAt = input.occurredAt ?? Date.now();
        const event: InteractionEvent = {
            id: newNodeId(),
            personDocId: input.personDocId,
            occurredAt,
            localDate: toLocalDateKey(new Date(occurredAt)),
            source: input.source ?? "manual",
            ...(input.externalRef !== undefined ? { externalRef: input.externalRef } : {}),
            ...(input.note !== undefined && input.note.length > 0 ? { note: input.note } : {}),
        };
        const next = appendEvent(store, event);
        if (next !== store) {
            await saveJsonVerified(plugin, INTERACTION_STORAGE_KEY, next);
        }
        return next;
    });
}

/** 墓碑删除 */
export async function deleteInteraction(plugin: Plugin, eventId: string): Promise<InteractionStore> {
    return withStoreLock(INTERACTION_STORAGE_KEY, async () => {
        const store = await loadInteractionStore(plugin);
        const { removeEvent } = await import("../domain/interactions");
        const next = removeEvent(store, eventId);
        if (next !== store) {
            await saveJsonVerified(plugin, INTERACTION_STORAGE_KEY, next);
        }
        return next;
    });
}

export { emptyStore };
