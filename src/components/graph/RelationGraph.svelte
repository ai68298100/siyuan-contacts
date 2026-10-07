<script lang="ts">
    /** 关系图谱：cytoscape 力导向布局，节点=联系人，边=related 关系，点击节点开文档 */
    import cytoscape from "cytoscape";
    import { onDestroy, onMount, tick, untrack } from "svelte";
    import { getFrontend } from "siyuan";
    import { Scan, ZoomIn, ZoomOut, Network, RefreshCw } from "@lucide/svelte";
    import ViewState from "../ViewState.svelte";
    import { loadGraphSources, loadGraphReferences } from "../../services/graph-query";
    import { GRAPH_MAX_NODES } from "../../domain/graph";
    import { buildGraphQuerySnapshot, graphEdgeLabel } from "../../domain/graph-query";
    import type { GraphSources, GraphQuery, GraphReferenceSource, GraphScope } from "../../domain/graph-query";
    import type { GraphNode } from "../../domain/graph";
    import type { GraphViewMode, ViewPreferences } from "../../domain/preferences";
    import { renderGraphSnapshotMarkdown } from "../../domain/graph-export";
    import { translateText } from "../../domain/translation";
    import type { ContactsSettings } from "../../domain/model";
    import type { ContactSummary } from "../../domain/person";
    import type { PersonInsights } from "../../services/insights";
    import type { ContactsPluginFacade } from "../../types";
    import PersonPicker from "../people/PersonPicker.svelte";
    import type { PickerItem } from "../people/PersonPicker.svelte";

    let {
        settings,
        revision = 0,
        facade,
        i18n,
        preferences,
        onPreferencesChange,
        onOpenDetail,
        onOpenPeople,
        onOpenOrgs,
    }: {
        settings: ContactsSettings;
        revision?: number;
        facade?: ContactsPluginFacade;
        i18n?: Readonly<Record<string, string>>;
        /** B14.5：图谱数据源模式保存在视图偏好中，重开仍用用户选定模式 */
        preferences: ViewPreferences;
        onPreferencesChange: (next: ViewPreferences) => Promise<ViewPreferences>;
        onOpenDetail: (person: ContactSummary) => void;
        onOpenPeople: () => void;
        /** B14 组织入口（可选）：点击组织节点跳转组织视图；未接线时组织节点点击无动作 */
        onOpenOrgs?: () => void;
    } = $props();
    const text = $derived.by(() => (key: string, fallback: string, values?: Record<string, string | number>) =>
        translateText(i18n, key, fallback, values));

    let container: HTMLElement | undefined = $state();
    let sources: GraphSources = $state({ people: [], organizations: [], selfDocId: null,
        status: { roster: "unknown", organizations: "unknown", self: "unknown" }, errors: {}, revision: 0 });
    const people = $derived(sources.people);
    let loading: boolean = $state(true);
    let errorText: string = $state("");
    // svelte-ignore state_referenced_locally
    let graphMode: GraphViewMode = $state(preferences.graphMode);
    let references: GraphReferenceSource = $state({ status: "unknown", graph: { nodes: [], edges: [] } });
    let nativeLoading = $state(false);
    let nativeVersion = 0;
    /* B14.8 引用图范围（B14.5 重开保留）：self=本人中心一度；person=指定联系人中心；global=全部登记文档 */
    // svelte-ignore state_referenced_locally
    let nativeScope: GraphScope = $state(preferences.nativeScope);
    // svelte-ignore state_referenced_locally
    let nativeCenterDocId = $state(preferences.nativeCenterDocId);
    /* B14.6 组织增强：组织节点+成员边只叠加渲染，关系查询仍只按 related 边 */
    let showOrgs = $state(true);
    let relationScope: GraphScope = $state("global");
    let relationCenterDocId = $state("");
    const frontend = getFrontend();
    let presentation: "canvas" | "text" = $state(frontend === "mobile" || frontend === "browser-mobile" ? "text" : "canvas");
    let graphFiltersOpen = $state(frontend !== "mobile" && frontend !== "browser-mobile");
    let textLimit = $state(100);
    let resultHeading: HTMLElement | undefined = $state();
    let canvasFocusId = $state("");
    let preferenceError = $state("");
    let alive = true;
    let returnObserver: MutationObserver | undefined;
    /* B14.8 按组织收窄（会话态：组织可能被归档/改名，不持久化） */
    let orgNarrowId = $state("");
    let searchText: string = $state("");
    let groupFilter: string = $state("");
    let isolatedOnly = $state(false);
    let relationDepth: "direct" | "second" = $state("direct");
    let graphInstance: cytoscape.Core | null = $state.raw(null);
    let focusId = $state("");
    let compareId = $state("");
    let queryMode: "common" | "path" = $state("common");
    let hoveredPerson: ContactSummary | null = $state(null);
    /* B14：组织节点 hover 卡（与人物 hover 互斥） */
    let hoveredOrg: { id: string; label: string; degree: number } | null = $state(null);
    let hoverInsights: PersonInsights | null = $state(null);
    let hoverInsightsLoading = $state(false);
    let hoverInsightsError = $state(false);
    let hoverPosition: { x: number; y: number } = $state({ x: 12, y: 12 });
    let hoverTimer: ReturnType<typeof setTimeout> | undefined;
    let clearHoverTimer: ReturnType<typeof setTimeout> | undefined;
    let refreshVersion = 0;
    let hoverInsightsVersion = 0;
    const groupLegend = [
        { label: "家人", className: "family" },
        { label: "朋友", className: "friend" },
        { label: "同事", className: "work" },
        { label: "同学", className: "school" },
        { label: "其他", className: "other" },
        { label: "组织", className: "org" },
    ] as const;

    const groups = $derived.by(() => [...new Set(snapshot.people.map((person) => person.group).filter(Boolean))].sort());
    /* B03 可搜索选人器：图内节点 → 候选项（带分组提示与联系方式关键词） */
    const graphPickerItems = $derived.by((): PickerItem[] => snapshot.people.map((person) => {
        return {
            id: person.docId,
            label: person.name,
            docId: person.docId,
            itemId: person.itemId,
            hint: [person.group, person.phone || person.email, ...person.tags].filter(Boolean).join(" · ") || undefined,
            keywords: `${person.phone} ${person.wechat} ${person.email}`.toLowerCase(),
        };
    }));
    /* B14.8 按组织收窄：选中组织后画布人物=该组织成员（成员边来自组织覆盖层） */
    const query: GraphQuery = $derived({ mode: graphMode, scope: graphMode === "native" ? nativeScope : relationScope,
        centerDocId: graphMode === "native" ? nativeCenterDocId : relationCenterDocId, orgDocId: orgNarrowId,
        search: searchText, group: groupFilter, isolatedOnly, showOrgs, depth: relationDepth, focusId, compareId, queryMode });
    const snapshot = $derived(buildGraphQuerySnapshot(sources, query, references));
    const canvasData = $derived(JSON.stringify(snapshot.graph));
    const snapshotStatusText = $derived.by(() => loading || nativeLoading
        ? text("graphSnapshotLoading", "正在核实图查询…")
        : snapshot.state === "unknown" || snapshot.state === "center_missing" ? "范围尚未核实"
            : snapshot.state === "partial" ? "已显示核实部分" : "查询完成");
    const canvasCanRender = $derived(snapshot.state !== "unknown" && snapshot.state !== "center_missing");
    const orgOverlay = $derived({ nodes: snapshot.organizations });
    const searchNeedle = $derived(searchText.trim().toLowerCase());
    /* B14 原生模式：搜索只按节点 label/ID 过滤，再统一走规模裁剪 */
    const truncated = $derived(snapshot.truncated);
    /* native 模式 hover 卡的图内连接数（related 度数在引用图语境不适用，B14.8 边来源标识）；-1=非本模式。
       先取局部快照：svelte-check 对 $state 跨表达式不收窄（既有坑位） */
    const hoveredNativeDegree = $derived.by(() => {
        const person = hoveredPerson;
        if (graphMode !== "native" || !person) return -1;
        return snapshot.graph.nodes.find((node) => node.id === person.docId)?.degree ?? 0;
    });
    const relations = $derived({ neighborIds: snapshot.result.neighborIds });
    const secondMode = $derived.by(() => !compareId && relationDepth === "second");
    const resultIds = $derived(snapshot.result.ids);
    const resultPeople = $derived(resultIds.map((id) => snapshot.people.find((person) => person.docId === id)).filter((person) => person !== undefined));
    const pathMode = $derived.by(() => Boolean(compareId) && queryMode === "path");
    const pathIds = $derived(snapshot.result.pathIds);
    const pathPeople = $derived(pathIds.map((id) => snapshot.people.find((person) => person.docId === id)).filter((person) => person !== undefined));

    // ---- 查询结果导出（F16） ----
    let resultExportMessage = $state("");
    function exportResultMarkdown() {
        const pad = (value: number) => String(value).padStart(2, "0");
        const now = new Date();
        const markdown = renderGraphSnapshotMarkdown(snapshot, `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`);
        const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
        anchor.download = `小驴人脉_关系结果_${stamp}.md`;
        anchor.click();
        URL.revokeObjectURL(url);
        resultExportMessage = "结果说明已导出为 Markdown";
    }

    onDestroy(() => { alive = false; refreshVersion += 1; nativeVersion += 1; returnObserver?.disconnect(); clearHover(); });

    function openSnapshotPerson(person: ContactSummary) {
        const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        returnObserver?.disconnect();
        onOpenDetail(person);
        void tick().then(() => {
            if (!alive) return;
            const dialog = [...document.querySelectorAll(".lvct-dialog-panel")].at(-1);
            if (!dialog) return;
            returnObserver = new MutationObserver(() => {
                if (dialog.isConnected || document.querySelector(".lvct-dialog-panel")) return;
                returnObserver?.disconnect();
                void tick().then(() => {
                    if (!alive) return;
                    const active = document.activeElement;
                    if (active instanceof HTMLElement && active !== document.body && active.isConnected) return;
                    const target = trigger?.isConnected ? trigger : [...document.querySelectorAll<HTMLElement>("[data-graph-id]")].find((element) => element.dataset.graphId === person.docId);
                    (target ?? resultHeading)?.focus();
                });
            });
            returnObserver.observe(document.body, { childList: true, subtree: true });
        });
    }

    async function locateNode(id: string) {
        presentation = "canvas";
        canvasFocusId = id;
        await tick();
        const node = graphInstance?.getElementById(id);
        if (node?.nonempty()) { graphInstance?.fit(node.closedNeighborhood(), 60); node.addClass("lvct-graph-focus"); }
        container?.focus();
    }

    $effect(() => {
        const instance = graphInstance;
        const selected = focusId;
        const other = compareId;
        const hits = pathMode ? pathIds : resultIds;
        const path = pathMode ? pathIds : null;
        const bridges = secondMode ? relations.neighborIds : [];
        const expandSecond = secondMode;
        const canHighlight = graphMode === "relations" && (snapshot.result.status === "ready" || snapshot.result.status === "no_path");
        if (!instance || instance.destroyed()) return;
        instance.batch(() => {
            instance.elements().removeClass("lvct-graph-muted lvct-graph-focus");
            if (!selected || !canHighlight) return;
            const visible = new Set([selected, other, ...hits, ...bridges]);
            const hitIds = new Set(hits);
            const bridgeIds = new Set(bridges);
            const nextOnPath = new Map((path ?? []).slice(0, -1).map((id, index) => [id, path![index + 1]]));
            instance.nodes().forEach((node) => {
                if (!visible.has(node.id())) node.addClass("lvct-graph-muted");
                if (node.id() === selected || node.id() === other) node.addClass("lvct-graph-focus");
            });
            instance.edges().forEach((edge) => {
                const source = edge.source().id();
                const target = edge.target().id();
                const connectsHit = edge.data("kind") === "related" && (path !== null
                    ? nextOnPath.get(source) === target || nextOnPath.get(target) === source
                    : expandSecond
                    ? (source === selected && bridgeIds.has(target)) || (target === selected && bridgeIds.has(source))
                        || (bridgeIds.has(source) && hitIds.has(target)) || (bridgeIds.has(target) && hitIds.has(source))
                    : (hitIds.has(source) && (target === selected || target === other))
                        || (hitIds.has(target) && (source === selected || source === other)));
                if (!connectsHit) edge.addClass("lvct-graph-muted");
            });
        });
    });

    /** cytoscape 无法用 CSS 变量，挂载时从主题运行时取值 */
    function normalizeGraphColor(value: string, fallback: string): string {
        const normalized = value.trim();
        const match = normalized.match(/^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\)$/i);
        if (!match) return normalized || fallback;
        const channels = match.slice(1, 4).map((channel) => Math.round(Math.max(0, Math.min(1, Number(channel))) * 255));
        const alpha = match[4] === undefined ? 1 : Math.max(0, Math.min(1, Number(match[4])));
        return `rgba(${channels.join(", ")}, ${alpha})`;
    }

    function themeColors(): { text: string; edge: string; surface: string } {
        const probe = container ?? document.body;
        const style = getComputedStyle(probe);
        const resolve = (name: string, fallback: string): string => {
            const value = style.getPropertyValue(name).trim();
            if (!value || !value.includes("color-mix")) return normalizeGraphColor(value, fallback);
            const swatch = document.createElement("span");
            swatch.style.color = `var(${name})`;
            probe.appendChild(swatch);
            const resolved = getComputedStyle(swatch).color;
            swatch.remove();
            return normalizeGraphColor(resolved, fallback);
        };
        return {
            text: resolve("--lvct-text-2", "currentColor"),
            edge: resolve("--lvct-border-subtle", "currentColor"),
            surface: resolve("--lvct-bg-surface", "transparent"),
        };
    }

    function groupColorValue(group: string): string {
        const key: Record<string, string> = {
            "家人": "--lvct-group-family",
            "朋友": "--lvct-group-friend",
            "同事": "--lvct-group-work",
            "同学": "--lvct-group-school",
            "其他": "--lvct-group-other",
        };
        const value = getComputedStyle(container ?? document.body).getPropertyValue(key[group] ?? "--lvct-group-other").trim();
        return normalizeGraphColor(value || getComputedStyle(container ?? document.body).getPropertyValue("--lvct-accent"), "currentColor");
    }

    onMount(() => {
        const updateTheme = () => {
            const instance = graphInstance;
            if (!instance || instance.destroyed()) return;
            const palette = themeColors();
            instance.batch(() => {
                instance.nodes().forEach((node) => { node.data("color", groupColorValue(node.data("group"))); });
                instance.nodes().style({
                    color: palette.text,
                    "border-color": palette.surface,
                    "text-outline-color": palette.surface,
                });
                instance.edges().style("line-color", palette.edge);
            });
        };
        const observer = new MutationObserver(updateTheme);
        for (const target of [document.documentElement, document.body]) {
            observer.observe(target, { attributes: true, attributeFilter: ["class", "style", "data-theme-mode"] });
        }
        return () => observer.disconnect();
    });

    async function refresh() {
        const version = ++refreshVersion;
        loading = true;
        errorText = "";
        try {
            const next = await loadGraphSources(settings, {
                listOrganizations: facade?.listOrganizations ? () => facade.listOrganizations() : undefined,
                loadSelfIdentity: facade?.loadSelfIdentity ? () => facade.loadSelfIdentity() : undefined,
            }, version);
            if (!alive || version !== refreshVersion) return;
            sources = next;
            errorText = next.errors.roster ?? "";
        } catch (error) {
            if (alive && version === refreshVersion) errorText = error instanceof Error ? error.message : String(error);
        } finally {
            if (alive && version === refreshVersion) loading = false;
        }
    }

    /** B14.5：切换数据源模式并持久化偏好；保存失败不阻断本次切换（下次重开回落上次成功保存值） */
    async function switchGraphMode(mode: GraphViewMode) {
        if (graphMode === mode) return;
        graphMode = mode;
        if (mode === "relations") { nativeVersion += 1; nativeLoading = false; }
        preferenceError = "";
        try {
            await onPreferencesChange({ ...preferences, graphMode: mode });
        } catch (error) {
            if (alive) preferenceError = `图谱偏好保存失败：${error instanceof Error ? error.message : String(error)}`;
        }
    }

    /** B14 原生模式加载：范围由 nativeScope 决定（B14.8），登记集合过滤（B14.3）。失败显式降级 */
    async function loadNativeGraph() {
        const version = ++nativeVersion;
        const currentSources = sources;
        const currentQuery = query;
        nativeLoading = true;
        references = { status: "unknown", graph: { nodes: [], edges: [] } };
        try {
            const next = await loadGraphReferences(currentSources, currentQuery);
            if (alive && version === nativeVersion && currentSources === sources && graphMode === "native") {
                references = next;
            }
        } catch (error) {
            if (alive && version === nativeVersion && currentSources === sources && graphMode === "native") {
                references = { status: "unknown", graph: { nodes: [], edges: [] }, error: error instanceof Error ? error.message : String(error) };
            }
        } finally {
            if (alive && version === nativeVersion && currentSources === sources && graphMode === "native") {
                nativeLoading = false;
            }
        }
    }

    $effect(() => {
        if (graphMode !== "native") return;
        nativeScope;
        nativeCenterDocId;
        sources;
        if (nativeScope === "org") orgNarrowId;
        untrack(() => { if (!loading) void loadNativeGraph(); });
    });

    /** B14.8：切换引用图范围并持久化（B14.5 重开保留）；保存失败不阻断本次切换 */
    async function switchNativeScope(next: string) {
        const scope: GraphScope = next === "global" ? "global" : next === "person" ? "person" : next === "org" ? "org" : "self";
        if (nativeScope === scope) return;
        nativeScope = scope;
        try {
            if (scope !== "org") await onPreferencesChange({ ...preferences, nativeScope: scope, nativeCenterDocId });
        } catch (error) {
            if (alive) preferenceError = `引用图范围偏好保存失败：${error instanceof Error ? error.message : String(error)}`;
        }
    }

    async function pickNativeCenter(docId: string) {
        nativeCenterDocId = docId;
        try {
            await onPreferencesChange({ ...preferences, nativeScope: nativeScope === "org" ? "global" : nativeScope, nativeCenterDocId: docId });
        } catch (error) {
            if (alive) preferenceError = `引用图中心偏好保存失败：${error instanceof Error ? error.message : String(error)}`;
        }
    }

    const nativeCenterItems = $derived(snapshot.people.map((person) => ({
        id: person.docId,
        label: person.name,
        docId: person.docId,
        itemId: person.itemId,
        hint: [person.group, person.phone || person.email, ...person.tags].filter(Boolean).join(" · ") || undefined,
    })));

    function zoomBy(factor: number) {
        if (graphInstance) graphInstance.zoom(graphInstance.zoom() * factor);
    }

    function relayout() {
        const instance = graphInstance;
        if (!instance) return;
        instance.layout({
            name: "cose",
            animate: true,
            animationDuration: 300,
            padding: 30,
            nodeDimensionsIncludeLabels: true,
        }).run();
    }

    function clearHover() {
        if (hoverTimer) clearTimeout(hoverTimer);
        if (clearHoverTimer) clearTimeout(clearHoverTimer);
        hoverTimer = undefined;
        clearHoverTimer = undefined;
        hoveredPerson = null;
        hoveredOrg = null;
        hoverInsights = null;
        hoverInsightsLoading = false;
        hoverInsightsError = false;
        hoverInsightsVersion += 1;
    }

    function scheduleClearHover() {
        if (hoverTimer) clearTimeout(hoverTimer);
        hoverTimer = undefined;
        if (clearHoverTimer) clearTimeout(clearHoverTimer);
        clearHoverTimer = setTimeout(() => {
            hoveredPerson = null;
            hoveredOrg = null;
            clearHoverTimer = undefined;
        }, 220);
    }

    function scheduleHover(event: cytoscape.EventObject) {
        const docId = event.target.id();
        const person = people.find((item) => item.docId === docId);
        if (!person) {
            /* B14：组织节点 hover 卡（名称+成员连接数+跳转入口） */
            const orgNode = snapshot.graph.nodes.find((node) => node.id === docId && node.kind === "org");
            if (!orgNode) return;
            if (hoverTimer) clearTimeout(hoverTimer);
            if (clearHoverTimer) clearTimeout(clearHoverTimer);
            const position = event.renderedPosition ?? event.target.renderedPosition();
            hoverTimer = setTimeout(() => {
                const width = container?.clientWidth ?? 420;
                const height = container?.clientHeight ?? 360;
                hoverPosition = {
                    x: Math.min(Math.max(8, position.x + 16), Math.max(8, width - 228)),
                    y: Math.min(Math.max(8, position.y + 16), Math.max(8, height - 150)),
                };
                hoveredPerson = null;
                hoveredOrg = { id: orgNode.id, label: orgNode.label, degree: orgNode.degree };
                hoverTimer = undefined;
            }, 300);
            return;
        }
        if (hoverTimer) clearTimeout(hoverTimer);
        if (clearHoverTimer) clearTimeout(clearHoverTimer);
        const position = event.renderedPosition ?? event.target.renderedPosition();
        hoverTimer = setTimeout(() => {
            const width = container?.clientWidth ?? 420;
            const height = container?.clientHeight ?? 360;
            hoverPosition = {
                x: Math.min(Math.max(8, position.x + 16), Math.max(8, width - 228)),
                y: Math.min(Math.max(8, position.y + 16), Math.max(8, height - 150)),
            };
            hoveredPerson = person;
            if (facade) void loadHoverInsights(person);
            hoverTimer = undefined;
        }, 300);
    }

    async function loadHoverInsights(person: ContactSummary) {
        const client = facade;
        if (!client) return;
        const version = ++hoverInsightsVersion;
        hoverInsightsLoading = true;
        hoverInsightsError = false;
        try {
            const result = await client.loadPersonInsights(person.docId);
            if (version === hoverInsightsVersion && hoveredPerson?.docId === person.docId) hoverInsights = result;
        } catch {
            if (version === hoverInsightsVersion && hoveredPerson?.docId === person.docId) hoverInsightsError = true;
        } finally {
            if (version === hoverInsightsVersion && hoveredPerson?.docId === person.docId) hoverInsightsLoading = false;
        }
    }

    $effect(() => {
        if (!container || presentation !== "canvas" || loading || nativeLoading || !canvasCanRender) return;
        /* B14：数据源按模式切换——关系图用名册投影，文档引用图用内核局部图（均走规模裁剪） */
        const graph: import("../../domain/graph").PersonGraph = JSON.parse(canvasData);
        if (graph.nodes.length === 0) return;
        const palette = themeColors();

        const instance = cytoscape({
            container,
            /* 画布撑满工作台后，小图的 fit 放大不设上限会糊脸（UX-02.13） */
            maxZoom: 2.5,
            elements: [
                ...graph.nodes.map((node) => ({
                    data: {
                        id: node.id,
                        label: node.label,
                        degree: node.degree,
                        group: node.group,
                        kind: node.kind ?? "person",
                        color: groupColorValue(node.group),
                    },
                    classes: searchNeedle ? "lvct-graph-hit" : "",
                })),
                ...graph.edges.map((edge) => ({
                    data: { source: edge.source, target: edge.target, kind: edge.kind ?? "related" },
                })),
            ],
            // 同步完成布局，避免筛选/切页销毁画布后动画帧继续访问 renderer。
            layout: { name: "cose", animate: false, padding: 30, nodeDimensionsIncludeLabels: true },
            style: [
                {
                    selector: "node",
                    style: {
                        label: "data(label)",
                        "background-color": "data(color)",
                        width: "mapData(degree, 0, 6, 24, 48)",
                        height: "mapData(degree, 0, 6, 24, 48)",
                        "font-size": 11,
                        "font-weight": 500,
                        color: palette.text,
                        "text-wrap": "ellipsis",
                        "text-max-width": "88px",
                        "text-outline-width": 2,
                        "text-outline-color": palette.surface,
                        "text-valign": "bottom",
                        "text-margin-y": 4,
                        /* UX-02.4 表面色描边环 + 同色 underlay 光晕 */
                        "border-width": 2,
                        "border-color": palette.surface,
                        "underlay-color": "data(color)",
                        "underlay-opacity": 0.16,
                        "underlay-padding": 6,
                        "underlay-shape": "ellipse",
                    },
                },
                {
                    selector: ".lvct-graph-hit",
                    style: {
                        "border-color": palette.text,
                        "border-width": 3,
                        "underlay-opacity": 0.3,
                        "underlay-padding": 10,
                    },
                },
                {
                    selector: "edge",
                    style: {
                        width: 2,
                        "line-color": palette.edge,
                        "curve-style": "bezier",
                    },
                },
                { selector: ".lvct-graph-muted", style: { opacity: 0.18 } },
                { selector: ".lvct-graph-focus", style: { "border-color": palette.text, "border-width": 4 } },
                /* B14.6：组织节点方形、成员边虚线——与 related 边视觉分源 */
                { selector: 'node[kind = "org"]', style: { shape: "round-rectangle" } },
                { selector: 'edge[kind = "member"]', style: { "line-style": "dashed" } },
            ],
        });
        graphInstance = instance;
        if (searchNeedle && instance.nodes().length > 0) {
            instance.fit(instance.nodes(), 72);
        }

        instance.on("tap", "node", (event: cytoscape.EventObject) => {
            const docId = event.target.id();
            const person = people.find((item) => item.docId === docId);
            if (person) {
                clearHover();
                openSnapshotPerson(person);
                return;
            }
            /* B14 组织入口：组织节点点击跳组织视图 */
            const orgNode = orgOverlay?.nodes.find((node) => node.id === docId);
            if (orgNode) {
                clearHover();
                focusOrganization(docId);
            }
        });
        instance.on("mouseover", "node", scheduleHover);
        instance.on("mouseout", "node", scheduleClearHover);

        return () => {
            clearHover();
            instance.destroy();
            if (graphInstance === instance) graphInstance = null;
        };
    });

    $effect(() => {
        revision;
        void refresh();
    });

    function openHoveredPerson() {
        const person = hoveredPerson;
        clearHover();
        if (person) openSnapshotPerson(person);
    }

    function focusOrganization(id: string) {
        orgNarrowId = id;
        if (graphMode === "relations") relationScope = "org";
        else nativeScope = "org";
        textLimit = 100;
    }

    function clearFilters() {
        searchText = ""; groupFilter = ""; isolatedOnly = false; orgNarrowId = "";
        if (relationScope === "org") relationScope = "global";
        if (nativeScope === "org") nativeScope = "global";
    }

    const nodeById = $derived(new Map(snapshot.graph.nodes.map((node) => [node.id, node])));
    function nodeName(id: string): string { return nodeById.get(id)?.label ?? id; }

    function openTextNode(node: GraphNode) {
        if (node.kind === "org") focusOrganization(node.id);
        else {
            const person = snapshot.people.find((entry) => entry.docId === node.id);
            if (person) openSnapshotPerson(person);
        }
    }
