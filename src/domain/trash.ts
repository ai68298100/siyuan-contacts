/**
 * E-33 联系人软删除回收站与时光机（Trash & Soft Delete Buffer）
 * 当联系人从名册移除（解绑）时，将其元数据快照缓存 30 天，支持一键无损撤销与恢复。
 * 纯函数：无 DOM、无 IO，node --test 直接可测。
 */

import { StoreIntegrityError } from "./store-integrity.ts";
import type { ContactSummary } from "./person.ts";

export const TRASH_STORE_VERSION = 1;
export const TRASH_RETENTION_DAYS = 30;
export const MAX_TRASH_ENTRIES = 200;

const DOC_ID_RE = /^\d{14}-[0-9a-z]{7}$/;

export interface TrashContactSnapshot {
    phone?: string;
    email?: string;
    wechat?: string;
    website?: string;
    birthday?: string;
    isLunar?: boolean;
    group?: string;
    tags: string[];
}

export interface TrashContactEntry {
    /** 稳定垃圾箱条目 ID */
    id: string;
    /** 人物文档 ID */
    docId: string;
    /** 被删除时的数据库行 ID */
    itemId: string;
    /** 姓名快照 */
    name: string;
    /** 元数据字段快照（供恢复时完整还原到数据库行） */
    snapshot: TrashContactSnapshot;
    /** 移除时间戳（毫秒） */
    removedAt: number;
    /** 自动过期时间戳（毫秒，默认 30 天后） */
    expiresAt: number;
}

export interface TrashStore {
    schemaVersion: 1;
    entries: TrashContactEntry[];
}

export function emptyTrashStore(): TrashStore {
    return { schemaVersion: TRASH_STORE_VERSION, entries: [] };
}

export function newTrashId(): string {
    const stamp = new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);
    const random = Math.random().toString(36).slice(2, 9).padEnd(7, "0");
    return `${stamp}-${random}`;
}

/** 创建一条软删除回收站记录 */
export function createTrashEntry(person: ContactSummary, nowTime: number = Date.now()): TrashContactEntry {
    const msInDay = 86400 * 1000;
    return {
        id: newTrashId(),
        docId: person.docId,
        itemId: person.itemId,
        name: person.name,
        snapshot: {
            phone: person.phone || undefined,
            email: person.email || undefined,
            wechat: person.wechat || undefined,
            website: person.website || undefined,
            birthday: person.birthday || undefined,
            isLunar: Boolean(person.isLunar),
            group: person.group || undefined,
            tags: [...person.tags],
        },
        removedAt: nowTime,
        expiresAt: nowTime + TRASH_RETENTION_DAYS * msInDay,
    };
}

/** 清理已超过 30 天有效期的条目 */
export function pruneExpiredTrash(store: TrashStore, nowTime: number = Date.now()): TrashStore {
    const active = store.entries.filter((entry) => entry.expiresAt > nowTime);
    if (active.length === store.entries.length) return store;
    return {
        schemaVersion: TRASH_STORE_VERSION,
        entries: active,
    };
}

/** 添加或更新回收站记录（若同一人物多次删除，更新为最新删除快照；最多保留 200 条） */
export function addTrashEntry(store: TrashStore, entry: TrashContactEntry, nowTime: number = Date.now()): TrashStore {
    const unexpired = pruneExpiredTrash(store, nowTime);
    // 移除同 docId 旧条目
    const filtered = unexpired.entries.filter((item) => item.docId !== entry.docId);
    // 新增置顶
    const updated = [entry, ...filtered].slice(0, MAX_TRASH_ENTRIES);
    return {
        schemaVersion: TRASH_STORE_VERSION,
        entries: updated,
    };
}

/** 移除某条回收站记录（恢复或永久物理清除时使用） */
export function removeTrashEntry(store: TrashStore, entryId: string): TrashStore {
    const filtered = store.entries.filter((entry) => entry.id !== entryId && entry.docId !== entryId);
    if (filtered.length === store.entries.length) return store;
    return {
        schemaVersion: TRASH_STORE_VERSION,
        entries: filtered,
    };
}

/** 距离过期的剩余天数（钳制在 0–30） */
export function daysUntilTrashExpiration(entry: TrashContactEntry, nowTime: number = Date.now()): number {
    const remainingMs = entry.expiresAt - nowTime;
    if (remainingMs <= 0) return 0;
    return Math.max(0, Math.min(TRASH_RETENTION_DAYS, Math.ceil(remainingMs / (86400 * 1000))));
}

