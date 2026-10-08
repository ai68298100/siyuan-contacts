/** 人物独立备注的纯文本/Markdown 边界处理。备注不是互动事实，也不是跟进任务。 */

import { escapeMarkdown } from "./format.ts";

export const PERSON_NOTE_ATTR = "custom-lvct-person-note";
export const MAX_PERSON_NOTE_LENGTH = 5000;
const NOTE_TITLE = "**人物备注**";

/** 统一换行并去掉首尾空白；空串代表清空备注。 */
export function normalizePersonNote(value: string): string {
    return String(value ?? "").replace(/\r\n?/g, "\n").trim();
}

/**
 * 备注按纯文本保存到 Markdown 块：转义 Markdown 结构，避免自由输入变成任务/标题/链接；
 * 每个换行保留为 Markdown 软换行，IAL 行也会被转义，不能伪造插件标记。
 */
export function buildPersonNoteMarkdown(value: string): string {
    const note = normalizePersonNote(value);
    if (!note) return "";
    const escaped = escapeMarkdown(note)
        .replace(/^(\s*)\{:/gm, "$1\\{:")
        .replace(/\n/g, "  \n");
    return `${NOTE_TITLE}\n\n${escaped}`;
}

function stripIal(value: string): string {
    return value.replace(/\r\n?/g, "\n").replace(/^\s*\{:[^\n]*\}\s*$/gm, "").trim();
}

/** 从标记块 Markdown 回读用户备注；未知形状返回空串，交由服务层做严格核对。 */
export function parsePersonNoteMarkdown(markdown: string): string {
    const content = stripIal(markdown);
    if (!content.startsWith(`${NOTE_TITLE}\n`)) return "";
    const body = content.slice(NOTE_TITLE.length).replace(/^\n+/, "");
    return normalizePersonNote(body
        .replace(/ {2}\n/g, "\n")
        .replace(/^(\s*)\\\{:/gm, "$1{:")
        .replace(/\\([\\`*_\[\]#<>])/g, "$1"));
}

export function personNoteMatches(markdown: string, expected: string): boolean {
    return parsePersonNoteMarkdown(markdown) === normalizePersonNote(expected);
}
