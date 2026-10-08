import type { Plugin } from "siyuan";
import { deleteBlock, updateTaskListItemMarker } from "../api/blocks";
import { newNodeId } from "../api/client";
import { FollowUpDocumentMissingError, readFollowUpTaskBlocks, writeFollowUpTask } from "../api/followup-tasks";
import { observeFollowUpTasks, planTaskSync, taskMatchesItem } from "../domain/followup-doc";
import type { DocTaskBlock } from "../domain/followup-doc";
import { normalizeFollowUpStoreForWrite } from "../domain/followups";
import type { FollowUpItem, FollowUpStore } from "../domain/followups";
import { FOLLOW_UP_STORAGE_KEY } from "../data/followups";
import { loadJsonStrict, saveJsonVerified, withStoreLock } from "../data/storage";
import { loadSettings } from "./init";

export interface FollowUpSyncFailure {
    followUpId: string;
    action: string;
    message: string;
}

export interface FollowUpTaskResult {
    personDocId: string;
    followUpId: string;
    blockId?: string;
    action: string;
    changes: string[];
    index: "verified" | "failed" | "unknown";
    document: "verified" | "missing" | "not_created" | "pending" | "failed" | "unknown";
    message?: string;
}

export interface FollowUpSyncReport {
    applied: number;
    changed: boolean;
    failed: FollowUpSyncFailure[];
    items: FollowUpTaskResult[];
}

export interface FollowUpTaskOptions {
    followUpIds?: readonly string[];
}

function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export async function readFollowUpIndex(plugin: Plugin): Promise<FollowUpStore> {
    return normalizeFollowUpStoreForWrite(await loadJsonStrict(plugin, FOLLOW_UP_STORAGE_KEY));
}

async function checkpoint(plugin: Plugin, expected: FollowUpItem, patch: Partial<FollowUpItem>): Promise<FollowUpItem> {
    return withStoreLock(FOLLOW_UP_STORAGE_KEY, async () => {
        const store = await readFollowUpIndex(plugin);
        const current = store.items.find((item) => item.id === expected.id);
        if (!current || JSON.stringify(current) !== JSON.stringify(expected)) throw new Error("事项已被并发修改，请基于最新索引重试");
        const next = { ...current, ...patch };
        await saveJsonVerified(plugin, FOLLOW_UP_STORAGE_KEY, { ...store, items: store.items.map((item) => item.id === current.id ? next : item) });
        return next;
    });
}

function emptyReport(): FollowUpSyncReport {
    return { applied: 0, changed: false, failed: [], items: [] };
}

function addResult(report: FollowUpSyncReport, result: FollowUpTaskResult): void {
    report.items.push(result);
    if (result.message) report.failed.push({ followUpId: result.followUpId, action: result.action, message: result.message });
}

async function prepare(
    plugin: Plugin, personDocId: string, report: FollowUpSyncReport, options: FollowUpTaskOptions,
): Promise<{ items: FollowUpItem[]; blocks: DocTaskBlock[] } | null> {
    let items: FollowUpItem[] = [];
    let index: FollowUpTaskResult["index"] = "unknown";
    try {
        const store = await readFollowUpIndex(plugin);
        const selected = options.followUpIds ? new Set(options.followUpIds) : undefined;
        items = store.items.filter((item) => item.personDocId === personDocId && (!selected || selected.has(item.id)));
        index = "verified";
        if (!await loadSettings(plugin)) throw new Error("工作空间尚未初始化，文档任务未核实");
        return { items, blocks: await readFollowUpTaskBlocks(personDocId) };
    } catch (error) {
        for (const item of items.length > 0 ? items : [{ id: "*", docBlockId: undefined }]) {
            addResult(report, {
                personDocId, followUpId: item.id, blockId: item.docBlockId, action: "read", changes: [], index,
                document: error instanceof FollowUpDocumentMissingError ? "missing" : "unknown", message: messageOf(error),
            });
        }
        return null;
    }
}

