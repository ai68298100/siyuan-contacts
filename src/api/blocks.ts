/**
 * 块级操作：插入/更新/删除markdown 块，以及按块属性定位块。
 * 用于维护人物文档的"相关人物"区块（带 custom-lvct-related 属性标记）。
 * SQL 组装遵守 DATA-CONTRACT §4：进入语句的值仅限严格校验过的思源 ID。
 */
import {
    assertKernelRecord,
    decodeDocumentExport,
    decodeInsertBlockData,
    firstOperationId,
    KernelProtocolError,
    kernelPost,
    newNodeId,
    querySql,
} from "./client";
import { organizationIalAttributes, sameOrganizationIal, ORGANIZATION_ATTR, ORGANIZATION_DRAFT_ATTR } from "../domain/organization-operations.ts";
import type { OrganizationFact } from "../domain/organization-operations.ts";
import { buildPersonNoteDom, PERSON_NOTE_ATTR, PERSON_NOTE_DETACHED_ATTR, PERSON_NOTE_FORMAT_ATTR } from "../domain/person-note.ts";
import type { PersonNoteBlock } from "../domain/person-note.ts";

export class OrganizationWriteNotSentError extends Error {}

const NODE_ID = /^\d{14}-[0-9a-z]{7}$/;
function assertNodeId(value: string, label = "块 ID"): void {
    if (typeof value !== "string" || !NODE_ID.test(value)) throw new Error(`${label}不是合法的思源 ID`);
}

export async function readOrganizationFact(docId: string): Promise<OrganizationFact> {
    if (!/^\d{14}-[0-9a-z]{7}$/.test(docId)) throw new Error("组织文档 ID 非法");
    await flushBlockIndex();
    const rows = await querySql<unknown>(`SELECT id, content, box, path FROM blocks WHERE type='d' AND id='${docId}'`);
    const doc = rows.length === 1 ? assertKernelRecord("/api/query/sql", rows[0]) : null;
    if (!doc || doc.id !== docId || typeof doc.content !== "string" || !doc.content.trim()
        || typeof doc.box !== "string" || !/^\d{14}-[0-9a-z]{7}$/.test(doc.box)
        || typeof doc.path !== "string" || !/^\/(?:\d{14}-[0-9a-z]{7}\/)*\d{14}-[0-9a-z]{7}\.sy$/.test(doc.path)
        || !doc.path.endsWith(`/${docId}.sy`)) throw new KernelProtocolError("/api/query/sql", "组织文档身份或物理路径未核实");
    const markers = await querySql<unknown>(`SELECT id, root_id, box, ial, markdown, type FROM blocks WHERE root_id='${docId}' AND ial LIKE '%custom-lvct-org="%' ORDER BY id LIMIT 2`);
    const marker = markers.length === 1 ? assertKernelRecord("/api/query/sql", markers[0]) : null;
    if (!marker || typeof marker.id !== "string" || !/^\d{14}-[0-9a-z]{7}$/.test(marker.id) || marker.id === docId
        || marker.root_id !== docId || marker.box !== doc.box || marker.type !== "p"
        || typeof marker.markdown !== "string" || typeof marker.ial !== "string") {
        throw new KernelProtocolError("/api/query/sql", "组织标记未唯一核实，未自动选择、追加或删除");
    }
    const attributes = organizationIalAttributes(marker.ial);
    const value = attributes[ORGANIZATION_ATTR];
    if (value !== "1" && value !== "archived" || attributes.id !== undefined && attributes.id !== marker.id) {
        throw new KernelProtocolError("/api/query/sql", "组织标记属性值或块身份未知");
    }
    return { docId, name: doc.content, notebookId: doc.box, path: doc.path,
        marker: { id: marker.id, markdown: marker.markdown, ial: marker.ial, value } };
}

