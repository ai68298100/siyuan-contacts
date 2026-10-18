/** 隔离浏览器回归：真实 Svelte/Cytoscape，内存 Siyuan 适配器，不连接用户内核。
 *  LVCT_UI_HOST=1 时页面注入真实思源 base.css + 官方主题变量（宿主样式基线，C01），
 *  用于在真实宿主 CSS 下跑同一套断言；本机无思源安装（如 CI）时自动回退近似样式。 */
import { createServer } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { spawn } from "node:child_process";
import { hostBaselinePlugin } from "./host-baseline.mjs";
import { readBrowserDebuggingPort, removeIsolatedBrowserProfile, stopIsolatedBrowser } from "./browser-cleanup.mjs";

const root = resolve(import.meta.dirname, "../..");
const browserPath = [
    process.env.LVCT_TEST_BROWSER,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
].find((candidate) => candidate && existsSync(candidate));
if (!browserPath) throw new Error("未找到测试浏览器，请用 LVCT_TEST_BROWSER 指定 Chromium 可执行文件");
const profile = mkdtempSync(join(tmpdir(), "lvct-ui-"));

let resolveReport;
const report = new Promise((resolve) => { resolveReport = resolve; });
const server = await createServer({
    configFile: false, root, publicDir: false,
    cacheDir: join(profile, "vite-cache"),
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
    server: {
        host: "127.0.0.1",
        port: Number(process.env.LVCT_E2E_PORT || 0),
        strictPort: Number(process.env.LVCT_E2E_PORT) > 0,
        open: false,
        hmr: false,
    },
});
let browser;
let debuggerSocket;
let timeout;
let requestBrowserClose;
try {
    await server.listen();
    const address = server.httpServer.address();
    console.log(`隔离浏览器临时目录：${profile}`);
    browser = spawn(browserPath, [
        "--headless=new", "--no-first-run", "--no-default-browser-check", "--disable-gpu", "--disable-extensions",
        // Linux runner（无 user-namespace）上 Chromium 必须关闭沙箱才能启动
        "--no-sandbox", "--disable-dev-shm-usage",
        "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank",
    ], { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
    let chromeStartupError = "";
    browser.stderr?.on("data", (chunk) => { chromeStartupError += chunk.toString(); });
    let debugPort;
    for (let attempt = 0; attempt < 100; attempt++) {
        debugPort = readBrowserDebuggingPort(profile);
        if (debugPort) break;
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
        if (reply.method === "Runtime.bindingCalled" && reply.params.name === "__lvctTrustedClick") {
            void handleTrustedClick(reply.params);
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
    // Only fixed fixture targets are accepted; the page cannot request arbitrary
    // CDP methods or JavaScript. Input events are trusted, unlike element.click().
    // A checkbox toggle can synchronously update the parent Svelte tree and
    // replace the focused input before the next real key request is handled.
    // Keep recovery scoped to the same picker panel and aria identity; never
    // guess a different option or bypass disabled-state checks.
    const handleTrustedClick = async ({ payload }) => {
        let requestId;
        let error;
        try {
            const request = JSON.parse(payload);
            requestId = request.requestId;
            const targets = {
                "relation-empty-cta": "#fixture #lvct-detail-panel-relations .lvct-empty__actions button",
                "relation-heading": "#fixture #lvct-detail-panel-relations h4",
                "org-search": '#fixture .lvct-person-edit__profile input[aria-label="搜索组织"]',
                "org-focused-option": '#fixture .lvct-person-edit__profile .lvct-org-multi__option input[type="checkbox"]:focus',
                "strip-chips-more": "#fixture .lvct-strip__chip-more",
            };
            const selector = Object.hasOwn(targets, request.target) ? targets[request.target] : undefined;
            const actions = {
                "relation-empty-cta": ["click", "enter"], "relation-heading": ["click"],
                "org-search": ["enter", "arrowdown", "arrowup", "home", "end"],
                "org-focused-option": ["enter", "space", "arrowdown", "arrowup", "home", "end"],
                "strip-chips-more": ["enter", "space"],
            };
            const action = request.action ?? "click";
            if (!/^[a-z0-9-]{1,60}$/.test(requestId ?? "") || !selector
                || !actions[request.target].includes(action)) {
                throw new Error("真实输入请求不属于允许的 UI 回归入口");
            }
            const point = await call("Runtime.evaluate", {
                expression: `(async () => {
                    const directTarget = document.querySelector(${JSON.stringify(selector)});
                    const panel = document.querySelector('#fixture .lvct-org-multi__panel');
                    const previous = window.__lvctTrustedOrgOption;
                    const fallbackTarget = !directTarget && ${JSON.stringify(request.target)} === "org-focused-option"
                        && panel && previous?.panelId === panel.id
                        ? [...panel.querySelectorAll('input[type="checkbox"]')].find((input) => input.getAttribute('aria-label') === previous.label)
                        : null;
                    const target = directTarget || fallbackTarget;
                    if (!target) throw new Error('真实输入入口不可交互：目标已消失 ' + JSON.stringify({
                        active: document.activeElement?.outerHTML?.slice(0, 320) ?? null,
                        activeConnected: document.activeElement?.isConnected ?? false,
                        panel: Boolean(document.querySelector('#fixture .lvct-org-multi__panel')),
                    }));
                    if (target.disabled) throw new Error('真实输入入口不可交互：目标已禁用 ' + JSON.stringify({
                        active: document.activeElement?.outerHTML?.slice(0, 320) ?? null,
                        panel: Boolean(document.querySelector('#fixture .lvct-org-multi__panel')),
                    }));
                    if (${JSON.stringify(request.target)} === "org-focused-option") {
                        const owner = target.closest('.lvct-org-multi__panel');
                        if (!owner?.id || !target.getAttribute('aria-label')) throw new Error('真实输入入口不可交互：组织候选缺少稳定身份');
                        window.__lvctTrustedOrgOption = { panelId: owner.id, label: target.getAttribute('aria-label') };
                        if (target !== document.activeElement) target.focus({ preventScroll: true });
                    }
                    // The harness report precedes #fixture and grows after each
                    // case. Host body styles can prevent scrolling past it.
                    document.querySelector('#results').hidden = true;
                    // Picker panels own their scroll container. Scrolling an
                    // option into view through the page can emit an outer
                    // scroll event and legitimately close the popover before
                    // the trusted key is dispatched.
                    if (!target.closest('.lvct-picker__panel, .lvct-org-multi__panel')) {
                        target.scrollIntoView({ block: 'center', behavior: 'instant' });
                    }
                    const frame = () => new Promise((done) => requestAnimationFrame(done));
                    let rect = target.getBoundingClientRect();
                    let stable = false;
                    for (let attempt = 0; attempt < 10; attempt++) {
                        await frame();
                        const next = target.getBoundingClientRect();
                        stable = ['x', 'y', 'width', 'height'].every((key) => Math.abs(next[key] - rect[key]) < 0.5);
                        rect = next;
                        if (stable) break;
                    }
                    if (!stable) throw new Error('真实输入目标尚未稳定');
                    ${action !== "click" ? "target.focus({ preventScroll: true });" : ""}
                    const point = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
                    const hit = document.elementFromPoint(point.x, point.y);
                    if (!hit || !target.contains(hit)) {
                        throw new Error('真实输入未命中目标: ' + JSON.stringify({ rect: rect.toJSON(), hit: hit?.tagName, text: hit?.textContent?.slice(0, 80) }));
                    }
                    return point;
                })()`,
                awaitPromise: true, returnByValue: true,
            });
            if (point.exceptionDetails) throw new Error(point.exceptionDetails.exception?.description ?? "无法定位真实输入入口");
            if (action !== "click") {
                const key = {
                    enter: { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, text: "\r", unmodifiedText: "\r" },
                    space: { key: " ", code: "Space", windowsVirtualKeyCode: 32, nativeVirtualKeyCode: 32, text: " ", unmodifiedText: " " },
                    arrowdown: { key: "ArrowDown", code: "ArrowDown", windowsVirtualKeyCode: 40, nativeVirtualKeyCode: 40 },
                    arrowup: { key: "ArrowUp", code: "ArrowUp", windowsVirtualKeyCode: 38, nativeVirtualKeyCode: 38 },
                    home: { key: "Home", code: "Home", windowsVirtualKeyCode: 36, nativeVirtualKeyCode: 36 },
                    end: { key: "End", code: "End", windowsVirtualKeyCode: 35, nativeVirtualKeyCode: 35 },
                }[action];
                await call("Input.dispatchKeyEvent", { type: "keyDown", ...key });
                await call("Input.dispatchKeyEvent", { type: "keyUp", key: key.key, code: key.code,
                    windowsVirtualKeyCode: key.windowsVirtualKeyCode, nativeVirtualKeyCode: key.nativeVirtualKeyCode });
            } else {
                await call("Input.dispatchMouseEvent", { type: "mousePressed", ...point.result.value, button: "left", clickCount: 1 });
                await call("Input.dispatchMouseEvent", { type: "mouseReleased", ...point.result.value, button: "left", clickCount: 1 });
            }
        } catch (cause) {
            error = cause instanceof Error ? cause.message : String(cause);
        }
        await call("Runtime.evaluate", {
            expression: `window.dispatchEvent(new CustomEvent('lvct:trusted-click-done', { detail: ${JSON.stringify({ requestId, error })} }))`,
        });
    };
    requestBrowserClose = () => call("Browser.close");
    const mobile = process.env.LVCT_UI_MOBILE === "1";
    await call("Runtime.enable");
    await call("Runtime.addBinding", { name: "__lvctTrustedClick" });
    await call("Emulation.setDeviceMetricsOverride", { width: mobile ? 390 : 1280, height: mobile ? 844 : 900, deviceScaleFactor: 1, mobile });
    const parameters = new URLSearchParams();
    if (mobile) parameters.set("mobile", "1");
    if (process.env.LVCT_UI_HOST === "1") parameters.set("host", "1");
    if (process.env.LVCT_UI_FILTER) parameters.set("filter", process.env.LVCT_UI_FILTER);
    await call("Page.navigate", { url: `http://127.0.0.1:${address.port}/scripts/e2e/ui/index.html?${parameters}` });
await new Promise((r) => setTimeout(r, 300));
    const results = await Promise.race([
        report,
        new Promise((_, reject) => {
            timeout = setTimeout(async () => {
                try {
                    const state = await call("Runtime.evaluate", { expression: "(async () => { const q = navigator.locks ? await navigator.locks.query() : {held:[],pending:[]}; return JSON.stringify({stage: window.__stage||'none', currentCase: window.__cases?.at(-1), results: document.querySelector('#results')?.textContent?.slice(-6000), fixture: document.querySelector('#fixture')?.textContent?.slice(0,2000), held: q.held.map(function(l){return l.name}), pending: q.pending.map(function(l){return l.name})}); })()", awaitPromise: true, returnByValue: true });
                    console.log("--- 回归超时，页面进度：", state.result.value);
                    console.log("--- 浏览器 console 尾部 ---");
                    console.log(browserConsole.slice(-40).join(String.fromCharCode(10)));
                } catch { console.log("--- 回归超时（页面状态不可读）"); }
                reject(new Error("浏览器回归 420 秒超时"));
            }, 420000);
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
    let browserStopped = false;
    try {
        await stopIsolatedBrowser(browser, { requestClose: requestBrowserClose });
        browserStopped = true;
    } catch (error) {
        console.error("隔离浏览器停止失败，保留本轮临时目录：", profile, error);
        process.exitCode = 1;
    } finally {
        debuggerSocket?.close();
    }
    try {
        if (profile && browserStopped) await removeIsolatedBrowserProfile(profile);
    } catch (error) {
        console.error("隔离浏览器临时目录清理失败，原始回归结果保留：", profile, error);
        process.exitCode = 1;
    } finally {
        await server.close();
    }
}
