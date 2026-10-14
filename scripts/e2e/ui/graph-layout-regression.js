import { mount, unmount, tick } from "svelte";
import RelationGraph from "../../../src/components/graph/RelationGraph.svelte";
import { invalidateRoster } from "../../../src/services/roster";
import { DEFAULT_VIEW_PREFERENCES } from "../../../src/domain/preferences";

const personId = (index) => `20261012000000-l${String(index).padStart(6, "0")}`;
const itemId = (index) => `20261012000000-j${String(index).padStart(6, "0")}`;
const orgId = "20261012000000-orglay1";

function rows() {
    return Array.from({ length: 4 }, (_, index) => ({ id: itemId(index), cells: [
        { valueType: "block", value: { keyID: "name", type: "block", block: { id: personId(index), content: `图谱布局联系人${index}` } } },
        { valueType: "relation", value: { keyID: "related", type: "relation", relation: { blockIDs: index < 2 ? [itemId(index + 1)] : [] } } },
    ] }));
}

function organizations() {
    return [{ docId: orgId, name: "图谱布局测试组织", archived: false, memberships: Array.from({ length: 3 }, (_, index) => ({
        id: `20261012000000-k${String(index).padStart(6, "0")}`, orgDocId: orgId, personDocId: personId(index),
        status: "active", joinedOn: "", leftOn: "", department: "", title: "",
    })) }];
}

const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
async function settleSize() { await tick(); await frame(); await frame(); }
function canvas(fixture) { return fixture.querySelector(".lvct-graph-view__canvas"); }
// Cytoscape 的容器注册表指向真实 renderer；仅测试侧读取，不在生产组件增加调试接口。
function graph(fixture) { return canvas(fixture)?._cyreg?.cy; }
function center(cy) {
    const pan = cy.pan();
    return { x: (cy.width() / 2 - pan.x) / cy.zoom(), y: (cy.height() / 2 - pan.y) / cy.zoom() };
}
function rgb(value) {
    const match = String(value).match(/^rgba?\(([^)]+)\)$/);
    if (!match) throw new Error(`无法读取图谱实际颜色：${value}`);
    const channels = match[1].split(/[,\s/]+/).filter(Boolean).map(Number);
    if (channels.length < 3 || channels.some((channel) => !Number.isFinite(channel))) {
        throw new Error(`图谱颜色不是有效的 RGB：${value}`);
    }
    if (channels.length > 3 && channels[3] < 0.99) throw new Error(`图谱信息颜色依赖透明背景，无法核对对比度：${value}`);
    return channels.slice(0, 3);
}
function luminance(channels) {
    const linear = channels.map((channel) => channel / 255)
        .map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
    return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}
