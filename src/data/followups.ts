/**
 * 跟进事项存储（插件自管 JSON）：Web Lock 临界区 + 写后回读 + 严格/容错双读。
 * 键：follow-ups.json（契约见 docs/DATA-CONTRACT.md §3）。
 */
import type { Plugin } from "siyuan";
import { loadJson, loadJsonStrict, saveJsonVerified, withStoreLock } from "./storage";
import {
    appendFollowUp,
    emptyFollowUpStore,
    normalizeFollowUpStore,
    normalizeFollowUpStoreForWrite,
    updateFollowUp,
} from "../domain/followups";
import type { FollowUpItem, FollowUpStore } from "../domain/followups";
import { newNodeId } from "../api/client";
import { isValidDateKey } from "../domain/date-key";
import { isPersonDocId } from "../domain/cadence";

export const FOLLOW_UP_STORAGE_KEY = "follow-ups.json";

/** 展示用容错读取 */
export async function loadFollowUpStore(plugin: Plugin): Promise<FollowUpStore> {
    return normalizeFollowUpStore(await loadJson(plugin, FOLLOW_UP_STORAGE_KEY));
}

/** FUNC-01.12 严格展示读：键不存在返回空库；读取失败/损坏抛错，不得按空待办呈现 */
export async function loadFollowUpStoreStrict(plugin: Plugin): Promise<FollowUpStore> {
    return normalizeFollowUpStoreForWrite(await loadJsonStrict(plugin, FOLLOW_UP_STORAGE_KEY));
}

export interface CreateFollowUpInput {
    personDocId: string;
    title?: string;
    /** YYYY-MM-DD，已由服务层严格校验 */
    dueDate: string;
}

/** 新建跟进事项；id 在锁内生成，写入与新增判定同临界区 */
export async function createFollowUpRecord(plugin: Plugin, input: CreateFollowUpInput): Promise<FollowUpItem> {
    if (!isPersonDocId(input.personDocId)) throw new Error("人物文档 ID 无效，未创建跟进事项");
    if (!isValidDateKey(input.dueDate)) throw new Error("跟进到期日期无效，未创建跟进事项");
    if (input.title !== undefined && typeof input.title !== "string") throw new Error("跟进标题无效，未创建跟进事项");
    return withStoreLock(FOLLOW_UP_STORAGE_KEY, async () => {
        const now = Date.now();
        const item: FollowUpItem = {
            id: newNodeId(),
            personDocId: input.personDocId,
            title: input.title?.trim() ?? "",
            dueDate: input.dueDate,
            status: "open",
            createdAt: now,
            updatedAt: now,
            docSyncPending: true,
        };
        const store = normalizeFollowUpStoreForWrite(await loadJsonStrict(plugin, FOLLOW_UP_STORAGE_KEY));
        /* 极低概率的随机 ID 碰撞也不能返回一个实际未落盘的“成功”事项。 */
        if (store.items.some((existing) => existing.id === item.id)) throw new Error("跟进事项 ID 冲突，未创建；请重试");
        await saveJsonVerified(plugin, FOLLOW_UP_STORAGE_KEY, appendFollowUp(store, item));
        return item;
    });
}

export interface FollowUpPatch {
    dueDate?: string;
    status?: FollowUpItem["status"];
    title?: string;
    /** B07-a：仅对账路径写入（须同时传 opts.fromReconcile，否则被忽略） */
    docBlockId?: string | undefined;
    docMissing?: boolean;
}

export interface FollowUpPatchOptions {
    /** B07-a：对账写入（文档为准）——允许 docBlockId/docMissing，且不清除 docMissing 标记 */
    fromReconcile?: boolean;
}

/** 状态/到期变更；done|cancelled 写 closedAt，重开清除；找不到 id 抛错。
    非对账的用户显式改动（改标题/改期/状态）清除 docMissing——用户重新意图该事项有任务块 */
