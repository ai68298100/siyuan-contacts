/** 隔离工作台视觉截图；CDP 固定真实 CSS 视口，不依赖 Chromium 窗口最小宽度。
 *  LVCT_HOST_BASELINE=1 时追加"宿主样式基线"套件：页面 ?host=1 注入真实思源
 *  base.css + 官方主题变量（C01），复现 B02/B09 这类只在真实宿主 CSS 下出现的问题。 */
import { createServer } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { spawn } from "node:child_process";
import { hostBaselinePlugin } from "./host-baseline.mjs";

const root = resolve(import.meta.dirname, "../..");
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
    server: { host: "127.0.0.1", port: 0, open: false },
});
await server.listen();
const port = server.httpServer.address().port;

const pause = (ms) => new Promise((resolvePause) => setTimeout(resolvePause, ms));

async function capture({ url, outFile, size }) {
    const [width, height] = size.split(",").map(Number);
    const profile = mkdtempSync(join(tmpdir(), "lvct-shot-"));
    const browser = spawn(browserPath, [
        "--headless=new", "--no-first-run", "--disable-gpu", "--hide-scrollbars",
        "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank",
    ], { stdio: "ignore", windowsHide: true });
    let socket;
    try {
        let debugPort;
        for (let i = 0; i < 100; i++) {
            const portFile = join(profile, "DevToolsActivePort");
            if (existsSync(portFile)) { debugPort = Number(readFileSync(portFile, "utf8").split(/\r?\n/)[0]); break; }
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
            const finish = pending.get(reply.id);
            if (finish) { pending.delete(reply.id); finish(reply); }
        });
        const call = (method, params = {}) => new Promise((resolveCall, rejectCall) => {
            const id = ++nextId;
            pending.set(id, (reply) => reply.error ? rejectCall(new Error(reply.error.message)) : resolveCall(reply.result));
            socket.send(JSON.stringify({ id, method, params }));
        });
        await call("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width <= 640 });
        await call("Page.navigate", { url });
        let title = "";
        for (let i = 0; i < 80; i++) {
            await pause(100);
            const evaluated = await call("Runtime.evaluate", { expression: "document.title" });
            title = evaluated.result.value ?? "";
            if (title === "READY" || title.startsWith("ERROR")) break;
        }
        if (title !== "READY") throw new Error(`页面未就绪：${title}`);
        const metrics = await call("Runtime.evaluate", { expression: "[innerWidth,innerHeight,document.documentElement.scrollWidth]", returnByValue: true });
        const [actualWidth, actualHeight, scrollWidth] = metrics.result.value ?? [];
        if (actualWidth !== width || actualHeight !== height || scrollWidth > width + 2) {
            throw new Error(`视口/溢出异常：${actualWidth}x${actualHeight}, scrollWidth=${scrollWidth}`);
        }
        const shot = await call("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
        writeFileSync(outFile, Buffer.from(shot.data, "base64"));
        return true;
    } catch (error) {
        console.warn(url, error instanceof Error ? error.message : String(error));
        return false;
    } finally {
        socket?.close();
        browser.kill();
    }
}

const selectedView = process.env.LVCT_SHOT_VIEW;
const sections = selectedView ? [] : ["general", "data"];
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
    for (const state of selectedView ? [] : ["reuse", "failed"]) {
        for (const [viewport, size] of [["desktop", "1280,900"], ["mobile", "390,844"]]) {
            for (const theme of ["light", "dark"]) {
                const url = `http://127.0.0.1:${port}/scripts/e2e/shot-wizard.html?state=${state}&theme=${theme}`;
                const ok = await capture({ url, size, outFile: join(outDir, `wizard-${state}-${viewport}-${theme}.png`) });
                console.log(`wizard ${state} ${viewport} ${theme}: ${ok ? "OK" : "FAIL"}`);
                if (!ok) process.exitCode = 1;
            }
        }
    }
    for (const view of selectedView ? [selectedView] : ["home", "people", "table", "peek", "graph"]) {
        for (const [viewport, size] of [["desktop", "1280,900"], ["mobile", "390,844"]]) {
            for (const theme of ["light", "dark"]) {
                const url = `http://127.0.0.1:${port}/scripts/e2e/shot-workbench.html?view=${view}&theme=${theme}`;
                const ok = await capture({ url, size, outFile: join(outDir, `workbench-${view}-${viewport}-${theme}.png`) });
                console.log(`${view} ${viewport} ${theme}: ${ok ? "OK" : "FAIL"}`);
                if (!ok) process.exitCode = 1;
            }
        }
    }
    /* 宿主样式基线套件（C01，LVCT_HOST_BASELINE=1 开启）：
       真实思源 base.css + 官方主题变量下截图，重点覆盖自绘浮层（B02）与主要页面。 */
    if (process.env.LVCT_HOST_BASELINE === "1") {
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
