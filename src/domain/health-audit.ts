/**
 * FUNC-01.4/C04 资料体检：对名册数据质量做只读巡检，纯函数无 IO。
 * 纪律（docs/FEEDBACK-BACKLOG.md FUNC-01.4/C04）：
 * - 体检零写入；每项给可解释的检测依据与影响范围；
 * - 不自动合并人物、不删除文档、不猜测关系；修复动作由既有入口（补录/安全解绑/重绑）承担。
 * 检查项：缺电话、缺生日、三联系渠道全空、无分组且无标签、生日年份异常、
 * 关系目标不可达、跟进目标不可达、互动指向不存在文档。
 */

import type { ContactSummary } from "./person";
import type { FollowUpItem } from "./followups";
import type { OrgMembership } from "./org-membership";
import type { SelfIdentity } from "./self-identity";
import { normalizeInteractionStoreForWrite } from "./interactions.ts";
import type { InteractionStore } from "./interactions";
import { normalizeFollowUpStoreForWrite } from "./followups.ts";
import type { FollowUpStore } from "./followups";
import { normalizeSelfIdentity } from "./self-identity.ts";

export type AuditIssueKind =
    | "missingPhone"
    | "missingBirthday"
    | "missingContact"
    | "noGroupNoTags"
    | "suspiciousBirthday"
    | "danglingRelation"
    | "unreachableFollowUp"
    | "orphanInteraction"
    | "duplicateSuspect"
    | "longInactive"
    | "orphanOrganizationMember"
    | "duplicateOrganizationHistory"
    | "abnormalOrganizationPeriod"
    | "unreachableSelfIdentity";

export type AuditModuleKey = "roster" | "interactions" | "followUps" | "organizationMembers" | "selfIdentity";
export type AuditModuleState = "success" | "failed" | "unknown";
export type AuditReadStatus = "verified" | "not_found" | "read_failed" | "timed_out" | "bad_json" | "unverified";
export type AuditPresence = "found" | "not_found" | "unverified";

export interface AuditRepairPreview {
    mode: "preview";
    action: string;
    targetIds: string[];
    targetDocIds?: string[];
    impact: string;
    writes: 0;
    confirmationRequired: true;
}

export interface AuditIssue {
    module: AuditModuleKey;
    kind: AuditIssueKind;
    /** 检测依据（一句话，可解释） */
    reason: string;
    /** 涉及对象：人物用 itemId；互动孤儿用人物 docId（供跳转类入口消费） */
    itemIds: string[];
    /** 展示用示例名单（≤5；孤儿互动显示 docId 片段） */
    samples: string[];
    repair: AuditRepairPreview;
}

export interface AuditModuleResult {
    module: AuditModuleKey;
    state: AuditModuleState;
    readStatus: AuditReadStatus;
    presence: AuditPresence;
    count: number | null;
    issues: AuditIssue[];
    stale?: boolean;
    message?: string;
}

export interface HealthAuditReferences {
    people: ContactSummary[];
    organizationDocIds: string[];
    interactions?: InteractionStore;
    followUps?: FollowUpStore;
    organizationMembers?: OrgMembership[];
    selfIdentity?: SelfIdentity | null;
}

export interface HealthAuditReport {
    modules: Record<AuditModuleKey, AuditModuleResult>;
    issues: AuditIssue[];
    references: HealthAuditReferences;
    writes: 0;
}

export interface HealthAuditInput {
    people: readonly ContactSummary[];
    /** 人物 docId → 未删除互动条数 */
    interactionCounts: Readonly<Record<string, number>>;
    /** 全量跟进（只检查 open 状态的可达性） */
    followUps: readonly FollowUpItem[];
    /** C04：长期无互动阈值（天，默认 90）；0/缺省 = 不检查 */
    longInactiveDays?: number;
    /** 人物 docId → 最近互动毫秒时间戳（服务层从互动库计算；缺条目 = 从未互动） */
    lastInteractionAt?: Readonly<Record<string, number>>;
    /** C04：疑似重复对（复用 F13 findDuplicatePairs 判定，服务层传入） */
    duplicatePairs?: Readonly<{ a: { itemId: string; name: string }; b: { itemId: string; name: string } }[]>;
    organizationMembers?: readonly OrgMembership[];
    organizationDocIds?: readonly string[];
    selfIdentity?: SelfIdentity | null;
}

