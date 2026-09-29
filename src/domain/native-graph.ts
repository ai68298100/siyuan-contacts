/**
 * B14：内核原生图数据 → 插件图形状映射（纯函数）。
 * 元素字段经 spike:b14 E 段实证：节点 {id, label, refs, defs}、边 {from, to}（不是 source/target）。
 * 本层用结构类型描述载荷（domain 只允许引用自身；api 层的 NativeGraphData 与之结构兼容）。
 * 范围契约（B14.3）：只保留登记文档集合内的节点（本人/联系人/组织文档），
 * 不因文档位于人脉笔记本而把无关笔记画进图；被过滤节点的边随之丢弃。
 * 边语义 = 文档间块引用（含回链），与 related 关系边不同源——UI 必须标识边来源（B14.8）。
 */
import type { GraphEdge, GraphNode, PersonGraph } from "./graph.ts";

/** 内核图载荷的结构视图（字段名与 spike:b14 实证一致；未知字段忽略） */
export interface NativeGraphPayload {
    nodes?: ReadonlyArray<{ id?: unknown; label?: unknown } | undefined>;
    links?: ReadonlyArray<{ from?: unknown; to?: unknown } | undefined>;
}

export interface NativeGraphMapOptions {
    /** 登记文档 ID 集合（本人+联系人）；不在集合内的节点连同其边丢弃 */
    allowedDocIds: ReadonlySet<string>;
    /** docId → 联系人分组（着色/图例用；缺省按「其他」灰） */
    docGroups?: ReadonlyMap<string, string>;
}

export function mapNativeGraph(native: NativeGraphPayload, options: NativeGraphMapOptions): PersonGraph {
    const nodes: GraphNode[] = [];
    const keptIds = new Set<string>();
    for (const node of native.nodes ?? []) {
        if (!node || typeof node.id !== "string" || node.id === "" || keptIds.has(node.id)) continue;
        if (!options.allowedDocIds.has(node.id)) continue;
        keptIds.add(node.id);
        nodes.push({
            id: node.id,
            label: typeof node.label === "string" && node.label !== "" ? node.label : node.id,
            group: options.docGroups?.get(node.id) ?? "其他",
            degree: 0,
        });
    }
    const byId = new Map(nodes.map((node) => [node.id, node]));

    /* 边按无向去重（与 buildGraph 口径一致）；自环与端点不全在图内的边丢弃 */
    const seen = new Set<string>();
    const edges: GraphEdge[] = [];
    for (const link of native.links ?? []) {
        const from = typeof link?.from === "string" ? link.from : "";
        const to = typeof link?.to === "string" ? link.to : "";
        if (from === "" || to === "" || from === to) continue;
        if (!keptIds.has(from) || !keptIds.has(to)) continue;
        const key = [from, to].sort().join("~");
        if (seen.has(key)) continue;
        seen.add(key);
        edges.push({ source: from, target: to });
        const a = byId.get(from);
        const b = byId.get(to);
        if (a) a.degree += 1;
        if (b) b.degree += 1;
    }
    return { nodes, edges };
}
