/**
 * E-36 重要日期与周年纪念日（Anniversaries & Milestones）
 * 支持结婚纪念、相识纪念、入职/合作、特殊事件等重要日期的记录、农历/公历换算与循环提醒。
 * 纯函数：无 DOM、无 IO，node --test 直接可测。
 */

import { lunarToSolar, solarToLunar, formatLunar } from "./lunar.ts";
import { isValidDateKey } from "./date-key.ts";
import { StoreIntegrityError } from "./store-integrity.ts";

export const ANNIVERSARY_STORE_VERSION = 1;
export const MAX_ANNIVERSARIES_PER_PERSON = 20;

export type AnniversaryCategory = "wedding" | "acquaintance" | "work" | "memorial" | "other";

export const ANNIVERSARY_CATEGORIES: readonly AnniversaryCategory[] = [
    "wedding",
    "acquaintance",
    "work",
    "memorial",
    "other",
] as const;

export const ANNIVERSARY_CATEGORY_LABELS: Record<AnniversaryCategory, { label: string; icon: string }> = {
    wedding: { label: "结婚纪念", icon: "💍" },
    acquaintance: { label: "相识相聚", icon: "🤝" },
    work: { label: "入职/合作", icon: "💼" },
    memorial: { label: "特别纪念", icon: "🌟" },
    other: { label: "其他日期", icon: "📅" },
};

const DOC_ID_RE = /^\d{14}-[0-9a-z]{7}$/;

export interface AnniversaryItem {
    /** 稳定纪念日 ID */
    id: string;
    /** 归属联系人文档 ID */
    personDocId: string;
    /** 纪念日名称（如：银婚纪念、相识三周年、创业纪念日） */
    title: string;
    /** 分类 */
    category: AnniversaryCategory;
    /** 发生日期（YYYY-MM-DD，若年份未知可存 0000-MM-DD） */
    date: string;
    /** 是否按农历计算 */
    isLunar: boolean;
    /** 提前提醒天数（默认 7 天，0~30 天） */
    remindDaysBefore?: number;
    /** 备注说明 */
    note?: string;
    createdAt: number;
    updatedAt: number;
}

export interface AnniversaryStore {
    schemaVersion: 1;
    anniversaries: Record<string, AnniversaryItem[]>;
}

export interface AnniversaryProjection {
    item: AnniversaryItem;
    /** 下一次发生的本地公历日期（零点） */
    nextDate: Date;
    /** 距今天数（今天=0） */
    daysUntil: number;
    /** 周年届数（若有明确起始年份） */
    yearsCount?: number;
    /** 展示用日期文本（农历显示农历月日，公历显示公历月日） */
    displayDate: string;
}

export function emptyAnniversaryStore(): AnniversaryStore {
    return { schemaVersion: ANNIVERSARY_STORE_VERSION, anniversaries: {} };
}

export function newAnniversaryId(): string {
    const stamp = new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);
    const random = Math.random().toString(36).slice(2, 9).padEnd(7, "0");
    return `anniv-${stamp}-${random}`;
}

export function validateAnniversary(item: Partial<AnniversaryItem>): string[] {
    const errors: string[] = [];

    const title = item.title?.trim() ?? "";
    if (!title) {
        errors.push("纪念日名称不能为空");
    } else if (title.length > 80) {
        errors.push("纪念日名称不能超过 80 个字符");
    }

    if (!item.personDocId || !DOC_ID_RE.test(item.personDocId)) {
        errors.push("人物文档 ID 无效");
    }

    if (!item.category || !ANNIVERSARY_CATEGORIES.includes(item.category)) {
        errors.push("未知的纪念日分类");
    }

    if (!item.date || !isValidDateKey(item.date)) {
        errors.push("发生日期必须是有效的 YYYY-MM-DD 格式");
    }

    if (item.remindDaysBefore !== undefined) {
        if (!Number.isInteger(item.remindDaysBefore) || item.remindDaysBefore < 0 || item.remindDaysBefore > 30) {
            errors.push("提前提醒天数必须为 0 到 30 天之间的整数");
        }
    }

    return errors;
}

function parseLocalDate(value: string): Date | undefined {
    const parts = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!parts) return undefined;
    const [year, month, day] = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
    const date = new Date(year, month - 1, day);
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return undefined;
    return date;
}

