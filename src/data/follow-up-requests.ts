/** Durable write-ahead checkpoints for follow-up creation requests. */
import type { Plugin } from "siyuan";
import { loadJsonStrict, saveJsonVerified, withStoreLock } from "./storage";
import { isFollowUpRequestId } from "../domain/followups";
import { isValidDateKey } from "../domain/date-key";
import type { FollowUpCreateRequest } from "../domain/followups";

export const FOLLOW_UP_CREATE_REQUESTS_STORAGE_KEY = "follow-up-create-requests.json";

interface FollowUpCreateRequestStore {
    schemaVersion: 1;
    requests: FollowUpCreateRequest[];
}

function decode(raw: unknown): FollowUpCreateRequestStore {
    if (raw === null || raw === "") return { schemaVersion: 1, requests: [] };
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new Error("跟进创建断点格式不正确，操作已停止");
    const store = raw as Partial<FollowUpCreateRequestStore>;
    if (store.schemaVersion !== 1 || !Array.isArray(store.requests)) throw new Error("跟进创建断点版本或结构不兼容，操作已停止");
    const seen = new Set<string>();
    const requests: FollowUpCreateRequest[] = [];
    for (const request of store.requests) {
        if (!request || typeof request !== "object" || Array.isArray(request)
            || !isFollowUpRequestId(request.requestId) || !isFollowUpRequestId(request.personDocId)
            || typeof request.title !== "string" || request.title.length > 500
            || typeof request.dueDate !== "string" || !isValidDateKey(request.dueDate)
            || seen.has(request.requestId)) throw new Error("跟进创建断点损坏，操作已停止；请先检查备份");
        seen.add(request.requestId);
        requests.push({ requestId: request.requestId, personDocId: request.personDocId, title: request.title, dueDate: request.dueDate });
    }
    return { schemaVersion: 1, requests };
}

function sameRequest(a: FollowUpCreateRequest, b: FollowUpCreateRequest): boolean {
    return a.requestId === b.requestId && a.personDocId === b.personDocId && a.title === b.title && a.dueDate === b.dueDate;
}

/** Must be saved before creating the indexed follow-up fact. */
export async function checkpointFollowUpCreate(plugin: Plugin, request: FollowUpCreateRequest): Promise<void> {
    await withStoreLock(FOLLOW_UP_CREATE_REQUESTS_STORAGE_KEY, async () => {
        const store = decode(await loadJsonStrict(plugin, FOLLOW_UP_CREATE_REQUESTS_STORAGE_KEY));
        const existing = store.requests.find((item) => item.requestId === request.requestId);
        if (existing) {
            if (!sameRequest(existing, request)) throw new Error("原跟进创建请求的输入已变化，不能复用原请求 ID");
            return;
        }
        const unresolvedForPerson = store.requests.find((item) => item.personDocId === request.personDocId);
        if (unresolvedForPerson) throw new Error(`该人物有一条结果尚未核实的跟进请求（${unresolvedForPerson.requestId}），请先使用原请求重试`);
        await saveJsonVerified(plugin, FOLLOW_UP_CREATE_REQUESTS_STORAGE_KEY, { ...store, requests: [...store.requests, request] });
    });
}

export async function listPendingFollowUpCreates(plugin: Plugin, personDocId?: string): Promise<FollowUpCreateRequest[]> {
    const store = decode(await loadJsonStrict(plugin, FOLLOW_UP_CREATE_REQUESTS_STORAGE_KEY));
    return store.requests.filter((request) => personDocId === undefined || request.personDocId === personDocId).map((request) => ({ ...request }));
}

export async function clearPendingFollowUpCreate(plugin: Plugin, requestId: string, expected: FollowUpCreateRequest): Promise<void> {
    await withStoreLock(FOLLOW_UP_CREATE_REQUESTS_STORAGE_KEY, async () => {
        const store = decode(await loadJsonStrict(plugin, FOLLOW_UP_CREATE_REQUESTS_STORAGE_KEY));
        const current = store.requests.find((request) => request.requestId === requestId);
        if (!current) return;
        if (!sameRequest(current, expected)) throw new Error("跟进创建断点已变化，未清除其他请求");
        await saveJsonVerified(plugin, FOLLOW_UP_CREATE_REQUESTS_STORAGE_KEY, { ...store, requests: store.requests.filter((request) => request.requestId !== requestId) });
    });
}
