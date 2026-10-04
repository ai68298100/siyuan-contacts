/**
 * 关系图谱数据投影：联系人摘要 → 图节点/边。
 * 边的语义（D-0009）：relatedItemIds 是行 itemID，节点用 docId；
 * 换算在本层完成，指向未知目标的边丢弃（对端联系人已删等场景）。
 */
import type { ContactSummary } from "./person";

export interface GraphNode {
    /** 文档 ID（cytoscape 节点 id，点击即开文档） */
    id: string;
    label: string;
    group: string;
    /** 关系边数（用于节点大小） */
    degree: number;
    /** B14.6 节点类型：person=联系人（默认）；org=组织文档（成员边挂接） */
    kind?: "person" | "org";
}

export interface GraphEdge {
    source: string;
    target: string;
    /** B14.6 边来源：related=显式关系（查询唯一依据）；member=组织成员（仅展示，不参与关系查询） */
    kind?: "related" | "member" | "ref";
}

export interface PersonGraph {
    nodes: GraphNode[];
    edges: GraphEdge[];
}

/** 只计算当前图内的显式无向关系，忽略悬空边、自环与重复边。 */
export function queryGraphRelations(graph: PersonGraph, firstId: string, secondId = ""): {
    neighborIds: string[]; commonIds: string[];
} {
    const ids = new Set(graph.nodes.map((node) => node.id));
    const first = new Set<string>();
    const second = new Set<string>();
    if (!ids.has(firstId)) return { neighborIds: [], commonIds: [] };
    for (const edge of graph.edges) {
        if (edge.kind && edge.kind !== "related") continue;
        if (edge.source === edge.target || !ids.has(edge.source) || !ids.has(edge.target)) continue;
        if (edge.source === firstId) first.add(edge.target);
        if (edge.target === firstId) first.add(edge.source);
        if (edge.source === secondId) second.add(edge.target);
        if (edge.target === secondId) second.add(edge.source);
    }
    return {
        neighborIds: graph.nodes.filter((node) => first.has(node.id)).map((node) => node.id),
        commonIds: firstId === secondId || !ids.has(secondId) ? [] : graph.nodes
            .filter((node) => first.has(node.id) && second.has(node.id)).map((node) => node.id),
    };
}

export function buildGraph(people: readonly ContactSummary[]): PersonGraph {
    const itemToDoc = new Map<string, string>();
    for (const person of people) {
        itemToDoc.set(person.itemId, person.docId);
    }

    const nodes: GraphNode[] = people.map((person) => ({
        id: person.docId,
        label: person.name,
        group: person.group,
        degree: 0,
        kind: "person" as const,
    }));
    const nodeById = new Map(nodes.map((node) => [node.id, node]));

    const seen = new Set<string>();
    const edges: GraphEdge[] = [];
    for (const person of people) {
        for (const relatedItemId of person.relatedItemIds) {
            const targetDocId = itemToDoc.get(relatedItemId);
            if (!targetDocId || targetDocId === person.docId) continue;
            const edgeKey = [person.docId, targetDocId].sort().join("~");
            if (seen.has(edgeKey)) continue;
            seen.add(edgeKey);
            edges.push({ source: person.docId, target: targetDocId, kind: "related" as const });
            const source = nodeById.get(person.docId);
            const target = nodeById.get(targetDocId);
            if (source) source.degree += 1;
            if (target) target.degree += 1;
        }
    }
    return { nodes, edges };
}

/** 图谱渲染规模上限（cytoscape 在千级节点交互明显劣化；见 DATA-CONTRACT §4） */
export const GRAPH_MAX_NODES = 800;

/**
 * 规模上限：按度数降序保留前 maxNodes 个节点，丢弃两端都被裁掉的边。
 * 返回裁剪说明，由 UI 提示"图太大，只展示关系最多的 N 人"。
 */
