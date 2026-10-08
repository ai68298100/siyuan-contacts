import { assertKernelRecord, decodeInsertBlockData, kernelPost, KernelProtocolError, newNodeId, querySql } from "./client";
import { buildTaskMarkdown, parseTaskMarkdown } from "../domain/followup-doc";
import type { DocTaskBlock } from "../domain/followup-doc";
import type { FollowUpItem } from "../domain/followups";

const NODE_ID = /^\d{14}-[0-9a-z]{7}$/;
const PAGE_SIZE = 200;

function assertNodeId(value: string): void {
    if (!NODE_ID.test(value)) throw new Error("任务目标不是合法的思源 ID");
}

export class FollowUpDocumentMissingError extends Error {}

export async function readFollowUpTaskBlocks(rootId: string): Promise<DocTaskBlock[]> {
    assertNodeId(rootId);
    await kernelPost("/api/sqlite/flushTransaction");
    const roots = await querySql<unknown>(`SELECT id FROM blocks WHERE id = '${rootId}' AND type = 'd' LIMIT 1`);
    if (roots.length === 0) throw new FollowUpDocumentMissingError("人物文档不可达，任务状态尚未核实");
    if (assertKernelRecord("/api/query/sql", roots[0]).id !== rootId) {
        throw new KernelProtocolError("/api/query/sql", "人物文档查询返回错误 ID");
    }
    const blocks: DocTaskBlock[] = [];
    let cursor = "";
    while (true) {
        const after = cursor ? ` AND id > '${cursor}'` : "";
        const rows = await querySql<unknown>(
            `SELECT id, ial, markdown FROM blocks WHERE root_id = '${rootId}' AND type = 'i' AND subtype = 't' AND ial LIKE '%custom-lvct-followup="%'${after} ORDER BY id LIMIT ${PAGE_SIZE}`,
        );
        for (const raw of rows) {
            const row = assertKernelRecord("/api/query/sql", raw);
            const match = typeof row.ial === "string" ? row.ial.match(/(?:^|\s)custom-lvct-followup="([^"]+)"/) : null;
            if (typeof row.id !== "string" || !NODE_ID.test(row.id) || row.id <= cursor || typeof row.markdown !== "string" || !match) {
                throw new KernelProtocolError("/api/query/sql", "任务扫描返回损坏行或分页游标未前进");
            }
            blocks.push({ blockId: row.id, followUpId: match[1], markdown: row.markdown });
            cursor = row.id;
        }
        if (rows.length < PAGE_SIZE) return blocks;
    }
}

function escapeHtml(value: string): string {
    return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function taskItemDom(item: FollowUpItem, blockId: string): string {
    const done = item.status === "done";
    const title = parseTaskMarkdown(buildTaskMarkdown(item.title, item.dueDate, done)).title;
    return `<div data-node-id="${blockId}" data-type="NodeListItem" data-subtype="t" data-marker="*" data-task="${done ? "x" : " "}" class="li" custom-lvct-followup="${escapeHtml(item.id)}"><div class="protyle-action protyle-action--task"><svg><use xlink:href="#${done ? "iconCheck" : "iconUncheck"}"></use></svg></div><div data-node-id="${newNodeId()}" data-type="NodeParagraph" class="p"><div contenteditable="true">${escapeHtml(title)} 📅${item.dueDate}</div></div></div>`;
}

export async function writeFollowUpTask(rootId: string, item: FollowUpItem, blockId: string, insert: boolean): Promise<void> {
    assertNodeId(rootId);
    assertNodeId(blockId);
    const task = taskItemDom(item, blockId);
    if (insert) {
        await kernelPost("/api/block/insertBlock", {
            parentID: rootId, dataType: "dom",
            data: `<div data-node-id="${newNodeId()}" data-type="NodeList" data-subtype="t" class="list">${task}</div>`,
        }, { decode: (data) => decodeInsertBlockData("/api/block/insertBlock", data) });
    } else {
        await kernelPost("/api/block/updateBlock", { id: blockId, dataType: "dom", data: task });
    }
}
