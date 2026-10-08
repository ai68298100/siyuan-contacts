import type { Plugin } from "siyuan";
import { newNodeId } from "../api/client";
import { parsePersonRelationshipLabelStore, mergeRelationshipLabelBackup } from "../domain/person-relationship-labels";
import type { PersonRelationshipLabels, PersonRelationshipLabelStore } from "../domain/person-relationship-labels";
import { MigrationWriteUnknownError } from "../domain/migration-records";
import { loadJsonStrict, saveJsonVerified, withStoreLock } from "./storage";

export const RELATIONSHIP_LABEL_STORAGE_KEY = "person-relationship-labels.json";

const unknownWrites = new WeakMap<Plugin, Map<string, PersonRelationshipLabels>>();

export function retainUnknownRelationshipLabelWrite(plugin: Plugin, record: PersonRelationshipLabels): void {
    const pending = unknownWrites.get(plugin) ?? new Map<string, PersonRelationshipLabels>();
    pending.set(`${record.selfDocId}:${record.personDocId}`, structuredClone(record));
    unknownWrites.set(plugin, pending);
}

export async function loadRelationshipLabelStore(plugin: Plugin): Promise<PersonRelationshipLabelStore> {
    const store = parsePersonRelationshipLabelStore(await loadJsonStrict(plugin, RELATIONSHIP_LABEL_STORAGE_KEY));
    const pending = unknownWrites.get(plugin);
    for (const [reference, expected] of pending ?? []) {
        const actual = store.labels.find((record) => record.selfDocId === expected.selfDocId && record.personDocId === expected.personDocId);
        if (JSON.stringify(actual) !== JSON.stringify(expected)) {
            throw new MigrationWriteUnknownError(new Error("原称谓记录尚未匹配；记录缺失不能证明明确清空已保存，未重发"));
        }
        pending!.delete(reference);
    }
    return store;
}

export async function saveRelationshipLabels(
    plugin: Plugin, selfDocId: string, personDocId: string, labels: string[], expected: PersonRelationshipLabels | null,
    assertWritable?: () => void,
): Promise<PersonRelationshipLabels> {
    return withStoreLock(RELATIONSHIP_LABEL_STORAGE_KEY, async () => {
        assertWritable?.();
        const store = await loadRelationshipLabelStore(plugin);
        assertWritable?.();
        const current = store.labels.find((record) => record.selfDocId === selfDocId && record.personDocId === personDocId) ?? null;
        const checkedExpected = expected === null ? null : parsePersonRelationshipLabelStore({ schemaVersion: 1, labels: [expected] }).labels[0];
        const now = Math.max(Date.now(), current?.updatedAt ?? 0);
        const candidate = parsePersonRelationshipLabelStore({ schemaVersion: 1, labels: [{
            id: current?.id ?? newNodeId(), selfDocId, personDocId, labels, createdAt: current?.createdAt ?? now, updatedAt: now,
        }] }).labels[0];
        if (current && JSON.stringify(current.labels) === JSON.stringify(candidate.labels)) return current;
        if (JSON.stringify(current) !== JSON.stringify(checkedExpected)) throw new Error("称谓已被其他操作修改，请重新读取后核对；未覆盖原记录");
        const next = { schemaVersion: 1, labels: [...store.labels.filter((record) => record.id !== candidate.id), candidate] };
        try { await saveJsonVerified(plugin, RELATIONSHIP_LABEL_STORAGE_KEY, next); }
        catch (cause) {
            retainUnknownRelationshipLabelWrite(plugin, candidate);
            throw new MigrationWriteUnknownError(cause);
        }
        return candidate;
    });
}

export async function mergeRelationshipLabelStore(
    plugin: Plugin, raw: unknown, selfDocId: string | null, reachable: ReadonlySet<string>, assertWritable?: () => void,
) {
    const incoming = parsePersonRelationshipLabelStore(raw);
    return withStoreLock(RELATIONSHIP_LABEL_STORAGE_KEY, async () => {
        assertWritable?.();
        const current = await loadRelationshipLabelStore(plugin);
        assertWritable?.();
        const result = mergeRelationshipLabelBackup(current, incoming, selfDocId, reachable);
        if (result.summary.merged > 0) {
            try { await saveJsonVerified(plugin, RELATIONSHIP_LABEL_STORAGE_KEY, result.store); }
            catch (cause) { throw new MigrationWriteUnknownError(cause); }
        }
        return result.summary;
    });
}
