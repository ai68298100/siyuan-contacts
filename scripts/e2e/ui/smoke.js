import { mount, unmount, tick } from "svelte";
import Workbench from "../../../src/components/Workbench.svelte";
import PersonDetail from "../../../src/components/people/PersonDetail.svelte";
import RelationGraph from "../../../src/components/graph/RelationGraph.svelte";
import VCardDialog from "../../../src/components/people/VCardDialog.svelte";
import CaptureDialog from "../../../src/components/capture/CaptureDialog.svelte";
import ImportDialog from "../../../src/components/people/ImportDialog.svelte";
import DashboardView from "../../../src/components/dashboard/DashboardView.svelte";
import SettingsView from "../../../src/components/SettingsView.svelte";
import { svelteDialog } from "../../../src/libs/dialog";
import { invalidateRoster } from "../../../src/services/roster";
import { recordInteraction, loadInteractionStore } from "../../../src/data/interactions";
import { initExternalBridge, disposeExternalBridge } from "../../../src/bridge/external-bridge";
import { captureFromDoc } from "../../../src/services/capture";
import { FIELD_SPECS } from "../../../src/domain/fields";
import { DEFAULT_VIEW_PREFERENCES } from "../../../src/domain/preferences";
import { kernel } from "./siyuan-mock.js";
import { handleProtyleEvent } from "../../../src/panels/person-panel";
import "../../../src/index.scss";

const fixture = document.querySelector("#fixture");
const results = [];
const runtimeErrors = [];
const pause = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
window.addEventListener("error", (event) => runtimeErrors.push(event.message));
window.addEventListener("unhandledrejection", (event) => runtimeErrors.push(String(event.reason)));
const assert = (ok, message) => { if (!ok) throw new Error(message); };
async function until(predicate, message) {
    const deadline = Date.now() + 4000;
    while (!predicate()) {
        if (Date.now() > deadline) throw new Error(message);
        await pause(20);
    }
    await tick();
}
function button(label, root = fixture) {
    const found = [...root.querySelectorAll("button")].find((node) => node.textContent.trim() === label);
    assert(found, `未找到按钮：${label}`);
    return found;
}
function input(node, value) {
    node.value = value;
    node.dispatchEvent(new Event("input", { bubbles: true }));
}
const settings = {
    schemaVersion: 1, notebookName: "回归测试", notebookId: "20260927000000-book001",
    hostDocId: "20260927000000-host001", dbBlockId: "20260927000000-block01",
    avId: "20260927000000-view001", initializedAt: "2026-09-27T00:00:00Z",
    fieldMap: Object.fromEntries(FIELD_SPECS.map((field) => [field.key, field.key])),
};
const person = {
    docId: "20260927000000-person1", itemId: "row-1", name: "回归测试甲",
    phone: "", email: "", wechat: "", website: "", birthday: "", isLunar: false,
    group: "朋友", tags: [], relatedItemIds: [],
};
const emptyInsights = () => ({ timeline: [], coAttendance: [], totalEvents: 0 });
const renderResult = () => ({ view: {
    columns: FIELD_SPECS.map((field) => ({ id: field.key, name: field.nameZh, type: field.type })),
    rows: [{ id: person.itemId, cells: [{ value: {
        type: "block", keyID: "name", block: { id: person.docId, content: person.name },
    } }] }],
} });
function resetKernel() {
    invalidateRoster();
    kernel.handler = async (route) => {
        if (route === "/api/av/renderAttributeView") return renderResult();
        throw new Error(`回归测试不允许请求 ${route}`);
    };
}
let mounted;
async function test(name, action) {
    resetKernel();
    try {
        await action();
        results.push({ name, ok: true });
    } catch (error) {
        results.push({ name, ok: false, detail: error.stack });
    } finally {
        if (mounted) await unmount(mounted);
        mounted = undefined;
        fixture.replaceChildren();
        document.querySelector("#results").textContent = JSON.stringify(results, null, 2);
    }
}