</script>

<style>
    .lvct-graph-view { overflow-y: auto; min-width: 0; }
    .lvct-graph-toolbar { padding: var(--lvct-sp-2); }
    .lvct-graph-toolbar__primary,
    .lvct-graph-toolbar__actions,
    .lvct-graph-toolbar__filters {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        min-width: 0;
        gap: 6px;
    }
    .lvct-graph-toolbar__primary > input { flex: 1 1 220px; min-width: 160px; }
    .lvct-graph-toolbar__primary > .ft__smaller { flex: 0 1 auto; }
    .lvct-graph-toolbar__actions { justify-content: flex-end; }
    .lvct-graph-toolbar__actions > [role="group"] {
        display: inline-flex;
        align-items: center;
        gap: 2px;
        padding: 2px;
        border: 1px solid var(--lvct-border-subtle);
        border-radius: var(--lvct-r-sm);
        background: var(--lvct-bg-app);
    }
    .lvct-graph-toolbar__actions > [role="group"] > .b3-button {
        min-height: 28px;
        border-radius: calc(var(--lvct-r-sm) - 2px);
        transition:
            background var(--lvct-dur-fast) var(--lvct-ease),
            border-color var(--lvct-dur-fast) var(--lvct-ease),
            color var(--lvct-dur-fast) var(--lvct-ease),
            transform var(--lvct-dur-fast) var(--lvct-ease);
    }
    .lvct-graph-toolbar__actions > [role="group"] > .b3-button[aria-pressed="true"] {
        border-color: var(--lvct-border-strong);
        background: var(--lvct-bg-active);
        color: var(--lvct-text-1);
        font-weight: var(--lvct-fw-medium);
    }
    .lvct-graph-toolbar__actions > [role="group"] > .b3-button:focus-visible {
        outline: 2px solid var(--lvct-accent);
        outline-offset: 1px;
    }
    .lvct-graph-toolbar__filters {
        padding-top: 4px;
        border-top: 1px solid var(--lvct-border-subtle);
    }
    .lvct-graph-advanced { min-width: 0; }
    .lvct-graph-advanced > summary { display: none; }
    .lvct-graph-toolbar__filter-group {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 6px;
        min-width: 0;
        padding: 4px 6px;
        border: 1px solid var(--lvct-border-subtle);
        border-radius: var(--lvct-r-md);
        background: var(--lvct-bg-elevated);
    }
    .lvct-graph-toolbar__filter-group--scope { flex: 1 1 520px; }
    .lvct-graph-toolbar__filter-group--refine { flex: 1 1 280px; }
    .lvct-graph-toolbar__filter-group--legend {
        flex: 1 1 100%;
        padding-block: 3px;
        background: transparent;
        border-color: transparent;
    }
    .lvct-graph-toolbar__filter-group .ft__smaller { min-width: 0; overflow-wrap: anywhere; }
    .lvct-graph-summary, .lvct-graph-text {
        flex-shrink: 0;
        min-width: 0;
        padding: 12px;
        color: var(--lvct-text-1);
        background: var(--lvct-bg-surface);
        border: 1px solid var(--lvct-border-subtle);
        border-radius: var(--lvct-r-md);
        box-shadow: var(--lvct-shadow-1);
        overflow-wrap: anywhere;
    }
    .lvct-graph-summary h2,
    .lvct-graph-text h3 { margin: 0 0 8px; font-size: var(--lvct-fs-heading); }
    .lvct-graph-summary p { margin: 6px 0; line-height: var(--lvct-lh-body); }
    .lvct-graph-summary__head {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 12px;
        flex-wrap: wrap;
    }
    .lvct-graph-summary__head h2 { margin-bottom: 0; }
    .lvct-graph-summary__status {
        display: inline-flex;
        align-items: center;
        min-height: 24px;
        padding: 2px 8px;
        border-radius: var(--lvct-r-pill);
        background: var(--lvct-accent-soft);
        margin: 0;
        margin-left: auto;
        color: var(--lvct-accent);
        font-size: var(--lvct-fs-caption);
        font-weight: 600;
        max-width: 100%;
        white-space: normal;
        overflow-wrap: anywhere;
        text-align: right;
    }
    .lvct-graph-summary__status-counts {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip-path: inset(50%);
        white-space: nowrap;
        border: 0;
    }
    .lvct-graph-summary__status--complete {
        background: var(--lvct-success-soft);
        color: var(--lvct-success);
    }
    .lvct-graph-summary__status--partial,
    .lvct-graph-summary__status--loading {
        background: var(--lvct-accent-soft);
        color: var(--lvct-accent);
    }
    .lvct-graph-summary__status--unknown,
    .lvct-graph-summary__status--center_missing {
        background: var(--lvct-highlight-soft);
        color: var(--lvct-highlight);
    }
    .lvct-graph-summary__stats {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 8px;
        margin: 8px 0;
    }
    .lvct-graph-summary__stats > div {
        min-width: 0;
        padding: 6px 8px;
        border: 1px solid var(--lvct-border-subtle);
        border-radius: var(--lvct-r-sm);
        background: var(--lvct-bg-elevated);
    }
    .lvct-graph-summary__stats dt {
        color: var(--lvct-text-3);
        font-size: var(--lvct-fs-caption);
    }
    .lvct-graph-summary__stats dd {
        margin: 3px 0 0;
        color: var(--lvct-text-1);
        font-size: var(--lvct-fs-title);
        font-variant-numeric: tabular-nums;
        font-weight: 650;
    }
    .lvct-graph-summary__details {
        margin-top: 6px;
        border-top: 1px solid var(--lvct-border-subtle);
    }
    .lvct-graph-summary__details > summary {
        display: flex;
        align-items: center;
        min-height: 32px;
        color: var(--lvct-text-2);
        font-size: var(--lvct-fs-caption);
        cursor: pointer;
        list-style: none;
    }
    .lvct-graph-summary__details > summary::-webkit-details-marker { display: none; }
    .lvct-graph-summary__details > summary::after {
        width: 7px;
        height: 7px;
        margin-left: auto;
        border-right: 1px solid currentColor;
        border-bottom: 1px solid currentColor;
        transform: rotate(45deg) translateY(-2px);
        content: "";
    }
    .lvct-graph-summary__details[open] > summary::after { transform: rotate(225deg) translate(-1px, -1px); }
    .lvct-graph-summary__details > summary:focus-visible { outline: 2px solid var(--lvct-accent); outline-offset: 2px; }
    .lvct-graph-summary__details > p:first-of-type { margin-top: 0; }
    .lvct-graph-text { overflow-y: auto; }
    .lvct-graph-text ul, .lvct-graph-text ol { padding-inline-start: 20px; }
    .lvct-graph-text li { margin-block: 10px; }
    .lvct-graph-text__nodes li { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
    .lvct-graph-text__nodes span { flex: 1 1 180px; min-width: 0; }
    .lvct-graph-text button { min-height: 40px; max-width: 100%; white-space: normal; overflow-wrap: anywhere; }
    /* 文本结果按“节点/边”分出轻量行面，避免长列表退化成一串难扫读的正文。 */
    .lvct-graph-text__nodes,
    .lvct-graph-text > ul:not(.lvct-graph-text__nodes) {
        margin: 0;
        padding-inline-start: 0;
        list-style: none;
    }
    .lvct-graph-text__nodes li,
    .lvct-graph-text > ul:not(.lvct-graph-text__nodes) li {
        margin-block: 0;
        padding-block: 8px;
        border-top: 1px solid var(--lvct-border-subtle);
    }
    .lvct-graph-text__nodes li:first-child,
    .lvct-graph-text > ul:not(.lvct-graph-text__nodes) li:first-child {
        padding-top: 2px;
        border-top: 0;
    }
    .lvct-graph-text__nodes span {
        color: var(--lvct-text-2);
        font-size: var(--lvct-fs-caption);
    }
    .lvct-graph-text__nodes li > .b3-button--outline {
        min-height: 32px;
        padding-inline: 10px;
        border-color: var(--lvct-border-subtle);
        color: var(--lvct-text-2);
    }
    .lvct-graph-summary :focus-visible, .lvct-graph-text :focus-visible { outline: 2px solid var(--lvct-accent); outline-offset: 2px; }
    .lvct-graph-diagnostics { max-height: 180px; overflow: auto; }
    @media (max-width: 640px) {
        .lvct-graph-toolbar { padding: var(--lvct-sp-2); }
        .lvct-graph-toolbar__primary,
        .lvct-graph-toolbar__actions,
        .lvct-graph-toolbar__filters { width: 100%; }
        .lvct-graph-advanced { width: 100%; }
        .lvct-graph-advanced > summary {
            display: flex;
            align-items: center;
            min-height: 36px;
            padding: 0 12px;
            border: 1px solid var(--lvct-border-subtle);
            border-radius: var(--lvct-r-md);
            background: var(--lvct-bg-elevated);
            color: var(--lvct-text-2);
            font-size: var(--lvct-fs-caption);
            cursor: pointer;
            list-style: none;
        }
        .lvct-graph-advanced > summary::-webkit-details-marker { display: none; }
        .lvct-graph-advanced > summary::after {
            content: "";
            width: 7px;
            height: 7px;
            margin-left: auto;
            border-right: 1.5px solid var(--lvct-text-3);
            border-bottom: 1.5px solid var(--lvct-text-3);
            transform: rotate(45deg) translateY(-2px);
            transition: transform var(--lvct-dur-fast) var(--lvct-ease);
        }
        .lvct-graph-advanced[open] > summary::after { transform: rotate(225deg) translateY(-2px); }
        .lvct-graph-advanced > summary:focus-visible { outline: 2px solid var(--lvct-accent); outline-offset: 2px; }
        .lvct-graph-advanced .lvct-graph-toolbar__filters { padding-top: 8px; border-top: 0; }
        .lvct-graph-toolbar__primary > input { flex-basis: 100%; min-width: 0; }
        .lvct-graph-toolbar__actions { justify-content: flex-start; }
        .lvct-graph-toolbar__filters { padding-top: 8px; }
        .lvct-graph-toolbar__filter-group { width: 100%; box-sizing: border-box; }
        .lvct-graph-toolbar__filter-group--legend { padding-inline: 2px; }
        /* 移动端把摘要卡收紧到一个信息分组，保留触控高度。 */
        .lvct-graph-summary, .lvct-graph-text { padding: var(--lvct-sp-2) var(--lvct-sp-3); }
        .lvct-graph-summary__stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .lvct-graph-summary__stats { gap: var(--lvct-sp-1); margin-block: var(--lvct-sp-2); }
        .lvct-graph-summary__stats > div { padding: var(--lvct-sp-1) var(--lvct-sp-2); }
        .lvct-graph-summary__stats dd { margin-top: 2px; }
        .lvct-graph-summary__details { margin-top: var(--lvct-sp-1); }
        .lvct-graph-summary__details > summary { min-height: 28px; }
        .lvct-graph-text__nodes li { align-items: flex-start; }
        .lvct-graph-text__nodes span { flex-basis: 100%; }
    }
</style>

<div class="lvct-graph-view">
    <div class="lvct-people__toolbar lvct-people__control-surface lvct-graph-toolbar">
        <!-- B14.5 数据源模式：关系图（related 边）/ 文档引用图（内核原生图数据） -->
        <div class="lvct-graph-toolbar__primary">
            <div class="lvct-graph-mode" role="group" aria-label={text("graphModeLabel", "图谱数据源")}>
                <button
                    class="b3-button b3-button--small"
                    class:b3-button--outline={graphMode === "relations"}
                    class:b3-button--text={graphMode !== "relations"}
                    aria-pressed={graphMode === "relations"}
                    onclick={() => void switchGraphMode("relations")}
                >{text("graphModeRelations", "关系图")}</button>
                <button
                    class="b3-button b3-button--small"
                    class:b3-button--outline={graphMode === "native"}
                    class:b3-button--text={graphMode !== "native"}
                    aria-pressed={graphMode === "native"}
                    onclick={() => void switchGraphMode("native")}
                >{text("graphModeNative", "文档引用")}</button>
            </div>
            <input class="b3-text-field" type="search" placeholder={text("graphSearchPlaceholder", "搜索节点…")} aria-label={text("graphSearchNodes", "搜索关系图谱节点")} bind:value={searchText} />
            {#if searchNeedle}<span class="ft__smaller ft__on-surface">{text("graphSnapshotHits", "筛选后 {n} 个节点（含保留中心）", { n: snapshot.counts.filteredNodes })}</span>{/if}
        </div>
        <div class="lvct-graph-toolbar__actions">
            <div role="group" aria-label={text("graphPresentation", "图谱阅读方式")}>
                <button class="b3-button b3-button--text" aria-pressed={presentation === "text"} onclick={() => (presentation = "text")}>{text("graphTextView", "文本视图")}</button>
                <button class="b3-button b3-button--text" aria-pressed={presentation === "canvas"} onclick={() => (presentation = "canvas")}>{text("graphCanvasView", "画布视图")}</button>
            </div>
            <button class="b3-button b3-button--outline" onclick={exportResultMarkdown} disabled={loading || nativeLoading}>{text("graphSnapshotExport", "导出当前快照")}</button>
        </div>
        <details class="lvct-graph-advanced" bind:open={graphFiltersOpen}>
            <summary>{text("graphFiltersSummary", "范围、分组与图例")}</summary>
            <div class="lvct-graph-toolbar__filters">
            <div class="lvct-graph-toolbar__filter-group lvct-graph-toolbar__filter-group--scope">
                {#if orgOverlay.nodes.length > 0 || orgNarrowId}
                <!-- B14.8 按组织收窄：两模式共享（画布人物/登记白名单收窄到所选组织成员） -->
                <select class="b3-select" bind:value={orgNarrowId} aria-label={text("graphOrgNarrowLabel", "按组织收窄")}>
                    <option value="">{text("graphOrgNarrowAll", "全部组织")}</option>
                    {#if orgNarrowId && !orgOverlay.nodes.some((org) => org.id === orgNarrowId)}<option value={orgNarrowId}>{text("graphOrgUnverified", "所选组织待核实")} · {orgNarrowId}</option>{/if}
                    {#each orgOverlay.nodes as org (org.id)}
                        <option value={org.id}>{org.label}</option>
                    {/each}
                </select>
                {/if}
                {#if graphMode === "native"}
                    <select class="b3-select" value={nativeScope} aria-label={text("graphNativeScopeLabel", "引用图范围")} onchange={(event) => void switchNativeScope(event.currentTarget.value)}>
                        <option value="self">{text("graphNativeScopeSelf", "以本人为中心（一度引用）")}</option>
                        <option value="person">{text("graphNativeScopePerson", "以联系人为中心（一度引用）")}</option>
                        <option value="global">{text("graphNativeScopeGlobal", "全部登记文档")}</option>
                        <option value="org">{text("graphScopeOrg", "以组织为中心（一度引用）")}</option>
                    </select>
                    {#if nativeScope === "person"}
                        <!-- B03 可搜索选人器：中心人物（B14.8 中心保留） -->
                        <PersonPicker
                            items={nativeCenterItems}
                            value={nativeCenterDocId}
                            placeholder={text("graphPickNone", "未选择")}
                            emptyText={text("graphPickerEmpty", "当前图内没有匹配的人物")}
                            ariaLabel={text("graphNativePickCenter", "中心人物")}
                            onSelect={(id) => void pickNativeCenter(id)}
                        />
                    {/if}
                    <span class="ft__smaller ft__on-surface">{text("graphNativeEdgeNote", "边=文档间块引用（双向一度，含回链），非 related 关系")}</span>
                {:else}
                    <select class="b3-select" bind:value={relationScope} aria-label={text("graphRelationsScope", "关系图范围")}>
                        <option value="global">{text("graphScopeGlobal", "全部登记文档")}</option>
                        <option value="self">{text("graphScopeSelf", "以本人为中心")}</option>
                        <option value="person">{text("graphScopePerson", "以人物为中心")}</option>
                        <option value="org">{text("graphScopeOrganization", "以组织为中心")}</option>
                    </select>
                    {#if relationScope === "person"}<PersonPicker items={graphPickerItems} value={relationCenterDocId} ariaLabel={text("graphScopeCenter", "范围中心人物")} onSelect={(id) => (relationCenterDocId = id)} />{/if}
                {/if}
            </div>
            {#if graphMode === "relations"}
                <div class="lvct-graph-toolbar__filter-group lvct-graph-toolbar__filter-group--refine">
                    <select class="b3-select" bind:value={groupFilter} aria-label={text("graphFilterByGroup", "按分组过滤")}>
                        <option value="">{text("graphAllGroups", "全部分组")}</option>
                        {#each groups as group (group)}
                            <option value={group}>{group}</option>
                        {/each}
                    </select>
                    <label class="lvct-graph-isolated"><input type="checkbox" bind:checked={isolatedOnly} />{text("graphIsolatedOnly", "仅无关系人物（{n}）", { n: snapshot.counts.isolatedPeople })}</label>
                    <label class="lvct-graph-isolated"><input type="checkbox" bind:checked={showOrgs} />{text("graphShowOrgs", "显示组织（{n}）", { n: orgOverlay?.nodes.length ?? 0 })}</label>
                </div>
            {/if}
            <div class="lvct-graph-toolbar__filter-group lvct-graph-toolbar__filter-group--legend">
                <span class="ft__smaller ft__on-surface lvct-graph-legend">
                    {#each groupLegend as group (group.label)}
                        <span class={`lvct-graph-legend__item lvct-graph-legend__item--${group.className}`}><i></i>{group.label}</span>
                    {/each}
                </span>
            </div>
            </div>
        </details>
    </div>

    {#if graphMode === "relations" && !loading && !errorText && snapshot.people.length > 0}
        <div class="lvct-graph-query">
            <div class="lvct-graph-query__fields">
            <label>{text("graphCenterLabel", "关系中心")}
                <!-- B03 可搜索选人器：输入即筛替换全量长列表 -->
                <PersonPicker
                    items={graphPickerItems}
                    value={focusId}
                    placeholder={text("graphPickNone", "未选择")}
                    emptyText={text("graphPickerEmpty", "当前图内没有匹配的人物")}
                    ariaLabel={text("graphCenterLabel", "关系中心")}
                    onSelect={(id) => (focusId = id)}
                />
            </label>
            <label>{text("graphCompareLabel", "对比人物")}
                <PersonPicker
                    items={graphPickerItems.filter((item) => item.id !== focusId)}
                    value={compareId}
                    placeholder={text("graphPickNone", "未选择")}
                    emptyText={text("graphPickerEmpty", "当前图内没有匹配的人物")}
                    ariaLabel={text("graphCompareLabel", "对比人物")}
                    disabled={!focusId}
                    onSelect={(id) => (compareId = id)}
                />
            </label>
            {#if focusId && !compareId}
                <select class="b3-select" bind:value={relationDepth} aria-label={text("graphDepthLabel", "关系层级")}>
                    <option value="direct">{text("graphDepthDirect", "直接关系")}</option>
                    <option value="second">{text("graphDepthSecond", "二度关系")}</option>
                </select>
            {/if}
            {#if compareId}
                <select class="b3-select" bind:value={queryMode} aria-label={text("graphQueryModeLabel", "关系查询模式")}>
                    <option value="common">{text("graphModeCommon", "共同联系人")}</option>
                    <option value="path">{text("graphModePath", "最短路径")}</option>
                </select>
            {/if}
            </div>
            {#if focusId}
                <div class="lvct-graph-query__result">
                {#if snapshot.result.status === "unknown" || snapshot.result.status === "center_missing"}
                    <span class="ft__smaller ft__on-surface">{text("graphQueryUnverified", "关系查询结果待核实")}</span>
                {:else if pathMode}
                    <span class="ft__smaller ft__on-surface">{pathIds.length > 0 ? text("graphPathCount", "最短路径：{n} 段关系（当前图内）", { n: pathIds.length - 1 }) : text("graphPathNone", "最短路径：无连接（当前图内）")}</span>
                {:else}
                    <span class="ft__smaller ft__on-surface">{compareId ? text("graphCommonCount", "共同联系人：{n} 人（当前图内）", { n: resultPeople.length }) : secondMode ? text("graphSecondCount", "二度关系：{n} 人（当前图内）", { n: resultPeople.length }) : text("graphDirectCount", "直接关系：{n} 人（当前图内）", { n: resultPeople.length })}</span>
                {/if}
                <button class="b3-button b3-button--text" onclick={() => { focusId = ""; compareId = ""; }}>{text("graphClearSelection", "清除选择")}</button>
                <button class="b3-button b3-button--outline" title={text("graphExportTitle", "导出查询结果说明（Markdown）")} onclick={exportResultMarkdown}>{text("graphExportButton", "导出结果说明")}</button>
                </div>
            {/if}
        </div>
        {#if focusId}
            {#if resultExportMessage}
                <div class="ft__smaller ft__on-surface" role="status">{resultExportMessage}（{text("graphExportScope", "结果仅限当前图内，不代表现实社交关系或引荐意愿。")}）</div>
            {/if}
            <div class="lvct-graph-query__results">
                {#if snapshot.result.status === "unknown" || snapshot.result.status === "center_missing"}
                    <span class="ft__smaller ft__on-surface">{snapshot.result.reason}</span>
                {:else if pathMode}
                    {#each pathPeople as person, index (person.docId)}
                        {#if index > 0}<span class="ft__on-surface" aria-hidden="true">→</span>{/if}
                        <button class="b3-button b3-button--text" onclick={() => openSnapshotPerson(person)}>{person.name} · {person.docId}</button>
                    {:else}
                        <span class="ft__smaller ft__on-surface">{text("graphNoPath", "当前图内没有连接路径")}</span>
                    {/each}
                {:else}
                {#each resultPeople as person (person.docId)}
                    <button class="b3-button b3-button--text" onclick={() => openSnapshotPerson(person)}>{person.name} · {person.docId}</button>
                {:else}
                    <span class="ft__smaller ft__on-surface">{compareId ? text("graphNoCommon", "当前图内没有共同联系人") : secondMode ? text("graphNoSecond", "当前图内没有二度关系") : text("graphNoDirect", "当前图内没有直接关系")}</span>
                {/each}
                {/if}
            </div>
        {/if}
    {/if}

    <section class="lvct-graph-summary" aria-label={text("graphSnapshotSummary", "图查询范围与计数")} aria-busy={loading || nativeLoading}>
        <div class="lvct-graph-summary__head">
            <h2 tabindex="-1" bind:this={resultHeading}>{text("graphSnapshotTitle", "当前图查询")}</h2>
            <p
                class="lvct-graph-summary__status lvct-graph-summary__status--{loading || nativeLoading ? "loading" : snapshot.state === "ready" || snapshot.state === "empty" ? "complete" : snapshot.state}"
                role="status"
                aria-live="polite"
                aria-atomic="true"
            >{snapshotStatusText}<span class="lvct-graph-summary__status-counts"> · 展示 {snapshot.counts.displayedNodes} 节点 / {snapshot.counts.displayedEdges} 边</span></p>
        </div>
        <dl class="lvct-graph-summary__stats" aria-label={text("graphSnapshotStats", "图谱统计")}>
            <div><dt>{text("graphDisplayedNodes", "展示节点")}</dt><dd>{snapshot.counts.displayedNodes}</dd></div>
            <div><dt>{text("graphDisplayedEdges", "展示边")}</dt><dd>{snapshot.counts.displayedEdges}</dd></div>
            <div><dt>{text("graphRangeNodes", "范围内")}</dt><dd>{snapshot.counts.rangeNodes}</dd></div>
            <div><dt>{text("graphFilteredNodes", "筛选后")}</dt><dd>{snapshot.counts.filteredNodes}</dd></div>
        </dl>
        <p>{text("graphScopeLabel", "范围")}：{query.scope === "global" ? "全部登记文档" : query.scope === "self" ? "本人中心" : query.scope === "person" ? "人物中心" : "组织中心"} · {snapshot.center.status === "none" ? "中心：无中心" : `${snapshot.center.label} · ${snapshot.center.status === "verified" ? snapshot.center.id : "中心待核实"}`}</p>
        <details class="lvct-graph-summary__details" open={snapshot.state === "unknown" || snapshot.state === "center_missing"}>
            <summary>{text("graphSummaryDetails", "来源与排除详情")}</summary>
            <p>登记 {snapshot.counts.registered ?? "未知"} · 来源节点 {snapshot.counts.sourceNodes ?? "未知"} / 边 {snapshot.counts.sourceEdges ?? "未知"} · 范围内 {snapshot.counts.rangeNodes} · 筛选后 {snapshot.counts.filteredNodes} · 范围排除 {snapshot.counts.rangeExcluded ?? "未知"} · 筛选排除 {snapshot.counts.filterExcluded}</p>
            <p>{graphMode === "relations" ? `${graphEdgeLabel("related")}；${graphEdgeLabel("member")}。只有 related 参与关系查询。` : `${graphEdgeLabel("ref")}（含回链）；不是整库图，未打开思源原生面板。`}</p>
            {#if graphMode === "native" && (groupFilter || isolatedOnly)}<p>已保留关系图分组/无关系筛选；这些条件不应用于文档引用图。</p>{/if}
            {#if snapshot.retainedByRange.length}<p>{text("graphRangeRetained", "范围外中心优先保留：{names}（不属于当前范围或组织成员集合，不新增关系事实）", { names: snapshot.retainedByRange.map(nodeName).join("、") })}</p>{/if}
            {#if snapshot.retainedByFilter.length}<p>中心优先保留：{snapshot.retainedByFilter.map(nodeName).join("、")}（未满足全部筛选）</p>{/if}
        </details>
        {#if snapshot.result.status !== "none"}<p role={snapshot.result.status === "unknown" || snapshot.result.status === "center_missing" ? "alert" : "status"}>{snapshot.result.reason}</p>{/if}
        {#if snapshot.diagnostics.length}<details class="lvct-graph-diagnostics" open={snapshot.state === "unknown" || snapshot.state === "center_missing"}>
            <summary>{text("graphDiagnostics", "待核实与诊断")}（{snapshot.diagnostics.length}）</summary>
            <ul>{#each snapshot.diagnostics as diagnostic}<li>{diagnostic.message}</li>{/each}</ul>
        </details>{/if}
        {#if preferenceError}<p role="alert">{preferenceError}</p>{/if}
    </section>

    {#if truncated}
        <div class="ft__smaller ft__on-surface lvct-graph-note">
            {text("graphSnapshotTruncated", "节点预算 {max}（含人物与组织），裁剪 {nodes} 节点 / {edges} 边；中心已保留，请搜索或按组织收窄。", { max: GRAPH_MAX_NODES, nodes: snapshot.counts.clippedNodes, edges: snapshot.counts.clippedEdges })}
        </div>
    {/if}

    {#if errorText}
        <ViewState error title={text("graphLoadFailTitle", "图谱加载失败")} description={errorText}>
            <button class="b3-button b3-button--outline" onclick={refresh}>{text("graphReload", "重新加载")}</button>
        </ViewState>
    {:else if loading || nativeLoading}
        <ViewState loading title={text("graphLoadingTitle", "正在加载关系图谱")} />
    {:else if snapshot.state === "unknown" || snapshot.state === "center_missing"}
        <ViewState error title={text("graphSnapshotUnknown", "图查询范围尚未核实")} description={snapshot.diagnostics.map((entry) => entry.message).join("；")}>
            <button class="b3-button b3-button--outline" onclick={refresh}>{text("graphReverify", "重新核实来源")}</button>
            <button class="b3-button b3-button--text" onclick={() => { relationScope = "global"; nativeScope = "global"; orgNarrowId = ""; }}>{text("graphUseGlobal", "切换全局范围")}</button>
            {#if graphMode === "native"}<button class="b3-button b3-button--text" onclick={() => void switchGraphMode("relations")}>{text("graphUseRelations", "切换关系图")}</button>{/if}
        </ViewState>
    {:else if snapshot.graph.nodes.length === 0}
        <ViewState title={people.length === 0 ? text("graphEmptyNoPeopleTitle", "还没有联系人") : text("graphEmptyNoMatchTitle", "没有匹配的节点")}
            description={people.length === 0 ? text("graphEmptyNoPeopleDesc", "创建或导入联系人后，在人物详情中建立关系。") : text("graphEmptyNoMatchDesc", "试试清除关键词和分组筛选。")}>
            {#if people.length > 0}
                <button class="b3-button b3-button--outline" onclick={clearFilters}>{text("graphClearFilters", "清除筛选")}</button>
            {/if}
            <button class="b3-button b3-button--text" onclick={onOpenPeople}>{text("graphGoContacts", "前往联系人")}</button>
        </ViewState>
    {:else if presentation === "text"}
        <section class="lvct-graph-text" aria-label={text("graphTextResults", "图谱文本结果")}>
            <h3>{text("graphTextNodes", "节点")}（{snapshot.graph.nodes.length}）</h3>
            <ul class="lvct-graph-text__nodes">
                {#each snapshot.graph.nodes.slice(0, textLimit) as node (node.id)}
                    <li>
                        <button class="b3-button b3-button--text" data-graph-id={node.id} title={node.id} onclick={() => openTextNode(node)} aria-label={`${node.kind === "org" ? "聚焦组织" : "打开人物"} ${node.label} ${node.id}`}>{node.label}</button>
                        <span>{node.kind === "org" ? "组织" : "人物"} · 图内连接 {node.degree}</span>
                        <button class="b3-button b3-button--outline" onclick={() => void locateNode(node.id)}>{text("graphLocateCanvas", "定位画布")}</button>
                    </li>
                {/each}
            </ul>
            <h3>{text("graphTextEdges", "边及来源")}（{snapshot.graph.edges.length}）</h3>
            <ul>{#each snapshot.graph.edges.slice(0, textLimit) as edge}<li title={`${edge.source} → ${edge.target}`}>{nodeName(edge.source)} — {nodeName(edge.target)} · {graphEdgeLabel(edge.kind)}</li>{/each}</ul>
            {#if snapshot.result.pathIds.length}<h3>{text("graphTextPath", "related 路径链")}</h3><ol>{#each snapshot.result.pathIds as id}<li title={id}>{nodeName(id)}</li>{/each}</ol>{/if}
            <p role="status">文本已列出 {Math.min(textLimit, snapshot.graph.nodes.length)} / {snapshot.graph.nodes.length} 节点，{Math.min(textLimit, snapshot.graph.edges.length)} / {snapshot.graph.edges.length} 边；导出包含完整展示快照。</p>
            {#if textLimit < Math.max(snapshot.graph.nodes.length, snapshot.graph.edges.length)}<button class="b3-button b3-button--outline" onclick={() => (textLimit += 100)}>{text("graphTextMore", "继续列出节点与边")}</button>{/if}
        </section>
    {:else}
        <div class="lvct-graph-view__canvas-wrap">
            <div class="lvct-graph-view__canvas" bind:this={container} tabindex="-1" role="img" aria-label={`图谱画布，${snapshot.graph.nodes.length} 节点、${snapshot.graph.edges.length} 边。请切换文本视图用键盘阅读。${canvasFocusId ? `已定位 ${nodeName(canvasFocusId)}` : ""}`}></div>
            <!-- UX-02.13 视图操作收进画布右下角浮动簇（地图应用范式），工具栏只留筛选 -->
            <div class="lvct-graph__fab" role="toolbar" aria-label={text("graphViewTools", "图谱视图操作")}>
                <button class="lvct-graph__fab-btn" title={text("graphFit", "适应")} aria-label={text("graphFit", "适应")} onclick={() => graphInstance?.fit()}><Scan size={15} /></button>
                <button class="lvct-graph__fab-btn" title={text("graphZoomIn", "放大")} aria-label={text("graphZoomIn", "放大")} onclick={() => zoomBy(1.2)}><ZoomIn size={15} /></button>
                <button class="lvct-graph__fab-btn" title={text("graphZoomOut", "缩小")} aria-label={text("graphZoomOut", "缩小")} onclick={() => zoomBy(1 / 1.2)}><ZoomOut size={15} /></button>
                <button class="lvct-graph__fab-btn" title={text("graphRelayout", "重新布局")} aria-label={text("graphRelayout", "重新布局")} onclick={relayout}><Network size={15} /></button>
                <button class="lvct-graph__fab-btn" title={text("graphRefresh", "刷新")} aria-label={text("graphRefresh", "刷新")} onclick={refresh}><RefreshCw size={15} /></button>
            </div>
            {#if hoveredOrg}
                <div
                    class="lvct-graph-view__hover-card"
                    role="dialog"
                    aria-modal="false"
                    aria-label={`组织 ${hoveredOrg.label} 的图谱信息`}
                    tabindex="-1"
                    style={`left:${hoverPosition.x}px;top:${hoverPosition.y}px`}
                    onmouseenter={() => clearHoverTimer && clearTimeout(clearHoverTimer)}
                    onmouseleave={scheduleClearHover}
                >
                    <div class="lvct-graph-view__hover-name">
                        <b>{hoveredOrg.label}</b>
                        <span class="lvct-chip lvct-chip--group">{text("graphOrgChip", "组织")}</span>
                    </div>
                    <div class="ft__smaller ft__on-surface">{graphMode === "native" ? text("graphOrgHoverConnections", "图内引用连接：{n}", { n: hoveredOrg.degree }) : text("graphOrgHoverMembers", "图内成员连接：{n}", { n: hoveredOrg.degree })}</div>
                    <button class="b3-button b3-button--text" onclick={() => { const id = hoveredOrg?.id; clearHover(); if (id) focusOrganization(id); }}>{text("graphOrgFocus", "聚焦该组织")}</button>
                    {#if onOpenOrgs}<button class="b3-button b3-button--text" onclick={onOpenOrgs}>{text("graphOrgHoverOpen", "打开组织视图")}</button>{/if}
                </div>
            {:else if hoveredPerson}
                <div
                    class="lvct-graph-view__hover-card"
                    role="dialog"
                    aria-modal="false"
                    aria-label={`人物 ${hoveredPerson.name} 的图谱信息`}
                    tabindex="-1"
                    style={`left:${hoverPosition.x}px;top:${hoverPosition.y}px`}
                    onmouseenter={() => clearHoverTimer && clearTimeout(clearHoverTimer)}
                    onmouseleave={scheduleClearHover}
                >
                    <div class="lvct-graph-view__hover-name">
                        <b>{hoveredPerson.name}</b>
                        {#if hoveredPerson.group}<span class="lvct-chip lvct-chip--group">{hoveredPerson.group}</span>{/if}
                    </div>
                    {#if hoveredNativeDegree >= 0}
                        <div class="ft__smaller ft__on-surface">{text("graphNativeDegree", "图内连接：{n}", { n: hoveredNativeDegree })}</div>
                    {:else}
                        <div class="ft__smaller ft__on-surface">{text("graphDegreeLabel", "关系度数：{n}", { n: snapshot.relationGraph.nodes.find((node) => node.id === hoveredPerson?.docId)?.degree ?? 0 })}</div>
                    {/if}
                    {#if hoveredPerson.phone}<div class="ft__smaller ft__on-surface">{text("graphPhoneLabel", "电话：{n}", { n: hoveredPerson.phone })}</div>{/if}
                    {#if hoveredPerson.tags.length > 0}<div class="ft__smaller ft__on-surface">{text("graphTagsLabel", "标签：{n}", { n: hoveredPerson.tags.join(" · ") })}</div>{/if}
                    {#if facade}
                        <div class="lvct-graph-view__hover-insights">
                            {#if hoverInsightsLoading}
                                <span class="ft__smaller ft__on-surface">{text("graphHoverLoading", "正在读取互动…")}</span>
                            {:else if hoverInsightsError}
                                <span class="ft__smaller ft__on-surface">{text("graphHoverUnavailable", "互动摘要暂时不可用")}</span>
                            {:else if hoverInsights}
                                <span class="ft__smaller ft__on-surface">{text("graphHoverLast", "最近互动：{n}", { n: hoverInsights.timeline[0]?.localDate ?? text("graphHoverNone", "暂无记录") })}</span>
                                <span class="ft__smaller ft__on-surface">{text("graphHoverCoAttend", "共同出席：{n}", { n: hoverInsights.coAttendance.slice(0, 3).map((item) => item.name).join("、") || text("graphHoverNone", "暂无记录") })}</span>
                            {/if}
                        </div>
                    {/if}
                    <button class="b3-button b3-button--text" onclick={openHoveredPerson}>{text("graphOpenDetail", "查看人物详情")}</button>
                </div>
            {/if}
        </div>
    {/if}
</div>
