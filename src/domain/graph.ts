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
}

export interface GraphEdge {
    source: string;
    target: string;
}

export interface PersonGraph {
    nodes: GraphNode[];
    edges: GraphEdge[];
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
            edges.push({ source: person.docId, target: targetDocId });
            const source = nodeById.get(person.docId);
            const target = nodeById.get(targetDocId);
            if (source) source.degree += 1;
            if (target) target.degree += 1;
        }
    }
    return { nodes, edges };
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
