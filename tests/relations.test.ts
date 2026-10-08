import { test } from "node:test";
import assert from "node:assert/strict";
import { nextRelatedItemIds, relationRetryKey } from "../src/domain/relations.ts";

test("关系增量基于最新列表幂等去重", () => {
    assert.deepEqual(nextRelatedItemIds("add", ["item-a", "item-a"], "item-b"), {
        changed: true,
        relatedItemIds: ["item-a", "item-b"],
    });
    assert.deepEqual(nextRelatedItemIds("add", ["item-a"], "item-a"), {
        changed: false,
        relatedItemIds: ["item-a"],
    });
    assert.deepEqual(nextRelatedItemIds("remove", ["item-a", "item-b"], "item-a"), {
        changed: true,
        relatedItemIds: ["item-b"],
    });
    assert.deepEqual(nextRelatedItemIds("remove", ["item-b"], "item-a"), {
        changed: false,
        relatedItemIds: ["item-b"],
    });
});

test("关系投影重试键包含文档和当前事实快照", () => {
    assert.equal(
        relationRetryKey("20260101000000-abcdefg", ["item-b", "item-c"]),
        "relation-projection:20260101000000-abcdefg:item-b,item-c",
    );
});
