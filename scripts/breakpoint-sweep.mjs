/** UX-01.10 断点扫描：主页面 × 390/575/640/1280 档截图 + Peek 场景（V-05 布局矩阵第一批：
 *  575px 补中间档——全屏 Peek/布局在手机与小屏平板之间曾无基线覆盖）。 */
import { createServer } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { spawn } from "node:child_process";
import { hostBaselinePlugin } from "./e2e/host-baseline.mjs";

const root = resolve(import.meta.dirname, "..");
const browserPath = [
    process.env.LVCT_TEST_BROWSER,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
].find((c) => c && existsSync(c));
if (!browserPath) throw new Error("未找到浏览器");

const outDir = resolve(root, "scripts/e2e/shots/breakpoints");
mkdirSync(outDir, { recursive: true });

const server = await createServer({
    configFile: false, root, publicDir: false,
    /* 夹具须显式挂 svelte 插件与 siyuan mock 别名（同 ui-smoke）：configFile:false 不加载根
       vite.config，缺插件时 .svelte 被当裸 JS 解析、缺别名时 siyuan 包无法解析——
       页面只剩 vite 报错浮层（2026-09-29 根修并补 title 校验） */
    resolve: { alias: { siyuan: resolve(root, "scripts/e2e/ui/siyuan-mock.js") } },
    /* V-05：sweep 页面带 host=1，但 vite 未挂 hostBaselinePlugin——/__host/*.css 404、
       近似宿主样式又被夹具移除 → b3 桥接令牌全空（浮层透明、页面交叠）。同 ui-smoke 补挂。 */
    plugins: [svelte(), hostBaselinePlugin()],
    server: { host: "127.0.0.1", port: 0, open: false },
});
await server.listen();
const port = server.httpServer.address().port;
const pages = ["home", "people", "peek", "graph", "orgs", "settings"];
const widths = [390, 575, 640, 1280];

const profile = mkdtempSync(join(tmpdir(), "bp-sweep-"));
const browser = spawn(browserPath, [
    "--headless=new", "--no-first-run", "--disable-gpu", "--hide-scrollbars",
    "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank",
], { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });

let socket;
try {
    let debugPort;
    for (let i = 0; i < 100; i++) {
        const portFile = join(profile, "DevToolsActivePort");
        if (existsSync(portFile)) { debugPort = Number(readFileSync(portFile, "utf8").split(/\r?\n/)[0]); break; }
        await new Promise((r) => setTimeout(r, 100));
    }
    const targets = await fetch(`http://127.0.0.1:${debugPort}/json/list`).then((r) => r.json());
    const page = targets.find((t) => t.type === "page");
    socket = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolveOpen, rejectOpen) => {
        socket.addEventListener("open", resolveOpen, { once: true });
        socket.addEventListener("error", rejectOpen, { once: true });
    });
    let nextId = 0;
    const pending = new Map();
    socket.addEventListener("message", ({ data }) => {
        const reply = JSON.parse(data);
        const finish = pending.get(reply.id);
        if (finish) { pending.delete(reply.id); finish(reply); }
    });
    const call = (method, params = {}) => new Promise((resolveCall, rejectCall) => {
        const id = ++nextId;
        pending.set(id, (reply) => reply.error ? rejectCall(new Error(reply.error.message)) : resolveCall(reply.result));
        socket.send(JSON.stringify({ id, method, params }));
    });

    await call("Page.enable");
    /* 页面就绪以 title 为准（shot-workbench.html 置 READY/ERROR…），带病页面直接判失败 */
    async function waitReady(label) {
        for (let i = 0; i < 80; i++) {
            const evaluated = await call("Runtime.evaluate", { expression: "document.title" });
            const title = evaluated?.result?.value ?? "";
            if (title === "READY" || title.startsWith("ERROR")) {
                if (title !== "READY") throw new Error(`${label} 页面异常：${title}`);
                return;
            }
            await new Promise((r) => setTimeout(r, 100));
        }
        throw new Error(`${label} 页面未就绪（title 超时）`);
    }
    for (const width of widths) {
        for (const view of pages) {
            await call("Emulation.setDeviceMetricsOverride", {
                width, height: width === 390 ? 844 : 900, deviceScaleFactor: 1, mobile: width <= 640,
            });
            await call("Page.navigate", {
                url: `http://127.0.0.1:${port}/scripts/e2e/shot-workbench.html?view=${view}&theme=light&host=1`,
            });
            await waitReady(`${view}@${width}`);
            /* V-05：Peek 有滑入动画（lvct-peek-in），400ms 曾截到半透明中间帧（页面透出交叠） */
            await new Promise((r) => setTimeout(r, view === "peek" ? 1200 : 400));
            const shot = await call("Page.captureScreenshot", { format: "png" });
            writeFileSync(join(outDir, `${view}-${width}.png`), Buffer.from(shot.data, "base64"));
            console.log(`${view} @ ${width}`);
        }
    }
    console.log("sweep done →", outDir);
} finally {
    socket?.close();
    browser.kill();
    if (process.platform === "win32") {
        /* kill() 只结束主进程，Chrome 子进程残留句柄会让 rmSync 失败，须整树杀 */
        spawn("taskkill", ["/pid", String(browser.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
        await new Promise((r) => setTimeout(r, 300));
    }
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    await server.close();
}
