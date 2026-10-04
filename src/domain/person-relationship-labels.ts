import { parseStoreRecords, StoreIntegrityError } from "./store-integrity.ts";
import type { MigrationRecordSummary } from "./migration-records.ts";

export interface PersonRelationshipLabels {
    id: string;
    selfDocId: string;
    personDocId: string;
    labels: string[];
    createdAt: number;
    updatedAt: number;
}

export interface PersonRelationshipLabelStore {
    schemaVersion: 1;
    labels: PersonRelationshipLabels[];
}

const ID_PATTERN = /^\d{14}-[0-9a-z]{7}$/;

function parseRelationshipLabels(raw: unknown): PersonRelationshipLabels | null {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
    const record = raw as Partial<PersonRelationshipLabels>;
    if (typeof record.id !== "string" || !ID_PATTERN.test(record.id)
        || typeof record.selfDocId !== "string" || !ID_PATTERN.test(record.selfDocId)
        || typeof record.personDocId !== "string" || !ID_PATTERN.test(record.personDocId)
        || record.selfDocId === record.personDocId) return null;
    if (!Number.isSafeInteger(record.createdAt) || !Number.isSafeInteger(record.updatedAt)
        || record.createdAt! < 0 || record.updatedAt! < record.createdAt!) return null;
    if (!Array.isArray(record.labels) || record.labels.length > 20
        || record.labels.some((label) => typeof label !== "string" || !label.trim() || label.trim().length > 80
            || /[\u0000-\u001f\u007f]/.test(label))) return null;
    const labels = record.labels.map((label) => label.trim());
    if (new Set(labels).size !== labels.length) return null;
    return {
        id: record.id, selfDocId: record.selfDocId, personDocId: record.personDocId,
        labels, createdAt: record.createdAt!, updatedAt: record.updatedAt!,
    };
}

export function parsePersonRelationshipLabelStore(raw: unknown): PersonRelationshipLabelStore {
    const labels = parseStoreRecords(raw, "人物关系称谓", "labels", parseRelationshipLabels);
    const references = new Set<string>();
    for (const record of labels) {
        const reference = `${record.selfDocId}:${record.personDocId}`;
        if (references.has(reference)) throw new StoreIntegrityError("人物关系称谓", "本人和人物组合重复", labels.length);
        references.add(reference);
    }
    return { schemaVersion: 1, labels };
}

export type RelationshipLabelProjection =
    | { state: "unknown" | "self_missing" | "self"; labels: null }
    | { state: "known"; labels: string[]; recordId: string | null; updatedAt: number | null };

export function projectPersonRelationshipLabels(
    store: PersonRelationshipLabelStore,
    selfDocId: string | null | undefined,
    personDocId: string,
): RelationshipLabelProjection {
    if (selfDocId === undefined) return { state: "unknown", labels: null };
    if (selfDocId === null) return { state: "self_missing", labels: null };
    if (selfDocId === personDocId) return { state: "self", labels: null };
    const record = store.labels.find((item) => item.selfDocId === selfDocId && item.personDocId === personDocId);
    return { state: "known", labels: [...(record?.labels ?? [])], recordId: record?.id ?? null, updatedAt: record?.updatedAt ?? null };
}

export function mergeRelationshipLabelBackup(
    current: PersonRelationshipLabelStore, incoming: PersonRelationshipLabelStore, selfDocId: string | null, reachable: ReadonlySet<string>,
): { store: PersonRelationshipLabelStore; summary: MigrationRecordSummary } {
    const labels = [...current.labels];
    const summary: MigrationRecordSummary = { merged: 0, skipped: 0, removed: 0, issues: [] };
    for (const record of incoming.labels) {
        const existing = labels.find((entry) => entry.id === record.id || entry.selfDocId === record.selfDocId && entry.personDocId === record.personDocId);
        if (existing && JSON.stringify(existing) === JSON.stringify(record)) { summary.skipped += 1; continue; }
        const reason = existing ? "conflict" : record.selfDocId !== selfDocId || !reachable.has(record.selfDocId) || !reachable.has(record.personDocId) ? "unreachable" : null;
        if (reason) {
            summary.skipped += 1;
            summary.issues.push({ id: record.id, personDocId: record.personDocId, selfDocId: record.selfDocId, reason,
                message: reason === "conflict" ? "称谓与当前组合冲突，保留当前值（含明确清空）" : "本人参照或人物绑定未核实，未转移称谓；请核对原文档 ID" });
        } else { labels.push(record); summary.merged += 1; }
    }
    return { store: { schemaVersion: 1, labels }, summary };
}
