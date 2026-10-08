import { escapeMarkdown, validateDocumentTitle } from "./format.ts";
import { StoreIntegrityError } from "./store-integrity.ts";

export const ORGANIZATION_DRAFT_ATTR = "custom-lvct-org-draft";
export const ORGANIZATION_ATTR = "custom-lvct-org";
export type OrganizationStepState = "unissued" | "pending" | "rejected" | "verified";

interface OrganizationOperationBase {
    requestId: string;
    notebookId: string;
    name: string;
    docId: string;
    createdAt: number;
    updatedAt: number;
}

export interface OrganizationCreateOperation extends OrganizationOperationBase {
    kind: "create";
    createState: OrganizationStepState;
}

export interface OrganizationRenameOperation extends OrganizationOperationBase {
    kind: "rename";
    originalName: string;
    path: string;
    markerId: string;
    originalMarkerMarkdown: string;
    markerIal: string;
    markerValue: "1" | "archived";
    targetMarkerMarkdown: string;
    titleState: OrganizationStepState;
    markerState: OrganizationStepState;
}

export type OrganizationOperation = OrganizationCreateOperation | OrganizationRenameOperation;
export interface OrganizationOperationStore {
    schemaVersion: 1;
    operations: OrganizationOperation[];
}

export interface OrganizationFact {
    docId: string;
    notebookId: string;
    name: string;
    path: string;
    marker: { id: string; markdown: string; ial: string; value: "1" | "archived" };
}

export interface OrganizationOperationReport {
    operation: OrganizationOperation;
    status: "complete" | "ready" | "failed" | "unknown" | "conflict";
    canResume: boolean;
    message: string;
    docId: string;
}

const NODE_ID = /^\d{14}-[0-9a-z]{7}$/;
const STATES = ["unissued", "pending", "rejected", "verified"];

export function organizationMarkerMarkdown(name: string): string {
    return `**组织**：${escapeMarkdown(name)}`;
}

export function organizationIalAttributes(ial: string): Record<string, string> {
    if (!/^\{:\s[\s\S]*\}$/.test(ial)) throw new Error("组织标记属性形状未核实");
    const attributes: Record<string, string> = Object.create(null);
    const body = ial.slice(2, -1);
    const remaining = body.replace(/([a-zA-Z0-9_-]+)="([^"\r\n]*)"/g, (_match, key: string, value: string) => {
        if (Object.hasOwn(attributes, key)) throw new Error("组织标记属性重复");
        attributes[key] = value;
        return "";
    });
    if (remaining.trim()) throw new Error("组织标记属性含未核实内容");
    return attributes;
}

export function sameOrganizationIal(left: string, right: string): boolean {
    const fingerprint = (ial: string) => JSON.stringify(Object.entries(organizationIalAttributes(ial))
        .filter(([key]) => key !== "updated").sort(([first], [second]) => first.localeCompare(second)));
    return fingerprint(left) === fingerprint(right);
}

export function organizationOperationComplete(operation: OrganizationOperation): boolean {
    return operation.kind === "create" ? operation.createState === "verified"
        : operation.titleState === "verified" && operation.markerState === "verified";
}

