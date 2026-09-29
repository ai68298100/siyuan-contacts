/**
 * B07 同步服务：跟进事项 ↔ 人物文档原生任务块双向同步。
 * 写侧：插件库变更后按 planTaskSync 落文档——逐计划隔离，分项报告（B07-b），
 * 由调用方把失败上浮为「已保存但同步失败」；读侧：人物详情打开时按文档对账。
 * 契约见 docs/DATA-CONTRACT.md §3.1；端点实证 spike 12/12。
 */
import type { Plugin } from "siyuan";
import {
    deleteBlock,
    findFollowUpTaskBlocks,
    setBlockAttrs,
    appendBlockMd,
    updateBlockMd,
    updateTaskListItemMarker,
} from "../api/blocks";
import { planTaskSync, reconcileDecisions } from "../domain/followup-doc";
import type { DocTaskBlock } from "../domain/followup-doc";
import { loadSettings } from "./init";
import type { ContactsSettings } from "../domain/model";
import {
    updateFollowUpRecord,
} from "../data/followups";
import { listPersonFollowUps } from "./followups";

export interface FollowUpSyncFailure {
    followUpId: string;
    action: string;
    message: string;
}

export interface FollowUpSyncReport {
    applied: number;
    failed: FollowUpSyncFailure[];
}

/** 该人物文档的任务块同步（写侧）。settings 未初始化 → 空报告（无可同步）。
 *  B07-b：逐计划隔离——单个任务块写失败不阻断其余；分项报告返回，由调用方决定上浮方式。 */
export async function syncFollowUpTasksToDoc(plugin: Plugin, personDocId: string): Promise<FollowUpSyncReport> {
    const report: FollowUpSyncReport = { applied: 0, failed: [] };
    let items: { id: string; title: string; dueDate: string; status: "open" | "done" | "cancelled"; docMissing?: boolean }[];
    let blocks: DocTaskBlock[];
    try {
        const settings: ContactsSettings | null = await loadSettings(plugin);
        if (!settings) return report;
        items = (await listPersonFollowUps(plugin, personDocId))
            .map((item) => ({ id: item.id, title: item.title, dueDate: item.dueDate, status: item.status, docMissing: item.docMissing }));
        blocks = await findFollowUpTaskBlocks(personDocId);
    } catch (error) {
        /* 骨架失败（设置/名册/块扫描）：所有计划无法执行，整批记入 failed */
        report.failed.push({
            followUpId: "*", action: "plan",
            message: error instanceof Error ? error.message : String(error),
        });
        return report;
    }
    for (const plan of planTaskSync(items, blocks)) {
        try {
            if (plan.action === "insert") {
                const blockId = await appendBlockMd(personDocId, plan.markdown ?? "");
                try {
                    await setBlockAttrs(blockId, { "custom-lvct-followup": plan.followUpId });
                } catch (attrsError) {
                    /* 关联键挂载失败：块无关联键会在重试时被再次插入产生重复——先删块再报失败，保证重试安全 */
                    try { await deleteBlock(blockId); } catch { /* 删除失败时报告原错误，残留块由体检/对账发现 */ }
                    throw attrsError;
                }
            } else if (plan.action === "update") {
                await updateBlockMd(plan.blockId ?? "", plan.markdown ?? "");
            } else if (plan.action === "done") {
                await updateTaskListItemMarker(plan.blockId ?? "", "x");
            } else if (plan.action === "delete") {
                await deleteBlock(plan.blockId ?? "");
            }
            report.applied += 1;
        } catch (error) {
            report.failed.push({
                followUpId: plan.followUpId,
                action: plan.action,
                message: error instanceof Error ? error.message : String(error),
            });
        }
    }
    if (report.failed.length > 0) {
        console.warn(`[lvct] 跟进任务块同步分项失败（${personDocId}）:`, report.failed);
    }
    return report;
}

/** 读侧对账（文档为准，B07-a）：勾选收敛 + 标题/日期回写 + 块缺失标记不可达；返回是否发生收敛 */
export async function reconcileFollowUpTasksFromDoc(plugin: Plugin, personDocId: string): Promise<boolean> {
    const settings: ContactsSettings | null = await loadSettings(plugin);
    if (!settings) return false;
    const [items, blocks] = await Promise.all([
        listPersonFollowUps(plugin, personDocId),
        findFollowUpTaskBlocks(personDocId),
    ]);
    const decisions = reconcileDecisions(
        items.map((item) => ({
            id: item.id,
            status: item.status,
            title: item.title,
            dueDate: item.dueDate,
            ...(item.docBlockId !== undefined ? { docBlockId: item.docBlockId } : {}),
            ...(item.docMissing !== undefined ? { docMissing: item.docMissing } : {}),
        })),
        blocks,
    );
    let changed = false;
    for (const id of decisions.toDone) {
        /* done/closedAt 由 updateFollowUpRecord 的 status 语义统一维护 */
        await updateFollowUpRecord(plugin, id, { status: "done" }, { fromReconcile: true });
        changed = true;
    }
    for (const id of decisions.toOpen) {
        await updateFollowUpRecord(plugin, id, { status: "open" }, { fromReconcile: true });
        changed = true;
    }
    for (const update of decisions.updates) {
        /* 文档为准回写（含块 ID 记录与 docMissing 恢复）；updates 仅在有实际差异时发出 */
        await updateFollowUpRecord(
            plugin,
            update.id,
            {
                ...(update.title !== undefined ? { title: update.title } : {}),
                ...(update.dueDate !== undefined ? { dueDate: update.dueDate } : {}),
                docBlockId: update.blockId,
                docMissing: false,
            },
            { fromReconcile: true },
        );
        changed = true;
    }
    for (const id of decisions.missing) {
        /* 任务块已被删除/移出：显式不可达，写侧不再自动重建（契约 §3.1 同步方向） */
        await updateFollowUpRecord(plugin, id, { docMissing: true, docBlockId: undefined }, { fromReconcile: true });
        changed = true;
    }
    return changed;
}
