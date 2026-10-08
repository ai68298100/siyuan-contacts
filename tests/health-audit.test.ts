import assert from "node:assert/strict";
import test from "node:test";
import { decodeAuditFollowUps, decodeAuditInteractions, decodeAuditOrganizationMembers, decodeAuditSelfIdentity, HealthAuditJsonError, isSuspiciousBirthday, runFollowUpAudit, runHealthAudit, runOrganizationMemberAudit, runSelfIdentityAudit } from "../src/domain/health-audit.ts";
import type { ContactSummary } from "../src/domain/person.ts";
import type { FollowUpItem } from "../src/domain/followups.ts";

function person(overrides: Partial<ContactSummary>): ContactSummary {
    return {
        docId: "20260927000000-doc0001", itemId: "row-1", name: "甲",
        phone: "", email: "", wechat: "", website: "", birthday: "", isLunar: false,
        group: "", tags: [], relatedItemIds: [], ...overrides,
    };
}

function followUp(overrides: Partial<FollowUpItem>): FollowUpItem {
    return {
        id: "fu-1", personDocId: "20260927000000-doc0001", title: "保持联系",
        dueDate: "2026-10-01", status: "open", createdAt: 0, updatedAt: 0, ...overrides,
    };
}

test("isSuspiciousBirthday：空串不报、异常年份与非法格式报", () => {
    assert.equal(isSuspiciousBirthday(""), false);
    assert.equal(isSuspiciousBirthday("1990-09-27"), false);
    assert.equal(isSuspiciousBirthday("1899-12-31"), true);
    const nextYear = new Date().getFullYear() + 2;
    assert.equal(isSuspiciousBirthday(`${nextYear}-01-01`), true);
    assert.equal(isSuspiciousBirthday("1990/09/27"), true);
});

test("runHealthAudit：缺电话/缺生日/无分组无标签分别列项并带示例", () => {
    const issues = runHealthAudit({
        people: [
            person({ itemId: "row-1", name: "甲" }),
            person({ itemId: "row-2", name: "乙", phone: "13800000000", birthday: "1990-01-01", group: "家人", tags: ["x"] }),
        ],
        interactionCounts: {}, followUps: [],
    });
    const kinds = issues.map((issue) => issue.kind);
    assert.ok(kinds.includes("missingPhone") && kinds.includes("missingBirthday") && kinds.includes("missingContact") && kinds.includes("noGroupNoTags"));
    const missingPhone = issues.find((issue) => issue.kind === "missingPhone")!;
    assert.deepEqual(missingPhone.itemIds, ["row-1"]);
    assert.deepEqual(missingPhone.samples, ["甲"]);
    /* 乙资料齐全，不应出现在任何名单里 */
    for (const issue of issues) assert.ok(!issue.itemIds.includes("row-2"));
});

test("runHealthAudit：悬空关系、不可达跟进、孤儿互动指向已移除对象", () => {
    const issues = runHealthAudit({
        people: [person({ itemId: "row-1", docId: "20260927000000-doc0001", relatedItemIds: ["row-gone"] })],
        interactionCounts: { "20260927000000-gone001": 3 },
        followUps: [followUp({ personDocId: "20260927000000-gone001" }), followUp({ id: "fu-2", personDocId: "20260927000000-doc0001", status: "done" })],
    });
    const kinds = new Set(issues.map((issue) => issue.kind));
    assert.ok(kinds.has("danglingRelation") && kinds.has("unreachableFollowUp") && kinds.has("orphanInteraction"));
    const orphan = issues.find((issue) => issue.kind === "orphanInteraction")!;
    assert.deepEqual(orphan.itemIds, ["20260927000000-gone001"]);
    assert.match(orphan.samples[0], /3 条/);
    /* done 状态的跟进不参与可达性检查 */
    const unreachable = issues.find((issue) => issue.kind === "unreachableFollowUp")!;
    assert.equal(unreachable.itemIds.length, 1);
});

test("runHealthAudit：数据干净时零输出", () => {
    const issues = runHealthAudit({
        people: [person({
            name: "乙", phone: "13800000000", email: "a@x.com", birthday: "1990-01-01",
            group: "家人", tags: ["x"], relatedItemIds: [],
        })],
        interactionCounts: { "20260927000000-doc0001": 2 },
        followUps: [followUp({})],
    });
    assert.deepEqual(issues, []);
});

test("runHealthAudit：异常生日单列且缺生日不重复计入异常", () => {
    const issues = runHealthAudit({
        people: [person({ name: "丙", birthday: "1899-01-01", phone: "1" })],
        interactionCounts: {}, followUps: [],
    });
    const suspicious = issues.find((issue) => issue.kind === "suspiciousBirthday");
    assert.ok(suspicious);
    assert.deepEqual(suspicious.itemIds, ["row-1"]);
    /* 缺生日与异常生日互斥：异常名单里不重复罗列空生日 */
    assert.equal(issues.find((issue) => issue.kind === "missingBirthday"), undefined);
});

