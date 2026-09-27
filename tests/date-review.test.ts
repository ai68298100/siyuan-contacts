import assert from "node:assert/strict";
import test from "node:test";
import {
    addReviewDays,
    groupByMonth,
    inDateRange,
    onThisDay,
} from "../src/domain/date-review.ts";

interface Entry { localDate: string; note: string }

const entry = (localDate: string, note: string): Entry => ({ localDate, note });

test("日期范围：闭区间端点、跨年区间、非法端点视为不限制", () => {
    assert.equal(inDateRange("2026-12-31", "2026-12-01", "2026-12-31"), true, "to 端点应命中");
    assert.equal(inDateRange("2026-12-01", "2026-12-01", "2026-12-31"), true, "from 端点应命中");
    assert.equal(inDateRange("2027-01-01", "2026-12-28", "2027-01-03"), true, "跨年区间应命中");
    assert.equal(inDateRange("2026-12-27", "2026-12-28", "2027-01-03"), false, "下界之外应排除");
    assert.equal(inDateRange("2027-01-04", "2026-12-28", "2027-01-03"), false, "上界之外应排除");
    assert.equal(inDateRange("2020-01-01", "", "2026-06-30"), true, "空 from 不限制");
    assert.equal(inDateRange("2030-01-01", "bogus", ""), true, "非法 from 视为不限制");
});

test("按月分组：组序沿用输入（倒序），跨年分组，空月份不生成，计数正确", () => {
    const groups = groupByMonth([
        entry("2027-01-02", "跨年"),
        entry("2026-12-31", "年末"),
        entry("2026-12-28", "月初前"),
        entry("2026-11-05", "十一月"),
    ]);
    assert.deepEqual(groups.map((group) => group.month), ["2027-01", "2026-12", "2026-11"]);
    assert.deepEqual(groups.map((group) => group.label), ["2027年1月", "2026年12月", "2026年11月"]);
    assert.equal(groups[1].items.length, 2);
    assert.equal(groupByMonth([]).length, 0);
    // 输入中不含事件的月份（如 2026-10）不出现
    assert.equal(groups.some((group) => group.month === "2026-10"), false);
});

test("历史上的今天：月日匹配且早于今天，按年份倒序，当年今天不计入", () => {
    const items = [
        entry("2026-09-28", "今年今天"),
        entry("2025-09-28", "去年今天"),
        entry("2024-09-28", "前年今天"),
        entry("2025-09-27", "昨天月日不同"),
        entry("2025-10-28", "下月同日"),
    ];
    const result = onThisDay(items, "2026-09-28");
    assert.deepEqual(result.map((item) => item.localDate), ["2025-09-28", "2024-09-28"]);
    assert.deepEqual(onThisDay(items, "bogus"), []);
});
