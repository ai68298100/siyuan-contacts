<script lang="ts">
    /** 关系图谱：cytoscape 力导向布局，节点=联系人，边=related 关系，点击节点开文档 */
    import cytoscape from "cytoscape";
    import { onMount } from "svelte";
    import { Scan, ZoomIn, ZoomOut, Network, RefreshCw } from "@lucide/svelte";
    import ViewState from "../ViewState.svelte";
    import { listContacts } from "../../services/contacts";
    import { buildGraph, capGraph, GRAPH_MAX_NODES, groupColor, queryGraphRelations } from "../../domain/graph";
    import { shortestGraphPath, secondDegreeGraphIds } from "../../domain/graph-path";
    import { renderGraphResultMarkdown } from "../../domain/graph-export";
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
        onOpenDetail,
        onOpenPeople,
    }: {
        settings: ContactsSettings;
        revision?: number;
        facade?: ContactsPluginFacade;
        i18n?: Readonly<Record<string, string>>;
        onOpenDetail: (person: ContactSummary) => void;
        onOpenPeople: () => void;
    } = $props();
    const text = $derived.by(() => (key: string, fallback: string, values?: Record<string, string | number>) =>
        translateText(i18n, key, fallback, values));

    let container: HTMLElement | undefined = $state();
    let people: ContactSummary[] = $state([]);
    let loading: boolean = $state(true);
    let errorText: string = $state("");
    let truncated: boolean = $state(false);
    let searchText: string = $state("");
    let groupFilter: string = $state("");
    let isolatedOnly = $state(false);
    let relationDepth = $state("direct");
    let graphInstance: cytoscape.Core | null = $state.raw(null);
    let focusId = $state("");
    let compareId = $state("");
    let queryMode: "common" | "path" = $state("common");
    let hoveredPerson: ContactSummary | null = $state(null);
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
    ] as const;

    const groups = $derived.by(() => [...new Set(people.map((person) => person.group).filter(Boolean))].sort());
    /* B03 可搜索选人器：图内节点 → 候选项（带分组提示与联系方式关键词） */
    const graphPickerItems = $derived.by((): PickerItem[] => displayed.graph.nodes.map((node) => {
        const person = people.find((item) => item.docId === node.id);
        return {
            id: node.id,
            label: node.label,
            hint: person ? [person.group, ...person.tags].filter(Boolean).join(" · ") : undefined,
            keywords: person ? `${person.phone} ${person.wechat} ${person.email}`.toLowerCase() : undefined,
        };
    }));
    const fullGraph = $derived(buildGraph(people));
    const isolatedIds = $derived(new Set(fullGraph.nodes.filter((node) => node.degree === 0).map((node) => node.id)));
    const filteredPeople = $derived.by(() => {
        const needle = searchText.trim().toLowerCase();
        return people.filter((person) => {
            const matchesGroup = !groupFilter || person.group === groupFilter;
            const matchesSearch = !needle || [person.name, person.phone, person.wechat, person.email, ...person.tags]
                .join(" ")
                .toLowerCase()
                .includes(needle);
            return matchesGroup && matchesSearch && (!isolatedOnly || isolatedIds.has(person.docId));
        });
    });
    const searchNeedle = $derived(searchText.trim().toLowerCase());
    const displayed = $derived(capGraph(buildGraph(filteredPeople)));
    const relations = $derived(queryGraphRelations(displayed.graph, focusId, compareId));
    const secondMode = $derived.by(() => !compareId && relationDepth === "second");
    const secondIds = $derived(secondMode ? secondDegreeGraphIds(displayed.graph, focusId) : []);
    const resultIds = $derived(compareId ? relations.commonIds : secondMode ? secondIds : relations.neighborIds);
    const resultPeople = $derived(people.filter((person) => resultIds.includes(person.docId)));
    const pathMode = $derived.by(() => Boolean(compareId) && queryMode === "path");
    const pathIds = $derived(pathMode ? shortestGraphPath(displayed.graph, focusId, compareId) : []);
    const pathPeople = $derived(pathIds.map((id) => people.find((person) => person.docId === id)).filter((person) => person !== undefined));

    // ---- 查询结果导出（F16） ----
    let resultExportMessage = $state("");
    function exportResultMarkdown() {
        const center = people.find((person) => person.docId === focusId);
        const compare = people.find((person) => person.docId === compareId);
        const pad = (value: number) => String(value).padStart(2, "0");
        const now = new Date();
        const markdown = renderGraphResultMarkdown({
            kind: pathMode ? "path" : compareId ? "common" : secondMode ? "second" : "direct",
            centerName: center?.name ?? "（未知）",
            ...(compare ? { compareName: compare.name } : {}),
            pathNames: pathPeople.map((person) => person.name),
            resultNames: resultPeople.map((person) => person.name),
            nodeCount: displayed.graph.nodes.length,
            edgeCount: displayed.graph.edges.length,
            truncated,
            filters: { search: searchText.trim(), group: groupFilter, isolatedOnly },
            generatedAt: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`,
        });
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

    $effect(() => {
        const ids = new Set(displayed.graph.nodes.map((node) => node.id));
        if (!ids.has(focusId)) focusId = "";
        if (!focusId || !ids.has(compareId) || focusId === compareId) compareId = "";
    });

    $effect(() => {
        const instance = graphInstance;
        const selected = focusId;
        const other = compareId;
        const hits = pathMode ? pathIds : resultIds;
        const path = pathMode ? pathIds : null;
        const bridges = secondMode ? relations.neighborIds : [];
        const expandSecond = secondMode;
        if (!instance || instance.destroyed()) return;
        instance.batch(() => {
            instance.elements().removeClass("lvct-graph-muted lvct-graph-focus");
            if (!selected) return;
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
                const connectsHit = path !== null
                    ? nextOnPath.get(source) === target || nextOnPath.get(target) === source
                    : expandSecond
                    ? (source === selected && bridgeIds.has(target)) || (target === selected && bridgeIds.has(source))
                        || (bridgeIds.has(source) && hitIds.has(target)) || (bridgeIds.has(target) && hitIds.has(source))
                    : (hitIds.has(source) && (target === selected || target === other))
                        || (hitIds.has(target) && (source === selected || source === other));
                if (!connectsHit) edge.addClass("lvct-graph-muted");
            });
        });
    });

    /** cytoscape 无法用 CSS 变量，挂载时从主题运行时取值 */
    function themeColors(): { text: string; edge: string; surface: string } {
        const probe = container ?? document.body;
        const style = getComputedStyle(probe);
        return {
            text: style.getPropertyValue("--lvct-text-2").trim() || "currentColor",
            edge: style.getPropertyValue("--lvct-border-subtle").trim() || "currentColor",
            surface: style.getPropertyValue("--lvct-bg-surface").trim() || "transparent",
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
        return value || groupColor(group);
    }

    onMount(() => {
        const updateTheme = () => {
            const instance = graphInstance;
            if (!instance || instance.destroyed()) return;
            const palette = themeColors();
            instance.batch(() => {
                instance.nodes().forEach((node) => { node.data("color", groupColorValue(node.data("group"))); });
                instance.nodes().style({ color: palette.text, "border-color": palette.surface });
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
            const result = await listContacts(settings);
            if (version === refreshVersion) people = result;
        } catch (error) {
            if (version === refreshVersion) errorText = error instanceof Error ? error.message : String(error);
        } finally {
            if (version === refreshVersion) loading = false;
        }
    }

    function zoomBy(factor: number) {
        if (graphInstance) graphInstance.zoom(graphInstance.zoom() * factor);
    }

    function relayout() {
        const instance = graphInstance;
        if (!instance) return;
        instance.layout({ name: "cose", animate: true, animationDuration: 300, padding: 30 }).run();
    }

    function clearHover() {
        if (hoverTimer) clearTimeout(hoverTimer);
        if (clearHoverTimer) clearTimeout(clearHoverTimer);
        hoverTimer = undefined;
        clearHoverTimer = undefined;
        hoveredPerson = null;
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
            clearHoverTimer = undefined;
        }, 220);
    }

    function scheduleHover(event: cytoscape.EventObject) {
        const person = people.find((item) => item.docId === event.target.id());
        if (!person) return;
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
        if (!container || people.length === 0) return;
        const capped = displayed;
        truncated = capped.truncated;
        if (capped.graph.nodes.length === 0) return;
        const palette = themeColors();

        const instance = cytoscape({
            container,
            /* 画布撑满工作台后，小图的 fit 放大不设上限会糊脸（UX-02.13） */
            maxZoom: 2.5,
            elements: [
                ...capped.graph.nodes.map((node) => ({
                    data: {
                        id: node.id,
                        label: node.label,
                        degree: node.degree,
                        group: node.group,
                        color: groupColorValue(node.group),
                    },
                    classes: searchNeedle ? "lvct-graph-hit" : "",
                })),
                ...capped.graph.edges.map((edge) => ({
                    data: { source: edge.source, target: edge.target },
                })),
            ],
            // 同步完成布局，避免筛选/切页销毁画布后动画帧继续访问 renderer。
            layout: { name: "cose", animate: false, padding: 30 },
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
                onOpenDetail(person);
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
        if (person) onOpenDetail(person);
    }
</script>

<div class="lvct-graph-view">
    <div class="lvct-people__toolbar fn__flex">
        <input class="b3-text-field fn__flex-1" type="search" placeholder={text("graphSearchPlaceholder", "搜索节点…")} aria-label={text("graphSearchNodes", "搜索关系图谱节点")} bind:value={searchText} />
        {#if searchNeedle}<span class="ft__smaller ft__on-surface">{text("graphHitCount", "命中 {n} 人", { n: filteredPeople.length })}</span>{/if}
        <select class="b3-select" bind:value={groupFilter} aria-label={text("graphFilterByGroup", "按分组过滤")}>
            <option value="">{text("graphAllGroups", "全部分组")}</option>
            {#each groups as group (group)}
                <option value={group}>{group}</option>
            {/each}
        </select>
        <label class="lvct-graph-isolated"><input type="checkbox" bind:checked={isolatedOnly} />{text("graphIsolatedOnly", "仅无关系人物（{n}）", { n: isolatedIds.size })}</label>
        <span class="ft__smaller ft__on-surface lvct-graph-legend">
            {#each groupLegend as group (group.label)}
                <span class={`lvct-graph-legend__item lvct-graph-legend__item--${group.className}`}><i></i>{group.label}</span>
            {/each}
        </span>
        <span class="fn__flex-1"></span>
    </div>

    {#if !loading && !errorText && displayed.graph.nodes.length > 0}
        <div class="lvct-graph-query">
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
            {#if focusId}
                {#if pathMode}
                    <span class="ft__smaller ft__on-surface">{pathIds.length > 0 ? text("graphPathCount", "最短路径：{n} 段关系（当前图内）", { n: pathIds.length - 1 }) : text("graphPathNone", "最短路径：无连接（当前图内）")}</span>
                {:else}
                    <span class="ft__smaller ft__on-surface">{compareId ? text("graphCommonCount", "共同联系人：{n} 人（当前图内）", { n: resultPeople.length }) : secondMode ? text("graphSecondCount", "二度关系：{n} 人（当前图内）", { n: resultPeople.length }) : text("graphDirectCount", "直接关系：{n} 人（当前图内）", { n: resultPeople.length })}</span>
                {/if}
                <button class="b3-button b3-button--text" onclick={() => { focusId = ""; compareId = ""; }}>{text("graphClearSelection", "清除选择")}</button>
                <button class="b3-button b3-button--outline" title={text("graphExportTitle", "导出查询结果说明（Markdown）")} onclick={exportResultMarkdown}>{text("graphExportButton", "导出结果说明")}</button>
            {/if}
        </div>
        {#if focusId}
            {#if resultExportMessage}
                <div class="ft__smaller ft__on-surface" role="status">{resultExportMessage}（{text("graphExportScope", "结果仅限当前图内，不代表现实社交关系或引荐意愿。")}）</div>
            {/if}
            <div class="lvct-graph-query__results">
                {#if pathMode}
                    {#each pathPeople as person, index (person.docId)}
                        {#if index > 0}<span class="ft__on-surface" aria-hidden="true">→</span>{/if}
                        <button class="b3-button b3-button--text" onclick={() => onOpenDetail(person)}>{person.name}</button>
                    {:else}
                        <span class="ft__smaller ft__on-surface">{text("graphNoPath", "当前图内没有连接路径")}</span>
                    {/each}
                {:else}
                {#each resultPeople as person (person.docId)}
                    <button class="b3-button b3-button--text" onclick={() => onOpenDetail(person)}>{person.name}</button>
                {:else}
                    <span class="ft__smaller ft__on-surface">{compareId ? text("graphNoCommon", "当前图内没有共同联系人") : secondMode ? text("graphNoSecond", "当前图内没有二度关系") : text("graphNoDirect", "当前图内没有直接关系")}</span>
                {/each}
                {/if}
            </div>
        {/if}
    {/if}

    {#if truncated}
        <div class="ft__smaller ft__on-surface lvct-graph-note">
            {text("graphTruncatedNote", "联系人超过 {max}，当前只展示关系最多的 {max} 人（用分组筛选或搜索缩小范围可看全）。", { max: GRAPH_MAX_NODES })}
        </div>
    {/if}

    {#if errorText}
        <ViewState error title={text("graphLoadFailTitle", "图谱加载失败")} description={errorText}>
            <button class="b3-button b3-button--outline" onclick={refresh}>{text("graphReload", "重新加载")}</button>
        </ViewState>
    {:else if loading}
        <ViewState loading title={text("graphLoadingTitle", "正在加载关系图谱")} />
    {:else if filteredPeople.length === 0}
        <ViewState title={people.length === 0 ? text("graphEmptyNoPeopleTitle", "还没有联系人") : text("graphEmptyNoMatchTitle", "没有匹配的节点")}
            description={people.length === 0 ? text("graphEmptyNoPeopleDesc", "创建或导入联系人后，在人物详情中建立关系。") : text("graphEmptyNoMatchDesc", "试试清除关键词和分组筛选。")}>
            {#if people.length > 0}
                <button class="b3-button b3-button--outline" onclick={() => { searchText = ""; groupFilter = ""; isolatedOnly = false; }}>{text("graphClearFilters", "清除筛选")}</button>
            {/if}
            <button class="b3-button b3-button--text" onclick={onOpenPeople}>{text("graphGoContacts", "前往联系人")}</button>
        </ViewState>
    {:else}
        <div class="lvct-graph-view__canvas-wrap">
            <div class="lvct-graph-view__canvas" bind:this={container}></div>
            <!-- UX-02.13 视图操作收进画布右下角浮动簇（地图应用范式），工具栏只留筛选 -->
            <div class="lvct-graph__fab" role="toolbar" aria-label={text("graphViewTools", "图谱视图操作")}>
                <button class="lvct-graph__fab-btn" title={text("graphFit", "适应")} aria-label={text("graphFit", "适应")} onclick={() => graphInstance?.fit()}><Scan size={15} /></button>
                <button class="lvct-graph__fab-btn" title={text("graphZoomIn", "放大")} aria-label={text("graphZoomIn", "放大")} onclick={() => zoomBy(1.2)}><ZoomIn size={15} /></button>
                <button class="lvct-graph__fab-btn" title={text("graphZoomOut", "缩小")} aria-label={text("graphZoomOut", "缩小")} onclick={() => zoomBy(1 / 1.2)}><ZoomOut size={15} /></button>
                <button class="lvct-graph__fab-btn" title={text("graphRelayout", "重新布局")} aria-label={text("graphRelayout", "重新布局")} onclick={relayout}><Network size={15} /></button>
                <button class="lvct-graph__fab-btn" title={text("graphRefresh", "刷新")} aria-label={text("graphRefresh", "刷新")} onclick={refresh}><RefreshCw size={15} /></button>
            </div>
            {#if hoveredPerson}
                <div
                    class="lvct-graph-view__hover-card"
                    role="dialog"
                    tabindex="-1"
                    style={`left:${hoverPosition.x}px;top:${hoverPosition.y}px`}
                    onmouseenter={() => clearHoverTimer && clearTimeout(clearHoverTimer)}
                    onmouseleave={scheduleClearHover}
                >
                    <div class="lvct-graph-view__hover-name">
                        <b>{hoveredPerson.name}</b>
                        {#if hoveredPerson.group}<span class="lvct-chip lvct-chip--group">{hoveredPerson.group}</span>{/if}
                    </div>
                    <div class="ft__smaller ft__on-surface">{text("graphDegreeLabel", "关系度数：{n}", { n: hoveredPerson.relatedItemIds.length })}</div>
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
