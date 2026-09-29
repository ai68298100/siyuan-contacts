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