export async function findOrganizationRequest(requestId: string): Promise<{ docId: string; markerId: string; notebookId: string } | null> {
    if (!/^\d{14}-[0-9a-z]{7}$/.test(requestId)) throw new Error("组织创建请求 ID 非法");
    await flushBlockIndex();
    const rows = await querySql<unknown>(`SELECT id, root_id, box, ial FROM blocks WHERE ial LIKE '%${ORGANIZATION_DRAFT_ATTR}="${requestId}"%' ORDER BY id LIMIT 2`);
    if (!rows.length) return null;
    const marker = rows.length === 1 ? assertKernelRecord("/api/query/sql", rows[0]) : null;
    if (!marker || typeof marker.id !== "string" || !/^\d{14}-[0-9a-z]{7}$/.test(marker.id)
        || typeof marker.root_id !== "string" || !/^\d{14}-[0-9a-z]{7}$/.test(marker.root_id)
        || typeof marker.box !== "string" || !/^\d{14}-[0-9a-z]{7}$/.test(marker.box)
        || typeof marker.ial !== "string" || organizationIalAttributes(marker.ial)[ORGANIZATION_DRAFT_ATTR] !== requestId) {
        throw new KernelProtocolError("/api/query/sql", "原组织请求标记重复或损坏，未按同名对应文档");
    }
    return { docId: marker.root_id, markerId: marker.id, notebookId: marker.box };
}

async function assertOrganizationWriteFact(expected: OrganizationFact): Promise<void> {
    const current = await readOrganizationFact(expected.docId);
    if (current.name !== expected.name || current.path !== expected.path || current.notebookId !== expected.notebookId
        || current.marker.id !== expected.marker.id || current.marker.markdown !== expected.marker.markdown
        || !sameOrganizationIal(current.marker.ial, expected.marker.ial)) {
        throw new OrganizationWriteNotSentError("组织事实在发送前变化，请重新核实，未发送请求");
    }
}

export async function renameOrganizationTitle(expected: OrganizationFact, title: string): Promise<void> {
    await assertOrganizationWriteFact(expected);
    await kernelPost("/api/filetree/renameDoc", { notebook: expected.notebookId, path: expected.path, title });
}

export async function updateOrganizationMarker(expected: OrganizationFact, markdown: string): Promise<void> {
    await assertOrganizationWriteFact(expected);
    await updateBlockMd(expected.marker.id, `${markdown}\n${expected.marker.ial}`);
}

/** 在容器块（通常是文档根）末尾追加一个 markdown 块，返回新块 ID */
export async function appendBlockMd(parentId: string, markdown: string): Promise<string> {
    assertNodeId(parentId, "父块 ID");
    if (typeof markdown !== "string") throw new Error("块内容必须是文本");
    const data = await kernelPost("/api/block/insertBlock", {
        dataType: "markdown",
        parentID: parentId,
        data: markdown,
    }, { decode: (value) => decodeInsertBlockData("/api/block/insertBlock", value) });
    const id = firstOperationId(data);
    if (!id) throw new KernelProtocolError("/api/block/insertBlock", "/api/block/insertBlock 返回异常形状（未返回新块 ID）");
    return id;
}

/** 整块更新为新的 markdown（保留原块 ID） */
export async function updateBlockMd(blockId: string, markdown: string): Promise<void> {
    assertNodeId(blockId);
    if (typeof markdown !== "string") throw new Error("块内容必须是文本");
    await kernelPost<unknown>("/api/block/updateBlock", { id: blockId, dataType: "markdown", data: markdown });
}

export async function deleteBlock(blockId: string): Promise<void> {
    assertNodeId(blockId);
    await kernelPost<unknown>("/api/block/deleteBlock", { id: blockId });
}

export async function flushBlockIndex(): Promise<void> {
    await kernelPost("/api/sqlite/flushTransaction");
}

export const VCARD_REQUEST_ATTR = "custom-lvct-vcard";
export const SELF_DRAFT_ATTR = "custom-lvct-self-draft";
export const CONTACT_DRAFT_ATTR = "custom-lvct-contact-draft";

