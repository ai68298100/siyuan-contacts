import type { ExchangeStore } from "./exchanges.ts";
import { normalizeAliasKey } from "./person-aliases.ts";
import type { PersonAliasStore } from "./person-aliases.ts";
import type { OrgMembership, OrgMembershipStore } from "./org-membership.ts";

export interface MigrationRecordIssue {
    id: string;
    personDocId: string;
    orgDocId?: string;
    selfDocId?: string;
    reason: "conflict" | "unreachable";
    message: string;
}

export interface MigrationRecordSummary {
    merged: number;
    skipped: number;
    removed: number;
    issues: MigrationRecordIssue[];
}

export class MigrationWriteUnknownError extends Error {
    constructor(cause: unknown) {
        super("保存结果尚未核实，可能已写入；请保留迁移包，核实并重试未完成模块", { cause });
        this.name = "MigrationWriteUnknownError";
    }
}

export function mergeOrgMembershipBackup(
    current: OrgMembershipStore, incoming: OrgMembershipStore, reachablePeople: ReadonlySet<string>, reachableOrganizations: ReadonlySet<string>,
): { store: OrgMembershipStore; summary: MigrationRecordSummary } {
    const tombstones = [...new Set([...(current.tombstones ?? []), ...(incoming.tombstones ?? [])])];
    const deleted = new Set(tombstones);
    const memberships = current.memberships.filter((membership) => !deleted.has(membership.id));
    const byId = new Map(memberships.map((membership) => [membership.id, membership]));
    const active = new Set(memberships.filter((membership) => membership.status === "active")
        .map((membership) => `${membership.orgDocId}/${membership.personDocId}`));
    const summary: MigrationRecordSummary = { merged: 0, skipped: 0, removed: current.memberships.length - memberships.length, issues: [] };
    const contentKey = (membership: OrgMembership) => JSON.stringify({ ...membership, affiliationKind: membership.affiliationKind ?? "unspecified" });
    for (const membership of incoming.memberships) {
        if (deleted.has(membership.id)) { summary.skipped += 1; continue; }
        const existing = byId.get(membership.id);
        const activeKey = `${membership.orgDocId}/${membership.personDocId}`;
        const reason = existing ? contentKey(existing) === contentKey(membership) ? null : "conflict"
            : !reachablePeople.has(membership.personDocId) || !reachableOrganizations.has(membership.orgDocId) ? "unreachable"
            : membership.status === "active" && active.has(activeKey) ? "conflict" : null;
        if (existing || reason) {
            summary.skipped += 1;
            if (reason) summary.issues.push({ id: membership.id, personDocId: membership.personDocId, orgDocId: membership.orgDocId, reason,
                message: reason === "conflict" ? "成员内容或当前期间与现状冲突，已保留当前事实" : "人物未唯一登记或组织原标记不可达，请先恢复思源原文档并核对稳定 ID" });
            continue;
        }
        memberships.push(membership);
        byId.set(membership.id, membership);
        if (membership.status === "active") active.add(activeKey);
        summary.merged += 1;
    }
    return { store: { schemaVersion: 1, memberships, ...(tombstones.length ? { tombstones } : {}) }, summary };
}

function issue(record: { id: string; personDocId: string }, reason: MigrationRecordIssue["reason"]): MigrationRecordIssue {
    return {
        id: record.id,
        personDocId: record.personDocId,
        reason,
        message: reason === "unreachable" ? "人物文档不在当前名册；请恢复原文档并重绑后核实" : "与当前记录或别名归属冲突，已保留当前事实",
    };
}

export function mergeExchangeBackup(current: ExchangeStore, incoming: ExchangeStore, reachable: ReadonlySet<string>): {
    store: ExchangeStore; summary: MigrationRecordSummary;
} {
    const records = [...current.records];
    const byId = new Map(records.map((record) => [record.id, record]));
    const summary: MigrationRecordSummary = { merged: 0, skipped: 0, removed: 0, issues: [] };
    for (const record of incoming.records) {
        const existing = byId.get(record.id);
        if (existing) {
            summary.skipped += 1;
            if (JSON.stringify(existing) !== JSON.stringify(record)) summary.issues.push(issue(record, "conflict"));
        } else if (!reachable.has(record.personDocId)) {
            summary.skipped += 1;
            summary.issues.push(issue(record, "unreachable"));
        } else {
            records.push(record);
            byId.set(record.id, record);
            summary.merged += 1;
        }
    }
    return { store: { schemaVersion: 1, records }, summary };
}

export function mergeAliasBackup(current: PersonAliasStore, incoming: PersonAliasStore, reachable: ReadonlySet<string>): {
    store: PersonAliasStore; summary: MigrationRecordSummary;
} {
    const tombstones = [...new Set([...(current.tombstones ?? []), ...(incoming.tombstones ?? [])])];
    const deleted = new Set(tombstones);
    const aliases = current.aliases.filter((alias) => !deleted.has(alias.id));
    const byId = new Map(aliases.map((alias) => [alias.id, alias]));
    const owners = new Map<string, Set<string>>();
    for (const alias of aliases) {
        const key = normalizeAliasKey(alias.alias);
        const people = owners.get(key) ?? new Set<string>();
        people.add(alias.personDocId);
        owners.set(key, people);
    }
    const summary: MigrationRecordSummary = { merged: 0, skipped: 0, removed: current.aliases.length - aliases.length, issues: [] };
    for (const alias of incoming.aliases) {
        if (deleted.has(alias.id)) {
            summary.skipped += 1;
            continue;
        }
        const existing = byId.get(alias.id);
        const key = normalizeAliasKey(alias.alias);
        const people = owners.get(key);
        if (existing) {
            summary.skipped += 1;
            if (JSON.stringify(existing) !== JSON.stringify(alias)) summary.issues.push(issue(alias, "conflict"));
        } else if (people && (people.size !== 1 || !people.has(alias.personDocId))) {
            summary.skipped += 1;
            summary.issues.push(issue(alias, "conflict"));
        } else if (!reachable.has(alias.personDocId)) {
            summary.skipped += 1;
            summary.issues.push(issue(alias, "unreachable"));
        } else if (people) {
            summary.skipped += 1;
        } else {
            aliases.push(alias);
            byId.set(alias.id, alias);
            owners.set(key, new Set([alias.personDocId]));
            summary.merged += 1;
        }
    }
    return { store: { schemaVersion: 1, aliases, ...(tombstones.length > 0 ? { tombstones } : {}) }, summary };
}
