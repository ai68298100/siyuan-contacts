import assert from "node:assert/strict";
import test from "node:test";
import { matchesFolderPrefix, normalizeFolderPrefix, normalizeImportTags } from "../src/domain/import.ts";

test("收编文件夹前缀兼容斜杠并只匹配子路径", () => {
    assert.equal(normalizeFolderPrefix(" 客户\\2026/ "), "/客户/2026");
    assert.equal(matchesFolderPrefix("/客户/2026/张三", "客户/2026"), true);
    assert.equal(matchesFolderPrefix("/客户/20260/李四", "客户/2026"), false);
    assert.equal(matchesFolderPrefix("/朋友/王五", ""), true);
});

test("收编标签按中英文分隔符去重并保序", () => {
    assert.deepEqual(normalizeImportTags("客户, 重点，客户\n老友"), ["客户", "重点", "老友"]);
});