const SAMPLE_LIMIT = 5;
const MIN_BIRTH_YEAR = 1900;
export const DEFAULT_LONG_INACTIVE_DAYS = 90;

const REPAIR_COPY: Record<AuditIssueKind, { action: string; impact: string }> = {
    missingPhone: { action: "补录电话", impact: "只定位目标联系人，不改写其他字段。" },
    missingBirthday: { action: "补录生日", impact: "只定位目标联系人，不改写其他字段。" },
    missingContact: { action: "补录联系方式", impact: "只定位目标联系人，不自动猜测联系方式。" },
    noGroupNoTags: { action: "补充分组或标签", impact: "只定位目标联系人，不自动选择分组或标签。" },
    suspiciousBirthday: { action: "核对生日", impact: "只展示异常值，确认前不修改生日。" },
    danglingRelation: { action: "核对并安全解绑关系", impact: "只处理目标关系，不删除人物文档。" },
    unreachableFollowUp: { action: "核对跟进目标", impact: "只定位跟进记录，不重建人物或任务块。" },
    orphanInteraction: { action: "核对互动归属", impact: "只定位互动记录，不删除或移动互动事实。" },
    duplicateSuspect: { action: "人工核对疑似重复", impact: "只展示重复候选，不自动合并人物。" },
    longInactive: { action: "查看长期未互动联系人", impact: "只展示联系提醒范围，不自动创建跟进。" },
    orphanOrganizationMember: { action: "核对组织成员归属", impact: "只定位成员记录，不猜测组织或人物文档。" },
    duplicateOrganizationHistory: { action: "核对重复组织历史", impact: "只展示重复历史，不自动删除或合并成员记录。" },
    abnormalOrganizationPeriod: { action: "核对组织任职期间", impact: "只展示异常期间，不自动填补或更改任职日期。" },
    unreachableSelfIdentity: { action: "核对本人身份绑定", impact: "只展示身份与名册差异，不自动改绑。" },
};

export function previewAuditRepair(issue: Pick<AuditIssue, "module" | "kind" | "itemIds">): AuditRepairPreview {
    const copy = REPAIR_COPY[issue.kind];
    return {
        mode: "preview",
        action: copy.action,
        targetIds: [...issue.itemIds],
        impact: copy.impact,
        writes: 0,
        confirmationRequired: true,
    };
}

function toIssue(module: AuditModuleKey, kind: AuditIssueKind, reason: string, entries: { id: string; label: string; repairId?: string; docId?: string; docIds?: string[] }[]): AuditIssue {
    const repair = previewAuditRepair({ module, kind, itemIds: entries.map((entry) => entry.repairId ?? entry.id) });
    const targetDocIds = [...new Set(entries.flatMap((entry) => entry.docIds ?? (entry.docId ? [entry.docId] : [])))];
    if (targetDocIds.length) repair.targetDocIds = targetDocIds;
    return {
        module,
        kind,
        reason,
        itemIds: entries.map((entry) => entry.id),
        samples: entries.slice(0, SAMPLE_LIMIT).map((entry) => entry.label),
        repair,
    };
}

/** 生日年份异常：早于 1900 或晚于明年（未来生日不允许，未来年份属录入错误） */
export function isSuspiciousBirthday(birthday: string, now = new Date()): boolean {
    const match = birthday.match(/^(\d{4})-\d{2}-\d{2}$/);
    if (!match) return birthday.length > 0; /* 非空但不符合契约格式同样可疑 */
    const year = Number(match[1]);
    return year < MIN_BIRTH_YEAR || year > now.getFullYear() + 1;
}

/**
 * C04 长期无互动：有互动记录、但最近一次互动早于阈值（默认 90 天）的人。
 * 从未互动的人不在此类（由缺联系方式/无分组口径覆盖）；阈值 ≤0 时不检查。
 */