export async function readNotebookDocument(notebookId: string, docId: string): Promise<{ docId: string; name: string } | null> {
    if (!/^\d{14}-[0-9a-z]{7}$/.test(notebookId) || !/^\d{14}-[0-9a-z]{7}$/.test(docId)) throw new Error("笔记本或文档 ID 非法");
    await flushBlockIndex();
    const docs = await querySql<unknown>(`SELECT id, content FROM blocks WHERE type='d' AND box='${notebookId}' AND id='${docId}'`);
    if (!docs.length) return null;
    const doc = docs.length === 1 ? assertKernelRecord("/api/query/sql", docs[0]) : null;
    if (!doc || doc.id !== docId || typeof doc.content !== "string") throw new KernelProtocolError("/api/query/sql", "原请求人物文档尚未核实");
    return { docId, name: doc.content };
}

export async function documentExists(docId: string): Promise<boolean> {
    if (!/^\d{14}-[0-9a-z]{7}$/.test(docId)) throw new Error("文档 ID 非法");
    await flushBlockIndex();
    const rows = await querySql<unknown>(`SELECT id FROM blocks WHERE id = '${docId}' AND type = 'd' LIMIT 2`);
    if (!rows.length) return false;
    if (rows.length !== 1 || assertKernelRecord("/api/query/sql", rows[0]).id !== docId) {
        throw new KernelProtocolError("/api/query/sql", "目标文档回读形状异常，尚未核实可达性");
    }
    return true;
}

export async function findVcardRequestDoc(notebookId: string, requestId: string): Promise<{ docId: string; name: string } | null> {
    return findCreationRequestDoc(notebookId, requestId, VCARD_REQUEST_ATTR);
}

export async function findCreationRequestDoc(notebookId: string, requestId: string, attrName: typeof VCARD_REQUEST_ATTR | typeof SELF_DRAFT_ATTR | typeof CONTACT_DRAFT_ATTR): Promise<{ docId: string; name: string } | null> {
    if (attrName !== VCARD_REQUEST_ATTR && attrName !== SELF_DRAFT_ATTR && attrName !== CONTACT_DRAFT_ATTR) throw new Error("建档请求属性非法");
    if (!/^\d{14}-[0-9a-z]{7}$/.test(notebookId) || !/^\d{14}-[0-9a-z]{7}$/.test(requestId)) throw new Error("vCard 请求标记或笔记本 ID 非法");
    await flushBlockIndex();
    const roots = await querySql<unknown>(`SELECT DISTINCT root_id FROM blocks WHERE box='${notebookId}' AND ial LIKE '%${attrName}="${requestId}"%' LIMIT 2`);
    if (!roots.length) return null;
    if (roots.length !== 1) throw new KernelProtocolError("/api/query/sql", "vCard 请求对应多个文档，未自动选择");
    const root = assertKernelRecord("/api/query/sql", roots[0]);
    if (typeof root.root_id !== "string" || !/^\d{14}-[0-9a-z]{7}$/.test(root.root_id)) throw new KernelProtocolError("/api/query/sql", "vCard 请求标记返回非法根文档");
    const docs = await querySql<unknown>(`SELECT id, content FROM blocks WHERE type='d' AND box='${notebookId}' AND id='${root.root_id}'`);
    const doc = docs.length === 1 ? assertKernelRecord("/api/query/sql", docs[0]) : null;
    if (!doc || doc.id !== root.root_id || typeof doc.content !== "string") throw new KernelProtocolError("/api/query/sql", "vCard 请求人物文档尚未核实");
    return { docId: root.root_id, name: doc.content };
}

/**
 * 在文档内查找带指定 custom-* 块属性的块。
 * 自定义属性存储在 blocks.ial（JSON 字符串）列——attributes 表已弃用（内核源码实证）。
 * attrName 是本插件的常量（custom- 前缀小写），rootId 必须是合法节点 ID，均受控后才进语句。
 */
