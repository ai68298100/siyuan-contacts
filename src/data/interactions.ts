/**
 * 互动事件存储（插件自管 JSON）：Web Lock 临界区 + 写后回读 + 读时归一。
 * 键：interaction-events.json（契约见 docs/DATA-CONTRACT.md §3）。
 */
import type { Plugin } from "siyuan";
import { loadJson, loadJsonStrict, saveJsonVerified, withStoreLock } from "./storage";
import { appendEvent, emptyStore, normalizeInteractionStore, normalizeInteractionStoreForWrite, toLocalDateKey } from "../domain/interactions";
import type { InteractionEvent, InteractionStore } from "../domain/interactions";
import { newNodeId } from "../api/client";

export const INTERACTION_STORAGE_KEY = "interaction-events.json";

export async function loadInteractionStore(plugin: Plugin): Promise<InteractionStore> {
    return normalizeInteractionStore(await loadJson(plugin, INTERACTION_STORAGE_KEY));
}

/**
 * FUNC-01.12 严格展示读：键不存在返回空库（正常空态）；
 * 读取失败/损坏抛错，不得归一为空（首页统计、时间线、体检据此显式报错）。
 */
export async function loadInteractionStoreStrict(plugin: Plugin): Promise<InteractionStore> {
    return normalizeInteractionStore(await loadJsonStrict(plugin, INTERACTION_STORAGE_KEY));
}

export interface RecordInteractionInput {
    personDocId: string;
    note?: string;
    source?: InteractionEvent["source"];
    externalRef?: string;
    occurredAt?: number;
}

/** 追加一条互动事件；幂等（同人物+source+externalRef 或同 id 静默跳过）。 */
export async function recordInteraction(plugin: Plugin, input: RecordInteractionInput): Promise<InteractionStore> {
    return (await recordInteractionWithResult(plugin, input)).store;
}

/** 新增状态与写入在同一排他锁内确定，避免调用方先读后写导致计数竞态。 */
export async function recordInteractionWithResult(
    plugin: Plugin,
    input: RecordInteractionInput,
): Promise<{ store: InteractionStore; recorded: boolean }> {
    return withStoreLock(INTERACTION_STORAGE_KEY, async () => {
        const store = normalizeInteractionStoreForWrite(await loadJsonStrict(plugin, INTERACTION_STORAGE_KEY));
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
        return { store: next, recorded: next !== store };
    });
}

/** 墓碑删除 */
export async function deleteInteraction(plugin: Plugin, eventId: string, expectedPersonDocId?: string): Promise<InteractionStore> {
    return withStoreLock(INTERACTION_STORAGE_KEY, async () => {
        const store = normalizeInteractionStoreForWrite(await loadJsonStrict(plugin, INTERACTION_STORAGE_KEY));
        const event = store.events.find((item) => item.id === eventId);
        if (event && expectedPersonDocId !== undefined && event.personDocId !== expectedPersonDocId) {
            throw new Error("互动记录不属于当前人物，操作已停止");
        }
        const { removeEvent } = await import("../domain/interactions");
        const next = removeEvent(store, eventId);
        if (next !== store) {
            await saveJsonVerified(plugin, INTERACTION_STORAGE_KEY, next);
        }
        return next;
    });
}

export { emptyStore };
