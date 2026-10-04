import type { Plugin } from "siyuan";
import type { ContactsSettings } from "../domain/model";
import type { OrgMembership, OrgMembershipPatch } from "../domain/org-membership";
import { addOrgMembership, loadOrgMembershipStore, removeOrgMembership, replaceOrgMembership, updateOrgMembership } from "../data/org-membership";
import type { AddMembershipInput, ReplaceMembershipInput } from "../data/org-membership";
import { previewOrganizationProjections, repairOrganizationProjection } from "./org-projections";
import type { OrgProjectionRepairResult } from "./org-projections";
import { scanOrganizations } from "./org";
import { getRoster, invalidateRoster } from "./roster";

export interface OrgMembershipWriteReport {
    membership: OrgMembership;
    fact: "verified";
    projections: OrgProjectionRepairResult[];
}

async function requireActiveTargets(settings: ContactsSettings, orgDocId: string, personDocId: string): Promise<void> {
    invalidateRoster();
    const [organizations, people] = await Promise.all([scanOrganizations(), getRoster(settings)]);
    const organization = organizations.find((entry) => entry.docId === orgDocId);
    if (!organization || organization.archived) throw new Error("目标组织不可达或已归档，未登记当前成员");
    if (people.filter((person) => person.docId === personDocId).length !== 1 || organizations.some((entry) => entry.docId === personDocId)) {
        throw new Error("人物未唯一绑定当前名册，或目标是组织文档；未按名称猜测成员身份");
    }
}

async function membershipById(plugin: Plugin, id: string): Promise<OrgMembership> {
    const membership = (await loadOrgMembershipStore(plugin)).memberships.find((entry) => entry.id === id);
    if (!membership) throw new Error(`成员记录 ${id} 不存在，请先重新读取`);
    return membership;
}

async function projectVerifiedMembership(
    plugin: Plugin, settings: ContactsSettings, membership: OrgMembership, additionalDocIds: readonly string[] = [],
): Promise<OrgMembershipWriteReport> {
    const docIds = [...new Set([membership.orgDocId, membership.personDocId, ...additionalDocIds])];
    const projections: OrgProjectionRepairResult[] = [];
    try {
        const preview = await previewOrganizationProjections(plugin, settings, docIds);
        for (const target of preview.targets) {
            if (target.state === "unknown") projections.push({ docId: target.docId, retryKey: target.retryKey, status: "unknown", message: target.message });
            else {
                try { projections.push(await repairOrganizationProjection(plugin, settings, preview, target.retryKey)); }
                catch (error) { projections.push({ docId: target.docId, retryKey: target.retryKey, status: "unknown", message: error instanceof Error ? error.message : String(error) }); }
            }
        }
    } catch (error) {
        for (const docId of docIds) projections.push({ docId, retryKey: `org-projection:${docId === membership.orgDocId ? "organization" : "person"}:${docId}`,
            status: "unknown", message: error instanceof Error ? error.message : String(error) });
    }
    return { membership, fact: "verified", projections };
}

export async function saveOrganizationMember(plugin: Plugin, settings: ContactsSettings, input: AddMembershipInput): Promise<OrgMembershipWriteReport> {
    await requireActiveTargets(settings, input.orgDocId, input.personDocId);
    const membership = await addOrgMembership(plugin, input);
    return projectVerifiedMembership(plugin, settings, membership);
}

export async function editOrganizationMember(plugin: Plugin, settings: ContactsSettings, id: string, patch: OrgMembershipPatch, expected?: OrgMembership): Promise<OrgMembershipWriteReport> {
    const current = await membershipById(plugin, id);
    if ((patch.status ?? current.status) === "active") await requireActiveTargets(settings, current.orgDocId, current.personDocId);
    const membership = await updateOrgMembership(plugin, id, patch, expected ?? current);
    return projectVerifiedMembership(plugin, settings, membership);
}

export async function deleteOrganizationMember(plugin: Plugin, settings: ContactsSettings, id: string, expected?: OrgMembership): Promise<OrgMembershipWriteReport> {
    const membership = await removeOrgMembership(plugin, id, expected ?? await membershipById(plugin, id));
    return projectVerifiedMembership(plugin, settings, membership);
}

export async function replaceOrganizationMemberWithProjection(plugin: Plugin, settings: ContactsSettings, input: ReplaceMembershipInput, expected?: OrgMembership): Promise<OrgMembershipWriteReport> {
    const former = await membershipById(plugin, input.formerId);
    await requireActiveTargets(settings, former.orgDocId, input.personDocId);
    const membership = await replaceOrgMembership(plugin, input, expected ?? former);
    return projectVerifiedMembership(plugin, settings, membership, [former.personDocId]);
}
