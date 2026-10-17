/** 人物补充资料原生块边界；所有内核交互只在 API 层执行。 */
import {
    assertKernelArray,
    assertKernelRecord,
    decodeInsertBlockData,
    firstOperationId,
    KernelProtocolError,
    kernelPost,
    newNodeId,
} from "./client";
import { organizationIalAttributes } from "../domain/organization-operations.ts";
import {
    buildPersonFieldsDom,
    normalizePersonFields,
    PERSON_FIELDS_ATTR,
    PERSON_FIELDS_FORMAT_ATTR,
} from "../domain/person-fields.ts";
import type { PersonFieldsSnapshot } from "../domain/person-fields.ts";

export interface PersonFieldsBlock {
    id: string;
    type: string;
    content: string;
    format: string;
}

const NODE_ID = /^\d{14}-[0-9a-z]{7}$/;
function assertNodeId(value: string, label = "块 ID"): void {
    if (typeof value !== "string" || !NODE_ID.test(value)) throw new Error(`${label}不是合法的思源 ID`);
}

/** 先分配创建身份，未知响应后不能把他人的同内容块当作本请求。 */
export function allocatePersonFieldsBlockId(): string {
    return newNodeId();
}

async function freshSql(statement: string): Promise<unknown[]> {
    return kernelPost("/api/query/sql", { stmt: statement }, {
        dedupe: false,
        decode: (value) => assertKernelArray<unknown>("/api/query/sql", value),
    });
}

/** 同时发现遗失 marker 的可疑正文，防止把它当成空库并追加第二块。 */
export async function readPersonFieldsBlocks(docId: string): Promise<PersonFieldsBlock[]> {
    assertNodeId(docId, "人物文档 ID");
    await kernelPost("/api/sqlite/flushTransaction");
    const roots = await freshSql(`SELECT id FROM blocks WHERE id = '${docId}' AND type = 'd' LIMIT 2`);
    if (roots.length !== 1 || assertKernelRecord("/api/query/sql", roots[0]).id !== docId) {
        throw new KernelProtocolError("/api/query/sql", "人物文档不可达，补充资料尚未核实");
    }
    const rows = await freshSql(`SELECT id, root_id, parent_id, type, content, ial FROM blocks WHERE root_id = '${docId}' AND (ial LIKE '%${PERSON_FIELDS_ATTR}="%' OR content LIKE '补充资料' || char(10) || '{%') ORDER BY id LIMIT 2`);
    if (rows.length > 1) throw new KernelProtocolError("/api/query/sql", "人物文档存在多个补充资料候选块，未自动选择或追加");
    return rows.map((raw): PersonFieldsBlock => {
        const row = assertKernelRecord("/api/query/sql", raw);
        if (typeof row.id !== "string" || !NODE_ID.test(row.id) || row.id === docId
            || row.root_id !== docId || row.parent_id !== docId || row.type !== "p"
            || typeof row.content !== "string" || typeof row.ial !== "string") {
            throw new KernelProtocolError("/api/query/sql", "补充资料块身份、类型或直接归属尚未核实");
        }
        let attributes: Record<string, string>;
        try { attributes = organizationIalAttributes(row.ial); } catch {
            throw new KernelProtocolError("/api/query/sql", "补充资料块属性形状尚未核实");
        }
        if (attributes[PERSON_FIELDS_ATTR] !== "1" || attributes[PERSON_FIELDS_FORMAT_ATTR] !== "1"
            || attributes.id !== undefined && attributes.id !== row.id) {
            throw new KernelProtocolError("/api/query/sql", "补充资料标记、格式或块身份尚未核实");
        }
        return { id: row.id, type: row.type, content: row.content, format: attributes[PERSON_FIELDS_FORMAT_ATTR] };
    });
}

/** DOM 把正文和标记一起写入；空快照保留原块身份。写后业务核实由服务执行。 */
export async function writePersonFieldsBlock(
    docId: string,
    snapshot: PersonFieldsSnapshot,
    existingId?: string,
    allocatedId?: string,
): Promise<string> {
    assertNodeId(docId, "人物文档 ID");
    if (existingId !== undefined) assertNodeId(existingId);
    if (allocatedId !== undefined) assertNodeId(allocatedId);
    if (existingId !== undefined && allocatedId !== undefined && existingId !== allocatedId) throw new Error("补充资料目标块身份不一致");
    const blockId = existingId ?? allocatedId ?? allocatePersonFieldsBlockId();
    if (blockId === docId) throw new Error("补充资料块不能替代人物文档");
    const next = normalizePersonFields(snapshot, docId);
    const dom = buildPersonFieldsDom(next, blockId);
    if (existingId !== undefined) {
        await kernelPost("/api/block/updateBlock", { id: blockId, dataType: "dom", data: dom });
    } else {
        const data = await kernelPost("/api/block/insertBlock", { parentID: docId, dataType: "dom", data: dom }, {
            decode: (value) => decodeInsertBlockData("/api/block/insertBlock", value),
        });
        if (firstOperationId(data) !== blockId) throw new KernelProtocolError("/api/block/insertBlock", "补充资料新块 ID 未核实");
    }
    return blockId;
}
