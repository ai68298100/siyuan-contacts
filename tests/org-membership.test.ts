import { test } from "node:test";
import assert from "node:assert/strict";
import {
    normalizeOrgMembershipStore,
    normalizeOrgMembershipStoreForWrite,
    appendMembership,
    removeMembership,
    applyMembershipPatch,
    updateMembership,
    replaceMembership,
    buildCommonOrgBackground,
    pageOrgMemberships,
    sortOrgMemberships,
    projectPersonAffiliations,
} from "../src/domain/org-membership.ts";
import type { OrgMembership } from "../src/domain/org-membership.ts";
import { buildOrgProjectionTargets, orgProjectionSourceSnapshot, parseOrgProjectionOperationStore } from "../src/domain/org-projections.ts";
import { mergeOrgMembershipBackup } from "../src/domain/migration-records.ts";

const ID = /^\d{14}-[0-9a-z]{7}$/;

test("B13 成员删除标记：旧库兼容、删除原子登记、坏标记整体拒绝", () => {
    const original = membership({ id: "20261004000000-m000001" });
    const store = normalizeOrgMembershipStoreForWrite({ schemaVersion: 1, memberships: [original] });
    assert.equal(store.tombstones, undefined);
    const deleted = removeMembership(store, original.id);
    assert.deepEqual(deleted.tombstones, [original.id]);
    assert.equal(appendMembership(deleted, original), deleted);
    for (const tombstones of [null, ["bad"], [original.id, original.id], [original.id]]) {
        assert.throws(() => normalizeOrgMembershipStoreForWrite({ ...store, tombstones }), /内容损坏/);
    }
    assert.equal(store.memberships.length, 1);
});

test("B13 成员迁移：删除优先、重复零新增，历史稳定 ID 不猜测合并", () => {
    const original = membership({ id: "20261004000000-m000001" });
    const historical = { ...original, id: "20261004000000-m000002", status: "former" as const, leftOn: "2026-03-01" };
    const current = removeMembership({ schemaVersion: 1, memberships: [original] }, original.id);
    const incoming = { schemaVersion: 1 as const, memberships: [original, historical, { ...historical, id: "20261004000000-m000003" }] };
    const merged = mergeOrgMembershipBackup(current, incoming, new Set([original.personDocId]), new Set([original.orgDocId]));
    assert.deepEqual(merged.store.memberships.map((entry) => entry.id), [historical.id, "20261004000000-m000003"]);
    assert.equal(merged.summary.merged, 2);
    assert.equal(merged.summary.skipped, 1);
    assert.equal(mergeOrgMembershipBackup(merged.store, incoming, new Set(), new Set()).summary.merged, 0);
    const removed = mergeOrgMembershipBackup({ schemaVersion: 1, memberships: [original] }, current, new Set(), new Set());
    assert.equal(removed.summary.removed, 1);
    assert.deepEqual(removed.store.tombstones, [original.id]);
});

test("B13 成员迁移：同 ID 与第二当前记录冲突保现状，双方不可达逐项定位", () => {
    const original = membership({ id: "20261004000000-m000001" });
    const incoming = { schemaVersion: 1 as const, memberships: [
        { ...original, title: "旧职位" }, { ...original, id: "20261004000000-m000002" },
        { ...original, id: "20261004000000-m000003", personDocId: "20261004000000-per0002" },
        { ...original, id: "20261004000000-m000004", orgDocId: "20261004000000-org0002" },
    ] };
    const result = mergeOrgMembershipBackup({ schemaVersion: 1, memberships: [original] }, incoming,
        new Set([original.personDocId]), new Set([original.orgDocId]));
    assert.deepEqual(result.store.memberships, [original]);
    assert.deepEqual(result.summary.issues.map((entry) => entry.reason), ["conflict", "conflict", "unreachable", "unreachable"]);
    assert.ok(result.summary.issues.every((entry) => entry.orgDocId && entry.personDocId));
    const legacy = mergeOrgMembershipBackup({ schemaVersion: 1, memberships: [original] },
        { schemaVersion: 1, memberships: [{ ...original, affiliationKind: "unspecified" }] }, new Set(), new Set());
    assert.equal(legacy.summary.issues.length, 0);
});

