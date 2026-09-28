/**
 * 初始化续建的对账逻辑（D-0019）：
 * 现有数据库列 ↔ 字段契约的匹配、avID 还原。
 * 这两条纯函数决定了重跑向导时"跳过哪些列、补哪些列"，是首次引导卡死修复的核心守门。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { FIELD_SPECS, fieldSpec, reconcileFieldMap } from "../src/domain/fields.ts";
import { parseAvIdFromBlockMarkdown } from "../src/domain/init-plan.ts";

const column = (id: string, name: string, type: string) => ({ id, name, type });

/** 全字段的中文默认列（外加建库自带的主键/选择列） */
function fullColumns() {
    return [
        column("col-pk", "Primary Key", "block"),
        column("col-select", "Select", "select"),
        ...FIELD_SPECS.map((spec) => column(`col-${spec.key}`, spec.nameZh, spec.type)),
        column("col-back", "被相关人", "relation"),
    ];
}

test("avID 还原：从数据库块 markdown 提取", () => {
    assert.equal(
        parseAvIdFromBlockMarkdown('<div data-type="NodeAttributeView" data-av-id="20260928102445-uyia9by" data-av-type="table"></div>'),
        "20260928102445-uyia9by",
    );
});

test("avID 还原：非数据库块/非法 ID/非字符串一律 undefined", () => {
    assert.equal(parseAvIdFromBlockMarkdown("<div data-type=\"NodeParagraph\"></div>"), undefined);
    assert.equal(parseAvIdFromBlockMarkdown('<div data-av-id="not-an-id"></div>'), undefined);
    assert.equal(parseAvIdFromBlockMarkdown(undefined), undefined);
    assert.equal(parseAvIdFromBlockMarkdown(123), undefined);
});

test("对账：默认列名全部命中，无缺失", () => {
    const result = reconcileFieldMap(fullColumns());
    assert.equal(result.matched, FIELD_SPECS.length);
    assert.deepEqual(result.missing, []);
    assert.equal(result.fieldMap.birthday, "col-birthday");
    assert.equal(result.fieldMap.related, "col-related");
    assert.equal(result.backRelationExists, true);
    assert.equal(result.lastColumnId, "col-back");
});

test("对账：英文默认列名与已改名但同类型的列都能对上", () => {
    const columns = [
        column("c1", "Birthday", "date"),
        column("c2", "电话", "phone"),
        column("c3", "微信", "text"),
    ];
    const result = reconcileFieldMap(columns);
    assert.equal(result.fieldMap.birthday, "c1");
    assert.equal(result.fieldMap.phone, "c2");
    assert.equal(result.fieldMap.wechat, "c3");
});

test("对账：类型不符不匹配（宁可补建也不绑定错列）", () => {
    const columns = [column("c1", "生日", "text"), column("c2", "电话", "phone")];
    const result = reconcileFieldMap(columns);
    assert.equal(result.fieldMap.birthday, undefined);
    assert.equal(result.fieldMap.phone, "c2");
    assert.ok(result.missing.some((spec) => spec.key === "birthday"));
});

test("对账：重名列只绑一个字段，多余的同名列保持未绑定（不误配、不删除）", () => {
    const columns = [column("c1", "生日", "date"), column("c2", "生日", "date"), column("c3", "电话", "phone")];
    const result = reconcileFieldMap(columns);
    assert.equal(result.fieldMap.birthday, "c1");
    assert.equal(result.fieldMap.phone, "c3");
    assert.equal(result.matched, 2);
    assert.ok(!result.missing.some((spec) => spec.key === "birthday"), "已有列可用时不重复补建");
    assert.ok(!Object.values(result.fieldMap).includes("c2"), "多余的同名列不得再绑字段");
});

test("对账：优先沿用设置里已记录的 keyID（改过列名也不丢）", () => {
    const columns = [
        column("c1", "出生日期", "date"),
        column("c2", "生日", "date"),
    ];
    const result = reconcileFieldMap(columns, { birthday: "c1" });
    assert.equal(result.fieldMap.birthday, "c1", "旧 keyID 优先于默认列名");
});

test("对账：缺失清单按字段契约顺序，回链列未建时 backRelationExists 为 false", () => {
    const columns = [column("c1", "生日", "date")];
    const result = reconcileFieldMap(columns);
    assert.deepEqual(result.missing.map((spec) => spec.key), [
        "lunarBirthday", "phone", "email", "wechat", "website", "group", "tags", "related",
    ]);
    assert.equal(result.backRelationExists, false);
    assert.equal(result.lastColumnId, "c1");
});

test("对账：空数据库（只有主键列）时全部缺失，previousKeyID 落在主键列", () => {
    const result = reconcileFieldMap([column("pk", "Primary Key", "block"), column("sel", "Select", "select")]);
    assert.equal(result.matched, 0);
    assert.equal(result.missing.length, FIELD_SPECS.length);
    assert.equal(result.lastColumnId, "sel");
    assert.equal(fieldSpec("related").backNameZh, "被相关人");
});
