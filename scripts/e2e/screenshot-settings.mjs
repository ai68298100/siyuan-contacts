/** 截取设置页真实渲染图（桌面/移动 × 分区），用于视觉核对。用法：node scripts/e2e/screenshot-settings.mjs */
import { createServer } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { existsSync, mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { spawn } from "node:child_process";

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
    plugins: [svelte()],
    server: { host: "127.0.0.1", port: 0, open: false },
});
await server.listen();
const port = server.httpServer.address().port;

function capture({ url, outFile, size }) {
    return new Promise((resolveCapture) => {
        const profile = mkdtempSync(join(tmpdir(), "lvct-shot-"));
        const browser = spawn(browserPath, [
            "--headless=new", "--no-first-run", "--disable-gpu", "--hide-scrollbars",
            `--window-size=${size}`, `--user-data-dir=${profile}`,
            "--virtual-time-budget=1500", `--screenshot=${outFile}`, url,
        ], { stdio: "ignore", windowsHide: true });
        const timer = setTimeout(() => { browser.kill(); resolveCapture(false); }, 20000);
        browser.on("exit", () => { clearTimeout(timer); resolveCapture(existsSync(outFile)); });
    });
}

const sections = ["general", "data"];
try {
    for (const section of sections) {
        const url = `http://127.0.0.1:${port}/scripts/e2e/shot-settings.html?section=${section}`;
        const desktop = await capture({
            url, size: "1280,1000",
            outFile: join(outDir, `settings-desktop-${section}.png`),
        });
        const mobile = await capture({
            url, size: "390,844",
            outFile: join(outDir, `settings-mobile-${section}.png`),
        });
        console.log(`${section}: desktop ${desktop ? "OK" : "FAIL"}, mobile ${mobile ? "OK" : "FAIL"}`);
    }
} finally {
    await server.close();
    console.log("截图目录：", outDir);
}