test("B13 成员期间：真实日历、先后顺序与当前状态一致，非法输入保持原事实", () => {
    const original = membership({ id: "20261004000000-m000001" });
    for (const patch of [{ joinedOn: "2026-02-29" }, { joinedOn: "2026-04-31" },
        { status: "former" as const, leftOn: "2025-12-31" }, { leftOn: "2026-03-01" }]) {
        assert.equal(applyMembershipPatch(original, patch), null);
    }
    assert.ok(applyMembershipPatch(original, { joinedOn: "2024-02-29" }));
    assert.ok(applyMembershipPatch(original, { status: "former", leftOn: "" }));
    assert.equal(original.status, "active");
    assert.throws(() => normalizeOrgMembershipStoreForWrite({ schemaVersion: 1, memberships: [{ ...original, joinedOn: "2026-02-29" }] }), /内容损坏/);
});

test("B13 成员恢复：不得与另一当前期间并存，重复编辑零变更，替补非法零半成品", () => {
    const former = membership({ id: "20261004000000-m000001", status: "former", leftOn: "2026-03-01" });
    const current = membership({ id: "20261004000000-m000002", joinedOn: "2026-04-01" });
    const store = { schemaVersion: 1 as const, memberships: [former, current] };
    assert.equal(updateMembership(store, former.id, { status: "active", leftOn: "" }), null);
    assert.equal(updateMembership(store, current.id, { title: current.title }), store);
    assert.ok(updateMembership({ ...store, memberships: [former] }, former.id, { status: "active", leftOn: "" }));
    assert.throws(() => normalizeOrgMembershipStoreForWrite({ ...store, memberships: [current, { ...current, id: former.id }] }), /多条当前成员/);
    assert.equal(replaceMembership(store, current.id, { ...current, id: "20261004000000-m000003", personDocId: "20261004000000-other01", joinedOn: "2026-02-30" }, "2026-05-01"), null);
    assert.equal(store.memberships[1].status, "active");
});

test("B13 双链域：当前、历史和归档分源，同名人员/多段任职保留稳定链接", () => {
    const org = { docId: "20261004000000-org0001", name: "学校 [甲]", hpath: "/学校", notebookId: "20261004000000-book001", archived: false };
    const first = { docId: "20261004000000-per0001", name: "同名" };
    const second = { docId: "20261004000000-per0002", name: "同名" };
    const source = { organizations: [org], people: [first, second], memberships: [
        membership({ id: "20261004000000-m000001", orgDocId: org.docId, personDocId: first.docId, affiliationKind: "work", title: "老师" }),
        membership({ id: "20261004000000-m000002", orgDocId: org.docId, personDocId: second.docId, affiliationKind: "education", title: "学生" }),
        membership({ id: "20261004000000-m000003", orgDocId: org.docId, personDocId: first.docId, status: "former", leftOn: "2026-04-01", title: "旧职位" }),
    ] };
    const before = structuredClone(source);
    const targets = buildOrgProjectionTargets(source);
    const organization = targets.find((target) => target.kind === "organization")!;
    assert.ok(organization.markdown.includes(first.docId) && organization.markdown.includes(second.docId));
    assert.ok(!organization.markdown.includes("旧职位"));
    assert.ok(targets.find((target) => target.docId === first.docId)!.markdown.includes("学校 \\[甲\\]"));
    assert.ok(!organization.retryKey.includes(first.name));
    const archived = buildOrgProjectionTargets({ ...source, organizations: [{ ...org, archived: true }] });
    assert.ok(archived.every((target) => target.markdown === ""));
    assert.deepEqual(source, before);
    assert.equal(orgProjectionSourceSnapshot(source), orgProjectionSourceSnapshot({ ...source, people: [...source.people].reverse(), memberships: [...source.memberships].reverse() }));
});

