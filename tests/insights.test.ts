import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCoAttendance, buildTimeline } from "../src/domain/interactions.ts";
import type { InteractionEvent } from "../src/domain/interactions.ts";
import { buildMeetingBriefing } from "../src/domain/briefing.ts";
import type { ContactSummary } from "../src/domain/person.ts";

function event(partial: Partial<InteractionEvent> & { id: string; personDocId: string }): InteractionEvent {
    return {
        occurredAt: 0, localDate: "2026-09-01", source: "diary", externalRef: "doc-meeting",
        ...partial,
    };
}

const EVENTS: InteractionEvent[] = [
    // 会议 1：甲乙丙同场
    event({ id: "e1", personDocId: "d-a", localDate: "2026-09-01" }),
    event({ id: "e2", personDocId: "d-b", localDate: "2026-09-01" }),
    event({ id: "e3", personDocId: "d-c", localDate: "2026-09-01" }),
    // 会议 2：甲乙同场
    event({ id: "e4", personDocId: "d-a", localDate: "2026-10-05", externalRef: "doc-dinner" }),
    event({ id: "e5", personDocId: "d-b", localDate: "2026-10-05", externalRef: "doc-dinner" }),
    // 甲的单人记录
    event({ id: "e6", personDocId: "d-a", localDate: "2026-08-01", externalRef: "doc-solo" }),
    // 丙的无关事件（不同 ref）
    event({ id: "e7", personDocId: "d-c", localDate: "2026-07-01", externalRef: "doc-other" }),
];

test("buildTimeline：倒序、同场人数聚合", () => {
    const timeline = buildTimeline(EVENTS, "d-a");
    assert.deepEqual(timeline.map((item) => item.localDate), ["2026-10-05", "2026-09-01", "2026-08-01"]);
    assert.equal(timeline[0].groupSize, 2, "晚餐：甲乙两人");
    assert.equal(timeline[1].groupSize, 3, "会议：甲乙丙三人");
    assert.equal(timeline[2].groupSize, 1, "单人记录");
});

test("buildCoAttendance：同场次数统计，无关事件不计入", () => {
    const co = buildCoAttendance(EVENTS, "d-a");
    assert.deepEqual(co, [
        { otherDocId: "d-b", count: 2 },
        { otherDocId: "d-c", count: 1 },
    ]);
    const forC = buildCoAttendance(EVENTS, "d-c");
    assert.deepEqual(forC, [
        { otherDocId: "d-a", count: 1 },
        { otherDocId: "d-b", count: 1 },
    ], "会议 1 中丙与甲、乙各同场一次，单人的 e7 不增加共同出席次数");
});

test("buildCoAttendance：无同场事实时为空", () => {
    assert.deepEqual(buildCoAttendance(EVENTS, "d-x"), []);
});

test("同场索引：重复参与者不放大人数或次数，来源独立", () => {
    const events = [
        event({ id: "target", personDocId: "甲" }),
        event({ id: "other", personDocId: "乙" }),
        event({ id: "other-repeat", personDocId: "乙" }),
        event({ id: "different-source", personDocId: "丙", source: "api" }),
    ];
    assert.equal(buildTimeline(events, "甲")[0].groupSize, 2);
    assert.deepEqual(buildCoAttendance(events, "甲"), [{ otherDocId: "乙", count: 1 }]);
    assert.equal(buildTimeline(events, "丙")[0].groupSize, 1);
});

test("同场索引：未提供或空标识不关联字面 undefined 场合", () => {
    const events = [
        event({ id: "target", personDocId: "甲", externalRef: "undefined" }),
        event({ id: "same", personDocId: "乙", externalRef: "undefined" }),
        event({ id: "missing", personDocId: "丙", externalRef: undefined }),
        event({ id: "empty", personDocId: "丁", externalRef: "" }),
    ];
    assert.deepEqual(buildCoAttendance(events, "甲"), [{ otherDocId: "乙", count: 1 }]);
    assert.deepEqual(buildCoAttendance(events, "丙"), []);
    assert.equal(buildTimeline(events, "甲")[0].groupSize, 2);
    assert.equal(buildTimeline(events, "丙")[0].groupSize, 1);
});

test("同场索引：三万事件保留一万场事实和完整时间线", () => {
    const events = Array.from({ length: 10_000 }, (_, index) => [
        event({ id: `target-${index}`, personDocId: "甲", externalRef: `meeting-${index}` }),
        event({ id: `other-a-${index}`, personDocId: "乙", externalRef: `meeting-${index}` }),
        event({ id: `other-b-${index}`, personDocId: "丙", externalRef: `meeting-${index}` }),
    ]).flat();
    const timeline = buildTimeline(events, "甲");
    assert.equal(timeline.length, 10_000);
    assert.ok(timeline.every((item) => item.groupSize === 3));
    assert.deepEqual(buildCoAttendance(events, "甲"), [{ otherDocId: "乙", count: 10_000 }, { otherDocId: "丙", count: 10_000 }]);
    assert.equal(events.length, 30_000);
});

test("buildMeetingBriefing：汇总最近互动、显式关系与共同出席", () => {
    const people: ContactSummary[] = [
        { docId: "d-a", itemId: "i-a", name: "甲", phone: "", email: "", wechat: "", website: "", birthday: "", isLunar: false, group: "", tags: [], relatedItemIds: ["i-c"] },
        { docId: "d-b", itemId: "i-b", name: "乙", phone: "", email: "", wechat: "", website: "", birthday: "", isLunar: false, group: "", tags: [], relatedItemIds: [] },
        { docId: "d-c", itemId: "i-c", name: "丙", phone: "", email: "", wechat: "", website: "", birthday: "", isLunar: false, group: "", tags: [], relatedItemIds: [] },
    ];
    const events = EVENTS.map((item) => item.id === "e4" ? { ...item, note: "讨论发布计划" } : item);
    assert.deepEqual(buildMeetingBriefing(people[0], people, events), [
        { label: "最近互动", value: "2026-10-05 · 讨论发布计划 · 2 人同场" },
        { label: "相关人物", value: "丙" },
        { label: "共同出席", value: "乙 2 次、丙 1 次" },
    ]);
});

test("buildMeetingBriefing：没有事实数据时返回空简报", () => {
    const person: ContactSummary = { docId: "d-x", itemId: "i-x", name: "新人", phone: "", email: "", wechat: "", website: "", birthday: "", isLunar: false, group: "", tags: [], relatedItemIds: [] };
    assert.deepEqual(buildMeetingBriefing(person, [person], []), []);
});

test("buildMeetingBriefing：extraRows 追加在末尾（B12 简报单位行）", () => {
    const people: ContactSummary[] = [
        { docId: "d-a", itemId: "i-a", name: "甲", phone: "", email: "", wechat: "", website: "", birthday: "", isLunar: false, group: "", tags: [], relatedItemIds: [] },
    ];
    const rows = buildMeetingBriefing(people[0], people, [], [
        { label: "单位", value: "测试公司 · 研发部" },
    ]);
    assert.deepEqual(rows, [{ label: "单位", value: "测试公司 · 研发部" }], "extraRows 应原样追加在末尾");
    assert.deepEqual(buildMeetingBriefing(people[0], people, []), [], "缺省无追加行");
});
