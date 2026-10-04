import { addField, configureSelfRelationTwoWay, findAvBlocksInDoc, readAttributeViewKeys, renderView } from "../api/av";
import { KernelPermissionError, KernelResponseError, listNotebooks, newNodeId } from "../api/client";
import { readNotebookDocument } from "../api/blocks";
import { FIELD_SPECS, fieldSpec, validateFieldMap } from "../domain/fields.ts";
import type { AvColumnLike, FieldKey } from "../domain/fields.ts";
import type { ContactsSettings } from "../domain/model";
import { assertRepairCheckpointColumns, assertRepairCheckpointSettings, assertRepairColumns, parseRepairSettings,
    repairColumnsSignature, repairCompleteFieldMap, repairSettingsSignature, verifyRepairRelation } from "../domain/settings-repair.ts";
import type { SettingsRepairCheckpoint, SettingsRepairStep } from "../domain/settings-repair.ts";
import { loadRepairSettings, loadSettingsRepairCheckpoint, saveRepairSettings, saveSettingsRepairCheckpoint, SETTINGS_REPAIR_LOCK_KEY } from "../data/settings-repair.ts";
import { withStoreLock } from "../data/storage";
import { invalidateRoster } from "./roster";
import type { Plugin } from "siyuan";

export interface MissingField { key: string; expectedName: string; keyId: string; type: string }
export interface HealthColumn { id: string; name: string; type: string }
export interface SettingsHealth {
    ok: boolean;
    columns: number;
    missing: MissingField[];
    problems: { key: string; message: string }[];
    availableColumns: HealthColumn[];
}

export type SettingsAnchors = Pick<ContactsSettings, "notebookId" | "hostDocId" | "dbBlockId" | "avId">;
export type SettingsAnchorPatch = Pick<ContactsSettings, "hostDocId" | "dbBlockId" | "avId"> & Partial<Pick<ContactsSettings, "notebookId">>;
export type FieldMapPatch = Partial<ContactsSettings["fieldMap"]>;
export type SettingsRepairAlive = () => boolean;

function anchorsOf(settings: ContactsSettings): SettingsAnchors {
    return Object.freeze({ notebookId: settings.notebookId, hostDocId: settings.hostDocId, dbBlockId: settings.dbBlockId, avId: settings.avId });
}

export class FieldRebuildPreview {
    readonly settingsFingerprint: string;
    readonly anchors: SettingsAnchors;
    constructor(readonly source: ContactsSettings, readonly columns: readonly HealthColumn[], readonly missing: readonly MissingField[],
        readonly steps: readonly Readonly<SettingsRepairStep>[], readonly requestId?: string) {
        this.settingsFingerprint = repairSettingsSignature(source);
        this.anchors = anchorsOf(source);
        Object.freeze(source.fieldMap);
        Object.freeze(source);
        for (const column of columns) Object.freeze(column);
        for (const field of missing) Object.freeze(field);
        for (const step of steps) Object.freeze(step);
        Object.freeze(columns);
        Object.freeze(missing);
        Object.freeze(steps);
        Object.freeze(this);
    }
}

export interface RebindFieldImpact { key: FieldKey; previousKeyId?: string; targetKeyId: string; changed: boolean }

export class SettingsRebindPreview {
    readonly settingsFingerprint: string;
    readonly previous: SettingsAnchors;
    readonly matchedFields: number;
    readonly missingFields: readonly string[];
    constructor(readonly source: ContactsSettings, readonly target: ContactsSettings, readonly columns: readonly HealthColumn[],
        readonly notebookName: string, readonly hostDocName: string, readonly impacts: readonly RebindFieldImpact[]) {
        this.settingsFingerprint = repairSettingsSignature(source);
        this.previous = anchorsOf(source);
        this.matchedFields = impacts.length;
        this.missingFields = Object.freeze([]);
        Object.freeze(source.fieldMap);
        Object.freeze(source);
        Object.freeze(target.fieldMap);
        Object.freeze(target);
        for (const column of columns) Object.freeze(column);
        for (const impact of impacts) Object.freeze(impact);
        Object.freeze(columns);
        Object.freeze(impacts);
        Object.freeze(this);
    }
}

