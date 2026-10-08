/**
 * 从笔记捕获人脉（v0.2a 确定性核心）：
 * 一篇会议/聚会笔记 → 识别出链指向的联系人文档 → 每人记录一条互动事件（共享 externalRef=笔记ID，
 * 即"同一场合"身份）→ 笔记里写入"参与人员"双链区块（原生反链可见）。
 * 未入库的新人可同时按名收编。AI 抽取未链接人名是可选增强（ROADMAP v0.2b），不在此层。
 */
import { birthdayToMs, emptyDraft, validateDraft } from "../domain/person";
import type { ContactSummary } from "../domain/person";
import { createDocWithMd, KernelResponseError, KernelPermissionError, newNodeId } from "../api/client";
import { documentHPath, markdownHeading } from "../domain/format";
import { bindDocsAsRows, mapBoundDocIds } from "../api/av";
import { findBlockIdByCustomAttr, findOutgoingLinkRoots, getBlockContent, listNotebookDocs, upsertMarkedBlock } from "../api/blocks";
import {
    buildOccasionMarkdown,
    normalizeOccasionPlace,
    occasionDiaryPath,
    occasionMarkerAttr,
    occasionPlacePath,
} from "../domain/occasion-links";
import { assertContactWriteReady } from "./contacts";
import { getRoster, invalidateRoster } from "./roster";
import { INTERACTION_STORAGE_KEY } from "../data/interactions";
import { loadPersonAliasStore } from "../data/person-aliases";
import { resolvePersonAlias, resolvePersonIdentity } from "../domain/person-aliases";
import { appendEvent, normalizeInteractionStoreForWrite } from "../domain/interactions";
import { beginCaptureCheckpoint, captureCheckpointComplete, captureStageComplete, shouldWriteCaptureProjection } from "../domain/capture-checkpoint";
import type { CaptureCheckpoint, CapturePersonCheckpoint, CaptureProjectionCheckpoint } from "../domain/capture-checkpoint";
import { loadJsonStrict, saveJsonVerified, withStoreLock } from "../data/storage";
import type { Plugin } from "siyuan";
import type { ContactsSettings } from "../domain/model";

export const ATTENDEES_SECTION_ATTR = "custom-lvct-attendees";

export interface CapturePreview {
    docName: string;
    sourceDocId?: string;
    sourceStatus?: "available";
    /** 出链指向、且已在人脉库的联系人 */
    linked: ContactSummary[];
}

export async function previewCapture(settings: ContactsSettings, docId: string): Promise<CapturePreview> {
    const [linkedDocIds, roster, docName] = await Promise.all([
        findOutgoingLinkRoots(docId),
        getRoster(settings),
        getBlockContent(docId),
    ]);
    const linkedSet = new Set(linkedDocIds);
    const linked = roster.filter((person) => linkedSet.has(person.docId));
    if (docName === null || docName === undefined) throw new Error("来源笔记不可达，未生成捕获预览");
    return { docName, linked, sourceDocId: docId, sourceStatus: "available" };
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
    checkpoint?: CaptureCheckpoint;
}

export interface CaptureResult {
    checkpoint: CaptureCheckpoint;
    complete: boolean;
    createdNames: string[];
    /** 本次新建联系人对应的人物文档 ID，与 createdNames 按顺序对应 */
    createdDocIds: string[];
    /** 本次实际新记录的互动条数（同笔记重复捕获为 0） */
    interactions: number;
    attendeeBlockWritten: boolean;
    /** 成功写入的事项投影块数量（来源笔记、日记、地点、人物块） */
    occasionLinksWritten: number;
    /** 事项投影逐项失败，不回滚已经落库的互动事实 */
    occasionLinkFailures: CaptureLinkFailure[];
    dateDocId?: string;
    placeDocId?: string;
}

export interface CaptureLinkFailure {
    target: string;
    message: string;
}