test("B13 双链域：孤儿和重复文档绑定阻断受影响目标，不清空旧投影", () => {
    const org = { docId: "20261004000000-org0001", name: "单位", hpath: "/单位", notebookId: "20261004000000-book001", archived: false };
    const person = { docId: "20261004000000-per0001", name: "人物" };
    const source = { organizations: [org], people: [person, person], memberships: [membership({ id: "20261004000000-m000001", orgDocId: org.docId, personDocId: person.docId })] };
    const duplicate = buildOrgProjectionTargets(source);
    assert.ok(duplicate.every((target) => target.blockers.length > 0));
    const orphan = buildOrgProjectionTargets({ ...source, organizations: [], people: [person] });
    assert.ok(orphan.every((target) => target.blockers.length > 0));
    const unregistered = buildOrgProjectionTargets({ ...source, people: [] });
    assert.ok(unregistered.every((target) => target.blockers.length > 0));
});

test("B13 投影断点：旧缺键为空，未知版本/损坏/重复目标拒绝，不丢待核实请求", () => {
    const operation = { id: "20261004000000-req0001", docId: "20261004000000-per0001", attrName: "custom-lvct-orgs", markdown: "待核实", state: "pending", updatedAt: 100 };
    assert.deepEqual(parseOrgProjectionOperationStore(null), { schemaVersion: 1, operations: [] });
    assert.equal(parseOrgProjectionOperationStore({ schemaVersion: 1, operations: [operation] }).operations[0].state, "pending");
    for (const operations of [[{ ...operation, docId: "bad" }], [{ ...operation, attrName: "custom-lvct-org" }], [{ ...operation, state: "done" }],
        [operation, { ...operation, id: "20261004000000-req0002" }]]) {
        assert.throws(() => parseOrgProjectionOperationStore({ schemaVersion: 1, operations }), /组织投影断点存储内容损坏/);
    }
});

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

test("B12 旧成员保持未分类，分类清空保留身份、职位和历史", () => {
    const original = membership({ id: "20261004000000-m000001", status: "former", leftOn: "2026-03-01", title: "研究员" });
    const legacy = normalizeOrgMembershipStoreForWrite({ schemaVersion: 1, memberships: [original] });
    assert.equal(legacy.memberships[0].affiliationKind, undefined);
    const classified = applyMembershipPatch(original, { affiliationKind: "education" });
    assert.ok(classified);
    const cleared = applyMembershipPatch(classified, { affiliationKind: "unspecified" });
    assert.deepEqual(cleared, { ...original, affiliationKind: "unspecified" });
    assert.equal(applyMembershipPatch(original, { affiliationKind: "school" as never }), null);
    assert.equal(original.affiliationKind, undefined);
});

test("B12 严格成员读取拒绝坏 ID、重复和未知分类，不过滤后写回", () => {
    const valid = membership({ id: "20261004000000-m000001", affiliationKind: "work" });
    for (const memberships of [
        [valid, { ...valid, id: "bad-id" }],
        [valid, { ...valid, id: "20261004000000-m000002", orgDocId: "bad-org" }],
        [valid, { ...valid }],
        [valid, { ...valid, id: "20261004000000-m000002", affiliationKind: "school" }],
        [valid, { ...valid, id: "20261004000000-m000002", title: 123 }],
    ]) {
        const raw = { schemaVersion: 1, memberships };
        const snapshot = structuredClone(raw);
        assert.throws(() => normalizeOrgMembershipStoreForWrite(raw), /组织成员存储内容损坏/);
        assert.deepEqual(raw, snapshot);
    }
});

