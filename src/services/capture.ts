/**
 * 从笔记捕获人脉（v0.2a 确定性核心）：
 * 一篇会议/聚会笔记 → 识别出链指向的联系人文档 → 每人记录一条互动事件（共享 externalRef=笔记ID，
 * 即"同一场合"身份）→ 笔记里写入"参与人员"双链区块（原生反链可见）。
 * 未入库的新人可同时按名收编。AI 抽取未链接人名是可选增强（ROADMAP v0.2b），不在此层。
 */
import { birthdayToMs, emptyDraft, validateDraft } from "../domain/person";
import type { ContactSummary } from "../domain/person";
import { toLocalDateKey } from "../domain/interactions";
import { createContact } from "./contacts";
import { getRoster, invalidateRoster } from "./roster";
import { loadInteractionStore, recordInteraction } from "../data/interactions";
import { findBlockIdByCustomAttr, findOutgoingLinkRoots, getBlockContent, upsertMarkedBlock } from "../api/blocks";
import type { Plugin } from "siyuan";
import type { ContactsSettings } from "../domain/model";

export const ATTENDEES_SECTION_ATTR = "custom-lvct-attendees";

export interface CapturePreview {
    docName: string;
    /** 出链指向、且已在人脉库的联系人 */
    linked: ContactSummary[];
}

export async function previewCapture(settings: ContactsSettings, docId: string): Promise<CapturePreview> {
    const [linkedDocIds, roster, docName] = await Promise.all([
        findOutgoingLinkRoots(docId),
        getRoster(settings),
        getBlockContent(docId).catch(() => undefined),
    ]);
    const linkedSet = new Set(linkedDocIds);
    const linked = roster.filter((person) => linkedSet.has(person.docId));
    return { docName: docName ?? "", linked };
}

export interface CaptureOptions {
    /** 确认要记录互动的已有联系人（文档 ID） */
    personDocIds: readonly string[];
    /** 需要新建入库的新人姓名 */
    newNames: readonly string[];
    /** 场合日期 YYYY-MM-DD，默认今天 */
    date: string;
    place?: string;
    note?: string;
}

export interface CaptureResult {
    createdNames: string[];
    /** 本次实际新记录的互动条数（同笔记重复捕获为 0） */
    interactions: number;
    attendeeBlockWritten: boolean;
}

function composeNote(options: CaptureOptions): string | undefined {
    const parts = [
        options.place?.trim() ? `@${options.place.trim()}` : "",
        options.note?.trim() ?? "",
    ].filter((part) => part.length > 0);
    return parts.length > 0 ? parts.join(" ") : undefined;
}

/** 全流程捕获。幂等：同笔记对同人的重复捕获被 externalRef 拦截，不会重复计数 */
export async function captureFromDoc(
    plugin: Plugin,
    settings: ContactsSettings,
    docId: string,
    options: CaptureOptions,
): Promise<CaptureResult> {
    if (!/^\d{14}-[0-9a-z]{7}$/.test(docId)) throw new Error("笔记 ID 不是合法的思源 ID");

    // 1. 新人入库（重名跳过并计入结果）
    const createdNames: string[] = [];
    for (const rawName of options.newNames) {
        const name = rawName.trim();
        if (!name) continue;
        const draft = { ...emptyDraft(), name };
        if (validateDraft(draft).length > 0) continue;
        try {
            await createContact(settings, draft);
            createdNames.push(name);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (!message.includes("已存在")) throw error;
        }
    }

    // 2. 解析目标（确认的已有联系人 + 刚创建的新人）
    invalidateRoster();
    const roster = await getRoster(settings);
    const byDoc = new Map(roster.map((person) => [person.docId, person]));
    const targets: ContactSummary[] = [];
    for (const targetDocId of options.personDocIds) {
        const person = byDoc.get(targetDocId);
        if (person) targets.push(person);
    }
    for (const name of createdNames) {
        const person = roster.find((item) => item.name === name);
        if (person) targets.push(person);
    }

    // 3. 每人一条互动事件：source=diary，externalRef=笔记 ID（同场身份）；已捕获过的人跳过
    const store = await loadInteractionStore(plugin);
    const capturedAlready = new Set(
        store.events
            .filter((event) => event.source === "diary" && event.externalRef === docId)
            .map((event) => event.personDocId),
    );
    const freshTargets = targets.filter((person) => !capturedAlready.has(person.docId));
    const occurredAt = birthdayToMs(options.date) ?? Date.now();
    const note = composeNote(options);
    for (const person of freshTargets) {
        await recordInteraction(plugin, {
            personDocId: person.docId,
            source: "diary",
            externalRef: docId,
            occurredAt,
            note,
        });
    }

    // 4. 笔记写入"参与人员"双链区块（同场人员 >=1 才写）
    let attendeeBlockWritten = false;
    if (targets.length > 0) {
        const links = targets.map((person) => `[${person.name}](siyuan://blocks/${person.docId})`).join("、");
        const markdown = `**参与人员**（${toLocalDateKey(new Date(occurredAt))}）：${links}`;
        const existingId = await findBlockIdByCustomAttr(docId, ATTENDEES_SECTION_ATTR);
        await upsertMarkedBlock(docId, ATTENDEES_SECTION_ATTR, markdown, existingId);
        attendeeBlockWritten = true;
    }
    invalidateRoster();
    return { createdNames, interactions: freshTargets.length, attendeeBlockWritten };
}
