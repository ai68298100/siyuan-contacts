import { defaultBridgeRef, toLocalDateKey, normalizeInteractionStoreForWrite } from "./interactions.ts";
import { birthdayToMs } from "./person.ts";
import { validateDocumentTitle } from "./format.ts";
import type { VcfDocumentCheckpoint } from "./vcard.ts";

export const BRIDGE_PROTOCOL = 2;
export const BRIDGE_CAPABILITIES = Object.freeze(["searchPeople", "getPerson", "ensurePerson", "recordInteraction"] as const);
export const BRIDGE_STORAGE_KEY = "bridge-requests.json";

export interface BridgePerson {
    docId: string;
    itemId: string;
    name: string;
    group: string;
    tags: string[];
}

export type BridgeOperation = typeof BRIDGE_CAPABILITIES[number];
export type BridgeWriteState = "not_sent" | "rejected" | "unknown" | "verified";
export type BridgeErrorCode = "invalid_input" | "not_initialized" | "unavailable" | "disposed"
    | "configuration_changed" | "person_ambiguous" | "person_not_found" | "identity_unknown"
    | "idempotency_conflict" | "storage_unknown" | "write_failed" | "write_unknown";

const messages: Record<BridgeErrorCode, string> = {
    invalid_input: "桥接参数不符合协议，未发送业务写入",
    not_initialized: "人脉工作空间尚未初始化",
    unavailable: "人脉来源暂不可读，请重新核实",
    disposed: "人员服务桥已卸载，请重新获取当前桥",
    configuration_changed: "人脉锚点已变化，原请求未迁移到新目标",
    person_ambiguous: "姓名只提供候选，请选择稳定 docId 后调用 getPerson 或 ensurePerson",
    person_not_found: "目标文档未登记为唯一联系人，未写入",
    identity_unknown: "人物或绑定行身份尚未核实，未自动选择",
    idempotency_conflict: "幂等键已用于不同输入或目标，未覆盖原请求",
    storage_unknown: "桥请求存储尚未核实，请保留同一请求并重新读取",
    write_failed: "业务写入已明确拒绝，可保留同一请求重试",
    write_unknown: "业务写入结果未知，只能先核实原请求",
};

export class BridgeError extends Error {
    readonly code: BridgeErrorCode;
    readonly writeState: BridgeWriteState;
    readonly diagnostic: Readonly<{ operation: BridgeOperation; code: BridgeErrorCode; writeState: BridgeWriteState }>;
    readonly retry: "same_request" | "read_only" | "select_doc_id" | "none";

    constructor(
        code: BridgeErrorCode,
        operation: BridgeOperation,
        writeState: BridgeWriteState = "not_sent",
    ) {
        super(messages[code]);
        this.name = "BridgeError";
        this.code = code;
        this.writeState = writeState;
        this.diagnostic = Object.freeze({ operation, code, writeState });
        this.retry = code === "person_ambiguous" ? "select_doc_id"
            : writeState === "unknown" ? "read_only"
            : code === "write_failed" || code === "unavailable" || code === "storage_unknown" ? "same_request" : "none";
    }
}

export class BridgePersonAmbiguityError extends BridgeError {
    readonly candidates: BridgePerson[];
    readonly unboundCandidates: Array<{ docId: string; name: string }>;
    constructor(candidates: BridgePerson[], unboundCandidates: Array<{ docId: string; name: string }> = []) {
        super("person_ambiguous", "ensurePerson");
        this.name = "BridgePersonAmbiguityError";
        this.candidates = candidates;
        this.unboundCandidates = unboundCandidates;
    }
}

export interface BridgeEnsureOptions {
    ref?: string;
    docId?: string;
}

export interface BridgeInteractionMeta {
    ref?: string;
    date?: string;
    place?: string;
    note?: string;
}

export interface BridgeInteractionInput {
    ids: unknown[];
    docIds: string[];
    ref: string;
    date: string;
    occurredAt: number;
    note: string;
}

export type BridgeItemStatus = "applied" | "skipped" | "failed" | "unknown";
export interface BridgeItemResult {
    index: number;
    docId?: string;
    itemId?: string;
    status: BridgeItemStatus;
    code?: BridgeErrorCode | "duplicate_input" | "already_recorded";
    writeState: BridgeWriteState;
}

export interface BridgeInteractionResult {
    recorded: number;
    applied: number;
    skipped: number;
    failed: number;
    unknown: number;
    complete: boolean;
    results: BridgeItemResult[];
}