export function findLongInactive(
    people: readonly Pick<ContactSummary, "docId" | "itemId" | "name">[],
    lastInteractionAt: Readonly<Record<string, number>>,
    longInactiveDays: number,
    now = new Date(),
): { id: string; label: string }[] {
    if (longInactiveDays <= 0) return [];
    const cutoff = new Date(now);
    cutoff.setDate(cutoff.getDate() - longInactiveDays);
    const cutoffMs = cutoff.getTime();
    return people
        .filter((person) => {
            const last = lastInteractionAt[person.docId];
            return last !== undefined && last < cutoffMs;
        })
        .map((person) => ({ id: person.itemId, label: person.name }));
}

export function runHealthAudit(input: HealthAuditInput): AuditIssue[] {
    const { people, interactionCounts, followUps, lastInteractionAt, duplicatePairs } = input;
    const graceDays = input.longInactiveDays ?? DEFAULT_LONG_INACTIVE_DAYS;
    const issues: AuditIssue[] = [];
    const byItemId = new Map(people.map((person) => [person.itemId, person]));
    const byDocId = new Map(people.map((person) => [person.docId, person]));

    const missingPhone: { id: string; label: string }[] = [];
    const missingBirthday: { id: string; label: string }[] = [];
    const missingContact: { id: string; label: string }[] = [];
    const noGroupNoTags: { id: string; label: string }[] = [];
    const suspicious: { id: string; label: string }[] = [];
    const dangling: { id: string; label: string }[] = [];
    for (const person of people) {
        if (person.docId === input.selfIdentity?.selfDocId) continue;
        if (!person.phone.trim()) missingPhone.push({ id: person.itemId, label: person.name });
        if (!person.birthday.trim()) missingBirthday.push({ id: person.itemId, label: person.name });
        if (!person.phone.trim() && !person.email.trim() && !person.wechat.trim()) {
            missingContact.push({ id: person.itemId, label: person.name });
        }
        if (!person.group.trim() && person.tags.length === 0) {
            noGroupNoTags.push({ id: person.itemId, label: person.name });
        }
        if (isSuspiciousBirthday(person.birthday)) suspicious.push({ id: person.itemId, label: person.name });
        /* 关系目标不可达：related 指向的 itemID 不在当前名册（对方被解绑/移除） */
        for (const relatedItemId of person.relatedItemIds) {
            if (!byItemId.has(relatedItemId)) {
                dangling.push({ id: person.itemId, label: `${person.name} → itemID ${relatedItemId.slice(-6)}` });
                break; /* 每人只报一次，避免长列表重复 */
            }
        }
    }

    const unreachableFollowUps = followUps
        .filter((item) => item.status === "open" && item.personDocId !== input.selfIdentity?.selfDocId && !byDocId.has(item.personDocId))
        .map((item) => ({ id: item.personDocId, repairId: item.id, docId: item.personDocId, label: `「${item.title || "保持联系"}」(${item.dueDate})` }));
    const orphanInteractions = Object.entries(interactionCounts)
        .filter(([docId]) => docId !== input.selfIdentity?.selfDocId && !byDocId.has(docId))
        .map(([docId, count]) => ({ id: docId, label: `${docId.slice(-6)}（${count} 条）` }));

    if (missingPhone.length) issues.push(toIssue("roster", "missingPhone", "以下联系人未填电话，按名册电话列筛选可批量补录", missingPhone));
    if (missingBirthday.length) issues.push(toIssue("roster", "missingBirthday", "以下联系人未填生日，补录后生日提醒与农历投影才会生效", missingBirthday));
    if (missingContact.length) issues.push(toIssue("roster", "missingContact", "以下联系人电话、邮箱、微信全部为空，无法主动联系", missingContact));
    if (noGroupNoTags.length) issues.push(toIssue("roster", "noGroupNoTags", "以下联系人既无分组也无标签，列表与筛选中难以归类", noGroupNoTags));
    if (suspicious.length) issues.push(toIssue("roster", "suspiciousBirthday", "以下联系人生日早于 1900 年、晚于明年或不符合 YYYY-MM-DD 格式，疑似录入错误", suspicious));
    if (dangling.length) issues.push(toIssue("roster", "danglingRelation", "以下联系人的「相关人」指向的名册行已不存在（对方可能被解绑），可在联系人页安全解绑", dangling));
    if (unreachableFollowUps.length) issues.push(toIssue("followUps", "unreachableFollowUp", "以下跟进计划的人物文档已不在名册（可能被解绑），仍可完成/跳过或重建人物", unreachableFollowUps));
    if (orphanInteractions.length) issues.push(toIssue("interactions", "orphanInteraction", "以下互动记录指向的人物文档不在名册中，导出与回顾仍会包含，重绑或收编后自动归位", orphanInteractions));
    /* C04 余项并入：疑似重复（复用 F13 判定，服务层传入）与长期无互动 */
    if (duplicatePairs && duplicatePairs.length > 0) {
        const entries = duplicatePairs.map((pair) => ({
            id: pair.a.itemId,
            label: `${pair.a.name} ≈ ${pair.b.name}`,
        }));
        const issue = toIssue("roster", "duplicateSuspect", "以下联系人疑似同一人（同名/同联系方式，F13 判定），请人工核对；本体检不会自动合并", entries);
        issue.repair.targetIds = [...new Set(duplicatePairs.flatMap((pair) => [pair.a.itemId, pair.b.itemId]))];
        issues.push(issue);
    }
    const longInactive = findLongInactive(people.filter((person) => person.docId !== input.selfIdentity?.selfDocId), lastInteractionAt ?? {}, graceDays, new Date());
    if (longInactive.length) {
        issues.push(toIssue("interactions", "longInactive", `以下联系人有互动记录、但最近一次互动已超过 ${graceDays} 天（可在设置调整阈值视角）`, longInactive));
    }
    if (input.organizationMembers && input.organizationDocIds) {
        issues.push(...runOrganizationMemberAudit({
            people,
            memberships: input.organizationMembers,
            organizationDocIds: input.organizationDocIds,
        }));
    }
    if (input.selfIdentity !== undefined) {
        issues.push(...runSelfIdentityAudit({ people, identity: input.selfIdentity }));
    }
    return issues;
}

