import assert from "node:assert/strict";
import test from "node:test";
import { diffInteractionImport } from "../src/domain/interaction-backup.ts";
import { emptyStore } from "../src/domain/interactions.ts";
import type { InteractionEvent, InteractionStore } from "../src/domain/interactions.ts";

function event(partial: Partial<InteractionEvent> & { id: string; personDocId: string; localDate: string }): InteractionEvent {
    return { occurredAt: 1, source: "manual", ...partial, ...(partial.externalRef !== undefined ? { externalRef: partial.externalRef } : {}) };
}
function store(events: InteractionEvent[], tombstones: string[] = []): InteractionStore {
    return { schemaVersion: 1, events, tombstones };
}
const e = (id: string, personDocId: string, localDate: string, note?: string) =>
    event({ id, personDocId, localDate, ...(note !== undefined ? { note } : {}) });

const names = new Map([["doc-a", "甲"], ["doc-b", "乙"]]);

test("差异：新增与跳过分类，合计守恒 added+skipped === incomingTotal", () => {
    const current = store([e("exist", "doc-a", "2026-09-01", "已有")]);
    const incoming = store([
        e("exist", "doc-a", "2026-09-01", "已有"),
        e("new-1", "doc-b", "2026-09-02", "新互动"),
        e("new-2", "doc-ghost", "2026-09-03"),
    ]);
    const diff = diffInteractionImport(current, incoming, names);
    assert.equal(diff.incomingTotal, 3);
    assert.equal(diff.added.length + diff.skipped.length, diff.incomingTotal, "合计不守恒");
    assert.deepEqual(diff.added.map((entry) => entry.eventId), ["new-1", "new-2"]);
    assert.deepEqual(diff.skipped.map((entry) => entry.eventId), ["exist"]);
});

test("差异：人物名册解析与不可达标注", () => {
    const diff = diffInteractionImport(store([]), store([e("n1", "doc-b", "2026-09-02"), e("n2", "doc-ghost", "2026-09-03")]), names);
    assert.equal(diff.added.find((entry) => entry.eventId === "n1")?.personName, "乙");
    assert.equal(diff.added.find((entry) => entry.eventId === "n2")?.personFound, false);
});

test("差异：删除标记命中现有互动标注将移除，无命中标注无影响，备份事件被标记覆盖不新增", () => {
    const current = store([e("gone", "doc-a", "2026-09-01", "将被移除"), e("keep", "doc-b", "2026-09-02")]);
    const incoming = store(
        [e("new", "doc-a", "2026-09-10")],
        ["gone", "missing", "keep", "new"],
    );
    const diff = diffInteractionImport(current, incoming, names);
    const gone = diff.tombstoneHits.find((hit) => hit.tombstoneId === "gone");
    assert.equal(gone?.willRemove, true);
    assert.equal(gone?.removed?.localDate, "2026-09-01");
    assert.equal(diff.tombstoneHits.find((hit) => hit.tombstoneId === "missing")?.willRemove, false);
    // "new" 被备份内删除标记覆盖 → 计入跳过且不新增
    assert.deepEqual(diff.added.map((entry) => entry.eventId), []);
    assert.equal(diff.skipped.find((entry) => entry.eventId === "new")?.reason?.includes("删除标记"), true);
    assert.equal(diff.added.length + diff.skipped.length, diff.incomingTotal);
});

test("差异：幂等身份（人物+来源+场合）重复计入跳过；空备份全零", () => {
    const current = store([event({ id: "a1", personDocId: "doc-a", localDate: "2026-09-01", source: "diary", externalRef: "note-1" })]);
    const incoming = store([event({ id: "a1-dup", personDocId: "doc-a", localDate: "2026-09-01", source: "diary", externalRef: "note-1" })]);
    const diff = diffInteractionImport(current, incoming, names);
    assert.equal(diff.added.length, 0, "幂等身份重复不应新增");
    assert.equal(diff.skipped.length, 1);
    assert.deepEqual(diffInteractionImport(current, emptyStore(), names).added, []);
});
