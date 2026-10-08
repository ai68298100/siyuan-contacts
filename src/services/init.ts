/**
 * 人脉工作空间初始化服务：笔记本 → 宿主文档 → 数据库 → 字段 → 双向关联 → 设置落盘。
 *
 * 纪律（D-0019）：整条链**幂等可续建**。任何一步失败后重跑向导，已建成的部分
 * 一律复用、只补缺失，不新建第二份、不删除已有内容——首次引导实故里"第一次失败、
 * 第二次撞同名笔记本"的卡死正是缺这条保证。
 * 识别现场只认「联系人总表」文档内的数据库块，绝不把同名笔记本里的无关数据库当自己的。
 */
import { createDocWithMd, createNotebook, listNotebooks, newNodeId } from "../api/client";
import { validateDocumentTitle } from "../domain/format";
import type { NotebookMeta } from "../api/client";
import { countNotebookDocs, listNotebookDocs } from "../api/blocks";
import {
    addField,
    configureSelfRelationTwoWay,
    createDatabaseInDoc,
    findAvBlocksInDoc,
    renderView,
} from "../api/av";
import type { AvColumn } from "../api/av";
import { FIELD_SPECS, fieldSpec, reconcileFieldMap } from "../domain/fields.ts";
import type { FieldKey } from "../domain/fields";
import {
    ANCHOR_SCAN_CURSOR_VERSION,
    isAnchorScanNotebookExhausted,
    isAnchorScanCursor,
} from "../domain/init-plan.ts";
import type { AnchorScanCursor } from "../domain/init-plan";
import { normalizeSettings, SETTINGS_STORAGE_KEY, SETTINGS_STORE_VERSION } from "../domain/model";
import type { ContactsSettings } from "../domain/model";
import { parseRepairSettings } from "../domain/settings-repair";
import { loadJson, loadJsonStrict, saveJsonVerified } from "../data/storage";
import { ensureSelfIdentity, SELF_PERSON_NAME } from "./self-identity";
import type { Plugin } from "siyuan";

/** 进度以 i18n 键 + 插值上报，由向导渲染文案（服务层不产出成品句子） */
export interface InitProgressStep {
    key: string;
    values?: Readonly<Record<string, string | number>>;
}

export type ProgressReporter = (step: InitProgressStep) => void;

export const HOST_DOC_TITLE = "联系人总表";

export interface InitOptions {
    /** 人脉笔记本名 */
    notebookName: string;
    createSelf?: boolean;
}

/** 初始化前的现场快照：向导据此提示"将复用哪些已有内容" */
export interface WorkspaceSnapshot {
    /** 同名笔记本（v3.8.5 实测内核允许重名，故可能是多个） */
    notebooks: NotebookMeta[];
    /** 实际会沿用的笔记本；没有同名时为 null（将新建） */
    notebook: NotebookMeta | null;
    hostDocId: string | null;
    dbBlockId: string | null;
    avId: string | null;
    /** 数据库中已能对回字段契约的列名（按契约顺序） */
    existingFields: string[];
}

const EMPTY_SNAPSHOT: WorkspaceSnapshot = {
    notebooks: [], notebook: null, hostDocId: null, dbBlockId: null, avId: null, existingFields: [],
};

