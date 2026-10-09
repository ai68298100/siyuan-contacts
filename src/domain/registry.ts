/**
 * 收编时间索引（C02）：`person-registry.json` 的纯函数层。
 * 语义（docs/DATA-CONTRACT.md §3）：首次进入插件视野写入当天；宽限期（reminderGraceDays）
 * 内不计入「从未互动」提醒；「从未互动」行动组按 registeredAt 倒序（最近收编优先，D-0020）。
 * 纯函数：无 DOM、无 IO，node --test 直接可测。
 */

export interface RegistryStore {
    schemaVersion: 1;
    registeredAt: Record<string, string>;
}

export const REGISTRY_STORE_VERSION = 1;

import { isValidDateKey } from "./date-key.ts";

/** 人物文档 ID（与 SQL 安全面同一校验） */
const DOC_ID_RE = /^\d{14}-[0-9a-z]{7}$/;

/** 归一化：丢弃非法键/非法日期；重复键保留最后一条 */
export function normalizeRegistryStore(raw: unknown): RegistryStore {
    if (raw === null || typeof raw !== "object") return { schemaVersion: REGISTRY_STORE_VERSION, registeredAt: {} };
    const record = raw as Record<string, unknown>;
    if (record.schemaVersion !== REGISTRY_STORE_VERSION || record.registeredAt === null || typeof record.registeredAt !== "object") {
        return { schemaVersion: REGISTRY_STORE_VERSION, registeredAt: {} };
    }
    const registeredAt: Record<string, string> = {};
    for (const [docId, date] of Object.entries(record.registeredAt as Record<string, unknown>)) {
        if (!DOC_ID_RE.test(docId)) continue;
        if (!isValidDateKey(date)) continue;
        registeredAt[docId] = date;
    }
    return { schemaVersion: REGISTRY_STORE_VERSION, registeredAt };
}

/** 严格展示/写入读取：现有库损坏时抛错，禁止把故障伪装为未登记。 */
export function normalizeRegistryStoreForWrite(raw: unknown): RegistryStore {
    if (raw == null || raw === "") return { schemaVersion: REGISTRY_STORE_VERSION, registeredAt: {} };
    if (typeof raw !== "object" || (raw as Record<string, unknown>).schemaVersion !== REGISTRY_STORE_VERSION
        || (raw as Record<string, unknown>).registeredAt === null
        || typeof (raw as Record<string, unknown>).registeredAt !== "object"
        || Array.isArray((raw as Record<string, unknown>).registeredAt)) {
        throw new Error("收编时间索引存储格式或版本不兼容，操作已停止；请先备份并检查原文件");
    }
    const entries = (raw as { registeredAt: Record<string, unknown> }).registeredAt;
    for (const [docId, date] of Object.entries(entries)) {
        if (!DOC_ID_RE.test(docId) || !isValidDateKey(date)) {
            throw new Error("收编时间索引存储内容损坏，操作已停止；请先备份并检查原文件");
        }
    }
    return { schemaVersion: REGISTRY_STORE_VERSION, registeredAt: { ...entries } as Record<string, string> };
}

/**
 * 首次发现补记：返回"补记后的完整映射"与"本次新补记的 docId"（调用方决定是否落盘）。
 * 已登记的键不动；缺失键写 today。
 */
export function ensureRegistryEntries(
    store: RegistryStore,
    docIds: readonly string[],
    today: string,
): { registeredAt: Record<string, string>; added: string[] } {
    if (!isValidDateKey(today)) return { registeredAt: { ...store.registeredAt }, added: [] };
    const merged: Record<string, string> = { ...store.registeredAt };
    const added: string[] = [];
    for (const docId of docIds) {
        if (!DOC_ID_RE.test(docId) || merged[docId]) continue;
        merged[docId] = today;
        added.push(docId);
    }
    return { registeredAt: merged, added };
}

/**
 * 宽限期内返回 true（不计入「从未互动」提醒）：registeredAt + graceDays > today。
 * 未登记视为首次发现（按 today 起算，宽限生效）；graceDays ≤ 0 关闭宽限。
 */
export function isWithinGrace(registeredAt: string | undefined, today: string, graceDays: number): boolean {
    if (graceDays <= 0) return false;
    if (!isValidDateKey(today)) return false;
    if (registeredAt === undefined) return true;
    if (!isValidDateKey(registeredAt) || !isValidDateKey(today)) return false;
    return daysBetween(registeredAt, today) < graceDays;
}

/** registeredAt → today 的自然日差（含当天为 0）；日期非法返回 Infinity（按已过期处理） */
export function daysBetween(from: string, to: string): number {
    if (!isValidDateKey(from) || !isValidDateKey(to)) return Number.POSITIVE_INFINITY;
    const [fy, fm, fd] = from.split("-").map(Number);
    const [ty, tm, td] = to.split("-").map(Number);
    return Math.round((new Date(ty, tm - 1, td).getTime() - new Date(fy, fm - 1, fd).getTime()) / 86400000);
}
