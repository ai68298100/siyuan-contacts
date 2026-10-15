/* 真隔离内核：生产 api/graph.ts 的原生 refs 只读投影、分页与宿主配置保护。 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import net from "node:net";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { prepareIsolatedWorkspace, assertTestPortAvailable, observeTestKernel } from "../e2e/kernel-safety.mjs";

const WORKSPACE = path.join(os.tmpdir(), `SiYuan-Lvct-NativeRefs-${randomUUID()}`);
const MARKER = "renmai-native-refs-spike.json";
const OUTPUT = path.resolve("scripts/spike/b14-native-refs-results.json");
const results = [];
const record = (name, detail) => { results.push({ name, ok: true, detail }); console.log(`PASS ${name} — ${detail}`); };
let base;
let token = "";
let assertRunning;
const reads = [];

async function api(route, body = {}) {
    assertRunning?.();
    const headers = { "Content-Type": "application/json" };
    if (token) headers.Authorization = `Token ${token}`;
    const response = await fetch(`${base}${route}`, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
    const envelope = await response.json();
    assertRunning?.();
    return envelope;
}
async function checked(route, body = {}) {
    const envelope = await api(route, body);
    if (envelope.code !== 0) throw new Error(`${route}: ${envelope.msg}`);
    return envelope.data;
}

async function main() {
    const candidates = ["D:\\biji\\SiYuan\\resources\\kernel\\SiYuan-Kernel.exe", "D:\\RJ\\SiYuan\\resources\\kernel\\SiYuan-Kernel.exe",
        path.join(process.env.ProgramFiles || "C:\\Program Files", "SiYuan", "resources", "kernel", "SiYuan-Kernel.exe")];
    const kernel = candidates.find((candidate) => fs.existsSync(candidate));
    if (!kernel) throw new Error("未找到思源测试内核");
    const appDir = path.resolve(path.dirname(kernel), "..");
    const port = await new Promise((resolve, reject) => {
        const server = net.createServer();
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => { const selected = server.address().port; server.close((error) => error ? reject(error) : resolve(selected)); });
    });
    await assertTestPortAvailable("127.0.0.1", port);
    base = `http://127.0.0.1:${port}`;
    prepareIsolatedWorkspace(WORKSPACE, MARKER, "renmai native-refs-spike");
    const child = spawn(kernel, ["--workspace", WORKSPACE, "serve", "--wd", appDir, "--port", String(port)], { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, SIYUAN_WORKSPACE_PATH: WORKSPACE } });
    assertRunning = observeTestKernel(child);
    const logs = [];
    for (const stream of [child.stdout, child.stderr]) stream.on("data", (chunk) => { logs.push(String(chunk)); if (logs.length > 200) logs.shift(); });
    let hooks;
    try {
        const deadline = Date.now() + 60_000;
        let booted = false;
        while (Date.now() < deadline) {
            assertRunning();
            const progress = await checked("/api/system/bootProgress").catch(() => null);
            if (Number(progress?.progress) >= 100) { booted = true; break; }
            await new Promise((resolve) => setTimeout(resolve, 250));
        }
        if (!booted) throw new Error(`隔离内核启动超时：${logs.slice(-5).join("")}`);
        token = JSON.parse(fs.readFileSync(path.join(WORKSPACE, "conf/conf.json"), "utf8")).accessAuthCode || "";
        const version = await checked("/api/system/version");
        record("隔离内核启动", `v${version}; 随机回环端口; 独立标记工作区`);
        const notebook = (await checked("/api/notebook/createNotebook", { name: "native-refs-spike" })).notebook.id;
        const createDoc = (name) => checked("/api/filetree/createDocWithMd", { notebook, path: `/${name}`, markdown: `# ${name}\n\n` });
        const center = await createDoc("中心人物");
        const targets = [];
        for (let start = 0; start < 205; start += 8) {
            const chunk = Array.from({ length: Math.min(8, 205 - start) }, (_, index) => `联系人${String(start + index).padStart(3, "0")}`);
            targets.push(...await Promise.all(chunk.map(createDoc)));
        }
        const incoming = await createDoc("回链人物");
        const unrelated = await createDoc("非登记笔记");
        const protocol = await createDoc("普通协议链接");
        await checked("/api/block/insertBlock", { dataType: "markdown", parentID: center, data:
            [...targets, targets[0], center, unrelated].map((id) => `((${id} '引用'))`).join("\n\n") });
        await checked("/api/block/insertBlock", { dataType: "markdown", parentID: incoming, data: `((${center} '中心人物'))` });
        await checked("/api/block/insertBlock", { dataType: "markdown", parentID: protocol, data: `[中心人物](siyuan://blocks/${center})` });
        await checked("/api/sqlite/flushTransaction");
        // 只在隔离工作区预设一组非默认宿主图配置，验证生产读取绝不重置它。
        await checked("/api/graph/getLocalGraph", { id: center, conf: { dailyNote: true, type: { heading: true, tag: true }, d3: { nodeSize: 27, linkDistance: 173 } } });
        await checked("/api/graph/getGraph", { conf: { dailyNote: true, minRefs: 2, type: { heading: true }, d3: { nodeSize: 29, linkDistance: 181 } } });
        const graphConf = () => JSON.parse(fs.readFileSync(path.join(WORKSPACE, "conf/conf.json"), "utf8")).graph;
        const before = graphConf();
        globalThis.__lvctNativeRefsRequest = async (route, body) => {
            const stmt = String(body.stmt ?? "");
            const envelope = await api(route, body);
            reads.push({ route, stmt, bytes: Buffer.byteLength(stmt, "utf8"), rows: Array.isArray(envelope.data) ? envelope.data.length : null });
            if (stmt.includes("FROM refs") && Array.isArray(envelope.data)) {
                const queryIds = new Set([...stmt.matchAll(/'(\d{14}-[0-9a-z]{7})'/g)].map((match) => match[1]));
                assert(envelope.data.every((row) => queryIds.has(row.root_id) && queryIds.has(row.def_block_root_id) && row.root_id !== row.def_block_root_id),
                    "SQL 响应仍包含非登记端点或自引用，占用图谱分页/预算");
            }
            return envelope;
        };
        hooks = registerHooks({
            resolve(specifier, context, nextResolve) {
                if (specifier === "siyuan") return { shortCircuit: true, url: "data:text/javascript," + encodeURIComponent(
                    "export function fetchPost(route,body,callback,_headers,failure){globalThis.__lvctNativeRefsRequest(route,body).then(callback,failure);}") };
                if (specifier.startsWith(".") && context.parentURL?.startsWith("file:")) {
                    const candidate = new URL(specifier + ".ts", context.parentURL);
                    if (fs.existsSync(fileURLToPath(candidate))) return nextResolve(candidate.href, context);
                }
                return nextResolve(specifier, context);
            },
            load(url, context, nextLoad) {
                if (url.startsWith("file:") && url.endsWith(".ts")) return { shortCircuit: true, format: "module", source:
                    ts.transpileModule(fs.readFileSync(fileURLToPath(url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext } }).outputText };
                return nextLoad(url, context);
            },
        });
        const { fetchLocalGraph, fetchGlobalGraph } = await import("../../src/api/graph.ts");
        const allowed = new Set([center, ...targets, incoming, protocol]);
        const localStart = reads.length;
        const baseStart = performance.now();
        const local = await fetchLocalGraph(center, allowed);
        const baseDuration = performance.now() - baseStart;
        assert.equal(local.nodes.length, 207);
        assert.equal(local.links.length, 206);
        assert(local.links.some((link) => link.from === incoming && link.to === center));
        assert(!local.nodes.some((node) => node.id === unrelated || node.id === protocol));
        record("生产局部引用投影", "205 出链 + 1 回链；多块同文档引用合为文档对；自引用、非登记笔记和协议链接排除");
        const localPages = reads.slice(localStart).filter((request) => request.stmt.includes("FROM refs"));
        assert.equal(localPages.length, 2);
        assert(localPages[1].stmt.includes("def_block_root_id >"));
        assert.equal(localPages.at(-1).rows, 6, "SQL 未在分页前排除非登记笔记、自引用");
        record("真实复合 keyset 分页", "200+1 文档对；第二页完整读取；未受宿主默认 SQL 行数限制截断");
        const global = await fetchGlobalGraph(allowed);
        assert.equal(global.nodes.length, 208);
        assert.equal(global.links.length, 206);
        assert(global.nodes.some((node) => node.id === protocol));
        assert(!global.nodes.some((node) => node.id === unrelated));
        record("生产登记引用投影", "208 登记文档 / 206 引用文档对；文档和源引用按 100 ID 分批读取");
        record("SQL 两端登记范围", "局部/全局 SQL 响应均无非登记端点和自引用；普通笔记引用不占页数或 50k 预算");
        const measurements = [{ filterIds: allowed.size, durationMs: Math.round(baseDuration * 100) / 100,
            maxSqlBytes: Math.max(...reads.slice(localStart, localStart + 5).map((request) => request.bytes)) }];
        for (const size of [1_000, 10_000]) {
            const expanded = new Set(allowed);
            for (let index = 0; expanded.size < size; index += 1) expanded.add(`20261012000000-z${String(index).padStart(6, "0")}`);
            const readStart = reads.length;
            const started = performance.now();
            const scaled = await fetchLocalGraph(center, expanded);
            assert.equal(scaled.links.length, 206);
            measurements.push({ filterIds: size, durationMs: Math.round((performance.now() - started) * 100) / 100,
                maxSqlBytes: Math.max(...reads.slice(readStart).map((request) => request.bytes)), requests: reads.length - readStart });
        }
        record("白名单 SQL 参数规模", JSON.stringify({ measurements, note: "208 个真实登记文档，其余为合法但不存在的过滤 ID；衡量参数体积/解析，不代表真实 10k 库性能" }));
        assert(reads.every((request) => request.route === "/api/query/sql" && request.stmt.startsWith("SELECT ")));
        assert.deepEqual(graphConf(), before);
        record("宿主原生图配置保护", "所有生产读取仅 SELECT；局部/全局 dailyNote、type、d3、minRefs 配置前后相同");
    } finally {
        hooks?.deregister();
        delete globalThis.__lvctNativeRefsRequest;
        await api("/api/system/exit", { force: true }).catch(() => {});
    }
}

main().then(() => { fs.writeFileSync(OUTPUT, JSON.stringify({ checkedAt: new Date().toISOString(), results }, null, 2)); process.exit(0); })
    .catch((error) => { console.error(error); results.push({ name: "隔离验证", ok: false, detail: error.message }); fs.writeFileSync(OUTPUT, JSON.stringify({ checkedAt: new Date().toISOString(), results }, null, 2)); process.exit(1); });
