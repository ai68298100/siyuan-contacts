import type { Plugin } from "siyuan";
import { readMarkedBlocks, upsertMarkedBlock } from "../api/blocks";
import { loadOrgMembershipStore, ORG_MEMBERSHIP_STORAGE_KEY } from "../data/org-membership";
import { loadJsonStrict, saveJsonVerified, withStoreLock } from "../data/storage";
import { buildOrgProjectionTargets, orgProjectionSourceSnapshot, parseOrgProjectionOperationStore, stripProjectionIal } from "../domain/org-projections.ts";
import type { OrgProjectionOperation, OrgProjectionSource, OrgProjectionTarget } from "../domain/org-projections.ts";
import { KernelPermissionError, KernelResponseError, newNodeId } from "../api/client";
import type { ContactsSettings } from "../domain/model";
import { getRoster, invalidateRoster } from "./roster";
import { scanOrganizations } from "./org";

export const ORG_PROJECTION_CHECKPOINT_STORAGE_KEY = "org-projection-checkpoints.json";

export interface OrgProjectionPreviewTarget extends OrgProjectionTarget {
    state: "unchanged" | "missing" | "different" | "unknown";
    existing: Array<{ id: string; markdown: string }> | null;
    message?: string;
    checkpointPending?: boolean;
}

export interface OrgProjectionPreview {
    anchorKey: string;
    sourceSnapshot: string;
    targets: OrgProjectionPreviewTarget[];
}

export interface OrgProjectionRepairResult {
    docId: string;
    retryKey: string;
    status: "applied" | "unchanged" | "failed" | "unknown";
    message?: string;
}

function anchorKey(settings: ContactsSettings): string {
    return JSON.stringify([settings.notebookId, settings.avId, settings.dbBlockId]);
}

async function readSource(plugin: Plugin, settings: ContactsSettings): Promise<OrgProjectionSource> {
    invalidateRoster();
    const [organizations, store, people] = await Promise.all([scanOrganizations(), loadOrgMembershipStore(plugin), getRoster(settings)]);
    return { organizations, memberships: store.memberships, people: people.map((person) => ({ docId: person.docId, name: person.name })) };
}

function matchesProjection(markdown: string, existing: readonly { markdown: string }[]): boolean {
    return markdown ? existing.length === 1 && stripProjectionIal(existing[0].markdown) === markdown : existing.length === 0;
}

export async function previewOrganizationProjections(
    plugin: Plugin,
    settings: ContactsSettings,
    docIds?: readonly string[],
): Promise<OrgProjectionPreview> {
    const source = await readSource(plugin, settings);
    const operations = parseOrgProjectionOperationStore(await loadJsonStrict(plugin, ORG_PROJECTION_CHECKPOINT_STORAGE_KEY)).operations;
    const targets = buildOrgProjectionTargets(source);
    const scope = docIds ? new Set(docIds) : null;
    if (scope && [...scope].some((docId) => !targets.some((target) => target.docId === docId))) throw new Error("核对范围含未登记文档，请重新核实组织和人物身份");
    const preview: OrgProjectionPreview = { anchorKey: anchorKey(settings), sourceSnapshot: orgProjectionSourceSnapshot(source), targets: [] };
    for (const target of targets) {
        if (scope && !scope.has(target.docId)) continue;
        if (target.blockers.length) {
            preview.targets.push({ ...target, state: "unknown", existing: null, message: target.blockers.join("；") });
            continue;
        }
        try {
            const existing = await readMarkedBlocks(target.docId, target.attrName);
            if (existing.length > 1) throw new Error("存在多个投影标记，未自动覆盖或删除");
            const operation = operations.find((entry) => entry.docId === target.docId && entry.attrName === target.attrName);
            if (operation?.state === "pending" && !matchesProjection(operation.markdown, existing)) throw new Error("原投影请求结果尚未核实，未发送新的修复；请等待并只读核对原预期内容");
            preview.targets.push({ ...target, state: matchesProjection(target.markdown, existing) ? "unchanged" : existing.length ? "different" : "missing", existing,
                checkpointPending: operation?.state === "pending" });
        } catch (error) {
            preview.targets.push({ ...target, state: "unknown", existing: null, message: error instanceof Error ? error.message : String(error) });
        }
    }
    if (orgProjectionSourceSnapshot(await readSource(plugin, settings)) !== preview.sourceSnapshot) throw new Error("核对期间组织、成员或人物发生变化，请重新预览；未修复文档");
    return preview;
}

