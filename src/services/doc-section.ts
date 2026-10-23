/**
 * 人物文档各原子区块同步服务：把人脉基本资料、往来记录、跟进事项、人情往来与纪念日同步为文档内的 Markdown 区块。
 * 契约：各区块拥有独立 custom-lvct-* 属性标记，幂等更新，内容未变不触发写入。
 */
import { readMarkedBlocks, upsertMarkedBlock } from "../api/blocks";
import { KernelPermissionError, KernelResponseError } from "../api/client";
import type { ContactSummary } from "../domain/person";
import { loadInteractionStore } from "../data/interactions";
import { loadFollowUpStore } from "../data/followups";
import { loadExchangeStore } from "../data/exchanges";
import { loadAnniversaryStore } from "../data/anniversaries";
import type { Plugin } from "siyuan";
import {
    RELATED_SECTION_ATTR,
    INTERACTIONS_SECTION_ATTR,
    PROFILE_SECTION_ATTR,
    FOLLOWUPS_SECTION_ATTR,
    EXCHANGES_SECTION_ATTR,
    ANNIVERSARIES_SECTION_ATTR,
    profileSectionMarkdown,
    interactionSectionMarkdown,
    followupsSectionMarkdown,
    exchangesSectionMarkdown,
    anniversariesSectionMarkdown,
    relatedSectionMarkdown,
} from "../domain/doc-section.ts";

export {
    RELATED_SECTION_ATTR,
    INTERACTIONS_SECTION_ATTR,
    PROFILE_SECTION_ATTR,
    FOLLOWUPS_SECTION_ATTR,
    EXCHANGES_SECTION_ATTR,
    ANNIVERSARIES_SECTION_ATTR,
    profileSectionMarkdown,
    interactionSectionMarkdown,
    followupsSectionMarkdown,
    exchangesSectionMarkdown,
    anniversariesSectionMarkdown,
    relatedSectionMarkdown,
};

export class RelatedProjectionUnknownError extends Error {}

function contentWithoutIal(markdown: string): string {
    return markdown.replace(/\r\n/g, "\n").trim()
        .replace(/\n\s*\{:[^\n]*\}\s*$/, "").trim();
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
        console.warn("[LvContacts] 人脉基本档案同步到正文未完成", err);
    }
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
        console.warn("[LvContacts] 互动记录同步到正文未完成", err);
    }
}

export async function syncFollowUpsDocSection(plugin: Plugin, personDocId: string): Promise<void> {
    if (!personDocId) return;
    try {
        const store = await loadFollowUpStore(plugin);
        const items = store.items.filter((item) => item.personDocId === personDocId);
        const existing = await readMarkedBlocks(personDocId, FOLLOWUPS_SECTION_ATTR);
        const markdown = followupsSectionMarkdown(items);
        if (existing.length === 0 && !markdown) return;
        if (existing.length === 1 && contentWithoutIal(existing[0].markdown) === markdown) return;
        await upsertMarkedBlock(personDocId, FOLLOWUPS_SECTION_ATTR, markdown, existing[0]?.id);
    } catch (err) {
        console.warn("[LvContacts] 待办跟进同步到正文未完成", err);
    }
}

export async function syncExchangesDocSection(plugin: Plugin, personDocId: string): Promise<void> {
    if (!personDocId) return;
    try {
        const store = await loadExchangeStore(plugin);
        const items = store.records.filter((item) => item.personDocId === personDocId);
        const existing = await readMarkedBlocks(personDocId, EXCHANGES_SECTION_ATTR);
        const markdown = exchangesSectionMarkdown(items);
        if (existing.length === 0 && !markdown) return;
        if (existing.length === 1 && contentWithoutIal(existing[0].markdown) === markdown) return;
        await upsertMarkedBlock(personDocId, EXCHANGES_SECTION_ATTR, markdown, existing[0]?.id);
    } catch (err) {
        console.warn("[LvContacts] 人情往来同步到正文未完成", err);
    }
}

export async function syncAnniversariesDocSection(plugin: Plugin, personDocId: string): Promise<void> {
    if (!personDocId) return;
    try {
        const store = await loadAnniversaryStore(plugin);
        const items = store.anniversaries[personDocId] ?? [];
        const existing = await readMarkedBlocks(personDocId, ANNIVERSARIES_SECTION_ATTR);
        const markdown = anniversariesSectionMarkdown(items);
        if (existing.length === 0 && !markdown) return;
        if (existing.length === 1 && contentWithoutIal(existing[0].markdown) === markdown) return;
        await upsertMarkedBlock(personDocId, ANNIVERSARIES_SECTION_ATTR, markdown, existing[0]?.id);
    } catch (err) {
        console.warn("[LvContacts] 重要纪念日同步到正文未完成", err);
    }
}

/** 完整同步人脉档案、往来记录、跟进计划、人情账目与纪念日到思源独立文档正文 */
export async function syncFullPersonDocument(plugin: Plugin, person: ContactSummary): Promise<void> {
    if (!person.docId) return;
    await Promise.all([
        syncPersonProfileDocSection(person),
        syncInteractionDocSection(plugin, person.docId),
        syncFollowUpsDocSection(plugin, person.docId),
        syncExchangesDocSection(plugin, person.docId),
        syncAnniversariesDocSection(plugin, person.docId),
    ]);
}

/** 同步某人物文档的相关人物区块（related 为解析好姓名的对方联系人） */
export async function syncRelatedSection(person: ContactSummary, related: readonly ContactSummary[]): Promise<void> {
    const existing = await readMarkedBlocks(person.docId, RELATED_SECTION_ATTR);
    if (existing.length > 1) throw new RelatedProjectionUnknownError("存在多个关系标记区块，未自动覆盖；请先核对文档");
    const markdown = related.length > 0 ? relatedSectionMarkdown(related) : "";
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
