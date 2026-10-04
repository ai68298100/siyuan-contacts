import { compareGraphIds } from "./graph.ts";
import type { PersonGraph } from "./graph.ts";

function adjacency(graph: PersonGraph): Map<string, string[]> {
    const neighbors = new Map(graph.nodes.map((node) => [node.id, new Set<string>()]));
    for (const edge of graph.edges) {
        if (edge.kind && edge.kind !== "related") continue;
        if (edge.source === edge.target || !neighbors.has(edge.source) || !neighbors.has(edge.target)) continue;
        neighbors.get(edge.source)!.add(edge.target);
        neighbors.get(edge.target)!.add(edge.source);
    }
    return new Map([...neighbors].map(([id, values]) => [id, [...values].sort(compareGraphIds)]));
}

/** 严格二度邻接：排除中心与直接联系人，不改变输入图。 */
export function secondDegreeGraphIds(graph: PersonGraph, sourceId: string): string[] {
    const neighbors = adjacency(graph);
    const direct = new Set(neighbors.get(sourceId) ?? []);
    const second = new Set<string>();
    for (const neighbor of direct) {
        for (const target of neighbors.get(neighbor) ?? []) {
            if (target !== sourceId && !direct.has(target)) second.add(target);
        }
    }
    return [...second].sort(compareGraphIds);
}

/** 无权无向关系的最短链路；无路径/端点缺失返回空数组，不改变输入图。 */
export function shortestGraphPath(graph: PersonGraph, sourceId: string, targetId: string): string[] {
    const neighbors = adjacency(graph);
    if (!neighbors.has(sourceId) || !neighbors.has(targetId)) return [];
    const parents = new Map<string, string | null>([[sourceId, null]]);
    const queue = [sourceId];
    for (let offset = 0; offset < queue.length; offset += 1) {
        const current = queue[offset];
        if (current === targetId) {
            const path: string[] = [];
            let cursor: string | null = targetId;
            while (cursor !== null) {
                path.push(cursor);
                cursor = parents.get(cursor) ?? null;
            }
            return path.reverse();
        }
        for (const neighbor of neighbors.get(current) ?? []) {
            if (parents.has(neighbor)) continue;
            parents.set(neighbor, current);
            queue.push(neighbor);
        }
    }
    return [];
}
