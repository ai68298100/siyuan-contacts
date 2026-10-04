import type { Plugin } from "siyuan";
import { renderView } from "../api/av";
import { rosterFromRender } from "../domain/roster";
import { scanOrganizations } from "./org";
import { loadJsonStrict } from "../data/storage";
import { INTERACTION_STORAGE_KEY } from "../data/interactions";
import { FOLLOW_UP_STORAGE_KEY } from "../data/followups";
import { ORG_MEMBERSHIP_STORAGE_KEY } from "../data/org-membership";
import { SELF_IDENTITY_STORAGE_KEY } from "../data/self-identity";
import {
    buildHealthAuditReport,
    decodeAuditFollowUps,
    decodeAuditInteractions,
    decodeAuditOrganizationMembers,
    decodeAuditSelfIdentity,
    HealthAuditJsonError,
    runFollowUpAudit,
    runInteractionAudit,
    runOrganizationMemberAudit,
    runRosterAudit,
    runSelfIdentityAudit,
} from "../domain/health-audit";
import type { AuditIssue, AuditModuleKey, AuditModuleResult, HealthAuditReport } from "../domain/health-audit";
import type { ContactsSettings } from "../domain/model";
import { findDuplicatePairs } from "../domain/duplicate-check";
import { validateFieldMap } from "../domain/fields";
import { withTimeout } from "../shared/async";

export const HEALTH_AUDIT_MODULES: readonly AuditModuleKey[] = ["roster", "interactions", "followUps", "organizationMembers", "selfIdentity"];
const MODULE_LABELS: Record<AuditModuleKey, string> = { roster: "名册", interactions: "互动", followUps: "跟进", organizationMembers: "组织成员", selfIdentity: "本人身份" };

export interface HealthAuditRunOptions {
    modules?: readonly AuditModuleKey[];
    previous?: HealthAuditReport;
    timeoutMs?: number;
}

function readFailure(module: AuditModuleKey, error: unknown): AuditModuleResult {
    const failure: AuditModuleResult = {
        module, state: "failed", readStatus: "read_failed", presence: "unverified", count: null, issues: [],
        message: error instanceof Error ? error.message : String(error),
    };
    const seen = new Set<unknown>();
    let cause = error;
    while (cause instanceof Error && !seen.has(cause)) {
        seen.add(cause);
        const kind = "kind" in cause ? cause.kind : undefined;
        if (kind === "timeout" || cause.name === "AsyncTimeoutError") {
            failure.state = "unknown";
            failure.readStatus = "timed_out";
            break;
        }
        if (kind === "aborted" || cause.name === "AbortError" || cause.name === "AsyncAbortError") {
            failure.state = "unknown";
            failure.readStatus = "unverified";
            break;
        }
        if (cause instanceof HealthAuditJsonError || cause instanceof SyntaxError) {
            failure.readStatus = "bad_json";
            break;
        }
        cause = "cause" in cause ? cause.cause : undefined;
    }
    return failure;
}

function verified(module: AuditModuleKey, count: number): AuditModuleResult {
    return { module, state: "success", readStatus: count ? "verified" : "not_found", presence: count ? "found" : "not_found", count, issues: [] };
}

function sourceSucceeded(module: AuditModuleResult): boolean {
    return module.readStatus === "verified" || module.readStatus === "not_found";
}

