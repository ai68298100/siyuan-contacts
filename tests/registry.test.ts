import assert from "node:assert/strict";
import test from "node:test";
import {
    daysBetween,
    ensureRegistryEntries,
    isWithinGrace,
    normalizeRegistryStore,
} from "../src/domain/registry.ts";

test("normalizeRegistryStore：丢弃非法键/非法日期，坏包回空库", () => {
    const store = normalizeRegistryStore({
        schemaVersion: 1,
        registeredAt: {
            "20260927000000-aaaaaaa": "2026-09-28",
            "bad-id": "2026-09-28",
            "20260927000000-bbbbbbb": "not-a-date",
            "20260927000000-ccccccc": "2026-02-30",
        },
    });
    assert.deepEqual(store.registeredAt, { "20260927000000-aaaaaaa": "2026-09-28" });
    assert.deepEqual(normalizeRegistryStore({ schemaVersion: 2 }).registeredAt, {});
    assert.deepEqual(normalizeRegistryStore(null).registeredAt, {});
});

test("ensureRegistryEntries：只补缺失键（幂等），已登记不动", () => {
    const first = ensureRegistryEntries(
        { schemaVersion: 1, registeredAt: {} },
        ["20260927000000-aaaaaaa", "20260927000000-bbbbbbb"],
        "2026-09-28",
    );
    assert.deepEqual(first.added, ["20260927000000-aaaaaaa", "20260927000000-bbbbbbb"]);
    assert.equal(first.registeredAt["20260927000000-aaaaaaa"], "2026-09-28");
    const second = ensureRegistryEntries(
        { schemaVersion: 1, registeredAt: first.registeredAt },
        ["20260927000000-aaaaaaa", "20260927000000-ccccccc"],
        "2026-10-05",
    );
    assert.deepEqual(second.added, ["20260927000000-ccccccc"]);
    assert.equal(first.registeredAt["20260927000000-aaaaaaa"], "2026-09-28", "已登记键不应被覆盖");
});

test("isWithinGrace：宽限期内 true、到期 false、未登记视为首次发现、0 关闭", () => {
    assert.equal(isWithinGrace("2026-09-20", "2026-09-28", 14), true, "第 8 天在宽限内");
    assert.equal(isWithinGrace("2026-09-14", "2026-09-28", 14), false, "第 14 天到期（差值 ≥14 不再豁免）");
    assert.equal(isWithinGrace(undefined, "2026-09-28", 14), true, "未登记按首次发现宽限");
    assert.equal(isWithinGrace("2026-09-14", "2026-09-28", 0), false, "0 关闭宽限");
    assert.equal(isWithinGrace("bad-date", "2026-09-28", 14), false, "非法日期按已过期");
});

test("daysBetween：自然日差", () => {
    assert.equal(daysBetween("2026-09-28", "2026-09-28"), 0);
    assert.equal(daysBetween("2026-09-27", "2026-09-28"), 1);
    assert.equal(daysBetween("2026-08-29", "2026-09-28"), 30);
});
