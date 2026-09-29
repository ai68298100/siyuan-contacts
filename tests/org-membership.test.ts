import { test } from "node:test";
import assert from "node:assert/strict";
import {
    normalizeOrgMembershipStore,
    normalizeOrgMembershipStoreForWrite,
    appendMembership,
    removeMembership,
} from "../src/domain/org-membership.ts";
import type { OrgMembership } from "../src/domain/org-membership.ts";

const ID = /^\d{14}-[0-9a-z]{7}$/;

function membership(partial: Partial<OrgMembership> & { id: string }): OrgMembership {
    return {
        orgDocId: "20260930000000-org0001",
        personDocId: "20260930000000-per0001",
        department: "",
        title: "",
        joinedOn: "2026-01-01",
        leftOn: "",
        status: "active",
        ...partial,
    };
}

test("B13 归一：合法条目保留；坏 ID/坏状态/坏日期过滤；按 id 去重", () => {
    const store = normalizeOrgMembershipStore({
        schemaVersion: 1,
        memberships: [
            membership({ id: "20260930000000-m000001" }),
            membership({ id: "20260930000000-m000002", status: "former", leftOn: "2026-06-30", department: "研发部", title: "工程师" }),
            { id: "bad-id" },
            membership({ id: "20260930000000-m000003", status: "weird" }),
            membership({ id: "20260930000000-m000004", joinedOn: "2026/01/01" }),
            membership({ id: "20260930000000-m000001" }),
        ],
    });
    assert.deepEqual(store.memberships.map((entry) => entry.id), [
        "20260930000000-m000001",
        "20260930000000-m000002",
    ]);
    assert.equal(store.memberships[1].department, "研发部");
    assert.equal(store.memberships[1].status, "former");
});

test("B13 写前严格：坏版本/坏条目整体拒绝；空串/null 引导空库", () => {
    assert.throws(() => normalizeOrgMembershipStoreForWrite({ schemaVersion: 2, memberships: [] }), /内容损坏/);
    assert.throws(
        () => normalizeOrgMembershipStoreForWrite({ schemaVersion: 1, memberships: [{ id: "broken" }] }),
        /内容损坏/,
    );
    assert.deepEqual(normalizeOrgMembershipStoreForWrite(null).memberships, []);
    assert.deepEqual(normalizeOrgMembershipStoreForWrite("").memberships, []);
});

test("B13 append/remove：幂等增删（纯函数）", () => {
    let store = normalizeOrgMembershipStore({ schemaVersion: 1, memberships: [] });
    const m = membership({ id: "20260930000000-m000001" });
    store = appendMembership(store, m);
    store = appendMembership(store, m);
    assert.equal(store.memberships.length, 1, "重复追加应幂等");
    store = removeMembership(store, "20260930000000-m000001");
    assert.equal(store.memberships.length, 0);
    const unchanged = removeMembership(store, "missing");
    assert.equal(unchanged, store, "删除不存在 id 应原样返回");
});
