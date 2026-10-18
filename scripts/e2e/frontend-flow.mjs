import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { readBrowserDebuggingPort, removeIsolatedBrowserProfile, stopIsolatedBrowser } from "./browser-cleanup.mjs";
import { assertIsolatedPath } from "./kernel-safety.mjs";

const PLUGIN_NAME = "siyuan-contacts";
const FRONTEND = "browser-desktop";
const DEFAULT_DEADLINE_MS = 180_000;

function browserExecutable() {
    return [
        process.env.LVCT_TEST_BROWSER,
        "C:/Program Files/Google/Chrome/Application/chrome.exe",
        "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    ].find((candidate) => candidate && fs.existsSync(candidate));
}

function assertWorkspaceTarget(workspace, target) {
    assertIsolatedPath(workspace, target);
    const resolvedWorkspace = fs.realpathSync(workspace);
    const resolvedCwd = fs.realpathSync(process.cwd());
    const relativeToCwd = path.relative(resolvedCwd, resolvedWorkspace);
    const relativeToHome = path.relative(os.homedir(), resolvedWorkspace);
    const insideCwd = relativeToCwd === "" || (!path.isAbsolute(relativeToCwd) && !relativeToCwd.startsWith(`..${path.sep}`));
    if (insideCwd || relativeToHome === "" || path.parse(resolvedWorkspace).root === resolvedWorkspace) {
        throw new Error("拒绝使用项目、用户目录或根目录作为真实前端工作区");
    }
}

function removeOwnedDirectory(workspace, target) {
    if (!fs.existsSync(target)) return;
    const stat = fs.lstatSync(target);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`插件目标不是可替换的普通目录：${target}`);
    assertWorkspaceTarget(workspace, target);
    fs.rmSync(target, { recursive: true, force: true });
}

function installIsolatedPlugin(workspace, storage) {
    const dist = path.resolve(import.meta.dirname, "../..", "dist");
    for (const required of ["index.js", "index.css", "plugin.json"]) {
        if (!fs.existsSync(path.join(dist, required))) throw new Error(`当前 dist 缺少 ${required}`);
    }
    const manifest = JSON.parse(fs.readFileSync(path.join(dist, "plugin.json"), "utf8"));
    if (manifest?.name !== PLUGIN_NAME) throw new Error(`dist 插件名不是 ${PLUGIN_NAME}`);

    const pluginDir = path.join(workspace, "data", "plugins", PLUGIN_NAME);
    assertWorkspaceTarget(workspace, pluginDir);
    removeOwnedDirectory(workspace, pluginDir);
    fs.mkdirSync(path.dirname(pluginDir), { recursive: true });
    assertWorkspaceTarget(workspace, pluginDir);
    fs.cpSync(dist, pluginDir, { recursive: true, force: true });

    assertWorkspaceTarget(workspace, storage);
    fs.mkdirSync(storage, { recursive: true });
    const hostStorage = path.join(workspace, "data", "storage", "petal", PLUGIN_NAME);
    assertWorkspaceTarget(workspace, hostStorage);
    fs.mkdirSync(hostStorage, { recursive: true });
    for (const entry of fs.readdirSync(storage, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
        fs.copyFileSync(path.join(storage, entry.name), path.join(hostStorage, entry.name));
    }
    const settingsFile = path.join(hostStorage, "contacts-settings.json");
    assertWorkspaceTarget(workspace, settingsFile);
    return { pluginDir, hostStorage, settingsFile };
}

function unwrapKernelResult(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return value;
    const record = value;
    if (typeof record.code !== "number" || !("data" in record)) return value;
    if (record.code !== 0) throw new Error(`隔离内核请求失败 code=${record.code}`);
    return record.data;
}

async function connectCdpTarget(target) {
    if (!target?.webSocketDebuggerUrl) throw new Error("未找到隔离浏览器页面调试地址");
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
        socket.addEventListener("open", resolve, { once: true });
        socket.addEventListener("error", reject, { once: true });
    });
    let nextId = 0;
    const pending = new Map();
    const consoleTail = [];
    const fileRequestUrls = new Map();
    const fileNetworkEvents = [];
    const blockWriteRequests = [];
    const fileApiPath = (url) => {
        if (typeof url !== "string") return null;
        if (url.includes("/api/file/getFile")) return "/api/file/getFile";
        if (url.includes("/api/file/putFile")) return "/api/file/putFile";
        return null;
    };
    const rememberFileNetworkEvent = (event) => {
        // Keep only request metadata; response bodies are intentionally never
        // requested or retained by this diagnostic.
        fileNetworkEvents.push(event);
        if (fileNetworkEvents.length > 80) fileNetworkEvents.shift();
    };
    socket.addEventListener("message", ({ data }) => {
        const message = JSON.parse(data);
        if (message.method === "Runtime.consoleAPICalled") {
            consoleTail.push(message.params.args.map((arg) => arg.value ?? arg.description ?? "").join(" "));
            if (consoleTail.length > 30) consoleTail.shift();
            return;
        }
        if (message.method === "Network.requestWillBeSent") {
            const url = message.params?.request?.url;
            const path = fileApiPath(url);
            if (path) fileRequestUrls.set(message.params.requestId, { path, url });
            const blockWriteRoute = typeof url === "string" ? url.match(/\/api\/block\/(insertBlock|updateBlock|deleteBlock)(?:\?|$)/)?.[0]?.split("?")[0] : null;
            if (blockWriteRoute) blockWriteRequests.push({ requestId: message.params.requestId, route: blockWriteRoute, observedAt: new Date().toISOString() });
            return;
        }
        if (message.method === "Network.responseReceived") {
            const response = message.params?.response;
            const path = fileApiPath(response?.url) ?? fileRequestUrls.get(message.params?.requestId)?.path;
            if (path) {
                rememberFileNetworkEvent({
                    event: "responseReceived",
                    requestId: message.params?.requestId ?? null,
                    path,
                    status: response?.status ?? null,
                    url: response?.url ?? fileRequestUrls.get(message.params?.requestId)?.url ?? null,
                    timestamp: message.params?.timestamp ?? null,
                    observedAt: new Date().toISOString(),
                });
            }
            return;
        }
        if (message.method === "Network.loadingFailed") {
            const request = fileRequestUrls.get(message.params?.requestId);
            if (request) {
                rememberFileNetworkEvent({
                    event: "loadingFailed",
                    requestId: message.params?.requestId ?? null,
                    path: request.path,
                    status: null,
                    url: request.url,
                    timestamp: message.params?.timestamp ?? null,
                    observedAt: new Date().toISOString(),
                    errorText: message.params?.errorText ?? null,
                });
                fileRequestUrls.delete(message.params.requestId);
            }
            return;
        }
        const resolveMessage = pending.get(message.id);
        if (resolveMessage) {
            pending.delete(message.id);
            if (message.error) resolveMessage.reject(new Error(message.error.message));
            else resolveMessage.resolve(message.result);
        }
    });
    const call = (method, params = {}) => new Promise((resolve, reject) => {
        const id = ++nextId;
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
    });
    await call("Runtime.enable");
    await call("Network.enable");
    await call("Page.enable");
    const evaluate = async (expression, options = {}) => {
        const result = await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, ...options });
        if (result.exceptionDetails) {
            const details = result.exceptionDetails;
            const exception = details.exception;
            const description = exception?.description || exception?.value || details.text || "真实前端脚本执行失败";
            const location = details.url || details.scriptId
                ? ` @ ${details.url || `script:${details.scriptId}`}:${details.lineNumber ?? 0}:${details.columnNumber ?? 0}`
                : "";
            throw new Error(`${description}${location}`);
        }
        return result.result?.value;
    };
    return { socket, call, evaluate, consoleTail, fileNetworkEvents, blockWriteRequests };
}

