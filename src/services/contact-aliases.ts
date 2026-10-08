import type { Plugin } from "siyuan";
import type { ContactSummary } from "../domain/person";
import type { PersonAliasStore } from "../domain/person-aliases";
import { loadPersonAliasStore } from "../data/person-aliases";

let aliasPlugin: Plugin | undefined;

export function bindContactAliasStorage(plugin: Plugin): () => void {
    aliasPlugin = plugin;
    return () => { if (aliasPlugin === plugin) aliasPlugin = undefined; };
}

export async function loadContactAliasIndex(): Promise<PersonAliasStore | null> {
    return aliasPlugin ? loadPersonAliasStore(aliasPlugin) : null;
}

export async function enrichContactAliases(people: ContactSummary[]): Promise<ContactSummary[]> {
    const index = await loadContactAliasIndex().catch(() => undefined);
    if (index === null) return people;
    if (index === undefined) return people.map((person) => ({ ...person, aliasProfile: { state: "unknown", message: "别名读取失败，请重新读取核实" } }));
    const byDoc = new Map<string, string[]>();
    for (const entry of index.aliases) {
        const values = byDoc.get(entry.personDocId) ?? [];
        values.push(entry.alias);
        byDoc.set(entry.personDocId, values);
    }
    return people.map((person) => ({ ...person, aliasProfile: { state: "known", values: byDoc.get(person.docId) ?? [] } }));
}
