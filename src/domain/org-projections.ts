import { escapeMarkdown } from "./format.ts";
import type { OrgMembership } from "./org-membership.ts";
import { orgMembershipStatusLabel, sortOrgMemberships } from "./org-membership.ts";
import type { OrganizationSummary } from "./organization-scan.ts";
import { parseStoreRecords, StoreIntegrityError } from "./store-integrity.ts";

export const ORGANIZATION_MEMBERS_ATTR = "custom-lvct-members";
export const PERSON_ORGANIZATIONS_ATTR = "custom-lvct-orgs";

export interface OrgProjectionOperation {
    id: string;
    docId: string;
    attrName: typeof ORGANIZATION_MEMBERS_ATTR | typeof PERSON_ORGANIZATIONS_ATTR;
    markdown: string;
    state: "pending" | "rejected" | "verified";
    updatedAt: number;
}

export interface OrgProjectionOperationStore {
    schemaVersion: 1;
    operations: OrgProjectionOperation[];
}

export function parseOrgProjectionOperationStore(raw: unknown): OrgProjectionOperationStore {
    const operations = parseStoreRecords<OrgProjectionOperation>(raw, "组织投影断点", "operations", (entry) => {
        if (entry === null || typeof entry !== "object" || Array.isArray(entry)) return null;
        const record = entry as Partial<OrgProjectionOperation>;
        if (typeof record.id !== "string" || !/^\d{14}-[0-9a-z]{7}$/.test(record.id)
            || typeof record.docId !== "string" || !/^\d{14}-[0-9a-z]{7}$/.test(record.docId)
            || record.attrName !== ORGANIZATION_MEMBERS_ATTR && record.attrName !== PERSON_ORGANIZATIONS_ATTR
            || typeof record.markdown !== "string" || !["pending", "rejected", "verified"].includes(record.state ?? "")
            || !Number.isSafeInteger(record.updatedAt) || record.updatedAt! < 0) return null;
        return { id: record.id, docId: record.docId, attrName: record.attrName, markdown: record.markdown,
            state: record.state!, updatedAt: record.updatedAt! };
    });
    const keys = operations.map((operation) => `${operation.docId}/${operation.attrName}`);
    if (new Set(keys).size !== keys.length) throw new StoreIntegrityError("组织投影断点", "同一文档和属性的请求重复", operations.length);
    return { schemaVersion: 1, operations };
}

export interface OrgProjectionPerson {
    docId: string;
    name: string;
}

export interface OrgProjectionSource {
    organizations: readonly OrganizationSummary[];
    memberships: readonly OrgMembership[];
    people: readonly OrgProjectionPerson[];
}

export interface OrgProjectionTarget {
    docId: string;
    name: string;
    kind: "organization" | "person";
    attrName: typeof ORGANIZATION_MEMBERS_ATTR | typeof PERSON_ORGANIZATIONS_ATTR;
    markdown: string;
    retryKey: string;
    blockers: string[];
}

export function orgProjectionSourceSnapshot(source: OrgProjectionSource): string {
    return JSON.stringify({
        organizations: [...source.organizations].sort((left, right) => left.docId.localeCompare(right.docId))
            .map((org) => ({ docId: org.docId, name: org.name, archived: org.archived })),
        memberships: [...source.memberships].sort((left, right) => left.id.localeCompare(right.id)),
        people: [...source.people].sort((left, right) => left.docId.localeCompare(right.docId) || left.name.localeCompare(right.name)),
    });
}

function affiliationText(membership: OrgMembership): string {
    const classification = membership.affiliationKind === "family" ? "家庭" : membership.affiliationKind === "work" ? "工作" : membership.affiliationKind === "education" ? "学校" : "未分类";
    return [classification, orgMembershipStatusLabel(membership), membership.department, membership.title, `${membership.joinedOn || "?"} ~ ${membership.leftOn || "至今"}`]
        .filter(Boolean).map((value) => escapeMarkdown(value.replace(/[\r\n]+/g, " "))).join(" · ");
}

