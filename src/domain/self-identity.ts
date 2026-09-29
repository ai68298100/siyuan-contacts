/**
 * 本人身份（B11，纯函数层）：self-identity.json 的归一与使用规则投影。
 * 契约见 docs/DATA-CONTRACT.md §3 self-identity.json——按稳定文档 ID 识别本人；
 * 使用规则：首页统计/行动清单/普通资料体检默认排除本人（本人不是"待联系对象"）。
 */

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
    if (typeof record.createdAt !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(record.createdAt)) return null;
    return {
        schemaVersion: 1,
        selfDocId: record.selfDocId,
        selfItemId: record.selfItemId,
        createdAt: record.createdAt,
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
