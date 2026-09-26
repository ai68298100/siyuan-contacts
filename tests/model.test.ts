/**
 * 域层纯函数单测（node --test 原生跑 TS：类型擦除语法，无枚举/命名空间）。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { FIELD_SPECS, fieldSpec } from "../src/domain/fields.ts";
import { normalizeSettings, SETTINGS_STORE_VERSION } from "../src/domain/model.ts";

test("字段契约：含九个预设字段且 relation 指定回链名", () => {
    assert.equal(FIELD_SPECS.length, 9);
    const related = fieldSpec("related");
    assert.equal(related.type, "relation");
    assert.ok(related.backNameZh);
    const keys = new Set(FIELD_SPECS.map((spec) => spec.key));
    assert.equal(keys.size, FIELD_SPECS.length, "字段键不得重复");
});

test("normalizeSettings：合法设置原样通过并补齐版本", () => {
    const raw = {
        schemaVersion: 1,
        notebookId: "20260927000000-aaaaaaa",
        notebookName: "人脉",
        hostDocId: "20260927000000-bbbbbbb",
        dbBlockId: "20260927000000-ccccccc",
        avId: "20260927000000-ddddddd",
        fieldMap: { birthday: "20260927000000-eeeeeee" },
        initializedAt: "2026-09-27T00:00:00.000Z",
    };
    const settings = normalizeSettings(raw);
    assert.ok(settings);
    assert.equal(settings.schemaVersion, SETTINGS_STORE_VERSION);
    assert.equal(settings.fieldMap.birthday, "20260927000000-eeeeeee");
});

test("normalizeSettings：缺字段/坏版本/脏 fieldMap 一律拒绝", () => {
    const base = {
        schemaVersion: 1,
        notebookId: "x",
        notebookName: "人脉",
        hostDocId: "x",
        dbBlockId: "x",
        avId: "x",
        fieldMap: {},
        initializedAt: "2026-09-27T00:00:00.000Z",
    };
    assert.equal(normalizeSettings(null), null);
    assert.equal(normalizeSettings(undefined), null);
    assert.equal(normalizeSettings({ ...base, schemaVersion: 2 }), null);
    assert.equal(normalizeSettings({ ...base, avId: "" }), null);
    assert.equal(normalizeSettings({ ...base, fieldMap: null }), null);
    assert.equal(normalizeSettings({ ...base, fieldMap: { birthday: "" } }), null);
    // 未知多余字段被丢弃，不抛错
    const tolerated = normalizeSettings({ ...base, futureField: 1 });
    assert.ok(tolerated);
});
