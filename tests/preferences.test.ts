import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_VIEW_PREFERENCES, normalizeViewPreferences } from "../src/domain/preferences.ts";

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
