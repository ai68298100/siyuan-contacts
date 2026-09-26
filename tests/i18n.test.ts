/**
 * i18n 守门：所有语言文件的键集合必须一致（D-0004/D-0010 语言策略）。
 * 直接读文件比较，避免 ESM JSON 导入断言差异。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

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
