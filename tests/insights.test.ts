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
