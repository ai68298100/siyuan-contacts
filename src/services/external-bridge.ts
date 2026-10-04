import {
    BRIDGE_CAPABILITIES, BRIDGE_PROTOCOL, BridgeError, BridgePersonAmbiguityError,
    bridgeKeyword, bridgePerson, isBridgeId, normalizeBridgeEnsure, normalizeBridgeInteraction,
    resolveBridgePerson, summarizeBridgeInteraction,
} from "../domain/external-bridge.ts";
import type {
    BridgeAnchors, BridgeCreateRequest, BridgeEnsureOptions, BridgeEnsureRequest, BridgeInteractionMeta,
    BridgeInteractionRequest, BridgeInteractionResult, BridgeItemResult, BridgeOperation, BridgePerson, BridgeRequestStore,
} from "../domain/external-bridge.ts";
import type { ContactsSettings } from "../domain/model";
import { birthdayToMs } from "../domain/person.ts";

export interface BridgeDependencies {
    settings(): ContactsSettings;
    guard(settings?: ContactsSettings): void;
    lock<T>(task: () => Promise<T>): Promise<T>;
    readRequests(): Promise<BridgeRequestStore>;
    saveRequests(store: BridgeRequestStore): Promise<void>;
    people(settings: ContactsSettings): Promise<BridgePerson[]>;
    search(settings: ContactsSettings, keyword: string): Promise<BridgePerson[]>;
    reachable(docId: string): Promise<boolean>;
    newRequest(settings: ContactsSettings, name: string): BridgeCreateRequest;
    create(settings: ContactsSettings, name: string, request: BridgeCreateRequest): Promise<BridgePerson>;
    event(docId: string, ref: string): Promise<{ date: string; note: string } | null>;
    record(docId: string, ref: string, occurredAt: number, note: string): Promise<{ recorded: boolean }>;
}

export interface LvContactsBridgeApi {
    readonly protocol: number;
    readonly capabilities: readonly string[];
    readonly safety: Readonly<{ stableDocIds: true; persistentRequests: true; itemResults: true; unknownWrites: "verify_first" }>;
    searchPeople(keyword?: string): Promise<BridgePerson[]>;
    getPerson(docId: string): Promise<BridgePerson | null>;
    ensurePerson(name: string, options?: BridgeEnsureOptions): Promise<BridgePerson & { created: boolean }>;
    recordInteraction(personDocIds: readonly string[], meta?: BridgeInteractionMeta): Promise<BridgeInteractionResult>;
}

function anchors(settings: ContactsSettings): BridgeAnchors {
    return { notebookId: settings.notebookId, avId: settings.avId, dbBlockId: settings.dbBlockId };
}

function sameAnchors(previous: BridgeAnchors, settings: ContactsSettings): boolean {
    return previous.notebookId === settings.notebookId && previous.avId === settings.avId && previous.dbBlockId === settings.dbBlockId;
}

