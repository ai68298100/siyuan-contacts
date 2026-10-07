/** 人物文档独立备注：单个可重建标记块，文档是事实源。 */

import { readMarkedBlocks, upsertMarkedBlock } from "../api/blocks";
import {
    buildPersonNoteMarkdown,
    MAX_PERSON_NOTE_LENGTH,
    normalizePersonNote,
    parsePersonNoteMarkdown,
    PERSON_NOTE_ATTR,
    personNoteMatches,
} from "../domain/person-note";
import { withStoreLock } from "../data/storage";

export class PersonNoteProjectionUnknownError extends Error {}

function assertPersonDocId(docId: string): void {
    if (!/^\d{14}-[0-9a-z]{7}$/.test(docId)) throw new Error("人物文档 ID 无效");
}

async function readSingleNote(docId: string): Promise<{ id?: string; note: string }> {
    assertPersonDocId(docId);
    const blocks = await readMarkedBlocks(docId, PERSON_NOTE_ATTR);
    if (blocks.length > 1) throw new PersonNoteProjectionUnknownError("人物文档存在多个备注标记块，未自动选择或覆盖");
    if (blocks.length === 0) return { note: "" };
    const note = parsePersonNoteMarkdown(blocks[0].markdown);
    if (!note && buildPersonNoteMarkdown(note) !== blocks[0].markdown.replace(/\r\n?/g, "\n").replace(/^\s*\{:[^\n]*\}\s*$/gm, "").trim()) {
        throw new PersonNoteProjectionUnknownError("人物备注块格式无法核实，未按空备注处理");
    }
    return { id: blocks[0].id, note };
}

export async function loadPersonNote(personDocId: string): Promise<string> {
    return (await readSingleNote(personDocId)).note;
}

export async function savePersonNote(personDocId: string, value: string, expected?: string): Promise<string> {
    return withStoreLock(`person-note:${personDocId}`, async () => {
    const current = await readSingleNote(personDocId);
    if (expected !== undefined && current.note !== normalizePersonNote(expected)) {
        throw new PersonNoteProjectionUnknownError("人物备注已在其他窗口变化，请重新读取后再保存");
    }
    const next = normalizePersonNote(value);
    if (next.length > MAX_PERSON_NOTE_LENGTH) throw new Error(`人物备注不能超过 ${MAX_PERSON_NOTE_LENGTH} 个字符`);
        if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(next)) throw new Error("人物备注包含不可写入的控制字符");
    const markdown = buildPersonNoteMarkdown(next);
    if (current.note === next) return current.note;
    await upsertMarkedBlock(personDocId, PERSON_NOTE_ATTR, markdown, current.id);
    let verified: { id: string; markdown: string }[];
    try {
        verified = await readMarkedBlocks(personDocId, PERSON_NOTE_ATTR);
    } catch (cause) {
        throw new PersonNoteProjectionUnknownError("人物备注请求已发出，但回读失败，结果未知", { cause });
    }
    if (!next) {
        if (verified.length !== 0) throw new PersonNoteProjectionUnknownError("人物备注清空请求已接受，但回读仍发现备注块");
        return "";
    }
    if (verified.length !== 1 || !personNoteMatches(verified[0].markdown, next)) {
        throw new PersonNoteProjectionUnknownError("人物备注请求已接受，但回读尚未收敛到预期内容");
    }
    return next;
    });
}
