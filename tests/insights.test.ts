import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCoAttendance, buildTimeline } from "../src/domain/interactions.ts";
import type { InteractionEvent } from "../src/domain/interactions.ts";

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
    ], "丙只与甲同场过一次（e7 的 ref 不在甲的 ref 集里）");
});

test("buildCoAttendance：无同场事实时为空", () => {
    assert.deepEqual(buildCoAttendance(EVENTS, "d-x"), []);
});
