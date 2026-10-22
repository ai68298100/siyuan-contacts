/**
 * 人物文档"相关人物"区块：把关系边同步为文档内的双链段落。
 * 设计（ROADMAP 需求③）：让思源原生反链面板与关系图也能看到人脉边——图谱不只活在插件里。
 * 实现：单个带 custom-lvct-related 属性标记的段落块，幂等更新；关系清空则移除区块。
 * 防递归：只在 services 层关系写操作后调用（我们不监听 protyle 内容变化），不存在回环。
 */
import { readMarkedBlocks, upsertMarkedBlock } from "../api/blocks";
import { KernelPermissionError, KernelResponseError } from "../api/client";
import type { ContactSummary } from "../domain/person";
import { escapeLinkLabel } from "../domain/format";
import { loadInteractionStore } from "../data/interactions.ts";
import type { InteractionEvent } from "../domain/interactions.ts";
import { profileText } from "../domain/people-profiles.ts";
import type { Plugin } from "siyuan";

export const RELATED_SECTION_ATTR = "custom-lvct-related";
export const INTERACTIONS_SECTION_ATTR = "custom-lvct-interactions";
export const PROFILE_SECTION_ATTR = "custom-lvct-profile";

export function profileSectionMarkdown(person: ContactSummary): string {
    const lines = ["## 人脉基本档案", ""];
    if (person.phone) lines.push(`- **电话**：${person.phone}`);
    if (person.wechat) lines.push(`- **微信**：${person.wechat}`);
    if (person.email) lines.push(`- **邮箱**：${person.email}`);
    if (person.birthday) {
        const bdayStr = person.isLunar ? `${person.birthday}（农历）` : person.birthday;
        lines.push(`- **生日**：${bdayStr}`);
    }
    if (person.group) lines.push(`- **分组**：${person.group}`);
    if (person.tags && person.tags.length > 0) lines.push(`- **标签**：${person.tags.map((t) => `#${t}`).join(" ")}`);
    if (person.profile) {
        const work = profileText(person.profile, "work");
        const edu = profileText(person.profile, "education");
        const fam = profileText(person.profile, "family");
        const rel = profileText(person.profile, "relationship");
        if (work && work !== "—") lines.push(`- **工作单位**：${work}`);
        if (edu && edu !== "—") lines.push(`- **学校**：${edu}`);
        if (fam && fam !== "—") lines.push(`- **家庭**：${fam}`);
        if (rel && rel !== "—") lines.push(`- **与我的关系**：${rel}`);
    }
    if (lines.length <= 2) return "";
    return lines.join("\n");
}

/** 同步某人物文档的正文基本资料档案区块（真实落盘到思源笔记正文） */
export async function syncPersonProfileDocSection(person: ContactSummary): Promise<void> {
    if (!person.docId) return;
    const existing = await readMarkedBlocks(person.docId, PROFILE_SECTION_ATTR);
    const markdown = profileSectionMarkdown(person);
    if (existing.length === 0 && !markdown) return;
    if (existing.length === 1 && contentWithoutIal(existing[0].markdown) === markdown) return;
    try {
        await upsertMarkedBlock(person.docId, PROFILE_SECTION_ATTR, markdown, existing[0]?.id);
    } catch (err) {
        console.warn("[lvct] 人脉基本档案同步到正文未完成", err);
    }
}

/** 完整同步人脉档案与往来记录到思源独立文档正文 */
export async function syncFullPersonDocument(plugin: Plugin, person: ContactSummary): Promise<void> {
    await Promise.all([
        syncPersonProfileDocSection(person),
        syncInteractionDocSection(plugin, person.docId),
    ]);
}

const INTERACTION_ICONS: Record<string, string> = {
    meet: "🤝 见面",
    call: "📞 电话",
    message: "💬 消息",
    meal: "🍽️ 聚餐",
    mail: "✉️ 邮件",
    other: "📝 互动",
};

export function interactionSectionMarkdown(events: readonly InteractionEvent[]): string {
    if (events.length === 0) return "";
    const lines = ["## 往来记录", ""];
    for (const event of events) {
        const typeStr = (event.type && INTERACTION_ICONS[event.type]) ? INTERACTION_ICONS[event.type] : "📝 互动";
        const noteStr = event.note?.trim() ? `：${event.note.trim()}` : "";
        lines.push(`- ${event.localDate} ${typeStr}${noteStr}`);
    }
    return lines.join("\n");
}

/** 同步某人物文档的正文往来记录区块（真实落盘到思源笔记正文） */
export async function syncInteractionDocSection(plugin: Plugin, personDocId: string): Promise<void> {
    const store = await loadInteractionStore(plugin);
    const tombstones = new Set(store.tombstones);
    const events = store.events
        .filter((e) => e.personDocId === personDocId && !tombstones.has(e.id))
        .sort((a, b) => b.occurredAt - a.occurredAt);
    const existing = await readMarkedBlocks(personDocId, INTERACTIONS_SECTION_ATTR);
    const markdown = interactionSectionMarkdown(events);
    if (existing.length === 0 && !markdown) return;
    if (existing.length === 1 && contentWithoutIal(existing[0].markdown) === markdown) return;
    try {
        await upsertMarkedBlock(personDocId, INTERACTIONS_SECTION_ATTR, markdown, existing[0]?.id);
    } catch (err) {
        console.warn("[lvct] 互动记录同步到正文未完成", err);
    }
}

function sectionMarkdown(related: readonly ContactSummary[]): string {
    const links = related.map((item) => `[${escapeLinkLabel(item.name)}](siyuan://blocks/${item.docId})`);
    return `**相关人物**：${links.join("、")}`;
}

export class RelatedProjectionUnknownError extends Error {}

function contentWithoutIal(markdown: string): string {
    return markdown.replace(/\r\n/g, "\n").trim()
        .replace(/\n\s*\{:[^\n]*\}\s*$/, "").trim();
}

/** 同步某人物文档的相关人物区块（related 为解析好姓名的对方联系人） */
export async function syncRelatedSection(person: ContactSummary, related: readonly ContactSummary[]): Promise<void> {
    const existing = await readMarkedBlocks(person.docId, RELATED_SECTION_ATTR);
    if (existing.length > 1) throw new RelatedProjectionUnknownError("存在多个关系标记区块，未自动覆盖；请先核对文档");
    const markdown = related.length > 0 ? sectionMarkdown(related) : "";
    if (existing.length === 0 && !markdown
        || existing.length === 1 && contentWithoutIal(existing[0].markdown) === markdown) return;
    try {
        await upsertMarkedBlock(person.docId, RELATED_SECTION_ATTR, markdown, existing[0]?.id);
    } catch (cause) {
        const writeRejected = (cause instanceof KernelPermissionError || cause instanceof KernelResponseError)
            && ["/api/block/insertBlock", "/api/block/updateBlock", "/api/block/deleteBlock"].includes(cause.route);
        if (writeRejected) throw cause;
        throw new RelatedProjectionUnknownError("关系投影请求已发出，但写入或回读结果尚未核实", { cause });
    }
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
