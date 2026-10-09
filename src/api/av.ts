/**
 * 属性视图（思源数据库）操作层。
 * 铁律（M0 spike 实证，docs/DATA-CONTRACT.md）：
 * 1. itemID（行 ID）≠ 绑定块 ID；主键单元格 value.blockID 才是 itemID，
 *    绑定的文档块 ID 在 value.block.id。两者只经 mapBoundDocIds 换算。
 * 2. setAttributeViewBlockAttr 必须传 itemID（rowID 已进弃用通道）。
 * 3. 写渲染一律走 renderAttributeView；数据库没有 SQL 表。
 */
import {
    appendBlockDom,
    assertKernelArray,
    assertKernelRecord,
    decodeStringMap,
    KernelProtocolError,
    KernelResponseError,
    kernelPost,
    newNodeId,
    querySql,
} from "./client";
import { parseAvIdFromBlockMarkdown } from "../domain/init-plan.ts";
import type { AvFieldType, FieldSpec } from "../domain/fields";

/** 思源节点 ID 形状（DATA-CONTRACT §4：进 SQL 的值仅限严格校验过的 ID） */
const ID_PATTERN = /^\d{14}-[0-9a-z]{7}$/;

const ATTRIBUTE_VIEW_CARRIER_MISSING_PATTERN = /^resolve attribute view carrier:\s*block\s+\[(\d{14}-[0-9a-z]{7})\]\s+not found$/i;

/**
 * 属性视图的数据库块（carrier）已经不在内核块树中。
 *
 * 该错误与“属性视图定义不存在”不同：调用方必须保留原设置和原始
 * 内核错误，交给上层进入锚点恢复流程，不能把它当成空库或静默重建。
 */
export class AttributeViewCarrierMissingError extends Error {
    readonly avId: string;
    readonly dbBlockId: string;
    readonly originalError: unknown;

    constructor(avId: string, dbBlockId: string, originalError: unknown) {
        const detail = originalError instanceof Error ? originalError.message : String(originalError);
        super(`属性视图载体数据库块不存在（avId=${avId}，dbBlockId=${dbBlockId}）：${detail}`, { cause: originalError });
        this.name = "AttributeViewCarrierMissingError";
        this.avId = avId;
        this.dbBlockId = dbBlockId;
        this.originalError = originalError;
    }
}

/** 仅识别思源内核的精确 carrier 缺块错误，避免吞掉其它 not-found。 */
export function isAttributeViewCarrierMissingError(error: unknown): error is KernelResponseError {
    if (!(error instanceof KernelResponseError) || typeof error.responseMessage !== "string") return false;
    return ATTRIBUTE_VIEW_CARRIER_MISSING_PATTERN.test(error.responseMessage.trim());
}

function rethrowAttributeViewCarrierMissing(error: unknown, avId: string, dbBlockId: string): never {
    if (isAttributeViewCarrierMissingError(error)) throw new AttributeViewCarrierMissingError(avId, dbBlockId, error);
    throw error;
}

/* ---------- 类型（渲染响应的最小切片） ---------- */

/** 列定义里的选项元数据（renderAttributeView 的 columns[].options） */
export interface AvColumnOption {
    name: string;
    color?: string;
}

/** 单元格值里的选项（写入与回读都用 content，spike ⑤ 实证） */
export interface AvValueOption {
    content: string;
    color?: string;
}

export interface AvColumn {
    id: string;
    name: string;
    type: string;
    options?: AvColumnOption[];
}

export interface AvValueBlock {
    id: string;
    content: string;
}

export type AvValue = {
    keyID: string;
    blockID?: string;
    type: string;
    block?: AvValueBlock;
    text?: { content: string };
    phone?: { content: string };
    email?: { content: string };
    url?: { content: string };
    date?: { content: number; isNotEmpty: boolean; isNotTime?: boolean };
    mSelect?: AvValueOption[];
    checkbox?: { checked: boolean };
    relation?: { blockIDs: string[] };
};