test("C04 余项：疑似重复对并入体检、长期无互动按阈值筛出", () => {
    const roster = [
        person({ docId: "20260927000000-dup0001", itemId: "row-dup-a", name: "张三", phone: "13800000000", group: "家人" }),
        person({ docId: "20260927000000-dup0002", itemId: "row-dup-b", name: "张三", phone: "13800000000", group: "同事" }),
        person({ docId: "20260927000000-old0003", itemId: "row-old-c", name: "老王", phone: "13900000000", group: "朋友" }),
    ];
    const now = new Date();
    const longAgo = new Date(now);
    longAgo.setDate(longAgo.getDate() - 120);
    const lastInteractionAt: Record<string, number> = {
        "20260927000000-dup0001": now.getTime(),
        "20260927000000-dup0002": now.getTime(),
        "20260927000000-old0003": longAgo.getTime(),
    };
    const duplicatePairs = [
        { a: { itemId: "row-dup-a", name: "张三" }, b: { itemId: "row-dup-b", name: "张三" } },
    ];
    const issues = runHealthAudit({
        people: roster,
        interactionCounts: {
            "20260927000000-dup0001": 1,
            "20260927000000-dup0002": 1,
            "20260927000000-old0003": 4,
        },
        lastInteractionAt,
        longInactiveDays: 90,
        duplicatePairs,
        followUps: [],
    });
    const longInactive = issues.find((issue) => issue.kind === "longInactive");
    assert.ok(longInactive, "长期无互动项缺失");
    assert.deepEqual(longInactive.itemIds, ["row-old-c"]);
    const duplicateSuspect = issues.find((issue) => issue.kind === "duplicateSuspect");
    assert.ok(duplicateSuspect, "疑似重复项缺失");
    assert.deepEqual(duplicateSuspect.itemIds, ["row-dup-a"]);
    assert.ok(duplicateSuspect.samples[0].includes("张三"), "疑似重复样本应含人名");
});

test("AG-P0-012：问题带模块归属，修复预览始终零写入", () => {
    const issue = runHealthAudit({
        people: [person({ phone: "", name: "待补录" })],
        interactionCounts: {},
        followUps: [],
    }).find((item) => item.kind === "missingPhone");
    assert.equal(issue?.module, "roster");
    assert.equal(issue?.repair.mode, "preview");
    assert.equal(issue?.repair.writes, 0);
    assert.equal(issue?.repair.confirmationRequired, true);
});

test("AG-P0-012：组织成员孤儿与重复历史分别可定位", () => {
    const membership = {
        id: "20260927000000-mem0001",
        orgDocId: "20260927000000-org0001",
        personDocId: "20260927000000-doc0001",
        department: "",
        title: "",
        joinedOn: "2026-01-01",
        leftOn: "",
        status: "active" as const,
    };
    const issues = runOrganizationMemberAudit({
        people: [person({ docId: membership.personDocId })],
        memberships: [membership, { ...membership, id: "20260927000000-mem0002" }, { ...membership, id: "20260927000000-mem0003", personDocId: "20260927000000-gone001" }],
        organizationDocIds: [membership.orgDocId],
    });
    assert.equal(issues.find((item) => item.kind === "duplicateOrganizationHistory")?.module, "organizationMembers");
    assert.equal(issues.find((item) => item.kind === "orphanOrganizationMember")?.itemIds.includes("20260927000000-mem0003"), true);
});

test("AG-P0-012：本人身份绑定行不一致时不按正常空态处理", () => {
    const issues = runSelfIdentityAudit({
        people: [person({ docId: "20260927000000-doc0001", itemId: "row-current", name: "我自己" })],
        identity: { schemaVersion: 1, selfDocId: "20260927000000-doc0001", selfItemId: "row-old", createdAt: "2026-10-04" },
    });
    assert.equal(issues.length, 1);
    assert.equal(issues[0].kind, "unreachableSelfIdentity");
    assert.equal(issues[0].repair.writes, 0);
});

test("AG-P0-012：严格体检解析不把未知版本、坏容器和非法条目当空库", () => {
    for (const decode of [decodeAuditInteractions, decodeAuditFollowUps, decodeAuditOrganizationMembers, decodeAuditSelfIdentity]) {
        for (const raw of ["{broken", "null", false, [], { schemaVersion: 9 }, { schemaVersion: 1 }]) {
            assert.throws(() => decode(raw), HealthAuditJsonError);
        }
    }
    assert.equal(decodeAuditSelfIdentity(null), null);
    assert.equal(decodeAuditSelfIdentity(""), null);
    assert.deepEqual(decodeAuditOrganizationMembers(undefined), []);
    assert.deepEqual(decodeAuditInteractions(JSON.stringify({ schemaVersion: 1, events: [], tombstones: [] })).events, []);
    assert.throws(() => decodeAuditFollowUps({ schemaVersion: 1, items: [followUp({}), { id: "bad" }] }), HealthAuditJsonError);
});

test("AG-P0-012：重复成员记录和异常期间保留并列出，未知期间不猜测错误", () => {
    const member = { id: "20261004000000-member1", orgDocId: "20261004000000-org0001", personDocId: "20261004000000-person1", status: "former" as const, joinedOn: "", leftOn: "", department: "", title: "" };
    const memberships = decodeAuditOrganizationMembers({ schemaVersion: 1, memberships: [member, { ...member, joinedOn: "2026-02-31" }, { ...member, id: "20261004000000-member2", joinedOn: "2026-09-01", leftOn: "2026-08-01" }] });
    assert.equal(memberships.length, 3);
    const before = JSON.stringify(memberships);
    const issues = runOrganizationMemberAudit({ people: [{ docId: member.personDocId }], memberships, organizationDocIds: [member.orgDocId] });
    assert.equal(issues.find((issue) => issue.kind === "abnormalOrganizationPeriod")?.itemIds.length, 2);
    assert.ok(issues.some((issue) => issue.kind === "duplicateOrganizationHistory"));
    assert.equal(JSON.stringify(memberships), before);
    assert.ok(issues.every((issue) => issue.repair.writes === 0));
});

test("AG-P0-012：跟进修复预览定位记录 ID 与人物文档 ID", () => {
    const issues = runFollowUpAudit([], [followUp({ id: "follow-up-record-1" })]);
    assert.deepEqual(issues[0].repair.targetIds, ["follow-up-record-1"]);
    assert.deepEqual(issues[0].repair.targetDocIds, ["20260927000000-doc0001"]);
});
