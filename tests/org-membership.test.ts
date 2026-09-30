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
    buildOrgLinksSection,
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

test("B13.5b 共同背景：同人多段收录一次取最早交集；多组织输出保持归属顺序", () => {
    const selfId = "20260930000000-self001";
    const peerA = "20260930000000-peer0001";
    const peerB = "20260930000000-peer0002";
    const org1 = "20260930000000-org0001";
    const org2 = "20260930000000-org0002";
    const m = (over: Partial<OrgMembership>): OrgMembership => ({
        id: "20260930000000-m000001", orgDocId: org1, personDocId: selfId,
        department: "", title: "", joinedOn: "", leftOn: "", status: "active", ...over,
    });
    const index = new Map<string, readonly OrgMembership[]>([
        [selfId, [
            m({ orgDocId: org1, joinedOn: "2020-01-01", leftOn: "2022-01-01" }),
            m({ id: "20260930000000-m000002", orgDocId: org1, joinedOn: "2024-01-01", leftOn: "" }),
            m({ id: "20260930000000-m000003", orgDocId: org2, joinedOn: "2024-06-01", leftOn: "" }),
        ]],
        // 甲在 org1 两段：第一段不相交（2018~2019），第二段与本人大段相交 → 收录一次取该交集
        [peerA, [
            m({ id: "20260930000000-m000004", orgDocId: org1, personDocId: peerA, joinedOn: "2018-01-01", leftOn: "2019-01-01" }),
            m({ id: "20260930000000-m000005", orgDocId: org1, personDocId: peerA, joinedOn: "2021-01-01", leftOn: "2023-01-01" }),
        ]],
        [peerB, [m({ id: "20260930000000-m000006", orgDocId: org2, personDocId: peerB, joinedOn: "2025-01-01", leftOn: "" })]],
    ]);
    const background = buildCommonOrgBackground({
        personDocId: selfId,
        membershipIndex: index,
        namesByDoc: new Map([[peerA, "甲"], [peerB, "乙"]]),
    });
    assert.deepEqual(background.map((entry) => entry.orgDocId), [org1, org2], "组织顺序随本人归属记录顺序");
    const [org1Entry, org2Entry] = background;
    assert.equal(org1Entry.peers.length, 1, "甲在 org1 多段只收录一次");
    assert.equal(org1Entry.peers[0].docId, peerA);
    assert.equal(org1Entry.peers[0].overlapText, "2021-01-01 ~ 2022-01-01", "重叠取最早起点的交集");
    assert.equal(org1Entry.peers[0].samePeriod, true, "双方加入时间已知 → 同期");
    assert.equal(org2Entry.peers.length, 1);
    assert.equal(org2Entry.peers[0].docId, peerB);
    assert.equal(org2Entry.peers[0].overlapText, "2025-01-01 ~ 至今");
});

test("B13.5b 共同背景规模：3000 名同组织同伴一次索引查询零重复零丢失", () => {
    const selfId = "20260930000000-self001";
    const org1 = "20260930000000-org0001";
    const index = new Map<string, readonly OrgMembership[]>([
        [selfId, [{
            id: "20260930000000-m000001", orgDocId: org1, personDocId: selfId,
            department: "", title: "", joinedOn: "2020-01-01", leftOn: "", status: "active",
        }]],
    ]);
    const names = new Map<string, string>();
    for (let i = 0; i < 3000; i += 1) {
        const peerDocId = `20260930000000-peer${String(i).padStart(4, "0")}`;
        names.set(peerDocId, `同僚${i}`);
        index.set(peerDocId, [{
            id: `20260930000000-m${String(i).padStart(7, "0")}`.slice(0, 22),
            orgDocId: org1, personDocId: peerDocId,
            department: "", title: "", joinedOn: "2021-01-01", leftOn: "", status: "active",
        }]);
    }
    const background = buildCommonOrgBackground({ personDocId: selfId, membershipIndex: index, namesByDoc: names });
    assert.equal(background.length, 1);
    const peers = background[0].peers;
    assert.equal(peers.length, 3000, "3000 名同组织同伴全部收录");
    assert.equal(new Set(peers.map((peer) => peer.docId)).size, 3000, "同伴零重复");
    assert.ok(peers.every((peer) => peer.samePeriod), "全员加入时间已知 → 全部同期");
    assert.equal(peers[0].docId, "20260930000000-peer0000", "同伴顺序稳定（索引首现序）");
    assert.equal(peers[2999].docId, "20260930000000-peer2999");
});

test("B13.7 组织归属链接区块：链接/括注拼接与空条目移除语义", () => {
    // 部门职位齐全 → （部门 · 职位）；只其一 → 单括注；皆无 → 无括注
    assert.equal(
        buildOrgLinksSection([
            { orgDocId: "20260930000000-org0001", orgName: "曙光科技", department: "研发中心", title: "高级工程师" },
            { orgDocId: "20260930000000-org0002", orgName: "母校学院", department: "计算机系", title: "" },
            { orgDocId: "20260930000000-org0003", orgName: "兴趣社团", department: "", title: "会长" },
            { orgDocId: "20260930000000-org0004", orgName: "行业协会", department: "", title: "" },
        ]),
        "**所属组织**：[曙光科技](siyuan://blocks/20260930000000-org0001)（研发中心 · 高级工程师）、"
        + "[母校学院](siyuan://blocks/20260930000000-org0002)（计算机系）、"
        + "[兴趣社团](siyuan://blocks/20260930000000-org0003)（会长）、"
        + "[行业协会](siyuan://blocks/20260930000000-org0004)",
    );
    // 空条目 → 空串（调用方据此移除区块）
    assert.equal(buildOrgLinksSection([]), "");
});
