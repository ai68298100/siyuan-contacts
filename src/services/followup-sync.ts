/**
 * B07 同步服务：跟进事项 ↔ 人物文档原生任务块双向同步。
 * 写侧：插件库变更后按 planTaskSync 落文档（失败不阻断插件库写入，console 记录）。
 * 读侧：人物详情打开时按文档对账（文档为准，单向收敛插件库状态）。
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

/** 该人物文档的任务块同步（写侧）。settings 未初始化或失败时静默降级（console 记录） */
export async function syncFollowUpTasksToDoc(plugin: Plugin, personDocId: string): Promise<void> {
    try {
        const settings: ContactsSettings | null = await loadSettings(plugin);
        if (!settings) return;
        const items = (await listPersonFollowUps(plugin, personDocId))
            .map((item) => ({ id: item.id, title: item.title, dueDate: item.dueDate, status: item.status }));
        const blocks: DocTaskBlock[] = await findFollowUpTaskBlocks(personDocId);
        const plans = planTaskSync(items, blocks);
        for (const plan of plans) {
            if (plan.action === "insert") {
                const blockId = await appendBlockMd(personDocId, plan.markdown ?? "");
                await setBlockAttrs(blockId, { "custom-lvct-followup": plan.followUpId });
            } else if (plan.action === "update") {
                await updateBlockMd(plan.blockId ?? "", plan.markdown ?? "");
            } else if (plan.action === "done") {
                await updateTaskListItemMarker(plan.blockId ?? "", "x");
            } else if (plan.action === "delete") {
                await deleteBlock(plan.blockId ?? "");
            }
        }
    } catch (error) {
        console.warn("[lvct] 跟进任务块同步失败（不影响插件库写入）:", error);
    }
}

/** 读侧对账（文档为准）：文档勾选 → 插件置 done；取消勾选 → 恢复 open；返回是否发生收敛 */
export async function reconcileFollowUpTasksFromDoc(plugin: Plugin, personDocId: string): Promise<boolean> {
    const settings: ContactsSettings | null = await loadSettings(plugin);
    if (!settings) return false;
    const [items, blocks] = await Promise.all([
        listPersonFollowUps(plugin, personDocId),
        findFollowUpTaskBlocks(personDocId),
    ]);
    const decisions = reconcileDecisions(
        items.map((item) => ({ id: item.id, status: item.status })),
        blocks,
    );
    let changed = false;
    for (const id of decisions.toDone) {
        /* done/closedAt 由 updateFollowUpRecord 的 status 语义统一维护 */
        await updateFollowUpRecord(plugin, id, { status: "done" });
        changed = true;
    }
    for (const id of decisions.toOpen) {
        await updateFollowUpRecord(plugin, id, { status: "open" });
        changed = true;
    }
    return changed;
}
