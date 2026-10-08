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

test("api/data/domain/bridge/services 层不得依赖组件层、panels 或 svelte", () => {
    for (const dir of ["api", "data", "domain", "bridge"]) {
        for (const file of listFiles(path.join(SRC, dir), ".ts")) {
            for (const imported of importsOf(file)) {
                const forbidden =
                    imported.includes("components") ||
                    imported.includes("panels") ||
                    imported.startsWith("svelte") ||
                    imported.startsWith("siyuan") && dir === "domain";
                assert.ok(!forbidden, `${file} 违规依赖了 ${imported}`);
            }
        }
    }
    // services 层允许 siyuan（Plugin 类型）与 api/data/domain，但禁止组件与 panels
    for (const file of listFiles(path.join(SRC, "services"), ".ts")) {
        for (const imported of importsOf(file)) {
            const forbidden = imported.includes("components") || imported.includes("panels") || imported.startsWith("svelte");
            assert.ok(!forbidden, `${file} 违规依赖了 ${imported}`);
        }
    }
});

test("内核网络请求只能出现在 api/ 层", () => {
    const files = listFiles(SRC, ".ts").concat(listFiles(SRC, ".svelte"));
    for (const file of files) {
        // api/ 是内核交互的唯一边界；其它层不得直接调用宿主 fetch 或浏览器 fetch。
        if (path.relative(SRC, file).split(path.sep)[0] === "api") continue;
        const content = fs.readFileSync(file, "utf8");
        const directNetworkCall = /\b(?:fetch|fetchPost|fetchSync)\s*\(/.test(content);
        const importsKernelTransport = /\bimport\s*\{[^}]*\b(?:fetchPost|fetchSync)\b[^}]*\}\s*from\s*["']siyuan["']/.test(content);
        assert.ok(
            !directNetworkCall && !importsKernelTransport,
            `${file} 直接发网络请求或导入内核传输函数，内核交互必须经 api/ 层`,
        );
    }
});

test("插件自管 JSON 只能通过 data/storage.ts 访问宿主存储", () => {
    const storageFile = path.join(SRC, "data", "storage.ts");
    for (const file of listFiles(SRC, ".ts").concat(listFiles(SRC, ".svelte"))) {
        if (file === storageFile) continue;
        const content = fs.readFileSync(file, "utf8");
        // 仅拦截对宿主 Plugin 实例的直接调用，避免误报文档字符串和测试夹具。
        assert.ok(
            !/\b[A-Za-z_$][\w$]*\s*\.\s*(?:loadData|saveData)\s*\(/.test(content),
            `${file} 直接访问 loadData/saveData；插件自管 JSON 必须经 data/storage.ts`,
        );
    }
});

test("全 src 禁运行期动态 import（v0.4.0 事故防线：CJS 产物会拆出 require 相对 chunk，宿主 loader 加载即失败）", () => {
    for (const file of listFiles(SRC, ".ts").concat(listFiles(SRC, ".svelte"))) {
        const content = fs.readFileSync(file, "utf8");
        /* type 位置的 import("@/...") 是编译期擦除的类型引用，不受限；
           运行期动态 import 形如 await import(…) / = import(…) / => import(…) */
        const runtime = content
            .split(/\r?\n/)
            .filter((line) => !/^\s*(import type |\*\/)/.test(line))
            .join("\n");
        const dynamic = [...runtime.matchAll(/(?:await|=|=>)\s*import\s*\(/g)].map((match) => match.index);
        assert.ok(
            dynamic.length === 0,
            `${file} 含运行期动态 import（${dynamic.length} 处）——CJS 构建会拆出独立 chunk，宿主 require 无法解析相对路径导致插件加载失败；请改为静态导入`,
        );
    }
});
