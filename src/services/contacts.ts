/**
 * 联系人服务：新建（文档+绑行+写值）与列表查询。
 * 语义决策见 docs/DATA-CONTRACT.md §1.3 与 D-0007。
 */
import { KernelPermissionError, KernelResponseError, listNotebooks, newNodeId } from "../api/client";
import { documentHPath } from "../domain/format";
import { bindDocsAsRows, mapBoundDocIds, renderView, renderViewPage, setCell, unbindRows } from "../api/av";
import type { AvRenderResult, CellValue } from "../api/av";
import { CONTACT_DRAFT_ATTR, listNotebookDocs, NOTEBOOK_DOC_PAGE_SIZE, readMarkedBlocks, readNotebookDocument } from "../api/blocks";
import { ensurePersonRequestDocument } from "./person-document";
import type { VcfDocumentCheckpoint } from "../domain/vcard.ts";
import { withStoreLock } from "../data/storage";
import { discoverAllImportCandidates } from "./import-scan";
import { getRoster, invalidateRoster } from "./roster";
import { enrichContactProfiles } from "./people-profiles";
import { enrichContactAliases } from "./contact-aliases";
import { profileText } from "../domain/people-profiles";
import { rosterFromRender, rosterPageState } from "../domain/roster";
import type { ContactsSettings } from "../domain/model";
import { emptyDraft, validateDraft } from "../domain/person";
import type { ContactDraft, ContactSummary } from "../domain/person";
import { validateFieldMap } from "../domain/fields.ts";
import { buildContactWritePlan, settleContactFieldResult, summarizeContactWriteResults, verifyContactField } from "../domain/contact-write.ts";
import type {
    ContactFieldResult,
    ContactFieldWrite,
    ContactWriteMode,
    ContactWriteReport,
    WritableContactField,
} from "../domain/contact-write.ts";
import { resolveCandidateFields } from "../domain/contact-patch";
import type { CandidateFieldPatch } from "../domain/contact-patch";

const PRESET_GROUPS = ["家人", "朋友", "同事", "同学", "其他"] as const;

interface ContactFieldAttempt {
    docId: string;
    keyId: string;
    write: ContactFieldWrite;
    baseline: ContactFieldWrite;
    result: ContactFieldResult;
    intent?: string;
}

const fieldAttempts = new Map<string, ContactFieldAttempt>();
const contactWriteLock = (settings: ContactsSettings): string => `contact-write-${settings.avId}`;
const fieldAttemptKey = (settings: ContactsSettings, itemId: string, field: WritableContactField): string =>
    JSON.stringify([settings.avId, settings.dbBlockId, itemId, field]);

async function verifiedContactTarget(settings: ContactsSettings, rendered: AvRenderResult, itemId: string, expectedDocId?: string) {
    const people = rosterFromRender(rendered, settings.fieldMap);
    const targets = people.filter((person) => person.itemId === itemId);
    const person = targets.length === 1 ? targets[0] : undefined;
    if (!person?.docId || expectedDocId && person.docId !== expectedDocId
        || people.filter((entry) => entry.docId === person.docId).length !== 1) return undefined;
    const mapping = await mapBoundDocIds(settings.avId, [person.docId]);
    return mapping[person.docId] === itemId ? person : undefined;
}

/** 分页大小（联系人列表客户端分页的块大小） */
export const PAGE_SIZE = 200;

export interface ContactPage {
    people: ContactSummary[];
    page: number;
    pageSize: number;
    total: number;
    hasMore: boolean;
}

export interface ContactPageOptions {
    signal?: AbortSignal;
}

/**
 * 联系人列表的渐进读取入口：首屏和后续页都走已实证的 AV 分页参数。
 * 这里不复用全量名册缓存，避免首屏为了等待全部行而再次触发 pageSize=-1。
 */