const missingPreviews = new WeakSet<FieldRebuildPreview>();
const rebindPreviews = new WeakSet<SettingsRebindPreview>();

export class SettingsRepairUnknownError extends Error {
    constructor(message: string, readonly checkpoint: SettingsRepairCheckpoint, options?: ErrorOptions) {
        super(`${message}；原补列请求 ${checkpoint.requestId} 已保留，请只核实原列 ID`, options);
        this.name = "SettingsRepairUnknownError";
    }
}

function assertAlive(isAlive?: SettingsRepairAlive): void {
    if (isAlive && !isAlive()) throw new Error("页面已关闭，排队设置操作未执行");
}

function assertSameSettings(expected: ContactsSettings, actual: ContactsSettings): void {
    if (repairSettingsSignature(expected) !== repairSettingsSignature(actual)) throw new Error("设置已变化，请重新读取和预览；未覆盖最新设置");
}

async function readVerifiedAnchor(settings: ContactsSettings): Promise<{ columns: HealthColumn[]; notebookName: string; hostDocName: string }> {
    parseRepairSettings(settings);
    const notebooks = (await listNotebooks()).filter((notebook) => notebook.id === settings.notebookId);
    if (notebooks.length !== 1) throw new Error("目标笔记本未唯一核实，设置操作已停止");
    const doc = await readNotebookDocument(settings.notebookId, settings.hostDocId);
    if (!doc) throw new Error("宿主文档不属于明确指定的笔记本或已删除，设置操作已停止");
    const blocks = await findAvBlocksInDoc(settings.hostDocId);
    const matches = blocks.filter((block) => block.dbBlockId === settings.dbBlockId || block.avId === settings.avId);
    if (matches.length !== 1 || matches[0].hostDocId !== settings.hostDocId
        || matches[0].dbBlockId !== settings.dbBlockId || matches[0].avId !== settings.avId) throw new Error("宿主文档、数据库块与 AV 归属不一致或多重绑定，设置操作已停止");
    const rendered = await renderView(settings.avId, settings.dbBlockId);
    assertRepairColumns(rendered.view.columns);
    return { columns: rendered.view.columns.map(({ id, name, type }) => ({ id, name, type })),
        notebookName: notebooks[0].name, hostDocName: doc.name };
}

export async function checkSettingsHealth(settings: ContactsSettings): Promise<SettingsHealth> {
    const rendered = await renderView(settings.avId, settings.dbBlockId);
    assertRepairColumns(rendered.view.columns);
    const columnIds = new Set(rendered.view.columns.map((column) => column.id));
    const missing = FIELD_SPECS.filter((spec) => !columnIds.has(settings.fieldMap[spec.key])).map((spec) => ({
        key: spec.key, expectedName: spec.nameZh, keyId: settings.fieldMap[spec.key] ?? "（未记录）", type: spec.type,
    }));
    const problems = validateFieldMap(settings.fieldMap, rendered.view.columns).filter((problem) => !problem.message.includes("缺少列映射"))
        .map((problem) => ({ key: problem.key as string, message: problem.message }));
    return { ok: missing.length === 0 && problems.length === 0, columns: rendered.view.columns.length, missing, problems,
        availableColumns: rendered.view.columns.map(({ id, name, type }) => ({ id, name, type })) };
}

export async function repairFieldMap(plugin: Plugin, settings: ContactsSettings, patch: FieldMapPatch, isAlive?: SettingsRepairAlive): Promise<ContactsSettings> {
    const submitted = { ...patch };
    const expected = parseRepairSettings(settings);
    return withStoreLock(SETTINGS_REPAIR_LOCK_KEY, async () => {
        assertAlive(isAlive);
        const current = await loadRepairSettings(plugin);
        assertSameSettings(expected, current);
        const { columns } = await readVerifiedAnchor(current);
        const updated = repairCompleteFieldMap(current, submitted, columns);
        assertSameSettings(current, await loadRepairSettings(plugin));
        assertAlive(isAlive);
        await saveRepairSettings(plugin, updated);
        invalidateRoster();
        return updated;
    });
}

