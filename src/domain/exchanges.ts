import { parseStoreRecords } from "./store-integrity.ts";

export type ExchangeKind = "money" | "item" | "favor";
export type ExchangeDirection = "receivable" | "payable";
export type ExchangeStatus = "open" | "settled" | "cancelled";

export interface ExchangeRecord {
    id: string;
    personDocId: string;
    kind: ExchangeKind;
    direction: ExchangeDirection;
    description: string;
    amount?: number;
    currency: string;
    occurredOn: string;
    dueOn: string;
    status: ExchangeStatus;
    settledOn: string;
    note: string;
    createdAt: number;
    updatedAt: number;
}

export interface ExchangeStore {
    schemaVersion: 1;
    records: ExchangeRecord[];
}

export class ExchangeWriteUnknownError extends Error {
    readonly requestId: string;

    constructor(requestId: string, cause: unknown) {
        super(`往来保存结果未知（请求 ${requestId}），可能已保存；请保留本次输入，核实并重试，勿重复新建`, { cause });
        this.name = "ExchangeWriteUnknownError";
        this.requestId = requestId;
    }
}

export type ExchangePatch = Partial<Pick<ExchangeRecord,
    "kind" | "direction" | "description" | "amount" | "currency" | "occurredOn" | "dueOn" | "status" | "settledOn" | "note"
>>;

const ID_PATTERN = /^\d{14}-[0-9a-z]{7}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isValidExchangeDate(value: string): boolean {
    if (!DATE_PATTERN.test(value)) return false;
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(year, month - 1, day);
    return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

function validOptionalDate(value: unknown): value is string {
    return typeof value === "string" && (value === "" || isValidExchangeDate(value));
}

function parseRecord(raw: unknown): ExchangeRecord | null {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
    const record = raw as Partial<ExchangeRecord>;
    const id = record.id;
    const personDocId = record.personDocId;
    if (typeof id !== "string" || typeof personDocId !== "string" || !ID_PATTERN.test(id) || !ID_PATTERN.test(personDocId)) return null;
    if (record.kind !== "money" && record.kind !== "item" && record.kind !== "favor") return null;
    if (record.direction !== "receivable" && record.direction !== "payable") return null;
    if (record.status !== "open" && record.status !== "settled" && record.status !== "cancelled") return null;
    if (typeof record.description !== "string" || !record.description.trim()) return null;
    if (typeof record.currency !== "string" || typeof record.occurredOn !== "string" || !isValidExchangeDate(record.occurredOn)) return null;
    if (!validOptionalDate(record.dueOn) || !validOptionalDate(record.settledOn)) return null;
    if (typeof record.note !== "string" || typeof record.createdAt !== "number" || typeof record.updatedAt !== "number") return null;
    if (!Number.isFinite(record.createdAt) || !Number.isFinite(record.updatedAt)) return null;
    if (record.amount !== undefined && (typeof record.amount !== "number" || !Number.isFinite(record.amount) || record.amount <= 0)) return null;
    if (record.kind === "money" && record.amount === undefined) return null;
    if (record.kind !== "money" && record.amount !== undefined) return null;
    if (record.status === "settled" && !record.settledOn) return null;
    if (record.status !== "settled" && record.settledOn) return null;
    return {
        id,
        personDocId,
        kind: record.kind,
        direction: record.direction,
        description: record.description.trim(),
        ...(record.amount === undefined ? {} : { amount: record.amount }),
        currency: record.currency.trim(),
        occurredOn: record.occurredOn,
        dueOn: record.dueOn ?? "",
        status: record.status,
        settledOn: record.settledOn ?? "",
        note: record.note.trim(),
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
    };
}

export function emptyExchangeStore(): ExchangeStore {
    return { schemaVersion: 1, records: [] };
}

export function normalizeExchangeStore(raw: unknown): ExchangeStore {
    if (raw === null || typeof raw !== "object") return emptyExchangeStore();
    const record = raw as Partial<ExchangeStore>;
    if (record.schemaVersion !== 1 || !Array.isArray(record.records)) return emptyExchangeStore();
    const seen = new Set<string>();
    const records: ExchangeRecord[] = [];
    for (const item of record.records) {
        const parsed = parseRecord(item);
        if (!parsed || seen.has(parsed.id)) continue;
        seen.add(parsed.id);
        records.push(parsed);
    }
    return { schemaVersion: 1, records };
}

export function normalizeExchangeStoreForWrite(raw: unknown): ExchangeStore {
    return parseExchangeStore(raw);
}

export function parseExchangeStore(raw: unknown): ExchangeStore {
    return { schemaVersion: 1, records: parseStoreRecords(raw, "往来账本", "records", parseRecord) };
}

export function validateExchangeInput(input: {
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
}): string[] {
    const errors: string[] = [];
    if (!ID_PATTERN.test(input.personDocId)) errors.push("人物文档 ID 无效");
    if (!input.description.trim()) errors.push("往来内容不能为空");
    if (!isValidExchangeDate(input.occurredOn)) errors.push("发生日期无效");
    if (input.dueOn && !isValidExchangeDate(input.dueOn)) errors.push("到期日期无效");
    if (input.settledOn && !isValidExchangeDate(input.settledOn)) errors.push("结清日期无效");
    if (input.kind === "money" && (input.amount === undefined || !Number.isFinite(input.amount) || input.amount <= 0)) {
        errors.push("金钱往来金额必须为正数");
    }
    if (input.kind !== "money" && input.amount !== undefined) errors.push("物品或人情往来不应填写金额");
    const status = input.status ?? "open";
    if (status === "settled" && !input.settledOn) errors.push("已结清往来需要结清日期");
    if (status !== "settled" && input.settledOn) errors.push("未结清往来不能填写结清日期");
    return errors;
}

export function appendExchange(store: ExchangeStore, record: ExchangeRecord): ExchangeStore {
    if (store.records.some((item) => item.id === record.id)) return store;
    return { ...store, records: [...store.records, record] };
}

export function matchesExchangeRequest(record: ExchangeRecord, input: Parameters<typeof validateExchangeInput>[0]): boolean {
    return record.personDocId === input.personDocId && record.kind === input.kind && record.direction === input.direction
        && record.description === input.description.trim() && record.amount === input.amount
        && record.currency === (input.currency?.trim() || "CNY") && record.occurredOn === input.occurredOn
        && record.dueOn === (input.dueOn?.trim() ?? "") && record.note === (input.note?.trim() ?? "");
}

export function updateExchange(store: ExchangeStore, id: string, patch: ExchangePatch, updatedAt?: number): ExchangeStore | null {
    const index = store.records.findIndex((record) => record.id === id);
    if (index < 0) return null;
    const current = store.records[index];
    const candidate = { ...current, ...patch, updatedAt: updatedAt ?? current.updatedAt };
    const errors = validateExchangeInput(candidate);
    if (errors.length > 0) return null;
    const parsed = parseRecord(candidate);
    if (!parsed) return null;
    const records = [...store.records];
    records[index] = parsed;
    return { ...store, records };
}

export function listExchangesForPerson(store: ExchangeStore, personDocId: string): ExchangeRecord[] {
    return store.records
        .filter((record) => record.personDocId === personDocId)
        .sort((left, right) => right.occurredOn.localeCompare(left.occurredOn) || right.updatedAt - left.updatedAt);
}
