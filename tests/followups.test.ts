import assert from "node:assert/strict";
import test from "node:test";
import {
    addDaysToDate,
    appendFollowUp,
    daysBetween,
    dueLabel,
    emptyFollowUpStore,
    followUpsForPerson,
    isValidDateKey,
    nextMondayFrom,
    normalizeFollowUpStore,
    normalizeFollowUpStoreForWrite,
    projectOpenFollowUps,
    sameDayNextMonth,
    snoozedDueDate,
    updateFollowUp,
} from "../src/domain/followups.ts";
import type { FollowUpItem } from "../src/domain/followups.ts";

function item(partial: Partial<FollowUpItem> & { id: string }): FollowUpItem {
    return {
        personDocId: "doc-1", title: "", dueDate: "2026-09-28", status: "open",
        createdAt: 1, updatedAt: 1, ...partial,
    };
}

test("日期工具：加天、下周一、次月收敛与闰日校验", () => {
    assert.equal(addDaysToDate("2026-09-28", 3), "2026-10-01");
    assert.equal(addDaysToDate("2026-12-31", 1), "2027-01-01");
    // 2026-09-28 是周一 → 下周一 +7；周日的下周一 +1
    assert.equal(nextMondayFrom("2026-09-28"), "2026-10-05");
    assert.equal(nextMondayFrom("2026-09-27"), "2026-09-28");
    assert.equal(sameDayNextMonth("2026-01-31"), "2026-02-28");
    assert.equal(sameDayNextMonth("2026-09-28"), "2026-10-28");
    assert.equal(isValidDateKey("2026-02-29"), false);
    assert.equal(isValidDateKey("2028-02-29"), true);
    assert.equal(isValidDateKey(""), false);
    assert.equal(daysBetween("2026-09-28", "2026-09-30"), 2);
});

test("推迟语义：明天/三天/下周一/次月/指定日期；非法指定日期返回空串", () => {
    const today = "2026-09-28";
    assert.equal(snoozedDueDate("tomorrow", today), "2026-09-29");
    assert.equal(snoozedDueDate("threeDays", today), "2026-10-01");
    assert.equal(snoozedDueDate("nextMonday", today), "2026-10-05");
    assert.equal(snoozedDueDate("nextMonth", today), "2026-10-28");
    assert.equal(snoozedDueDate("nextMonth", "2026-01-31"), "2026-02-28");
    assert.equal(snoozedDueDate("custom", today, "2026-10-15"), "2026-10-15");
    assert.equal(snoozedDueDate("custom", today, "2026-10-32"), "");
    assert.equal(snoozedDueDate("custom", today), "");
});

test("归一化：坏条目容错过滤、按 id 去重；写前严格模式抛错；空串可首次保存", () => {
    const store = normalizeFollowUpStore({
        schemaVersion: 1,
        items: [
            item({ id: "a" }),
            item({ id: "a", dueDate: "2026-10-01" }),
            item({ id: "b", dueDate: "bogus" }),
            item({ id: "c", status: "weird" }),
            null,
        ],
    });
    assert.deepEqual(store.items.map((entry) => entry.id), ["a"]);
    assert.throws(() => normalizeFollowUpStoreForWrite({ schemaVersion: 99, items: [] }));
    assert.throws(() => normalizeFollowUpStoreForWrite({ schemaVersion: 1, items: [{ id: "x" }] }));
    assert.deepEqual(normalizeFollowUpStoreForWrite(""), emptyFollowUpStore());
    assert.deepEqual(normalizeFollowUpStoreForWrite(null), emptyFollowUpStore());
});

test("状态与投影：完成写 closedAt、重开清除；逾期/今天/未来分桶稳定排序", () => {
    let store = normalizeFollowUpStore({ schemaVersion: 1, items: [item({ id: "a" })] });
    store = updateFollowUp(store, "a", { status: "done", closedAt: 99, updatedAt: 99 });
    assert.equal(store.items[0].status, "done");
    assert.equal(store.items[0].closedAt, 99);
    store = updateFollowUp(store, "a", { status: "open", closedAt: undefined, updatedAt: 100 });
    assert.equal(store.items[0].closedAt, undefined);
    assert.equal(updateFollowUp(store, "missing", { status: "done" }), store);
    assert.equal(appendFollowUp(store, store.items[0]), store);

    const today = "2026-09-28";
    const items = [
        item({ id: "u1", dueDate: "2026-10-05" }),
        item({ id: "o2", dueDate: "2026-09-20" }),
        item({ id: "d1", dueDate: "2026-09-28", status: "done" as const }),
        item({ id: "t1", dueDate: "2026-09-28" }),
        item({ id: "o1", dueDate: "2026-09-21" }),
    ];
    const buckets = projectOpenFollowUps(items, today);
    assert.deepEqual(buckets.overdue.map((entry) => entry.id), ["o2", "o1"]);
    assert.deepEqual(buckets.today.map((entry) => entry.id), ["t1"]);
    assert.deepEqual(buckets.upcoming.map((entry) => entry.id), ["u1"]);
});

test("到期文案与人物过滤：逾期/今天/还有 N 天；closed 置后", () => {
    const today = "2026-09-28";
    assert.equal(dueLabel("2026-09-21", today), "逾期 7 天");
    assert.equal(dueLabel("2026-09-28", today), "今天");
    assert.equal(dueLabel("2026-10-02", today), "还有 4 天");
    const items = [
        item({ id: "closed", status: "cancelled" as const, closedAt: 5, dueDate: "2026-10-01" }),
        item({ id: "open-later", dueDate: "2026-10-10" }),
        item({ id: "other", personDocId: "doc-2", dueDate: "2026-09-29" }),
        item({ id: "open-soon", dueDate: "2026-09-29" }),
    ];
    assert.deepEqual(followUpsForPerson(items, "doc-1").map((entry) => entry.id), ["open-soon", "open-later", "closed"]);
});