function assertResumableCaller(settings: ContactsSettings, current: ContactsSettings, checkpoint: SettingsRepairCheckpoint): void {
    if (repairSettingsSignature(settings) !== repairSettingsSignature(current)) assertSameSettings(settings, checkpoint.source);
    assertRepairCheckpointSettings(checkpoint, current);
}

function missingFor(settings: ContactsSettings, columns: readonly AvColumnLike[]): MissingField[] {
    const ids = new Set(columns.map((column) => column.id));
    const missing = FIELD_SPECS.filter((spec) => !ids.has(settings.fieldMap[spec.key]));
    const problems = validateFieldMap(settings.fieldMap, columns).filter((problem) => !missing.some((spec) => spec.key === problem.key && problem.message.includes("不存在"))
        && !problem.message.includes("缺少列映射"));
    if (problems.length) throw new Error(problems.map((problem) => problem.message).join("；"));
    return missing.map((spec) => ({ key: spec.key, expectedName: spec.nameZh, keyId: settings.fieldMap[spec.key] ?? "", type: spec.type }));
}

export async function previewMissingFields(plugin: Plugin, settings: ContactsSettings): Promise<FieldRebuildPreview> {
    const expected = parseRepairSettings(settings);
    return withStoreLock(SETTINGS_REPAIR_LOCK_KEY, async () => {
        const current = await loadRepairSettings(plugin);
        const checkpoint = await loadSettingsRepairCheckpoint(plugin);
        const resume = checkpoint && !checkpoint.complete;
        if (resume) assertResumableCaller(expected, current, checkpoint);
        else assertSameSettings(expected, current);
        const { columns } = await readVerifiedAnchor(current);
        if (resume) assertRepairCheckpointColumns(checkpoint, columns);
        const missing = missingFor(current, columns);
        assertSameSettings(current, await loadRepairSettings(plugin));
        const preview = new FieldRebuildPreview(parseRepairSettings(current), columns, missing,
            resume ? checkpoint.steps.map((step) => ({ ...step })) : [], resume ? checkpoint.requestId : undefined);
        missingPreviews.add(preview);
        return preview;
    });
}

function makeCheckpoint(preview: FieldRebuildPreview): SettingsRepairCheckpoint {
    let previousKeyId = preview.columns.at(-1)?.id ?? "";
    const steps = preview.missing.map((missing): SettingsRepairStep => {
        const field = missing.key as FieldKey;
        const keyId = newNodeId();
        const step: SettingsRepairStep = { field, keyId, previousKeyId, columnState: "pending", mapped: false,
            ...(field === "related" ? { backKeyId: newNodeId(), relationState: "pending" as const } : {}) };
        previousKeyId = keyId;
        return step;
    });
    return { schemaVersion: 1, requestId: newNodeId(), source: parseRepairSettings(preview.source),
        columns: preview.columns.map((column) => ({ ...column })), steps, complete: false };
}

async function readStepColumns(checkpoint: SettingsRepairCheckpoint): Promise<HealthColumn[]> {
    const columns = (await readVerifiedAnchor(checkpoint.source)).columns;
    assertRepairCheckpointColumns(checkpoint, columns);
    return columns;
}

