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
const workbenchViews = ["home", "actions", "people", "peoplelong", "table", "peek", "detail", "detaillong", "graph", "orgs", "orgslong", "orgdetail", "orgmgr", "quickfill", "viewsmenu", "morefilter", "colmenu"];
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
        /* 截图记录稳定表面，而不是弹窗进入动画中途的透明帧。跳过无限加载动画。 */
        await call("Runtime.evaluate", { expression: `Promise.allSettled(document.getAnimations()
            .filter(animation => Number.isFinite(animation.effect?.getComputedTiming().endTime))
            .map(animation => animation.finished))`, awaitPromise: true });
        const refinement = await call("Runtime.evaluate", { expression: `(() => {
            const view = new URLSearchParams(location.search).get("view");
            const errors = [];
            for (const icon of document.querySelectorAll(".lvct-tab-root svg.lucide-icon")) {
                if (getComputedStyle(icon).fill !== "none") errors.push("描边图标被宿主填成实心");
            }
            if (view === "peoplelong") {
                const cards = [...document.querySelectorAll(".lvct-person-card")];
                if (cards.length !== 4) errors.push("长资料联系人夹具不完整");
                const profile = index => cards[index]?.querySelector(".lvct-profile-summary")?.textContent ?? "";
                if (!profile(0).includes("工作单位") || profile(0).includes("未填写")) errors.push("已知资料摘要缺失或显示冗余空字段");
                if (!profile(1).includes("其他组织") || profile(1).includes("资料待补充")) errors.push("其他组织被误认为空资料");
                if (!profile(2).includes("资料待补充")) errors.push("空资料缺少提示");
                if (!profile(3).includes("历史组织") || profile(3).includes("资料待补充")) errors.push("历史经历被误认为空资料");
                for (const card of cards) {
                    for (const element of card.querySelectorAll(".lvct-person-card__name, .lvct-person-card__meta-value, .lvct-profile-summary")) {
                        const rect = element.getBoundingClientRect();
                        const bounds = card.getBoundingClientRect();
                        if (rect.left < bounds.left - 1 || rect.right > bounds.right + 1 || rect.bottom > bounds.bottom + 1 || element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1) errors.push("联系人长资料被裁切或超出卡片：" + element.className + " " + element.scrollWidth + "/" + element.clientWidth + "x" + element.scrollHeight + "/" + element.clientHeight);
                    }
                }
            }
            if (view === "orgslong") {
                const logos = [...document.querySelectorAll(".lvct-orgs-view__card-logo")];
                if (logos.length !== 3) errors.push("大尺寸Logo夹具未显示");
                for (const logo of logos) {
                    const rect = logo.getBoundingClientRect();
                    if (rect.width > 40.5 || rect.height > 40.5) errors.push("组织Logo超过40px边界");
                }
                for (const head of document.querySelectorAll(".lvct-orgs-view__card-head")) {
                    const name = head.querySelector(".lvct-orgs-view__card-name");
                    if (name.scrollWidth > name.clientWidth + 1 || name.scrollHeight > name.clientHeight + 1) errors.push("组织长名称被裁切");
                    for (const chip of head.querySelectorAll(".lvct-chip")) {
                        const rect = chip.getBoundingClientRect();
                        const title = name.getBoundingClientRect();
                        if (rect.top < title.bottom - 1 || rect.right > head.getBoundingClientRect().right + 1) errors.push("简称或归档标记挤压组织名称");
                    }
                }
            }
            if (["detail", "detaillong"].includes(view)) {
                const detail = document.querySelector(".lvct-detail");
                const panel = detail.closest(".lvct-dialog-panel");
                const rect = panel.getBoundingClientRect();
                if (panel.getAttribute("aria-modal") !== "true" || !panel.classList.contains("lvct-dialog-panel--wide")) errors.push("人物详情未使用正常宽模态窗口");
                if (Math.abs((rect.left + rect.right) / 2 - innerWidth / 2) > 2 || rect.left < -1 || rect.right > innerWidth + 1) errors.push("人物详情窗口未居中或越界");
                if (Number(getComputedStyle(panel).opacity) < 1) errors.push("详情截图仍在进入动画中");
                for (const element of detail.querySelectorAll(".lvct-detail__name, .lvct-detail__group-chip, .lvct-detail__header-actions")) {
                    if (element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1) errors.push("详情头部长内容被裁切");
                }
            }
            return errors;
        })()`, returnByValue: true });
        if (refinement.result.value?.length) throw new Error(refinement.result.value.join("；"));
        if (new URL(url).searchParams.get("view") === "actions") {
            const actionLayout = await call("Runtime.evaluate", { expression: `(() => {
                const card = document.querySelector(".lvct-dash__actions");
                card.scrollIntoView({ block: "start", behavior: "instant" });
                const errors = [];
                const cardBounds = card.getBoundingClientRect();
                if (cardBounds.top < 0 || cardBounds.top > innerHeight / 3) errors.push("行动区未滚动到可见区域");
                const rows = [...card.querySelectorAll(".lvct-dash__action-row")];
                if (rows.length !== 3) errors.push("行动行夹具不完整");
                const buttonEdges = [];
                for (const row of rows) {
                    const bounds = row.getBoundingClientRect();
                    const mainBounds = row.querySelector(".lvct-dash__row-main").getBoundingClientRect();
                    const buttons = [...row.querySelectorAll(":scope > .lvct-dash__quick-button")];
                    buttonEdges.push(buttons[0].getBoundingClientRect().left);
                    for (const button of buttons) {
                        const rect = button.getBoundingClientRect();
                        if (rect.width < 40 || rect.height < 40) errors.push("处置按钮触控尺寸不足");
                        if (mainBounds.right > rect.left + 1 && mainBounds.bottom > rect.top + 1 && mainBounds.top < rect.bottom - 1) errors.push("内容与处置按钮重叠");
                    }
                    for (const element of row.querySelectorAll(".lvct-dash__row-primary, .lvct-dash__reasons, .lvct-action-chip")) {
                        const rect = element.getBoundingClientRect();
                        if (rect.left < bounds.left - 1 || rect.right > mainBounds.right + 1
                            || element.scrollWidth > element.clientWidth + 1) errors.push("姓名或提醒原因被挤压/截断");
                    }
                }
                if (Math.max(...buttonEdges) - Math.min(...buttonEdges) > 1) errors.push("处置按钮未对齐");
                if (!card.textContent.includes("下一阶段协作安排")) errors.push("缺少长内容夹具");
                return errors;
            })()`, returnByValue: true });
            if (actionLayout.result.value?.length) throw new Error(actionLayout.result.value.join("；"));
            await pause(100);
        }
        const metrics = await call("Runtime.evaluate", { expression: `(() => {
            const selectors = [".lvct-workbench", ".lvct-workbench__main", ".lvct-workbench__body", ".lvct-people", ".lvct-people__toolbar", ".lvct-people__cards", ".lvct-people__table-wrap", ".lvct-graph-view__canvas", ".lvct-graph__fab"];
            const containers = selectors.flatMap((selector) => [...document.querySelectorAll(selector)].map((element) => {
                const rect = element.getBoundingClientRect();
                return { selector, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height };
            }));
            const cy = document.querySelector(".lvct-graph-view__canvas")?._cyreg?.cy;
            const graph = cy ? { nodes: cy.nodes().length, edges: cy.edges().length,
                labelSize: cy.nodes().first().style("font-size"), edgeColor: cy.edges().first().style("line-color"),
                surface: getComputedStyle(document.querySelector(".lvct-graph-view__canvas")).backgroundColor } : undefined;
            return { width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth, containers, graph };
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
        if (selectedView === "graph") writeFileSync(outFile.replace(/\.png$/, ".metrics.json"), JSON.stringify(metrics.result.value, null, 2));
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
    const captureViews = selectedView ? [selectedView] : scaleSize ? ["people", "table"] : ["home", "actions", "people", "table", "peek", "graph", "orgs", "orgdetail", "orgmgr", "quickfill"];
    for (const view of captureViews) {
        for (const [viewport, size] of (["actions", "peoplelong", "detaillong", "orgslong", "graph"].includes(view) ? [["desktop", "1280,900"], ["tablet", "768,1024"], ["mobile", "390,844"], ["narrow", "320,844"]] : [["desktop", "1280,900"], ["mobile", "390,844"]])) {
            for (const theme of ["light", "dark"]) {
                const host = selectedView && process.env.LVCT_HOST_BASELINE === "1" ? "&host=1" : "";
                const fixtureQuery = scaleFixture ? `&fixture=${encodeURIComponent(scaleFixture)}` : "";
                const url = `http://127.0.0.1:${port}/scripts/e2e/shot-workbench.html?view=${view}&theme=${theme}&mobile=${Number(size.split(",")[0]) <= 640 ? "1" : "0"}${fixtureQuery}${host}`;
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
