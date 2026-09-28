/**
 * 跟进事项服务（F05）：创建/状态/推迟/人物列表 + 备份导出与合并恢复。
 * 日期严格校验（拒绝空串、格式错误与不存在的日期，不顺延回退）；
 * 导出与恢复纪律对齐互动备份（docs/DATA-CONTRACT.md §3）。
 */
import type { Plugin } from "siyuan";
import { FOLLOW_UP_STORE_VERSION, isValidDateKey, normalizeFollowUpStore, snoozedDueDate } from "../domain/followups";
import type { FollowUpItem, FollowUpStore, SnoozeOption } from "../domain/followups";
import { toLocalDateKey } from "../domain/interactions";
import {
    createFollowUpRecord,
    FOLLOW_UP_STORAGE_KEY,
    loadFollowUpStore,
    mergeFollowUpStore,
    readFollowUpStoreStrictInLock,
    updateFollowUpRecord,
} from "../data/followups";
import { syncFollowUpTasksToDoc } from "./followup-sync";

export type { FollowUpItem, FollowUpStatus, SnoozeOption } from "../domain/followups";

function assertDateKey(dueDate: string, label: string): void {
    if (!isValidDateKey(dueDate)) throw new Error(`${label}日期无效：需要真实存在的公历日期（YYYY-MM-DD）`);
}

export async function createFollowUp(
    plugin: Plugin,
    input: { personDocId: string; title?: string; dueDate: string },
): Promise<FollowUpItem> {
    if (!input.personDocId) throw new Error("缺少人物文档 ID");
    assertDateKey(input.dueDate, "计划");
    const item = await createFollowUpRecord(plugin, { personDocId: input.personDocId, title: input.title, dueDate: input.dueDate });
    /* B07：文档任务块为事实源——插件库变更后同步到人物文档（失败不阻断，sync 内部 console 记录） */
    await syncFollowUpTasksToDoc(plugin, input.personDocId);
    return item;
}

export async function setFollowUpStatus(plugin: Plugin, id: string, status: FollowUpItem["status"]): Promise<void> {
    await updateFollowUpRecord(plugin, id, { status });
    await syncAfterIdChange(plugin, id);
}

/** 语义化推迟：日期以本地今天为基准计算；custom 需合法日期，否则拒绝 */
export async function snoozeFollowUp(plugin: Plugin, id: string, option: SnoozeOption, customDate?: string): Promise<void> {
    const due = snoozedDueDate(option, toLocalDateKey(new Date()), customDate);
    if (!due) throw new Error("指定日期无效：需要真实存在的公历日期（YYYY-MM-DD）");
    await updateFollowUpRecord(plugin, id, { dueDate: due });
    await syncAfterIdChange(plugin, id);
}

/** 由跟进 id 反查人物文档后同步任务块（状态/改期变更共用） */
async function syncAfterIdChange(plugin: Plugin, id: string): Promise<void> {
    const store = await loadFollowUpStore(plugin);
    const item = store.items.find((entry) => entry.id === id);
    if (item) await syncFollowUpTasksToDoc(plugin, item.personDocId);
}

export async function listPersonFollowUps(plugin: Plugin, personDocId: string): Promise<FollowUpItem[]> {
    const store = await loadFollowUpStore(plugin);
    return followUpsForPersonFromStore(store, personDocId);
}

function followUpsForPersonFromStore(store: FollowUpStore, personDocId: string): FollowUpItem[] {
    const open = store.items.filter((item) => item.personDocId === personDocId && item.status === "open");
    const closed = store.items.filter((item) => item.personDocId === personDocId && item.status !== "open");
    open.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.createdAt - b.createdAt);
    closed.sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0));
    return [...open, ...closed.slice(0, 5)];
}

export interface FollowUpImportPreview {
    added: number;
    skipped: number;
}

/** 包络级兼容检查：版本与 items 数组必须合法（条目级由归一化容错过滤） */
function isCompatibleStore(raw: unknown): boolean {
    return raw !== null && typeof raw === "object" &&
        (raw as Partial<FollowUpStore>).schemaVersion === FOLLOW_UP_STORE_VERSION &&
        Array.isArray((raw as Partial<FollowUpStore>).items);
}

/** 解析备份文本：接受新版导出包（含 rawStore）或裸事项库；损坏或未知版本拒绝（零写入） */
function parseFollowUpBackup(text: string): FollowUpItem[] {
    let raw: unknown;
    try {
        raw = JSON.parse(text);
    } catch {
        throw new Error("备份文件不是有效的 JSON");
    }
    if (raw === null || typeof raw !== "object") throw new Error("备份版本不兼容，已拒绝导入");
    const record = raw as Record<string, unknown>;
    if ("rawStore" in record) {
        const rawStore = record.rawStore;
        // 首次未创建文件的 null / 空串原样保留，表示空快照
        if (rawStore === null || rawStore === "") return [];
        if (typeof rawStore !== "string") throw new Error("备份中的原始快照损坏，已拒绝导入");
        let inner: unknown;
        try {
            inner = JSON.parse(rawStore);
        } catch {
            throw new Error("备份中的原始快照损坏，已拒绝导入");
        }
        if (!isCompatibleStore(inner)) throw new Error("备份版本不兼容，已拒绝导入");
        return normalizeFollowUpStore(inner).items;
    }
    if (!isCompatibleStore(raw)) throw new Error("备份版本不兼容，已拒绝导入");
    return normalizeFollowUpStore(raw).items;
}

export async function previewFollowUpsImport(plugin: Plugin, text: string): Promise<FollowUpImportPreview> {
    const incoming = parseFollowUpBackup(text);
    const current = await loadFollowUpStore(plugin);
    const ids = new Set(current.items.map((item) => item.id));
    return {
        added: incoming.filter((item) => !ids.has(item.id)).length,
        skipped: incoming.length - incoming.filter((item) => !ids.has(item.id)).length,
    };
}

/** 合并导入：现状优先按 id，其余追加；确认时锁内重读，损坏当前库拒绝覆盖 */
export async function importFollowUpsJson(plugin: Plugin, text: string): Promise<FollowUpImportPreview> {
    const incoming = parseFollowUpBackup(text);
    return mergeFollowUpStore(plugin, incoming);
}

/** 导出原始快照：锁内严格读取，失败抛错不生成空备份 */
export async function exportFollowUpsJson(plugin: Plugin): Promise<string> {
    const { rawValue, store } = await readFollowUpStoreStrictInLock(plugin);
    return JSON.stringify({
        schemaVersion: 1,
        exportedAt: new Date().toISOString(),
        storageKey: FOLLOW_UP_STORAGE_KEY,
        rawStore: rawValue,
        items: store.items,
    }, null, 2);
}
