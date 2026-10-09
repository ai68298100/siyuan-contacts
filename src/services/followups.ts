/**
 * 跟进事项服务（F05）：创建/状态/推迟/人物列表 + 备份导出与合并恢复。
 * 日期严格校验（拒绝空串、格式错误与不存在的日期，不顺延回退）；
 * 导出与恢复纪律对齐互动备份（docs/DATA-CONTRACT.md §3）。
 */
import type { Plugin } from "siyuan";
import { isValidDateKey, snoozedDueDate } from "../domain/followups";
import type { FollowUpItem, FollowUpStore, SnoozeOption } from "../domain/followups";
import { toLocalDateKey } from "../domain/interactions";
import { parseFollowUpBackup } from "../domain/followup-backup";
import {
    createFollowUpRecord,
    FOLLOW_UP_STORAGE_KEY,
    loadFollowUpStoreStrict,
    mergeFollowUpStore,
    readFollowUpStoreStrictInLock,
    updateFollowUpRecord,
} from "../data/followups";
import { syncFollowUpTasksToDoc } from "./followup-sync";
import type { FollowUpSyncReport } from "./followup-sync";

export type { FollowUpItem, FollowUpStatus, SnoozeOption } from "../domain/followups";

function assertDateKey(dueDate: string, label: string): void {
    if (!isValidDateKey(dueDate)) throw new Error(`${label}日期无效：需要真实存在的公历日期（YYYY-MM-DD）`);
}

/** B07-b：文档任务块同步失败上浮为「已保存但同步失败」复合错误——插件库写入不回退，
 *  用户重开人物详情时对账+同步自动补做；失败不伪装成功。 */
function assertSyncReported(report: FollowUpSyncReport): void {
    if (report.failed.length === 0) return;
    const first = report.failed[0];
    throw new Error(
        `跟进已保存，但 ${report.failed.length} 个文档任务块同步失败（${first.action}：${first.message}）；重新打开该人物详情会自动补同步`,
    );
}

export async function createFollowUp(
    plugin: Plugin,
    input: { personDocId: string; title?: string; dueDate: string },
): Promise<FollowUpItem> {
    if (!input.personDocId) throw new Error("缺少人物文档 ID");
    assertDateKey(input.dueDate, "计划");
    const item = await createFollowUpRecord(plugin, { personDocId: input.personDocId, title: input.title, dueDate: input.dueDate });
    /* B07：文档任务块为事实源——插件库变更后同步到人物文档；同步失败不回退创建，按复合错误上浮 */
    assertSyncReported(await syncFollowUpTasksToDoc(plugin, input.personDocId));
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
    /* FUNC-01.12：库读取失败不得按空库跳过文档同步（会误判无任务），显式跳过并留痕；对账由 B07/FUNC-01.3 收口 */
    let store: FollowUpStore;
    try {
        store = await loadFollowUpStoreStrict(plugin);
    } catch (error) {
        // 状态/日期已经写入插件库，但无法回读人物文档归属。静默跳过会让
        // 用户误以为文档任务块也已同步，下一次打开详情前不会得到补救提示。
        // 将其作为“已保存但同步未核实”上浮，由界面提供明确的重试/重新打开入口。
        throw new Error("跟进已保存，但无法读取跟进库以核实文档任务同步；请重新打开该人物详情重试。", { cause: error });
    }
    const item = store.items.find((entry) => entry.id === id);
    if (!item) return;
    /* B07-b：同步分项失败以复合错误上浮（插件库已写入，不回退） */
    assertSyncReported(await syncFollowUpTasksToDoc(plugin, item.personDocId));
}

/** FUNC-01.12：读取失败抛错（详情页错误态重试），不得把故障呈现为空待办 */
export async function listPersonFollowUps(plugin: Plugin, personDocId: string): Promise<FollowUpItem[]> {
    const store = await loadFollowUpStoreStrict(plugin);
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

/* parseFollowUpBackup 已下沉域层（domain/followup-backup.ts，FUNC-01.6-a rawStore 三形态兼容） */

export async function previewFollowUpsImport(plugin: Plugin, text: string): Promise<FollowUpImportPreview> {
    const incoming = parseFollowUpBackup(text);
    /* FUNC-01.12：当前库读取失败时中止预览，不得按空库虚报「将新增」数（导入本体为锁内严格读） */
    const current = await loadFollowUpStoreStrict(plugin);
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
