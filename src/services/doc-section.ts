/**
 * 人物文档"相关人物"区块：把关系边同步为文档内的双链段落。
 * 设计（ROADMAP 需求③）：让思源原生反链面板与关系图也能看到人脉边——图谱不只活在插件里。
 * 实现：单个带 custom-lvct-related 属性标记的段落块，幂等更新；关系清空则移除区块。
 * 防递归：只在 services 层关系写操作后调用（我们不监听 protyle 内容变化），不存在回环。
 */
import { readMarkedBlocks, upsertMarkedBlock } from "../api/blocks";
import type { ContactSummary } from "../domain/person";
import { escapeMarkdown } from "../domain/briefing-export";

export const RELATED_SECTION_ATTR = "custom-lvct-related";

function sectionMarkdown(related: readonly ContactSummary[]): string {
    const links = related.map((item) => `[${escapeMarkdown(item.name.replace(/[\r\n]+/g, " "))}](siyuan://blocks/${item.docId})`);
    return `**相关人物**：${links.join("、")}`;
}

export class RelatedProjectionUnknownError extends Error {}

function contentWithoutIal(markdown: string): string {
    return markdown.replace(/\r\n/g, "\n").replace(/^\s*\{:[^\n]*\}\s*$/gm, "").trim();
}

/** 同步某人物文档的相关人物区块（related 为解析好姓名的对方联系人） */
export async function syncRelatedSection(person: ContactSummary, related: readonly ContactSummary[]): Promise<void> {
    const existing = await readMarkedBlocks(person.docId, RELATED_SECTION_ATTR);
    if (existing.length > 1) throw new RelatedProjectionUnknownError("存在多个关系标记区块，未自动覆盖；请先核对文档");
    const markdown = related.length > 0 ? sectionMarkdown(related) : "";
    if (existing.length === 0 && !markdown
        || existing.length === 1 && contentWithoutIal(existing[0].markdown) === markdown) return;
    await upsertMarkedBlock(person.docId, RELATED_SECTION_ATTR, markdown, existing[0]?.id);
    let verified: Array<{ id: string; markdown: string }>;
    try {
        verified = await readMarkedBlocks(person.docId, RELATED_SECTION_ATTR);
    } catch (cause) {
        throw new RelatedProjectionUnknownError("关系投影请求已发出，但回读失败，结果未知", { cause });
    }
    if (!markdown ? verified.length !== 0
        : verified.length !== 1 || contentWithoutIal(verified[0].markdown) !== markdown) {
        throw new RelatedProjectionUnknownError("关系投影请求已接受，但回读尚未核实预期内容");
    }
}

/** 从名册解析某人的相关人（itemID → 对方 ContactSummary，丢弃已删条目） */
export function resolveRelated(person: ContactSummary, roster: readonly ContactSummary[]): ContactSummary[] {
    return roster.filter((other) => other.itemId !== person.itemId
        && (person.relatedItemIds.includes(other.itemId) || other.relatedItemIds.includes(person.itemId)));
}
