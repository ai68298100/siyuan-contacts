/**
 * 跟进事项（F05）投影：日期型联系计划，独立于互动事实。
 * 完成跟进不自动写互动；记录互动也不悄悄完成跟进（计划联系与互动事实分开，D-0017）。
 * 纯函数：无 DOM、无 IO，node --test 直接可测；日期一律 localDate（YYYY-MM-DD）字符串。
 */

export type FollowUpStatus = "open" | "done" | "cancelled";

export interface FollowUpItem {
    id: string;
    personDocId: string;
    /** 空串时界面显示「保持联系」 */
    title: string;
    /** YYYY-MM-DD */
    dueDate: string;
    status: FollowUpStatus;
    createdAt: number;
    updatedAt: number;
    closedAt?: number;
    /** B07-a：最近一次对账观测到的文档任务块 ID（块消失后清空） */
    docBlockId?: string;
    /** B07-a：文档任务块已被删除/移出（显式不可达，写侧不自动重建；插件侧显式改动清除） */
    docMissing?: boolean;
    docSyncPending?: boolean;
    docSyncBlockId?: string;
}

export interface FollowUpStore {
    schemaVersion: 1;
    items: FollowUpItem[];
}

export const FOLLOW_UP_STORE_VERSION = 1;

import { isValidDateKey } from "./date-key.ts";
export { isValidDateKey } from "./date-key.ts";

/** 推迟语义选项（Google Inbox snooze 语义）：不做裸日期选择器，「指定日期」为唯一显式入口 */
export type SnoozeOption = "tomorrow" | "threeDays" | "nextMonday" | "nextMonth" | "custom";

/**
 * 人物详情中的跟进输入草稿。
 *
 * 标题/日期的基线来自最近一次成功创建后的表单状态；自定义推迟日期
 * 没有保存基线，因为它只在点击「按指定日期推迟」时写入。该判断让
 * 关闭守卫能拦截会被丢弃的输入，同时不会把「保存并离开」扩展成隐式
 * 创建跟进或执行推迟。
 */
export interface FollowUpDraftState {
    title: string;
    dueDate: string;
    savedTitle: string;
    savedDueDate: string;
    snoozeCustomDate: string;
}

export function hasFollowUpDraft(state: FollowUpDraftState): boolean {
    return state.title.trim() !== state.savedTitle.trim()
        || state.dueDate !== state.savedDueDate
        || state.snoozeCustomDate.trim().length > 0;
}

function toDate(dateKey: string): Date {
    const [year, month, day] = dateKey.split("-").map(Number);
    return new Date(year, month - 1, day);
}