export interface BridgeAnchors {
    notebookId: string;
    avId: string;
    dbBlockId: string;
}

export interface BridgeCreateRequest {
    checkpoint: VcfDocumentCheckpoint;
    bindingState: "new" | "unknown" | "rejected" | "verified";
}

export interface BridgeEnsureRequest {
    kind: "ensurePerson";
    ref: string;
    anchors: BridgeAnchors;
    name: string;
    state: "pending" | "applied" | "rejected" | "unknown";
    request: BridgeCreateRequest;
}

export interface BridgeInteractionRequest {
    kind: "recordInteraction";
    ref: string;
    anchors: BridgeAnchors;
    docIds: string[];
    date: string;
    note: string;
    items: Array<{ docId: string; itemId?: string; state: "unissued" | "pending" | BridgeItemStatus }>;
}

export interface BridgeRequestStore {
    schemaVersion: 1;
    requests: Array<BridgeEnsureRequest | BridgeInteractionRequest>;
}

export function isBridgeId(value: unknown): value is string {
    return typeof value === "string" && /^\d{14}-[0-9a-z]{7}$/.test(value);
}

function record(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function textInput(value: unknown, maxLength: number, operation: BridgeOperation, allowEmpty = true): string {
    if (typeof value !== "string" || value.length > maxLength || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)
        || !allowEmpty && !value.trim()) throw new BridgeError("invalid_input", operation);
    return value.trim();
}

function optionsInput(value: unknown, keys: readonly string[], operation: BridgeOperation): Record<string, unknown> {
    if (value === undefined) return {};
    if (!record(value) || Object.keys(value).some((key) => !keys.includes(key))) throw new BridgeError("invalid_input", operation);
    return value;
}

export function normalizeBridgeEnsure(name: unknown, options?: unknown): { name: string; ref?: string; docId?: string } {
    const operation = "ensurePerson";
    const trimmed = textInput(name, 512, operation, false);
    if (validateDocumentTitle(trimmed)) throw new BridgeError("invalid_input", operation);
    const value = optionsInput(options, ["ref", "docId"], operation);
    if (value.docId !== undefined && !isBridgeId(value.docId)) throw new BridgeError("invalid_input", operation);
    const ref = value.ref === undefined ? undefined : textInput(value.ref, 512, operation, false);
    if (ref !== undefined && value.docId !== undefined) throw new BridgeError("invalid_input", operation);
    return { name: trimmed, ...(ref === undefined ? {} : { ref }), ...(value.docId === undefined ? {} : { docId: value.docId as string }) };
}

export function normalizeBridgeInteraction(ids: unknown, meta?: unknown, now = new Date()): BridgeInteractionInput {
    const operation = "recordInteraction";
    if (!Array.isArray(ids) || ids.length > 200) throw new BridgeError("invalid_input", operation);
    const value = optionsInput(meta, ["ref", "date", "place", "note"], operation);
    const date = value.date === undefined ? toLocalDateKey(now) : textInput(value.date, 10, operation, false);
    const occurredAt = birthdayToMs(date);
    if (occurredAt === null) throw new BridgeError("invalid_input", operation);
    const place = value.place === undefined ? "" : textInput(value.place, 512, operation);
    const note = value.note === undefined ? "" : textInput(value.note, 4096, operation);
    const docIds = [...new Set(ids.filter(isBridgeId))].sort();
    const ref = value.ref === undefined ? defaultBridgeRef(docIds, date) : textInput(value.ref, 512, operation, false);
    return { ids: [...ids], docIds, ref, date, occurredAt, note: [place ? `@${place}` : "", note].filter(Boolean).join(" ") };
}

export function bridgeKeyword(value: unknown): string {
    return textInput(value === undefined ? "" : value, 512, "searchPeople");
}

export function bridgePerson(person: BridgePerson): BridgePerson {
    return { docId: person.docId, itemId: person.itemId, name: person.name, group: person.group, tags: [...person.tags] };
}

export function resolveBridgePerson(people: readonly BridgePerson[], docId: string, operation: BridgeOperation): BridgePerson | null {
    const matches = people.filter((person) => person.docId === docId);
    if (!matches.length) return null;
    const person = matches[0];
    if (matches.length !== 1 || !isBridgeId(person.docId) || !isBridgeId(person.itemId) || person.docId === person.itemId
        || people.filter((candidate) => candidate.itemId === person.itemId).length !== 1) {
        throw new BridgeError("identity_unknown", operation);
    }
    return bridgePerson(person);
}