export async function listContactPage(
    settings: ContactsSettings,
    page = 1,
    pageSize = PAGE_SIZE,
    query = "",
    options: ContactPageOptions = {},
): Promise<ContactPage> {
    if (!Number.isSafeInteger(page) || page < 1) throw new Error("联系人分页页码必须为正整数");
    if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 500) throw new Error("联系人分页大小必须在 1-500 之间");
    const rendered = await renderViewPage(settings.avId, settings.dbBlockId, {
        page,
        pageSize,
        query: query.trim(),
        signal: options.signal,
    });
    const returnedRows = rendered.view.rows;
    const rowCount = rendered.view.rowCount;
    const responseLooksUnpaged = returnedRows.length > pageSize;
    const pagedRendered = responseLooksUnpaged
        ? { view: { ...rendered.view, rows: returnedRows.slice((page - 1) * pageSize, page * pageSize) } }
        : rendered;
    const rawPeople = rosterFromRender(pagedRendered, settings.fieldMap);
    const total = typeof rowCount === "number" && Number.isSafeInteger(rowCount) && rowCount >= 0
        ? rowCount
        : (page - 1) * pageSize + rawPeople.length;
    const enriched = await enrichContactAliases(await enrichContactProfiles(rawPeople));
    const people = enriched.map((person) => person.profile?.selfDocId === person.docId
        ? { ...person, isSelf: true }
        : person);
    const hasKnownRowCount = typeof rowCount === "number" && Number.isSafeInteger(rowCount) && rowCount >= 0;
    const state = rosterPageState(page, pageSize, total, people.length);
    return {
        people,
        page,
        pageSize,
        total: Math.max(state.total, (page - 1) * pageSize + people.length),
        hasMore: hasKnownRowCount ? state.hasMore : people.length === pageSize,
    };
}

export async function assertContactWriteReady(settings: ContactsSettings, phase: "before" | "after" = "before"): Promise<AvRenderResult> {
    const rendered = await renderView(settings.avId, settings.dbBlockId);
    const problems = validateFieldMap(settings.fieldMap, rendered.view.columns);
    if (problems.length > 0) {
        throw new Error(`字段映射校验失败，${phase === "before" ? "未做任何写入" : "无法核实已发出的写入"}：${problems.map((problem) => problem.message).join("；")}`);
    }
    return rendered;
}

function contactWriteFailureText(report: ContactWriteReport): string {
    return report.unresolved.map((failure) => `${failure.label}（${failure.message}）`).join("、");
}

function cellForContactWrite(write: ContactFieldWrite): CellValue {
    switch (write.field) {
        case "phone":
            return { type: "phone", value: { phone: { content: String(write.value) } } };
        case "email":
            return { type: "email", value: { email: { content: String(write.value) } } };
        case "wechat":
            return { type: "text", value: { text: { content: String(write.value) } } };
        case "website":
            return { type: "url", value: { url: { content: String(write.value) } } };
        case "birthday":
            return {
                type: "date",
                value: {
                    date: write.value === null
                        ? { content: 0, isNotEmpty: false }
                        : { content: Number(write.value), isNotEmpty: true, isNotTime: true },
                },
            };
        case "lunarBirthday":
            return { type: "checkbox", value: { checkbox: { checked: write.value === true } } };
        case "group":
            return {
                type: "select",
                value: { mSelect: String(write.value).trim() ? [{ content: String(write.value).trim(), color: "1" }] : [] },
            };
        case "tags":
            return {
                type: "mSelect",
                value: {
                    mSelect: (Array.isArray(write.value) ? write.value : [])
                        .map((tag, index) => ({ content: String(tag), color: String((index % 9) + 1) })),
                },
            };
    }
}

