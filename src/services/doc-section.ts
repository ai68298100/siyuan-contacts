/**
 * 人物文档"相关人物"区块：把关系边同步为文档内的双链段落。
 * 设计（ROADMAP 需求③）：让思源原生反链面板与关系图也能看到人脉边——图谱不只活在插件里。
 * 实现：单个带 custom-lvct-related 属性标记的段落块，幂等更新；关系清空则移除区块。
 * 防递归：只在 services 层关系写操作后调用（我们不监听 protyle 内容变化），不存在回环。
 */
import { findBlockIdByCustomAttr, upsertMarkedBlock } from "../api/blocks";
import type { ContactSummary } from "../domain/person";

export const RELATED_SECTION_ATTR = "custom-lvct-related";

function sectionMarkdown(related: readonly ContactSummary[]): string {
    const links = related.map((item) => `[${item.name}](siyuan://blocks/${item.docId})`);
    return `**相关人物**：${links.join("、")}`;
}

/** 同步某人物文档的相关人物区块（related 为解析好姓名的对方联系人） */
export async function syncRelatedSection(person: ContactSummary, related: readonly ContactSummary[]): Promise<void> {
    const existingId = await findBlockIdByCustomAttr(person.docId, RELATED_SECTION_ATTR);
    const markdown = related.length > 0 ? sectionMarkdown(related) : "";
    await upsertMarkedBlock(person.docId, RELATED_SECTION_ATTR, markdown, existingId);
}

/** 从名册解析某人的相关人（itemID → 对方 ContactSummary，丢弃已删条目） */
export function resolveRelated(person: ContactSummary, roster: readonly ContactSummary[]): ContactSummary[] {
    const byItem = new Map(roster.map((item) => [item.itemId, item]));
    return person.relatedItemIds
        .map((itemId) => byItem.get(itemId))
        .filter((item): item is ContactSummary => Boolean(item));
}
