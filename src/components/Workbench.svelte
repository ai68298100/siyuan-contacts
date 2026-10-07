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
    import OrgsView from "./org/OrgsView.svelte";
    import OrgManagerDialog from "./org/OrgManagerDialog.svelte";
    import { createCloseScope, anyDirtyChanges } from "./close-guard";
    import { House, UsersRound, Network, Settings, Building2, Sparkles, UserPlus } from "@lucide/svelte";
    import SettingsView from "./SettingsView.svelte";
    import { getContext, onDestroy, onMount, tick } from "svelte";
    import { translateText } from "../domain/translation";
    import { subscribeDataChangedDebounced, subscribePersonNavigation } from "../libs/data-events";
    import { isNavigationDocId, personReturnContext, resolveNavigationPerson } from "../domain/navigation";
    import type { PersonReturnContext } from "../domain/navigation";
    import StatusNotice from "./StatusNotice.svelte";
    import { invalidateRoster } from "../services/roster";
    import type { ContactsSettings } from "../domain/model";
    import type { ViewPreferences } from "../domain/preferences";
    import { normalizeViewPreferences } from "../domain/preferences";
    import { createPreferenceRequests, savePreferenceChanges } from "../services/preferences";
    import { createLifecycleToken, LIFECYCLE_CONTEXT, type LifecycleToken } from "../domain/lifecycle";
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
    // Keep the message object as an explicit reactive dependency.  Returning a
    // function from `$derived` hid the actual `facade.i18n` read from derived
    // values such as `viewMeta`, so their first render could retain Chinese
    // fallback titles while the navigation (which calls `text` directly) had
    // already switched to English.
    const messages = $derived(facade.i18n);
    const text = (key: string, fallback: string, values?: Record<string, string | number>) =>
        translateText(messages, key, fallback, values);
    const canLeave = createCloseScope();
    const mountToken = getContext<LifecycleToken | undefined>(LIFECYCLE_CONTEXT);
    const lifecycleToken = createLifecycleToken(mountToken);
    onDestroy(lifecycleToken.invalidate);

    const views: readonly { id: ViewId; label: string; shortLabel: string; enabled: boolean }[] = $derived([
        { id: "home", label: text("navHome", "首页"), shortLabel: text("navHome", "首页"), enabled: true },
        { id: "people", label: text("navPeople", "联系人"), shortLabel: text("navPeople", "联系人"), enabled: true },
        { id: "graph", label: text("navGraph", "关系图谱"), shortLabel: text("navGraphShort", "关系图"), enabled: true },
        { id: "orgs", label: text("navOrganizations", "组织"), shortLabel: text("navOrganizations", "组织"), enabled: true },
    ]);

    const viewMeta: Record<ViewId, { title: string; subtitle: string }> = $derived.by(() => {
        // Read `messages` in this derived computation so a supplied locale is
        // reflected in the page heading as well as in the sidebar labels.
        const localized = messages;
        const t = (key: string, fallback: string) => translateText(localized, key, fallback);
        return {
            // The page heading names the workspace section; the dashboard keeps
            // its more conversational greeting inside the content area.
            home: { title: t("navHome", "首页"), subtitle: t("dashHomeSubtitle", "把记忆变成下一步；每条提醒都说明出现原因") },
            people: { title: t("navPeople", "联系人"), subtitle: t("peopleSubtitle", "管理你的联系人与资料") },
            graph: { title: t("navGraph", "关系图谱"), subtitle: t("graphPageSubtitle", "只呈现当前范围内有来源的连接；没有连线不能证明两人没有关系") },
            orgs: { title: t("navOrganizations", "组织"), subtitle: t("orgsSubtitle", "公司与学校等归属维度") },
            settings: { title: t("navSettings", "设置"), subtitle: t("settingsSubtitle", "检查数据锚点与插件行为") },
        };
    });

    // svelte-ignore state_referenced_locally
    let current: ViewId = $state(initialView ?? preferences.defaultView);
    // svelte-ignore state_referenced_locally
    let currentSettings: ContactsSettings = $state(settings);
    // svelte-ignore state_referenced_locally
    let currentPreferences: ViewPreferences = $state(preferences);
    let preferencesNotice = $state("");
    const preferenceRequests = createPreferenceRequests({
        load: () => typeof facade.loadViewPreferences === "function"
            ? facade.loadViewPreferences() : Promise.resolve(currentPreferences),
        save: (next, baseline) => typeof facade.saveViewPreferences === "function"
            ? savePreferenceChanges(facade, next, baseline) : Promise.resolve(next),
        apply: applyPreferences,
        fail: (error) => {
            if (!lifecycleToken.isAlive()) return;
            preferencesNotice = `偏好读取或保存失败，当前结果尚未核实：${error instanceof Error ? error.message : String(error)}`;
        },
    });
    lifecycleToken.onDispose(preferenceRequests.dispose);

    function applyPreferences(updated: ViewPreferences) {
        if (!lifecycleToken.isAlive()) return;
        if (updated.revision < currentPreferences.revision) return;
        currentPreferences = updated;
        preferencesNotice = "";
        onPreferencesUpdated(updated);
    }

    function savePreferences(next: ViewPreferences, baseline?: ViewPreferences): Promise<ViewPreferences> {
        const effectiveBaseline = normalizeViewPreferences(baseline ?? currentPreferences);
        return preferenceRequests.save(next, effectiveBaseline);
    }
    let detailPerson: ContactSummary | null = $state(null);
    let detailReturn = $state<PersonReturnContext | null>(null);
    let organizationOpen = $state(false);
    let organizationDocId = $state("");
    let workbenchElement: HTMLDivElement | undefined = $state();
    let navigationError = $state("");
    let navigationRequest = 0;
    type ReturnDom = { trigger: HTMLElement | null; scrolls: Array<{ element: HTMLElement; top: number; left: number }> };
    let detailDom: ReturnDom | null = null;
    let organizationDom: ReturnDom | null = null;

    function captureReturn(trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null): ReturnDom {
        const elements = new Set<HTMLElement>();
        let ancestor = trigger;
        while (ancestor) { elements.add(ancestor); ancestor = ancestor.parentElement; }
        const body = workbenchElement?.querySelector<HTMLElement>(".lvct-workbench__body");
        if (body) elements.add(body);
        return { trigger, scrolls: [...elements].map((element) => ({ element, top: element.scrollTop, left: element.scrollLeft })) };
    }

    async function restoreReturn(snapshot: ReturnDom | null, context?: PersonReturnContext | null) {
        await tick();
        if (!lifecycleToken.isAlive()) return;
        for (const position of snapshot?.scrolls ?? []) {
            if (position.element.isConnected) { position.element.scrollTop = position.top; position.element.scrollLeft = position.left; }
        }
        const documentTrigger = context?.kind === "document"
            ? document.querySelector<HTMLElement>(`.lvct-doc-strip[data-person-doc-id="${context.docId}"] [data-lvct-person-entry]`) : null;
        const fallback = organizationOpen ? document.querySelector<HTMLElement>(".lvct-org-manager__members input")
            : workbenchElement?.querySelector<HTMLElement>("h1");
        (snapshot?.trigger?.isConnected ? snapshot.trigger : documentTrigger ?? fallback)?.focus({ preventScroll: true });
    }

    async function closeDetail() {
        const context = detailReturn;
        const snapshot = detailDom;
        detailPerson = null;
        detailReturn = null;
        detailDom = null;
        navigationRequest += 1;
        if (context?.kind === "document") onOpenPersonDoc(context.docId);
        await restoreReturn(snapshot, context);
    }

    async function openOrganization(docId = "") {
        if (docId && !isNavigationDocId(docId)) { navigationError = "组织导航 ID 非法"; return; }
        if (!(await canLeave.requestClose()) || !lifecycleToken.isAlive()) return;
        if (!organizationOpen) organizationDom = captureReturn();
        detailPerson = null;
        detailReturn = null;
        organizationDocId = docId;
        organizationOpen = true;
    }

    async function closeOrganization() {
        organizationOpen = false;
        organizationDocId = "";
        detailPerson = null;
        detailReturn = null;
        navigationRequest += 1;
        await restoreReturn(organizationDom);
        organizationDom = null;
    }

    async function openPersonByDocId(docId: string, context?: PersonReturnContext, trigger?: HTMLElement) {
        if (!(await canLeave.requestClose()) || !lifecycleToken.isAlive()) return;
        const request = ++navigationRequest;
        const snapshot = detailPerson ? detailDom : captureReturn(trigger);
        try {
            const people = await facade.listContacts();
            if (!lifecycleToken.isAlive() || request !== navigationRequest) return;
            const person = resolveNavigationPerson(people, docId);
            if (!detailPerson) {
                detailReturn = context ?? personReturnContext(current, organizationOpen && organizationDocId ? { orgDocId: organizationDocId } : undefined);
                detailDom = snapshot;
            }
            navigationError = "";
            showDetail(person);
        } catch (error) {
            if (lifecycleToken.isAlive() && request === navigationRequest) navigationError = error instanceof Error ? error.message : String(error);
        }
    }
    const detailCloseLabel = $derived(detailReturn?.kind === "organization" ? text("routeReturnOrganization", "返回原组织")
        : detailReturn?.kind === "document" ? text("routeReturnDocument", "返回原文档")
            : text("routeReturnView", "返回{view}", { view: viewMeta[detailReturn?.view ?? current].title }));
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
        if (!lifecycleToken.isAlive()) return;
        if (detailPerson && !(await canLeave.requestClose())) return;
        if (!lifecycleToken.isAlive()) return;
        showDetail(person);
    }

    function showDetail(person: ContactSummary) {
        if (!lifecycleToken.isAlive()) return;
        if (!detailReturn) {
            detailReturn = personReturnContext(current);
            detailDom = captureReturn();
        }
        detailPerson = person;
        detailKey += 1; // 同一人重复打开时重置内部状态
    }

    function clearPeopleFocus() {
        peopleFocusIds = [];
        peopleFocusLabel = "";
        peopleFocusSort = undefined;
    }

    async function selectView(view: ViewId) {
        if (!lifecycleToken.isAlive()) return;
        if ((view !== current || detailPerson || organizationOpen) && !(await canLeave.requestClose())) return;
        if (!lifecycleToken.isAlive()) return;
        current = view;
        detailPerson = null;
        detailReturn = null;
        organizationOpen = false;
        navigationRequest += 1;
        if (view !== "people") createRequested = 0;
        clearPeopleFocus();
    }

    async function openPeople(focus?: { itemIds: readonly string[]; label: string; sort?: "name" | "group" | "birthday" | "recent" }) {
        if (!lifecycleToken.isAlive()) return;
        if (current !== "people" && !(await canLeave.requestClose())) return;
        if (!lifecycleToken.isAlive()) return;
        current = "people";
        peopleFocusIds = focus?.itemIds ? [...focus.itemIds] : [];
        peopleFocusLabel = focus?.label ?? "";
        peopleFocusSort = focus?.sort;
    }

    onMount(() => {
        const unsubscribePerson = subscribePersonNavigation(facade, (request) => {
            void (async () => {
                if (!lifecycleToken.isAlive()) return;
                await openPersonByDocId(request.docId, personReturnContext(current, { docId: request.docId }), request.trigger);
            })();
        }, lifecycleToken);
        lifecycleToken.onDispose(unsubscribePerson);
        const handleRequestedView = (event: Event) => {
            if (!lifecycleToken.isAlive()) return;
            const detail = (event as CustomEvent<{ view?: string; facade?: ContactsPluginFacade; token?: LifecycleToken }>).detail;
            if (detail?.facade && detail.facade !== facade) return;
            if (detail?.token && !detail.token.isAlive()) return;
            if (detail?.token && mountToken !== detail.token) return;
            const view = detail?.view;
            if (view === "home" || view === "people" || view === "graph" || view === "orgs" || view === "settings") {
                void selectView(view);
            }
        };
        window.addEventListener("lvct-workbench-view", handleRequestedView);
        lifecycleToken.onDispose(() => window.removeEventListener("lvct-workbench-view", handleRequestedView));
        return () => {
            lifecycleToken.invalidate();
            window.removeEventListener("lvct-workbench-view", handleRequestedView);
        };
    });

    // FUNC-01.7：跨窗口/宿主数据变化 → 防抖合并后 bump revision 原地刷新（筛选与 Peek 上下文保留）；
    // 有未保存草稿时不静默：追加一条可见提示（草稿在弹窗本地状态中，列表刷新不覆盖草稿）。
    let dataChangeNotice = $state("");
    onMount(() => {
        if (!lifecycleToken.isAlive()) return;
        void preferenceRequests.load().catch(() => {});
        const unsubscribe = subscribeDataChangedDebounced((change) => {
            if (!lifecycleToken.isAlive()) return;
            dataRevision += 1;
            if (change.preferencesError) {
                preferencesNotice = `偏好读取失败，当前值尚未核实：${change.preferencesError}`;
            }
            void preferenceRequests.load().catch(() => {});
            if (anyDirtyChanges()) {
                dataChangeNotice = text("dataChangedWhileEditing", "数据已在其他窗口更新：列表已刷新，未保存的草稿已保留。");
            }
        }, { invalidate: () => { invalidateRoster(); preferenceRequests.invalidate(); }, token: lifecycleToken });
        return () => {
            lifecycleToken.invalidate();
            unsubscribe();
            preferenceRequests.dispose();
        };
    });