async function executeContactWritePlan(
    settings: ContactsSettings,
    itemId: string,
    plan: ReturnType<typeof buildContactWritePlan>,
    before: AvRenderResult,
    retry = false,
    expectedDocId?: string,
    intents?: Partial<Record<WritableContactField, string>>,
    canWrite?: () => boolean,
): Promise<ContactWriteReport> {
    const writes: ContactFieldResult[] = [];
    const sent = new Set<WritableContactField>();
    const person = await verifiedContactTarget(settings, before, itemId, expectedDocId);
    const beforeRows = before.view.rows.filter((row) => row.id === itemId);
    const row = person && beforeRows.length === 1 ? beforeRows[0] : undefined;
    const baseline = person ? buildContactWritePlan(person, "edit") : undefined;
    for (const write of plan.writes) {
        const keyId = settings.fieldMap[write.field];
        const attemptKey = fieldAttemptKey(settings, itemId, write.field);
        const previous = fieldAttempts.get(attemptKey);
        const blocked = (message: string): void => { writes.push({ field: write.field, label: write.label, status: "unknown", requestStatus: "not_sent", message }); };
        if (canWrite && !canWrite()) { blocked("编辑窗口已关闭，未发送剩余字段写入；已发出的请求请核实原结果"); continue; }
        if (!row || !person) { blocked("原人物未唯一绑定当前数据库，未发送写入；请核对稳定文档 ID"); continue; }
        if (previous && (retry || previous.result.status === "unknown" || previous.result.status === "failed")) {
            if (previous.docId !== person.docId || previous.keyId !== keyId) {
                blocked("原请求人物或字段绑定已变化，未补写或转移原请求"); continue;
            }
            const original = verifyContactField(previous.write, row, keyId);
            if (original.status === "applied") previous.result = { ...original, requestStatus: previous.result.requestStatus };
            const sameInput = JSON.stringify(previous.write.value) === JSON.stringify(write.value);
            if (!sameInput && (retry || previous.result.status === "unknown")) {
                blocked("输入与未完成原请求不同，请先核实原请求；未发送新值"); continue;
            }
            if (sameInput && previous.result.status === "applied") {
                if (original.status === "applied") writes.push({ ...original, requestStatus: "not_sent" });
                else blocked("原字段曾已核实，但当前值已变化；保留当前值，未回退已完成字段");
                continue;
            }
            if (previous.result.status !== "applied" && previous.result.requestStatus !== "failed") {
                blocked("原写入结果未知，当前回读不匹配不能证明请求未执行；未重发"); continue;
            }
            if (previous.result.status !== "applied" && verifyContactField(previous.baseline, row, keyId).status !== "applied") {
                blocked("明确拒绝后的字段已被其他操作修改，未覆盖当前值"); continue;
            }
        } else if (retry) {
            const checked = verifyContactField(write, row, keyId);
            if (checked.status === "applied") writes.push({ ...checked, requestStatus: "not_sent" });
            else blocked("缺少原字段请求结果，只核实当前值，未重发");
            continue;
        }
        const checked = verifyContactField(write, row, keyId);
        if (checked.status === "applied" || checked.status === "unknown") {
            writes.push({ ...checked, requestStatus: "not_sent" });
            continue;
        }
        const attempt: ContactFieldAttempt = {
            docId: person.docId, keyId, write: structuredClone(write),
            baseline: baseline!.writes.find((entry) => entry.field === write.field)!,
            result: { field: write.field, label: write.label, status: "unknown", requestStatus: "unknown" },
            intent: intents?.[write.field],
        };
        fieldAttempts.set(attemptKey, attempt);
        sent.add(write.field);
        try {
            await setCell(settings.avId, keyId, itemId, cellForContactWrite(write));
            attempt.result = { field: write.field, label: write.label, status: "unknown", requestStatus: "accepted" };
        } catch (error) {
            const rejected = error instanceof KernelResponseError || error instanceof KernelPermissionError;
            attempt.result = {
                field: write.field,
                label: write.label,
                status: rejected ? "failed" : "unknown",
                requestStatus: rejected ? "failed" : "unknown",
                message: error instanceof Error ? error.message : String(error),
            };
        }
        writes.push(attempt.result);
    }
    if (sent.size === 0) {
        return summarizeContactWriteResults(plan.mode, [...plan.skipped, ...writes]);
    }
    try {
        const rendered = await assertContactWriteReady(settings, "after");
        const target = await verifiedContactTarget(settings, rendered, itemId, person!.docId);
        const rows = rendered.view.rows.filter((row) => row.id === itemId);
        const verified = writes.map((result) => {
            if (!sent.has(result.field)) return result;
            const checked = verifyContactField(plan.writes.find((write) => write.field === result.field)!, target && rows.length === 1 ? rows[0] : undefined, settings.fieldMap[result.field]);
            const settled = settleContactFieldResult(checked, result);
            if (sent.has(result.field)) fieldAttempts.get(fieldAttemptKey(settings, itemId, result.field))!.result = settled;
            return settled;
        });
        return summarizeContactWriteResults(plan.mode, [...plan.skipped, ...verified]);
    } catch (error) {
        const message = `写后回读失败，结果未知：${error instanceof Error ? error.message : String(error)}；请核实原请求，未知写入不自动重发`;
        return summarizeContactWriteResults(plan.mode, [...plan.skipped, ...writes.map((result): ContactFieldResult => ({
            ...result, status: result.requestStatus === "not_sent" ? result.status : result.requestStatus === "failed" ? "failed" : "unknown",
            message: result.requestStatus === "not_sent" || result.requestStatus === "failed" ? result.message : message,
        }))]);
    } finally {
        invalidateRoster();
    }
}

/**
 * 全量名册（缓存优先，30s TTL，写操作立即失效）。
 * 搜索/筛选在名册上做客户端过滤——万级以内的字符串过滤远快于反复打内核。
 */
export async function listContacts(settings: ContactsSettings): Promise<ContactSummary[]> {
    const people = await enrichContactAliases(await enrichContactProfiles(await getRoster(settings)));
    // 与分页入口保持一致：所有打开人物详情的入口都必须保留本人标记，
    // 否则首页/全局搜索打开「我自己」时会误显示与我的关系编辑项。
    return people.map((person) => person.profile?.selfDocId === person.docId
        ? { ...person, isSelf: true }
        : person);
}