function composeNote(options: CaptureOptions): string | undefined {
    const parts = [
        options.place?.trim() ? `@${options.place.trim()}` : "",
        options.note?.trim() ?? "",
    ].filter((part) => part.length > 0);
    return parts.length > 0 ? parts.join(" ") : undefined;
}

const OCCASION_DOC_PAGE_SIZE = 500;

async function findNotebookDocByPath(notebookId: string, hPath: string): Promise<string | undefined> {
    let offset = 0;
    while (true) {
        const page = await listNotebookDocs(notebookId, OCCASION_DOC_PAGE_SIZE, offset);
        const exact = page.find((doc) => doc.hpath === hPath);
        if (exact) return exact.id;
        if (page.length < OCCASION_DOC_PAGE_SIZE) return undefined;
        offset += page.length;
    }
}

async function ensureOccasionDoc(settings: ContactsSettings, hPath: string, title: string): Promise<string> {
    return withStoreLock(`occasion-docs-${settings.notebookId}`, async () => {
        const existing = await findNotebookDocByPath(settings.notebookId, hPath);
        if (existing) return existing;
        const created = await createDocWithMd(settings.notebookId, hPath, markdownHeading(title));
        if (!/^\d{14}-[0-9a-z]{7}$/.test(created)) throw new Error(`创建文档「${title}」后未返回合法文档 ID`);
        return created;
    });
}

function captureFailureMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function definitelyRejected(error: unknown): boolean {
    return error instanceof KernelResponseError || error instanceof KernelPermissionError;
}

async function resolveCapturePerson(
    settings: ContactsSettings,
    person: CapturePersonCheckpoint,
): Promise<void> {
    let creating = false;
    let binding = false;
    const previous = person.contact;
    try {
        if (!person.personDocId) {
            const errors = validateDraft({ ...emptyDraft(), name: person.name });
            if (errors.length > 0) {
                person.contact = { status: "failed", code: "invalid_name", message: errors.join("；") };
                return;
            }
            await assertContactWriteReady(settings);
            const path = documentHPath(settings.notebookName, person.name);
            person.personDocId = await findNotebookDocByPath(settings.notebookId, path);
            if (!person.personDocId && previous.status === "unknown") {
                person.contact = { status: "unknown", code: "create_unknown", message: "尚未找到上次可能创建的人物文档，请核实内核结果后再试；未再次创建" };
                return;
            }
            if (!person.personDocId) {
                creating = true;
                const created = await createDocWithMd(settings.notebookId, path, markdownHeading(person.name));
                if (!/^\d{14}-[0-9a-z]{7}$/.test(created)) throw new Error("创建人物文档后未返回合法文档 ID");
                person.personDocId = created;
                person.created = true;
                creating = false;
            }
        }
        const content = await getBlockContent(person.personDocId);
        if (content === undefined) {
            person.contact = { status: "failed", code: "person_missing", message: `人物文档 ${person.personDocId} 已失效，请恢复原文档或核对绑定；未按姓名新建` };
            return;
        }
        const mapping = await mapBoundDocIds(settings.avId, [person.personDocId]);
        if (!mapping[person.personDocId]) {
            await assertContactWriteReady(settings);
            binding = true;
            await bindDocsAsRows(settings.avId, settings.dbBlockId, [{ id: person.personDocId, content: person.name }]);
        }
        invalidateRoster();
        const found = (await getRoster(settings)).find((entry) => entry.docId === person.personDocId);
        if (!found) {
            person.contact = { status: "unknown", code: "bind_failed", message: `人物文档 ${person.personDocId} 已保留，数据库行尚未核实；重试只核实或补绑定` };
            return;
        }
        person.name = found.name;
        person.contact = { status: person.created ? "applied" : "skipped" };
    } catch (error) {
        person.contact = {
            status: creating ? definitelyRejected(error) ? "failed" : "unknown" : binding ? "unknown" : "failed",
            code: creating ? definitelyRejected(error) ? "create_rejected" : "create_unknown" : binding ? "bind_failed" : "read_failed",
            message: captureFailureMessage(error),
        };
    }
}