export interface AvCell {
    value: AvValue;
    valueType: string;
}

export interface AvRow {
    id: string;
    cells: AvCell[];
}

export interface AvRenderResult {
    view: {
        columns: AvColumn[];
        rows: AvRow[];
        rowCount?: number;
    };
}

function decodeAvRenderResult(route: string, data: unknown): AvRenderResult {
    const result = assertKernelRecord(route, data);
    const view = assertKernelRecord(route, result.view);
    const columns = assertKernelArray<unknown>(route, view.columns);
    const rows = assertKernelArray<unknown>(route, view.rows);
    if (columns.some((column) => {
        if (typeof column !== "object" || column === null || Array.isArray(column)) return true;
        const candidate = column as Record<string, unknown>;
        return typeof candidate.id !== "string" || typeof candidate.name !== "string" || typeof candidate.type !== "string";
    })) {
        throw new KernelProtocolError(route, `${route} 返回异常形状（columns 项缺 id/name/type）`);
    }
    if (rows.some((row) => {
        if (typeof row !== "object" || row === null || Array.isArray(row)) return true;
        const candidate = row as Record<string, unknown>;
        if (typeof candidate.id !== "string" || !Array.isArray(candidate.cells)) return true;
        return (candidate.cells as unknown[]).some((cell) => {
            if (typeof cell !== "object" || cell === null || Array.isArray(cell)) return true;
            const cellRecord = cell as Record<string, unknown>;
            const value = cellRecord.value;
            if (typeof cellRecord.valueType !== "string"
                || typeof value !== "object"
                || value === null
                || Array.isArray(value)) return true;
            const valueRecord = value as Record<string, unknown>;
            return typeof valueRecord.keyID !== "string" || typeof valueRecord.type !== "string"
                || (valueRecord.blockID !== undefined && typeof valueRecord.blockID !== "string");
        });
    })) {
        throw new KernelProtocolError(route, `${route} 返回异常形状（rows/cells 项字段非法）`);
    }
    return { view: { ...view, columns, rows } } as AvRenderResult;
}

function decodeOptionalAvValue(route: string, data: unknown): AvValue | undefined {
    if (data === null || data === undefined) return undefined;
    const record = assertKernelRecord(route, data);
    const value = assertKernelRecord(route, Object.hasOwn(record, "value") ? record.value : record);
    if (typeof value.keyID !== "string" || typeof value.type !== "string"
        || (value.blockID !== undefined && typeof value.blockID !== "string")) {
        throw new KernelProtocolError(route, `${route} 返回异常形状（单元格缺 keyID/type 或 blockID 非字符串）`);
    }
    return value as AvValue;
}

/* ---------- 建库 / 建字段 ---------- */

/** 在宿主文档里插入数据库块并物化数据库（客户端先定 avID，spike 假设①） */
export async function createDatabaseInDoc(hostDocId: string): Promise<{ avId: string; dbBlockId: string }> {
    const avId = newNodeId();
    const dom = `<div data-type="NodeAttributeView" data-av-id="${avId}" data-av-type="table"></div>`;
    const dbBlockId = await appendBlockDom(hostDocId, dom);
    // 物化必须 createIfNotExist: true——全新块上传 false 会以
    // `code=-1 attribute view not found` 失败（v0.2.0 首次引导卡死的根因，spike 通道9a）
    await renderView(avId, dbBlockId, "", true);
    return { avId, dbBlockId };
}

export async function renderView(
    avId: string,
    dbBlockId: string,
    query: string = "",
    createIfNotExist: boolean = false,
): Promise<AvRenderResult> {
    try {
        return await kernelPost("/api/av/renderAttributeView", {
            id: avId,
            blockID: dbBlockId,
            query,
            pageSize: -1,
            createIfNotExist,
        }, { decode: (data) => decodeAvRenderResult("/api/av/renderAttributeView", data) });
    } catch (error) {
        rethrowAttributeViewCarrierMissing(error, avId, dbBlockId);
    }
}