export function buildOrgProjectionTargets(source: OrgProjectionSource): OrgProjectionTarget[] {
    const organizations = new Map(source.organizations.map((org) => [org.docId, org]));
    const people = new Map<string, OrgProjectionPerson[]>();
    for (const person of source.people) people.set(person.docId, [...(people.get(person.docId) ?? []), person]);
    const targets: OrgProjectionTarget[] = [
        ...source.organizations.map((org): OrgProjectionTarget => ({
            docId: org.docId, name: org.name, kind: "organization", attrName: ORGANIZATION_MEMBERS_ATTR,
            markdown: "", retryKey: `org-projection:organization:${org.docId}`, blockers: [],
        })),
        ...[...people].map(([docId, candidates]): OrgProjectionTarget => ({
            docId, name: candidates[0].name, kind: "person", attrName: PERSON_ORGANIZATIONS_ATTR,
            markdown: "", retryKey: `org-projection:person:${docId}`,
            blockers: candidates.length === 1 ? [] : ["同一人物文档绑定多条名册行，未核实唯一人物"],
        })),
    ];
    const byKey = new Map(targets.map((target) => [target.retryKey, target]));
    for (const target of targets) {
        if (organizations.has(target.docId) && people.has(target.docId)) target.blockers.push("组织文档同时进入人物名册，未按名称或类型猜测修复");
    }
    const entries = new Map<string, string[]>();
    for (const membership of sortOrgMemberships(source.memberships)) {
        if (membership.status !== "active") continue;
        const organization = organizations.get(membership.orgDocId);
        if (organization?.archived) continue;
        const candidates = people.get(membership.personDocId) ?? [];
        const orgTarget = byKey.get(`org-projection:organization:${membership.orgDocId}`);
        const personTarget = byKey.get(`org-projection:person:${membership.personDocId}`);
        if (!organization || candidates.length !== 1) {
            const reason = !organization ? `组织 ${membership.orgDocId} 不可达或未登记` : `人物 ${membership.personDocId} 未唯一登记`;
            orgTarget?.blockers.push(reason);
            personTarget?.blockers.push(reason);
            if (!orgTarget) targets.push({ docId: membership.orgDocId, name: membership.orgDocId, kind: "organization", attrName: ORGANIZATION_MEMBERS_ATTR,
                markdown: "", retryKey: `org-projection:organization:${membership.orgDocId}`, blockers: [reason] });
            if (!personTarget) targets.push({ docId: membership.personDocId, name: membership.personDocId, kind: "person", attrName: PERSON_ORGANIZATIONS_ATTR,
                markdown: "", retryKey: `org-projection:person:${membership.personDocId}`, blockers: [reason] });
            continue;
        }
        const person = candidates[0];
        const metadata = affiliationText(membership);
        for (const [target, label, docId] of [[orgTarget!, person.name, person.docId], [personTarget!, organization.name, organization.docId]] as const) {
            const labelText = escapeMarkdown(label.replace(/[\r\n]+/g, " "));
            entries.set(target.retryKey, [...(entries.get(target.retryKey) ?? []), `[${labelText}](siyuan://blocks/${docId}) · ${metadata}`]);
        }
    }
    for (const target of targets) {
        const links = entries.get(target.retryKey) ?? [];
        target.markdown = links.length ? `**${target.kind === "organization" ? "当前成员" : "当前组织归属"}**：${links.join("；")}` : "";
        target.blockers = [...new Set(target.blockers)];
    }
    return [...new Map(targets.map((target) => [target.retryKey, target])).values()]
        .sort((left, right) => left.retryKey.localeCompare(right.retryKey));
}

export function stripProjectionIal(markdown: string): string {
    return markdown.replace(/\r\n/g, "\n").replace(/^\s*\{:[^\n]*\}\s*$/gm, "").trim();
}