test("B12 多单位/学校与历史、归档、不可达按稳定成员身份投影", () => {
    const personDocId = "20261004000000-per0001";
    const organization = "20261004000000-org0001";
    const records = [
        membership({ id: "20261004000000-m000001", orgDocId: organization, personDocId, affiliationKind: "work", title: "讲师" }),
        membership({ id: "20261004000000-m000002", orgDocId: organization, personDocId, affiliationKind: "education", title: "博士生" }),
        membership({ id: "20261004000000-m000003", personDocId, affiliationKind: "work" }),
        membership({ id: "20261004000000-m000004", personDocId }),
        membership({ id: "20261004000000-m000005", personDocId, affiliationKind: "education", status: "former", leftOn: "2026-04-01" }),
        membership({ id: "20261004000000-m000006", orgDocId: "20261004000000-org0002", personDocId, affiliationKind: "work" }),
        membership({ id: "20261004000000-m000007", orgDocId: "20261004000000-org0003", personDocId, affiliationKind: "work" }),
        membership({ id: "20261004000000-m000008", orgDocId: organization, personDocId: "20261004000000-per0002", affiliationKind: "education" }),
    ];
    const snapshot = structuredClone(records);
    const organizations = new Map([
        [organization, { name: "某大学", archived: false }],
        ["20260930000000-org0001", { name: "另一单位", archived: false }],
        ["20261004000000-org0002", { name: "归档单位", archived: true }],
    ]);
    const projected = projectPersonAffiliations(personDocId, records, organizations);
    assert.equal(projected.work.length, 2);
    assert.equal(projected.education.length, 1);
    assert.equal(projected.education[0].orgName, "某大学");
    assert.equal(projected.unspecified.length, 1);
    assert.deepEqual(projected.history.map((item) => item.scope).sort(), ["archived", "former"]);
    assert.equal(projected.unresolved[0].id, "20261004000000-m000007");
    assert.equal(projected.unresolved[0].orgName, null);
    assert.deepEqual(records, snapshot);
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

test("组织成员替换：关闭旧 active 并追加新 active，非法替补不产生半成品", () => {
    const org = "20261002000000-org0001";
    const oldPerson = "20261002000000-per0001";
    const newPerson = "20261002000000-per0002";
    const old = membership({ id: "20261002000000-m000010", orgDocId: org, personDocId: oldPerson, status: "active" });
    const store = appendMembership(normalizeOrgMembershipStore({ schemaVersion: 1, memberships: [] }), old);
    const successor = membership({ id: "20261002000000-m000011", orgDocId: org, personDocId: newPerson, status: "active", joinedOn: "2026-07-01" });
    const next = replaceMembership(store, old.id, successor, "2026-06-30");
    assert.ok(next);
    assert.deepEqual(next.memberships.map((item) => [item.personDocId, item.status, item.leftOn]), [
        [oldPerson, "former", "2026-06-30"],
        [newPerson, "active", ""],
    ]);
    const invalid = replaceMembership(store, old.id, { ...successor, personDocId: oldPerson }, "2026-06-30");
    assert.equal(invalid, null);
    assert.equal(store.memberships[0].status, "active");
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

test("B13.5b 成员排序与分页：在职优先、稳定 tie-break、筛选不跳页", () => {
    const items = [
        membership({ id: "20260930000000-m000003", status: "former", joinedOn: "2020-01-01" }),
        membership({ id: "20260930000000-m000002", status: "active", joinedOn: "2026-02-01" }),
        membership({ id: "20260930000000-m000001", status: "active", joinedOn: "2026-01-01" }),
    ];
    assert.deepEqual(sortOrgMemberships(items).map((item) => item.id), [
        "20260930000000-m000001", "20260930000000-m000002", "20260930000000-m000003",
    ]);
    const page = pageOrgMemberships(items, { status: "active", offset: 1, limit: 1 });
    assert.deepEqual(page.items.map((item) => item.id), ["20260930000000-m000002"]);
    assert.equal(page.total, 2);
    assert.equal(page.hasMore, false);
    assert.throws(() => pageOrgMemberships(items, { limit: 501 }), /1-500/);
});
