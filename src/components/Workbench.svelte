<script lang="ts">
    /**
     * 主工作台：首页(仪表盘) + 联系人(卡片/表格) + 关系图谱。
     * 人物详情弹窗在此层统一承载，各视图共用。
     */
    import PeopleView from "./people/PeopleView.svelte";
    import PersonDetail from "./people/PersonDetail.svelte";
    import RelationGraph from "./graph/RelationGraph.svelte";
    import DashboardView from "./dashboard/DashboardView.svelte";
    import LvctDialog from "./LvctDialog.svelte";
    import SettingsView from "./SettingsView.svelte";
    import { onMount } from "svelte";
    import type { ContactsSettings } from "../domain/model";
    import type { ViewPreferences } from "../domain/preferences";
    import type { ContactSummary } from "../domain/person";
    import type { ContactsPluginFacade, WorkbenchView } from "../types";

    let {
        facade,
        settings,
        preferences,
        initialView,
        onPreferencesUpdated,
        isMobile,
        onOpenPersonDoc,
    }: {
        facade: ContactsPluginFacade;
        settings: ContactsSettings;
        preferences: ViewPreferences;
        initialView?: WorkbenchView;
        onPreferencesUpdated: (preferences: ViewPreferences) => void;
        isMobile: boolean;
        onOpenPersonDoc: (docId: string) => void;
    } = $props();

    type ViewId = WorkbenchView;

    const views: readonly { id: ViewId; label: string; icon: string; enabled: boolean }[] = [
        { id: "home", label: "首页", icon: "⌂", enabled: true },
        { id: "people", label: "联系人", icon: "♙", enabled: true },
        { id: "graph", label: "关系图谱", icon: "⌘", enabled: true },
    ];

    const viewMeta: Record<ViewId, { title: string; subtitle: string }> = {
        home: { title: "首页", subtitle: "今天该关注谁" },
        people: { title: "联系人", subtitle: "管理你的联系人与资料" },
        graph: { title: "关系图谱", subtitle: "查看人际关系网络" },
        settings: { title: "设置", subtitle: "检查数据锚点与插件行为" },
    };

    // svelte-ignore state_referenced_locally
    let current: ViewId = $state(initialView ?? preferences.defaultView);
    // svelte-ignore state_referenced_locally
    let currentSettings: ContactsSettings = $state(settings);
    // svelte-ignore state_referenced_locally
    let currentPreferences: ViewPreferences = $state(preferences);
    let detailPerson: ContactSummary | null = $state(null);
    let detailKey = $state(0);
    let dataRevision = $state(0);
    let peopleFocusIds: string[] = $state([]);
    let peopleFocusLabel = $state("");
    let peopleFocusSort: "name" | "group" | "birthday" | undefined = $state(undefined);
    const currentMeta = $derived(viewMeta[current]);

    function openDetail(person: ContactSummary) {
        detailPerson = person;
        detailKey += 1; // 同一人重复打开时重置内部状态
    }

    function clearPeopleFocus() {
        peopleFocusIds = [];
        peopleFocusLabel = "";
        peopleFocusSort = undefined;
    }

    function selectView(view: ViewId) {
        current = view;
        clearPeopleFocus();
    }

    function openPeople(focus?: { itemIds: readonly string[]; label: string; sort?: "name" | "group" | "birthday" }) {
        current = "people";
        peopleFocusIds = focus?.itemIds ? [...focus.itemIds] : [];
        peopleFocusLabel = focus?.label ?? "";
        peopleFocusSort = focus?.sort;
    }

    onMount(() => {
        const handleRequestedView = (event: Event) => {
            const view = (event as CustomEvent<{ view?: string }>).detail?.view;
            if (view === "home" || view === "people" || view === "graph" || view === "settings") {
                selectView(view);
            }
        };
        window.addEventListener("lvct-workbench-view", handleRequestedView);
        return () => window.removeEventListener("lvct-workbench-view", handleRequestedView);
    });
</script>

