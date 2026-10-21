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

export type RelationshipHeatLevel = "hot" | "warm" | "cool" | "cold" | "paused" | "unknown";

export interface RelationshipHealthInput {
    /** 目标周期天数（1–365） */
    cadenceDays: number;
    /** 最近一次互动发生的时间戳（毫秒）；未曾互动为 undefined 或 null */
    lastInteractionTime?: number | null;
    /** 计算基准当前时间戳（毫秒，缺省为调用时的 Date.now()） */
    nowTime?: number;
    /** 是否对该联系人暂停提醒 */
    paused?: boolean;
}

export interface RelationshipHealth {
    /** 紧迫度/热度分级：hot（温热/近期联系）| warm（常温/状态良好）| cool（微凉/已逾期）| cold（渐冻/深度疏远）| paused（已暂停）| unknown（从未联系） */
    level: RelationshipHeatLevel;
    /** 健康度/温度百分比：0–100 整数；越接近 100 表示联系越紧密；从未联系为 0；已暂停为 100 */
    score: number;
    /** 距离上次互动过去的天数；从未互动为 null */
    elapsedDays: number | null;
    /** 目标周期天数（1–365） */
    cadenceDays: number;
    /** 是否已超过目标联系周期 */
    overdue: boolean;
    /** 逾期天数（若未逾期为 0） */
    overdueDays: number;
}

/**
 * E-29：动态关系温度与联系紧迫度分级计算。
 * 纯函数：完全基于客观时间推导，无黑盒、无外部 IO、无副作用。
 */
export function computeRelationshipHealth(input: RelationshipHealthInput): RelationshipHealth {
    const rawCadence = typeof input.cadenceDays === "number" && Number.isFinite(input.cadenceDays)
        ? Math.round(input.cadenceDays)
        : 30;
    const cadenceDays = Math.max(CADENCE_DAYS_MIN, Math.min(CADENCE_DAYS_MAX, rawCadence));

    if (input.paused === true) {
        return {
            level: "paused",
            score: 100,
            elapsedDays: null,
            cadenceDays,
            overdue: false,
            overdueDays: 0,
        };
    }

    const lastTime = input.lastInteractionTime;
    if (typeof lastTime !== "number" || !Number.isFinite(lastTime) || lastTime <= 0) {
        return {
            level: "unknown",
            score: 0,
            elapsedDays: null,
            cadenceDays,
            overdue: true,
            overdueDays: 0,
        };
    }

    const now = typeof input.nowTime === "number" && Number.isFinite(input.nowTime)
        ? input.nowTime
        : Date.now();
    const elapsedMs = Math.max(0, now - lastTime);
    const elapsedDays = Math.floor(elapsedMs / (86400 * 1000));
    const overdue = elapsedDays > cadenceDays;
    const overdueDays = Math.max(0, elapsedDays - cadenceDays);

    const ratio = elapsedDays / cadenceDays;
    let level: RelationshipHeatLevel;
    if (ratio <= 0.5) {
        level = "hot";
    } else if (ratio <= 1.0) {
        level = "warm";
    } else if (ratio <= 2.0) {
        level = "cool";
    } else {
        level = "cold";
    }

    const rawScore = Math.round((1 - ratio / 2) * 100);
    const score = Math.max(0, Math.min(100, rawScore));

    return {
        level,
        score,
        elapsedDays,
        cadenceDays,
        overdue,
        overdueDays,
    };
}

/** 视觉展示样式类名（基于思源 b3 CSS 变量约定） */
export function heatLevelColorClass(level: RelationshipHeatLevel): string {
    switch (level) {
        case "hot":
            return "lvct-heat--hot";
        case "warm":
            return "lvct-heat--warm";
        case "cool":
            return "lvct-heat--cool";
        case "cold":
            return "lvct-heat--cold";
        case "paused":
        case "unknown":
        default:
            return "lvct-heat--muted";
    }
}

export const relationshipHeatColorClass = heatLevelColorClass;

export interface RelationshipHealthDistribution {
    hot: { count: number; percentage: number; itemIds: string[] };
    warm: { count: number; percentage: number; itemIds: string[] };
    cool: { count: number; percentage: number; itemIds: string[] };
    cold: { count: number; percentage: number; itemIds: string[] };
    paused: { count: number; percentage: number; itemIds: string[] };
    unknown: { count: number; percentage: number; itemIds: string[] };
    total: number;
}

/**
 * 计算全库联系人的关系温度分布统计，供仪表盘图表与全局下钻联动消费
 */
export function computeRelationshipHealthDistribution(
    people: readonly { docId: string; itemId: string }[],
    recentInteractions: Readonly<Record<string, { occurredAt: number }>>,
    cadences: Readonly<Record<string, PersonCadence>> = {},
    defaultCadenceDays = 30,
    nowTime = Date.now(),
): RelationshipHealthDistribution {
    const buckets: Record<RelationshipHeatLevel, string[]> = {
        hot: [],
        warm: [],
        cool: [],
        cold: [],
        paused: [],
        unknown: [],
    };

    for (const person of people) {
        const cadence = cadences[person.docId];
        const last = recentInteractions[person.docId]?.occurredAt;
        const health = computeRelationshipHealth({
            cadenceDays: cadence?.days ?? defaultCadenceDays,
            lastInteractionTime: last,
            paused: cadence?.paused,
            nowTime,
        });
        buckets[health.level].push(person.itemId);
    }

    const total = people.length;
    const calc = (level: RelationshipHeatLevel) => {
        const count = buckets[level].length;
        const percentage = total > 0 ? Math.round((count / total) * 100) : 0;
        return { count, percentage, itemIds: buckets[level] };
    };

    return {
        hot: calc("hot"),
        warm: calc("warm"),
        cool: calc("cool"),
        cold: calc("cold"),
        paused: calc("paused"),
        unknown: calc("unknown"),
        total,
    };
}

import { StoreIntegrityError } from "./store-integrity.ts";

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
    if (typeof raw !== "object" || Array.isArray(raw)) {
        throw new StoreIntegrityError("联系节奏", "需要版本化对象");
    }
    const record = raw as Partial<{ schemaVersion: unknown; cadences: unknown }>;
    if (record.schemaVersion !== CADENCE_STORE_VERSION) {
        throw new StoreIntegrityError("联系节奏", "版本不兼容");
    }
    if (typeof record.cadences !== "object" || record.cadences === null || Array.isArray(record.cadences)) {
        throw new StoreIntegrityError("联系节奏", "条目容器必须为对象映射");
    }
    const cadences = record.cadences as Record<string, unknown>;
    const entries = Object.entries(cadences);
    for (let index = 0; index < entries.length; index++) {
        const [docId, value] = entries[index];
        if (!isPersonDocId(docId)) {
            throw new StoreIntegrityError("联系节奏", `人物文档 ID 无效（${docId}）`, entries.length, index);
        }
        if (value === null || typeof value !== "object" || clampDays((value as { days: unknown }).days) === null
            || (Object.hasOwn(value, "paused") && typeof (value as { paused?: unknown }).paused !== "boolean")) {
            throw new StoreIntegrityError("联系节奏", `条目字段无效（${docId}）`, entries.length, index);
        }
    }
    return normalizeCadenceMap(raw);
}
