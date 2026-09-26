/* M1 加载验证：把 dist/ 装进隔离内核工作区，启用插件并确认内核下发。
   模式移植自 siyuan-checkin E2E（D-222）：拷贝 dist 不会触发加载，
   必须 setBazaar trust + setPetalEnabled + loadPetals 三步。 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {spawn} from "node:child_process";

const PLUGIN_NAME = "siyuan-contacts";
const MARKER = "renmai-e2e.json";
const HOST = "127.0.0.1";
const PORT = 6829;
const BASE = `http://${HOST}:${PORT}`;

const workspace = process.env.LVCT_E2E_WORKSPACE || path.join(os.homedir(), "SiYuan-Renmai-E2E");

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
    if (fs.existsSync(workspace)) {
        if (!fs.existsSync(path.join(workspace, MARKER))) {
            throw new Error(`拒绝使用非 E2E 工作区 ${workspace}：缺少标记文件`);
        }
        return;
    }
    fs.mkdirSync(path.join(workspace, "data"), {recursive: true});
    fs.writeFileSync(path.join(workspace, MARKER), `${JSON.stringify({createdBy: "renmai e2e", createdIso: new Date().toISOString()}, null, 2)}\n`);
}

function installPlugin() {
    const dist = path.join(process.cwd(), "dist");
    for (const required of ["index.js", "index.css", "plugin.json", "i18n/zh-CN.json"]) {
        if (!fs.existsSync(path.join(dist, required))) throw new Error(`dist/${required} 不存在，先 pnpm build`);
    }
    const manifest = JSON.parse(fs.readFileSync(path.join(dist, "plugin.json"), "utf8"));
    if (manifest.name !== PLUGIN_NAME) throw new Error(`plugin.json.name=${manifest.name} 与目录名不一致`);
    const target = path.join(workspace, "data", "plugins", PLUGIN_NAME);
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
async function api(route, body = {}) {
    const headers = {"Content-Type": "application/json"};
    if (token) headers.Authorization = `Token ${token}`;
    const response = await fetch(`${BASE}${route}`, {method: "POST", headers, body: JSON.stringify(body)});
    const text = await response.text();
    return text ? JSON.parse(text) : {};
}
async function apiChecked(route, body = {}) {
    const payload = await api(route, body);
    if (payload.code !== 0) throw new Error(`${route} code=${payload.code} msg=${payload.msg}`);
    return payload.data;
}

async function waitForBoot(lines) {
    const until = Date.now() + 60000;
    while (Date.now() < until) {
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
    assertLoopback();
    prepareWorkspace();
    const installPath = installPlugin();
    const {kernel, appDir} = resolveKernel();
    const {child, lines} = startKernel({kernel, appDir});
    let exitCode = 0;
    try {
        await waitForBoot(lines);
        token = JSON.parse(fs.readFileSync(path.join(workspace, "conf", "conf.json"), "utf8")).accessAuthCode || "";
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
        await api("/api/system/exit", {force: true}).catch(() => undefined);
        const exited = await Promise.race([
            new Promise((resolve) => child.once("exit", () => resolve(true))),
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
