/**
 * 块级操作：插入/更新/删除markdown 块，以及按块属性定位块。
 * 用于维护人物文档的"相关人物"区块（带 custom-lvct-related 属性标记）。
 * SQL 组装遵守 DATA-CONTRACT §4：进入语句的值仅限严格校验过的思源 ID。
 */
import { firstOperationId, kernelPost, newNodeId, querySql } from "./client";
import type { InsertBlockData } from "./client";

/** 在容器块（通常是文档根）末尾追加一个 markdown 块，返回新块 ID */
export async function appendBlockMd(parentId: string, markdown: string): Promise<string> {
    const data = await kernelPost<InsertBlockData>("/api/block/insertBlock", {
        dataType: "markdown",
        parentID: parentId,
        data: markdown,
    });
    const id = firstOperationId(data);
    if (!id) throw new Error("insertBlock 未返回新块 ID");
    return id;
}

/** 整块更新为新的 markdown（保留原块 ID） */
export async function updateBlockMd(blockId: string, markdown: string): Promise<void> {
    await kernelPost<unknown>("/api/block/updateBlock", { id: blockId, dataType: "markdown", data: markdown });
}

export async function deleteBlock(blockId: string): Promise<void> {
    await kernelPost<unknown>("/api/block/deleteBlock", { id: blockId });
}

/**
 * 在文档内查找带指定 custom-* 块属性的块。
 * 自定义属性存储在 blocks.ial（JSON 字符串）列——attributes 表已弃用（内核源码实证）。
 * attrName 是本插件的常量（custom- 前缀小写），rootId 必须是合法节点 ID，均受控后才进语句。
 */
export async function findBlockIdByCustomAttr(rootId: string, attrName: string): Promise<string | undefined> {
    if (!/^\d{14}-[0-9a-z]{7}$/.test(rootId)) throw new Error("rootId 不是合法的思源 ID");
    if (!/^custom-[a-z0-9-]+$/.test(attrName)) throw new Error("attrName 必须是 custom- 前缀的小写属性名");
    const rows = await querySql<{ id: string }>(
        `SELECT id FROM blocks WHERE root_id = '${rootId}' AND ial LIKE '%${attrName}="%' LIMIT 1`,
    );
    return rows[0]?.id;
}

/**
 * 文档内所有出链指向的文档 ID（去重）——"从笔记捕获人脉"的确定性识别来源：
 * 笔记里链接了谁（siyuan://blocks 双链/块引），refs 索引里就有谁。
 */
export async function findOutgoingLinkRoots(rootId: string): Promise<string[]> {
    if (!/^\d{14}-[0-9a-z]{7}$/.test(rootId)) throw new Error("rootId 不是合法的思源 ID");
    const rows = await querySql<{ docId: string }>(
        `SELECT DISTINCT def_block_root_id AS docId FROM refs WHERE root_id = '${rootId}' AND def_block_root_id != ''`,
    );
    return rows.map((row) => row.docId).filter((id) => /^\d{14}-[0-9a-z]{7}$/.test(id));
}

/** 某笔记本下的文档清单（收编候选的数据源，最多 limit 篇） */
export async function listNotebookDocs(notebookId: string, limit: number = 500): Promise<Array<{ id: string; content: string; hpath: string }>> {
    if (!/^\d{14}-[0-9a-z]{7}$/.test(notebookId)) throw new Error("notebookId 不是合法的思源 ID");
    return querySql(
        `SELECT id, content, hpath FROM blocks WHERE type='d' AND box='${notebookId}' LIMIT ${Math.max(1, Math.min(limit, 1000))}`,
    );
}

/** 单块简要信息（content；ID 严格校验） */
export async function getBlockContent(blockId: string): Promise<string | undefined> {
    if (!/^\d{14}-[0-9a-z]{7}$/.test(blockId)) throw new Error("blockId 不是合法的思源 ID");
    const rows = await querySql<{ content: string }>(`SELECT content FROM blocks WHERE id = '${blockId}' LIMIT 1`);
    return rows[0]?.content;
}

/** 导出文档全文 markdown（含子文档？不含，仅本文档内容；ID 严格校验） */
export async function fetchDocMarkdown(docId: string): Promise<{ hPath: string; content: string }> {
    if (!/^\d{14}-[0-9a-z]{7}$/.test(docId)) throw new Error("docId 不是合法的思源 ID");
    const data = await kernelPost<{ hPath: string; content: string }>("/api/export/exportMdContent", { id: docId });
    return { hPath: data?.hPath ?? "", content: data?.content ?? "" };
}

/** 幂等写"带属性标记的单块"：有内容则更新/追加，无内容则删除。existingId 由调用方先查好（无查询则传 undefined）
 *  IAL 语法必须独占一行跟在块内容后（行尾式不会被解析为属性，spike/ial-probe 实证） */
export async function upsertMarkedBlock(
    rootId: string,
    attrName: string,
    markdown: string,
    existingId?: string,
): Promise<void> {
    const marked = markdown.length > 0 ? `${markdown}\n{: ${attrName}="1"}` : "";
    if (!marked) {
        if (existingId) await deleteBlock(existingId);
        return;
    }
    const id = existingId ?? (await findBlockIdByCustomAttr(rootId, attrName));
    if (id) {
        await updateBlockMd(id, marked);
    } else {
        await appendBlockMd(rootId, marked);
    }
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
    const rows = await querySql<{ id: string; ial: string; markdown: string }>(
        `SELECT id, ial, markdown FROM blocks WHERE root_id = '${rootId}' AND type = 'i' AND subtype = 't' AND ial LIKE '%${FOLLOW_UP_ATTR}="%'`,
    );
    const result: Array<{ blockId: string; followUpId: string; markdown: string }> = [];
    for (const row of rows) {
        const match = String(row.ial ?? "").match(new RegExp(`${FOLLOW_UP_ATTR}="([^"]+)"`));
        if (match) result.push({ blockId: row.id, followUpId: match[1], markdown: String(row.markdown ?? "") });
    }
    return result;
}
