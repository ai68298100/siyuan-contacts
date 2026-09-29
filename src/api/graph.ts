/**
 * 内核图查询端点（B14）：只取图数据，不做原生图面板（面板为前端域，内核无此端点）。
 * 参数与形状经 spike:b14 在 v3.8.6 隔离内核实证（scripts/spike/b14-graph-results.json）：
 * - conf 必须为对象：缺 conf 报「Field [conf] is required」，conf.type 传字符串报 unmarshal 错；
 * - 节点字段 {id, label, type, refs, defs}；边字段 {from, to, ref}（不是 source/target）；
 * - getLocalGraph 为双向一度（出链与回链都在图内）。
 */
import { kernelPost } from "./client";

export interface NativeGraphNode {
    id: string;
    label: string;
    type: string;
    /** 出链计数（内核全库口径，图内度数由域层重算，不用此值） */
    refs: number;
    defs: number;
}

export interface NativeGraphLink {
    from: string;
    to: string;
    ref?: boolean;
}

export interface NativeGraphData {
    id?: string;
    nodes: NativeGraphNode[];
    links: NativeGraphLink[];
}

/** 内核图查询 conf：空对象即可（内核回填默认项）；type 必须是对象，不能是字符串 */
const GRAPH_CONF = { type: {} };

function assertGraphShape(route: string, data: NativeGraphData | undefined): NativeGraphData {
    /* CODE-02.6：形状异常上抛，不归一为空图——空图与读失败必须可区分 */
    if (!data || !Array.isArray(data.nodes) || !Array.isArray(data.links)) {
        throw new Error(`${route} 返回异常形状（缺 nodes/links 数组）`);
    }
    return data;
}

/** 以文档为中心的局部图（双向一度：出链+回链）；docId 进语句前严格校验 */
export async function fetchLocalGraph(docId: string): Promise<NativeGraphData> {
    if (!/^\d{14}-[0-9a-z]{7}$/.test(docId)) throw new Error("docId 不是合法的思源 ID");
    const data = await kernelPost<NativeGraphData>("/api/graph/getLocalGraph", { id: docId, conf: GRAPH_CONF });
    return assertGraphShape("/api/graph/getLocalGraph", data);
}

/** 全局图（全库文档级节点，量可能很大；仅显式调用方使用） */
export async function fetchGlobalGraph(): Promise<NativeGraphData> {
    const data = await kernelPost<NativeGraphData>("/api/graph/getGraph", { conf: GRAPH_CONF });
    return assertGraphShape("/api/graph/getGraph", data);
}
