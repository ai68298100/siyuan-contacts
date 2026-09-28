/** 隔离浏览器回归：真实 Svelte/Cytoscape，内存 Siyuan 适配器，不连接用户内核。
 *  LVCT_UI_HOST=1 时页面注入真实思源 base.css + 官方主题变量（宿主样式基线，C01），
 *  用于在真实宿主 CSS 下跑同一套断言；本机无思源安装（如 CI）时自动回退近似样式。 */
import { createServer } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { spawn } from "node:child_process";
import { hostBaselinePlugin } from "./host-baseline.mjs";

const root = resolve(import.meta.dirname, "../..");
const browserPath = [
    process.env.LVCT_TEST_BROWSER,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
].find((candidate) => candidate && existsSync(candidate));
if (!browserPath) throw new Error("未找到测试浏览器，请用 LVCT_TEST_BROWSER 指定 Chromium 可执行文件");

let resolveReport;
const report = new Promise((resolve) => { resolveReport = resolve; });
const server = await createServer({
    configFile: false, root, publicDir: false,
    resolve: { alias: { siyuan: resolve(root, "scripts/e2e/ui/siyuan-mock.js") } },
    plugins: [svelte(), hostBaselinePlugin(), {
        name: "isolated-ui-report",
        configureServer(server) {
            server.middlewares.use("/__ui_report", (request, response) => {
                let body = "";
                request.on("data", (chunk) => { body += chunk; });
                request.on("end", () => {
                    try { resolveReport(JSON.parse(body)); response.end("ok"); }
                    catch { response.statusCode = 400; response.end("invalid report"); }
                });
            });
        },
    }],
    server: { host: "127.0.0.1", port: 0, open: false },
});
let browser;
let debuggerSocket;
let profile;
let timeout;
try {
    await server.listen();
    const address = server.httpServer.address();
    profile = mkdtempSync(join(tmpdir(), "lvct-ui-"));
    console.log(`隔离浏览器临时目录：${profile}`);
    browser = spawn(browserPath, [
        "--headless=new", "--no-first-run", "--no-default-browser-check", "--disable-gpu",
        // Linux runner（无 user-namespace）上 Chromium 必须关闭沙箱才能启动
        "--no-sandbox", "--disable-dev-shm-usage",
        "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank",
    ], { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
    let chromeStartupError = "";
    browser.stderr?.on("data", (chunk) => { chromeStartupError += chunk.toString(); });
    let debugPort;
    for (let attempt = 0; attempt < 100; attempt++) {
        const portFile = join(profile, "DevToolsActivePort");
        if (existsSync(portFile)) { debugPort = Number(readFileSync(portFile, "utf8").split(/\r?\n/)[0]); break; }
        await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    }
    if (!debugPort) throw new Error("浏览器调试端口未启动" + (chromeStartupError ? `：${chromeStartupError.slice(0, 300)}` : ""));
    const targets = await fetch(`http://127.0.0.1:${debugPort}/json/list`).then((response) => response.json());
    const page = targets.find((target) => target.type === "page");
    if (!page) throw new Error("未找到隔离测试页面");
    debuggerSocket = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolveOpen, rejectOpen) => {
        debuggerSocket.addEventListener("open", resolveOpen, { once: true });
        debuggerSocket.addEventListener("error", rejectOpen, { once: true });
    });
    let nextId = 0;
    const pending = new Map();
    const browserConsole = [];
    debuggerSocket.addEventListener("message", ({ data }) => {
        const reply = JSON.parse(data);
        if (reply.method === "Runtime.exceptionThrown") {
            browserConsole.push("EXCEPTION " + JSON.stringify(reply.params.exceptionDetails).slice(0, 300));
            return;
        }
        if (reply.method === "Runtime.consoleAPICalled") {
            browserConsole.push(reply.params.args.map((arg) => arg.value ?? arg.description ?? "").join(" "));
            return;
        }
        const complete = pending.get(reply.id);
        if (complete) { pending.delete(reply.id); complete(reply); }
    });
    const call = (method, params = {}) => new Promise((resolveCall, rejectCall) => {
        const id = ++nextId;
        pending.set(id, (reply) => reply.error ? rejectCall(new Error(reply.error.message)) : resolveCall(reply.result));
        debuggerSocket.send(JSON.stringify({ id, method, params }));
    });
    const mobile = process.env.LVCT_UI_MOBILE === "1";
    await call("Runtime.enable");
    await call("Emulation.setDeviceMetricsOverride", { width: mobile ? 390 : 1280, height: mobile ? 844 : 900, deviceScaleFactor: 1, mobile });
    const hostBaseline = process.env.LVCT_UI_HOST === "1" ? "?host=1" : "";
    await call("Page.navigate", { url: `http://127.0.0.1:${address.port}/scripts/e2e/ui/index.html${hostBaseline}` });
await new Promise((r) => setTimeout(r, 300));
    const results = await Promise.race([
        report,
        new Promise((_, reject) => {
            timeout = setTimeout(async () => {
                try {
                    const state = await call("Runtime.evaluate", { expression: "(async () => { const q = navigator.locks ? await navigator.locks.query() : {held:[],pending:[]}; return JSON.stringify({stage: window.__stage||'none', held: q.held.map(function(l){return l.name}), pending: q.pending.map(function(l){return l.name})}); })()", awaitPromise: true, returnByValue: true });
                    console.log("--- 回归超时，页面进度：", state.result.value);
                    console.log("--- 浏览器 console 尾部 ---");
                    console.log(browserConsole.slice(-40).join(String.fromCharCode(10)));
                } catch { console.log("--- 回归超时（页面状态不可读）"); }
                reject(new Error("浏览器回归 240 秒超时"));
            }, 240000);
        }),
        new Promise((_, reject) => browser.once("error", reject)),
    ]);
    for (const result of results) console.log(`${result.ok ? "PASS" : "FAIL"} ${result.name}${result.detail ? `\n${result.detail}` : ""}`);
    console.log(`UI 回归：${results.filter((result) => result.ok).length}/${results.length}`);
    if (results.some((result) => !result.ok)) {
        console.log("--- 浏览器 console（最后 40 条）---");
        console.log(browserConsole.slice(-40).join(String.fromCharCode(10)));
        process.exitCode = 1;
    }
} finally {
    clearTimeout(timeout);
    debuggerSocket?.close();
    browser?.kill();
    if (process.platform === "win32" && browser?.pid) {
        /* kill() 只结束主进程，Chrome 子进程残留句柄会让 rmSync 失败，须整树杀 */
        spawn("taskkill", ["/pid", String(browser.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
        await new Promise((r) => setTimeout(r, 300));
    }
    if (profile) {
        rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
    await server.close();
}
