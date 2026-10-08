/** 隔离工作台视觉截图；CDP 固定真实 CSS 视口，不依赖 Chromium 窗口最小宽度。
 *  LVCT_HOST_BASELINE=1 时追加"宿主样式基线"套件：页面 ?host=1 注入真实思源
 *  base.css + 官方主题变量（C01），复现 B02/B09 这类只在真实宿主 CSS 下出现的问题。 */
import { createServer } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { spawn } from "node:child_process";
import { hostBaselinePlugin } from "./host-baseline.mjs";
import { readBrowserDebuggingPort, removeIsolatedBrowserProfile, stopIsolatedBrowser } from "./browser-cleanup.mjs";

const root = resolve(import.meta.dirname, "../..");
const workbenchViews = ["home", "people", "table", "peek", "graph", "orgs", "orgdetail", "quickfill", "viewsmenu", "morefilter", "colmenu"];
const selectedView = process.env.LVCT_SHOT_VIEW?.trim();
if (selectedView && !workbenchViews.includes(selectedView)) throw new Error(`截图视图未知：${selectedView}；可用 ${workbenchViews.join(", ")}`);
const scaleValue = process.env.LVCT_SHOT_SCALE?.trim();
const scaleSize = scaleValue ? Number(scaleValue) : 0;
if (scaleValue && ![200, 1000].includes(scaleSize)) throw new Error(`LVCT_SHOT_SCALE 只支持 200 或 1000，收到：${scaleValue}`);
if (scaleSize && selectedView && !["people", "table"].includes(selectedView)) {
    throw new Error("规模截图只支持联系人 people/table 视图");
}
const scaleFixture = scaleSize ? `scale:${scaleSize}` : "";
const browserPath = [
    process.env.LVCT_TEST_BROWSER,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
].find((c) => c && existsSync(c));
if (!browserPath) throw new Error("未找到浏览器，可用 LVCT_TEST_BROWSER 指定");

const outDir = resolve(root, "scripts/e2e/shots");
mkdirSync(outDir, { recursive: true });

const server = await createServer({
    configFile: false, root, publicDir: false,
    resolve: { alias: { siyuan: resolve(root, "scripts/e2e/ui/siyuan-mock.js") } },
    plugins: [svelte(), hostBaselinePlugin()],
    server: { host: "127.0.0.1", port: 0, open: false, hmr: false },
});
await server.listen();
const port = server.httpServer.address().port;

const pause = (ms) => new Promise((resolvePause) => setTimeout(resolvePause, ms));

