/**
 * 按人物联系节奏（F06）：对特定人物覆盖全局久未联系阈值，或暂停提醒。
 * 纯函数：无 DOM、无 IO，node --test 直接可测。
 * 存储契约见 docs/DATA-CONTRACT.md §3 person-cadences.json。
 */

export interface PersonCadence {
    /** 自定义久未联系阈值（天），1–365 */
    days: number;
    /** 暂停对该人的久未联系/从未互动提醒 */
    paused: boolean;
}

export const CADENCE_STORE_VERSION = 1;
export const CADENCE_DAYS_MIN = 1;
export const CADENCE_DAYS_MAX = 365;

/** 人物文档 ID（与 SQL 安全面同一校验） */
const DOC_ID_RE = /^\d{14}-[0-9a-z]{7}$/;

export function isPersonDocId(value: string): boolean {
    return DOC_ID_RE.test(value);
}

function clampDays(value: unknown): number | null {
    if (typeof value !== "number" || !Number.isFinite(value)) return null;
    return Math.max(CADENCE_DAYS_MIN, Math.min(CADENCE_DAYS_MAX, Math.round(value)));
}

/**
 * 归一化：非法键（非人物文档 ID）或非法值的条目丢弃；days 钳制到 1–365；paused 缺省 false。
 * 不影响未登记人物（跟随全局）。
 */
export function normalizeCadenceMap(raw: unknown): Record<string, PersonCadence> {
    if (raw === null || typeof raw !== "object") return {};
    const record = raw as Record<string, unknown>;
    if (record.schemaVersion !== CADENCE_STORE_VERSION || typeof record.cadences !== "object" || record.cadences === null) return {};
    const result: Record<string, PersonCadence> = {};
    for (const [docId, value] of Object.entries(record.cadences as Record<string, unknown>)) {
        if (!isPersonDocId(docId) || value === null || typeof value !== "object") continue;
        const entry = value as Record<string, unknown>;
        const days = clampDays(entry.days);
        if (days === null) continue;
        result[docId] = { days, paused: entry.paused === true };
    }
    return result;
}

/** 写前包络检查：版本或结构不兼容抛错（损坏不覆盖，与互动/跟进库同纪律） */
export function normalizeCadenceMapForWrite(raw: unknown): Record<string, PersonCadence> {
    if (raw == null || raw === "") return {};
    if (typeof raw !== "object" || (raw as Partial<{ schemaVersion: unknown }>).schemaVersion !== CADENCE_STORE_VERSION ||
        typeof (raw as Partial<{ cadences: unknown }>).cadences !== "object" ||
        (raw as Partial<{ cadences: unknown }>).cadences === null) {
        throw new Error("联系节奏存储格式或版本不兼容，操作已停止；请先备份并检查原文件");
    }
    const cadences = (raw as { cadences: unknown }).cadences;
    for (const [docId, value] of Object.entries(cadences as Record<string, unknown>)) {
        if (!isPersonDocId(docId)) throw new Error("联系节奏存储内容损坏，操作已停止；请先备份并检查原文件");
        if (value === null || typeof value !== "object" || clampDays((value as { days: unknown }).days) === null) {
            throw new Error("联系节奏存储内容损坏，操作已停止；请先备份并检查原文件");
        }
    }
    return normalizeCadenceMap(raw);
}