/** 只读预检：同名笔记本 → 其中的「联系人总表」→ 文档内的数据库块与可对回字段 */
export async function inspectWorkspace(notebookName: string): Promise<WorkspaceSnapshot> {
    const name = notebookName.trim();
    const titleError = validateDocumentTitle(notebookName);
    if (titleError) throw new Error(titleError);
    const notebooks = (await listNotebooks()).filter((notebook) => notebook.name === name);
    if (notebooks.length === 0) return { ...EMPTY_SNAPSHOT };

    // 同名可能有多个：优先复用确实装着本插件半成品的那个（含宿主文档/数据库块）
    for (const candidate of notebooks) {
        const hostDoc = await findHostDoc(candidate.id);
        if (!hostDoc) continue;
        const avBlocks = await findAvBlocksInDoc(hostDoc.id);
        if (avBlocks.length === 0) {
            /* 文档复用、数据库新建（首次引导的常规路径） */
            return { notebooks, notebook: candidate, hostDocId: hostDoc.id, dbBlockId: null, avId: null, existingFields: [] };
        }
        /* FUNC-01.8a：不再取首个 AV——列全候选按字段证据评估；列读取失败保持未知并中止
           当前预检，避免把无关库当锚点补列 */
        const evaluated = [];
        for (const block of avBlocks) {
            const columns = await readColumnsStrict(block.avId, block.dbBlockId);
            const reconciled = reconcileFieldMap(columns);
            evaluated.push({ block, matched: reconciled.matched, fields: reconciled.fieldMap });
        }
        const withEvidence = evaluated.filter((entry) => entry.matched > 0);
        if (withEvidence.length === 0) {
            /* 全部 AV 均无字段证据（无关库）：不采纳、不补列——复用文档新建库 */
            return { notebooks, notebook: candidate, hostDocId: hostDoc.id, dbBlockId: null, avId: null, existingFields: [] };
        }
        withEvidence.sort((a, b) => b.matched - a.matched);
        const top = withEvidence[0];
        const tied = withEvidence.filter((entry) => entry.matched === top.matched);
        if (tied.length > 1) {
            /* 歧义：暂停写入供选择——设置页锚点扫描（scanAnchorCandidates）列出全部候选手动重绑 */
            const ids = tied.map((entry) => entry.block.avId).join("、");
            throw new Error(
                `检测到 ${tied.length} 个字段证据相同的候选数据库（${ids}），已暂停初始化以避免写错库；请在 设置 → 数据与字段 → 锚点扫描 中核对后手动重绑，再继续向导`,
            );
        }
        return {
            notebooks,
            notebook: candidate,
            hostDocId: hostDoc.id,
            dbBlockId: top.block.dbBlockId,
            avId: top.block.avId,
            existingFields: FIELD_SPECS
                .filter((spec) => top.fields[spec.key])
                .map((spec) => spec.nameZh),
        };
    }
    return { notebooks, notebook: notebooks[0], hostDocId: null, dbBlockId: null, avId: null, existingFields: [] };
}

/** 初始化预检也必须跨过首 500 篇文档找宿主文档，不能因分页截断误建第二套数据。 */
async function findHostDoc(notebookId: string): Promise<{ id: string; content: string; hpath: string } | undefined> {
    let afterDocId: string | undefined;
    while (true) {
        const docs = await listNotebookDocs(notebookId, ANCHOR_SCAN_PAGE_SIZE, 0, afterDocId);
        const hostDoc = docs.find((doc) => doc.content === HOST_DOC_TITLE || doc.hpath === `/${HOST_DOC_TITLE}`);
        if (hostDoc) return hostDoc;
        if (docs.length < ANCHOR_SCAN_PAGE_SIZE) return undefined;
        afterDocId = docs[docs.length - 1].id;
    }
}

/** 锚点证据读取失败必须保持未知，不能降级成零字段后继续写入。 */
async function readColumnsStrict(avId: string, dbBlockId: string): Promise<AvColumn[]> {
    return (await renderView(avId, dbBlockId)).view.columns;
}

/** FUNC-01.8 锚点候选：全库扫描得到的一处可复用锚点（笔记本 + 宿主文档 + 数据库块） */
export interface AnchorCandidate {
    notebookId: string;
    notebookName: string;
    hostDocId: string;
    /** 宿主文档路径（展示用） */
    hpath: string;
    dbBlockId: string;
    avId: string;
    /** 九字段契约对回的列数（0–9）；越高越可能是本插件的数据 */
    matchedFields: number;
}

export type AnchorScanStatus = "complete" | "truncated" | "blocked";

export interface AnchorScanOptions {
    /** 上一次返回的游标；不传则从全库起点开始 */
    cursor?: AnchorScanCursor;
    /** 单页文档数，服务层会限制在 1–500 */
    pageSize?: number;
    /** 单次调用最多扫描的文档数；达到后返回可继续游标 */
    maxDocuments?: number;
}