export function runRosterAudit(
    people: readonly ContactSummary[],
    duplicatePairs: HealthAuditInput["duplicatePairs"] = [],
    identity?: SelfIdentity | null,
): AuditIssue[] {
    return runHealthAudit({ people, interactionCounts: {}, followUps: [], duplicatePairs, selfIdentity: identity }).filter((issue) => issue.module === "roster");
}

export function runInteractionAudit(input: {
    people: readonly Pick<ContactSummary, "docId" | "itemId" | "name">[];
    interactionCounts: Readonly<Record<string, number>>;
    lastInteractionAt?: Readonly<Record<string, number>>;
    longInactiveDays?: number;
}): AuditIssue[] {
    const byDocId = new Set(input.people.map((person) => person.docId));
    const orphan = Object.entries(input.interactionCounts)
        .filter(([docId]) => !byDocId.has(docId))
        .map(([docId, count]) => ({ id: docId, label: `${docId.slice(-6)}（${count} 条）` }));
    const longInactive = findLongInactive(input.people, input.lastInteractionAt ?? {}, input.longInactiveDays ?? DEFAULT_LONG_INACTIVE_DAYS);
    const issues: AuditIssue[] = [];
    if (orphan.length) issues.push(toIssue("interactions", "orphanInteraction", "以下互动记录指向的人物文档不在名册中，导出与回顾仍会包含，重绑或收编后自动归位", orphan));
    if (longInactive.length) issues.push(toIssue("interactions", "longInactive", `以下联系人有互动记录、但最近一次互动已超过 ${input.longInactiveDays ?? DEFAULT_LONG_INACTIVE_DAYS} 天（可在设置调整阈值视角）`, longInactive));
    return issues;
}

