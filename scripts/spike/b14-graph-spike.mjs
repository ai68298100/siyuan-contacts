/* B14.1 spike：在隔离内核上系统探测"思源原生关系图"的能力边界。
   目的：为 B14 双图实现路线提供「已实证 / 不支持 / 未知」证据表。
   探测面：
   A. 内核 graph 端点存在性与参数（getGraph/getLocalGraph/getBlockGraph 等）
   B. refs 表作为图数据源——节点=文档，边=块引用（先建 B/C 再建 A 插入真实块引用）
   C. 内核侧"打开原生图面板"入口（预期为前端域，记证据）
   D. 反向边（回链）自动维护验证
   产出 scripts/spike/b14-graph-results.json。模式移植自 b13-org-spike.mjs。 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {spawn} from "node:child_process";
import { prepareIsolatedWorkspace, assertTestPortAvailable, observeTestKernel } from "../e2e/kernel-safety.mjs";

const WORKSPACE = path.join(os.homedir(), "SiYuan-Renmai-B14-Spike");
const HOST = "127.0.0.1";
const PORT = 6834;
const BASE = `http://${HOST}:${PORT}`;
const MARKER = "renmai-b14-spike.json";

const results = [];
/** ok 为 null 表示信息性探测（证据本身即产出，不判 PASS/FAIL） */
const record = (name, ok, detail) => {
    results.push({name, ok, detail});
    console.log(`${ok === null ? "INFO" : ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

function resolveKernel() {
    const candidates = [
        "D:\\biji\\SiYuan\\resources\\kernel\\SiYuan-Kernel.exe",
        "D:\\RJ\\SiYuan\\resources\\kernel\\SiYuan-Kernel.exe",
        path.join(process.env.ProgramFiles || "C:\\Program Files", "SiYuan", "resources", "kernel", "SiYuan-Kernel.exe"),
    ];
    const kernel = candidates.find((c) => fs.existsSync(c));
    if (!kernel) throw new Error("未找到 SiYuan-Kernel.exe");
    const appDir = path.resolve(path.dirname(kernel), "..");
    for (const required of ["stage", "appearance"]) {
        if (!fs.existsSync(path.join(appDir, required))) throw new Error(`app 目录缺少 ${required}: ${appDir}`);
    }
    return {kernel, appDir};
}

function prepareWorkspace() {
    prepareIsolatedWorkspace(WORKSPACE, MARKER, "renmai b14-graph-spike");
}

function startKernel({kernel, appDir}) {
    const child = spawn(kernel, ["--workspace", WORKSPACE, "serve", "--wd", appDir, "--port", String(PORT)], {
        stdio: ["ignore", "pipe", "pipe"],
        env: {...process.env, SIYUAN_WORKSPACE_PATH: WORKSPACE},
    });
    const lines = [];
    for (const stream of [child.stdout, child.stderr]) {
        stream.on("data", (chunk) => {
            String(chunk).split(/\r?\n/).forEach((line) => {
                if (line) {
                    lines.push(line);
                    if (lines.length > 2000) lines.shift();
                }
            });
        });
    }
    return {child, lines};
}

let token = "";
let assertKernelRunning;
async function api(route, body = {}) {
    assertKernelRunning?.();
    const headers = {"Content-Type": "application/json"};
    if (token) headers.Authorization = `Token ${token}`;
    const response = await fetch(`${BASE}${route}`, {method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(5000)});
    const text = await response.text();
    assertKernelRunning?.();
    let parsed;
    try { parsed = text ? JSON.parse(text) : {}; } catch { parsed = {}; }
    return {status: response.status, text, parsed};
}
async function apiChecked(route, body = {}) {
    const payload = await api(route, body);
    if (payload.parsed?.code !== 0) throw new Error(`${route} code=${payload.parsed?.code} msg=${payload.parsed?.msg}`);
    return payload.parsed.data ?? payload.parsed;
}
const flush = async () => { await api("/api/sqlite/flushTransaction"); };

async function waitForBoot(lines, assertRunning) {
    const until = Date.now() + 60000;
    while (Date.now() < until) {
        assertRunning();
        if (lines.some((line) => line.includes("lock workspace"))) {
            throw new Error(`工作区被锁定：${WORKSPACE} 有残留内核。请先结束该进程。`);
        }
        const progress = await api("/api/system/bootProgress").catch(() => undefined);
        if (progress?.parsed?.code === 0 && Number(progress?.parsed?.data?.progress) >= 100) {
            return apiChecked("/api/system/version");
        }
        await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error(`内核启动超时。日志尾部:\n${lines.slice(-25).join("\n")}`);
}

/** 端点探测：返回 status/code/msg/dataKeys 摘要（404/参数错误/正常响应均为证据） */
async function probeEndpoint(route, body = {}) {
    const payload = await api(route, body);
    const code = payload.parsed?.code;
    const msg = payload.parsed?.msg ?? "";
    const dataKeys = payload.parsed?.data ? Object.keys(payload.parsed.data).slice(0, 8).join(",") : "";
    return `status=${payload.status} code=${code} msg=${String(msg).slice(0, 80)} dataKeys=[${dataKeys}]`;
}

async function main() {
    const host = new URL(BASE).hostname;
    if (!["127.0.0.1", "localhost", "::1"].includes(host)) throw new Error(`只允许回环地址，当前 ${host}`);
    await assertTestPortAvailable(HOST, PORT);
    prepareWorkspace();
    const {kernel, appDir} = resolveKernel();
    const {child, lines} = startKernel({kernel, appDir});
    const assertRunning = observeTestKernel(child);
    assertKernelRunning = assertRunning;
    try {
        const version = await waitForBoot(lines, assertRunning);
        assertRunning();
        record("内核启动", true, `v${version}`);
        token = (JSON.parse(fs.readFileSync(path.join(WORKSPACE, "conf", "conf.json"), "utf8")).accessAuthCode) || "";

        /* 造数据：先建 B/C，再建 A 并插入真实块引用（目标存在才能被索引） */
        const notebook = await apiChecked("/api/notebook/createNotebook", {name: "B14_spike"});
        const notebookID = notebook.notebook.id;
        await flush();
        const docB = await apiChecked("/api/filetree/createDocWithMd", {notebook: notebookID, path: "/文档B", markdown: "# 文档B\n\n"});
        const docC = await apiChecked("/api/filetree/createDocWithMd", {notebook: notebookID, path: "/文档C", markdown: "# 文档C\n\n"});
        const docA = await apiChecked("/api/filetree/createDocWithMd", {notebook: notebookID, path: "/文档A", markdown: "# 文档A\n\n"});
        const docD = await apiChecked("/api/filetree/createDocWithMd", {notebook: notebookID, path: "/文档D", markdown: "# 文档D\n\n"});
        const refMarkdown = "((" + docB + " '文档B'))\n((" + docC + " '文档C'))";
        await apiChecked("/api/block/insertBlock", {dataType: "markdown", parentID: docA, data: refMarkdown});
        await apiChecked("/api/block/insertBlock", {dataType: "markdown", parentID: docD, data: "((" + docA + " '文档A'))"});
        await flush();

        /* A：候选内核 graph 端点探测（信息性——存在/参数要求都是证据） */
        const graphConf = {type: {}}
        const probes = [
            ["/api/graph/getGraph", {conf: graphConf, graph: "global"}],
            ["/api/graph/getGraph", {}],
            ["/api/graph/getLocalGraph", {id: docA, conf: graphConf}],
            ["/api/graph/getLocalGraph", {id: docA}],
            ["/api/graph/getBlockGraph", {id: docA, conf: graphConf}],
        ];
        for (const [route, body] of probes) {
            const summary = await probeEndpoint(route, body);
            record(`A ${route}`, null, summary);
        }

        /* B：refs 表作为图数据源（节点=文档，边=块引用） */
        await flush();
        const refs = await apiChecked("/api/query/sql", {stmt: "SELECT id, def_block_id, def_block_root_id FROM refs WHERE root_id = '" + docA + "'"});
        const edges = refs.map((row) => row.def_block_root_id);
        const refsOK = refs.length >= 2 && edges.includes(docB) && edges.includes(docC);
        record("B refs 表作为图数据源（节点=文档，边=refs）", refsOK, `edges=${JSON.stringify(edges)}`);

        /* C：内核侧"打开原生图面板"入口——预期为前端域（记证据） */
        record("C 打开原生图面板", null, "内核 API 无此端点（通道A 探测仅 graph 查询类）；原生图为前端渲染，插件侧需经前端 API/协议（留真机核对）");

        /* D：反向边（B→A 的回链）自动维护验证 */
        const backRefs = await apiChecked("/api/query/sql", {stmt: "SELECT root_id FROM refs WHERE def_block_root_id = '" + docB + "'"});
        record("D 反向边（回链）自动维护", backRefs.some((row) => row.root_id === docA),
            `docB 回链来源=${JSON.stringify(backRefs.map((row) => row.root_id))}`);

        /* E：图数据元素形状 dump（B14 域层映射硬前置——nodes/links 字段名必须实证，不得臆造）
           同时验证 getLocalGraph 一度口径：docD→A 为入链，看局部图是否把回链画进来 */
        const local = await apiChecked("/api/graph/getLocalGraph", {id: docA, conf: graphConf});
        record("E getLocalGraph 数据形状", null,
            `nodes=${local?.nodes?.length ?? null} 首节点=${JSON.stringify(local?.nodes?.[0] ?? null).slice(0, 260)} ` +
            `首边=${JSON.stringify(local?.links?.[0] ?? null).slice(0, 180)} conf=${JSON.stringify(local?.conf ?? null).slice(0, 220)}`);
        const localIds = new Set((local?.nodes ?? []).map((node) => node.id));
        const localEdgePairs = (local?.links ?? []).map((link) => `${link.source ?? "?"}->${link.target ?? "?"}`);
        record("E 局部图一度范围（入链回链是否纳入）", null,
            `含A=${localIds.has(docA)} 含B=${localIds.has(docB)} 含C=${localIds.has(docC)} 含D=${localIds.has(docD)} edges=${JSON.stringify(localEdgePairs).slice(0, 240)}`);
        const global = await apiChecked("/api/graph/getGraph", {conf: graphConf});
        record("E getGraph 数据形状", null,
            `nodes=${global?.nodes?.length ?? null} 首节点=${JSON.stringify(global?.nodes?.[0] ?? null).slice(0, 260)} ` +
            `首边=${JSON.stringify(global?.links?.[0] ?? null).slice(0, 180)}`);
    } finally {
        await flush().catch(() => {});
        try { await api("/api/system/exit", {force: true}); } catch { /* 内核可能已退出 */ }
    }
}

main().then(() => {
    fs.writeFileSync(path.join("scripts", "spike", "b14-graph-results.json"), JSON.stringify(results, null, 2));
    console.log(`\nB14 图 spike：${results.length} 项证据已写入 results（A/C 为信息性探测）`);
    process.exit(0);
}).catch((error) => {
    console.error("spike 失败：", error);
    fs.writeFileSync(path.join("scripts", "spike", "b14-graph-results.json"), JSON.stringify(results, null, 2));
    process.exit(1);
});