await test("首页零人筛选保持空结果，清除后恢复联系人", async () => {
    mounted = mount(Workbench, { target: fixture, props: {
        settings, preferences: DEFAULT_VIEW_PREFERENCES, isMobile: false,
        onPreferencesUpdated() {}, onOpenPersonDoc() {},
        facade: { settings, loadDashboard: async () => ({
            people: 1, relations: 0, birthdays: [], birthdaysThisWeek: 0,
            stale: [], neverContacted: 0, neverContactedItemIds: [],
        }) },
    } });
    await until(() => fixture.querySelectorAll('.lvct-dash__stat').length === 4, "首页未加载");
    [...fixture.querySelectorAll('.lvct-dash__stat')].find((node) => node.textContent.includes("从未互动")).click();
    await until(() => fixture.textContent.includes("当前筛选下没有联系人"), "零人筛选错误地显示全名册");
    assert(!fixture.querySelector(".lvct-person-card"), "零人筛选不应出现卡片");
    button("清除所有筛选").click();
    await until(() => fixture.querySelector(".lvct-person-card"), "清除首页筛选未恢复联系人");
});

await test("工作台可通过入口请求切换到设置页", async () => {
    mounted = mount(Workbench, { target: fixture, props: {
        settings, preferences: DEFAULT_VIEW_PREFERENCES, isMobile: false,
        onPreferencesUpdated() {}, onOpenPersonDoc() {},
        facade: { settings, loadDashboard: async () => ({
            people: 1, relations: 0, birthdays: [], birthdaysThisWeek: 0,
            stale: [], neverContacted: 0, neverContactedItemIds: [],
        }) },
    } });
    await until(() => fixture.querySelector("h1")?.textContent === "首页", "工作台未加载");
    window.dispatchEvent(new CustomEvent("lvct-workbench-view", { detail: { view: "settings" } }));
    await until(() => fixture.querySelector("h1")?.textContent === "设置", "设置入口请求未切换工作台");
    assert(fixture.querySelector(".lvct-settings"), "设置页内容未挂载");
});

await test("新工作台可按入口指定的初始视图打开", async () => {
    mounted = mount(Workbench, { target: fixture, props: {
        settings, preferences: DEFAULT_VIEW_PREFERENCES, initialView: "settings", isMobile: false,
        onPreferencesUpdated() {}, onOpenPersonDoc() {}, facade: { settings },
    } });
    await until(() => fixture.querySelector("h1")?.textContent === "设置", "工作台没有使用入口指定的初始视图");
    assert(fixture.querySelector(".lvct-settings"), "初始设置页内容未挂载");
});

if (window.innerWidth <= 640) {
    await test("移动视口显示底部导航，Peek 详情占满屏幕并保留安全区内距", async () => {
        mounted = mount(Workbench, { target: fixture, props: {
            settings, preferences: DEFAULT_VIEW_PREFERENCES, isMobile: true,
            onPreferencesUpdated() {}, onOpenPersonDoc() {},
            facade: {
                settings, viewPreferences: DEFAULT_VIEW_PREFERENCES,
                loadDashboard: async () => ({ people: 1, relations: 0, birthdays: [], birthdaysThisWeek: 0,
                    stale: [{ person }], neverContacted: 1, neverContactedItemIds: [person.itemId] }),
                loadPersonInsights: async () => emptyInsights(),
                recordInteraction: async () => {},
            },
        } });
        await until(() => fixture.querySelector(".lvct-workbench__sidebar"), "移动工作台未加载");
        const sidebar = fixture.querySelector(".lvct-workbench__sidebar");
        assert(getComputedStyle(sidebar).position === "fixed", "移动端导航没有固定在底部");
        assert(getComputedStyle(sidebar).bottom === "0px", "移动端导航没有贴近底部");
        const peopleNav = [...fixture.querySelectorAll(".lvct-workbench__nav-item")].find((node) => node.textContent.includes("联系人"));
        assert(peopleNav, "未找到移动端联系人导航");
        peopleNav.click();
        await until(() => fixture.querySelector("h1")?.textContent === "联系人", "底部导航未切换联系人");
        fixture.querySelector(".lvct-person-card")?.click();
        await until(() => fixture.querySelector(".lvct-dialog-panel--peek"), "移动端详情 Peek 未打开");
        const panel = fixture.querySelector(".lvct-dialog-panel--peek");
        assert(panel.getBoundingClientRect().width >= window.innerWidth - 20, `移动端 Peek 没有占满视口：${getComputedStyle(panel).width} / ${window.innerWidth}px`);
        assert(Number.parseFloat(getComputedStyle(panel).paddingBottom) > 0, "移动端 Peek 没有底部内距");
    });
}

