/**
 * i18n 守门：所有语言文件的键集合必须一致（D-0004/D-0010 语言策略）。
 * 直接读文件比较，避免 ESM JSON 导入断言差异。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { translateText } from "../src/domain/translation.ts";

const I18N_DIR = path.resolve(import.meta.dirname, "..", "public", "i18n");

function flattenKeys(value, prefix = ""): string[] {
    const keys: string[] = [];
    if (value !== null && typeof value === "object") {
        for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
            const full = prefix ? `${prefix}.${key}` : key;
            if (child !== null && typeof child === "object") keys.push(...flattenKeys(child, full));
            else keys.push(full);
        }
    }
    return keys;
}

test("i18n：zh-CN 与 en 键集合一致（parity）", () => {
    const zh = JSON.parse(fs.readFileSync(path.join(I18N_DIR, "zh-CN.json"), "utf8"));
    const en = JSON.parse(fs.readFileSync(path.join(I18N_DIR, "en.json"), "utf8"));
    const zhKeys = flattenKeys(zh).sort();
    const enKeys = flattenKeys(en).sort();
    assert.deepEqual(enKeys, zhKeys, "en.json 与 zh-CN.json 键集不一致");
});

test("i18n：zh-CN 非空且无占位残留", () => {
    const zh = JSON.parse(fs.readFileSync(path.join(I18N_DIR, "zh-CN.json"), "utf8"));
    for (const [key, value] of Object.entries(zh)) {
        assert.equal(typeof value, "string", `${key} 必须是字符串`);
        assert.ok((value as string).trim().length > 0, `${key} 不能为空`);
        assert.ok(!/TODO|FIXME/.test(value as string), `${key} 含未完成标记`);
    }
});

test("翻译：缺失/空字符串回退，姓名插值按字面保留", () => {
    assert.equal(translateText(undefined, "key", "默认"), "默认");
    assert.equal(translateText({ key: "  " }, "key", "默认"), "默认");
    assert.equal(translateText({ key: "Person: {name} / {count}" }, "key", "默认", { name: "$& <李四>", count: 0 }), "Person: $& <李四> / 0");
    assert.equal(translateText({}, "key", "{name} {missing}", { name: "甲" }), "甲 {missing}");
});

test("i18n：英文非空，双语插值参数一致", () => {
    const zh = JSON.parse(fs.readFileSync(path.join(I18N_DIR, "zh-CN.json"), "utf8"));
    const en = JSON.parse(fs.readFileSync(path.join(I18N_DIR, "en.json"), "utf8"));
    const params = (value: string) => [...value.matchAll(/\{([a-zA-Z0-9_]+)\}/g)].map((match) => match[1]).sort();
    for (const [key, value] of Object.entries(en)) {
        assert.equal(typeof value, "string");
        assert.ok((value as string).trim().length > 0, `${key} 英文为空`);
        assert.deepEqual(params(value as string), params(zh[key]), `${key} 插值参数不一致`);
    }
});