export function summarizeBridgeInteraction(results: BridgeItemResult[], recorded: number): BridgeInteractionResult {
    const count = (status: BridgeItemStatus) => results.filter((result) => result.status === status).length;
    return { recorded, applied: count("applied"), skipped: count("skipped"), failed: count("failed"), unknown: count("unknown"),
        complete: results.every((result) => result.status === "applied" || result.status === "skipped"), results };
}

export function bridgeEventEvidence(raw: unknown, docId: string, ref: string): { date: string; note: string } | null {
    const store = normalizeInteractionStoreForWrite(raw);
    if (record(raw) && Array.isArray(raw.events)) {
        const matches = raw.events.filter((event) => record(event) && event.personDocId === docId && event.source === "api"
            && event.externalRef === ref && !store.tombstones.includes(String(event.id)));
        if (matches.length > 1) throw new BridgeError("storage_unknown", "recordInteraction");
    }
    const event = store.events.find((event) => event.personDocId === docId && event.source === "api" && event.externalRef === ref);
    return event ? { date: event.localDate, note: event.note ?? "" } : null;
}

export function normalizeBridgeRequestStore(raw: unknown): BridgeRequestStore {
    if (raw === null || raw === undefined || raw === "") return { schemaVersion: 1, requests: [] };
    const fail = (): never => { throw new BridgeError("storage_unknown", "recordInteraction"); };
    if (!record(raw) || raw.schemaVersion !== 1 || !Array.isArray(raw.requests)) return fail();
    const seen = new Set<string>();
    for (const request of raw.requests) {
        if (!record(request) || !["ensurePerson", "recordInteraction"].includes(String(request.kind))
            || typeof request.ref !== "string" || !request.ref.trim() || !record(request.anchors)
            || !isBridgeId(request.anchors.notebookId) || !isBridgeId(request.anchors.avId) || !isBridgeId(request.anchors.dbBlockId)) return fail();
        const key = JSON.stringify([request.kind, request.ref]);
        if (seen.has(key)) return fail();
        seen.add(key);
        if (request.kind === "ensurePerson") {
            if (typeof request.name !== "string" || validateDocumentTitle(request.name)
                || !["pending", "applied", "rejected", "unknown"].includes(String(request.state))
                || !record(request.request) || !record(request.request.checkpoint)) return fail();
            const checkpoint = request.request.checkpoint;
            if (!isBridgeId(checkpoint.requestId) || checkpoint.name !== request.name || typeof checkpoint.path !== "string"
                || checkpoint.draftKey !== "[]" || !["new", "unknown", "rejected", "verified"].includes(String(checkpoint.state))
                || !["new", "unknown", "rejected", "verified"].includes(String(request.request.bindingState))
                || checkpoint.docId !== undefined && !isBridgeId(checkpoint.docId)
                || checkpoint.itemId !== undefined && !isBridgeId(checkpoint.itemId)
                || checkpoint.notebookId !== request.anchors.notebookId || checkpoint.avId !== request.anchors.avId
                || checkpoint.dbBlockId !== request.anchors.dbBlockId
                || checkpoint.state === "verified" && !isBridgeId(checkpoint.docId)
                || request.request.bindingState === "verified" && !isBridgeId(checkpoint.itemId)
                || request.state === "applied" && (checkpoint.state !== "verified" || request.request.bindingState !== "verified")) return fail();
        } else {
            const docIds = Array.isArray(request.docIds) ? request.docIds : fail();
            if (!docIds.every(isBridgeId)
                || new Set(docIds).size !== docIds.length
                || docIds.some((docId, index) => index > 0 && docId <= docIds[index - 1])
                || typeof request.date !== "string" || birthdayToMs(request.date) === null || typeof request.note !== "string"
                || !Array.isArray(request.items) || request.items.length !== docIds.length) return fail();
            for (const [index, item] of request.items.entries()) {
                if (!record(item) || item.docId !== docIds[index]
                    || !["unissued", "pending", "applied", "skipped", "failed", "unknown"].includes(String(item.state))
                    || item.itemId !== undefined && !isBridgeId(item.itemId)
                    || ["pending", "applied", "skipped", "unknown"].includes(String(item.state)) && !isBridgeId(item.itemId)) return fail();
            }
        }
    }
    return structuredClone(raw) as unknown as BridgeRequestStore;
}
