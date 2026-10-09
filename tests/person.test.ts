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
import { profileText, matchesProfileFilters } from "../src/domain/people-profiles.ts";
import type { PersonProfile } from "../src/domain/people-profiles.ts";
import { mergeRelationshipLabelBackup, parsePersonRelationshipLabelStore } from "../src/domain/person-relationship-labels.ts";

test("B12 三项资料：未知不当空，当前分类组合筛选不匹配历史与称谓提示", () => {
    const profile: PersonProfile = { readAt: 1, affiliations: { state: "known", value: { work: [], education: [], unspecified: [], history: [], unresolved: [] } },
        relationship: { state: "known", labels: ["同学"], recordId: null, updatedAt: null } };
    assert.equal(profileText(profile, "work"), "未填写");
    assert.equal(matchesProfileFilters(profile, { relationshipLabel: "同学" }), true);
    assert.equal(matchesProfileFilters(profile, { workQuery: "未填写" }), false);
    assert.equal(matchesProfileFilters({ ...profile, relationship: { state: "unknown", labels: null } }, { relationshipLabel: "同学" }), false);
    assert.equal(profileText({ ...profile, affiliations: { state: "unknown", message: "fail" } }, "education"), "组织归属尚未核实");
    assert.equal(matchesProfileFilters(undefined, {}), true);
});

test("B12 称谓恢复：空值保现状、组合冲突不覆盖、其他本人不转移", () => {
    const record = { id: "20261004000000-label01", selfDocId: "20261004000000-self001", personDocId: "20261004000000-person1", labels: ["朋友"], createdAt: 1, updatedAt: 2 };
    const incoming = parsePersonRelationshipLabelStore({ schemaVersion: 1, labels: [record] });
    const current = parsePersonRelationshipLabelStore({ schemaVersion: 1, labels: [{ ...record, labels: [], updatedAt: 3 }] });
    const reachable = new Set([record.selfDocId, record.personDocId]);
    const conflict = mergeRelationshipLabelBackup(current, incoming, record.selfDocId, reachable);
    assert.deepEqual(conflict.store, current);
    assert.equal(conflict.summary.issues[0].reason, "conflict");
    const empty = { schemaVersion: 1 as const, labels: [] };
    assert.equal(mergeRelationshipLabelBackup(empty, incoming, "20261004000000-self002", reachable).summary.issues[0].selfDocId, record.selfDocId);
    const merged = mergeRelationshipLabelBackup(empty, incoming, record.selfDocId, reachable);
    assert.equal(merged.summary.merged, 1);
    assert.equal(mergeRelationshipLabelBackup(merged.store, incoming, null, new Set()).summary.merged, 0);
    assert.equal(mergeRelationshipLabelBackup(empty, incoming, record.selfDocId, new Set([record.selfDocId])).summary.issues[0].reason, "unreachable");
});

test("validateDraft：姓名必填，邮箱与生日格式校验", () => {
    const errors = validateDraft({ ...emptyDraft() });
    assert.deepEqual(errors, ["姓名不能为空"]);
    assert.deepEqual(validateDraft({ ...emptyDraft(), name: "张三" }), []);
    assert.ok(validateDraft({ ...emptyDraft(), name: "张三", email: "bad-mail" }).includes("邮箱格式不正确"));
    assert.ok(validateDraft({ ...emptyDraft(), name: "张三", birthday: "1990/05/20" }).includes("生日日期格式不正确"));
    assert.ok(validateDraft({ ...emptyDraft(), name: "张三", birthday: "2026-02-30" }).includes("生日不是有效日期"));
});

test("validateDraft：农历生日按农历校验，并阻止无法写入日期列的组合", () => {
    assert.deepEqual(validateDraft({ ...emptyDraft(), name: "张三", birthday: "1990-02-28", isLunar: true }), []);
    assert.ok(validateDraft({ ...emptyDraft(), name: "张三", birthday: "1990-02-31", isLunar: true }).includes("农历生日不是有效日期"));
    assert.ok(validateDraft({ ...emptyDraft(), name: "张三", birthday: "1990-02-30", isLunar: true }).includes("农历生日日期暂不支持，请重新选择"));
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

test("生日回读：1970 年之前和零时间戳有效，空日期由标记决定", () => {
    for (const date of ["1950-01-02", "1969-12-31", "1970-01-01"]) {
        assert.equal(msToBirthday(birthdayToMs(date)!), date);
    }
    assert.notEqual(msToBirthday(0), "");
    assert.equal(msToBirthday(NaN), "");
    const row = { id: "row", cells: [{ valueType: "date", value: {
        keyID: "birth", type: "date", date: { content: 0, isNotEmpty: false },
    } }] };
    assert.equal(summaryFromRow(row, { birth: "birthday" }).birthday, "");
    row.cells[0].value.date.isNotEmpty = true;
    assert.equal(summaryFromRow(row, { birth: "birthday" }).birthday, msToBirthday(0));
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