export async function findBlockIdByCustomAttr(rootId: string, attrName: string): Promise<string | undefined> {
    if (!/^\d{14}-[0-9a-z]{7}$/.test(rootId)) throw new Error("rootId 不是合法的思源 ID");
    if (!/^custom-[a-z0-9-]+$/.test(attrName)) throw new Error("attrName 必须是 custom- 前缀的小写属性名");
    const rows = await querySql<unknown>(
        `SELECT id FROM blocks WHERE root_id = '${rootId}' AND ial LIKE '%${attrName}="%' LIMIT 1`,
    );
    if (rows.length === 0) return undefined;
    const row = assertKernelRecord("/api/query/sql", rows[0]);
    if (typeof row.id !== "string" || !/^\d{14}-[0-9a-z]{7}$/.test(row.id)) {
        throw new KernelProtocolError("/api/query/sql", "属性标记查询返回非法块 ID");
    }
    return row.id;
}

export async function readMarkedBlocks(rootId: string, attrName: string): Promise<Array<{ id: string; markdown: string }>> {
    if (!/^\d{14}-[0-9a-z]{7}$/.test(rootId)) throw new Error("rootId 不是合法的思源 ID");
    if (!/^custom-[a-z0-9-]+$/.test(attrName)) throw new Error("attrName 必须是 custom- 前缀的小写属性名");
    await kernelPost("/api/sqlite/flushTransaction");
    const roots = await querySql<unknown>(`SELECT id FROM blocks WHERE id = '${rootId}' AND type = 'd' LIMIT 1`);
    if (roots.length !== 1 || assertKernelRecord("/api/query/sql", roots[0]).id !== rootId) {
        throw new Error("目标文档不可达，标记区块尚未核实");
    }
    const rows = await querySql<unknown>(
        `SELECT id, markdown FROM blocks WHERE root_id = '${rootId}' AND ial LIKE '%${attrName}="%' ORDER BY id LIMIT 2`,
    );
    return rows.map((raw) => {
        const row = assertKernelRecord("/api/query/sql", raw);
        if (typeof row.id !== "string" || !/^\d{14}-[0-9a-z]{7}$/.test(row.id) || typeof row.markdown !== "string") {
            throw new KernelProtocolError("/api/query/sql", "标记区块回读返回损坏行");
        }
        return { id: row.id, markdown: row.markdown };
    });
}

/** 去掉目标属性对应的末尾 IAL 行，保留正文作为写后核验事实。 */
function markedBlockContent(markdown: string, attrName?: string): string {
    const normalized = markdown.replace(/\r\n/g, "\n").trim();
    // The marker is appended as the final line by upsertMarkedBlock. Keep
    // IAL-looking lines in the body: they may be literal user text.
    if (!attrName) return normalized;
    const escapedAttr = attrName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const marker = new RegExp(`\\n\\s*\\{:[^\\n]*\\b${escapedAttr}="[^"\\n]*"[^}\\n]*\\}\\s*$`);
    return normalized.replace(marker, "").trim();
}

/** 回读拒绝不能作为原写请求被拒绝的证据。 */
export class MarkedBlockWriteUnknownError extends Error {
    readonly cause: unknown;

    constructor(cause: unknown) {
        super("标记区块写入请求已接受，但回读未核实预期内容");
        this.name = "MarkedBlockWriteUnknownError";
        this.cause = cause;
    }
}

/** 写入后必须重新读取唯一标记块；响应成功只代表请求被接受，不能代表正文已收敛。 */
async function verifyMarkedBlockWrite(rootId: string, attrName: string, expectedMarkdown: string): Promise<void> {
    try {
        const verified = await readMarkedBlocks(rootId, attrName);
        const matches = expectedMarkdown
            ? verified.length === 1 && markedBlockContent(verified[0].markdown, attrName) === markedBlockContent(expectedMarkdown)
            : verified.length === 0;
        if (!matches) {
            throw new KernelProtocolError("/api/query/sql", "标记区块回读未核实预期内容");
        }
    } catch (error) {
        throw new MarkedBlockWriteUnknownError(error);
    }
}

