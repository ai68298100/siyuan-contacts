/** 隔离浏览器回归：真实 Svelte/Cytoscape，内存 Siyuan 适配器，不连接用户内核。 */
import { createServer } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { spawn } from "node:child_process";

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
    plugins: [svelte(), {
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
let timeout;
try {
    await server.listen();
    const address = server.httpServer.address();
    const profile = mkdtempSync(join(tmpdir(), "lvct-ui-"));
    console.log(`隔离浏览器临时目录：${profile}`);
    browser = spawn(browserPath, [
        "--headless=new", "--no-first-run", "--no-default-browser-check", "--disable-gpu",
        ...(process.env.LVCT_UI_MOBILE === "1" ? ["--window-size=390,844"] : ["--window-size=1280,900"]),
        `--user-data-dir=${profile}`, `http://127.0.0.1:${address.port}/scripts/e2e/ui/index.html`,
    ], { stdio: "ignore", windowsHide: true });
    const results = await Promise.race([
        report,
        new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error("浏览器回归 45 秒超时")), 45000); }),
        new Promise((_, reject) => browser.once("error", reject)),
    ]);
    for (const result of results) console.log(`${result.ok ? "PASS" : "FAIL"} ${result.name}${result.detail ? `\n${result.detail}` : ""}`);
    console.log(`UI 回归：${results.filter((result) => result.ok).length}/${results.length}`);
    if (results.some((result) => !result.ok)) process.exitCode = 1;
} finally {
    clearTimeout(timeout);
    browser?.kill();
    await server.close();
}
