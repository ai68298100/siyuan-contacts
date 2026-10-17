/** 人物文档独立备注：单个可重建标记块，文档是事实源。 */

import { readPersonNoteBlocks, readPersonNoteSourceBlock, setBlockAttrs, upsertPersonNoteBlock } from "../api/blocks";
import { KernelPermissionError, KernelResponseError } from "../api/client";
import {
    MAX_PERSON_NOTE_LENGTH,
    normalizePersonNote,
    normalizeLegacyPersonNoteSnapshot,
    parsePersonNoteBlock,
    PERSON_NOTE_ATTR,
    PERSON_NOTE_DETACHED_ATTR,
} from "../domain/person-note";
import type { LegacyPersonNoteSnapshot } from "../domain/person-note";
import { withStoreLock } from "../data/storage";

export class PersonNoteProjectionUnknownError extends Error {}
/** 同窗口保留已发送请求；未知结果只读核实，不因暂未发现而重写。 */
const unknownNoteWrites = new Map<string, string>();
const unknownLegacyDetachWrites = new Map<string, LegacyPersonNoteSnapshot>();

function assertPersonDocId(docId: string): void {
    if (!/^\d{14}-[0-9a-z]{7}$/.test(docId)) throw new Error("人物文档 ID 无效");
}

async function readSingleNote(docId: string): Promise<{ id?: string; note: string }> {
    assertPersonDocId(docId);
    const pendingDetach = unknownLegacyDetachWrites.get(docId);
    if (pendingDetach) {
        await verifyLegacyDetached(docId, pendingDetach);
        unknownLegacyDetachWrites.delete(docId);
    }
    const blocks = await readPersonNoteBlocks(docId);
    if (blocks.length > 1) throw new PersonNoteProjectionUnknownError("人物文档存在多个备注标记块，未自动选择或覆盖");
    if (blocks.length === 0) return { note: "" };
    const note = parsePersonNoteBlock(blocks[0]);
    if (note === null) {
        throw new PersonNoteProjectionUnknownError("人物备注块格式无法核实，未按空备注处理");
    }
    return { id: blocks[0].id, note };
}

export async function loadPersonNote(personDocId: string): Promise<string> {
    return withStoreLock(`person-note:${personDocId}`, async () => (await readSingleNote(personDocId)).note);
}

function sameLegacySnapshot(left: LegacyPersonNoteSnapshot, right: LegacyPersonNoteSnapshot): boolean {
    return left.blockId === right.blockId && left.content === right.content && left.markdown === right.markdown;
}

async function inspectLegacyNote(docId: string): Promise<LegacyPersonNoteSnapshot> {
    assertPersonDocId(docId);
    const blocks = await readPersonNoteBlocks(docId);
    if (blocks.length !== 1 || blocks[0].parentId !== docId || blocks[0].type !== "p"
        || blocks[0].format !== undefined || parsePersonNoteBlock(blocks[0]) !== null) {
        throw new PersonNoteProjectionUnknownError("当前不是可单独核对的旧版备注末段，未提供自动解除");
    }
    return { blockId: blocks[0].id, content: blocks[0].content, markdown: blocks[0].markdown };
}

export async function inspectLegacyPersonNote(docId: string): Promise<LegacyPersonNoteSnapshot> {
    assertPersonDocId(docId);
    return withStoreLock(`person-note:${docId}`, async () => {
        if (unknownLegacyDetachWrites.has(docId)) throw new PersonNoteProjectionUnknownError("上次旧备注解除结果未知，请先重试核实原请求");
        if (unknownNoteWrites.has(docId)) throw new PersonNoteProjectionUnknownError("人物备注仍有未核实的保存请求，未解除旧标记");
        return inspectLegacyNote(docId);
    });
}

async function verifyLegacyDetached(docId: string, expected: LegacyPersonNoteSnapshot): Promise<void> {
    const source = await readPersonNoteSourceBlock(docId, expected.blockId);
    if (source.content !== expected.content || source.markdown !== expected.markdown || source.format !== undefined
        || source.marker !== undefined || source.detached !== "1") {
        throw new PersonNoteProjectionUnknownError("旧备注解除结果尚未核实，原文或标记未匹配；未重复发送");
    }
}