/** 客户端过滤：搜索词匹配姓名/电话/微信/邮箱/标签 */
export function filterContacts(people: readonly ContactSummary[], query: string, group: string = ""): ContactSummary[] {
    const keyword = query.trim().toLowerCase();
    return people.filter((person) => {
        if (group && person.group !== group) return false;
        if (!keyword) return true;
        return (
            person.name.toLowerCase().includes(keyword) ||
            person.aliasProfile?.state === "known" && person.aliasProfile.values.some((alias) => alias.toLowerCase().includes(keyword)) ||
            person.phone.includes(keyword) ||
            person.wechat.toLowerCase().includes(keyword) ||
            person.email.toLowerCase().includes(keyword) ||
            person.tags.some((tag) => tag.toLowerCase().includes(keyword)) ||
            person.profile && ["family", "work", "education", "relationship"].some((field) =>
                (field === "relationship" ? person.profile?.relationship.state === "known" && person.profile.relationship.labels.length > 0
                    : person.profile?.affiliations.state === "known" && person.profile.affiliations.value[field as "family" | "work" | "education"].length > 0)
                && profileText(person.profile, field as "family" | "work" | "education" | "relationship").toLowerCase().includes(keyword))
        );
    });
}

export interface ContactCreationPreview {
    name: string;
    existing: ContactSummary[];
    unbound: Array<{ docId: string; name: string; hpath: string }>;
}

export class ContactNameAmbiguityError extends Error {
    constructor(readonly preview: ContactCreationPreview) {
        super(`联系人「${preview.name}」已存在同名候选，请选择具体文档或明确创建独立人物；未自动收编`);
        this.name = "ContactNameAmbiguityError";
    }
}

export interface ContactCreationRequest {
    draft: ContactDraft;
    checkpoint: VcfDocumentCheckpoint;
    source: "created" | "selected";
    bindingState: "new" | "unknown" | "rejected" | "verified";
    unresolvedFields?: readonly WritableContactField[];
}

export class ContactCreationError extends Error {
    constructor(message: string, readonly request: ContactCreationRequest, options?: ErrorOptions) {
        super(`${message}；原请求 ${request.checkpoint.requestId}${request.checkpoint.docId ? `，人物文档 ${request.checkpoint.docId}` : ""} 已保留，请核实后续做`, options);
        this.name = "ContactCreationError";
    }
}

export async function previewContactCreation(settings: ContactsSettings, name: string): Promise<ContactCreationPreview> {
    invalidateRoster();
    const existing = (await getRoster(settings)).filter((person) => person.name === name.trim());
    const candidates: ContactCreationPreview["unbound"] = [];
    let afterDocId: string | undefined;
    while (true) {
        const docs = await listNotebookDocs(settings.notebookId, NOTEBOOK_DOC_PAGE_SIZE, 0, afterDocId);
        if (docs.some((doc, index) => (afterDocId && doc.id <= afterDocId) || (index > 0 && doc.id <= docs[index - 1].id))) {
            throw new Error("候选文档分页未前进，未核实完整候选；未创建联系人");
        }
        candidates.push(...docs.filter((doc) => doc.id !== settings.hostDocId && doc.content.trim() === name.trim())
            .map((doc) => ({ docId: doc.id, name: doc.content, hpath: doc.hpath })));
        if (docs.length < NOTEBOOK_DOC_PAGE_SIZE) break;
        afterDocId = docs[docs.length - 1].id;
    }
    const bindings = await mapBoundDocIds(settings.avId, candidates.map((doc) => doc.docId));
    const unbound: ContactCreationPreview["unbound"] = [];
    for (const candidate of candidates) {
        if (!bindings[candidate.docId] && !(await readMarkedBlocks(candidate.docId, "custom-lvct-org")).length) unbound.push(candidate);
    }
    return { name: name.trim(), existing, unbound };
}

