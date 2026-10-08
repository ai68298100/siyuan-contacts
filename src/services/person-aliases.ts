import type { Plugin } from "siyuan";
import {
    createPersonAlias,
    deletePersonAlias,
    listPersonAliasRecords,
    resolvePersonAliasRecord,
} from "../data/person-aliases";
import type { PersonAlias } from "../domain/person-aliases";
import { resolvePersonIdentity } from "../domain/person-aliases";
import type { PersonIdentityResolution } from "../domain/person-aliases";
import { loadPersonAliasStore } from "../data/person-aliases";
import type { ContactsSettings } from "../domain/model";
import { getRoster, invalidateRoster } from "./roster";
import { documentExists } from "../api/blocks";

const ID_PATTERN = /^\d{14}-[0-9a-z]{7}$/;

function assertPersonDocId(personDocId: string): void {
    if (!ID_PATTERN.test(personDocId)) throw new Error("人物文档 ID 无效");
}

export async function listPersonAliases(plugin: Plugin, personDocId: string): Promise<PersonAlias[]> {
    assertPersonDocId(personDocId);
    return listPersonAliasRecords(plugin, personDocId);
}

export async function addPersonAlias(plugin: Plugin, personDocId: string, alias: string, settings?: ContactsSettings): Promise<PersonAlias> {
    assertPersonDocId(personDocId);
    if (settings) {
        invalidateRoster();
        const people = await getRoster(settings);
        if (people.filter((person) => person.docId === personDocId).length !== 1 || !(await documentExists(personDocId))) {
            throw new Error("别名人物未唯一登记或文档不可达，未保存或改绑");
        }
    }
    return createPersonAlias(plugin, personDocId, alias);
}

export async function removePersonAlias(plugin: Plugin, id: string): Promise<void> {
    await deletePersonAlias(plugin, id);
}

export async function resolveAlias(plugin: Plugin, alias: string, settings?: ContactsSettings): Promise<PersonIdentityResolution> {
    if (!settings) return resolvePersonAliasRecord(plugin, alias);
    invalidateRoster();
    const [store, people] = await Promise.all([loadPersonAliasStore(plugin), getRoster(settings)]);
    const resolved = resolvePersonIdentity(store, people, alias);
    if (resolved.status === "resolved" && !(await documentExists(resolved.personDocId))) {
        return { status: "unavailable", alias: alias.trim(), personDocIds: [resolved.personDocId] };
    }
    return resolved;
}

export type { AliasResolution, PersonIdentityResolution, PersonAlias } from "../domain/person-aliases";
