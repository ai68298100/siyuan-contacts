import type { Plugin } from "siyuan";
import { newNodeId } from "../api/client";
import { documentExists } from "../api/blocks";
import { createContact, ContactCreationError, ContactNameAmbiguityError, filterContacts, listContacts, previewContactCreation } from "../services/contacts";
import type { ContactCreationRequest } from "../services/contacts";
import { createExternalBridgeApi } from "../services/external-bridge.ts";
import type { LvContactsBridgeApi } from "../services/external-bridge.ts";
import { recordInteractionWithResult, INTERACTION_STORAGE_KEY } from "../data/interactions";
import { loadJsonStrict, saveJsonVerified, withStoreLock } from "../data/storage";
import { defaultBridgeRef } from "../domain/interactions.ts";
import {
    BRIDGE_STORAGE_KEY, BridgeError, BridgePersonAmbiguityError, bridgeEventEvidence, bridgePerson, normalizeBridgeRequestStore,
    resolveBridgePerson,
} from "../domain/external-bridge.ts";
import { documentHPath } from "../domain/format.ts";
import { emptyDraft } from "../domain/person.ts";
import { invalidateRoster } from "../services/roster";
import type { ContactsSettings } from "../domain/model";

export { defaultBridgeRef };
export { BRIDGE_PROTOCOL, BridgeError, BridgePersonAmbiguityError } from "../domain/external-bridge.ts";
export type { BridgePerson, BridgeInteractionMeta, BridgeEnsureOptions, BridgeInteractionResult } from "../domain/external-bridge.ts";
export type { LvContactsBridgeApi } from "../services/external-bridge.ts";

declare global {
    interface Window {
        LvContacts?: LvContactsBridgeApi;
    }
}

let mounted: { api: LvContactsBridgeApi; deactivate(): void } | undefined;

export function initExternalBridge(plugin: Plugin, getSettings: () => ContactsSettings | null): void {
    disposeExternalBridge();
    let active = true;
    const requireSettings = (): ContactsSettings => {
        if (!active) throw new BridgeError("disposed", "getPerson");
        const settings = getSettings();
        if (!settings) throw new BridgeError("not_initialized", "getPerson");
        return { ...settings, fieldMap: { ...settings.fieldMap } };
    };
    const guard = (original?: ContactsSettings): void => {
        const current = requireSettings();
        if (original && (original.notebookId !== current.notebookId || original.avId !== current.avId
            || original.dbBlockId !== current.dbBlockId || original.hostDocId !== current.hostDocId
            || original.notebookName !== current.notebookName || JSON.stringify(original.fieldMap) !== JSON.stringify(current.fieldMap))) {
            throw new BridgeError("configuration_changed", "getPerson");
        }
    };
    const people = async (settings: ContactsSettings) => {
        invalidateRoster();
        return listContacts(settings);
    };
    const api = createExternalBridgeApi({
        settings: requireSettings,
        guard,
        lock: (task) => withStoreLock(BRIDGE_STORAGE_KEY, task),
        readRequests: async () => normalizeBridgeRequestStore(await loadJsonStrict(plugin, BRIDGE_STORAGE_KEY)),
        saveRequests: async (store) => saveJsonVerified(plugin, BRIDGE_STORAGE_KEY, normalizeBridgeRequestStore(store)),
        people,
        reachable: documentExists,
        search: async (settings, keyword) => {
            const roster = await people(settings);
            for (const person of roster) resolveBridgePerson(roster, person.docId, "searchPeople");
            return filterContacts(roster, keyword).map(bridgePerson);
        },
        newRequest: (settings, name) => ({
            checkpoint: { requestId: newNodeId(), notebookId: settings.notebookId, avId: settings.avId, dbBlockId: settings.dbBlockId,
                name, path: documentHPath(settings.notebookName, name), draftKey: "[]", state: "new" },
            bindingState: "new",
        }),
        create: async (settings, name, previous) => {
            const request: ContactCreationRequest = { draft: { ...emptyDraft(), name }, checkpoint: previous.checkpoint,
                source: "created", bindingState: previous.bindingState };
            try {
                if (request.checkpoint.state === "new") {
                    const preview = await previewContactCreation(settings, name);
                    guard(settings);
                    if (preview.existing.length || preview.unbound.length) throw new BridgePersonAmbiguityError(preview.existing.map(bridgePerson),
                        preview.unbound.map((candidate) => ({ docId: candidate.docId, name: candidate.name })));
                }
                const person = await createContact(settings, request.draft, { request });
                guard(settings);
                return bridgePerson(person);
            } catch (error) {
                if (error instanceof BridgePersonAmbiguityError) throw error;
                if (error instanceof ContactNameAmbiguityError) throw new BridgePersonAmbiguityError(error.preview.existing.map(bridgePerson),
                    error.preview.unbound.map((candidate) => ({ docId: candidate.docId, name: candidate.name })));
                const rejected = request.checkpoint.state === "rejected" || request.bindingState === "rejected";
                if (error instanceof ContactCreationError) {
                    throw new BridgeError(rejected ? "write_failed" : "write_unknown", "ensurePerson", rejected ? "rejected" : "unknown");
                }
                throw new BridgeError("write_unknown", "ensurePerson", "unknown");
            } finally {
                previous.checkpoint = request.checkpoint;
                previous.bindingState = request.bindingState;
            }
        },
        event: async (docId, ref) => {
            return bridgeEventEvidence(await loadJsonStrict(plugin, INTERACTION_STORAGE_KEY), docId, ref);
        },
        record: (personDocId, externalRef, occurredAt, note) => recordInteractionWithResult(plugin, {
            personDocId, source: "api", externalRef, occurredAt, ...(note ? { note } : {}),
        }),
    });
    mounted = { api, deactivate: () => { active = false; } };
    window.LvContacts = api;
}

export function disposeExternalBridge(): void {
    if (!mounted) return;
    mounted.deactivate();
    if (window.LvContacts === mounted.api) delete window.LvContacts;
    mounted = undefined;
}