export async function auditWorkspaceDataReport(plugin: Plugin, settings: ContactsSettings, options: HealthAuditRunOptions = {}): Promise<HealthAuditReport> {
    const selected = [...new Set(options.modules ?? HEALTH_AUDIT_MODULES)];
    if (selected.some((module) => !HEALTH_AUDIT_MODULES.includes(module))) throw new Error("未知体检模块");
    const references: HealthAuditReport["references"] = { people: [], organizationDocIds: [], ...options.previous?.references };
    const modules = Object.fromEntries(HEALTH_AUDIT_MODULES.map((module) => {
        const old = options.previous?.modules[module];
        return [module, old ? { ...old, issues: [...old.issues] } : {
            module, state: "unknown", readStatus: "unverified", presence: "unverified", count: null, issues: [], message: "本模块尚未读取核实",
        }];
    })) as Record<AuditModuleKey, AuditModuleResult>;

    await Promise.all(selected.map(async (module) => {
        try {
            const data = await withTimeout(async () => {
                if (module === "roster") {
                    const rendered = await renderView(settings.avId, settings.dbBlockId);
                    const problems = validateFieldMap(settings.fieldMap, rendered.view.columns);
                    if (problems.length) throw new Error(`名册字段来源无法核实：${problems.map((problem) => problem.message).join("；")}`);
                    const people = rosterFromRender(rendered, settings.fieldMap);
                    return { count: people.length, references: { people } };
                }
                if (module === "interactions") {
                    const interactions = decodeAuditInteractions(await loadJsonStrict(plugin, INTERACTION_STORAGE_KEY));
                    return { count: interactions.events.length, references: { interactions } };
                }
                if (module === "followUps") {
                    const followUps = decodeAuditFollowUps(await loadJsonStrict(plugin, FOLLOW_UP_STORAGE_KEY));
                    return { count: followUps.items.length, references: { followUps } };
                }
                if (module === "organizationMembers") {
                    const organizationMembers = decodeAuditOrganizationMembers(await loadJsonStrict(plugin, ORG_MEMBERSHIP_STORAGE_KEY));
                    const organizations = await scanOrganizations();
                    return { count: organizationMembers.length, references: { organizationMembers, organizationDocIds: organizations.map((organization) => organization.docId) } };
                }
                const selfIdentity = decodeAuditSelfIdentity(await loadJsonStrict(plugin, SELF_IDENTITY_STORAGE_KEY));
                return { count: selfIdentity ? 1 : 0, references: { selfIdentity } };
            }, options.timeoutMs ?? 15_000, MODULE_LABELS[module]);
            Object.assign(references, data.references);
            modules[module] = verified(module, data.count);
        } catch (error) {
            modules[module] = { ...readFailure(module, error), issues: [...modules[module].issues], stale: modules[module].issues.length > 0 };
        }
    }));

    const rosterReady = sourceSucceeded(modules.roster);
    const identityReady = sourceSucceeded(modules.selfIdentity);
    const ordinaryPeople = references.people.filter((person) => person.docId !== references.selfIdentity?.selfDocId);
    for (const module of HEALTH_AUDIT_MODULES) {
        if (!sourceSucceeded(modules[module])) continue;
        const previousIssues = modules[module].issues.length ? modules[module].issues : options.previous?.modules[module].issues ?? [];
        const unknown = (message: string) => {
            modules[module] = { ...modules[module], state: "unknown", issues: previousIssues, stale: previousIssues.length > 0, message };
        };
        modules[module] = { ...modules[module], state: "success", issues: [], stale: false, message: undefined };
        if (module === "roster") {
            if (!identityReady) { unknown("本人身份未核实，普通联系人范围未知；不按无本人处理"); continue; }
            const pairs = findDuplicatePairs(ordinaryPeople).map((pair) => ({ a: pair.a, b: pair.b }));
            modules[module].issues = runRosterAudit(references.people, pairs, references.selfIdentity);
        } else if (module === "selfIdentity") {
            if (!references.selfIdentity) continue;
            if (!rosterReady) { unknown("本人身份已读取，但名册未核实绑定目标"); continue; }
            modules[module].issues = runSelfIdentityAudit({ people: references.people, identity: references.selfIdentity });
        } else if (module === "interactions") {
            if (!references.interactions?.events.length) continue;
            if (!rosterReady || !identityReady) { unknown("互动已读取，但名册或本人身份未核实，互动归属与提醒范围未知"); continue; }
            const counts: Record<string, number> = {};
            const latest: Record<string, number> = {};
            for (const event of references.interactions.events) {
                if (event.personDocId === references.selfIdentity?.selfDocId) continue;
                counts[event.personDocId] = (counts[event.personDocId] ?? 0) + 1;
                latest[event.personDocId] = Math.max(latest[event.personDocId] ?? 0, event.occurredAt);
            }
            modules[module].issues = runInteractionAudit({ people: ordinaryPeople, interactionCounts: counts, lastInteractionAt: latest });
        } else if (module === "followUps") {
            if (!references.followUps?.items.length) continue;
            if (!rosterReady || !identityReady) { unknown("跟进已读取，但名册或本人身份未核实，跟进目标范围未知"); continue; }
            modules[module].issues = runFollowUpAudit(ordinaryPeople, references.followUps.items.filter((item) => item.personDocId !== references.selfIdentity?.selfDocId));
        } else {
            if (!references.organizationMembers?.length) continue;
            if (!rosterReady) { unknown("组织成员已读取，但名册未核实，人物归属未知"); continue; }
            modules[module].issues = runOrganizationMemberAudit({ people: references.people, memberships: references.organizationMembers, organizationDocIds: references.organizationDocIds });
        }
    }
    return buildHealthAuditReport(modules, references);
}

export async function retryFailedHealthAuditModules(plugin: Plugin, settings: ContactsSettings, previous: HealthAuditReport): Promise<HealthAuditReport> {
    const failed = HEALTH_AUDIT_MODULES.filter((module) => previous.modules[module].state === "failed");
    return failed.length ? auditWorkspaceDataReport(plugin, settings, { modules: failed, previous }) : previous;
}

export class HealthAuditIncompleteError extends Error {
    readonly report: HealthAuditReport;

    constructor(report: HealthAuditReport) {
        const failures = Object.values(report.modules).filter((module) => module.state !== "success")
            .map((module) => `${MODULE_LABELS[module.module]}（${module.readStatus}）`).join("、");
        super(`资料体检未完成，受影响模块：${failures}`);
        this.name = "HealthAuditIncompleteError";
        this.report = report;
    }
}

export async function auditWorkspaceData(plugin: Plugin, settings: ContactsSettings): Promise<AuditIssue[]> {
    const report = await auditWorkspaceDataReport(plugin, settings);
    if (Object.values(report.modules).some((module) => module.state !== "success")) throw new HealthAuditIncompleteError(report);
    return report.issues;
}