async function capture({ url, outFile, size, assertViewportBounds = false }) {
    const [width, height] = size.split(",").map(Number);
    const profile = mkdtempSync(join(tmpdir(), "lvct-shot-"));
    const browser = spawn(browserPath, [
        "--headless=new", "--no-first-run", "--disable-gpu", "--hide-scrollbars",
        "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank",
    ], { stdio: "ignore", windowsHide: true });
    let socket;
    let requestBrowserClose;
    try {
        let debugPort;
        for (let attempt = 0; attempt < 100; attempt++) {
            debugPort = readBrowserDebuggingPort(profile);
            if (debugPort) break;
            await pause(100);
        }
        if (!debugPort) throw new Error("浏览器调试端口未启动");
        const targets = await fetch(`http://127.0.0.1:${debugPort}/json/list`).then((response) => response.json());
        const page = targets.find((target) => target.type === "page");
        if (!page) throw new Error("未找到截图页面");
        socket = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((resolveOpen, rejectOpen) => {
            socket.addEventListener("open", resolveOpen, { once: true });
            socket.addEventListener("error", rejectOpen, { once: true });
        });
        let nextId = 0;
        const pending = new Map();
        socket.addEventListener("message", ({ data }) => {
            const reply = JSON.parse(data);
            const request = pending.get(reply.id);
            if (request) { pending.delete(reply.id); clearTimeout(request.timer); request.finish(reply); }
        });
        const call = (method, params = {}) => new Promise((resolveCall, rejectCall) => {
            const id = ++nextId;
            const timer = setTimeout(() => { pending.delete(id); rejectCall(new Error(`截图浏览器请求超时：${method}`)); }, 10000);
            pending.set(id, { timer, finish: (reply) => reply.error ? rejectCall(new Error(reply.error.message)) : resolveCall(reply.result) });
            socket.send(JSON.stringify({ id, method, params }));
        });
        requestBrowserClose = () => call("Browser.close");
        await call("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width <= 640 });
        await call("Page.navigate", { url });
        let title = "";
        for (let index = 0; index < 150; index++) {
            await pause(100);
            const evaluated = await call("Runtime.evaluate", { expression: "document.title" });
            title = evaluated.result.value ?? "";
            if (title === "READY" || title.startsWith("ERROR")) break;
        }
        if (title !== "READY") throw new Error(`页面未就绪：${title}`);
        const metrics = await call("Runtime.evaluate", { expression: `(() => {
            const selectors = [".lvct-workbench", ".lvct-workbench__main", ".lvct-workbench__body", ".lvct-people", ".lvct-people__toolbar", ".lvct-people__cards", ".lvct-people__table-wrap"];
            const containers = selectors.flatMap((selector) => [...document.querySelectorAll(selector)].map((element) => {
                const rect = element.getBoundingClientRect();
                return { selector, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height };
            }));
            return { width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth, containers };
        })()`, returnByValue: true });
        const { width: actualWidth, height: actualHeight, scrollWidth, containers = [] } = metrics.result.value ?? {};
        if (actualWidth !== width || actualHeight !== height || scrollWidth > width + 2) {
            throw new Error(`视口/溢出异常：${actualWidth}x${actualHeight}, scrollWidth=${scrollWidth}`);
        }
        if (assertViewportBounds) {
            const outOfBounds = containers.filter(({ left, right, width: boxWidth }) => boxWidth > 0 && (left < -2 || right > actualWidth + 2));
            if (outOfBounds.length) {
                throw new Error(`联系人容器超出视口：${outOfBounds.map(({ selector, left, right }) => `${selector}[${Math.round(left)},${Math.round(right)}]`).join(", ")}`);
            }
        }
        const shot = await call("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
        writeFileSync(outFile, Buffer.from(shot.data, "base64"));
        return true;
    } catch (error) {
        console.warn(url, error instanceof Error ? error.message : String(error));
        return false;
    } finally {
        try {
            await stopIsolatedBrowser(browser, { requestClose: requestBrowserClose });
            await removeIsolatedBrowserProfile(profile);
        } catch (error) {
            process.exitCode = 1;
            console.error(`截图浏览器清理失败，保留本轮目录：${profile}`, error);
        } finally {
            socket?.close();
        }
    }
}

const sections = selectedView || scaleSize ? [] : ["general", "data"];
try {
    for (const section of sections) {
        for (const theme of ["light", "dark"]) {
            const url = `http://127.0.0.1:${port}/scripts/e2e/shot-settings.html?section=${section}&theme=${theme}`;
            for (const [viewport, size] of [["desktop", "1280,1000"], ["mobile", "390,844"]]) {
                const ok = await capture({ url, size, outFile: join(outDir, `settings-${viewport}-${section}-${theme}.png`) });
                console.log(`${section} ${viewport} ${theme}: ${ok ? "OK" : "FAIL"}`);
                if (!ok) process.exitCode = 1;
            }
        }
    }
    for (const state of selectedView || scaleSize ? [] : ["reuse", "failed"]) {
        for (const [viewport, size] of [["desktop", "1280,900"], ["mobile", "390,844"]]) {
            for (const theme of ["light", "dark"]) {
                const url = `http://127.0.0.1:${port}/scripts/e2e/shot-wizard.html?state=${state}&theme=${theme}`;
                const ok = await capture({ url, size, outFile: join(outDir, `wizard-${state}-${viewport}-${theme}.png`) });
                console.log(`wizard ${state} ${viewport} ${theme}: ${ok ? "OK" : "FAIL"}`);
                if (!ok) process.exitCode = 1;
            }
        }
    }
    const captureViews = selectedView ? [selectedView] : scaleSize ? ["people", "table"] : ["home", "people", "table", "peek", "graph", "orgs", "orgdetail", "orgmgr", "quickfill"];
    for (const view of captureViews) {
        for (const [viewport, size] of [["desktop", "1280,900"], ["mobile", "390,844"]]) {
            for (const theme of ["light", "dark"]) {
                const host = selectedView && process.env.LVCT_HOST_BASELINE === "1" ? "&host=1" : "";
                const fixtureQuery = scaleFixture ? `&fixture=${encodeURIComponent(scaleFixture)}` : "";
                const url = `http://127.0.0.1:${port}/scripts/e2e/shot-workbench.html?view=${view}&theme=${theme}&mobile=${viewport === "mobile" ? "1" : "0"}${fixtureQuery}${host}`;
                const scaleSuffix = scaleSize ? `-scale-${scaleSize}` : "";
                const ok = await capture({ url, size, assertViewportBounds: Boolean(scaleSize), outFile: join(outDir, `${host ? "host-" : ""}workbench-${view}-${viewport}-${theme}${scaleSuffix}.png`) });
                console.log(`${view} ${viewport} ${theme}: ${ok ? "OK" : "FAIL"}`);
                if (!ok) process.exitCode = 1;
            }
        }
    }
    /* 宿主样式基线套件（C01，LVCT_HOST_BASELINE=1 开启）：
       真实思源 base.css + 官方主题变量下截图，重点覆盖自绘浮层（B02）与主要页面。 */
    if (!selectedView && process.env.LVCT_HOST_BASELINE === "1") {
        const hostShots = [
            ["shot-wizard.html?state=reuse&host=1", "wizard-reuse", "desktop", "1280,900"],
            ["shot-wizard.html?state=failed&host=1", "wizard-failed", "desktop", "1280,900"],
            ["shot-settings.html?section=data&host=1", "settings-data", "desktop", "1280,1000"],
            ["shot-workbench.html?view=home&host=1", "workbench-home", "desktop", "1280,900"],
            ["shot-workbench.html?view=people&host=1", "workbench-people", "desktop", "1280,900"],
            ["shot-workbench.html?view=people&host=1", "workbench-people", "mobile", "390,844"],
            ["shot-workbench.html?view=viewsmenu&host=1", "pop-viewsmenu", "desktop", "1280,900"],
            ["shot-workbench.html?view=viewsmenu&host=1", "pop-viewsmenu", "mobile", "390,844"],
            ["shot-workbench.html?view=morefilter&host=1", "pop-morefilter", "desktop", "1280,900"],
            ["shot-workbench.html?view=colmenu&host=1", "pop-colmenu", "desktop", "1280,900"],
            ["shot-workbench.html?view=orgmgr&host=1", "pop-orgmgr", "desktop", "1280,900"],
            ["shot-workbench.html?view=home&host=1", "workbench-home-dark", "desktop-dark", "1280,900"],
            ["shot-workbench.html?view=viewsmenu&host=1", "pop-viewsmenu-dark", "desktop-dark", "1280,900"],
        ];
        for (const [query, name, viewport, size] of hostShots) {
            const theme = viewport.endsWith("-dark") ? "&theme=dark" : "";
            const baseViewport = viewport.replace("-dark", "");
            const url = `http://127.0.0.1:${port}/scripts/e2e/${query}${theme}`;
            const ok = await capture({ url, size, outFile: join(outDir, `host-${name}-${baseViewport}.png`) });
            console.log(`host ${name} ${baseViewport}: ${ok ? "OK" : "FAIL"}`);
            if (!ok) process.exitCode = 1;
        }
    }
} finally {
    await server.close();
    console.log("截图目录：", outDir);
}
