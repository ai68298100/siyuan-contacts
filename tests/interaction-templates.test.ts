import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
    DEFAULT_TEMPLATES,
    newTemplateId,
    normalizeTemplates,
    normalizeTemplatesForWrite,
    renderTemplate,
} from "../src/domain/interaction-templates.ts";

const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
        if (specifier.startsWith(".") && context.parentURL?.startsWith("file:")) {
            const candidate = new URL(specifier + ".ts", context.parentURL);
            if (existsSync(fileURLToPath(candidate))) return nextResolve(candidate.href, context);
        }
        return nextResolve(specifier, context);
    },
});
const { saveTemplates, listTemplates } = await import("../src/services/templates.ts");
const { loadTemplatesStoreStrict, saveTemplatesStore, mergeTemplatesStore, TEMPLATES_STORAGE_KEY } = await import("../src/data/templates.ts");
test.after(() => hooks.deregister());

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

function templateFixture(initial: unknown = null, failRead = false) {
    let stored = structuredClone(initial);
    let writes = 0;
    const plugin = {
        async loadData(key: string) {
            assert.equal(key, TEMPLATES_STORAGE_KEY);
            if (failRead) throw new Error("模板读取断开");
            return structuredClone(stored);
        },
        async saveData(key: string, value: unknown) {
            assert.equal(key, TEMPLATES_STORAGE_KEY);
            writes += 1;
            stored = structuredClone(value);
        },
    } as never;
    return { plugin, stored: () => stored, writes: () => writes };
}

test("模板严格读取：首次空库回退默认，已保存空列表保持空且零写入", async () => {
    for (const initial of [null, ""]) {
        const fixture = templateFixture(initial);
        assert.equal(await loadTemplatesStoreStrict(fixture.plugin), null);
        assert.deepEqual(await listTemplates(fixture.plugin), DEFAULT_TEMPLATES);
        assert.equal(fixture.writes(), 0);
    }
    const fixture = templateFixture({ schemaVersion: 1, templates: [] });
    assert.deepEqual(await loadTemplatesStoreStrict(fixture.plugin), { schemaVersion: 1, templates: [] });
    assert.deepEqual(await listTemplates(fixture.plugin), []);
    assert.equal(fixture.writes(), 0);
});

test("模板严格读取和列表均传播读故障，不按默认模板伪装成功", async () => {
    const fixture = templateFixture({ schemaVersion: 1, templates: [{ id: "old", name: "已有", content: "原文" }] }, true);
    await assert.rejects(loadTemplatesStoreStrict(fixture.plugin), /存储读取失败/);
    await assert.rejects(listTemplates(fixture.plugin), /存储读取失败/);
    assert.equal(fixture.writes(), 0);
});

test("模板严格读取和列表拒绝坏库，不过滤、去重或截断后返回成功", async () => {
    const valid = { id: "old", name: "已有", content: "原文" };
    const cases = [
        [], { schemaVersion: 2, templates: [] }, { schemaVersion: 1 },
        { schemaVersion: 1, templates: "坏列表" },
        { schemaVersion: 1, templates: [{ ...valid, name: "" }] },
        { schemaVersion: 1, templates: [valid, { ...valid }] },
        { schemaVersion: 1, templates: Array.from({ length: 51 }, (_, index) => ({ ...valid, id: `t${index}` })) },
    ];
    for (const initial of cases) {
        const fixture = templateFixture(initial);
        await assert.rejects(loadTemplatesStoreStrict(fixture.plugin), /模板|格式|版本/);
        await assert.rejects(listTemplates(fixture.plugin), /模板|格式|版本/);
        assert.deepEqual(fixture.stored(), initial);
        assert.equal(fixture.writes(), 0);
    }
});

test("模板保存边界：超限、重复或非法条目明确拒绝，不静默丢弃草稿", () => {
    const many = Array.from({ length: 51 }, (_, index) => ({ id: `t${index}`, name: `模板${index}`, content: `备注${index}` }));
    assert.throws(() => normalizeTemplatesForWrite(many), /最多 50 条/);
    assert.throws(() => normalizeTemplatesForWrite([{ id: "a", name: "有效", content: "文本" }, { id: "a", name: "重复", content: "保留我" }]), /标识重复/);
    for (const invalid of [null, "wrong", [{ id: "a", name: "", content: "保留我" }], [{ id: " ", name: "无标识", content: "保留我" }], [{ id: "a", name: "有名", content: null }]]) {
        assert.throws(() => normalizeTemplatesForWrite(invalid), /格式不正确/);
    }
});

test("模板备注的多行、Markdown、IAL 文本保存并重新读取不变", async () => {
    const fixture = templateFixture();
    const content = "第一段 *标记* [链接](https://example.com)\n\n第二段\\路径\n{: custom-lvct-person-note=\"fake\"}";
    const saved = await saveTemplates(fixture.plugin, [{ id: "a", name: " 多行模板 ", content: `  ${content}  ` }]);
    assert.deepEqual(saved, [{ id: "a", name: "多行模板", content }]);
    assert.deepEqual(await listTemplates(fixture.plugin), saved);
    assert.equal(fixture.writes(), 1);
});

test("模板服务和存储直写均在非法/超限时零写入，保留原备注库", async () => {
    const original = { schemaVersion: 1, templates: [{ id: "old", name: "已有模板", content: "原始备注" }] };
    const fixture = templateFixture(original);
    const many = Array.from({ length: 51 }, (_, index) => ({ id: `t${index}`, name: `模板${index}`, content: `备注${index}` }));
    await assert.rejects(saveTemplates(fixture.plugin, many), /最多 50 条/);
    await assert.rejects(saveTemplatesStore(fixture.plugin, [{ id: "a", name: "", content: "不能丢的备注" }]), /格式不正确/);
    assert.equal(fixture.writes(), 0);
    assert.deepEqual(fixture.stored(), original);
});

test("模板保存检查现有库损坏，不用容错展示结果覆盖原文件", async () => {
    for (const original of [{ schemaVersion: 1, templates: "坏列表" }, { schemaVersion: 1, templates: [{ id: "old", name: "", content: "保留我" }] }]) {
        const fixture = templateFixture(original);
        await assert.rejects(saveTemplates(fixture.plugin, [{ id: "new", name: "新模板", content: "新备注" }]), /格式不正确/);
        assert.equal(fixture.writes(), 0);
        assert.deepEqual(fixture.stored(), original);
    }
});

test("模板合并超出容量明确失败，不截断条目或虚报新增数量", async () => {
    const original = { schemaVersion: 1, templates: Array.from({ length: 50 }, (_, index) => ({ id: `t${index}`, name: `模板${index}`, content: `备注${index}` })) };
    const fixture = templateFixture(original);
    await assert.rejects(mergeTemplatesStore(fixture.plugin, [{ id: "incoming", name: "应保留", content: "迁移备注" }]), /最多 50 条/);
    assert.equal(fixture.writes(), 0);
    assert.deepEqual(fixture.stored(), original);
    assert.equal(await mergeTemplatesStore(fixture.plugin, [{ id: "t0", name: "冲突", content: "不覆盖现状" }]), 0);
    assert.deepEqual(fixture.stored(), original);
});