export function capGraph(graph: PersonGraph, maxNodes: number = GRAPH_MAX_NODES, retainedIds: readonly string[] = []): { graph: PersonGraph; truncated: boolean } {
    if (!Number.isSafeInteger(maxNodes) || maxNodes < 1) throw new Error("图节点预算必须为正整数");
    const ordered = orderGraph(graph);
    const existing = new Set(ordered.nodes.map((node) => node.id));
    const retained = new Set(retainedIds.filter((id) => existing.has(id)));
    if (retained.size > maxNodes) throw new Error("节点预算不足以保留查询中心，请扩大预算或清除对比人物");
    const keep = new Set(retained);
    for (const node of ordered.nodes) {
        if (keep.size >= maxNodes) break;
        keep.add(node.id);
    }
    return { graph: orderGraph({
        nodes: ordered.nodes.filter((node) => keep.has(node.id)),
        edges: ordered.edges.filter((edge) => keep.has(edge.source) && keep.has(edge.target)),
    }), truncated: ordered.nodes.length > keep.size };
}

export function orderGraph(graph: PersonGraph): PersonGraph {
    const nodes = graph.nodes.map((node) => ({ ...node, degree: 0 }));
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const seen = new Set<string>();
    const edges: GraphEdge[] = [];
    for (const edge of graph.edges) {
        if (edge.source === edge.target || !byId.has(edge.source) || !byId.has(edge.target)) continue;
        const [source, target] = [edge.source, edge.target].sort();
        const key = `${edge.kind ?? "related"}:${source}:${target}`;
        if (seen.has(key)) continue;
        seen.add(key);
        edges.push({ ...edge, source, target });
        byId.get(source)!.degree += 1;
        byId.get(target)!.degree += 1;
    }
    nodes.sort((left, right) => right.degree - left.degree || compareGraphIds(left.id, right.id));
    edges.sort((left, right) => compareGraphIds(left.kind ?? "related", right.kind ?? "related")
        || compareGraphIds(left.source, right.source) || compareGraphIds(left.target, right.target));
    return { nodes, edges };
}

export function compareGraphIds(left: string, right: string): number {
    return left < right ? -1 : left > right ? 1 : 0;
}

/** 分组→固定色相（数据编码用固定色板；UI 底色仍走 b3 变量，见 D-0002 约定注释） */
export const GROUP_COLORS: Readonly<Record<string, string>> = {
    "家人": "#e05a5a",
    "朋友": "#4caf7d",
    "同事": "#4a8fe0",
    "同学": "#e0a13a",
    "其他": "#9e9e9e",
};

export function groupColor(group: string): string {
    return GROUP_COLORS[group] ?? "#8f8f8f";
}

/* ---------- B14.6：组织节点与成员边增强（只进渲染层，不参与关系查询） ---------- */

/** 组织增强输入：组织文档 + 参与成员边的人物文档 ID（调用方先按 status=active 过滤） */
export interface OrgAugmentationInput {
    docId: string;
    name: string;
    memberDocIds: readonly string[];
}

export interface GraphOrgAugmentation {
    nodes: GraphNode[];
    edges: GraphEdge[];
}

/** 组织节点固定色（数据编码固定色板，D-0002；与五个人群色相区分） */
export const ORG_NODE_COLOR = "#8e5ad8";

/**
 * 组织节点 + 成员边构建。与 related 边分源：产物只叠加到画布渲染，
 * 关系查询（一度/二度/共同/路径）仍只吃 buildGraph 的 related 图——
 * 「人物→组织→人物」不会被算成二度关系（B14.6 验收口径）。
 * 成员边只连名册内人物（已解绑/悬空记录丢弃，不造悬空端点）；
 * 同人同组织多段成员记录合并为一条边；组织节点度数=有效成员边数。
 */
export function buildOrgAugmentation(
    orgs: readonly OrgAugmentationInput[],
    rosterDocIds: ReadonlySet<string>,
): GraphOrgAugmentation {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    for (const org of orgs ?? []) {
        if (!org || typeof org.docId !== "string" || org.docId === "") continue;
        if (typeof org.name !== "string" || org.name === "") continue;
        const connected = new Set<string>();
        for (const personDocId of org.memberDocIds ?? []) {
            if (typeof personDocId !== "string" || personDocId === "" || personDocId === org.docId) continue;
            if (!rosterDocIds.has(personDocId) || connected.has(personDocId)) continue;
            connected.add(personDocId);
            edges.push({ source: org.docId, target: personDocId, kind: "member" as const });
        }
        nodes.push({ id: org.docId, label: org.name, group: "组织", kind: "org" as const, degree: connected.size });
    }
    return { nodes, edges };
}
