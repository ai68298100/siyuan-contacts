/**
 * E-32 会面谈资与备忘（Conversation Starters / Topics to Mention）
 * 记录下次与联系人见面时值得聊的话题、承诺的事情或兴趣备忘。
 * 纯函数：无 DOM、无 IO，node --test 直接可测。
 */

import { StoreIntegrityError } from "./store-integrity.ts";

export interface PersonTopicItem {
    id: string;
    text: string;
    createdAt: number;
}

export interface PersonTopicStore {
    schemaVersion: 1;
    topics: Record<string, PersonTopicItem[]>;
}

export const TOPIC_STORE_VERSION = 1;
export const MAX_TOPICS_PER_PERSON = 15;
export const MAX_TOPIC_TEXT_LENGTH = 140;

const DOC_ID_RE = /^\d{14}-[0-9a-z]{7}$/;

export function newTopicId(): string {
    const stamp = new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);
    const random = Math.random().toString(36).slice(2, 9).padEnd(7, "0");
    return `${stamp}-${random}`;
}

export function normalizeTopicText(text: string): string {
    return text.trim().replace(/[\r\n\t]+/g, " ");
}

export function isValidTopicText(text: unknown): text is string {
    if (typeof text !== "string") return false;
    const normalized = normalizeTopicText(text);
    return normalized.length > 0 && normalized.length <= MAX_TOPIC_TEXT_LENGTH;
}

export function emptyTopicStore(): PersonTopicStore {
    return { schemaVersion: TOPIC_STORE_VERSION, topics: {} };
}

/** 读时归一化：容错过滤坏数据，保证安全展示 */
export function normalizeTopicStore(raw: unknown): PersonTopicStore {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return emptyTopicStore();
    const record = raw as Record<string, unknown>;
    if (record.schemaVersion !== TOPIC_STORE_VERSION || !record.topics || typeof record.topics !== "object" || Array.isArray(record.topics)) {
        return emptyTopicStore();
    }
    const topics: Record<string, PersonTopicItem[]> = {};
    for (const [docId, list] of Object.entries(record.topics as Record<string, unknown>)) {
        if (!DOC_ID_RE.test(docId) || !Array.isArray(list)) continue;
        const validItems: PersonTopicItem[] = [];
        const seen = new Set<string>();
        for (const item of list) {
            if (!item || typeof item !== "object" || Array.isArray(item)) continue;
            const candidate = item as Partial<PersonTopicItem>;
            if (typeof candidate.id !== "string" || !candidate.id || seen.has(candidate.id)) continue;
            if (!isValidTopicText(candidate.text)) continue;
            seen.add(candidate.id);
            validItems.push({
                id: candidate.id,
                text: normalizeTopicText(candidate.text),
                createdAt: typeof candidate.createdAt === "number" && Number.isFinite(candidate.createdAt) ? candidate.createdAt : Date.now(),
            });
            if (validItems.length >= MAX_TOPICS_PER_PERSON) break;
        }
        if (validItems.length > 0) topics[docId] = validItems;
    }
    return { schemaVersion: TOPIC_STORE_VERSION, topics };
}

