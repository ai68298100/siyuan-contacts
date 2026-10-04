import assert from "node:assert/strict";
import test from "node:test";
import { emptyDraft } from "../src/domain/person.ts";
import { draftImportMappings, quickFillDefaultIndexes, resolveImportFields, snapshotCompletionPeople, snapshotImportQueue } from "../src/domain/import.ts";
import { parseContactText } from "../src/domain/quick-fill.ts";
import { parseVcfForImport } from "../src/domain/vcard.ts";

const docId = "20261004000000-person1";
const notebookId = "20261004000000-noteb01";
const baseline = () => ({ ...emptyDraft(), name: "同名人物" });

test("收编队列按文档 ID 固定同名对象，不随原候选或标签变化", () => {
    const candidates = [{ docId, name: "同名人物", hpath: "/甲" }, { docId: "20261004000000-person2", name: "同名人物", hpath: "/乙" }];
    const tags = ["客户"];
    const queue = snapshotImportQueue("锚点", notebookId, candidates, { tags });
    candidates[0].name = "外部变更";
    tags.push("新增");
    assert.deepEqual(queue.items.map((item) => item.docId), [docId, "20261004000000-person2"]);
    assert.equal(queue.items[0].name, "同名人物");
    assert.deepEqual(queue.tags, ["客户"]);
    assert.throws(() => snapshotImportQueue("锚点", notebookId, [candidates[0], candidates[0]]), /重复/);
});

test("补录快照不跟随父层排序、姓名或标签改变", () => {
    const people = [{ ...baseline(), docId, itemId: "row-1", relatedItemIds: [], tags: ["原标签"] }];
    const snapshot = snapshotCompletionPeople(people);
    people[0].tags.push("新标签");
    people[0].name = "新姓名";
    people.splice(0);
    assert.equal(snapshot[0].name, "同名人物");
    assert.deepEqual(snapshot[0].tags, ["原标签"]);
});

test("不同来源的选择保留各自笔记本，空补录范围可正常返回", () => {
    const anotherNotebookId = "20261004000000-noteb02";
    const queue = snapshotImportQueue("锚点", notebookId, [
        { docId, name: "甲", hpath: "/甲", notebookId },
        { docId: "20261004000000-person2", name: "乙", hpath: "/乙", notebookId: anotherNotebookId },
    ]);
    assert.deepEqual(queue.items.map((item) => item.notebookId), [notebookId, anotherNotebookId]);
    assert.deepEqual(snapshotCompletionPeople([]), []);
    assert.throws(() => snapshotImportQueue("锚点", notebookId, [{ docId, name: "甲", hpath: "/甲", notebookId: "非法" }]));
});

test("并发从空字段补齐后，旧补录不能覆盖；其他字段仍可写", () => {
    const result = resolveImportFields({ ...baseline(), phone: "新电话", website: "https://fresh.example" }, baseline(),
        { ...baseline(), phone: "旧候选", email: "input@example.com" }, ["phone", "email"]);
    assert.deepEqual(result.conflicts, ["phone"]);
    assert.deepEqual(result.fields, ["email"]);
    assert.equal(result.draft.phone, "新电话");
    assert.equal(result.draft.website, "https://fresh.example");
});

test("未知写结果重试核实成功字段，只追加缺少标签并保留并发标签", () => {
    const submitted = { ...baseline(), phone: "已保存", tags: ["本次"] };
    const result = resolveImportFields({ ...baseline(), phone: "已保存", tags: ["并发"] }, baseline(), submitted, ["phone", "tags"]);
    assert.deepEqual(result.verified, ["phone"]);
    assert.deepEqual(result.fields, ["tags"]);
    assert.deepEqual(result.draft.tags, ["并发", "本次"]);
});

test("生日和农历作为一项核对；另一生日不可被旧农历标记污染", () => {
    const result = resolveImportFields({ ...baseline(), birthday: "2001-02-03", isLunar: true }, baseline(),
        { ...baseline(), birthday: "1990-01-01" }, ["birthday", "lunarBirthday"]);
    assert.deepEqual(new Set(result.conflicts), new Set(["birthday", "lunarBirthday"]));
    assert.deepEqual(result.fields, []);
    const retry = resolveImportFields({ ...baseline(), birthday: "1990-01-01" }, baseline(),
        { ...baseline(), birthday: "1990-01-01", isLunar: true }, ["birthday", "lunarBirthday"]);
    assert.deepEqual(retry.fields, ["lunarBirthday"]);
});

test("同字段冲突候选不默认选中，多行表格不合并为一个人", () => {
    const parsed = parseContactText("姓名：甲\n电话：13800000001\n电话：13800000002\n邮箱：one@example.com");
    const defaults = quickFillDefaultIndexes(parsed, emptyDraft()).map((index) => parsed.items[index].field);
    assert.deepEqual(defaults, ["name", "email"]);
    assert.equal(parseContactText("甲\t13800000001\n乙\t13800000002").items.length, 0);
    assert.ok(parseContactText("甲\t13800000001\n乙\t13800000002").unrecognized.length > 1);
});

test("生日单字段重试必须核实另一个配对值，不重复报告成功和冲突", () => {
    const submitted = { ...baseline(), birthday: "1990-01-01" };
    const changedCalendar = resolveImportFields({ ...baseline(), isLunar: true }, baseline(), submitted, ["birthday"]);
    assert.deepEqual(changedCalendar.fields, []);
    assert.deepEqual(changedCalendar.conflicts, ["birthday"]);
    const changedBirthday = resolveImportFields({ ...baseline(), birthday: "2001-02-03" }, baseline(), submitted, ["lunarBirthday"]);
    assert.deepEqual(changedBirthday.verified, []);
    assert.deepEqual(changedBirthday.conflicts, ["lunarBirthday"]);
    const conflict = resolveImportFields({ ...submitted, isLunar: true }, baseline(), submitted, ["birthday", "lunarBirthday"]);
    assert.deepEqual(conflict.verified, []);
    assert.deepEqual(new Set(conflict.conflicts), new Set(["birthday", "lunarBirthday"]));
});

test("同日不同历法的粘贴生日需要人工单选", () => {
    const result = { items: [
        { field: "birthday" as const, value: "1990-01-01", raw: "公历生日", confidence: "certain" as const },
        { field: "birthday" as const, value: "1990-01-01", raw: "农历生日", note: "农历", confidence: "certain" as const },
    ], unrecognized: [] };
    assert.deepEqual(quickFillDefaultIndexes(result, emptyDraft()), []);
});

test("严格导入拒绝空、截断、缺姓名和损坏卡片，保留额外邮箱与映射边界", () => {
    for (const input of ["", "BEGIN:VCARD\nFN:甲", "BEGIN:VCARD\nTEL:123\nEND:VCARD", "BEGIN:VCARD\nFN:甲\n坏属性\nEND:VCARD"]) {
        assert.throws(() => parseVcfForImport(input));
    }
    const cards = parseVcfForImport("BEGIN:VCARD\nVERSION:3.0\nFN:甲\nEMAIL:one@example.com\nEMAIL:two@example.com\nORG:组织\nPHOTO:图片\nEND:VCARD");
    assert.equal(cards[0].email, "one@example.com");
    assert.ok(cards[0].unsupportedProperties?.includes("EMAIL（第 2 项起）"));
    const mappings = draftImportMappings("vcard", { ...baseline(), email: cards[0].email }, cards[0].unsupportedProperties);
    assert.ok(mappings.some((mapping) => mapping.sourceField === "EMAIL" && mapping.targetField === "email"));
    assert.equal(mappings.filter((mapping) => mapping.state === "ignored").length, 3);
});
