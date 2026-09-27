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
import { getRoster, invalidateRoster } from "../../../src/services/roster";
import { recordInteraction, deleteInteraction, loadInteractionStore } from "../../../src/data/interactions";
import { initExternalBridge, disposeExternalBridge } from "../../../src/bridge/external-bridge";
import { captureFromDoc } from "../../../src/services/capture";
import { exportInteractionJson } from "../../../src/services/interaction-export";
import { importInteractionJson, previewInteractionImport } from "../../../src/services/interaction-import";
import { FIELD_SPECS } from "../../../src/domain/fields";
import { buildTimeline, buildCoAttendance } from "../../../src/domain/interactions";
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

await test("图谱邻接、共同联系人与最短路径不重建画布，筛选清理失效选择", async () => {
    const entries = [
        { id: "a", name: "甲", related: ["c", "d"] },
        { id: "b", name: "乙", related: ["c"] },
        { id: "c", name: "共同人物", related: [] },
        { id: "d", name: "独有关系", related: [] },
        { id: "e", name: "孤立人物", related: [] },
    ];
    kernel.handler = async (route) => {
        assert(route === "/api/av/renderAttributeView", "图谱查询不应写内核");
        return { view: { columns: renderResult().view.columns, rows: entries.map((entry) => ({
            id: entry.id, cells: [
                { value: { type: "block", keyID: "name", block: { id: entry.id, content: entry.name } } },
                { value: { type: "relation", keyID: "related", relation: { blockIDs: entry.related } } },
            ],
        })) } };
    };
    let opened;
    mounted = mount(RelationGraph, { target: fixture, props: {
        settings, onOpenDetail(value) { opened = value.docId; }, onOpenPeople() {},
    } });
    await until(() => fixture.querySelector(".lvct-graph-view__canvas")?._cyreg?.cy, "图谱未挂载");
    const cy = fixture.querySelector(".lvct-graph-view__canvas")._cyreg.cy;
    const select = (label, value) => {
        const node = fixture.querySelector(`select[aria-label="${label}"]`);
        node.value = value;
        node.dispatchEvent(new Event("change", { bubbles: true }));
    };
    select("关系中心", "a");
    await until(() => fixture.textContent.includes("直接关系：2 人"), "直接关系计数错误");
    assert(cy.getElementById("a").hasClass("lvct-graph-focus"), "中心未高亮");
    assert(cy.getElementById("e").hasClass("lvct-graph-muted"), "无关人物未淡化");
    assert(!cy.getElementById("c").hasClass("lvct-graph-muted"), "邻接人物被淡化");
    select("关系层级", "second");
    await until(() => fixture.textContent.includes("二度关系：1 人"), "二度关系计数错误");
    assert([...fixture.querySelectorAll(".lvct-graph-query__results button")].map((node) => node.textContent).join(",") === "乙", "二度结果混入直接关系或中心");
    assert(!cy.getElementById("b").hasClass("lvct-graph-muted"), "二度人物未显示");
    assert(!cy.getElementById("c").hasClass("lvct-graph-muted"), "中间关系被淡化");
    assert(cy.edges().filter((edge) => !edge.hasClass("lvct-graph-muted")).length === 3, "二度连线高亮错误");
    assert(!cy.destroyed(), "二度切换不应重建画布");
    button("乙", fixture.querySelector(".lvct-graph-query__results")).click();
    assert(opened === "b", "二度结果未打开人物");
    select("关系层级", "direct");
    select("对比人物", "b");
    await until(() => fixture.textContent.includes("共同联系人：1 人"), "共同联系人计数错误");
    assert(cy.getElementById("d").hasClass("lvct-graph-muted"), "独有关系未淡化");
    button("共同人物", fixture.querySelector(".lvct-graph-query__results")).click();
    assert(opened === "c", "结果未打开正确详情");
    assert(!cy.destroyed(), "选人不应重建图谱");
    select("关系查询模式", "path");
    await until(() => fixture.textContent.includes("最短路径：2 段关系"), "最短路径段数错误");
    assert([...fixture.querySelectorAll(".lvct-graph-query__results button")].map((node) => node.textContent).join(",") === "甲,共同人物,乙", "路径顺序错误");
    assert(!cy.getElementById("c").hasClass("lvct-graph-muted"), "路径中间人物被淡化");
    assert(cy.edges().filter((edge) => !edge.hasClass("lvct-graph-muted")).length === 2, "路径连线高亮错误");
    button("共同人物", fixture.querySelector(".lvct-graph-query__results")).click();
    assert(opened === "c", "路径人物未打开详情");
    select("对比人物", "e");
    await until(() => fixture.textContent.includes("当前图内没有连接路径"), "断开人物应无路径");
    assert(cy.edges().every((edge) => edge.hasClass("lvct-graph-muted")), "无路径仍高亮旧连线");
    select("对比人物", "d");
    await until(() => fixture.textContent.includes("最短路径：1 段关系"), "直接关系应为一段路径");
    assert(!cy.destroyed(), "切换路径不应重建画布");
    select("关系查询模式", "common");
    select("对比人物", "e");
    await until(() => fixture.textContent.includes("当前图内没有共同联系人"), "无共同联系人空态错误");
    button("清除选择").click();
    await until(() => cy.elements(".lvct-graph-muted").length === 0, "清除未恢复图谱");
    select("关系中心", "e");
    await until(() => fixture.textContent.includes("当前图内没有直接关系"), "孤立人物空态错误");
    input(fixture.querySelector('input[type="search"]'), "共同人物");
    await until(() => fixture.querySelector('select[aria-label="关系中心"]')?.value === "", "筛选后未清除失效中心");
    assert(fixture.querySelector('select[aria-label="对比人物"]').disabled, "无中心不应允许对比");
    const bounds = fixture.querySelector(".lvct-graph-query").getBoundingClientRect();
    assert(bounds.right <= window.innerWidth + 1, "关系查询超出视口");
    for (const control of fixture.querySelectorAll(".lvct-graph-query select")) {
        assert(control.getBoundingClientRect().right <= window.innerWidth + 1, "选人控件超出视口");
    }
    fixture.querySelector(".lvct-graph-isolated input").click();
    await until(() => fixture.textContent.includes("没有匹配的节点"), "隐藏关系对端后不应将共同人物误判为孤立");
    button("清除筛选").click();
    await until(() => fixture.querySelector(".lvct-graph-view__canvas")?._cyreg?.cy?.nodes().length === 5, "清除筛选未恢复全图");
    assert(!fixture.querySelector(".lvct-graph-isolated input").checked, "清除筛选未重置无关系筛选");
    fixture.querySelector(".lvct-graph-isolated input").click();
    await until(() => fixture.querySelector(".lvct-graph-view__canvas")?._cyreg?.cy?.nodes().length === 1, "未只显示孤立人物");
    const isolatedCy = fixture.querySelector(".lvct-graph-view__canvas")._cyreg.cy;
    assert(isolatedCy.nodes()[0].id() === "e", "孤立筛选人物错误");
    select("关系中心", "e");
    await tick();
    select("关系层级", "second");
    await until(() => fixture.textContent.includes("当前图内没有二度关系"), "孤立人物二度空态错误");
});

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

