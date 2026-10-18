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
import { StoreIntegrityError } from "./store-integrity.ts";

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
    if (typeof raw !== "object" || Array.isArray(raw)) {
        throw new StoreIntegrityError("提醒暂缓", "需要版本化对象");
    }
    const record = raw as Record<string, unknown>;
    if (record.schemaVersion !== REMINDER_DISMISSALS_STORE_VERSION) {
        throw new StoreIntegrityError("提醒暂缓", "版本不兼容");
    }
    if (!Array.isArray(record.dismissals)) {
        throw new StoreIntegrityError("提醒暂缓", "条目容器必须为数组");
    }
    const entries = record.dismissals as unknown[];
    const seen = new Set<string>();
    for (let index = 0; index < entries.length; index++) {
        const entry = entries[index];
        if (entry === null || typeof entry !== "object") {
            throw new StoreIntegrityError("提醒暂缓", "条目必须为对象", entries.length, index);
        }
        const candidate = entry as Record<string, unknown>;
        if (typeof candidate.personDocId !== "string" || !DOC_ID_RE.test(candidate.personDocId)
            || !isValidKind(candidate.kind) || typeof candidate.until !== "string"
            || candidate.until !== "" && !isValidDateKey(candidate.until)) {
            throw new StoreIntegrityError("提醒暂缓", "条目字段或日期无效", entries.length, index);
        }
        const key = `${candidate.personDocId}|${candidate.kind}`;
        if (seen.has(key)) {
            throw new StoreIntegrityError("提醒暂缓", `存在重复记录（${key}）`, entries.length, index);
        }
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
