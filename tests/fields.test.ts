import { test } from "node:test";
import assert from "node:assert/strict";
import { validateFieldMap } from "../src/domain/fields.ts";

const TYPES: Record<string, string> = {
    birthday: "date", lunarBirthday: "checkbox", phone: "phone", email: "email",
    wechat: "text", website: "url", group: "select", tags: "mSelect", related: "relation",
};

const FULL: Record<string, string> = {
    birthday: "20260930000000-bday001",
    lunarBirthday: "20260930000000-luna001",
    phone: "20260930000000-phon001",
    email: "20260930000000-mail001",
    wechat: "20260930000000-wech001",
    website: "20260930000000-site001",
    group: "20260930000000-grp0001",
    tags: "20260930000000-tags001",
    related: "20260930000000-rela001",
};

const COLUMNS = Object.entries(FULL).map(([key, id]) => ({ id, type: TYPES[key] }));

test("CODE-02.4 fieldMap 校验：完整且列存在 → 零问题", () => {
    assert.deepEqual(validateFieldMap(FULL, COLUMNS), []);
    assert.deepEqual(validateFieldMap(FULL).map((problem) => problem.key), [], "无列清单时也不应有结构问题");
});

test("CODE-02.4 fieldMap 校验：缺键、重复映射、列不存在、类型不一致", () => {
    const partial: Record<string, string> = { ...FULL };
    delete partial.phone;
    partial.email = FULL.wechat;
    partial.website = "20260930000000-gone001";
    const problems = validateFieldMap(partial, COLUMNS);
    const messages = problems.map((problem) => problem.message);
    assert(messages.some((message) => message.includes("电话 缺少列映射")), "缺键未报告");
    assert(messages.some((message) => message.includes("重复映射")), "重复映射未报告");
    assert(messages.some((message) => message.includes("不存在于当前数据库")), "列不存在未报告");
    assert(
        messages.some((message) => message.includes("邮箱 需要 email 类型") && message.includes("text")),
        "类型不一致未报告",
    );
});

test("CODE-02.4 fieldMap 校验：不提供列清单时跳过存在性/类型核对", () => {
    const problems = validateFieldMap({ ...FULL, email: FULL.wechat });
    assert(problems.length === 1 && problems[0].message.includes("重复映射"), `应只剩重复映射问题：${JSON.stringify(problems)}`);
});
import { parsePersonRelationshipLabelStore, projectPersonRelationshipLabels } from "../src/domain/person-relationship-labels.ts";

test("B12 称谓跟随本人参照，更换/清除/未知不搬移旧标签", () => {
    const record = {
        id: "20261004000000-rel0001", selfDocId: "20261004000000-per0001", personDocId: "20261004000000-per0002",
        labels: [" 朋友 ", "合作伙伴"], createdAt: 100, updatedAt: 200,
    };
    const store = parsePersonRelationshipLabelStore({ schemaVersion: 1, labels: [record] });
    assert.deepEqual(projectPersonRelationshipLabels(store, record.selfDocId, record.personDocId).labels, ["朋友", "合作伙伴"]);
    assert.deepEqual(projectPersonRelationshipLabels(store, "20261004000000-per0003", record.personDocId).labels, []);
    assert.equal(projectPersonRelationshipLabels(store, null, record.personDocId).state, "self_missing");
    assert.equal(projectPersonRelationshipLabels(store, undefined, record.personDocId).state, "unknown");
    assert.equal(projectPersonRelationshipLabels(store, record.selfDocId, record.selfDocId).state, "self");
    assert.deepEqual(store.labels[0].labels, ["朋友", "合作伙伴"]);
    const cleared = parsePersonRelationshipLabelStore({ schemaVersion: 1, labels: [{ ...record, labels: [] }] });
    const projection = projectPersonRelationshipLabels(cleared, record.selfDocId, record.personDocId);
    assert.equal(projection.state, "known");
    if (projection.state === "known") assert.equal(projection.recordId, record.id);
});

test("B12 称谓旧空键兼容，坏包/重复组合/非法值整体拒绝", () => {
    assert.deepEqual(parsePersonRelationshipLabelStore(null), { schemaVersion: 1, labels: [] });
    const record = {
        id: "20261004000000-rel0001", selfDocId: "20261004000000-per0001", personDocId: "20261004000000-per0002",
        labels: ["朋友"], createdAt: 100, updatedAt: 200,
    };
    for (const labels of [
        [record, { ...record, id: "20261004000000-rel0002" }],
        [{ ...record, selfDocId: record.personDocId }],
        [{ ...record, personDocId: "bad-id" }],
        [{ ...record, labels: ["朋友", " 朋友 "] }],
        [{ ...record, labels: [""] }],
        [{ ...record, labels: ["朋友\n老板"] }],
        [{ ...record, labels: Array.from({ length: 21 }, (_, index) => String(index)) }],
        [{ ...record, updatedAt: 99 }],
    ]) assert.throws(() => parsePersonRelationshipLabelStore({ schemaVersion: 1, labels }), /存储内容损坏/);
    assert.throws(() => parsePersonRelationshipLabelStore({ schemaVersion: 2, labels: [] }), /版本/);
});
