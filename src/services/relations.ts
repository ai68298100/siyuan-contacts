/**
 * 关系编辑服务：在 related relation 字段上做增量增删。
 * 边以 itemID 表达（D-0009）；写入后由内核自动维护双向回链（E2E 实证）。
 * CODE-02.5：写前回读最新关系列表（调用方快照可能过期，直接写会丢并发边）；
 * 文档区块副作用逐文档隔离，失败可定位、可由下一次关系编辑补同步。
 */
import { listContacts } from "./contacts";
import { invalidateRoster } from "./roster";
import { renderView, setCell } from "../api/av";
import { RelatedProjectionUnknownError, resolveRelated, syncRelatedSection } from "./doc-section";
import type { ContactsSettings } from "../domain/model";
import type { ContactSummary } from "../domain/person";
import { withStoreLock } from "../data/storage";
import { rosterFromRender } from "../domain/roster";
import {
    nextRelatedItemIds,
    relationRetryKey,
} from "../domain/relations";
import type {
    RelationMutationReport,
    RelationOperation,
    RelationProjectionResult,
} from "../domain/relations";

export type { RelationMutationReport, RelationProjectionResult } from "../domain/relations";

export class RelationFactUnknownError extends Error {
    readonly operation: RelationOperation;
    readonly personItemId: string;
    readonly otherItemId: string;

    constructor(operation: RelationOperation, personItemId: string, otherItemId: string, cause?: unknown) {
        super("关系写入已发出，但写后回读未能核实；未自动重试，请重新读取后显式重试。", { cause });
        this.name = "RelationFactUnknownError";
        this.operation = operation;
        this.personItemId = personItemId;
        this.otherItemId = otherItemId;
    }
}

async function writeRelated(
    settings: ContactsSettings,
    person: ContactSummary,
    relatedItemIds: readonly string[],
): Promise<void> {
    await setCell(settings.avId, settings.fieldMap.related, person.itemId, {
        type: "relation",
        value: { relation: { blockIDs: [...relatedItemIds] } },
    });
}

/** CODE-02.5：写前回读该联系人的最新关系列表（调用方快照可能过期） */
async function readFreshRoster(settings: ContactsSettings): Promise<ContactSummary[]> {
    invalidateRoster();
    const rendered = await renderView(settings.avId, settings.dbBlockId);
    const keyId = settings.fieldMap.related;
    const columns = rendered.view.columns.filter((column) => column.id === keyId);
    if (columns.length !== 1 || columns[0].type !== "relation") throw new Error("相关人列映射缺失或类型不符，关系操作已停止");
    for (const row of rendered.view.rows) {
        const cells = row.cells.filter((cell) => cell.value.keyID === keyId);
        if (cells.length > 1 || cells.some((cell) => {
            if (cell.value.type !== "relation" || cell.valueType !== "relation") return true;
            // 思源不同版本对空 relation 单元格的渲染不完全一致：有的返回
            // relation.blockIDs=[]，有的省略 relation 或 blockIDs。两者都表示空值；
            // 只有出现非空但结构非法的 blockIDs 才应阻断关系写入。
            const blockIDs = cell.value.relation?.blockIDs;
            if (blockIDs === undefined || blockIDs === null) return false;
            return !Array.isArray(blockIDs) || blockIDs.some((itemId) => typeof itemId !== "string" || !itemId);
        })) {
            throw new Error("相关人单元格读取异常，关系操作已停止");
        }
    }
    return rosterFromRender(rendered, settings.fieldMap);
}

function requirePerson(roster: readonly ContactSummary[], expected: ContactSummary): ContactSummary {
    const matches = roster.filter((person) => person.itemId === expected.itemId);
    if (matches.length !== 1 || matches[0].docId !== expected.docId) {
        throw new Error(`联系人已移除或绑定已变化，拒绝修改关系：${expected.docId}`);
    }
    return matches[0];
}

/** 关系变更后：失效名册，并把双方人物文档的"相关人物"双链区块同步到最新。
 *  CODE-02.5：逐文档隔离——单个文档区块失败不阻断另一个，失败清单返回（可定位、
 *  可由对该人物的下一次关系编辑自然补同步）；关系数据本身在数据库，不受影响。 */
