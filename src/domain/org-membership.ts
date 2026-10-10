/**
 * 组织与成员关系（B13，纯函数层）：org-membership.json 的归一与投影。
 * 契约见 docs/DATA-CONTRACT.md §8——组织 = 文档 + custom-lvct-org 标记区块；
 * 成员关系存本键（多对多、同组织多段历史、active|former）；组织维度不写 related。
 */

import { parseStoreRecords, StoreIntegrityError } from "./store-integrity.ts";

export type OrgMembershipStatus = "active" | "former";
export type OrgAffiliationKind = "family" | "work" | "education" | "unspecified";

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
    /** 用户自定义状态显示文案；空串表示使用分类和当前性推导的默认文案。 */
    statusLabel?: string;
    affiliationKind?: OrgAffiliationKind;
    /** 仅针对这段组织经历的备注；不替代人物备注。 */
    note?: string;
}

export interface OrgMembershipStore {
    schemaVersion: 1;
    memberships: OrgMembership[];
    tombstones?: string[];
}

export type OrgMembershipStatusFilter = "all" | "active" | "former";

export interface OrgMembershipPage<T> {
    items: T[];
    offset: number;
    limit: number;
    total: number;
    hasMore: boolean;
}

export function sortOrgMemberships<T extends Pick<OrgMembership, "status" | "joinedOn" | "id">>(items: readonly T[]): T[] {
    return [...items].sort((left, right) =>
        Number(left.status !== "active") - Number(right.status !== "active")
        || left.joinedOn.localeCompare(right.joinedOn)
        || left.id.localeCompare(right.id));
}

export function pageOrgMemberships<T extends Pick<OrgMembership, "status" | "joinedOn" | "id">>(
    items: readonly T[],
    options: { status?: OrgMembershipStatusFilter; offset?: number; limit?: number } = {},
): OrgMembershipPage<T> {
    const status = options.status ?? "all";
    if (!["all", "active", "former"].includes(status)) throw new Error("成员状态筛选无效");
    const filtered = status === "all" ? [...items] : items.filter((item) => item.status === status);
    const ordered = sortOrgMemberships(filtered);
    const offset = options.offset ?? 0;
    const limit = options.limit ?? 200;
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error("成员分页 offset 必须是非负整数");
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new Error("成员分页 limit 必须为 1-500");
    const page = ordered.slice(offset, offset + limit);
    return { items: page, offset, limit, total: ordered.length, hasMore: offset + page.length < ordered.length };
}

const ID_PATTERN = /^\d{14}-[0-9a-z]{7}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function validMembershipDate(value: string): boolean {
    if (value === "") return true;
    if (!DATE_PATTERN.test(value)) return false;
    const [year, month, day] = value.split("-").map(Number);
    const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const days = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    return year > 0 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1];
}

export function isValidMembershipPeriod(joinedOn: string, leftOn: string, status: OrgMembershipStatus): boolean {
    return validMembershipDate(joinedOn) && validMembershipDate(leftOn)
        && !(joinedOn && leftOn && joinedOn > leftOn) && !(status === "active" && leftOn);
}

function isNonEmptyString(value: unknown): value is string {
    return typeof value === "string" && value.trim().length > 0;
}

export function isValidOrgStatusLabel(value: unknown): value is string {
    return typeof value === "string" && value.length <= 40 && !/[\r\n]/.test(value);
}

/** 成员备注是单行短文本，避免把组织经历备注误当成人物长备注。 */
export function isValidOrgMembershipNote(value: unknown): value is string {
    return typeof value === "string" && value.length <= 240 && !/[\r\n]/.test(value);
}

