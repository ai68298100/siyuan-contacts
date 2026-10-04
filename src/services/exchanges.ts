import type { Plugin } from "siyuan";
import { newNodeId } from "../api/client";
import {
    createExchangeRecord,
    listPersonExchangeRecords,
    setExchangeStatus,
    updateExchangeRecord,
} from "../data/exchanges";
import type {
    ExchangeDirection,
    ExchangeKind,
    ExchangePatch,
    ExchangeRecord,
    ExchangeStatus,
} from "../domain/exchanges";

export type { ExchangeDirection, ExchangeKind, ExchangePatch, ExchangeRecord, ExchangeStatus } from "../domain/exchanges";

const ID_PATTERN = /^\d{14}-[0-9a-z]{7}$/;

export function newExchangeRequestId(): string {
    return newNodeId();
}

function assertPersonDocId(personDocId: string): void {
    if (!ID_PATTERN.test(personDocId)) throw new Error("人物文档 ID 无效");
}

export interface CreatePersonExchangeInput {
    requestId: string;
    personDocId: string;
    kind: ExchangeKind;
    direction: ExchangeDirection;
    description: string;
    amount?: number;
    currency?: string;
    occurredOn: string;
    dueOn?: string;
    note?: string;
}

export async function listPersonExchanges(plugin: Plugin, personDocId: string): Promise<ExchangeRecord[]> {
    assertPersonDocId(personDocId);
    return listPersonExchangeRecords(plugin, personDocId);
}

export async function createPersonExchange(plugin: Plugin, input: CreatePersonExchangeInput): Promise<ExchangeRecord> {
    assertPersonDocId(input.personDocId);
    return createExchangeRecord(plugin, input);
}

export async function updatePersonExchange(plugin: Plugin, id: string, patch: ExchangePatch): Promise<ExchangeRecord> {
    return updateExchangeRecord(plugin, id, patch);
}

export async function changePersonExchangeStatus(
    plugin: Plugin,
    id: string,
    status: ExchangeStatus,
    settledOn?: string,
): Promise<ExchangeRecord> {
    return setExchangeStatus(plugin, id, status, settledOn ?? "");
}
