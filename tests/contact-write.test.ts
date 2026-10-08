import { test } from "node:test";
import assert from "node:assert/strict";
import { buildContactWritePlan, changedContactWriteFields, settleContactFieldResult, summarizeContactWriteResults, verifyContactField } from "../src/domain/contact-write.ts";
import { birthdayToMs, emptyDraft } from "../src/domain/person.ts";
import { GROUP_OPTION_PREFIX, normalizeCustomGroupName } from "../src/domain/contact-group.ts";
import type { AvCell } from "../src/api/av.ts";

test("自定义分组会去除首尾空格，拒绝空值和 UI 内部选项，并按普通分组写入", () => {
    assert.deepEqual(normalizeCustomGroupName("  跑团伙伴  "), { ok: true, value: "跑团伙伴" });
    assert.deepEqual(normalizeCustomGroupName("  \t "), { ok: false, reason: "empty" });
    assert.deepEqual(normalizeCustomGroupName(`${GROUP_OPTION_PREFIX}custom`), { ok: false, reason: "reserved" });

    const plan = buildContactWritePlan({ ...emptyDraft(), name: "测试", group: "跑团伙伴" }, "create");
    assert.equal(plan.writes.find((write) => write.field === "group")?.value, "跑团伙伴");
});

test("真实内核空选项省略属性可核实空值，显式坏形状仍保持未知", () => {
    const plan = buildContactWritePlan({ ...emptyDraft(), name: "虚构人物" }, "edit", ["group", "tags"]);
    for (const write of plan.writes) {
        const type = write.field === "group" ? "select" : "mSelect";
        const row = { id: "original", cells: [{ valueType: type, value: { keyID: write.field, type } }] };
        assert.equal(verifyContactField(write, row, write.field).status, "applied");
        const nonempty = { ...write, value: write.field === "group" ? "朋友" : ["朋友"] };
        assert.equal(verifyContactField(nonempty, row, write.field).status, "failed");
        for (const invalid of [null, {}, "", [{ name: "错误键" }]]) {
            assert.equal(verifyContactField(write, { ...row, cells: [{ valueType: type,
                value: { keyID: write.field, type, mSelect: invalid } } as unknown as AvCell] }, write.field).status, "unknown");
        }
    }
});

test("联系人写入计划：新建跳过空值，标签去重并保留字段顺序", () => {
    const plan = buildContactWritePlan({
        ...emptyDraft(),
        name: "张三",
        phone: " 13800138000 ",
        tags: ["重点", "重点", " 同学 "],
    }, "create");

    assert.deepEqual(plan.writes.map((write) => write.field), ["phone", "tags"]);
    assert.equal(plan.writes[0].value, "13800138000");
    assert.deepEqual(plan.writes[1].value, ["重点", "同学"]);
    assert.deepEqual(plan.skipped.map((result) => result.field), ["email", "wechat", "website", "birthday", "lunarBirthday", "group"]);
});

test("联系人写入计划：编辑模式保留清空语义，只生成指定字段", () => {
    const plan = buildContactWritePlan({ ...emptyDraft(), name: "张三" }, "edit", ["group", "tags"]);

    assert.deepEqual(plan.skipped, []);
    assert.deepEqual(plan.writes.map((write) => write.field), ["group", "tags"]);
    assert.equal(plan.writes[0].value, "");
    assert.deepEqual(plan.writes[1].value, []);
});

test("联系人写入报告：部分字段失败时保留成功结果并标记不可完成", () => {
    const report = summarizeContactWriteResults("edit", [
        { field: "phone", label: "电话", status: "applied" },
        { field: "wechat", label: "微信", status: "failed", message: "网络错误" },
        { field: "tags", label: "标签", status: "skipped" },
    ]);

    assert.deepEqual(report.applied, ["phone"]);
    assert.deepEqual(report.failed, [{ field: "wechat", label: "微信", message: "网络错误" }]);
    assert.deepEqual(report.skipped, ["tags"]);
    assert.equal(report.complete, false);
});

