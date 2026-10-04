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
    socket.addEventListener("message", ({ data }) => {
        const message = JSON.parse(data);
        if (message.method === "Runtime.consoleAPICalled") {
            consoleTail.push(message.params.args.map((arg) => arg.value ?? arg.description ?? "").join(" "));
            if (consoleTail.length > 30) consoleTail.shift();
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
    await call("Page.enable");
    const evaluate = async (expression) => {
        const result = await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
        if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "真实前端脚本执行失败");
        return result.result?.value;
    };
    return { socket, call, evaluate, consoleTail };
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

async function openCdpPage(browserSession, url, deadline) {
    const response = await fetch(`http://127.0.0.1:${browserSession.debugPort}/json/new?${encodeURIComponent(url)}`, { method: "PUT" });
    if (!response.ok) throw new Error(`第二隔离页面创建失败：HTTP ${response.status}`);
    const target = await response.json();
    const session = await connectCdpTarget(target);
    await session.call("Page.enable");
    await waitUntil(deadline, async () => Boolean(await session.evaluate("document.readyState === 'complete'")), "第二隔离页面");
    return { ...session, targetId: target.id };
}

function json(value) {
    return JSON.stringify(value).replace(/</g, "\\u003c");
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
    organization,
    settings,
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
        organizationView: false,
        organizationRenamed: false,
        organizationMemberEdited: false,
        organizationArchived: false,
        organizationRestored: false,
        organizationReloaded: false,
        captureSourceDocId: captureSourceDocId ?? null,
        captureEditorOpen: false,
        captureContextMenu: false,
        captureDialog: false,
        captureCompleted: false,
        captureUiLimitations: [],
        uiReloaded: false,
        multiWindowStable: false,
        multiWindowInteraction: false,
        organizationCrossWindow: false,
        organizationMemberCrossWindow: false,
        organizationArchiveCrossWindow: false,
        hostReady: false,
        screenshots: [],
        limitations: [],
        failure: null,
        browserUrl: null,
        consoleTail: [],
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
        const firstRow = await browserSession.evaluate(`(()=>{const expected=${json(first.name)};const candidates=[...document.querySelectorAll('[aria-label^="查看 "]')];const row=candidates.find(item=>item.getAttribute('aria-label')?.includes(expected))
            ?? [...document.querySelectorAll('.lvct-person-card, .lvct-people__row')].find(item=>item.textContent?.includes(expected));
            if(!row)return {clicked:false,expected,count:candidates.length,labels:candidates.slice(0,10).map(item=>item.getAttribute('aria-label')),peopleText:document.querySelector('.lvct-people')?.textContent?.slice(0,1000)??''};
            row.click();return {clicked:true,expected,count:candidates.length};})()`);
        if (!firstRow?.clicked) throw new Error(`工作台未找到首人物稳定姓名入口：${JSON.stringify(firstRow)}`);
        await waitUntil(deadline, async () => Boolean(await browserSession.evaluate("document.querySelector('.lvct-detail')")), "人物详情");
        const edit = await browserSession.evaluate("(()=>{const button=document.querySelector('.lvct-detail__header-actions button:first-child');if(!button)return false;button.click();return true})()");
        await waitUntil(deadline, async () => Boolean(await browserSession.evaluate("document.querySelector('.lvct-form input[type=date]')")), "生日编辑控件");
        evidence.birthdayEditor = Boolean(edit);
        if (!evidence.birthdayEditor) throw new Error("生日编辑控件已出现但编辑入口不可定位");
        const birthday = "2026-12-24";
        const birthdayInput = await browserSession.evaluate(`(()=>{const input=document.querySelector('.lvct-form input[type=date]');if(!input)return false;const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(input,${json(birthday)});input.dispatchEvent(new Event('input',{bubbles:true}));return input.value===${json(birthday)}})()`);
        if (!birthdayInput) throw new Error("生日编辑控件无法接受隔离测试日期");
        const save = await browserSession.evaluate("(()=>{const input=document.querySelector('.lvct-form input[type=date]');const button=input?.closest('.lvct-form')?.querySelector('.lvct-form__actions button:last-child');if(!button||button.disabled)return false;button.click();return true})()");
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
        const orgsNavigation = await browserSession.evaluate("(()=>{const node=document.querySelector('[data-navigation-view=orgs]');if(!node)return false;node.click();return true})()");
        if (!orgsNavigation) throw new Error('工作台组织导航不存在');
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
            try {
                await waitUntil(deadline, async () => Boolean(await browserSession.evaluate("window.siyuan?.isReady === true")), "真实宿主前端就绪");
                evidence.hostReady = true;
                const captureEntry = await browserSession.evaluate(`(async()=>{
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
                if (captureEntry?.ok) {
                    await waitUntil(deadline, async () => Boolean(await browserSession.evaluate(`Boolean(document.querySelector('.protyle[data-node-id="${captureSourceDocId}"], .protyle [data-node-id="${captureSourceDocId}"], .protyle-wysiwyg)')`)), "捕获来源编辑器");
                    evidence.captureEditorOpen = true;
                    const editorPoint = await browserSession.evaluate(`(()=>{
                        const editor = document.querySelector('.protyle[data-node-id="${captureSourceDocId}"] .protyle-wysiwyg, .protyle-wysiwyg');
                        if (!editor) return null;
                        const rect = editor.getBoundingClientRect();
                        return { x: Math.max(8, rect.left + Math.min(120, Math.max(20, rect.width / 3))), y: Math.max(8, rect.top + Math.min(80, Math.max(20, rect.height / 3))) };
                    })()`);
                    if (editorPoint) {
                        await browserSession.call('Input.dispatchMouseEvent', { type: 'mousePressed', x: editorPoint.x, y: editorPoint.y, button: 'right', clickCount: 1 });
                        await browserSession.call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: editorPoint.x, y: editorPoint.y, button: 'right', clickCount: 1 });
                        await waitUntil(deadline, async () => Boolean(await browserSession.evaluate(`([...document.querySelectorAll('.b3-menu__item, [role="menuitem"]')].some((item) => /捕获本文人员|Capture contacts from note/.test(item.textContent || '')))`)), "捕获右键菜单");
                        evidence.captureContextMenu = true;
                        const clickedCapture = await browserSession.evaluate(`(()=>{
                            const item = [...document.querySelectorAll('.b3-menu__item, [role="menuitem"]')].find((node) => /捕获本文人员|Capture contacts from note/.test(node.textContent || ''));
                            if (!item) return false;
                            item.click();
                            return true;
                        })()`);
                        if (clickedCapture) {
                            await waitUntil(deadline, async () => Boolean(await browserSession.evaluate("document.querySelector('.lvct-dialog-panel')?.textContent?.includes('联系人候选') || document.querySelector('.lvct-dialog-panel')?.textContent?.includes('Contact candidates')")), "真实捕获弹窗");
                            evidence.captureDialog = true;
                            const nextButton = await browserSession.evaluate(`(()=>[...document.querySelectorAll('.lvct-dialog-panel button')].find((button) => /下一步：确认记录|Next: confirm/.test(button.textContent || '') && !button.disabled))?.click() !== undefined`);
                            if (nextButton) {
                                await waitUntil(deadline, async () => Boolean(await browserSession.evaluate("document.querySelector('.lvct-dialog-panel')?.textContent?.includes('记录互动并建立事项双链') || document.querySelector('.lvct-dialog-panel')?.textContent?.includes('Record interaction')")), "真实捕获确认页");
                                const submitCapture = await browserSession.evaluate(`(()=>[...document.querySelectorAll('.lvct-dialog-panel button')].find((button) => /记录互动并建立事项双链|Record interaction/.test(button.textContent || '') && !button.disabled))?.click() !== undefined`);
                                if (submitCapture) {
                                    await waitUntil(deadline, async () => Boolean(await browserSession.evaluate("document.querySelector('.lvct-dialog-panel')?.textContent?.includes('已记录') || document.querySelector('.lvct-dialog-panel')?.textContent?.includes('Recorded')")), "真实捕获完成页");
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
            }
        } else {
            evidence.captureUiLimitations.push('未提供隔离捕获来源文档');
        }
        let secondPage;
        try {
            secondPage = await openCdpPage(browserSession, evidence.browserUrl, deadline);
            await waitUntil(deadline, async () => Boolean(await secondPage.evaluate("window.LvContacts && window.LvContacts.protocol === 2")), "第二页面桥");
            await waitUntil(deadline, async () => Boolean(await secondPage.evaluate(`(()=>[...document.querySelectorAll('[title], [aria-label], button, .b3-tooltips')].some((item) => /小驴人脉|Lv Contacts/.test(item.getAttribute('title') || item.getAttribute('aria-label') || item.textContent || '')))()`)), "第二页面插件入口");
            if (!await secondPage.evaluate(`(()=>{const nodes=[...document.querySelectorAll('[title], [aria-label], button, .b3-tooltips')];const node=nodes.find(item=>/小驴人脉|Lv Contacts/.test(item.getAttribute('title')||item.getAttribute('aria-label')||item.textContent||''));if(!node)return false;node.click();return true})()`)) throw new Error("第二页面工作台入口不可定位");
            await waitUntil(deadline, async () => Boolean(await secondPage.evaluate("document.querySelector('.lvct-workbench')")), "第二页面工作台");
            if (!await secondPage.evaluate("(()=>{const node=document.querySelector('[data-navigation-view=orgs]');if(!node)return false;node.click();return true})()")) throw new Error("第二页面组织导航不可定位");
            await waitUntil(deadline, async () => Boolean(await secondPage.evaluate("document.querySelector('.lvct-orgs-view')")), "第二页面组织工作台");
            await waitUntil(deadline, async () => Boolean(await secondPage.evaluate(`([...document.querySelectorAll('.lvct-orgs-view__card')].some((card) => card.textContent?.includes(${json(renamedOrg)})))`)), "第二页面组织卡片");
            const crossWindowOrg = `${renamedOrg} MW${randomUUID().slice(0, 6)}`;
            try {
                if (await browserSession.evaluate("Boolean(document.querySelector('.lvct-detail'))")) {
                    if (!await browserSession.evaluate("(()=>{const button=document.querySelector('.lvct-dialog-panel__close');if(!button)return false;button.click();return true})()")) throw new Error("跨窗口测试关闭人物详情失败");
                    await waitUntil(deadline, async () => Boolean(await browserSession.evaluate("!document.querySelector('.lvct-detail')")), "跨窗口测试关闭人物详情");
                }
                if (!await browserSession.evaluate("(()=>{const node=document.querySelector('[data-navigation-view=orgs]');if(!node)return false;node.click();return true})()")) throw new Error("跨窗口测试第一页面组织导航不可定位");
                await waitUntil(deadline, async () => Boolean(await browserSession.evaluate("document.querySelector('.lvct-orgs-view')")), "跨窗口测试第一页面组织工作台");
                await waitUntil(deadline, async () => Boolean(await browserSession.evaluate(`([...document.querySelectorAll('.lvct-orgs-view__card')].some((card) => card.textContent?.includes(${json(renamedOrg)})))`)), "跨窗口测试第一页面组织卡片");
                if (!await browserSession.evaluate(`(()=>{const card=[...document.querySelectorAll('.lvct-orgs-view__card')].find((item)=>item.textContent?.includes(${json(renamedOrg)}));const button=[...(card?.querySelectorAll('button') ?? [])].find((item)=>['管理','Manage'].includes(item.textContent?.trim())&&!item.disabled);if(!button)return false;button.click();return true})()`)) throw new Error("跨窗口组织管理入口不可定位");
                await waitUntil(deadline, async () => Boolean(await browserSession.evaluate("document.querySelector('.lvct-org-manager')")), "跨窗口组织管理弹窗");
                await waitUntil(deadline, async () => Boolean(await browserSession.evaluate("[...document.querySelectorAll('.lvct-org-manager__detail button')].some((button) => ['改名', 'Rename'].includes(button.textContent?.trim()) && !button.disabled)")), "跨窗口组织管理加载完成");
                if (!await clickButton('.lvct-org-manager__detail', (text) => text.trim() === '改名' || text.trim() === 'Rename')) throw new Error("跨窗口组织改名入口不可定位");
                if (!await setValue('.lvct-org-manager__detail input[aria-label="新组织名称"], .lvct-org-manager__detail input[aria-label="New org name"]', crossWindowOrg)) throw new Error("跨窗口组织改名输入框不可写");
                if (!await clickButton('.lvct-org-manager__detail', (text) => text.trim() === '保存名称' || text.trim() === 'Save name')) throw new Error("跨窗口组织改名保存按钮不可定位");
                await waitUntil(deadline, async () => Boolean(await browserSession.evaluate(`document.querySelector('.lvct-org-manager__detail')?.textContent?.includes(${json(crossWindowOrg)})`)), "跨窗口组织改名本页回读");
                await waitUntil(deadline, async () => Boolean(await secondPage.evaluate(`([...document.querySelectorAll('.lvct-orgs-view__card')].some((card) => card.textContent?.includes(${json(crossWindowOrg)})))`)), "组织跨窗口刷新");
                evidence.organizationCrossWindow = true;
            } catch (error) {
                evidence.captureUiLimitations.push(`组织跨窗口刷新仍未核实：${error instanceof Error ? error.message : String(error)}`);
            } finally {
                try {
                    if (await browserSession.evaluate("Boolean(document.querySelector('.lvct-org-manager'))")) {
                        if (await browserSession.evaluate(`Boolean(document.querySelector('.lvct-org-manager__detail')?.textContent?.includes(${json(crossWindowOrg)}))`)
                            && await clickButton('.lvct-org-manager__detail', (text) => text.trim() === '改名' || text.trim() === 'Rename')
                            && await setValue('.lvct-org-manager__detail input[aria-label="新组织名称"], .lvct-org-manager__detail input[aria-label="New org name"]', renamedOrg)
                            && await clickButton('.lvct-org-manager__detail', (text) => text.trim() === '保存名称' || text.trim() === 'Save name')) {
                            await waitUntil(deadline, async () => Boolean(await browserSession.evaluate(`document.querySelector('.lvct-org-manager__detail')?.textContent?.includes(${json(renamedOrg)})`)), "跨窗口组织恢复原名");
                        }
                        if (await browserSession.evaluate("Boolean(document.querySelector('.lvct-org-manager'))")) await clickButton('.lvct-org-manager', (text) => text.trim() === '关闭' || text.trim() === 'Close');
                    }
                } catch (error) {
                    evidence.captureUiLimitations.push(`跨窗口测试清理未完成：${error instanceof Error ? error.message : String(error)}`);
                }
            }
            const memberSelector = `.lvct-org-manager__member[data-person-doc-id="${second.docId}"]`;
            const openOrgManager = async (session, label) => {
                if (!await session.evaluate("Boolean(document.querySelector('.lvct-org-manager'))")) {
                    await waitUntil(deadline, async () => Boolean(await session.evaluate(`([...document.querySelectorAll('.lvct-orgs-view__card')].some((card) => card.textContent?.includes(${json(renamedOrg)})))`)), `${label}组织卡片`);
                    await waitUntil(deadline, async () => Boolean(await session.evaluate(`(()=>{const card=[...document.querySelectorAll('.lvct-orgs-view__card')].find((item)=>item.textContent?.includes(${json(renamedOrg)}));return [...(card?.querySelectorAll('button') ?? [])].some((item)=>['管理','Manage'].includes(item.textContent?.trim())&&!item.disabled)})()`)), `${label}组织管理入口`);
                    if (!await session.evaluate(`(()=>{const card=[...document.querySelectorAll('.lvct-orgs-view__card')].find((item)=>item.textContent?.includes(${json(renamedOrg)}));const button=[...(card?.querySelectorAll('button') ?? [])].find((item)=>['管理','Manage'].includes(item.textContent?.trim())&&!item.disabled);if(!button)return false;button.click();return true})()`)) throw new Error(`${label}组织管理入口不可定位`);
                }
                await waitUntil(deadline, async () => Boolean(await session.evaluate("document.querySelector('.lvct-org-manager')")), `${label}组织管理弹窗`);
                await waitUntil(deadline, async () => Boolean(await session.evaluate(`document.querySelector(${json(memberSelector)})`)), `${label}组织成员`);
                await waitUntil(deadline, async () => Boolean(await session.evaluate(`(()=>{const member=document.querySelector(${json(memberSelector)});return [...(member?.querySelectorAll('button') ?? [])].some((item)=>['编辑','Edit'].includes(item.textContent?.trim())&&!item.disabled)})()`)), `${label}组织成员编辑入口`);
            };
            const closeOrgManager = async (session, label) => {
                if (!await session.evaluate("Boolean(document.querySelector('.lvct-org-manager'))")) return;
                const closed = await session.evaluate(`(()=>{const button=[...document.querySelectorAll('button')].find((item)=>['关闭','Close'].includes(item.textContent?.trim())&&!item.disabled);if(!button)return false;button.click();return true})()`);
                if (!closed) throw new Error(`${label}组织管理关闭按钮不可定位`);
                await waitUntil(deadline, async () => Boolean(await session.evaluate("!document.querySelector('.lvct-org-manager')")), `${label}组织管理关闭`);
            };
            try {
                try {
                    await openOrgManager(secondPage, "第二页面");
                    await openOrgManager(browserSession, "第一页面");
                    if (!await clickButton(memberSelector, (text) => text.trim() === '编辑' || text.trim() === 'Edit')) throw new Error("跨窗口成员编辑入口不可定位");
                    const crossWindowTitle = `MW成员职位${randomUUID().slice(0, 6)}`;
                    if (!await setValue(`${memberSelector} input[aria-label="职位"], ${memberSelector} input[aria-label="Title"]`, crossWindowTitle)) throw new Error("跨窗口成员职位输入框不可写");
                    if (!await clickButton(memberSelector, (text) => text.trim() === '保存' || text.trim() === 'Save')) throw new Error("跨窗口成员编辑保存按钮不可定位");
                    await waitUntil(deadline, async () => Boolean(await browserSession.evaluate(`document.querySelector(${json(memberSelector)})?.textContent?.includes(${json(crossWindowTitle)})`)), "跨窗口成员本页回读");
                    await waitUntil(deadline, async () => Boolean(await secondPage.evaluate(`document.querySelector(${json(memberSelector)})?.textContent?.includes(${json(crossWindowTitle)})`)), "成员跨窗口刷新");
                    evidence.organizationMemberCrossWindow = true;
                } catch (error) {
                    evidence.captureUiLimitations.push(`组织成员跨窗口刷新仍未核实：${error instanceof Error ? error.message : String(error)}`);
                } finally {
                    try {
                        const originalTitle = "UI新对接人";
                        if (await browserSession.evaluate(`Boolean(document.querySelector(${json(memberSelector)})?.textContent?.includes('MW成员职位'))`)
                            && await clickButton(memberSelector, (text) => text.trim() === '编辑' || text.trim() === 'Edit')
                            && await setValue(`${memberSelector} input[aria-label="职位"], ${memberSelector} input[aria-label="Title"]`, originalTitle)
                            && await clickButton(memberSelector, (text) => text.trim() === '保存' || text.trim() === 'Save')) {
                            await waitUntil(deadline, async () => Boolean(await browserSession.evaluate(`document.querySelector(${json(memberSelector)})?.textContent?.includes(${json(originalTitle)})`)), "跨窗口成员恢复原职位");
                        }
                        await closeOrgManager(browserSession, "第一页面");
                        await closeOrgManager(secondPage, "第二页面");
                    } catch (error) {
                        evidence.captureUiLimitations.push(`组织成员跨窗口清理未完成：${error instanceof Error ? error.message : String(error)}`);
                    }
                }
            } catch (error) {
                evidence.captureUiLimitations.push(`组织成员跨窗口测试未完成：${error instanceof Error ? error.message : String(error)}`);
            }
            try {
                try {
                    await openOrgManager(secondPage, "第二页面");
                    await openOrgManager(browserSession, "第一页面");
                    if (!await clickButton('.lvct-org-manager__detail', (text) => text.trim() === '归档组织' || text.trim() === 'Archive org')) throw new Error("跨窗口组织归档入口不可定位");
                    await waitUntil(deadline, async () => Boolean(await browserSession.evaluate("document.querySelector('.lvct-org-manager__detail')?.textContent?.includes('已归档') || document.querySelector('.lvct-org-manager__detail')?.textContent?.includes('Archived')")), "跨窗口组织归档本页回读");
                    await waitUntil(deadline, async () => Boolean(await secondPage.evaluate("document.querySelector('.lvct-org-manager__detail')?.textContent?.includes('已归档') || document.querySelector('.lvct-org-manager__detail')?.textContent?.includes('Archived')")), "组织归档跨窗口刷新");
                    evidence.organizationArchiveCrossWindow = true;
                    if (!await clickButton('.lvct-org-manager__detail', (text) => text.trim() === '恢复组织' || text.trim() === 'Restore org')) throw new Error("跨窗口组织恢复入口不可定位");
                    await waitUntil(deadline, async () => Boolean(await browserSession.evaluate("[...document.querySelectorAll('.lvct-org-manager__detail button')].some((button) => ['归档组织', 'Archive org'].includes(button.textContent?.trim()) && !button.disabled)")), "跨窗口组织恢复本页回读");
                    await waitUntil(deadline, async () => Boolean(await secondPage.evaluate("[...document.querySelectorAll('.lvct-org-manager__detail button')].some((button) => ['归档组织', 'Archive org'].includes(button.textContent?.trim()) && !button.disabled)")), "组织恢复跨窗口刷新");
                } catch (error) {
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
            try { await stopIsolatedBrowser(browserSession.browser, { requestClose: () => browserSession.call("Browser.close") }); }
            catch (error) { evidence.failure ??= error instanceof Error ? error.message : String(error); }
            browserSession.socket.close();
        }
        if (profile) {
            try { await removeIsolatedBrowserProfile(profile); }
            catch (error) { evidence.failure ??= error instanceof Error ? error.message : String(error); }
        }
    }
    return evidence;
}
