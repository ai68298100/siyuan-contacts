/**
 * 互动备注模板存储（插件自管 JSON）：Web Lock 临界区 + 写后回读。
 * 键：interaction-templates.json（契约见 docs/DATA-CONTRACT.md §3）。
 * 存储为空时由服务层回退内置默认模板；任何修改即全量落盘。
 */
import type { Plugin } from "siyuan";
import { loadJson, loadJsonStrict, saveJsonVerified, withStoreLock } from "./storage";
import { normalizeTemplates } from "../domain/interaction-templates";
import type { NoteTemplate } from "../domain/interaction-templates";

export const TEMPLATES_STORAGE_KEY = "interaction-templates.json";

export interface TemplatesStore {
    schemaVersion: 1;
    templates: NoteTemplate[];
}

/** 展示用容错读取：存储为空/不存在返回 null（由调用方回退内置默认） */
export async function loadTemplatesStore(plugin: Plugin): Promise<TemplatesStore | null> {
    const raw = await loadJson(plugin, TEMPLATES_STORAGE_KEY);
    if (raw === null || raw === "") return null;
    const templates = normalizeTemplates((raw as Partial<TemplatesStore>)?.templates);
    if ((raw as Partial<TemplatesStore>)?.schemaVersion !== 1 || (raw as Partial<TemplatesStore>)?.templates === undefined) return null;
    return { schemaVersion: 1, templates };
}

/** 全量保存（增改删统一走这里）：锁内严格读取，损坏当前库拒绝覆盖；写后回读验证 */
export async function saveTemplatesStore(plugin: Plugin, templates: readonly NoteTemplate[]): Promise<void> {
    return withStoreLock(TEMPLATES_STORAGE_KEY, async () => {
        normalizeTemplatesStrictForWrite(await loadJsonStrict(plugin, TEMPLATES_STORAGE_KEY));
        await saveJsonVerified(plugin, TEMPLATES_STORAGE_KEY, { schemaVersion: 1, templates: [...templates] });
    });
}

/**
 * 锁内合并写入（C08/FUNC-01.6-c 恢复用）：读取、按 id 现状优先合并、保存同一临界区，
 * 两窗口并发恢复不丢模板；损坏当前库拒绝合并（错误上抛交由调用方逐模块报告）。返回新增数。
 */
export async function mergeTemplatesStore(plugin: Plugin, incoming: readonly NoteTemplate[]): Promise<number> {
    return withStoreLock(TEMPLATES_STORAGE_KEY, async () => {
        const raw = await loadJsonStrict(plugin, TEMPLATES_STORAGE_KEY);
        normalizeTemplatesStrictForWrite(raw);
        const existing = normalizeTemplates((raw as Partial<TemplatesStore> | null)?.templates);
        const byId = new Map(existing.map((template) => [template.id, template]));
        let added = 0;
        for (const template of incoming) {
            if (byId.has(template.id)) continue;
            byId.set(template.id, template);
            added += 1;
        }
        if (added > 0) {
            await saveJsonVerified(plugin, TEMPLATES_STORAGE_KEY, { schemaVersion: 1, templates: [...byId.values()].slice(0, 50) });
        }
        return added;
    });
}

/** 写前包络检查：已存在的存储若损坏/版本不兼容则拒绝保存（避免覆盖），不存在（null/空串）放行 */
function normalizeTemplatesStrictForWrite(raw: unknown): void {
    if (raw == null || raw === "") return;
    if (typeof raw !== "object" || (raw as Partial<TemplatesStore>).schemaVersion !== 1) {
        throw new Error("模板存储格式或版本不兼容，操作已停止；请先备份并检查原文件");
    }
}