await test("图谱稳定挂载，悬停卡保留人物，筛选清空后可恢复", async () => {
    let opened;
    mounted = mount(RelationGraph, { target: fixture, props: {
        settings, onOpenDetail: (value) => { opened = value; }, onOpenPeople() {},
    } });
    await until(() => fixture.querySelector(".lvct-graph-view__canvas")?._cyreg?.cy, "图谱未挂载");
    const cy = fixture.querySelector(".lvct-graph-view__canvas")._cyreg.cy;
    await pause(400);
    assert(!cy.destroyed(), "图谱被响应式 effect 重复销毁");
    cy.nodes()[0].emit("mouseover");
    await until(() => fixture.querySelector(".lvct-graph-view__hover-card"), "悬停卡未出现");
    button("查看人物详情").click();
    assert(opened?.docId === person.docId, "悬停卡传给详情的人物为空");
    input(fixture.querySelector('input[type="search"]'), "没有此人");
    await until(() => fixture.textContent.includes("没有匹配的节点"), "图谱没有展示筛选空态");
    assert(cy.destroyed(), "旧图谱没有销毁");
    button("清除筛选").click();
    await until(() => fixture.querySelector(".lvct-graph-view__canvas")?._cyreg?.cy, "清除筛选后图谱未恢复");
});

await test("详情加载失败可重试，空记录可跳转记一笔，写入后时间线刷新", async () => {
    let fail = true;
    let recorded = false;
    let changes = 0;
    mounted = mount(PersonDetail, { target: fixture, props: {
        settings, person, onRecord: async () => { recorded = true; },
        onLoadInsights: async () => {
            if (fail) throw new Error("测试读取失败");
            return recorded ? { timeline: [{ eventId: "test", localDate: "2026-09-27", note: "测试互动", groupSize: 1 }], totalEvents: 1, coAttendance: [] } : emptyInsights();
        }, onOpenPersonDoc() {}, onNavigate() {}, onChanged() { changes++; }, onDeleted() {}, onClose() {},
    } });
    button("互动").click();
    await until(() => fixture.textContent.includes("互动记录加载失败"), "读取失败被误报为空记录");
    fail = false;
    button("重试").click();
    await until(() => fixture.textContent.includes("还没有互动记录"), "重试未恢复");
    button("去记一笔").click();
    await tick();
    button("记录").click();
    await until(() => changes === 1, "互动保存未通知父视图");
    button("互动").click();
    await until(() => fixture.textContent.includes("测试互动"), "互动保存后时间线仍陈旧");
});

await test("从首页打开详情并记录互动后，首页统计同步刷新", async () => {
    let loads = 0;
    let recorded = false;
    const facade = {
        settings, viewPreferences: DEFAULT_VIEW_PREFERENCES,
        loadDashboard: async () => {
            loads++;
            return { people: 1, relations: 0, birthdays: [], birthdaysThisWeek: 0,
                stale: recorded ? [] : [{ person }], neverContacted: recorded ? 0 : 1,
                neverContactedItemIds: recorded ? [] : [person.itemId] };
        }, loadPersonInsights: async () => emptyInsights(),
        recordInteraction: async () => { recorded = true; }, openHostDoc() {},
    };
    mounted = mount(Workbench, { target: fixture, props: {
        facade, settings, preferences: DEFAULT_VIEW_PREFERENCES,
        onPreferencesUpdated() {}, isMobile: false, onOpenPersonDoc() {},
    } });
    await until(() => fixture.querySelector(".lvct-dash__row-main"), "首页未加载");
    fixture.querySelector(".lvct-dash__row-main").click();
    await tick();
    button("记录").click();
    await until(() => loads >= 2 && fixture.textContent.includes("暂无久未联系的人"), "详情修改没有刷新首页");
});

await test("vCard 切换文件解析失败时清空旧计划，禁止误导入", async () => {
    mounted = mount(VCardDialog, { target: fixture, props: { settings, onImported() {}, onClose() {} } });
    const fileInput = fixture.querySelector('input[type="file"]');
    function selectFile(name) {
        const transfer = new DataTransfer();
        transfer.items.add(new File([`BEGIN:VCARD\nVERSION:3.0\nFN:${name}\nEND:VCARD`], "test.vcf", { type: "text/vcard" }));
        fileInput.files = transfer.files;
        fileInput.dispatchEvent(new Event("change", { bubbles: true }));
    }
    selectFile("待导入联系人");
    await until(() => fixture.textContent.includes("导入为联系人（1）"), "首个文件未解析");
    invalidateRoster();
    kernel.handler = async () => { throw new Error("测试名册读取失败"); };
    selectFile("新文件联系人");
    await until(() => fixture.textContent.includes("通讯录处理失败"), "新文件错误未显示");
    assert(button("导入为联系人（0）").disabled, "新文件失败后仍可提交旧计划");
});

