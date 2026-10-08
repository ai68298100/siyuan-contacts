import type { Plugin } from "siyuan";
import type { ContactsSettings } from "../domain/model";
import { createDocWithMd, KernelPermissionError, KernelResponseError, newNodeId } from "../api/client";
import { findOrganizationRequest, OrganizationWriteNotSentError, readOrganizationFact, renameOrganizationTitle, updateOrganizationMarker } from "../api/blocks";
import { loadOrganizationOperations, saveOrganizationOperation } from "../data/organization-operations.ts";
import { withStoreLock } from "../data/storage.ts";
import { documentHPath, markdownHeading, validateDocumentTitle } from "../domain/format.ts";
import { ORGANIZATION_DRAFT_ATTR, organizationIalAttributes, organizationMarkerMarkdown, organizationOperationComplete, organizationRenameConflict } from "../domain/organization-operations.ts";
import type { OrganizationCreateOperation, OrganizationOperation, OrganizationOperationReport, OrganizationRenameOperation } from "../domain/organization-operations.ts";
import { scanOrganizations } from "./org";

function report(operation: OrganizationOperation, status: OrganizationOperationReport["status"], message: string): OrganizationOperationReport {
    const states = operation.kind === "create" ? [operation.createState] : [operation.titleState, operation.markerState];
    return { operation, docId: operation.docId, status, message,
        canResume: (status === "ready" || status === "failed") && !states.includes("pending") };
}

async function persist(plugin: Plugin, operation: OrganizationOperation): Promise<void> {
    operation.updatedAt = Math.max(Date.now(), operation.updatedAt);
    await saveOrganizationOperation(plugin, operation);
}

async function inspect(plugin: Plugin, operation: OrganizationOperation): Promise<OrganizationOperationReport> {
    if (operation.kind === "create") {
        const marker = await findOrganizationRequest(operation.requestId);
        if (!marker) return report(operation, operation.createState === "pending" || operation.createState === "verified" ? "unknown"
            : operation.createState === "rejected" ? "failed" : "ready", "原创建请求尚未找到唯一标记；未知请求只核实，不重建");
        if (marker.notebookId !== operation.notebookId || operation.docId && marker.docId !== operation.docId) {
            return report(operation, "conflict", "原请求文档身份或笔记本变化，未按同名对应");
        }
        const fact = await readOrganizationFact(marker.docId);
        if (fact.marker.id !== marker.markerId || organizationIalAttributes(fact.marker.ial)[ORGANIZATION_DRAFT_ATTR] !== operation.requestId) {
            return report(operation, "conflict", "请求标记与组织唯一标记不一致");
        }
        if (operation.createState !== "verified" && (fact.name !== operation.name || fact.marker.value !== "1"
            || fact.marker.markdown !== organizationMarkerMarkdown(operation.name))) return report(operation, "conflict", "原请求组织标题、正文或归档状态变化，未覆盖");
        if (operation.createState === "unissued") return report(operation, "conflict", "未发创建请求已有相同请求标记，请人工核对");
        if (operation.createState !== "verified") {
            operation.docId = fact.docId;
            operation.createState = "verified";
            await persist(plugin, operation);
        }
        return report(operation, "complete", "原创建请求与唯一组织文档已核实");
    }
    const fact = await readOrganizationFact(operation.docId);
    const conflict = organizationRenameConflict(operation, fact);
    if (conflict) return report(operation, "conflict", conflict);
    let changed = false;
    if (fact.name === operation.name && operation.titleState !== "verified") { operation.titleState = "verified"; changed = true; }
    if (fact.marker.markdown === operation.targetMarkerMarkdown && operation.markerState !== "verified") { operation.markerState = "verified"; changed = true; }
    if (changed) await persist(plugin, operation);
    if (organizationOperationComplete(operation)) return report(operation, "complete", "组织标题与原唯一标记均已核实");
    if (operation.titleState === "pending" || operation.markerState === "pending") return report(operation, "unknown", "原步骤已发出或发送情况未知，仅只读核实；未自动重发");
    if (operation.titleState === "rejected" || operation.markerState === "rejected") return report(operation, "failed", "明确拒绝步骤尚未完成，可只补未发或被拒绝步骤");
    return report(operation, "ready", "剩余步骤尚未发送，可继续原操作");
}