export async function createContact(
    settings: ContactsSettings,
    draft: ContactDraft,
    options: { allowSameName?: boolean; reuseDocId?: string; request?: ContactCreationRequest } = {},
): Promise<ContactSummary> {
    const errors = validateDraft(draft);
    if (errors.length > 0) throw new Error(errors.join("；"));
    return withStoreLock(`person-create-${settings.avId}`, async () => {
        await assertContactWriteReady(settings);
        const name = draft.name.trim();
        const path = documentHPath(settings.notebookName, name);
        const draftKey = JSON.stringify(buildContactWritePlan(draft, "create").writes);
        const previous = options.request;
        if (previous && (previous.checkpoint.notebookId !== settings.notebookId || previous.checkpoint.avId !== settings.avId
            || previous.checkpoint.dbBlockId !== settings.dbBlockId || previous.checkpoint.name !== name
            || previous.checkpoint.path !== path || previous.checkpoint.draftKey !== draftKey
            || !["created", "selected"].includes(previous.source)
            || !["new", "unknown", "rejected", "verified"].includes(previous.bindingState))) {
            throw new ContactCreationError("输入或锚点与原请求不同，未创建或改绑", previous);
        }
        if (!previous) {
            const preview = await previewContactCreation(settings, name);
            if (options.reuseDocId) {
                if (!preview.unbound.some((doc) => doc.docId === options.reuseDocId)) throw new Error("所选文档已变化或不在未绑定候选中，请重新核实");
            } else if (!options.allowSameName && (preview.existing.length || preview.unbound.length)) {
                throw new ContactNameAmbiguityError(preview);
            }
        }
        const request: ContactCreationRequest = previous ?? {
            draft: { ...draft, tags: [...draft.tags] },
            checkpoint: { requestId: newNodeId(), notebookId: settings.notebookId, avId: settings.avId, dbBlockId: settings.dbBlockId,
                name, path, draftKey, state: options.reuseDocId ? "verified" : "new", ...(options.reuseDocId ? { docId: options.reuseDocId } : {}) },
            source: options.reuseDocId ? "selected" : "created", bindingState: "new",
        };
        try {
            const docId = request.source === "created"
                ? await ensurePersonRequestDocument(settings, request, CONTACT_DRAFT_ATTR)
                : request.checkpoint.docId!;
            const original = await readNotebookDocument(settings.notebookId, docId);
            if (!original) throw new Error("原人物文档不可达或已移出原笔记本，未创建替代人物");
            let itemId = (await mapBoundDocIds(settings.avId, [docId]))[docId];
            if (request.checkpoint.itemId && itemId !== request.checkpoint.itemId) throw new Error("原文档的绑定行已变化或已解绑，未重绑或补写字段");
            if (!itemId) {
                if (request.bindingState === "unknown" || request.bindingState === "verified") throw new Error("原绑定请求结果未知，未重发绑定；请先核实名册");
                request.bindingState = "unknown";
                let bindingError: unknown;
                try { await bindDocsAsRows(settings.avId, settings.dbBlockId, [{ id: docId, content: original.name }]); }
                catch (error) { bindingError = error; }
                itemId = (await mapBoundDocIds(settings.avId, [docId]))[docId];
                if (!itemId) {
                    if (bindingError instanceof KernelResponseError || bindingError instanceof KernelPermissionError) request.bindingState = "rejected";
                    throw new Error(`绑定数据库${bindingError ? `失败：${bindingError instanceof Error ? bindingError.message : String(bindingError)}` : "未获得行 ID"}`);
                }
            }
            request.checkpoint.itemId = itemId;
            request.bindingState = "verified";
            invalidateRoster();
            const resumingFields = request.unresolvedFields !== undefined;
            const fields = request.unresolvedFields ?? buildContactWritePlan(draft, "create").writes.map((write) => write.field);
            request.unresolvedFields = fields;
            const writeReport = resumingFields
                ? await retryContactFields(settings, itemId, draft, fields, { docId, itemId })
                : await writeDraftCells(settings, itemId, draft, { mode: "create", onlyFields: fields, expected: { docId, itemId } });
            request.unresolvedFields = writeReport.unresolved.map((failure) => failure.field);
            if (!writeReport.complete) throw new Error(`「${name}」资料字段写入失败：${contactWriteFailureText(writeReport)}；数据库行 ${itemId} 已保留`);
            invalidateRoster();
            const matches = (await getRoster(settings)).filter((person) => person.docId === docId && person.itemId === itemId);
            if (matches.length !== 1) throw new Error(`「${name}」已写入但唯一人物回读未核实，请刷新确认`);
            return matches[0];
        } catch (cause) {
            invalidateRoster();
            throw new ContactCreationError(cause instanceof Error ? cause.message : String(cause), request, { cause });
        }
    });
}

/** 草稿 → 单元格写入（不含查重/建行）。vCard 批量导入复用同一套写入语义。
 *  FUNC-01.15：逐字段隔离——单字段失败不阻断其余，返回失败字段清单（含原因）由调用方上浮；
 *  未知请求只核实原证据，明确拒绝才能重试。 */