export function runFollowUpAudit(people: readonly Pick<ContactSummary, "docId">[], followUps: readonly FollowUpItem[]): AuditIssue[] {
    const byDocId = new Set(people.map((person) => person.docId));
    const unreachable = followUps
        .filter((item) => item.status === "open" && !byDocId.has(item.personDocId))
        .map((item) => ({ id: item.personDocId, repairId: item.id, docId: item.personDocId, label: `「${item.title || "保持联系"}」(${item.dueDate})` }));
    return unreachable.length
        ? [toIssue("followUps", "unreachableFollowUp", "以下跟进计划的人物文档已不在名册（可能被解绑），仍可完成/跳过或重建人物", unreachable)]
        : [];
}

export function runOrganizationMemberAudit(input: {
    people: readonly Pick<ContactSummary, "docId">[];
    memberships: readonly OrgMembership[];
    organizationDocIds: readonly string[];
}): AuditIssue[] {
    const personIds = new Set(input.people.map((person) => person.docId));
    const organizationIds = new Set(input.organizationDocIds);
    const orphan = input.memberships
        .filter((membership) => !personIds.has(membership.personDocId) || !organizationIds.has(membership.orgDocId))
        .map((membership) => ({
            id: membership.id,
            docIds: [membership.orgDocId, membership.personDocId],
            label: `${membership.id.slice(-6)}（${personIds.has(membership.personDocId) ? "组织不可达" : "人物不可达"}）`,
        }));
    const duplicateGroups = new Map<string, OrgMembership[]>();
    const byRecordId = new Map<string, OrgMembership[]>();
    for (const membership of input.memberships) {
        const key = [membership.orgDocId, membership.personDocId, membership.status, membership.joinedOn, membership.leftOn].join("|");
        const group = duplicateGroups.get(key) ?? [];
        group.push(membership);
        duplicateGroups.set(key, group);
        const records = byRecordId.get(membership.id) ?? [];
        records.push(membership);
        byRecordId.set(membership.id, records);
    }
    const duplicate = [...duplicateGroups.values(), ...byRecordId.values()]
        .filter((group) => group.length > 1)
        .flatMap((group) => group.map((membership) => ({ id: membership.id, label: `${membership.id.slice(-6)}（重复历史）` })));
    const invalidPeriod = input.memberships.filter((membership) =>
        membership.joinedOn !== "" && !isCalendarDate(membership.joinedOn)
        || membership.leftOn !== "" && !isCalendarDate(membership.leftOn)
        || membership.joinedOn !== "" && membership.leftOn !== "" && membership.joinedOn > membership.leftOn
        || membership.status === "active" && membership.leftOn !== "",
    ).map((membership) => ({ id: membership.id, docId: membership.orgDocId, label: `${membership.id}（${membership.joinedOn || "未知"} ~ ${membership.leftOn || "至今"}）` }));
    const issues: AuditIssue[] = [];
    if (orphan.length) issues.push(toIssue("organizationMembers", "orphanOrganizationMember", "以下组织成员记录指向名册或组织文档之外的对象，不能猜测归属", orphan));
    if (duplicate.length) issues.push(toIssue("organizationMembers", "duplicateOrganizationHistory", "以下组织成员记录具有重复记录 ID 或相同组织、人物、状态和时间区间，疑似重复历史", duplicate));
    if (invalidPeriod.length) issues.push(toIssue("organizationMembers", "abnormalOrganizationPeriod", "以下组织成员记录的日期不存在、加入晚于离开或在职状态仍有离开日期，请核对原记录", invalidPeriod));
    return issues;
}

function isCalendarDate(value: string): boolean {
    const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!parts) return false;
    const date = new Date(0);
    date.setFullYear(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]));
    return date.getFullYear() === Number(parts[1]) && date.getMonth() === Number(parts[2]) - 1 && date.getDate() === Number(parts[3]);
}