await test("名册并发查询合并，失效后的旧请求不能回填缓存，失败后可重试", async () => {
    let calls = 0;
    let releaseOld;
    const oldResponse = new Promise((resolve) => { releaseOld = resolve; });
    kernel.handler = async (route) => {
        assert(route === "/api/av/renderAttributeView", "名册请求越界");
        calls += 1;
        if (calls === 1) return oldResponse;
        const response = renderResult();
        response.view.rows[0].cells[0].value.block.content = "最新姓名";
        return response;
    };
    const old = getRoster(settings);
    const shared = getRoster(settings);
    await until(() => calls === 1, "旧查询未发出");
    invalidateRoster();
    assert((await getRoster(settings))[0].name === "最新姓名", "失效后没有读取新数据");
    releaseOld(renderResult());
    await Promise.all([old, shared]);
    assert((await getRoster(settings))[0].name === "最新姓名", "旧查询覆盖了新缓存");
    assert(calls === 2, "同配置并发查询未合并或缓存未复用");
    await getRoster({ ...settings, fieldMap: { ...settings.fieldMap, phone: "changed-phone" } });
    assert(calls === 3, "字段映射改变仍复用旧缓存");
    invalidateRoster();
    kernel.handler = async () => { throw new Error("暂时不可用"); };
    let failed = false;
    try { await getRoster(settings); } catch { failed = true; }
    assert(failed, "查询失败未传递给调用方");
    kernel.handler = async () => renderResult();
    assert((await getRoster(settings))[0].name === person.name, "失败后无法重新查询");
});

