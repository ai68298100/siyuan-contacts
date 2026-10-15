import { mount, unmount, tick, createRawSnippet } from "svelte";
import RelationGraph from "../../../src/components/graph/RelationGraph.svelte";
import LvctDialog from "../../../src/components/LvctDialog.svelte";
import { invalidateRoster } from "../../../src/services/roster";
import { DEFAULT_VIEW_PREFERENCES } from "../../../src/domain/preferences";
import { loadGraphSources, loadGraphReferences } from "../../../src/services/graph-query";
import { buildGraphQuerySnapshot } from "../../../src/domain/graph-query";
import { renderGraphSnapshotMarkdown } from "../../../src/domain/graph-export";
import { KernelPermissionError } from "../../../src/api/kernel-contract";
import { nativeRefsFixture, nativeRefsQueryCenter } from "./native-refs-fixture";

const personId = (index) => `20261004000000-p${String(index).padStart(6, "0")}`;
const itemId = (index) => `20261004000000-i${String(index).padStart(6, "0")}`;
const orgId = "20261004000000-org0001";

function rows(count) {
    return Array.from({ length: count }, (_, index) => ({ id: itemId(index), cells: [
        { valueType: "block", value: { keyID: "name", type: "block", block: { id: personId(index), content: index < 2 ? "同名[*]" : index === 2 ? "长姓名与组织资料[*]".repeat(12) : `成员${index}` } } },
        { valueType: "relation", value: { keyID: "related", type: "relation", relation: { blockIDs: index < 2 ? [itemId(index + 1)] : [] } } },
    ] }));
}

function organizations(count) {
    return [{ docId: orgId, name: "测试组织", archived: false, memberships: Array.from({ length: count }, (_, index) => ({
        id: `20261004000000-m${String(index).padStart(6, "0")}`, orgDocId: orgId, personDocId: personId(index),
        status: "active", joinedOn: "", leftOn: "", department: "", title: "",
    })) }];
}

function query(partial = {}) {
    return { mode: "relations", scope: "global", centerDocId: "", orgDocId: "", search: "", group: "", isolatedOnly: false,
        showOrgs: true, depth: "direct", focusId: "", compareId: "", queryMode: "common", ...partial };
}

function select(element, value) {
    element.value = value;
    element.dispatchEvent(new Event("change", { bubbles: true }));
}