export function createExternalBridgeApi(deps: BridgeDependencies): LvContactsBridgeApi {
    const settingsFor = (operation: BridgeOperation): ContactsSettings => {
        try { deps.guard(); return deps.settings(); }
        catch (error) {
            if (error instanceof BridgeError) throw new BridgeError(error.code, operation, error.writeState);
            throw new BridgeError("not_initialized", operation);
        }
    };
    const freshPeople = async (settings: ContactsSettings, operation: BridgeOperation): Promise<BridgePerson[]> => {
        try {
            const people = await deps.people(settings);
            deps.guard(settings);
            return people;
        } catch (error) {
            if (error instanceof BridgeError) throw new BridgeError(error.code, operation, error.writeState);
            throw new BridgeError("unavailable", operation);
        }
    };
    const readRequests = async (operation: BridgeOperation): Promise<BridgeRequestStore> => {
        try { return await deps.readRequests(); }
        catch { throw new BridgeError("storage_unknown", operation); }
    };
    const reachable = async (settings: ContactsSettings, docId: string, operation: BridgeOperation): Promise<boolean> => {
        try {
            const exists = await deps.reachable(docId);
            deps.guard(settings);
            return exists;
        } catch (error) {
            if (error instanceof BridgeError) throw new BridgeError(error.code, operation, error.writeState);
            throw new BridgeError("unavailable", operation);
        }
    };
    const persist = async (store: BridgeRequestStore, operation: BridgeOperation, issued = false): Promise<void> => {
        try { await deps.saveRequests(store); }
        catch { throw new BridgeError("storage_unknown", operation, issued ? "unknown" : "not_sent"); }
    };
    const locked = async <Result>(operation: BridgeOperation, task: () => Promise<Result>): Promise<Result> => {
        try { return await deps.lock(task); }
        catch (error) {
            if (error instanceof BridgeError) throw error;
            throw new BridgeError("unavailable", operation);
        }
    };

    return Object.freeze({
        protocol: BRIDGE_PROTOCOL,
        capabilities: BRIDGE_CAPABILITIES,
        safety: Object.freeze({ stableDocIds: true, persistentRequests: true, itemResults: true, unknownWrites: "verify_first" as const }),
        async searchPeople(keyword?: string) {
            const query = bridgeKeyword(keyword);
            const settings = settingsFor("searchPeople");
            try {
                const people = await deps.search(settings, query);
                deps.guard(settings);
                return people.map((person) => {
                    const resolved = resolveBridgePerson(people, person.docId, "searchPeople");
                    if (!resolved) throw new BridgeError("identity_unknown", "searchPeople");
                    return resolved;
                });
            } catch (error) {
                if (error instanceof BridgeError) throw error;
                throw new BridgeError("unavailable", "searchPeople");
            }
        },
        async getPerson(docId: string) {
            if (!isBridgeId(docId)) throw new BridgeError("invalid_input", "getPerson");
            const settings = settingsFor("getPerson");
            const person = resolveBridgePerson(await freshPeople(settings, "getPerson"), docId, "getPerson");
            return person && await reachable(settings, docId, "getPerson") ? person : null;
        },
        async ensurePerson(name: string, options?: BridgeEnsureOptions) {
            const input = normalizeBridgeEnsure(name, options);
            const settings = settingsFor("ensurePerson");
            return locked("ensurePerson", async () => {
                deps.guard(settings);
                if (input.docId) {
                    const person = resolveBridgePerson(await freshPeople(settings, "ensurePerson"), input.docId, "ensurePerson");
                    if (!person || !await reachable(settings, input.docId, "ensurePerson")) throw new BridgeError("person_not_found", "ensurePerson");
                    return { ...person, created: false };
                }
                const store = await readRequests("ensurePerson");
                let entry = store.requests.find((request): request is BridgeEnsureRequest => request.kind === "ensurePerson" && request.ref === input.ref);
                if (entry && (!sameAnchors(entry.anchors, settings) || entry.name !== input.name)) throw new BridgeError("idempotency_conflict", "ensurePerson");
                if (!entry) {
                    if (store.requests.some((request) => request.kind === "ensurePerson" && request.name === input.name
                        && request.anchors.notebookId === settings.notebookId && ["pending", "unknown"].includes(request.state))) {
                        throw new BridgeError("write_unknown", "ensurePerson", "unknown");
                    }
                    const people = await freshPeople(settings, "ensurePerson");
                    const candidates = people.filter((person) => person.name === input.name).map((person) => {
                        const resolved = resolveBridgePerson(people, person.docId, "ensurePerson");
                        if (!resolved) throw new BridgeError("identity_unknown", "ensurePerson");
                        return resolved;
                    });
                    if (candidates.length) throw new BridgePersonAmbiguityError(candidates);
                    if (!input.ref) throw new BridgeError("invalid_input", "ensurePerson");
                    entry = { kind: "ensurePerson", ref: input.ref, anchors: anchors(settings), name: input.name,
                        state: "pending", request: deps.newRequest(settings, input.name) };
                    store.requests.push(entry);
                } else if (entry.state === "applied") {
                    const person = resolveBridgePerson(await freshPeople(settings, "ensurePerson"), entry.request.checkpoint.docId!, "ensurePerson");
                    if (!person || person.itemId !== entry.request.checkpoint.itemId || !await reachable(settings, person.docId, "ensurePerson")) throw new BridgeError("identity_unknown", "ensurePerson", "unknown");
                    return { ...person, created: true };
                } else if (["pending", "unknown"].includes(entry.state) && entry.request.checkpoint.state === "new") {
                    entry.request.checkpoint.state = "unknown";
                    entry.request.bindingState = "unknown";
                }
                await persist(store, "ensurePerson", entry.request.checkpoint.state !== "new");
                deps.guard(settings);
                let person: BridgePerson;
                try {
                    person = await deps.create(settings, entry.name, entry.request);
                } catch (error) {
                    const rejected = error instanceof BridgeError && error.writeState === "rejected";
                    entry.state = rejected ? "rejected" : "unknown";
                    await persist(store, "ensurePerson", true);
                    if (error instanceof BridgePersonAmbiguityError) throw error;
                    throw new BridgeError(rejected ? "write_failed" : "write_unknown", "ensurePerson", rejected ? "rejected" : "unknown");
                }
                entry.state = "applied";
                await persist(store, "ensurePerson", true);
                const verified = resolveBridgePerson(await freshPeople(settings, "ensurePerson"), person.docId, "ensurePerson");
                if (!verified || verified.itemId !== person.itemId) throw new BridgeError("identity_unknown", "ensurePerson", "unknown");
                return { ...bridgePerson(verified), created: true };
            });
        },
        async recordInteraction(personDocIds: readonly string[], meta?: BridgeInteractionMeta) {
            const input = normalizeBridgeInteraction(personDocIds, meta);
            const settings = settingsFor("recordInteraction");
            if (!input.ids.length) return summarizeBridgeInteraction([], 0);
            return locked("recordInteraction", async () => {
                deps.guard(settings);
                const store = await readRequests("recordInteraction");
                let entry = store.requests.find((request): request is BridgeInteractionRequest => request.kind === "recordInteraction" && request.ref === input.ref);
                if (entry && meta?.date === undefined) {
                    input.date = entry.date;
                    input.occurredAt = birthdayToMs(entry.date)!;
                }
                if (entry && (!sameAnchors(entry.anchors, settings) || entry.date !== input.date || entry.note !== input.note
                    || JSON.stringify(entry.docIds) !== JSON.stringify(input.docIds))) throw new BridgeError("idempotency_conflict", "recordInteraction");
                if (!entry) {
                    entry = { kind: "recordInteraction", ref: input.ref, anchors: anchors(settings), docIds: input.docIds,
                        date: input.date, note: input.note, items: input.docIds.map((docId) => ({ docId, state: "unissued" })) };
                    store.requests.push(entry);
                }
                const results: BridgeItemResult[] = [];
                const seen = new Set<string>();
                let recorded = 0;
                let storageStopped = false;
                for (const [index, value] of input.ids.entries()) {
                    if (!isBridgeId(value)) {
                        results.push({ index, status: "failed", code: "invalid_input", writeState: "not_sent" });
                        continue;
                    }
                    if (seen.has(value)) {
                        results.push({ index, docId: value, status: "skipped", code: "duplicate_input", writeState: "not_sent" });
                        continue;
                    }
                    seen.add(value);
                    const item = entry.items.find((candidate) => candidate.docId === value)!;
                    const previouslyIssued = ["pending", "unknown", "applied", "skipped"].includes(item.state);
                    const result: BridgeItemResult = { index, docId: value, status: "unknown", writeState: previouslyIssued ? "unknown" : "not_sent" };
                    results.push(result);
                    if (storageStopped) { result.code = "storage_unknown"; continue; }
                    let issued = false;
                    let wasRecorded = false;
                    try {
                        const person = resolveBridgePerson(await freshPeople(settings, "recordInteraction"), value, "recordInteraction");
                        if (!person || !await reachable(settings, value, "recordInteraction")) throw new BridgeError("person_not_found", "recordInteraction");
                        if (item.itemId && item.itemId !== person.itemId) throw new BridgeError("identity_unknown", "recordInteraction",
                            item.state === "unissued" || item.state === "failed" ? "not_sent" : "unknown");
                        result.itemId = person.itemId;
                        const previous = await deps.event(value, entry.ref);
                        deps.guard(settings);
                        if (previous) {
                            if (previous.date !== entry.date || previous.note !== entry.note) throw new BridgeError("idempotency_conflict", "recordInteraction");
                            item.itemId = person.itemId;
                            item.state = "skipped";
                            result.status = "skipped";
                            result.code = "already_recorded";
                            result.writeState = "verified";
                        } else if (["pending", "unknown", "applied", "skipped"].includes(item.state)) {
                            result.code = "write_unknown";
                            result.writeState = "unknown";
                        } else {
                            item.itemId = person.itemId;
                            item.state = "pending";
                            await persist(store, "recordInteraction");
                            deps.guard(settings);
                            issued = true;
                            const outcome = await deps.record(value, entry.ref, input.occurredAt, entry.note);
                            const evidence = await deps.event(value, entry.ref);
                            deps.guard(settings);
                            if (!evidence || evidence.date !== entry.date || evidence.note !== entry.note) throw new BridgeError("write_unknown", "recordInteraction", "unknown");
                            item.state = outcome.recorded ? "applied" : "skipped";
                            result.status = item.state;
                            result.writeState = "verified";
                            if (!outcome.recorded) result.code = "already_recorded";
                            wasRecorded = outcome.recorded;
                        }
                        await persist(store, "recordInteraction", issued || result.writeState === "verified" || result.writeState === "unknown");
                        if (wasRecorded) recorded += 1;
                    } catch (error) {
                        const known = error instanceof BridgeError ? error : undefined;
                        result.code = known?.code ?? (issued ? "write_unknown" : "unavailable");
                        result.writeState = (issued || previouslyIssued) && known?.writeState !== "rejected" ? "unknown" : known?.writeState ?? "not_sent";
                        result.status = result.writeState === "unknown" || ["unavailable", "identity_unknown", "storage_unknown", "configuration_changed", "disposed"].includes(result.code) ? "unknown" : "failed";
                        if (result.code === "storage_unknown") { storageStopped = true; continue; }
                        if (issued) {
                            item.state = result.writeState === "rejected" ? "failed" : "unknown";
                            try { await persist(store, "recordInteraction", true); }
                            catch { result.code = "storage_unknown"; storageStopped = true; }
                        }
                    }
                }
                return summarizeBridgeInteraction(results, recorded);
            });
        },
    });
}
