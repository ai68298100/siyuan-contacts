import { test } from "node:test";
import assert from "node:assert/strict";
import { StoreIntegrityError, parseStoreRecords } from "../src/domain/store-integrity.ts";
import { normalizeCadenceMapForWrite } from "../src/domain/cadence.ts";
import { normalizeFollowUpStoreForWrite } from "../src/domain/followups.ts";
import { normalizeRegistryStoreForWrite } from "../src/domain/registry.ts";
import { normalizeDismissalStoreForWrite } from "../src/domain/reminder-dismissals.ts";

const DOC_1 = "20261004000000-per0001";
const DOC_2 = "20261004000000-per0002";
const DOC_3 = "20261004000000-per0003";

test("StoreIntegrityError 结构与定位消息格式化", () => {
    const errWithoutPos = new StoreIntegrityError("测试模块", "版本不兼容");
    assert.equal(errWithoutPos.name, "StoreIntegrityError");
    assert.equal(errWithoutPos.module, "测试模块");
    assert.equal(errWithoutPos.originalCount, undefined);
    assert.equal(errWithoutPos.entryIndex, undefined);
    assert.equal(errWithoutPos.message, "测试模块存储内容损坏：版本不兼容；操作已停止，请先备份并检查原文件，修复后重试");

    const errWithCountOnly = new StoreIntegrityError("测试模块", "条目无效", 5);
    assert.equal(errWithCountOnly.originalCount, 5);
    assert.equal(errWithCountOnly.entryIndex, undefined);
    assert.equal(errWithCountOnly.message, "测试模块存储内容损坏（原始 5 条）：条目无效；操作已停止，请先备份并检查原文件，修复后重试");

    const errWithIndex = new StoreIntegrityError("测试模块", "字段损坏", 10, 2);
    assert.equal(errWithIndex.originalCount, 10);
    assert.equal(errWithIndex.entryIndex, 2);
    assert.equal(errWithIndex.message, "测试模块存储内容损坏（原始 10 条，第 3 条）：字段损坏；操作已停止，请先备份并检查原文件，修复后重试");
});

test("parseStoreRecords 针对空值与非法顶层类型的防御", () => {
    assert.deepEqual(parseStoreRecords(null, "测试", "items", () => null), []);
    assert.deepEqual(parseStoreRecords(undefined, "测试", "items", () => null), []);
    assert.deepEqual(parseStoreRecords("", "测试", "items", () => null), []);

    for (const bad of [123, "string", true, [1, 2, 3]]) {
        assert.throws(
            () => parseStoreRecords(bad, "测试", "items", () => null),
            (err: unknown) => err instanceof StoreIntegrityError && err.message.includes("需要版本化对象"),
        );
    }

    for (const badVer of [undefined, 0, 2, -1, "1", null]) {
        assert.throws(
            () => parseStoreRecords({ schemaVersion: badVer, items: [] }, "测试", "items", () => null),
            (err: unknown) => err instanceof StoreIntegrityError && err.message.includes("版本不兼容"),
        );
    }

    for (const badContainer of [null, undefined, 123, {}, "items"]) {
        assert.throws(
            () => parseStoreRecords({ schemaVersion: 1, items: badContainer }, "测试", "items", () => null),
            (err: unknown) => err instanceof StoreIntegrityError && err.message.includes("条目容器必须为数组"),
        );
    }
});

test("parseStoreRecords 解析有效条目与重复 ID 捕获", () => {
    interface DummyItem {
        id: string;
        val: number;
    }
    const parseDummy = (rec: unknown): DummyItem | null => {
        if (!rec || typeof rec !== "object") return null;
        const candidate = rec as Record<string, unknown>;
        if (typeof candidate.id !== "string" || typeof candidate.val !== "number") return null;
        return { id: candidate.id, val: candidate.val };
    };

    const validRaw = {
        schemaVersion: 1,
        items: [
            { id: "a", val: 1 },
            { id: "b", val: 2 },
        ],
    };
    const parsed = parseStoreRecords(validRaw, "假模块", "items", parseDummy);
    assert.deepEqual(parsed, [
        { id: "a", val: 1 },
        { id: "b", val: 2 },
    ]);

    const corruptRaw = {
        schemaVersion: 1,
        items: [
            { id: "a", val: 1 },
            { id: "b", val: "bad-val" },
        ],
    };
    assert.throws(
        () => parseStoreRecords(corruptRaw, "假模块", "items", parseDummy),
        (err: unknown) => {
            assert.ok(err instanceof StoreIntegrityError);
            assert.equal(err.originalCount, 2);
            assert.equal(err.entryIndex, 1);
            assert.ok(err.message.includes("原始 2 条，第 2 条"));
            return true;
        },
    );

    const dupRaw = {
        schemaVersion: 1,
        items: [
            { id: "a", val: 1 },
            { id: "b", val: 2 },
            { id: "a", val: 3 },
        ],
    };
    assert.throws(
        () => parseStoreRecords(dupRaw, "假模块", "items", parseDummy),
        (err: unknown) => {
            assert.ok(err instanceof StoreIntegrityError);
            assert.equal(err.originalCount, 3);
            assert.equal(err.entryIndex, 2);
            assert.ok(err.message.includes("记录 ID 重复"));
            return true;
        },
    );
});

