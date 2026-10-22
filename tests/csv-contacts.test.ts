import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCsvRows, parseCsvContacts, generateCsvTemplate } from "../src/domain/csv-contacts.ts";

test("parseCsvRows：能正确处理引号转义、逗号、多行和首尾空格", () => {
    const raw = `姓名,电话,"公司, 带逗号",备注\r\n张三,13800000000,"金雨""茂物""",普通备注\r\n李四,13900000000,腾讯,无`;
    const rows = parseCsvRows(raw);
    assert.equal(rows.length, 3);
    assert.deepEqual(rows[0], ["姓名", "电话", "公司, 带逗号", "备注"]);
    assert.deepEqual(rows[1], ["张三", "13800000000", '金雨"茂物"', "普通备注"]);
    assert.deepEqual(rows[2], ["李四", "13900000000", "腾讯", "无"]);
});

test("parseCsvContacts：解析标准模板与中英文别名表头", () => {
    const template = generateCsvTemplate();
    const contacts = parseCsvContacts(template);
    assert.equal(contacts.length, 2);
    assert.equal(contacts[0].name, "张三");
    assert.equal(contacts[0].phone, "13800138000");
    assert.equal(contacts[0].email, "zhangsan@example.com");
    assert.equal(contacts[0].birthday, "1992-05-20");
    assert.equal(contacts[0].isLunar, false);
    assert.deepEqual(contacts[0].tags, ["投资", "业务"]);
    assert.equal(contacts[0].org, "金雨茂物");

    assert.equal(contacts[1].name, "李四");
    assert.equal(contacts[1].phone, "13900139000");
    assert.equal(contacts[1].isLunar, true);
});

test("parseCsvContacts：缺失姓名列时给出友好报错", () => {
    const badCsv = "电话,邮箱\n13800000000,test@example.com";
    assert.throws(() => parseCsvContacts(badCsv), /未找到「姓名」列/);
});
