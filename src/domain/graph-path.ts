import cytoscape from "cytoscape";
import type { PersonGraph } from "./graph.ts";

function createHeadlessGraph(graph: PersonGraph): cytoscape.Core {
    const ids = new Set(graph.nodes.map((node) => node.id));
    return cytoscape({
        headless: true,
        styleEnabled: false,
        elements: [
            ...[...ids].map((id) => ({ data: { id } })),
            ...graph.edges.filter((edge) => edge.source !== edge.target && ids.has(edge.source) && ids.has(edge.target))
                .map((edge) => ({ data: { source: edge.source, target: edge.target } })),
        ],
    });
}

/** 严格二度邻接：排除中心与直接联系人，不改变输入图。 */
export function secondDegreeGraphIds(graph: PersonGraph, sourceId: string): string[] {
    if (!graph.nodes.some((node) => node.id === sourceId)) return [];
    const instance = createHeadlessGraph(graph);
    try {
        const center = instance.getElementById(sourceId);
        const direct = center.neighborhood().nodes();
        const second = direct.neighborhood().nodes().difference(direct.union(center));
        const ids = new Set(second.map((node) => node.id()));
        return graph.nodes.filter((node) => ids.has(node.id)).map((node) => node.id);
    } finally {
        instance.destroy();
    }
}

/** 无权无向关系的最短链路；无路径/端点缺失返回空数组，不改变输入图。 */
export function shortestGraphPath(graph: PersonGraph, sourceId: string, targetId: string): string[] {
    const ids = new Set(graph.nodes.map((node) => node.id));
    if (!ids.has(sourceId) || !ids.has(targetId)) return [];
    if (sourceId === targetId) return [sourceId];
    const instance = createHeadlessGraph(graph);
    try {
        const target = instance.getElementById(targetId);
        const result = instance.elements().dijkstra({ root: instance.getElementById(sourceId), directed: false });
        if (!Number.isFinite(result.distanceTo(target))) return [];
        return result.pathTo(target).nodes().map((node) => node.id());
    } finally {
        instance.destroy();
    }
}
