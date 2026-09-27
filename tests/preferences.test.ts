import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_VIEW_PREFERENCES, normalizeTableColumns, normalizeViewPreferences } from "../src/domain/preferences.ts";

test("视图偏好：空存储回退默认值", () => {
    assert.deepEqual(normalizeViewPreferences(null), DEFAULT_VIEW_PREFERENCES);
});

test("视图偏好：非法枚举回退，数值限制在 0-365", () => {
    const result = normalizeViewPreferences({
        defaultView: "unknown",
        peopleSort: "unknown",
        openOnStartup: "yes",
        birthdayWindowDays: 999,
        staleThresholdDays: -8,
    });
    assert.equal(result.defaultView, "home");
    assert.equal(result.peopleSort, "name");
    assert.equal(result.openOnStartup, false);
    assert.equal(result.aiEnabled, true);
    assert.equal(result.birthdayWindowDays, 365);
    assert.equal(result.staleThresholdDays, 0);
});

test("显示偏好：旧偏好缺字段回退默认形态与全列", () => {
    const result = normalizeViewPreferences({ peopleSort: "recent" });
    assert.equal(result.peopleView, DEFAULT_VIEW_PREFERENCES.peopleView);
    assert.deepEqual(result.tableColumns, DEFAULT_VIEW_PREFERENCES.tableColumns);
    assert.equal(result.peopleSort, "recent");
});

test("显示偏好：非法形态回退卡片，非法键与重复键剔除且保留用户顺序", () => {
    const result = normalizeViewPreferences({
        peopleView: "grid",
        tableColumns: ["phone", "phone", "name", "秘密列", "tags", "group", 42, null],
    });
    assert.equal(result.peopleView, "card");
    assert.deepEqual(result.tableColumns, ["phone", "tags", "group"]);
});

test("显示偏好：全部列无效或显式清空时回退全列默认", () => {
    assert.deepEqual(normalizeTableColumns(["name", "wechat", "wechat"]), ["wechat"]);
    assert.deepEqual(normalizeViewPreferences({ tableColumns: [] }), { ...DEFAULT_VIEW_PREFERENCES, tableColumns: DEFAULT_VIEW_PREFERENCES.tableColumns });
    assert.deepEqual(normalizeViewPreferences({ tableColumns: "phone" }).tableColumns, DEFAULT_VIEW_PREFERENCES.tableColumns);
});

test("显示偏好：合法自定义顺序原样保留", () => {
    const result = normalizeViewPreferences({ peopleView: "table", tableColumns: ["birthday", "phone"] });
    assert.equal(result.peopleView, "table");
    assert.deepEqual(result.tableColumns, ["birthday", "phone"]);
});