export interface AnchorScanIssue {
    kind: "count" | "documents" | "avBlocks" | "columns";
    notebookId: string;
    notebookName: string;
    hostDocId?: string;
    avId?: string;
    message: string;
}

export interface AnchorScanProgress {
    pageSize: number;
    maxDocuments: number;
    notebooksTotal: number;
    notebooksCompleted: number;
    documentsScanned: number;
    documentsScannedThisCall: number;
    totalDocuments: number | null;
    candidatesFound: number;
    currentNotebookId?: string;
    currentNotebookName?: string;
    currentNotebookScanned: number;
    currentNotebookTotal: number | null;
}

export interface AnchorScanResult {
    status: AnchorScanStatus;
    candidates: AnchorCandidate[];
    cursor: AnchorScanCursor | null;
    progress: AnchorScanProgress;
    issues: AnchorScanIssue[];
}

export const ANCHOR_SCAN_PAGE_SIZE = 500;
export const ANCHOR_SCAN_DOCUMENT_LIMIT = 1000;

function normalizeScanOption(value: number | undefined, fallback: number, max: number): number {
    if (value === undefined) return fallback;
    if (!Number.isInteger(value) || value < 1) throw new Error("锚点扫描参数必须是正整数");
    return Math.min(value, max);
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function sameStringArray(left: readonly string[], right: readonly string[]): boolean {
    return left.length === right.length && left.every((value, index) => value === right[index]);
}

/**
 * FUNC-01.8 锚点找回：全库只读扫描——所有笔记本中的「联系人总表」文档及其数据库块。
 * 零写入、不创建任何内容；笔记本改名/文档移动后据此在设置页手动重绑，
 * "找不到原锚点"时列表为空，停在预检，绝不自动建第二套数据。
 */
export async function scanAnchorCandidates(options: AnchorScanOptions = {}): Promise<AnchorScanResult> {
    const pageSize = normalizeScanOption(options.pageSize, ANCHOR_SCAN_PAGE_SIZE, ANCHOR_SCAN_PAGE_SIZE);
    const maxDocuments = normalizeScanOption(options.maxDocuments, ANCHOR_SCAN_DOCUMENT_LIMIT, ANCHOR_SCAN_DOCUMENT_LIMIT);
    const notebooks = (await listNotebooks()).sort((left, right) => left.id.localeCompare(right.id));
    const notebookIds = notebooks.map((notebook) => notebook.id);
    const cursor = options.cursor;
    if (cursor !== undefined) {
        if (!isAnchorScanCursor(cursor) || cursor.version !== ANCHOR_SCAN_CURSOR_VERSION) {
            throw new Error("锚点扫描游标无效，请重新开始扫描");
        }
        if (!sameStringArray(cursor.notebookIds, notebookIds)) {
            throw new Error("笔记本列表已变化，锚点扫描游标失效，请重新开始扫描");
        }
    }

    const totals = new Map<string, number>();
    const issues: AnchorScanIssue[] = [];
    for (const notebook of notebooks) {
        try {
            totals.set(notebook.id, await countNotebookDocs(notebook.id));
        } catch (error) {
            issues.push({
                kind: "count",
                notebookId: notebook.id,
                notebookName: notebook.name,
                message: `无法读取文档总数：${errorMessage(error)}`,
            });
        }
    }
    const totalDocuments = totals.size === notebooks.length
        ? [...totals.values()].reduce((sum, value) => sum + value, 0)
        : null;
    let notebookIndex = cursor ? notebookIds.indexOf(cursor.notebookId) : 0;
    if (notebookIndex < 0) throw new Error("锚点扫描游标指向的笔记本已不存在，请重新开始扫描");
    let afterDocId: string | undefined = cursor?.afterDocId ?? undefined;
    let scannedDocuments = cursor?.scannedDocuments ?? 0;
    let scannedInNotebook = cursor?.scannedInNotebook ?? 0;
    const startingScannedDocuments = scannedDocuments;
    const candidates: AnchorCandidate[] = [];

    const makeCursor = (): AnchorScanCursor => ({
        version: ANCHOR_SCAN_CURSOR_VERSION,
        notebookIds: [...notebookIds],
        notebookId: notebooks[notebookIndex].id,
        afterDocId: afterDocId ?? null,
        scannedDocuments,
        scannedInNotebook,
    });
    const makeProgress = (): AnchorScanProgress => ({
        pageSize,
        maxDocuments,
        notebooksTotal: notebooks.length,
        notebooksCompleted: notebookIndex,
        documentsScanned: scannedDocuments,
        documentsScannedThisCall: scannedDocuments - startingScannedDocuments,
        totalDocuments,
        candidatesFound: candidates.length,
        currentNotebookId: notebooks[notebookIndex]?.id,
        currentNotebookName: notebooks[notebookIndex]?.name,
        currentNotebookScanned: scannedInNotebook,
        currentNotebookTotal: notebooks[notebookIndex] ? (totals.get(notebooks[notebookIndex].id) ?? null) : null,
    });
    const blocked = (issue: AnchorScanIssue, failedAfterDocId: string | undefined, failedScannedDocuments: number, failedScannedInNotebook: number): AnchorScanResult => {
        issues.push(issue);
        afterDocId = failedAfterDocId;
        scannedDocuments = failedScannedDocuments;
        scannedInNotebook = failedScannedInNotebook;
        return {
            status: "blocked",
            candidates: candidates.sort((left, right) => right.matchedFields - left.matchedFields),
            cursor: makeCursor(),
            progress: makeProgress(),
            issues: [...issues],
        };
    };

    while (notebookIndex < notebooks.length) {
        const notebook = notebooks[notebookIndex];
        if (scannedDocuments - startingScannedDocuments >= maxDocuments) {
            return {
                status: "truncated",
                candidates: candidates.sort((left, right) => right.matchedFields - left.matchedFields),
                cursor: makeCursor(),
                progress: makeProgress(),
                issues: [...issues],
            };
        }

        const remaining = maxDocuments - (scannedDocuments - startingScannedDocuments);
        const requestedPageSize = Math.min(pageSize, remaining);
        let docs;
        try {
            docs = await listNotebookDocs(notebook.id, requestedPageSize, 0, afterDocId);
        } catch (error) {
            return blocked({
                kind: "documents",
                notebookId: notebook.id,
                notebookName: notebook.name,
                message: `无法读取文档页，扫描已停在此处：${errorMessage(error)}`,
            }, afterDocId, scannedDocuments, scannedInNotebook);
        }
        if (docs.length === 0) {
            notebookIndex += 1;
            afterDocId = undefined;
            scannedInNotebook = 0;
            continue;
        }

        for (const doc of docs) {
            const isHostDoc = doc.content === HOST_DOC_TITLE || doc.hpath === `/${HOST_DOC_TITLE}`;
            if (isHostDoc) {
                let avBlocks;
                try {
                    avBlocks = await findAvBlocksInDoc(doc.id);
                } catch (error) {
                    return blocked({
                        kind: "avBlocks",
                        notebookId: notebook.id,
                        notebookName: notebook.name,
                        hostDocId: doc.id,
                        message: `无法读取宿主文档中的数据库块，扫描已停在此处：${errorMessage(error)}`,
                    }, afterDocId, scannedDocuments, scannedInNotebook);
                }
                for (const block of avBlocks) {
                    let columns: AvColumn[];
                    try {
                        columns = await readColumnsStrict(block.avId, block.dbBlockId);
                    } catch (error) {
                        return blocked({
                            kind: "columns",
                            notebookId: notebook.id,
                            notebookName: notebook.name,
                            hostDocId: doc.id,
                            avId: block.avId,
                            message: `无法读取数据库字段，扫描已停在此处：${errorMessage(error)}`,
                        }, afterDocId, scannedDocuments, scannedInNotebook);
                    }
                    candidates.push({
                        notebookId: notebook.id,
                        notebookName: notebook.name,
                        hostDocId: doc.id,
                        hpath: doc.hpath,
                        dbBlockId: block.dbBlockId,
                        avId: block.avId,
                        matchedFields: reconcileFieldMap(columns).matched,
                    });
                }
            }
            // 只有宿主文档及其字段全部核实后，才能推进游标和计数。
            // 读取失败时由上面的 blocked() 保留当前文档，重试会从它重新核实，
            // 避免把未知状态伪装成已扫描并漏掉候选。
            scannedDocuments += 1;
            scannedInNotebook += 1;
            afterDocId = doc.id;
            if (scannedDocuments - startingScannedDocuments >= maxDocuments) {
                if (!isAnchorScanNotebookExhausted(docs.length, requestedPageSize)) {
                    return {
                        status: "truncated",
                        candidates: candidates.sort((left, right) => right.matchedFields - left.matchedFields),
                        cursor: makeCursor(),
                        progress: makeProgress(),
                        issues: [...issues],
                    };
                }
            }
        }

        if (isAnchorScanNotebookExhausted(docs.length, requestedPageSize)) {
            notebookIndex += 1;
            afterDocId = undefined;
            scannedInNotebook = 0;
        }
    }

    return {
        status: "complete",
        candidates: candidates.sort((left, right) => right.matchedFields - left.matchedFields),
        cursor: null,
        progress: {
            pageSize,
            maxDocuments,
            notebooksTotal: notebooks.length,
            notebooksCompleted: notebooks.length,
            documentsScanned: scannedDocuments,
            documentsScannedThisCall: scannedDocuments - startingScannedDocuments,
            totalDocuments,
            candidatesFound: candidates.length,
            currentNotebookScanned: 0,
            currentNotebookTotal: null,
        },
        issues: [...issues],
    };
}

export async function loadSettings(plugin: Plugin): Promise<ContactsSettings | null> {
    return normalizeSettings(await loadJson(plugin, SETTINGS_STORAGE_KEY));
}

/**
 * 严格读取当前工作空间设置，并保留“缺失”和“读取失败”的区别。
 *
 * `loadSettings` 仍用于启动时的兼容降级；数据变化事件、恢复入口和任何
 * 可能继续使用数据库锚点的路径应使用此状态读取，避免把 I/O 故障或坏
 * 设置误当成首次初始化。思源在未创建文件时可能返回空字符串，因此空串
 * 与 null/undefined 一样属于明确的 missing 状态。
 */
export type SettingsReadStatus = "missing" | "valid" | "invalid" | "read_failed";

export interface SettingsReadState {
    readonly status: SettingsReadStatus;
    readonly settings: ContactsSettings | null;
    /** 仅 invalid/read_failed 提供；调用方应显示固定类别并按需重试。 */
    readonly error?: Error;
}

export async function readSettingsState(plugin: Plugin): Promise<SettingsReadState> {
    let raw: unknown;
    try {
        raw = await loadJsonStrict(plugin, SETTINGS_STORAGE_KEY);
    } catch (cause) {
        const error = cause instanceof Error ? cause : new Error(String(cause));
        return { status: "read_failed", settings: null, error };
    }
    if (raw === null || raw === undefined || raw === "") {
        return { status: "missing", settings: null };
    }
    const settings = normalizeSettings(raw);
    if (!settings) {
        return { status: "invalid", settings: null };
    }
    try {
        parseRepairSettings(settings);
    } catch {
        return { status: "invalid", settings: null };
    }
    return { status: "valid", settings };
}

export async function persistSettings(plugin: Plugin, settings: ContactsSettings): Promise<void> {
    await saveJsonVerified(plugin, SETTINGS_STORAGE_KEY, settings);
}

/** 幂等初始化：复用已有笔记本/宿主文档/数据库/字段，只补缺失；不删除任何已有内容 */
export async function initializeWorkspace(
    plugin: Plugin,
    options: InitOptions,
    onProgress: ProgressReporter,
): Promise<ContactsSettings> {
    const name = options.notebookName.trim();
    const titleError = validateDocumentTitle(options.notebookName);
    if (titleError) throw new Error(titleError);

    const snapshot = await inspectWorkspace(name);

    let notebook: NotebookMeta;
    if (snapshot.notebook) {
        onProgress({ key: "wizardStepNotebookReuse", values: { name, count: snapshot.notebooks.length } });
        notebook = snapshot.notebook;
    } else {
        onProgress({ key: "wizardStepNotebookCreate", values: { name } });
        notebook = await createNotebook(name);
    }

    let hostDocId = snapshot.hostDocId;
    if (hostDocId) {
        onProgress({ key: "wizardStepDocReuse", values: { name: HOST_DOC_TITLE } });
    } else {
        onProgress({ key: "wizardStepDocCreate", values: { name: HOST_DOC_TITLE } });
        hostDocId = await createDocWithMd(notebook.id, `/${HOST_DOC_TITLE}`, `# ${HOST_DOC_TITLE}\n\n`);
    }

    let avId = snapshot.avId;
    let dbBlockId = snapshot.dbBlockId;
    if (avId && dbBlockId) {
        onProgress({ key: "wizardStepDbReuse" });
    } else {
        onProgress({ key: "wizardStepDbCreate" });
        const created = await createDatabaseInDoc(hostDocId);
        avId = created.avId;
        dbBlockId = created.dbBlockId;
    }

    // 物化调用幂等（v3.8.5 实证）：续建时对已物化的库也安全
    const rendered = await renderView(avId, dbBlockId, "", true);
    const reconciled = reconcileFieldMap(rendered.view.columns);
    const reusedRelated = reconciled.fieldMap.related;

    const fieldMap: Record<FieldKey, string> = {} as Record<FieldKey, string>;
    for (const [key, columnId] of Object.entries(reconciled.fieldMap)) {
        if (columnId) fieldMap[key as FieldKey] = columnId;
    }
    if (reconciled.matched > 0) {
        onProgress({ key: "wizardStepFieldsKept", values: { count: reconciled.matched } });
    }
    let previousKeyId = reconciled.lastColumnId;
    for (const spec of reconciled.missing) {
        onProgress({ key: "wizardStepFieldCreate", values: { name: spec.nameZh } });
        previousKeyId = await addField(avId, spec, spec.nameZh, previousKeyId);
        fieldMap[spec.key] = previousKeyId;
    }

    // 相关人列已按契约复用时，回链列在即双向已配置（重配会再叠一列）——跳过
    const related = fieldSpec("related");
    if (reusedRelated && reconciled.backRelationExists) {
        onProgress({ key: "wizardStepRelationKept" });
    } else {
        onProgress({ key: "wizardStepRelationCreate", values: { name: related.nameZh } });
        await configureSelfRelationTwoWay(
            avId,
            fieldMap.related,
            newNodeId(),
            related.nameZh,
            related.backNameZh ?? "被相关人",
        );
    }

    onProgress({ key: "wizardStepSettings" });
    const settings: ContactsSettings = {
        schemaVersion: SETTINGS_STORE_VERSION,
        notebookId: notebook.id,
        notebookName: notebook.name,
        hostDocId,
        dbBlockId,
        avId,
        fieldMap,
        initializedAt: new Date().toISOString(),
    };
    await persistSettings(plugin, settings);

    /* B11：数据库确认后默认建立首个本人档案「我自己」并标记身份（幂等续建；
       失败不阻断初始化——身份可稍后在设置页指定，B11.3） */
    if (options.createSelf !== false) {
        onProgress({ key: "wizardStepSelfCreate", values: { name: SELF_PERSON_NAME } });
        try {
            await ensureSelfIdentity(plugin, settings);
        } catch (error) {
            onProgress({ key: "wizardStepSelfPending", values: { message: errorMessage(error) } });
        }
    } else {
        onProgress({ key: "wizardStepSelfSkipped" });
    }

    onProgress({ key: "wizardStepDone" });
    return settings;
}
