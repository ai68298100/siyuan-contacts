/**
 * 组织与成员关系（B13，纯函数层）：org-membership.json 的归一与投影。
 * 契约见 docs/DATA-CONTRACT.md §8——组织 = 文档 + custom-lvct-org 标记区块；
 * 成员关系存本键（多对多、同组织多段历史、active|former）；组织维度不写 related。
 */

export type OrgMembershipStatus = "active" | "former";

export interface OrgMembership {
    /** 成员记录 ID（yyyyMMddHHmmss-xxxxxxx，与人物/组织文档 ID 相互独立） */
    id: string;
    orgDocId: string;
    personDocId: string;
    /** 部门；空串表示未填 */
    department: string;
    /** 职位；空串表示未填 */
    title: string;
    /** YYYY-MM-DD；空串表示未知 */
    joinedOn: string;
    /** YYYY-MM-DD；空串表示在职/在学中 */
    leftOn: string;
    status: OrgMembershipStatus;
}

export interface OrgMembershipStore {
    schemaVersion: 1;
    memberships: OrgMembership[];
}

const ID_PATTERN = /^\d{14}-[0-9a-z]{7}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isNonEmptyString(value: unknown): value is string {
    return typeof value === "string" && value.trim().length > 0;
}

function parseMembership(raw: unknown): OrgMembership | null {
    if (raw === null || typeof raw !== "object") return null;
    const record = raw as Partial<OrgMembership>;
    if (!isNonEmptyString(record.id) || !ID_PATTERN.test(record.id)) return null;
    if (!isNonEmptyString(record.orgDocId) || !ID_PATTERN.test(record.orgDocId)) return null;
    if (!isNonEmptyString(record.personDocId) || !ID_PATTERN.test(record.personDocId)) return null;
    const status = record.status === "former" ? "former" : record.status === "active" ? "active" : null;
    if (!status) return null;
    const joinedOn = typeof record.joinedOn === "string" ? record.joinedOn : "";
    const leftOn = typeof record.leftOn === "string" ? record.leftOn : "";
    /* 日期字段存在但格式非法 → 视为坏条目过滤（不静默改写为空） */
    if (joinedOn !== "" && !DATE_PATTERN.test(joinedOn)) return null;
    if (leftOn !== "" && !DATE_PATTERN.test(leftOn)) return null;
    return {
        id: record.id,
        orgDocId: record.orgDocId,
        personDocId: record.personDocId,
        department: typeof record.department === "string" ? record.department.trim() : "",
        title: typeof record.title === "string" ? record.title.trim() : "",
        joinedOn,
        leftOn,
        status,
    };
}

/** 读时归一：坏条目过滤、按 id 去重，绝不抛错 */
export function normalizeOrgMembershipStore(raw: unknown): OrgMembershipStore {
    if (raw === null || typeof raw !== "object") return { schemaVersion: 1, memberships: [] };
    const record = raw as Partial<OrgMembershipStore>;
    if (!Array.isArray(record.memberships)) return { schemaVersion: 1, memberships: [] };
    const seen = new Set<string>();
    const memberships: OrgMembership[] = [];
    for (const item of record.memberships) {
        const parsed = parseMembership(item);
        if (!parsed || seen.has(parsed.id)) continue;
        seen.add(parsed.id);
        memberships.push(parsed);
    }
    return { schemaVersion: 1, memberships };
}

/** 写前严格检查：不丢弃损坏数据；版本或结构不兼容抛错（与跟进库同纪律） */
export function normalizeOrgMembershipStoreForWrite(raw: unknown): OrgMembershipStore {
    if (raw === null || raw === "") return { schemaVersion: 1, memberships: [] };
    if (typeof raw !== "object" || (raw as Partial<OrgMembershipStore>).schemaVersion !== 1
        || !Array.isArray((raw as Partial<OrgMembershipStore>).memberships)
        || !(raw as Partial<OrgMembershipStore>).memberships!.every(isStrictMembership)) {
        throw new Error("组织成员存储内容损坏，操作已停止；请先备份并检查原文件");
    }
    return normalizeOrgMembershipStore(raw);
}

function isStrictMembership(raw: unknown): boolean {
    if (raw === null || typeof raw !== "object") return false;
    const item = raw as Partial<OrgMembership>;
    return typeof item.id === "string" && item.id.length > 0
        && typeof item.orgDocId === "string" && item.orgDocId.length > 0
        && typeof item.personDocId === "string" && item.personDocId.length > 0
        && (item.status === "active" || item.status === "former")
        && (item.department === undefined || typeof item.department === "string")
        && (item.title === undefined || typeof item.title === "string")
        && (item.joinedOn === undefined || (typeof item.joinedOn === "string" && (item.joinedOn === "" || DATE_PATTERN.test(item.joinedOn))))
        && (item.leftOn === undefined || (typeof item.leftOn === "string" && (item.leftOn === "" || DATE_PATTERN.test(item.leftOn))));
}

/** 追加成员记录（纯函数返回新 store）；同 id 视为重复静默跳过 */
export function appendMembership(store: OrgMembershipStore, membership: OrgMembership): OrgMembershipStore {
    if (store.memberships.some((existing) => existing.id === membership.id)) return store;
    return { ...store, memberships: [...store.memberships, membership] };
}

/** 移除成员记录（纯函数返回新 store）；找不到 id 返回原 store */
export function removeMembership(store: OrgMembershipStore, id: string): OrgMembershipStore {
    if (!store.memberships.some((existing) => existing.id === id)) return store;
    return { ...store, memberships: store.memberships.filter((existing) => existing.id !== id) };
}

/* ---------- B13.4 成员字段编辑：身份字段（id/orgDocId/personDocId）不可变 ---------- */

export interface OrgMembershipPatch {
    department?: string;
    title?: string;
    joinedOn?: string;
    leftOn?: string;
    status?: OrgMembershipStatus;
}

/**
 * 成员记录字段更新（纯函数）：只拷贝白名单字段；日期必须为空串或 YYYY-MM-DD，
 * 非法返回 null（写前拒绝，绝不静默改写）；department/title trim。
 */
export function applyMembershipPatch(membership: OrgMembership, patch: OrgMembershipPatch): OrgMembership | null {
    const department = patch.department === undefined ? membership.department : patch.department.trim();
    const title = patch.title === undefined ? membership.title : patch.title.trim();
    const joinedOn = patch.joinedOn === undefined ? membership.joinedOn : patch.joinedOn;
    const leftOn = patch.leftOn === undefined ? membership.leftOn : patch.leftOn;
    if (joinedOn !== "" && !DATE_PATTERN.test(joinedOn)) return null;
    if (leftOn !== "" && !DATE_PATTERN.test(leftOn)) return null;
    const status = patch.status === undefined ? membership.status : patch.status;
    if (status !== "active" && status !== "former") return null;
    return { ...membership, department, title, joinedOn, leftOn, status };
}

/** 按 id 更新成员记录字段（纯函数返回新 store）；找不到 id 返回原 store */
export function updateMembership(store: OrgMembershipStore, id: string, patch: OrgMembershipPatch): OrgMembershipStore | null {
    const index = store.memberships.findIndex((existing) => existing.id === id);
    if (index < 0) return null;
    const updated = applyMembershipPatch(store.memberships[index], patch);
    if (!updated) return null;
    if (updated === store.memberships[index]) return store;
    const memberships = [...store.memberships];
    memberships[index] = updated;
    return { ...store, memberships };
}
