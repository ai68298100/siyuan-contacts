import { mount, unmount, tick, createRawSnippet } from "svelte";
import RelationGraph from "../../../src/components/graph/RelationGraph.svelte";
import LvctDialog from "../../../src/components/LvctDialog.svelte";
import { invalidateRoster } from "../../../src/services/roster";
import { DEFAULT_VIEW_PREFERENCES } from "../../../src/domain/preferences";
import { loadGraphSources, loadGraphReferences } from "../../../src/services/graph-query";
import { buildGraphQuerySnapshot } from "../../../src/domain/graph-query";
import { renderGraphSnapshotMarkdown } from "../../../src/domain/graph-export";

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
    await test("图查询实际来源：登记组织引用、三种边分源及导出快照一致", async () => {
        const calls = [];
        kernel.handler = async (route, body) => {
            calls.push({ route, body });
            if (route === "/api/av/renderAttributeView") return { view: { columns: [], rows: rows(3) } };
            if (route === "/api/graph/getLocalGraph") return { nodes: [orgId, personId(0), personId(2), personId(99)].map((id) => ({ id, label: id, type: "NodeDocument", refs: 0, defs: 0 })),
                links: [{ from: orgId, to: personId(0) }, { from: personId(0), to: personId(99) }] };
            throw new Error(`图查询夹具拒绝请求：${route}`);
        };
        invalidateRoster();
        const orgs = organizations(3);
        const sources = await loadGraphSources(settings, { listOrganizations: async () => orgs, loadSelfIdentity: async () => ({ selfDocId: personId(0) }) }, 1);
        orgs[0].memberships[0].status = "former";
        assert(sources.organizations[0].memberships[0].status === "active", "来源快照被后续修改混入");
        const related = buildGraphQuerySnapshot(sources, query({ focusId: personId(0), compareId: personId(2), queryMode: "path" }));
        assert(related.result.pathIds.join(",") === [personId(0), personId(1), personId(2)].join(","), "成员边污染人物最短路径");
        const nativeQuery = query({ mode: "native", scope: "org", orgDocId: orgId });
        const references = await loadGraphReferences(sources, nativeQuery);
        const native = buildGraphQuerySnapshot(sources, nativeQuery, references);
        assert(calls.filter((call) => call.route === "/api/graph/getLocalGraph").length === 1, "引用查询重复请求内核");
        assert(calls.find((call) => call.route === "/api/graph/getLocalGraph").body.id === orgId, "未按稳定组织 ID 请求中心");
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
        const instance = mount(RelationGraph, { target: fixture, props: { settings, preferences: DEFAULT_VIEW_PREFERENCES,
            onPreferencesChange: async (next) => next, onOpenPeople() {}, onOpenDetail: (person) => {
                opened.push(person.docId);
                detailDialog = mount(LvctDialog, { target: document.body, props: { title: person.name, peek: true,
                    onClose() { const current = detailDialog; detailDialog = null; void unmount(current); },
                    children: createRawSnippet(() => ({ render: () => "<p>图谱只读详情测试</p>" })) } });
            },
            facade: { listOrganizations: async () => organizations(1001), loadSelfIdentity: async () => ({ selfDocId: personId(1000) }) } } });
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
            if (route === "/api/graph/getGraph") { nativeCalls += 1; throw new Error("引用图权限失败"); }
            throw new Error(`图未知夹具拒绝请求：${route}`);
        };
        invalidateRoster();
        const instance = mount(RelationGraph, { target: fixture, props: { settings,
            preferences: { ...DEFAULT_VIEW_PREFERENCES, nativeScope: "person", nativeCenterDocId: personId(99) },
            onPreferencesChange: async (next) => next, onOpenPeople() {}, onOpenDetail() {},
            facade: { listOrganizations: async () => { if (orgFail) throw new Error("组织权限失败"); return organizations(3); }, loadSelfIdentity: async () => ({ selfDocId: personId(0) }) } } });
        try {
            await until(() => fixture.textContent.includes("组织权限失败"), "组织读取错误被吞掉");
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
            if (route === "/api/graph/getLocalGraph") {
                calls.push(body.id);
                if (body.id === personId(0)) return new Promise((resolve) => { releaseOld = resolve; });
                return { nodes: [{ id: body.id, label: "新中心", type: "NodeDocument", refs: 0, defs: 0 }], links: [] };
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
            releaseOld({ nodes: [personId(0), personId(1)].map((id) => ({ id, label: "过期中心", type: "NodeDocument", refs: 0, defs: 0 })),
                links: [{ from: personId(0), to: personId(1) }] });
            await new Promise((resolve) => setTimeout(resolve, 0));
            await tick();
            assert(fixture.querySelectorAll("[data-graph-id]").length === 1 && fixture.querySelector(`[data-graph-id="${orgId}"]`), "迟到引用覆盖新的组织中心");
            select(fixture.querySelector('[aria-label="引用图范围"]'), "self");
            await until(() => calls.length === 3, "重开本人中心没有发出核实请求");
            button("关系图").click();
            await until(() => fixture.textContent.includes("查询完成"), "切关系图仍停在引用忙碌");
            releaseOld({ nodes: [{ id: personId(0), label: "过期中心", type: "NodeDocument", refs: 0, defs: 0 }], links: [] });
            await new Promise((resolve) => setTimeout(resolve, 0));
            await tick();
            assert(fixture.querySelectorAll("[data-graph-id]").length === 4 && calls.length === 3, "迟到引用覆盖关系图或重复请求");
            button("文档引用").click();
            await until(() => calls.length === 4, "重开引用没有核实原中心");
            await unmount(instance);
            instance = null;
            releaseOld({ nodes: [], links: [] });
            await tick();
            assert(!fixture.querySelector(".lvct-graph-view"), "已销毁图谱被迟到回调重新挂载");
        } finally {
            if (releaseOld) releaseOld({ nodes: [], links: [] });
            if (instance) await unmount(instance);
        }
    });
}
