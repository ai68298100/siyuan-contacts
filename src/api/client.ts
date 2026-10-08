/**
 * 内核 HTTP 传输层：api/ 目录是唯一允许发内核请求的地方。
 * 全部端点形状经 M0 spike 在 v3.8.5 真内核实证（scripts/spike/）。
 * CODE-02.6 API 边界：请求有界（超时拒绝，不自动重试——写入重试会产生重复块），
 * 协议异常形状上抛，不得归一为空结果（读故障显式化）。
 */
import { fetchPost } from "siyuan";
import { withTimeout } from "../shared/async";
import { validateDocumentTitle } from "../domain/format";
import {
    assertKernelArray,
    assertKernelRecord,
    decodeKernelResponse,
    KernelProtocolError,
    KernelTransportError,
} from "./kernel-contract.ts";

export type {
    KernelDataState,
    KernelFailureKind,
    KernelResponse,
} from "./kernel-contract.ts";
export {
    assertKernelArray,
    assertKernelRecord,
    classifyKernelData,
    decodeKernelResponse,
    KernelError,
    KernelPermissionError,
    KernelProtocolError,
    KernelResponseError,
    KernelTransportError,
} from "./kernel-contract.ts";

/** 内核请求等待上限；宿主卡顿时以超时拒绝，用户可在界面重试（写入严禁自动重试） */
export const kernelConfig = { timeoutMs: 15_000 };

export interface KernelPostOptions<T> {
    timeoutMs?: number;
    signal?: AbortSignal;
    decode?: (data: unknown) => T;
}

function kernelPost<T>(
    route: string,
    body: Record<string, unknown> = {},
    options: KernelPostOptions<T> = {},
): Promise<T> {
    return withTimeout(
        () => new Promise<T>((resolve, reject) => {
            const handleResponse = (response: unknown) => {
                try {
                    const envelope = decodeKernelResponse<T>(route, response);
                    resolve(options.decode ? options.decode(envelope.data) : envelope.data);
                } catch (error) {
                    reject(error);
                }
            };

            const handleFailure = (response: unknown) => {
                if (typeof response === "object" && response !== null &&
                    ("code" in response || "msg" in response || "data" in response)) {
                    handleResponse(response);
                    return;
                }
                reject(new KernelTransportError(route, response));
            };

            try {
                fetchPost(
                    route,
                    body,
                    handleResponse,
                    undefined,
                    handleFailure,
                );
            } catch (error) {
                reject(new KernelTransportError(route, error));
            }
        }),
        options.timeoutMs ?? kernelConfig.timeoutMs,
        route,
        { signal: options.signal },
    );
}

function decodeNotebookList(route: string, data: unknown): NotebookMeta[] {
    const record = assertKernelRecord(route, data);
    const notebooks = assertKernelArray<unknown>(route, record.notebooks);
    if (notebooks.some((notebook) => {
        if (typeof notebook !== "object" || notebook === null || Array.isArray(notebook)) return true;
        const candidate = notebook as Record<string, unknown>;
        return typeof candidate.id !== "string" || typeof candidate.name !== "string";
    })) {
        throw new KernelProtocolError(route, `${route} 返回异常形状（notebooks 项缺 id/name）`);
    }
    return notebooks as NotebookMeta[];
}

function decodeString(route: string, data: unknown): string {
    if (typeof data !== "string") {
        throw new KernelProtocolError(route, `${route} 返回异常形状（非字符串）`);
    }
    return data;
}

function decodeDocumentExport(route: string, data: unknown): { hPath: string; content: string } {
    const record = assertKernelRecord(route, data);
    if (typeof record.hPath !== "string" || typeof record.content !== "string") {
        throw new KernelProtocolError(route, `${route} 返回异常形状（缺 hPath/content）`);
    }
    return { hPath: record.hPath, content: record.content };
}

function decodeStringMap(route: string, data: unknown): Record<string, string> {
    const record = assertKernelRecord(route, data);
    for (const value of Object.values(record)) {
        if (typeof value !== "string") throw new KernelProtocolError(route, `${route} 返回异常形状（映射值非字符串）`);
    }
    return record as Record<string, string>;
}

function decodeArray<T>(route: string, data: unknown): T[] {
    return assertKernelArray<T>(route, data);
}

