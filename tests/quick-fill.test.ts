import assert from "node:assert/strict";
import test from "node:test";
import { normalizeBirthday, normalizePhone, parseContactText, quickFillValues, CONTACT_TEMPLATE } from "../src/domain/quick-fill.ts";

function fields(text: string) {
    return parseContactText(text);
}

test("parseContactText：多行键值（中文冒号）识别姓名/手机/微信/邮箱", () => {
    const result = fields("张三\n手机：13800138000\n微信：zhang_san\n邮箱：a@example.com");
    assert.deepEqual(quickFillValues(result, "name"), ["张三"]);
    assert.deepEqual(quickFillValues(result, "phone"), ["13800138000"]);
    assert.deepEqual(quickFillValues(result, "wechat"), ["zhang_san"]);
    assert.deepEqual(quickFillValues(result, "email"), ["a@example.com"]);
    assert.equal(result.items.find((item) => item.field === "phone")?.confidence, "certain");
    assert.equal(result.items.find((item) => item.field === "name")?.confidence, "likely");
    assert.deepEqual(result.unrecognized, []);
});

test("parseContactText：单行混排 `张三 13800138000 wx:zhang_san`", () => {
    const result = fields("张三 13800138000 wx:zhang_san");
    assert.deepEqual(quickFillValues(result, "name"), ["张三"]);
    assert.deepEqual(quickFillValues(result, "phone"), ["13800138000"]);
    assert.deepEqual(quickFillValues(result, "wechat"), ["zhang_san"]);
});

test("normalizePhone：空格/短横线/括号/国家码/分机规范化并保留说明", () => {
    assert.equal(normalizePhone("138 0013 8000")?.value, "13800138000");
    assert.equal(normalizePhone("(+86) 138-0013-8000")?.value, "13800138000");
    assert.match(normalizePhone("+8613800138000")?.note ?? "", /国家码/);
    assert.equal(normalizePhone("0731-88888888 转 801")?.value, "073188888888 转 801");
    assert.match(normalizePhone("0731-88888888 转 801")?.note ?? "", /分机/);
    assert.equal(normalizePhone("not-a-number"), null);
});

test("normalizeBirthday：完整日期校验、无年份、农历标记与非法日期", () => {
    assert.equal(normalizeBirthday("2001-03-05")?.value, "2001-03-05");
    assert.equal(normalizeBirthday("2001/3/5")?.value, "2001-03-05");
    assert.equal(normalizeBirthday("2001年3月5日")?.value, "2001-03-05");
    assert.equal(normalizeBirthday("3月5日")?.value, "03-05");
    assert.match(normalizeBirthday("3月5日")?.note ?? "", /未提供年份/);
    assert.equal(normalizeBirthday("农历3月5日")?.value, "03-05");
    assert.match(normalizeBirthday("农历3月5日")?.note ?? "", /农历/);
    assert.equal(normalizeBirthday("2001-13-40"), null);
});

test("parseContactText：邮箱大小写归一、网址补协议、#标签拆分", () => {
    const result = fields("User@Example.COM https://example.com/a #家人 #球友");
    assert.deepEqual(quickFillValues(result, "email"), ["user@example.com"]);
    assert.deepEqual(quickFillValues(result, "website"), ["https://example.com/a"]);
    assert.deepEqual(quickFillValues(result, "tags"), ["家人", "球友"]);
});

test("parseContactText：同一字段多个值保留为多个候选，不拼接不覆盖", () => {
    const result = fields("电话：13800138000\n手机：0731-88888888");
    assert.deepEqual(quickFillValues(result, "phone"), ["13800138000", "073188888888"]);
});

test("parseContactText：微信号裸词不猜，普通英文单词不误识别", () => {
    const result = fields("zhang_san meeting notes 13800138000");
    assert.deepEqual(quickFillValues(result, "wechat"), []);
    assert.deepEqual(quickFillValues(result, "name"), ["zhang_san"]);
    assert.deepEqual(quickFillValues(result, "phone"), ["13800138000"]);
});

test("parseContactText：缺姓名、无效输入进 unrecognized，不静默丢弃", () => {
    const result = fields("手机：13800138000\n这是一段没有格式的话？？？\n生日：2001-13-40");
    assert.deepEqual(quickFillValues(result, "phone"), ["13800138000"]);
    assert.deepEqual(result.unrecognized, ["这是一段没有格式的话？？？", "生日：2001-13-40"]);
    assert.deepEqual(quickFillValues(result, "name"), []);
});

test("parseContactText：全角标点、列表序号与中英文键名等价", () => {
    const byChinese = fields("姓名：李四\n电话：13800138000");
    const byEnglish = fields("1. Name: 李四\n2. Tel: 13800138000");
    assert.deepEqual(quickFillValues(byEnglish, "name"), quickFillValues(byChinese, "name"));
    assert.deepEqual(quickFillValues(byEnglish, "phone"), quickFillValues(byChinese, "phone"));
});

test("parseContactText：重复粘贴幂等，空输入返回空结果", () => {
    const input = "张三\n手机：13800138000";
    assert.deepEqual(fields(input), fields(input));
    assert.deepEqual(fields(""), { items: [], unrecognized: [] });
});

test("parseContactText：Markdown frontmatter 剥壳，围栏不误识别（FAST-01.2）", () => {
    const result = fields("---\nname: 张三\nphone: 13800138000\n---\n正文段落没有固定格式");
    assert.deepEqual(quickFillValues(result, "name"), ["张三"]);
    assert.deepEqual(quickFillValues(result, "phone"), ["13800138000"]);
    assert.deepEqual(result.unrecognized, ["正文段落没有固定格式"]);
});

test("parseContactText：TSV 表格一行按单元格推断（FAST-01.2）", () => {
    const result = fields("王五\t13922223333\tb@x.com");
    assert.deepEqual(quickFillValues(result, "name"), ["王五"]);
    assert.deepEqual(quickFillValues(result, "phone"), ["13922223333"]);
    assert.deepEqual(quickFillValues(result, "email"), ["b@x.com"]);
});

test("parseContactText：模板空键占位行静默忽略，已填键正常识别（FAST-01.2）", () => {
    const result = fields("姓名：赵六\n手机：\n微信：\n邮箱：zhao@x.com");
    assert.deepEqual(quickFillValues(result, "name"), ["赵六"]);
    assert.deepEqual(quickFillValues(result, "email"), ["zhao@x.com"]);
    assert.deepEqual(result.unrecognized, []);
});

test("parseContactText：纯标点/分隔线不猜姓名（FAST-01.2）", () => {
    const result = fields("手机：13800138000\n———\n***");
    assert.deepEqual(quickFillValues(result, "name"), []);
    assert.deepEqual(quickFillValues(result, "phone"), ["13800138000"]);
});

test("CONTACT_TEMPLATE：覆盖全部契约字段的中文键（FAST-01.2）", () => {
    for (const key of ["姓名", "手机", "微信", "邮箱", "生日", "网站", "分组", "标签"]) {
        assert(CONTACT_TEMPLATE.includes(`${key}：`), `模板缺 ${key}`);
    }
});