/** 个人备注按单段落 content 回读；Markdown 会丢失软换行/空白，不能作文本事实源。 */
export async function readPersonNoteBlocks(rootId: string): Promise<PersonNoteBlock[]> {
    assertNodeId(rootId, "人物文档 ID");
    await flushBlockIndex();
    const roots = await querySql<unknown>(`SELECT id FROM blocks WHERE id = '${rootId}' AND type = 'd' LIMIT 1`, { dedupe: false });
    if (roots.length !== 1 || assertKernelRecord("/api/query/sql", roots[0]).id !== rootId) {
        throw new Error("目标文档不可达，人物备注尚未核实");
    }
    const rows = await querySql<unknown>(`SELECT id, root_id, parent_id, type, content, markdown, ial FROM blocks WHERE root_id = '${rootId}' AND ial LIKE '%${PERSON_NOTE_ATTR}="%' ORDER BY id LIMIT 2`, { dedupe: false });
    const blocks = rows.map((raw): PersonNoteBlock => {
        const row = assertKernelRecord("/api/query/sql", raw);
        if (typeof row.id !== "string" || !NODE_ID.test(row.id) || row.id === rootId || row.root_id !== rootId
            || typeof row.parent_id !== "string" || row.parent_id !== rootId
            || typeof row.type !== "string" || typeof row.content !== "string" || typeof row.markdown !== "string"
            || typeof row.ial !== "string") throw new KernelProtocolError("/api/query/sql", "人物备注块回读形状异常");
        const attrs = organizationIalAttributes(row.ial);
        if (attrs[PERSON_NOTE_ATTR] !== "1" || attrs.id !== undefined && attrs.id !== row.id) {
            throw new KernelProtocolError("/api/query/sql", "人物备注标记值或块身份未知");
        }
        return { id: row.id, parentId: row.parent_id, type: row.type, content: row.content, markdown: row.markdown, format: attrs[PERSON_NOTE_FORMAT_ATTR] };
    });
    if (blocks.length !== 1 || blocks[0].format !== undefined || blocks[0].type !== "p") return blocks;
    // 旧实现只给末段打标记。仅紧邻前置标题能证明它是完整的单段备注。
    const data = await kernelPost<unknown>("/api/block/getChildBlocks", { id: rootId });
    if (!Array.isArray(data)) throw new KernelProtocolError("/api/block/getChildBlocks", "人物文档子块回读形状异常");
    const children = data.map((raw) => {
        const child = assertKernelRecord("/api/block/getChildBlocks", raw);
        if (typeof child.id !== "string" || !NODE_ID.test(child.id) || typeof child.type !== "string" || typeof child.markdown !== "string") {
            throw new KernelProtocolError("/api/block/getChildBlocks", "人物文档子块身份未知");
        }
        return child;
    });
    const index = children.findIndex((child) => child.id === blocks[0].id);
    const previous = index > 0 ? children[index - 1] : undefined;
    blocks[0].legacyTitleBefore = previous?.type === "p" && previous.markdown === "**人物备注**";
    return blocks;
}

export interface PersonNoteSourceBlock extends PersonNoteBlock {
    marker?: string;
    detached?: string;
}

