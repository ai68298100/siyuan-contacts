import type { Plugin } from "siyuan";
import { newNodeId } from "../api/client";
import {
    appendPersonAlias,
    emptyPersonAliasStore,
    listPersonAliases,
    parsePersonAliasStore,
    normalizePersonAliasStoreForWrite,
    removePersonAlias,
    resolvePersonAlias,
    validatePersonAlias,
} from "../domain/person-aliases";
import type { AliasResolution, PersonAlias, PersonAliasStore } from "../domain/person-aliases";
import { loadJsonStrict, saveJsonVerified, withStoreLock } from "./storage";
import { mergeAliasBackup, MigrationWriteUnknownError } from "../domain/migration-records";
import type { MigrationRecordSummary } from "../domain/migration-records";

export const PERSON_ALIAS_STORAGE_KEY = "person-aliases.json";

export async function loadPersonAliasStore(plugin: Plugin): Promise<PersonAliasStore> {
    return parsePersonAliasStore(await loadJsonStrict(plugin, PERSON_ALIAS_STORAGE_KEY));
}

export async function listPersonAliasRecords(plugin: Plugin, personDocId: string): Promise<PersonAlias[]> {
    return listPersonAliases(await loadPersonAliasStore(plugin), personDocId);
}

export async function resolvePersonAliasRecord(plugin: Plugin, alias: string): Promise<AliasResolution> {
    return resolvePersonAlias(await loadPersonAliasStore(plugin), alias);
}

export async function createPersonAlias(plugin: Plugin, personDocId: string, alias: string): Promise<PersonAlias> {
    const errors = validatePersonAlias(alias, personDocId);
    if (errors.length > 0) throw new Error(errors.join("；"));
    return withStoreLock(PERSON_ALIAS_STORAGE_KEY, async () => {
        const store = normalizePersonAliasStoreForWrite(await loadJsonStrict(plugin, PERSON_ALIAS_STORAGE_KEY));
        const now = Date.now();
        const candidate: PersonAlias = {
            id: newNodeId(),
            personDocId,
            alias: alias.trim(),
            createdAt: now,
            updatedAt: now,
        };
        const result = appendPersonAlias(store, candidate);
        if (result.status === "conflict") throw new Error(`别名“${alias.trim()}”已被其他联系人使用，请先消歧`);
        if (result.status === "added") await saveJsonVerified(plugin, PERSON_ALIAS_STORAGE_KEY, result.store);
        return result.alias;
    });
}

export async function deletePersonAlias(plugin: Plugin, id: string): Promise<void> {
    await withStoreLock(PERSON_ALIAS_STORAGE_KEY, async () => {
        const store = normalizePersonAliasStoreForWrite(await loadJsonStrict(plugin, PERSON_ALIAS_STORAGE_KEY));
        const next = removePersonAlias(store, id);
        if (!next) throw new Error("人物别名不存在");
        await saveJsonVerified(plugin, PERSON_ALIAS_STORAGE_KEY, next);
    });
}

export { emptyPersonAliasStore };

export async function mergePersonAliasStore(plugin: Plugin, incoming: PersonAliasStore, reachable: ReadonlySet<string>): Promise<MigrationRecordSummary> {
    const checked = parsePersonAliasStore(incoming);
    return withStoreLock(PERSON_ALIAS_STORAGE_KEY, async () => {
        const current = await loadPersonAliasStore(plugin);
        const result = mergeAliasBackup(current, checked, reachable);
        if (JSON.stringify(current) !== JSON.stringify(result.store)) {
            try {
                await saveJsonVerified(plugin, PERSON_ALIAS_STORAGE_KEY, result.store);
            } catch (error) {
                throw new MigrationWriteUnknownError(error);
            }
        }
        return result.summary;
    });
}