async function ensureRepairColumn(plugin: Plugin, checkpoint: SettingsRepairCheckpoint, step: SettingsRepairStep, isAlive?: SettingsRepairAlive): Promise<void> {
    const spec = fieldSpec(step.field);
    let columns = await readStepColumns(checkpoint);
    let column = columns.find((entry) => entry.id === step.keyId);
    if (!column) {
        if (step.columnState === "unknown" || step.columnState === "verified") throw new SettingsRepairUnknownError("原列尚未核实，未再次建列", checkpoint);
        assertAlive(isAlive);
        step.columnState = "unknown";
        await saveSettingsRepairCheckpoint(plugin, checkpoint);
        let requestError: unknown;
        try { await addField(checkpoint.source.avId, spec, spec.nameZh, step.previousKeyId, step.keyId); }
        catch (error) {
            requestError = error;
            if (error instanceof KernelPermissionError || error instanceof KernelResponseError) {
                step.columnState = "rejected";
                await saveSettingsRepairCheckpoint(plugin, checkpoint);
            }
        }
        try { columns = await readStepColumns(checkpoint); }
        catch (cause) { throw new SettingsRepairUnknownError("建列后读取失败，保留原 ID", checkpoint, { cause }); }
        column = columns.find((entry) => entry.id === step.keyId);
        if (!column) {
            if (step.columnState === "rejected") throw new Error(`内核明确拒绝 ${spec.nameZh} 建列，原 ID 可显式重试`, { cause: requestError });
            throw new SettingsRepairUnknownError("建列请求结果未知，未重发", checkpoint, { cause: requestError });
        }
    }
    if (column.type !== spec.type) throw new SettingsRepairUnknownError("原列类型已变化，未建立替代列", checkpoint);
    if (step.columnState !== "verified") {
        step.columnState = "verified";
        await saveSettingsRepairCheckpoint(plugin, checkpoint);
    }
}

async function ensureRepairRelation(plugin: Plugin, checkpoint: SettingsRepairCheckpoint, step: SettingsRepairStep, isAlive?: SettingsRepairAlive): Promise<void> {
    if (step.field !== "related" || !step.backKeyId) return;
    const read = async () => verifyRepairRelation(await readAttributeViewKeys(checkpoint.source.avId), checkpoint.source.avId, step.keyId, step.backKeyId!);
    if (!await read()) {
        if (step.relationState === "unknown" || step.relationState === "verified") throw new SettingsRepairUnknownError("原回链尚未核实，未再次配置", checkpoint);
        assertAlive(isAlive);
        step.relationState = "unknown";
        await saveSettingsRepairCheckpoint(plugin, checkpoint);
        let requestError: unknown;
        try { await configureSelfRelationTwoWay(checkpoint.source.avId, step.keyId, step.backKeyId, fieldSpec("related").nameZh, fieldSpec("related").backNameZh!); }
        catch (error) {
            requestError = error;
            if (error instanceof KernelPermissionError || error instanceof KernelResponseError) {
                step.relationState = "rejected";
                await saveSettingsRepairCheckpoint(plugin, checkpoint);
            }
        }
        try {
            if (!await read()) {
                if (step.relationState === "rejected") throw new Error("内核明确拒绝回链配置，原回链 ID 可显式重试", { cause: requestError });
                throw new SettingsRepairUnknownError("回链配置结果未知，未重发", checkpoint, { cause: requestError });
            }
        } catch (cause) {
            if (step.relationState === "rejected" && !(cause instanceof SettingsRepairUnknownError)) throw cause;
            throw new SettingsRepairUnknownError("双向配置未核实，未重建回链", checkpoint, { cause });
        }
    }
    const columns = await readStepColumns(checkpoint);
    if (!columns.some((column) => column.id === step.backKeyId && column.type === "relation")) throw new SettingsRepairUnknownError("回链未出现在原 AV 渲染列中", checkpoint);
    if (step.relationState !== "verified") {
        step.relationState = "verified";
        await saveSettingsRepairCheckpoint(plugin, checkpoint);
    }
}