/** 按已确认的块 ID 回读，解除标记后仍能核实原文和直接归属。 */
export async function readPersonNoteSourceBlock(rootId: string, blockId: string): Promise<PersonNoteSourceBlock> {
    assertNodeId(rootId, "人物文档 ID");
    assertNodeId(blockId, "旧备注块 ID");
    if (blockId === rootId) throw new Error("旧备注块不能替代人物文档");
    await flushBlockIndex();
    const roots = await querySql<unknown>(`SELECT id FROM blocks WHERE id = '${rootId}' AND type = 'd' LIMIT 1`, { dedupe: false });
    if (roots.length !== 1 || assertKernelRecord("/api/query/sql", roots[0]).id !== rootId) throw new KernelProtocolError("/api/query/sql", "目标文档不可达，旧备注解除结果尚未核实");
    const rows = await querySql<unknown>(`SELECT id, root_id, parent_id, type, content, markdown, ial FROM blocks WHERE id = '${blockId}' LIMIT 2`, { dedupe: false });
    if (rows.length !== 1) throw new KernelProtocolError("/api/query/sql", "旧备注原块不存在或身份不唯一，解除结果尚未核实");
    const row = assertKernelRecord("/api/query/sql", rows[0]);
    if (row.id !== blockId || row.root_id !== rootId || row.parent_id !== rootId || row.type !== "p"
        || typeof row.content !== "string" || typeof row.markdown !== "string" || typeof row.ial !== "string") {
        throw new KernelProtocolError("/api/query/sql", "旧备注原块正文、类型或直接归属尚未核实");
    }
    const attrs = organizationIalAttributes(row.ial);
    if (attrs.id !== undefined && attrs.id !== blockId) throw new KernelProtocolError("/api/query/sql", "旧备注原块属性身份不一致");
    return { id: blockId, parentId: rootId, type: "p", content: row.content, markdown: row.markdown,
        format: attrs[PERSON_NOTE_FORMAT_ATTR], marker: attrs[PERSON_NOTE_ATTR], detached: attrs[PERSON_NOTE_DETACHED_ATTR] };
}

/** DOM 在同一次块写入中携带标记，保证空行和用户输入不会拆成多个块。 */
export async function upsertPersonNoteBlock(rootId: string, note: string, existingId?: string): Promise<void> {
    assertNodeId(rootId, "人物文档 ID");
    if (existingId !== undefined) assertNodeId(existingId);
    if (!note) {
        if (existingId) await deleteBlock(existingId);
        return;
    }
    const id = existingId ?? newNodeId();
    const dom = buildPersonNoteDom(note, id);
    if (existingId) {
        await kernelPost("/api/block/updateBlock", { id, dataType: "dom", data: dom });
    } else {
        const data = await kernelPost("/api/block/insertBlock", { parentID: rootId, dataType: "dom", data: dom }, {
            decode: (value) => decodeInsertBlockData("/api/block/insertBlock", value),
        });
        if (firstOperationId(data) !== id) throw new KernelProtocolError("/api/block/insertBlock", "人物备注新块 ID 未核实");
    }
}

/**
 * 文档内所有出链指向的文档 ID（去重）——"从笔记捕获人脉"的确定性识别来源：
 * 笔记里链接了谁（siyuan://blocks 双链/块引），refs 索引里就有谁。
 */
export async function findOutgoingLinkRoots(rootId: string): Promise<string[]> {
    if (!/^\d{14}-[0-9a-z]{7}$/.test(rootId)) throw new Error("rootId 不是合法的思源 ID");
    const rows = await querySql<unknown>(
        `SELECT DISTINCT def_block_root_id AS docId FROM refs WHERE root_id = '${rootId}' AND def_block_root_id != ''`,
    );
    return rows.map((raw) => {
        const row = assertKernelRecord("/api/query/sql", raw);
        if (typeof row.docId !== "string" || !/^\d{14}-[0-9a-z]{7}$/.test(row.docId)) {
            throw new KernelProtocolError("/api/query/sql", "出链查询返回非法目标文档 ID");
        }
        return row.docId;
    });
}

export const NOTEBOOK_DOC_PAGE_SIZE = 500;

