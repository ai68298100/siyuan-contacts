/**
 * 互动备注模板存储（插件自管 JSON）：Web Lock 临界区 + 写后回读。
 * 键：interaction-templates.json（契约见 docs/DATA-CONTRACT.md §3）。
 * 存储为空时由服务层回退内置默认模板；任何修改即全量落盘。
 */
import type { Plugin } from "siyuan";
import { loadJson, loadJsonStrict, saveJsonVerified, withStoreLock } from "./storage";
import { DEFAULT_TEMPLATES, normalizeTemplates, normalizeTemplatesForWrite } from "../domain/interaction-templates";
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

/** 严格读取：只有未建立存储才返回 null；读取失败或坏库不能伪装成空模板。 */
export async function loadTemplatesStoreStrict(plugin: Plugin): Promise<TemplatesStore | null> {
    return parseTemplatesStoreStrict(await loadJsonStrict(plugin, TEMPLATES_STORAGE_KEY));
}

/** 全量保存需带编辑基线；锁内核对现状，过期草稿不覆盖并发新增、修改或删除。 */
export async function saveTemplatesStore(plugin: Plugin, templates: readonly NoteTemplate[], expected: readonly NoteTemplate[]): Promise<void> {
    const normalized = normalizeTemplatesForWrite(templates);
    const baseline = normalizeTemplatesForWrite(expected);
    return withStoreLock(TEMPLATES_STORAGE_KEY, async () => {
        const store = parseTemplatesStoreStrict(await loadJsonStrict(plugin, TEMPLATES_STORAGE_KEY));
        const current = store?.templates ?? DEFAULT_TEMPLATES;
        // 上次请求可能已保存但回读失败；同一目标已存在只核实成功，不重写。
        if (JSON.stringify(current) === JSON.stringify(normalized)) return;
        if (JSON.stringify(current) !== JSON.stringify(baseline)) {
            throw new Error("模板已被其他窗口修改或恢复，本次未保存。草稿已保留，请重新读取当前版本并核对后再编辑。");
        }
        try {
            await saveJsonVerified(plugin, TEMPLATES_STORAGE_KEY, { schemaVersion: 1, templates: normalized });
        } catch (cause) {
            throw new Error("模板保存结果尚未核实，草稿与编辑基线已保留。请重新读取核实，或用相同草稿重试。", { cause });
        }
    });
}

/**
 * 锁内合并写入（C08/FUNC-01.6-c 恢复用）：读取、按 id 现状优先合并、保存同一临界区，
 * 两窗口并发恢复不丢模板；损坏当前库拒绝合并（错误上抛交由调用方逐模块报告）。返回新增数。
 */
export async function mergeTemplatesStore(plugin: Plugin, incoming: readonly NoteTemplate[]): Promise<number> {
    const normalizedIncoming = normalizeTemplatesForWrite(incoming);
    return withStoreLock(TEMPLATES_STORAGE_KEY, async () => {
        const store = parseTemplatesStoreStrict(await loadJsonStrict(plugin, TEMPLATES_STORAGE_KEY));
        const existing = store?.templates ?? [];
        const byId = new Map(existing.map((template) => [template.id, template]));
        let added = 0;
        for (const template of normalizedIncoming) {
            if (byId.has(template.id)) continue;
            byId.set(template.id, template);
            added += 1;
        }
        if (added > 0) {
            const templates = normalizeTemplatesForWrite([...byId.values()]);
            await saveJsonVerified(plugin, TEMPLATES_STORAGE_KEY, { schemaVersion: 1, templates });
        }
        return added;
    });
}

/** 写前包络检查：已存在的存储若损坏/版本不兼容则拒绝保存（避免覆盖），不存在（null/空串）放行 */
function parseTemplatesStoreStrict(raw: unknown): TemplatesStore | null {
    if (raw == null || raw === "") return null;
    if (typeof raw !== "object" || Array.isArray(raw) || (raw as Partial<TemplatesStore>).schemaVersion !== 1) {
        throw new Error("模板存储格式或版本不兼容，操作已停止；请先备份并检查原文件");
    }
    return { schemaVersion: 1, templates: normalizeTemplatesForWrite((raw as Partial<TemplatesStore>).templates) };
}