<div class="lvct-workbench">
    <aside class="lvct-workbench__sidebar" aria-label="小驴人脉导航">
        <div class="lvct-workbench__brand">
            <span class="lvct-workbench__brand-mark">驴</span>
            <span>
                <b>小驴人脉</b>
                <small>Lv Contacts</small>
            </span>
        </div>
        <nav class="lvct-workbench__nav">
            <span class="lvct-workbench__nav-label">工作台</span>
            {#each views as view (view.id)}
                <button
                    class="lvct-workbench__nav-item"
                    class:lvct-workbench__nav-item--active={current === view.id}
                    disabled={!view.enabled}
                    aria-current={current === view.id ? "page" : undefined}
                    onclick={() => selectView(view.id)}
                >
                    <span aria-hidden="true">{view.icon}</span>{view.label}
                </button>
            {/each}
            <span class="lvct-workbench__nav-label lvct-workbench__nav-label--secondary">即将推出</span>
            <button class="lvct-workbench__nav-item" disabled><span aria-hidden="true">＋</span>组织</button>
            <button class="lvct-workbench__nav-item" disabled><span aria-hidden="true">✦</span>建议</button>
        </nav>
        <div class="lvct-workbench__sidebar-footer">
            <button class="lvct-workbench__nav-item" title="打开插件设置" onclick={() => selectView("settings")}>
                <span aria-hidden="true">⚙</span>设置
            </button>
        </div>
    </aside>

    <main class="lvct-workbench__main">
        <header class="lvct-workbench__header">
            <div>
                <h1>{currentMeta.title}</h1>
                <p>{currentMeta.subtitle}</p>
            </div>
        </header>
        <div class="lvct-workbench__body">
            {#if current === "home"}
                <DashboardView
                    {facade}
                    revision={dataRevision}
                    preferences={currentPreferences}
                    onOpenDetail={openDetail}
                    onOpenPeople={openPeople}
                    onOpenGraph={() => selectView("graph")}
                />
            {:else if current === "people"}
                <PeopleView
                    settings={currentSettings}
                    initialSort={peopleFocusSort ?? currentPreferences.peopleSort}
                    focusIds={peopleFocusIds}
                    focusLabel={peopleFocusLabel}
                    onClearFocus={clearPeopleFocus}
                    revision={dataRevision}
                    onOpenDetail={openDetail}
                />
            {:else if current === "graph"}
                <RelationGraph
                    settings={currentSettings}
                    {facade}
                    revision={dataRevision}
                    onOpenDetail={openDetail}
                    onOpenPeople={() => selectView("people")}
                />
            {:else if current === "settings"}
                <SettingsView
                    {facade}
                    settings={currentSettings}
                    preferences={currentPreferences}
                    onSettingsUpdated={(updated) => {
                        currentSettings = updated;
                        detailPerson = null;
                        clearPeopleFocus();
                        dataRevision += 1;
                    }}
                    onPreferencesUpdated={(updated) => {
                        currentPreferences = updated;
                        onPreferencesUpdated(updated);
                    }}
                    onBack={() => (current = "home")}
                    onInteractionsUpdated={() => (dataRevision += 1)}
                />
            {/if}
        </div>

        {#if isMobile}
            <div class="lvct-workbench__mobile-hint ft__smaller ft__on-surface">使用底部 Tab 在首页、联系人、图谱与设置之间切换。</div>
        {/if}
    </main>
</div>

{#if detailPerson}
    <LvctDialog title={`人物详情 · ${detailPerson.name}`} peek closeOnBackdrop={false} onClose={() => (detailPerson = null)}>
        {#key detailKey}
        <PersonDetail
            settings={currentSettings}
            person={detailPerson}
            onRecord={(personDocId, note) => facade.recordInteraction(personDocId, note)}
            onDeleteInteraction={(personDocId, eventId) => facade.deleteInteraction(personDocId, eventId)}
            onLoadInsights={(docId) => facade.loadPersonInsights(docId)}
            {onOpenPersonDoc}
            onNavigate={openDetail}
            onChanged={() => (dataRevision += 1)}
            onDeleted={() => {
                detailPerson = null;
                dataRevision += 1;
            }}
            onClose={() => (detailPerson = null)}
        />
        {/key}
    </LvctDialog>
{/if}