await test("快速修改收编关键词时，迟到的旧查询不能覆盖新结果", async () => {
    let resolveOld;
    let queries = 0;
    const oldResponse = new Promise((resolve) => { resolveOld = resolve; });
    const oldRow = { id: "20260927000000-old0001", content: "收编甲", hpath: "/甲" };
    const newRow = { id: "20260927000000-new0001", content: "收编乙", hpath: "/乙" };
    kernel.handler = async (route) => {
        if (route === "/api/notebook/lsNotebooks") return { notebooks: [{ id: "20260927000000-book002", name: "测试笔记本" }] };
        if (route === "/api/query/sql") return ++queries === 1 ? oldResponse : [newRow];
        if (route === "/api/av/getAttributeViewItemIDsByBoundIDs") return {};
        throw new Error(`非预期请求：${route}`);
    };
    mounted = mount(ImportDialog, { target: fixture, props: { settings, onImported() {}, onClose() {} } });
    await until(() => queries === 1, "初始扫描未开始");
    input(fixture.querySelector('input[type="text"]'), "乙");
    await until(() => fixture.textContent.includes("收编乙"), "新查询结果未展示");
    resolveOld([oldRow]);
    await pause(60);
    assert(fixture.textContent.includes("收编乙") && !fixture.textContent.includes("收编甲"), "旧查询覆盖了新结果");
    fixture.querySelector('.lvct-import__row:not(.lvct-import__row--head) input').click();
    await tick();
    assert(!button("收编为联系人（1）").disabled, "勾选新结果后应允许收编");
    input(fixture.querySelector('input[type="text"]'), "甲");
    await tick();
    assert(button("收编为联系人（0）").disabled, "等待新查询时仍能误提交旧勾选");
});

await test("首页快捷互动失败保留备注，重试成功后更新提醒", async () => {
    let fail = true;
    let recorded = false;
    const notes = [];
    mounted = mount(DashboardView, { target: fixture, props: {
        preferences: DEFAULT_VIEW_PREFERENCES, onOpenDetail() {}, onOpenPeople() {}, onOpenGraph() {},
        facade: { settings, loadDashboard: async () => ({
            people: 1, relations: 0, birthdays: [], birthdaysThisWeek: 0,
            stale: recorded ? [] : [{ person }], neverContacted: recorded ? 0 : 1, neverContactedItemIds: [],
        }), recordInteraction: async (_, note) => {
            notes.push(note);
            if (fail) throw new Error("测试写入失败");
            recorded = true;
        } },
    } });
    await until(() => fixture.querySelector(".lvct-dash__quick-button"), "快捷操作未加载");
    button("记一笔").click();
    await tick();
    const noteInput = fixture.querySelector(".lvct-dash__quick-form input");
    input(noteInput, "保留这条备注");
    button("记录").click();
    await until(() => fixture.textContent.includes("测试写入失败"), "记录错误未展示");
    assert(noteInput.value === "保留这条备注", "写入失败后备注丢失");
    fail = false;
    button("记录").click();
    await until(() => fixture.textContent.includes("暂无久未联系的人"), "重试后列表未更新");
    assert(notes.length === 2 && notes[1] === notes[0], "重试提交的备注发生变化");
});

