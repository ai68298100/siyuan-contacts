/** 人物补充资料只保存在人物原生文档；原块身份和完整快照共同构成编辑基线。 */
import { allocatePersonFieldsBlockId, readPersonFieldsBlocks, writePersonFieldsBlock } from "../api/person-fields";
import { KernelPermissionError, KernelResponseError } from "../api/client";
import { withStoreLock } from "../data/storage";
import {
    buildPersonFieldsDom,
    emptyPersonFields,
    normalizePersonFields,
    parsePersonFieldsBlock,
    personFieldsKey,
} from "../domain/person-fields.ts";
import type { PersonFieldsSnapshot, PersonFieldsState } from "../domain/person-fields.ts";

export class PersonFieldsProjectionUnknownError extends Error {}

interface PendingPersonFieldsWrite {
    targetKey: string;
    blockId: string;
    expected: PersonFieldsState;
}

/** 同窗口的已发请求只读核实；不把找不到或同内容的其他块当成未发送。 */
const unknownPersonFieldsWrites = new Map<string, PendingPersonFieldsWrite>();
const NODE_ID = /^\d{14}-[0-9a-z]{7}$/;

function assertDocId(docId: string): void {
    if (typeof docId !== "string" || !NODE_ID.test(docId)) throw new Error("人物文档 ID 无效");
}

function normalizeState(value: PersonFieldsState, docId: string): PersonFieldsState {
    if (!value || typeof value !== "object" || Array.isArray(value)
        || value.blockId !== undefined && (!NODE_ID.test(value.blockId) || value.blockId === docId)) {
        throw new Error("补充资料编辑基线无效，请重新读取");
    }
    return { ...(value.blockId !== undefined ? { blockId: value.blockId } : {}), snapshot: normalizePersonFields(value.snapshot, docId) };
}

function sameState(left: PersonFieldsState, right: PersonFieldsState): boolean {
    return left.blockId === right.blockId && personFieldsKey(left.snapshot) === personFieldsKey(right.snapshot);
}

export async function loadPersonFields(docId: string): Promise<PersonFieldsState> {
    assertDocId(docId);
    const blocks = await readPersonFieldsBlocks(docId);
    if (blocks.length > 1) throw new PersonFieldsProjectionUnknownError("人物文档存在多个补充资料块，未自动选择或覆盖");
    if (!blocks.length) return { snapshot: emptyPersonFields(docId) };
    try {
        return { blockId: blocks[0].id, snapshot: parsePersonFieldsBlock(blocks[0], docId) };
    } catch (cause) {
        throw new PersonFieldsProjectionUnknownError("补充资料格式或人物归属无法核实，未按空资料处理", { cause });
    }
}

export async function savePersonFields(
    docId: string,
    snapshot: PersonFieldsSnapshot,
    expected: PersonFieldsState,
): Promise<PersonFieldsState> {
    assertDocId(docId);
    // Validate and clone before entering a request state. Invalid input never
    // becomes an unknown write and cannot poison the next valid submission.
    const next = normalizePersonFields(snapshot, docId);
    const baseline = normalizeState(expected, docId);
    const targetKey = personFieldsKey(next);
    return withStoreLock(`person-fields:${docId}`, async () => {
        const current = await loadPersonFields(docId);
        const pending = unknownPersonFieldsWrites.get(docId);
        if (pending) {
            if (current.blockId !== pending.blockId || personFieldsKey(current.snapshot) !== pending.targetKey) {
                throw new PersonFieldsProjectionUnknownError("上次补充资料写入结果未知，当前仅核实原请求，未重复发送");
            }
            unknownPersonFieldsWrites.delete(docId);
            if (targetKey === pending.targetKey) return current;
            // A different draft must carry a fresh baseline after the original
            // request is verified; the stale pre-write baseline has no authority.
        }
        if (!sameState(current, baseline)) {
            throw new PersonFieldsProjectionUnknownError("补充资料已在其他窗口变化，请重新读取后再保存");
        }
        if (personFieldsKey(current.snapshot) === targetKey) return current;
        const blockId = current.blockId ?? allocatePersonFieldsBlockId();
        // All local DOM/identity validation precedes the pending marker.
        buildPersonFieldsDom(next, blockId);
        unknownPersonFieldsWrites.set(docId, { targetKey, blockId, expected: baseline });
        try {
            await writePersonFieldsBlock(docId, next, current.blockId, blockId);
        } catch (cause) {
            if (cause instanceof KernelResponseError || cause instanceof KernelPermissionError) {
                unknownPersonFieldsWrites.delete(docId);
                throw cause;
            }
            throw new PersonFieldsProjectionUnknownError("补充资料请求已发出，但响应未核实，结果未知", { cause });
        }
        let verified: PersonFieldsState;
        try {
            verified = await loadPersonFields(docId);
        } catch (cause) {
            throw new PersonFieldsProjectionUnknownError("补充资料请求已发出，但回读失败，结果未知", { cause });
        }
        if (verified.blockId !== blockId || personFieldsKey(verified.snapshot) !== targetKey) {
            throw new PersonFieldsProjectionUnknownError("补充资料请求已接受，但回读尚未收敛到原块及完整快照");
        }
        unknownPersonFieldsWrites.delete(docId);
        return verified;
    });
}
