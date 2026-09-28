import assert from "node:assert/strict";
import test from "node:test";
import { isSuspiciousBirthday, runHealthAudit } from "../src/domain/health-audit.ts";
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