await test("设置页可按列类型手动恢复字段映射并拒绝空提交", async () => {
    let repaired;
    let checked = false;
    const columns = FIELD_SPECS
        .filter((field) => field.key !== "phone")
        .map((field) => ({ id: field.key, name: field.nameZh, type: field.type }));
    columns.push({ id: "phone-renamed", name: "联系方式", type: "phone" });
    const facade = {
        settings, viewPreferences: DEFAULT_VIEW_PREFERENCES,
        checkSettingsHealth: async () => {
            checked = true;
            return checked && repaired
                ? { ok: true, columns: columns.length, missing: [], availableColumns: columns }
                : { ok: false, columns: columns.length, missing: [{ key: "phone", expectedName: "电话", keyId: "old-phone", type: "phone" }], availableColumns: columns };
        },
        repairFieldMap: async (patch) => { repaired = patch; return { ...settings, fieldMap: { ...settings.fieldMap, ...patch } }; },
        rebuildMissingFields: async () => settings,
        rebindSettings: async () => settings,
        saveViewPreferences: async (value) => value,
        exportInteractionJson: async () => "{}",
        openHostDoc() {},
    };
    mounted = mount(SettingsView, { target: fixture, props: {
        facade, settings, preferences: DEFAULT_VIEW_PREFERENCES,
        onSettingsUpdated() {}, onPreferencesUpdated() {}, onBack() {},
    } });
    if (window.innerWidth <= 640) {
        const layoutEl = fixture.querySelector(".lvct-settings__layout");
        const navEl = fixture.querySelector(".lvct-settings__nav");
        assert(getComputedStyle(layoutEl).flexDirection === "column", "移动端设置页应为纵向布局");
        assert(getComputedStyle(navEl).flexDirection === "row", "移动端设置导航应为横向");
    }
    const dataNav = [...fixture.querySelectorAll(".lvct-settings__nav-item")].find((node) => node.textContent.includes("数据与字段"));
    assert(dataNav, "未找到数据与字段导航");
    dataNav.click();
    await until(() => [...fixture.querySelectorAll("button")].some((node) => node.textContent.trim() === "检查字段健康"), "数据与字段分区未显示");
    button("检查字段健康").click();
    await until(() => fixture.textContent.includes("发现 1 个字段缺失"), "健康检查结果未展示");
    const mapping = fixture.querySelector(".lvct-settings__mapping select");
    assert(mapping, "缺失字段没有映射选择器");
    mapping.value = "phone-renamed";
    mapping.dispatchEvent(new Event("change", { bubbles: true }));
    button("保存字段映射").click();
    await until(() => repaired?.phone === "phone-renamed", "字段映射没有保存");
    await until(() => fixture.textContent.includes("字段完整"), "保存映射后健康状态未刷新");
});

await test("原生捕获弹窗可完成并关闭，继承主题令牌", async () => {
    const dialog = svelteDialog({ title: "测试捕获", component: CaptureDialog, props: {
        docId: settings.hostDocId,
        facade: {
            viewPreferences: DEFAULT_VIEW_PREFERENCES,
            previewCapture: async () => ({ docName: "测试笔记", linked: [person] }),
            captureDoc: async () => ({ createdNames: [], createdDocIds: [], interactions: 1, attendeeBlockWritten: true }),
        },
    } });
    try {
        await until(() => dialog.dialog.element.textContent.includes("下一步：确认记录"), "捕获未加载");
        button("下一步：确认记录", dialog.dialog.element).click();
        await tick();
        button("记录互动并写入参与人员", dialog.dialog.element).click();
        await until(() => dialog.dialog.element.textContent.includes("打开原笔记"), "捕获完成页未显示");
        assert(getComputedStyle(dialog.dialog.element.querySelector(".lvct-dialog-root")).getPropertyValue("--lvct-sp-2").trim(), "原生弹窗缺少主题令牌");
        button("完成", dialog.dialog.element).click();
        await tick();
        assert(!dialog.dialog.element.isConnected, "完成按钮未关闭弹窗");
    } finally {
        if (dialog.dialog.element.isConnected) dialog.close();
    }
});

await test("快速切换文档不会插入旧人物档案条，独立档案条有明暗主题令牌", async () => {
    const element = document.createElement("div");
    element.innerHTML = '<div class="protyle-title"></div>';
    fixture.append(element);
    const protyle = { element, block: { rootID: person.docId } };
    let resolveStore;
    let requested = false;
    const store = new Promise((resolve) => { resolveStore = resolve; });
    const context = { settings, plugin: { loadData: () => { requested = true; return store; } } };
    handleProtyleEvent(context, { detail: { protyle } });
    await until(() => requested, "档案条未开始读取互动");
    protyle.block.rootID = "20260927000000-other01";
    handleProtyleEvent(context, { detail: { protyle } });
    resolveStore({ schemaVersion: 1, events: [], tombstones: [] });
    await pause(50);
    assert(!element.querySelector('.lvct-doc-strip'), "旧人物档案条写入了新文档");
    const strip = document.createElement("div");
    strip.className = "lvct-doc-strip";
    document.body.append(strip);
    const previousMode = document.documentElement.getAttribute("data-theme-mode");
    try {
        document.documentElement.setAttribute("data-theme-mode", "light");
        assert(getComputedStyle(strip).getPropertyValue("--lvct-sp-2").trim(), "编辑器外置档案条缺少令牌");
        const light = getComputedStyle(strip).getPropertyValue("--lvct-highlight");
        document.documentElement.setAttribute("data-theme-mode", "dark");
        assert(getComputedStyle(strip).getPropertyValue("--lvct-highlight") !== light, "档案条暗色令牌未生效");
    } finally {
        strip.remove();
        if (previousMode === null) document.documentElement.removeAttribute("data-theme-mode");
        else document.documentElement.setAttribute("data-theme-mode", previousMode);
    }
});

