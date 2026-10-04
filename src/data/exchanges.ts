import type { Plugin } from "siyuan";
import {
    appendExchange,
    emptyExchangeStore,
    ExchangeWriteUnknownError,
    listExchangesForPerson,
    matchesExchangeRequest,
    parseExchangeStore,
    normalizeExchangeStoreForWrite,
    updateExchange,
    validateExchangeInput,
} from "../domain/exchanges";
import type {
    ExchangeDirection,
    ExchangeKind,
    ExchangePatch,
    ExchangeRecord,
    ExchangeStatus,
    ExchangeStore,
} from "../domain/exchanges";
import { loadJsonStrict, saveJsonVerified, withStoreLock } from "./storage";
import { mergeExchangeBackup, MigrationWriteUnknownError } from "../domain/migration-records";
import type { MigrationRecordSummary } from "../domain/migration-records";

export const EXCHANGE_STORAGE_KEY = "exchange-records.json";

export async function loadExchangeStore(plugin: Plugin): Promise<ExchangeStore> {
    return parseExchangeStore(await loadJsonStrict(plugin, EXCHANGE_STORAGE_KEY));
}

export interface CreateExchangeInput {
    requestId: string;
    personDocId: string;
    kind: ExchangeKind;
    direction: ExchangeDirection;
    description: string;
    amount?: number;
    currency?: string;
    occurredOn: string;
    dueOn?: string;
    status?: ExchangeStatus;
    settledOn?: string;
    note?: string;
}

export async function createExchangeRecord(plugin: Plugin, input: CreateExchangeInput): Promise<ExchangeRecord> {
    if (typeof input.requestId !== "string" || !/^\d{14}-[0-9a-z]{7}$/.test(input.requestId)) throw new Error("往来保存请求 ID 无效，未做任何写入");
    const status = input.status ?? "open";
    const settledOn = input.settledOn ?? "";
    const errors = validateExchangeInput({ ...input, status, settledOn });
    if (errors.length > 0) throw new Error(errors.join("；"));
    return withStoreLock(EXCHANGE_STORAGE_KEY, async () => {
        const store = normalizeExchangeStoreForWrite(await loadJsonStrict(plugin, EXCHANGE_STORAGE_KEY));
        const existing = store.records.find((record) => record.id === input.requestId);
        if (existing) {
            if (!matchesExchangeRequest(existing, input)) throw new Error("同一往来保存请求已存在不同内容，请核对已有记录；未修改原事实");
            return existing;
        }
        const now = Date.now();
        const record: ExchangeRecord = {
            id: input.requestId,
            personDocId: input.personDocId,
            kind: input.kind,
            direction: input.direction,
            description: input.description.trim(),
            ...(input.amount === undefined ? {} : { amount: input.amount }),
            currency: input.currency?.trim() || "CNY",
            occurredOn: input.occurredOn,
            dueOn: input.dueOn?.trim() ?? "",
            status,
            settledOn,
            note: input.note?.trim() ?? "",
            createdAt: now,
            updatedAt: now,
        };
        const next = appendExchange(store, record);
        try {
            await saveJsonVerified(plugin, EXCHANGE_STORAGE_KEY, next);
        } catch (error) {
            throw new ExchangeWriteUnknownError(input.requestId, error);
        }
        return record;
    });
}

export async function listPersonExchangeRecords(plugin: Plugin, personDocId: string): Promise<ExchangeRecord[]> {
    return listExchangesForPerson(await loadExchangeStore(plugin), personDocId);
}

export async function updateExchangeRecord(plugin: Plugin, id: string, patch: ExchangePatch): Promise<ExchangeRecord> {
    return withStoreLock(EXCHANGE_STORAGE_KEY, async () => {
        const store = normalizeExchangeStoreForWrite(await loadJsonStrict(plugin, EXCHANGE_STORAGE_KEY));
        const current = store.records.find((record) => record.id === id);
        if (!current) throw new Error("往来记录不存在");
        const next = updateExchange(store, id, patch, Date.now());
        if (!next) throw new Error("往来记录更新内容无效");
        await saveJsonVerified(plugin, EXCHANGE_STORAGE_KEY, next);
        return next.records.find((record) => record.id === id) ?? current;
    });
}

export async function setExchangeStatus(plugin: Plugin, id: string, status: ExchangeStatus, settledOn: string = ""): Promise<ExchangeRecord> {
    return updateExchangeRecord(plugin, id, {
        status,
        settledOn: status === "settled" ? settledOn : "",
    });
}

export { emptyExchangeStore };

export async function mergeExchangeStore(plugin: Plugin, incoming: ExchangeStore, reachable: ReadonlySet<string>): Promise<MigrationRecordSummary> {
    const checked = parseExchangeStore(incoming);
    return withStoreLock(EXCHANGE_STORAGE_KEY, async () => {
        const current = await loadExchangeStore(plugin);
        const result = mergeExchangeBackup(current, checked, reachable);
        if (JSON.stringify(current) !== JSON.stringify(result.store)) {
            try {
                await saveJsonVerified(plugin, EXCHANGE_STORAGE_KEY, result.store);
            } catch (error) {
                throw new MigrationWriteUnknownError(error);
            }
        }
        return result.summary;
    });
}
