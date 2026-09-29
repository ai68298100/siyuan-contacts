/**
 * 人脉工作空间初始化服务：笔记本 → 宿主文档 → 数据库 → 字段 → 双向关联 → 设置落盘。
 *
 * 纪律（D-0019）：整条链**幂等可续建**。任何一步失败后重跑向导，已建成的部分
 * 一律复用、只补缺失，不新建第二份、不删除已有内容——首次引导实故里"第一次失败、
 * 第二次撞同名笔记本"的卡死正是缺这条保证。
 * 识别现场只认「联系人总表」文档内的数据库块，绝不把同名笔记本里的无关数据库当自己的。
 */
import { createDocWithMd, createNotebook, listNotebooks, newNodeId } from "../api/client";
import type { NotebookMeta } from "../api/client";
import { listNotebookDocs } from "../api/blocks";
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
import { normalizeSettings, SETTINGS_STORAGE_KEY, SETTINGS_STORE_VERSION } from "../domain/model";
import type { ContactsSettings } from "../domain/model";
import { loadJson, saveJsonVerified } from "../data/storage";
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
    if (!name) throw new Error("笔记本名不能为空");
    const notebooks = (await listNotebooks()).filter((notebook) => notebook.name === name);
    if (notebooks.length === 0) return { ...EMPTY_SNAPSHOT };

    // 同名可能有多个：优先复用确实装着本插件半成品的那个（含宿主文档/数据库块）
    for (const candidate of notebooks) {
        const docs = await listNotebookDocs(candidate.id);
        const hostDoc = docs.find((doc) => doc.content === HOST_DOC_TITLE || doc.hpath === `/${HOST_DOC_TITLE}`);
        if (!hostDoc) continue;
        const avBlocks = await findAvBlocksInDoc(hostDoc.id);
        if (avBlocks.length === 0) {
            /* 文档复用、数据库新建（首次引导的常规路径） */
            return { notebooks, notebook: candidate, hostDocId: hostDoc.id, dbBlockId: null, avId: null, existingFields: [] };
        }
        /* FUNC-01.8a：不再取首个 AV——列全候选按字段证据评估；列读取失败保持未知
           （matched=0，不采纳），避免把无关库当锚点补列 */
        const evaluated = [];
        for (const block of avBlocks) {
            const columns = await readColumnsOrEmpty(block.avId, block.dbBlockId);
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

/** 预检自身不能因为"数据库尚未物化/锚点失效"而失败：读不回来按"没有可对回字段"处理 */
async function readColumnsOrEmpty(avId: string, dbBlockId: string): Promise<AvColumn[]> {
    try {
        return (await renderView(avId, dbBlockId)).view.columns;
    } catch {
        return [];
    }
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

/**
 * FUNC-01.8 锚点找回：全库只读扫描——所有笔记本中的「联系人总表」文档及其数据库块。
 * 零写入、不创建任何内容；笔记本改名/文档移动后据此在设置页手动重绑，
 * "找不到原锚点"时列表为空，停在预检，绝不自动建第二套数据。
 */
export async function scanAnchorCandidates(): Promise<AnchorCandidate[]> {
    const candidates: AnchorCandidate[] = [];
    for (const notebook of await listNotebooks()) {
        let docs;
        try {
            docs = await listNotebookDocs(notebook.id);
        } catch {
            continue; /* 单个笔记本读取失败不阻断整体扫描 */
        }
        const hostDocs = docs.filter((doc) => doc.content === HOST_DOC_TITLE || doc.hpath === `/${HOST_DOC_TITLE}`);
        for (const hostDoc of hostDocs) {
            let avBlocks;
            try {
                avBlocks = await findAvBlocksInDoc(hostDoc.id);
            } catch {
                continue;
            }
            for (const block of avBlocks) {
                const columns = await readColumnsOrEmpty(block.avId, block.dbBlockId);
                candidates.push({
                    notebookId: notebook.id,
                    notebookName: notebook.name,
                    hostDocId: hostDoc.id,
                    hpath: hostDoc.hpath,
                    dbBlockId: block.dbBlockId,
                    avId: block.avId,
                    matchedFields: reconcileFieldMap(columns).matched,
                });
            }
        }
    }
    return candidates.sort((a, b) => b.matchedFields - a.matchedFields);
}

export async function loadSettings(plugin: Plugin): Promise<ContactsSettings | null> {
    return normalizeSettings(await loadJson(plugin, SETTINGS_STORAGE_KEY));
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
    if (!name) throw new Error("笔记本名不能为空");

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
    onProgress({ key: "wizardStepSelfCreate", values: { name: SELF_PERSON_NAME } });
    try {
        await ensureSelfIdentity(plugin, settings);
    } catch (error) {
        console.warn("[lvct] 本人档案建立失败（初始化继续）", error);
    }

    onProgress({ key: "wizardStepDone" });
    return settings;
}
