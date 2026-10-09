/**
 * 导出中心（F01）：设置页统一导出入口的数量摘要。
 * 数量仅辅助展示，走容错读取（展示归一化），失败由调用方降级为不显示数量，
 * 不阻塞导出动作本身；导出复用既有服务，不新造格式（DATA-CONTRACT §3/§7）。
 */
import type { Plugin } from "siyuan";
import type { ContactsSettings } from "../domain/model";
import { loadInteractionStoreStrict } from "../data/interactions";
import { getRoster } from "./roster";

export interface ExportSummary {
    peopleCount: number;
    /** 活跃互动事件数：读时归一已剔除墓碑与重复，即 events 长度 */
    interactionCount: number;
}

export async function loadExportSummary(plugin: Plugin, settings: ContactsSettings): Promise<ExportSummary> {
    const [roster, store] = await Promise.all([getRoster(settings), loadInteractionStoreStrict(plugin)]);
    return { peopleCount: roster.length, interactionCount: store.events.length };
}
