/**
 * 块级操作：插入/更新/删除markdown 块，以及按块属性定位块。
 * 用于维护人物文档的"相关人物"区块（带 custom-lvct-related 属性标记）。
 * SQL 组装遵守 DATA-CONTRACT §4：进入语句的值仅限严格校验过的思源 ID。
 */
import { kernelPost, newNodeId, querySql } from "./client";

interface DoOperationsData {
    operations?: Array<{ id: string; action: string }>;
    doOperations?: Array<{ id: string; action: string }>;
}

/** 在容器块（通常是文档根）末尾追加一个 markdown 块，返回新块 ID */
export async function appendBlockMd(parentId: string, markdown: string): Promise<string> {
    const data = await kernelPost<DoOperationsData>("/api/block/insertBlock", {
        dataType: "markdown",
        parentID: parentId,
        data: markdown,
    });
    const op = data?.doOperations?.[0] ?? data?.operations?.[0];
    if (!op?.id) throw new Error("insertBlock 未返回新块 ID");
    return op.id;
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
