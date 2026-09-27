import cytoscape from "cytoscape";
import type { PersonGraph } from "./graph.ts";

/** 无权无向关系的最短链路；无路径/端点缺失返回空数组，不改变输入图。 */
export function shortestGraphPath(graph: PersonGraph, sourceId: string, targetId: string): string[] {
    const ids = new Set(graph.nodes.map((node) => node.id));
    if (!ids.has(sourceId) || !ids.has(targetId)) return [];
    if (sourceId === targetId) return [sourceId];
    const instance = cytoscape({
        headless: true,
        styleEnabled: false,
        elements: [
            ...[...ids].map((id) => ({ data: { id } })),
            ...graph.edges.filter((edge) => edge.source !== edge.target && ids.has(edge.source) && ids.has(edge.target))
                .map((edge) => ({ data: { source: edge.source, target: edge.target } })),
        ],
    });
    try {
        const target = instance.getElementById(targetId);
        const result = instance.elements().dijkstra({ root: instance.getElementById(sourceId), directed: false });
        if (!Number.isFinite(result.distanceTo(target))) return [];
        return result.pathTo(target).nodes().map((node) => node.id());
    } finally {
        instance.destroy();
    }
}