await test("互动读取失败阻止新增与删除，恢复后保留旧记录", async () => {
    let saved;
    let writes = 0;
    let failRead = false;
    const plugin = {
        loadData: async () => {
            if (failRead) throw new Error("模拟存储暂时不可读");
            return saved === undefined ? null : JSON.parse(JSON.stringify(saved));
        },
        saveData: async (_key, value) => { writes += 1; saved = JSON.parse(JSON.stringify(value)); },
    };
    const first = await recordInteraction(plugin, { personDocId: "甲", source: "api", externalRef: "旧记录" });
    const snapshot = JSON.stringify(saved);
    const before = writes;
    failRead = true;
    assert((await loadInteractionStore(plugin)).events.length === 0, "展示读取未保持容错");
    for (const action of [
        () => recordInteraction(plugin, { personDocId: "乙", source: "api", externalRef: "新记录" }),
        () => deleteInteraction(plugin, first.events[0].id),
    ]) {
        let message = "";
        try { await action(); } catch (error) { message = error.message; }
        assert(message.includes("存储读取失败"), "读取失败未阻止修改");
    }
    assert(writes === before && JSON.stringify(saved) === snapshot, "读取失败覆盖了已有记录");
    failRead = false;
    const recovered = await recordInteraction(plugin, { personDocId: "乙", source: "api", externalRef: "新记录" });
    assert(recovered.events.length === 2 && recovered.events.some((event) => event.id === first.events[0].id), "恢复后旧记录丢失");
    const deleted = await deleteInteraction(plugin, first.events[0].id);
    assert(deleted.events.length === 1 && deleted.tombstones.includes(first.events[0].id), "恢复后删除未正常写墓碑");
});

await test("互动损坏数据与未知版本禁止覆盖，宿主空字符串可首次保存", async () => {
    let saved = "";
    let writes = 0;
    const plugin = {
        loadData: async () => JSON.parse(JSON.stringify(saved)),
        saveData: async (_key, value) => { writes += 1; saved = JSON.parse(JSON.stringify(value)); },
    };
    const first = await recordInteraction(plugin, { personDocId: "甲" });
    assert(first.events.length === 1 && writes === 1, "宿主未创建文件的空字符串无法首次保存");
    const good = JSON.parse(JSON.stringify(saved));
    for (const damaged of [
        { ...good, schemaVersion: 99 }, { ...good, events: [...good.events, null] },
        { ...good, tombstones: [42] }, { schemaVersion: 1 }, "损坏内容",
    ]) {
        saved = damaged;
        const snapshot = JSON.stringify(saved);
        const before = writes;
        for (const action of [
            () => recordInteraction(plugin, { personDocId: "乙" }),
            () => deleteInteraction(plugin, good.events[0].id),
        ]) {
            let message = "";
            try { await action(); } catch (error) { message = error.message; }
            assert(message.includes("操作已停止"), "损坏存储未阻止修改");
        }
        assert(writes === before && JSON.stringify(saved) === snapshot, "损坏存储被覆盖");
    }
    saved = good;
    assert((await recordInteraction(plugin, { personDocId: "乙" })).events.length === 2, "恢复合法文件后不能继续追加");
});