async function inspectSafely(plugin: Plugin, operation: OrganizationOperation): Promise<OrganizationOperationReport> {
    try { return await inspect(plugin, operation); }
    catch (error) { return report(operation, "unknown", error instanceof Error ? error.message : String(error)); }
}

function explicitlyRejected(error: unknown): boolean {
    return error instanceof KernelPermissionError || error instanceof KernelResponseError || error instanceof OrganizationWriteNotSentError;
}

async function createStep(plugin: Plugin, operation: OrganizationCreateOperation): Promise<OrganizationOperationReport> {
    const checked = await inspectSafely(plugin, operation);
    if (!checked.canResume) return checked;
    const store = await loadOrganizationOperations(plugin);
    if (store.operations.some((entry) => entry.requestId !== operation.requestId && entry.name === operation.name
        && !organizationOperationComplete(entry))) return report(operation, "conflict", "已有同名未完成操作，请先核实原请求");
    if ((await scanOrganizations()).some((org) => org.name === operation.name)) return report(operation, "conflict", "已有同名组织（含归档），未误建或对应其身份");
    operation.createState = "pending";
    await persist(plugin, operation);
    try {
        const docId = await createDocWithMd(operation.notebookId, documentHPath(operation.name),
            `${markdownHeading(operation.name)}${organizationMarkerMarkdown(operation.name)}\n{: ${ORGANIZATION_DRAFT_ATTR}="${operation.requestId}" custom-lvct-org="1"}\n\n`);
        if (/^\d{14}-[0-9a-z]{7}$/.test(docId)) {
            operation.docId = docId;
            await persist(plugin, operation);
        }
    } catch (error) {
        if (explicitlyRejected(error)) { operation.createState = "rejected"; await persist(plugin, operation); }
    }
    return inspectSafely(plugin, operation);
}

async function renameSteps(plugin: Plugin, operation: OrganizationRenameOperation): Promise<OrganizationOperationReport> {
    let checked = await inspectSafely(plugin, operation);
    if (!checked.canResume) return checked;
    if ((await scanOrganizations()).some((org) => org.docId !== operation.docId && org.name === operation.name)) {
        return report(operation, "conflict", "目标名称已有组织（含归档），未覆盖");
    }
    for (const step of ["titleState", "markerState"] as const) {
        checked = await inspectSafely(plugin, operation);
        if (!checked.canResume) return checked;
        if (operation[step] === "verified") continue;
        if (step === "markerState" && operation.titleState !== "verified") return checked;
        const fact = await readOrganizationFact(operation.docId);
        const conflict = organizationRenameConflict(operation, fact);
        if (conflict) return report(operation, "conflict", conflict);
        operation[step] = "pending";
        await persist(plugin, operation);
        try {
            if (step === "titleState") await renameOrganizationTitle(fact, operation.name);
            else await updateOrganizationMarker(fact, operation.targetMarkerMarkdown);
        } catch (error) {
            if (explicitlyRejected(error)) { operation[step] = "rejected"; await persist(plugin, operation); }
        }
        checked = await inspectSafely(plugin, operation);
        if (checked.status === "unknown" || checked.status === "conflict" || checked.operation.kind !== "rename" || checked.operation[step] !== "verified") return checked;
    }
    return checked;
}

function validateName(name: string): string {
    const error = validateDocumentTitle(name);
    if (error) throw new Error(error);
    return name.trim();
}

async function withOperationLock<T>(operation: OrganizationOperation, action: () => Promise<T>): Promise<T> {
    return withStoreLock("organization-create", () => operation.kind === "rename"
        ? withStoreLock(`organization-state-${operation.docId}`, action) : action());
}

