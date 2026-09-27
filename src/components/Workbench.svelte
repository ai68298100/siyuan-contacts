<script lang="ts">
    /**
     * 主工作台：首页(仪表盘) + 联系人(卡片/表格) + 关系图谱。
     * 人物详情弹窗在此层统一承载，各视图共用。
     */
    import PeopleView from "./people/PeopleView.svelte";
    import PersonDetail from "./people/PersonDetail.svelte";
    import RelationGraph from "./graph/RelationGraph.svelte";
    import DashboardView from "./dashboard/DashboardView.svelte";
    import type { ContactsSettings } from "../domain/model";
    import type { ContactSummary } from "../domain/person";
    import type { ContactsPluginFacade } from "../types";

    let {
        facade,
        settings,
        isMobile,
        onOpenPersonDoc,
    }: {
        facade: ContactsPluginFacade;
        settings: ContactsSettings;
        isMobile: boolean;
        onOpenPersonDoc: (docId: string) => void;
    } = $props();

    type ViewId = "home" | "people" | "graph";

    const views: readonly { id: ViewId; label: string; enabled: boolean }[] = [
        { id: "home", label: "首页", enabled: true },
        { id: "people", label: "联系人", enabled: true },
        { id: "graph", label: "关系图谱", enabled: true },
    ];

    let current: ViewId = $state("home");
    let detailPerson: ContactSummary | null = $state(null);
    let detailKey = $state(0);

    function openDetail(person: ContactSummary) {
        detailPerson = person;
        detailKey += 1; // 同一人重复打开时重置内部状态
    }
</script>

<div class="lvct-workbench fn__flex-column">
    <nav class="lvct-workbench__nav fn__flex">
        {#each views as view (view.id)}
            <button
                class="lvct-workbench__nav-item"
                class:lvct-workbench__nav-item--active={current === view.id}
                onclick={() => (current = view.id)}
            >
                {view.label}
            </button>
        {/each}
        <span class="fn__flex-1"></span>
        <button class="lvct-workbench__nav-item b3-button--small" title="打开插件设置" onclick={() => facade.openSettings()}>设置</button>
    </nav>

    <div class="lvct-workbench__body fn__flex-1">
        {#if current === "home"}
            <DashboardView {facade} onOpenDetail={openDetail} />
        {:else if current === "people"}
            <PeopleView
                {settings}
                {onOpenPersonDoc}
                onOpenDetail={openDetail}
            />
        {:else if current === "graph"}
            <RelationGraph
                {settings}
                onOpenDetail={openDetail}
            />
        {/if}
    </div>

    {#if isMobile}
        <div class="lvct-workbench__mobile-hint ft__smaller ft__on-surface">小屏模式：点击联系人文档名可直接跳转原文档。</div>
    {/if}
</div>

{#if detailPerson}
    <div class="lvct-dialog-mask" role="presentation" onclick={(event) => { if (event.target === event.currentTarget) detailPerson = null; }}>
        <div class="lvct-dialog-panel">
            {#key detailKey}
            <PersonDetail
                {settings}
                person={detailPerson}
                onRecord={(personDocId, note) => facade.recordInteraction(personDocId, note)}
                onLoadInsights={(docId) => facade.loadPersonInsights(docId)}
                {onOpenPersonDoc}
                onChanged={() => {}}
                onClose={() => (detailPerson = null)}
            />
            {/key}
        </div>
    </div>
{/if}