await test("互动导出保留原始损坏项与未知版本，读取失败不生成空备份", async () => {
    let saved;
    let writes = 0;
    let failRead = false;
    const plugin = {
        loadData: async () => {
            if (failRead) throw new Error("备份读取失败");
            return JSON.parse(JSON.stringify(saved));
        },
        saveData: async () => { writes += 1; },
    };
    const event = { id: "备份事件", personDocId: "甲", source: "manual", occurredAt: Date.now(), localDate: "2026-09-27" };
    for (const raw of ["", null,
        { schemaVersion: 1, events: [event, event, null], tombstones: ["墓碑", 42] },
        { schemaVersion: 99, events: [event], tombstones: [], unknownField: "不能丢失" },
    ]) {
        saved = raw;
        const backup = JSON.parse(await exportInteractionJson(plugin));
        assert(JSON.stringify(backup.rawStore) === JSON.stringify(raw), "原始数据快照丢失内容");
        assert(backup.storageKey === "interaction-events.json" && backup.exportedAt, "备份缺少来源与导出时间");
        if (raw?.schemaVersion === 1) {
            assert(backup.events.length === 1 && backup.tombstones.length === 1, "原有归一化导出字段不兼容");
        }
    }
    failRead = true;
    let message = "";
    try { await exportInteractionJson(plugin); } catch (error) { message = error.message; }
    assert(message.includes("存储读取失败"), "读取失败仍生成备份");
    assert(writes === 0, "导出修改了原存储");
});

await test("设置页备份读取失败不下载，重试后下载完整快照", async () => {
    let failRead = true;
    const raw = { schemaVersion: 99, events: [null], tombstones: [], preserved: "原始内容" };
    const plugin = { loadData: async () => {
        if (failRead) throw new Error("暂时不可读");
        return raw;
    } };
    let blob;
    let downloads = 0;
    let filename = "";
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    const originalClick = HTMLAnchorElement.prototype.click;
    URL.createObjectURL = (value) => { blob = value; return "blob:backup-test"; };
    URL.revokeObjectURL = () => {};
    HTMLAnchorElement.prototype.click = function () { downloads += 1; filename = this.download; };
    try {
        mounted = mount(SettingsView, { target: fixture, props: {
            facade: { exportInteractionJson: () => exportInteractionJson(plugin) },
            settings, preferences: DEFAULT_VIEW_PREFERENCES,
            onSettingsUpdated() {}, onPreferencesUpdated() {}, onBack() {},
        } });
        [...fixture.querySelectorAll(".lvct-settings__nav-item")].find((node) => node.textContent.includes("数据与字段")).click();
        await tick();
        button("导出 JSON").click();
        await until(() => fixture.textContent.includes("存储读取失败"), "备份读取失败未显示错误");
        assert(downloads === 0, "读取失败触发了空下载");
        failRead = false;
        button("导出 JSON").click();
        await until(() => fixture.textContent.includes("原始数据快照已导出"), "重试导出未成功");
        assert(downloads === 1 && filename.endsWith(".json"), "备份下载次数或文件名错误");
        assert(JSON.stringify(JSON.parse(await blob.text()).rawStore) === JSON.stringify(raw), "下载文件缺失原始内容");
    } finally {
        URL.createObjectURL = originalCreate;
        URL.revokeObjectURL = originalRevoke;
        HTMLAnchorElement.prototype.click = originalClick;
    }
});

