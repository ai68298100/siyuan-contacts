import { test } from "node:test";
import assert from "node:assert/strict";
import {
    appendEvent,
    buildCoAttendance,
    buildTimeline,
    filterTimelineByType,
    inferInteractionType,
    isDuplicateEvent,
    lastInteractionByPerson,
    normalizeInteractionStore,
    normalizeInteractionStoreForWrite,
    removeEvent,
    staleContacts,
    toLocalDateKey,
    INTERACTION_TYPES,
} from "../src/domain/interactions.ts";
import type { InteractionEvent, InteractionStore } from "../src/domain/interactions.ts";
import type { ContactSummary } from "../src/domain/person.ts";
import { mergeInteractionBackup, parseInteractionBackup } from "../src/domain/interaction-backup.ts";

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
            event({ id: "bad-calendar-date", localDate: "2026-02-30" }),
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

test("备份解析：旧版兼容，新版优先原快照，不偷换损坏数据", () => {
    const store = { schemaVersion: 1, events: [event({})], tombstones: [] };
    assert.deepEqual(parseInteractionBackup(JSON.stringify(store)), store);
    assert.deepEqual(parseInteractionBackup(JSON.stringify({ ...store, rawStore: store })), store);
    assert.equal(parseInteractionBackup(JSON.stringify({ ...store, rawStore: "" })).events.length, 0);
    for (const text of ["bad", "null", JSON.stringify({ ...store, schemaVersion: 99 }),
        JSON.stringify({ ...store, rawStore: { ...store, schemaVersion: 99 } }),
        JSON.stringify({ ...store, rawStore: { ...store, events: [null] } })]) {
        assert.throws(() => parseInteractionBackup(text));
    }
});

test("备份合并：当前优先、人物场合去重、双方墓碑阻止复活、再次合并幂等", () => {
    const current = normalizeInteractionStore({ schemaVersion: 1, events: [event({ id: "keep", note: "现有备注", externalRef: "会议" }), event({ id: "remove" })], tombstones: ["deleted"] });
    const incoming = normalizeInteractionStore({ schemaVersion: 1, events: [
        event({ id: "duplicate", note: "旧备注", externalRef: "会议" }),
        event({ id: "new", personDocId: "d2", externalRef: "会议" }), event({ id: "deleted" }),
    ], tombstones: ["remove"] });
    const before = JSON.stringify([current, incoming]);
    const result = mergeInteractionBackup(current, incoming);
    assert.deepEqual(result.summary, { added: 1, skipped: 2, removed: 1, tombstonesAdded: 1 });
    assert.equal(result.store.events.find((item) => item.id === "keep")?.note, "现有备注");
    assert.deepEqual(result.store.tombstones, ["deleted", "remove"]);
    assert.equal(JSON.stringify([current, incoming]), before, "输入不应被修改");
    assert.deepEqual(mergeInteractionBackup(result.store, incoming).summary, { added: 0, skipped: 3, removed: 0, tombstonesAdded: 0 });
});

test("备份批量合并：与逐条追加的去重、墓碑、顺序及计数一致", () => {
    for (let seed = 0; seed < 40; seed += 1) {
        const make = (index: number) => event({
            id: `event-${index % 25}`, personDocId: `person-${(index + seed) % 7}`,
            source: index % 2 ? "api" : "diary",
            externalRef: index % 3 ? `ref-${index % 5}` : undefined,
        });
        const current = normalizeInteractionStore({ schemaVersion: 1, events: Array.from({ length: 30 }, (_, index) => make(index)), tombstones: [`event-${seed % 25}`] });
        const incoming = normalizeInteractionStore({ schemaVersion: 1, events: Array.from({ length: 35 }, (_, index) => make(index + seed)), tombstones: [`event-${(seed + 8) % 25}`] });
        const tombstones = [...new Set([...current.tombstones, ...incoming.tombstones])];
        let reference = normalizeInteractionStore({ ...current, tombstones });
        const removed = current.events.length - reference.events.length;
        let added = 0;
        let skipped = 0;
        for (const item of incoming.events) {
            const next = appendEvent(reference, item);
            if (next === reference) skipped += 1;
            else added += 1;
            reference = next;
        }
        assert.deepEqual(mergeInteractionBackup(current, incoming), {
            store: reference,
            summary: { added, skipped, removed, tombstonesAdded: tombstones.length - new Set(current.tombstones).size },
        }, `场景 ${seed} 与逐条追加不一致`);
    }
});

