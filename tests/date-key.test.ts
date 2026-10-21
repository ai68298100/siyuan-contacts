import assert from "node:assert/strict";
import test from "node:test";
import { isValidDateKey } from "../src/domain/date-key.ts";

test("date-key：接受真实存在的公历日期", () => {
    // 常规日期
    assert.equal(isValidDateKey("2026-10-19"), true);
    assert.equal(isValidDateKey("2000-01-01"), true);
    assert.equal(isValidDateKey("1999-12-31"), true);

    // 闰年 2 月 29 日（2024 是闰年）
    assert.equal(isValidDateKey("2024-02-29"), true);
    // 世纪闰年（2000 能被 400 整除，是闰年）
    assert.equal(isValidDateKey("2000-02-29"), true);

    // 大小月边界
    assert.equal(isValidDateKey("2026-01-31"), true, "1 月有 31 天");
    assert.equal(isValidDateKey("2026-04-30"), true, "4 月有 30 天");
    assert.equal(isValidDateKey("2026-12-31"), true);
});

test("date-key：拒绝不存在的日期（含闰年陷阱与月份天数）", () => {
    // 平年没有 2 月 29 日
    assert.equal(isValidDateKey("2026-02-29"), false, "2026 是平年");
    assert.equal(isValidDateKey("1900-02-29"), false, "1900 能被 100 整除但不能被 400 整除，是平年");

    // 月份天数越界
    assert.equal(isValidDateKey("2026-02-30"), false, "2 月没有 30 日");
    assert.equal(isValidDateKey("2026-04-31"), false, "4 月只有 30 天");
    assert.equal(isValidDateKey("2026-06-31"), false, "6 月只有 30 天");
    assert.equal(isValidDateKey("2026-09-31"), false, "9 月只有 30 天");
    assert.equal(isValidDateKey("2026-11-31"), false, "11 月只有 30 天");
    assert.equal(isValidDateKey("2026-01-32"), false);

    // 月份越界
    assert.equal(isValidDateKey("2026-00-15"), false, "月份不能为 0");
    assert.equal(isValidDateKey("2026-13-01"), false, "月份不能为 13");
    assert.equal(isValidDateKey("2026-99-99"), false);

    // 日为 0
    assert.equal(isValidDateKey("2026-10-00"), false, "日不能为 0");
});

test("date-key：拒绝格式错误与非字符串输入", () => {
    // 格式错误
    assert.equal(isValidDateKey("2026-1-9"), false, "必须两位补零");
    assert.equal(isValidDateKey("2026/10/19"), false, "分隔符必须是短横线");
    assert.equal(isValidDateKey("20261019"), false, "缺少分隔符");
    assert.equal(isValidDateKey("2026-10-19T00:00:00"), false, "不接受带时间");
    assert.equal(isValidDateKey(" 2026-10-19"), false, "不接受前后空格");
    assert.equal(isValidDateKey("2026-10-19 "), false);
    assert.equal(isValidDateKey("2026-10-19\n"), false);
    assert.equal(isValidDateKey(""), false);
    assert.equal(isValidDateKey("abcd-ef-gh"), false);

    // 非字符串一律拒绝（类型守卫语义）
    assert.equal(isValidDateKey(null), false);
    assert.equal(isValidDateKey(undefined), false);
    assert.equal(isValidDateKey(20261019), false, "数字不接受");
    assert.equal(isValidDateKey(new Date("2026-10-19")), false, "Date 对象不接受");
    assert.equal(isValidDateKey(["2026-10-19"]), false, "数组不接受");
    assert.equal(isValidDateKey({ date: "2026-10-19" }), false, "对象不接受");
    assert.equal(isValidDateKey(true), false);
});

test("date-key：避免 JS 对 0–99 年份的特殊解释（两位数年份陷阱）", () => {
    // JS Date 会把 0–99 年映射到 1900–1999；本函数必须严格按字面年份判断
    assert.equal(isValidDateKey("0099-01-01"), true, "四位补零的 0099 年应有效");
    assert.equal(isValidDateKey("0001-01-01"), true, "公元 1 年应有效");
    assert.equal(isValidDateKey("0000-01-01"), false, "year 必须 >= 1");
    assert.equal(isValidDateKey("0099-02-29"), false, "99 年是平年，没有 2 月 29 日");
    // 闰年规则在字面年份上生效（0096 能被 4 整除且不是世纪年 → 闰年）
    assert.equal(isValidDateKey("0096-02-29"), true, "96 年是闰年");
});