/** 文档内的数据库块（含从块 markdown 还原的 avID） */
export interface AvBlockRef {
    dbBlockId: string;
    /** 数据库块所在文档（= 行绑定目标的宿主文档） */
    hostDocId: string;
    avId: string;
}

/**
 * 按文档找回数据库块。续建初始化时用它还原 dbBlockId/avId 锚点：
 * 块 IAL 里没有 avID，唯一的还原通道是同一条 blocks 行的 markdown 列。
 */
export async function findAvBlocksInDoc(docId: string): Promise<AvBlockRef[]> {
    if (!ID_PATTERN.test(docId)) throw new Error("docId 不是合法的思源 ID");
    const rows = await querySql<unknown>(
        `SELECT id, parent_id, markdown FROM blocks WHERE parent_id = '${docId}' AND type = 'av'`,
    );
    const refs: AvBlockRef[] = [];
    for (const raw of rows) {
        const row = assertKernelRecord("/api/query/sql", raw);
        if (typeof row.id !== "string" || !ID_PATTERN.test(row.id)
            || typeof row.parent_id !== "string" || !ID_PATTERN.test(row.parent_id)
            || typeof row.markdown !== "string") {
            throw new KernelProtocolError("/api/query/sql", "数据库块扫描返回异常形状，未继续选择锚点");
        }
        if (row.parent_id !== docId) {
            throw new KernelProtocolError("/api/query/sql", "数据库块扫描返回了错误父文档，未继续选择锚点");
        }
        const avId = parseAvIdFromBlockMarkdown(row.markdown);
        if (!avId) continue;
        refs.push({ dbBlockId: row.id, hostDocId: row.parent_id, avId });
    }
    return refs;
}

/** 分页参数（性能预算见 DATA-CONTRACT §4：卡片/表格走分页，完整名册仍由专用缓存读取） */
export interface RenderPageOptions {
    query?: string;
    page?: number;
    pageSize?: number;
    /** 读取分页可由视图切换/用户停止操作取消；取消只终止本次等待，不重试请求。 */
    signal?: AbortSignal;
}

export async function renderViewPage(avId: string, dbBlockId: string, options: RenderPageOptions = {}): Promise<AvRenderResult> {
    const page = options.page ?? 1;
    const pageSize = options.pageSize ?? 200;
    if (!Number.isSafeInteger(page) || page < 1) throw new Error("属性视图页码必须为正整数");
    if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 500) throw new Error("属性视图分页大小必须在 1-500 之间");
    try {
        return await kernelPost("/api/av/renderAttributeView", {
            id: avId,
            blockID: dbBlockId,
            query: options.query ?? "",
            page,
            pageSize,
            createIfNotExist: false,
        }, {
            signal: options.signal,
            decode: (data) => decodeAvRenderResult("/api/av/renderAttributeView", data),
        });
    } catch (error) {
        rethrowAttributeViewCarrierMissing(error, avId, dbBlockId);
    }
}

/** v3.8.5 实测 keyIcon 必填（官方文档漏写），永远显式传空串 */
export async function addField(avId: string, spec: FieldSpec, displayName: string, previousKeyId: string, stableKeyId?: string): Promise<string> {
    const keyId = stableKeyId ?? newNodeId();
    if (!ID_PATTERN.test(keyId)) throw new Error("keyID 不是合法的思源 ID");
    await kernelPost<unknown>("/api/av/addAttributeViewKey", {
        avID: avId,
        keyID: keyId,
        keyName: displayName,
        keyType: spec.type as AvFieldType,
        keyIcon: "",
        previousKeyID: previousKeyId,
    });
    return keyId;
}

