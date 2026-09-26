/**
 * 关系编辑服务：在 related relation 字段上做增量增删。
 * 边以 itemID 表达（D-0009）；写入后由内核自动维护双向回链（E2E 实证）。
 */
import { listContacts } from "./contacts";
import { invalidateRoster } from "./roster";
import { setCell } from "../api/av";
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
    invalidateRoster();
}

/** 建立关系（幂等：已存在则不重复写） */
export async function addRelation(
    settings: ContactsSettings,
    person: ContactSummary,
    other: ContactSummary,
): Promise<void> {
    if (person.relatedItemIds.includes(other.itemId)) return;
    await writeRelated(settings, person, [...person.relatedItemIds, other.itemId]);
}

/** 解除关系（幂等：不存在则跳过） */
export async function removeRelation(
    settings: ContactsSettings,
    person: ContactSummary,
    other: ContactSummary,
): Promise<void> {
    if (!person.relatedItemIds.includes(other.itemId)) return;
    await writeRelated(settings, person, person.relatedItemIds.filter((itemId) => itemId !== other.itemId));
}

/** 关系编辑后的刷新：回查该联系人（走名册缓存） */
export async function refreshPerson(settings: ContactsSettings, person: ContactSummary): Promise<ContactSummary | null> {
    const people = await listContacts(settings);
    return people.find((item) => item.itemId === person.itemId) ?? null;
}
