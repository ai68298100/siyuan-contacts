import { test } from "node:test";
import assert from "node:assert/strict";
import {
    appendEvent,
    buildCoAttendance,
    buildTimeline,
    isDuplicateEvent,
    lastInteractionByPerson,
    normalizeInteractionStore,
    normalizeInteractionStoreForWrite,
    removeEvent,
    staleContacts,
    toLocalDateKey,
} from "../src/domain/interactions.ts";
import type { InteractionEvent, InteractionStore } from "../src/domain/interactions.ts";
import type { ContactSummary } from "../src/domain/person.ts";

function event(partial: Partial<InteractionEvent>): InteractionEvent {
    return {
        id: "e1", personDocId: "d1", occurredAt: 1780000000000, localDate: "2026-06-01", source: "manual",
        ...partial,
    };
}

function person(docId: string, name: string): ContactSummary {
    return {
        docId, itemId: `i-${docId}`, name, phone: "", email: "", wechat: "", website: "",
        birthday: "", isLunar: false, group: "", tags: [], relatedItemIds: [],
    };
}

test("toLocalDateKey：本地日格式", () => {
    assert.equal(toLocalDateKey(new Date(2026, 8, 27)), "2026-09-27");
    assert.equal(toLocalDateKey(new Date(2026, 0, 5)), "2026-01-05");
});

test("appendEvent：追加与幂等（同 id / 同人物+source+externalRef / 墓碑）", () => {
    let store: InteractionStore = normalizeInteractionStore(undefined);
    const e1 = event({ id: "e1" });
    store = appendEvent(store, e1);
    assert.equal(store.events.length, 1);
    // 同 id 重复
    store = appendEvent(store, event({ id: "e1" }));
    assert.equal(store.events.length, 1);
    // 同人物+source+externalRef
    store = appendEvent(store, event({ id: "e2", externalRef: "x1", source: "diary" }));
    assert.equal(store.events.length, 2);
    store = appendEvent(store, event({ id: "e3", externalRef: "x1", source: "diary" }));
    assert.equal(store.events.length, 2);
    // 墓碑拦截
    store = removeEvent(store, "e1");
    assert.equal(store.events.length, 1);
    assert.deepEqual(store.tombstones, ["e1"]);
    store = appendEvent(store, event({ id: "e1" }));
    assert.equal(store.events.length, 1, "墓碑事件不得复活");
    assert.ok(isDuplicateEvent(store, event({ id: "e1" })));
});

test("normalize：脏数据降级为空库，合法数据过虑保留", () => {
    assert.equal(normalizeInteractionStore(null).events.length, 0);
    assert.equal(normalizeInteractionStore({ schemaVersion: 99 }).events.length, 0);
    const store = normalizeInteractionStore({
        schemaVersion: 1,
        events: [
            event({ id: "ok" }),
            { id: "", personDocId: "d", occurredAt: 1, localDate: "2026-01-01", source: "manual" },
            event({ id: "bad-date", localDate: "2026/01/01" }),
            event({ id: "bad-source", source: "hack" }),
        ],
        tombstones: ["t1", 42],
    });
    assert.equal(store.events.length, 1);
    assert.deepEqual(store.tombstones, ["t1"]);
});

test("写前归一：首次空值可创建，未知版本与损坏数据拒绝修改", () => {
    for (const raw of [null, undefined, ""]) assert.deepEqual(normalizeInteractionStoreForWrite(raw), { schemaVersion: 1, events: [], tombstones: [] });
    for (const raw of ["broken", {}, { schemaVersion: 2, events: [], tombstones: [] },
        { schemaVersion: 1, events: [event({}), null], tombstones: [] },
        { schemaVersion: 1, events: [], tombstones: [42] },
        { schemaVersion: 1, events: [ { ...event({}), externalRef: 42 } ], tombstones: [] },
        { schemaVersion: 1, events: [ { ...event({}), note: {} } ], tombstones: [] }]) {
        assert.throws(() => normalizeInteractionStoreForWrite(raw), /操作已停止/);
    }
});

test("写前归一：合法重复项与墓碑按已有规则投影", () => {
    const raw = { schemaVersion: 1, events: [event({}), event({}), event({ id: "deleted" })], tombstones: ["deleted"] };
    assert.deepEqual(normalizeInteractionStoreForWrite(raw), normalizeInteractionStore(raw));
    assert.equal(normalizeInteractionStoreForWrite(raw).events.length, 1);
});

test("多人同场：各人记录保留，重复捕获幂等，回读后共同出席可计算", () => {
    let store = normalizeInteractionStore(null);
    for (const [index, personDocId] of ["甲", "乙", "丙"].entries()) {
        store = appendEvent(store, event({ id: `meeting-${index}`, personDocId, source: "diary", externalRef: "会议" }));
    }
    store = appendEvent(store, event({ id: "repeat", personDocId: "乙", source: "diary", externalRef: "会议" }));
    const reread = normalizeInteractionStore(JSON.parse(JSON.stringify(store)));
    assert.equal(reread.events.length, 3);
    assert.equal(buildTimeline(reread.events, "甲")[0].groupSize, 3);
    assert.deepEqual(buildCoAttendance(reread.events, "甲"), [
        { otherDocId: "乙", count: 1 }, { otherDocId: "丙", count: 1 },
    ]);
});

test("归一化：事件 ID 全局去重，不同来源及空场合标识与追加规则一致", () => {
    const events = [
        event({ id: "a", source: "diary", externalRef: "" }),
        event({ id: "b", source: "diary", externalRef: "" }),
        event({ id: "b", personDocId: "另一人", source: "diary", externalRef: "另一场合" }),
        event({ id: "c", source: "api", externalRef: "" }),
        event({ id: "c", personDocId: "另一人", source: "api", externalRef: "另一场合" }),
    ];
    let appended = normalizeInteractionStore(null);
    for (const item of events) appended = appendEvent(appended, item);
    const normalized = normalizeInteractionStore({ schemaVersion: 1, events, tombstones: [] });
    assert.deepEqual(normalized.events, appended.events);
    assert.equal(normalized.events.length, 3);
});

test("lastInteractionByPerson / staleContacts：最近互动与久未联系排序", () => {
    const now = new Date(2026, 8, 27);
    const store = normalizeInteractionStore({
        schemaVersion: 1,
        events: [
            event({ id: "a", personDocId: "d-a", occurredAt: new Date(2026, 8, 1).getTime(), localDate: "2026-09-01" }),
            event({ id: "b", personDocId: "d-a", occurredAt: new Date(2026, 8, 20).getTime(), localDate: "2026-09-20" }),
            event({ id: "c", personDocId: "d-b", occurredAt: new Date(2026, 4, 1).getTime(), localDate: "2026-05-01" }),
        ],
        tombstones: [],
    });
    const people = [person("d-a", "甲"), person("d-b", "乙"), person("d-c", "丙")];
    const last = lastInteractionByPerson(store, people, now);
    assert.equal(last.get("d-a")?.lastDaysAgo, 7);
    assert.equal(last.get("d-c")?.lastDaysAgo, undefined);

    const stale = staleContacts(store, people, 30, now);
    assert.deepEqual(stale.map((info) => info.person.name), ["丙", "乙"], "从未互动排最前，其后按天数降序");
});