/** 容错读取归一化（坏条目过滤，安全展示） */
export function normalizeTrashStore(raw: unknown): TrashStore {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return emptyTrashStore();
    const record = raw as Record<string, unknown>;
    if (record.schemaVersion !== TRASH_STORE_VERSION || !Array.isArray(record.entries)) return emptyTrashStore();

    const validEntries: TrashContactEntry[] = [];
    const seen = new Set<string>();

    for (const item of record.entries) {
        if (!item || typeof item !== "object" || Array.isArray(item)) continue;
        const candidate = item as Partial<TrashContactEntry>;
        if (typeof candidate.id !== "string" || !candidate.id || seen.has(candidate.id)) continue;
        if (typeof candidate.docId !== "string" || !DOC_ID_RE.test(candidate.docId)) continue;
        if (typeof candidate.itemId !== "string" || !candidate.itemId) continue;
        if (typeof candidate.name !== "string" || !candidate.name.trim()) continue;
        if (typeof candidate.removedAt !== "number" || !Number.isFinite(candidate.removedAt)) continue;
        if (typeof candidate.expiresAt !== "number" || !Number.isFinite(candidate.expiresAt)) continue;

        const snapRaw = candidate.snapshot;
        const snapshot: TrashContactSnapshot = {
            phone: typeof snapRaw?.phone === "string" ? snapRaw.phone : undefined,
            email: typeof snapRaw?.email === "string" ? snapRaw.email : undefined,
            wechat: typeof snapRaw?.wechat === "string" ? snapRaw.wechat : undefined,
            website: typeof snapRaw?.website === "string" ? snapRaw.website : undefined,
            birthday: typeof snapRaw?.birthday === "string" ? snapRaw.birthday : undefined,
            isLunar: Boolean(snapRaw?.isLunar),
            group: typeof snapRaw?.group === "string" ? snapRaw.group : undefined,
            tags: Array.isArray(snapRaw?.tags) ? snapRaw!.tags.filter((t): t is string => typeof t === "string") : [],
        };

        seen.add(candidate.id);
        validEntries.push({
            id: candidate.id,
            docId: candidate.docId,
            itemId: candidate.itemId,
            name: candidate.name.trim(),
            snapshot,
            removedAt: candidate.removedAt,
            expiresAt: candidate.expiresAt,
        });

        if (validEntries.length >= MAX_TRASH_ENTRIES) break;
    }

    return {
        schemaVersion: TRASH_STORE_VERSION,
        entries: validEntries,
    };
}

/** 写前检查（严格校验，损坏拒绝） */
export function normalizeTrashStoreForWrite(raw: unknown): TrashStore {
    if (raw == null || raw === "") return emptyTrashStore();
    if (typeof raw !== "object" || Array.isArray(raw)) {
        throw new StoreIntegrityError("回收站", "需要版本化对象");
    }
    const record = raw as Record<string, unknown>;
    if (record.schemaVersion !== TRASH_STORE_VERSION) {
        throw new StoreIntegrityError("回收站", "版本不兼容");
    }
    if (!Array.isArray(record.entries)) {
        throw new StoreIntegrityError("回收站", "条目容器必须为数组");
    }

    const seen = new Set<string>();
    for (let i = 0; i < record.entries.length; i++) {
        const item = record.entries[i];
        if (!item || typeof item !== "object" || Array.isArray(item)) {
            throw new StoreIntegrityError("回收站", `条目结构无效（索引 ${i}）`, record.entries.length, i);
        }
        const candidate = item as Partial<TrashContactEntry>;
        if (typeof candidate.id !== "string" || !candidate.id) {
            throw new StoreIntegrityError("回收站", `条目 ID 无效（索引 ${i}）`, record.entries.length, i);
        }
        if (seen.has(candidate.id)) {
            throw new StoreIntegrityError("回收站", `存在重复条目 ID（${candidate.id}）`, record.entries.length, i);
        }
        seen.add(candidate.id);
        if (typeof candidate.docId !== "string" || !DOC_ID_RE.test(candidate.docId)) {
            throw new StoreIntegrityError("回收站", `人物文档 ID 无效（索引 ${i}）`, record.entries.length, i);
        }
        if (typeof candidate.itemId !== "string" || !candidate.itemId) {
            throw new StoreIntegrityError("回收站", `数据库行 ID 无效（索引 ${i}）`, record.entries.length, i);
        }
        if (typeof candidate.name !== "string" || !candidate.name.trim()) {
            throw new StoreIntegrityError("回收站", `人物姓名无效（索引 ${i}）`, record.entries.length, i);
        }
    }

    return normalizeTrashStore(raw);
}
