import { test } from "node:test";
import assert from "node:assert/strict";
import {
    normalizeOrgMembershipStore,
    normalizeOrgMembershipStoreForWrite,
    appendMembership,
    removeMembership,
    applyMembershipPatch,
    updateMembership,
    buildCommonOrgBackground,
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

test("B13.4 成员编辑：字段更新白名单与日期校验（写前拒绝）", () => {
    const m = membership({ id: "20260930000000-m000002" });
    const patched = applyMembershipPatch(m, { department: " 研发部 ", title: "工程师", joinedOn: "2024-01-02", status: "former" });
    assert.ok(patched);
    assert.equal(patched.department, "研发部");
    assert.equal(patched.status, "former");
    assert.equal(patched.id, m.id, "身份字段不可变");
    assert.equal(patched.orgDocId, m.orgDocId);
    assert.equal(patched.personDocId, m.personDocId);
    // 非法日期写前拒绝；不修改原对象
    assert.equal(applyMembershipPatch(m, { joinedOn: "2024/01/02" }), null);
    assert.equal(applyMembershipPatch(m, { leftOn: "昨天" }), null);
    assert.equal(applyMembershipPatch(m, { status: "paused" as never }), null);
    assert.deepEqual(m, membership({ id: "20260930000000-m000002" }), "原对象不被修改");
});

test("B13.4 成员编辑：store 级更新与查无此 id", () => {
    const m = membership({ id: "20260930000000-m000003" });
    const store = appendMembership(normalizeOrgMembershipStore({ schemaVersion: 1, memberships: [] }), m);
    const next = updateMembership(store, "20260930000000-m000003", { title: "顾问" });
    assert.ok(next && next !== store);
    assert.equal(next.memberships[0].title, "顾问");
    assert.equal(updateMembership(store, "missing", { title: "x" }), null, "查无此 id 返回 null");
    assert.equal(updateMembership(store, "20260930000000-m000003", { joinedOn: "bad" }), null, "非法补丁返回 null");
});

test("B13.6 共同背景：重叠期间与同期推断（时间未知不推断）", () => {
    const selfId = "20260930000000-self001";
    const peerA = "20260930000000-peer0001";
    const peerB = "20260930000000-peer0002";
    const peerC = "20260930000000-peer0003";
    const org1 = "20260930000000-org0001";
    const org2 = "20260930000000-org0002";
    const m = (over: Partial<OrgMembership>): OrgMembership => ({
        id: "20260930000000-m000001", orgDocId: org1, personDocId: selfId,
        department: "", title: "", joinedOn: "", leftOn: "", status: "active", ...over,
    });
    const index = new Map<string, readonly OrgMembership[]>([
        [selfId, [
            m({ orgDocId: org1, joinedOn: "2023-01-01", leftOn: "" }),
            m({ id: "20260930000000-m000002", orgDocId: org2, joinedOn: "2020-01-01", leftOn: "2021-12-31" }),
        ]],
        [peerA, [m({ id: "20260930000000-m000003", orgDocId: org1, personDocId: peerA, joinedOn: "2024-06-01", leftOn: "2025-05-31" })]],
        // 同组织但 joinedOn 未知：收录为同组织，不推断同期
        [peerB, [m({ id: "20260930000000-m000004", orgDocId: org1, personDocId: peerB, joinedOn: "" })]],
        // 期间不相交：不收录
        [peerC, [m({ id: "20260930000000-m000005", orgDocId: org2, personDocId: peerC, joinedOn: "2023-01-01" })]],
    ]);
    const names = new Map([[peerA, "甲"], [peerB, "乙"], [peerC, "丙"], [selfId, "我自己"]]);
    const background = buildCommonOrgBackground({ personDocId: selfId, membershipIndex: index, namesByDoc: names });
    assert.equal(background.length, 1, "org2 与丙期间不相交，唯一背景应是 org1");
    const org1Entry = background[0];
    assert.equal(org1Entry.orgDocId, org1);
    assert.equal(org1Entry.peers.length, 2, "只有甲乙同 org1 有交集");
    const peerAEntry = org1Entry.peers.find((peer) => peer.docId === peerA);
    assert.ok(peerAEntry);
    assert.equal(peerAEntry.samePeriod, true, "双方加入时间已知且交集非空 → 同期");
    assert.equal(peerAEntry.overlapText, "2024-06-01 ~ 2025-05-31");
    const peerBEntry = org1Entry.peers.find((peer) => peer.docId === peerB);
    assert.ok(peerBEntry);
    assert.equal(peerBEntry.samePeriod, false, "对方加入时间未知 → 不推断同期");
    assert.equal(peerBEntry.overlapText, "2023-01-01 ~ 至今");
    // 空成员记录 → 空背景
    assert.deepEqual(buildCommonOrgBackground({ personDocId: peerC, membershipIndex: new Map(), namesByDoc: names }), []);
});

test("B13.6 共同背景：组织名解析与归档组织纳入", () => {
    const selfId = "20260930000000-self001";
    const peerA = "20260930000000-peer0001";
    const org1 = "20260930000000-org0001";
    const m = (over: Partial<OrgMembership>): OrgMembership => ({
        id: "20260930000000-m000001", orgDocId: org1, personDocId: selfId,
        department: "", title: "", joinedOn: "", leftOn: "", status: "former", ...over,
    });
    const index = new Map<string, readonly OrgMembership[]>([
        [selfId, [m({ joinedOn: "2020-01-01", leftOn: "2022-01-01" })]],
        [peerA, [m({ id: "20260930000000-m000002", orgDocId: org1, personDocId: peerA, joinedOn: "2021-01-01", leftOn: "" })]],
    ]);
    const background = buildCommonOrgBackground({
        personDocId: selfId,
        membershipIndex: index,
        namesByDoc: new Map([[peerA, "甲"]]),
        orgNames: new Map([[org1, "旧东家"]]),
    });
    assert.equal(background.length, 1);
    assert.equal(background[0].orgName, "旧东家");
    assert.equal(background[0].peers[0].overlapText, "2021-01-01 ~ 2022-01-01");
    // 未知组织名降级占位
    const unknown = buildCommonOrgBackground({
        personDocId: selfId, membershipIndex: index, namesByDoc: new Map([[peerA, "甲"]]),
    });
    assert.equal(unknown[0].orgName, "（组织文档不可达）");
});
