/** UX-01.10 断点扫描：主页面 × 390/640/1280 三档截图，供断点收敛核对（一次性脚本可复用）。 */
import { createServer } from "vite";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { spawn } from "node:child_process";

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
    server: { host: "127.0.0.1", port: 0, open: false },
});
await server.listen();
const port = server.httpServer.address().port;
const pages = ["home", "people", "graph", "settings"];
const widths = [390, 640, 1280];

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
    for (const width of widths) {
        for (const view of pages) {
            await call("Emulation.setDeviceMetricsOverride", {
                width, height: width === 390 ? 844 : 900, deviceScaleFactor: 1, mobile: width <= 640,
            });
            await call("Page.navigate", {
                url: `http://127.0.0.1:${port}/scripts/e2e/shot-workbench.html?view=${view}&theme=light&host=1`,
            });
            await new Promise((r) => setTimeout(r, 1400));
            const shot = await call("Page.captureScreenshot", { format: "png" });
            writeFileSync(join(outDir, `${view}-${width}.png`), Buffer.from(shot.data, "base64"));
            console.log(`${view} @ ${width}`);
        }
    }
    console.log("sweep done →", outDir);
} finally {
    socket?.close();
    browser.kill();
    await server.close();
}