export async function runGraphQueryRegression({ test, assert, kernel, settings, fixture, until, button }) {
    await test("图谱重试加载：在途请求锁定按钮并阻止重复读取", async () => {
        let avCalls = 0;
        let releaseRetry;
        kernel.handler = async (route) => {
            if (route !== "/api/av/renderAttributeView") throw new Error(`图谱重试夹具拒绝请求：${route}`);
            avCalls += 1;
            if (avCalls === 1) throw new Error("首次名册读取失败");
            if (avCalls === 2) return new Promise((resolve) => { releaseRetry = resolve; });
            return { view: { columns: [], rows: rows(3) } };
        };
        invalidateRoster();
        const instance = mount(RelationGraph, { target: fixture, props: { settings, preferences: DEFAULT_VIEW_PREFERENCES,
            onPreferencesChange: async (next) => next, onOpenPeople() {}, onOpenDetail() {} } });
        try {
            await until(() => fixture.textContent.includes("图谱加载失败"), "首次图谱读取失败态未显示");
            const retry = button("重新加载");
            retry.click();
            await until(() => avCalls === 2 && fixture.textContent.includes("正在加载关系图谱") && !retry.isConnected,
                "图谱重试没有显示加载态或隐藏旧重试入口");
            retry.click();
            assert(avCalls === 2, "图谱在途重试发生重复读取");
            releaseRetry({ view: { columns: [], rows: rows(3) } });
            await until(() => !fixture.textContent.includes("图谱加载失败") && fixture.textContent.includes("已显示核实部分"), "图谱重试成功后未恢复完成态");
        } finally { await unmount(instance); }
    });

    await test("图谱偏好保存：迟到旧结果不清理新草稿或覆盖错误态", async () => {
        kernel.handler = async (route) => {
            if (route === "/api/av/renderAttributeView") return { view: { columns: [], rows: rows(3) } };
            throw new Error(`图谱偏好夹具拒绝请求：${route}`);
        };
        invalidateRoster();
        let resolveOld;
        let rejectOld;
        const preferenceCalls = [];
        const instance = mount(RelationGraph, { target: fixture, props: { settings, preferences: DEFAULT_VIEW_PREFERENCES,
            onPreferencesChange: async (next) => {
                preferenceCalls.push(next);
                if (next.graphMode === "native") return new Promise((resolve, reject) => { resolveOld = resolve; rejectOld = reject; });
                return next;
            }, onOpenPeople() {}, onOpenDetail() {} } });
        try {
            await until(() => fixture.textContent.includes("已显示核实部分"), "图谱偏好测试初始状态未完成");
            button("文档引用").click();
            await until(() => preferenceCalls.length === 1, "文档引用偏好未发起保存");
            button("关系图").click();
            await until(() => preferenceCalls.length === 2 && !fixture.textContent.includes("图谱偏好保存失败"), "新偏好保存未完成或错误态提前出现");
            rejectOld(new Error("旧保存迟到失败"));
            await new Promise((resolve) => setTimeout(resolve, 0));
            await tick();
            assert(!fixture.textContent.includes("旧保存迟到失败") && !fixture.textContent.includes("重试保存"), "迟到旧失败覆盖了最新偏好结果");
            resolveOld?.(DEFAULT_VIEW_PREFERENCES);
        } finally { if (resolveOld) resolveOld(DEFAULT_VIEW_PREFERENCES); await unmount(instance); }
    });

    await test("图查询实际来源：登记组织引用、三种边分源及导出快照一致", async () => {
        const calls = [];
        kernel.handler = async (route, body) => {
            calls.push({ route, body });
            if (route === "/api/av/renderAttributeView") return { view: { columns: [], rows: rows(3) } };
            if (route === "/api/query/sql") return nativeRefsFixture(body.stmt, { nodes: [orgId, personId(0), personId(2), personId(99)].map((id) => ({ id, label: id })),
                links: [{ from: orgId, to: personId(0) }, { from: personId(0), to: personId(99) }] });
            throw new Error(`图查询夹具拒绝请求：${route}`);
        };
        invalidateRoster();
        const orgs = organizations(3);
        // One person has both a current and a historical record; another only
        // has historical membership so every lifecycle label is exercised.
        orgs[0].memberships.push({ id: "20261004000000-mixed", orgDocId: orgId, personDocId: personId(0),
            status: "former", joinedOn: "2024-01-01", leftOn: "2025-01-01", department: "", title: "" });
        orgs[0].memberships[2].status = "former";
        orgs[0].memberships[2].leftOn = "2025-01-01";
        const sources = await loadGraphSources(settings, { listOrganizations: async () => orgs, loadSelfIdentity: async () => ({ selfDocId: personId(0) }) }, 1);
        orgs[0].memberships[0].status = "former";
        assert(sources.organizations[0].memberships[0].status === "active", "来源快照被后续修改混入");
        const related = buildGraphQuerySnapshot(sources, query({ focusId: personId(0), compareId: personId(2), queryMode: "path" }));
        const memberEdges = related.graph.edges.filter((edge) => edge.kind === "member");
        assert(memberEdges.find((edge) => edge.target === personId(0))?.memberStatus === "mixed", "成员边没有合并当前与历史状态");
        assert(memberEdges.find((edge) => edge.target === personId(2))?.memberStatus === "former", "仅历史成员边状态缺失");
        const relatedMarkdown = renderGraphSnapshotMarkdown(related, "2026-10-04");
        assert(relatedMarkdown.includes("组织成员（member）·当前+历史") && relatedMarkdown.includes("组织成员（member）·历史"), "Markdown 未导出成员生命周期标签");
        assert(related.result.pathIds.join(",") === [personId(0), personId(1), personId(2)].join(","), "成员边污染人物最短路径");
        const nativeQuery = query({ mode: "native", scope: "org", orgDocId: orgId });
        const references = await loadGraphReferences(sources, nativeQuery);
        const native = buildGraphQuerySnapshot(sources, nativeQuery, references);
        const referenceReads = calls.filter((call) => call.route === "/api/query/sql" && String(call.body.stmt).includes("FROM refs"));
        assert(referenceReads.length === 1, "引用查询重复请求内核");
        assert(nativeRefsQueryCenter(referenceReads[0].body.stmt) === orgId, "未按稳定组织 ID 请求中心");
        assert(!calls.some((call) => call.route.startsWith("/api/graph/")), "只读引用图覆盖宿主图配置");
        assert(native.graph.edges.length === 1 && native.graph.edges[0].kind === "ref", "引用边来源缺失或无关笔记污染图");
        const markdown = renderGraphSnapshotMarkdown(native, "2026-10-04");
        assert(markdown.includes(`展示节点 ${native.graph.nodes.length} / 边 ${native.graph.edges.length}`) && markdown.includes("文档块引用（ref）"), "导出与快照不一致");
        const failed = await loadGraphSources(settings, { listOrganizations() { throw new Error("同步读取故障"); }, loadSelfIdentity: async () => null }, 2);
        assert(failed.status.roster === "verified" && failed.status.organizations === "unknown" && failed.errors.organizations.includes("同步读取故障"), "一个来源同步失败覆盖其他已核实来源");
        let releaseSelf;
        const observed = organizations(3);
        const pending = loadGraphSources(settings, { listOrganizations: async () => observed,
            loadSelfIdentity: () => new Promise((resolve) => { releaseSelf = resolve; }) }, 3);
        await until(() => releaseSelf, "本人来源没有挂起");
        await new Promise((resolve) => setTimeout(resolve, 0));
        observed[0].memberships[0].status = "former";
        releaseSelf(null);
        assert((await pending).organizations[0].memberships[0].status === "active", "等待其他来源时已核实成员被后续变更污染");
    });

    await test("图文本界面：千人裁剪保中心、键盘节点和 390px 换行，文本无需画布", async () => {
        kernel.handler = async (route) => {
            if (route === "/api/av/renderAttributeView") return { view: { columns: [], rows: rows(1001) } };
            throw new Error(`图文本夹具拒绝请求：${route}`);
        };
        invalidateRoster();
        const opened = [];
        const previousWidth = fixture.style.width;
        fixture.style.width = "390px";
        let detailDialog;
        const textOrganizations = organizations(1001);
        textOrganizations[0].memberships.push({ id: "20261004000000-mixed-text", orgDocId: orgId, personDocId: personId(0),
            status: "former", joinedOn: "2024-01-01", leftOn: "2025-01-01", department: "", title: "" });
        const instance = mount(RelationGraph, { target: fixture, props: { settings, preferences: DEFAULT_VIEW_PREFERENCES,
            onPreferencesChange: async (next) => next, onOpenPeople() {}, onOpenDetail: (person) => {
                opened.push(person.docId);
                detailDialog = mount(LvctDialog, { target: document.body, props: { title: person.name, wide: true,
                    onClose() { const current = detailDialog; detailDialog = null; void unmount(current); },
                    children: createRawSnippet(() => ({ render: () => "<p>图谱只读详情测试</p>" })) } });
            },
            facade: { listOrganizations: async () => textOrganizations, loadSelfIdentity: async () => ({ selfDocId: personId(1000) }) } } });
        try {
            button("文本视图").click();
            await until(() => fixture.textContent.includes("查询完成"), "来源读取未完成");
            select(fixture.querySelector('[aria-label="关系图范围"]'), "self");
            await until(() => fixture.querySelector(`[data-graph-id="${personId(1000)}"]`), "低度本人中心被裁掉");
            const center = fixture.querySelector(`[data-graph-id="${personId(1000)}"]`);
            center.focus();
            assert(document.activeElement === center, "文本人物按钮无法键盘聚焦");
            center.click();
            assert(opened[0] === personId(1000), "同名/低度人物打开目标错误");
            await until(() => document.querySelector(".lvct-dialog-panel"), "详情没有打开");
            await tick();
            document.querySelector(".lvct-dialog-panel__close").click();
            await until(() => document.activeElement === center, "关闭详情没有返回文本触发按钮");
            center.click();
            await until(() => document.querySelector(".lvct-dialog-panel"), "第二次详情没有打开");
            await tick();
            select(fixture.querySelector('[aria-label="关系图范围"]'), "global");
            await until(() => fixture.textContent.includes("裁剪 202 节点"), "统一预算未包含组织或裁剪计数错误");
            document.querySelector(".lvct-dialog-panel__close").click();
            await until(() => document.activeElement?.textContent === "当前图查询", "原文本目标不可见时没有返回结果标题");
            assert(!fixture.querySelector(".lvct-graph-view__canvas"), "文本视图仍要求画布");
            assert(fixture.textContent.includes("组织成员（member）") && fixture.textContent.includes("显式人物关系（related）"), "文本没有边来源");
            assert(fixture.textContent.includes("组织成员（member）·当前+历史"), "文本没有成员当前+历史生命周期标签");
            const textView = fixture.querySelector(".lvct-graph-text");
            assert(textView.scrollWidth <= textView.clientWidth + 2, "文本视图横向溢出");
            textView.style.fontSize = "200%";
            assert(textView.scrollWidth <= textView.clientWidth + 2, "大字号长内容横向溢出");
            button("继续列出节点与边").click();
            await until(() => fixture.querySelectorAll("[data-graph-id]").length === 200, "渐进文本分页丢项");
        } finally {
            if (detailDialog) await unmount(detailDialog);
            await unmount(instance);
            fixture.style.width = previousWidth;
        }
    });

    await test("图查询界面：组织读取未知、失效中心、引用失败保持选择且能降级", async () => {
        let orgFail = true;
        let nativeCalls = 0;
        kernel.handler = async (route) => {
            if (route === "/api/av/renderAttributeView") return { view: { columns: [], rows: rows(3) } };
            if (route === "/api/query/sql") { nativeCalls += 1; throw new Error("引用图权限失败"); }
            throw new Error(`图未知夹具拒绝请求：${route}`);
        };
        invalidateRoster();
        const instance = mount(RelationGraph, { target: fixture, props: { settings,
            preferences: { ...DEFAULT_VIEW_PREFERENCES, nativeScope: "person", nativeCenterDocId: personId(99) },
            onPreferencesChange: async (next) => next, onOpenPeople() {}, onOpenDetail() {},
            facade: { listOrganizations: async () => {
                if (orgFail) throw new KernelPermissionError("/api/organization/list", 403, "组织权限失败-原始响应");
                return organizations(3);
            }, loadSelfIdentity: async () => ({ selfDocId: personId(0) }) } } });
        try {
            await until(() => fixture.textContent.includes("没有访问这部分数据的权限"), "组织权限错误没有显示统一提示");
            assert(!fixture.textContent.includes("组织权限失败-原始响应") && !fixture.textContent.includes("/api/organization/list"),
                "组织权限提示泄露内核路由或原始响应");
            assert(fixture.textContent.includes("登记 未知"), "未知组织总量显示正常 0");
            button("文档引用").click();
            await until(() => fixture.textContent.includes("图查询范围尚未核实"), "失效中心自动回退本人");
            assert(nativeCalls === 0, "失效中心仍调用全局端点");
            button("切换全局范围").click();
            await until(() => fixture.textContent.includes("引用图权限失败"), "引用失败被显示成空引用");
            button("切换关系图").click();
            await until(() => fixture.textContent.includes("已显示核实部分"), "引用错误阻断纯人物关系图");
            orgFail = false;
            button("文本视图").click();
            select(fixture.querySelector('[aria-label="关系图范围"]'), "org");
            await until(() => fixture.textContent.includes("图查询范围尚未核实"), "无所选组织显示正常空态");
            button("重新核实来源").click();
            await until(() => fixture.querySelector('[aria-label="按组织收窄"]'), "重试未恢复健康组织");
            select(fixture.querySelector('[aria-label="按组织收窄"]'), orgId);
            await until(() => fixture.querySelector(`[data-graph-id="${orgId}"]`), "组织聚焦未使用原 ID");
        } finally { await unmount(instance); }
    });

    await test("图引用界面：迟到响应和销毁后回调不覆盖当前中心", async () => {
        let releaseOld;
        const calls = [];
        kernel.handler = async (route, body) => {
            if (route === "/api/av/renderAttributeView") return { view: { columns: [], rows: rows(3) } };
            if (route === "/api/query/sql") {
                const center = nativeRefsQueryCenter(body.stmt);
                if (String(body.stmt).includes("FROM refs")) {
                    calls.push(center);
                    if (center === personId(0)) return new Promise((resolve) => { releaseOld = resolve; });
                    return [];
                }
                return nativeRefsFixture(body.stmt, { nodes: [orgId, personId(0), personId(1)].map((id) => ({ id, label: "新中心" })), links: [] });
            }
            throw new Error(`图迟到夹具拒绝请求：${route}`);
        };
        invalidateRoster();
        let instance = mount(RelationGraph, { target: fixture, props: { settings, preferences: { ...DEFAULT_VIEW_PREFERENCES, graphMode: "native" },
            onPreferencesChange: async (next) => next, onOpenPeople() {}, onOpenDetail() {},
            facade: { listOrganizations: async () => organizations(3), loadSelfIdentity: async () => ({ selfDocId: personId(0) }) } } });
        try {
            await until(() => releaseOld, "旧引用请求没有挂起");
            button("文本视图").click();
            select(fixture.querySelector('[aria-label="引用图范围"]'), "org");
            select(fixture.querySelector('[aria-label="按组织收窄"]'), orgId);
            await until(() => fixture.querySelector(`[data-graph-id="${orgId}"]`), "新组织中心未完成核实");
            assert(calls.join(",") === [personId(0), orgId].join(","), "切组织中心未请求正确原 ID");
            releaseOld([{ root_id: personId(0), def_block_root_id: personId(1) }]);
            await new Promise((resolve) => setTimeout(resolve, 0));
            await tick();
            assert(fixture.querySelectorAll("[data-graph-id]").length === 1 && fixture.querySelector(`[data-graph-id="${orgId}"]`), "迟到引用覆盖新的组织中心");
            select(fixture.querySelector('[aria-label="引用图范围"]'), "self");
            await until(() => calls.length === 3, "重开本人中心没有发出核实请求");
            button("关系图").click();
            await until(() => fixture.textContent.includes("查询完成"), "切关系图仍停在引用忙碌");
            releaseOld([]);
            await new Promise((resolve) => setTimeout(resolve, 0));
            await tick();
            assert(fixture.querySelectorAll("[data-graph-id]").length === 4 && calls.length === 3, "迟到引用覆盖关系图或重复请求");
            button("文档引用").click();
            await until(() => calls.length === 4, "重开引用没有核实原中心");
            await unmount(instance);
            instance = null;
            releaseOld([]);
            await tick();
            assert(!fixture.querySelector(".lvct-graph-view"), "已销毁图谱被迟到回调重新挂载");
        } finally {
            if (releaseOld) releaseOld([]);
            if (instance) await unmount(instance);
        }
    });
}