await test("人物档案条会前简报展示真实互动事实", async () => {
    const element = document.createElement("div");
    element.innerHTML = '<div class="protyle-title"></div>';
    fixture.append(element);
    const protyle = { element, block: { rootID: person.docId } };
    const context = { settings, plugin: { loadData: async () => ({
        schemaVersion: 1,
        events: [{
            id: "event-briefing", personDocId: person.docId, occurredAt: Date.now(),
            localDate: "2026-09-27", source: "manual", note: "确认下周合作安排",
        }],
        tombstones: [],
    }) } };
    handleProtyleEvent(context, { detail: { protyle } });
    await until(() => element.querySelector(".lvct-strip__briefing-list"), "会前简报未渲染事实条目");
    const briefing = element.querySelector(".lvct-strip__briefing");
    assert(briefing.textContent.includes("最近互动"), "会前简报缺少最近互动标签");
    assert(briefing.textContent.includes("确认下周合作安排"), "会前简报缺少互动备注");
    assert(!briefing.textContent.includes("预留"), "会前简报仍显示占位内容");
});

await test("多人互动通过真实存储服务写入并回读，重复记录保持幂等", async () => {
    let saved;
    const plugin = {
        loadData: async () => saved === undefined ? null : JSON.parse(JSON.stringify(saved)),
        saveData: async (_key, value) => { saved = JSON.parse(JSON.stringify(value)); },
    };
    for (const personDocId of ["甲", "乙", "丙", "乙"]) {
        await recordInteraction(plugin, { personDocId, source: "diary", externalRef: "同场回归" });
    }
    const store = await loadInteractionStore(plugin);
    assert(store.events.length === 3, `多人同场只保存了 ${store.events.length} 条互动`);
    assert(new Set(store.events.map((event) => event.personDocId)).size === 3, "参与者记录不完整");
});

await test("外部联动重复及并发调用只计实际新增，写入失败不报成功", async () => {
    let saved;
    const plugin = {
        loadData: async () => saved === undefined ? null : JSON.parse(JSON.stringify(saved)),
        saveData: async (_key, value) => { saved = JSON.parse(JSON.stringify(value)); },
    };
    initExternalBridge(plugin, () => settings);
    try {
        const api = window.LvContacts;
        const first = await api.recordInteraction(["甲", "乙", "甲"], { ref: "会议" });
        assert(first.recorded === 2, "重复人员被计为新增");
        assert((await api.recordInteraction(["乙", "甲"], { ref: "会议" })).recorded === 0, "重复调用误报新增");
        const concurrent = await Promise.all([
            api.recordInteraction(["丙"], { ref: "会议" }),
            api.recordInteraction(["丙"], { ref: "会议" }),
        ]);
        assert(concurrent.reduce((sum, result) => sum + result.recorded, 0) === 1, "并发调用重复计数");
        assert((await loadInteractionStore(plugin)).events.length === 3, "并发保存丢失参与者");
        plugin.saveData = async () => {};
        let rejected = false;
        try { await api.recordInteraction(["丁"], { ref: "会议" }); } catch { rejected = true; }
        assert(rejected, "写后回读失败仍返回成功");
    } finally {
        disposeExternalBridge();
    }
});