export async function syncFollowUpTasksToDoc(
    plugin: Plugin, personDocId: string, options: FollowUpTaskOptions = {},
): Promise<FollowUpSyncReport> {
    return withStoreLock(`follow-up-tasks:${personDocId}`, async () => {
        const report = emptyReport();
        const prepared = await prepare(plugin, personDocId, report, options);
        if (!prepared) return report;
        let blocks = prepared.blocks;
        for (const original of prepared.items) {
            let item = original;
            const result: FollowUpTaskResult = {
                personDocId, followUpId: item.id, blockId: item.docBlockId, action: "verify", changes: [], index: "verified", document: "unknown",
            };
            const matches = blocks.filter((block) => block.followUpId === item.id);
            if (matches.length > 1) {
                addResult(report, { ...result, message: "同一事项存在多个任务项，已停止自动写入" });
                continue;
            }
            const plan = planTaskSync([item], matches)[0];
            if (!plan && !item.docSyncPending) {
                const observation = observeFollowUpTasks([item], matches)[0];
                addResult(report, { ...result, document: observation.document, blockId: matches[0]?.blockId ?? item.docBlockId, message: observation.message });
                continue;
            }
            if (!plan && !taskMatchesItem(item, matches)) {
                addResult(report, { ...result, document: "not_created", message: "历史关闭事项没有任务项，不自动回填" });
                continue;
            }
            result.action = plan?.action ?? "verify";
            const blockId = plan?.blockId ?? matches[0]?.blockId ?? item.docSyncBlockId ?? newNodeId();
            result.blockId = blockId;
            try {
                item = await checkpoint(plugin, item, { docSyncPending: true, docSyncBlockId: blockId });
            } catch (error) {
                addResult(report, { ...result, index: "unknown", document: "pending", message: messageOf(error) });
                continue;
            }
            let writeError: unknown;
            if (plan) {
                try {
                    if (plan.action === "delete") await deleteBlock(blockId);
                    else if (plan.action === "done") await updateTaskListItemMarker(blockId, "x");
                    else await writeFollowUpTask(personDocId, item, blockId, plan.action === "insert");
                } catch (error) { writeError = error; }
            }
            try {
                blocks = await readFollowUpTaskBlocks(personDocId);
            } catch (error) {
                addResult(report, { ...result, document: "unknown", message: messageOf(writeError ?? error) });
                continue;
            }
            if (!taskMatchesItem(item, blocks)) {
                addResult(report, { ...result, document: writeError ? "unknown" : "failed", message: writeError ? messageOf(writeError) : "写请求已接受，但任务内容或关联键回读未收敛" });
                continue;
            }
            result.document = "verified";
            try {
                const observed = blocks.find((block) => block.followUpId === item.id);
                await checkpoint(plugin, item, {
                    docSyncPending: undefined, docSyncBlockId: undefined,
                    docBlockId: observed?.blockId, docMissing: undefined,
                });
                if (plan) report.applied += 1;
                report.changed = true;
                result.changes = plan ? [plan.action] : [];
                addResult(report, result);
            } catch (error) {
                addResult(report, { ...result, index: "unknown", message: messageOf(error) });
            }
        }
        return report;
    });
}

export async function reconcileFollowUpTaskReport(
    plugin: Plugin, personDocId: string, options: FollowUpTaskOptions = {},
): Promise<FollowUpSyncReport> {
    return withStoreLock(`follow-up-tasks:${personDocId}`, async () => {
        const report = emptyReport();
        const prepared = await prepare(plugin, personDocId, report, options);
        if (!prepared) return report;
        for (const observation of observeFollowUpTasks(prepared.items, prepared.blocks)) {
            const { item, block, changes, patch } = observation;
            const result: FollowUpTaskResult = {
                personDocId, followUpId: item.id, blockId: block?.blockId ?? item.docBlockId ?? item.docSyncBlockId,
                action: "reconcile", changes, index: "verified", document: observation.document, message: observation.message,
            };
            if (item.docSyncPending && taskMatchesItem(item, prepared.blocks)) {
                Object.assign(patch, {
                    docSyncPending: undefined, docSyncBlockId: undefined, docBlockId: block?.blockId, docMissing: undefined,
                });
                result.document = "verified";
                result.message = undefined;
                changes.push("checkpoint");
            }
            if (Object.keys(patch).length > 0) {
                try {
                    await checkpoint(plugin, item, {
                        ...patch, updatedAt: Date.now(),
                        ...(patch.status ? { closedAt: patch.status === "open" ? undefined : Date.now() } : {}),
                    });
                    report.applied += 1;
                    report.changed = true;
                } catch (error) {
                    result.index = "unknown";
                    result.message = messageOf(error);
                }
            }
            addResult(report, result);
        }
        return report;
    });
}

export async function reconcileFollowUpTasksFromDoc(plugin: Plugin, personDocId: string): Promise<boolean> {
    const report = await reconcileFollowUpTaskReport(plugin, personDocId);
    if (report.failed.length > 0) throw new Error(`跟进任务尚未完成对账：${report.failed[0].message}`);
    return report.changed;
}

export async function retryFollowUpTasks(
    plugin: Plugin, personDocId: string, previous: FollowUpSyncReport, module: "index" | "document",
): Promise<FollowUpSyncReport> {
    const followUpIds = previous.items.filter((item) => item.personDocId === personDocId && (
        module === "index" ? item.index !== "verified" : item.document === "pending" || item.document === "failed" || item.document === "unknown"
    )).map((item) => item.followUpId);
    const options = followUpIds.includes("*") ? {} : { followUpIds };
    return module === "index"
        ? reconcileFollowUpTaskReport(plugin, personDocId, options)
        : syncFollowUpTasksToDoc(plugin, personDocId, options);
}
