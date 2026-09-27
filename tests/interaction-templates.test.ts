import assert from "node:assert/strict";
import test from "node:test";
import {
    DEFAULT_TEMPLATES,
    newTemplateId,
    normalizeTemplates,
    renderTemplate,
} from "../src/domain/interaction-templates.ts";

test("模板归一化：坏条目丢弃、去首尾空白、按 id 去重、截断上限", () => {
    const result = normalizeTemplates([
        { id: "a", name: " 见面 ", content: " 和{{姓名}}见面 " },
        { id: "a", name: "重复", content: "重复" },
        { id: "", name: "缺 ID", content: "x" },
        { name: "缺 ID 二", content: "x" },
        { id: "c", name: "   ", content: "x" },
        null,
        "junk",
    ]);
    assert.deepEqual(result, [{ id: "a", name: "见面", content: "和{{姓名}}见面" }]);
    assert.deepEqual(normalizeTemplates("junk"), []);
    const many = Array.from({ length: 60 }, (_, index) => ({ id: `t${index}`, name: `n${index}`, content: "c" }));
    assert.equal(normalizeTemplates(many).length, 50);
});

test("变量替换：全部占位替换所有出现，未知占位原样保留", () => {
    const rendered = renderTemplate(
        "{{姓名}}，{{日期}} 记一笔。上次互动：{{上次互动}}。{{姓名}}的备注，{{未知}}占位",
        { name: "林晓梅", date: "2026-09-28", lastInteraction: "2026-08-01" },
    );
    assert.equal(rendered.includes("{{姓名}}"), false);
    assert.equal(rendered.includes("{{日期}}"), false);
    assert.equal(rendered.includes("{{上次互动}}"), false);
    assert.equal(rendered.includes("林晓梅"), true);
    assert.equal(rendered.includes("2026-09-28"), true);
    assert.equal(rendered.includes("2026-08-01"), true);
    assert.equal(rendered.includes("{{未知}}"), true);
});

test("内置默认模板：见面/电话/聚会三条且占位符合法", () => {
    assert.deepEqual(DEFAULT_TEMPLATES.map((template) => template.name), ["见面", "电话", "聚会"]);
    for (const template of DEFAULT_TEMPLATES) {
        assert.equal(normalizeTemplates([template]).length, 1);
    }
    assert.notEqual(newTemplateId(), newTemplateId());
});
