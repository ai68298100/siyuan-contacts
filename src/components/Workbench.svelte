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
    import { createCloseScope, anyDirtyChanges } from "./close-guard";
    import { House, UsersRound, Network, Settings, Building2, Sparkles, UserPlus } from "@lucide/svelte";
    import SettingsView from "./SettingsView.svelte";
    import { onMount } from "svelte";
    import { translateText } from "../domain/translation";
    import { subscribeDataChanged } from "../libs/data-events";
    import StatusNotice from "./StatusNotice.svelte";
    import type { ContactsSettings } from "../domain/model";
    import type { ViewPreferences } from "../domain/preferences";
    import type { ContactSummary } from "../domain/person";
    import type { ContactsPluginFacade, WorkbenchView } from "../types";

    let {
        facade,
        settings,
        preferences,
        initialView,
        isMobile,
        onPreferencesUpdated,
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
    const text = $derived.by(() => (key: string, fallback: string, values?: Record<string, string | number>) =>
        translateText(facade.i18n, key, fallback, values));
    const canLeave = createCloseScope();

    const views: readonly { id: ViewId; label: string; shortLabel: string; enabled: boolean }[] = $derived([
        { id: "home", label: text("navHome", "首页"), shortLabel: text("navHome", "首页"), enabled: true },
        { id: "people", label: text("navPeople", "联系人"), shortLabel: text("navPeople", "联系人"), enabled: true },
        { id: "graph", label: text("navGraph", "关系图谱"), shortLabel: text("navGraphShort", "关系图"), enabled: true },
    ]);

    const viewMeta: Record<ViewId, { title: string; subtitle: string }> = $derived({
        home: { title: text("navHome", "首页"), subtitle: text("homeSubtitle", "今天该关注谁") },
        people: { title: text("navPeople", "联系人"), subtitle: text("peopleSubtitle", "管理你的联系人与资料") },
        graph: { title: text("navGraph", "关系图谱"), subtitle: text("graphSubtitle", "查看人际关系网络") },
        settings: { title: text("navSettings", "设置"), subtitle: text("settingsSubtitle", "检查数据锚点与插件行为") },
    });

    // svelte-ignore state_referenced_locally
    let current: ViewId = $state(initialView ?? preferences.defaultView);
    // svelte-ignore state_referenced_locally
    let currentSettings: ContactsSettings = $state(settings);
    // svelte-ignore state_referenced_locally
    let currentPreferences: ViewPreferences = $state(preferences);
    let detailPerson: ContactSummary | null = $state(null);
    let detailKey = $state(0);
    let peopleOrder: ContactSummary[] = $state([]);
    let globalSearch = $state("");
    let createRequested = $state(0);
    let dataRevision = $state(0);
    let peopleFocusIds: string[] = $state([]);
    let peopleFocusLabel = $state("");
    let peopleFocusSort: "name" | "group" | "birthday" | "recent" | undefined = $state(undefined);
    const currentMeta = $derived(viewMeta[current]);

    async function openDetail(person: ContactSummary) {
        if (detailPerson && !(await canLeave.requestClose())) return;
        detailPerson = person;
        detailKey += 1; // 同一人重复打开时重置内部状态
    }

    function clearPeopleFocus() {
        peopleFocusIds = [];
        peopleFocusLabel = "";
        peopleFocusSort = undefined;
    }

    async function selectView(view: ViewId) {
        if (view !== current && !(await canLeave.requestClose())) return;
        current = view;
        if (view !== "people") createRequested = 0;
        clearPeopleFocus();
    }

    async function openPeople(focus?: { itemIds: readonly string[]; label: string; sort?: "name" | "group" | "birthday" | "recent" }) {
        if (current !== "people" && !(await canLeave.requestClose())) return;
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

    // FUNC-01.7：跨窗口/宿主数据变化 → 防抖合并后 bump revision 原地刷新（筛选与 Peek 上下文保留）；
    // 有未保存草稿时不静默：追加一条可见提示（草稿在弹窗本地状态中，列表刷新不覆盖草稿）。
    let dataChangeNotice = $state("");
    let dataChangeTimer = 0;
    $effect(() => {
        return subscribeDataChanged(() => {
            window.clearTimeout(dataChangeTimer);
            dataChangeTimer = window.setTimeout(() => {
                dataChangeTimer = 0;
                dataRevision += 1;
                if (anyDirtyChanges()) {
                    dataChangeNotice = text("dataChangedWhileEditing", "数据已在其他窗口更新：列表已刷新，未保存的草稿已保留。");
                }
            }, 400);
        });
    });
</script>

<div class="lvct-workbench">
    <aside class="lvct-workbench__sidebar" aria-label={text("navigationLabel", "小驴人脉导航")}>
        <div class="lvct-workbench__brand">
            <span class="lvct-workbench__brand-mark">驴</span>
            <span>
                <b>{text("tabTitle", "小驴人脉")}</b>
                <small>Lv Contacts</small>
            </span>
        </div>
        <nav class="lvct-workbench__nav">
            <span class="lvct-workbench__nav-label">{text("navWorkspace", "工作台")}</span>
            {#each views as view (view.id)}
                <button
                    class="lvct-workbench__nav-item"
                    class:lvct-workbench__nav-item--active={current === view.id}
                    disabled={!view.enabled}
                    aria-current={current === view.id ? "page" : undefined}
                    onclick={() => selectView(view.id)}
                >
                    <span class="lvct-workbench__nav-icon" aria-hidden="true">{#if view.id === "home"}<House size={16}/>{:else if view.id === "people"}<UsersRound size={16}/>{:else}<Network size={16}/>{/if}</span><span class="lvct-workbench__nav-text">{isMobile ? view.shortLabel : view.label}</span>
                </button>
            {/each}
            <span class="lvct-workbench__nav-label lvct-workbench__nav-label--secondary">{text("navUpcoming", "即将推出")}</span>
            <button class="lvct-workbench__nav-item" disabled><span class="lvct-workbench__nav-icon" aria-hidden="true"><Building2 size={16}/></span><span class="lvct-workbench__nav-text">{text("navOrganizations", "组织")}</span></button>
            <button class="lvct-workbench__nav-item" disabled><span class="lvct-workbench__nav-icon" aria-hidden="true"><Sparkles size={16}/></span><span class="lvct-workbench__nav-text">{text("navSuggestions", "建议")}</span></button>
        </nav>
        <div class="lvct-workbench__sidebar-footer">
            <button class="lvct-workbench__nav-item" title={text("openSettings", "打开插件设置")} onclick={() => selectView("settings")}>
                <span class="lvct-workbench__nav-icon" aria-hidden="true"><Settings size={16}/></span><span class="lvct-workbench__nav-text">{text("navSettings", "设置")}</span>
            </button>
        </div>
    </aside>

    <main class="lvct-workbench__main">
        <header class="lvct-workbench__header">
            <div>
                <h1>{currentMeta.title}</h1>
                <p>{currentMeta.subtitle}</p>
            </div>
            {#if current === "home"}<div class="lvct-workbench__header-actions">
                <input class="b3-text-field" type="search" aria-label="搜索联系人" placeholder="搜索联系人" bind:value={globalSearch}
                    oninput={() => { if (globalSearch.trim() && current !== "people") selectView("people"); }} />
                <button type="button" class="b3-button b3-button--text" onclick={() => { selectView("people"); createRequested += 1; }}><UserPlus size={16}/>新建联系人</button>
            </div>{/if}
        </header>
        <StatusNotice message={dataChangeNotice} onDismiss={() => (dataChangeNotice = "")} />
        <div class="lvct-workbench__body">
            {#if current === "home"}
                <DashboardView
                    {facade}
                    revision={dataRevision}
                    preferences={currentPreferences}
                    onPreferencesChange={async (next) => {
                        const saved = await facade.saveViewPreferences(next);
                        currentPreferences = saved;
                        onPreferencesUpdated(saved);
                        return saved;
                    }}
                    onOpenDetail={openDetail}
                    onOpenPeople={openPeople}
                    onOpenGraph={() => selectView("graph")}
                />
            {:else if current === "people"}
                <PeopleView
                    settings={currentSettings}
                    i18n={facade.i18n}
                    preferences={currentPreferences}
                    loadRecentInteractions={() => facade.loadRecentInteractions()}
                    initialSort={peopleFocusSort ?? currentPreferences.peopleSort}
                    focusIds={peopleFocusIds}
                    focusLabel={peopleFocusLabel}
                    externalSearch={globalSearch}
                    {createRequested}
                    onClearFocus={clearPeopleFocus}
                    revision={dataRevision}
                    onOpenDetail={openDetail}
                    activePersonId={detailPerson?.itemId ?? ""}
                    onOrderChange={(ordered) => {
                        if (ordered.map((person) => person.itemId).join("|") !== peopleOrder.map((person) => person.itemId).join("|")) peopleOrder = ordered;
                    }}
                    onPreferencesChange={async (next) => {
                        const saved = await facade.saveViewPreferences(next);
                        currentPreferences = saved;
                        onPreferencesUpdated(saved);
                        return saved;
                    }}
                    {onOpenPersonDoc}
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
                    i18n={facade.i18n}
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
                    onOpenPeople={(focus) => void openPeople(focus)}
                />
            {/if}
        </div>

    </main>
</div>

{#if detailPerson}
    <LvctDialog title={text("personDetailTitle", "人物详情 · {name}", { name: detailPerson.name })} closeLabel={text("closeDialog", "关闭")} peek modal={isMobile} closeOnBackdrop={false} onClose={() => (detailPerson = null)}>
        {#key detailKey}
        <PersonDetail
            settings={currentSettings}
            i18n={facade.i18n}
            person={detailPerson}
            onRecord={(personDocId, note) => facade.recordInteraction(personDocId, note)}
            onDeleteInteraction={(personDocId, eventId) => facade.deleteInteraction(personDocId, eventId)}
            onLoadInsights={(docId) => facade.loadPersonInsights(docId)}
            onListFollowUps={(docId) => facade.listPersonFollowUps(docId)}
            onCreateFollowUp={(docId, title, dueDate) => facade.createFollowUp(docId, title, dueDate)}
            onSetFollowUpStatus={(id, status) => facade.setFollowUpStatus(id, status)}
            onSnoozeFollowUp={(id, option, customDate) => facade.snoozeFollowUp(id, option, customDate)}
            onGetCadence={(docId) => facade.getPersonCadence(docId)}
            onSaveCadence={(docId, cadence) => facade.savePersonCadence(docId, cadence)}
            onListTemplates={() => facade.listTemplates()}
            onSaveTemplates={(templates) => facade.saveTemplates(templates)}
            {onOpenPersonDoc}
            onNavigate={openDetail}
            navigationOrder={current === "people" ? peopleOrder : undefined}
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