function contrast(left, right) {
    const a = luminance(left);
    const b = luminance(right);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
function tool(fixture, label, assert) {
    const found = fixture.querySelector(`.lvct-graph__fab button[aria-label="${label}"]`);
    assert(found, `未找到图谱操作：${label}`);
    assert(!found.disabled, `图谱已就绪但操作不可用：${label}`);
    return found;
}

export async function runGraphLayoutRegression({ test, assert, kernel, settings, fixture, until, button }) {
    function prepare(contactRows = rows()) {
        kernel.handler = async (route) => {
            if (route === "/api/av/renderAttributeView") return { view: { columns: [], rows: contactRows } };
            throw new Error(`图谱布局夹具拒绝请求：${route}`);
        };
        invalidateRoster();
    }
    function mountGraph(callbacks = {}) {
        const { facade: facadeOverrides = {}, preferences: preferenceOverrides = {}, ...handlers } = callbacks;
        return mount(RelationGraph, { target: fixture, props: { settings, preferences: { ...DEFAULT_VIEW_PREFERENCES, ...preferenceOverrides },
            onPreferencesChange: async (next) => next, onOpenPeople() {}, onOpenDetail() {}, onOpenOrgs() {},
            facade: { listOrganizations: async () => organizations(), loadSelfIdentity: async () => ({ selfDocId: personId(0) }),
                loadPersonInsights: async () => ({ timeline: [], coAttendance: [], totalEvents: 0 }), ...facadeOverrides },
            ...handlers,
        } });
    }

    await test("图谱空名册：说明、创建与联系人入口均可用", async () => {
        prepare([]);
        let createRequests = 0;
        let peopleRequests = 0;
        const instance = mountGraph({ onOpenCreatePerson: () => { createRequests += 1; },
            onOpenPeople: () => { peopleRequests += 1; },
            facade: { listOrganizations: async () => [], loadSelfIdentity: async () => null } });
        try {
            await until(() => fixture.querySelector(".lvct-view-state__content[role='status']")
                && fixture.textContent.includes("还没有联系人"), "空名册没有呈现联系人专属空态");
            assert(!graph(fixture), "空名册错误地挂载了没有数据的图谱画布");
            assert(fixture.textContent.includes("创建或导入联系人后"), "空名册缺少下一步说明");
            assert(fixture.querySelector(".lvct-view-state__content[role='status'] b")?.textContent === "还没有联系人",
                "空名册空态标题没有说明当前状态");
            assert(![...fixture.querySelectorAll("button")].some((node) => node.textContent.trim() === "清除筛选"),
                "空名册不应显示没有作用的清除筛选操作");
            const create = button("新建联系人", fixture);
            const people = button("前往联系人", fixture);
            create.click();
            people.click();
            assert(createRequests === 1 && peopleRequests === 1,
                `空态入口没有分别触发创建与联系人导航：create=${createRequests}, people=${peopleRequests}`);
        } finally { await unmount(instance); }
    });

    await test("文档引用图空名册：空集合是已核实空结果并说明登记前置条件", async () => {
        prepare([]);
        const faultStart = kernel.faultLog.length;
        let createRequests = 0;
        const instance = mountGraph({ preferences: { graphMode: "native", nativeScope: "global" },
            facade: { listOrganizations: async () => [], loadSelfIdentity: async () => null },
            onOpenCreatePerson: () => { createRequests += 1; } });
        try {
            await until(() => fixture.querySelector(".lvct-view-state__content[role='status']")
                && fixture.textContent.includes("还没有可绘制的登记文档"), "文档引用图空名册没有显示对应说明");
            assert(fixture.textContent.includes("没有引用不代表没有关联"), "文档引用图空态没有说明双链的含义");
            assert(!kernel.faultLog.slice(faultStart).some((entry) => entry.route === "/api/query/sql"), "空登记集合不应请求空白名单 SQL");
            button("新建联系人", fixture).click();
            assert(createRequests === 1, "文档引用空态的新建联系人入口没有触发回调");
        } finally { await unmount(instance); }
    });

    await test("图谱布局：首屏大画布、紧凑状态和可展开控件按阅读顺序呈现", async () => {
        prepare();
        const instance = mountGraph();
        try {
            await until(() => graph(fixture)?.nodes().length === 5, "默认没有显示完整关系画布");
            await settleSize();
            const view = fixture.querySelector(".lvct-graph-view");
            const summary = fixture.querySelector(".lvct-graph-summary");
            const wrap = fixture.querySelector(".lvct-graph-view__canvas-wrap");
            const filters = fixture.querySelector(".lvct-graph-advanced");
            const explore = fixture.querySelector(".lvct-graph-explore");
            assert(!fixture.querySelector(".lvct-graph-text"), "默认画布被文本结果占据");
            assert(!filters.open && !explore.open, "低频筛选或关系探索默认占据图谱空间");
            assert(filters.querySelector("summary").getBoundingClientRect().height > 0, "折叠筛选没有可发现入口");
            assert(summary.querySelectorAll("dt").length === 2, "状态带仍堆叠重复统计卡");
            assert(wrap.compareDocumentPosition(summary) & Node.DOCUMENT_POSITION_FOLLOWING, "详细图查询摘要抢在主画布前");
            assert(wrap.compareDocumentPosition(explore) & Node.DOCUMENT_POSITION_FOLLOWING, "关系探索挡在图谱前方");
            const minHeight = window.innerWidth <= 640 ? 400 : 480;
            assert(canvas(fixture).getBoundingClientRect().height >= minHeight - 2, `画布低于${minHeight}px 的可读空间`);
            if (window.innerWidth <= 640) {
                const canvasBounds = canvas(fixture).getBoundingClientRect();
                const fabBounds = fixture.querySelector(".lvct-graph__fab").getBoundingClientRect();
                assert(fabBounds.top >= canvasBounds.top - 1 && fabBounds.bottom <= canvasBounds.bottom + 1,
                    `移动端图谱操作栏没有完整留在画布区域内：canvas=${JSON.stringify({ top: canvasBounds.top, bottom: canvasBounds.bottom })}, fab=${JSON.stringify({ top: fabBounds.top, bottom: fabBounds.bottom })}, media=${window.matchMedia("(max-width: 640px)").matches}, css=${JSON.stringify({ position: getComputedStyle(fixture.querySelector(".lvct-graph__fab")).position, top: getComputedStyle(fixture.querySelector(".lvct-graph__fab")).top, bottom: getComputedStyle(fixture.querySelector(".lvct-graph__fab")).bottom })}`);
                assert(fabBounds.top <= canvasBounds.top + 24,
                    `移动端图谱操作栏没有锚定在画布上沿：canvasTop=${canvasBounds.top.toFixed(1)}, fabTop=${fabBounds.top.toFixed(1)}`);
            }
            assert(view.scrollWidth <= view.clientWidth + 2, "图谱页面横向溢出");
            filters.querySelector("summary").click();
            await until(() => filters.open, "范围与筛选入口点击无反应");
            assert(fixture.querySelector('[aria-label="关系图范围"]').getBoundingClientRect().height > 0, "展开后范围选择仍不可见");
            filters.querySelector("summary").click();
            await until(() => !filters.open, "范围筛选无法收起");
            explore.querySelector("summary").click();
            await until(() => explore.open, "关系探索入口点击无反应");
            const centerGroup = fixture.querySelector('[role="group"][aria-label="关系中心"]');
            const compareGroup = fixture.querySelector('[role="group"][aria-label="对比人物"]');
            assert(centerGroup?.getBoundingClientRect().height > 0, "展开关系探索后选人器不可见");
            assert(compareGroup, "对比人物控件缺少独立分组名称");
            assert(!centerGroup.closest("label") && !compareGroup.closest("label"), "分组标签不应包裹自定义选人器按钮");
            assert(centerGroup.querySelector(".lvct-picker__trigger")?.getAttribute("aria-label") === "关系中心"
                && compareGroup.querySelector(".lvct-picker__trigger")?.getAttribute("aria-label") === "对比人物",
            "关系探索选人器缺少与分组一致的可访问名称");
            const isolated = fixture.querySelector(".lvct-graph-isolated input");
            assert(isolated, "关系图筛选缺少仅无关系人物入口");
            assert(!isolated.checked, "仅无关系人物筛选不应默认开启");
            const search = fixture.querySelector('input[aria-label="搜索关系图谱节点"]');
            assert(search.getAttribute("aria-controls") === "lvct-graph-results"
                && search.getAttribute("aria-describedby") === "lvct-graph-status",
            "图谱搜索没有关联动态结果和状态播报");
            const beforeIsolated = graph(fixture)?.nodes().length;
            isolated.click();
            await until(() => graph(fixture)?.nodes().length === 1, "仅无关系人物筛选没有留下单独的孤立联系人");
            assert(graph(fixture).nodes()[0].id() === personId(3), "仅无关系人物筛选展示了错误联系人或组织节点");
            isolated.click();
            await until(() => graph(fixture)?.nodes().length === beforeIsolated, "关闭无关系筛选没有恢复画布结果");
        } finally { await unmount(instance); }
    });

    await test("图谱布局：画布与等价文本互换、定位回图且旧画布正确销毁", async () => {
        prepare();
        const opened = [];
        const openedOrganizations = [];
        const sourceIds = [];
        let sourceFail = true;
        const instance = mountGraph({ onOpenDetail: (person) => opened.push(person.docId),
            onOpenOrgs: (docId) => openedOrganizations.push(docId), facade: { openDoc(docId) {
            sourceIds.push(docId);
            if (sourceFail) throw new Error("来源暂时不可达");
        } } });
        try {
            await until(() => graph(fixture)?.nodes().length === 5, "画布未准备好");
            const old = graph(fixture);
            const ids = old.nodes().map((node) => node.id()).sort();
            button("文本视图").click();
            await until(() => fixture.querySelector(".lvct-graph-text"), "点击文本视图未呈现文本结果");
            assert(!canvas(fixture) && old.destroyed(), "文本模式保留了不可见画布或旧 renderer");
            assert(button("文本视图").getAttribute("aria-pressed") === "true", "文本模式没有明确选中态");
            const textIds = [...fixture.querySelectorAll("[data-graph-id]")].map((node) => node.dataset.graphId).sort();
            assert(JSON.stringify(textIds) === JSON.stringify(ids), "文本节点与图谱实际快照不一致");
            const organization = fixture.querySelector(`[data-graph-id="${orgId}"]`);
            const openOrganization = [...organization.closest("li").querySelectorAll("button")]
                .find((candidate) => candidate.textContent.trim() === "打开组织视图");
            assert(openOrganization, "文本模式组织行缺少打开组织视图操作");
            openOrganization.click();
            assert(openedOrganizations[0] === orgId, "文本模式组织入口没有传递所选组织文档 ID");
            const person = fixture.querySelector(`[data-graph-id="${personId(1)}"]`);
            const source = button("打开来源文档", person.closest("li"));
            source.click();
            await until(() => fixture.querySelector('[role="alert"]')?.textContent.includes("来源文档暂时无法打开"),
                "来源打开失败没有可读说明");
            assert(sourceIds[0] === personId(1) && !source.disabled && source.isConnected,
                "来源失败后正确入口丢失、被锁定或打开了错误文档");
            sourceFail = false;
            source.click();
            await until(() => !fixture.querySelector('[role="alert"]')
                && [...fixture.querySelectorAll('[role="status"]')].some((node) => node.textContent.includes("已请求打开来源文档")),
            "重新打开请求完成后旧错误未清除或没有明确反馈");
            assert(sourceIds.join(",") === [personId(1), personId(1)].join(","), "来源重试没有复用稳定文档 ID");
            person.focus();
            assert(document.activeElement === person, "文本节点无法通过键盘聚焦");
            person.click();
            assert(opened[0] === personId(1), "文本节点打开了错误人物");
            button("定位画布", person.closest("li")).click();
            await until(() => graph(fixture)?.getElementById(personId(1)).hasClass("lvct-graph-focus"), "定位画布没有聚焦所选节点");
            assert(!fixture.querySelector(".lvct-graph-text"), "定位回图后文本仍重复展示");
            assert(button("画布视图").getAttribute("aria-pressed") === "true", "定位后画布选中态没有同步");
            assert(document.activeElement === canvas(fixture), "定位后焦点没有进入画布");
            assert(JSON.stringify(graph(fixture).nodes().map((node) => node.id()).sort()) === JSON.stringify(ids), "切换呈现方式改变了图谱数据");
        } finally { await unmount(instance); }
    });

    await test("图谱布局：异步来源打开期间锁定重复操作，失败保留入口且重试恢复", async () => {
        prepare();
        const sourceIds = [];
        let pending;
        let fail = true;
        const instance = mountGraph({ facade: { openDoc(docId) {
            sourceIds.push(docId);
            if (!fail) return Promise.resolve();
            return new Promise((resolve, reject) => { pending = { resolve, reject }; });
        } } });
        try {
            await until(() => graph(fixture)?.nodes().length === 5, "画布未准备好");
            button("文本视图").click();
            await until(() => fixture.querySelector(".lvct-graph-text"), "文本来源入口未呈现");
            const person = fixture.querySelector(`[data-graph-id="${personId(1)}"]`);
            const source = button("打开来源文档", person.closest("li"));
            const sources = [...fixture.querySelectorAll(".lvct-graph-text button")]
                .filter((node) => node.textContent.trim() === "打开来源文档");
            source.click();
            await until(() => pending && source.disabled && source.textContent.includes("正在打开"),
                "异步打开来源时没有加载反馈与提交锁");
            assert(source.getAttribute("aria-busy") === "true", "异步来源打开未声明忙碌状态");
            assert(sources.length === 5 && sources.every((node) => node.disabled), "打开期间其他来源入口仍能重复触发");
            source.click();
            sources.find((node) => node !== source).dispatchEvent(new MouseEvent("click", { bubbles: true }));
            await tick();
            assert(sourceIds.length === 1 && sourceIds[0] === personId(1), "重复点击或其他来源触发了第二次打开");
            fail = false;
            pending.reject(new Error("异步来源不可达"));
            pending = null;
            await until(() => fixture.querySelector('[role="alert"]')?.textContent.includes("来源文档暂时无法打开")
                && !source.disabled && source.textContent.trim() === "打开来源文档", "异步失败未反馈或没有恢复原入口");
            assert(sources.every((node) => !node.disabled), "异步来源失败后仍锁住其他入口");
            assert(source.getAttribute("aria-busy") !== "true", "异步失败后忙碌状态未清除");
            source.click();
            await until(() => !source.disabled && !fixture.querySelector('[role="alert"]')
                && [...fixture.querySelectorAll('[role="status"]')].some((node) => node.textContent.includes("已请求打开来源文档")),
            "异步失败后重试未恢复请求状态或缺少明确回执");
            assert(sourceIds.join(",") === [personId(1), personId(1)].join(","), "异步重试打开了错误的来源身份");
        } finally {
            pending?.resolve();
            await unmount(instance);
        }
    });

    await test("图谱布局：展开还原、容器缩放保持图心，视图工具产生实际绘图结果", async () => {
        prepare();
        const oldWidth = fixture.style.width;
        const instance = mountGraph();
        try {
            await until(() => graph(fixture)?.nodes().length === 5, "画布未准备好");
            await settleSize();
            const cy = graph(fixture);
            cy.zoom(1.1);
            cy.pan({ x: cy.width() / 2 - 110, y: cy.height() / 2 + 27.5 });
            const originalCenter = center(cy);
            const originalHeight = canvas(fixture).getBoundingClientRect().height;
            tool(fixture, "展开大图", assert).click();
            await until(() => fixture.querySelector(".lvct-graph-view__canvas-wrap--expanded")
                && cy.height() > originalHeight + 30, "展开大图没有实际增加 renderer 的高度");
            await settleSize();
            assert(graph(fixture) === cy, "展开大图重新创建了数据画布");
            assert(tool(fixture, "收起大图", assert).getAttribute("aria-pressed") === "true", "展开操作没有选中反馈");
            assert(Math.abs(center(cy).x - originalCenter.x) < 2 && Math.abs(center(cy).y - originalCenter.y) < 2, "展开大图丢失原图心");
            assert(Math.abs(cy.zoom() - 1.1) < 0.001, "展开画布擅自改变用户缩放");

            const oldCanvasWidth = cy.width();
            fixture.style.width = "280px";
            await until(() => Math.abs(cy.width() - oldCanvasWidth) > 30, "宿主容器变宽窄后 renderer 尺寸没有同步");
            await settleSize();
            assert(Math.abs(cy.width() - canvas(fixture).clientWidth) < 4, "renderer 与真实容器宽度不一致");
            assert(Math.abs(center(cy).x - originalCenter.x) < 2 && Math.abs(center(cy).y - originalCenter.y) < 2, "容器缩放使图心偏移");
            const canvasBounds = canvas(fixture).getBoundingClientRect();
            const toolbarBounds = fixture.querySelector(".lvct-graph__fab").getBoundingClientRect();
            assert(toolbarBounds.left >= canvasBounds.left - 1 && toolbarBounds.right <= canvasBounds.right + 1,
                "窄容器内图谱操作簇溢出画布，部分操作不可见");
            const zoom = cy.zoom();
            tool(fixture, "放大", assert).click();
            await until(() => cy.zoom() > zoom, "放大按钮没有改变实际缩放");
            assert(Math.abs(center(cy).x - originalCenter.x) < 2 && Math.abs(center(cy).y - originalCenter.y) < 2, "放大没有围绕可见图心");
            tool(fixture, "缩小", assert).click();
            await until(() => Math.abs(cy.zoom() - zoom) < 0.001, "缩小按钮不能恢复前一缩放");
            tool(fixture, "适应", assert).click();
            const bounds = cy.nodes().renderedBoundingBox();
            assert(bounds.x1 >= -2 && bounds.y1 >= -2 && bounds.x2 <= cy.width() + 2 && bounds.y2 <= cy.height() + 2, "适应按钮没有将节点置于可见画布");
            let layouts = 0;
            cy.one("layoutstart", () => { layouts += 1; });
            tool(fixture, "重新布局", assert).click();
            await until(() => layouts === 1, "重新布局按钮没有触发布局");
            tool(fixture, "收起大图", assert).click();
            await until(() => !fixture.querySelector(".lvct-graph-view__canvas-wrap--expanded")
                && Math.abs(canvas(fixture).getBoundingClientRect().height - originalHeight) < 4, "收起大图未还原画布高度");
        } finally {
            await unmount(instance);
            fixture.style.width = oldWidth;
        }
    });

    await test("图谱布局：触屏点组织后保留可进入组织的入口与来源线型", async () => {
        prepare();
        const orgOpens = [];
        const sourceIds = [];
        const instance = mountGraph({ onOpenOrgs: (id) => orgOpens.push(id), facade: { openDoc: (id) => sourceIds.push(id) } });
        try {
            await until(() => graph(fixture)?.nodes().length === 5, "组织图谱未准备好");
            const cy = graph(fixture);
            const member = cy.edges().filter((edge) => edge.data("kind") === "member"
                && [edge.source().id(), edge.target().id()].includes(personId(2)));
            assert(member.length === 1 && member[0].style("line-style") === "dashed", "组织成员没有连线或来源线型");
            // 只发送 tap，不触发 mouseover；触屏使用者也必须获得详情入口。
            cy.getElementById(orgId).emit({ type: "tap", originalEvent: { pointerType: "touch" } });
            await until(() => fixture.querySelector(".lvct-graph-view__hover-card")
                && graph(fixture)?.nodes().length === 4, "点组织完成聚焦后没有保留可点击信息卡");
            const card = fixture.querySelector(".lvct-graph-view__hover-card");
            assert(card.getAttribute("aria-label")?.includes("图谱布局测试组织"), "组织信息卡名称不正确");
            assert(fixture.querySelector(".lvct-graph-summary").textContent.includes("组织中心"), "组织点击未切换到对应范围");
            button("打开组织视图", card).click();
            assert(orgOpens.length === 1 && orgOpens[0] === orgId, "组织信息卡没有导航至点击组织的稳定身份");
            button("打开来源文档", card).click();
            assert(sourceIds[0] === orgId, "组织信息卡打开了错误来源文档");
            const current = graph(fixture);
            current.getElementById(personId(1)).emit({ type: "mouseover",
                renderedPosition: { x: current.width() - 2, y: current.height() - 2 } });
            await until(() => fixture.querySelector(".lvct-graph-view__hover-card")?.getAttribute("aria-label")
                === `人物 图谱布局联系人1 的图谱信息`, "已选组织信息卡遮挡了人物悬停摘要");
            await until(() => fixture.querySelector(".lvct-graph-view__hover-card")?.textContent.includes("最近互动：暂无记录"),
                "人物信息卡没有显示真实加载的互动摘要");
            await settleSize();
            const personCardBounds = fixture.querySelector(".lvct-graph-view__hover-card").getBoundingClientRect();
            const graphBounds = canvas(fixture).getBoundingClientRect();
            assert(personCardBounds.left >= graphBounds.left - 1 && personCardBounds.right <= graphBounds.right + 1
                && personCardBounds.top >= graphBounds.top - 1 && personCardBounds.bottom <= graphBounds.bottom + 1,
                "靠画布右下角的悬停卡在摘要回填后溢出画布，来源或详情操作不可达");
            assert(button("查看人物详情", fixture.querySelector(".lvct-graph-view__hover-card")), "人物信息卡缺少明确详情入口");
            button("打开来源文档", fixture.querySelector(".lvct-graph-view__hover-card")).click();
            assert(sourceIds[1] === personId(1), "人物信息卡打开了错误来源文档");
            current.getElementById(personId(1)).emit("mouseout");
            await until(() => fixture.querySelector(".lvct-graph-view__hover-card")?.getAttribute("aria-label")
                === "组织 图谱布局测试组织 的图谱信息", "离开人物后未恢复先前选中的组织信息");
            graph(fixture).emit("tap");
            await until(() => !fixture.querySelector(".lvct-graph-view__hover-card"), "点击图谱空白不能关闭组织信息卡");
        } finally { await unmount(instance); }
    });

    await test("图谱布局：明暗主题真实连线对比度达标且主题切换同步画布", async () => {
        prepare();
        const previousTheme = document.documentElement.getAttribute("data-theme-mode");
        const instance = mountGraph();
        try {
            await until(() => graph(fixture)?.edges().length > 0, "图谱连线未准备好");
            const cy = graph(fixture);
            const colors = {};
            for (const theme of ["light", "dark"]) {
                document.documentElement.setAttribute("data-theme-mode", theme);
                await settleSize();
                assert(graph(fixture) === cy, "主题切换重新建立了图谱数据");
                const surface = rgb(getComputedStyle(canvas(fixture)).backgroundColor);
                colors[theme] = cy.edges()[0].style("line-color");
                for (const edge of cy.edges()) {
                    const ratio = contrast(rgb(edge.style("line-color")), surface);
                    assert(ratio >= 3, `${theme === "light" ? "浅色" : "暗色"}主题 ${edge.data("kind")} 连线对比度只有 ${ratio.toFixed(2)}:1，低于 3:1`);
                }
            }
            assert(colors.light !== colors.dark, "明暗主题切换没有更新真实 renderer 的连线色");
        } finally {
            if (previousTheme === null) document.documentElement.removeAttribute("data-theme-mode");
            else document.documentElement.setAttribute("data-theme-mode", previousTheme);
            await unmount(instance);
        }
    });

    await test("图谱布局：选中与搜索命中在主题切换后保持可辨认的节点描边", async () => {
        prepare();
        const previousTheme = document.documentElement.getAttribute("data-theme-mode");
        const instance = mountGraph();
        try {
            await until(() => graph(fixture)?.nodes().length === 5, "图谱未准备好");
            const explore = fixture.querySelector(".lvct-graph-explore");
            explore.querySelector("summary").click();
            await tick();
            fixture.querySelector('.lvct-picker__trigger[aria-label="关系中心"]').click();
            await until(() => fixture.querySelector(".lvct-picker__panel"), "关系中心选人器未打开");
            const pickerSearch = fixture.querySelector(".lvct-picker__search");
            pickerSearch.value = "图谱布局联系人1";
            pickerSearch.dispatchEvent(new Event("input", { bubbles: true }));
            await tick();
            const option = [...fixture.querySelectorAll(".lvct-picker__option")]
                .find((node) => node.textContent.includes("图谱布局联系人1"));
            assert(option, "关系中心候选不存在");
            option.click();
            await until(() => graph(fixture)?.getElementById(personId(1)).hasClass("lvct-graph-focus"), "真实选择没有高亮关系中心");
            const selectedGraph = graph(fixture);
            for (const theme of ["light", "dark"]) {
                document.documentElement.setAttribute("data-theme-mode", theme);
                await settleSize();
                const node = graph(fixture).getElementById(personId(1));
                const surface = getComputedStyle(canvas(fixture)).backgroundColor;
                assert(graph(fixture) === selectedGraph && node.hasClass("lvct-graph-focus"), "主题切换丢失了关系中心选择");
                assert(Number.parseFloat(node.style("border-width")) >= 4, "选中描边在主题切换后退回普通节点尺寸");
                const focusBorder = node.style("border-color");
                const focusContrast = contrast(rgb(focusBorder), rgb(surface));
                assert(focusContrast >= 3,
                    `主题切换后的关系中心描边对比度不足：contrast=${focusContrast.toFixed(2)}:1, border=${JSON.stringify(focusBorder)}, text=${JSON.stringify(node.style("color"))}, background=${JSON.stringify(node.style("background-color"))}, themeText=${JSON.stringify(node.data("themeText"))}, themeSurface=${JSON.stringify(node.data("themeSurface"))}, classes=${JSON.stringify(node.classes())}, theme=${document.documentElement.getAttribute("data-theme-mode")}, surface=${surface}`);
            }
            button("清除选择").click();
            await until(() => !graph(fixture).getElementById(personId(1)).hasClass("lvct-graph-focus"), "关系选择未清除");
            const search = fixture.querySelector('input[aria-label="搜索关系图谱节点"]');
            search.value = "图谱布局联系人1";
            search.dispatchEvent(new Event("input", { bubbles: true }));
            await until(() => graph(fixture)?.nodes().length === 1
                && graph(fixture).getElementById(personId(1)).hasClass("lvct-graph-hit"), "真实搜索未高亮命中节点");
            const searchedGraph = graph(fixture);
            for (const theme of ["dark", "light"]) {
                document.documentElement.setAttribute("data-theme-mode", theme);
                await settleSize();
                const node = graph(fixture).getElementById(personId(1));
                const surface = getComputedStyle(canvas(fixture)).backgroundColor;
                assert(graph(fixture) === searchedGraph && node.hasClass("lvct-graph-hit") && search.value === "图谱布局联系人1",
                    "主题切换丢失搜索条件或命中标记");
                const hitBorder = node.style("border-color");
                const hitContrast = contrast(rgb(hitBorder), rgb(surface));
                assert(Number.parseFloat(node.style("border-width")) >= 3 && hitContrast >= 3,
                    `主题切换后的搜索命中描边不可辨认：contrast=${hitContrast.toFixed(2)}:1, border=${JSON.stringify(hitBorder)}, text=${JSON.stringify(node.style("color"))}, background=${JSON.stringify(node.style("background-color"))}, themeText=${JSON.stringify(node.data("themeText"))}, themeSurface=${JSON.stringify(node.data("themeSurface"))}, classes=${JSON.stringify(node.classes())}, theme=${document.documentElement.getAttribute("data-theme-mode")}, surface=${surface}`);
            }
        } finally {
            if (previousTheme === null) document.documentElement.removeAttribute("data-theme-mode");
            else document.documentElement.setAttribute("data-theme-mode", previousTheme);
            await unmount(instance);
        }
    });

    await test("图谱布局：销毁时断开尺寸观察、销毁 renderer，晚到 resize 不污染页面", async () => {
        prepare();
        const OriginalObserver = window.ResizeObserver;
        const observers = [];
        const oldWidth = fixture.style.width;
        window.ResizeObserver = class extends OriginalObserver {
            constructor(callback) { super(callback); this.seen = new Set(); this.disconnected = false; observers.push(this); }
            observe(target, options) { this.seen.add(target); return super.observe(target, options); }
            disconnect() { this.disconnected = true; return super.disconnect(); }
        };
        let instance;
        try {
            instance = mountGraph();
            await until(() => graph(fixture)?.nodes().length === 5, "画布未准备好");
            await settleSize();
            const element = canvas(fixture);
            const cy = graph(fixture);
            const attached = observers.filter((observer) => observer.seen.has(element));
            assert(attached.length > 0, "真实画布未注册尺寸观察");
            fixture.style.width = "280px";
            await tick();
            await unmount(instance);
            instance = null;
            await frame();
            await frame();
            assert(cy.destroyed() && !element.isConnected && !element._cyreg?.cy, "卸载仍留下可运行 renderer");
            assert(attached.every((observer) => observer.disconnected), "卸载没有断开画布尺寸观察");
            assert(!fixture.querySelector(".lvct-graph-view"), "晚到尺寸事件重新挂载了图谱");
        } finally {
            if (instance) await unmount(instance);
            window.ResizeObserver = OriginalObserver;
            fixture.style.width = oldWidth;
        }
    });
}