export async function rebuildMissingFields(plugin: Plugin, settings: ContactsSettings, preview?: FieldRebuildPreview, isAlive?: SettingsRepairAlive): Promise<ContactsSettings> {
    if (!preview || !missingPreviews.has(preview)) throw new Error("补列需要显式确认只读预览，尚未执行任何写入");
    const expected = parseRepairSettings(settings);
    return withStoreLock(SETTINGS_REPAIR_LOCK_KEY, async () => {
        assertAlive(isAlive);
        let current = await loadRepairSettings(plugin);
        let checkpoint = await loadSettingsRepairCheckpoint(plugin);
        if (checkpoint && (checkpoint.requestId === preview.requestId || repairSettingsSignature(checkpoint.source) === repairSettingsSignature(preview.source))) {
            if (!preview.requestId && (repairColumnsSignature(preview.columns) !== repairColumnsSignature(checkpoint.columns)
                || JSON.stringify(preview.missing.map((field) => field.key)) !== JSON.stringify(checkpoint.steps.map((step) => step.field)))) throw new Error("补列确认范围与原断点不一致，请重新预览");
            assertResumableCaller(expected, current, checkpoint);
            await readStepColumns(checkpoint);
        } else {
            if (checkpoint && !checkpoint.complete) throw new Error("另一个补列请求尚未完成，未覆盖原断点");
            assertSameSettings(expected, current);
            assertSameSettings(preview.source, current);
            const { columns } = await readVerifiedAnchor(current);
            if (repairColumnsSignature(columns) !== repairColumnsSignature(preview.columns)
                || JSON.stringify(missingFor(current, columns)) !== JSON.stringify(preview.missing)) throw new Error("补列预览已过期，请重新预览");
            if (!preview.missing.length) return current;
            checkpoint = makeCheckpoint(preview);
            assertAlive(isAlive);
            await saveSettingsRepairCheckpoint(plugin, checkpoint);
        }
        for (const step of checkpoint.steps) {
            current = await loadRepairSettings(plugin);
            assertRepairCheckpointSettings(checkpoint, current);
            assertAlive(isAlive);
            await ensureRepairColumn(plugin, checkpoint, step, isAlive);
            await ensureRepairRelation(plugin, checkpoint, step, isAlive);
            current = await loadRepairSettings(plugin);
            assertRepairCheckpointSettings(checkpoint, current);
            if (current.fieldMap[step.field] !== step.keyId) {
                const updated = { ...current, fieldMap: { ...current.fieldMap, [step.field]: step.keyId } };
                const columns = await readStepColumns(checkpoint);
                const problems = validateFieldMap(updated.fieldMap, columns).filter((problem) => !checkpoint!.steps.some((pending) => pending.field === problem.key && !pending.mapped && pending.field !== step.field)
                    || problem.message.includes("重复"));
                if (problems.length) throw new Error(problems.map((problem) => problem.message).join("；"));
                assertSameSettings(current, await loadRepairSettings(plugin));
                await saveRepairSettings(plugin, updated);
                current = updated;
                invalidateRoster();
            }
            if (!step.mapped) {
                step.mapped = true;
                checkpoint.complete = checkpoint.steps.every((entry) => entry.mapped);
                await saveSettingsRepairCheckpoint(plugin, checkpoint);
            }
        }
        return current;
    });
}

function normalizeAnchorPatch(settings: ContactsSettings, patch: SettingsAnchorPatch): ContactsSettings {
    const anchors = { notebookId: patch.notebookId === undefined ? settings.notebookId : patch.notebookId.trim(),
        hostDocId: patch.hostDocId.trim(), dbBlockId: patch.dbBlockId.trim(), avId: patch.avId.trim() };
    return parseRepairSettings({ ...settings, ...anchors });
}

function rebindMap(settings: ContactsSettings, columns: readonly AvColumnLike[]): ContactsSettings["fieldMap"] {
    const fieldMap = {} as Record<FieldKey, string>;
    const used = new Set<string>();
    for (const spec of FIELD_SPECS) {
        const original = columns.filter((column) => column.id === settings.fieldMap[spec.key] && column.type === spec.type);
        const candidates = original.length ? original : columns.filter((column) => column.type === spec.type && (column.name === spec.nameZh || column.name === spec.nameEn));
        if (candidates.length !== 1 || used.has(candidates[0].id)) throw new Error(`${spec.nameZh} 目标映射不唯一或缺失，请核对完整字段结构`);
        fieldMap[spec.key] = candidates[0].id;
        used.add(candidates[0].id);
    }
    return fieldMap;
}

