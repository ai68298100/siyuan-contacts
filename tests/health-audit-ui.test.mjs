import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { readBrowserDebuggingPort, removeIsolatedBrowserProfile, stopIsolatedBrowser } from "../scripts/e2e/browser-cleanup.mjs";

const root = resolve(import.meta.dirname, "..");
const browserPath = [process.env.LVCT_TEST_BROWSER, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find((candidate) => candidate && existsSync(candidate));
const entry = `<script type="module">
import { tick } from "svelte";
import { runHealthAuditRegression } from "/scripts/e2e/ui/health-audit-regression.js";
const fixture = document.querySelector("#fixture");
const results = [];
const errors = [];
window.addEventListener("error", (event) => errors.push(event.message));
window.addEventListener("unhandledrejection", (event) => errors.push(String(event.reason)));
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const test = async (name, run) => {
    try { await run(); results.push({name, ok:true}); }
    catch (error) { results.push({name, ok:false, detail:String(error.stack ?? error)}); }
    document.querySelector("#results").textContent = JSON.stringify(results, null, 2);
};
const until = async (condition, message) => {
    const end = Date.now() + 5000;
    while (!condition()) {
        if (Date.now() > end) throw new Error(message + "\\n" + fixture.textContent);
        await new Promise((resolve) => setTimeout(resolve, 20));
    }
    await tick();
};
const button = (label) => {
    const node = [...fixture.querySelectorAll("button")].find((item) => item.textContent.trim() === label);
    assert(node, "未找到按钮：" + label);
    return node;
};
await runHealthAuditRegression({test, assert, fixture, until, button});
if (errors.length) results.push({name:"浏览器运行期错误", ok:false, detail:errors.join("\\n")});
await fetch("/__health_report", {method:"POST", body:JSON.stringify(results)});
</script>`;

for (const width of [1280, 390]) {
    test(`AG-P0-012 独立服务和页面回归 ${width}px`, { timeout: 120_000 }, async () => {
        assert.ok(browserPath, "未找到隔离 Chromium，请设置 LVCT_TEST_BROWSER");
        let completeReport;
        const report = new Promise((resolveReport) => { completeReport = resolveReport; });
        const html = readFileSync(join(root, "scripts/e2e/ui/index.html"), "utf8").replace('<script type="module" src="/scripts/e2e/ui/smoke.js"></script>', entry);
        const server = await createServer({
            configFile: false, root, publicDir: false,
            resolve: { alias: { siyuan: join(root, "scripts/e2e/ui/siyuan-mock.js") } },
            plugins: [svelte(), {
                name: "health-audit-isolated-fixture",
                configureServer(instance) {
                    instance.middlewares.use((request, response, next) => {
                        if (request.url !== "/__health_audit.html") { next(); return; }
                        instance.transformIndexHtml("/__health_audit.html", html).then((page) => {
                            response.setHeader("Content-Type", "text/html; charset=utf-8");
                            response.end(page);
                        }, next);
                    });
                    instance.middlewares.use("/__health_report", (request, response) => {
                        let body = "";
                        request.on("data", (chunk) => { body += chunk; });
                        request.on("end", () => { completeReport(JSON.parse(body)); response.end("ok"); });
                    });
                },
            }],
            server: { host: "127.0.0.1", port: 0, open: false },
        });
        let browser;
        let socket;
        let profile;
        let call;
        let deadline;
        try {
            await server.listen();
            console.log(`${width}px 隔离服务已启动`);
            profile = mkdtempSync(join(tmpdir(), "lvct-ui-"));
            console.log(`${width}px 本轮浏览器目录：${profile}`);
            browser = spawn(browserPath, ["--headless=new", "--no-first-run", "--no-default-browser-check", "--disable-gpu", "--no-sandbox", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore", windowsHide: true });
            const spawned = new Promise((resolveSpawn, rejectSpawn) => { browser.once("spawn", resolveSpawn); browser.once("error", rejectSpawn); });
            await spawned;
            let port;
            for (let attempt = 0; attempt < 100; attempt += 1) {
                port = readBrowserDebuggingPort(profile);
                if (port) break;
                await new Promise((resolveWait) => setTimeout(resolveWait, 100));
            }
            assert.ok(port, "隔离浏览器调试端口未启动");
            const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
            socket = new WebSocket(targets.find((target) => target.type === "page").webSocketDebuggerUrl);
            await new Promise((resolveOpen, rejectOpen) => { socket.addEventListener("open", resolveOpen, { once: true }); socket.addEventListener("error", rejectOpen, { once: true }); });
            let requestId = 0;
            const requests = new Map();
            socket.addEventListener("message", ({ data }) => {
                const reply = JSON.parse(data);
                if (requests.has(reply.id)) { requests.get(reply.id)(reply); requests.delete(reply.id); }
            });
            call = (method, params = {}) => new Promise((resolveCall, rejectCall) => {
                const id = ++requestId;
                const timer = setTimeout(() => { requests.delete(id); rejectCall(new Error(`${method} 10 秒超时`)); }, 10_000);
                requests.set(id, (reply) => {
                    clearTimeout(timer);
                    if (reply.error) rejectCall(new Error(reply.error.message)); else resolveCall(reply.result);
                });
                socket.send(JSON.stringify({ id, method, params }));
            });
            await call("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width === 390 });
            await call("Page.navigate", { url: `http://127.0.0.1:${server.httpServer.address().port}/__health_audit.html` });
            console.log(`${width}px 已打开独立体检回归页`);
            const results = await Promise.race([report, new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error("独立体检回归 75 秒超时")), 75_000); })]);
            for (const result of results) console.log(`${width}px ${result.ok ? "PASS" : "FAIL"} ${result.name}${result.detail ? `\n${result.detail}` : ""}`);
            assert.equal(results.filter((result) => !result.ok).length, 0, JSON.stringify(results.filter((result) => !result.ok)));
            assert.equal(results.length, 10, "回归用例未完整运行");
        } finally {
            clearTimeout(deadline);
            try {
                await stopIsolatedBrowser(browser, { requestClose: call ? () => call("Browser.close") : undefined });
                if (profile) await removeIsolatedBrowserProfile(profile);
            } finally { socket?.close(); await server.close(); }
        }
    });
}
