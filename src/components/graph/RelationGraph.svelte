<script lang="ts">
    /** 关系图谱：cytoscape 力导向布局，节点=联系人，边=related 关系，点击节点开文档 */
    import cytoscape from "cytoscape";
    import { listContacts } from "../../services/contacts";
    import { buildGraph, capGraph, GRAPH_MAX_NODES, groupColor } from "../../domain/graph";
    import type { ContactsSettings } from "../../domain/model";
    import type { ContactSummary } from "../../domain/person";

    let {
        settings,
        onOpenDetail,
    }: {
        settings: ContactsSettings;
        onOpenDetail: (person: ContactSummary) => void;
    } = $props();

    let container: HTMLElement | undefined = $state();
    let people: ContactSummary[] = $state([]);
    let loading: boolean = $state(true);
    let errorText: string = $state("");
    let truncated: boolean = $state(false);

    /** cytoscape 无法用 CSS 变量，挂载时从主题运行时取值 */
    function themeColors(): { text: string; edge: string } {
        const probe = container ?? document.body;
        const style = getComputedStyle(probe);
        return {
            text: style.getPropertyValue("--b3-theme-on-surface").trim() || "#8f8f8f",
            edge: style.getPropertyValue("--b3-border-color").trim() || "#cccccc",
        };
    }

    async function refresh() {
        loading = true;
        errorText = "";
        try {
            people = await listContacts(settings);
        } catch (error) {
            errorText = error instanceof Error ? error.message : String(error);
        } finally {
            loading = false;
        }
    }

    $effect(() => {
        if (!container || people.length === 0) return;
        const capped = capGraph(buildGraph(people));
        truncated = capped.truncated;
        if (capped.graph.nodes.length === 0) return;
        const palette = themeColors();

        const instance = cytoscape({
            container,
            elements: [
                ...capped.graph.nodes.map((node) => ({
                    data: {
                        id: node.id,
                        label: node.label,
                        degree: node.degree,
                        color: groupColor(node.group),
                    },
                })),
                ...capped.graph.edges.map((edge) => ({
                    data: { source: edge.source, target: edge.target },
                })),
            ],
            layout: { name: "cose", animate: true, padding: 30 },
            style: [
                {
                    selector: "node",
                    style: {
                        label: "data(label)",
                        "background-color": "data(color)",
                        width: "mapData(degree, 0, 6, 24, 48)",
                        height: "mapData(degree, 0, 6, 24, 48)",
                        "font-size": 11,
                        color: palette.text,
                        "text-valign": "bottom",
                        "text-margin-y": 4,
                    },
                },
                {
                    selector: "edge",
                    style: {
                        width: 1.5,
                        "line-color": palette.edge,
                        "curve-style": "bezier",
                    },
                },
            ],
        });

        instance.on("tap", "node", (event: cytoscape.EventObject) => {
            const docId = event.target.id();
            const person = people.find((item) => item.docId === docId);
            if (person) onOpenDetail(person);
        });

        return () => {
            instance.destroy();
        };
    });

    refresh();
</script>

<div class="lvct-graph-view">
    <div class="lvct-people__toolbar fn__flex">
        <span class="ft__smaller ft__on-surface lvct-graph-legend">
            {#each Object.entries({ "家人": "#e05a5a", "朋友": "#4caf7d", "同事": "#4a8fe0", "同学": "#e0a13a" }) as [group, color] (group)}
                <span class="lvct-graph-legend__item"><i style={`background:${color}`}></i>{group}</span>
            {/each}
        </span>
        <span class="fn__flex-1"></span>
        <button class="b3-button b3-button--outline" onclick={refresh}>刷新</button>
    </div>

    {#if truncated}
        <div class="ft__smaller ft__on-surface lvct-graph-note">
            联系人超过 {GRAPH_MAX_NODES}，当前只展示关系最多的 {GRAPH_MAX_NODES} 人（用分组筛选或搜索缩小范围可看全）。
        </div>
    {/if}

    {#if errorText}
        <div class="lvct-form__error">加载失败：{errorText}</div>
    {:else if loading}
        <div class="lvct-placeholder">加载中…</div>
    {:else if people.length === 0}
        <div class="lvct-placeholder">先在「联系人」页创建联系人，关系建立后图谱会自动生成。</div>
    {:else}
        <div class="lvct-graph-view__canvas" bind:this={container}></div>
    {/if}
</div>