async function assertRebindRelation(target: ContactsSettings, columns: readonly AvColumnLike[]): Promise<void> {
    const keys = await readAttributeViewKeys(target.avId);
    const related = keys.filter((key) => key.id === target.fieldMap.related);
    const relation = related.length === 1 ? related[0].relation : undefined;
    if (!relation || typeof relation !== "object" || Array.isArray(relation)) throw new Error("目标相关人双向配置未知，未切换数据库");
    const backKeyId = (relation as Record<string, unknown>).backKeyID;
    if (typeof backKeyId !== "string" || !backKeyId || backKeyId === target.fieldMap.related
        || !columns.some((column) => column.id === backKeyId && column.type === "relation")
        || !verifyRepairRelation(keys, target.avId, target.fieldMap.related, backKeyId)) throw new Error("目标相关人及回链未核实，未切换数据库");
}

export async function previewRebindSettings(plugin: Plugin, settings: ContactsSettings, patch: SettingsAnchorPatch): Promise<SettingsRebindPreview> {
    const expected = parseRepairSettings(settings);
    const targetAnchors = normalizeAnchorPatch(expected, patch);
    return withStoreLock(SETTINGS_REPAIR_LOCK_KEY, async () => {
        const current = await loadRepairSettings(plugin);
        assertSameSettings(expected, current);
        const evidence = await readVerifiedAnchor(targetAnchors);
        const fieldMap = rebindMap(current, evidence.columns);
        const target = { ...targetAnchors, notebookName: evidence.notebookName, fieldMap };
        await assertRebindRelation(target, evidence.columns);
        assertSameSettings(current, await loadRepairSettings(plugin));
        const preview = new SettingsRebindPreview(current, target, evidence.columns, evidence.notebookName, evidence.hostDocName,
            FIELD_SPECS.map((spec) => ({ key: spec.key, previousKeyId: current.fieldMap[spec.key], targetKeyId: fieldMap[spec.key], changed: current.fieldMap[spec.key] !== fieldMap[spec.key] })));
        rebindPreviews.add(preview);
        return preview;
    });
}

export async function rebindSettings(plugin: Plugin, settings: ContactsSettings, patch: SettingsAnchorPatch, preview?: SettingsRebindPreview, isAlive?: SettingsRepairAlive): Promise<ContactsSettings> {
    if (!preview || !rebindPreviews.has(preview)) throw new Error("重绑需要显式确认只读预览，尚未写入设置");
    const expected = parseRepairSettings(settings);
    const targetAnchors = normalizeAnchorPatch(expected, patch);
    return withStoreLock(SETTINGS_REPAIR_LOCK_KEY, async () => {
        assertAlive(isAlive);
        const current = await loadRepairSettings(plugin);
        assertSameSettings(expected, current);
        assertSameSettings(preview.source, current);
        for (const key of ["notebookId", "hostDocId", "dbBlockId", "avId"] as const) {
            if (targetAnchors[key] !== preview.target[key]) throw new Error("重绑目标已变化，请重新预览");
        }
        const evidence = await readVerifiedAnchor(targetAnchors);
        const fieldMap = rebindMap(current, evidence.columns);
        await assertRebindRelation({ ...targetAnchors, fieldMap }, evidence.columns);
        if (repairColumnsSignature(evidence.columns) !== repairColumnsSignature(preview.columns)
            || evidence.hostDocName !== preview.hostDocName || evidence.notebookName !== preview.notebookName
            || JSON.stringify(fieldMap) !== JSON.stringify(preview.target.fieldMap)) throw new Error("重绑预览已过期，请重新核对目标归属与字段影响");
        assertSameSettings(current, await loadRepairSettings(plugin));
        assertAlive(isAlive);
        const updated = { ...current, ...targetAnchors, notebookName: evidence.notebookName, fieldMap };
        await saveRepairSettings(plugin, updated);
        invalidateRoster();
        return updated;
    });
}