</script>

<div class="lvct-workbench" bind:this={workbenchElement}>
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
                    data-navigation-view={view.id}
                    onclick={() => selectView(view.id)}
                >
            <span class="lvct-workbench__nav-icon" aria-hidden="true">{#if view.id === "home"}<House size={16}/>{:else if view.id === "people"}<UsersRound size={16}/>{:else if view.id === "orgs"}<Building2 size={16}/>{:else}<Network size={16}/>{/if}</span><span class="lvct-workbench__nav-text">{isMobile ? view.shortLabel : view.label}</span>
            </button>
            {/each}
            <span class="lvct-workbench__nav-label lvct-workbench__nav-label--secondary">{text("navUpcoming", "即将推出")}</span>
            <button class="lvct-workbench__nav-item" disabled><span class="lvct-workbench__nav-icon" aria-hidden="true"><Sparkles size={16}/></span><span class="lvct-workbench__nav-text">{text("navSuggestions", "建议")}</span></button>
            <button
                class="lvct-workbench__nav-item lvct-workbench__nav-item--mobile-settings"
                class:lvct-workbench__nav-item--active={current === "settings"}
                aria-current={current === "settings" ? "page" : undefined}
                onclick={() => selectView("settings")}
            >
                <span class="lvct-workbench__nav-icon" aria-hidden="true"><Settings size={16}/></span>
                <span class="lvct-workbench__nav-text">{text("navSettings", "设置")}</span>
            </button>
        </nav>
        <div class="lvct-workbench__sidebar-footer">
            <button class="lvct-workbench__nav-item" class:lvct-workbench__nav-item--active={current === "settings"} aria-current={current === "settings" ? "page" : undefined} title={text("openSettings", "打开插件设置")} onclick={() => selectView("settings")}>
                <span class="lvct-workbench__nav-icon" aria-hidden="true"><Settings size={16}/></span><span class="lvct-workbench__nav-text">{text("navSettings", "设置")}</span>
            </button>
        </div>
    </aside>

    <main class="lvct-workbench__main">
        <header class="lvct-workbench__header">
            <div>
                <h1 tabindex="-1">{currentMeta.title}</h1>
                <p>{currentMeta.subtitle}</p>
            </div>
            {#if current === "home"}<div class="lvct-workbench__header-actions">
                <input class="b3-text-field" type="search" aria-label="搜索联系人" placeholder="搜索联系人" bind:value={globalSearch}
                    oninput={() => { if (globalSearch.trim() && current !== "people") selectView("people"); }} />
                <button type="button" class="b3-button" onclick={() => { selectView("people"); createRequested += 1; }}><UserPlus size={16}/>新建联系人</button>
            </div>{/if}
        </header>
        <StatusNotice message={dataChangeNotice} onDismiss={() => (dataChangeNotice = "")} />
        <StatusNotice message={preferencesNotice} error />
        <StatusNotice message={navigationError} error onDismiss={() => (navigationError = "")} />
        {#if preferencesNotice}
            <button class="b3-button b3-button--outline" onclick={() => preferenceRequests.load().catch(() => {})}>重新读取偏好</button>
        {/if}
        <div class="lvct-workbench__body">
            {#if current === "home"}
                <DashboardView
                    {facade}
                    revision={dataRevision}
                    preferences={currentPreferences}
                    onPreferencesChange={savePreferences}
                    onOpenDetail={openDetail}
                    onOpenPeople={openPeople}
                    onOpenGraph={() => selectView("graph")}
                />
            {:else if current === "people"}
                <PeopleView
                    settings={currentSettings}
                    i18n={facade.i18n}
                    isMobile={isMobile}
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
                    onPreferencesChange={savePreferences}
                    {onOpenPersonDoc}
                />
            {:else if current === "graph"}
                <RelationGraph
                    settings={currentSettings}
                    {facade}
                    revision={dataRevision}
                    preferences={currentPreferences}
                    onPreferencesChange={savePreferences}
                    onOpenDetail={openDetail}
                    onOpenPeople={() => selectView("people")}
                    onOpenOrgs={() => selectView("orgs")}
                />
            {:else if current === "orgs"}
                <OrgsView
                    {facade}
                    revision={dataRevision}
                    i18n={facade.i18n}
                    onOpenOrgManager={(docId) => void openOrganization(docId)}
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
                    onPreferencesUpdated={applyPreferences}
                    onBack={() => (current = "home")}
                    onInteractionsUpdated={() => (dataRevision += 1)}
                    onOpenPeople={(focus) => void openPeople(focus)}
                />
            {/if}
        </div>

    </main>
</div>

{#if organizationOpen}
    <LvctDialog title={text("orgManagerTitle", "组织管理")} wide closeOnBackdrop={false} onClose={() => void closeOrganization()}>
        <OrgManagerDialog {facade} i18n={facade.i18n} initialOrgDocId={organizationDocId}
            onOpenPerson={(docId, orgDocId) => void openPersonByDocId(docId, personReturnContext(current, { orgDocId }))} onClose={() => void closeOrganization()} />
    </LvctDialog>
{/if}

{#if detailPerson}
    <LvctDialog title={text("personDetailTitle", "人物详情 · {name}", { name: detailPerson.name })} closeLabel={detailCloseLabel} peek modal={isMobile} closeOnBackdrop={false} onClose={() => void closeDetail()}>
        {#key detailKey}
        <PersonDetail
            settings={currentSettings}
            i18n={facade.i18n}
            person={detailPerson}
            revision={dataRevision}
            onRecord={(personDocId, note) => facade.recordInteraction(personDocId, note)}
            onDeleteInteraction={(personDocId, eventId) => facade.deleteInteraction(personDocId, eventId)}
            onLoadInsights={(docId) => facade.loadPersonInsights(docId)}
            onLoadPersonNote={(docId) => facade.loadPersonNote(docId)}
            onSavePersonNote={(docId, note, expected) => facade.savePersonNote(docId, note, expected)}
            onLoadExchanges={(docId) => facade.listPersonExchanges(docId)}
            onCreateExchange={(input) => facade.createPersonExchange(input)}
            onChangeExchangeStatus={(id, status, settledOn) => facade.changePersonExchangeStatus(id, status, settledOn)}
            onLoadAliases={(docId) => facade.listPersonAliases(docId)}
            onAddAlias={(docId, alias) => facade.addPersonAlias(docId, alias)}
            onRemoveAlias={(id) => facade.removePersonAlias(id)}
            onLoadRelationshipLabels={facade.loadPersonRelationshipLabels ? (docId) => facade.loadPersonRelationshipLabels(docId) : undefined}
            onSaveRelationshipLabels={facade.savePersonRelationshipLabels ? (docId, selfDocId, labels, expected) => facade.savePersonRelationshipLabels(docId, selfDocId, labels, expected) : undefined}
            onLoadOrgMemberships={(docId) => facade.listPersonOrgMemberships(docId)}
            onLoadCommonOrgs={(docId) => facade.listCommonOrgBackground(docId)}
            onOpenOrgManager={() => void openOrganization()}
            onOpenOrganization={(docId) => void openOrganization(docId)}
            onLoadOrgCandidates={async () => (await facade.listOrganizations())
                .filter((org) => !org.archived).map((org) => ({ docId: org.docId, name: org.name }))}
            onAddOrgMembership={(personDocId, orgDocId, extra) => facade.addOrganizationMember(orgDocId, personDocId, extra)}
            onRemoveOrgMembership={(id, expected) => facade.removeOrganizationMember(id, expected)}
            onUpdateOrgMembership={(id, patch, expected) => facade.updateOrganizationMember(id, patch, expected)}
            onListFollowUps={(docId) => facade.listPersonFollowUps(docId)}
            onCreateFollowUp={(docId, title, dueDate) => facade.createFollowUp(docId, title, dueDate)}
            onSetFollowUpStatus={(id, status) => facade.setFollowUpStatus(id, status)}
            onSnoozeFollowUp={(id, option, customDate) => facade.snoozeFollowUp(id, option, customDate)}
            onGetCadence={(docId) => facade.getPersonCadence(docId)}
            onSaveCadence={(docId, cadence) => facade.savePersonCadence(docId, cadence)}
            onListTemplates={() => facade.listTemplates()}
            onSaveTemplates={(templates) => facade.saveTemplates(templates)}
            {onOpenPersonDoc}
            onNavigate={showDetail}
            onNavigateDocId={(docId) => openPersonByDocId(docId)}
            closeLabel={detailCloseLabel}
            navigationOrder={current === "people" ? peopleOrder : undefined}
            onChanged={() => (dataRevision += 1)}
            onDeleted={() => {
                void closeDetail();
                dataRevision += 1;
            }}
            onClose={() => void closeDetail()}
        />
        {/key}
    </LvctDialog>
{/if}
