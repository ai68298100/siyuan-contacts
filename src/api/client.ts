/**
 * 内核 HTTP 传输层：api/ 目录是唯一允许发内核请求的地方。
 * 全部端点形状经 M0 spike 在 v3.8.5 真内核实证（scripts/spike/）。
 * CODE-02.6 API 边界：请求有界（超时拒绝，不自动重试——写入重试会产生重复块），
 * 协议异常形状上抛，不得归一为空结果（读故障显式化）。
 */
import { fetchPost } from "siyuan";
import { withTimeout } from "../shared/async";

export interface KernelResponse<T> {
    code: number;
    msg: string;
    data: T;
}

/** 内核请求等待上限；宿主卡顿时以超时拒绝，用户可在界面重试（写入严禁自动重试） */
export const kernelConfig = { timeoutMs: 15_000 };

function kernelPost<T>(route: string, body: Record<string, unknown> = {}): Promise<T> {
    return withTimeout(
        () => new Promise<T>((resolve, reject) => {
            fetchPost(route, body, (response: { code?: number; msg?: string; data?: T }) => {
                if (!response || typeof response.code !== "number") {
                    reject(new Error(`${route} 返回异常响应`));
                } else if (response.code !== 0) {
                    reject(new Error(`${route} code=${response.code} msg=${response.msg || ""}`));
                } else {
                    resolve(response.data as T);
                }
            });
        }),
        kernelConfig.timeoutMs,
        route,
    );
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
    const data = await kernelPost<{ notebooks?: NotebookMeta[] }>("/api/notebook/lsNotebooks", {});
    /* CODE-02.6：缺 notebooks 字段是协议异常，不得按「没有笔记本」处理（会引导重复建库） */
    if (!Array.isArray(data?.notebooks)) throw new Error("/api/notebook/lsNotebooks 返回异常形状（缺 notebooks 数组）");
    return data.notebooks;
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

/**
 * 文档改名（B13 组织改名）。spike:b13 通道7 实证（v3.8.6）：
 * path 参数必须是物理路径 `/{docId}.sy`（传 hpath 报 invalid document path）；
 * 改名后 blocks.content（文档标题）更新，正文与 custom-* 标记块 IAL 保留。
 */
export async function renameDoc(notebookId: string, docId: string, title: string): Promise<void> {
    if (!/^\d{14}-[0-9a-z]{7}$/.test(docId)) throw new Error("docId 不是合法的思源 ID");
    await kernelPost("/api/filetree/renameDoc", { notebook: notebookId, path: `/${docId}.sy`, title });
}

/* ---------- SQL（仅用于文档/块查询；数据库没有 SQL 表，见 DATA-CONTRACT §1.5） ---------- */

export interface DocRow {
    id: string;
    content: string;
    hpath: string;
    box?: string;
}

/** 跑一条只读 SQL；思源索引异步刷新，写后立刻查可能短暂滞后 */
export async function querySql<T = Record<string, unknown>>(stmt: string): Promise<T[]> {
    const data = await kernelPost<T[]>("/api/query/sql", { stmt });
    /* CODE-02.6：非数组是协议异常（挂起/损坏响应），不得静默按空结果处理 */
    if (!Array.isArray(data)) throw new Error("/api/query/sql 返回异常形状（非数组）");
    return data;
}

/* ---------- block ---------- */

interface DoOperation {
    id: string;
    action: string;
}

interface TransactionResult {
    operations?: DoOperation[];
    doOperations?: DoOperation[];
}

/**
 * insertBlock 等写入端点的 data 形状：
 * v3.8.5 实测（spike/init-resume 通道）是**事务结果数组** `[{doOperations:[…]}]`，
 * 早期代码按对象读导致首次引导在建库一步抛"未返回新块 ID"。
 * 两种形状都容忍，取第一个带 id 的操作。
 */
export type InsertBlockData = TransactionResult[] | TransactionResult;

export function firstOperationId(data: InsertBlockData | undefined): string {
    const results: TransactionResult[] = Array.isArray(data) ? data : data ? [data] : [];
    for (const result of results) {
        const operation = result?.doOperations?.[0] ?? result?.operations?.[0];
        if (operation?.id) return operation.id;
    }
    return "";
}

/** 向文档追加一个块（DOM），返回新块 ID */
export async function appendBlockDom(parentBlockId: string, dom: string): Promise<string> {
    const data = await kernelPost<InsertBlockData>("/api/block/insertBlock", {
        dataType: "dom",
        parentID: parentBlockId,
        data: dom,
    });
    const id = firstOperationId(data);
    if (!id) throw new Error("insertBlock 未返回新块 ID");
    return id;
}

export { kernelPost };
