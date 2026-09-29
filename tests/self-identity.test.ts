import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeSelfIdentity, isSelfDoc, excludeSelf } from "../src/domain/self-identity.ts";

const IDENTITY = { schemaVersion: 1, selfDocId: "20260930000000-self001", selfItemId: "20260930000000-row0001", createdAt: "2026-09-30" };

test("B11 归一：合法身份通过；坏版本/坏 ID/坏日期/非对象返回 null", () => {
    assert.deepEqual(normalizeSelfIdentity(IDENTITY), IDENTITY);
    assert.equal(normalizeSelfIdentity(null), null);
    assert.equal(normalizeSelfIdentity({ ...IDENTITY, schemaVersion: 2 }), null);
    assert.equal(normalizeSelfIdentity({ ...IDENTITY, selfDocId: "blk-s1" }), null, "文档 ID 须过格式校验");
    assert.equal(normalizeSelfIdentity({ ...IDENTITY, createdAt: "2026/09/30" }), null);
});

test("B11 isSelfDoc/excludeSelf：本人保留在名册，统计面摘除", () => {
    const people = [
        { docId: IDENTITY.selfDocId, name: "我自己" },
        { docId: "20260930000000-other1", name: "张三" },
    ];
    assert.equal(isSelfDoc(IDENTITY, IDENTITY.selfDocId), true);
    assert.equal(isSelfDoc(IDENTITY, "20260930000000-other1"), false);
    assert.equal(isSelfDoc(null, IDENTITY.selfDocId), false, "无身份标记时不得误排");
    const kept = excludeSelf(people, IDENTITY);
    assert.deepEqual(kept.map((person) => person.name), ["张三"]);
    assert.equal(people.length, 2, "excludeSelf 不得改动原数组");
    assert.deepEqual(excludeSelf(people, null), people);
});
