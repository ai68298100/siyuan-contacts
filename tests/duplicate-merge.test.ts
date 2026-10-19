import assert from "node:assert/strict";
import test from "node:test";
import {
    buildDefaultMergePlan,
    resolveMergePlan,
    validateMergePlan,
} from "../src/domain/duplicate-merge.ts";
import type { ContactSummary } from "../src/domain/person.ts";

function mockContact(partial: Partial<ContactSummary> & { docId: string; itemId: string; name: string }): ContactSummary {
    return {
        phone: "",
        email: "",
        wechat: "",
        website: "",
        birthday: "",
        isLunar: false,
        group: "",
        tags: [],
        relatedItemIds: [],
        ...partial,
    };
}

test("E-31 merge: validateMergePlan 安全防御机制", () => {
    const c1 = mockContact({ docId: "20261019000000-doc0001", itemId: "i-1", name: "张三" });
    const c2 = mockContact({ docId: "20261019000000-doc0002", itemId: "i-2", name: "张三 (重)" });

    // 1. 同一文档拒绝
    const selfPlan = buildDefaultMergePlan(c1, c1);
    assert.deepEqual(validateMergePlan(selfPlan), [
        "主人物与次人物不能是同一篇文档",
        "主人物与次人物不能是同一数据库行",
    ]);

    // 2. 次人物为本人时拒绝
    const selfSecondary = mockContact({ docId: "20261019000000-doc0002", itemId: "i-2", name: "我自己", isSelf: true });
    const mergeSelfPlan = buildDefaultMergePlan(c1, selfSecondary);
    assert.ok(validateMergePlan(mergeSelfPlan).some((e) => e.includes("本人身份不可被销毁")));

    // 3. 姓名清空拒绝
    const emptyNamePlan = buildDefaultMergePlan(c1, c2);
    emptyNamePlan.fields.name = { choice: "custom", customValue: "   " };
    assert.ok(validateMergePlan(emptyNamePlan).some((e) => e.includes("姓名不能为空")));

    // 4. 合法计划无错误
    assert.deepEqual(validateMergePlan(buildDefaultMergePlan(c1, c2)), []);
});

test("E-31 merge: buildDefaultMergePlan 智能推荐非空补齐", () => {
    const primary = mockContact({
        docId: "20261019000000-doc0001",
        itemId: "i-1",
        name: "李四",
        phone: "13800000000",
        email: "", // 主人物缺邮箱
        wechat: "wx-lisi",
        group: "同事",
        tags: ["同事", "架构师"],
    });

    const secondary = mockContact({
        docId: "20261019000000-doc0002",
        itemId: "i-2",
        name: "李四 (旧)",
        phone: "13900000000",
        email: "lisi@company.com", // 次人物有邮箱
        wechat: "",
        birthday: "1992-08-15", // 次人物有生日
        isLunar: true,
        group: "",
        tags: ["羽毛球", "同事"],
    });

    const plan = buildDefaultMergePlan(primary, secondary);

    // 主人物已有值，默认保留 primary
    assert.equal(plan.fields.name.choice, "primary");
    assert.equal(plan.fields.phone.choice, "primary");
    assert.equal(plan.fields.wechat.choice, "primary");
    assert.equal(plan.fields.group.choice, "primary");

    // 主人物缺项，次人物有值，默认自动选 secondary 补齐
    assert.equal(plan.fields.email.choice, "secondary");
    assert.equal(plan.fields.birthday.choice, "secondary");

    // 执行决议
    const { draft, auditSnapshot } = resolveMergePlan(plan, 1700000000000);
    assert.equal(draft.name, "李四");
    assert.equal(draft.phone, "13800000000");
    assert.equal(draft.email, "lisi@company.com");
    assert.equal(draft.birthday, "1992-08-15");
    assert.equal(draft.isLunar, true, "生日选用次人物时，历法标志一并跟随");
    assert.equal(draft.group, "同事");
    assert.deepEqual(draft.tags, ["同事", "架构师", "羽毛球"], "标签自动去重并集");

    // 审计快照完整保留双方历史
    assert.equal(auditSnapshot.primaryDocId, primary.docId);
    assert.equal(auditSnapshot.secondaryDocId, secondary.docId);
    assert.equal(auditSnapshot.primaryBefore.phone, "13800000000");
    assert.equal(auditSnapshot.secondaryBefore.phone, "13900000000");
    assert.deepEqual(auditSnapshot.mergedResult, draft);
});

test("E-31 merge: resolveMergePlan 自定义选择与字段覆盖", () => {
    const primary = mockContact({ docId: "20261019000000-doc0001", itemId: "i-1", name: "王五", phone: "111" });
    const secondary = mockContact({ docId: "20261019000000-doc0002", itemId: "i-2", name: "王小五", phone: "222" });

    const plan = buildDefaultMergePlan(primary, secondary);
    // 用户手动覆盖：取次人物电话，自定义姓名
    plan.fields.name = { choice: "custom", customValue: "王五（合并后）" };
    plan.fields.phone = { choice: "secondary" };
    plan.tagsMode = "primary";
    plan.additionalTags = ["合并完成"];

    const { draft } = resolveMergePlan(plan);
    assert.equal(draft.name, "王五（合并后）");
    assert.equal(draft.phone, "222");
    assert.deepEqual(draft.tags, ["合并完成"]);
});