await test("备份预览不写入，合并重读当前数据并保留并发新增，再次合并幂等", async () => {
    let saved = "";
    let writes = 0;
    const plugin = {
        loadData: async () => JSON.parse(JSON.stringify(saved)),
        saveData: async (_key, value) => { writes += 1; saved = JSON.parse(JSON.stringify(value)); },
    };
    const incoming = { id: "导入事件", personDocId: "甲", source: "manual", occurredAt: Date.now(), localDate: "2026-09-27" };
    const text = JSON.stringify({ schemaVersion: 1, events: [incoming], tombstones: ["删除标记"] });
    const preview = await previewInteractionImport(plugin, text);
    assert(preview.added === 1 && writes === 0, "预览发生写入或计数错误");
    await recordInteraction(plugin, { personDocId: "乙" });
    const result = await importInteractionJson(plugin, text);
    assert(result.added === 1 && (await loadInteractionStore(plugin)).events.length === 2, "导入覆盖了预览后的新增记录");
    const before = writes;
    const repeat = await importInteractionJson(plugin, text);
    assert(repeat.added === 0 && repeat.skipped === 1 && writes === before, "重复导入不幂等");
    const nextText = JSON.stringify({ schemaVersion: 1, events: [{ ...incoming, id: "并发导入", personDocId: "丙" }], tombstones: [] });
    const concurrent = await Promise.all([importInteractionJson(plugin, nextText), importInteractionJson(plugin, nextText)]);
    assert(concurrent.reduce((sum, item) => sum + item.added, 0) === 1, "并发导入重复计数");
    const afterConcurrent = writes;
    saved = { schemaVersion: 99, events: [], tombstones: [] };
    let rejected = false;
    try { await importInteractionJson(plugin, text); } catch { rejected = true; }
    assert(rejected && writes === afterConcurrent, "导入覆盖了不兼容的当前库");
});

await test("设置页备份合并先预览，坏文件清空旧计划，取消不写入，失败可重试", async () => {
    let saved = "";
    let failWrite = true;
    let writes = 0;
    let refreshed = 0;
    let delayPreview = false;
    let releasePreview;
    const plugin = {
        loadData: async () => JSON.parse(JSON.stringify(saved)),
        saveData: async (_key, value) => { if (!failWrite) { writes += 1; saved = JSON.parse(JSON.stringify(value)); } },
    };
    const facade = {
        previewInteractionImport: async (text) => {
            if (delayPreview) {
                delayPreview = false;
                await new Promise((resolve) => { releasePreview = resolve; });
            }
            return previewInteractionImport(plugin, text);
        },
        importInteractionJson: (text) => importInteractionJson(plugin, text),
    };
    mounted = mount(SettingsView, { target: fixture, props: {
        facade, settings, preferences: DEFAULT_VIEW_PREFERENCES,
        onSettingsUpdated() {}, onPreferencesUpdated() {}, onBack() {}, onInteractionsUpdated() { refreshed += 1; },
    } });
    [...fixture.querySelectorAll(".lvct-settings__nav-item")].find((node) => node.textContent.includes("数据与字段")).click();
    await tick();
    const fileInput = fixture.querySelector("#lvct-interaction-backup");
    const good = JSON.stringify({ schemaVersion: 1, events: [{ id: "恢复事件", personDocId: "甲", occurredAt: Date.now(), localDate: "2026-09-27", source: "manual" }], tombstones: [] });
    function selectFile(text) {
        const transfer = new DataTransfer();
        transfer.items.add(new File([text], "backup.json", { type: "application/json" }));
        fileInput.files = transfer.files;
        fileInput.dispatchEvent(new Event("change", { bubbles: true }));
    }
    const originalConfirm = window.confirm;
    try {
        selectFile(good);
        await until(() => fixture.textContent.includes("预计新增 1 条"), "导入预览未显示");
        assert(writes === 0, "选择文件即发生写入");
        delayPreview = true;
        selectFile(good);
        await until(() => Boolean(releasePreview), "迟到预览未开始");
        selectFile("bad-json");
        await until(() => fixture.textContent.includes("备份不是有效"), "坏文件未报错");
        releasePreview();
        await pause(50);
        await tick();
        assert(button("确认合并备份").disabled, "坏文件仍可执行旧导入计划");
        selectFile(good);
        await until(() => !button("确认合并备份").disabled, "重新选择备份后不可提交");
        window.confirm = () => false;
        button("确认合并备份").click();
        await tick();
        assert(writes === 0, "取消确认仍写入");
        window.confirm = (message) => { assert(message.includes("删除标记"), "确认未说明删除语义"); return true; };
        button("确认合并备份").click();
        await until(() => fixture.textContent.includes("存储写入未收敛"), "写入失败未显示");
        assert(!button("确认合并备份").disabled, "失败后无法重试");
        failWrite = false;
        button("确认合并备份").click();
        await until(() => fixture.textContent.includes("合并完成：新增 1 条"), "重试合并未成功");
        assert(refreshed === 1 && writes === 1, "完成后未通知刷新或重复写入");
        assert(button("确认合并备份").disabled && fileInput.value === "", "完成后保留了可重复提交的旧计划");
        assert(fileInput.getBoundingClientRect().right <= fixture.getBoundingClientRect().right + 1, "文件选择框超出移动布局");
    } finally { window.confirm = originalConfirm; }
});