/** 某笔记本下的文档清单（收编候选的数据源；按 id 分页，支持安全续扫） */
export async function listNotebookDocs(
    notebookId: string,
    limit: number = NOTEBOOK_DOC_PAGE_SIZE,
    offset: number = 0,
    afterDocId?: string,
): Promise<Array<{ id: string; content: string; hpath: string }>> {
    if (!/^\d{14}-[0-9a-z]{7}$/.test(notebookId)) throw new Error("notebookId 不是合法的思源 ID");
    if (afterDocId !== undefined && !/^\d{14}-[0-9a-z]{7}$/.test(afterDocId)) throw new Error("afterDocId 不是合法的思源 ID");
    if (!Number.isSafeInteger(limit) || limit < 1) throw new Error("limit 必须是正整数");
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error("offset 必须是非负整数");
    const safeLimit = Math.min(limit, NOTEBOOK_DOC_PAGE_SIZE);
    const safeOffset = offset;
    const afterClause = afterDocId ? ` AND id > '${afterDocId}'` : "";
    const rows = await querySql<unknown>(
        `SELECT id, content, hpath FROM blocks WHERE type='d' AND box='${notebookId}'${afterClause} ORDER BY id LIMIT ${safeLimit} OFFSET ${safeOffset}`,
        // 搜索条件在服务层按关键词过滤；同一页的两次扫描可能属于不同搜索代次，
        // 不能共享旧的 in-flight SQL，否则新关键词会被旧响应卡住。
        { dedupe: false },
    );
    return rows.map((row) => {
        const record = assertKernelRecord("/api/query/sql", row);
        if (typeof record.id !== "string" || !/^\d{14}-[0-9a-z]{7}$/.test(record.id)
            || typeof record.content !== "string" || typeof record.hpath !== "string") {
            throw new KernelProtocolError("/api/query/sql", "/api/query/sql 返回异常形状（文档行缺 id/content/hpath）");
        }
        return { id: record.id, content: record.content, hpath: record.hpath };
    });
}

/** 某笔记本下的文档总数（仅用于扫描进度，不参与候选采纳） */
export async function countNotebookDocs(notebookId: string): Promise<number> {
    if (!/^\d{14}-[0-9a-z]{7}$/.test(notebookId)) throw new Error("notebookId 不是合法的思源 ID");
    const rows = await querySql<unknown>(
        `SELECT COUNT(*) AS total FROM blocks WHERE type='d' AND box='${notebookId}'`,
    );
    const record = assertKernelRecord("/api/query/sql", rows[0]);
    const raw = record.total;
    const total = typeof raw === "number"
        ? raw
        : typeof raw === "string" && /^\d+$/.test(raw)
            ? Number(raw)
            : Number.NaN;
    if (!Number.isSafeInteger(total) || total < 0) {
        throw new KernelProtocolError("/api/query/sql", "/api/query/sql 返回异常形状（文档总数非法）");
    }
    return total;
}

/** 单块简要信息（content；ID 严格校验） */
export async function getBlockContent(blockId: string): Promise<string | undefined> {
    if (!/^\d{14}-[0-9a-z]{7}$/.test(blockId)) throw new Error("blockId 不是合法的思源 ID");
    await kernelPost("/api/sqlite/flushTransaction", {});
    const rows = await querySql<unknown>(`SELECT content FROM blocks WHERE id = '${blockId}' LIMIT 1`);
    if (rows.length === 0) return undefined;
    const row = assertKernelRecord("/api/query/sql", rows[0]);
    if (typeof row.content !== "string") throw new KernelProtocolError("/api/query/sql", "块内容查询返回异常形状");
    return row.content;
}

/** 导出文档全文 markdown（含子文档？不含，仅本文档内容；ID 严格校验） */
export async function fetchDocMarkdown(docId: string): Promise<{ hPath: string; content: string }> {
    if (!/^\d{14}-[0-9a-z]{7}$/.test(docId)) throw new Error("docId 不是合法的思源 ID");
    return kernelPost("/api/export/exportMdContent", { id: docId }, {
        decode: (data) => decodeDocumentExport("/api/export/exportMdContent", data),
    });
}