export async function repairOrganizationProjection(
    plugin: Plugin,
    settings: ContactsSettings,
    preview: OrgProjectionPreview,
    retryKey: string,
): Promise<OrgProjectionRepairResult> {
    const proposed = preview.targets.filter((target) => target.retryKey === retryKey);
    if (proposed.length !== 1 || proposed[0].state === "unknown" || proposed[0].existing === null) throw new Error("目标投影尚未唯一核实，未修复");
    const expected = proposed[0];
    return withStoreLock(ORG_MEMBERSHIP_STORAGE_KEY, () => withStoreLock(ORG_PROJECTION_CHECKPOINT_STORAGE_KEY, async () => {
        const source = await readSource(plugin, settings);
        if (preview.anchorKey !== anchorKey(settings) || preview.sourceSnapshot !== orgProjectionSourceSnapshot(source)) throw new Error("来源或锚点已变化，请重新预览；未修复文档");
        const current = buildOrgProjectionTargets(source).find((target) => target.retryKey === retryKey);
        if (!current || current.docId !== expected.docId || current.attrName !== expected.attrName || current.markdown !== expected.markdown || current.blockers.length) throw new Error("目标或预期内容已变化，请重新预览；未修复文档");
        let existing;
        try { existing = await readMarkedBlocks(current.docId, current.attrName); }
        catch (error) { return { docId: current.docId, retryKey, status: "unknown", message: error instanceof Error ? error.message : String(error) }; }
        if (existing.length > 1) return { docId: current.docId, retryKey, status: "unknown", message: "投影标记重复，未自动选择或删除" };
        let checkpointStore = parseOrgProjectionOperationStore(await loadJsonStrict(plugin, ORG_PROJECTION_CHECKPOINT_STORAGE_KEY));
        const previous = checkpointStore.operations.find((entry) => entry.docId === current.docId && entry.attrName === current.attrName);
        if (previous?.state === "pending" && !matchesProjection(previous.markdown, existing)) {
            return { docId: current.docId, retryKey, status: "unknown", message: "原修复请求仍未核实，未发送新的更新、追加或删除" };
        }
        const saveCheckpoint = async (operation: OrgProjectionOperation): Promise<void> => {
            checkpointStore = parseOrgProjectionOperationStore({ schemaVersion: 1, operations: [
                ...checkpointStore.operations.filter((entry) => entry.docId !== operation.docId || entry.attrName !== operation.attrName), operation,
            ] });
            await saveJsonVerified(plugin, ORG_PROJECTION_CHECKPOINT_STORAGE_KEY, checkpointStore);
        };
        if (matchesProjection(current.markdown, existing)) {
            if (previous?.state === "pending") {
                try { await saveCheckpoint({ ...previous, state: "verified", updatedAt: Date.now() }); }
                catch (error) { return { docId: current.docId, retryKey, status: "unknown", message: `文档已核实，断点收口未知：${error instanceof Error ? error.message : String(error)}` }; }
            }
            return { docId: current.docId, retryKey, status: "unchanged" };
        }
        if (JSON.stringify(existing) !== JSON.stringify(expected.existing)) throw new Error("原投影区块在预览后变化，请重新预览；未覆盖新内容");
        const operation: OrgProjectionOperation = { id: newNodeId(), docId: current.docId, attrName: current.attrName, markdown: current.markdown, state: "pending", updatedAt: Date.now() };
        try { await saveCheckpoint(operation); }
        catch (error) { return { docId: current.docId, retryKey, status: "unknown", message: `写前断点未核实，内核修复请求尚未发出：${error instanceof Error ? error.message : String(error)}` }; }
        let writeError: unknown;
        try { await upsertMarkedBlock(current.docId, current.attrName, current.markdown, existing[0]?.id); }
        catch (error) { writeError = error; }
        try {
            const verified = await readMarkedBlocks(current.docId, current.attrName);
            const applied = matchesProjection(current.markdown, verified);
            const rejected = writeError instanceof KernelResponseError || writeError instanceof KernelPermissionError;
            if (applied || rejected) await saveCheckpoint({ ...operation, state: applied ? "verified" : "rejected", updatedAt: Date.now() });
            if (orgProjectionSourceSnapshot(await readSource(plugin, settings)) !== preview.sourceSnapshot) throw new Error("修复期间事实来源已变化，请重新核对当前投影");
            if (applied) return { docId: current.docId, retryKey, status: "applied" };
            return { docId: current.docId, retryKey, status: rejected ? "failed" : "unknown", message: "投影请求已发出，但预期内容尚未核实；请重新预览，未自动重放" };
        } catch (error) {
            return { docId: current.docId, retryKey, status: "unknown", message: error instanceof Error ? error.message : String(error) };
        }
    }));
}