async function recordCapturePerson(
    plugin: Plugin,
    docId: string,
    person: CapturePersonCheckpoint,
    occurredAt: number,
    date: string,
    note: string | undefined,
): Promise<boolean> {
    let sent = false;
    const wasUnknown = person.interaction.status === "unknown";
    try {
        return await withStoreLock(INTERACTION_STORAGE_KEY, async () => {
            const store = normalizeInteractionStoreForWrite(await loadJsonStrict(plugin, INTERACTION_STORAGE_KEY));
            if (person.eventId && store.tombstones.includes(person.eventId)) {
                person.interaction = { status: "failed", code: "interaction_removed", message: "原互动已删除，未恢复旧事实；请核对后另行记录" };
                return false;
            }
            const existing = store.events.find((event) => event.personDocId === person.personDocId
                && event.source === "diary" && event.externalRef === docId);
            if (existing) {
                person.eventId = existing.id;
                person.interaction = { status: "skipped" };
                return false;
            }
            person.eventId ??= newNodeId();
            const next = appendEvent(store, {
                id: person.eventId, personDocId: person.personDocId!, source: "diary", externalRef: docId,
                occurredAt, localDate: date, ...(note ? { note } : {}),
            });
            sent = true;
            await saveJsonVerified(plugin, INTERACTION_STORAGE_KEY, next);
            person.interaction = { status: "applied" };
            return true;
        });
    } catch (error) {
        person.interaction = {
            status: sent || wasUnknown ? "unknown" : "failed",
            code: sent || wasUnknown ? "interaction_unknown" : "interaction_failed",
            message: captureFailureMessage(error),
        };
        return false;
    }
}

