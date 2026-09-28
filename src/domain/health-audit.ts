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
    | "longInactive";

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
