import type { Plugin } from "siyuan";
import { parseOrganizationOperationStore } from "../domain/organization-operations.ts";
import type { OrganizationOperation, OrganizationOperationStore } from "../domain/organization-operations.ts";
import { loadJsonStrict, saveJsonVerified, withStoreLock } from "./storage.ts";

export const ORGANIZATION_OPERATIONS_STORAGE_KEY = "organization-operations.json";

export async function loadOrganizationOperations(plugin: Plugin): Promise<OrganizationOperationStore> {
    return parseOrganizationOperationStore(await loadJsonStrict(plugin, ORGANIZATION_OPERATIONS_STORAGE_KEY));
}

export async function saveOrganizationOperation(plugin: Plugin, operation: OrganizationOperation): Promise<void> {
    await withStoreLock(ORGANIZATION_OPERATIONS_STORAGE_KEY, async () => {
        const store = await loadOrganizationOperations(plugin);
        const previous = store.operations.find((entry) => entry.requestId === operation.requestId);
        if (previous) {
            const immutable = (entry: OrganizationOperation) => {
                if (entry.kind === "create") return JSON.stringify([entry.kind, entry.requestId, entry.notebookId, entry.name, entry.createdAt]);
                const { updatedAt: _updatedAt, titleState: _titleState, markerState: _markerState, ...snapshot } = entry;
                return JSON.stringify(snapshot);
            };
            if (immutable(previous) !== immutable(operation) || previous.docId && previous.docId !== operation.docId
                || operation.updatedAt < previous.updatedAt) throw new Error("组织操作身份或原快照不可变");
            const transitions = { unissued: ["unissued", "pending"], pending: ["pending", "rejected", "verified"], rejected: ["rejected", "pending", "verified"], verified: ["verified"] };
            const states = (entry: OrganizationOperation) => entry.kind === "create" ? [entry.createState] : [entry.titleState, entry.markerState];
            if (states(previous).some((state, index) => !transitions[state].includes(states(operation)[index]))) {
                throw new Error("组织操作步骤不可回退或绕过发送前断点");
            }
        }
        const next = parseOrganizationOperationStore({ schemaVersion: 1, operations: previous
            ? store.operations.map((entry) => entry.requestId === operation.requestId ? operation : entry)
            : [...store.operations, operation] });
        await saveJsonVerified(plugin, ORGANIZATION_OPERATIONS_STORAGE_KEY, next);
    });
}
