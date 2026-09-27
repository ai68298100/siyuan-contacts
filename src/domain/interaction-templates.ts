/**
 * 互动备注模板（F09）：为见面/电话/聚会等场景保存可复用备注，应用时纯本地变量替换。
 * 模板文本不发送 AI；应用模板不自动提交、不悄悄覆盖已有草稿（由调用方确认）。
 * 存储契约见 docs/DATA-CONTRACT.md §3 interaction-templates.json。
 * 纯函数：无 DOM、无 IO，node --test 直接可测。
 */

export interface NoteTemplate {
    id: string;
    name: string;
    content: string;
}

export const TEMPLATES_STORE_VERSION = 1;
export const TEMPLATES_LIMIT = 50;

/** 内置默认模板：存储为空时展示；不落盘，任何修改即全量落盘后以存储为准 */
export const DEFAULT_TEMPLATES: readonly NoteTemplate[] = [
    { id: "tpl-meet", name: "见面", content: "和{{姓名}}见面，聊了……" },
    { id: "tpl-call", name: "电话", content: "和{{姓名}}通电话，主要聊了……" },
    { id: "tpl-party", name: "聚会", content: "在聚会见到{{姓名}}，大家一起……" },
];

/** 模板占位符（应用时纯本地替换） */
export interface TemplateVars {
    /** 人物姓名 → {{姓名}} */
    name: string;
    /** 当天本地日期 → {{日期}} */
    date: string;
    /** 上次互动日期，无则传"无" → {{上次互动}} */
    lastInteraction: string;
}

/** 纯本地变量替换：全部占位符替换所有出现；未知占位符原样保留 */
export function renderTemplate(content: string, vars: TemplateVars): string {
    return content
        .replaceAll("{{姓名}}", vars.name)
        .replaceAll("{{日期}}", vars.date)
        .replaceAll("{{上次互动}}", vars.lastInteraction);
}

function isNoteTemplate(raw: unknown): raw is NoteTemplate {
    if (raw === null || typeof raw !== "object") return false;
    const item = raw as Partial<NoteTemplate>;
    return typeof item.id === "string" && item.id.length > 0 &&
        typeof item.name === "string" && item.name.trim().length > 0 &&
        typeof item.content === "string";
}

/** 归一化：丢弃坏条目、name/content 去首尾空白、按 id 去重、截断到上限；非法输入回退空数组 */
export function normalizeTemplates(raw: unknown): NoteTemplate[] {
    if (!Array.isArray(raw)) return [];
    const seen = new Set<string>();
    const result: NoteTemplate[] = [];
    for (const item of raw) {
        if (result.length >= TEMPLATES_LIMIT) break;
        if (!isNoteTemplate(item) || seen.has(item.id)) continue;
        seen.add(item.id);
        result.push({ id: item.id, name: item.name.trim(), content: item.content.trim() });
    }
    return result;
}

/** 新模板 ID（本地生成，存储内唯一性由调用方以 normalize 去重兜底） */
export function newTemplateId(): string {
    return `tpl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