export async function captureFromDoc(
    plugin: Plugin,
    settings: ContactsSettings,
    docId: string,
    options: CaptureOptions,
): Promise<CaptureResult> {
    if (!/^\d{14}-[0-9a-z]{7}$/.test(docId)) throw new Error("笔记 ID 不是合法的思源 ID");
    const occurredAt = birthdayToMs(options.date);
    if (occurredAt === null) throw new Error("场合日期必须是有效的 YYYY-MM-DD 公历日期");
    const place = normalizeOccasionPlace(options.place);
    const checkpoint = beginCaptureCheckpoint(docId, `${settings.notebookId}/${settings.avId}/${settings.dbBlockId}`,
        { ...options, place }, newNodeId(), options.checkpoint);
    return withStoreLock(`capture-${settings.avId}-${docId}`, async () => {
        const aliases = await loadPersonAliasStore(plugin);
        try {
            const source = await getBlockContent(docId);
            if (source === null || source === undefined) throw new Error("source unavailable");
        } catch {
            return {
                checkpoint, complete: false, createdNames: [], createdDocIds: [], interactions: 0,
                attendeeBlockWritten: false, occasionLinksWritten: 0,
                occasionLinkFailures: [{ target: "source", message: "来源笔记不可达，未执行本次写入；保留原断点等待核实" }],
            };
        }
        invalidateRoster();
        let roster: ContactSummary[];
        try {
            roster = await getRoster(settings);
        } catch (error) {
            for (const person of checkpoint.people) {
                person.contact = { status: "unknown", code: "read_failed", message: captureFailureMessage(error) };
            }
            return {
                checkpoint, complete: false, createdNames: [], createdDocIds: [], interactions: 0,
                attendeeBlockWritten: false, occasionLinksWritten: 0, occasionLinkFailures: [],
            };
        }
        const byDoc = new Map(roster.map((person) => [person.docId, person]));
        const docCounts = new Map<string, number>();
        for (const person of roster) docCounts.set(person.docId, (docCounts.get(person.docId) ?? 0) + 1);
        for (const person of checkpoint.people) {
            if (person.personDocId) continue;
            const alias = resolvePersonAlias(aliases, person.name);
            const identity = resolvePersonIdentity(aliases, roster, person.name);
            if (identity.status === "unavailable") {
                person.contact = { status: "failed", code: "identity_unavailable", message: "姓名或别名指向未登记或多重绑定人物，请按文档核实；未新建或改绑" };
                continue;
            }
            if (identity.status === "ambiguous") {
                person.contact = { status: "failed", code: alias.status === "missing" ? "name_ambiguous" : "alias_ambiguous", message: `姓名或别名“${person.name}”对应多个人物，请按文档选择` };
                continue;
            }
            const resolvedId = identity.status === "resolved" ? identity.personDocId : undefined;
            if (resolvedId) person.personDocId = resolvedId;
            const preserveUnknown = person.contact.status === "unknown"
                && (person.contact.code === "create_unknown" || person.contact.code === "bind_failed");
            person.contact = preserveUnknown ? person.contact : { status: "pending" };
        }
        let interactions = 0;
        const seen = new Map<string, CapturePersonCheckpoint>();
        const targets: CapturePersonCheckpoint[] = [];
        for (const person of checkpoint.people) {
            if (person.contact.code === "alias_ambiguous" || person.contact.code === "name_ambiguous" || person.contact.code === "identity_unavailable") continue;
            if (person.personDocId && seen.has(person.personDocId)) {
                const first = seen.get(person.personDocId)!;
                person.contact = { ...first.contact };
                person.interaction = { ...first.interaction, ...(captureStageComplete(first.interaction) ? { status: "skipped" as const } : {}) };
                person.eventId = first.eventId;
                continue;
            }
            if (person.personDocId && !person.created && !byDoc.has(person.personDocId)) {
                person.contact = { status: "failed", code: "person_missing", message: `人物 ${person.personDocId} 不在当前名册，未静默跳过或新建` };
                continue;
            }
            if (person.personDocId && byDoc.has(person.personDocId)) {
                if (docCounts.get(person.personDocId) !== 1) {
                    person.contact = { status: "failed", code: "identity_unavailable", message: "人物文档存在多重绑定，未记录或按姓名改绑" };
                    continue;
                }
                try {
                    if (await getBlockContent(person.personDocId) === undefined) {
                        person.contact = { status: "failed", code: "person_missing", message: "原人物文档不可达，未记录或重新创建" };
                        continue;
                    }
                } catch {
                    person.contact = { status: "unknown", code: "read_failed", message: "人物文档读取未核实，未记录互动" };
                    continue;
                }
                person.name = byDoc.get(person.personDocId)!.name;
                person.contact = { status: "applied" };
            } else if (!captureStageComplete(person.contact)) {
                await resolveCapturePerson(settings, person);
            } else {
                try {
                    if (await getBlockContent(person.personDocId!) === undefined) {
                        person.contact = { status: "failed", code: "person_missing", message: `人物文档 ${person.personDocId} 已失效` };
                    }
                } catch (error) {
                    person.contact = { status: "failed", code: "read_failed", message: captureFailureMessage(error) };
                }
            }
            if (person.personDocId) seen.set(person.personDocId, person);
            if (!captureStageComplete(person.contact)) continue;
            if (!captureStageComplete(person.interaction)) {
                if (await recordCapturePerson(plugin, docId, person, occurredAt, options.date, composeNote({ ...options, place }))) interactions += 1;
            }
            if (captureStageComplete(person.interaction)) targets.push(person);
        }
        let occasionLinksWritten = 0;
        const saveProjection = (projection: CaptureProjectionCheckpoint): void => {
            const index = checkpoint.projections.findIndex((entry) => entry.key === projection.key);
            if (index < 0) checkpoint.projections.push(projection);
            else checkpoint.projections[index] = projection;
        };
        const ensureDocument = async (key: string, target: string, path: string, title: string): Promise<string | undefined> => {
            const previous = checkpoint.projections.find((entry) => entry.key === key);
            if (previous?.rootId && captureStageComplete(previous)) return previous.rootId;
            try {
                let rootId: string | undefined;
                if (previous?.status === "unknown") {
                    rootId = await findNotebookDocByPath(settings.notebookId, path);
                    if (!rootId) return undefined;
                } else {
                    rootId = await ensureOccasionDoc(settings, path, title);
                }
                saveProjection({ key, target, rootId, status: "applied" });
                return rootId;
            } catch (error) {
                saveProjection({ key, target, status: definitelyRejected(error) ? "failed" : "unknown",
                    code: definitelyRejected(error) ? "projection_failed" : "projection_unknown", message: captureFailureMessage(error) });
                return undefined;
            }
        };
        let dateDocId: string | undefined;
        let placeDocId: string | undefined;
        if (targets.length > 0) {
            dateDocId = await ensureDocument("diary-doc", "当日日记", occasionDiaryPath(settings.notebookName, options.date), options.date);
            if (place) placeDocId = await ensureDocument("place-doc", `地点「${place}」`, occasionPlacePath(settings.notebookName, place), place);
            const projection = {
                sourceDocId: docId, date: options.date, place, diaryDocId: dateDocId, placeDocId,
                people: targets.map((person) => ({ docId: person.personDocId!, name: person.name })),
            };
            const writeProjection = async (key: string, target: string, rootId: string, attrName: string, markdown: string): Promise<void> => {
                const previous = checkpoint.projections.find((entry) => entry.key === key);
                if (!shouldWriteCaptureProjection(previous, markdown)) return;
                let sent = false;
                try {
                    const existingId = await findBlockIdByCustomAttr(rootId, attrName);
                    if (previous?.status === "unknown" && !existingId) {
                        saveProjection({ key, target, rootId, markdown, status: "unknown", code: "projection_unknown",
                            message: "上次写入尚未核实，未找到原标记块；未再次插入，请核对后重试" });
                        return;
                    }
                    sent = true;
                    await upsertMarkedBlock(rootId, attrName, markdown, existingId);
                    occasionLinksWritten += 1;
                    saveProjection({ key, target, rootId, markdown, status: "applied" });
                } catch (error) {
                    const unknown = previous?.status === "unknown" || sent && !definitelyRejected(error);
                    saveProjection({ key, target, rootId, markdown, status: unknown ? "unknown" : "failed",
                        code: unknown ? "projection_unknown" : "projection_failed", message: captureFailureMessage(error) });
                }
            };
            await writeProjection("source", "原笔记参与人员区块", docId, ATTENDEES_SECTION_ATTR, buildOccasionMarkdown("source", projection));
            if (dateDocId) await writeProjection("diary", "当日日记事项区块", dateDocId, occasionMarkerAttr(docId), buildOccasionMarkdown("diary", projection));
            if (placeDocId) await writeProjection("place", `地点「${place}」事项区块`, placeDocId, occasionMarkerAttr(docId), buildOccasionMarkdown("place", projection));
            for (const person of targets) {
                await writeProjection(`person:${person.personDocId}`, `人物「${person.name}」事项区块`, person.personDocId!,
                    occasionMarkerAttr(docId), buildOccasionMarkdown("person", projection, person.personDocId));
            }
        }
        invalidateRoster();
        const created = checkpoint.people.filter((person) => person.created && person.personDocId);
        return {
            checkpoint, complete: captureCheckpointComplete(checkpoint),
            createdNames: created.map((person) => person.name), createdDocIds: created.map((person) => person.personDocId!),
            interactions, attendeeBlockWritten: captureStageComplete(checkpoint.projections.find((entry) => entry.key === "source") ?? { status: "pending" }),
            occasionLinksWritten,
            occasionLinkFailures: checkpoint.projections.filter((entry) => !captureStageComplete(entry))
                .map((entry) => ({ target: entry.target, message: entry.message ?? "尚未核实" })),
            ...(dateDocId ? { dateDocId } : {}), ...(placeDocId ? { placeDocId } : {}),
        };
    });
}