await test("无浏览器锁时并发互动与备份合并仍串行，不丢记录", async () => {
    const descriptor = Object.getOwnPropertyDescriptor(navigator, "locks");
    Object.defineProperty(navigator, "locks", { configurable: true, value: undefined });
    let saved = "";
    const plugin = {
        loadData: async () => JSON.parse(JSON.stringify(saved)),
        saveData: async (_key, value) => { await pause(5); saved = JSON.parse(JSON.stringify(value)); },
    };
    try {
        await Promise.all(Array.from({ length: 12 }, (_, index) => recordInteraction(plugin, {
            personDocId: `参与者${index}`, source: "api", externalRef: "降级并发回归",
        })));
        assert((await loadInteractionStore(plugin)).events.length === 12, "无浏览器锁时并发保存丢失记录");
        const text = JSON.stringify({ schemaVersion: 1, events: [{ id: "降级导入", personDocId: "导入参与者", source: "api", occurredAt: Date.now(), localDate: "2026-09-27" }], tombstones: [] });
        const results = await Promise.all([importInteractionJson(plugin, text), importInteractionJson(plugin, text)]);
        assert(results.reduce((sum, result) => sum + result.added, 0) === 1, "降级并发导入重复计数");
        assert((await loadInteractionStore(plugin)).events.length === 13, "降级合并覆盖了已有事件");
    } finally {
        if (descriptor) Object.defineProperty(navigator, "locks", descriptor);
        else Reflect.deleteProperty(navigator, "locks");
    }
});

