import assert from "node:assert/strict";
import test from "node:test";
import { isSuspiciousBirthday, runHealthAudit, runOrgHealthAudit } from "../src/domain/health-audit.ts";
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

test("B13.9 组织体检：孤儿成员/不可达组织/期间倒挂/重复在职/冲突标记与清洁样本", () => {
    const membership = (over) => ({
        id: "20260930000000-m000001", orgDocId: "20260930000000-org0001",
        personDocId: "20260930000000-per0001", department: "", title: "",
        joinedOn: "", leftOn: "", status: "active", ...over,
    });
    const rosterDocIds = new Set(["20260930000000-per0001"]);
    const reachable = new Set(["20260930000000-org0001"]);
    const orgNames = new Map([["20260930000000-org0001", "曙光科技"]]);
    const personNames = new Map([["20260930000000-per0001", "张三"]]);

    /* 清洁：全零 */
    assert.deepEqual(runOrgHealthAudit({
        memberships: [membership({ id: "20260930000000-m000009" })],
        rosterDocIds, reachableOrgDocIds: reachable, orgNames, personNames,
    }), []);

    const issues = runOrgHealthAudit({
        memberships: [
            membership({ id: "20260930000000-m000001" }),
            membership({ id: "20260930000000-m000002", personDocId: "20260930000000-pergone1", orgDocId: "20260930000000-orggone1" }),
            membership({ id: "20260930000000-m000003", joinedOn: "2024-05-01", leftOn: "2024-01-01" }),
            membership({ id: "20260930000000-m000004", title: "顾问" }),
            membership({ id: "20260930000000-m000005", title: "顾问", joinedOn: "2023-01-01" }),
        ],
        rosterDocIds,
        reachableOrgDocIds: reachable,
        orgNames,
        personNames,
        markerCounts: new Map([["20260930000000-org0001", 2]]),
    });
    const byKind = new Map(issues.map((issue) => [issue.kind, issue]));
    const orphan = byKind.get("orphanOrgMember");
    assert.ok(orphan, "孤儿成员缺失");
    assert.deepEqual(orphan.itemIds, ["20260930000000-m000002"]);
    assert.ok(orphan.samples[0].includes("人物 rgone1"), "孤儿成员降级展示 docId 片段");
    const unreachable = byKind.get("unreachableOrg");
    assert.ok(unreachable && unreachable.itemIds.includes("20260930000000-orggone1"), "不可达组织缺失");
    assert.ok(unreachable.samples[0].includes("组织文档 ggone1"), "不可达组织降级展示 docId 片段");
    const inverted = byKind.get("invertedMembershipPeriod");
    assert.ok(inverted && inverted.samples[0].includes("2024-05-01 ~ 2024-01-01"), "期间倒挂缺失");
    const duplicate = byKind.get("duplicateActiveMembership");
    assert.ok(duplicate && duplicate.samples[0].includes("4 条在职记录"), "重复在职缺失");
    assert.equal(duplicate.itemIds[0], "20260930000000-m000001", "重复在职定位到首条记录");
    const conflict = byKind.get("conflictingOrgMarkers");
    assert.ok(conflict && conflict.samples[0].includes("2 个标记块"), "冲突标记缺失");
});