export async function writeDraftCells(
    settings: ContactsSettings,
    itemId: string,
    draft: ContactDraft,
    options: {
        mode?: ContactWriteMode;
        onlyFields?: readonly WritableContactField[];
        skipReadyCheck?: boolean;
        expected?: Pick<ContactSummary, "docId" | "itemId">;
        canWrite?: () => boolean;
    } = {},
): Promise<ContactWriteReport> {
    const errors = validateDraft(draft);
    if (errors.length > 0) throw new Error(`资料校验失败，未做任何写入：${errors.join("；")}`);
    return withStoreLock(contactWriteLock(settings), async () => {
        if (options.canWrite && !options.canWrite()) throw new Error("编辑窗口已关闭，排队写入未执行");
        const rendered = await assertContactWriteReady(settings);
        const plan = buildContactWritePlan(draft, options.mode ?? "create", options.onlyFields);
        if (options.expected && options.expected.itemId !== itemId) throw new Error("原人物行已变化，未写入");
        return executeContactWritePlan(settings, itemId, plan, rendered, false, options.expected?.docId, undefined, options.canWrite);
    });
}

export { PRESET_GROUPS };

/**
 * 编辑资料：全字段更新（含清空语义）。
 * 空字符串/空数组的写入即清空对应单元格——编辑弹窗依赖此语义。
 * CODE-02.4：写前与新建共用同一套预校验（validateDraft + 真实生日日期）——非法生日/邮箱
 * 在任何写入前拒绝（旧值不被清空）；字段写入逐项隔离，失败清单以复合错误上浮
 * （其余字段已更新，失败字段可直接重试保存补写）。
 */
export async function updateContactFields(
    settings: ContactsSettings, itemId: string, draft: ContactDraft,
    options: { onlyFields?: readonly WritableContactField[]; expected?: Pick<ContactSummary, "docId" | "itemId">; canWrite?: () => boolean } = {},
): Promise<ContactWriteReport> {
    const report = await writeDraftCells(settings, itemId, draft, { ...options, mode: "edit" });
    if (report.applied.length > 0) invalidateRoster();
    return report;
}

export async function retryContactFields(
    settings: ContactsSettings,
    itemId: string,
    draft: ContactDraft,
    fields: readonly WritableContactField[],
    expected?: Pick<ContactSummary, "docId" | "itemId">,
    canWrite?: () => boolean,
): Promise<ContactWriteReport> {
    const errors = validateDraft(draft);
    if (errors.length > 0) throw new Error(`资料校验失败，未做任何写入：${errors.join("；")}`);
    return withStoreLock(contactWriteLock(settings), async () => {
        if (canWrite && !canWrite()) throw new Error("编辑窗口已关闭，排队重试未执行");
        const rendered = await assertContactWriteReady(settings);
        if (expected && expected.itemId !== itemId) throw new Error("原人物行已变化，未重试");
        const report = await executeContactWritePlan(settings, itemId, buildContactWritePlan(draft, "edit", fields), rendered, true, expected?.docId, undefined, canWrite);
        if (report.applied.length > 0) invalidateRoster();
        return report;
    });
}

export interface CandidateFieldApplyResult {
    applied: string[];
    skipped: string[];
    conflicts: string[];
    report: ContactWriteReport;
}

/**
 * FUNC-01.14：AI 资料候选安全写。与 updateContactFields（编辑弹窗全字段语义）不同：
 * 只写补丁字段（其余字段零触碰，并发/他人字段不可能被回退）；写前失效名册回读**最新值**
 * 逐字段裁决（快照后字段被并发改动且与候选不同 → conflict 跳过并提示，不覆盖）；
 * 同一人多字段（电话+邮箱）各写各的互不影响。
 */
export async function applyContactCandidateFields(
    settings: ContactsSettings,
    itemId: string,
    patches: readonly CandidateFieldPatch[],
): Promise<CandidateFieldApplyResult> {
    return withStoreLock(contactWriteLock(settings), async () => {
        invalidateRoster();
        const rendered = await assertContactWriteReady(settings);
        const roster = rosterFromRender(rendered, settings.fieldMap);
        const people = roster.filter((entry) => entry.itemId === itemId);
        const person = people.length === 1 ? people[0] : undefined;
        if (!person) throw new Error("联系人不存在或已解绑，资料候选未写入");
        const outcomes = resolveCandidateFields(
            { phone: person.phone, wechat: person.wechat, email: person.email, website: person.website, birthday: person.birthday },
            patches,
        );
        const draft: ContactDraft = { ...person, tags: [...person.tags] };
        const fields: WritableContactField[] = [];
        for (const outcome of outcomes) {
            if (outcome.action !== "apply") continue;
            draft[outcome.field] = outcome.value;
            fields.push(outcome.field);
        }
        const errors = validateDraft(draft);
        if (errors.length > 0) throw new Error(`资料校验失败，未做任何写入：${errors.join("；")}`);
        const report = fields.length > 0
            ? await executeContactWritePlan(settings, itemId, buildContactWritePlan(draft, "edit", fields), rendered, false, person.docId)
            : summarizeContactWriteResults("edit", []);
        return {
            applied: [...report.applied],
            skipped: outcomes.filter((outcome) => outcome.action === "skip").map((outcome) => outcome.field),
            conflicts: outcomes.filter((outcome) => outcome.action === "conflict").map((outcome) => outcome.field),
            report,
        };
    });
}

