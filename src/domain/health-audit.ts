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
    /* B13.9 组织体检（第一批只读；修复由组织管理既有入口承担） */
    | "orphanOrgMember"
    | "unreachableOrg"
    | "invertedMembershipPeriod"
    | "duplicateActiveMembership"
    | "conflictingOrgMarkers";

export interface AuditIssue {
    kind: AuditIssueKind;
    /** 检测依据（一句话，可解释） */
    reason: string;
    /** 涉及对象：人物用 itemId；互动孤儿用人物 docId（供跳转类入口消费） */
    itemIds: string[];
    /** 展示用示例名单（≤5；孤儿互动显示 docId 片段） */
    samples: string[];
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
}

const SAMPLE_LIMIT = 5;
const MIN_BIRTH_YEAR = 1900;
export const DEFAULT_LONG_INACTIVE_DAYS = 90;

function toIssue(kind: AuditIssueKind, reason: string, entries: { id: string; label: string }[]): AuditIssue {
    return {
        kind,
        reason,
        itemIds: entries.map((entry) => entry.id),
        samples: entries.slice(0, SAMPLE_LIMIT).map((entry) => entry.label),
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
    people: readonly ContactSummary[],
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
        .filter((item) => item.status === "open" && !byDocId.has(item.personDocId))
        .map((item) => ({ id: item.personDocId, label: `「${item.title || "保持联系"}」(${item.dueDate})` }));
    const orphanInteractions = Object.entries(interactionCounts)
        .filter(([docId]) => !byDocId.has(docId))
        .map(([docId, count]) => ({ id: docId, label: `${docId.slice(-6)}（${count} 条）` }));

    if (missingPhone.length) issues.push(toIssue("missingPhone", "以下联系人未填电话，按名册电话列筛选可批量补录", missingPhone));
    if (missingBirthday.length) issues.push(toIssue("missingBirthday", "以下联系人未填生日，补录后生日提醒与农历投影才会生效", missingBirthday));
    if (missingContact.length) issues.push(toIssue("missingContact", "以下联系人电话、邮箱、微信全部为空，无法主动联系", missingContact));
    if (noGroupNoTags.length) issues.push(toIssue("noGroupNoTags", "以下联系人既无分组也无标签，列表与筛选中难以归类", noGroupNoTags));
    if (suspicious.length) issues.push(toIssue("suspiciousBirthday", "以下联系人生日早于 1900 年、晚于明年或不符合 YYYY-MM-DD 格式，疑似录入错误", suspicious));
    if (dangling.length) issues.push(toIssue("danglingRelation", "以下联系人的「相关人」指向的名册行已不存在（对方可能被解绑），可在联系人页安全解绑", dangling));
    if (unreachableFollowUps.length) issues.push(toIssue("unreachableFollowUp", "以下跟进计划的人物文档已不在名册（可能被解绑），仍可完成/跳过或重建人物", unreachableFollowUps));
    if (orphanInteractions.length) issues.push(toIssue("orphanInteraction", "以下互动记录指向的人物文档不在名册中，导出与回顾仍会包含，重绑或收编后自动归位", orphanInteractions));
    /* C04 余项并入：疑似重复（复用 F13 判定，服务层传入）与长期无互动 */
    if (duplicatePairs && duplicatePairs.length > 0) {
        const entries = duplicatePairs.map((pair) => ({
            id: pair.a.itemId,
            label: `${pair.a.name} ≈ ${pair.b.name}`,
        }));
        issues.push(toIssue("duplicateSuspect", "以下联系人疑似同一人（同名/同联系方式，F13 判定），请人工核对；本体检不会自动合并", entries));
    }
    const longInactive = findLongInactive(people, lastInteractionAt ?? {}, graceDays, new Date());
    if (longInactive.length) {
        issues.push(toIssue("longInactive", `以下联系人有互动记录、但最近一次互动已超过 ${graceDays} 天（可在设置调整阈值视角）`, longInactive));
    }
    return issues;
}

/* ---------- B13.9 组织体检（第一批只读；零写入，修复由组织管理既有入口承担） ---------- */

export interface OrgAuditInput {
    memberships: readonly OrgMembership[];
    /** 名册 docId 集合（含本人——本人可加入组织） */
    rosterDocIds: ReadonlySet<string>;
    /** 可达组织 docId 集合（标记区块扫描结果，含归档） */
    reachableOrgDocIds: ReadonlySet<string>;
    /** 组织 docId → 名称（不可达时用 docId 片段降级展示） */
    orgNames: ReadonlyMap<string, string>;
    /** 人物 docId → 姓名（孤儿成员降级展示 docId 片段） */
    personNames: ReadonlyMap<string, string>;
    /** 组织 docId → 标记块数量（>1 = 冲突标记，H-22；缺省不检查） */
    markerCounts?: ReadonlyMap<string, number>;
}

/**
 * 组织维度体检（纯函数）：孤儿成员、组织文档不可达、期间倒挂、同人同组织重复在职、
 * 冲突标记块。逐项给既有修复入口指引（组织管理弹窗编辑/移除）；不自动改写任何数据。
 */
export function runOrgHealthAudit(input: OrgAuditInput): AuditIssue[] {
    const { memberships, rosterDocIds, reachableOrgDocIds, orgNames, personNames } = input;
    const issues: AuditIssue[] = [];
    const orgLabel = (docId: string) => orgNames.get(docId) ?? `组织文档 ${docId.slice(-6)}`;
    const personLabel = (docId: string) => personNames.get(docId) ?? `人物 ${docId.slice(-6)}`;
    const memberLabel = (membership: OrgMembership) =>
        `${personLabel(membership.personDocId)} @ ${orgLabel(membership.orgDocId)}`;

    const orphans = memberships
        .filter((membership) => !rosterDocIds.has(membership.personDocId))
        .map((membership) => ({ id: membership.id, label: memberLabel(membership) }));
    if (orphans.length) {
        issues.push(toIssue("orphanOrgMember", "以下成员记录的人物文档已不在名册（可能被解绑）；可在组织管理中移除该记录，重建人物后重新添加", orphans));
    }

    const unreachableCounts = new Map<string, number>();
    for (const membership of memberships) {
        if (reachableOrgDocIds.has(membership.orgDocId)) continue;
        unreachableCounts.set(membership.orgDocId, (unreachableCounts.get(membership.orgDocId) ?? 0) + 1);
    }
    if (unreachableCounts.size > 0) {
        issues.push(toIssue("unreachableOrg", "以下组织文档不可达（被删除或标记区块丢失）；成员记录保留可核对，重建同名组织文档并恢复标记后自动归位",
            [...unreachableCounts].map(([docId, count]) => ({ id: docId, label: `${orgLabel(docId)}（${count} 条成员记录）` }))));
    }

    const inverted = memberships
        .filter((membership) => membership.joinedOn !== "" && membership.leftOn !== "" && membership.joinedOn > membership.leftOn)
        .map((membership) => ({ id: membership.id, label: `${memberLabel(membership)}（${membership.joinedOn} ~ ${membership.leftOn}）` }));
    if (inverted.length) {
        issues.push(toIssue("invertedMembershipPeriod", "以下成员记录的期间倒挂（加入晚于离开），可在组织管理中编辑修正", inverted));
    }

    const activeCounts = new Map<string, { count: number; sample: OrgMembership }>();
    for (const membership of memberships) {
        if (membership.status !== "active") continue;
        const key = `${membership.personDocId}|${membership.orgDocId}`;
        const entry = activeCounts.get(key);
        if (entry) entry.count += 1;
        else activeCounts.set(key, { count: 1, sample: membership });
    }
    const duplicates = [...activeCounts.values()]
        .filter((entry) => entry.count > 1)
        .map((entry) => ({
            id: entry.sample.id,
            label: `${memberLabel(entry.sample)}（${entry.count} 条在职记录）`,
        }));
    if (duplicates.length) {
        issues.push(toIssue("duplicateActiveMembership", "以下同人同组织存在多条在职记录（可能重复添加），可在组织管理中保留一条、其余改为已离开或移除", duplicates));
    }

    const conflicts = [...(input.markerCounts ?? [])]
        .filter(([, count]) => count > 1)
        .map(([docId, count]) => ({ id: docId, label: `${orgLabel(docId)}（${count} 个标记块）` }));
    if (conflicts.length) {
        issues.push(toIssue("conflictingOrgMarkers", "以下组织文档存在多个组织标记块，归档状态投影已不可靠；请只保留一个标记块（多余的手工删除）", conflicts));
    }

    return issues;
}