/** 幂等写"带属性标记的单块"：有内容则更新/追加，无内容则删除。existingId 由调用方先查好（无查询则传 undefined）
 *  IAL 语法必须独占一行跟在块内容后（行尾式不会被解析为属性，spike/ial-probe 实证）
 *  attrValue 默认 "1"；B13 归档语义写 "archived"（扫描按值区分，见 DATA-CONTRACT §8） */
export async function upsertMarkedBlock(
    rootId: string,
    attrName: string,
    markdown: string,
    existingId?: string,
    attrValue: string = "1",
): Promise<void> {
    if (!/^[\w-]+$/.test(attrValue)) throw new Error("attrValue 只允许字母数字下划线连字符");
    const marked = markdown.length > 0 ? `${markdown}\n{: ${attrName}="${attrValue}"}` : "";
    if (!marked) {
        if (existingId) await deleteBlock(existingId);
        await verifyMarkedBlockWrite(rootId, attrName, "");
        return;
    }
    const id = existingId ?? (await findBlockIdByCustomAttr(rootId, attrName));
    if (id) {
        await updateBlockMd(id, marked);
    } else {
        await appendBlockMd(rootId, marked);
    }
    await verifyMarkedBlockWrite(rootId, attrName, markdown);
}

export { newNodeId };

/* ---------- B07：跟进任务块（原生待办双向同步，端点行为见 §3.1 与 spike 12/12 实证） ---------- */

/** 任务块关联键：IAL custom-lvct-followup="<跟进 id>" */
export const FOLLOW_UP_ATTR = "custom-lvct-followup";

/** 写任务块关联键（官方 /api/attr/setBlockAttrs；勾选后存活，spike ③ 实证） */
export async function setBlockAttrs(blockId: string, attrs: Record<string, string>): Promise<void> {
    if (!/^\d{14}-[0-9a-z]{7}$/.test(blockId)) throw new Error("blockId 不是合法的思源 ID");
    await kernelPost<unknown>("/api/attr/setBlockAttrs", { id: blockId, attrs });
}

/** 任务项勾选标记（官方端点只认列表项 ID；marker: "x" 勾选 / " " 取消） */
export async function updateTaskListItemMarker(blockId: string, marker: "x" | " "): Promise<void> {
    if (!/^\d{14}-[0-9a-z]{7}$/.test(blockId)) throw new Error("blockId 不是合法的思源 ID");
    await kernelPost<unknown>("/api/block/updateTaskListItemMarker", { id: blockId, marker });
}

/** 人物文档内本插件的跟进任务块（关联键反查 + type='i' 过滤列表容器；markdown 含勾选态） */
export async function findFollowUpTaskBlocks(
    rootId: string,
): Promise<Array<{ blockId: string; followUpId: string; markdown: string }>> {
    if (!/^\d{14}-[0-9a-z]{7}$/.test(rootId)) throw new Error("rootId 不是合法的思源 ID");
    const rows = await querySql<unknown>(
        `SELECT id, ial, markdown FROM blocks WHERE root_id = '${rootId}' AND type = 'i' AND subtype = 't' AND ial LIKE '%${FOLLOW_UP_ATTR}="%'`,
    );
    const result: Array<{ blockId: string; followUpId: string; markdown: string }> = [];
    for (const raw of rows) {
        const row = assertKernelRecord("/api/query/sql", raw);
        if (typeof row.id !== "string" || !/^\d{14}-[0-9a-z]{7}$/.test(row.id)
            || typeof row.ial !== "string" || typeof row.markdown !== "string") {
            throw new KernelProtocolError("/api/query/sql", "跟进任务查询返回异常形状");
        }
        const match = row.ial.match(new RegExp(`${FOLLOW_UP_ATTR}="([^"]+)"`));
        if (match?.[1]) result.push({ blockId: row.id, followUpId: match[1], markdown: row.markdown });
    }
    return result;
}