/**
 * 从人脉名册移除联系人：只解绑数据库行，保留人物文档内容。
 * 文档仍可在思源中搜索，也可以之后重新收编；这是数据契约 §1.3 的删除语义。
 */
export async function removeContact(settings: ContactsSettings, person: Pick<ContactSummary, "itemId">): Promise<void> {
    await withStoreLock(contactWriteLock(settings), async () => {
        await unbindRows(settings.avId, [person.itemId]);
        invalidateRoster();
    });
}

/** 批量安全移除：只解绑数据库行，保留人物文档和插件互动审计记录。 */
export async function removeContacts(settings: ContactsSettings, itemIds: readonly string[]): Promise<number> {
    const ids = [...new Set(itemIds.map((itemId) => itemId.trim()).filter(Boolean))];
    if (ids.length === 0) return 0;
    return withStoreLock(contactWriteLock(settings), async () => {
        const CHUNK = 200;
        for (let start = 0; start < ids.length; start += CHUNK) {
            await unbindRows(settings.avId, ids.slice(start, start + CHUNK));
        }
        invalidateRoster();
        return ids.length;
    });
}

export interface ContactBatchUpdate {
    itemId: string;
    /** undefined = 不修改；空字符串 = 清空分组 */
    group?: string;
    /** undefined = 不修改；空数组 = 清空标签 */
    tags?: readonly string[];
    tagsToAdd?: readonly string[];
    expected?: Pick<ContactSummary, "docId" | "itemId" | "group">;
}

export interface ContactBatchWriteResult {
    itemId: string;
    report: ContactWriteReport;
}

export interface ContactBatchWriteOptions {
    onlyFieldsByItem?: Readonly<Record<string, readonly WritableContactField[]>>;
    verifyBeforeWrite?: boolean;
}

export async function batchUpdateContacts(
    settings: ContactsSettings,
    updates: readonly ContactBatchUpdate[],
    options: ContactBatchWriteOptions = {},
): Promise<ContactBatchWriteResult[]> {
    if (updates.length === 0) return [];
    const updateLocked = async (update: ContactBatchUpdate): Promise<ContactBatchWriteResult> => {
        const rendered = await assertContactWriteReady(settings);
        const currentPeople = rosterFromRender(rendered, settings.fieldMap);
        const fields: WritableContactField[] = [];
        if (update.group !== undefined) fields.push("group");
        if (update.tags !== undefined || update.tagsToAdd !== undefined) fields.push("tags");
        const current = currentPeople.filter((person) => person.itemId === update.itemId);
        const blocked: ContactFieldResult[] = [];
        if (current.length !== 1 || update.expected && (current[0].docId !== update.expected.docId || update.expected.itemId !== update.itemId)) {
            return { itemId: update.itemId, report: summarizeContactWriteResults("edit", fields.map((field) => ({
                field, label: field === "group" ? "分组" : "标签", status: "unknown", requestStatus: "not_sent", message: "原人物绑定已变化，未发送写入；请重新选择并核对" }))) };
        }
        const retry = Boolean(options.onlyFieldsByItem || options.verifyBeforeWrite);
        if (!retry && update.expected && update.group !== undefined && current[0].group !== update.expected.group && current[0].group !== update.group) {
            blocked.push({ field: "group", label: "分组", status: "failed", requestStatus: "not_sent", message: "分组已被其他操作修改，保留当前值；请重新读取并确认" });
        }
        const draft = {
            ...emptyDraft(),
            group: update.group ?? "",
            tags: update.tagsToAdd !== undefined ? [...new Set([...(current[0]?.tags ?? []), ...update.tagsToAdd])] : [...(update.tags ?? [])],
        };
        const intents: Partial<Record<WritableContactField, string>> = {};
        if (update.tagsToAdd !== undefined) intents.tags = JSON.stringify([...new Set(update.tagsToAdd.map((tag) => tag.trim()).filter(Boolean))].sort());
        let plan = buildContactWritePlan(
            draft,
            "edit",
            (options.onlyFieldsByItem?.[update.itemId] ?? fields).filter((field) => !blocked.some((result) => result.field === field)),
        );
        if (retry && update.tagsToAdd !== undefined) {
            const previous = fieldAttempts.get(fieldAttemptKey(settings, update.itemId, "tags"));
            if (previous && previous.intent === intents.tags) {
                plan = { ...plan, writes: plan.writes.map((write) => write.field === "tags" ? previous.write : write) };
            } else {
                blocked.push({ field: "tags", label: "标签", status: "unknown", requestStatus: "not_sent", message: "缺少原追加标签请求或输入已变化，未重发" });
                plan = { ...plan, writes: plan.writes.filter((write) => write.field !== "tags") };
            }
        }
        return {
            itemId: update.itemId,
            report: summarizeContactWriteResults("edit", [...(await executeContactWritePlan(settings, update.itemId, plan,
                rendered, retry, update.expected?.docId, intents)).results, ...blocked]),
        };
    };
    const results: ContactBatchWriteResult[] = [];
    for (const update of updates) {
        results.push(await withStoreLock(contactWriteLock(settings), () => updateLocked(update)));
    }
    if (results.some((result) => result.report.applied.length > 0)) invalidateRoster();
    return results;
}