/** 仅解除已确认旧末段标记；不改正文、不删除、不拼接，也不建立新备注。 */
export async function detachLegacyPersonNote(docId: string, expected: LegacyPersonNoteSnapshot): Promise<void> {
    assertPersonDocId(docId);
    const baseline = normalizeLegacyPersonNoteSnapshot(expected);
    if (baseline.blockId === docId) throw new Error("旧备注块不能替代人物文档");
    return withStoreLock(`person-note:${docId}`, async () => {
        const pending = unknownLegacyDetachWrites.get(docId);
        if (pending) {
            if (!sameLegacySnapshot(pending, baseline)) throw new PersonNoteProjectionUnknownError("旧备注核对内容与未完成原请求不同，未发送新解除请求");
            await verifyLegacyDetached(docId, pending);
            unknownLegacyDetachWrites.delete(docId);
            return;
        }
        if (unknownNoteWrites.has(docId)) throw new PersonNoteProjectionUnknownError("人物备注仍有未核实的保存请求，未解除旧标记");
        const current = await inspectLegacyNote(docId);
        if (!sameLegacySnapshot(current, baseline)) throw new PersonNoteProjectionUnknownError("旧备注原块或正文已变化，请重新核对；未解除标记");
        const source = await readPersonNoteSourceBlock(docId, baseline.blockId);
        if (source.marker !== "1" || source.format !== undefined || source.content !== baseline.content || source.markdown !== baseline.markdown) {
            throw new PersonNoteProjectionUnknownError("旧备注原块或标记已变化，请重新核对；未解除标记");
        }
        unknownLegacyDetachWrites.set(docId, baseline);
        try {
            await setBlockAttrs(baseline.blockId, { [PERSON_NOTE_ATTR]: "", [PERSON_NOTE_DETACHED_ATTR]: "1" });
        } catch (cause) {
            if (cause instanceof KernelResponseError || cause instanceof KernelPermissionError) {
                unknownLegacyDetachWrites.delete(docId);
                throw cause;
            }
            throw new PersonNoteProjectionUnknownError("旧备注解除请求已发出，但响应未核实，结果未知；可重试核实原请求", { cause });
        }
        try { await verifyLegacyDetached(docId, baseline); }
        catch (cause) { throw new PersonNoteProjectionUnknownError("旧备注解除请求已发出，但原文保留与标记回读未核实，结果未知；可重试核实原请求", { cause }); }
        unknownLegacyDetachWrites.delete(docId);
    });
}

export async function savePersonNote(personDocId: string, value: string, expected?: string): Promise<string> {
    return withStoreLock(`person-note:${personDocId}`, async () => {
        const current = await readSingleNote(personDocId);
        const next = normalizePersonNote(value);
        if (next.length > MAX_PERSON_NOTE_LENGTH) throw new Error(`人物备注不能超过 ${MAX_PERSON_NOTE_LENGTH} 个字符`);
        if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(next)) throw new Error("人物备注包含不可写入的控制字符");
        const pending = unknownNoteWrites.get(personDocId);
        if (pending !== undefined) {
            if (current.note !== pending) throw new PersonNoteProjectionUnknownError("上次人物备注写入结果未知，当前仅核实原请求，未重复发送");
            unknownNoteWrites.delete(personDocId);
        }
        // 响应丢失后的原值重试，已有目标正文时只读核实成功，不重复写块。
        if (current.note === next) return current.note;
        if (expected !== undefined && current.note !== normalizePersonNote(expected)) {
            throw new PersonNoteProjectionUnknownError("人物备注已在其他窗口变化，请重新读取后再保存");
        }
        unknownNoteWrites.set(personDocId, next);
        try {
            await upsertPersonNoteBlock(personDocId, next, current.id);
        } catch (cause) {
            if (cause instanceof KernelResponseError || cause instanceof KernelPermissionError) {
                unknownNoteWrites.delete(personDocId);
                throw cause;
            }
            throw new PersonNoteProjectionUnknownError("人物备注请求已发出，但响应未核实，结果未知", { cause });
        }
        let verified: Awaited<ReturnType<typeof readPersonNoteBlocks>>;
        try {
            verified = await readPersonNoteBlocks(personDocId);
        } catch (cause) {
            throw new PersonNoteProjectionUnknownError("人物备注请求已发出，但回读失败，结果未知", { cause });
        }
        if (!next) {
            if (verified.length !== 0) throw new PersonNoteProjectionUnknownError("人物备注清空请求已接受，但回读仍发现备注块");
            unknownNoteWrites.delete(personDocId);
            return "";
        }
        if (verified.length !== 1 || verified[0].format !== "2" || parsePersonNoteBlock(verified[0]) !== next) {
            throw new PersonNoteProjectionUnknownError("人物备注请求已接受，但回读尚未收敛到预期内容");
        }
        unknownNoteWrites.delete(personDocId);
        return next;
    });
}
