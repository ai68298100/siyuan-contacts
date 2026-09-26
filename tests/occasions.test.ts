import { test } from "node:test";
import assert from "node:assert/strict";
import { nextBirthday, bucketOf, upcomingBirthdays } from "../src/domain/occasions.ts";
import { lunarToSolar, solarToLunar } from "../src/domain/lunar.ts";
import type { ContactSummary } from "../src/domain/person.ts";

function person(partial: Partial<ContactSummary>): ContactSummary {
    return {
        docId: "d", itemId: "i", name: "测试", phone: "", email: "", wechat: "", website: "",
        birthday: "", isLunar: false, group: "", tags: [], relatedItemIds: [],
        ...partial,
    };
}

test("公历生日：今年未过用今年，已过用明年", () => {
    const now = new Date(2026, 8, 27); // 2026-09-27
    const ahead = nextBirthday("1990-09-30", false, now);
    assert.ok(ahead);
    assert.equal(ahead.daysUntil, 3);
    assert.equal(ahead.age, 36);
    assert.equal(ahead.label, "9月30日");

    const today = nextBirthday("1990-09-27", false, now);
    assert.ok(today);
    assert.equal(today.daysUntil, 0);

    const passed = nextBirthday("1980-01-01", false, now);
    assert.ok(passed);
    assert.equal(passed.date.getFullYear(), 2027);
    assert.equal(passed.age, 47);
});

test("公历 2月29日：平年顺延 3月1日，闰年当年仍是 2月29", () => {
    // 2027 平年：生日视为 2027-03-01
    const now = new Date(2027, 1, 1);
    const flat = nextBirthday("1992-02-29", false, now);
    assert.ok(flat);
    assert.equal(flat.date.getFullYear(), 2027);
    assert.equal(flat.date.getMonth(), 2);
    assert.equal(flat.date.getDate(), 1);
    // 2028 闰年：当年仍有 2/29
    const leapNow = new Date(2028, 1, 1);
    const leap = nextBirthday("1992-02-29", false, leapNow);
    assert.ok(leap);
    assert.equal(leap.date.getFullYear(), 2028);
    assert.equal(leap.date.getMonth(), 1);
    assert.equal(leap.date.getDate(), 29);
});

test("农历生日：按农历月日换算，今年已过顺延明年", () => {
    const now = new Date(2026, 8, 27);
    // 1990-01-01 按农历解读：1990 年正月初一
    const birthLunar = solarToLunar(new Date(1990, 0, 1));
    assert.ok(birthLunar, "出生日应在换算表范围内");
    const projection = nextBirthday("1990-01-01", true, now);
    assert.ok(projection);
    // 与换算原语自洽：目标日 = 农历(某年, 出生月日) 的公历
    const targetLunarYear = solarToLunar(projection.date)?.year;
    assert.ok(targetLunarYear);
    const expected = lunarToSolar(targetLunarYear, birthLunar.month, birthLunar.day);
    assert.ok(expected);
    assert.equal(projection.date.getTime(), expected.getTime());
    assert.ok(projection.daysUntil >= 0);
});

test("bucketOf 分桶", () => {
    assert.equal(bucketOf(0), "today");
    assert.equal(bucketOf(7), "week");
    assert.equal(bucketOf(8), "month");
    assert.equal(bucketOf(31), "later");
});

test("upcomingBirthdays：过滤无生日、按天数升序", () => {
    const now = new Date(2026, 8, 27);
    const list = upcomingBirthdays(
        [
            person({ name: "无生日" }),
            person({ name: "十天", birthday: "1990-10-07", itemId: "i2", docId: "d2" }),
            person({ name: "三天", birthday: "1990-09-30", itemId: "i1", docId: "d1" }),
            person({ name: "非法", birthday: "1990/1/1", itemId: "i3", docId: "d3" }),
        ],
        now,
    );
    assert.equal(list.length, 2);
    assert.equal(list[0].person.name, "三天");
    assert.equal(list[1].person.name, "十天");
});