function fromDate(date: Date): string {
    const pad = (value: number) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** 当地时区日期加 N 天（YYYY-MM-DD 进出，避免毫秒差取整的时区坑） */
export function addDaysToDate(dateKey: string, days: number): string {
    const date = toDate(dateKey);
    date.setDate(date.getDate() + days);
    return fromDate(date);
}

/** 下一个周一；今天是周一则 +7 */
export function nextMondayFrom(dateKey: string): string {
    const date = toDate(dateKey);
    const offset = ((8 - date.getDay()) % 7) || 7;
    return addDaysToDate(dateKey, offset);
}

/** 同日次月；目标月没有该日则取月末（1/31 → 2/28 或 2/29） */
export function sameDayNextMonth(dateKey: string): string {
    const date = toDate(dateKey);
    const target = new Date(date.getFullYear(), date.getMonth() + 1, 1);
    const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
    target.setDate(Math.min(date.getDate(), lastDay));
    return fromDate(target);
}

/** 计算推迟后的到期日；custom 需给合法 customDate，否则返回空串由调用方拒绝 */
export function snoozedDueDate(option: SnoozeOption, today: string, customDate?: string): string {
    switch (option) {
        case "tomorrow": return addDaysToDate(today, 1);
        case "threeDays": return addDaysToDate(today, 3);
        case "nextMonday": return nextMondayFrom(today);
        case "nextMonth": return sameDayNextMonth(today);
        case "custom": return customDate !== undefined && isValidDateKey(customDate) ? customDate : "";
    }
}

function isFollowUpItem(raw: unknown): raw is FollowUpItem {
    if (raw === null || typeof raw !== "object") return false;
    const item = raw as Partial<FollowUpItem>;
    return typeof item.id === "string" && item.id.length > 0 &&
        typeof item.personDocId === "string" && item.personDocId.length > 0 &&
        typeof item.title === "string" &&
        typeof item.dueDate === "string" && isValidDateKey(item.dueDate) &&
        (item.status === "open" || item.status === "done" || item.status === "cancelled") &&
        typeof item.createdAt === "number" && Number.isFinite(item.createdAt) &&
        typeof item.updatedAt === "number" && Number.isFinite(item.updatedAt) &&
        (item.closedAt === undefined || (typeof item.closedAt === "number" && Number.isFinite(item.closedAt))) &&
        (item.docBlockId === undefined || (typeof item.docBlockId === "string" && item.docBlockId.length > 0)) &&
        (item.docMissing === undefined || typeof item.docMissing === "boolean") &&
        (item.docSyncPending === undefined || typeof item.docSyncPending === "boolean") &&
        (item.docSyncBlockId === undefined || (typeof item.docSyncBlockId === "string" && /^\d{14}-[0-9a-z]{7}$/.test(item.docSyncBlockId)));
}

/** 写前检查：不丢弃损坏数据；版本或结构不兼容抛错（与互动库同纪律） */
export function normalizeFollowUpStoreForWrite(raw: unknown): FollowUpStore {
    if (raw == null || raw === "") return emptyFollowUpStore();
    if (typeof raw !== "object" ||
        (raw as Partial<FollowUpStore>).schemaVersion !== FOLLOW_UP_STORE_VERSION) {
        throw new Error("跟进事项存储格式或版本不兼容，操作已停止；请先备份并检查原文件");
    }
    const record = raw as Partial<FollowUpStore>;
    if (!Array.isArray(record.items) || !record.items.every(isFollowUpItem)) {
        throw new Error("跟进事项存储内容损坏，操作已停止；请先备份并检查原文件");
    }
    return normalizeFollowUpStore(raw);
}

/** 读时归一：脏数据降级过滤、按 id 去重，绝不抛错 */
export function normalizeFollowUpStore(raw: unknown): FollowUpStore {
    if (raw === null || typeof raw !== "object") return emptyFollowUpStore();
    const record = raw as Partial<FollowUpStore>;
    if (record.schemaVersion !== FOLLOW_UP_STORE_VERSION || !Array.isArray(record.items)) return emptyFollowUpStore();
    const seen = new Set<string>();
    const items: FollowUpItem[] = [];
    for (const item of record.items) {
        if (!isFollowUpItem(item) || seen.has(item.id)) continue;
        seen.add(item.id);
        items.push(item);
    }
    return { schemaVersion: FOLLOW_UP_STORE_VERSION, items };
}

export function emptyFollowUpStore(): FollowUpStore {
    return { schemaVersion: FOLLOW_UP_STORE_VERSION, items: [] };
}

/** 追加事项（纯函数返回新 store）；同 id 视为重复静默跳过 */
export function appendFollowUp(store: FollowUpStore, item: FollowUpItem): FollowUpStore {
    if (store.items.some((existing) => existing.id === item.id)) return store;
    return { ...store, items: [...store.items, item] };
}

/** 就地字段更新（纯函数返回新 store）；找不到 id 返回原 store。
    docBlockId/docMissing 仅由 B07 对账路径写入 */
export function updateFollowUp(
    store: FollowUpStore,
    id: string,
    patch: Partial<Pick<FollowUpItem, "dueDate" | "status" | "title" | "updatedAt" | "closedAt" | "docBlockId" | "docMissing" | "docSyncPending" | "docSyncBlockId">>,
): FollowUpStore {
    const index = store.items.findIndex((item) => item.id === id);
    if (index < 0) return store;
    const items = [...store.items];
    items[index] = { ...items[index], ...patch };
    return { ...store, items };
}

export type FollowUpBucket = "overdue" | "today" | "upcoming";

/** 语义化到期描述（展示用） */
export function dueLabel(dueDate: string, today: string): string {
    if (dueDate === today) return "今天";
    if (dueDate < today) return `逾期 ${daysBetween(dueDate, today)} 天`;
    return `还有 ${daysBetween(today, dueDate)} 天`;
}

/** from → to 的天数（to 更晚为正） */
export function daysBetween(from: string, to: string): number {
    return Math.round((toDate(to).getTime() - toDate(from).getTime()) / 86400000);
}

/** 待办投影：open 事项按 逾期/今天/未来 7 天 分桶，桶内按到期日再创建时间稳定排序 */
export function projectOpenFollowUps(
    items: readonly FollowUpItem[],
    today: string,
): Record<FollowUpBucket, FollowUpItem[]> {
    const buckets: Record<FollowUpBucket, FollowUpItem[]> = { overdue: [], today: [], upcoming: [] };
    const horizon = addDaysToDate(today, 7);
    for (const item of items) {
        if (item.status !== "open") continue;
        if (item.dueDate < today) buckets.overdue.push(item);
        else if (item.dueDate === today) buckets.today.push(item);
        else if (item.dueDate <= horizon) buckets.upcoming.push(item);
    }
    const byRule = (a: FollowUpItem, b: FollowUpItem) => a.dueDate.localeCompare(b.dueDate) || a.createdAt - b.createdAt;
    buckets.overdue.sort(byRule);
    buckets.today.sort(byRule);
    buckets.upcoming.sort(byRule);
    return buckets;
}

/** 某人物的 open 事项（Peek 用）：按到期日升序，closed 置后按关闭时间倒序 */
export function followUpsForPerson(items: readonly FollowUpItem[], personDocId: string): FollowUpItem[] {
    const open = items.filter((item) => item.personDocId === personDocId && item.status === "open");
    const closed = items.filter((item) => item.personDocId === personDocId && item.status !== "open");
    open.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.createdAt - b.createdAt);
    closed.sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0));
    return [...open, ...closed.slice(0, 5)];
}