async function connectBrowser(profile, deadline) {
    const executable = browserExecutable();
    if (!executable) throw new Error("未找到 Chromium/Edge 测试浏览器");
    const browser = spawn(executable, [
        "--headless=new", "--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage",
        "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank",
    ], { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
    let socket;
    try {
        let startupError = "";
        browser.stderr?.on("data", (chunk) => { startupError += String(chunk); });
        let debugPort;
        while (Date.now() < deadline) {
            debugPort = readBrowserDebuggingPort(profile);
            if (debugPort) break;
            if (browser.exitCode !== null || browser.signalCode !== null) throw new Error(`浏览器提前退出${startupError ? `：${startupError.slice(0, 240)}` : ""}`);
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
        if (!debugPort) throw new Error("浏览器调试端口启动超时");
        const targets = await fetch(`http://127.0.0.1:${debugPort}/json/list`).then((response) => response.json());
        const page = targets.find((target) => target.type === "page");
        if (!page?.webSocketDebuggerUrl) throw new Error("未找到隔离浏览器页面");
        const session = await connectCdpTarget(page);
        socket = session.socket;
        return { browser, debugPort, ...session };
    } catch (error) {
        socket?.close();
        try { await stopIsolatedBrowser(browser); } catch { /* 保留原启动错误 */ }
        throw error;
    }
}

async function waitUntil(deadline, predicate, label) {
    while (Date.now() < deadline) {
        if (await predicate()) return;
        await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(`${label}超时`);
}

async function openCdpPage(browserSession, url, deadline, extraHeaders = {}) {
    // Create a blank target first so authentication headers are installed
    // before the page starts issuing API requests during navigation.
    const response = await fetch(`http://127.0.0.1:${browserSession.debugPort}/json/new?${encodeURIComponent("about:blank")}`, { method: "PUT" });
    if (!response.ok) throw new Error(`第二隔离页面创建失败：HTTP ${response.status}`);
    const target = await response.json();
    const session = await connectCdpTarget(target);
    if (Object.keys(extraHeaders).length > 0) {
        await session.call("Network.enable");
        await session.call("Network.setExtraHTTPHeaders", { headers: extraHeaders });
    }
    await session.call("Page.enable");
    await session.call("Page.navigate", { url });
    await waitUntil(deadline, async () => Boolean(await session.evaluate("document.readyState === 'complete'")), "第二隔离页面");
    return { ...session, targetId: target.id };
}

function json(value) {
    return JSON.stringify(value).replace(/</g, "\\u003c");
}

/** Real input dispatch is required: HTMLElement.click() hides listener/microtask races. */
async function verifyRelationPickerScene({ browserSession, first, second, settings, deadline, evidence, workspace }) {
    const { listContacts } = await import("../../src/services/contacts.ts");
    const { invalidateRoster } = await import("../../src/services/roster.ts");
    const { renderView } = await import("../../src/api/av.ts");
    const { rosterFromRender } = await import("../../src/domain/roster.ts");
    const scope = "#lvct-detail-panel-relations";
    const outcome = evidence.relationPicker = { actualProductionUi: true, trustedInput: true, emptyCtaOpened: false, searchFocused: false, escapeClosed: false, outsideClosed: false, reopened: false, searched: false, selected: false, serviceAndAvVerified: false, detailReopened: false, newDocumentVerified: false, persistedAfterReload: false, completed: false, clicks: [] };
    await browserSession.evaluate(`(()=>{
        window.__lvctRelationPickerClicks=[];
        window.__lvctRelationPickerClickHandler=(event)=>window.__lvctRelationPickerClicks.push({trusted:event.isTrusted,target:event.target?.closest('button')?.className??event.target?.tagName,id:event.target?.closest('button')?.id??event.target?.id,text:event.target?.closest('button')?.textContent?.trim()??event.target?.textContent?.trim(),matched:!!document.querySelector(window.__lvctRelationPickerClickSelector)?.contains(event.target)});
        document.addEventListener('click',window.__lvctRelationPickerClickHandler,true);
    })()`);
    const click = async (selector, label, scroll = true) => {
        const point = await browserSession.evaluate(`(async()=>{
            const node=document.querySelector(${json(selector)});if(!node||node.disabled)return null;
            if(${scroll})node.scrollIntoView({behavior:'instant',block:'center',inline:'nearest'});
            await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
            const rect=node.getBoundingClientRect();const x=rect.left+rect.width/2,y=rect.top+rect.height/2;
            if(rect.width<=0||rect.height<=0||!node.contains(document.elementFromPoint(x,y)))return null;
            return {x,y};
        })()`);
        if (!point) throw new Error(`真实关系选择器${label}不可点击`);
        await browserSession.evaluate(`window.__lvctRelationPickerClickSelector=${json(selector)}`);
        const count = await browserSession.evaluate("window.__lvctRelationPickerClicks.length");
        await browserSession.call("Input.dispatchMouseEvent", { type: "mouseMoved", ...point });
        await browserSession.call("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button: "left", buttons: 1, clickCount: 1 });
        await browserSession.call("Input.dispatchMouseEvent", { type: "mouseReleased", ...point, button: "left", buttons: 0, clickCount: 1 });
        const observed = await browserSession.evaluate(`window.__lvctRelationPickerClicks.slice(${count})`);
        if (observed.length !== 1 || !observed[0].trusted || !observed[0].matched) throw new Error(`真实关系选择器${label}没有命中目标并产生唯一可信点击：${JSON.stringify(observed)}`);
        outcome.clicks.push({ label, ...observed[0] });
    };
    const openRelationsTab = async () => {
        // Opening details starts guarded reads; an early tab request can be
        // refused while those reads are busy, so retry after they settle.
        await waitUntil(deadline, async () => Boolean(await browserSession.evaluate(`(()=>{if(document.querySelector('${scope}')&&document.querySelector('#lvct-detail-tab-relations')?.getAttribute('aria-selected')==='true')return true;document.querySelector('#lvct-detail-tab-relations')?.click();return false})()`)), "真实相关人Tab就绪");
    };
    const openFromEmpty = async () => {
        await click(`${scope} .lvct-empty__actions button`, "空态选择联系人");
        await waitUntil(deadline, async () => Boolean(await browserSession.evaluate(`document.querySelector('${scope} .lvct-picker__panel')`)), "真实空态选择器打开");
        // Check after another task, so a transient panel cannot count as success.
        await browserSession.evaluate("new Promise(resolve=>setTimeout(resolve,250))");
        const state = await browserSession.evaluate(`(()=>({open:!!document.querySelector('${scope} .lvct-picker__panel'),expanded:document.querySelector('${scope} .lvct-picker__trigger')?.getAttribute('aria-expanded'),focused:document.activeElement===document.querySelector('${scope} .lvct-picker__search')}))()`);
        if (!state.open || state.expanded !== "true" || !state.focused) throw new Error("真实空态点击后选人器消失或搜索框未获焦");
        outcome.searchFocused = true;
    };
    const readFact = async () => {
        invalidateRoster();
        const service = await listContacts(settings);
        const av = rosterFromRender(await renderView(settings.avId, settings.dbBlockId), settings.fieldMap);
        const select = (people) => people.filter(person => [first.itemId, second.itemId].includes(person.itemId)).map(person => ({ docId: person.docId, itemId: person.itemId, relatedItemIds: person.relatedItemIds }));
        const servicePeople = select(service), avPeople = select(av);
        if (servicePeople.length !== 2 || avPeople.length !== 2
            || !servicePeople.find(person => person.itemId === first.itemId)?.relatedItemIds.includes(second.itemId)
            || !avPeople.find(person => person.itemId === first.itemId)?.relatedItemIds.includes(second.itemId)) throw new Error("真实选人保存后生产服务或AV缺少目标关系事实");
        return { servicePeople, avPeople };
    };
    const artifactDir = process.env.LVCT_E2E_ARTIFACT_DIR ? path.resolve(process.env.LVCT_E2E_ARTIFACT_DIR) : path.join(workspace, "relation-picker-ui-artifacts");
    try {
        await openRelationsTab();
        await waitUntil(deadline, async () => Boolean(await browserSession.evaluate(`document.querySelector('${scope} .lvct-empty__actions button')?.textContent?.trim()==='选择联系人'&&!document.querySelector('${scope} .lvct-picker__trigger')?.disabled`)), "真实空态关系入口就绪");
        await openFromEmpty(); outcome.emptyCtaOpened = true;
        await browserSession.call("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
        await browserSession.call("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
        await waitUntil(deadline, async () => Boolean(await browserSession.evaluate(`!document.querySelector('${scope} .lvct-picker__panel')`)), "真实选择器Escape关闭");
        outcome.escapeClosed = true;
        await openFromEmpty(); outcome.reopened = true;
        await click(".lvct-dialog-panel__title", "浮层外部窗口标题", false);
        await waitUntil(deadline, async () => Boolean(await browserSession.evaluate(`!document.querySelector('${scope} .lvct-picker__panel')`)), "真实选择器外部点击关闭");
        outcome.outsideClosed = true;
        await openFromEmpty();
        await browserSession.call("Input.insertText", { text: second.name });
        await waitUntil(deadline, async () => Boolean(await browserSession.evaluate(`document.querySelector('${scope} .lvct-picker__search')?.value===${json(second.name)}&&document.querySelectorAll('${scope} .lvct-picker__option').length===1&&document.querySelector('${scope} .lvct-picker__option')?.textContent?.includes(${json(second.name)})`)), "真实选人器按姓名搜索");
        outcome.searched = true;
        fs.mkdirSync(artifactDir, { recursive: true });
        const shot = await browserSession.call("Page.captureScreenshot", { format: "png" });
        const screenshot = path.join(artifactDir, "relation-picker-trusted-empty-cta.png");
        fs.writeFileSync(screenshot, Buffer.from(shot.data, "base64")); evidence.screenshots.push(screenshot);
        await click(`${scope} .lvct-picker__option`, "搜索候选联系人");
        await waitUntil(deadline, async () => Boolean(await browserSession.evaluate(`!document.querySelector('${scope} .lvct-picker__panel')&&[...document.querySelectorAll('${scope} .lvct-detail__relation-name')].some(node=>node.textContent?.trim()===${json(second.name)})&&!document.querySelector('${scope} .lvct-detail__relation-remove')?.disabled`)), "真实选人器关系保存回读");
        outcome.selected = true; outcome.savedFact = await readFact(); outcome.serviceAndAvVerified = true;
        if (!await browserSession.evaluate("(()=>{const node=document.querySelector('.lvct-detail .lvct-form__actions button:first-child');if(!node||node.disabled)return false;node.click();return true})()")) throw new Error("真实关系详情关闭按钮不可用");
        await waitUntil(deadline, async () => Boolean(await browserSession.evaluate("!document.querySelector('.lvct-detail')")), "真实关系人物详情关闭");
        if (!await browserSession.evaluate(`(()=>{const node=document.querySelector('[data-person-item-id="${first.itemId}"]');if(!node)return false;node.click();return true})()`)) throw new Error("真实关系原人物重开入口不可用");
        await waitUntil(deadline, async () => Boolean(await browserSession.evaluate("document.querySelector('#lvct-detail-tab-relations')")), "真实关系人物详情重开");
        await openRelationsTab();
        await waitUntil(deadline, async () => Boolean(await browserSession.evaluate(`[...document.querySelectorAll('${scope} .lvct-detail__relation-name')].some(node=>node.textContent?.trim()===${json(second.name)})`)), "真实人物重开关系回读");
        outcome.detailReopened = true;
        const reloadNonce = randomUUID();
        await browserSession.evaluate(`window.__lvctRelationPickerReloadNonce=${json(reloadNonce)}`);
        await browserSession.call("Page.reload", { ignoreCache: true });
        await waitUntil(deadline, async () => Boolean(await browserSession.evaluate(`window.__lvctRelationPickerReloadNonce!==${json(reloadNonce)}&&document.readyState==='complete'&&window.LvContacts?.protocol===2`).catch(() => false)), "真实关系新document重载插件");
        outcome.newDocumentVerified = true;
        if (!await browserSession.evaluate("(()=>{const node=[...document.querySelectorAll('[title],[aria-label],button,.b3-tooltips')].find(item=>/小驴人脉|Lv Contacts/.test(item.getAttribute('title')||item.getAttribute('aria-label')||item.textContent||''));if(!node)return false;node.click();return true})()")) throw new Error("关系重载后工作台入口不可用");
        await waitUntil(deadline, async () => Boolean(await browserSession.evaluate("document.querySelector('[data-navigation-view=people]')")), "关系重载后工作台");
        await browserSession.evaluate("document.querySelector('[data-navigation-view=people]').click()");
        await waitUntil(deadline, async () => Boolean(await browserSession.evaluate(`document.querySelector('[data-person-item-id="${first.itemId}"]')`)), "关系重载后原人物入口");
        await browserSession.evaluate(`document.querySelector('[data-person-item-id="${first.itemId}"]').click()`);
        await waitUntil(deadline, async () => Boolean(await browserSession.evaluate("document.querySelector('#lvct-detail-tab-relations')")), "关系重载后原人物详情");
        await openRelationsTab();
        await waitUntil(deadline, async () => Boolean(await browserSession.evaluate(`[...document.querySelectorAll('${scope} .lvct-detail__relation-name')].some(node=>node.textContent?.trim()===${json(second.name)})`)), "关系重载后UI持久化回读");
        outcome.reloadedFact = await readFact(); outcome.persistedAfterReload = true;
        outcome.completed = true;
    } finally {
        await browserSession.evaluate("document.removeEventListener('click',window.__lvctRelationPickerClickHandler,true);delete window.__lvctRelationPickerClickHandler;delete window.__lvctRelationPickerClicks;delete window.__lvctRelationPickerClickSelector").catch(() => {});
    }
}

/** Bounded production UI -> service -> SQL check; no component/mock replacement. */
async function verifyPersonFieldsScene({ browserSession, request, first, second, deadline, evidence, workspace, targetURL, authHeaders, personFieldsMultiWindow, personFieldsFilterCopy, personFieldsLifecycle, personNoteLegacyRecovery }) {
    const { loadPersonFields } = await import("../../src/services/person-fields.ts");
    const { personFieldsKey, parsePersonFieldsBlock } = await import("../../src/domain/person-fields.ts");
    const { loadPersonNote } = await import("../../src/services/person-note.ts");
    const { parsePersonNoteBlock } = await import("../../src/domain/person-note.ts");
    const section = ".lvct-person-fields";
    const fields = evidence.personFields = { actualProductionUi: true, saved: false, detailReopened: false, serviceAndSqlVerified: false, nativeEditorCasVerified: false };
    const click = async (label) => browserSession.evaluate(`(()=>{const node=[...document.querySelectorAll('${section} button')].find(item=>item.textContent?.trim()===${json(label)});if(!node||node.disabled)return false;node.click();return true})()`);
    const fill = async (selector, value) => browserSession.evaluate(`(()=>{const node=document.querySelector(${json(selector)});if(!node||node.disabled)return false;node.focus();const proto=node instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:node instanceof HTMLSelectElement?HTMLSelectElement.prototype:HTMLInputElement.prototype;const setter=Object.getOwnPropertyDescriptor(proto,'value')?.set;if(!setter)return false;setter.call(node,${json(value)});node.dispatchEvent(new Event(node instanceof HTMLSelectElement?'change':'input',{bubbles:true}));return node.value===${json(value)}})()`);
    const raw = async () => {
        await unwrapKernelResult(await request("/api/sqlite/flushTransaction"));
        return unwrapKernelResult(await request("/api/query/sql", { stmt: `SELECT id, root_id, parent_id, type, content, markdown, ial FROM blocks WHERE root_id='${first.docId}' ORDER BY id LIMIT 129` }));
    };
    const before = await raw();
    if (!Array.isArray(before) || before.length >= 129) throw new Error("人物原文 SQL 形状或范围无法核实");
    const noteEvidence = evidence.personNote = { actualProductionUi: true, saved: false, sameBlockUpdate: false, detailReopened: false, serviceAndSqlVerified: false };
    const noteSelector = '.lvct-detail__person-note textarea[aria-label="个人备注"]';
    await waitUntil(deadline, async () => Boolean(await browserSession.evaluate(`document.querySelector(${json(noteSelector)}) && !document.querySelector(${json(noteSelector)}).disabled`)), "真实个人备注读取");
    const saveNoteUi = async (value) => {
        // A verified save triggers the product's normal revision/read cycle.
        // Wait for that real textarea to return before editing it again.
        await waitUntil(deadline, async () => fill(noteSelector, value), "真实个人备注输入框就绪");
        if (!await browserSession.evaluate(`(()=>{const button=[...document.querySelectorAll('.lvct-detail__person-note button')].find(node=>node.textContent?.trim()==='保存备注');if(!button||button.disabled)return false;button.click();return true})()`)) throw new Error("真实个人备注保存按钮不可用");
        await waitUntil(deadline, async () => Boolean(await browserSession.evaluate(`document.querySelector('.lvct-detail__person-note')?.textContent?.includes('已保存') && document.querySelector(${json(noteSelector)})?.value===${json(value)}`)), "真实个人备注保存");
        if (await loadPersonNote(first.docId) !== value) throw new Error("个人备注UI保存后生产服务全文不一致");
    };
    await saveNoteUi("虚构备注初值");
    const noteInitialRows = (await raw()).filter(row => row.ial?.includes('custom-lvct-person-note="1"'));
    if (noteInitialRows.length !== 1) throw new Error("个人备注首次UI保存未形成唯一标记块");
    const noteBlockId = noteInitialRows[0].id;
    const noteText = '真实UI备注：<b>纯文本</b> &amp; "引号" \'单引号\' \\路径\\n字面\n第二行：偏好安静 😀\n{: custom-fake="1"}\n- [ ] 保留任务形似文本';
    await saveNoteUi(noteText);
    const noteUpdatedRows = (await raw()).filter(row => row.ial?.includes('custom-lvct-person-note="1"'));
    if (noteUpdatedRows.length !== 1 || noteUpdatedRows[0].id !== noteBlockId || parsePersonNoteBlock({ ...noteUpdatedRows[0], format: "2" }) !== noteText) throw new Error("个人备注UI更新未保留原块与完整特殊字符/多行正文");
    noteEvidence.saved = true; noteEvidence.sameBlockUpdate = true; noteEvidence.blockId = noteBlockId; noteEvidence.expectedText = noteText;
    noteEvidence.updatedSqlRow = noteUpdatedRows[0];
    const baseline = await loadPersonFields(first.docId);
    if (baseline.blockId || baseline.snapshot.items.length) throw new Error("本轮虚构人物已有补充资料，未覆盖既有快照");
    await waitUntil(deadline, async () => Boolean(await browserSession.evaluate(`document.querySelector('${section}') && [...document.querySelectorAll('${section} button')].some(node=>node.textContent?.trim()==='编辑补充资料'&&!node.disabled)`)), "真实人物补充资料读取");
    if (!await click("编辑补充资料")) throw new Error("真实补充资料编辑入口不可用");
    if (!await click("添加分组")) throw new Error("真实补充资料添加分组不可用");
    await waitUntil(deadline, async () => Boolean(await browserSession.evaluate(`document.querySelector('${section} [aria-label="分组名称"]')`)), "真实分组新增");
    const groupName = `真实UI联系方式 ${randomUUID().slice(0, 8)}`;
    if (!await fill(`${section} [aria-label="分组名称"]`, groupName)) throw new Error("真实分组名称不可写");
    const groupId = await browserSession.evaluate(`document.querySelector('${section} [data-field-kind="group"]')?.getAttribute('data-field-id')`);
    const values = ["+00 111 001", "+00 111 002\n仅工作日联系"];
    for (let index = 0; index < values.length; index += 1) {
        if (!await click("添加资料条目")) throw new Error("真实补充资料添加条目不可用");
        await waitUntil(deadline, async () => Number(await browserSession.evaluate(`document.querySelectorAll('${section} [data-field-kind="entry"]').length`)) === index + 1, "真实同名条目新增");
        const card = `${section} [data-field-kind="entry"]:last-child`;
        if (!await fill(`${card} [aria-label="条目名称"]`, "电话")
            || !await fill(`${card} [aria-label="内容"]`, values[index])
            || !await fill(`${card} [aria-label="所属分组"]`, groupId)) throw new Error("真实补充资料表单不可写");
    }
    const expected = await browserSession.evaluate(`(()=>({schemaVersion:1,ownerDocId:${json(first.docId)},items:[...document.querySelectorAll('${section} [data-field-id]')].map(node=>{const id=node.getAttribute('data-field-id');const kind=node.getAttribute('data-field-kind');const label=node.querySelector('input')?.value;if(kind==='group')return{id,kind,label};const parentId=node.querySelector('select')?.value;return{id,kind,label,value:node.querySelector('textarea')?.value,...(parentId?{parentId}:{})}})}))()`);
    const expectedKey = personFieldsKey(expected);
    fields.expected = expected;
    if (!await click("保存补充资料")) throw new Error("真实补充资料保存按钮不可用");
    await waitUntil(deadline, async () => Boolean(await browserSession.evaluate(`document.querySelector('${section}')?.textContent?.includes('补充资料已保存') && [...document.querySelectorAll('${section} button')].some(node=>node.textContent?.trim()==='编辑补充资料')`)), "真实补充资料保存");
    fields.saved = true;
    const saved = await loadPersonFields(first.docId);
    if (!saved.blockId || personFieldsKey(saved.snapshot) !== expectedKey) throw new Error("UI 保存后生产服务未回读同一完整快照");
    fields.blockId = saved.blockId;
    fields.savedServiceState = saved;
    fields.savedUiValues = await browserSession.evaluate(`[...document.querySelectorAll('${section} .lvct-person-fields__value')].map(node=>({label:node.querySelector('dt')?.textContent,value:(node.querySelector('.lvct-person-fields__content')??node.querySelector('dd'))?.textContent}))`);
    if (JSON.stringify(fields.savedUiValues) !== JSON.stringify(values.map(value => ({ label: "电话", value })))) throw new Error("真实UI保存视图丢失同名电话或多行值");
    await waitUntil(deadline, async () => Boolean(await browserSession.evaluate(`(()=>{const detail=document.querySelector('.lvct-detail');if(!detail)return true;if(document.querySelector('.lvct-closeguard'))throw new Error('保存完成后关闭详情仍出现脏稿守卫');const button=detail.closest('.lvct-dialog-panel')?.querySelector('.lvct-dialog-panel__close');if(button&&!button.disabled)button.click();return false})()`)), "真实人物详情关闭");
    fields.detailClosed = true;
    if (!await browserSession.evaluate(`(()=>{const expected=${json(first.name)};const row=document.querySelector('[data-person-item-id="${first.itemId}"]')??[...document.querySelectorAll('[aria-label^="查看 "]')].find(item=>item.getAttribute('aria-label')?.includes(expected))??[...document.querySelectorAll('.lvct-person-card,.lvct-people__row')].find(item=>item.textContent?.includes(expected));if(!row)return false;row.click();return true})()`)) throw new Error("关闭后首人物入口不可定位");
    await waitUntil(deadline, async () => Boolean(await browserSession.evaluate(`document.querySelector('${section}')?.textContent?.includes(${json(groupName)}) && document.querySelectorAll('${section} .lvct-person-fields__value').length===2`)), "真实人物详情重开回读");
    fields.reopenedUiValues = await browserSession.evaluate(`[...document.querySelectorAll('${section} .lvct-person-fields__value')].map(node=>({label:node.querySelector('dt')?.textContent,value:(node.querySelector('.lvct-person-fields__content')??node.querySelector('dd'))?.textContent}))`);
    if (JSON.stringify(fields.reopenedUiValues) !== JSON.stringify(values.map(value => ({ label: "电话", value })))) throw new Error("真实UI重开详情丢失同名电话或多行值");
    await waitUntil(deadline, async () => Boolean(await browserSession.evaluate(`document.querySelector(${json(noteSelector)})?.value===${json(noteText)}`)), "真实个人备注重开全文回读");
    noteEvidence.reopenedUiText = await browserSession.evaluate(`document.querySelector(${json(noteSelector)})?.value`);
    if (await loadPersonNote(first.docId) !== noteText) throw new Error("重开详情后生产服务个人备注全文不一致");
    noteEvidence.detailReopened = true;
    fields.detailReopened = true;
    const reopened = await loadPersonFields(first.docId);
    const rows = await raw();
    const marked = rows.filter(row => row.ial?.includes('custom-lvct-person-fields="1"'));
    if (marked.length !== 1 || marked[0].id !== saved.blockId || marked[0].root_id !== first.docId || marked[0].parent_id !== first.docId
        || reopened.blockId !== saved.blockId || personFieldsKey(reopened.snapshot) !== expectedKey
        || personFieldsKey(parsePersonFieldsBlock({ ...marked[0], format: "1" }, first.docId)) !== expectedKey) throw new Error("重开详情后生产服务/SQL块ID或完整快照不一致");
    const markedNotes = rows.filter(row => row.ial?.includes('custom-lvct-person-note="1"'));
    if (markedNotes.length !== 1 || markedNotes[0].id !== noteBlockId || markedNotes[0].root_id !== first.docId || markedNotes[0].parent_id !== first.docId || parsePersonNoteBlock({ ...markedNotes[0], format: "2" }) !== noteText) throw new Error("重开详情后个人备注SQL原块/全文不一致");
    noteEvidence.reopenedSqlRow = markedNotes[0]; noteEvidence.serviceAndSqlVerified = true;
    for (const original of before.filter(row => row.type !== "d")) {
        const current = rows.find(row => row.id === original.id);
        if (!current || ["id", "root_id", "parent_id", "type", "content", "markdown"].some(key => current[key] !== original[key])) throw new Error("UI 保存改变了人物原有正文");
    }
    fields.reopenedServiceState = reopened;
    fields.sqlRows = rows;
    fields.originalNativeBodiesPreserved = true;
    fields.serviceAndSqlVerified = true;
    const artifactDir = process.env.LVCT_E2E_ARTIFACT_DIR ? path.resolve(process.env.LVCT_E2E_ARTIFACT_DIR) : path.join(workspace, "person-fields-ui-artifacts");
    fs.mkdirSync(artifactDir, { recursive: true });
    for (const [selector, name] of [[".lvct-detail__person-note", "person-note-detail-reopened"], [section, "person-fields-detail-reopened"]]) {
        await browserSession.evaluate(`document.querySelector(${json(selector)})?.scrollIntoView({block:'center'})`);
        const screenshot = await browserSession.call("Page.captureScreenshot", { format: "png" });
        const screenshotPath = path.join(artifactDir, `${name}.png`);
        fs.writeFileSync(screenshotPath, Buffer.from(screenshot.data, "base64"));
        evidence.screenshots.push(screenshotPath);
    }
    if (personFieldsFilterCopy) {
        const outcome = evidence.personFieldsFilterCopy = { actualProductionUi: true, filterSelectedSecondPhone: false, clipboardMatchedFullMultiline: false, domFallbackMatchedFullMultiline: false, fallbackFocusAndSelectionRestored: false, editorRetainedFullSnapshot: false, fullSnapshotSaved: false };
        await browserSession.call("Page.bringToFront");
        const filterSelector = `${section} .lvct-person-fields__filter input[aria-label="筛选补充资料"]`;
        await waitUntil(deadline, async () => Boolean(await browserSession.evaluate(`document.querySelector(${json(filterSelector)})`)), "真实补充资料筛选入口");
        if (!await fill(filterSelector, "仅工作日联系")) throw new Error("真实资料筛选输入框不可写");
        const secondEntry = saved.snapshot.items.filter(item => item.kind === "entry")[1];
        const selectedRow = `${section} .lvct-person-fields__value[data-field-id="${secondEntry.id}"]`;
        await waitUntil(deadline, async () => Boolean(await browserSession.evaluate(`document.querySelectorAll('${section} .lvct-person-fields__value').length===1&&document.querySelector(${json(selectedRow)})`)), "真实筛选第二电话");
        outcome.filterSelectedSecondPhone = true;
        await browserSession.call("Browser.grantPermissions", { origin: new URL(targetURL).origin, permissions: ["clipboardReadWrite", "clipboardSanitizedWrite"] });
        const sentinel = `lvct-fictional-clipboard-${randomUUID()}`;
        // Never read a pre-existing clipboard value: write this run's fictional
        // sentinel first, then expose only exact-equality booleans to Node.
        const sentinelReady = await browserSession.evaluate(`(async()=>{await navigator.clipboard.writeText(${json(sentinel)});return (await navigator.clipboard.readText())===${json(sentinel)}})()`, { userGesture: true });
        if (!sentinelReady) throw new Error("测试profile剪贴板哨兵写入未核实");
        if (!await browserSession.evaluate(`(()=>{const row=document.querySelector(${json(selectedRow)});const button=[...(row?.querySelectorAll('button')??[])].find(node=>(node.getAttribute('aria-label')||'').includes('电话'));if(!button||button.disabled)return false;button.click();return true})()`, { userGesture: true })) throw new Error("真实筛选条目的复制按钮不可用");
        await waitUntil(Math.min(deadline, Date.now() + 5000), async () => {
            outcome.clipboardObservation = await browserSession.evaluate(`(async()=>{const value=await navigator.clipboard.readText();return{exact:value===${json(secondEntry.value)},normalized:value.replace(/\\r\\n?/g,'\\n')===${json(secondEntry.value)},length:value.length,expectedLength:${secondEntry.value.length},hasCarriageReturn:value.includes('\\r'),sentinelUnchanged:value===${json(sentinel)}}})()`);
            return Boolean(outcome.clipboardObservation?.normalized);
        }, "真实复制完整多行内容");
        outcome.clipboardMatchedFullMultiline = true; outcome.copiedExpectedValue = secondEntry.value;
        const fallbackSentinel = `lvct-fictional-fallback-${randomUUID()}`;
        if (!await browserSession.evaluate(`(async()=>{await navigator.clipboard.writeText(${json(fallbackSentinel)});return (await navigator.clipboard.readText())===${json(fallbackSentinel)}})()`, { userGesture: true })) throw new Error("DOM fallback前本轮虚构哨兵未核实");
        const fallback = await browserSession.evaluate(`(async()=>{
            const row=document.querySelector(${json(selectedRow)});
            const button=row?.querySelector('[data-copy-field-id="${secondEntry.id}"]');
            const input=document.querySelector(${json(filterSelector)});
            if(!button||button.disabled||!input)return{available:false};
            const clipboard=navigator.clipboard;
            const ownDescriptor=Object.getOwnPropertyDescriptor(navigator,'clipboard');
            input.focus(); input.setSelectionRange(1,3,'forward');
            let focusRestored=false, selectionRestored=false, copied=false;
            try {
                Object.defineProperty(navigator,'clipboard',{configurable:true,value:undefined});
                if(navigator.clipboard!==undefined)throw new Error('cannot disable clipboard API');
                button.click();
                focusRestored=document.activeElement===input;
                selectionRestored=input.selectionStart===1&&input.selectionEnd===3;
            } finally {
                if(ownDescriptor)Object.defineProperty(navigator,'clipboard',ownDescriptor);
                else delete navigator.clipboard;
            }
            const value=await clipboard.readText();
            copied=value.replace(/\\r\\n?/g,'\\n')===${json(secondEntry.value)};
            return{available:true,copied,exact:value===${json(secondEntry.value)},hasCarriageReturn:value.includes('\\r'),focusRestored,selectionRestored};
        })()`, { userGesture: true });
        outcome.domFallback = fallback;
        outcome.domFallbackMatchedFullMultiline = Boolean(fallback?.copied);
        outcome.fallbackFocusAndSelectionRestored = Boolean(fallback?.focusRestored && fallback?.selectionRestored);
        if (!outcome.domFallbackMatchedFullMultiline || !outcome.fallbackFocusAndSelectionRestored) throw new Error("真实DOM复制fallback全文、焦点或选区未恢复");
        if (!await click("编辑补充资料")) throw new Error("筛选后进入完整编辑器失败");
        await waitUntil(deadline, async () => Number(await browserSession.evaluate(`document.querySelectorAll('${section} [data-field-id]').length`)) === saved.snapshot.items.length, "筛选后完整条目编辑");
        outcome.editorRetainedFullSnapshot = true;
        const fullExpected = structuredClone(saved.snapshot);
        const firstEntry = fullExpected.items.find(item => item.kind === "entry"); firstEntry.value += "\n筛选后完整保存验证";
        if (!await fill(`${section} [data-field-id="${firstEntry.id}"] [aria-label="内容"]`, firstEntry.value) || !await click("保存补充资料")) throw new Error("筛选后完整编辑保存不可用");
        await waitUntil(deadline, async () => Boolean(await browserSession.evaluate(`document.querySelector('${section}')?.textContent?.includes('补充资料已保存')`)), "筛选后完整保存回读");
        const fullSaved = await loadPersonFields(first.docId);
        if (fullSaved.blockId !== saved.blockId || personFieldsKey(fullSaved.snapshot) !== personFieldsKey(fullExpected)) throw new Error("筛选后保存丢失非匹配条目或改变原块身份");
        outcome.fullSnapshotSaved = true; outcome.fullSavedState = fullSaved;
    }
    if (personFieldsMultiWindow) await verifyPersonFieldsMultiPage({ browserSession, request, first, second, deadline, evidence, targetURL, authHeaders, artifactDir, loadPersonFields, personFieldsKey, loadPersonNote, noteText });
    if (personFieldsLifecycle) await verifyPersonFieldsLifecycle({ browserSession, request, first, second, deadline, evidence, artifactDir, loadPersonFields, personFieldsKey, parsePersonFieldsBlock, loadPersonNote, before });
    if (personNoteLegacyRecovery) await verifyLegacyPersonNoteRecovery({ browserSession, request, deadline, evidence, artifactDir, fixture: personNoteLegacyRecovery, loadPersonNote, parsePersonNoteBlock });
}

async function verifyPersonFieldsMultiPage({ browserSession, request, first, second, deadline, evidence, targetURL, authHeaders, artifactDir, loadPersonFields, personFieldsKey, loadPersonNote, noteText }) {
    const outcome = evidence.personFieldsMultiWindow = { actualProductionUi: true, nativeEditorCasVerified: false, conflictDraftPreserved: false, conflictZeroBlockWrites: false, discardRereadRecovered: false, freshBaselineSaveSucceeded: false, sameNamePeopleIsolated: false, secondPageClosed: false };
    if (first.name !== second.name || first.docId === second.docId || first.itemId === second.itemId) throw new Error("双页面夹具必须是同名但身份不同的两个人物");
    const scope = ".lvct-person-fields";
    const click = async (session, label) => session.evaluate(`(()=>{const node=[...document.querySelectorAll('${scope} button')].find(item=>item.textContent?.trim()===${json(label)});if(!node||node.disabled)return false;node.click();return true})()`);
    const fill = async (session, selector, value) => session.evaluate(`(()=>{const node=document.querySelector(${json(selector)});if(!node||node.disabled)return false;const proto=node instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(node,${json(value)});node.dispatchEvent(new Event('input',{bubbles:true}));return node.value===${json(value)}})()`);
    const closeDetail = async (session) => waitUntil(deadline, async () => Boolean(await session.evaluate(`(()=>{const detail=document.querySelector('.lvct-detail');if(!detail)return true;if(document.querySelector('.lvct-closeguard'))throw new Error('已保存详情关闭时出现意外脏稿守卫');const button=detail.closest('.lvct-dialog-panel')?.querySelector('.lvct-dialog-panel__close');if(button&&!button.disabled)button.click();return false})()`)), "双页面人物详情关闭");
    const openPerson = async (session, person) => {
        await waitUntil(deadline, async () => Boolean(await session.evaluate(`document.querySelector('[data-person-item-id="${person.itemId}"]')`)), "按稳定人物身份定位卡片");
        if (!await session.evaluate(`(()=>{const row=document.querySelector('[data-person-item-id="${person.itemId}"]');if(!row)return false;row.click();return true})()`)) throw new Error("稳定人物卡片不可点击");
        await waitUntil(deadline, async () => Boolean(await session.evaluate(`document.querySelector('${scope}') && [...document.querySelectorAll('${scope} button')].some(node=>node.textContent?.trim()==='编辑补充资料'&&!node.disabled)`)), "双页面补充资料就绪");
    };
    const screenshot = async (session, name, focusSelector = scope) => {
        await session.call("Page.bringToFront");
        await waitUntil(deadline, async () => Boolean(await session.evaluate(`document.querySelector(${json(focusSelector)})&&!document.querySelector('${scope}[aria-busy="true"]')`)), "双页面截图状态就绪");
        await session.evaluate(`document.querySelector(${json(focusSelector)})?.scrollIntoView({block:'center'})`);
        await session.evaluate("new Promise(resolve=>setTimeout(resolve,50))");
        const data = await session.call("Page.captureScreenshot", { format: "png" });
        const target = path.join(artifactDir, `${name}.png`); fs.writeFileSync(target, Buffer.from(data.data, "base64")); evidence.screenshots.push(target);
    };
    let secondPage;
    try {
        const initial = await loadPersonFields(first.docId);
        const entry = initial.snapshot.items.find(item => item.kind === "entry");
        if (!initial.blockId || !entry) throw new Error("双页面初始快照缺少稳定块或条目");
        const valueSelector = `${scope} [data-field-id="${entry.id}"] [aria-label="内容"]`;
        await waitUntil(deadline, async () => Boolean(await browserSession.evaluate(`document.querySelector('${scope}')&&[...document.querySelectorAll('${scope} button')].some(node=>node.textContent?.trim()==='编辑补充资料'&&!node.disabled)`)), "甲页初始编辑入口就绪");
        if (!await click(browserSession, "编辑补充资料") || !await fill(browserSession, valueSelector, "甲页未保存草稿")) throw new Error("甲页草稿准备失败");
        secondPage = await openCdpPage(browserSession, targetURL, deadline, authHeaders);
        outcome.secondPageTargetId = secondPage.targetId;
        await waitUntil(deadline, async () => Boolean(await secondPage.evaluate("window.LvContacts?.protocol===2")), "乙页真实插件加载");
        if (!await secondPage.evaluate(`(()=>{const node=[...document.querySelectorAll('[title],[aria-label],button,.b3-tooltips')].find(item=>/小驴人脉|Lv Contacts/.test(item.getAttribute('title')||item.getAttribute('aria-label')||item.textContent||''));if(!node)return false;node.click();return true})()`)) throw new Error("乙页工作台入口不可定位");
        await waitUntil(deadline, async () => Boolean(await secondPage.evaluate("document.querySelector('.lvct-workbench')")), "乙页工作台加载");
        if (!await secondPage.evaluate("(()=>{const node=document.querySelector('[data-navigation-view=people]');if(!node)return false;node.click();return true})()")) throw new Error("乙页联系人导航不可定位");
        await openPerson(secondPage, first);
        if (!await click(secondPage, "编辑补充资料") || !await fill(secondPage, valueSelector, "乙页已保存值")) throw new Error("乙页编辑同一人物失败");
        if (!await click(secondPage, "保存补充资料")) throw new Error("乙页保存按钮不可用");
        await waitUntil(deadline, async () => Boolean(await secondPage.evaluate(`document.querySelector('${scope}')?.textContent?.includes('补充资料已保存')&&document.querySelector('${scope}')?.textContent?.includes('乙页已保存值')`)), "乙页同人物保存");
        const secondSaved = await loadPersonFields(first.docId);
        const secondExpected = structuredClone(initial.snapshot); secondExpected.items.find(item => item.id === entry.id).value = "乙页已保存值";
        if (secondSaved.blockId !== initial.blockId || personFieldsKey(secondSaved.snapshot) !== personFieldsKey(secondExpected)) throw new Error("乙页保存未核实原块完整快照");
        outcome.secondPageSavedState = secondSaved;
        const writesBefore = browserSession.blockWriteRequests.length;
        if (!await click(browserSession, "保存补充资料")) throw new Error("甲页旧基线保存按钮不可用");
        await waitUntil(deadline, async () => Boolean(await browserSession.evaluate(`document.querySelector('${scope} [role="alert"]')?.textContent?.includes('已在其他窗口变化')`)), "甲页旧基线冲突反馈");
        outcome.conflictMessage = await browserSession.evaluate(`document.querySelector('${scope} [role="alert"]')?.textContent`);
        outcome.conflictDraftPreserved = await browserSession.evaluate(`document.querySelector(${json(valueSelector)})?.value==='甲页未保存草稿'`);
        outcome.conflictBlockWriteDelta = browserSession.blockWriteRequests.length - writesBefore;
        outcome.conflictZeroBlockWrites = outcome.conflictBlockWriteDelta === 0;
        if (!outcome.conflictDraftPreserved || !outcome.conflictZeroBlockWrites || personFieldsKey((await loadPersonFields(first.docId)).snapshot) !== personFieldsKey(secondExpected)) throw new Error("甲页冲突覆盖了乙页内容、重复写入或丢失草稿");
        await screenshot(browserSession, "person-fields-stale-baseline-conflict", `${scope} [role="alert"]`);
        if (!await click(browserSession, "重新读取")) throw new Error("冲突后重新读取入口不可用");
        await waitUntil(deadline, async () => Boolean(await browserSession.evaluate("document.querySelector('.lvct-closeguard button[data-choice=discard]')")), "冲突草稿放弃确认");
        if (!await browserSession.evaluate("(()=>{const button=document.querySelector('.lvct-closeguard button[data-choice=discard]');if(!button||button.disabled)return false;button.click();return true})()")) throw new Error("冲突草稿放弃确认不可用");
        await waitUntil(deadline, async () => Boolean(await browserSession.evaluate(`!document.querySelector('${scope} .lvct-person-fields__item')&&document.querySelector('${scope}')?.textContent?.includes('乙页已保存值')`)), "甲页放弃草稿后的新基线");
        outcome.discardRereadRecovered = true;
        if (!await click(browserSession, "编辑补充资料") || !await fill(browserSession, valueSelector, "甲页重读后保存值") || !await click(browserSession, "保存补充资料")) throw new Error("甲页新基线编辑保存失败");
        await waitUntil(deadline, async () => Boolean(await browserSession.evaluate(`document.querySelector('${scope}')?.textContent?.includes('补充资料已保存')&&document.querySelector('${scope}')?.textContent?.includes('甲页重读后保存值')`)), "甲页新基线保存");
        const recovered = await loadPersonFields(first.docId);
        const recoveredExpected = structuredClone(secondExpected); recoveredExpected.items.find(item => item.id === entry.id).value = "甲页重读后保存值";
        if (recovered.blockId !== initial.blockId || personFieldsKey(recovered.snapshot) !== personFieldsKey(recoveredExpected)) throw new Error("甲页恢复保存改变原块或完整快照");
        outcome.freshBaselineSaveSucceeded = true; outcome.recoveredState = recovered;
        await closeDetail(secondPage);
        await openPerson(secondPage, second);
        const emptySecond = await loadPersonFields(second.docId);
        outcome.independentInitialServiceState = emptySecond;
        if (emptySecond.blockId || emptySecond.snapshot.items.length) throw new Error("同名另一人物服务侧错误继承第一人物资料");
        await waitUntil(deadline, async () => Boolean(await secondPage.evaluate(`document.querySelector('${scope}')?.textContent?.includes('还没有补充资料')&&!document.querySelector('${scope}[aria-busy="true"]')`)), "同名另一人物真实空态");
        if (!await click(secondPage, "添加资料条目")) throw new Error("同名另一人物新增资料不可用");
        await waitUntil(deadline, async () => Boolean(await secondPage.evaluate(`document.querySelector('${scope} [data-field-kind="entry"]')`)), "同名另一人物独立草稿");
        if (!await fill(secondPage, `${scope} [aria-label="条目名称"]`, "电话") || !await fill(secondPage, `${scope} [aria-label="内容"]`, "同名人物独立值") || !await click(secondPage, "保存补充资料")) throw new Error("同名另一人物独立保存失败");
        await waitUntil(deadline, async () => Boolean(await secondPage.evaluate(`document.querySelector('${scope}')?.textContent?.includes('补充资料已保存')&&document.querySelector('${scope}')?.textContent?.includes('同名人物独立值')`)), "同名另一人物独立保存回读");
        const independent = await loadPersonFields(second.docId);
        if (!independent.blockId || independent.blockId === initial.blockId || independent.snapshot.ownerDocId !== second.docId || independent.snapshot.items.length !== 1 || independent.snapshot.items[0].value !== "同名人物独立值" || personFieldsKey((await loadPersonFields(first.docId)).snapshot) !== personFieldsKey(recoveredExpected) || await loadPersonNote(first.docId) !== noteText || await loadPersonNote(second.docId) !== "") throw new Error("同名人物资料或备注发生串写");
        outcome.sameNamePeopleIsolated = true; outcome.independentPersonState = independent;
        await screenshot(secondPage, "person-fields-same-name-independent-person");
        await waitUntil(deadline, async () => Boolean(await browserSession.evaluate(`document.querySelector('${scope}')?.textContent?.includes('甲页重读后保存值')&&!document.querySelector('${scope}[aria-busy="true"]')`)), "甲页跨人物变化后仍显示本人物资料");
        await screenshot(browserSession, "person-fields-conflict-recovered");
        await unwrapKernelResult(await request("/api/sqlite/flushTransaction"));
        outcome.finalSqlRows = await unwrapKernelResult(await request("/api/query/sql", { stmt: `SELECT id, root_id, parent_id, content, ial FROM blocks WHERE root_id IN ('${first.docId}','${second.docId}') AND ial LIKE '%custom-lvct-person-fields="1"%' ORDER BY id LIMIT 3` }));
        if (!Array.isArray(outcome.finalSqlRows) || outcome.finalSqlRows.length !== 2 || !outcome.finalSqlRows.some(row => row.id === recovered.blockId && row.root_id === first.docId && row.parent_id === first.docId) || !outcome.finalSqlRows.some(row => row.id === independent.blockId && row.root_id === second.docId && row.parent_id === second.docId)) throw new Error("同名人物最终SQL归属或块唯一性不一致");
        outcome.firstPageBlockWriteRequests = [...browserSession.blockWriteRequests];
        outcome.secondPageBlockWriteRequests = [...secondPage.blockWriteRequests];
    } finally {
        if (secondPage) {
            try {
                const closed = await fetch(`http://127.0.0.1:${browserSession.debugPort}/json/close/${secondPage.targetId}`);
                outcome.secondPageClosed = closed.ok;
            } finally { secondPage.socket.close(); }
        }
    }
}

/** Exercise the remaining exposed lifecycle controls on already saved data. */
async function verifyPersonFieldsLifecycle({ browserSession, request, first, second, deadline, evidence, artifactDir, loadPersonFields, personFieldsKey, parsePersonFieldsBlock, loadPersonNote, before }) {
    const { savePersonNote } = await import("../../src/services/person-note.ts");
    const scope = ".lvct-person-fields";
    const editorCard = (id) => `${scope} .lvct-person-fields__item[data-field-id="${id}"]`;
    const noteSelector = '.lvct-detail__person-note textarea[aria-label="个人备注"]';
    const outcome = evidence.personFieldsLifecycle = { actualProductionUi: true, nativeEditorCasVerified: false, saves: [], repeatedWechatAndEmailSaved: false, reparentedAndUngrouped: false, siblingMoveUpSaved: false, siblingMoveDownSaved: false, deleteCancelZeroWrites: false, entryDeleteSaved: false, groupKeepChildrenSaved: false, groupCascadeDeleteSaved: false, emptyReopenedSameBlock: false, recreatedReopenedSameBlock: false, noteConflictDraftPreserved: false, noteConflictZeroWrites: false, noteRereadKeptDraftAndDisplayedLatest: false, noteRebasedExplicitSaveSucceeded: false, noteClearedAndReopened: false, originalNativeBodiesPreserved: false, otherPersonUnchanged: false };
    const click = async (label, selector = scope) => browserSession.evaluate(`(()=>{const root=document.querySelector(${json(selector)});const node=[...(root?.querySelectorAll('button')??[])].find(item=>item.textContent?.trim()===${json(label)});if(!node||node.disabled)return false;node.click();return true})()`);
    const fill = async (selector, value) => browserSession.evaluate(`(()=>{const node=document.querySelector(${json(selector)});if(!node||node.disabled)return false;const proto=node instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:node instanceof HTMLSelectElement?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(node,${json(value)});node.dispatchEvent(new Event(node instanceof HTMLSelectElement?'change':'input',{bubbles:true}));return node.value===${json(value)}})()`);
    const readDraft = async () => browserSession.evaluate(`(()=>({schemaVersion:1,ownerDocId:${json(first.docId)},items:[...document.querySelectorAll('${scope} .lvct-person-fields__item')].map(node=>{const id=node.getAttribute('data-field-id');const kind=node.getAttribute('data-field-kind');const label=node.querySelector('input')?.value;if(kind==='group')return{id,kind,label};const parentId=node.querySelector('select')?.value;return{id,kind,label,value:node.querySelector('textarea')?.value,...(parentId?{parentId}:{})}})}))()`);
    const initial = await loadPersonFields(first.docId);
    const otherInitial = await loadPersonFields(second.docId);
    const otherNote = await loadPersonNote(second.docId);
    const originalNote = await loadPersonNote(first.docId);
    const originalGroup = initial.snapshot.items.find(item => item.kind === "group");
    const originalPhones = initial.snapshot.items.filter(item => item.kind === "entry");
    if (!initial.blockId || !originalGroup || originalPhones.length !== 2 || !originalNote) throw new Error("生命周期场景须从已存分组、两条电话与非空备注开始");
    let expected = structuredClone(initial.snapshot);
    outcome.initialState = initial;
    const assertDraft = async (label) => {
        const actual = await readDraft();
        if (personFieldsKey(actual) !== personFieldsKey(expected)) throw new Error(`生命周期${label}草稿的确切UUID、顺序、父子关系或内容不一致`);
    };
    const beginEdit = async () => {
        await waitUntil(deadline, async () => Boolean(await browserSession.evaluate(`document.querySelector('${scope}')&&!document.querySelector('${scope}[aria-busy="true"]')&&[...document.querySelectorAll('${scope} button')].some(node=>node.textContent?.trim()==='编辑补充资料'&&!node.disabled)`)), "生命周期已存资料编辑入口");
        if (!await click("编辑补充资料")) throw new Error("生命周期无法再次编辑已存资料");
        await waitUntil(deadline, async () => Number(await browserSession.evaluate(`document.querySelectorAll('${scope} .lvct-person-fields__item').length`)) === expected.items.length, "生命周期完整草稿");
        await assertDraft("进入编辑");
    };
    const save = async (step) => {
        await assertDraft(step);
        if (!await click("保存补充资料")) throw new Error(`生命周期${step}保存按钮不可用`);
        await waitUntil(deadline, async () => Boolean(await browserSession.evaluate(`!document.querySelector('${scope} .lvct-person-fields__item')&&document.querySelector('${scope}')?.textContent?.includes('补充资料已保存')`)), `生命周期${step}保存完成`);
        const state = await loadPersonFields(first.docId);
        if (state.blockId !== initial.blockId || personFieldsKey(state.snapshot) !== personFieldsKey(expected)) throw new Error(`生命周期${step}生产服务完整快照或原块ID不一致`);
        outcome.saves.push({ step, state });
        return state;
    };
    const add = async (kind, label, value, parentId) => {
        const knownIds = expected.items.map(item => item.id);
        if (!await click(kind === "group" ? "添加分组" : "添加资料条目")) throw new Error(`生命周期新增${kind}按钮不可用`);
        let id;
        await waitUntil(deadline, async () => {
            const ids = await browserSession.evaluate(`[...document.querySelectorAll('${scope} .lvct-person-fields__item')].map(node=>node.getAttribute('data-field-id')).filter(id=>!${json(knownIds)}.includes(id))`);
            if (ids.length > 1) throw new Error("生命周期单次新增产生多个身份");
            id = ids[0]; return Boolean(id);
        }, "生命周期新增稳定身份");
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) throw new Error("生命周期新增未形成稳定UUIDv4");
        if (!await fill(`${editorCard(id)} [aria-label="${kind === "group" ? "分组名称" : "条目名称"}"]`, label)) throw new Error("生命周期新增名称不可写");
        if (kind === "entry" && (!await fill(`${editorCard(id)} [aria-label="内容"]`, value) || parentId && !await fill(`${editorCard(id)} [aria-label="所属分组"]`, parentId))) throw new Error("生命周期新增内容或分组不可写");
        expected.items.push({ id, kind, label, ...(kind === "entry" ? { value, ...(parentId ? { parentId } : {}) } : {}) });
        await assertDraft("新增后"); return id;
    };
    const changeParent = async (id, parentId) => {
        if (!await fill(`${editorCard(id)} [aria-label="所属分组"]`, parentId)) throw new Error("生命周期改分组控件不可用");
        const item = expected.items.find(entry => entry.id === id); delete item.parentId; if (parentId) item.parentId = parentId;
        await assertDraft(parentId ? "改分组后" : "解除分组后");
    };
    const moveAdjacent = async (id, siblingId, label) => {
        if (!await click(label, editorCard(id))) throw new Error(`生命周期${label}按钮不可用`);
        const from = expected.items.findIndex(item => item.id === id), to = expected.items.findIndex(item => item.id === siblingId);
        if (from < 0 || to < 0) throw new Error("生命周期排序预期身份不存在");
        [expected.items[from], expected.items[to]] = [expected.items[to], expected.items[from]];
        await assertDraft(`${label}后`);
    };
    const remove = async (id, choice) => {
        const target = expected.items.find(item => item.id === id);
        if (!target) throw new Error("生命周期待删身份不在预期快照中");
        // A cancelled, unchanged draft can return to readonly during the
        // normal roster revision reload. Re-enter it explicitly when needed.
        await waitUntil(deadline, async () => browserSession.evaluate(`(()=>{
            const root=document.querySelector('${scope}');if(!root||root.getAttribute('aria-busy')==='true')return false;
            const card=document.querySelector(${json(editorCard(id))});
            if(card){const button=[...card.querySelectorAll('button')].find(node=>node.textContent?.trim()==='删除');if(!button||button.disabled)return false;button.click();return true;}
            const edit=[...root.querySelectorAll('button')].find(node=>node.textContent?.trim()==='编辑补充资料');if(edit&&!edit.disabled)edit.click();return false;
        })()`), "生命周期已存条目删除入口就绪");
        const confirmSelector = `${editorCard(id)} [aria-label="${target.kind === "group" ? "确认删除分组" : "确认删除资料条目"}"]`;
        await waitUntil(deadline, async () => Boolean(await browserSession.evaluate(`document.querySelector(${json(confirmSelector)})`)), "生命周期删除影响确认");
        if (!await click(choice, confirmSelector)) throw new Error("生命周期删除确认选项不可用");
        const cascade = choice === "连同子条目删除";
        expected.items = expected.items.filter(item => item.id !== id && !(cascade && item.kind === "entry" && item.parentId === id)).map(item => {
            if (item.kind !== "entry" || item.parentId !== id) return item;
            const { parentId, ...unparented } = item; return unparented;
        });
        await assertDraft("删除确认后");
    };
    const reopen = async (label) => {
        await waitUntil(deadline, async () => Boolean(await browserSession.evaluate(`(()=>{const detail=document.querySelector('.lvct-detail');if(!detail)return true;if(document.querySelector('.lvct-closeguard'))throw new Error('生命周期已保存详情关闭仍出现脏稿守卫');const button=detail.closest('.lvct-dialog-panel')?.querySelector('.lvct-dialog-panel__close');if(button&&!button.disabled)button.click();return false})()`)), `生命周期${label}关闭详情`);
        await waitUntil(deadline, async () => Boolean(await browserSession.evaluate(`document.querySelector('[data-person-item-id="${first.itemId}"]')`)), "生命周期原人物稳定入口");
        if (!await browserSession.evaluate(`(()=>{const row=document.querySelector('[data-person-item-id="${first.itemId}"]');if(!row)return false;row.click();return true})()`)) throw new Error("生命周期重开原人物失败");
        await waitUntil(deadline, async () => Boolean(await browserSession.evaluate(`document.querySelector('${scope}')&&!document.querySelector('${scope}[aria-busy="true"]')&&document.querySelector(${json(noteSelector)})&&!document.querySelector(${json(noteSelector)}).disabled`)), `生命周期${label}重开读取`);
        const state = await loadPersonFields(first.docId);
        if (state.blockId !== initial.blockId || personFieldsKey(state.snapshot) !== personFieldsKey(expected)) throw new Error(`生命周期${label}重开后生产快照或块身份不一致`);
        const values = await browserSession.evaluate(`[...document.querySelectorAll('${scope} .lvct-person-fields__value')].map(node=>({id:node.getAttribute('data-field-id'),label:node.querySelector('dt')?.textContent,value:node.querySelector('[data-field-content]')?.textContent}))`);
        const expectedValues = expected.items.filter(item => item.kind === "entry").map(({ id, label, value }) => ({ id, label, value: value || "（空）" })).sort((a, b) => a.id.localeCompare(b.id));
        if (JSON.stringify(values.sort((a, b) => a.id.localeCompare(b.id))) !== JSON.stringify(expectedValues)) throw new Error(`生命周期${label}真实只读UI重开值不一致`);
        return state;
    };
    const screenshot = async (name, selector = scope) => {
        await browserSession.call("Page.bringToFront");
        await browserSession.evaluate(`document.querySelector(${json(selector)})?.scrollIntoView({block:'center'})`);
        await browserSession.evaluate("new Promise(resolve=>setTimeout(resolve,50))");
        const data = await browserSession.call("Page.captureScreenshot", { format: "png" });
        const target = path.join(artifactDir, `${name}.png`); fs.writeFileSync(target, Buffer.from(data.data, "base64")); evidence.screenshots.push(target);
    };

    await browserSession.call("Page.bringToFront");
    await beginEdit();
    const renamedGroup = "生命周期已改名联系方式";
    if (!await fill(`${editorCard(originalGroup.id)} [aria-label="分组名称"]`, renamedGroup)) throw new Error("生命周期分组改名不可写");
    expected.items.find(item => item.id === originalGroup.id).label = renamedGroup;
    const secondGroupId = await add("group", "生命周期工作资料");
    const wechatOne = await add("entry", "微信", "fictional_wechat_work", originalGroup.id);
    const wechatTwo = await add("entry", "微信", "fictional_wechat_home", secondGroupId);
    const emailOne = await add("entry", "邮箱", "same@example.test", originalGroup.id);
    const emailTwo = await add("entry", "邮箱", "same@example.test", secondGroupId);
    outcome.createdIds = { secondGroupId, wechatOne, wechatTwo, emailOne, emailTwo };
    await save("已存分组改名并新增重复微信邮箱"); outcome.repeatedWechatAndEmailSaved = true;

    await beginEdit();
    await changeParent(originalPhones[0].id, secondGroupId);
    await changeParent(originalPhones[1].id, "");
    await moveAdjacent(emailTwo, wechatTwo, "上移");
    await save("改分组解除分组及同级上移"); outcome.reparentedAndUngrouped = true; outcome.siblingMoveUpSaved = true;
    await beginEdit();
    await moveAdjacent(emailTwo, wechatTwo, "下移");
    await save("同级下移"); outcome.siblingMoveDownSaved = true;

    await beginEdit();
    const writesBeforeCancel = browserSession.blockWriteRequests.length;
    if (!await click("删除", editorCard(originalPhones[1].id))) throw new Error("生命周期条目删除取消入口不可用");
    const confirmEntry = `${editorCard(originalPhones[1].id)} [aria-label="确认删除资料条目"]`;
    await waitUntil(deadline, async () => Boolean(await browserSession.evaluate(`document.querySelector(${json(confirmEntry)})`)), "生命周期条目取消确认");
    if (!await click("取消", confirmEntry)) throw new Error("生命周期条目删除取消不可用");
    await waitUntil(deadline, async () => !await browserSession.evaluate(`Boolean(document.querySelector(${json(confirmEntry)}))`), "生命周期删除取消返回草稿");
    await assertDraft("删除取消后");
    const afterCancel = await loadPersonFields(first.docId);
    outcome.deleteCancelWriteDelta = browserSession.blockWriteRequests.length - writesBeforeCancel;
    if (outcome.deleteCancelWriteDelta !== 0 || afterCancel.blockId !== initial.blockId || personFieldsKey(afterCancel.snapshot) !== personFieldsKey(expected)) throw new Error("生命周期取消删除产生写入或修改已存快照");
    outcome.deleteCancelZeroWrites = true;
    await remove(originalPhones[1].id, "确认删除条目");
    await save("确认删除已存电话条目"); outcome.entryDeleteSaved = true;

    await beginEdit();
    await remove(originalGroup.id, "保留子条目（解除分组）");
    await save("删除分组保留微信邮箱子条目"); outcome.groupKeepChildrenSaved = true;
    await beginEdit();
    await remove(secondGroupId, "连同子条目删除");
    await save("删除分组连同电话微信邮箱子条目"); outcome.groupCascadeDeleteSaved = true;
    if (expected.items.length !== 2 || expected.items.some(item => item.parentId) || !expected.items.some(item => item.id === wechatOne) || !expected.items.some(item => item.id === emailOne)) throw new Error("生命周期两类分组删除未只保留预期独立微信邮箱");
    await screenshot("person-fields-lifecycle-after-group-deletions");

    await beginEdit();
    await remove(wechatOne, "确认删除条目");
    await remove(emailOne, "确认删除条目");
    await save("全部清空仍保留原补充资料块");
    outcome.emptyReopenedState = await reopen("全部清空");
    if (!await browserSession.evaluate(`document.querySelector('${scope}')?.textContent?.includes('还没有补充资料')`) || await loadPersonNote(first.docId) !== originalNote) throw new Error("生命周期清空补充资料未显示真实空态或误清备注");
    outcome.emptyReopenedSameBlock = true;
    await screenshot("person-fields-lifecycle-empty-reopened");
    const recreatedId = await add("entry", "电话", "+00 111 099\n清空后重新新增");
    if (initial.snapshot.items.some(item => item.id === recreatedId)) throw new Error("生命周期清空后新增错误复用已删除条目身份");
    await save("清空后重新新增电话");
    outcome.recreatedReopenedState = await reopen("重新新增"); outcome.recreatedReopenedSameBlock = true;

    const noteDraft = "生命周期个人备注本地草稿\n显式保留后重新保存";
    const remoteNote = "生命周期个人备注外部已存值\n由同一生产服务写入";
    await waitUntil(deadline, async () => fill(noteSelector, noteDraft), "生命周期备注冲突草稿");
    if (await savePersonNote(first.docId, remoteNote, originalNote) !== remoteNote) throw new Error("生命周期外部备注生产服务写入未核实");
    const noteWritesBeforeConflict = browserSession.blockWriteRequests.length;
    if (!await click("保存备注", ".lvct-detail__person-note")) throw new Error("生命周期备注旧基线保存入口不可用");
    await waitUntil(deadline, async () => Boolean(await browserSession.evaluate(`document.querySelector('.lvct-detail__person-note [role="alert"]')?.textContent?.includes('已在其他窗口变化')`)), "生命周期备注真实基线冲突");
    outcome.noteConflictMessage = await browserSession.evaluate(`document.querySelector('.lvct-detail__person-note [role="alert"]')?.textContent`);
    outcome.noteConflictDraftPreserved = await browserSession.evaluate(`document.querySelector(${json(noteSelector)})?.value===${json(noteDraft)}`);
    outcome.noteConflictBlockWriteDelta = browserSession.blockWriteRequests.length - noteWritesBeforeConflict;
    outcome.noteConflictZeroWrites = outcome.noteConflictBlockWriteDelta === 0;
    if (!outcome.noteConflictDraftPreserved || !outcome.noteConflictZeroWrites || await loadPersonNote(first.docId) !== remoteNote) throw new Error("生命周期备注冲突未保留草稿、零写入或外部已存值");
    if (!await click("重新读取", ".lvct-detail__person-note")) throw new Error("生命周期备注冲突后常驻重新读取入口不可用");
    const noteConfirm = '.lvct-detail__person-note [aria-label="重新读取个人备注前确认草稿"]';
    await waitUntil(deadline, async () => Boolean(await browserSession.evaluate(`document.querySelector(${json(noteConfirm)})`)), "生命周期备注重读草稿选择");
    if (!await click("保留草稿并读取最新", noteConfirm)) throw new Error("生命周期备注保留草稿重读选项不可用");
    await waitUntil(deadline, async () => Boolean(await browserSession.evaluate(`document.querySelector(${json(noteSelector)})?.value===${json(noteDraft)}&&document.querySelector('.lvct-detail__person-note [aria-label="最新已存个人备注"]')?.textContent===${json(remoteNote)}`)), "生命周期备注保留草稿并展示最新原文");
    if (await loadPersonNote(first.docId) !== remoteNote || browserSession.blockWriteRequests.length !== noteWritesBeforeConflict) throw new Error("生命周期备注重新读取意外写入或替换原文");
    outcome.noteRereadKeptDraftAndDisplayedLatest = true;
    await screenshot("person-note-lifecycle-conflict-reread", ".lvct-detail__person-note");
    if (!await click("保存备注", ".lvct-detail__person-note")) throw new Error("生命周期备注新基线显式保存不可用");
    await waitUntil(deadline, async () => Boolean(await browserSession.evaluate(`document.querySelector('.lvct-detail__person-note')?.textContent?.includes('已保存')&&document.querySelector(${json(noteSelector)})?.value===${json(noteDraft)}`)), "生命周期备注新基线保存");
    if (await loadPersonNote(first.docId) !== noteDraft) throw new Error("生命周期备注重读后显式保存完整值不一致");
    outcome.noteRebasedExplicitSaveSucceeded = true;

    await waitUntil(deadline, async () => fill(noteSelector, ""), "生命周期备注清空输入框");
    if (!await click("保存备注", ".lvct-detail__person-note")) throw new Error("生命周期备注清空保存按钮不可用");
    await waitUntil(deadline, async () => Boolean(await browserSession.evaluate(`document.querySelector('.lvct-detail__person-note')?.textContent?.includes('已保存')&&document.querySelector(${json(noteSelector)})?.value===''`)), "生命周期备注清空已保存");
    if (await loadPersonNote(first.docId) !== "") throw new Error("生命周期备注清空生产服务仍非空");
    await reopen("备注清空");
    if (await browserSession.evaluate(`document.querySelector(${json(noteSelector)})?.value`) !== "" || await loadPersonNote(first.docId) !== "") throw new Error("生命周期备注清空后重开内容复现");
    outcome.noteClearedAndReopened = true;
    await screenshot("person-note-lifecycle-cleared-reopened", ".lvct-detail__person-note");

    await unwrapKernelResult(await request("/api/sqlite/flushTransaction"));
    const rows = await unwrapKernelResult(await request("/api/query/sql", { stmt: `SELECT id, root_id, parent_id, type, content, markdown, ial FROM blocks WHERE root_id='${first.docId}' ORDER BY id LIMIT 129` }));
    if (!Array.isArray(rows) || rows.length >= 129) throw new Error("生命周期最终原文SQL范围不可核实");
    const marked = rows.filter(row => row.ial?.includes('custom-lvct-person-fields="1"'));
    if (marked.length !== 1 || marked[0].id !== initial.blockId || marked[0].root_id !== first.docId || marked[0].parent_id !== first.docId || personFieldsKey(parsePersonFieldsBlock({ ...marked[0], format: "1" }, first.docId)) !== personFieldsKey(expected) || rows.some(row => row.ial?.includes('custom-lvct-person-note="1"'))) throw new Error("生命周期最终SQL补充资料归属/块身份/快照或备注清空不一致");
    for (const original of before.filter(row => row.type !== "d")) {
        const current = rows.find(row => row.id === original.id);
        if (!current || ["id", "root_id", "parent_id", "type", "content", "markdown"].some(key => current[key] !== original[key])) throw new Error("生命周期删除或清空改变人物原有正文");
    }
    outcome.originalNativeBodiesPreserved = true;
    const otherFinal = await loadPersonFields(second.docId);
    if (otherFinal.blockId !== otherInitial.blockId || personFieldsKey(otherFinal.snapshot) !== personFieldsKey(otherInitial.snapshot) || await loadPersonNote(second.docId) !== otherNote) throw new Error("生命周期改变另一人物补充资料或备注");
    outcome.otherPersonUnchanged = true; outcome.finalSqlRows = rows; outcome.finalState = await loadPersonFields(first.docId); outcome.completed = true;
}

/** One explicit recovery of the old multi-paragraph/last-marker shape. */
async function verifyLegacyPersonNoteRecovery({ browserSession, request, deadline, evidence, artifactDir, fixture, loadPersonNote, parsePersonNoteBlock }) {
    const { person, paragraphs, confirmedFullText, markedBlockId, beforeRows } = fixture;
    const scope = ".lvct-detail__person-note";
    const noteSelector = `${scope} textarea[aria-label="个人备注"]`;
    const panelSelector = `${scope} [aria-label="核对旧备注关联"]`;
    const outcome = evidence.personNoteLegacyRecovery = { actualProductionUi: true, fixtureCreatedByRealMarkdownParser: true, nativeEditorCasVerified: false, loadRejectedLegacySplit: false, inspectionReadOnly: false, tailPreviewExact: false, openDocumentControlAvailable: false, documentActuallyOpened: false, explicitDetachSucceeded: false, originalParagraphsPreserved: false, newFullNoteSaved: false, reopenedFullNoteExact: false };
    const click = async (label, selector = scope) => browserSession.evaluate(`(()=>{const root=document.querySelector(${json(selector)});const node=[...(root?.querySelectorAll('button')??[])].find(item=>item.textContent?.trim()===${json(label)});if(!node||node.disabled)return false;node.click();return true})()`);
    const raw = async () => {
        await unwrapKernelResult(await request("/api/sqlite/flushTransaction"));
        const rows = await unwrapKernelResult(await request("/api/query/sql", { stmt: `SELECT id, root_id, parent_id, type, content, markdown, ial FROM blocks WHERE root_id='${person.docId}' ORDER BY id LIMIT 129` }));
        if (!Array.isArray(rows) || rows.length >= 129) throw new Error("旧备注恢复SQL形状或范围无法核实");
        return rows;
    };
    const checkOriginals = (rows) => {
        for (const original of beforeRows.filter(row => row.type !== "d")) {
            const current = rows.find(row => row.id === original.id);
            if (!current || ["id", "root_id", "parent_id", "type", "content", "markdown"].some(key => current[key] !== original[key])) throw new Error("旧备注恢复改变或删除了原段落");
        }
    };
    const close = async () => waitUntil(deadline, async () => Boolean(await browserSession.evaluate(`(()=>{const detail=document.querySelector('.lvct-detail');if(!detail)return true;if(document.querySelector('.lvct-closeguard'))throw new Error('旧备注恢复已保存详情关闭仍出现脏稿守卫');const button=detail.closest('.lvct-dialog-panel')?.querySelector('.lvct-dialog-panel__close');if(button&&!button.disabled)button.click();return false})()`)), "旧备注恢复关闭已保存详情");
    const open = async () => {
        await waitUntil(deadline, async () => Boolean(await browserSession.evaluate(`document.querySelector('[data-person-item-id="${person.itemId}"]')`)), "旧备注第三人物稳定入口");
        if (!await browserSession.evaluate(`(()=>{const row=document.querySelector('[data-person-item-id="${person.itemId}"]');if(!row)return false;row.click();return true})()`)) throw new Error("旧备注恢复人物无法打开");
        await waitUntil(deadline, async () => Boolean(await browserSession.evaluate(`document.querySelector('${scope}')`)), "旧备注真实详情加载");
    };
    const screenshot = async (name) => {
        await browserSession.call("Page.bringToFront");
        await browserSession.evaluate(`document.querySelector('${scope}')?.scrollIntoView({block:'center'})`);
        await browserSession.evaluate("new Promise(resolve=>setTimeout(resolve,50))");
        const data = await browserSession.call("Page.captureScreenshot", { format: "png" });
        const target = path.join(artifactDir, `${name}.png`); fs.writeFileSync(target, Buffer.from(data.data, "base64")); evidence.screenshots.push(target);
    };
    try { await loadPersonNote(person.docId); throw new Error("旧多段备注被错误当作可完整读取"); }
    catch (error) {
        outcome.initialServiceError = String(error?.message ?? error);
        if (!outcome.initialServiceError.includes("格式无法核实")) throw error;
    }
    await close(); await open();
    await waitUntil(deadline, async () => Boolean(await browserSession.evaluate(`document.querySelector('${scope} [role="alert"]')?.textContent?.includes('读取失败')&&[...document.querySelectorAll('${scope} button')].some(node=>node.textContent?.trim()==='核对旧备注'&&!node.disabled)`)), "旧拆块备注读取失败和核对入口");
    outcome.loadRejectedLegacySplit = true;
    const inspectionWrites = browserSession.blockWriteRequests.length;
    if (!await click("核对旧备注")) throw new Error("旧备注核对入口不可用");
    await waitUntil(deadline, async () => Boolean(await browserSession.evaluate(`document.querySelector(${json(panelSelector)})`)), "旧备注真实核对面板");
    outcome.tailPreviewExact = await browserSession.evaluate(`document.querySelector('${scope} [aria-label="旧备注末段原文"]')?.textContent===${json(paragraphs.at(-1))}`);
    outcome.openDocumentControlAvailable = await browserSession.evaluate(`(()=>{const node=[...document.querySelectorAll(${json(`${panelSelector} button`)})].find(node=>node.textContent?.trim()==='打开人物文档核对');return Boolean(node&&!node.disabled)})()`);
    if (!outcome.tailPreviewExact || !outcome.openDocumentControlAvailable) throw new Error("旧备注核对未精确展示末段或缺少可用原文入口");
    const inspected = await raw(); checkOriginals(inspected);
    if (browserSession.blockWriteRequests.length !== inspectionWrites || JSON.stringify(inspected) !== JSON.stringify(beforeRows)) throw new Error("旧备注核对产生写入或改变原块");
    outcome.inspectionReadOnly = true;
    await screenshot("person-note-legacy-split-inspected");
    if (!await click("保留原文并解除旧备注关联", panelSelector)) throw new Error("旧备注显式解除关联按钮不可用");
    await waitUntil(deadline, async () => Boolean(await browserSession.evaluate(`document.querySelector('${scope} .lvct-detail__person-note-legacy-detached')&&document.querySelector(${json(noteSelector)})&&!document.querySelector(${json(noteSelector)}).disabled`)), "旧备注解除关联后的真实重读");
    const detachedRows = await raw(); checkOriginals(detachedRows);
    const oldBlock = detachedRows.find(row => row.id === markedBlockId);
    if (!oldBlock || !oldBlock.ial.includes('custom-lvct-person-note-detached="1"') || detachedRows.some(row => row.ial?.includes('custom-lvct-person-note="')) || await loadPersonNote(person.docId) !== "") throw new Error("旧备注解除关联没有保留归档原块或没有核实空基线");
    outcome.explicitDetachSucceeded = true; outcome.detachedSqlRows = detachedRows;
    // Detach broadcasts the normal people revision; wait for that production
    // reload before entering the explicitly confirmed full text.
    await waitUntil(deadline, async () => browserSession.evaluate(`(()=>{const node=document.querySelector(${json(noteSelector)});if(!node||node.disabled)return false;Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(node,${json(confirmedFullText)});node.dispatchEvent(new Event('input',{bubbles:true}));return node.value===${json(confirmedFullText)}})()`), "旧备注解除后全文输入框就绪");
    await waitUntil(deadline, async () => click("保存备注"), "旧备注解除后确认全文保存入口就绪");
    await waitUntil(deadline, async () => Boolean(await browserSession.evaluate(`document.querySelector('${scope}')?.textContent?.includes('已保存')&&document.querySelector(${json(noteSelector)})?.value===${json(confirmedFullText)}`)), "旧备注完整确认文本保存");
    if (await loadPersonNote(person.docId) !== confirmedFullText) throw new Error("旧备注恢复后生产服务全文不一致");
    const savedRows = await raw(); checkOriginals(savedRows);
    const activeNotes = savedRows.filter(row => row.ial?.includes('custom-lvct-person-note="1"'));
    if (activeNotes.length !== 1 || activeNotes[0].id === markedBlockId || activeNotes[0].root_id !== person.docId || activeNotes[0].parent_id !== person.docId || parsePersonNoteBlock({ ...activeNotes[0], format: "2" }) !== confirmedFullText || !savedRows.find(row => row.id === markedBlockId)?.ial.includes('custom-lvct-person-note-detached="1"')) throw new Error("旧备注恢复完整新备注块或归档旧块SQL不一致");
    outcome.newFullNoteSaved = true; outcome.activeNoteBlockId = activeNotes[0].id;
    await close(); await open();
    await waitUntil(deadline, async () => Boolean(await browserSession.evaluate(`document.querySelector(${json(noteSelector)})?.value===${json(confirmedFullText)}`)), "旧备注恢复后关闭重开完整文本");
    if (await loadPersonNote(person.docId) !== confirmedFullText) throw new Error("旧备注恢复重开后生产服务全文不一致");
    const reopenedRows = await raw(); checkOriginals(reopenedRows);
    const reopenedNotes = reopenedRows.filter(row => row.ial?.includes('custom-lvct-person-note="1"'));
    if (reopenedNotes.length !== 1 || reopenedNotes[0].id !== activeNotes[0].id || parsePersonNoteBlock({ ...reopenedNotes[0], format: "2" }) !== confirmedFullText) throw new Error("旧备注恢复重开后块身份或完整文本不一致");
    outcome.reopenedFullNoteExact = true; outcome.originalParagraphsPreserved = true; outcome.finalSqlRows = reopenedRows; outcome.confirmedFullText = confirmedFullText; outcome.completed = true;
    await screenshot("person-note-legacy-recovered-reopened");
}

/**
 * 在已启动的隔离 SiYuan 内核上验证真实 browser-desktop 前端。
 * 失败也返回 evidence，调用方可把限制写入自己的验收报告；本 helper 不连接用户内核、不调用外部 AI。
 */
export async function verifyRealFrontend({
    workspace,
    storage,
    baseURL,
    request,
    accessAuthCode,
    first,
    second,
    captureSourceDocId,
    captureProjectionDocIds,
    organization,
    settings,
    relationPickerOnly = false,
    personOrganizations,
    personFieldsOnly = false,
    personFieldsMultiWindow = false,
    personFieldsFilterCopy = false,
    personFieldsLifecycle = false,
    personNoteLegacyRecovery,
    deadlineMs = DEFAULT_DEADLINE_MS,
}) {
    const evidence = {
        ok: false,
        isolated: true,
        frontend: FRONTEND,
        workspace,
        plugin: PLUGIN_NAME,
        pluginInstalled: false,
        pluginLoaded: false,
        browserAuthentication: false,
        bridgeLoaded: false,
        bridgeProtocol: null,
        bridgeGetPerson: false,
        replayCreated: false,
        replayStable: false,
        workbenchTopbar: false,
        birthdayEditor: false,
        birthdaySaved: false,
        ledgerEditor: false,
        ledgerCreated: false,
        ledgerSettled: false,
        ledgerReopened: false,
        aliasEditor: false,
        aliasSaved: false,
        aliasRejected: false,
        followUpEditor: false,
        followUpCreated: false,
        followUpCompleted: false,
        followUpKernelVerified: false,
        detailCloseDiagnostic: null,
        organizationView: false,
        organizationNavigationDiagnostic: null,
        organizationRenamed: false,
        organizationMemberEdited: false,
        organizationArchived: false,
        organizationRestored: false,
        organizationReloaded: false,
        captureSourceDocId: captureSourceDocId ?? null,
        captureOpenMode: null,
        captureEditorOpen: false,
        captureContextMenu: false,
        captureCommandPanel: false,
        captureDialog: false,
        captureCandidateCount: 0,
        captureCompleted: false,
        captureUiReadback: null,
        captureUiLimitations: [],
        uiReloaded: false,
        multiWindowStable: false,
        multiWindowInteraction: false,
        organizationCrossWindow: false,
        organizationMemberCrossWindow: false,
        organizationArchiveCrossWindow: false,
        organizationRestoreCrossWindow: false,
        organizationCrossWindowDiagnostics: [],
        captureUiDiagnostic: null,
        captureDialogClosed: false,
        hostReady: false,
        screenshots: [],
        limitations: [],
        failure: null,
        browserUrl: null,
        consoleTail: [],
        fileNetworkEvents: [],
    };
    const deadline = Date.now() + deadlineMs;
    let browserSession;
    let profile;
    try {
        if (!workspace || !storage || !baseURL || typeof request !== "function") throw new Error("真实前端验收参数不完整");
        if (!first?.docId || !first?.itemId || !second?.docId || !second?.itemId) throw new Error("稳定人物 ID 不完整");
        assertWorkspaceTarget(workspace, path.join(workspace, "data"));
        const installed = installIsolatedPlugin(workspace, storage);
        fs.writeFileSync(installed.settingsFile, JSON.stringify(settings, null, 2) + "\n", { encoding: "utf8", flag: "w" });
        evidence.pluginInstalled = true;

        await unwrapKernelResult(await request("/api/setting/setBazaar", { trust: true }));
        await unwrapKernelResult(await request("/api/petal/setPetalEnabled", { packageName: PLUGIN_NAME, enabled: true }));
        const petals = await unwrapKernelResult(await request("/api/petal/loadPetals", { frontend: FRONTEND }));
        if (!Array.isArray(petals) || !petals.some((petal) => petal?.name === PLUGIN_NAME && typeof petal.js === "string" && petal.js.length > 0)) {
            evidence.limitations.push("隔离内核未向 browser-desktop 下发插件包");
            return evidence;
        }
        evidence.pluginLoaded = true;

        profile = fs.mkdtempSync(path.join(os.tmpdir(), "lvct-ui-"));
        browserSession = await connectBrowser(profile, deadline);
        evidence.browserProcess = { pid: browserSession.browser.pid, profile };
        // The isolated kernel uses the modern api.token setting. browser-
        // desktop does not render the legacy /check-auth page for that
        // setting, so install the token at the transport boundary before
        // loading the real frontend. This prevents anonymous requests from
        // tripping the kernel's failed-authentication limiter.
        const authHeaders = accessAuthCode ? { Authorization: `Token ${accessAuthCode}` } : {};
        if (Object.keys(authHeaders).length > 0) {
            await browserSession.call("Network.enable");
            await browserSession.call("Network.setExtraHTTPHeaders", { headers: authHeaders });
        }
        const targetURL = new URL("/stage/build/desktop/", baseURL).href;
        await browserSession.call("Page.navigate", { url: targetURL });
        await waitUntil(deadline, async () => Boolean(await browserSession.evaluate("document.readyState === 'complete'")), "真实 Web desktop 页面");
        evidence.browserUrl = await browserSession.evaluate("location.href");
        if (String(evidence.browserUrl).includes("/check-auth")) {
            if (typeof accessAuthCode !== "string" || accessAuthCode.length === 0) {
                evidence.limitations.push("隔离 Web desktop 要求认证，但隔离工作区未提供认证码");
                return evidence;
            }
            const submitted = await browserSession.evaluate(`(()=>{
                const input = document.querySelector('#authCode');
                const button = [...document.querySelectorAll('button')].find((item) => item.classList.contains('b3-button') && !item.classList.contains('b3-button--white'));
                if (!(input instanceof HTMLInputElement) || !(button instanceof HTMLButtonElement)) return false;
                input.value = ${json(accessAuthCode)};
                input.dispatchEvent(new Event('input', { bubbles: true }));
                const remember = document.querySelector('#rememberMe');
                if (remember instanceof HTMLInputElement) remember.checked = false;
                button.click();
                return true;
            })()`);
            if (!submitted) {
                evidence.limitations.push("隔离 Web desktop 认证页控件不可定位");
                return evidence;
            }
            await waitUntil(deadline, async () => !String(await browserSession.evaluate("location.pathname")).includes("/check-auth"), "隔离 Web desktop 认证");
            evidence.browserAuthentication = true;
            evidence.browserUrl = await browserSession.evaluate("location.href");
        }

        await waitUntil(deadline, async () => Boolean(await browserSession.evaluate("window.LvContacts && window.LvContacts.protocol === 2")), "window.LvContacts 桥");
        evidence.bridgeLoaded = true;
        evidence.bridgeProtocol = await browserSession.evaluate("window.LvContacts.protocol");
        const firstResult = await browserSession.evaluate(`(async()=>{const p=await window.LvContacts.getPerson(${json(first.docId)});return p?{docId:p.docId,itemId:p.itemId,name:p.name}:null})()`);
        evidence.bridgeGetPerson = Boolean(firstResult?.docId === first.docId && firstResult?.itemId === first.itemId);
        if (!evidence.bridgeGetPerson) throw new Error("真实浏览器桥 getPerson 未返回首人物稳定身份");

        const replayRef = `frontend-replay-${randomUUID()}`;
        const replayName = `Frontend Replay ${randomUUID().slice(0, 8)}`;
        const created = await browserSession.evaluate(`window.LvContacts.ensurePerson(${json(replayName)}, { ref: ${json(replayRef)} })`);
        const replay = await browserSession.evaluate(`window.LvContacts.ensurePerson(${json(replayName)}, { ref: ${json(replayRef)} })`);
        evidence.replayCreated = Boolean(created?.created && created.docId && created.itemId
            && created.docId !== first.docId && created.docId !== second.docId);
        evidence.replayStable = Boolean(evidence.replayCreated && replay?.created
            && replay.docId === created.docId && replay.itemId === created.itemId);
        if (!evidence.replayStable) throw new Error("真实浏览器桥 ref 重放未保持独立稳定人物");

        const topbar = await browserSession.evaluate(`(()=>{const nodes=[...document.querySelectorAll('[title], [aria-label], button, .b3-tooltips')];const node=nodes.find(item=>/小驴人脉|Lv Contacts/.test(item.getAttribute('title')||item.getAttribute('aria-label')||item.textContent||''));if(!node)return false;node.click();return true})()`);
        await waitUntil(deadline, async () => Boolean(await browserSession.evaluate("document.querySelector('.lvct-workbench')")), "顶部工作台入口");
        evidence.workbenchTopbar = Boolean(topbar);
        if (!evidence.workbenchTopbar) throw new Error("工作台已出现但未找到顶部栏入口");

        const peopleView = await browserSession.evaluate("(()=>{const node=document.querySelector('[data-navigation-view=people]');if(!node)return false;node.click();return true})()");
        if (!peopleView) throw new Error("工作台联系人导航不存在");
        await waitUntil(deadline, async () => Boolean(await browserSession.evaluate("document.querySelector('.lvct-people')")), "联系人工作台");
        await waitUntil(deadline, async () => Boolean(await browserSession.evaluate("!document.querySelector('.lvct-people [aria-busy=\\\"true\\\"]')")), "联系人列表加载完成");
        const firstRow = await browserSession.evaluate(`(()=>{const expected=${json(first.name)};const candidates=[...document.querySelectorAll('[aria-label^="查看 "]')];const row=document.querySelector('[data-person-item-id="${first.itemId}"]') ?? candidates.find(item=>item.getAttribute('aria-label')?.includes(expected))
            ?? [...document.querySelectorAll('.lvct-person-card, .lvct-people__row')].find(item=>item.textContent?.includes(expected));
            if(!row)return {clicked:false,expected,count:candidates.length,labels:candidates.slice(0,10).map(item=>item.getAttribute('aria-label')),peopleText:document.querySelector('.lvct-people')?.textContent?.slice(0,1000)??''};
            row.click();return {clicked:true,expected,count:candidates.length};})()`);
        if (!firstRow?.clicked) throw new Error(`工作台未找到首人物稳定姓名入口：${JSON.stringify(firstRow)}`);
        await waitUntil(deadline, async () => Boolean(await browserSession.evaluate("document.querySelector('.lvct-detail')")), "人物详情");
        if (relationPickerOnly) {
            await verifyRelationPickerScene({ browserSession, first, second, settings, deadline, evidence, workspace });
            evidence.ok = true;
            return evidence;
        }
        if (personOrganizations) {
            const { verifyPersonOrganizationsScene } = await import("./person-organizations-frontend-scene.mjs");
            await verifyPersonOrganizationsScene({ browserSession, first, organizations: personOrganizations, deadline, evidence, workspace, request, targetURL, settings });
            evidence.ok = true;
            return evidence;
        }
        if (personFieldsOnly) {
            await verifyPersonFieldsScene({ browserSession, request, first, second, deadline, evidence, workspace, targetURL, authHeaders, personFieldsMultiWindow, personFieldsFilterCopy, personFieldsLifecycle, personNoteLegacyRecovery });
            evidence.ok = true;
            return evidence;
        }
        const edit = await browserSession.evaluate("(()=>{const button=document.querySelector('.lvct-detail__header-actions button:first-child');if(!button)return false;button.click();return true})()");
        await waitUntil(deadline, async () => Boolean(await browserSession.evaluate("document.querySelector('.lvct-form input[type=date]')")), "生日编辑控件");
        evidence.birthdayEditor = Boolean(edit);
        if (!evidence.birthdayEditor) throw new Error("生日编辑控件已出现但编辑入口不可定位");
        // The date field mounts before the organization/profile read finishes.
        // Wait for the actual submit control instead of treating its deliberate
        // loading lock as a missing save button. Scope to the outer form actions;
        // nested member editors have their own action rows.
        const birthdayEditorReady = () => browserSession.evaluate("(()=>{const input=document.querySelector('.lvct-form input[type=date]');const form=input?.closest('.lvct-form');const save=form?.querySelector(':scope > .lvct-form__actions > button.b3-button--primary');return Boolean(input&&!input.disabled&&save&&!save.disabled)})()");
        await waitUntil(deadline, birthdayEditorReady, "人物资料加载完成且生日保存可用");
        const birthday = "2026-12-24";
        const birthdayInput = await browserSession.evaluate(`(()=>{const input=document.querySelector('.lvct-form input[type=date]');if(!input)return false;const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(input,${json(birthday)});input.dispatchEvent(new Event('input',{bubbles:true}));return input.value===${json(birthday)}})()`);
        if (!birthdayInput) throw new Error("生日编辑控件无法接受隔离测试日期");
        await waitUntil(deadline, birthdayEditorReady, "生日输入后的保存按钮就绪");
        const save = await browserSession.evaluate("(()=>{const input=document.querySelector('.lvct-form input[type=date]');const button=input?.closest('.lvct-form')?.querySelector(':scope > .lvct-form__actions > button.b3-button--primary');if(!button||button.disabled)return false;button.click();return true})()");
        if (!save) throw new Error("生日编辑保存按钮不可定位");
        await waitUntil(deadline, async () => Boolean(await browserSession.evaluate(`document.querySelector('.lvct-detail')?.textContent?.includes(${json(birthday)})`)), "生日保存回读");
        evidence.birthdaySaved = true;

        const clickButton = async (scopeSelector, matcher) => browserSession.evaluate(`(()=>{
            const root = document.querySelector(${json(scopeSelector)});
            if (!root) return false;
            const button = [...root.querySelectorAll('button')].find((node) => (${matcher.toString()})(node.textContent || ''));
            if (!button || button.disabled) return false;
            button.click();
            return true;
        })()`);
        const setValue = async (selector, value) => {
            const target = selector.trim().startsWith('(') ? selector : `document.querySelector(${json(selector)})`;
            const control = await browserSession.evaluate(`(()=>{
                const input = ${target};
                if (!input || input.disabled) return null;
                input.focus();
                if (typeof input.select === 'function') input.select();
                return { type: input.type || input.tagName.toLowerCase(), value: input.value };
            })()`);
            if (!control) return false;
            if (control.type === 'text' || control.type === 'search' || control.type === 'number') {
                await browserSession.call('Input.insertText', { text: String(value) });
                await browserSession.evaluate(`(()=>{
                    const input = ${target};
                    if (!input) return false;
                    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ${json(value)} }));
                    input.dispatchEvent(new Event('change', { bubbles: true }));
                    return true;
                })()`);
                const inserted = await browserSession.evaluate(`(()=>{const input=${target};return Boolean(input && input.value===${json(value)})})()`);
                if (!inserted) {
                    await browserSession.evaluate(`(()=>{
                        const input = ${target};
                        if (!input) return false;
                        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
                        if (!setter) return false;
                        setter.call(input, ${json(value)});
                        input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ${json(value)} }));
                        input.dispatchEvent(new Event('change', { bubbles: true }));
                        return true;
                    })()`);
                }
            } else {
                await browserSession.evaluate(`(()=>{
                    const input = ${target};
                    const prototype = input instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
                    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
                    if (!setter) return false;
                    setter.call(input, ${json(value)});
                    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ${json(value)} }));
                    input.dispatchEvent(new Event('change', { bubbles: true }));
                    return input.value === ${json(value)};
                })()`);
            }
            await browserSession.evaluate("new Promise((resolve) => setTimeout(resolve, 0))");
            return Boolean(await browserSession.evaluate(`(()=>{const input=${target};return Boolean(input && input.value===${json(value)})})()`));
        };
        const sectionByHeading = (...headings) => `([...document.querySelectorAll('.lvct-detail__section')].find((section) => ${json(headings)}.some((heading) => section.querySelector('h4')?.textContent?.includes(heading))))`;
        const captureScreenshot = async (name) => {
            try {
                const result = await browserSession.call('Page.captureScreenshot', { format: 'png' });
                const artifactDir = process.env.LVCT_E2E_ARTIFACT_DIR
                    ? path.resolve(process.env.LVCT_E2E_ARTIFACT_DIR)
                    : path.resolve(process.cwd(), 'output/playwright');
                const target = path.join(artifactDir, `real-frontend-${name}.png`);
                fs.mkdirSync(path.dirname(target), { recursive: true });
                fs.writeFileSync(target, Buffer.from(result.data, 'base64'));
                evidence.screenshots.push(target);
            } catch (error) {
                evidence.limitations.push(`截图 ${name} 未保存：${error instanceof Error ? error.message : String(error)}`);
            }
        };

        const ledgerSection = sectionByHeading('往来账本', 'Exchange ledger');
        await waitUntil(deadline, async () => Boolean(await browserSession.evaluate(`Boolean(${ledgerSection})`)), "往来账本界面");
        evidence.ledgerEditor = true;
        const ledgerDescription = `Real UI ledger ${randomUUID().slice(0, 8)}`;
        const ledgerDate = '2026-12-26';
        const ledgerDescriptionSet = await setValue(`(() => {
            const section = ${ledgerSection};
            return section?.querySelector('input[type="text"]') ?? null;
        })()`, ledgerDescription);
        const ledgerDateSet = await setValue(`(() => {
            const section = ${ledgerSection};
            return section?.querySelector('input[type="date"]') ?? null;
        })()`, ledgerDate);
        const ledgerAmountSet = await setValue(`(() => {
            const section = ${ledgerSection};
            return section?.querySelector('input[type="number"]') ?? null;
        })()`, '35');
        evidence.ledgerBeforeSubmit = await browserSession.evaluate(`(()=>{
            const section = ${ledgerSection};
            return [...(section?.querySelectorAll('input') ?? [])].map((input) => ({ type: input.type, value: input.value }));
        })()`);
        if (!ledgerDescriptionSet || !ledgerAmountSet || !ledgerDateSet) throw new Error('往来账本表单控件不可写');
        await waitUntil(deadline, async () => Boolean(await browserSession.evaluate(`([...document.querySelectorAll('.lvct-detail button')].some((button) => ((button.textContent || '').includes('记一笔往来') || (button.textContent || '').includes('Record an exchange')) && !button.disabled))`)), "往来账本提交控件可用");
        if (!await clickButton('.lvct-detail', (text) => text.includes('记一笔往来') || text.includes('Record an exchange'))) throw new Error('往来账本保存按钮不可定位');
        await waitUntil(deadline, async () => Boolean(await browserSession.evaluate(`document.querySelector('.lvct-detail')?.textContent?.includes(${json(ledgerDescription)})`)), "往来账本提交后回读");
        evidence.ledgerSubmitState = await browserSession.evaluate(`(()=>{
            const section = ${ledgerSection};
            return {
                text: section?.textContent?.slice(-1600) ?? '',
                inputs: [...(section?.querySelectorAll('input') ?? [])].map((input) => ({ type: input.type, value: input.value, disabled: input.disabled })),
                alerts: [...(section?.querySelectorAll('[role="alert"]') ?? [])].map((node) => node.textContent),
            };
        })()`);
        await waitUntil(deadline, async () => Boolean(await browserSession.evaluate(`document.querySelector('.lvct-detail')?.textContent?.includes(${json(ledgerDescription)})`)), "往来账本保存回读");
        evidence.ledgerCreated = true;
        const ledgerSettled = await browserSession.evaluate(`(()=>{
            const section = ${ledgerSection};
            const row = [...(section?.querySelectorAll('.lvct-detail__timeline-row') ?? [])].find((item) => item.textContent?.includes(${json(ledgerDescription)}));
            const button = [...(row?.querySelectorAll('button') ?? [])].find((item) => item.textContent?.includes('结清'));
            if (!button || button.disabled) return false;
            button.click();
            return true;
        })()`);
        if (!ledgerSettled) throw new Error('往来账本结清按钮不可定位');
        await waitUntil(deadline, async () => Boolean(await browserSession.evaluate(`document.querySelector('.lvct-detail')?.textContent?.includes('已结清')`)), "往来账本结清回读");
        evidence.ledgerSettled = true;
        const ledgerReopened = await browserSession.evaluate(`(()=>{
            const section = ${ledgerSection};
            const row = [...(section?.querySelectorAll('.lvct-detail__timeline-row') ?? [])].find((item) => item.textContent?.includes(${json(ledgerDescription)}));
            const button = [...(row?.querySelectorAll('button') ?? [])].find((item) => item.textContent?.includes('重新打开'));
            if (!button || button.disabled) return false;
            button.click();
            return true;
        })()`);
        if (!ledgerReopened) throw new Error('往来账本重开按钮不可定位');
        await waitUntil(deadline, async () => Boolean(await browserSession.evaluate(`document.querySelector('.lvct-detail')?.textContent?.includes('待处理')`)), "往来账本重开回读");
        evidence.ledgerReopened = true;

        const aliasSection = '.lvct-person-aliases';
        await waitUntil(deadline, async () => Boolean(await browserSession.evaluate(`document.querySelector(${json(aliasSection)})`)), "别名界面");
        evidence.aliasEditor = true;
        const alias = `Real UI alias ${randomUUID().slice(0, 8)}`;
        if (!await setValue(`${aliasSection} input[aria-label="新增别名"], ${aliasSection} input[aria-label="Add alias"]`, alias)) throw new Error('别名输入框不可写');
        if (!await clickButton(aliasSection, (text) => text.trim() === '添加' || text.trim() === 'Add')) throw new Error('别名添加按钮不可定位');
        await waitUntil(deadline, async () => Boolean(await browserSession.evaluate(`document.querySelector(${json(aliasSection)})?.textContent?.includes(${json(alias)})`)), "别名保存回读");
        evidence.aliasSaved = true;
        if (!await setValue(`${aliasSection} input[aria-label="新增别名"], ${aliasSection} input[aria-label="Add alias"]`, '王总')) throw new Error('泛称测试输入框不可写');
        if (!await clickButton(aliasSection, (text) => text.trim() === '添加' || text.trim() === 'Add')) throw new Error('泛称拒绝按钮不可定位');
        await waitUntil(deadline, async () => Boolean(await browserSession.evaluate(`Boolean(document.querySelector(${json(aliasSection)})?.querySelector('[role="alert"]')?.textContent || document.querySelector('.lvct-detail [role="alert"]')?.textContent)`)), "泛称拒绝回读");
        evidence.aliasRejected = true;

        const followUpSection = sectionByHeading('跟进计划', 'Follow-ups');
        await waitUntil(deadline, async () => Boolean(await browserSession.evaluate(`Boolean(${followUpSection}) && ${followUpSection}?.querySelector('input[aria-label="计划日期"], input[aria-label="Plan date"]') && ${followUpSection}?.querySelector('button')`)), "跟进计划界面");
        evidence.followUpEditor = true;
        const followUpTitle = `Real UI followup ${randomUUID().slice(0, 8)}`;
        const followUpTitleSet = await setValue(`(${followUpSection})?.querySelector('input[placeholder*="这次想联系"], input[placeholder*="What do you want"]')`, followUpTitle);
        const followUpDateSet = await setValue(`(${followUpSection})?.querySelector('input[aria-label="计划日期"], input[aria-label="Plan date"]')`, '2026-12-27');
        evidence.followUpBeforeSubmit = await browserSession.evaluate(`(()=>{
            const section = ${followUpSection};
            return {
                inputs: [...(section?.querySelectorAll('input') ?? [])].map((input) => ({ placeholder: input.placeholder, aria: input.getAttribute('aria-label'), value: input.value, disabled: input.disabled })),
                buttons: [...(section?.querySelectorAll('button') ?? [])].map((button) => ({ text: button.textContent?.trim(), disabled: button.disabled })),
            };
        })()`);
        if (!followUpTitleSet || !followUpDateSet) throw new Error(`跟进计划表单控件不可写：标题=${followUpTitleSet}，日期=${followUpDateSet}`);
        if (!await clickButton('.lvct-detail', (text) => text.includes('添加计划') || text.includes('再加一条') || text.includes('Add plan') || text.includes('Add another'))) throw new Error('跟进计划添加按钮不可定位');
        await waitUntil(deadline, async () => Boolean(await browserSession.evaluate(`(${followUpSection})?.textContent?.includes(${json(followUpTitle)})`)), "跟进计划保存回读");
        evidence.followUpCreated = true;
        const followUpCompleted = await browserSession.evaluate(`(()=>{
            const section = ${followUpSection};
            const row = [...(section?.querySelectorAll('.lvct-detail__timeline-row') ?? [])].find((item) => item.textContent?.includes(${json(followUpTitle)}));
            const actions = row?.nextElementSibling?.classList.contains('lvct-detail__followup-actions')
                ? row.nextElementSibling : row?.nextElementSibling?.nextElementSibling;
            const button = [...(actions?.querySelectorAll('button') ?? [])].find((item) => item.textContent?.trim() === '完成' || item.textContent?.trim() === 'Complete');
            if (!button || button.disabled) return false;
            button.click();
            return true;
        })()`);
        if (!followUpCompleted) throw new Error('跟进计划完成按钮不可定位');
        await waitUntil(deadline, async () => Boolean(await browserSession.evaluate(`(${followUpSection})?.textContent?.includes(${json(followUpTitle)}) && (${followUpSection})?.textContent?.includes('已完成')`)), "跟进计划完成回读");
        evidence.followUpCompleted = true;
        const followUpRows = await unwrapKernelResult(await request('/api/query/sql', {
            stmt: `SELECT id, ial, markdown FROM blocks WHERE root_id='${first.docId}' AND type='i' AND subtype='t' AND ial LIKE '%custom-lvct-followup="%'`,
        }));
        evidence.followUpKernelVerified = Array.isArray(followUpRows)
            && followUpRows.some((row) => typeof row?.markdown === 'string' && row.markdown.includes(followUpTitle)
                && typeof row.ial === 'string' && row.ial.includes('custom-lvct-followup'));
        if (!evidence.followUpKernelVerified) throw new Error('跟进计划未在真实内核任务块中核实');

        const orgName = organization?.name;
        if (!orgName) throw new Error('组织验收缺少稳定组织名称');

        // Workbench.selectView() is asynchronous and the person detail dialog
        // remains mounted while its close guards resolve. Close it explicitly
        // before clicking the underlying navigation item so the browser test
        // does not race a modal close with view selection.
        evidence.detailCloseDiagnostic = await browserSession.evaluate(`(()=>{
            const detail = document.querySelector('.lvct-detail');
            return {
                present: Boolean(detail),
                disabledHeaderActions: detail ? [...detail.querySelectorAll('.lvct-detail__header-actions button')].filter((button) => button.disabled).map((button) => button.textContent?.trim()) : [],
                loadingStatuses: detail ? [...detail.querySelectorAll('[role="status"]')].map((node) => node.textContent?.trim()).filter(Boolean) : [],
                closeGuardVisible: Boolean(document.querySelector('.lvct-closeguard')),
            };
        })()`);
        await waitUntil(deadline, async () => Boolean(await browserSession.evaluate(`(()=>{
            const detail = document.querySelector('.lvct-detail');
            if (!detail || detail.querySelector('.lvct-detail__header-actions button:first-child[disabled]')) return false;
            const pending = [...detail.querySelectorAll('[role="status"]')].some((node) => /正在核实本人参照与称谓|正在读取个人备注|正在加载成员|正在读取组织候选/.test(node.textContent || ''));
            return !pending;
        })()`)), "人物详情就绪");
        // A close guard may reject a click while a nested read is still busy.
        // Retry the same explicit close action until it either closes or opens
        // the guard; this keeps the test deterministic without bypassing the
        // product's close policy.
        await waitUntil(deadline, async () => Boolean(await browserSession.evaluate(`(()=>{
            const detail = document.querySelector('.lvct-detail');
            if (!detail || document.querySelector('.lvct-closeguard')) return true;
            const panel = detail.closest('.lvct-dialog-panel');
            const button = panel?.querySelector('.lvct-dialog-panel__close');
            if (!(button instanceof HTMLElement) || (button instanceof HTMLButtonElement && button.disabled)) return false;
            button.click();
            return false;
        })()`)), "人物详情关闭/离开确认");
        const closeGuardVisible = await browserSession.evaluate("Boolean(document.querySelector('.lvct-closeguard'))");
        if (closeGuardVisible) {
            const discarded = await browserSession.evaluate(`(()=>{
                const button = document.querySelector('.lvct-closeguard button[data-choice="discard"]');
                if (!button || button.disabled) return false;
                button.click();
                return true;
            })()`);
            if (!discarded) throw new Error('人物详情离开确认不可定位');
            await waitUntil(deadline, async () => Boolean(await browserSession.evaluate("!document.querySelector('.lvct-detail')")), "人物详情关闭");
        }
        const orgsNavigation = await browserSession.evaluate("(()=>{const node=document.querySelector('[data-navigation-view=orgs]');if(!node)return false;node.click();return true})()");
        if (!orgsNavigation) throw new Error('工作台组织导航不存在');
        evidence.organizationNavigationDiagnostic = await browserSession.evaluate(`(()=>{
            const node = document.querySelector('[data-navigation-view="orgs"]');
            return {
                activeNavigation: document.querySelector('.lvct-workbench__nav-item--active')?.getAttribute('data-navigation-view') || null,
                requestedNavigation: node ? { ariaCurrent: node.getAttribute('aria-current'), disabled: node.disabled === true } : null,
                detailVisible: Boolean(document.querySelector('.lvct-detail')),
                dialogVisible: Boolean(document.querySelector('.lvct-dialog-panel')),
                closeGuardVisible: Boolean(document.querySelector('.lvct-closeguard')),
                organizationViewVisible: Boolean(document.querySelector('.lvct-orgs-view')),
            };
        })()`);
        await waitUntil(deadline, async () => Boolean(await browserSession.evaluate("document.querySelector('.lvct-orgs-view')")), "组织工作台");
        await waitUntil(deadline, async () => Boolean(await browserSession.evaluate(`[...document.querySelectorAll('.lvct-orgs-view__card')].some((card) => card.textContent?.includes(${json(orgName)}))`)), "组织卡片");
        evidence.organizationView = true;
        const openOrg = await browserSession.evaluate(`(()=>{
            const card = [...document.querySelectorAll('.lvct-orgs-view__card')].find((item) => item.textContent?.includes(${json(orgName)}));
            const button = [...(card?.querySelectorAll('button') ?? [])].find((item) => ['管理', 'Manage'].includes(item.textContent?.trim()));
            if (!button || button.disabled) return false;
            button.click();
            return true;
        })()`);
        if (!openOrg) throw new Error('组织管理入口不可定位');
        await waitUntil(deadline, async () => Boolean(await browserSession.evaluate("document.querySelector('.lvct-org-manager')")), "组织管理弹窗");
        await waitUntil(deadline, async () => Boolean(await browserSession.evaluate("[...document.querySelectorAll('.lvct-org-manager__detail button')].some((button) => ['改名', 'Rename'].includes(button.textContent?.trim()) && !button.disabled)")), "组织管理加载完成");
        const renamedOrg = `${orgName} UI${randomUUID().slice(0, 6)}`;
        if (!await clickButton('.lvct-org-manager__detail', (text) => text.trim() === '改名' || text.trim() === 'Rename')) throw new Error('组织改名入口不可定位');
        if (!await setValue('.lvct-org-manager__detail input[aria-label="新组织名称"], .lvct-org-manager__detail input[aria-label="New org name"]', renamedOrg)) throw new Error('组织改名输入框不可写');
        if (!await clickButton('.lvct-org-manager__detail', (text) => text.trim() === '保存名称' || text.trim() === 'Save name')) throw new Error('组织改名保存按钮不可定位');
        await waitUntil(deadline, async () => Boolean(await browserSession.evaluate(`document.querySelector('.lvct-org-manager__detail')?.textContent?.includes(${json(renamedOrg)})`)), "组织改名回读");
        evidence.organizationRenamed = true;
        const memberSelector = `.lvct-org-manager__member[data-person-doc-id="${second.docId}"]`;
        await waitUntil(deadline, async () => Boolean(await browserSession.evaluate(`document.querySelector(${json(memberSelector)})`)), "组织成员界面");
        await waitUntil(deadline, async () => Boolean(await browserSession.evaluate(`(()=>{const member=document.querySelector(${json(memberSelector)});return [...(member?.querySelectorAll('button') ?? [])].some((item)=>['编辑','Edit'].includes(item.textContent?.trim()) && !item.disabled)})()`)), "组织成员编辑入口");
        if (!await browserSession.evaluate(`(()=>{const member=document.querySelector(${json(memberSelector)});const button=[...(member?.querySelectorAll('button') ?? [])].find((item)=>['编辑','Edit'].includes(item.textContent?.trim()) && !item.disabled);if(!button)return false;button.click();return true})()`)) throw new Error('组织成员编辑入口不可定位');
        if (!await setValue(`${memberSelector} input[aria-label="部门"], ${memberSelector} input[aria-label="Department"]`, 'UI部门')
            || !await setValue(`${memberSelector} input[aria-label="职位"], ${memberSelector} input[aria-label="Title"]`, 'UI新对接人')) throw new Error('组织成员编辑表单不可写');
        if (!await clickButton(memberSelector, (text) => text.trim() === '保存' || text.trim() === 'Save')) throw new Error('组织成员编辑保存按钮不可定位');
        await waitUntil(deadline, async () => Boolean(await browserSession.evaluate(`document.querySelector(${json(memberSelector)})?.textContent?.includes('UI新对接人')`)), "组织成员编辑回读");
        evidence.organizationMemberEdited = true;
        await waitUntil(deadline, async () => Boolean(await browserSession.evaluate(`(()=>{
            const detail = document.querySelector('.lvct-org-manager__detail');
            return [...(detail?.querySelectorAll('button') ?? [])].some((item) => ['归档组织', 'Archive org'].includes(item.textContent?.trim()) && !item.disabled);
        })()`)), "组织归档入口");
        if (!await clickButton('.lvct-org-manager__detail', (text) => text.trim() === '归档组织' || text.trim() === 'Archive org')) throw new Error('组织归档入口不可定位');
        await waitUntil(deadline, async () => Boolean(await browserSession.evaluate(`(()=>{
            const detail = document.querySelector('.lvct-org-manager__detail');
            const text = detail?.textContent || '';
            const button = [...(detail?.querySelectorAll('button') ?? [])].find((item) => ['恢复组织', 'Restore org'].includes(item.textContent?.trim()));
            return Boolean((text.includes('已归档') || text.includes('Archived')) && button && !button.disabled);
        })()`)), "组织归档回读");
        evidence.organizationArchived = true;
        if (!await clickButton('.lvct-org-manager__detail', (text) => text.trim() === '恢复组织' || text.trim() === 'Restore org')) throw new Error('组织恢复入口不可定位');
        await waitUntil(deadline, async () => Boolean(await browserSession.evaluate(`(()=>{
            const detail = document.querySelector('.lvct-org-manager__detail');
            const button = [...(detail?.querySelectorAll('button') ?? [])].find((item) => ['归档组织', 'Archive org'].includes(item.textContent?.trim()));
            return Boolean(detail?.textContent?.includes(${json(renamedOrg)}) && button && !button.disabled);
        })()`)), "组织恢复回读");
        evidence.organizationRestored = true;
        if (!await clickButton('.lvct-org-manager', (text) => text.trim() === '关闭' || text.trim() === 'Close')) throw new Error('组织管理关闭按钮不可定位');
        await waitUntil(deadline, async () => Boolean(await browserSession.evaluate(`document.querySelector('.lvct-orgs-view') && [...document.querySelectorAll('.lvct-orgs-view__card')].some((card) => card.textContent?.includes(${json(renamedOrg)}))`)), "组织视图刷新回读");
        evidence.organizationReloaded = true;
        await captureScreenshot('organization');

        await browserSession.call('Page.navigate', { url: targetURL });
        await waitUntil(deadline, async () => Boolean(await browserSession.evaluate("document.readyState === 'complete'")), "真实前端重载页面");
        await waitUntil(deadline, async () => Boolean(await browserSession.evaluate("window.LvContacts && window.LvContacts.protocol === 2")), "重载页面桥");
        await waitUntil(deadline, async () => Boolean(await browserSession.evaluate(`(()=>[...document.querySelectorAll('[title], [aria-label], button, .b3-tooltips')].some((item) => /小驴人脉|Lv Contacts/.test(item.getAttribute('title') || item.getAttribute('aria-label') || item.textContent || '')))()`)), "重载页面插件入口");
        const reloadedTopbar = await browserSession.evaluate(`(()=>{const nodes=[...document.querySelectorAll('[title], [aria-label], button, .b3-tooltips')];const node=nodes.find(item=>/小驴人脉|Lv Contacts/.test(item.getAttribute('title')||item.getAttribute('aria-label')||item.textContent||''));if(!node)return false;node.click();return true})()`);
        if (!reloadedTopbar) throw new Error('重载页面工作台入口不可定位');
        await waitUntil(deadline, async () => Boolean(await browserSession.evaluate("document.querySelector('.lvct-workbench')")), "重载工作台");
        if (!await browserSession.evaluate("(()=>{const node=document.querySelector('[data-navigation-view=people]');if(!node)return false;node.click();return true})()")) throw new Error('重载页面联系人导航不存在');
        await waitUntil(deadline, async () => Boolean(await browserSession.evaluate("document.querySelector('.lvct-people')")), "重载联系人工作台");
        await waitUntil(deadline, async () => Boolean(await browserSession.evaluate("!document.querySelector('.lvct-people [aria-busy=\\\"true\\\"]')")), "重载联系人列表");
        if (!await browserSession.evaluate(`(()=>{const expected=${json(first.name)};const row=[...document.querySelectorAll('[aria-label^="查看 "]')].find((item)=>item.getAttribute('aria-label')?.includes(expected)) ?? [...document.querySelectorAll('.lvct-person-card, .lvct-people__row')].find((item)=>item.textContent?.includes(expected));if(!row)return false;row.click();return true})()`)) throw new Error('重载页面首人物不可定位');
        await waitUntil(deadline, async () => Boolean(await browserSession.evaluate("document.querySelector('.lvct-detail')")), "重载人物详情");
        await waitUntil(deadline, async () => Boolean(await browserSession.evaluate(`document.querySelector('.lvct-detail')?.textContent?.includes(${json(ledgerDescription)}) && document.querySelector('.lvct-detail')?.textContent?.includes(${json(alias)}) && document.querySelector('.lvct-detail')?.textContent?.includes(${json(followUpTitle)})`)), "真实前端持久化回读");
        evidence.uiReloaded = true;
        await captureScreenshot('detail');

        if (captureSourceDocId) {
            const captureDeadline = Math.min(deadline, Date.now() + 30_000);
            // Capture is mounted through svelteDialog in a native host Dialog,
            // unlike the Workbench's LvctDialog panels. Keep every operation
            // scoped to that owned capture root so it cannot target another modal.
            const captureRoot = `([...document.querySelectorAll('.b3-dialog .lvct-dialog-root')].find((root) => root.querySelector('.lvct-capture__steps') || root.closest('.b3-dialog')?.querySelector('.b3-dialog__header')?.textContent?.includes('从笔记捕获人脉')))`;
            const interactionFile = path.join(installed.hostStorage, "interaction-events.json");
            assertWorkspaceTarget(workspace, interactionFile);
            const readCaptureEvents = () => {
                const store = JSON.parse(fs.readFileSync(interactionFile, "utf8"));
                if (!Array.isArray(store?.events)) throw new Error("真实捕获互动存储格式无法核实");
                return store.events.filter((event) => event.source === "diary" && event.externalRef === captureSourceDocId);
            };
            const captureEventsBefore = readCaptureEvents();
            try {
                await waitUntil(captureDeadline, async () => Boolean(await browserSession.evaluate("window.siyuan?.isReady === true")), "真实宿主前端就绪");
                evidence.hostReady = true;
                let captureEntry;
                try {
                    captureEntry = await browserSession.evaluate(`(async()=>{
                        if (typeof window.openFileByURL !== 'function') return { ok: false, reason: '宿主未暴露 openFileByURL' };
                        const errors = [];
                        const onError = (event) => errors.push([
                            event?.error?.message || event?.message || String(event),
                            event?.filename ? event.filename + ':' + (event.lineno ?? 0) + ':' + (event.colno ?? 0) : '',
                            event?.error?.stack || '',
                        ].filter(Boolean).join(' @ '));
                        const onRejection = (event) => errors.push([
                            event?.reason?.message || String(event?.reason || event),
                            event?.reason?.stack || '',
                        ].filter(Boolean).join(' @ '));
                        window.addEventListener('error', onError);
                        window.addEventListener('unhandledrejection', onRejection);
                        try {
                            const result = window.openFileByURL(${json(`siyuan://blocks/${captureSourceDocId}`)});
                            await new Promise((resolve) => setTimeout(resolve, 500));
                            return { ok: result !== false && errors.length === 0, result, reason: errors.join('; ') };
                        } catch (error) {
                            return { ok: false, reason: String(error?.message || error) };
                        } finally {
                            window.removeEventListener('error', onError);
                            window.removeEventListener('unhandledrejection', onRejection);
                        }
                    })()`);
                } catch (error) {
                    captureEntry = { ok: false, reason: error instanceof Error ? error.message : String(error) };
                }
                if (!captureEntry?.ok) {
                    const sourceURL = new URL(targetURL);
                    sourceURL.searchParams.set('id', captureSourceDocId);
                    await browserSession.call('Page.navigate', { url: sourceURL.href });
                    await waitUntil(captureDeadline, async () => Boolean(await browserSession.evaluate("document.readyState === 'complete'")), "捕获来源文档入口");
                    await waitUntil(captureDeadline, async () => Boolean(await browserSession.evaluate("window.siyuan?.isReady === true")), "捕获来源宿主就绪");
                    captureEntry = { ok: true, result: 'page-id', reason: captureEntry?.reason || '' };
                    evidence.captureOpenMode = 'page-id';
                } else {
                    evidence.captureOpenMode = 'openFileByURL';
                }
                if (captureEntry?.ok) {
                    await waitUntil(captureDeadline, async () => Boolean(await browserSession.evaluate(`Boolean(document.querySelector('.protyle[data-node-id="${captureSourceDocId}"], .protyle [data-node-id="${captureSourceDocId}"], .protyle-wysiwyg'))`)), "捕获来源编辑器");
                    evidence.captureEditorOpen = true;
                    const editorPoint = await browserSession.evaluate(`(()=>{
                        const editor = document.querySelector('.protyle[data-node-id="${captureSourceDocId}"] .protyle-wysiwyg, .protyle-wysiwyg');
                        if (!editor) return null;
                        const target = editor.querySelector('[data-node-id], .p, .b3-typography') || editor;
                        const rect = target.getBoundingClientRect();
                        return { x: Math.max(8, rect.left + Math.min(120, Math.max(20, rect.width / 3))), y: Math.max(8, rect.top + Math.min(40, Math.max(20, rect.height / 2))) };
                    })()`);
                    if (editorPoint) {
                        await browserSession.call('Input.dispatchMouseEvent', { type: 'mousePressed', x: editorPoint.x, y: editorPoint.y, button: 'right', clickCount: 1 });
                        await browserSession.call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: editorPoint.x, y: editorPoint.y, button: 'right', clickCount: 1 });
                        await browserSession.evaluate(`(()=>{
                            const target = document.elementFromPoint(${editorPoint.x}, ${editorPoint.y});
                            if (!target) return false;
                            target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, view: window, clientX: ${editorPoint.x}, clientY: ${editorPoint.y}, button: 2, buttons: 2 }));
                            return true;
                        })()`);
                        let clickedCapture = false;
                        const captureLabelPattern = '/捕获本文人员|capture (?:contacts|people) from (?:this )?note/i';
                        try {
                            await waitUntil(Math.min(captureDeadline, Date.now() + 5000), async () => Boolean(await browserSession.evaluate(`([...document.querySelectorAll('.b3-menu__item, [role="menuitem"]')].some((item) => ${captureLabelPattern}.test(item.textContent || '')))`)), "捕获右键菜单");
                            evidence.captureContextMenu = true;
                            clickedCapture = await browserSession.evaluate(`(()=>{
                                const item = [...document.querySelectorAll('.b3-menu__item, [role="menuitem"]')].find((node) => ${captureLabelPattern}.test(node.textContent || ''));
                                if (!item) return false;
                                item.click();
                                return true;
                            })()`);
                        } catch {
                            const openedCommandPanel = await browserSession.evaluate(`(()=>{
                                const button = document.querySelector('[data-topbar-entry="barCommand"]');
                                if (!button) return false;
                                button.click();
                                return true;
                            })()`);
                            if (!openedCommandPanel) throw new Error("捕获右键菜单和命令面板均不可用");
                            await waitUntil(captureDeadline, async () => Boolean(await browserSession.evaluate("document.querySelector('#commands') && document.querySelector('#commands').parentElement")), "捕获命令面板");
                            const commandInput = await browserSession.evaluate(`(()=>{
                                const input = document.querySelector('[aria-label="命令面板"], [aria-label="Command panel"], #commands')?.closest('.b3-dialog')?.querySelector('input') || document.querySelector('.b3-dialog input.b3-text-field, .b3-dialog input');
                                if (!input) return false;
                                input.focus();
                                return true;
                            })()`);
                            if (!commandInput) throw new Error("捕获命令面板输入框不可用");
                            const commandItemSelector = '.b3-list-item, [role="option"], [role="menuitem"]';
                            const commandItemMatches = `(node) => ${captureLabelPattern}.test(node.textContent || '') && (() => { const rect = node.getBoundingClientRect(); return rect.width > 0 && rect.height > 0; })()`;
                            const commandItemVisible = () => browserSession.evaluate(`([...document.querySelectorAll(${json(commandItemSelector)})].some(${commandItemMatches}))`);
                            const searchCommands = async (query) => {
                                const cleared = await browserSession.evaluate(`(()=>{
                                    const marker = document.querySelector('[aria-label="命令面板"], [aria-label="Command panel"], #commands');
                                    const input = marker instanceof HTMLInputElement || marker instanceof HTMLTextAreaElement
                                        ? marker
                                        : marker?.closest('.b3-dialog')?.querySelector('input, textarea') || document.querySelector('.b3-dialog input.b3-text-field, .b3-dialog input, .b3-dialog textarea');
                                    if (!(input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement)) return false;
                                    input.focus();
                                    const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
                                    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
                                    if (!setter) return false;
                                    setter.call(input, '');
                                    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
                                    return input.value === '';
                                })()`);
                                if (!cleared) return false;
                                await browserSession.call('Input.insertText', { text: query });
                                return true;
                            };
                            let commandFound = false;
                            if (await searchCommands('capture')) {
                                try {
                                    await waitUntil(Math.min(captureDeadline, Date.now() + 2000), commandItemVisible, "捕获英文命令项");
                                    commandFound = true;
                                } catch {
                                    commandFound = false;
                                }
                            }
                            if (!commandFound && await searchCommands('捕获本文人员')) {
                                await waitUntil(captureDeadline, commandItemVisible, "捕获命令项");
                                commandFound = true;
                            }
                            if (!commandFound) throw new Error("捕获命令项不可见");
                            clickedCapture = await browserSession.evaluate(`(()=>{
                                const item = [...document.querySelectorAll(${json(commandItemSelector)})].find((node) => ${captureLabelPattern}.test(node.textContent || '') && (() => { const rect = node.getBoundingClientRect(); return rect.width > 0 && rect.height > 0; })());
                                if (!item) return false;
                                item.click();
                                return true;
                            })()`);
                            evidence.captureCommandPanel = clickedCapture;
                        }
                        if (!clickedCapture) throw new Error("真实捕获命令入口不可触发");
                        if (clickedCapture) {
                            await waitUntil(captureDeadline, async () => Boolean(await browserSession.evaluate(`(${captureRoot})?.textContent?.includes('联系人候选') || (${captureRoot})?.textContent?.includes('Contact candidates')`)), "真实捕获弹窗");
                            evidence.captureDialog = true;
                            evidence.captureCandidateCount = await browserSession.evaluate(`(${captureRoot})?.querySelectorAll('.lvct-capture__list input[type="checkbox"]').length ?? 0`);
                            if (evidence.captureCandidateCount !== 2) throw new Error(`真实捕获原生引用候选数未核实为 2（实际 ${evidence.captureCandidateCount}）`);
                            const nextButton = await browserSession.evaluate(`(()=>{const button=[...((${captureRoot})?.querySelectorAll('button') ?? [])].find((button) => /下一步：确认记录|Next: confirm/.test(button.textContent || '') && !button.disabled);if(!button)return false;button.click();return true})()`);
                            if (!nextButton) throw new Error(`真实捕获下一步不可用（候选数 ${evidence.captureCandidateCount}）`);
                            if (nextButton) {
                                await waitUntil(captureDeadline, async () => Boolean(await browserSession.evaluate(`(${captureRoot})?.textContent?.includes('记录互动并建立事项双链') || (${captureRoot})?.textContent?.includes('Record interaction')`)), "真实捕获确认页");
                                if (!await setValue(`(${captureRoot})?.querySelector('.lvct-form__grid input[type="date"]')`, "2026-10-04")
                                    || !await setValue(`(${captureRoot})?.querySelector('.lvct-form__grid input[type="text"]')`, "虚构会议室")) throw new Error("真实捕获日期/地点前置条件不可填写");
                                const submitCapture = await browserSession.evaluate(`(()=>{const button=[...((${captureRoot})?.querySelectorAll('button') ?? [])].find((button) => /记录互动并建立事项双链|Record interaction/.test(button.textContent || '') && !button.disabled);if(!button)return false;button.click();return true})()`);
                                if (!submitCapture) throw new Error("真实捕获提交按钮不可用");
                                if (submitCapture) {
                                    await waitUntil(captureDeadline, async () => Boolean(await browserSession.evaluate(`Boolean((${captureRoot})?.querySelector('.lvct-capture__result-actions'))`)), "真实捕获完成页");
                                    if (await browserSession.evaluate(`[...((${captureRoot})?.querySelectorAll('button') ?? [])].some((button) => /仅重试未完成项|Retry incomplete items only/.test(button.textContent || ''))`)) throw new Error("真实捕获结果仍有未完成项");
                                    const afterEvents = readCaptureEvents();
                                    const unchangedIds = afterEvents.length === captureEventsBefore.length
                                        && afterEvents.every((event) => captureEventsBefore.some((before) => before.id === event.id));
                                    const projections = [];
                                    for (const [kind, docId] of Object.entries(captureProjectionDocIds ?? {})) {
                                        if (!/^\d{14}-[0-9a-z]{7}$/.test(docId)) throw new Error("真实捕获投影文档 ID 不完整");
                                        const marker = kind === "source" ? "custom-lvct-attendees" : `custom-lvct-occasion-${captureSourceDocId}`;
                                        const rows = unwrapKernelResult(await request('/api/query/sql', { stmt: `SELECT id FROM blocks WHERE root_id='${docId}' AND ial LIKE '%${marker}="%'` }));
                                        projections.push({ kind, markerCount: Array.isArray(rows) ? rows.length : null });
                                    }
                                    evidence.captureUiReadback = { beforeInteractions: captureEventsBefore.length, afterInteractions: afterEvents.length,
                                        originalEventIdsPreserved: unchangedIds, projections };
                                    if (afterEvents.length !== 2 || !unchangedIds || projections.length !== 5 || projections.some((entry) => entry.markerCount !== 1)) throw new Error("真实捕获重复提交后的互动/五侧标记回读未收敛");
                                    evidence.captureCompleted = true;
                                }
                            }
                        }
                    }
                } else {
                    evidence.captureUiLimitations.push(captureEntry?.reason || '宿主未打开捕获来源编辑器');
                }
            } catch (error) {
                evidence.captureUiLimitations.push(`真实捕获 UI 未完成：${error instanceof Error ? error.message : String(error)}`);
            } finally {
                // Retain only fixed UI structure and known action states, never
                // source text, candidate names or document content.
                evidence.captureUiDiagnostic = await browserSession.evaluate(`(()=>{const root=${captureRoot};return {rootPresent:Boolean(root),stepsPresent:Boolean(root?.querySelector('.lvct-capture__steps')),resultPresent:Boolean(root?.querySelector('.lvct-capture__result-actions')),analysisFailed:Boolean(root?.textContent?.includes('笔记分析失败')||root?.textContent?.includes('Note analysis failed')),busy:Boolean(root?.querySelector('[aria-busy="true"]')),knownActions:[...(root?.querySelectorAll('button')??[])].filter((button)=>/^(完成|Done|取消|Cancel|关闭|Close|下一步：确认记录|Next: confirm.*|记录互动并建立事项双链|Record interaction.*)$/.test(button.textContent?.trim()||'')).map((button)=>({label:button.textContent?.trim(),disabled:button.disabled})),closeGuardVisible:Boolean(document.querySelector('.lvct-closeguard'))}})()`).catch(() => null);
                try {
                    const cleanupDeadline = Date.now() + 15_000;
                    await waitUntil(cleanupDeadline, async () => Boolean(await browserSession.evaluate(`(()=>{const root=${captureRoot};if(!root)return true;if(root.querySelector('[aria-busy="true"]'))return false;const action=[...root.querySelectorAll('button')].find((button)=>['完成','Done','取消','Cancel','关闭','Close'].includes(button.textContent?.trim())&&!button.disabled);const close=action??root.closest('.b3-dialog')?.querySelector('.b3-dialog__close');if(!(close instanceof HTMLElement))return false;close.click();return !(${captureRoot})||Boolean(document.querySelector('.lvct-closeguard'))})()`)), "捕获弹窗正常关闭");
                    if (await browserSession.evaluate("Boolean(document.querySelector('.lvct-closeguard'))")) {
                        const discarded = await browserSession.evaluate("(()=>{const button=document.querySelector('.lvct-closeguard button[data-choice=\"discard\"]');if(!button||button.disabled)return false;button.click();return true})()");
                        if (!discarded) throw new Error("捕获测试草稿离开确认不可定位");
                    }
                    await waitUntil(cleanupDeadline, async () => Boolean(await browserSession.evaluate(`!(${captureRoot})`)), "捕获弹窗移除");
                    evidence.captureDialogClosed = true;
                } catch (error) {
                    evidence.captureUiLimitations.push(`真实捕获弹窗清理未完成：${error instanceof Error ? error.message : String(error)}`);
                }
            }
        } else {
            evidence.captureUiLimitations.push('未提供隔离捕获来源文档');
        }
        let secondPage;
        // A failed optional capture probe must not consume the budgets of the
        // independent organization probes. Each phase remains bounded.
        let multiWindowDeadline = Date.now() + 30_000;
        const organizationDiagnostic = async (session, phase) => {
            const state = await session.evaluate(`(()=>{const manager=document.querySelector('.lvct-org-manager');return {visibilityState:document.visibilityState,managerPresent:Boolean(manager),memberCount:manager?.querySelectorAll('.lvct-org-manager__member').length??0,memberEditorPresent:Boolean(manager?.querySelector('.lvct-org-manager__member-edit')),renameInputPresent:Boolean(manager?.querySelector('input[aria-label="新组织名称"],input[aria-label="New org name"]')),knownActions:[...(manager?.querySelectorAll('button')??[])].filter((button)=>['编辑','Edit','关闭','Close','改名','Rename','保存名称','Save name','归档组织','Archive org','恢复组织','Restore org'].includes(button.textContent?.trim())).map((button)=>({label:button.textContent?.trim(),disabled:button.disabled})),errorCount:manager?.querySelectorAll('[role="alert"]').length??0,busyCount:manager?.querySelectorAll('[aria-busy="true"]').length??0,closeGuardVisible:Boolean(document.querySelector('.lvct-closeguard')),capturePresent:Boolean(document.querySelector('.b3-dialog .lvct-capture__steps'))}})()`).catch(() => null);
            evidence.organizationCrossWindowDiagnostics.push({ phase, state });
        };
        try {
            secondPage = await openCdpPage(browserSession, evidence.browserUrl, multiWindowDeadline, authHeaders);
            await waitUntil(multiWindowDeadline, async () => Boolean(await secondPage.evaluate("window.LvContacts && window.LvContacts.protocol === 2")), "第二页面桥");
            await waitUntil(multiWindowDeadline, async () => Boolean(await secondPage.evaluate(`(()=>[...document.querySelectorAll('[title], [aria-label], button, .b3-tooltips')].some((item) => /小驴人脉|Lv Contacts/.test(item.getAttribute('title') || item.getAttribute('aria-label') || item.textContent || '')))()`)), "第二页面插件入口");
            if (!await secondPage.evaluate(`(()=>{const nodes=[...document.querySelectorAll('[title], [aria-label], button, .b3-tooltips')];const node=nodes.find(item=>/小驴人脉|Lv Contacts/.test(item.getAttribute('title')||item.getAttribute('aria-label')||item.textContent||''));if(!node)return false;node.click();return true})()`)) throw new Error("第二页面工作台入口不可定位");
            await waitUntil(multiWindowDeadline, async () => Boolean(await secondPage.evaluate("document.querySelector('.lvct-workbench')")), "第二页面工作台");
            if (!await secondPage.evaluate("(()=>{const node=document.querySelector('[data-navigation-view=orgs]');if(!node)return false;node.click();return true})()")) throw new Error("第二页面组织导航不可定位");
            await waitUntil(multiWindowDeadline, async () => Boolean(await secondPage.evaluate("document.querySelector('.lvct-orgs-view')")), "第二页面组织工作台");
            await waitUntil(multiWindowDeadline, async () => Boolean(await secondPage.evaluate(`([...document.querySelectorAll('.lvct-orgs-view__card')].some((card) => card.textContent?.includes(${json(renamedOrg)})))`)), "第二页面组织卡片");
            const crossWindowOrg = `${renamedOrg} MW${randomUUID().slice(0, 6)}`;
            multiWindowDeadline = Date.now() + 30_000;
            try {
                if (await browserSession.evaluate("Boolean(document.querySelector('.lvct-detail'))")) {
                    if (!await browserSession.evaluate("(()=>{const button=document.querySelector('.lvct-dialog-panel__close');if(!button)return false;button.click();return true})()")) throw new Error("跨窗口测试关闭人物详情失败");
                    await waitUntil(multiWindowDeadline, async () => Boolean(await browserSession.evaluate("!document.querySelector('.lvct-detail')")), "跨窗口测试关闭人物详情");
                }
                if (!await browserSession.evaluate("(()=>{const node=document.querySelector('[data-navigation-view=orgs]');if(!node)return false;node.click();return true})()")) throw new Error("跨窗口测试第一页面组织导航不可定位");
                await waitUntil(multiWindowDeadline, async () => Boolean(await browserSession.evaluate("document.querySelector('.lvct-orgs-view')")), "跨窗口测试第一页面组织工作台");
                await waitUntil(multiWindowDeadline, async () => Boolean(await browserSession.evaluate(`([...document.querySelectorAll('.lvct-orgs-view__card')].some((card) => card.textContent?.includes(${json(renamedOrg)})))`)), "跨窗口测试第一页面组织卡片");
                if (!await browserSession.evaluate(`(()=>{const card=[...document.querySelectorAll('.lvct-orgs-view__card')].find((item)=>item.textContent?.includes(${json(renamedOrg)}));const button=[...(card?.querySelectorAll('button') ?? [])].find((item)=>['管理','Manage'].includes(item.textContent?.trim())&&!item.disabled);if(!button)return false;button.click();return true})()`)) throw new Error("跨窗口组织管理入口不可定位");
                await waitUntil(multiWindowDeadline, async () => Boolean(await browserSession.evaluate("document.querySelector('.lvct-org-manager')")), "跨窗口组织管理弹窗");
                await waitUntil(multiWindowDeadline, async () => Boolean(await browserSession.evaluate("[...document.querySelectorAll('.lvct-org-manager__detail button')].some((button) => ['改名', 'Rename'].includes(button.textContent?.trim()) && !button.disabled)")), "跨窗口组织管理加载完成");
                await organizationDiagnostic(browserSession, "rename-first-page-before-write");
                if (!await clickButton('.lvct-org-manager__detail', (text) => text.trim() === '改名' || text.trim() === 'Rename')) throw new Error("跨窗口组织改名入口不可定位");
                if (!await setValue('.lvct-org-manager__detail input[aria-label="新组织名称"], .lvct-org-manager__detail input[aria-label="New org name"]', crossWindowOrg)) throw new Error("跨窗口组织改名输入框不可写");
                if (!await clickButton('.lvct-org-manager__detail', (text) => text.trim() === '保存名称' || text.trim() === 'Save name')) throw new Error("跨窗口组织改名保存按钮不可定位");
                await waitUntil(multiWindowDeadline, async () => Boolean(await browserSession.evaluate(`document.querySelector('.lvct-org-manager__detail')?.textContent?.includes(${json(crossWindowOrg)})`)), "跨窗口组织改名本页回读");
                await waitUntil(multiWindowDeadline, async () => Boolean(await secondPage.evaluate(`([...document.querySelectorAll('.lvct-orgs-view__card')].some((card) => card.textContent?.includes(${json(crossWindowOrg)})))`)), "组织跨窗口刷新");
                evidence.organizationCrossWindow = true;
            } catch (error) {
                await organizationDiagnostic(browserSession, "rename-first-page-failed");
                await organizationDiagnostic(secondPage, "rename-second-page-failed");
                evidence.captureUiLimitations.push(`组织跨窗口刷新仍未核实：${error instanceof Error ? error.message : String(error)}`);
            } finally {
                try {
                    if (await browserSession.evaluate("Boolean(document.querySelector('.lvct-org-manager'))")) {
                        const cleanupDeadline = Date.now() + 15_000;
                        await waitUntil(cleanupDeadline, async () => Boolean(await browserSession.evaluate("[...document.querySelectorAll('.lvct-org-manager__detail button')].some((button) => ['改名', 'Rename'].includes(button.textContent?.trim()) && !button.disabled)")), "跨窗口组织改名完成");
                        if (await browserSession.evaluate(`Boolean(document.querySelector('.lvct-org-manager__detail')?.textContent?.includes(${json(crossWindowOrg)}))`)
                            && await clickButton('.lvct-org-manager__detail', (text) => text.trim() === '改名' || text.trim() === 'Rename')
                            && await setValue('.lvct-org-manager__detail input[aria-label="新组织名称"], .lvct-org-manager__detail input[aria-label="New org name"]', renamedOrg)
                            && await clickButton('.lvct-org-manager__detail', (text) => text.trim() === '保存名称' || text.trim() === 'Save name')) {
                            await waitUntil(cleanupDeadline, async () => Boolean(await browserSession.evaluate(`document.querySelector('.lvct-org-manager__detail')?.textContent?.includes(${json(renamedOrg)}) && [...document.querySelectorAll('.lvct-org-manager__detail button')].some((button) => ['改名', 'Rename'].includes(button.textContent?.trim()) && !button.disabled)`)), "跨窗口组织恢复原名");
                        }
                        if (await browserSession.evaluate("Boolean(document.querySelector('.lvct-org-manager'))")) {
                            if (!await clickButton('.lvct-org-manager__footer', (text) => text.trim() === '关闭' || text.trim() === 'Close')) throw new Error("跨窗口组织改名关闭入口不可定位");
                            await waitUntil(cleanupDeadline, async () => Boolean(await browserSession.evaluate("!document.querySelector('.lvct-org-manager')")), "跨窗口组织改名关闭");
                        }
                    }
                } catch (error) {
                    await organizationDiagnostic(browserSession, "rename-cleanup-failed");
                    evidence.captureUiLimitations.push(`跨窗口测试清理未完成：${error instanceof Error ? error.message : String(error)}`);
                }
            }
            const memberSelector = `.lvct-org-manager__member[data-person-doc-id="${second.docId}"]`;
            const openOrgManager = async (session, label) => {
                if (!await session.evaluate("Boolean(document.querySelector('.lvct-org-manager'))")) {
                    await waitUntil(multiWindowDeadline, async () => Boolean(await session.evaluate(`([...document.querySelectorAll('.lvct-orgs-view__card')].some((card) => card.textContent?.includes(${json(renamedOrg)})))`)), `${label}组织卡片`);
                    await waitUntil(multiWindowDeadline, async () => Boolean(await session.evaluate(`(()=>{const card=[...document.querySelectorAll('.lvct-orgs-view__card')].find((item)=>item.textContent?.includes(${json(renamedOrg)}));return [...(card?.querySelectorAll('button') ?? [])].some((item)=>['管理','Manage'].includes(item.textContent?.trim())&&!item.disabled)})()`)), `${label}组织管理入口`);
                    if (!await session.evaluate(`(()=>{const card=[...document.querySelectorAll('.lvct-orgs-view__card')].find((item)=>item.textContent?.includes(${json(renamedOrg)}));const button=[...(card?.querySelectorAll('button') ?? [])].find((item)=>['管理','Manage'].includes(item.textContent?.trim())&&!item.disabled);if(!button)return false;button.click();return true})()`)) throw new Error(`${label}组织管理入口不可定位`);
                }
                await waitUntil(multiWindowDeadline, async () => Boolean(await session.evaluate("document.querySelector('.lvct-org-manager')")), `${label}组织管理弹窗`);
                await waitUntil(multiWindowDeadline, async () => Boolean(await session.evaluate(`document.querySelector(${json(memberSelector)})`)), `${label}组织成员`);
                await waitUntil(multiWindowDeadline, async () => Boolean(await session.evaluate(`(()=>{const member=document.querySelector(${json(memberSelector)});return [...(member?.querySelectorAll('button') ?? [])].some((item)=>['编辑','Edit'].includes(item.textContent?.trim())&&!item.disabled)})()`)), `${label}组织成员编辑入口`);
            };
            const closeOrgManager = async (session, label) => {
                if (!await session.evaluate("Boolean(document.querySelector('.lvct-org-manager'))")) return;
                const cleanupDeadline = Date.now() + 15_000;
                await waitUntil(cleanupDeadline, async () => Boolean(await session.evaluate("[...document.querySelectorAll('.lvct-org-manager__footer button')].some((button) => ['关闭', 'Close'].includes(button.textContent?.trim()) && !button.disabled)")), `${label}组织管理可关闭`);
                const closed = await session.evaluate(`(()=>{const button=[...document.querySelectorAll('.lvct-org-manager__footer button')].find((item)=>['关闭','Close'].includes(item.textContent?.trim())&&!item.disabled);if(!button)return false;button.click();return true})()`);
                if (!closed) throw new Error(`${label}组织管理关闭按钮不可定位`);
                await waitUntil(cleanupDeadline, async () => Boolean(await session.evaluate("!document.querySelector('.lvct-org-manager')")), `${label}组织管理关闭`);
            };
            multiWindowDeadline = Date.now() + 30_000;
            try {
                try {
                    await openOrgManager(secondPage, "第二页面");
                    await openOrgManager(browserSession, "第一页面");
                    if (!await clickButton(memberSelector, (text) => text.trim() === '编辑' || text.trim() === 'Edit')) throw new Error("跨窗口成员编辑入口不可定位");
                    const crossWindowTitle = `MW成员职位${randomUUID().slice(0, 6)}`;
                    if (!await setValue(`${memberSelector} input[aria-label="职位"], ${memberSelector} input[aria-label="Title"]`, crossWindowTitle)) throw new Error("跨窗口成员职位输入框不可写");
                    if (!await clickButton(memberSelector, (text) => text.trim() === '保存' || text.trim() === 'Save')) throw new Error("跨窗口成员编辑保存按钮不可定位");
                    await waitUntil(multiWindowDeadline, async () => Boolean(await browserSession.evaluate(`document.querySelector(${json(memberSelector)})?.textContent?.includes(${json(crossWindowTitle)})`)), "跨窗口成员本页回读");
                    await waitUntil(multiWindowDeadline, async () => Boolean(await secondPage.evaluate(`document.querySelector(${json(memberSelector)})?.textContent?.includes(${json(crossWindowTitle)})`)), "成员跨窗口刷新");
                    evidence.organizationMemberCrossWindow = true;
                } catch (error) {
                    await organizationDiagnostic(browserSession, "member-first-page-failed");
                    await organizationDiagnostic(secondPage, "member-second-page-failed");
                    evidence.captureUiLimitations.push(`组织成员跨窗口刷新仍未核实：${error instanceof Error ? error.message : String(error)}`);
                } finally {
                    try {
                        const originalTitle = "UI新对接人";
                        if (await browserSession.evaluate(`Boolean(document.querySelector(${json(memberSelector)})?.textContent?.includes('MW成员职位'))`)
                            && await clickButton(memberSelector, (text) => text.trim() === '编辑' || text.trim() === 'Edit')
                            && await setValue(`${memberSelector} input[aria-label="职位"], ${memberSelector} input[aria-label="Title"]`, originalTitle)
                            && await clickButton(memberSelector, (text) => text.trim() === '保存' || text.trim() === 'Save')) {
                            await waitUntil(multiWindowDeadline, async () => Boolean(await browserSession.evaluate(`document.querySelector(${json(memberSelector)})?.textContent?.includes(${json(originalTitle)})`)), "跨窗口成员恢复原职位");
                        }
                        await closeOrgManager(browserSession, "第一页面");
                        await closeOrgManager(secondPage, "第二页面");
                    } catch (error) {
                        await organizationDiagnostic(browserSession, "member-cleanup-failed");
                        evidence.captureUiLimitations.push(`组织成员跨窗口清理未完成：${error instanceof Error ? error.message : String(error)}`);
                    }
                }
            } catch (error) {
                evidence.captureUiLimitations.push(`组织成员跨窗口测试未完成：${error instanceof Error ? error.message : String(error)}`);
            }
            multiWindowDeadline = Date.now() + 30_000;
            try {
                try {
                    await openOrgManager(secondPage, "第二页面");
                    await openOrgManager(browserSession, "第一页面");
                    if (!await clickButton('.lvct-org-manager__detail', (text) => text.trim() === '归档组织' || text.trim() === 'Archive org')) throw new Error("跨窗口组织归档入口不可定位");
                    await waitUntil(multiWindowDeadline, async () => Boolean(await browserSession.evaluate("(document.querySelector('.lvct-org-manager__detail')?.textContent?.includes('已归档') || document.querySelector('.lvct-org-manager__detail')?.textContent?.includes('Archived')) && [...document.querySelectorAll('.lvct-org-manager__detail button')].some((button) => ['恢复组织', 'Restore org'].includes(button.textContent?.trim()) && !button.disabled)")), "跨窗口组织归档本页回读");
                    await waitUntil(multiWindowDeadline, async () => Boolean(await secondPage.evaluate("document.querySelector('.lvct-org-manager__detail')?.textContent?.includes('已归档') || document.querySelector('.lvct-org-manager__detail')?.textContent?.includes('Archived')")), "组织归档跨窗口刷新");
                    evidence.organizationArchiveCrossWindow = true;
                    if (!await clickButton('.lvct-org-manager__detail', (text) => text.trim() === '恢复组织' || text.trim() === 'Restore org')) throw new Error("跨窗口组织恢复入口不可定位");
                    await waitUntil(multiWindowDeadline, async () => Boolean(await browserSession.evaluate("[...document.querySelectorAll('.lvct-org-manager__detail button')].some((button) => ['归档组织', 'Archive org'].includes(button.textContent?.trim()) && !button.disabled)")), "跨窗口组织恢复本页回读");
                    await waitUntil(multiWindowDeadline, async () => Boolean(await secondPage.evaluate("[...document.querySelectorAll('.lvct-org-manager__detail button')].some((button) => ['归档组织', 'Archive org'].includes(button.textContent?.trim()) && !button.disabled)")), "组织恢复跨窗口刷新");
                    evidence.organizationRestoreCrossWindow = true;
                } catch (error) {
                    await organizationDiagnostic(browserSession, "archive-first-page-failed");
                    await organizationDiagnostic(secondPage, "archive-second-page-failed");
                    evidence.captureUiLimitations.push(`组织归档跨窗口刷新仍未核实：${error instanceof Error ? error.message : String(error)}`);
                } finally {
                    try {
                        await closeOrgManager(browserSession, "第一页面");
                        await closeOrgManager(secondPage, "第二页面");
                    } catch (error) {
                        evidence.captureUiLimitations.push(`组织归档跨窗口清理未完成：${error instanceof Error ? error.message : String(error)}`);
                    }
                }
            } catch (error) {
                evidence.captureUiLimitations.push(`组织归档跨窗口测试未完成：${error instanceof Error ? error.message : String(error)}`);
            }
            const replayRef = `multi-window-${randomUUID()}`;
            const replayName = `Multi Window ${randomUUID().slice(0, 8)}`;
            const replayResults = await Promise.all([
                browserSession.evaluate(`window.LvContacts.ensurePerson(${json(replayName)}, { ref: ${json(replayRef)} })`),
                secondPage.evaluate(`window.LvContacts.ensurePerson(${json(replayName)}, { ref: ${json(replayRef)} })`),
            ]);
            evidence.multiWindowStable = Boolean(replayResults.every((result) => result?.created
                && result.docId === replayResults[0]?.docId && result.itemId === replayResults[0]?.itemId));
            if (!evidence.multiWindowStable) throw new Error("真实双页面稳定 ref 未收敛到同一人物");
            const interactionRef = `multi-window-interaction-${randomUUID()}`;
            const interactionMeta = { ref: interactionRef, date: "2026-10-04", note: "隔离多窗口幂等" };
            const interactionResults = await Promise.all([
                browserSession.evaluate(`window.LvContacts.recordInteraction([${json(first.docId)}], ${json(interactionMeta)})`),
                secondPage.evaluate(`window.LvContacts.recordInteraction([${json(first.docId)}], ${json(interactionMeta)})`),
            ]);
            const interactionItems = interactionResults.flatMap((result) => result?.results ?? []);
            evidence.multiWindowInteraction = Boolean(interactionResults.every((result) => result?.complete)
                && interactionResults.reduce((sum, result) => sum + Number(result?.recorded ?? 0), 0) === 1
                && interactionItems.some((item) => item.status === "applied")
                && interactionItems.some((item) => item.status === "skipped"));
            if (!evidence.multiWindowInteraction) throw new Error("真实双页面互动幂等未收敛为一条事实");
        } finally {
            if (secondPage) {
                try { await fetch(`http://127.0.0.1:${browserSession.debugPort}/json/close/${secondPage.targetId}`); } catch { /* 隔离页面可能已关闭 */ }
                secondPage.socket.close();
            }
        }
        evidence.ok = true;
    } catch (error) {
        evidence.failure = error instanceof Error ? error.message : String(error);
        if (browserSession) {
            evidence.visibleState = await browserSession.evaluate("(()=>({people:document.querySelector('.lvct-people')?.textContent?.slice(0,2000),detail:document.querySelector('.lvct-detail')?.textContent?.slice(0,6000),sections:[...document.querySelectorAll('.lvct-detail__section')].map(section=>({heading:section.querySelector('h4')?.textContent,inputs:[...section.querySelectorAll('input,select')].map(input=>({type:input.type,aria:input.getAttribute('aria-label'),placeholder:input.getAttribute('placeholder'),value:input.value,disabled:input.disabled})),buttons:[...section.querySelectorAll('button')].map(button=>({text:button.textContent?.trim(),disabled:button.disabled}))})),forms:[...document.querySelectorAll('.lvct-dialog-panel .lvct-form')].map(form=>({text:form.textContent?.slice(0,1200),dates:[...form.querySelectorAll('input[type=date]')].map(input=>input.value)}))}))()").catch(() => null);
        }
    } finally {
        if (browserSession) {
            evidence.consoleTail = [...browserSession.consoleTail];
            evidence.fileNetworkEvents = [...browserSession.fileNetworkEvents];
            try {
                await stopIsolatedBrowser(browserSession.browser, { requestClose: () => browserSession.call("Browser.close") });
                evidence.browserProcess.exited = browserSession.browser.exitCode !== null || browserSession.browser.signalCode !== null;
            }
            catch (error) { evidence.failure ??= error instanceof Error ? error.message : String(error); }
            browserSession.socket.close();
        }
        if (profile) {
            try { await removeIsolatedBrowserProfile(profile); if (evidence.browserProcess) evidence.browserProcess.profileRemoved = !fs.existsSync(profile); }
            catch (error) { evidence.failure ??= error instanceof Error ? error.message : String(error); }
        }
    }
    return evidence;
}
