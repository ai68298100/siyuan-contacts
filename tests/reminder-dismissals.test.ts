import assert from "node:assert/strict";
import test from "node:test";
import {
    isDismissed,
    normalizeDismissalStore,
    dismissalsFor,
} from "../src/domain/reminder-dismissals.ts";

const d = (personDocId: string, kind: "birthday" | "stale", until: string) => ({ personDocId, kind, until });

test("normalizeDismissalStore：丢弃非法条目、去重保留最后、坏包回空库", () => {
    const store = normalizeDismissalStore({
        schemaVersion: 1,
        dismissals: [
            d("20260927000000-aaaaaaa", "birthday", "2026-12-31"),
            d("bad-id", "stale", ""),
            d("20260927000000-bbbbbbb", "weekly", ""),
            d("20260927000000-ccccccc", "stale", "not-a-date"),
            d("20260927000000-aaaaaaa", "birthday", ""),
        ],
    });
    assert.deepEqual(store.dismissals, [
        d("20260927000000-aaaaaaa", "birthday", ""),
    ]);
    assert.deepEqual(normalizeDismissalStore({ schemaVersion: 2, dismissals: [] }).dismissals, []);
    assert.deepEqual(normalizeDismissalStore(null).dismissals, []);
});

test("isDismissed：until 含当天生效、过期失效、空串长期、按 kind 区分", () => {
    const dismissals = [
        d("20260927000000-aaaaaaa", "birthday", "2026-12-31"),
        d("20260927000000-bbbbbbb", "stale", "2026-09-27"),
        d("20260927000000-ccccccc", "stale", ""),
    ];
    assert.equal(isDismissed(dismissals, "20260927000000-aaaaaaa", "birthday", "2026-09-28"), true);
    assert.equal(isDismissed(dismissals, "20260927000000-aaaaaaa", "birthday", "2027-01-01"), false);
    assert.equal(isDismissed(dismissals, "20260927000000-bbbbbbb", "stale", "2026-09-27"), true);
    assert.equal(isDismissed(dismissals, "20260927000000-bbbbbbb", "stale", "2026-09-28"), false);
    assert.equal(isDismissed(dismissals, "20260927000000-ccccccc", "stale", "2030-01-01"), true);
    assert.equal(isDismissed(dismissals, "20260927000000-ccccccc", "birthday", "2026-09-28"), false);
});

test("dismissalsFor：按人物过滤", () => {
    const dismissals = [
        d("20260927000000-aaaaaaa", "birthday", ""),
        d("20260927000000-aaaaaaa", "stale", "2026-12-31"),
        d("20260927000000-bbbbbbb", "stale", ""),
    ];
    assert.equal(dismissalsFor(dismissals, "20260927000000-aaaaaaa").length, 2);
    assert.equal(dismissalsFor(dismissals, "20260927000000-bbbbbbb").length, 1);
});
