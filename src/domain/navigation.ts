import type { ContactSummary } from "./person.ts";

export type NavigationView = "home" | "people" | "graph" | "orgs" | "settings";
export type PersonReturnContext =
    | { kind: "view"; view: NavigationView }
    | { kind: "organization"; view: NavigationView; orgDocId: string }
    | { kind: "document"; view: NavigationView; docId: string };

export function isNavigationDocId(value: unknown): value is string {
    return typeof value === "string" && /^\d{14}-[0-9a-z]{7}$/.test(value);
}

export function personReturnContext(view: NavigationView, source?: { orgDocId?: string; docId?: string }): PersonReturnContext {
    if (!["home", "people", "graph", "orgs", "settings"].includes(view)) throw new Error("返回来源视图未知");
    if (source?.orgDocId !== undefined) {
        if (!isNavigationDocId(source.orgDocId)) throw new Error("返回组织 ID 非法");
        return { kind: "organization", view, orgDocId: source.orgDocId };
    }
    if (source?.docId !== undefined) {
        if (!isNavigationDocId(source.docId)) throw new Error("返回文档 ID 非法");
        return { kind: "document", view, docId: source.docId };
    }
    return { kind: "view", view };
}

export function resolveNavigationPerson(people: readonly ContactSummary[], docId: string): ContactSummary {
    if (!isNavigationDocId(docId)) throw new Error("人物导航 ID 非法");
    const matches = people.filter((person) => person.docId === docId);
    if (matches.length !== 1 || !isNavigationDocId(matches[0].itemId)) throw new Error("原人物尚未唯一核实，未按同名跳转");
    return matches[0];
}

export interface VersionedDataChange {
    revision: number;
    version?: 1;
    sourceId?: string;
    preferencesRevision?: number;
    preferencesError?: string;
    topics?: Array<"organizations" | "memberships" | "people" | "all">;
    docIds?: string[];
}

export function normalizeDataChange(raw: unknown): VersionedDataChange | null {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const change = raw as VersionedDataChange;
    if (change.version !== undefined && change.version !== 1 || !Number.isSafeInteger(change.revision) || change.revision < 1
        || change.sourceId !== undefined && (typeof change.sourceId !== "string" || !/^[a-zA-Z0-9._-]{1,80}$/.test(change.sourceId))
        || change.preferencesRevision !== undefined && (!Number.isSafeInteger(change.preferencesRevision) || change.preferencesRevision < 0)
        || change.preferencesError !== undefined && typeof change.preferencesError !== "string"
        || change.topics !== undefined && (!Array.isArray(change.topics) || change.topics.some((topic) => !["organizations", "memberships", "people", "all"].includes(topic)))
        || change.docIds !== undefined && (!Array.isArray(change.docIds) || change.docIds.some((docId) => !isNavigationDocId(docId)))) return null;
    return { ...change, ...(change.docIds ? { docIds: [...new Set(change.docIds)] } : {}), ...(change.topics ? { topics: [...new Set(change.topics)] } : {}) };
}

export function acceptDataChange(seen: Map<string, number>, change: VersionedDataChange): boolean {
    const source = change.sourceId ?? "legacy";
    if (change.revision <= (seen.get(source) ?? 0)) return false;
    seen.set(source, change.revision);
    return true;
}

export function mergeDataChanges(previous: VersionedDataChange | undefined, next: VersionedDataChange): VersionedDataChange {
    if (!previous) return next;
    return { ...previous, ...next,
        preferencesRevision: Math.max(previous.preferencesRevision ?? 0, next.preferencesRevision ?? 0) || undefined,
        topics: [...new Set([...(previous.topics ?? ["all"]), ...(next.topics ?? ["all"])])],
        docIds: [...new Set([...(previous.docIds ?? []), ...(next.docIds ?? [])])] };
}
