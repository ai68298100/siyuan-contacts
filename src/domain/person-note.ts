/** 人物独立备注是原生单段落中的纯文本，不是互动事实或跟进任务。 */

export const PERSON_NOTE_ATTR = "custom-lvct-person-note";
export const PERSON_NOTE_FORMAT_ATTR = "custom-lvct-person-note-format";
export const PERSON_NOTE_DETACHED_ATTR = "custom-lvct-person-note-detached";
export const MAX_PERSON_NOTE_LENGTH = 5000;
export const PERSON_NOTE_TITLE = "人物备注";

export interface PersonNoteBlock {
    id: string;
    markdown: string;
    content: string;
    type: string;
    parentId?: string;
    format?: string;
    legacyTitleBefore?: boolean;
}

/** 仅记录用户将解除标记的原块；不推断相邻正文属于备注。 */
export interface LegacyPersonNoteSnapshot {
    blockId: string;
    content: string;
    markdown: string;
}

export function normalizeLegacyPersonNoteSnapshot(value: unknown): LegacyPersonNoteSnapshot {
    if (!value || typeof value !== "object" || Array.isArray(value)
        || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error("旧备注核对快照格式无效");
    const record = value as Record<string, unknown>;
    if (Reflect.ownKeys(record).some((key) => key !== "blockId" && key !== "content" && key !== "markdown")
        || typeof record.blockId !== "string" || !/^\d{14}-[0-9a-z]{7}$/.test(record.blockId)
        || typeof record.content !== "string" || typeof record.markdown !== "string") throw new Error("旧备注核对快照身份或原文无效");
    return { blockId: record.blockId, content: record.content, markdown: record.markdown };
}

/** 统一换行并去掉首尾空白；空串代表清空备注。 */
export function normalizePersonNote(value: string): string {
    return String(value ?? "").replace(/\r\n?/g, "\n").trim();
}

/** DOM 文本编码避免输入变成节点、IAL、任务或 Markdown 结构。 */
export function buildPersonNoteDom(value: string, blockId: string): string {
    if (!/^\d{14}-[0-9a-z]{7}$/.test(blockId)) throw new Error("人物备注块 ID 无效");
    const note = normalizePersonNote(value);
    if (!note) return "";
    const escaped = note.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;").replace(/'/g, "&#39;").replace(/\n/g, "<br />");
    return `<div data-node-id="${blockId}" data-type="NodeParagraph" class="p" ${PERSON_NOTE_ATTR}="1" ${PERSON_NOTE_FORMAT_ATTR}="2"><div contenteditable="true"><strong>${PERSON_NOTE_TITLE}</strong><br />${escaped}</div></div>`;
}

/** 只接受已核实格式；null 与空备注严格区分。 */
export function parsePersonNoteBlock(block: PersonNoteBlock): string | null {
    if (block.type !== "p") return null;
    const prefix = `${PERSON_NOTE_TITLE}\n`;
    if (block.format === "2") {
        if (!block.content.startsWith(prefix)) return null;
        return normalizePersonNote(block.content.slice(prefix.length));
    }
    if (block.format !== undefined) return null;
    // 历史同段落格式，或由相邻标题证明归属的历史正文。禁止猜测孤立末段。
    if (block.markdown.startsWith(`**${PERSON_NOTE_TITLE}**\n`) && block.content.startsWith(prefix)) {
        return normalizePersonNote(block.content.slice(prefix.length));
    }
    return block.legacyTitleBefore ? normalizePersonNote(block.content) : null;
}
