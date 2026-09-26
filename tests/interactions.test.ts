import { test } from "node:test";
import assert from "node:assert/strict";
import {
    appendEvent,
    isDuplicateEvent,
    lastInteractionByPerson,
    normalizeInteractionStore,
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

test("appendEvent：追加与幂等（同 id / 同 source+externalRef / 墓碑）", () => {
    let store: InteractionStore = normalizeInteractionStore(undefined);
    const e1 = event({ id: "e1" });
    store = appendEvent(store, e1);
    assert.equal(store.events.length, 1);
    // 同 id 重复
    store = appendEvent(store, event({ id: "e1" }));
    assert.equal(store.events.length, 1);
    // 同 source+externalRef
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
