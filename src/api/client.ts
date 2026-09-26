/**
 * 内核 HTTP 传输层：api/ 目录是唯一允许发内核请求的地方。
 * 全部端点形状经 M0 spike 在 v3.8.5 真内核实证（scripts/spike/）。
 */
import { fetchPost } from "siyuan";

export interface KernelResponse<T> {
    code: number;
    msg: string;
    data: T;
}

function kernelPost<T>(route: string, body: Record<string, unknown> = {}): Promise<T> {
    return new Promise((resolve, reject) => {
        fetchPost(route, body, (response: { code?: number; msg?: string; data?: T }) => {
            if (!response || typeof response.code !== "number") {
                reject(new Error(`${route} 返回异常响应`));
            } else if (response.code !== 0) {
                reject(new Error(`${route} code=${response.code} msg=${response.msg || ""}`));
            } else {
                resolve(response.data as T);
            }
        });
    });
}

/**
 * 生成合法节点 ID（yyyyMMddHHmmss-xxxxxxx，同 Lute.NewNodeID 格式）。
 * 仅作标识符使用，无加密语义，随机性要求与内核同源。
 */
export function newNodeId(now: Date = new Date()): string {
    const pad = (value: number, width: number) => String(value).padStart(width, "0");
    const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1, 2)}${pad(now.getDate(), 2)}${pad(now.getHours(), 2)}${pad(now.getMinutes(), 2)}${pad(now.getSeconds(), 2)}`;
    const charset = "0123456789abcdefghijklmnopqrstuvwxyz";
    let rand = "";
    for (let i = 0; i < 7; i += 1) {
        rand += charset[Math.floor(Math.random() * charset.length)];
    }
    return `${stamp}-${rand}`;
}

/* ---------- notebook / filetree ---------- */

export interface NotebookMeta {
    id: string;
    name: string;
}

export async function listNotebooks(): Promise<NotebookMeta[]> {
    const data = await kernelPost<{ notebooks: NotebookMeta[] }>("/api/notebook/lsNotebooks", {});
    return data?.notebooks ?? [];
}

/** 思源在部分版本下 createNotebook 的返回值不是 ID，创建后统一重新列表获取（spike 结论） */
export async function createNotebook(name: string): Promise<NotebookMeta> {
    const existing = (await listNotebooks()).find((notebook) => notebook.name === name);
    if (existing) throw new Error(`已存在同名笔记本「${name}」`);
    await kernelPost<unknown>("/api/notebook/createNotebook", { name });
    const created = (await listNotebooks()).find((notebook) => notebook.name === name);
    if (!created) throw new Error(`笔记本「${name}」创建后未在列表中出现`);
    return created;
}

export async function createDocWithMd(notebookId: string, hPath: string, markdown: string): Promise<string> {
    return kernelPost<string>("/api/filetree/createDocWithMd", { notebook: notebookId, path: hPath, markdown });
}

/* ---------- block ---------- */

interface DoOperation {
    id: string;
    action: string;
}

interface InsertBlockData {
    operations?: DoOperation[];
    doOperations?: DoOperation[];
}

/** 向文档追加一个块（DOM），返回新块 ID */
export async function appendBlockDom(parentBlockId: string, dom: string): Promise<string> {
    const data = await kernelPost<InsertBlockData>("/api/block/insertBlock", {
        dataType: "dom",
        parentID: parentBlockId,
        data: dom,
    });
    const op = data?.doOperations?.[0] ?? data?.operations?.[0];
    if (!op?.id) throw new Error("insertBlock 未返回新块 ID");
    return op.id;
}

export { kernelPost };
