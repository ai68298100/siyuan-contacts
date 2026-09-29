import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFollowUpBackup } from "../src/domain/followup-backup.ts";
import { emptyFollowUpStore } from "../src/domain/followups.ts";
import type { FollowUpItem } from "../src/domain/followups.ts";

function item(partial: Partial<FollowUpItem> & { id: string }): FollowUpItem {
    return {
        personDocId: "20260927000000-person1", title: "", dueDate: "2026-10-01", status: "open",
        createdAt: 1, updatedAt: 1, ...partial,
    };
}

const ITEMS = [item({ id: "fu-1", title: "寄生日礼物" }), item({ id: "fu-2", title: "同步评审结论" })];

test("FUNC-01.6-a 往返：对象形态 rawStore（真实宿主 loadData 返回已解析对象）可解析", () => {
    const exported = {
        schemaVersion: 1,
        exportedAt: "2026-09-29T00:00:00.000Z",
        storageKey: "follow-ups.json",
        rawStore: { schemaVersion: 1, items: ITEMS },
        items: ITEMS,
    };
    assert.deepEqual(parseFollowUpBackup(JSON.stringify(exported)), ITEMS);
});

test("FUNC-01.6-a 往返：字符串形态 rawStore（文本快照）可解析；损坏字符串拒绝", () => {
    const exported = {
        schemaVersion: 1,
        storageKey: "follow-ups.json",
        rawStore: JSON.stringify({ schemaVersion: 1, items: ITEMS }),
        items: ITEMS,
    };
    assert.deepEqual(parseFollowUpBackup(JSON.stringify(exported)), ITEMS);
    const corrupted = { schemaVersion: 1, rawStore: "{ broken" };
    assert.throws(() => parseFollowUpBackup(JSON.stringify(corrupted)), /原始快照损坏/);
});

test("FUNC-01.6-a：null/空串 rawStore 为空快照；未知版本拒绝；裸事项库兼容", () => {
    assert.deepEqual(parseFollowUpBackup(JSON.stringify({ schemaVersion: 1, rawStore: null, items: [] })), []);
    assert.deepEqual(parseFollowUpBackup(JSON.stringify({ schemaVersion: 1, rawStore: "", items: [] })), []);
    assert.deepEqual(
        parseFollowUpBackup(JSON.stringify({ schemaVersion: 1, rawStore: emptyFollowUpStore(), items: [] })),
        [],
        "对象空库返回空",
    );
    assert.throws(
        () => parseFollowUpBackup(JSON.stringify({ schemaVersion: 1, rawStore: { schemaVersion: 99, items: ITEMS } })),
        /版本不兼容/,
    );
    assert.deepEqual(parseFollowUpBackup(JSON.stringify({ schemaVersion: 1, items: ITEMS })), ITEMS, "无 rawStore 的裸库");
    assert.throws(() => parseFollowUpBackup("not json"), /不是有效的 JSON/);
});
