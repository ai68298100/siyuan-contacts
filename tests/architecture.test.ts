/**
 * 架构守门测试（移植打卡库 boundaries 思想）：
 * - domain/ 必须是纯函数层：禁止 import svelte、siyuan、api/、data/、components/；
 * - api/ 与 data/ 等下层禁止 import components/ 与 svelte；
 * - 组件不得直接 fetch 内核端点（必须经 api/ 层）。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const SRC = path.resolve(import.meta.dirname, "..", "src");

function listFiles(dir, ext) {
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            out.push(...listFiles(full, ext));
        } else if (entry.name.endsWith(ext)) {
            out.push(full);
        }
    }
    return out;
}

function importsOf(file) {
    // `import type` 是编译期擦除的，不构成运行时依赖，从扫描中剔除（逐行过滤）
    const raw = fs.readFileSync(file, "utf8");
    const content = raw
        .split(/\r?\n/)
        .filter((line) => !line.trimStart().startsWith("import type "))
        .join("\n");
    const imports = [];
    const re = /(?:import|from)\s+["']([^"']+)["']/g;
    for (const match of content.matchAll(re)) {
        imports.push(match[1]);
    }
    return imports;
}

test("domain 层保持纯净（无 svelte / siyuan / 上层依赖）", () => {
    const domainDir = path.join(SRC, "domain");
    for (const file of listFiles(domainDir, ".ts")) {
        for (const imported of importsOf(file)) {
            const external = imported.startsWith("svelte") || imported.startsWith("siyuan") || imported.startsWith("@");
            const upward = imported.startsWith("..") && !imported.startsWith("../domain");
            assert.ok(
                !external && !upward,
                `${file} 违规依赖了 ${imported}；domain 层只允许相对引用自身`,
            );
        }
    }
});

test("domain 层运行时相对导入必须带 .ts 扩展名（node --test 直跑约束）", () => {
    const domainDir = path.join(SRC, "domain");
    for (const file of listFiles(domainDir, ".ts")) {
        for (const imported of importsOf(file)) {
            const isRelativeSelf = imported.startsWith("./") || imported.startsWith("../domain");
            const hasExtension = imported.endsWith(".ts");
            assert.ok(
                !isRelativeSelf || hasExtension,
                `${file} 的运行时导入 ${imported} 缺少 .ts 扩展名（type-only 导入不受限）`,
            );
        }
    }
});

test("api/data/services/bridge 层不得依赖组件层或 svelte", () => {
    for (const dir of ["api", "data", "services", "bridge"]) {
        for (const file of listFiles(path.join(SRC, dir), ".ts")) {
            for (const imported of importsOf(file)) {
                const hitsComponents = imported.includes("components");
                const hitsSvelte = imported.startsWith("svelte");
                assert.ok(
                    !hitsComponents && !hitsSvelte,
                    `${file} 违规依赖了 ${imported}`,
                );
            }
        }
    }
});

test("组件不得直接发内核请求（必须经 api/ 层）", () => {
    for (const file of listFiles(SRC, ".svelte")) {
        const content = fs.readFileSync(file, "utf8");
        const directFetch = content.includes("fetchPost") || content.includes("fetchSync") || content.includes("/api/");
        assert.ok(!directFetch, `${file} 直接发内核请求，必须经 api/ 层`);
    }
});
