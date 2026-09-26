/**
 * 人脉工作空间初始化服务：笔记本 → 宿主文档 → 数据库 → 字段 → 双向关联 → 设置落盘。
 * 任何一步失败都直接抛错，由向导 UI 呈现；已落盘的锚点不回滚（可重跑向导续建）。
 */
import { createDocWithMd, createNotebook, newNodeId } from "../api/client";
import {
    addField,
    configureSelfRelationTwoWay,
    createDatabaseInDoc,
} from "../api/av";
import { FIELD_SPECS, fieldSpec } from "../domain/fields";
import type { FieldKey } from "../domain/fields";
import { normalizeSettings, SETTINGS_STORAGE_KEY, SETTINGS_STORE_VERSION } from "../domain/model";
import type { ContactsSettings } from "../domain/model";
import { loadJson, saveJsonVerified } from "../data/storage";
import type { Plugin } from "siyuan";

export type ProgressReporter = (message: string) => void;

export const HOST_DOC_TITLE = "联系人总表";

export interface InitOptions {
    /** 人脉笔记本名 */
    notebookName: string;
}

export async function loadSettings(plugin: Plugin): Promise<ContactsSettings | null> {
    return normalizeSettings(await loadJson(plugin, SETTINGS_STORAGE_KEY));
}

export async function persistSettings(plugin: Plugin, settings: ContactsSettings): Promise<void> {
    await saveJsonVerified(plugin, SETTINGS_STORAGE_KEY, settings);
}

/**
 * 全新初始化。若笔记本已存在会抛错（向导层先做存在性提示）。
 */
export async function initializeWorkspace(
    plugin: Plugin,
    options: InitOptions,
    onProgress: ProgressReporter,
): Promise<ContactsSettings> {
    const name = options.notebookName.trim();
    if (!name) throw new Error("笔记本名不能为空");

    onProgress(`创建笔记本「${name}」…`);
    const notebook = await createNotebook(name);

    onProgress(`创建宿主文档「${HOST_DOC_TITLE}」…`);
    const hostDocId = await createDocWithMd(notebook.id, `/${HOST_DOC_TITLE}`, `# ${HOST_DOC_TITLE}\n\n`);

    onProgress("创建人脉数据库…");
    const { avId, dbBlockId } = await createDatabaseInDoc(hostDocId);

    const fieldMap: Record<FieldKey, string> = {} as Record<FieldKey, string>;
    let previousKeyId = "";
    for (const spec of FIELD_SPECS) {
        const displayName = spec.nameZh;
        onProgress(`创建字段「${displayName}」…`);
        previousKeyId = await addField(avId, spec, displayName, previousKeyId);
        fieldMap[spec.key] = previousKeyId;
    }

    onProgress("配置「相关人」双向关联…");
    const related = fieldSpec("related");
    await configureSelfRelationTwoWay(
        avId,
        fieldMap.related,
        newNodeId(),
        related.nameZh,
        related.backNameZh ?? "被相关人",
    );

    onProgress("保存工作空间设置…");
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
    onProgress("初始化完成 ✔");
    return settings;
}
