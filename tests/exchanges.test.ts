import { test } from "node:test";
import assert from "node:assert/strict";
import {
    appendExchange,
    emptyExchangeStore,
    listExchangesForPerson,
    normalizeExchangeStore,
    normalizeExchangeStoreForWrite,
    parseExchangeStore,
    updateExchange,
    validateExchangeInput,
} from "../src/domain/exchanges.ts";
import type { ExchangeRecord } from "../src/domain/exchanges.ts";
import { mergeExchangeBackup } from "../src/domain/migration-records.ts";

const PERSON = "20261002000000-per0001";
const OTHER_PERSON = "20261002000000-per0002";

test("账本迁移：结清和取消完整保留，重复恢复零新增，当前状态及并发记录优先", () => {
    const first = record({ id: "20261002000000-ex00001", status: "settled", settledOn: "2026-10-01" });
    const cancelled = record({ id: "20261002000000-ex00002", status: "cancelled" });
    const incoming = { schemaVersion: 1 as const, records: [first, cancelled] };
    const restored = mergeExchangeBackup(emptyExchangeStore(), incoming, new Set([PERSON]));
    assert.deepEqual(restored.store, incoming);
    const concurrent = record({ id: "20261002000000-ex00003" });
    const current = { ...restored.store, records: [...restored.store.records, concurrent] };
    const retry = mergeExchangeBackup(current, incoming, new Set([PERSON]));
    assert.equal(retry.summary.merged, 0);
    assert.equal(retry.summary.skipped, 2);
    assert.deepEqual(retry.store, current);
    const stale = { ...incoming, records: [record({ id: first.id }), { ...cancelled, personDocId: OTHER_PERSON }] };
    const conflict = mergeExchangeBackup(current, stale, new Set([PERSON, OTHER_PERSON]));
    assert.deepEqual(conflict.store, current);
    assert.deepEqual(conflict.summary.issues.map((entry) => entry.reason), ["conflict", "conflict"]);
});

test("账本迁移：人物不可达按原文档 ID 留待处理，不自动按同名替换", () => {
    const orphan = record({ id: "20261002000000-ex00001" });
    const incoming = { schemaVersion: 1 as const, records: [orphan] };
    const result = mergeExchangeBackup(emptyExchangeStore(), incoming, new Set([OTHER_PERSON]));
    assert.deepEqual(result.store, emptyExchangeStore());
    assert.equal(result.summary.issues[0].id, orphan.id);
    assert.equal(result.summary.issues[0].personDocId, PERSON);
    assert.equal(result.summary.issues[0].reason, "unreachable");
    assert.equal(mergeExchangeBackup(result.store, incoming, new Set([PERSON])).summary.merged, 1);
});

function record(partial: Partial<ExchangeRecord> & Pick<ExchangeRecord, "id">): ExchangeRecord {
    return {
        personDocId: PERSON,
        kind: "money",
        direction: "receivable",
        description: "代垫餐费",
        amount: 120,
        currency: "CNY",
        occurredOn: "2026-09-30",
        dueOn: "",
        status: "open",
        settledOn: "",
        note: "",
        createdAt: 1,
        updatedAt: 1,
        ...partial,
    };
}

test("往来账本：合法记录保留，坏记录读取时过滤，写入时整体拒绝", () => {
    const valid = record({ id: "20261002000000-ex00001" });
    const normalized = normalizeExchangeStore({
        schemaVersion: 1,
        records: [
            valid,
            { ...valid, id: "bad" },
            { ...valid, id: "20261002000000-ex00002", kind: "item", amount: 10 },
            valid,
        ],
    });
    assert.deepEqual(normalized.records.map((item) => item.id), [valid.id]);
    assert.throws(
        () => normalizeExchangeStoreForWrite({ schemaVersion: 1, records: [{ ...valid, status: "settled", settledOn: "" }] }),
        /内容损坏/,
    );
    assert.deepEqual(normalizeExchangeStoreForWrite(null), emptyExchangeStore());
});

test("往来账本：金额、物品、人情的输入规则明确拒绝错误组合", () => {
    assert.deepEqual(validateExchangeInput({
        personDocId: PERSON,
        kind: "money",
        direction: "receivable",
        description: "借款",
        amount: 0,
        occurredOn: "2026-09-30",
    }), ["金钱往来金额必须为正数"]);
    assert.deepEqual(validateExchangeInput({
        personDocId: PERSON,
        kind: "item",
        direction: "payable",
        description: "借出相机",
        amount: 1,
        occurredOn: "2026-09-30",
    }), ["物品或人情往来不应填写金额"]);
    assert.deepEqual(validateExchangeInput({
        personDocId: PERSON,
        kind: "favor",
        direction: "receivable",
        description: "请对方帮忙引荐",
        occurredOn: "2026-09-30",
        status: "settled",
    }), ["已结清往来需要结清日期"]);
    assert.deepEqual(validateExchangeInput({
        personDocId: PERSON,
        kind: "favor",
        direction: "receivable",
        description: "请对方帮忙引荐",
        occurredOn: "2026-09-30",
        settledOn: "2026-09-31",
    }), ["结清日期无效", "未结清往来不能填写结清日期"]);
});

test("往来账本严格读取：首次空库与未知版本、坏条目、重复 ID 分开且诊断不泄露正文", () => {
    for (const missing of [null, undefined, ""]) assert.deepEqual(parseExchangeStore(missing), emptyExchangeStore());
    const first = record({ id: "20261002000000-ex00001", description: "不应显示的私密正文" });
    for (const raw of [[], false, "{}", { schemaVersion: 2, records: [] }, { schemaVersion: 1, records: {} }]) {
        assert.throws(() => parseExchangeStore(raw), /存储内容损坏/);
    }
    for (const bad of [null, { ...first, amount: -1 }, { ...first, occurredOn: "2026-02-30" }, first]) {
        const raw = { schemaVersion: 1, records: [first, bad] };
        const snapshot = JSON.stringify(raw);
        assert.throws(() => parseExchangeStore(raw), (error: Error & { originalCount?: number; entryIndex?: number }) => {
            assert.equal(error.originalCount, 2);
            assert.equal(error.entryIndex, 1);
            assert.equal(error.message.includes(first.description), false);
            return true;
        });
        assert.equal(JSON.stringify(raw), snapshot);
    }
    assert.deepEqual(parseExchangeStore({ schemaVersion: 1, records: [first] }).records, [first]);
});

test("往来账本：追加幂等、按人物排序、更新保持身份并刷新时间", () => {
    const first = record({ id: "20261002000000-ex00001", occurredOn: "2026-09-29" });
    const second = record({ id: "20261002000000-ex00002", personDocId: OTHER_PERSON, occurredOn: "2026-10-01" });
    let store = appendExchange(emptyExchangeStore(), first);
    store = appendExchange(store, first);
    store = appendExchange(store, second);
    assert.equal(store.records.length, 2);
    const next = updateExchange(store, first.id, { description: "代垫晚餐", status: "settled", settledOn: "2026-10-01" }, 99);
    assert.ok(next);
    const updated = next.records.find((item) => item.id === first.id);
    assert.ok(updated);
    assert.equal(updated.description, "代垫晚餐");
    assert.equal(updated.personDocId, PERSON);
    assert.equal(updated.updatedAt, 99);
    assert.deepEqual(listExchangesForPerson(next, PERSON).map((item) => item.id), [first.id]);
    assert.equal(updateExchange(store, "missing", { description: "x" }), null);
});
