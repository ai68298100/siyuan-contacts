import type { OrgAffiliationKind, OrgMembershipStatus } from "./org-membership.ts";
import { isOrgAffiliationKind, isValidMembershipPeriod, isValidOrgMembershipNote, isValidOrgStatusLabel } from "./org-membership.ts";

export interface ContactOrgAffiliationDraft {
    orgDocId: string;
    orgDepartment: string;
    orgTitle: string;
    orgJoinedOn: string;
    orgLeftOn: string;
    orgStatus: OrgMembershipStatus;
    orgStatusLabel: string;
    orgAffiliationKind: OrgAffiliationKind;
    /** 仅针对这段组织经历的可选备注；旧调用点可省略。 */
    orgNote?: string;
}

/** 创建联系人后可选保存的扩展资料。基础姓名字段仍由 ContactDraft 管理。 */
export interface ContactExtendedDraft {
    orgMemberships: ContactOrgAffiliationDraft[];
    /** 兼容旧调用点；新增 UI 统一提交 orgMemberships。 */
    orgDocId: string;
    orgDepartment: string;
    orgTitle: string;
    orgJoinedOn: string;
    orgAffiliationKind: OrgAffiliationKind;
    aliases: string;
    relationshipLabels: string;
    note: string;
}

export function validateContactExtendedDraft(details: ContactExtendedDraft): string[] {
    const errors: string[] = [];
    const activeOrganizations = new Set<string>();
    const exact = new Set<string>();
    for (const [index, entry] of details.orgMemberships.entries()) {
        if (!entry.orgDocId) { errors.push(`第 ${index + 1} 条组织经历尚未选择组织`); continue; }
        if (!isOrgAffiliationKind(entry.orgAffiliationKind)) errors.push(`第 ${index + 1} 条组织经历的归属分类无效`);
        if (!isValidMembershipPeriod(entry.orgJoinedOn, entry.orgLeftOn, entry.orgStatus)) errors.push(`第 ${index + 1} 条组织经历的起止日期或状态不匹配`);
        if (!isValidOrgStatusLabel(entry.orgStatusLabel)) errors.push(`第 ${index + 1} 条组织经历的自定义状态限 40 字且不能换行`);
        if (entry.orgNote !== undefined && !isValidOrgMembershipNote(entry.orgNote)) errors.push(`第 ${index + 1} 条组织经历的成员备注限 240 字且不能换行`);
        if (entry.orgStatus === "active" && activeOrganizations.has(entry.orgDocId)) errors.push(`组织 ${entry.orgDocId} 有重复的当前归属`);
        if (entry.orgStatus === "active") activeOrganizations.add(entry.orgDocId);
        const key = JSON.stringify([entry.orgDocId, entry.orgAffiliationKind, entry.orgStatus, entry.orgStatusLabel.trim(), entry.orgJoinedOn, entry.orgLeftOn, entry.orgDepartment.trim(), entry.orgTitle.trim(), entry.orgNote?.trim() ?? ""]);
        if (exact.has(key)) errors.push(`第 ${index + 1} 条组织经历与另一条完全重复`);
        exact.add(key);
    }
    return errors;
}
