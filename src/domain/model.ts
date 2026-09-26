/**
 * 插件自管数据的模型与读时归一（normalize）。
 * 约定（docs/DATA-CONTRACT.md）：每个存储键的 JSON 都带 schemaVersion；
 * 读入时统一 normalize，旧版本数据在下一次持久化时自动升级，不写迁移脚本。
 */
import type { FieldKey } from "./fields";

export const SETTINGS_STORE_VERSION = 1;
export const SETTINGS_STORAGE_KEY = "contacts-settings.json";

/** 人脉工作空间初始化完成后固化的思源侧锚点 */
export interface ContactsSettings {
    readonly schemaVersion: number;
    /** 人脉笔记本 */
    readonly notebookId: string;
    readonly notebookName: string;
    /** 数据库宿主文档（内嵌数据库块的文档） */
    readonly hostDocId: string;
    /** 数据库块 ID（位于宿主文档内） */
    readonly dbBlockId: string;
    /** 数据库（属性视图）ID */
    readonly avId: string;
    /** 字段稳定键 → 数据库字段 ID */
    readonly fieldMap: Readonly<Record<FieldKey, string>>;
    readonly initializedAt: string;
}

function isNonEmptyString(value: unknown): value is string {
    return typeof value === "string" && value.length > 0;
}

/**
 * 读时归一：合法则补齐字段并返回，不兼容则返回 null（引导用户重新初始化）。
 * 永不抛错——存储里的脏数据不能阻断插件启动。
 */
export function normalizeSettings(raw: unknown): ContactsSettings | null {
    if (raw === null || typeof raw !== "object") return null;
    const record = raw as Record<string, unknown>;
    if (record.schemaVersion !== 1) return null;
    const required: readonly (keyof ContactsSettings)[] = [
        "notebookId", "notebookName", "hostDocId", "dbBlockId", "avId", "initializedAt",
    ];
    for (const key of required) {
        if (!isNonEmptyString(record[key])) return null;
    }
    const fieldMapRaw = record.fieldMap;
    if (fieldMapRaw === null || typeof fieldMapRaw !== "object") return null;
    const fieldMap = {} as Record<FieldKey, string>;
    for (const [key, value] of Object.entries(fieldMapRaw as Record<string, unknown>)) {
        if (!isNonEmptyString(value)) return null;
        fieldMap[key as FieldKey] = value;
    }
    return {
        schemaVersion: SETTINGS_STORE_VERSION,
        notebookId: record.notebookId as string,
        notebookName: record.notebookName as string,
        hostDocId: record.hostDocId as string,
        dbBlockId: record.dbBlockId as string,
        avId: record.avId as string,
        fieldMap,
        initializedAt: record.initializedAt as string,
    };
}