export async function startOrganizationCreate(plugin: Plugin, settings: ContactsSettings, name: string): Promise<OrganizationOperationReport> {
    const normalized = validateName(name);
    if (!/^\d{14}-[0-9a-z]{7}$/.test(settings.notebookId)) throw new Error("组织创建笔记本锚点非法");
    return withStoreLock("organization-create", async () => {
        const store = await loadOrganizationOperations(plugin);
        const existing = store.operations.filter((entry) => !organizationOperationComplete(entry) && entry.name === normalized);
        if (existing.length) return report(existing[0], "conflict", "同名旧操作尚未完成，请只读核实或继续原请求；未自动对应身份");
        if ((await scanOrganizations()).some((org) => org.name === normalized)) throw new Error(`组织「${normalized}」已存在`);
        const now = Date.now();
        const operation: OrganizationCreateOperation = { kind: "create", requestId: newNodeId(), notebookId: settings.notebookId,
            name: normalized, docId: "", createdAt: now, updatedAt: now, createState: "unissued" };
        await persist(plugin, operation);
        return createStep(plugin, operation);
    });
}

export async function startOrganizationRename(plugin: Plugin, docId: string, name: string): Promise<OrganizationOperationReport> {
    const normalized = validateName(name);
    if (!/^\d{14}-[0-9a-z]{7}$/.test(docId)) throw new Error("组织文档 ID 非法");
    return withStoreLock("organization-create", () => withStoreLock(`organization-state-${docId}`, async () => {
        const store = await loadOrganizationOperations(plugin);
        const existing = store.operations.find((entry) => entry.kind === "rename" && entry.docId === docId && !organizationOperationComplete(entry));
        if (existing) return report(existing, "conflict", "该组织已有未完成改名，请核实原请求，未改换输入或覆盖快照");
        const fact = await readOrganizationFact(docId);
        if (fact.name === normalized) throw new Error("组织已使用此名称，未发改名请求");
        if (fact.marker.markdown !== organizationMarkerMarkdown(fact.name)) throw new Error("组织标记已被修改，未覆盖其正文；请人工核对");
        if ((await scanOrganizations()).some((org) => org.docId !== docId && org.name === normalized)) throw new Error(`组织「${normalized}」已存在`);
        const now = Date.now();
        const operation: OrganizationRenameOperation = { kind: "rename", requestId: newNodeId(), notebookId: fact.notebookId,
            name: normalized, docId, createdAt: now, updatedAt: now, originalName: fact.name, path: fact.path,
            markerId: fact.marker.id, originalMarkerMarkdown: fact.marker.markdown, markerIal: fact.marker.ial,
            markerValue: fact.marker.value, targetMarkerMarkdown: organizationMarkerMarkdown(normalized), titleState: "unissued", markerState: "unissued" };
        await persist(plugin, operation);
        return renameSteps(plugin, operation);
    }));
}

export async function inspectOrganizationOperation(plugin: Plugin, requestId: string): Promise<OrganizationOperationReport> {
    const operation = (await loadOrganizationOperations(plugin)).operations.find((entry) => entry.requestId === requestId);
    if (!operation) throw new Error("组织操作请求不存在");
    return withOperationLock(operation, async () => {
        const current = (await loadOrganizationOperations(plugin)).operations.find((entry) => entry.requestId === requestId)!;
        return inspectSafely(plugin, current);
    });
}

export async function listPendingOrganizationOperations(plugin: Plugin): Promise<OrganizationOperationReport[]> {
    const store = await loadOrganizationOperations(plugin);
    const reports: OrganizationOperationReport[] = [];
    for (const operation of store.operations.filter((entry) => !organizationOperationComplete(entry))) {
        reports.push(await inspectOrganizationOperation(plugin, operation.requestId));
    }
    return reports;
}

export async function resumeOrganizationOperation(plugin: Plugin, settings: ContactsSettings, requestId: string): Promise<OrganizationOperationReport> {
    const operation = (await loadOrganizationOperations(plugin)).operations.find((entry) => entry.requestId === requestId);
    if (!operation) throw new Error("组织操作请求不存在");
    return withOperationLock(operation, async () => {
        const current = (await loadOrganizationOperations(plugin)).operations.find((entry) => entry.requestId === requestId)!;
        if (current.kind === "create" && current.notebookId !== settings.notebookId) return report(current, "conflict", "当前笔记本锚点变化，仅可核实原创建请求");
        return current.kind === "create" ? createStep(plugin, current) : renameSteps(plugin, current);
    });
}
