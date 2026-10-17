<script lang="ts">
    import { requestErrorMessage } from "../shared/error-presenter";
    /**
     * 主工作台：首页(仪表盘) + 联系人(卡片/表格) + 关系图谱。
     * 人物详情弹窗在此层统一承载，各视图共用。
     */
    import PeopleView from "./people/PeopleView.svelte";
    import PersonDetail from "./people/PersonDetail.svelte";
    import RelationGraphLoader from "./graph/RelationGraphLoader.svelte";
    import DashboardView from "./dashboard/DashboardView.svelte";
    import LvctDialog from "./LvctDialog.svelte";
    import OrgsView from "./org/OrgsView.svelte";
    import OrgManagerDialog from "./org/OrgManagerDialog.svelte";
    import OrganizationProfileEditor from "./org/OrganizationProfileEditor.svelte";
    import { createCloseScope, anyDirtyChanges } from "./close-guard";
    import { House, UsersRound, Network, Settings, Building2, Sparkles, UserPlus, Search } from "@lucide/svelte";
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
    import { OrganizationProfileConflictError } from "../data/organization-profiles";
    import { normalizeOrganizationProfileDraft } from "../domain/organization-profile";

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
    const validViewIds: readonly ViewId[] = ["home", "people", "graph", "orgs", "settings"];
    const WORKBENCH_HISTORY_KEY = "__lvctWorkbench";
    type WorkbenchHistoryEntry = { view: ViewId; index: number };
    function historyEntry(state: unknown = window.history.state): WorkbenchHistoryEntry | undefined {
        if (!state || typeof state !== "object") return undefined;
        const entry = (state as Record<string, unknown>)[WORKBENCH_HISTORY_KEY];
        if (!entry || typeof entry !== "object") return undefined;
        const { view, index } = entry as Partial<WorkbenchHistoryEntry>;
        return validViewIds.includes(view as ViewId) && Number.isSafeInteger(index) && (index as number) >= 0
            ? { view: view as ViewId, index: index as number }
            : undefined;
    }
    let historyIndex = historyEntry()?.index ?? 0;
    let historyNavigationRequest = 0;
    function syncViewHistory(view: ViewId, mode: "push" | "replace"): void {
        if (typeof window === "undefined" || !window.history?.pushState) return;
        const previous = window.history.state;
        // History state is structured-cloneable by definition; retain the host's object fields.
        const state = previous && typeof previous === "object" && !Array.isArray(previous) ? { ...previous } : {};
        if (mode === "push") historyIndex += 1;
        state[WORKBENCH_HISTORY_KEY] = { view, index: historyIndex } satisfies WorkbenchHistoryEntry;
        try {
            window.history[mode === "push" ? "pushState" : "replaceState"](state, "", window.location.href);
        } catch {
            // Some embedded hosts restrict History API writes; navigation still works in-place.
        }
    }
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
    let current: ViewId = $state(initialView ?? historyEntry()?.view ?? preferences.defaultView);
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
            preferencesNotice = `偏好读取或保存失败，当前结果尚未核实：${requestErrorMessage(error)}`;
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
    let peopleGroups: string[] = $state([]);
    let detailReturn = $state<PersonReturnContext | null>(null);
    let organizationOpen = $state(false);
    let organizationDocId = $state("");
    let organizationProfileOpen = $state(false);
    let organizationProfileSaving = $state(false);
    let organizationProfileError = $state("");
    let organizationProfileReadOnly = $state(false);
    let organizationProfileDocId = $state("");
    let organizationProfileInitial = $state<Partial<import("../domain/organization-profile").OrganizationProfileDraft>>({});
    // 编辑组织资料时保留打开瞬间的基线；保存前由数据层拒绝覆盖其他窗口的新版本。
    let organizationProfileExpected = $state<import("../domain/organization-profile").OrganizationProfileDraft | null | undefined>(undefined);
    let organizationProfileCreatedDraft = $state<import("../domain/organization-profile").OrganizationProfileDraft | null>(null);
    let organizationProfileEditor: { requestClose: () => Promise<boolean> } | undefined = $state();
    let returnToContactAfterOrganizationProfile = $state(false);
    let organizationProfileCompletion: ((created?: { docId: string; name: string }) => void) | null = $state(null);
    let workbenchElement: HTMLDivElement | undefined = $state();
    let peopleView: {
        focusContact: (itemId: string) => Promise<"restored" | "cancelled" | "missing">;
        cancelContactFocus: () => void;
    } | undefined = $state();
    let navigationError = $state("");
    let navigationRequest = 0;
    type ReturnDom = { trigger: HTMLElement | null; personItemId: string | null; scrolls: Array<{ element: HTMLElement; top: number; left: number }> };
    let detailDom: ReturnDom | null = null;
    let organizationDom: ReturnDom | null = null;

    function captureReturn(trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null): ReturnDom {
        const elements = new Set<HTMLElement>();
        let ancestor = trigger;
        while (ancestor) { elements.add(ancestor); ancestor = ancestor.parentElement; }
        const body = workbenchElement?.querySelector<HTMLElement>(".lvct-workbench__body");
        if (body) elements.add(body);
        return { trigger, personItemId: trigger?.closest<HTMLElement>("[data-person-item-id]")?.dataset.personItemId ?? null,
            scrolls: [...elements].map((element) => ({ element, top: element.scrollTop, left: element.scrollLeft })) };
    }

    async function restoreReturn(snapshot: ReturnDom | null, context?: PersonReturnContext | null) {
        const request = navigationRequest;
        await tick();
        if (!lifecycleToken.isAlive() || request !== navigationRequest || detailPerson) return;
        const contactFocus = snapshot?.personItemId && current === "people" && peopleView
            ? await peopleView.focusContact(snapshot.personItemId) : "missing";
        if (!lifecycleToken.isAlive() || request !== navigationRequest || detailPerson || contactFocus === "cancelled") return;
        for (const position of snapshot?.scrolls ?? []) {
            if (position.element.isConnected) { position.element.scrollTop = position.top; position.element.scrollLeft = position.left; }
        }
        if (contactFocus === "restored") return;
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
        navigationError = "";
        if (!organizationOpen) organizationDom = captureReturn();
        detailPerson = null;
        detailReturn = null;
        organizationDocId = docId;
        organizationOpen = true;
    }

    function showCreateOrganization(returnToContact = false, initialName = ""): void {
        if (!lifecycleToken.isAlive()) return;
        navigationError = "";
        returnToContactAfterOrganizationProfile = returnToContact;
        organizationProfileError = "";
        organizationProfileReadOnly = false;
        organizationProfileDocId = "";
        organizationProfileInitial = { name: initialName.trim() };
        organizationProfileExpected = undefined;
        organizationProfileCreatedDraft = null;
        organizationProfileOpen = true;
    }

    /** 在联系人编辑中创建组织时，等待资料弹窗完成后再刷新候选。 */
    function openCreateOrganizationForContact(initialName?: string): Promise<void | { docId: string; name: string }> {
        if (!lifecycleToken.isAlive() || organizationProfileOpen) return Promise.resolve();
        return new Promise((resolve) => {
            organizationProfileCompletion = (created) => { organizationProfileCompletion = null; resolve(created); };
            showCreateOrganization(true, initialName);
        });
    }

    async function openCreateOrganization() {
        if (!(await canLeave.requestClose()) || !lifecycleToken.isAlive()) return;
        showCreateOrganization();
    }

    async function openEditOrganizationProfile(docId: string) {
        if (!(await canLeave.requestClose()) || !lifecycleToken.isAlive()) return;
        navigationError = "";
        organizationProfileError = "";
        organizationProfileReadOnly = true;
        organizationProfileDocId = docId;
        organizationProfileInitial = {};
        organizationProfileExpected = undefined;
        organizationProfileCreatedDraft = null;
        let profileError = "";
        let profile: import("../domain/organization-profile").OrganizationProfileDraft | undefined;
        let org: { name: string } | undefined;
        try {
            profile = (await facade.loadOrganizationProfile?.(docId)) ?? undefined;
        } catch (error) {
            profileError = requestErrorMessage(error);
        }
        try {
            org = (await facade.listOrganizations()).find((item) => item.docId === docId);
        } catch (error) {
            profileError ||= requestErrorMessage(error);
        }
        if (!lifecycleToken.isAlive() || organizationProfileDocId !== docId) return;
        organizationProfileInitial = profile ?? { name: org?.name ?? "" };
        organizationProfileExpected = profile ?? null;
        organizationProfileReadOnly = Boolean(profileError);
        organizationProfileError = profileError ? `读取组织资料失败：${profileError}。可先核对内容后重试保存。` : "";
        organizationProfileOpen = true;
        if (profileError) {
            queueMicrotask(() => document.querySelector<HTMLElement>(".lvct-org-profile-editor .lvct-form__error")?.focus());
        }
    }

    async function retryOrganizationProfile(): Promise<void> {
        const docId = organizationProfileDocId;
        if (!docId || organizationProfileSaving) return;
        organizationProfileOpen = false;
        await tick();
        if (lifecycleToken.isAlive()) await openEditOrganizationProfile(docId);
    }

    async function saveOrganizationProfile(draft: import("../domain/organization-profile").OrganizationProfileDraft) {
        if (!lifecycleToken.isAlive()) return;
        organizationProfileSaving = true;
        organizationProfileError = "";
        try {
            let docId = organizationProfileDocId;
            if (docId && organizationProfileCreatedDraft) {
                const original = organizationProfileCreatedDraft;
                const fingerprint = JSON.stringify(normalizeOrganizationProfileDraft(original));
                if (JSON.stringify(normalizeOrganizationProfileDraft(draft)) !== fingerprint) throw new Error("组织资料仍待核实，请恢复首次提交的名称和资料后重试；不能用新输入覆盖原请求");
                if (!facade.loadOrganizationProfile || !facade.saveOrganizationProfile) throw new Error("当前环境不能核实组织资料，请重新加载插件后核对；原组织不会再次创建");
                const current = (await facade.listOrganizations()).find((org) => org.docId === docId);
                if (!lifecycleToken.isAlive()) return;
                if (!current || current.name.trim() !== original.name) throw new Error("组织名称或可用状态已变化，请从组织页面重新核对；本次未改名或覆盖资料");
                const profile = await facade.loadOrganizationProfile(docId);
                if (!lifecycleToken.isAlive()) return;
                if (profile && JSON.stringify(normalizeOrganizationProfileDraft(profile)) !== fingerprint) throw new OrganizationProfileConflictError(docId);
                if (!profile) await facade.saveOrganizationProfile(docId, original, null);
                if (!lifecycleToken.isAlive()) return;
            } else if (docId) {
                if (!facade.saveOrganizationProfile) throw new Error("当前环境不支持编辑组织资料，请重新加载插件后重试");
                const current = (await facade.listOrganizations()).find((org) => org.docId === docId);
                if (!lifecycleToken.isAlive()) return;
                if (current && current.name !== draft.name.trim()) await facade.renameOrganization?.(docId, draft.name.trim());
                await facade.saveOrganizationProfile(docId, draft, organizationProfileExpected);
                if (!lifecycleToken.isAlive()) return;
            } else {
                const created = await facade.createOrganization(draft.name, draft);
                if (!lifecycleToken.isAlive()) return;
                docId = created.docId;
                if (created.profileSaved === false) {
                    organizationProfileDocId = docId;
                    organizationProfileInitial = draft;
                    organizationProfileExpected = null;
                    organizationProfileCreatedDraft = normalizeOrganizationProfileDraft(draft);
                    organizationProfileError = `组织已创建，但资料尚未保存：${created.profileError ?? "请重试"}`;
                    return;
                }
            }
            organizationProfileOpen = false;
            organizationProfileDocId = "";
            organizationProfileInitial = {};
            organizationProfileExpected = undefined;
            organizationProfileCreatedDraft = null;
            organizationProfileReadOnly = false;
            if (returnToContactAfterOrganizationProfile) {
                returnToContactAfterOrganizationProfile = false;
                organizationProfileCompletion?.({ docId, name: draft.name.trim() });
                return;
            }
            await openOrganization(docId);
        } catch (error) {
            if (lifecycleToken.isAlive()) {
                if (error instanceof OrganizationProfileConflictError) organizationProfileReadOnly = true;
                organizationProfileError = requestErrorMessage(error);
            }
        } finally {
            if (lifecycleToken.isAlive()) organizationProfileSaving = false;
        }
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
            if (lifecycleToken.isAlive() && request === navigationRequest) navigationError = requestErrorMessage(error);
        }
    }
    const detailCloseLabel = $derived(detailReturn?.kind === "organization" ? text("routeReturnOrganization", "返回原组织")
        : detailReturn?.kind === "document" ? text("routeReturnDocument", "返回原文档")
            : text("routeReturnView", "返回{view}", { view: viewMeta[detailReturn?.view ?? current].title }));
    let detailKey = $state(0);
    let peopleOrder: ContactSummary[] = $state([]);
    let globalSearch = $state("");
    let createRequested = $state(0);
    let importRequested = $state(0);
    let vcardRequested = $state(0);
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
        navigationRequest += 1;
        peopleView?.cancelContactFocus();
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

    async function selectView(view: ViewId, options: { history?: "push" | "replace" | "none" } = {}): Promise<boolean> {
        if (options.history !== "none") historyNavigationRequest += 1;
        if (!lifecycleToken.isAlive()) return false;
        const previousView = current;
        if ((view !== current || detailPerson || organizationOpen) && !(await canLeave.requestClose())) return false;
        if (!lifecycleToken.isAlive()) return false;
        current = view;
        if (options.history !== "none" && (view !== previousView || detailPerson || organizationOpen)) syncViewHistory(view, options.history ?? "push");
        detailPerson = null;
        detailReturn = null;
        organizationOpen = false;
        navigationRequest += 1;
        if (view !== "people") {
            createRequested = 0;
            importRequested = 0;
            vcardRequested = 0;
        }
        clearPeopleFocus();
        return true;
    }

    async function requestPeopleAction(action: "create" | "import" | "vcard"): Promise<void> {
        if (!(await selectView("people"))) return;
        if (action === "create") createRequested += 1;
        if (action === "import") importRequested += 1;
        if (action === "vcard") vcardRequested += 1;
    }

    async function submitGlobalSearch() {
        const query = globalSearch.trim();
        if (!query) return;
        globalSearch = query;
        await selectView("people");
    }

    async function openPeople(focus?: { itemIds: readonly string[]; label: string; sort?: "name" | "group" | "birthday" | "recent" }) {
        if (!lifecycleToken.isAlive()) return;
        if (current !== "people" && !(await canLeave.requestClose())) return;
        if (!lifecycleToken.isAlive()) return;
        const previousView = current;
        current = "people";
        if (previousView !== "people") syncViewHistory("people", "push");
        peopleFocusIds = focus?.itemIds ? [...focus.itemIds] : [];
        peopleFocusLabel = focus?.label ?? "";
        peopleFocusSort = focus?.sort;
    }

    onMount(() => {
        // Store the selected in-plugin view in the current history entry without changing
        // the host URL; this preserves browser Back/Forward and refresh restoration safely.
        const restored = historyEntry();
        if (!initialView && restored) current = restored.view;
        else syncViewHistory(current, "replace");
        const handlePopState = (event: PopStateEvent) => {
            const target = historyEntry(event.state);
            if (!target || target.index === historyIndex && target.view === current) return;
            const previousIndex = historyIndex;
            const request = ++historyNavigationRequest;
            void selectView(target.view, { history: "none" }).then((accepted) => {
                if (request !== historyNavigationRequest) return;
                if (accepted) historyIndex = target.index;
                else if (target.index !== previousIndex) window.history.go(previousIndex - target.index);
            });
        };
        window.addEventListener("popstate", handlePopState);
        lifecycleToken.onDispose(() => window.removeEventListener("popstate", handlePopState));
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
        const handleRequestedOrganizationCreate = (event: Event) => {
            const detail = (event as CustomEvent<{ facade?: ContactsPluginFacade; returnToContact?: boolean; initialName?: string; completion?: (created?: { docId: string; name: string }) => void }>).detail;
            if (detail?.facade && detail.facade !== facade) return;
            if (organizationProfileOpen) { detail?.completion?.(); return; }
            organizationProfileCompletion = detail?.completion ?? null;
            showCreateOrganization(detail?.returnToContact === true, detail?.initialName);
        };
        window.addEventListener("lvct-workbench-create-organization", handleRequestedOrganizationCreate);
        lifecycleToken.onDispose(() => window.removeEventListener("lvct-workbench-create-organization", handleRequestedOrganizationCreate));
        // 外部联系人表单可能正在等待组织资料弹窗结束；工作台卸载时也要
        // 收口该 Promise，避免宿主先卸载工作台后联系人一直停在“组织创建中”。
        lifecycleToken.onDispose(() => {
            organizationProfileCompletion?.();
            organizationProfileCompletion = null;
            returnToContactAfterOrganizationProfile = false;
        });
        // B13.6a：组织管理弹窗成员「查看详情」跨弹窗导航（弹窗先关，人物详情由本层打开）
        const handleRequestedPerson = (event: Event) => {
            const person = (event as CustomEvent<{ person?: ContactSummary }>).detail?.person;
            if (person?.docId) void openDetail(person);
        };
        window.addEventListener("lvct-workbench-person", handleRequestedPerson);
        return () => {
            lifecycleToken.invalidate();
            window.removeEventListener("lvct-workbench-view", handleRequestedView);
            window.removeEventListener("lvct-workbench-create-organization", handleRequestedOrganizationCreate);
            window.removeEventListener("lvct-workbench-person", handleRequestedPerson);
        };
    });

    // FUNC-01.7：跨窗口/宿主数据变化 → 防抖合并后 bump revision 原地刷新（筛选与人物详情上下文保留）；
    // 有未保存草稿时不静默：追加一条可见提示（草稿在弹窗本地状态中，列表刷新不覆盖草稿）。
    let dataChangeNotice = $state("");
    onMount(() => {
        if (!lifecycleToken.isAlive()) return;
        void preferenceRequests.load().catch(() => {});
        const unsubscribe = subscribeDataChangedDebounced((change) => {
            if (!lifecycleToken.isAlive()) return;
            // 偏好保存已经在当前工作台即时应用。它会通过同一事件通道通知其它
            // 工作台，但当前实例无需因此重新读取联系人名册；否则切换卡片/表格
            // 时会被无关的 loading 骨架短暂替换，连续保存还会造成多次闪烁。
            const hasDataScope = Boolean(change.topics?.length || change.docIds?.length);
            const preferenceRevision = change.preferencesRevision;
            const preferenceOnly = preferenceRevision !== undefined && !change.preferencesError && !hasDataScope;
            if (preferenceOnly && preferenceRevision <= currentPreferences.revision) return;
            if (change.preferencesError) {
                preferencesNotice = `偏好读取失败，当前值尚未核实：${change.preferencesError}`;
            }
            if (preferenceOnly) {
                // 外部窗口的偏好变更需要应用到当前工作台，但不应触发联系人名册刷新。
                void preferenceRequests.load().catch(() => {});
                return;
            }
            dataRevision += 1;
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
            <span class="lvct-workbench__brand-mark">
                {#if currentPreferences.brandAvatarImage}
                    <img src={currentPreferences.brandAvatarImage} alt="" width="40" height="40" decoding="async" />
                {:else}
                    {currentPreferences.brandAvatar || "驴"}
                {/if}
            </span>
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
            <button
                class="lvct-workbench__nav-item"
                disabled
                aria-label={text("navSuggestionsAria", "建议（即将推出）")}
                title={text("navSuggestionsUnavailable", "建议功能尚未开放")}
            >
                <span class="lvct-workbench__nav-icon" aria-hidden="true"><Sparkles size={16}/></span>
                <span class="lvct-workbench__nav-text">{text("navSuggestions", "建议")}</span>
            </button>
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
        <header class="lvct-workbench__header" class:lvct-workbench__header--settings={current === "settings"}>
            <div>
                <h1 tabindex="-1">{currentMeta.title}</h1>
                <p>{currentMeta.subtitle}</p>
            </div>
            {#if current === "home"}<div class="lvct-workbench__header-actions">
                <input class="b3-text-field" type="search" aria-label={text("homeSearchPlaceholder", "搜索联系人")} placeholder={text("homeSearchPlaceholder", "搜索联系人")} bind:value={globalSearch}
                    onkeydown={(event) => { if (event.key === "Enter") { event.preventDefault(); void submitGlobalSearch(); } }} />
                <button type="button" class="b3-button b3-button--outline" disabled={!globalSearch.trim()} title={!globalSearch.trim() ? text("homeSearchDisabled", "请输入联系人姓名或其他关键词") : undefined} onclick={() => void submitGlobalSearch()}><Search size={16}/>{text("homeSearchAction", "搜索")}</button>
                <button type="button" class="b3-button" onclick={() => void requestPeopleAction("create")}><UserPlus size={16}/>新建联系人</button>
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
                    onCreate={() => void requestPeopleAction("create")}
                    onImportVCard={() => void requestPeopleAction("vcard")}
                    onImportDocuments={() => void requestPeopleAction("import")}
                    onOpenOrganizations={() => void selectView("orgs")}
                    onOpenSettings={() => void selectView("settings")}
                />
            {:else if current === "people"}
                <PeopleView
                    bind:this={peopleView}
                    settings={currentSettings}
                    i18n={facade.i18n}
                    isMobile={isMobile}
                    preferences={currentPreferences}
                    loadRecentInteractions={() => facade.loadRecentInteractions()}
                    initialSort={peopleFocusSort ?? currentPreferences.peopleSort}
                    focusIds={peopleFocusIds}
                    focusLabel={peopleFocusLabel}
                    externalSearch={globalSearch}
                    onExternalSearchCleared={() => (globalSearch = "")}
                    onExternalSearchChange={(value) => (globalSearch = value)}
                    {createRequested}
                    {importRequested}
                    {vcardRequested}
                    onClearFocus={clearPeopleFocus}
                    revision={dataRevision}
                    onOpenDetail={openDetail}
                    activePersonId={detailPerson?.itemId ?? ""}
                    onOrderChange={(ordered) => {
                        if (ordered.map((person) => person.itemId).join("|") !== peopleOrder.map((person) => person.itemId).join("|")) peopleOrder = ordered;
                    }}
                    onGroupsChange={(groups) => {
                        if (groups.join("|") !== peopleGroups.join("|")) peopleGroups = groups;
                    }}
                    onPreferencesChange={savePreferences}
                    {onOpenPersonDoc}
                    onLoadOrgCandidates={async () => (await facade.listOrganizations()).map((org) => ({ docId: org.docId, name: org.name, archived: org.archived }))}
                    onCreateOrganization={openCreateOrganizationForContact}
                    onAddOrgMembership={(personDocId, orgDocId, extra) => facade.addOrganizationMember(orgDocId, personDocId, extra)}
                    onCreateSelfProfile={() => facade.createSelfProfile()}
                    onLoadSelfCandidates={() => facade.listContacts()}
                    onPreviewSelfIdentityChange={(personItemId) => facade.previewSelfIdentityChange(personItemId)}
                    onApplySelfIdentityChange={(preview) => facade.applySelfIdentityChange(preview)}
                    onValidateExtended={async (details) => {
                        if (details.orgMemberships.length) {
                            const organizations = await facade.listOrganizations();
                            for (const membership of details.orgMemberships) {
                                const selected = organizations.find((org) => org.docId === membership.orgDocId);
                                if (!selected || (membership.orgStatus === "active" && selected.archived)) throw new Error(`组织 ${membership.orgDocId} 不可用；当前归属不能加入已归档组织，请重新读取并选择`);
                            }
                        }
                        if (details.relationshipLabels.trim() && !await facade.loadSelfIdentity()) {
                            throw new Error("请先在设置中指定“我”的档案，再创建并填写与我的关系称谓");
                        }
                    }}
                    onSaveExtended={async (person, details) => {
                        if (details.orgMemberships.length) {
                            const memberships = await facade.listPersonOrgMemberships(person.docId);
                            for (const affiliation of details.orgMemberships) {
                                const same = (membership: typeof memberships[number]) => membership.orgDocId === affiliation.orgDocId
                                    && membership.status === affiliation.orgStatus && membership.statusLabel === (affiliation.orgStatusLabel.trim() || undefined)
                                    && membership.affiliationKind === affiliation.orgAffiliationKind && membership.department === affiliation.orgDepartment.trim()
                                    && membership.title === affiliation.orgTitle.trim() && membership.joinedOn === affiliation.orgJoinedOn && membership.leftOn === affiliation.orgLeftOn
                                    && (membership.note ?? "") === (affiliation.orgNote?.trim() ?? "");
                                if (memberships.some(same)) continue;
                                if (affiliation.orgStatus === "active" && memberships.some((membership) => membership.orgDocId === affiliation.orgDocId && membership.status === "active")) {
                                    throw new Error(`组织 ${affiliation.orgDocId} 已有当前归属，请核对原记录；未覆盖它`);
                                }
                                await facade.addOrganizationMember(affiliation.orgDocId, person.docId, {
                                    department: affiliation.orgDepartment, title: affiliation.orgTitle, joinedOn: affiliation.orgJoinedOn,
                                    leftOn: affiliation.orgLeftOn, status: affiliation.orgStatus,
                                    statusLabel: affiliation.orgStatusLabel.trim(), affiliationKind: affiliation.orgAffiliationKind, note: affiliation.orgNote?.trim() ?? "",
                                });
                                memberships.push({ id: "", orgDocId: affiliation.orgDocId, orgName: "", department: affiliation.orgDepartment.trim(),
                                    title: affiliation.orgTitle.trim(), joinedOn: affiliation.orgJoinedOn, leftOn: affiliation.orgLeftOn,
                                    status: affiliation.orgStatus, statusLabel: affiliation.orgStatusLabel.trim() || undefined,
                                    affiliationKind: affiliation.orgAffiliationKind, note: affiliation.orgNote?.trim() || undefined, archived: false, reachable: true });
                            }
                        }
                        if (details.relationshipLabels.trim()) {
                            const identity = await facade.loadSelfIdentity();
                            if (!identity) throw new Error("请先在设置中指定“我”的档案，再保存与我的关系称谓");
                            const labels = details.relationshipLabels.split(/[、,，\n]/).map((label) => label.trim()).filter(Boolean);
                            const current = await facade.loadPersonRelationshipLabels(person.docId);
                            if (current.selfDocId !== identity.selfDocId || JSON.stringify(current.record?.labels ?? []) !== JSON.stringify(labels)) {
                                await facade.savePersonRelationshipLabels(person.docId, identity.selfDocId, labels, current.record);
                            }
                        }
                        if (details.aliases.trim()) {
                            const existingAliases = await facade.listPersonAliases(person.docId);
                            const existing = new Set(existingAliases.map((alias) => alias.alias.trim().toLocaleLowerCase()));
                            const aliases = details.aliases.split(/[、,，\n]/).map((alias) => alias.trim()).filter(Boolean);
                            for (const alias of aliases) {
                                const key = alias.toLocaleLowerCase();
                                if (!existing.has(key)) {
                                    await facade.addPersonAlias(person.docId, alias);
                                    existing.add(key);
                                }
                            }
                        }
                        if (details.note.trim()) {
                            const currentNote = await facade.loadPersonNote(person.docId);
                            if (currentNote !== details.note.trim()) await facade.savePersonNote(person.docId, details.note.trim(), currentNote);
                        }
                    }}
                />
            {:else if current === "graph"}
                <RelationGraphLoader
                    settings={currentSettings}
                    {facade}
                    revision={dataRevision}
                    preferences={currentPreferences}
                    onPreferencesChange={savePreferences}
                    onOpenDetail={openDetail}
                    onOpenPeople={() => selectView("people")}
                    onOpenCreatePerson={() => void requestPeopleAction("create")}
                    onOpenOrgs={(docId) => docId ? void openOrganization(docId) : selectView("orgs")}
                />
            {:else if current === "orgs"}
                <OrgsView
                    {facade}
                    revision={dataRevision}
                    i18n={facade.i18n}
                    onOpenOrgManager={(docId) => void openOrganization(docId)}
                    onCreateOrganization={() => void openCreateOrganization()}
                    onEditOrganization={(docId) => void openEditOrganizationProfile(docId)}
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
            onOpenPerson={(docId, orgDocId) => void openPersonByDocId(docId, personReturnContext(current, { orgDocId }))}
            onCreateOrganization={() => void openCreateOrganization()}
            onEditOrganization={(docId) => void openEditOrganizationProfile(docId)}
            onClose={() => void closeOrganization()} />
    </LvctDialog>
{/if}

{#if detailPerson}
    <LvctDialog title={text("personDetailTitle", "人物详情 · {name}", { name: detailPerson.name })} closeLabel={detailCloseLabel} wide closeOnBackdrop={false} onClose={() => void closeDetail()}>
        {#key detailKey}
        <PersonDetail
            settings={currentSettings}
            i18n={facade.i18n}
            person={detailPerson}
            availableGroups={peopleGroups}
            revision={dataRevision}
            onRecord={(personDocId, note) => facade.recordInteraction(personDocId, note)}
            onDeleteInteraction={(personDocId, eventId) => facade.deleteInteraction(personDocId, eventId)}
            onLoadInsights={(docId) => facade.loadPersonInsights(docId)}
            onLoadPersonNote={(docId) => facade.loadPersonNote(docId)}
            onSavePersonNote={(docId, note, expected) => facade.savePersonNote(docId, note, expected)}
            onInspectLegacyPersonNote={facade.inspectLegacyPersonNote ? (docId) => facade.inspectLegacyPersonNote(docId) : undefined}
            onDetachLegacyPersonNote={facade.detachLegacyPersonNote ? (docId, expected) => facade.detachLegacyPersonNote(docId, expected) : undefined}
            onLoadPersonFields={facade.loadPersonFields ? (docId) => facade.loadPersonFields(docId) : undefined}
            onSavePersonFields={facade.savePersonFields ? (docId, snapshot, expected) => facade.savePersonFields(docId, snapshot, expected) : undefined}
            onLoadExchanges={(docId) => facade.listPersonExchanges(docId)}
            onCreateExchange={(input) => facade.createPersonExchange(input)}
            onChangeExchangeStatus={(id, status, settledOn, expected) => facade.changePersonExchangeStatus(id, status, settledOn, expected)}
            onLoadAliases={(docId) => facade.listPersonAliases(docId)}
            onAddAlias={(docId, alias) => facade.addPersonAlias(docId, alias)}
            onRemoveAlias={(id) => facade.removePersonAlias(id)}
            onLoadRelationshipLabels={facade.loadPersonRelationshipLabels ? (docId) => facade.loadPersonRelationshipLabels(docId) : undefined}
            onSaveRelationshipLabels={facade.savePersonRelationshipLabels ? (docId, selfDocId, labels, expected) => facade.savePersonRelationshipLabels(docId, selfDocId, labels, expected) : undefined}
            onLoadOrgMemberships={(docId) => facade.listPersonOrgMemberships(docId)}
            onLoadCommonOrgs={(docId) => facade.listCommonOrgBackground(docId)}
            onOpenOrgManager={() => void openOrganization()}
            onCreateOrganization={openCreateOrganizationForContact}
            onOpenOrganization={(docId) => void openOrganization(docId)}
            onLoadOrgCandidates={async () => (await facade.listOrganizations())
                .map((org) => ({ docId: org.docId, name: org.name, archived: org.archived }))}
            onAddOrgMembership={(personDocId, orgDocId, extra) => facade.addOrganizationMember(orgDocId, personDocId, extra)}
            onRemoveOrgMembership={(id, expected) => facade.removeOrganizationMember(id, expected)}
            onUpdateOrgMembership={(id, patch, expected) => facade.updateOrganizationMember(id, patch, expected)}
            onListFollowUps={(docId) => facade.listPersonFollowUps(docId)}
            onCreateFollowUp={(docId, title, dueDate, requestId) => facade.createFollowUp(docId, title, dueDate, requestId)}
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

<!-- 详情或编辑窗口内新建组织时，资料窗口必须在已有模态之上。 -->
{#if organizationProfileOpen}
    <LvctDialog title={organizationProfileDocId ? text("orgEditTitle", "编辑组织资料") : text("orgCreateTitle", "新建组织")} wide closeOnBackdrop={false} beforeClose={() => organizationProfileEditor?.requestClose() ?? Promise.resolve(false)} onClose={() => { if (!organizationProfileSaving) { organizationProfileOpen = false; returnToContactAfterOrganizationProfile = false; organizationProfileCompletion?.(); organizationProfileCompletion = null; } }}>
        <OrganizationProfileEditor
            bind:this={organizationProfileEditor}
            mode={organizationProfileDocId ? "edit" : "create"}
            initial={organizationProfileInitial}
            saving={organizationProfileSaving}
            error={organizationProfileError}
            readOnly={organizationProfileReadOnly}
            onRetry={() => void retryOrganizationProfile()}
            onSave={saveOrganizationProfile}
            onCancel={() => { if (!organizationProfileSaving) { organizationProfileOpen = false; returnToContactAfterOrganizationProfile = false; organizationProfileCompletion?.(); organizationProfileCompletion = null; } }}
        />
    </LvctDialog>
{/if}