async function refreshSections(settings: ContactsSettings, docIds: readonly string[]): Promise<RelationProjectionResult[]> {
    invalidateRoster();
    const results: RelationProjectionResult[] = [];
    const uniqueDocIds = [...new Set(docIds)];
    let roster: ContactSummary[];
    try {
        roster = await readFreshRoster(settings);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        for (const docId of uniqueDocIds) {
            results.push({ docId, status: "unknown", retryKey: relationRetryKey(docId, []), message });
        }
        console.warn("[lvct] 相关人物区块同步失败（名册读取）", error);
        return results;
    }
    for (const docId of uniqueDocIds) {
        const person = roster.find((item) => item.docId === docId);
        if (!person) {
            results.push({
                docId,
                status: "unknown",
                retryKey: relationRetryKey(docId, []),
                message: "人物文档已不在当前名册，无法核实文档投影。",
            });
            continue;
        }
        try {
            await syncRelatedSection(person, resolveRelated(person, roster));
            results.push({
                docId,
                status: "applied",
                retryKey: relationRetryKey(docId, person.relatedItemIds),
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            results.push({
                docId,
                status: error instanceof RelatedProjectionUnknownError ? "unknown" : "failed",
                retryKey: relationRetryKey(docId, person.relatedItemIds),
                message,
            });
            console.warn(`[lvct] 相关人物区块同步失败（${docId}）——对该人物重新执行关系编辑可补同步`, error);
        }
    }
    return results;
}

async function mutateRelation(
    settings: ContactsSettings,
    operation: RelationOperation,
    person: ContactSummary,
    other: ContactSummary,
): Promise<RelationMutationReport> {
    if (person.itemId === other.itemId || person.docId === other.docId) throw new Error("不能建立人物自身关系");
    const before = await readFreshRoster(settings);
    const fresh = requirePerson(before, person);
    const counterpart = requirePerson(before, other);
    const alreadyLinked = fresh.relatedItemIds.includes(counterpart.itemId) || counterpart.relatedItemIds.includes(fresh.itemId);
    const changes = operation === "add"
        ? alreadyLinked ? [] : [{ person: fresh, relatedItemIds: nextRelatedItemIds("add", fresh.relatedItemIds, counterpart.itemId).relatedItemIds }]
        : [fresh, counterpart].flatMap((target) => {
            const oppositeId = target.itemId === fresh.itemId ? counterpart.itemId : fresh.itemId;
            const next = nextRelatedItemIds("remove", target.relatedItemIds, oppositeId);
            return next.changed ? [{ person: target, relatedItemIds: next.relatedItemIds }] : [];
        });
    if (changes.length > 0) {
        let requestError: unknown;
        try {
            for (const change of changes) await writeRelated(settings, change.person, change.relatedItemIds);
        } catch (error) {
            requestError = error;
        }
        let verified: ContactSummary;
        let verifiedOther: ContactSummary;
        try {
            const after = await readFreshRoster(settings);
            verified = requirePerson(after, fresh);
            verifiedOther = requirePerson(after, counterpart);
            for (const change of changes) {
                const actual = requirePerson(after, change.person);
                if (change.relatedItemIds.some((itemId) => !actual.relatedItemIds.includes(itemId))) {
                    throw new Error("回读缺少预期关系边，结果尚未核实");
                }
            }
        } catch (error) {
            throw new RelationFactUnknownError(operation, fresh.itemId, other.itemId, error);
        }
        const applied = operation === "add"
            ? verified.relatedItemIds.includes(counterpart.itemId) || verifiedOther.relatedItemIds.includes(fresh.itemId)
            : !verified.relatedItemIds.includes(counterpart.itemId) && !verifiedOther.relatedItemIds.includes(fresh.itemId);
        if (!applied) throw new RelationFactUnknownError(operation, fresh.itemId, other.itemId, requestError);
        const projections = await refreshSections(settings, [verified.docId, counterpart.docId]);
        return {
            operation,
            personItemId: fresh.itemId,
            otherItemId: other.itemId,
            fact: { status: "applied", relatedItemIds: [...verified.relatedItemIds] },
            projections,
        };
    }
    const projections = await refreshSections(settings, [fresh.docId, other.docId]);
    return {
        operation,
        personItemId: fresh.itemId,
        otherItemId: other.itemId,
        fact: { status: "unchanged", relatedItemIds: [...fresh.relatedItemIds] },
        projections,
    };
}

/** 建立关系（幂等：已存在则不重复写）。同一数据库关系编辑锁内回读并写后核实。 */
export async function addRelation(
    settings: ContactsSettings,
    person: ContactSummary,
    other: ContactSummary,
): Promise<RelationMutationReport> {
    return withStoreLock(`relations:${settings.avId}:${settings.fieldMap.related}`, () =>
        mutateRelation(settings, "add", person, other));
}

/** 解除关系（幂等：不存在则跳过）。同一数据库关系编辑锁内回读并写后核实。 */
export async function removeRelation(
    settings: ContactsSettings,
    person: ContactSummary,
    other: ContactSummary,
): Promise<RelationMutationReport> {
    return withStoreLock(`relations:${settings.avId}:${settings.fieldMap.related}`, () =>
        mutateRelation(settings, "remove", person, other));
}

/** 只重试文档投影；每次先读取当前名册和事实，不恢复旧快照。 */
export async function retryRelationProjections(
    settings: ContactsSettings,
    docIds: readonly string[],
): Promise<RelationProjectionResult[]> {
    return withStoreLock(`relations:${settings.avId}:${settings.fieldMap.related}`, () => refreshSections(settings, docIds));
}

/** 关系编辑后的刷新：回查该联系人（走名册缓存） */
export async function refreshPerson(settings: ContactsSettings, person: ContactSummary): Promise<ContactSummary | null> {
    const people = await listContacts(settings);
    return people.find((item) => item.itemId === person.itemId) ?? null;
}
