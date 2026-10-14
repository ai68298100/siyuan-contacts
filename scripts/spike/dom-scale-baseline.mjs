/*
 * 真实浏览器规模采样：挂载生产 PeopleView，模拟内核分页返回 200/1000/5000 行。
 * 这不是产品回归测试，结果用于判断虚拟滚动/懒加载是否有实测收益。
 * 用法：node scripts/spike/dom-scale-baseline.mjs
 * 可选：LVCT_DOM_VIEWPORT_WIDTH/HEIGHT 指定视口；LVCT_DOM_EXTREME_CONTENT=1 使用长文本夹具。
 */
import { createServer } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { readBrowserDebuggingPort, removeIsolatedBrowserProfile, stopIsolatedBrowser } from "../e2e/browser-cleanup.mjs";

const root = resolve(import.meta.dirname, "../..");
const browserPath = [
    process.env.LVCT_TEST_BROWSER,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
].find((candidate) => candidate && existsSync(candidate));
if (!browserPath) throw new Error("未找到测试浏览器，请用 LVCT_TEST_BROWSER 指定 Chromium 可执行文件");

const sizes = [200, 1000, 5000];
const repetitions = Number(process.env.LVCT_DOM_REPETITIONS ?? 3);
const disableVirtual = process.env.LVCT_DOM_NO_VIRTUAL === "1";
const viewportWidth = Number(process.env.LVCT_DOM_VIEWPORT_WIDTH ?? 1280);
const viewportHeight = Number(process.env.LVCT_DOM_VIEWPORT_HEIGHT ?? 900);
const extremeContent = process.env.LVCT_DOM_EXTREME_CONTENT === "1";
for (const [name, value] of [["LVCT_DOM_VIEWPORT_WIDTH", viewportWidth], ["LVCT_DOM_VIEWPORT_HEIGHT", viewportHeight]]) {
    if (!Number.isSafeInteger(value) || value < 320 || value > 4096) {
        throw new Error(`${name} 必须是 320 到 4096 之间的整数`);
    }
}
const profile = mkdtempSync(join(tmpdir(), "lvct-dom-scale-"));
const results = [];
const server = await createServer({
    configFile: false,
    root,
    publicDir: false,
    cacheDir: join(profile, "vite-cache"),
    resolve: { alias: { siyuan: resolve(root, "scripts/e2e/ui/siyuan-mock.js") } },
    plugins: [disableVirtual ? {
        name: "lvct-dom-scale-disable-virtual",
        enforce: "pre",
        transform(code, id) {
            if (!id.endsWith("/src/components/people/PeopleView.svelte")) return undefined;
            return code.replace("const VIRTUAL_LIST_THRESHOLD = 600;", "const VIRTUAL_LIST_THRESHOLD = Number.MAX_SAFE_INTEGER;");
        },
    } : undefined, svelte(), {
        name: "lvct-dom-scale-page",
        configureServer(viteServer) {
            viteServer.middlewares.use("/dom-scale.html", (_request, response) => {
                response.setHeader("Content-Type", "text/html; charset=utf-8");
                response.end(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>DOM scale</title></head><body><main id="fixture" class="lvct-tab-root" style="height:760px;max-height:760px;overflow:hidden"></main><script type="module" src="/scripts/spike/dom-scale-entry.js"></script></body></html>`);
            });
        },
    }],
    server: { host: "127.0.0.1", port: 0, strictPort: false, open: false, hmr: false },
});

let browser;
let socket;
let requestClose;
try {
    await server.listen();
    const address = server.httpServer.address();
    browser = spawn(browserPath, [
        "--headless=new", "--no-first-run", "--no-default-browser-check", "--disable-gpu", "--disable-extensions",
        "--no-sandbox", "--disable-dev-shm-usage", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank",
    ], { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
    let debugPort;
    for (let attempt = 0; attempt < 100 && !debugPort; attempt++) {
        debugPort = readBrowserDebuggingPort(profile);
        if (!debugPort) await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    }
    if (!debugPort) throw new Error("浏览器调试端口未启动");
    const targets = await fetch(`http://127.0.0.1:${debugPort}/json/list`).then((response) => response.json());
    const page = targets.find((target) => target.type === "page");
    if (!page) throw new Error("未找到性能采样页面");
    socket = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolveOpen, rejectOpen) => {
        socket.addEventListener("open", resolveOpen, { once: true });
        socket.addEventListener("error", rejectOpen, { once: true });
    });
    let nextId = 0;
    const pending = new Map();
    socket.addEventListener("message", ({ data }) => {
        const message = JSON.parse(data);
        const resolveMessage = pending.get(message.id);
        if (resolveMessage) { pending.delete(message.id); resolveMessage(message); }
    });
    const call = (method, params = {}) => new Promise((resolveCall, rejectCall) => {
        const id = ++nextId;
        pending.set(id, (reply) => reply.error ? rejectCall(new Error(reply.error.message)) : resolveCall(reply.result));
        socket.send(JSON.stringify({ id, method, params }));
    });
    requestClose = () => call("Browser.close");
    await call("Runtime.enable");
    await call("HeapProfiler.enable");
    await call("Emulation.setDeviceMetricsOverride", {
        width: viewportWidth,
        height: viewportHeight,
        deviceScaleFactor: 1,
        mobile: viewportWidth <= 640,
    });
    for (const size of sizes) {
        const samples = [];
        for (let repetition = 0; repetition < repetitions; repetition += 1) {
            await call("HeapProfiler.collectGarbage");
            await call("Page.navigate", { url: `http://127.0.0.1:${address.port}/dom-scale.html?size=${size}&run=${repetition}&virtual=${disableVirtual ? 0 : 1}&extreme=${extremeContent ? 1 : 0}` });
            const deadline = Date.now() + 180000;
            let evidence;
            while (Date.now() < deadline) {
                const result = await call("Runtime.evaluate", { expression: "window.__domScaleError ? JSON.stringify({ error: window.__domScaleError }) : window.__domScaleReady ? JSON.stringify(window.__domScaleEvidence) : null", returnByValue: true });
                if (result.result?.value) {
                    evidence = JSON.parse(result.result.value);
                    if (evidence.error) throw new Error(`规模 ${size} 第 ${repetition + 1} 次采样断言失败：${evidence.error}`);
                    break;
                }
                await new Promise((resolveWait) => setTimeout(resolveWait, 25));
            }
            if (!evidence) throw new Error(`规模 ${size} 第 ${repetition + 1} 次采样超时`);
            samples.push({ repetition: repetition + 1, ...evidence });
        }
        const median = (key) => {
            const values = samples.map((sample) => sample[key]).filter((value) => typeof value === "number").sort((a, b) => a - b);
            return values[Math.floor(values.length / 2)] ?? null;
        };
        const medianWindow = (key, index, field) => {
            const values = samples.map((sample) => sample[key]?.[index]?.[field]).filter((value) => typeof value === "number").sort((a, b) => a - b);
            return values[Math.floor(values.length / 2)] ?? null;
        };
        const summary = {
            fixtureSize: size,
            repetitions,
            firstPageMsMedian: median("firstPageMs"),
            loadedMsMedian: median("loadedMs"),
            firstPageCardDomCount: median("firstPageCardDomCount"),
            firstPageDomNodes: median("firstPageDomNodes"),
            firstPageHeapBytesMedian: median("firstPageHeapBytes"),
            expandedCardDomCount: median("expandedCardDomCount"),
            expandedDomNodes: median("expandedDomNodes"),
            bottomCardDomCount: median("bottomCardDomCount"),
            bottomDomNodes: median("bottomDomNodes"),
            tableRowCount: median("tableRowCount"),
            cardTopWindowCount: medianWindow("cardWindowSamples", 0, "cardCount"),
            cardMiddleWindowCount: medianWindow("cardWindowSamples", 1, "cardCount"),
            cardBottomWindowCount: medianWindow("cardWindowSamples", 2, "cardCount"),
            tableTopWindowRows: medianWindow("tableWindowSamples", 0, "rowCount"),
            tableMiddleWindowRows: medianWindow("tableWindowSamples", 1, "rowCount"),
            tableBottomWindowRows: medianWindow("tableWindowSamples", 2, "rowCount"),
            fullHeapBytesMedian: median("fullHeapBytes"),
            fullRenderMsMedian: median("fullRenderMs"),
            tableSwitchMsMedian: median("tableSwitchMs"),
            cardsSwitchMsMedian: median("cardsSwitchMs"),
            initialLayoutShiftScoreMedian: median("initialLayoutShiftScore"),
            syntheticInteractionLayoutShiftScoreMedian: median("syntheticInteractionLayoutShiftScore"),
            totalRecordedLayoutShiftScoreMedian: median("totalRecordedLayoutShiftScore"),
            samples,
        };
        results.push(summary);
        console.log(`${size} 条（${repetitions} 次中位数）：首屏 ${summary.firstPageMsMedian.toFixed(1)}ms，读取完成 ${summary.loadedMsMedian.toFixed(1)}ms，展开耗时 ${summary.fullRenderMsMedian.toFixed(1)}ms；卡片窗口 顶/中/底 ${summary.cardTopWindowCount}/${summary.cardMiddleWindowCount}/${summary.cardBottomWindowCount}，表格窗口 ${summary.tableTopWindowRows}/${summary.tableMiddleWindowRows}/${summary.tableBottomWindowRows} 行；DOM节点 ${summary.firstPageDomNodes}→${summary.expandedDomNodes}，视图切换 ${summary.tableSwitchMsMedian.toFixed(1)}ms/${summary.cardsSwitchMsMedian.toFixed(1)}ms，布局偏移 首屏 CLS/合成交互 ${summary.initialLayoutShiftScoreMedian.toFixed(4)}/${summary.syntheticInteractionLayoutShiftScoreMedian.toFixed(4)}`);
    }
} finally {
    socket?.close();
    try { await stopIsolatedBrowser(browser, { requestClose }); } catch (error) { console.error("浏览器停止失败：", error.message); }
    try { await server.close(); } finally { if (profile) await removeIsolatedBrowserProfile(profile).catch(() => rmSync(profile, { recursive: true, force: true })); }
}

const output = resolve(root, process.env.LVCT_DOM_OUTPUT ?? "scripts/spike/dom-scale-results.json");
writeFileSync(output, JSON.stringify({
    at: new Date().toISOString(),
    node: process.version,
    browser: browserPath,
    repetitions,
    virtualization: disableVirtual ? "disabled" : "enabled",
    viewport: { width: viewportWidth, height: viewportHeight },
    contentMode: extremeContent ? "extreme" : "default",
    samples: results,
}, null, 2) + "\n", "utf8");
console.log(`真实性能证据：${output}`);