export async function updateFollowUpRecord(
    plugin: Plugin,
    id: string,
    patch: FollowUpPatch,
    options: FollowUpPatchOptions = {},
): Promise<FollowUpItem> {
    if (typeof id !== "string" || !id.trim()) throw new Error("跟进事项 ID 无效");
    if (patch.dueDate !== undefined && !isValidDateKey(patch.dueDate)) throw new Error("跟进到期日期无效，未修改跟进事项");
    if (patch.title !== undefined && typeof patch.title !== "string") throw new Error("跟进标题无效，未修改跟进事项");
    if (patch.status !== undefined && !["open", "done", "cancelled"].includes(patch.status)) throw new Error("跟进状态无效，未修改跟进事项");
    if (patch.docBlockId !== undefined && (typeof patch.docBlockId !== "string" || !/^\d{14}-[0-9a-z]{7}$/.test(patch.docBlockId))) {
        throw new Error("跟进文档块 ID 无效，未修改跟进事项");
    }
    if (patch.docMissing !== undefined && typeof patch.docMissing !== "boolean") throw new Error("跟进文档状态无效，未修改跟进事项");
    return withStoreLock(FOLLOW_UP_STORAGE_KEY, async () => {
        const store = normalizeFollowUpStoreForWrite(await loadJsonStrict(plugin, FOLLOW_UP_STORAGE_KEY));
        const existing = store.items.find((item) => item.id === id);
        if (!existing) throw new Error("跟进事项不存在或已被删除");
        const fromReconcile = options.fromReconcile === true;
        const userEdited = !fromReconcile &&
            (patch.dueDate !== undefined || patch.title !== undefined || patch.status !== undefined);
        const next: FollowUpItem = {
            ...existing,
            ...(patch.dueDate !== undefined ? { dueDate: patch.dueDate } : {}),
            ...(patch.title !== undefined ? { title: patch.title } : {}),
            ...(patch.status !== undefined && patch.status !== existing.status
                ? {
                    status: patch.status,
                    ...(patch.status === "open" ? { closedAt: undefined } : { closedAt: Date.now() }),
                }
                : {}),
            ...(userEdited ? { docMissing: undefined, docSyncPending: true, docSyncBlockId: undefined } : {}),
            updatedAt: Date.now(),
        };
        const updated = updateFollowUp(store, id, {
            ...(patch.dueDate !== undefined ? { dueDate: next.dueDate } : {}),
            ...(patch.title !== undefined ? { title: next.title } : {}),
            ...(next.status !== existing.status ? { status: next.status, closedAt: next.closedAt } : {}),
            ...(fromReconcile ? { docBlockId: patch.docBlockId, docMissing: patch.docMissing } : {}),
            ...(userEdited ? { docMissing: undefined, docSyncPending: true, docSyncBlockId: undefined } : {}),
            updatedAt: next.updatedAt,
        });
        await saveJsonVerified(plugin, FOLLOW_UP_STORAGE_KEY, updated);
        return next;
    });
}

/** 锁内严格读取原始快照（导出用）；读取异常向上抛，禁止生成空成功备份 */
export async function readFollowUpStoreStrictInLock(plugin: Plugin): Promise<{ rawValue: unknown; store: FollowUpStore }> {
    return withStoreLock(FOLLOW_UP_STORAGE_KEY, async () => {
        const rawValue = await loadJsonStrict(plugin, FOLLOW_UP_STORAGE_KEY);
        return { rawValue, store: normalizeFollowUpStoreForWrite(rawValue) };
    });
}

/** 锁内合并写入（恢复用）：现状优先按 id，新增条目追加；写后回读验证；返回受影响人物供任务同步 */
export async function mergeFollowUpStore(plugin: Plugin, incoming: readonly FollowUpItem[]): Promise<{ added: number; skipped: number; personDocIds: string[] }> {
    return withStoreLock(FOLLOW_UP_STORAGE_KEY, async () => {
        const store = normalizeFollowUpStoreForWrite(await loadJsonStrict(plugin, FOLLOW_UP_STORAGE_KEY));
        const existingIds = new Set(store.items.map((item) => item.id));
        /* 备份条目结构已归一化，但人物 ID 仍需按文档契约核实，避免导入后产生永远不可达的跟进。 */
        const validIncoming = incoming.filter((item) => isPersonDocId(item.personDocId));
        const additions = validIncoming.filter((item) => !existingIds.has(item.id));
        if (additions.length === 0) return { added: 0, skipped: incoming.length, personDocIds: [] };
        let merged = store;
        for (const item of additions) merged = appendFollowUp(merged, item);
        await saveJsonVerified(plugin, FOLLOW_UP_STORAGE_KEY, merged);
        return {
            added: additions.length,
            skipped: incoming.length - additions.length,
            personDocIds: [...new Set(additions.map((item) => item.personDocId))],
        };
    });
}

export { emptyFollowUpStore };
