/* M1 加载验证：把 dist/ 装进隔离内核工作区，启用插件并确认内核下发。
   模式移植自 siyuan-checkin E2E（D-222）：拷贝 dist 不会触发加载，
   必须 setBazaar trust + setPetalEnabled + loadPetals 三步。 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import {spawn} from "node:child_process";
import { prepareIsolatedWorkspace, assertIsolatedPath, assertTestPortAvailable, observeTestKernel } from "./kernel-safety.mjs";
import { guardScratch, kernelTokenFromConfig, makeApi, sweepOrphans } from "../lib/smoke-kernel.mjs";

const PLUGIN_NAME = "siyuan-contacts";
const MARKER = "renmai-e2e.json";
const HOST = "127.0.0.1";
const PORT = 6829;
const BASE = `http://${HOST}:${PORT}`;

function readArg(name) {
    const index = process.argv.indexOf(name);
    return index >= 0 ? process.argv[index + 1] : undefined;
}

const cliBase = readArg("--base-url");
const cliToken = readArg("--token");
const cliWorkspace = readArg("--workspace");
const workspace = cliWorkspace || process.env.LVCT_E2E_WORKSPACE || path.join(os.tmpdir(), `SiYuan-Lvct-Load-${randomUUID()}`);

function assertLoopback() {
    const host = new URL(BASE).hostname;
    if (!["127.0.0.1", "localhost", "::1"].includes(host)) throw new Error(`只允许回环地址: ${host}`);
}

function resolveKernel() {
    const candidates = [
        "D:\\biji\\SiYuan\\resources\\kernel\\SiYuan-Kernel.exe",
        "D:\\RJ\\SiYuan\\resources\\kernel\\SiYuan-Kernel.exe",
        path.join(process.env.ProgramFiles || "C:\\Program Files", "SiYuan", "resources", "kernel", "SiYuan-Kernel.exe"),
    ];
    const kernel = candidates.find((c) => fs.existsSync(c));
    if (!kernel) throw new Error("未找到 SiYuan-Kernel.exe");
    const appDir = path.resolve(path.dirname(kernel), "..");
    return {kernel, appDir};
}

function prepareWorkspace() {
    prepareIsolatedWorkspace(workspace, MARKER, "renmai e2e");
}

function installPlugin() {
    const dist = path.join(process.cwd(), "dist");
    for (const required of ["index.js", "index.css", "plugin.json", "i18n/zh-CN.json"]) {
        if (!fs.existsSync(path.join(dist, required))) throw new Error(`dist/${required} 不存在，先 pnpm build`);
    }
    const manifest = JSON.parse(fs.readFileSync(path.join(dist, "plugin.json"), "utf8"));
    if (manifest.name !== PLUGIN_NAME) throw new Error(`plugin.json.name=${manifest.name} 与目录名不一致`);
    const target = path.join(workspace, "data", "plugins", PLUGIN_NAME);
    assertIsolatedPath(workspace, target);
    fs.rmSync(target, {recursive: true, force: true});
    fs.cpSync(dist, target, {recursive: true, force: true});
    return target;
}

function startKernel({kernel, appDir}) {
    const child = spawn(kernel, ["--workspace", workspace, "serve", "--wd", appDir, "--port", String(PORT)], {
        stdio: ["ignore", "pipe", "pipe"],
        env: {...process.env, SIYUAN_WORKSPACE_PATH: workspace},
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
    return text ? JSON.parse(text) : {};
}
async function apiChecked(route, body = {}) {
    const payload = await api(route, body);
    if (payload.code !== 0) throw new Error(`${route} code=${payload.code} msg=${payload.msg}`);
    return payload.data;
}

async function waitForBoot(lines, assertRunning) {
    const until = Date.now() + 60000;
    while (Date.now() < until) {
        assertRunning();
        if (lines.some((line) => line.includes("lock workspace"))) {
            throw new Error(`工作区被锁定：${workspace} 有残留内核`);
        }
        const progress = await api("/api/system/bootProgress").catch(() => undefined);
        if (progress?.code === 0 && Number(progress?.data?.progress) >= 100) return;
        await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error(`内核启动超时:\n${lines.slice(-20).join("\n")}`);
}

async function main() {
    // Loading a local dist package changes petal state, so this script always
    // owns the kernel it starts. Reject external target variables instead of
    // silently writing to a user's running workspace.
    if (cliBase || cliToken || process.env.SIYUAN_BASE_URL || process.env.SIYUAN_TOKEN) {
        throw new Error("load-check 是写型本地加载验证，不能连接外部思源；请去掉 --base-url/--token 与 SIYUAN_BASE_URL/SIYUAN_TOKEN，并让脚本创建隔离靶场。需检查已有内核时使用只读走查脚本。");
    }
    assertLoopback();
    await assertTestPortAvailable(HOST, PORT);
    prepareWorkspace();
    const installPath = installPlugin();
    const {kernel, appDir} = resolveKernel();
    const {child, lines} = startKernel({kernel, appDir});
    const assertRunning = observeTestKernel(child);
    assertKernelRunning = assertRunning;
    let booted = false;
    let exitCode = 0;
    try {
        await waitForBoot(lines, assertRunning);
        assertRunning();
        booted = true;
        token = kernelTokenFromConfig(JSON.parse(fs.readFileSync(path.join(workspace, "conf", "conf.json"), "utf8")));
        if (!token) throw new Error("隔离内核没有生成 accessAuthCode，拒绝无 token 写入检查");
        const guardedApi = makeApi(BASE, token);
        await sweepOrphans(guardedApi);
        await guardScratch(guardedApi, { base: BASE });
        console.log(`PASS 内核启动（工作区 ${workspace}）`);

        const trust = await api("/api/setting/setBazaar", {trust: true});
        if (trust.code !== 0) throw new Error(`setBazaar 失败: ${trust.msg}`);
        const enabled = await api("/api/petal/setPetalEnabled", {packageName: PLUGIN_NAME, enabled: true});
        if (enabled.code !== 0) throw new Error(`setPetalEnabled 失败: ${enabled.msg}`);
        const petals = await apiChecked("/api/petal/loadPetals", {frontend: "desktop"});
        const loaded = (petals || []).find((item) => item.name === PLUGIN_NAME);
        if (!loaded) throw new Error(`内核未下发插件，loadPetals: ${(petals || []).map((i) => i.name).join(", ") || "空"}`);
        if (!(loaded.js || "").length) throw new Error("插件 index.js 为空");
        console.log(`PASS 插件已加载 v${loaded.version} js=${(loaded.js || "").length}B css=${(loaded.css || "").length}B`);

        // 存储目录应随启用创建（petal 目录由宿主管理）
        if (!fs.existsSync(path.join(workspace, "data", "storage", "petal", PLUGIN_NAME))) {
            console.log("WARN 插件存储目录未创建（首次 loadData 后才会出现）");
        }
        // 宿主文档应能通过前端正常打开：用 SQL 验证笔记本存在性留到功能 E2E
        void installPath;
        console.log("\n== M1 加载验证通过 ==");
    } catch (error) {
        exitCode = 1;
        console.error("E2E FAIL:", error.message);
        console.error(lines.slice(-25).join("\n"));
    } finally {
        if (booted && child.exitCode === null && child.signalCode === null) {
            await api("/api/system/exit", {force: true}).catch(() => undefined);
        }
        const exited = await Promise.race([
            new Promise((resolve) => child.exitCode !== null || child.signalCode !== null ? resolve(true) : child.once("exit", () => resolve(true))),
            new Promise((resolve) => setTimeout(() => resolve(false), 8000)),
        ]);
        if (!exited) child.kill("SIGKILL");
    }
    process.exit(exitCode);
}

main().catch((error) => {
    console.error("E2E ERROR:", error.message);
    process.exit(2);
});