function parseMembership(raw: unknown): OrgMembership | null {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
    const record = raw as Partial<OrgMembership>;
    if (!isNonEmptyString(record.id) || !ID_PATTERN.test(record.id)) return null;
    if (!isNonEmptyString(record.orgDocId) || !ID_PATTERN.test(record.orgDocId)) return null;
    if (!isNonEmptyString(record.personDocId) || !ID_PATTERN.test(record.personDocId)) return null;
    const status = record.status === "former" ? "former" : record.status === "active" ? "active" : null;
    if (!status) return null;
    if (record.affiliationKind !== undefined && !isOrgAffiliationKind(record.affiliationKind)) return null;
    if (record.department !== undefined && typeof record.department !== "string") return null;
    if (record.title !== undefined && typeof record.title !== "string") return null;
    if (record.joinedOn !== undefined && typeof record.joinedOn !== "string") return null;
    if (record.leftOn !== undefined && typeof record.leftOn !== "string") return null;
    if (record.statusLabel !== undefined && !isValidOrgStatusLabel(record.statusLabel)) return null;
    if (record.note !== undefined && !isValidOrgMembershipNote(record.note)) return null;
    const joinedOn = typeof record.joinedOn === "string" ? record.joinedOn : "";
    const leftOn = typeof record.leftOn === "string" ? record.leftOn : "";
    /* 日期字段存在但格式非法 → 视为坏条目过滤（不静默改写为空） */
    if (!isValidMembershipPeriod(joinedOn, leftOn, status)) return null;
    return {
        id: record.id,
        orgDocId: record.orgDocId,
        personDocId: record.personDocId,
        department: typeof record.department === "string" ? record.department.trim() : "",
        title: typeof record.title === "string" ? record.title.trim() : "",
        joinedOn,
        leftOn,
        status,
        ...(record.statusLabel === undefined || record.statusLabel.trim() === "" ? {} : { statusLabel: record.statusLabel.trim() }),
        ...(record.affiliationKind === undefined ? {} : { affiliationKind: record.affiliationKind }),
        ...(record.note === undefined || record.note.trim() === "" ? {} : { note: record.note.trim() }),
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
    const memberships = parseStoreRecords<OrgMembership>(raw, "组织成员", "memberships", parseMembership);
    const tombstones = raw !== null && typeof raw === "object" ? (raw as OrgMembershipStore).tombstones : undefined;
    if (tombstones !== undefined && (!Array.isArray(tombstones) || tombstones.some((id) => typeof id !== "string" || !ID_PATTERN.test(id))
        || new Set(tombstones).size !== tombstones.length || memberships.some((membership) => tombstones.includes(membership.id)))) {
        throw new StoreIntegrityError("组织成员", "删除标记损坏、重复或与当前记录冲突", memberships.length);
    }
    const activeKeys = memberships.filter((membership) => membership.status === "active")
        .map((membership) => `${membership.orgDocId}/${membership.personDocId}`);
    if (new Set(activeKeys).size !== activeKeys.length) throw new StoreIntegrityError("组织成员", "同一人物和组织有多条当前成员记录", memberships.length);
    return { schemaVersion: 1, memberships, ...(tombstones === undefined ? {} : { tombstones: [...tombstones] }) };
}

export function isOrgAffiliationKind(value: unknown): value is OrgAffiliationKind {
    return value === "family" || value === "work" || value === "education" || value === "unspecified";
}

/** 自定义状态为空时由界面按当前性和归属分类显示默认文案。 */
export function orgMembershipStatusLabel(
    membership: Pick<OrgMembership, "status" | "statusLabel" | "affiliationKind">,
): string {
    if (membership.statusLabel?.trim()) return membership.statusLabel.trim();
    if (membership.status === "former") return membership.affiliationKind === "education" ? "已毕业/离校" : membership.affiliationKind === "family" ? "曾是家庭成员" : "已离开";
    return membership.affiliationKind === "education" ? "就读" : membership.affiliationKind === "family" ? "家庭成员" : membership.affiliationKind === "work" ? "在职" : "在职/在学";
}

/** 追加成员记录（纯函数返回新 store）；同 id 视为重复静默跳过 */
export function appendMembership(store: OrgMembershipStore, membership: OrgMembership): OrgMembershipStore {
    if (store.tombstones?.includes(membership.id)) return store;
    if (store.memberships.some((existing) => existing.id === membership.id)) return store;
    return { ...store, memberships: [...store.memberships, membership] };
}

/** 移除成员记录（纯函数返回新 store）；找不到 id 返回原 store */
export function removeMembership(store: OrgMembershipStore, id: string): OrgMembershipStore {
    if (!store.memberships.some((existing) => existing.id === id)) return store;
    return { ...store, memberships: store.memberships.filter((existing) => existing.id !== id), tombstones: [...new Set([...(store.tombstones ?? []), id])] };
}

/* ---------- B13.4 成员字段编辑：身份字段（id/orgDocId/personDocId）不可变 ---------- */

export interface OrgMembershipPatch {
    department?: string;
    title?: string;
    joinedOn?: string;
    leftOn?: string;
    status?: OrgMembershipStatus;
    statusLabel?: string;
    affiliationKind?: OrgAffiliationKind;
    note?: string;
}

/**
 * 成员记录字段更新（纯函数）：只拷贝白名单字段；日期必须为空串或 YYYY-MM-DD，
 * 非法返回 null（写前拒绝，绝不静默改写）；department/title trim。
 */
export function applyMembershipPatch(membership: OrgMembership, patch: OrgMembershipPatch): OrgMembership | null {
    if (patch.department !== undefined && typeof patch.department !== "string" || patch.title !== undefined && typeof patch.title !== "string") return null;
    if (patch.statusLabel !== undefined && !isValidOrgStatusLabel(patch.statusLabel)) return null;
    if (patch.note !== undefined && !isValidOrgMembershipNote(patch.note)) return null;
    const department = patch.department === undefined ? membership.department : patch.department.trim();
    const title = patch.title === undefined ? membership.title : patch.title.trim();
    const joinedOn = patch.joinedOn === undefined ? membership.joinedOn : patch.joinedOn;
    const status = patch.status === undefined ? membership.status : patch.status;
    /* 恢复为当前归属时清理历史结束日期；避免 UI 禁用日期控件后把旧日期带回写入。 */
    const leftOn = status === "active" && membership.status !== "active" ? "" : patch.leftOn === undefined ? membership.leftOn : patch.leftOn;
    const statusLabel = patch.statusLabel === undefined ? membership.statusLabel : patch.statusLabel.trim();
    const note = patch.note === undefined ? membership.note : patch.note.trim();
    if (status !== "active" && status !== "former") return null;
    if (typeof joinedOn !== "string" || typeof leftOn !== "string" || !isValidMembershipPeriod(joinedOn, leftOn, status)) return null;
    if (patch.affiliationKind !== undefined && !isOrgAffiliationKind(patch.affiliationKind)) return null;
    const { statusLabel: _currentStatusLabel, note: _currentNote, ...withoutOptionalFields } = membership;
    return {
        ...withoutOptionalFields, department, title, joinedOn, leftOn, status,
        ...(statusLabel ? { statusLabel } : {}),
        ...(patch.affiliationKind === undefined ? {} : { affiliationKind: patch.affiliationKind }),
        ...(note ? { note } : {}),
    };
}

export interface PersonAffiliation extends OrgMembership {
    affiliationKind: OrgAffiliationKind;
    orgName: string | null;
    scope: "current" | "former" | "archived" | "unreachable";
}

export interface PersonAffiliationProjection {
    family: PersonAffiliation[];
    work: PersonAffiliation[];
    education: PersonAffiliation[];
    unspecified: PersonAffiliation[];
    history: PersonAffiliation[];
    unresolved: PersonAffiliation[];
}

export function projectPersonAffiliations(
    personDocId: string,
    memberships: readonly OrgMembership[],
    organizations: ReadonlyMap<string, { name: string; archived: boolean }>,
): PersonAffiliationProjection {
    const result: PersonAffiliationProjection = { family: [], work: [], education: [], unspecified: [], history: [], unresolved: [] };
    for (const membership of sortOrgMemberships(memberships.filter((item) => item.personDocId === personDocId))) {
        const organization = organizations.get(membership.orgDocId);
        const affiliation: PersonAffiliation = {
            ...membership,
            affiliationKind: membership.affiliationKind ?? (organization?.name === "家庭" ? "family" : "unspecified"),
            orgName: organization?.name ?? null,
            scope: !organization ? "unreachable" : membership.status === "former" ? "former" : organization.archived ? "archived" : "current",
        };
        if (affiliation.scope === "unreachable") result.unresolved.push(affiliation);
        else if (affiliation.scope !== "current") result.history.push(affiliation);
        else result[affiliation.affiliationKind].push(affiliation);
    }
    return result;
}

/** 按 id 更新成员记录字段（纯函数返回新 store）；找不到 id 返回原 store */
export function updateMembership(store: OrgMembershipStore, id: string, patch: OrgMembershipPatch): OrgMembershipStore | null {
    const index = store.memberships.findIndex((existing) => existing.id === id);
    if (index < 0) return null;
    const updated = applyMembershipPatch(store.memberships[index], patch);
    if (!updated) return null;
    if (updated.status === "active" && store.memberships.some((entry) => entry.id !== id && entry.status === "active"
        && entry.orgDocId === updated.orgDocId && entry.personDocId === updated.personDocId)) return null;
    if (JSON.stringify(updated) === JSON.stringify(store.memberships[index])) return store;
    const memberships = [...store.memberships];
    memberships[index] = updated;
    return { ...store, memberships };
}

/** 把一段成员经历移动到另一个组织；只改变组织身份，其他字段和记录 ID 保留。 */
export function moveMembership(store: OrgMembershipStore, id: string, targetOrgDocId: string): OrgMembershipStore | null {
    const index = store.memberships.findIndex((existing) => existing.id === id);
    if (index < 0 || !ID_PATTERN.test(targetOrgDocId)) return null;
    const current = store.memberships[index];
    if (current.orgDocId === targetOrgDocId) return null;
    if (current.status === "active" && store.memberships.some((entry) => entry.id !== id
        && entry.orgDocId === targetOrgDocId && entry.personDocId === current.personDocId && entry.status === "active")) return null;
    const memberships = [...store.memberships];
    memberships[index] = { ...current, orgDocId: targetOrgDocId };
    return { ...store, memberships };
}

export function replaceMembership(
    store: OrgMembershipStore,
    formerId: string,
    successor: OrgMembership,
    leftOn: string,
): OrgMembershipStore | null {
    const formerIndex = store.memberships.findIndex((item) => item.id === formerId);
    if (formerIndex < 0) return null;
    const former = store.memberships[formerIndex];
    if (!parseMembership(successor) || store.memberships.some((entry) => entry.id === successor.id) || store.tombstones?.includes(successor.id)) return null;
    if (former.status !== "active" || successor.status !== "active" || successor.leftOn !== "") return null;
    if (successor.orgDocId !== former.orgDocId || successor.personDocId === former.personDocId) return null;
    if (store.memberships.some((item) => item.orgDocId === former.orgDocId && item.personDocId === successor.personDocId && item.status === "active")) {
        return null;
    }
    const closedFormer = applyMembershipPatch(former, { status: "former", leftOn });
    if (!closedFormer) return null;
    const memberships = [...store.memberships];
    memberships[formerIndex] = closedFormer;
    memberships.push(successor);
    return { ...store, memberships };
}
/* ---------- B13.7 人物文档组织归属链接区块（active × 活跃组织投影，契约 §8） ---------- */

export interface OrgLinkEntry {
    orgDocId: string;
    orgName: string;
    department: string;
    title: string;
    affiliationKind?: OrgAffiliationKind;
    statusLabel?: string;
}

/**
 * 组织归属链接区块文本（纯函数）：`**所属组织**：[名](siyuan://blocks/<id>)（部门 · 职位）、…`。
 * 空条目返回空串（调用方据此移除区块）；部门/职位按存在性拼接，两者皆空不加括注。
 * 组织名含 Markdown 语法字符的显示瑕疵与人物姓名同水位（C-14 通道统一处理，不在此转义）。
 */
export function buildOrgLinksSection(entries: readonly OrgLinkEntry[]): string {
    if (entries.length === 0) return "";
    const links = entries.map((entry) => {
        const classification = entry.affiliationKind === "family" ? "家庭" : entry.affiliationKind === "work" ? "工作单位" : entry.affiliationKind === "education" ? "学校" : "其他组织";
        const status = entry.statusLabel?.trim() || (entry.affiliationKind === "education" ? "就读" : entry.affiliationKind === "family" ? "家庭成员" : "在职");
        const details = [classification, status, entry.department, entry.title].filter(Boolean);
        const suffix = details.length ? `（${details.join(" · ")}）`
            : "";
        return `[${entry.orgName}](siyuan://blocks/${entry.orgDocId})${suffix}`;
    });
    return `**所属组织**：${links.join("、")}`;
}

/**
 * B13.9 悬空 org-links 区块判定（纯函数）：文档存在归属链接区块、但该人物已无任何
 * active 成员记录＝悬空（历史对账失败残留）。返回待清理的块 ID 清单。
 */
export function findDanglingOrgLinks(
    /** 文档 rootId → org-links 块 id（SQL 反查结果） */
    blockRoots: ReadonlyMap<string, string>,
    /** 有 active 成员记录的人物 docId 集合 */
    activePersonDocIds: ReadonlySet<string>,
): { blockId: string; rootId: string }[] {
    const dangling: { blockId: string; rootId: string }[] = [];
    for (const [rootId, blockId] of blockRoots) {
        if (!activePersonDocIds.has(rootId)) dangling.push({ rootId, blockId });
    }
    return dangling;
}

/* ---------- B13.6 共同背景：同组织联系人投影（纯展示，零写入，不写 related/称谓） ---------- */

export interface CommonOrgPeer {
    docId: string;
    name: string;
    /** 与本人该组织的重叠期间文本（两端时间未知显示占位） */
    overlapText: string;
    /** 仅当双方加入时间均已知且期间有交集才为 true（时间未知不推断同期，B13.6 验收口径） */
    samePeriod: boolean;
    /** 名册命中的联系人摘要（B13.6 点击同伴开详情；解绑/不在名册时缺省，UI 隐藏入口） */
    contact?: import("./person").ContactSummary;
}

export interface CommonOrgBackground {
    orgDocId: string;
    orgName: string;
    peers: CommonOrgPeer[];
}

const DATE_MIN = "0000-01-01";
const DATE_MAX = "9999-12-31";

/** 成员记录的有效区间（空 joinedOn 视为最早、空 leftOn 视为最晚） */
function membershipRange(membership: OrgMembership): { start: string; end: string } {
    return {
        start: membership.joinedOn !== "" ? membership.joinedOn : DATE_MIN,
        end: membership.leftOn !== "" ? membership.leftOn : DATE_MAX,
    };
}

/** 两区间交集（无交集返回 null） */
function rangeIntersection(a: { start: string; end: string }, b: { start: string; end: string }): { start: string; end: string } | null {
    const start = a.start > b.start ? a.start : b.start;
    const end = a.end < b.end ? a.end : b.end;
    return start <= end ? { start, end } : null;
}

function formatRange(range: { start: string; end: string }): string {
    const start = range.start === DATE_MIN ? "?" : range.start;
    const end = range.end === DATE_MAX ? "至今" : range.end;
    return `${start} ~ ${end}`;
}

/** 本人成员记录是否时间起点已知（推断「同期」的必要条件） */
function startKnown(membership: OrgMembership): boolean {
    return membership.joinedOn !== "";
}

/**
 * 共同背景投影：与当前人物同组织的联系人（含历史 former，期间交集为准）。
 * - 排除本人；双方多段记录任一交集非空即收录，重叠文本取最大交集；
 * - samePeriod 仅在双方 joinedOn 均已知时为 true——时间未知只展示同组织事实，不推断「同期」；
 * - 不写 related、不产生称谓、零写入（B13.6 验收口径）。
 * - B13.5b 查询规模：一次遍历建「组织 → 成员记录」索引后按组织直取候选，同伴查重用
 *   Set——不再对每段归属全索引扫描、不对 peers 做线性 some；输出语义与全量扫描一致。
 */
export function buildCommonOrgBackground(options: {
    personDocId: string;
    membershipIndex: ReadonlyMap<string, readonly OrgMembership[]>;
    namesByDoc: ReadonlyMap<string, string>;
    /** docId → 组织名（含归档组织——共同背景是历史事实，活跃口径过滤在调用方） */
    orgNames?: ReadonlyMap<string, string>;
    /** docId → 联系人摘要（B13.6 点击同伴开详情；缺省时 UI 隐藏入口） */
    contactsByDoc?: ReadonlyMap<string, import("./person").ContactSummary>;
}): CommonOrgBackground[] {
    const { personDocId, membershipIndex, namesByDoc, orgNames, contactsByDoc } = options;
    const ownRecords = membershipIndex.get(personDocId) ?? [];
    if (ownRecords.length === 0) return [];
    /* 组织 →（人物 → 该组织成员记录）：键序沿用 membershipIndex 首现序，保证同伴顺序稳定 */
    const membersByOrg = new Map<string, Map<string, OrgMembership[]>>();
    for (const [peerDocId, peerRecords] of membershipIndex) {
        if (peerDocId === personDocId) continue;
        for (const record of peerRecords) {
            let byPerson = membersByOrg.get(record.orgDocId);
            if (!byPerson) {
                byPerson = new Map();
                membersByOrg.set(record.orgDocId, byPerson);
            }
            const list = byPerson.get(peerDocId);
            if (list) list.push(record);
            else byPerson.set(peerDocId, [record]);
        }
    }
    const byOrg = new Map<string, CommonOrgBackground>();
    const seenPeersByOrg = new Map<string, Set<string>>();
    for (const own of ownRecords) {
        const ownRange = membershipRange(own);
        let entry = byOrg.get(own.orgDocId);
        if (!entry) {
            entry = {
                orgDocId: own.orgDocId,
                orgName: orgNames?.get(own.orgDocId) ?? "（组织文档不可达）",
                peers: [],
            };
            byOrg.set(own.orgDocId, entry);
            seenPeersByOrg.set(own.orgDocId, new Set());
        }
        const seenPeers = seenPeersByOrg.get(own.orgDocId)!;
        const candidates = membersByOrg.get(own.orgDocId);
        if (!candidates) continue;
        for (const [peerDocId, peerRecords] of candidates) {
            if (seenPeers.has(peerDocId)) continue;
            let best: { range: { start: string; end: string }; samePeriod: boolean } | null = null;
            for (const peerRecord of peerRecords) {
                const intersection = rangeIntersection(ownRange, membershipRange(peerRecord));
                if (!intersection) continue;
                const candidate = {
                    range: intersection,
                    samePeriod: startKnown(own) && startKnown(peerRecord),
                };
                if (!best || candidate.range.start < best.range.start) best = candidate;
            }
            if (!best) continue;
            const peerName = namesByDoc.get(peerDocId);
            if (!peerName) continue;
            seenPeers.add(peerDocId);
            entry.peers.push({
                docId: peerDocId,
                name: peerName,
                overlapText: formatRange(best.range),
                samePeriod: best.samePeriod,
                contact: contactsByDoc?.get(peerDocId),
            });
        }
    }
    /* 无同伴的组织不进背景（组织名单本身由成员列表承载） */
    return [...byOrg.values()].filter((entry) => entry.peers.length > 0);
}