/** 写前检查：损坏数据整体拒绝，定位错误条目，不破坏用户存储 */
export function normalizeTopicStoreForWrite(raw: unknown): PersonTopicStore {
    if (raw == null || raw === "") return emptyTopicStore();
    if (typeof raw !== "object" || Array.isArray(raw)) {
        throw new StoreIntegrityError("谈资备忘", "需要版本化对象");
    }
    const record = raw as Record<string, unknown>;
    if (record.schemaVersion !== TOPIC_STORE_VERSION) {
        throw new StoreIntegrityError("谈资备忘", "版本不兼容");
    }
    if (!record.topics || typeof record.topics !== "object" || Array.isArray(record.topics)) {
        throw new StoreIntegrityError("谈资备忘", "条目容器必须为对象映射");
    }
    const topicsRecord = record.topics as Record<string, unknown>;
    const docEntries = Object.entries(topicsRecord);
    for (let docIdx = 0; docIdx < docEntries.length; docIdx++) {
        const [docId, list] = docEntries[docIdx];
        if (!DOC_ID_RE.test(docId)) {
            throw new StoreIntegrityError("谈资备忘", `人物文档 ID 无效（${docId}）`, docEntries.length, docIdx);
        }
        if (!Array.isArray(list)) {
            throw new StoreIntegrityError("谈资备忘", `人物话题列表必须为数组（${docId}）`, docEntries.length, docIdx);
        }
        const seen = new Set<string>();
        for (let itemIdx = 0; itemIdx < list.length; itemIdx++) {
            const item = list[itemIdx];
            if (!item || typeof item !== "object" || Array.isArray(item)) {
                throw new StoreIntegrityError("谈资备忘", `话题条目结构无效（${docId}）`, list.length, itemIdx);
            }
            const candidate = item as Partial<PersonTopicItem>;
            if (typeof candidate.id !== "string" || !candidate.id) {
                throw new StoreIntegrityError("谈资备忘", `话题条目 ID 无效（${docId}）`, list.length, itemIdx);
            }
            if (seen.has(candidate.id)) {
                throw new StoreIntegrityError("谈资备忘", `存在重复话题 ID（${candidate.id}）`, list.length, itemIdx);
            }
            seen.add(candidate.id);
            if (!isValidTopicText(candidate.text)) {
                throw new StoreIntegrityError("谈资备忘", `话题内容格式无效或超长（${docId}）`, list.length, itemIdx);
            }
        }
        if (list.length > MAX_TOPICS_PER_PERSON) {
            throw new StoreIntegrityError("谈资备忘", `单人话题数量超过上限 ${MAX_TOPICS_PER_PERSON}（${docId}）`, docEntries.length, docIdx);
        }
    }
    return normalizeTopicStore(raw);
}

/** 为指定人物新增一条备忘话题（置顶在列表最前） */
export function addTopicToStore(store: PersonTopicStore, personDocId: string, text: string): PersonTopicStore {
    if (!DOC_ID_RE.test(personDocId)) throw new Error("人物文档 ID 无效");
    if (!isValidTopicText(text)) throw new Error(`话题内容必须在 1–${MAX_TOPIC_TEXT_LENGTH} 字符之间`);
    const existing = store.topics[personDocId] ?? [];
    if (existing.length >= MAX_TOPICS_PER_PERSON) {
        throw new Error(`每位联系人最多记录 ${MAX_TOPICS_PER_PERSON} 条谈资备忘，请先移除已处理项`);
    }
    const newItem: PersonTopicItem = {
        id: newTopicId(),
        text: normalizeTopicText(text),
        createdAt: Date.now(),
    };
    return {
        schemaVersion: TOPIC_STORE_VERSION,
        topics: {
            ...store.topics,
            [personDocId]: [newItem, ...existing],
        },
    };
}

/** 移除指定人物的某条备忘话题 */
export function removeTopicFromStore(store: PersonTopicStore, personDocId: string, topicId: string): PersonTopicStore {
    if (!DOC_ID_RE.test(personDocId)) return store;
    const existing = store.topics[personDocId];
    if (!existing) return store;
    const remaining = existing.filter((item) => item.id !== topicId);
    const updated = { ...store.topics };
    if (remaining.length > 0) {
        updated[personDocId] = remaining;
    } else {
        delete updated[personDocId];
    }
    return {
        schemaVersion: TOPIC_STORE_VERSION,
        topics: updated,
    };
}

/** 严格解析供迁移包与写前校验使用 */
export function parseTopicStore(raw: unknown): PersonTopicStore {
    return normalizeTopicStoreForWrite(raw);
}

export interface TopicMergeResult {
    store: PersonTopicStore;
    merged: number;
    skipped: number;
}

/** 现状优先合并两个谈资备忘存储 */
export function mergeTopicStore(current: PersonTopicStore, incoming: PersonTopicStore): TopicMergeResult {
    const updated: Record<string, PersonTopicItem[]> = { ...current.topics };
    let merged = 0;
    let skipped = 0;

    for (const [docId, incomingList] of Object.entries(incoming.topics)) {
        const currentList = updated[docId] ? [...updated[docId]] : [];
        const existingIds = new Set(currentList.map((item) => item.id));

        for (const item of incomingList) {
            if (existingIds.has(item.id)) {
                skipped += 1;
                continue;
            }
            if (currentList.length < MAX_TOPICS_PER_PERSON) {
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
        store: {
            schemaVersion: TOPIC_STORE_VERSION,
            topics: updated,
        },
        merged,
        skipped,
    };
}