await test("人物互动支持加载更多、筛选及安全删除，取消/失败不丢记录，成功刷新同场统计", async () => {
    const mine = Array.from({ length: 26 }, (_, index) => ({
        id: `history-${index}`, personDocId: person.docId, source: "manual", occurredAt: Date.now(),
        localDate: "2026-09-27", note: `历史互动${index}`,
    }));
    mine[0].note = "长备注回归".repeat(40);
    let saved = { schemaVersion: 1, events: [...mine,
        { id: "meeting-mine", personDocId: person.docId, source: "diary", externalRef: "会议", occurredAt: Date.now(), localDate: "2026-09-26", note: "共同会议" },
        { id: "meeting-other", personDocId: "乙", source: "diary", externalRef: "会议", occurredAt: Date.now(), localDate: "2026-09-26" },
    ], tombstones: [] };
    let failDelete = true;
    let changed = 0;
    const plugin = {
        loadData: async () => JSON.parse(JSON.stringify(saved)),
        saveData: async (_key, value) => { if (!failDelete) saved = JSON.parse(JSON.stringify(value)); },
    };
    mounted = mount(PersonDetail, { target: fixture, props: {
        settings, person, onRecord: async () => {},
        onLoadInsights: async () => {
            const store = await loadInteractionStore(plugin);
            return { timeline: buildTimeline(store.events, person.docId), coAttendance: buildCoAttendance(store.events, person.docId).map((item) => ({ ...item, name: "乙" })), totalEvents: store.events.filter((item) => item.personDocId === person.docId).length };
        },
        onDeleteInteraction: (personDocId, eventId) => deleteInteraction(plugin, eventId, personDocId),
        onOpenPersonDoc() {}, onNavigate() {}, onChanged() { changed += 1; }, onDeleted() {}, onClose() {},
    } });
    button("互动").click();
    await until(() => fixture.querySelectorAll(".lvct-detail__timeline-row").length === 20, "时间线未分批显示");
    const longNote = fixture.querySelector(".lvct-detail__timeline-note");
    assert(longNote.scrollWidth <= longNote.clientWidth + 1, "长备注溢出时间线");
    assert(getComputedStyle(longNote).whiteSpace === "normal", "长备注仍被截断而无法阅读");
    button("加载更多").click();
    await until(() => fixture.querySelectorAll(".lvct-detail__timeline-row").length === 27, "旧互动无法继续浏览");
    const search = fixture.querySelector('input[aria-label="搜索互动备注或日期"]');
    input(search, "不存在的备注");
    await until(() => fixture.textContent.includes("没有匹配的互动"), "搜索空结果没有提示");
    button("清除筛选").click();
    await tick();
    assert(fixture.querySelectorAll(".lvct-detail__timeline-row").length === 20, "清除筛选未恢复首批结果");
    const source = fixture.querySelector('select[aria-label="互动来源"]');
    source.value = "diary";
    source.dispatchEvent(new Event("change", { bubbles: true }));
    await until(() => fixture.querySelectorAll(".lvct-detail__timeline-row").length === 1, "来源筛选未生效");
    assert(fixture.textContent.includes("与 乙 同场 1 次"), "共同出席统计缺失");
    const originalConfirm = window.confirm;
    try {
        window.confirm = () => false;
        button("删除", fixture.querySelector(".lvct-detail__timeline-row")).click();
        await tick();
        assert(saved.events.length === 28 && changed === 0, "取消删除仍修改记录");
        window.confirm = (message) => { assert(message.includes("其他参与者"), "删除确认未说明范围"); return true; };
        button("删除", fixture.querySelector(".lvct-detail__timeline-row")).click();
        await until(() => fixture.textContent.includes("存储写入未收敛"), "删除失败未显示错误");
        assert(saved.events.length === 28 && changed === 0, "删除失败丢失记录");
        failDelete = false;
        button("删除", fixture.querySelector(".lvct-detail__timeline-row")).click();
        await until(() => fixture.textContent.includes("没有匹配的互动"), "成功后时间线未刷新");
        assert(changed === 1 && saved.tombstones.includes("meeting-mine"), "成功删除未刷新统计或写墓碑");
        assert(saved.events.some((item) => item.id === "meeting-other"), "删除了其他参与者记录");
        assert(!fixture.textContent.includes("与 乙 同场 1 次"), "删除后共同出席统计未刷新");
    } finally { window.confirm = originalConfirm; }
});

await test("人物互动删除在锁内检查归属，不能删除他人事件", async () => {
    let saved = "";
    let writes = 0;
    const plugin = {
        loadData: async () => JSON.parse(JSON.stringify(saved)),
        saveData: async (_key, value) => { writes += 1; saved = JSON.parse(JSON.stringify(value)); },
    };
    const store = await recordInteraction(plugin, { personDocId: "乙" });
    const before = writes;
    let message = "";
    try { await deleteInteraction(plugin, store.events[0].id, "甲"); } catch (error) { message = error.message; }
    assert(message.includes("不属于当前人物") && writes === before, "归属不符仍执行删除");
    assert((await loadInteractionStore(plugin)).events.length === 1, "他人事件被误删");
});

await pause(100);
results.push({ name: "无未处理异常及响应式循环", ok: runtimeErrors.length === 0, detail: runtimeErrors.join("\n") });
document.querySelector("#results").textContent = JSON.stringify(results, null, 2);
await fetch("/__ui_report", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(results) });
