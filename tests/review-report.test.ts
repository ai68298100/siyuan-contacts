import assert from "node:assert/strict";
import test from "node:test";
import {
    activityKey,
    buildReviewReport,
    monthToDateRange,
    previousRange,
} from "../src/domain/review-report.ts";
import type { InteractionEvent } from "../src/domain/interactions.ts";
import type { ContactSummary } from "../src/domain/person.ts";

function person(docId: string, name: string): ContactSummary {
    return {
        docId, itemId: `item-${docId}`, name, phone: "", email: "", wechat: "", website: "",
        birthday: "", isLunar: false, group: "", tags: [], relatedItemIds: [],
    };
}

function event(partial: Partial<InteractionEvent> & { id: string; personDocId: string; localDate: string }): InteractionEvent {
    return {
        occurredAt: 1, source: "manual", ...partial,
        ...(partial.externalRef !== undefined ? { externalRef: partial.externalRef } : {}),
    };
}

const roster = [person("doc-a", "甲"), person("doc-b", "乙"), person("doc-c", "丙")];
const range = { from: "2026-09-01", to: "2026-09-30" };

test("口径：多人同场算一场活动，人物条数各计一条，手工各自成次", () => {
    const events: InteractionEvent[] = [
        event({ id: "e1", personDocId: "doc-a", localDate: "2026-09-05", source: "diary", externalRef: "note-1" }),
        event({ id: "e2", personDocId: "doc-b", localDate: "2026-09-05", source: "diary", externalRef: "note-1" }),
        event({ id: "e3", personDocId: "doc-c", localDate: "2026-09-06", source: "manual" }),
        event({ id: "e4", personDocId: "doc-a", localDate: "2026-09-07", source: "manual" }),
    ];
    const report = buildReviewReport({ events, roster, range });
    assert.equal(report.total, 4, "人物互动条数应逐条计数");
    assert.equal(report.activities, 3, "同场活动应去重（2 条同场 + 2 条各自成场）");
    assert.equal(report.contactedPeople, 3);
    assert.equal(report.bySource.manual, 2);
    assert.equal(report.bySource.diary, 2);
    // 多人同场的 groupSize
    assert.equal(report.entries.find((entry) => entry.eventId === "e1")?.groupSize, 2);
});

test("区间：闭区间端点命中，上期对比与差值正确", () => {
    const events: InteractionEvent[] = [
        event({ id: "in-from", personDocId: "doc-a", localDate: "2026-09-01" }),
        event({ id: "in-to", personDocId: "doc-a", localDate: "2026-09-30" }),
        event({ id: "prev", personDocId: "doc-b", localDate: "2026-08-15" }),
        event({ id: "out", personDocId: "doc-b", localDate: "2026-10-01" }),
    ];
    const report = buildReviewReport({ events, roster, range });
    assert.equal(report.total, 2, "区间端点与范围外过滤错误");
    assert.deepEqual(report.previous, { from: "2026-08-02", to: "2026-08-31" });
    assert.equal(report.previousTotal, 1);
    assert.equal(report.delta, 1);
});

test("排行：按次数降序取前 5，人名缺失回退空串", () => {
    const events: InteractionEvent[] = [
        event({ id: "1", personDocId: "doc-a", localDate: "2026-09-01" }),
        event({ id: "2", personDocId: "doc-a", localDate: "2026-09-02" }),
        event({ id: "3", personDocId: "doc-a", localDate: "2026-09-03" }),
        event({ id: "4", personDocId: "doc-ghost", localDate: "2026-09-04" }),
    ];
    const report = buildReviewReport({ events, roster, range });
    assert.deepEqual(report.topPeople[0], { personDocId: "doc-a", name: "甲", count: 3 });
    assert.equal(report.topPeople[1].name, "", "不在名册的人物应回退空串");
    assert.equal(report.topPeople.length, 2);
});

test("零数据与工具：空区间一致，本月范围与上期推算", () => {
    const report = buildReviewReport({ events: [], roster, range });
    assert.equal(report.total, 0);
    assert.equal(report.activities, 0);
    assert.equal(report.contactedPeople, 0);
    assert.equal(report.delta, 0);
    assert.deepEqual(monthToDateRange("2026-09-28"), { from: "2026-09-01", to: "2026-09-28" });
    assert.deepEqual(previousRange({ from: "2026-09-01", to: "2026-09-30" }), { from: "2026-08-02", to: "2026-08-31" });
    assert.equal(activityKey({ id: "e9", source: "manual" }), "id:e9");
    assert.equal(activityKey({ eventId: "e9", source: "diary", externalRef: "note-1" }), "diary:note-1");
});

test("报表忽略非法互动日期，避免伪造统计和上一周期数量", () => {
    const report = buildReviewReport({
        events: [event({ id: "bad", personDocId: "doc-a", localDate: "2026-02-31" }), event({ id: "ok", personDocId: "doc-a", localDate: "2026-09-10" })],
        roster,
        range,
    });
    assert.equal(report.total, 1);
    assert.deepEqual(report.entries.map((entry) => entry.eventId), ["ok"]);
});