export function parseOrganizationOperationStore(raw: unknown): OrganizationOperationStore {
    if (raw === null || raw === undefined || raw === "") return { schemaVersion: 1, operations: [] };
    const fail = () => { throw new StoreIntegrityError("组织操作断点", "版本、身份、快照或步骤状态无效"); };
    if (typeof raw !== "object" || Array.isArray(raw)) return fail();
    const container = raw as Partial<OrganizationOperationStore>;
    if (container.schemaVersion !== 1 || !Array.isArray(container.operations)) return fail();
    const seen = new Set<string>();
    const operations = container.operations.map((entry) => {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) return fail();
        if (!NODE_ID.test(entry.requestId) || seen.has(entry.requestId) || !NODE_ID.test(entry.notebookId)
            || typeof entry.name !== "string" || validateDocumentTitle(entry.name) || entry.name !== entry.name.trim()
            || typeof entry.docId !== "string" || entry.docId !== "" && !NODE_ID.test(entry.docId)
            || !Number.isSafeInteger(entry.createdAt) || entry.createdAt < 0
            || !Number.isSafeInteger(entry.updatedAt) || entry.updatedAt < entry.createdAt) return fail();
        seen.add(entry.requestId);
        if (entry.kind === "create") {
            if (!STATES.includes(entry.createState) || entry.createState === "verified" && !entry.docId
                || (entry.createState === "unissued" || entry.createState === "rejected") && entry.docId) return fail();
            return { kind: entry.kind, requestId: entry.requestId, notebookId: entry.notebookId, name: entry.name,
                docId: entry.docId, createdAt: entry.createdAt, updatedAt: entry.updatedAt, createState: entry.createState };
        }
        if (entry.kind !== "rename" || !NODE_ID.test(entry.docId) || typeof entry.originalName !== "string"
            || validateDocumentTitle(entry.originalName) || entry.name === entry.originalName
            || typeof entry.path !== "string" || !/^\/(?:\d{14}-[0-9a-z]{7}\/)*\d{14}-[0-9a-z]{7}\.sy$/.test(entry.path)
            || !entry.path.endsWith(`/${entry.docId}.sy`) || !NODE_ID.test(entry.markerId) || entry.markerId === entry.docId
            || entry.originalMarkerMarkdown !== organizationMarkerMarkdown(entry.originalName)
            || entry.targetMarkerMarkdown !== organizationMarkerMarkdown(entry.name)
            || typeof entry.markerIal !== "string" || !STATES.includes(entry.titleState) || !STATES.includes(entry.markerState)
            || entry.markerState !== "unissued" && entry.titleState !== "verified") return fail();
        let attributes: Record<string, string>;
        try { attributes = organizationIalAttributes(entry.markerIal); } catch { return fail(); }
        if (entry.markerValue !== "1" && entry.markerValue !== "archived"
            || attributes[ORGANIZATION_ATTR] !== entry.markerValue
            || attributes.id !== undefined && attributes.id !== entry.markerId) return fail();
        return { kind: entry.kind, requestId: entry.requestId, notebookId: entry.notebookId, name: entry.name,
            docId: entry.docId, createdAt: entry.createdAt, updatedAt: entry.updatedAt,
            originalName: entry.originalName, path: entry.path, markerId: entry.markerId,
            originalMarkerMarkdown: entry.originalMarkerMarkdown, markerIal: entry.markerIal, markerValue: entry.markerValue,
            targetMarkerMarkdown: entry.targetMarkerMarkdown, titleState: entry.titleState, markerState: entry.markerState };
    });
    return { schemaVersion: 1, operations };
}

export function organizationRenameConflict(operation: OrganizationRenameOperation, fact: OrganizationFact): string | null {
    if (fact.docId !== operation.docId || fact.notebookId !== operation.notebookId || fact.path !== operation.path
        || fact.marker.id !== operation.markerId || fact.marker.value !== operation.markerValue
        || !sameOrganizationIal(fact.marker.ial, operation.markerIal)) return "组织身份、路径、标记或归档状态已变化，未覆盖";
    const titleMatches = fact.name === operation.name;
    const markerMatches = fact.marker.markdown === operation.targetMarkerMarkdown;
    if (operation.titleState === "verified" ? !titleMatches
        : !titleMatches && fact.name !== operation.originalName) return "组织标题已变化，未覆盖";
    if (operation.markerState === "verified" ? !markerMatches
        : !markerMatches && fact.marker.markdown !== operation.originalMarkerMarkdown) return "组织标记正文已变化，未覆盖";
    if (titleMatches && operation.titleState === "unissued" || markerMatches && operation.markerState === "unissued") {
        return "尚未发送的步骤已被其他操作改动，请人工核对，未覆盖";
    }
    return null;
}
