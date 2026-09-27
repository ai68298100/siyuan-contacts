/**
 * 互动备注模板服务（F09）：列表（空存储回退内置默认）与全量保存。
 * 模板文本不发送 AI；应用与应用模板的覆盖确认在组件层。
 */
import type { Plugin } from "siyuan";
import { normalizeTemplates, DEFAULT_TEMPLATES } from "../domain/interaction-templates";
import type { NoteTemplate } from "../domain/interaction-templates";
import { loadTemplatesStore, saveTemplatesStore } from "../data/templates";

/** 模板列表：存储为空时返回内置默认三个（见面/电话/聚会，不落盘） */
export async function listTemplates(plugin: Plugin): Promise<NoteTemplate[]> {
    const store = await loadTemplatesStore(plugin);
    return store ? store.templates : [...DEFAULT_TEMPLATES];
}

/** 全量保存（增改删统一入口），返回归一化后的列表 */
export async function saveTemplates(plugin: Plugin, templates: readonly NoteTemplate[]): Promise<NoteTemplate[]> {
    const normalized = normalizeTemplates(templates);
    await saveTemplatesStore(plugin, normalized);
    return normalized;
}
