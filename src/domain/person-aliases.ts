import { parseStoreRecords, StoreIntegrityError } from "./store-integrity.ts";
import type { ContactSummary } from "./person.ts";

export interface PersonAlias {
    id: string;
    personDocId: string;
    alias: string;
    createdAt: number;
    updatedAt: number;
}

export interface PersonAliasStore {
    schemaVersion: 1;
    aliases: PersonAlias[];
    tombstones?: string[];
}

export type AliasResolution =
    | { status: "missing" }
    | { status: "resolved"; personDocId: string; alias: string }
    | { status: "ambiguous"; alias: string; personDocIds: string[] };

export type PersonIdentityResolution = AliasResolution
    | { status: "unavailable"; alias: string; personDocIds: string[] };

export type PersonAliasAppendResult =
    | { status: "added"; store: PersonAliasStore; alias: PersonAlias }
    | { status: "exists"; store: PersonAliasStore; alias: PersonAlias }
    | { status: "conflict"; store: PersonAliasStore; alias: PersonAlias };

const ID_PATTERN = /^\d{14}-[0-9a-z]{7}$/;
const HONORIFIC_PATTERN = /^[\u4e00-\u9fff]{1,4}(总|老板|经理|主管|主任|老师|先生|女士|总监|董事长|校长|院长|局长|部长|秘书|助理)$/;
const STANDALONE_TITLE_PATTERN = /^(老板|经理|主管|主任|老师|先生|女士|总监|董事长|校长|院长|局长|部长|秘书|助理)$/;

export function normalizeAliasKey(alias: string): string {
    return alias.trim().toLocaleLowerCase();
}

export function validatePersonAlias(alias: string, personDocId: string): string[] {
    const trimmed = alias.trim();
    const errors: string[] = [];
    if (!ID_PATTERN.test(personDocId)) errors.push("人物文档 ID 无效");
    if (!trimmed) errors.push("别名不能为空");
    if (trimmed.length > 80) errors.push("别名不能超过 80 个字符");
    if (/[\u0000-\u001f\u007f]/.test(trimmed)) errors.push("别名不能包含换行或控制字符");
    if (STANDALONE_TITLE_PATTERN.test(trimmed) || HONORIFIC_PATTERN.test(trimmed)) {
        errors.push("别名不能只使用姓氏加职务或泛称，例如“王总”；请填写能唯一识别此人的称呼");
    }
    return errors;
}

function parseAlias(raw: unknown): PersonAlias | null {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
    const record = raw as Partial<PersonAlias>;
    if (typeof record.id !== "string" || typeof record.personDocId !== "string" || !ID_PATTERN.test(record.id) || !ID_PATTERN.test(record.personDocId)) return null;
    if (typeof record.alias !== "string" || !record.alias.trim() || typeof record.createdAt !== "number" || typeof record.updatedAt !== "number") return null;
    if (!Number.isFinite(record.createdAt) || !Number.isFinite(record.updatedAt)) return null;
    if (validatePersonAlias(record.alias, record.personDocId).length > 0) return null;
    return {
        id: record.id,
        personDocId: record.personDocId,
        alias: record.alias.trim(),
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
    };
}

export function emptyPersonAliasStore(): PersonAliasStore {
    return { schemaVersion: 1, aliases: [] };
}

export function normalizePersonAliasStore(raw: unknown): PersonAliasStore {
    if (raw === null || typeof raw !== "object") return emptyPersonAliasStore();
    const record = raw as Partial<PersonAliasStore>;
    if (record.schemaVersion !== 1 || !Array.isArray(record.aliases)) return emptyPersonAliasStore();
    const seen = new Set<string>();
    const aliases: PersonAlias[] = [];
    for (const item of record.aliases) {
        const parsed = parseAlias(item);
        if (!parsed || seen.has(parsed.id)) continue;
        seen.add(parsed.id);
        aliases.push(parsed);
    }
    return { schemaVersion: 1, aliases };
}

export function normalizePersonAliasStoreForWrite(raw: unknown): PersonAliasStore {
    return parsePersonAliasStore(raw);
}

export function parsePersonAliasStore(raw: unknown): PersonAliasStore {
    const aliases = parseStoreRecords(raw, "人物别名", "aliases", parseAlias);
    const entries = raw !== null && typeof raw === "object" ? (raw as PersonAliasStore).tombstones : undefined;
    if (entries === undefined) return { schemaVersion: 1, aliases };
    if (!Array.isArray(entries) || entries.some((id) => typeof id !== "string" || !ID_PATTERN.test(id))
        || new Set(entries).size !== entries.length) {
        throw new StoreIntegrityError("人物别名", "删除标记必须为不重复的合法记录 ID 数组");
    }
    const deleted = new Set(entries);
    return { schemaVersion: 1, aliases: aliases.filter((alias) => !deleted.has(alias.id)), tombstones: [...entries] };
}

export function appendPersonAlias(store: PersonAliasStore, alias: PersonAlias): PersonAliasAppendResult {
    const key = normalizeAliasKey(alias.alias);
    const sameKey = store.aliases.filter((item) => normalizeAliasKey(item.alias) === key);
    const existing = sameKey.find((item) => item.personDocId === alias.personDocId);
    if (existing) return { status: "exists", store, alias: existing };
    const conflict = sameKey[0];
    if (conflict) return { status: "conflict", store, alias: conflict };
    return { status: "added", store: { ...store, aliases: [...store.aliases, alias] }, alias };
}

export function removePersonAlias(store: PersonAliasStore, id: string): PersonAliasStore | null {
    if (!store.aliases.some((item) => item.id === id)) return null;
    return { ...store, aliases: store.aliases.filter((item) => item.id !== id), tombstones: [...new Set([...(store.tombstones ?? []), id])] };
}

export function listPersonAliases(store: PersonAliasStore, personDocId: string): PersonAlias[] {
    return store.aliases
        .filter((item) => item.personDocId === personDocId)
        .sort((left, right) => left.alias.localeCompare(right.alias, "zh-CN") || left.id.localeCompare(right.id));
}

export function resolvePersonAlias(store: PersonAliasStore, alias: string): AliasResolution {
    const trimmed = alias.trim();
    const key = normalizeAliasKey(trimmed);
    if (!key) return { status: "missing" };
    const matches = store.aliases.filter((item) => normalizeAliasKey(item.alias) === key);
    const personDocIds = [...new Set(matches.map((item) => item.personDocId))];
    if (personDocIds.length === 0) return { status: "missing" };
    if (personDocIds.length > 1) return { status: "ambiguous", alias: trimmed, personDocIds };
    return { status: "resolved", personDocId: personDocIds[0], alias: matches[0].alias };
}

export function resolvePersonIdentity(store: PersonAliasStore, people: readonly ContactSummary[], name: string): PersonIdentityResolution {
    const key = normalizeAliasKey(name);
    if (!key) return { status: "missing" };
    const aliasIds = new Set(store.aliases.filter((entry) => normalizeAliasKey(entry.alias) === key).map((entry) => entry.personDocId));
    const matches = people.filter((person) => aliasIds.has(person.docId) || normalizeAliasKey(person.name) === key);
    const ids = [...new Set([...aliasIds, ...matches.map((person) => person.docId)])];
    if (ids.some((docId) => people.filter((person) => person.docId === docId).length !== 1)) {
        return { status: "unavailable", alias: name.trim(), personDocIds: ids };
    }
    if (matches.length > 1) return { status: "ambiguous", alias: name.trim(), personDocIds: ids };
    return matches.length === 1 ? { status: "resolved", alias: name.trim(), personDocId: matches[0].docId } : { status: "missing" };
}
