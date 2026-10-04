import { FIELD_SPECS, validateFieldMap } from "./fields.ts";
import type { AvColumnLike, FieldKey } from "./fields.ts";
import type { ContactsSettings } from "./model.ts";

export const SETTINGS_REPAIR_STORAGE_KEY = "settings-repair-checkpoint.json";
export const SETTINGS_REPAIR_VERSION = 1;
export type SettingsRepairState = "pending" | "unknown" | "rejected" | "verified";

export interface SettingsRepairStep {
    field: FieldKey;
    keyId: string;
    previousKeyId: string;
    backKeyId?: string;
    columnState: SettingsRepairState;
    relationState?: SettingsRepairState;
    mapped: boolean;
}

export interface SettingsRepairCheckpoint {
    schemaVersion: 1;
    requestId: string;
    source: ContactsSettings;
    columns: AvColumnLike[];
    steps: SettingsRepairStep[];
    complete: boolean;
}

function record(value: unknown, label: string): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label}损坏，未修改原文件`);
    return value as Record<string, unknown>;
}

export function parseRepairSettings(raw: unknown): ContactsSettings {
    const source = record(raw, "设置");
    if (source.schemaVersion !== 1) throw new Error("设置版本未知，修复已停止");
    for (const key of ["notebookId", "hostDocId", "dbBlockId", "avId"] as const) {
        if (typeof source[key] !== "string" || !/^\d{14}-[0-9a-z]{7}$/.test(source[key])) throw new Error(`设置 ${key} 非法，修复已停止`);
    }
    for (const key of ["notebookName", "initializedAt"] as const) {
        if (typeof source[key] !== "string" || !source[key].trim()) throw new Error(`设置 ${key} 缺失，修复已停止`);
    }
    const rawMap = record(source.fieldMap, "字段映射");
    const fieldMap: Partial<Record<FieldKey, string>> = {};
    for (const [key, value] of Object.entries(rawMap)) {
        if (!FIELD_SPECS.some((spec) => spec.key === key) || typeof value !== "string" || !value.trim()) throw new Error("字段映射损坏，修复已停止");
        fieldMap[key as FieldKey] = value;
    }
    return { schemaVersion: 1, notebookId: source.notebookId as string, notebookName: source.notebookName as string,
        hostDocId: source.hostDocId as string, dbBlockId: source.dbBlockId as string, avId: source.avId as string,
        initializedAt: source.initializedAt as string, fieldMap: fieldMap as ContactsSettings["fieldMap"] };
}

export function repairSettingsSignature(settings: ContactsSettings): string {
    const parsed = parseRepairSettings(settings);
    return JSON.stringify({ ...parsed, fieldMap: FIELD_SPECS.map((spec) => [spec.key, parsed.fieldMap[spec.key] ?? null]) });
}

export function repairColumnsSignature(columns: readonly AvColumnLike[]): string {
    assertRepairColumns(columns);
    return JSON.stringify(columns.map(({ id, name, type }) => ({ id, name, type })).sort((first, second) => first.id.localeCompare(second.id)));
}

export function assertRepairColumns(columns: readonly AvColumnLike[]): void {
    const ids = new Set<string>();
    for (const column of columns) {
        if (!column || typeof column.id !== "string" || !column.id || ids.has(column.id)
            || typeof column.name !== "string" || typeof column.type !== "string") throw new Error("数据库列缺失、损坏或重复，修复已停止");
        ids.add(column.id);
    }
}

export function repairCompleteFieldMap(settings: ContactsSettings, patch: Partial<ContactsSettings["fieldMap"]>, columns: readonly AvColumnLike[]): ContactsSettings {
    assertRepairColumns(columns);
    const entries = Object.entries(patch);
    if (!entries.length) throw new Error("请至少选择一个字段映射");
    for (const [key, value] of entries) {
        if (!FIELD_SPECS.some((spec) => spec.key === key) || typeof value !== "string" || !value.trim()) throw new Error("未知字段键或空列映射");
    }
    const updated = { ...settings, fieldMap: { ...settings.fieldMap, ...patch } };
    const problems = validateFieldMap(updated.fieldMap, columns);
    if (problems.length) throw new Error(problems.map((problem) => problem.message).join("；"));
    return updated;
}

export function parseSettingsRepairCheckpoint(raw: unknown): SettingsRepairCheckpoint | null {
    if (raw === null || raw === undefined || raw === "") return null;
    const source = record(raw, "设置修复断点");
    if (source.schemaVersion !== 1 || typeof source.requestId !== "string" || !/^\d{14}-[0-9a-z]{7}$/.test(source.requestId)
        || !Array.isArray(source.columns) || !Array.isArray(source.steps) || !source.steps.length || typeof source.complete !== "boolean") throw new Error("设置修复断点损坏或版本未知，未修改原文件");
    const settings = parseRepairSettings(source.source);
    const columns = source.columns as AvColumnLike[];
    assertRepairColumns(columns);
    const ids = new Set(columns.map((column) => column.id));
    const fields = new Set<string>();
    const expectedFields = FIELD_SPECS.filter((spec) => !ids.has(settings.fieldMap[spec.key])).map((spec) => spec.key);
    if (validateFieldMap(settings.fieldMap).some((problem) => problem.message.includes("重复"))) throw new Error("原修复设置映射重复，未修改断点");
    const states = new Set(["pending", "unknown", "rejected", "verified"]);
    let previousKeyId = columns.at(-1)?.id ?? "";
    const steps = source.steps.map((rawStep, index): SettingsRepairStep => {
        const step = record(rawStep, "设置修复列断点");
        if (typeof step.field !== "string" || fields.has(step.field) || !FIELD_SPECS.some((spec) => spec.key === step.field)
            || typeof step.keyId !== "string" || !/^\d{14}-[0-9a-z]{7}$/.test(step.keyId) || ids.has(step.keyId)
            || typeof step.previousKeyId !== "string" || !states.has(String(step.columnState)) || typeof step.mapped !== "boolean") throw new Error("设置修复列断点损坏，未修改原文件");
        if (step.previousKeyId && !ids.has(step.previousKeyId)) throw new Error("设置修复列顺序断点未知，未修改原文件");
        if (step.field !== expectedFields[index] || step.previousKeyId !== previousKeyId) throw new Error("设置修复范围或列顺序与原预览不一致，未修改原文件");
        ids.add(step.keyId);
        previousKeyId = step.keyId;
        fields.add(step.field);
        if (step.field === "related") {
            if (typeof step.backKeyId !== "string" || !/^\d{14}-[0-9a-z]{7}$/.test(step.backKeyId) || ids.has(step.backKeyId)
                || !states.has(String(step.relationState))) throw new Error("相关人回链断点损坏，未修改原文件");
            ids.add(step.backKeyId);
        } else if (step.backKeyId !== undefined || step.relationState !== undefined) throw new Error("非关系列包含回链断点，未修改原文件");
        if (step.mapped && (step.columnState !== "verified" || step.field === "related" && step.relationState !== "verified")) throw new Error("未核实列被标为映射完成，未修改原文件");
        return { field: step.field as FieldKey, keyId: step.keyId, previousKeyId: step.previousKeyId,
            columnState: step.columnState as SettingsRepairState, mapped: step.mapped,
            ...(step.field === "related" ? { backKeyId: step.backKeyId as string, relationState: step.relationState as SettingsRepairState } : {}) };
    });
    if (steps.length !== expectedFields.length) throw new Error("设置修复断点缺少原预览字段，未修改原文件");
    if (source.complete !== steps.every((step) => step.mapped)) throw new Error("设置修复断点完成状态不一致，未修改原文件");
    return { schemaVersion: 1, requestId: source.requestId, source: settings,
        columns: columns.map(({ id, name, type }) => ({ id, name, type })), steps, complete: source.complete };
}

export function assertRepairCheckpointSettings(checkpoint: SettingsRepairCheckpoint, current: ContactsSettings): void {
    const fieldMap = { ...checkpoint.source.fieldMap };
    for (const step of checkpoint.steps) {
        const ready = step.columnState === "verified" && (step.field !== "related" || step.relationState === "verified");
        if (step.mapped || ready && current.fieldMap[step.field] === step.keyId) fieldMap[step.field] = step.keyId;
    }
    if (repairSettingsSignature({ ...checkpoint.source, fieldMap }) !== repairSettingsSignature(current)) throw new Error("当前设置与原修复断点冲突，未覆盖最新锚点或字段映射");
}

export function assertRepairCheckpointColumns(checkpoint: SettingsRepairCheckpoint, columns: readonly AvColumnLike[]): void {
    const createdIds = new Set(checkpoint.steps.flatMap((step) => [step.keyId, ...(step.backKeyId ? [step.backKeyId] : [])]));
    if (repairColumnsSignature(columns.filter((column) => !createdIds.has(column.id))) !== repairColumnsSignature(checkpoint.columns)) throw new Error("原列结构已变化，请重新核对修复范围");
}

export interface RepairRelationKey extends AvColumnLike {
    relation?: unknown;
}

export function verifyRepairRelation(keys: readonly RepairRelationKey[], avId: string, keyId: string, backKeyId: string): boolean {
    assertRepairColumns(keys);
    const forward = keys.find((key) => key.id === keyId);
    const backward = keys.find((key) => key.id === backKeyId);
    if (forward && forward.type !== "relation" || backward && backward.type !== "relation") throw new Error("原相关人或回链列类型冲突，未重建");
    if (forward?.relation !== undefined && !backward) {
        const relation = record(forward.relation, "原相关人配置");
        if (relation.avID && relation.avID !== avId || relation.backKeyID && relation.backKeyID !== backKeyId) throw new Error("相关人已经连接其他目标，未重新配置");
    }
    if (!forward || !backward) return false;
    for (const [key, oppositeId] of [[forward, backKeyId], [backward, keyId]] as const) {
        const relation = record(key.relation, "双向关系配置");
        if (relation.avID !== avId || relation.isTwoWay !== true || relation.backKeyID !== oppositeId) throw new Error("双向关系归属或回链未知，未重新配置");
    }
    return true;
}
