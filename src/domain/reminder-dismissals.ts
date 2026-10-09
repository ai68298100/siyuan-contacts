/**
 * 提醒暂缓（B08）：`reminder-dismissals.json` 的纯函数层。
 * 语义（docs/DATA-CONTRACT.md §3）：只屏蔽提醒呈现，不改变统计与名单口径；
 * `until` 为 YYYY-MM-DD（含当天）或空串（长期）。同一 personDocId+kind 仅一条。
 * 纯函数：无 DOM、无 IO，node --test 直接可测。
 */

export type ReminderKind = "birthday" | "stale";

export interface ReminderDismissal {
    personDocId: string;
    kind: ReminderKind;
    /** YYYY-MM-DD（含当天生效）或空串（长期） */
    until: string;
}

export interface ReminderDismissalStore {
    schemaVersion: 1;
    dismissals: ReminderDismissal[];
}

export const REMINDER_DISMISSALS_STORE_VERSION = 1;

import { isValidDateKey } from "./date-key.ts";

/** 人物文档 ID（与 SQL 安全面同一校验，对齐 cadence） */
const DOC_ID_RE = /^\d{14}-[0-9a-z]{7}$/;

function isValidKind(value: unknown): value is ReminderKind {
    return value === "birthday" || value === "stale";
}

/**
 * 归一化：丢弃非法键/非法 kind/非法 until 的条目；until "0000-00-00" 类伪日期交给查询侧
 * 当天比较自然失效；同一 personDocId+kind 去重（保留最后一条）。
 */
export function normalizeDismissalStore(raw: unknown): ReminderDismissalStore {
    if (raw === null || typeof raw !== "object") return { schemaVersion: REMINDER_DISMISSALS_STORE_VERSION, dismissals: [] };
    const record = raw as Record<string, unknown>;
    if (record.schemaVersion !== REMINDER_DISMISSALS_STORE_VERSION || !Array.isArray(record.dismissals)) {
        return { schemaVersion: REMINDER_DISMISSALS_STORE_VERSION, dismissals: [] };
    }
    const byKey = new Map<string, ReminderDismissal>();
    for (const entry of record.dismissals) {
        if (entry === null || typeof entry !== "object") continue;
        const candidate = entry as Record<string, unknown>;
        if (typeof candidate.personDocId !== "string" || !DOC_ID_RE.test(candidate.personDocId)) continue;
        if (!isValidKind(candidate.kind)) continue;
        if (typeof candidate.until !== "string" || (candidate.until !== "" && !isValidDateKey(candidate.until))) continue;
        byKey.set(`${candidate.personDocId}|${candidate.kind}`, {
            personDocId: candidate.personDocId,
            kind: candidate.kind,
            until: candidate.until,
        });
    }
    return { schemaVersion: REMINDER_DISMISSALS_STORE_VERSION, dismissals: [...byKey.values()] };
}

/** 严格展示/写入读取：损坏数据抛错，避免提醒故障被当成空列表。 */
export function normalizeDismissalStoreForWrite(raw: unknown): ReminderDismissalStore {
    if (raw == null || raw === "") return { schemaVersion: REMINDER_DISMISSALS_STORE_VERSION, dismissals: [] };
    if (typeof raw !== "object" || (raw as Record<string, unknown>).schemaVersion !== REMINDER_DISMISSALS_STORE_VERSION
        || !Array.isArray((raw as Record<string, unknown>).dismissals)) {
        throw new Error("提醒暂缓存储格式或版本不兼容，操作已停止；请先备份并检查原文件");
    }
    const entries = (raw as { dismissals: unknown[] }).dismissals;
    const seen = new Set<string>();
    for (const entry of entries) {
        if (entry === null || typeof entry !== "object") throw new Error("提醒暂缓存储内容损坏，操作已停止；请先备份并检查原文件");
        const candidate = entry as Record<string, unknown>;
        if (typeof candidate.personDocId !== "string" || !DOC_ID_RE.test(candidate.personDocId)
            || !isValidKind(candidate.kind) || typeof candidate.until !== "string"
            || candidate.until !== "" && !isValidDateKey(candidate.until)) {
            throw new Error("提醒暂缓存储内容损坏，操作已停止；请先备份并检查原文件");
        }
        const key = `${candidate.personDocId}|${candidate.kind}`;
        if (seen.has(key)) throw new Error("提醒暂缓存储存在重复记录，操作已停止；请先备份并检查原文件");
        seen.add(key);
    }
    return normalizeDismissalStore(raw);
}

/** 该人物该类提醒在 today（YYYY-MM-DD）是否处于暂缓期 */
export function isDismissed(
    dismissals: readonly ReminderDismissal[],
    personDocId: string,
    kind: ReminderKind,
    today: string,
): boolean {
    return dismissals.some((dismissal) =>
        dismissal.personDocId === personDocId
        && dismissal.kind === kind
        && (dismissal.until === "" || dismissal.until >= today));
}

/** 从完整库提取某人的暂缓条目（设置页恢复列表用） */
export function dismissalsFor(
    dismissals: readonly ReminderDismissal[],
    personDocId: string,
): ReminderDismissal[] {
    return dismissals.filter((dismissal) => dismissal.personDocId === personDocId);
}