/* ---------- 存量文档收编（需求②：把已有"人名"文档批量转为联系人） ---------- */

export interface ImportCandidate {
    docId: string;
    name: string;
    hpath: string;
}

export interface AdoptOptions {
    /** 收编后统一写入的分组；空值表示不写入分组。 */
    group?: string;
    /** 收编后统一追加的标签；空数组表示不写入标签。 */
    tags?: readonly string[];
}

/** 可选笔记本（排除人脉笔记本自己） */
export async function listImportNotebooks(settings: ContactsSettings): Promise<{ id: string; name: string }[]> {
    const notebooks = await listNotebooks();
    return notebooks
        .filter((notebook) => notebook.id !== settings.notebookId)
        .map((notebook) => ({ id: notebook.id, name: notebook.name }));
}

/** 列出可收编候选：某笔记本下的文档，排除已绑定行、排除宿主文档与空名。 */
export async function discoverImportCandidates(
    settings: ContactsSettings,
    notebookId: string,
    keyword: string = "",
    folderPrefix: string = "",
): Promise<ImportCandidate[]> {
    return discoverAllImportCandidates(settings, notebookId, keyword, folderPrefix);
}

/**
 * 批量收编：绑行为联系人（文档标题即主键显示名）。返回成功数。
 * 性能：先一次批量映射过滤已绑定，再按 200/批合并绑定——
 * 500 篇文档 = 1 次映射 + 3 次绑定，而不是 1500 次逐个调用。
 */
export async function adoptDocs(
    settings: ContactsSettings,
    candidates: readonly ImportCandidate[],
    options: AdoptOptions = {},
): Promise<number> {
    if (candidates.length === 0) return 0;
    const boundMap = await mapBoundDocIds(settings.avId, candidates.map((candidate) => candidate.docId));
    const unbound = candidates.filter((candidate) => !boundMap[candidate.docId]);
    const CHUNK = 200;
    for (let start = 0; start < unbound.length; start += CHUNK) {
        const chunk = unbound.slice(start, start + CHUNK);
        await bindDocsAsRows(
            settings.avId,
            settings.dbBlockId,
            chunk.map((candidate) => ({ id: candidate.docId, content: candidate.name })),
        );
    }
    const group = options.group?.trim() ?? "";
    const tags = [...new Set((options.tags ?? []).map((tag) => tag.trim()).filter(Boolean))];
    if (unbound.length > 0 && (group || tags.length > 0)) {
        // 绑定完成后再换算 itemID；一次映射覆盖整批，避免逐文档往返。
        const itemIds = await mapBoundDocIds(settings.avId, unbound.map((candidate) => candidate.docId));
        await batchUpdateContacts(
            settings,
            unbound
                .map((candidate) => itemIds[candidate.docId])
                .filter((itemId): itemId is string => Boolean(itemId))
                .map((itemId) => ({
                    itemId,
                    ...(group ? { group } : {}),
                    ...(tags.length > 0 ? { tags } : {}),
                })),
        );
    }
    invalidateRoster();
    return unbound.length;
}
