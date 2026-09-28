/* B02 定位探针：在宿主样式基线下打开「视图」浮层，打印其计算样式与令牌解析情况。
   一次性诊断脚本，随 C01/B02 收尾可删。 */
import { createServer } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
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
if (!browserPath) throw new Error("未找到浏览器");

const server = await createServer({
    configFile: false, root, publicDir: false,
    resolve: { alias: { siyuan: resolve(root, "scripts/e2e/ui/siyuan-mock.js") } },
    plugins: [svelte(), hostBaselinePlugin()],
    server: { host: "127.0.0.1", port: 0, open: false },
});
await server.listen();
const port = server.httpServer.address().port;

const profile = mkdtempSync(join(tmpdir(), "lvct-probe-"));
const browser = spawn(browserPath, [
    "--headless=new", "--no-first-run", "--disable-gpu",
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
        const done = pending.get(reply.id);
        if (done) { pending.delete(reply.id); done(reply); }
    });
    const call = (method, params = {}) => new Promise((resolveCall, rejectCall) => {
        const id = ++nextId;
        pending.set(id, (reply) => reply.error ? rejectCall(new Error(reply.error.message)) : resolveCall(reply.result));
        socket.send(JSON.stringify({ id, method, params }));
    });
    await call("Page.navigate", { url: `http://127.0.0.1:${port}/scripts/e2e/shot-workbench.html?view=viewsmenu&host=1` });
    for (let i = 0; i < 80; i++) {
        await new Promise((r) => setTimeout(r, 100));
        const title = (await call("Runtime.evaluate", { expression: "document.title" })).result.value ?? "";
        if (title === "READY" || title.startsWith("ERROR")) break;
    }
    const probe = await call("Runtime.evaluate", { expression: `(() => {
        const menu = document.querySelector(".lvct-people__viewsmenu");
        if (!menu) return { found: false };
        const cs = getComputedStyle(menu);
        const root = getComputedStyle(document.querySelector(".lvct-tab-root"));
        let ruleFound = null;
        for (const sheet of document.styleSheets) {
            let rules; try { rules = sheet.cssRules; } catch { continue; }
            for (const rule of rules ?? []) {
                if (rule.selectorText && rule.selectorText.includes("lvct-people__moremenu") && !rule.selectorText.includes(" ")) {
                    ruleFound = { selector: rule.selectorText, cssText: rule.cssText.slice(0, 400) };
                }
            }
        }
        return {
            found: true,
            computed: {
                position: cs.position, top: cs.top, right: cs.right, width: cs.width, minWidth: cs.minWidth,
                background: cs.backgroundColor, border: cs.borderTopWidth + " " + cs.borderTopColor,
                padding: cs.padding, zIndex: cs.zIndex, overflow: cs.overflowX + "/" + cs.overflowY,
                boxShadow: cs.boxShadow.slice(0, 80),
            },
            rect: menu.getBoundingClientRect().toJSON(),
            tokens: {
                bgElevated: root.getPropertyValue("--lvct-bg-elevated"),
                sp2: root.getPropertyValue("--lvct-sp-2"),
                borderSubtle: root.getPropertyValue("--lvct-border-subtle"),
            },
            ruleFound,
            hostCssLoaded: [...document.styleSheets].some((sheet) => { try { return (sheet.href ?? "").includes("__host"); } catch { return false; } }),
            sheetCount: document.styleSheets.length,
        };
    })()`, returnByValue: true });
    console.log(JSON.stringify(probe.result.value, null, 2));
} finally {
    socket?.close();
    browser.kill();
    await server.close();
}
