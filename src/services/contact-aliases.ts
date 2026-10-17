import type { Plugin } from "siyuan";
import type { ContactSummary } from "../domain/person";
import type { PersonAliasStore } from "../domain/person-aliases";
import { loadPersonAliasStore } from "../data/person-aliases";

let aliasPlugin: Plugin | undefined;

export function bindContactAliasStorage(plugin: Plugin): () => void {
    aliasPlugin = plugin;
    return () => { if (aliasPlugin === plugin) aliasPlugin = undefined; };
}

export async function loadContactAliasIndex(plugin = aliasPlugin): Promise<PersonAliasStore | null> {
    return plugin ? loadPersonAliasStore(plugin) : null;
}

async function readContactAliasSnapshot(plugin: Plugin | undefined) {
    const index = plugin ? await loadContactAliasIndex(plugin).catch(() => undefined) : null;
    if (index === null || index === undefined) return index;
    const byDoc = new Map<string, string[]>();
    for (const entry of index.aliases) {
        const values = byDoc.get(entry.personDocId) ?? [];
        values.push(entry.alias);
        byDoc.set(entry.personDocId, values);
    }
    return byDoc;
}

function projectContactAliases(people: ContactSummary[], snapshot: Awaited<ReturnType<typeof readContactAliasSnapshot>>): ContactSummary[] {
    if (snapshot === null) return people;
    if (snapshot === undefined) return people.map((person) => ({ ...person, aliasProfile: { state: "unknown", message: "别名读取失败，请重新读取核实" } }));
    return people.map((person) => ({ ...person, aliasProfile: { state: "known", values: [...(snapshot.get(person.docId) ?? [])] } }));
}

/** 绑定在创建时捕获；每轮读取一次，显式未知也保留至下一轮重读。 */
export function createContactAliasProjection(plugin = aliasPlugin): (people: ContactSummary[]) => Promise<ContactSummary[]> {
    let snapshot: ReturnType<typeof readContactAliasSnapshot> | undefined;
    return async (people) => projectContactAliases(people, await (snapshot ??= readContactAliasSnapshot(plugin)));
}

export async function enrichContactAliases(people: ContactSummary[]): Promise<ContactSummary[]> {
    return projectContactAliases(people, await readContactAliasSnapshot(aliasPlugin));
}
