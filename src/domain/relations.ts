/**
 * 人物关系写入结果：关系字段是事实源，人物文档区块只是可重建投影。
 * 本文件只描述状态和纯函数，内核读写由 services/relations.ts 负责。
 */

export type RelationOperation = "add" | "remove";
export type RelationFactStatus = "applied" | "unchanged" | "unknown";
export type RelationProjectionStatus = "applied" | "failed" | "unknown";

export interface RelationProjectionResult {
    docId: string;
    status: RelationProjectionStatus;
    retryKey: string;
    message?: string;
}

export interface RelationMutationReport {
    operation: RelationOperation;
    personItemId: string;
    otherItemId: string;
    fact: {
        status: RelationFactStatus;
        relatedItemIds: string[];
    };
    projections: RelationProjectionResult[];
}

export function relationContains(relatedItemIds: readonly string[], itemId: string): boolean {
    return relatedItemIds.includes(itemId);
}

export function nextRelatedItemIds(
    operation: RelationOperation,
    relatedItemIds: readonly string[],
    otherItemId: string,
): { changed: boolean; relatedItemIds: string[] } {
    const current = [...new Set(relatedItemIds)];
    if (operation === "add") {
        if (current.includes(otherItemId)) return { changed: false, relatedItemIds: current };
        return { changed: true, relatedItemIds: [...current, otherItemId] };
    }
    if (!current.includes(otherItemId)) return { changed: false, relatedItemIds: current };
    return { changed: true, relatedItemIds: current.filter((itemId) => itemId !== otherItemId) };
}

export function relationRetryKey(docId: string, relatedItemIds: readonly string[]): string {
    return `relation-projection:${docId}:${relatedItemIds.join(",")}`;
}
