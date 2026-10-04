/**
 * 本人身份（B11，纯函数层）：self-identity.json 的归一与使用规则投影。
 * 契约见 docs/DATA-CONTRACT.md §3 self-identity.json——按稳定文档 ID 识别本人；
 * 使用规则：首页统计/行动清单/普通资料体检默认排除本人（本人不是"待联系对象"）。
 */

import { birthdayToMs } from "./person.ts";
import { StoreIntegrityError } from "./store-integrity.ts";

export interface SelfIdentity {
    schemaVersion: 1;
    selfDocId: string;
    selfItemId: string;
    /** YYYY-MM-DD（本地日期，标记创建日） */
    createdAt: string;
}

const ID_PATTERN = /^\d{14}-[0-9a-z]{7}$/;

/** 读时归一：结构或字段非法返回 null（按无本人处理），绝不抛错 */
export function normalizeSelfIdentity(raw: unknown): SelfIdentity | null {
    if (raw === null || typeof raw !== "object") return null;
    const record = raw as Partial<SelfIdentity>;
    if (record.schemaVersion !== 1) return null;
    if (typeof record.selfDocId !== "string" || !ID_PATTERN.test(record.selfDocId)) return null;
    if (typeof record.selfItemId !== "string" || !ID_PATTERN.test(record.selfItemId)) return null;
    if (typeof record.createdAt !== "string" || birthdayToMs(record.createdAt) === null) return null;
    return {
        schemaVersion: 1,
        selfDocId: record.selfDocId,
        selfItemId: record.selfItemId,
        createdAt: record.createdAt,
    };
}

export function parseSelfIdentity(raw: unknown): SelfIdentity | null {
    if (raw === null || raw === undefined || raw === "") return null;
    const identity = normalizeSelfIdentity(raw);
    if (!identity) throw new StoreIntegrityError("本人身份", "版本、人物/行 ID 或创建日期无效");
    return identity;
}

export interface SelfProfileCheckpoint {
    schemaVersion: 1;
    notebookId: string;
    avId: string;
    dbBlockId: string;
    requestId: string;
    source: "created" | "reused";
    state: "unknown" | "rejected" | "verified";
    docId?: string;
    itemId?: string;
}

export interface SelfIdentityChangePreview {
    schemaVersion: 1;
    anchorKey: string;
    previous: SelfIdentity | null;
    target: { docId: string; itemId: string; name: string } | null;
    previousName: string;
    ordinaryBefore: number;
    ordinaryAfter: number;
    createdAt: string;
}

export function parseSelfProfileCheckpoint(raw: unknown): SelfProfileCheckpoint | null {
    if (raw === null || raw === undefined || raw === "") return null;
    if (typeof raw !== "object" || Array.isArray(raw)) throw new StoreIntegrityError("本人建档断点", "结构无效");
    const record = raw as Partial<SelfProfileCheckpoint>;
    if (record.schemaVersion !== 1 || !["unknown", "rejected", "verified"].includes(record.state ?? "")
        || !["created", "reused"].includes(record.source ?? "")
        || [record.notebookId, record.avId, record.dbBlockId, record.requestId].some((value) => typeof value !== "string" || !ID_PATTERN.test(value))
        || record.docId !== undefined && (typeof record.docId !== "string" || !ID_PATTERN.test(record.docId))
        || record.itemId !== undefined && (typeof record.itemId !== "string" || !ID_PATTERN.test(record.itemId))
        || record.state === "verified" && !record.docId || record.itemId && !record.docId) {
        throw new StoreIntegrityError("本人建档断点", "版本、锚点或请求/文档/行 ID 无效");
    }
    return {
        schemaVersion: 1, notebookId: record.notebookId!, avId: record.avId!, dbBlockId: record.dbBlockId!,
        requestId: record.requestId!, source: record.source!, state: record.state!,
        ...(record.docId ? { docId: record.docId } : {}), ...(record.itemId ? { itemId: record.itemId } : {}),
    };
}

/** 该文档是否是本人 */
export function isSelfDoc(identity: SelfIdentity | null, docId: string): boolean {
    return identity !== null && identity.selfDocId === docId;
}

/** 从名册中摘除本人（首页统计/行动清单/体检用）；identity 为 null 时原样返回 */
export function excludeSelf<T extends { docId: string }>(people: readonly T[], identity: SelfIdentity | null): T[] {
    if (!identity) return [...people];
    return people.filter((person) => person.docId !== identity.selfDocId);
}