export async function readAttributeViewKeys(avId: string): Promise<Array<{ id: string; name: string; type: string; relation?: unknown }>> {
    if (!ID_PATTERN.test(avId)) throw new Error("avID 不是合法的思源 ID");
    return kernelPost("/api/av/getAttributeView", { id: avId }, { decode: (data) => {
        const route = "/api/av/getAttributeView";
        const response = assertKernelRecord(route, data);
        const av = assertKernelRecord(route, response.av);
        return assertKernelArray<unknown>(route, av.keyValues).map((entry) => {
            const value = assertKernelRecord(route, entry);
            const key = assertKernelRecord(route, value.key);
            if (typeof key.id !== "string" || typeof key.name !== "string" || typeof key.type !== "string") throw new KernelProtocolError(route, "属性视图字段定义损坏，未核实双向关系");
            return { id: key.id, name: key.name, type: key.type, ...(key.relation !== undefined ? { relation: key.relation } : {}) };
        });
    } });
}

/**
 * 配置 relation 字段的自关联双向（spike 假设③）。
 * 唯一通道是 transactions 的 updateAttrViewColRelation；回链字段不存在时内核自动创建。
 */
export async function configureSelfRelationTwoWay(
    avId: string,
    relationKeyId: string,
    backKeyId: string,
    sourceName: string,
    backName: string,
): Promise<void> {
    await kernelPost<unknown>("/api/transactions", {
        reqId: Date.now(),
        transactions: [{
            doOperations: [{
                action: "updateAttrViewColRelation",
                avID: avId,
                keyID: relationKeyId,
                id: avId,
                isTwoWay: true,
                backRelationKeyID: backKeyId,
                name: backName,
                format: sourceName,
            }],
            undoOperations: [],
        }],
    });
}

/* ---------- 行（人） ---------- */

export interface BindRowSource {
    /** 要绑定的文档/块 ID */
    id: string;
    /** 主键显示文本（人名） */
    content: string;
}

/** 把文档绑定为行（isDetached: false）。内核不返回 itemID，需要随后 mapBoundDocIds 或渲染换算 */
export async function bindDocsAsRows(avId: string, dbBlockId: string, srcs: readonly BindRowSource[]): Promise<void> {
    await kernelPost<unknown>("/api/av/addAttributeViewBlocks", {
        avID: avId,
        blockID: dbBlockId,
        srcs: srcs.map((src) => ({ id: src.id, isDetached: false, content: src.content })),
    });
}

/** 绑定文档 ID → 行 itemID 的官方换算端点 */
export async function mapBoundDocIds(avId: string, docIds: readonly string[]): Promise<Record<string, string>> {
    return kernelPost("/api/av/getAttributeViewItemIDsByBoundIDs", {
        avID: avId,
        blockIDs: docIds,
    }, { decode: (data) => decodeStringMap("/api/av/getAttributeViewItemIDsByBoundIDs", data) });
}

/** 解绑行（绑定行只解绑，不删文档——spike 假设⑥） */
export async function unbindRows(avId: string, itemIds: readonly string[]): Promise<void> {
    await kernelPost<unknown>("/api/av/removeAttributeViewBlocks", { avID: avId, srcIDs: itemIds });
}

/* ---------- 单元格 ---------- */

export type CellValue =
    | { type: "text"; value: { text: { content: string } } }
    | { type: "phone"; value: { phone: { content: string } } }
    | { type: "email"; value: { email: { content: string } } }
    | { type: "url"; value: { url: { content: string } } }
    | { type: "date"; value: { date: { content: number; isNotEmpty: boolean; isNotTime?: boolean } } }
    | { type: "select"; value: { mSelect: AvValueOption[] } }
    | { type: "mSelect"; value: { mSelect: AvValueOption[] } }
    | { type: "checkbox"; value: { checkbox: { checked: boolean } } }
    | { type: "relation"; value: { relation: { blockIDs: string[] } } };

export async function setCell(avId: string, keyId: string, itemId: string, cell: CellValue): Promise<AvValue | undefined> {
    return kernelPost("/api/av/setAttributeViewBlockAttr", {
        avID: avId,
        keyID: keyId,
        itemID: itemId,
        value: cell.value,
    }, { decode: (data) => decodeOptionalAvValue("/api/av/setAttributeViewBlockAttr", data) });
}
