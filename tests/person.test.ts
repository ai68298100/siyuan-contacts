import { test } from "node:test";
import assert from "node:assert/strict";
import {
    validateDraft,
    birthdayToMs,
    msToBirthday,
    invertFieldMap,
    summaryFromRow,
    emptyDraft,
} from "../src/domain/person.ts";
import { FIELD_SPECS } from "../src/domain/fields.ts";

test("validateDraft：姓名必填，邮箱与生日格式校验", () => {
    const errors = validateDraft({ ...emptyDraft() });
    assert.deepEqual(errors, ["姓名不能为空"]);
    assert.deepEqual(validateDraft({ ...emptyDraft(), name: "张三" }), []);
    assert.ok(validateDraft({ ...emptyDraft(), name: "张三", email: "bad-mail" }).includes("邮箱格式不正确"));
    assert.ok(validateDraft({ ...emptyDraft(), name: "张三", birthday: "1990/05/20" }).includes("生日日期格式不正确"));
});

test("birthdayToMs / msToBirthday：本地时区日期与毫秒互转", () => {
    const ms = birthdayToMs("1990-05-20");
    assert.ok(ms !== null);
    assert.equal(msToBirthday(ms), "1990-05-20");
    assert.equal(birthdayToMs("1990-13-01"), null, "拒绝不存在的日期");
    assert.equal(birthdayToMs("1990/1/1"), null);
    assert.equal(birthdayToMs("2026-02-29"), null);
    assert.equal(birthdayToMs("2026-04-31"), null);
    assert.equal(birthdayToMs(""), null);
    assert.equal(msToBirthday(birthdayToMs("2024-02-29")!), "2024-02-29");
    assert.equal(msToBirthday(undefined), "");
});

test("invertFieldMap：keyID 与稳定键互逆", () => {
    const fieldMap: Record<string, string> = {};
    for (const spec of FIELD_SPECS) fieldMap[spec.key] = `id-${spec.key}`;
    const inverted = invertFieldMap(fieldMap as never);
    assert.equal(inverted["id-phone"], "phone");
    assert.equal(inverted["id-related"], "related");
    assert.equal(Object.keys(inverted).length, FIELD_SPECS.length);
});

test("summaryFromRow：主键取文档 ID 与姓名，各字段按 keyID 归位，未知字段跳过", () => {
    const fieldMap: Record<string, string> = {
        birthday: "k-birth", lunarBirthday: "k-lunar", phone: "k-phone", email: "k-email",
        wechat: "k-wechat", website: "k-web", group: "k-group", tags: "k-tags", related: "k-rel",
    };
    const inverted = invertFieldMap(fieldMap as never);
    const row = {
        id: "item-1",
        cells: [
            { value: { keyID: "k-pk", blockID: "item-1", type: "block", block: { id: "doc-9", content: "张三" } }, valueType: "block" },
            { value: { keyID: "k-phone", type: "phone", phone: { content: "13800138000" } }, valueType: "phone" },
            { value: { keyID: "k-birth", type: "date", date: { content: birthdayToMs("1990-05-20"), isNotEmpty: true, isNotTime: true } }, valueType: "date" },
            { value: { keyID: "k-lunar", type: "checkbox", checkbox: { checked: true } }, valueType: "checkbox" },
            { value: { keyID: "k-group", type: "mSelect", mSelect: [{ content: "朋友" }] }, valueType: "mSelect" },
            { value: { keyID: "k-tags", type: "mSelect", mSelect: [{ content: "球友" }, { content: "重点" }] }, valueType: "mSelect" },
            { value: { keyID: "k-rel", type: "relation", relation: { blockIDs: ["item-2"] } }, valueType: "relation" },
            { value: { keyID: "k-unknown", type: "text", text: { content: "别人家的字段" } }, valueType: "text" },
        ],
    };
    const summary = summaryFromRow(row, inverted);
    assert.equal(summary.docId, "doc-9");
    assert.equal(summary.name, "张三");
    assert.equal(summary.phone, "13800138000");
    assert.equal(summary.birthday, "1990-05-20");
    assert.equal(summary.isLunar, true);
    assert.equal(summary.group, "朋友");
    assert.deepEqual(summary.tags, ["球友", "重点"]);
    assert.deepEqual(summary.relatedItemIds, ["item-2"]);
});
