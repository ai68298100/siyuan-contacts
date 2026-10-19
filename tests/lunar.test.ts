import assert from "node:assert/strict";
import test from "node:test";
import {
    formatLunar,
    lunarToSolar,
    solarToLunar,
    LUNAR_DAY_NAMES,
    LUNAR_MONTH_NAMES,
} from "../src/domain/lunar.ts";

/** 取本地日期（与被测函数约定一致） */
function solar(y: number, m: number, d: number): Date {
    return new Date(y, m - 1, d);
}

function keyOf(date: Date): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

test("lunar：公历 → 农历 往返一致性（有效范围 1900-01-31 起，跨 200 年抽样）", () => {
    // 换算表有效区间为 1900-01-31 ~ 2100 年；从 1901 年起逐年抽样验证往返闭合
    let checked = 0;
    for (let year = 1901; year <= 2100; year += 1) {
        for (const [m, d] of [[1, 15], [3, 1], [6, 10], [9, 20], [12, 25]] as const) {
            const date = solar(year, m, d);
            const lunar = solarToLunar(date);
            assert.ok(lunar, `${year}-${m}-${d} 应能换算为农历`);
            const back = lunarToSolar(lunar.year, lunar.month, lunar.day, lunar.leap);
            assert.ok(back, `${year}-${m}-${d} 的农历应能换回公历`);
            assert.equal(keyOf(back), keyOf(date), `往返不一致：${keyOf(date)} → ${JSON.stringify(lunar)} → ${keyOf(back)}`);
            checked += 1;
        }
    }
    assert.equal(checked, 200 * 5);
});

test("lunar：锚点 1900-01-31 是农历 1900 年正月初一", () => {
    const lunar = solarToLunar(solar(1900, 1, 31));
    assert.deepEqual(lunar, { year: 1900, month: 1, day: 1, leap: false });
    assert.equal(formatLunar(lunar!), "正月初一");
});

test("lunar：闰月换算正确（2023 闰二月真实存在）", () => {
    // 2023 年农历有闰二月（leapMonth = 2）。找到该闰月的日期应标记 leap=true
    const leapDay = lunarToSolar(2023, 2, 1, true);
    assert.ok(leapDay, "2023 年闰二月初一应可换算");
    const back = solarToLunar(leapDay);
    assert.ok(back, "闰月日期应能换回农历");
    assert.equal(back.leap, true, "闰二月的日期应标记 leap=true");
    assert.equal(back.month, 2, "闰月月份应为 2");
    assert.equal(back.day, 1);

    // 同一年的普通二月不应标闰
    const regularFeb = lunarToSolar(2023, 2, 1, false);
    assert.ok(regularFeb, "2023 年二月初一应可换算");
    assert.notEqual(keyOf(regularFeb), keyOf(leapDay), "闰二月与二月不应是同一天");
    assert.equal(solarToLunar(regularFeb)!.leap, false, "普通二月不应标闰");
});

test("lunar：formatLunar 展示格式（月份与日名称覆盖）", () => {
    assert.equal(formatLunar({ year: 2024, month: 1, day: 1, leap: false }), "正月初一");
    assert.equal(formatLunar({ year: 2024, month: 10, day: 20, leap: false }), "十月二十");
    assert.equal(formatLunar({ year: 2024, month: 10, day: 30, leap: false }), "十月三十");
    assert.equal(formatLunar({ year: 2024, month: 11, day: 5, leap: false }), "冬月初五", "十一月称冬月");
    assert.equal(formatLunar({ year: 2024, month: 12, day: 8, leap: false }), "腊月初八", "十二月称腊月");
    assert.equal(formatLunar({ year: 2023, month: 2, day: 15, leap: true }), "闰二月十五", "闰月带闰前缀");

    // 名称表完整
    assert.equal(LUNAR_MONTH_NAMES.length, 12);
    assert.equal(LUNAR_DAY_NAMES.length, 30);
});

test("lunar：越界与无效输入一律返回 undefined，不猜测不抛错", () => {
    // 早于基准日 1900-01-31
    assert.equal(solarToLunar(solar(1900, 1, 30)), undefined, "早于基准日应返回 undefined");
    assert.equal(solarToLunar(solar(1899, 12, 31)), undefined);

    // 年份越界（表只到 2100）
    assert.equal(lunarToSolar(1899, 1, 1), undefined, "早于 1900 年应返回 undefined");
    assert.equal(lunarToSolar(2101, 1, 1), undefined, "晚于 2100 年应返回 undefined");
    assert.equal(lunarToSolar(3000, 1, 1), undefined);

    // 月份越界
    assert.equal(lunarToSolar(2024, 0, 1), undefined, "月份不能为 0");
    assert.equal(lunarToSolar(2024, 13, 1), undefined, "月份不能为 13");

    // 日期越界
    assert.equal(lunarToSolar(2024, 1, 0), undefined, "日不能为 0");
    assert.equal(lunarToSolar(2024, 1, 31), undefined, "农历日最大 30");

    // 闰月组合无效：2024 年没有闰月，却要求闰月
    assert.equal(lunarToSolar(2024, 2, 1, true), undefined, "2024 年无闰月，闰月组合应无效");
    // 闰月月份不匹配：2023 闰二月，却要求闰五月
    assert.equal(lunarToSolar(2023, 5, 1, true), undefined, "闰月月份不匹配应无效");
});

test("lunar：农历日期超出该月实际天数时拒绝（区分大小月）", () => {
    // 腊月（12 月）可能为 29 或 30 天；超出该月实际长度必须拒绝
    const year = 2024;
    let monthLength = 0;
    for (let d = 1; d <= 30; d += 1) {
        if (lunarToSolar(year, 12, d)) monthLength = d;
    }
    assert.ok(monthLength === 29 || monthLength === 30, `2024 年腊月长度应合法，实际 ${monthLength}`);
    assert.equal(lunarToSolar(year, 12, monthLength + 1), undefined, `腊月只有 ${monthLength} 天，超出应拒绝`);
});