test("字段核实：1950 年生日、日期清空和农历标记按真实值比较", () => {
    const writes = buildContactWritePlan({ ...emptyDraft(), name: "测试", birthday: "1950-01-02", isLunar: true }, "edit").writes;
    const birthday = writes.find((write) => write.field === "birthday")!;
    const lunar = writes.find((write) => write.field === "lunarBirthday")!;
    const row = { id: "row", cells: [
        { valueType: "date", value: { keyID: "birthday", type: "date", date: { content: birthdayToMs("1950-01-02")! + 1000, isNotEmpty: true } } },
        { valueType: "checkbox", value: { keyID: "lunarBirthday", type: "checkbox", checkbox: { checked: true } } },
    ] };
    assert.equal(verifyContactField(birthday, row, "birthday").status, "applied");
    assert.equal(verifyContactField(lunar, row, "lunarBirthday").status, "applied");
    assert.equal(verifyContactField({ ...birthday, value: null }, row, "birthday").status, "failed");
    row.cells[0].value.date!.isNotEmpty = false;
    assert.equal(verifyContactField({ ...birthday, value: null }, row, "birthday").status, "applied");
    assert.equal(verifyContactField(birthday, row, "birthday").status, "failed");
});

test("字段核实：标签按集合比较，字符串和单选值不得以请求成功代替", () => {
    const plan = buildContactWritePlan({ ...emptyDraft(), name: "测试", tags: ["甲", "乙"], phone: "123", group: "朋友" }, "edit");
    const row = { id: "row", cells: [
        { valueType: "mSelect", value: { keyID: "tags", type: "mSelect", mSelect: [{ content: "乙" }, { content: "甲" }] } },
        { valueType: "phone", value: { keyID: "phone", type: "phone", phone: { content: "456" } } },
        { valueType: "select", value: { keyID: "group", type: "select", mSelect: [{ content: "朋友" }, { content: "其他" }] } },
    ] };
    assert.equal(verifyContactField(plan.writes.find((write) => write.field === "tags")!, row, "tags").status, "applied");
    assert.equal(verifyContactField(plan.writes.find((write) => write.field === "phone")!, row, "phone").status, "failed");
    assert.equal(verifyContactField(plan.writes.find((write) => write.field === "group")!, row, "group").status, "failed");
});

test("字段核实：行丢失、重复单元格、类型错误及坏生日保持未知，缺格仅证明空值", () => {
    const write = buildContactWritePlan({ ...emptyDraft(), name: "测试", birthday: "2000-01-02" }, "edit").writes.find((entry) => entry.field === "birthday")!;
    const cell: AvCell = { valueType: "date", value: { keyID: "birthday", type: "date", date: { content: NaN, isNotEmpty: true } } };
    assert.equal(verifyContactField(write, undefined, "birthday").status, "unknown");
    assert.equal(verifyContactField(write, { id: "row", cells: [cell, cell] }, "birthday").status, "unknown");
    assert.equal(verifyContactField(write, { id: "row", cells: [cell] }, "birthday").status, "unknown");
    assert.equal(verifyContactField(write, { id: "row", cells: [{ ...cell, valueType: "text" }] }, "birthday").status, "unknown");
    assert.equal(verifyContactField(write, { id: "row", cells: [] }, "birthday").status, "failed");
    assert.equal(verifyContactField({ ...write, value: null }, { id: "row", cells: [] }, "birthday").status, "applied");
});

test("字段报告：请求接受与已核实分开，未知和无错误文本的失败不能标完成", () => {
    const report = summarizeContactWriteResults("edit", [
        { field: "birthday", label: "生日", status: "unknown", requestStatus: "accepted", message: "回读失败" },
        { field: "phone", label: "电话", status: "failed" },
    ]);
    assert.deepEqual(report.accepted, ["birthday"]);
    assert.deepEqual(report.applied, []);
    assert.equal(report.unknown.length, 1);
    assert.equal(report.failed.length, 1);
    assert.equal(report.unresolved.length, 2);
    assert.equal(report.complete, false);
});

test("写入裁决：旧值回读不是拒绝证据，传输未知与已接受均不得成为可重试失败", () => {
    const mismatch = { field: "phone", label: "电话", status: "failed" } as const;
    assert.equal(settleContactFieldResult(mismatch, { ...mismatch, requestStatus: "accepted" }).status, "unknown");
    assert.equal(settleContactFieldResult(mismatch, { ...mismatch, requestStatus: "unknown" }).status, "unknown");
    assert.equal(settleContactFieldResult(mismatch, { ...mismatch, requestStatus: "failed" }).status, "failed");
    assert.equal(settleContactFieldResult({ ...mismatch, status: "applied" }, { ...mismatch, requestStatus: "unknown" }).status, "applied");
});

test("编辑输入比较：重试与新输入区分，只选择实际改变字段，保留清空语义", () => {
    const before = { ...emptyDraft(), name: "测试", phone: "123", email: "old@example.com", tags: ["甲"] };
    assert.deepEqual(changedContactWriteFields(before, { ...before, phone: " 123 " }), []);
    assert.deepEqual(changedContactWriteFields(before, { ...before, email: "", tags: [] }), ["email", "tags"]);
});