export function runSelfIdentityAudit(input: { people: readonly Pick<ContactSummary, "docId" | "itemId" | "name">[]; identity: SelfIdentity | null }): AuditIssue[] {
    if (!input.identity) return [];
    const person = input.people.find((item) => item.docId === input.identity!.selfDocId);
    if (!person) {
        return [toIssue("selfIdentity", "unreachableSelfIdentity", "本人身份标记存在，但对应人物文档不在名册中；不会按普通联系人静默处理", [{ id: input.identity.selfDocId, label: input.identity.selfDocId }])];
    }
    if (person.itemId !== input.identity.selfItemId) {
        return [toIssue("selfIdentity", "unreachableSelfIdentity", `本人身份文档已在名册，但绑定行不一致（当前为 ${person.itemId}）`, [{ id: person.docId, label: person.name }])];
    }
    return [];
}

export function buildHealthAuditReport(
    modules: Readonly<Record<AuditModuleKey, AuditModuleResult>>,
    references: HealthAuditReferences,
): HealthAuditReport {
    const issues = (Object.keys(modules) as AuditModuleKey[]).flatMap((key) => modules[key].issues);
    return { modules: { ...modules }, issues, references, writes: 0 };
}

export class HealthAuditJsonError extends Error {
    readonly module: AuditModuleKey;

    constructor(module: AuditModuleKey) {
        super(`${module} JSON 格式、版本或条目损坏，体检无法核实`);
        this.name = "HealthAuditJsonError";
        this.module = module;
    }
}

function decodeRaw(raw: unknown, module: AuditModuleKey): unknown {
    if (raw == null || raw === "") return null;
    if (typeof raw !== "string") return raw;
    try {
        const value: unknown = JSON.parse(raw);
        if (value === null || typeof value !== "object" || Array.isArray(value)) throw new HealthAuditJsonError(module);
        return value;
    } catch {
        throw new HealthAuditJsonError(module);
    }
}

export function decodeAuditInteractions(raw: unknown): InteractionStore {
    try {
        return normalizeInteractionStoreForWrite(decodeRaw(raw, "interactions"));
    } catch {
        throw new HealthAuditJsonError("interactions");
    }
}

export function decodeAuditFollowUps(raw: unknown): FollowUpStore {
    try {
        return normalizeFollowUpStoreForWrite(decodeRaw(raw, "followUps"));
    } catch {
        throw new HealthAuditJsonError("followUps");
    }
}

export function decodeAuditSelfIdentity(raw: unknown): SelfIdentity | null {
    const value = decodeRaw(raw, "selfIdentity");
    if (value === null) return null;
    const identity = normalizeSelfIdentity(value);
    if (!identity) throw new HealthAuditJsonError("selfIdentity");
    return identity;
}

export function decodeAuditOrganizationMembers(raw: unknown): OrgMembership[] {
    const value = decodeRaw(raw, "organizationMembers");
    if (value === null) return [];
    if (typeof value !== "object" || Array.isArray(value)) throw new HealthAuditJsonError("organizationMembers");
    const store = value as { schemaVersion?: unknown; memberships?: unknown };
    if (store.schemaVersion !== 1 || !Array.isArray(store.memberships)) throw new HealthAuditJsonError("organizationMembers");
    return store.memberships.map((rawMember) => {
        if (rawMember === null || typeof rawMember !== "object" || Array.isArray(rawMember)) throw new HealthAuditJsonError("organizationMembers");
        const member = rawMember as Partial<OrgMembership>;
        const validId = (id: unknown) => typeof id === "string" && /^\d{14}-[0-9a-z]{7}$/.test(id);
        const validDate = (date: unknown) => date === undefined || typeof date === "string" && (date === "" || /^\d{4}-\d{2}-\d{2}$/.test(date));
        if (!validId(member.id) || !validId(member.personDocId) || !validId(member.orgDocId)
            || member.status !== "active" && member.status !== "former"
            || member.department !== undefined && typeof member.department !== "string"
            || member.title !== undefined && typeof member.title !== "string"
            || !validDate(member.joinedOn) || !validDate(member.leftOn)) throw new HealthAuditJsonError("organizationMembers");
        return { ...member, department: member.department ?? "", title: member.title ?? "", joinedOn: member.joinedOn ?? "", leftOn: member.leftOn ?? "" } as OrgMembership;
    });
}
