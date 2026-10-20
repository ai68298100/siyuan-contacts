/**
 * E-26 礼物“点子/偏好”清单与赠礼事实分离（Gift Ideas & Preferences）
 * 记录联系人的喜好偏好与送礼点子，支持构思中/已采购/已送出状态；
 * 未送点子不计入人情往来财务统计，送出后可一键转换为正式往来账本记录。
 * 纯函数：无 DOM、无 IO，node --test 直接可测。
 */

import { StoreIntegrityError } from "./store-integrity.ts";
import type { ExchangeRecord } from "./exchanges.ts";
import type { InteractionEvent } from "./interactions.ts";
import { toLocalDateKey } from "./interactions.ts";

export const GIFT_IDEA_STORE_VERSION = 1;
export const MAX_GIFT_IDEAS_PER_PERSON = 30;

export type GiftIdeaType = "idea" | "preference";
export type GiftIdeaStatus = "idea" | "purchased" | "given";

const DOC_ID_RE = /^\d{14}-[0-9a-z]{7}$/;

export interface GiftIdeaItem {
    /** 稳定点子 ID（14位时间戳-随机串） */
    id: string;
    /** 所属人物文档 ID */
    personDocId: string;
    /** 类型：idea（送礼点子）| preference（喜好偏好） */
    type: GiftIdeaType;
    /** 状态：idea（构思中）| purchased（已采购待赠）| given（已送出） */
    status: GiftIdeaStatus;
    /** 礼物/喜好标题 */
    title: string;
    /** 预估预算或实际金额（可选正数） */
    priceEstimate?: number;
    /** 购买或参考链接 */
    url?: string;
    /** 备注与规格（如尺码、颜色偏好） */
    note?: string;
    /** 目标赠送场合（如：生日、结婚纪念、乔迁） */
    targetOccasion?: string;
    createdAt: number;
    updatedAt: number;
}

export interface GiftIdeaStore {
    schemaVersion: 1;
    ideas: Record<string, GiftIdeaItem[]>;
}

export function emptyGiftIdeaStore(): GiftIdeaStore {
    return { schemaVersion: GIFT_IDEA_STORE_VERSION, ideas: {} };
}

export function newGiftIdeaId(): string {
    const stamp = new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);
    const random = Math.random().toString(36).slice(2, 9).padEnd(7, "0");
    return `${stamp}-${random}`;
}

export function validateGiftIdea(idea: Partial<GiftIdeaItem>): string[] {
    const errors: string[] = [];

    const title = idea.title?.trim() ?? "";
    if (!title) {
        errors.push("礼物标题或喜好名称不能为空");
    } else if (title.length > 120) {
        errors.push("礼物标题或喜好名称不能超过 120 个字符");
    }

    if (!idea.personDocId || !DOC_ID_RE.test(idea.personDocId)) {
        errors.push("人物文档 ID 无效");
    }

    if (idea.type !== "idea" && idea.type !== "preference") {
        errors.push("未知的点子类型（必须为 idea 或 preference）");
    }

    if (idea.status !== "idea" && idea.status !== "purchased" && idea.status !== "given") {
        errors.push("未知的点子状态（必须为 idea、purchased 或 given）");
    }

    if (idea.priceEstimate !== undefined) {
        if (typeof idea.priceEstimate !== "number" || !Number.isFinite(idea.priceEstimate) || idea.priceEstimate < 0) {
            errors.push("预估金额必须为非负有效数值");
        }
    }

    return errors;
}

/** 为指定联系人新增一条点子或喜好 */
export function addGiftIdeaToStore(store: GiftIdeaStore, item: GiftIdeaItem): GiftIdeaStore {
    const errors = validateGiftIdea(item);
    if (errors.length > 0) throw new Error(`点子数据无效：${errors.join("；")}`);

    const existing = store.ideas[item.personDocId] ?? [];
    if (existing.length >= MAX_GIFT_IDEAS_PER_PERSON) {
        throw new Error(`单人最多保留 ${MAX_GIFT_IDEAS_PER_PERSON} 条礼物点子与偏好`);
    }

    const updated = [item, ...existing.filter((existingItem) => existingItem.id !== item.id)];
    return {
        schemaVersion: GIFT_IDEA_STORE_VERSION,
        ideas: {
            ...store.ideas,
            [item.personDocId]: updated,
        },
    };
}

