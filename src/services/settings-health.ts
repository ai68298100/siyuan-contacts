import { addField, configureSelfRelationTwoWay, renderView } from "../api/av";
import { newNodeId } from "../api/client";
import { FIELD_SPECS, reconcileFieldMap, validateFieldMap } from "../domain/fields.ts";
import type { FieldKey } from "../domain/fields";
import type { ContactsSettings } from "../domain/model";
import { persistSettings } from "./init";
import { invalidateRoster } from "./roster";
import type { Plugin } from "siyuan";

export interface MissingField {
    key: string;
    expectedName: string;
    keyId: string;
    type: string;
}

export interface HealthColumn {
    id: string;
    name: string;
    type: string;
}

export interface SettingsHealth {
    ok: boolean;
    columns: number;
    missing: MissingField[];
    /** CODE-02.4：fieldMap 结构问题（重复映射/列不存在/类型不一致），修复态呈现 */
    problems: { key: string; message: string }[];
    availableColumns: HealthColumn[];
}

export type SettingsAnchorPatch = Pick<ContactsSettings, "hostDocId" | "dbBlockId" | "avId">;
export type FieldMapPatch = Partial<ContactsSettings["fieldMap"]>;

/**
 * 对照设置中固化的字段 ID 与当前数据库列，给设置页提供可解释的健康状态。
 * 只读检查，不尝试静默修复；修复入口待字段重建事务完成后接入。
 */
export async function checkSettingsHealth(settings: ContactsSettings): Promise<SettingsHealth> {
    const rendered = await renderView(settings.avId, settings.dbBlockId);
    const columnIds = new Set(rendered.view.columns.map((column) => column.id));
    const missing = FIELD_SPECS
        .filter((spec) => !columnIds.has(settings.fieldMap[spec.key]))
        .map((spec) => ({
            key: spec.key,
            expectedName: spec.nameZh,
            keyId: settings.fieldMap[spec.key] ?? "（未记录）",
            type: spec.type,
        }));
    /* CODE-02.4：结构问题（重复映射/列不存在/类型不一致）——「缺少列映射」已由 missing 覆盖，滤除避免重复 */
    const problems = validateFieldMap(settings.fieldMap, rendered.view.columns)
        .filter((problem) => !problem.message.includes("缺少列映射"))
        .map((problem) => ({ key: problem.key as string, message: problem.message }));
    return {
        ok: missing.length === 0 && problems.length === 0,
        columns: rendered.view.columns.length,
        missing,
        problems,
        availableColumns: rendered.view.columns.map((column) => ({ id: column.id, name: column.name, type: column.type })),
    };
}

/** 显式把健康检查中的现有列映射到缺失字段；每列只允许绑定一个字段，且类型必须一致。 */
export async function repairFieldMap(
    plugin: Plugin,
    settings: ContactsSettings,
    patch: FieldMapPatch,
): Promise<ContactsSettings> {
    const entries = Object.entries(patch).filter(([, columnId]) => typeof columnId === "string" && columnId.length > 0);
    if (entries.length === 0) throw new Error("请至少选择一个字段映射");

    const rendered = await renderView(settings.avId, settings.dbBlockId);
    const columns = rendered.view.columns;
    const specByKey = new Map(FIELD_SPECS.map((spec) => [spec.key, spec]));
    const used = new Set<string>();
    const fieldMap = { ...settings.fieldMap };
    for (const [rawKey, rawColumnId] of entries) {
        const key = rawKey as FieldKey;
        const spec = specByKey.get(key);
        if (!spec) throw new Error(`未知字段键：${rawKey}`);
        const columnId = String(rawColumnId);
        const column = columns.find((item) => item.id === columnId);
        if (!column) throw new Error(`${spec.nameZh} 映射的列不存在`);
        if (column.type !== spec.type) throw new Error(`${spec.nameZh} 需要 ${spec.type} 类型，当前列是 ${column.type}`);
        if (used.has(column.id)) throw new Error(`列「${column.name || column.id}」不能重复映射`);
        used.add(column.id);
        fieldMap[key] = column.id;
    }

    const updated: ContactsSettings = { ...settings, fieldMap };
    await persistSettings(plugin, updated);
    invalidateRoster();
    return updated;
}

/**
 * 显式重建健康检查发现的缺失字段，并写回新的 fieldMap。
 * 只补缺失字段，不改已有列；相关人字段恢复后重新配置双向回链。
 */
export async function rebuildMissingFields(plugin: Plugin, settings: ContactsSettings): Promise<ContactsSettings> {
    const rendered = await renderView(settings.avId, settings.dbBlockId);
    const columnIds = new Set(rendered.view.columns.map((column) => column.id));
    const missing = FIELD_SPECS.filter((spec) => !columnIds.has(settings.fieldMap[spec.key]));
    if (missing.length === 0) return settings;

    const fieldMap = { ...settings.fieldMap };
    let previousKeyId = rendered.view.columns.at(-1)?.id ?? "";
    for (const spec of missing) {
        const keyId = await addField(settings.avId, spec, spec.nameZh, previousKeyId);
        fieldMap[spec.key] = keyId;
        previousKeyId = keyId;
        if (spec.key === "related") {
            await configureSelfRelationTwoWay(
                settings.avId,
                keyId,
                newNodeId(),
                spec.nameZh,
                spec.backNameZh ?? "被相关人",
            );
        }
    }

    const updated: ContactsSettings = { ...settings, fieldMap };
    await persistSettings(plugin, updated);
    invalidateRoster();
    return updated;
}

/**
 * 显式切换到一个已有的联系人数据库锚点。
 * 先用只读渲染验证数据库视图可访问，再写回设置；字段映射留给健康检查处理。
 */
export async function rebindSettings(
    plugin: Plugin,
    settings: ContactsSettings,
    patch: SettingsAnchorPatch,
): Promise<ContactsSettings> {
    const anchors = {
        hostDocId: patch.hostDocId.trim(),
        dbBlockId: patch.dbBlockId.trim(),
        avId: patch.avId.trim(),
    };
    for (const [key, value] of Object.entries(anchors)) {
        if (!/^\d{14}-[0-9a-z]{7}$/.test(value)) {
            throw new Error(`${key} 不是合法的思源 ID`);
        }
    }

    const rendered = await renderView(anchors.avId, anchors.dbBlockId);
    // 重绑优先沿用旧 keyID；迁移到同结构的新库时按默认列名和类型恢复。
    // 列名被用户改过且 keyID 也变化时不猜测，交给健康检查和显式补建处理。
    const reconciled = reconcileFieldMap(rendered.view.columns, settings.fieldMap);
    if (reconciled.matched === 0) {
        throw new Error("目标属性视图无法识别为联系人数据库：请确认数据库锚点，或先恢复标准字段名称");
    }
    const updated: ContactsSettings = {
        ...settings,
        ...anchors,
        fieldMap: { ...settings.fieldMap, ...reconciled.fieldMap },
    };
    await persistSettings(plugin, updated);
    invalidateRoster();
    return updated;
}