function startOfToday(now: Date): Date {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function daysBetween(from: Date, to: Date): number {
    return Math.round((to.getTime() - from.getTime()) / 86400000);
}

function lunarOccurrenceIn(lunarYear: number, month: number, day: number): Date | undefined {
    return lunarToSolar(lunarYear, month, day) ?? lunarToSolar(lunarYear + 1, month, day);
}

/**
 * 计算下一次纪念日发生日。
 * 支持公历平闰年（2/29 顺延 3/1）与农历月日循环换算。
 */
export function nextAnniversary(item: AnniversaryItem, now: Date = new Date()): AnniversaryProjection | undefined {
    const parsed = parseLocalDate(item.date);
    if (!parsed) return undefined;
    const today = startOfToday(now);

    if (!item.isLunar) {
        let target = new Date(today.getFullYear(), parsed.getMonth(), parsed.getDate());
        if (daysBetween(today, target) < 0) {
            target = new Date(today.getFullYear() + 1, parsed.getMonth(), parsed.getDate());
        }
        const diffYears = target.getFullYear() - parsed.getFullYear();
        return {
            item,
            nextDate: target,
            daysUntil: daysBetween(today, target),
            yearsCount: diffYears > 0 ? diffYears : undefined,
            displayDate: `${parsed.getMonth() + 1}月${parsed.getDate()}日`,
        };
    }

    const origLunar = {
        year: parsed.getFullYear(),
        month: parsed.getMonth() + 1,
        day: parsed.getDate(),
    };
    if (!lunarToSolar(origLunar.year, origLunar.month, origLunar.day)) return undefined;

    const todayLunar = solarToLunar(today);
    if (!todayLunar) return undefined;

    let targetYear = todayLunar.year;
    let target = lunarOccurrenceIn(targetYear, origLunar.month, origLunar.day);
    if (!target || daysBetween(today, target) < 0) {
        targetYear += 1;
        target = lunarOccurrenceIn(targetYear, origLunar.month, origLunar.day);
    }
    if (!target) return undefined;

    const diffYears = targetYear - origLunar.year;
    const label = formatLunar({
        year: targetYear,
        month: origLunar.month,
        day: origLunar.day,
        leap: false,
    });

    return {
        item,
        nextDate: target,
        daysUntil: daysBetween(today, target),
        yearsCount: diffYears > 0 ? diffYears : undefined,
        displayDate: `${label}（农历）`,
    };
}

/** 筛选窗口内即将到来的纪念日，按剩余天数升序排序 */
export function upcomingAnniversaries(
    items: readonly AnniversaryItem[],
    windowDays: number = 30,
    now: Date = new Date(),
): AnniversaryProjection[] {
    const results: AnniversaryProjection[] = [];
    for (const item of items) {
        const projection = nextAnniversary(item, now);
        if (!projection) continue;
        const maxDays = item.remindDaysBefore ?? windowDays;
        if (projection.daysUntil >= 0 && projection.daysUntil <= maxDays) {
            results.push(projection);
        }
    }
    return results.sort((a, b) => a.daysUntil - b.daysUntil);
}

/** 为指定联系人新增一条纪念日 */
export function addAnniversaryToStore(store: AnniversaryStore, item: AnniversaryItem): AnniversaryStore {
    const errors = validateAnniversary(item);
    if (errors.length > 0) throw new Error(`纪念日数据无效：${errors.join("；")}`);

    const existing = store.anniversaries[item.personDocId] ?? [];
    if (existing.length >= MAX_ANNIVERSARIES_PER_PERSON) {
        throw new Error(`单人最多保留 ${MAX_ANNIVERSARIES_PER_PERSON} 条纪念日`);
    }

    const updated = [item, ...existing.filter((existingItem) => existingItem.id !== item.id)];
    return {
        schemaVersion: ANNIVERSARY_STORE_VERSION,
        anniversaries: {
            ...store.anniversaries,
            [item.personDocId]: updated,
        },
    };
}

/** 更新一条纪念日 */
export function updateAnniversaryInStore(
    store: AnniversaryStore,
    personDocId: string,
    annivId: string,
    patch: Partial<Omit<AnniversaryItem, "id" | "personDocId" | "createdAt">>,
    nowTime: number = Date.now(),
): AnniversaryStore {
    const list = store.anniversaries[personDocId] ?? [];
    const index = list.findIndex((item) => item.id === annivId);
    if (index === -1) return store;

    const current = list[index];
    const candidate: AnniversaryItem = {
        ...current,
        ...patch,
        updatedAt: nowTime,
    };

    const errors = validateAnniversary(candidate);
    if (errors.length > 0) throw new Error(`纪念日数据更新无效：${errors.join("；")}`);

    const nextList = [...list];
    nextList[index] = candidate;

    return {
        schemaVersion: ANNIVERSARY_STORE_VERSION,
        anniversaries: {
            ...store.anniversaries,
            [personDocId]: nextList,
        },
    };
}

/** 移除一条纪念日 */
export function removeAnniversaryFromStore(store: AnniversaryStore, personDocId: string, annivId: string): AnniversaryStore {
    const list = store.anniversaries[personDocId];
    if (!list) return store;

    const remaining = list.filter((item) => item.id !== annivId);
    const updated = { ...store.anniversaries };
    if (remaining.length > 0) {
        updated[personDocId] = remaining;
    } else {
        delete updated[personDocId];
    }

    return {
        schemaVersion: ANNIVERSARY_STORE_VERSION,
        anniversaries: updated,
    };
}

/** 容错读取归一化 */
export function normalizeAnniversaryStore(raw: unknown): AnniversaryStore {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return emptyAnniversaryStore();
    const record = raw as Partial<AnniversaryStore>;
    if (record.schemaVersion !== ANNIVERSARY_STORE_VERSION || typeof record.anniversaries !== "object" || record.anniversaries === null) {
        return emptyAnniversaryStore();
    }

    const anniversaries: Record<string, AnniversaryItem[]> = {};
    for (const [docId, list] of Object.entries(record.anniversaries)) {
        if (!DOC_ID_RE.test(docId) || !Array.isArray(list)) continue;
        const validList: AnniversaryItem[] = [];
        const seenIds = new Set<string>();

        for (const item of list) {
            if (!item || typeof item !== "object" || Array.isArray(item)) continue;
            const candidate = item as Partial<AnniversaryItem>;
            if (!candidate.id || seenIds.has(candidate.id)) continue;
            const errors = validateAnniversary({ ...candidate, personDocId: docId });
            if (errors.length > 0) continue;

            seenIds.add(candidate.id);
            validList.push({
                id: candidate.id,
                personDocId: docId,
                title: candidate.title!.trim(),
                category: candidate.category!,
                date: candidate.date!,
                isLunar: Boolean(candidate.isLunar),
                remindDaysBefore: candidate.remindDaysBefore ?? 7,
                note: candidate.note?.trim() || undefined,
                createdAt: Number.isFinite(candidate.createdAt) ? candidate.createdAt! : Date.now(),
                updatedAt: Number.isFinite(candidate.updatedAt) ? candidate.updatedAt! : Date.now(),
            });
            if (validList.length >= MAX_ANNIVERSARIES_PER_PERSON) break;
        }

        if (validList.length > 0) {
            anniversaries[docId] = validList;
        }
    }

    return {
        schemaVersion: ANNIVERSARY_STORE_VERSION,
        anniversaries,
    };
}

/** 写前检查严格归一化：坏条目抛出 StoreIntegrityError */
export function normalizeAnniversaryStoreForWrite(raw: unknown): AnniversaryStore {
    if (raw == null || raw === "") return emptyAnniversaryStore();
    if (typeof raw !== "object" || Array.isArray(raw)) {
        throw new StoreIntegrityError("纪念日存储格式不兼容，非对象容器", "纪念日", 0, 0);
    }
    const record = raw as Partial<AnniversaryStore>;
    if (record.schemaVersion !== ANNIVERSARY_STORE_VERSION) {
        throw new StoreIntegrityError(`纪念日存储版本未知：${record.schemaVersion}`, "纪念日", 0, 0);
    }
    if (typeof record.anniversaries !== "object" || record.anniversaries === null || Array.isArray(record.anniversaries)) {
        throw new StoreIntegrityError("纪念日存储 anniversaries 容器损坏", "纪念日", 0, 0);
    }

    for (const [docId, list] of Object.entries(record.anniversaries)) {
        if (!DOC_ID_RE.test(docId)) {
            throw new StoreIntegrityError(`纪念日归属人物文档 ID 非法：${docId}`, "纪念日", 1, 0);
        }
        if (!Array.isArray(list)) {
            throw new StoreIntegrityError(`人物 ${docId} 的纪念日列表损坏`, "纪念日", 1, 0);
        }
        for (let i = 0; i < list.length; i++) {
            const item = list[i];
            const errors = validateAnniversary({ ...item, personDocId: docId });
            if (errors.length > 0) {
                throw new StoreIntegrityError(`人物 ${docId} 的第 ${i + 1} 条纪念日无效：${errors.join("；")}`, "纪念日", list.length, i);
            }
        }
    }

    return normalizeAnniversaryStore(raw);
}