/** 更新一条点子或喜好 */
export function updateGiftIdeaInStore(
    store: GiftIdeaStore,
    personDocId: string,
    ideaId: string,
    patch: Partial<Omit<GiftIdeaItem, "id" | "personDocId" | "createdAt">>,
    nowTime: number = Date.now(),
): GiftIdeaStore {
    const list = store.ideas[personDocId] ?? [];
    const index = list.findIndex((item) => item.id === ideaId);
    if (index === -1) return store;

    const current = list[index];
    const candidate: GiftIdeaItem = {
        ...current,
        ...patch,
        updatedAt: nowTime,
    };

    const errors = validateGiftIdea(candidate);
    if (errors.length > 0) throw new Error(`点子数据更新无效：${errors.join("；")}`);

    const nextList = [...list];
    nextList[index] = candidate;

    return {
        schemaVersion: GIFT_IDEA_STORE_VERSION,
        ideas: {
            ...store.ideas,
            [personDocId]: nextList,
        },
    };
}

/** 移除一条点子 */
export function removeGiftIdeaFromStore(store: GiftIdeaStore, personDocId: string, ideaId: string): GiftIdeaStore {
    const list = store.ideas[personDocId];
    if (!list) return store;

    const remaining = list.filter((item) => item.id !== ideaId);
    const updated = { ...store.ideas };
    if (remaining.length > 0) {
        updated[personDocId] = remaining;
    } else {
        delete updated[personDocId];
    }

    return {
        schemaVersion: GIFT_IDEA_STORE_VERSION,
        ideas: updated,
    };
}

export interface GiftIdeaMergeResult {
    store: GiftIdeaStore;
    merged: number;
    skipped: number;
}

/** 迁移合并礼物点子与偏好存储（现状优先、条目去重与单人上限保护） */
export function mergeGiftIdeaStore(current: GiftIdeaStore, incoming: GiftIdeaStore): GiftIdeaMergeResult {
    const updated: Record<string, GiftIdeaItem[]> = { ...current.ideas };
    let merged = 0;
    let skipped = 0;

    for (const [docId, incomingList] of Object.entries(incoming.ideas)) {
        const currentList = updated[docId] ? [...updated[docId]] : [];
        const existingIds = new Set(currentList.map((item) => item.id));

        for (const item of incomingList) {
            if (existingIds.has(item.id)) {
                skipped += 1;
                continue;
            }
            if (currentList.length < MAX_GIFT_IDEAS_PER_PERSON) {
                currentList.push(item);
                existingIds.add(item.id);
                merged += 1;
            } else {
                skipped += 1;
            }
        }

        if (currentList.length > 0) {
            updated[docId] = currentList;
        }
    }

    return {
        store: { schemaVersion: GIFT_IDEA_STORE_VERSION, ideas: updated },
        merged,
        skipped,
    };
}

/**
 * 将已送出的礼物点子转为正式往来账本记录（ExchangeRecord）：
 * kind = "item", direction = "payable"（我方赠出），金额取预估值。
 */
export function convertGiftIdeaToExchange(idea: GiftIdeaItem, occurredOn: string, nowTime: number = Date.now()): ExchangeRecord {
    const desc = idea.targetOccasion
        ? `[赠礼 · ${idea.targetOccasion}] ${idea.title}`
        : `[赠礼] ${idea.title}`;

    return {
        id: newGiftIdeaId(),
        personDocId: idea.personDocId,
        kind: "item",
        direction: "payable",
        description: desc,
        amount: idea.priceEstimate,
        currency: "CNY",
        occurredOn,
        dueOn: "",
        status: "settled",
        settledOn: occurredOn,
        note: idea.note ?? "",
        createdAt: nowTime,
        updatedAt: nowTime,
    };
}

/**
 * 将已送出的礼物点子投影为对应联系人的互动时间线事件（InteractionEvent）：
 * 互动事件中记录赠送标题、预估/实际金额与场合备注，
 * externalRef 绑定 gift.id，保证幂等与撤销时精准溯源。
 */
export function deriveGiftInteractionEvent(
    idea: GiftIdeaItem,
    occurredAt: number = Date.now(),
): InteractionEvent {
    const occasionPrefix = idea.targetOccasion?.trim()
        ? `[赠礼 · ${idea.targetOccasion.trim()}]`
        : `[赠礼]`;
    let note = `${occasionPrefix} ${idea.title.trim()}`;
    if (idea.priceEstimate !== undefined && idea.priceEstimate > 0) {
        note += `（金额: ¥${idea.priceEstimate}）`;
    }
    if (idea.note?.trim()) {
        note += ` · ${idea.note.trim()}`;
    }

    return {
        id: `gift-${idea.id}-${occurredAt}`,
        personDocId: idea.personDocId,
        occurredAt,
        localDate: toLocalDateKey(new Date(occurredAt)),
        source: "manual",
        externalRef: idea.id,
        note,
    };
}

/** 仅返回活跃中（构思中或已采购待送）的送礼点子，不包含偏好或已完成项 */
export function filterPendingGiftIdeas(items: readonly GiftIdeaItem[]): GiftIdeaItem[] {
    return items.filter((item) => item.type === "idea" && item.status !== "given");
}