test("备份批量合并：两万当前记录与两万备份保留全部独立事实", () => {
    const make = (index: number) => event({ id: `event-${index}`, personDocId: `person-${index}`, source: "api", externalRef: "会议" });
    const current: InteractionStore = { schemaVersion: 1, events: Array.from({ length: 20_000 }, (_, index) => make(index)), tombstones: ["event-25000"] };
    const incoming: InteractionStore = { schemaVersion: 1, events: Array.from({ length: 20_000 }, (_, index) => make(index + 10_000)), tombstones: ["event-100"] };
    const result = mergeInteractionBackup(current, incoming);
    assert.equal(result.store.events.length, 29_998);
    assert.deepEqual(result.summary, { added: 9_999, skipped: 10_001, removed: 1, tombstonesAdded: 1 });
    assert.equal(result.store.events[0].id, "event-0");
    assert.equal(result.store.events.at(-1)?.id, "event-29999");
    assert.equal(current.events.length, 20_000);
    assert.equal(incoming.events.length, 20_000);
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

test("M-10：buildTimeline 同日事件按 occurredAt 倒序与 eventId tie-breaker 严格确定排序", () => {
    const events: InteractionEvent[] = [
        event({ id: "e-older", personDocId: "d-target", localDate: "2026-10-01", occurredAt: 1000 }),
        event({ id: "e-newer-b", personDocId: "d-target", localDate: "2026-10-01", occurredAt: 2000 }),
        event({ id: "e-newer-a", personDocId: "d-target", localDate: "2026-10-01", occurredAt: 2000 }),
        event({ id: "e-yesterday", personDocId: "d-target", localDate: "2026-09-30", occurredAt: 3000 }),
    ];
    // 乱序打乱输入，验证无论输入顺序如何，时间线输出始终一致确定
    const timeline1 = buildTimeline(events, "d-target");
    const timeline2 = buildTimeline([...events].reverse(), "d-target");
    assert.deepEqual(timeline1, timeline2, "多次生成或不同输入顺序输出必须完全一致");
    assert.deepEqual(
        timeline1.map((item) => item.eventId),
        ["e-newer-b", "e-newer-a", "e-older", "e-yesterday"],
        "先按日期倒序，同日按 occurredAt 倒序，再次按 eventId 倒序",
    );
});

test("AG-E17-INTERACTION-TYPE: 语义分类推导、时间线过滤与非法类型写入校验", () => {
    // 1. 显式指定的 type 优先
    assert.equal(inferInteractionType({ source: "manual", note: "[聚餐] 吃了火锅", type: "meeting" }), "meeting");

    // 2. 备注前缀推导
    assert.equal(inferInteractionType({ source: "manual", note: "[会议] 季度战略复盘" }), "meeting");
    assert.equal(inferInteractionType({ source: "manual", note: "[电话] 讨论合作细节" }), "call");
    assert.equal(inferInteractionType({ source: "manual", note: "[微信] 约了周末聚聚" }), "message");
    assert.equal(inferInteractionType({ source: "manual", note: "[聚餐] 团队聚餐" }), "meal");
    assert.equal(inferInteractionType({ source: "manual", note: "[邮件] 发送了合同" }), "email");
    assert.equal(inferInteractionType({ source: "manual", note: "日常聊天" }), "other");

    // 3. 时间线项自动推导并支持按类型过滤
    const events: InteractionEvent[] = [
        event({ id: "e1", note: "[会议] 复盘", localDate: "2026-10-01" }),
        event({ id: "e2", note: "[电话] 通话", localDate: "2026-10-02" }),
        event({ id: "e3", note: "[聚餐] 吃饭", localDate: "2026-10-03" }),
    ];
    const timeline = buildTimeline(events, "d1");
    assert.equal(timeline.find((t) => t.eventId === "e1")?.type, "meeting");
    assert.equal(timeline.find((t) => t.eventId === "e2")?.type, "call");
    assert.equal(timeline.find((t) => t.eventId === "e3")?.type, "meal");

    assert.equal(filterTimelineByType(timeline, "all").length, 3);
    assert.equal(filterTimelineByType(timeline, "call").length, 1);
    assert.equal(filterTimelineByType(timeline, "call")[0].eventId, "e2");
    assert.equal(filterTimelineByType(timeline, "email").length, 0);

    // 4. 写前校验支持合法 type，拒绝非法未知类型
    const validStore = {
        schemaVersion: 1,
        events: [event({ id: "e-ok", type: "meeting" })],
        tombstones: [],
    };
    assert.doesNotThrow(() => normalizeInteractionStoreForWrite(validStore));

    const invalidStore = {
        schemaVersion: 1,
        events: [event({ id: "e-bad", type: "invalid_type" as unknown as InteractionEvent["type"] })],
        tombstones: [],
    };
    assert.throws(() => normalizeInteractionStoreForWrite(invalidStore), /互动存储内容损坏/);
});
