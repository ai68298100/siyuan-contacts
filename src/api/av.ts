/**
 * 属性视图（思源数据库）操作层。
 * 铁律（M0 spike 实证，docs/DATA-CONTRACT.md）：
 * 1. itemID（行 ID）≠ 绑定块 ID；主键单元格 value.blockID 才是 itemID，
 *    绑定的文档块 ID 在 value.block.id。两者只经 mapBoundDocIds 换算。
 * 2. setAttributeViewBlockAttr 必须传 itemID（rowID 已进弃用通道）。
 * 3. 写渲染一律走 renderAttributeView；数据库没有 SQL 表。
 */
import { appendBlockDom, kernelPost, newNodeId } from "./client";
import type { AvFieldType, FieldSpec } from "../domain/fields";

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
    blockID: string;
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

/* ---------- 建库 / 建字段 ---------- */

/** 在宿主文档里插入数据库块并物化数据库（客户端先定 avID，spike 假设①） */
export async function createDatabaseInDoc(hostDocId: string): Promise<{ avId: string; dbBlockId: string }> {
    const avId = newNodeId();
    const dom = `<div data-type="NodeAttributeView" data-av-id="${avId}" data-av-type="table"></div>`;
    const dbBlockId = await appendBlockDom(hostDocId, dom);
    // createIfNotExist 物化数据库（默认视图 + 主键列）
    await renderView(avId, dbBlockId);
    return { avId, dbBlockId };
}

export async function renderView(avId: string, dbBlockId: string, query: string = ""): Promise<AvRenderResult> {
    return kernelPost<AvRenderResult>("/api/av/renderAttributeView", {
        id: avId,
        blockID: dbBlockId,
        query,
        pageSize: -1,
        createIfNotExist: false,
    });
}

/** v3.8.5 实测 keyIcon 必填（官方文档漏写），永远显式传空串 */
export async function addField(avId: string, spec: FieldSpec, displayName: string, previousKeyId: string): Promise<string> {
    const keyId = newNodeId();
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
    const data = await kernelPost<Record<string, string>>("/api/av/getAttributeViewItemIDsByBoundIDs", {
        avID: avId,
        blockIDs: docIds,
    });
    return data ?? {};
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

export async function setCell(avId: string, keyId: string, itemId: string, cell: CellValue): Promise<AvValue> {
    return kernelPost<AvValue>("/api/av/setAttributeViewBlockAttr", {
        avID: avId,
        keyID: keyId,
        itemID: itemId,
        value: cell.value,
    });
}