/** 仅返回喜好偏好记录 */
export function filterPreferences(items: readonly GiftIdeaItem[]): GiftIdeaItem[] {
    return items.filter((item) => item.type === "preference");
}

/** 容错读取归一化 */
export function normalizeGiftIdeaStore(raw: unknown): GiftIdeaStore {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return emptyGiftIdeaStore();
    const record = raw as Record<string, unknown>;
    if (record.schemaVersion !== GIFT_IDEA_STORE_VERSION || !record.ideas || typeof record.ideas !== "object" || Array.isArray(record.ideas)) {
        return emptyGiftIdeaStore();
    }

    const ideas: Record<string, GiftIdeaItem[]> = {};
    for (const [docId, list] of Object.entries(record.ideas as Record<string, unknown>)) {
        if (!DOC_ID_RE.test(docId) || !Array.isArray(list)) continue;
        const validList: GiftIdeaItem[] = [];
        const seen = new Set<string>();

        for (const item of list) {
            if (!item || typeof item !== "object" || Array.isArray(item)) continue;
            const candidate = item as Partial<GiftIdeaItem>;
            if (typeof candidate.id !== "string" || !candidate.id || seen.has(candidate.id)) continue;
            if (typeof candidate.title !== "string" || !candidate.title.trim()) continue;
            const type = candidate.type === "preference" ? "preference" : "idea";
            const status = candidate.status === "purchased" ? "purchased" : candidate.status === "given" ? "given" : "idea";
            const createdAt = typeof candidate.createdAt === "number" && Number.isFinite(candidate.createdAt) ? candidate.createdAt : Date.now();
            const updatedAt = typeof candidate.updatedAt === "number" && Number.isFinite(candidate.updatedAt) ? candidate.updatedAt : createdAt;

            seen.add(candidate.id);
            validList.push({
                id: candidate.id,
                personDocId: docId,
                type,
                status,
                title: candidate.title.trim(),
                priceEstimate: typeof candidate.priceEstimate === "number" && Number.isFinite(candidate.priceEstimate) && candidate.priceEstimate >= 0 ? candidate.priceEstimate : undefined,
                url: typeof candidate.url === "string" ? candidate.url.trim() : undefined,
                note: typeof candidate.note === "string" ? candidate.note.trim() : undefined,
                targetOccasion: typeof candidate.targetOccasion === "string" ? candidate.targetOccasion.trim() : undefined,
                createdAt,
                updatedAt,
            });

            if (validList.length >= MAX_GIFT_IDEAS_PER_PERSON) break;
        }

        if (validList.length > 0) ideas[docId] = validList;
    }

    return { schemaVersion: GIFT_IDEA_STORE_VERSION, ideas };
}

/** 严格写前校验 */
export function normalizeGiftIdeaStoreForWrite(raw: unknown): GiftIdeaStore {
    if (raw == null || raw === "") return emptyGiftIdeaStore();
    if (typeof raw !== "object" || Array.isArray(raw)) throw new StoreIntegrityError("礼物点子", "需要版本化对象");
    const record = raw as Record<string, unknown>;
    if (record.schemaVersion !== GIFT_IDEA_STORE_VERSION) throw new StoreIntegrityError("礼物点子", "版本不兼容");
    if (!record.ideas || typeof record.ideas !== "object" || Array.isArray(record.ideas)) {
        throw new StoreIntegrityError("礼物点子", "条目容器必须为对象映射");
    }

    for (const [docId, list] of Object.entries(record.ideas as Record<string, unknown>)) {
        if (!DOC_ID_RE.test(docId)) throw new StoreIntegrityError("礼物点子", `人物文档 ID 格式非法（${docId}）`);
        if (!Array.isArray(list)) throw new StoreIntegrityError("礼物点子", `人物条目必须为数组（${docId}）`);

        const seen = new Set<string>();
        for (let i = 0; i < list.length; i++) {
            const item = list[i];
            if (!item || typeof item !== "object" || Array.isArray(item)) {
                throw new StoreIntegrityError("礼物点子", `条目结构无效（${docId} 索引 ${i}）`, list.length, i);
            }
            const candidate = item as Partial<GiftIdeaItem>;
            if (typeof candidate.id !== "string" || !candidate.id) {
                throw new StoreIntegrityError("礼物点子", `条目 ID 无效（${docId} 索引 ${i}）`, list.length, i);
            }
            if (seen.has(candidate.id)) {
                throw new StoreIntegrityError("礼物点子", `存在重复条目 ID（${candidate.id}）`, list.length, i);
            }
            seen.add(candidate.id);
            const errors = validateGiftIdea({ ...candidate, personDocId: docId });
            if (errors.length > 0) {
                throw new StoreIntegrityError("礼物点子", `字段校验失败（${errors[0]}）`, list.length, i);
            }
        }
    }

    return normalizeGiftIdeaStore(raw);
}
