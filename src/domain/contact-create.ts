import type { OrgAffiliationKind } from "./org-membership.ts";

/** 创建联系人后可选保存的扩展资料。基础姓名字段仍由 ContactDraft 管理。 */
export interface ContactExtendedDraft {
    orgDocId: string;
    orgDepartment: string;
    orgTitle: string;
    orgJoinedOn: string;
    orgAffiliationKind: OrgAffiliationKind;
    aliases: string;
    relationshipLabels: string;
    note: string;
}
