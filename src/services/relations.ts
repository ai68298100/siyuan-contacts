/**
 * 关系编辑服务：在 related relation 字段上做增量增删。
 * 边以 itemID 表达（D-0009）；写入后由内核自动维护双向回链（E2E 实证）。
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

/** 关系变更后：失效名册，并把双方人物文档的"相关人物"双链区块同步到最新 */
async function refreshSections(settings: ContactsSettings, docIds: readonly string[]): Promise<void> {
    invalidateRoster();
    try {
        const roster = await listContacts(settings);
        for (const docId of docIds) {
            const person = roster.find((item) => item.docId === docId);
            if (person) {
                await syncRelatedSection(person, resolveRelated(person, roster));
            }
        }
    } catch (error) {
        // 区块同步是锦上添花：失败不影响关系数据本身（关系在数据库里），只记录
        console.warn("[lvct] 相关人物区块同步失败", error);
    }
}

/** 建立关系（幂等：已存在则不重复写）。内核自动维护双向回链；双方文档双链区块同步 */
export async function addRelation(
    settings: ContactsSettings,
    person: ContactSummary,
    other: ContactSummary,
): Promise<void> {
    if (person.relatedItemIds.includes(other.itemId)) return;
    await writeRelated(settings, person, [...person.relatedItemIds, other.itemId]);
    await refreshSections(settings, [person.docId, other.docId]);
}

/** 解除关系（幂等：不存在则跳过）。双方文档双链区块同步 */
export async function removeRelation(
    settings: ContactsSettings,
    person: ContactSummary,
    other: ContactSummary,
): Promise<void> {
    if (!person.relatedItemIds.includes(other.itemId)) return;
    await writeRelated(settings, person, person.relatedItemIds.filter((itemId) => itemId !== other.itemId));
    await refreshSections(settings, [person.docId, other.docId]);
}

/** 关系编辑后的刷新：回查该联系人（走名册缓存） */
export async function refreshPerson(settings: ContactsSettings, person: ContactSummary): Promise<ContactSummary | null> {
    const people = await listContacts(settings);
    return people.find((item) => item.itemId === person.itemId) ?? null;
}