export {
    decodeArray,
    decodeDocumentExport,
    decodeNotebookList,
    decodeString,
    decodeStringMap,
};

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
    return kernelPost("/api/notebook/lsNotebooks", {}, { decode: (data) => decodeNotebookList("/api/notebook/lsNotebooks", data) });
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
    return kernelPost("/api/filetree/createDocWithMd", { notebook: notebookId, path: hPath, markdown }, {
        decode: (data) => decodeString("/api/filetree/createDocWithMd", data),
    });
}

/**
 * 文档改名（B13 组织改名）。spike:b13 通道7 实证（v3.8.6）：
 * path 参数必须是回读核实的物理路径（含嵌套父文档；传 hpath 报 invalid document path）；
 * 改名后 blocks.content（文档标题）更新，正文与 custom-* 标记块 IAL 保留。
 */
export async function renameDoc(notebookId: string, docId: string, title: string): Promise<void> {
    if (!/^\d{14}-[0-9a-z]{7}$/.test(docId)) throw new Error("docId 不是合法的思源 ID");
    if (!/^\d{14}-[0-9a-z]{7}$/.test(notebookId)) throw new Error("notebookId 不是合法的思源 ID");
    const titleError = validateDocumentTitle(title);
    if (titleError) throw new Error(titleError);
    await kernelPost("/api/sqlite/flushTransaction");
    const rows = await querySql<unknown>(`SELECT path, box, content FROM blocks WHERE type='d' AND id='${docId}'`);
    const target = rows.length === 1 ? assertKernelRecord("/api/query/sql", rows[0]) : null;
    if (!target || target.box !== notebookId || typeof target.content !== "string" || typeof target.path !== "string"
        || !/^\/(?:\d{14}-[0-9a-z]{7}\/)*\d{14}-[0-9a-z]{7}\.sy$/.test(target.path)
        || !target.path.endsWith(`/${docId}.sy`)) {
        throw new KernelProtocolError("/api/query/sql", "改名目标的文档路径与笔记本尚未核实，未写入");
    }
    const requestedTitle = title.trim();
    if (target.content === requestedTitle) return;
    let writeError: unknown;
    try {
        await kernelPost("/api/filetree/renameDoc", { notebook: notebookId, path: target.path, title: requestedTitle });
    } catch (error) {
        writeError = error;
    }
    try {
        await kernelPost("/api/sqlite/flushTransaction");
        const verifiedRows = await querySql<unknown>(`SELECT content, box FROM blocks WHERE type='d' AND id='${docId}'`);
        const verified = verifiedRows.length === 1 ? assertKernelRecord("/api/query/sql", verifiedRows[0]) : null;
        if (!verified || verified.box !== notebookId || verified.content !== requestedTitle) throw new Error("标题未核实");
    } catch (cause) {
        throw new Error(`文档 ${docId} 改名请求已发出，但结果未知；请先重新读取核实，未自动重放`, { cause: writeError ?? cause });
    }
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
    return kernelPost("/api/query/sql", { stmt }, { decode: (data) => decodeArray<T>("/api/query/sql", data) });
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

function isDoOperation(value: unknown): value is DoOperation {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
    const candidate = value as Record<string, unknown>;
    return typeof candidate.id === "string" && typeof candidate.action === "string";
}

function isTransactionResult(value: unknown): value is TransactionResult {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
    const candidate = value as Record<string, unknown>;
    const hasOperations = Array.isArray(candidate.operations) || Array.isArray(candidate.doOperations);
    return hasOperations
        && (candidate.operations === undefined || (Array.isArray(candidate.operations) && candidate.operations.every(isDoOperation)))
        && (candidate.doOperations === undefined || (Array.isArray(candidate.doOperations) && candidate.doOperations.every(isDoOperation)));
}

export function decodeInsertBlockData(route: string, data: unknown): InsertBlockData {
    if (Array.isArray(data)) {
        if (!data.every(isTransactionResult)) {
            throw new KernelProtocolError(route, `${route} 返回异常形状（事务结果数组非法）`);
        }
        return data as TransactionResult[];
    }
    if (isTransactionResult(data)) return data;
    throw new KernelProtocolError(route, `${route} 返回异常形状（事务结果非法）`);
}

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
    const data = await kernelPost("/api/block/insertBlock", {
        dataType: "dom",
        parentID: parentBlockId,
        data: dom,
    }, { decode: (value) => decodeInsertBlockData("/api/block/insertBlock", value) });
    const id = firstOperationId(data);
    if (!id) throw new KernelProtocolError("/api/block/insertBlock", "/api/block/insertBlock 返回异常形状（未返回新块 ID）");
    return id;
}

export { kernelPost };