test("联系节奏 normalizeCadenceMapForWrite 严格错误捕获与定位", () => {
    assert.throws(
        () => normalizeCadenceMapForWrite({ schemaVersion: 2, cadences: {} }),
        (err: unknown) => err instanceof StoreIntegrityError && err.message.includes("版本不兼容"),
    );

    assert.throws(
        () => normalizeCadenceMapForWrite({ schemaVersion: 1, cadences: null }),
        (err: unknown) => err instanceof StoreIntegrityError && err.message.includes("条目容器必须为对象映射"),
    );

    assert.throws(
        () => normalizeCadenceMapForWrite({
            schemaVersion: 1,
            cadences: {
                [DOC_1]: { days: 7 },
                "bad-doc-id": { days: 14 },
            },
        }),
        (err: unknown) => {
            assert.ok(err instanceof StoreIntegrityError);
            assert.equal(err.originalCount, 2);
            assert.equal(err.entryIndex, 1);
            assert.ok(err.message.includes("人物文档 ID 无效"));
            return true;
        },
    );

    assert.throws(
        () => normalizeCadenceMapForWrite({
            schemaVersion: 1,
            cadences: {
                [DOC_1]: { days: "invalid-days" },
            },
        }),
        (err: unknown) => {
            assert.ok(err instanceof StoreIntegrityError);
            assert.equal(err.originalCount, 1);
            assert.equal(err.entryIndex, 0);
            assert.ok(err.message.includes("条目字段无效"));
            return true;
        },
    );
});

test("跟进事项 normalizeFollowUpStoreForWrite 严格条目校验与去重", () => {
    assert.throws(
        () => normalizeFollowUpStoreForWrite([1, 2, 3]),
        (err: unknown) => err instanceof StoreIntegrityError && err.message.includes("需要版本化对象"),
    );

    assert.throws(
        () => normalizeFollowUpStoreForWrite({ schemaVersion: 1, items: "not-array" }),
        (err: unknown) => err instanceof StoreIntegrityError && err.message.includes("条目容器必须为数组"),
    );

    const corruptItemStore = {
        schemaVersion: 1,
        items: [
            {
                id: "20261004000000-fl00001",
                personDocId: DOC_1,
                title: "跟进",
                dueDate: "2026-10-10",
                status: "open",
                createdAt: 1760000000000,
                updatedAt: 1760000000000,
            },
            {
                id: "20261004000000-fl00002",
                personDocId: DOC_2,
                title: "跟进2",
                dueDate: "bad-date-format",
                status: "open",
                createdAt: 1760000000000,
                updatedAt: 1760000000000,
            },
        ],
    };
    assert.throws(
        () => normalizeFollowUpStoreForWrite(corruptItemStore),
        (err: unknown) => {
            assert.ok(err instanceof StoreIntegrityError);
            assert.equal(err.originalCount, 2);
            assert.equal(err.entryIndex, 1);
            assert.ok(err.message.includes("条目字段或业务规则无效"));
            return true;
        },
    );

    const dupItemStore = {
        schemaVersion: 1,
        items: [
            {
                id: "20261004000000-fl00001",
                personDocId: DOC_1,
                title: "跟进1",
                dueDate: "2026-10-10",
                status: "open",
                createdAt: 1760000000000,
                updatedAt: 1760000000000,
            },
            {
                id: "20261004000000-fl00001",
                personDocId: DOC_2,
                title: "跟进2",
                dueDate: "2026-10-12",
                status: "open",
                createdAt: 1760000000000,
                updatedAt: 1760000000000,
            },
        ],
    };
    assert.throws(
        () => normalizeFollowUpStoreForWrite(dupItemStore),
        (err: unknown) => {
            assert.ok(err instanceof StoreIntegrityError);
            assert.equal(err.originalCount, 2);
            assert.equal(err.entryIndex, 1);
            assert.ok(err.message.includes("存在重复 ID"));
            return true;
        },
    );
});

test("收编时间索引与提醒暂缓 normalize*ForWrite 损坏捕获与位置报告", () => {
    assert.throws(
        () => normalizeRegistryStoreForWrite({
            schemaVersion: 1,
            registeredAt: {
                [DOC_1]: "2026-10-01",
                [DOC_2]: "bad-date-2026",
            },
        }),
        (err: unknown) => {
            assert.ok(err instanceof StoreIntegrityError);
            assert.equal(err.originalCount, 2);
            assert.equal(err.entryIndex, 1);
            assert.ok(err.message.includes("人物文档 ID 或收编日期无效"));
            return true;
        },
    );

    const dupDismissalStore = {
        schemaVersion: 1,
        dismissals: [
            { personDocId: DOC_1, kind: "birthday", until: "2026-10-10" },
            { personDocId: DOC_1, kind: "birthday", until: "2026-10-20" },
        ],
    };
    assert.throws(
        () => normalizeDismissalStoreForWrite(dupDismissalStore),
        (err: unknown) => {
            assert.ok(err instanceof StoreIntegrityError);
            assert.equal(err.originalCount, 2);
            assert.equal(err.entryIndex, 1);
            assert.ok(err.message.includes("存在重复记录"));
            return true;
        },
    );
});
