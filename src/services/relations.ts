/**
 * 关系编辑服务：在 related relation 字段上做增量增删。
 * 边以 itemID 表达（D-0009）；写入后由内核自动维护双向回链（E2E 实证）。
 * CODE-02.5：写前回读最新关系列表（调用方快照可能过期，直接写会丢并发边）；
 * 文档区块副作用逐文档隔离，失败可定位、可由下一次关系编辑补同步。
 */
import { listContacts } from "./contacts";
import { invalidateRoster } from "./roster";
import { setCell } from "../api/av";
import { resolveRelated, syncRelatedSection } from "./doc-section";
import type { ContactsSettings } from "../domain/model";
import type { ContactSummary } from "../domain/person";

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
async function readFreshPerson(settings: ContactsSettings, person: ContactSummary): Promise<ContactSummary> {
    invalidateRoster();
    const roster = await listContacts(settings);
    return roster.find((item) => item.itemId === person.itemId) ?? person;
}

/** 关系变更后：失效名册，并把双方人物文档的"相关人物"双链区块同步到最新。
 *  CODE-02.5：逐文档隔离——单个文档区块失败不阻断另一个，失败清单返回（可定位、
 *  可由对该人物的下一次关系编辑自然补同步）；关系数据本身在数据库，不受影响。 */
async function refreshSections(settings: ContactsSettings, docIds: readonly string[]): Promise<Array<{ docId: string; message: string }>> {
    invalidateRoster();
    const failures: Array<{ docId: string; message: string }> = [];
    const uniqueDocIds = [...new Set(docIds)];
    let roster: ContactSummary[];
    try {
        roster = await listContacts(settings);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        for (const docId of uniqueDocIds) failures.push({ docId, message });
        console.warn("[lvct] 相关人物区块同步失败（名册读取）", error);
        return failures;
    }
    for (const docId of uniqueDocIds) {
        const person = roster.find((item) => item.docId === docId);
        if (!person) continue;
        try {
            await syncRelatedSection(person, resolveRelated(person, roster));
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            failures.push({ docId, message });
            console.warn(`[lvct] 相关人物区块同步失败（${docId}）——对该人物重新执行关系编辑可补同步`, error);
        }
    }
    return failures;
}

/** 建立关系（幂等：已存在则不重复写）。写前回读最新列表防并发丢边；双方文档双链区块同步 */
export async function addRelation(
    settings: ContactsSettings,
    person: ContactSummary,
    other: ContactSummary,
): Promise<void> {
    const fresh = await readFreshPerson(settings, person);
    if (fresh.relatedItemIds.includes(other.itemId)) return;
    await writeRelated(settings, fresh, [...fresh.relatedItemIds, other.itemId]);
    await refreshSections(settings, [fresh.docId, other.docId]);
}

/** 解除关系（幂等：不存在则跳过）。写前回读最新列表防并发丢边；双方文档双链区块同步 */
export async function removeRelation(
    settings: ContactsSettings,
    person: ContactSummary,
    other: ContactSummary,
): Promise<void> {
    const fresh = await readFreshPerson(settings, person);
    if (!fresh.relatedItemIds.includes(other.itemId)) return;
    await writeRelated(settings, fresh, fresh.relatedItemIds.filter((itemId) => itemId !== other.itemId));
    await refreshSections(settings, [fresh.docId, other.docId]);
}

/** 关系编辑后的刷新：回查该联系人（走名册缓存） */
export async function refreshPerson(settings: ContactsSettings, person: ContactSummary): Promise<ContactSummary | null> {
    const people = await listContacts(settings);
    return people.find((item) => item.itemId === person.itemId) ?? null;
}
