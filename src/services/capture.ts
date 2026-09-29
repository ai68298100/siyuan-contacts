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
import { recordInteractionWithResult } from "../data/interactions";
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

export type RecognizeTargetResolution =
    | { status: "bound"; person: ContactSummary }
    | { status: "unlinked" }
    | { status: "failed" };

/**
 * FAST-01.3a：识别目标裁决。名册读取失败时自动重试一次（清半途状态后再读），仍失败返回
 * failed——调用方必须停止目标选择（零写入），**不得按「普通笔记新建」处理**（会把已绑定
 * 人物的笔记建成重复联系人）；普通笔记（名册正常且未绑定）明确返回 unlinked。
 */
export async function resolveRecognizeTarget(settings: ContactsSettings, rootDocId: string): Promise<RecognizeTargetResolution> {
    const find = async (): Promise<ContactSummary | null> =>
        (await getRoster(settings)).find((item) => item.docId === rootDocId) ?? null;
    try {
        const person = await find();
        return person ? { status: "bound", person } : { status: "unlinked" };
    } catch {
        await new Promise((resolve) => setTimeout(resolve, 600));
    }
    try {
        const person = await find();
        return person ? { status: "bound", person } : { status: "unlinked" };
    } catch {
        return { status: "failed" };
    }
}

export interface CaptureOptions {
    /** 确认要记录互动的已有联系人（文档 ID） */
    personDocIds: readonly string[];
    /** 按名收编的参与者；已存在时复用联系人 */
    newNames: readonly string[];
    /** 场合日期 YYYY-MM-DD，默认今天 */
    date: string;
    place?: string;
    note?: string;
}

export interface CaptureResult {
    createdNames: string[];
    /** 本次新建联系人对应的人物文档 ID，与 createdNames 按顺序对应 */
    createdDocIds: string[];
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
    const occurredAt = birthdayToMs(options.date);
    if (occurredAt === null) throw new Error("场合日期必须是有效的 YYYY-MM-DD 公历日期");

    // 1. 新人入库（重名复用；仅实际创建者计入新建结果）
    const createdNames: string[] = [];
    const createdDocIds: string[] = [];
    const requestedNames = [...new Set(options.newNames.map((name) => name.trim()).filter(Boolean))];
    for (const name of requestedNames) {
        const draft = { ...emptyDraft(), name };
        if (validateDraft(draft).length > 0) continue;
        try {
            const created = await createContact(settings, draft);
            createdNames.push(name);
            createdDocIds.push(created.docId);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (!message.includes("已存在")) throw error;
        }
    }

    // 2. 解析目标（确认的联系人 + 按名收编或复用的参与者）
    invalidateRoster();
    const roster = await getRoster(settings);
    const byDoc = new Map(roster.map((person) => [person.docId, person]));
    const targets: ContactSummary[] = [];
    for (const targetDocId of options.personDocIds) {
        const person = byDoc.get(targetDocId);
        if (person) targets.push(person);
    }
    for (const name of requestedNames) {
        const person = roster.find((item) => item.name === name);
        if (person) targets.push(person);
    }

    // 3. 每人一条互动事件：source=diary，externalRef=笔记 ID（同场身份）；已捕获过的人跳过
    const uniqueTargets = [...new Map(targets.map((person) => [person.docId, person])).values()];
    let interactions = 0;
    const note = composeNote(options);
    for (const person of uniqueTargets) {
        const result = await recordInteractionWithResult(plugin, {
            personDocId: person.docId,
            source: "diary",
            externalRef: docId,
            occurredAt,
            note,
        });
        if (result.recorded) interactions += 1;
    }

    // 4. 笔记写入"参与人员"双链区块（同场人员 >=1 才写）
    let attendeeBlockWritten = false;
    if (uniqueTargets.length > 0) {
        const links = uniqueTargets.map((person) => `[${person.name}](siyuan://blocks/${person.docId})`).join("、");
        const markdown = `**参与人员**（${toLocalDateKey(new Date(occurredAt))}）：${links}`;
        const existingId = await findBlockIdByCustomAttr(docId, ATTENDEES_SECTION_ATTR);
        await upsertMarkedBlock(docId, ATTENDEES_SECTION_ATTR, markdown, existingId);
        attendeeBlockWritten = true;
    }
    invalidateRoster();
    return { createdNames, createdDocIds, interactions, attendeeBlockWritten };
}