await test("笔记捕获去重参与人员，重复捕获返回零新增", async () => {
    let saved;
    let markdown = "";
    const plugin = {
        loadData: async () => saved === undefined ? null : JSON.parse(JSON.stringify(saved)),
        saveData: async (_key, value) => { saved = JSON.parse(JSON.stringify(value)); },
    };
    kernel.handler = async (route, payload) => {
        if (route === "/api/av/renderAttributeView") return renderResult();
        if (route === "/api/query/sql") return [{ id: "20260927000000-section" }];
        if (route === "/api/block/updateBlock") { markdown = payload.data; return null; }
        throw new Error(`捕获回归不允许请求 ${route}`);
    };
    const options = { personDocIds: [person.docId, person.docId], newNames: [], date: "2026-09-27" };
    const first = await captureFromDoc(plugin, settings, settings.hostDocId, options);
    assert(first.interactions === 1, "重复选择人员导致新增计数错误");
    assert(markdown.split(`siyuan://blocks/${person.docId}`).length - 1 === 1, "参与人员区块重复列出同一人");
    const repeat = await captureFromDoc(plugin, settings, settings.hostDocId, options);
    assert(repeat.interactions === 0, "重复捕获误报新增");
});

await test("互动日期严格校验，非法日期在创建人物和写入前被拒绝", async () => {
    let saved;
    let writes = 0;
    let requests = 0;
    const plugin = {
        loadData: async () => saved === undefined ? null : JSON.parse(JSON.stringify(saved)),
        saveData: async (_key, value) => { writes += 1; saved = JSON.parse(JSON.stringify(value)); },
    };
    kernel.handler = async () => { requests += 1; throw new Error("非法日期不应访问内核"); };
    initExternalBridge(plugin, () => settings);
    try {
        for (const date of ["", "2026-02-29", "2026-04-31", "2026/09/27", "not-a-date"]) {
            for (const action of [
                () => window.LvContacts.recordInteraction([person.docId], { ref: "日期回归", date }),
                () => captureFromDoc(plugin, settings, settings.hostDocId, {
                    personDocIds: [person.docId], newNames: ["不应创建"], date,
                }),
            ]) {
                let message = "";
                try { await action(); } catch (error) { message = error.message; }
                assert(message.includes("场合日期"), `非法日期未明确拒绝：${date}`);
            }
        }
        assert(writes === 0 && requests === 0, "非法日期导致存储或内核写入");
        const result = await window.LvContacts.recordInteraction([person.docId], { ref: "闰日回归", date: "2024-02-29" });
        assert(result.recorded === 1, "合法闰日被拒绝");
        const store = await loadInteractionStore(plugin);
        assert(store.events[0].localDate === "2024-02-29", "闰日被顺延或回退到今天");
        assert(new Date(store.events[0].occurredAt).getHours() === 0, "未按当地零点记录");
    } finally {
        disposeExternalBridge();
    }
});

await test("按名捕获复用已有联系人，不漏记互动或误报新建", async () => {
    let saved;
    let markdown = "";
    const plugin = {
        loadData: async () => saved === undefined ? null : JSON.parse(JSON.stringify(saved)),
        saveData: async (_key, value) => { saved = JSON.parse(JSON.stringify(value)); },
    };
    kernel.handler = async (route, payload) => {
        if (route === "/api/av/renderAttributeView") return renderResult();
        if (route === "/api/query/sql") return [{ id: "20260927000000-section" }];
        if (route === "/api/block/updateBlock") { markdown = payload.data; return null; }
        throw new Error(`复用联系人不应请求 ${route}`);
    };
    const options = { personDocIds: [], newNames: [person.name, ` ${person.name} `, ""], date: "2026-09-27" };
    const first = await captureFromDoc(plugin, settings, settings.hostDocId, options);
    assert(first.createdNames.length === 0 && first.createdDocIds.length === 0, "已有联系人被误报为新建");
    assert(first.interactions === 1 && first.attendeeBlockWritten, "已有姓名未被纳入参与者");
    assert(markdown.split(`siyuan://blocks/${person.docId}`).length - 1 === 1, "同名参与者未去重");
    const store = await loadInteractionStore(plugin);
    assert(store.events.length === 1 && store.events[0].personDocId === person.docId, "没有复用正确的人物文档");
    const repeat = await captureFromDoc(plugin, settings, settings.hostDocId, { ...options, personDocIds: [person.docId] });
    assert(repeat.interactions === 0, "按姓名与文档重叠捕获重复计数");
});

await pause(100);
results.push({ name: "无未处理异常及响应式循环", ok: runtimeErrors.length === 0, detail: runtimeErrors.join("\n") });
document.querySelector("#results").textContent = JSON.stringify(results, null, 2);
await fetch("/__ui_report", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(results) });
