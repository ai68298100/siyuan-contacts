<script lang="ts">
    /** 联系人视图：未过滤名册渐进读取，搜索与筛选共用本地投影；详情弹窗由 Workbench 统一承载 */
    import { batchUpdateContacts, createContactListProjection, listContactPage, PAGE_SIZE, removeContacts } from "../../services/contacts";
    import type { ContactPage } from "../../services/contacts";
    import { filterContactSearch } from "../../domain/contact-search";
    import { GROUP_CLEAR_OPTION, GROUP_KEEP_OPTION } from "../../domain/contact-group";
    import { profileText } from "../../domain/people-profiles";
    import { onDestroy, tick } from "svelte";
    import { exportVcfText } from "../../services/vcard";
    import { formatBirthdayDisplay, nextBirthday } from "../../domain/occasions";
    import GroupField from "./GroupField.svelte";
    import type { ContactSummary } from "../../domain/person";
    import type { WritableContactField } from "../../domain/contact-write.ts";
    import type { ContactsSettings } from "../../domain/model";
    import { DEFAULT_VIEW_PREFERENCES, normalizeTableColumns, normalizeViewPreferences, PEOPLE_TABLE_COLUMNS } from "../../domain/preferences";
    import type { PeopleTableColumn, ViewPreferences } from "../../domain/preferences";
    import { applyPeopleFilters, EMPTY_PEOPLE_FILTER, isExtraFilterActive, matchTags } from "../../domain/people-filters";
    import type { PeopleFilterState } from "../../domain/people-filters";
    import { DUPLICATE_PAIRS_LIMIT, findDuplicatePairs } from "../../domain/duplicate-check";
    import type { DuplicatePair } from "../../domain/duplicate-check";
    import { findSavedViewByName, missingTags, normalizeSavedViews, SAVED_VIEWS_LIMIT } from "../../domain/saved-views";
    import type { SavedView, SavedViewQuery } from "../../domain/saved-views";
    import { attachPopover } from "../../libs/popover";
    import PersonCard from "./PersonCard.svelte";
    import AddPersonDialog from "./AddPersonDialog.svelte";
    import ImportDialog from "./ImportDialog.svelte";
    import VCardDialog from "./VCardDialog.svelte";
    import LvctDialog from "../LvctDialog.svelte";
    import ProfileCompletionDialog from "./ProfileCompletionDialog.svelte";
    import { PROFILE_GAPS } from "../../domain/people-filters";
    import ViewState from "../ViewState.svelte";
    import { useCloseGuard } from "../close-guard";
    import { LayoutGrid, List, FolderInput, ContactRound, UserPlus, ExternalLink, Columns3, SlidersHorizontal, Bookmark, Pencil, Trash2 } from "@lucide/svelte";
    import { translateText } from "../../domain/translation";
    import { isAbortError } from "../../shared/async";
    import { getFocusableElements } from "../../shared/focusable-elements";
    import { requestErrorMessage } from "../../shared/error-presenter";
    import type { ContactExtendedDraft } from "../../domain/contact-create";
    import { buildVirtualRows, estimateVirtualHeight, virtualRowAtOffset, virtualRowRange } from "../../domain/virtual-list";

    let {
        settings,
        i18n,
        preferences,
        loadRecentInteractions,
        revision,
        initialSort,
        focusIds = [],
        focusLabel = "",
        externalSearch = "",
        onExternalSearchCleared,
        onExternalSearchChange,
        createRequested = 0,
        importRequested = 0,
        vcardRequested = 0,
        onClearFocus,
        onOpenDetail,
        activePersonId = "",
        onOrderChange,
        onGroupsChange,
        onOpenPersonDoc,
        onLoadOrgCandidates,
        onCreateOrganization,
        onAddOrgMembership,
        onCreateSelfProfile,
        onLoadSelfCandidates,
        onPreviewSelfIdentityChange,
        onApplySelfIdentityChange,
        onValidateExtended,
        onSaveExtended,
        onPreferencesChange,
        isMobile = false,
    }: {
        settings: ContactsSettings;
        i18n?: Readonly<Record<string, string>>;
        preferences: ViewPreferences;
        loadRecentInteractions: () => Promise<Record<string, { occurredAt: number; localDate: string }>>;
        revision: number;
        initialSort: "name" | "group" | "birthday" | "recent";
        focusIds?: readonly string[];
        focusLabel?: string;
        externalSearch?: string;
        /** 首页搜索下推到联系人页后，清除条件时同步清空上游搜索框。 */
        onExternalSearchCleared?: () => void;
        /** 联系人页直接修改关键词时同步更新首页搜索框。 */
        onExternalSearchChange?: (value: string) => void;
        createRequested?: number;
        /** 首页快速开始入口请求打开文档收编弹窗。 */
        importRequested?: number;
        /** 首页快速开始入口请求打开 vCard 弹窗。 */
        vcardRequested?: number;
        onClearFocus?: () => void;
        onOpenDetail: (person: ContactSummary) => void;
        activePersonId?: string;
        onOrderChange?: (people: ContactSummary[]) => void;
        /** 完整名册的分组候选；不随当前搜索结果缩小。 */
        onGroupsChange?: (groups: string[]) => void;
        onOpenPersonDoc?: (docId: string) => void;
        onLoadOrgCandidates?: () => Promise<ReadonlyArray<{ docId: string; name: string; archived?: boolean }>>;
        onCreateOrganization?: (initialName?: string) => void | { docId: string; name: string } | Promise<void | { docId: string; name: string }>;
        /** B13.3：批量将已选联系人登记为目标组织的当前成员。 */
        onAddOrgMembership?: (personDocId: string, orgDocId: string, extra?: { status?: "active" | "former"; affiliationKind?: "family" | "work" | "education" | "unspecified" }) => Promise<unknown>;
        onCreateSelfProfile?: () => Promise<import("../../domain/self-identity").SelfIdentity | null>;
        onLoadSelfCandidates?: () => Promise<ContactSummary[]>;
        onPreviewSelfIdentityChange?: (personItemId: string) => Promise<import("../../domain/self-identity").SelfIdentityChangePreview>;
        onApplySelfIdentityChange?: (preview: import("../../domain/self-identity").SelfIdentityChangePreview) => Promise<import("../../domain/self-identity").SelfIdentity | null>;
        onValidateExtended?: (details: ContactExtendedDraft) => Promise<void>;
        onSaveExtended?: (person: ContactSummary, details: ContactExtendedDraft) => Promise<void>;
        onPreferencesChange: (preferences: ViewPreferences, baseline?: ViewPreferences) => Promise<ViewPreferences>;
        /** B09-1：移动端工具栏收纳（常驻搜索/视图切换/新建，其余收进底部弹层） */
        isMobile?: boolean;
    } = $props();
    const text = $derived.by(() => (key: string, fallback: string) => translateText(i18n, key, fallback));

    let people: ContactSummary[] = $state([]);
    let loading: boolean = $state(true);
    let refreshQueued = $state(false);
    let peopleElement: HTMLDivElement | undefined = $state();
    type ContactFocusResult = "restored" | "cancelled" | "missing";
    let focusRequest: { itemId: string; previousActive: Element | null; resolve: (result: ContactFocusResult) => void } | null = $state(null);

    export function cancelContactFocus(): void {
        focusRequest?.resolve("cancelled");
        focusRequest = null;
    }

    /** 详情关闭时按稳定行 ID 返回；刷新或渐进读取期间保留请求，避免聚焦已卸载的旧卡片。 */
    export function focusContact(itemId: string): Promise<ContactFocusResult> {
        cancelContactFocus();
        if (!peopleAlive) return Promise.resolve("cancelled");
        return new Promise((resolve) => { focusRequest = { itemId, previousActive: document.activeElement, resolve }; });
    }
    let errorText: string = $state("");
    let searchText: string = $state("");
    let selectedPeopleCache: Record<string, ContactSummary> = $state({});
    $effect(() => { searchText = externalSearch; });
    $effect(() => { if (createRequested > 0) adding = true; });
    $effect(() => { if (importRequested > 0) importing = true; });
    $effect(() => { if (vcardRequested > 0) vcarding = true; });
    let groupFilter: string = $state("");
    let tagFilter: string[] = $state([]);
    // svelte-ignore state_referenced_locally
    let extraFilter: PeopleFilterState = $state({ ...EMPTY_PEOPLE_FILTER });
    let moreOpen = $state(false);
    // svelte-ignore state_referenced_locally
    let localViews: SavedView[] = $state(normalizeSavedViews(preferences.savedViews));
    let viewsOpen = $state(false);
    let viewsMenuWrap: HTMLElement | null = $state(null);
    let viewsMenuPanel: HTMLElement | null = $state(null);
    let moreMenuWrap: HTMLElement | null = $state(null);
    let moreMenuPanel: HTMLElement | null = $state(null);
    let colMenuWrap: HTMLElement | null = $state(null);
    let colMenuPanel: HTMLElement | null = $state(null);
    let currentViewId = $state("");
    let activeViewName = $state("");
    let viewHint = $state("");
    let dupOpen = $state(false);
    const duplicatePairs: DuplicatePair[] = $derived(findDuplicatePairs(people));
    const duplicatePairsCapped = $derived(duplicatePairs.length >= DUPLICATE_PAIRS_LIMIT);
    // svelte-ignore state_referenced_locally
    let sortMode: "name" | "group" | "birthday" | "recent" = $state(initialSort);
    let recent: Record<string, { occurredAt: number; localDate: string }> = $state({});
    let recentGeneration = 0;
    let recentError = $state("");
    let recentState = $state<"loading" | "ready" | "error">("loading");
    const recentFilterRequested = $derived(Boolean(extraFilter.recentFrom || extraFilter.recentTo || extraFilter.neverContacted));
    const recentFiltersPaused = $derived(recentFilterRequested && recentState !== "ready");
    // svelte-ignore state_referenced_locally
    let viewMode: "cards" | "table" = $state(preferences.peopleView === "table" ? "table" : "cards");
    // svelte-ignore state_referenced_locally
    let tableColumns: PeopleTableColumn[] = $state(normalizeTableColumns(preferences.tableColumns));
    // 连续切换期间父层 props 可能仍是旧 revision；本地意图作为下一次操作的基线，
    // 等持久化响应回来后再由 preferences effect 对齐，避免“切回原值”被旧快照吞掉。
    // svelte-ignore state_referenced_locally
    let preferenceIntent: ViewPreferences = $state(preferences);
    // 视图切换会先更新本地界面，再异步保存偏好。保存响应/跨窗口回读到达前，
    // 父层可能仍携带旧 peopleView；保留这份意图，避免卡片与表格反复卸载重建造成闪烁。
    let pendingViewMode: "cards" | "table" | null = $state(null);
    let prefError = $state("");
    let colMenuOpen = $state(false);
    const columnLabels: Record<PeopleTableColumn, { labelKey: string; fallback: string }> = {
        group: { labelKey: "peopleGroup", fallback: "分组" },
        phone: { labelKey: "peoplePhone", fallback: "电话" },
        wechat: { labelKey: "peopleWechat", fallback: "微信" },
        birthday: { labelKey: "peopleBirthday", fallback: "生日" },
        recent: { labelKey: "peopleRecent", fallback: "最近互动" },
        tags: { labelKey: "peopleTags", fallback: "标签" },
        org: { labelKey: "peopleColumnOrg", fallback: "单位" },
        school: { labelKey: "peopleColumnSchool", fallback: "学校" },
        relationship: { labelKey: "peopleColumnRelationship", fallback: "与我的关系" },
    };
    const columnLabel = (key: PeopleTableColumn) => text(columnLabels[key].labelKey, columnLabels[key].fallback);

    // 外部偏好更新（设置页保存/恢复默认）时同步本地显示
    $effect(() => {
        const incomingMode = preferences.peopleView === "table" ? "table" : "cards";
        preferenceIntent = preferences;
        tableColumns = normalizeTableColumns(preferences.tableColumns);
        if (pendingViewMode !== null) {
            if (incomingMode === pendingViewMode) pendingViewMode = null;
            else return;
        }
        viewMode = incomingMode;
    });

    // svelte-ignore state_referenced_locally
    let appliedInitialSort = $state(initialSort);
    // 设置页修改“联系人默认排序”后，已打开的联系人页也应立即跟随。
    // 已应用的保存视图或首页深链排序拥有更具体的意图，保留它们直到用户清除。
    $effect(() => {
        const nextSort = initialSort;
        if (nextSort === appliedInitialSort) return;
        appliedInitialSort = nextSort;
        if (currentViewId || focusLabel) return;
        sortMode = nextSort;
    });

    function nextPreferenceIntent(patch: Partial<ViewPreferences>): { next: ViewPreferences; baseline: ViewPreferences } {
        const baseline = normalizeViewPreferences(preferenceIntent);
        preferenceIntent = { ...preferenceIntent, ...patch };
        return { next: preferenceIntent, baseline };
    }

    async function persistPreferences(next: ViewPreferences) {
        prefError = "";
        preferenceIntent = next;
        try {
            // 始终以父层已确认的偏好作为并发保存基线。preferenceIntent 保留本地完整意图，
            // 这样某次自动保存失败后，下一次切换仍会把之前的改动一并重试，不会静默丢失。
            await onPreferencesChange(next, normalizeViewPreferences(preferences));
        } catch (error) {
            prefError = requestErrorMessage(error);
        }
    }

    function setViewMode(mode: "cards" | "table") {
        if (viewMode === mode) return;
        viewMode = mode;
        pendingViewMode = mode;
        virtualScrollTop = 0;
        if (peopleListElement) peopleListElement.scrollTop = 0;
        const intent = nextPreferenceIntent({ peopleView: mode === "table" ? "table" : "card" });
        void persistPreferences(intent.next);
    }

    function toggleColumn(key: PeopleTableColumn, visible: boolean) {
        const next = visible
            ? [...tableColumns, key]
            : tableColumns.filter((column) => column !== key);
        tableColumns = normalizeTableColumns(next);
        const intent = nextPreferenceIntent({ tableColumns: [...tableColumns] });
        void persistPreferences(intent.next);
    }

    function moveColumn(key: PeopleTableColumn, offset: -1 | 1) {
        const index = tableColumns.indexOf(key);
        const target = index + offset;
        if (index < 0 || target < 0 || target >= tableColumns.length) return;
        const next = [...tableColumns];
        next.splice(index, 1);
        next.splice(target, 0, key);
        tableColumns = next;
        const intent = nextPreferenceIntent({ tableColumns: [...tableColumns] });
        void persistPreferences(intent.next);
    }

    function resetDisplayPreferences() {
        viewMode = "cards";
        pendingViewMode = "cards";
        tableColumns = [...DEFAULT_VIEW_PREFERENCES.tableColumns];
        colMenuOpen = false;
        const intent = nextPreferenceIntent({
            peopleView: DEFAULT_VIEW_PREFERENCES.peopleView,
            tableColumns: [...DEFAULT_VIEW_PREFERENCES.tableColumns],
        });
        void persistPreferences(intent.next);
    }

    // 列设置浮层：fixed 定位原语（B02）——absolute 面板会被滚动祖先裁剪，宿主菜单同样用 fixed
    $effect(() => {
        const wrap = colMenuWrap;
        const panel = colMenuPanel;
        if (!colMenuOpen || !wrap || !panel) return;
        // 移动端软键盘会触发 resize/scroll；列设置内虽然没有文本框，
        // 但它可能与筛选抽屉共存，统一保持浮层并重新定位，避免视口变化误关闭。
        return attachPopover(panel, wrap, () => (colMenuOpen = false), isMobile ? {
            closeOnScroll: false,
            closeOnResize: false,
        } : undefined);
    });
    let adding: boolean = $state(false);
    let importing: boolean = $state(false);
    let vcarding: boolean = $state(false);
    // C03 串行补录：对当前筛选列表逐个补缺失字段
    let completing: boolean = $state(false);
    let completionPeople: ContactSummary[] = $state([]);
    // B09-1：移动端「筛选与整理」底部弹层
    let mobileSheetOpen: boolean = $state(false);
    let mobileSheetTrigger: HTMLButtonElement | null = $state(null);
    let mobileSheetCloseButton: HTMLButtonElement | null = $state(null);
    let mobileSheetPanel: HTMLDivElement | null = $state(null);
    const mobileSheetTitleId = "lvct-people-mobile-tools-title";

    function focusableMobileSheetElements(): HTMLElement[] {
        return mobileSheetPanel ? getFocusableElements(mobileSheetPanel) : [];
    }

    function openMobileSheet() {
        mobileSheetOpen = true;
        void tick().then(() => mobileSheetCloseButton?.focus());
    }

    function closeMobileSheet(restoreFocus = true) {
        mobileSheetOpen = false;
        if (restoreFocus) void tick().then(() => mobileSheetTrigger?.focus());
    }

    function handleMobileSheetKeydown(event: KeyboardEvent) {
        if (event.key === "Escape") {
            // 更多筛选、视图和列设置是挂在底部弹层里的独立浮层。
            // 先让最内层浮层的全局处理器收起自身，避免一次 Esc 把外层也带走。
            if (document.querySelector(".lvct-people__moremenu, .lvct-people__viewsmenu, .lvct-people__colmenu")) return;
            event.preventDefault();
            closeMobileSheet();
            return;
        }
        if (event.key !== "Tab") return;
        const items = focusableMobileSheetElements();
        if (items.length === 0) {
            event.preventDefault();
            mobileSheetPanel?.focus();
            return;
        }
        const first = items[0];
        const last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    }
    let batchOpen: boolean = $state(false);
    let batchBusy: boolean = $state(false);
    let exportingSelected: boolean = $state(false);
    let batchError: string = $state("");
    let batchGroup: string = $state(GROUP_KEEP_OPTION);
    let batchGroupValid = $state(true);
    let batchTagsText: string = $state("");
    let batchFailedFieldsByItem: Record<string, readonly WritableContactField[]> = $state({});
    let batchTargets: ContactSummary[] = $state([]);
    let batchFromFiltered = $state(false);
    let batchNeedsRecent = $state(false);
    let batchConfirmed = $state(false);
    const batchScopePending = $derived(batchFromFiltered && !batchConfirmed && filteredScopePending(batchNeedsRecent));
    let batchAnchor = $state("");
    let batchHiddenCount = $state(0);
    let includeHidden = $state(false);
    let batchResult = $state("");
    let batchResultElement: HTMLElement | undefined = $state();
    let batchOrgOpen = $state(false);
    let batchOrgBusy = $state(false);
    let batchOrgLoading = $state(false);
    let batchOrgError = $state("");
    let batchOrgResult = $state("");
    let batchOrgCandidates: Array<{ docId: string; name: string; archived?: boolean }> = $state([]);
    let batchOrgDocId = $state("");
    let batchOrgFailed: Array<{ person: ContactSummary; message: string }> = $state([]);
    let batchOrgTargets: ContactSummary[] = $state([]);
    let batchOrgFromFiltered = $state(false);
    let batchOrgNeedsRecent = $state(false);
    let batchOrgScopeLabel = $state("");
    let batchOrgAnchor = $state("");
    let batchOrgHiddenCount = $state(0);
    let batchOrgIncludeHidden = $state(false);
    let batchOrgIntent: { docId: string; name: string } | null = $state(null);
    const batchOrgScopePending = $derived(batchOrgFromFiltered && !batchOrgIntent && filteredScopePending(batchOrgNeedsRecent));
    let batchOrgDirectoryVerified = $state(false);
    let batchOrgReadGeneration = 0;
    const batchOrgTargetAvailable = $derived(batchOrgDirectoryVerified
        && batchOrgCandidates.some((candidate) => candidate.docId === (batchOrgIntent?.docId ?? batchOrgDocId) && !candidate.archived));
    let batchOrgResultElement: HTMLElement | undefined = $state();
    let peopleAlive = true;
    let rosterAbortController: AbortController | undefined;
    onDestroy(() => {
        peopleAlive = false;
        cancelContactFocus();
        refreshGeneration += 1;
        recentGeneration += 1;
        rosterLoadGeneration += 1;
        rosterAbortController?.abort();
        rosterAbortController = undefined;
        cardResizeObserver?.disconnect();
        cardResizeObserver = undefined;
        observedCards.clear();
    });
    const guardedClose = useCloseGuard({
        busy: () => batchBusy || exportingSelected,
        dirty: () => batchOpen && (batchGroup !== GROUP_KEEP_OPTION || !!batchTagsText.trim()),
        changes: () => [text("guardBatchDraft", "批量编辑尚未应用")],
    });
    function closeBatch() {
        void guardedClose(() => (batchOpen = false));
    }
    let selectedIds: string[] = $state([]);
    let selectedScope = $state<"manual" | "page" | "filtered">("manual");
    let selectedFilteredNeedsRecent = $state(false);
    const pendingScopeMessage = "筛选范围待核实；原名单已保留。请等名册与相关资料读取成功后再继续，或取消后手工明确选择联系人。";
    function filteredScopePending(needsRecent: boolean): boolean {
        return !rosterComplete || queryProjectionIncomplete || needsRecent && recentState !== "ready";
    }
    let batchScopeLabel = $state("");
    const selectionScopeLabel = $derived(selectedScope === "page" ? "当前页" : selectedScope === "filtered" ? "全部筛选" : "手动选中");
    let visibleCount: number = $state(PAGE_SIZE);
    let rosterTotal: number = $state(0);
    let rosterPage: number = $state(0);
    let rosterHasMore: boolean = $state(false);
    let rosterLoadingMore: boolean = $state(false);
    // 首页数据到达后仍可能在后台读取后续页；返回详情焦点必须等待整轮刷新
    // 完成，否则旧排序中的入口会过早被判定为已恢复，迟到的新排序无法再展开目标页。
    let rosterRefreshing: boolean = $state(false);
    let rosterLoadError: string = $state("");
    let rosterLoadGeneration = 0;
    let rosterVerified = $state(false);
    let rosterPageSize = PAGE_SIZE;
    let rosterTotalKnown = false;
    let rosterProjection: ReturnType<typeof createContactListProjection> | undefined;
    const AUTO_ROSTER_PAGE_LIMIT = 10;
    const rosterComplete = $derived(rosterVerified && !loading && !refreshQueued && !rosterRefreshing
        && !rosterHasMore && !rosterLoadError && !errorText);
    const queryProjectionIncomplete = $derived(people.some((person) =>
        (!!searchText.trim() && (person.aliasProfile?.state === "unknown"
            || person.profile?.affiliations.state === "unknown" || person.profile?.relationship.state === "unknown"))
        || (!!(extraFilter.workQuery?.trim() || extraFilter.educationQuery?.trim()) && person.profile?.affiliations.state === "unknown")
        || (!!extraFilter.relationshipLabel?.trim() && person.profile?.relationship.state === "unknown")));
    const selectionScopePending = $derived(selectedScope === "filtered" && filteredScopePending(selectedFilteredNeedsRecent));
    const allFilteredScopeReady = $derived(rosterComplete && !queryProjectionIncomplete && !recentFiltersPaused);


    /**
     * 长联系人列表只保留视口附近的 DOM。600 条以内继续使用原有完整渲染，
     * 避免小列表引入滚动估算；超过阈值后，数据仍完整保留在内存中，选择、
     * 筛选和批量操作的语义不变，只减少离屏卡片/行的挂载数量。
     */
    const VIRTUAL_LIST_THRESHOLD = 600;
    const VIRTUAL_OVERSCAN_ROWS = 3;
    const CARD_ROW_ESTIMATE = 202;
    const TABLE_ROW_ESTIMATE = 48;
    const VIRTUAL_ROW_GAP = 16;
    let peopleListElement: HTMLDivElement | null = $state(null);
    let virtualScrollTop = $state(0);
    let virtualViewportHeight = $state(0);
    let virtualViewportWidth = $state(0);
    let virtualFrame: number | undefined;
    let cardMeasureRevision = $state(0);
    const cardMeasurements = new Map<string, { width: number; height: number }>();
    let cardResizeObserver: ResizeObserver | undefined;
    const observedCards = new Set<HTMLElement>();

    function updateVirtualViewport(): void {
        if (!peopleListElement) return;
        const element = peopleListElement;
        if (virtualFrame !== undefined) return;
        virtualFrame = requestAnimationFrame(() => {
            virtualFrame = undefined;
            if (!element.isConnected) return;
            if (element !== peopleListElement) return;
            const active = document.activeElement;
            const focusedItem = active instanceof HTMLElement ? active.closest<HTMLElement>("[data-person-item-id]") : null;
            if (focusedItem && element.contains(focusedItem) && visible.length > VIRTUAL_LIST_THRESHOLD) {
                const index = filtered.findIndex((person) => person.itemId === focusedItem.dataset.personItemId);
                const height = element.clientHeight;
                const range = currentVirtualRange(element.scrollTop, height);
                const start = range.start * virtualColumnCount;
                const end = Math.min(visible.length, range.end * virtualColumnCount);
                if (index >= 0 && (index < start || index >= end)) element.focus({ preventScroll: true });
            }
            virtualScrollTop = element.scrollTop;
            virtualViewportHeight = element.clientHeight;
            virtualViewportWidth = element.clientWidth;
        });
    }

    function handlePeopleListScroll(): void {
        updateVirtualViewport();
    }

    $effect(() => {
        const element = peopleListElement;
        if (!element) return;
        updateVirtualViewport();
        element.addEventListener("scroll", handlePeopleListScroll, { passive: true });
        const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(updateVirtualViewport);
        observer?.observe(element);
        return () => {
            element.removeEventListener("scroll", handlePeopleListScroll);
            observer?.disconnect();
            if (virtualFrame !== undefined) {
                cancelAnimationFrame(virtualFrame);
                virtualFrame = undefined;
            }
        };
    });

    const groups = $derived.by(() => {
        const set = new Set<string>();
        for (const person of people) {
            if (person.group) set.add(person.group);
        }
        return [...set].sort();
    });
    $effect(() => { onGroupsChange?.([...groups]); });
    const tags = $derived([...new Set(people.flatMap((person) => person.tags))].sort((a, b) => a.localeCompare(b, "zh-CN")));

    const filtered = $derived.by(() => {
        const focus = new Set(focusIds);
        const result = filterContactSearch(people, searchText, groupFilter)
            .filter((person) => !focusLabel || focus.has(person.itemId))
            .filter((person) => matchTags(person, tagFilter, extraFilter.tagMatch));
        // 最近互动尚未核实时，不能把空快照解释成“从未联系”；暂时暂停受影响条件，
        // 保留联系人列表和其它筛选，待用户重试成功后再恢复条件。
        const recentSafeFilter = recentState !== "ready"
            ? { ...extraFilter, recentFrom: "", recentTo: "", neverContacted: false }
            : extraFilter;
        const final = applyPeopleFilters(result, recentState !== "ready" ? {} : recent, recentSafeFilter);
        const birthdayDays = new Map(final.map((person) => [person.itemId, nextBirthday(person.birthday, person.isLunar)?.daysUntil ?? Infinity]));
        const effectiveSortMode = recentState !== "ready" && sortMode === "recent" ? "name" : sortMode;
        final.sort((a, b) => {
            if (effectiveSortMode === "group") return a.group.localeCompare(b.group, "zh-CN") || a.name.localeCompare(b.name, "zh-CN");
            if (effectiveSortMode === "birthday") return (birthdayDays.get(a.itemId) ?? Infinity) - (birthdayDays.get(b.itemId) ?? Infinity) || a.name.localeCompare(b.name, "zh-CN");
            if (effectiveSortMode === "recent") return (recent[b.docId]?.occurredAt ?? -Infinity) - (recent[a.docId]?.occurredAt ?? -Infinity) || a.name.localeCompare(b.name, "zh-CN");
            return a.name.localeCompare(b.name, "zh-CN");
        });
        return final;
    });
    const visible = $derived(filtered.slice(0, visibleCount));
    const virtualized = $derived(visible.length > VIRTUAL_LIST_THRESHOLD);
    const virtualRowSize = $derived(viewMode === "table" ? TABLE_ROW_ESTIMATE : CARD_ROW_ESTIMATE);
    const virtualColumnCount = $derived(viewMode === "table"
        ? 1
        : Math.max(1, Math.floor((virtualViewportWidth + 16) / (285 + 16))));
    const virtualCardWidth = $derived(virtualColumnCount > 0
        ? Math.max(0, (virtualViewportWidth - VIRTUAL_ROW_GAP * (virtualColumnCount - 1)) / virtualColumnCount)
        : 0);
    const virtualCardEstimate = $derived.by(() => {
        cardMeasureRevision;
        const measuredRows: number[] = [];
        if (virtualCardWidth > 0) {
            for (let start = 0; start < visible.length; start += virtualColumnCount) {
                let rowHeight = 0;
                let complete = true;
                for (const person of visible.slice(start, start + virtualColumnCount)) {
                    const measurement = cardMeasurements.get(person.itemId);
                    if (!measurement || Math.abs(measurement.width - virtualCardWidth) >= 2) {
                        complete = false;
                        break;
                    }
                    rowHeight = Math.max(rowHeight, measurement.height);
                }
                if (complete) measuredRows.push(rowHeight);
            }
        }
        // Estimate with complete row maxima, so desktop multi-column rows and the
        // mobile single-column layout both track their own measured content density.
        return Math.max(120, Math.min(420, estimateVirtualHeight(measuredRows, CARD_ROW_ESTIMATE)));
    });
    const cardVirtualRows = $derived.by(() => {
        cardMeasureRevision;
        return buildVirtualRows(visible, virtualColumnCount, (person) => person.itemId,
            (itemId) => {
                const measurement = cardMeasurements.get(itemId);
                return measurement && virtualCardWidth > 0 && Math.abs(measurement.width - virtualCardWidth) < 2
                    ? measurement.height : undefined;
            }, virtualCardEstimate, VIRTUAL_ROW_GAP);
    });
    const tableVirtualRows = $derived.by(() => buildVirtualRows(visible, 1, (person) => person.itemId,
        () => TABLE_ROW_ESTIMATE, TABLE_ROW_ESTIMATE, 0));
    const virtualRows = $derived(viewMode === "cards" ? cardVirtualRows : tableVirtualRows);
    const currentVirtualRange = (scrollTop: number, viewportHeight: number) => virtualized
        ? virtualRowRange(virtualRows.offsets, scrollTop, viewportHeight, VIRTUAL_OVERSCAN_ROWS, virtualRowSize * 4)
        : { start: 0, end: virtualRows.rows.length };
    const virtualStartRow = $derived(virtualized ? currentVirtualRange(virtualScrollTop, virtualViewportHeight).start : 0);
    const virtualEndRow = $derived(virtualized ? currentVirtualRange(virtualScrollTop, virtualViewportHeight).end : 0);
    const virtualStartIndex = $derived(virtualized ? virtualStartRow * virtualColumnCount : 0);
    const virtualEndIndex = $derived(virtualized ? Math.min(visible.length, virtualEndRow * virtualColumnCount) : visible.length);
    const renderedVisible = $derived(virtualized ? visible.slice(virtualStartIndex, virtualEndIndex) : visible);
    const virtualTopSpacer = $derived(virtualized
        ? Math.max(0, (virtualRows.offsets[virtualStartRow] ?? 0) - (viewMode === "cards" && virtualStartRow > 0 ? VIRTUAL_ROW_GAP : 0))
        : 0);
    const virtualBottomSpacer = $derived(virtualized
        ? Math.max(0, virtualRows.totalHeight - (virtualRows.offsets[virtualEndRow] ?? virtualRows.totalHeight)
            - (viewMode === "cards" && virtualEndRow < virtualRows.rows.length ? VIRTUAL_ROW_GAP : 0))
        : 0);

    function readCardMeasurement(element: Element): { id: string; width: number; height: number } | null {
        if (!(element instanceof HTMLElement)) return null;
        const id = element.dataset.personItemId;
        if (!id || !element.isConnected) return null;
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 ? { id, width: rect.width, height: rect.height } : null;
    }

    function applyCardMeasurements(entries: readonly Pick<ResizeObserverEntry, "target">[]): void {
        const element = peopleListElement;
        if (!element || viewMode !== "cards" || !virtualized) return;
        const prior = cardVirtualRows;
        const anchorScrollTop = element.scrollTop;
        const wasAtBottom = element.scrollTop + element.clientHeight >= element.scrollHeight - 2;
        const priorAnchorRow = virtualRowAtOffset(prior.offsets, element.scrollTop);
        const anchorId = prior.rows[priorAnchorRow]?.items[0]?.itemId;
        const offsetInAnchor = element.scrollTop - (prior.offsets[priorAnchorRow] ?? 0);
        let changed = false;
        for (const entry of entries) {
            const measurement = readCardMeasurement(entry.target);
            if (!measurement) continue;
            const old = cardMeasurements.get(measurement.id);
            if (!old || Math.abs(old.width - measurement.width) >= 1 || Math.abs(old.height - measurement.height) >= 1) {
                cardMeasurements.set(measurement.id, { width: measurement.width, height: measurement.height });
                changed = true;
            }
        }
        if (!changed) return;
        cardMeasureRevision += 1;
        // Keep the same stable row at the same intra-row offset when measured rows above
        // the viewport change the spacer height (long wrapped profile text is common here).
        if (anchorId) {
            void tick().then(() => requestAnimationFrame(() => {
                if (element !== peopleListElement || !element.isConnected) return;
                // A user may scroll before this measurement batch reaches the next frame.
                // Never let a stale anchor move their newer position.
                if (Math.abs(element.scrollTop - anchorScrollTop) > 1) return;
                if (wasAtBottom) {
                    // Measurements of the final rows can grow the scroll height. Preserve
                    // the user's intent to stay at the end instead of leaving the viewport
                    // stranded above the last contacts.
                    element.scrollTop = Math.max(0, element.scrollHeight - element.clientHeight);
                    updateVirtualViewport();
                    return;
                }
                const row = cardVirtualRows.rows.findIndex((candidate) => candidate.items.some((person) => person.itemId === anchorId));
                if (row < 0) return;
                element.scrollTop = Math.max(0, (cardVirtualRows.offsets[row] ?? 0) + offsetInAnchor);
                updateVirtualViewport();
            }));
        }
    }

    // Observe only the rendered cards. The observer follows the list container lifetime;
    // the diff below avoids recreating it on every scroll-window update.
    $effect(() => {
        const element = peopleListElement;
        if (!element || typeof ResizeObserver === "undefined") return;
        const observer = new ResizeObserver((entries) => applyCardMeasurements(entries));
        cardResizeObserver = observer;
        return () => {
            observer.disconnect();
            if (cardResizeObserver === observer) cardResizeObserver = undefined;
            observedCards.clear();
        };
    });

    $effect(() => {
        renderedVisible;
        const element = peopleListElement;
        const observer = cardResizeObserver;
        if (!element || !observer) return;
        const cards = viewMode === "cards" && virtualized
            ? [...element.querySelectorAll<HTMLElement>(".lvct-person-card[data-person-item-id]")]
            : [];
        const current = new Set(cards);
        for (const previous of observedCards) {
            if (!current.has(previous)) {
                observer.unobserve(previous);
                observedCards.delete(previous);
            }
        }
        const initialMeasurements: Array<Pick<ResizeObserverEntry, "target">> = [];
        for (const card of cards) {
            if (observedCards.has(card)) continue;
            observedCards.add(card);
            observer.observe(card);
            const measurement = readCardMeasurement(card);
            if (measurement) initialMeasurements.push({ target: card });
        }
        if (initialMeasurements.length) applyCardMeasurements(initialMeasurements);
    });

    $effect(() => {
        const currentIds = new Set(people.map((person) => person.itemId));
        let changed = false;
        for (const id of cardMeasurements.keys()) {
            if (!currentIds.has(id)) {
                cardMeasurements.delete(id);
                changed = true;
            }
        }
        if (changed) cardMeasureRevision += 1;
    });

    let previousFilterSignature = "";
    $effect(() => {
        const signature = JSON.stringify([searchText, groupFilter, tagFilter, extraFilter, focusIds, focusLabel, sortMode, currentViewId]);
        if (previousFilterSignature && signature !== previousFilterSignature) {
            if (peopleListElement) peopleListElement.scrollTop = 0;
            virtualScrollTop = 0;
        }
        previousFilterSignature = signature;
    });

    let previousColumnCount = 0;
    $effect(() => {
        const columns = virtualColumnCount;
        if (previousColumnCount > 0 && columns !== previousColumnCount) {
            if (peopleListElement) peopleListElement.scrollTop = 0;
            virtualScrollTop = 0;
        }
        previousColumnCount = columns;
    });
    $effect(() => { onOrderChange?.(filtered); });

    $effect(() => {
        const request = focusRequest;
        if (!request || refreshQueued || loading || rosterRefreshing || !peopleElement) return;
        // 这些依赖在名册、筛选或视图变化提交后重新查找当前入口。
        visible;
        viewMode;
        const active = document.activeElement;
        if (active instanceof HTMLElement && active.isConnected && active !== document.body && active !== request.previousActive) {
            // 等待读取时用户已聚焦其他控件或新窗口，保留其新的操作位置。
            focusRequest = null;
            request.resolve("cancelled");
            return;
        }
        const index = filtered.findIndex((person) => person.itemId === request.itemId);
        if (index >= visibleCount) {
            // 编辑或互动可能改变排序位置，先展示新的所在页，再恢复该入口。
            visibleCount = index + 1;
            return;
        }
        if (virtualized && (index < virtualStartIndex || index >= virtualEndIndex)) {
            const targetRow = Math.floor(index / virtualColumnCount);
            if (peopleListElement) {
                peopleListElement.scrollTop = viewMode === "cards"
                    ? cardVirtualRows.offsets[targetRow] ?? 0
                    : targetRow * virtualRowSize;
                virtualScrollTop = peopleListElement.scrollTop;
            }
            return;
        }
        const target = peopleElement.querySelector<HTMLElement>(`[data-person-item-id="${CSS.escape(request.itemId)}"]`);
        if (!target && rosterLoadingMore) return;
        focusRequest = null;
        target?.focus({ preventScroll: true });
        request.resolve(target && document.activeElement === target ? "restored" : "missing");
    });

    // 生效条件行（F03）：搜索/分组/标签与更多筛选的可视化，可单项清除
    type ConditionChip = { key: string; label: string };
    const conditionChips: ConditionChip[] = $derived.by(() => {
        const chips: ConditionChip[] = [];
        if (activeViewName) chips.push({ key: "view", label: `视图：${activeViewName}` });
        if (searchText.trim()) chips.push({ key: "search", label: `搜索「${searchText.trim()}」` });
        if (groupFilter) chips.push({ key: "group", label: `分组：${groupFilter}` });
        if (tagFilter.length > 0) chips.push({ key: "tags", label: `标签${extraFilter.tagMatch === "any" ? "（任一）" : ""}：${tagFilter.join(" / ")}` });
        if (extraFilter.recentFrom || extraFilter.recentTo) chips.push({ key: "recentRange", label: `最近互动 ${extraFilter.recentFrom || "早期"} ~ ${extraFilter.recentTo || "至今"}${recentFiltersPaused ? "（已暂停）" : ""}` });
        if (extraFilter.neverContacted) chips.push({ key: "neverContacted", label: `从未联系${recentFiltersPaused ? "（已暂停）" : ""}` });
        if (extraFilter.profileGap) chips.push({ key: "profileGap", label: `资料：${PROFILE_GAPS.find((gap) => gap.key === extraFilter.profileGap)?.label ?? extraFilter.profileGap}` });
        if (extraFilter.workQuery?.trim()) chips.push({ key: "workQuery", label: `工作单位：${extraFilter.workQuery.trim()}` });
        if (extraFilter.educationQuery?.trim()) chips.push({ key: "educationQuery", label: `学校：${extraFilter.educationQuery.trim()}` });
        if (extraFilter.relationshipLabel?.trim()) chips.push({ key: "relationshipLabel", label: `与我的关系：${extraFilter.relationshipLabel.trim()}` });
        return chips;
    });

    function clearCondition(key: string) {
        if (key === "view") {
            // 仅取消当前视图标记，保留已应用的条件
            currentViewId = "";
            activeViewName = "";
            return;
        }
        if (key === "search") {
            searchText = "";
            onExternalSearchCleared?.();
        }
        else if (key === "group") groupFilter = "";
        else if (key === "tags") tagFilter = [];
        else if (key === "recentRange") extraFilter = { ...extraFilter, recentFrom: "", recentTo: "" };
        else if (key === "neverContacted") extraFilter = { ...extraFilter, neverContacted: false };
        else if (key === "profileGap") extraFilter = { ...extraFilter, profileGap: "" };
        else if (["workQuery", "educationQuery", "relationshipLabel"].includes(key)) extraFilter = { ...extraFilter, [key]: "" };
        visibleCount = PAGE_SIZE;
    }

    function clearAllConditions() {
        searchText = "";
        onExternalSearchCleared?.();
        groupFilter = "";
        tagFilter = [];
        extraFilter = { ...EMPTY_PEOPLE_FILTER };
        sortMode = initialSort;
        currentViewId = "";
        activeViewName = "";
        viewHint = "";
        visibleCount = PAGE_SIZE;
        onClearFocus?.();
    }

    // 更多筛选浮层：fixed 定位原语（B02）——absolute 面板会被滚动祖先裁剪，宿主菜单同样用 fixed
    $effect(() => {
        const wrap = moreMenuWrap;
        const panel = moreMenuPanel;
        if (!moreOpen || !wrap || !panel) return;
        // 更多筛选包含文本和日期输入，移动端输入法打开时不能销毁当前草稿。
        return attachPopover(panel, wrap, () => (moreOpen = false), isMobile ? {
            closeOnScroll: false,
            closeOnResize: false,
        } : undefined);
    });

    // 视图浮层：fixed 定位原语（B02）——absolute 面板会被滚动祖先裁剪，宿主菜单同样用 fixed
    $effect(() => {
        const wrap = viewsMenuWrap;
        const panel = viewsMenuPanel;
        if (!viewsOpen || !wrap || !panel) return;
        // 视图菜单在移动筛选抽屉内复用，和其它移动浮层保持一致的视口变化行为。
        return attachPopover(panel, wrap, () => (viewsOpen = false), isMobile ? {
            closeOnScroll: false,
            closeOnResize: false,
        } : undefined);
    });

    // 外部偏好更新时同步本地视图列表
    $effect(() => {
        localViews = normalizeSavedViews(preferences.savedViews);
    });

    function currentQuery(): SavedViewQuery {
        return {
            search: searchText,
            group: groupFilter,
            tags: [...tagFilter],
            tagMatch: extraFilter.tagMatch,
            recentFrom: extraFilter.recentFrom,
            recentTo: extraFilter.recentTo,
            neverContacted: extraFilter.neverContacted,
            profileGap: extraFilter.profileGap,
            sort: sortMode,
            ...(extraFilter.workQuery?.trim() ? { workQuery: extraFilter.workQuery.trim() } : {}),
            ...(extraFilter.educationQuery?.trim() ? { educationQuery: extraFilter.educationQuery.trim() } : {}),
            ...(extraFilter.relationshipLabel?.trim() ? { relationshipLabel: extraFilter.relationshipLabel.trim() } : {}),
        };
    }

    // 条件漂移检测：当前条件与激活视图的规则不一致时，取消视图标记（人物变化时规则自动重新求值）
    $effect(() => {
        if (!currentViewId) return;
        const view = localViews.find((item) => item.id === currentViewId);
        if (!view) {
            currentViewId = "";
            activeViewName = "";
            return;
        }
        if (JSON.stringify(currentQuery()) !== JSON.stringify(view.query)) {
            currentViewId = "";
            activeViewName = "";
        }
    });

    function applyQueryToState(query: SavedViewQuery) {
        searchText = query.search;
        groupFilter = query.group;
        tagFilter = [...query.tags];
        extraFilter = { ...extraFilter, tagMatch: query.tagMatch, recentFrom: query.recentFrom, recentTo: query.recentTo, neverContacted: query.neverContacted,
            profileGap: query.profileGap ?? "",
            workQuery: query.workQuery ?? "", educationQuery: query.educationQuery ?? "", relationshipLabel: query.relationshipLabel ?? "" };
        sortMode = query.sort;
        visibleCount = PAGE_SIZE;
    }

    function applySavedView(view: SavedView) {
        viewsOpen = false;
        currentViewId = view.id;
        activeViewName = view.name;
        applyQueryToState(view.query);
        const missing = missingTags(view.query, tags);
        viewHint = missing.length > 0 ? `视图「${view.name}」中的标签已失效：${missing.join("、")}（其余条件照常生效）` : "";
    }

    async function persistViews(next: SavedView[]) {
        prefError = "";
        preferenceIntent = { ...preferenceIntent, savedViews: next };
        try {
            // savedViews 同样以已确认的父层偏好为基线，避免前一次失败导致旧意图在后续操作中被省略。
            await onPreferencesChange(preferenceIntent, normalizeViewPreferences(preferences));
            return true;
        } catch (error) {
            prefError = requestErrorMessage(error);
            return false;
        }
    }

    async function saveCurrentAsView() {
        const name = (window.prompt("视图名称（保存当前的搜索、分组、标签、更多筛选与排序）") ?? "").trim();
        if (!name) {
            viewsOpen = false;
            return;
        }
        const existing = findSavedViewByName(localViews, name);
        if (!existing && localViews.length >= SAVED_VIEWS_LIMIT) {
            viewHint = `最多保存 ${SAVED_VIEWS_LIMIT} 个视图；请覆盖已有同名视图，或删除一个后再新增。`;
            return;
        }
        if (existing && !window.confirm(`已存在同名视图「${name}」，覆盖它吗？`)) return;
        const nextView: SavedView = {
            id: existing?.id ?? `view-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
            name,
            query: currentQuery(),
        };
        const nextViews = existing
            ? localViews.map((view) => (view.id === existing.id ? nextView : view))
            : [...localViews, nextView];
        if (!(await persistViews(nextViews))) return;
        localViews = normalizeSavedViews(nextViews);
        currentViewId = nextView.id;
        activeViewName = nextView.name;
        viewHint = "";
        viewsOpen = false;
    }

    async function renameSavedView(view: SavedView) {
        const name = (window.prompt("重命名视图", view.name) ?? "").trim();
        if (!name || name === view.name) return;
        const duplicate = findSavedViewByName(localViews, name);
        if (duplicate && duplicate.id !== view.id) {
            viewHint = `已存在同名视图「${name}」，请换一个名称`;
            return;
        }
        const nextViews = localViews.map((item) => (item.id === view.id ? { ...item, name } : item));
        if (!(await persistViews(nextViews))) return;
        localViews = normalizeSavedViews(nextViews);
        if (currentViewId === view.id) activeViewName = name;
    }

    async function deleteSavedView(view: SavedView) {
        if (!window.confirm(`删除视图「${view.name}」？只删除这条保存的规则，不改联系人与当前列表。`)) return;
        const nextViews = localViews.filter((item) => item.id !== view.id);
        if (!(await persistViews(nextViews))) return;
        localViews = normalizeSavedViews(nextViews);
        if (currentViewId === view.id) {
            currentViewId = "";
            activeViewName = "";
        }
    }

    // 附加筛选变化时重置分页，避免停留在过大的页
    $effect(() => {
        void extraFilter.tagMatch;
        void extraFilter.recentFrom;
        void extraFilter.recentTo;
        void extraFilter.neverContacted;
        visibleCount = PAGE_SIZE;
    });
    /*
     * 选择状态会同时驱动卡片、表格和批量工具栏。此前这些位置都用
     * Array.includes/Array.some 做线性查找，联系人较多时一次筛选会产生
     * O(n²) 的重复扫描。派生 Set 后每个查找均为 O(1)，且只在对应数组
     * 变化时重建，保持 Svelte 的响应式更新语义。
     */
    const selectedIdSet = $derived(new Set(selectedIds));
    const filteredIdSet = $derived(new Set(filtered.map((person) => person.itemId)));
    const selectedPeople = $derived(selectedIds.map((itemId) => selectedPeopleCache[itemId]).filter((person): person is ContactSummary => Boolean(person)));
    const hiddenSelectionCount = $derived(selectedPeople.filter((person) => !filteredIdSet.has(person.itemId)).length);
    const allVisibleSelected = $derived(visible.length > 0 && visible.every((person) => selectedIdSet.has(person.itemId)));
    const someVisibleSelected = $derived(visible.some((person) => selectedIdSet.has(person.itemId)) && !allVisibleSelected);
    let visibleSelectionToggle: HTMLInputElement | undefined = $state();
    $effect(() => {
        /* Native checkboxes expose partial selection through the DOM property only. */
        if (visibleSelectionToggle) visibleSelectionToggle.indeterminate = someVisibleSelected;
    });

    /* 每轮名册及扩展资料只读一次；关键词变化仅重算同一份本地投影。 */
    let refreshGeneration = 0;

    function verifyRosterPage(next: ContactPage, requestedPage: number, requestedSize: number, existing: readonly ContactSummary[]): void {
        if (next.page !== requestedPage || !Number.isSafeInteger(next.pageSize) || next.pageSize < 1
            || (requestedPage === 1 ? next.pageSize > requestedSize : next.pageSize !== requestedSize)) {
            throw new Error("联系人分页页码或页大小不一致，请重新加载名册");
        }
        if (next.people.length > next.pageSize || (next.people.length === 0 && next.hasMore)) {
            throw new Error("联系人分页返回空页或行数矛盾，已停止继续读取");
        }
        if (requestedPage > 1 && next.totalKnown && rosterTotalKnown && next.total !== rosterTotal) {
            throw new Error("读取期间联系人总数已变化，请重新加载完整名册");
        }
        const itemIds = new Set(existing.map((person) => person.itemId));
        const docIds = new Set(existing.map((person) => person.docId));
        for (const person of next.people) {
            if (!person.itemId.trim() || !person.docId.trim()) throw new Error("联系人缺少稳定行或文档身份，已停止继续读取");
            if (itemIds.has(person.itemId) || docIds.has(person.docId)) {
                throw new Error("联系人分页出现重复行或文档身份「" + person.name + "」，已停止继续读取以避免重复展示");
            }
            itemIds.add(person.itemId);
            docIds.add(person.docId);
        }
        const loaded = existing.length + next.people.length;
        if (next.totalKnown && (loaded > next.total || (!next.hasMore && loaded !== next.total))) {
            throw new Error("联系人分页尚未完整核实（已读取 " + loaded + "/" + next.total + " 人），请重新加载名册");
        }
    }

    async function refresh() {
        const request = ++refreshGeneration;
        rosterAbortController?.abort();
        const abortController = new AbortController();
        rosterAbortController = abortController;
        const project = createContactListProjection();
        rosterProjection = project;
        rosterVerified = false;
        rosterRefreshing = true;
        rosterLoadGeneration += 1;
        const pageGeneration = rosterLoadGeneration;
        // 刷新保留旧内容供查看，完整性门禁在新一轮读取完成前保持关闭。
        loading = people.length === 0;
        errorText = "";
        rosterLoadError = "";
        rosterLoadingMore = false;
        rosterPage = 0;
        rosterPageSize = PAGE_SIZE;
        rosterTotal = 0;
        rosterTotalKnown = false;
        rosterHasMore = false;
        try {
            const next = await listContactPage(settings, 1, PAGE_SIZE, "", { signal: abortController.signal, project });
            if (request !== refreshGeneration || pageGeneration !== rosterLoadGeneration || !peopleAlive || abortController.signal.aborted) return;
            verifyRosterPage(next, 1, PAGE_SIZE, []);
            people = next.people;
            selectedPeopleCache = { ...selectedPeopleCache, ...Object.fromEntries(next.people.map((person) => [person.itemId, person])) };
            rosterPage = next.page;
            rosterPageSize = next.pageSize;
            rosterTotal = next.total;
            rosterTotalKnown = next.totalKnown;
            rosterHasMore = next.hasMore;
            loading = false;
            void loadRemainingRosterPages(request, pageGeneration, abortController, project, 1);
        } catch (error) {
            if (request !== refreshGeneration || pageGeneration !== rosterLoadGeneration || !peopleAlive) return;
            if (!isAbortError(error)) errorText = requestErrorMessage(error);
            loading = false;
            rosterRefreshing = false;
        } finally {
            if (rosterAbortController === abortController && !rosterLoadingMore) rosterAbortController = undefined;
        }
    }

    async function loadRemainingRosterPages(
        request: number,
        expectedGeneration = rosterLoadGeneration,
        abortController = rosterAbortController ?? new AbortController(),
        project = rosterProjection ?? createContactListProjection(),
        pagesRead = 0,
    ) {
        if (expectedGeneration !== rosterLoadGeneration) return;
        rosterLoadingMore = true;
        rosterLoadError = "";
        try {
            while (rosterHasMore && pagesRead < AUTO_ROSTER_PAGE_LIMIT && request === refreshGeneration
                && expectedGeneration === rosterLoadGeneration && peopleAlive) {
                const requestedPage = rosterPage + 1;
                const next = await listContactPage(settings, requestedPage, rosterPageSize, "", { signal: abortController.signal, project });
                if (request !== refreshGeneration || expectedGeneration !== rosterLoadGeneration || !peopleAlive || abortController.signal.aborted) return;
                verifyRosterPage(next, requestedPage, rosterPageSize, people);
                people = [...people, ...next.people];
                selectedPeopleCache = { ...selectedPeopleCache, ...Object.fromEntries(next.people.map((person) => [person.itemId, person])) };
                rosterPage = next.page;
                rosterTotal = Math.max(rosterTotal, next.total);
                rosterTotalKnown = rosterTotalKnown && next.totalKnown;
                rosterHasMore = next.hasMore;
                pagesRead += 1;
            }
            if (!rosterHasMore && request === refreshGeneration && expectedGeneration === rosterLoadGeneration && peopleAlive) {
                // 同页未包含本人不能说明本人无效；完整唯一名册统一核实参照，复用已读快照而不新增IO。
                const projected = await project(people);
                if (request !== refreshGeneration || expectedGeneration !== rosterLoadGeneration || !peopleAlive || abortController.signal.aborted) return;
                people = projected;
                const completeIds = new Set(people.map((person) => person.itemId));
                selectedIds = selectedIds.filter((itemId) => completeIds.has(itemId));
                selectedPeopleCache = Object.fromEntries(people.map((person) => [person.itemId, person]));
                rosterVerified = true;
            }
        } catch (error) {
            if (request === refreshGeneration && expectedGeneration === rosterLoadGeneration && peopleAlive && !isAbortError(error)) {
                rosterLoadError = requestErrorMessage(error);
            }
        } finally {
            if (expectedGeneration === rosterLoadGeneration) {
                rosterLoadingMore = false;
                rosterRefreshing = false;
                if (rosterAbortController === abortController) rosterAbortController = undefined;
            }
        }
    }

    function stopRosterLoading() {
        rosterLoadGeneration += 1;
        rosterAbortController?.abort();
        rosterAbortController = undefined;
        rosterLoadingMore = false;
        rosterRefreshing = false;
    }

    function resumeRosterLoading() {
        if (rosterLoadingMore) return;
        if (!rosterHasMore) { if (rosterLoadError) void refresh(); return; }
        const abortController = new AbortController();
        rosterAbortController = abortController;
        rosterRefreshing = true;
        void loadRemainingRosterPages(refreshGeneration, ++rosterLoadGeneration, abortController);
    }

    $effect(() => {
        revision;
        settings.avId;
        settings.dbBlockId;
        settings.fieldMap;
        stopRosterLoading();
        refreshQueued = true;
        const timer = window.setTimeout(() => { refreshQueued = false; void refresh(); }, 0);
        return () => window.clearTimeout(timer);
    });

    async function reloadRecentInteractions(): Promise<void> {
        const request = ++recentGeneration;
        recentState = "loading";
        try {
            const value = await loadRecentInteractions();
            if (request !== recentGeneration) return;
            recent = value;
            recentError = "";
            recentState = "ready";
        } catch (error) {
            if (request !== recentGeneration) return;
            recentError = requestErrorMessage(error);
            recentState = "error";
            if (sortMode === "recent") sortMode = "name";
        }
    }

    $effect(() => {
        revision;
        /* FUNC-01.7-a 请求代际：recent 读取无共享缓存去重，须自行挡乱序响应 */
        void reloadRecentInteractions();
    });

    function toggleTag(tag: string) {
        tagFilter = tagFilter.includes(tag) ? tagFilter.filter((item) => item !== tag) : [...tagFilter, tag];
        visibleCount = PAGE_SIZE;
    }

    function toggleSelected(itemId: string, selected: boolean) {
        selectedScope = "manual";
        const person = people.find((item) => item.itemId === itemId);
        if (selected && person) selectedPeopleCache = { ...selectedPeopleCache, [itemId]: person };
        selectedIds = selected
            ? [...new Set([...selectedIds, itemId])]
            : selectedIds.filter((id) => id !== itemId);
    }

    function toggleAllVisible(selected: boolean) {
        selectedScope = "manual";
        if (selected) selectedPeopleCache = { ...selectedPeopleCache, ...Object.fromEntries(visible.map((person) => [person.itemId, person])) };
        const visibleIds = new Set(visible.map((person) => person.itemId));
        selectedIds = selected
            ? [...new Set([...selectedIds, ...visibleIds])]
            : selectedIds.filter((id) => !visibleIds.has(id));
    }

    function parseTags(value: string): string[] {
        return [...new Set(value.split(/[，,、\s]+/).map((tag) => tag.trim()).filter((tag) => tag.length > 0))];
    }

    function selectAllFiltered(): void {
        if (batchBusy || batchOrgBusy || exportingSelected || !allFilteredScopeReady) return;
        selectedPeopleCache = { ...selectedPeopleCache, ...Object.fromEntries(filtered.map((person) => [person.itemId, person])) };
        selectedIds = filtered.map((person) => person.itemId);
        selectedScope = "filtered";
        selectedFilteredNeedsRecent = recentFilterRequested;
    }

    function selectVisibleScope(): void {
        if (batchBusy || batchOrgBusy || exportingSelected) return;
        selectedPeopleCache = { ...selectedPeopleCache, ...Object.fromEntries(visible.map((person) => [person.itemId, person])) };
        selectedIds = visible.map((person) => person.itemId);
        selectedScope = "page";
    }

    function openBatch(): void {
        if (batchBusy || batchOrgBusy || exportingSelected) return;
        if (selectionScopePending) { batchError = pendingScopeMessage; return; }
        batchTargets = selectedPeople.map((person) => ({ ...person, tags: [...person.tags] }));
        batchFromFiltered = selectedScope === "filtered";
        batchNeedsRecent = selectedFilteredNeedsRecent;
        batchConfirmed = false;
        batchScopeLabel = selectionScopeLabel;
        batchAnchor = JSON.stringify([settings.avId, settings.dbBlockId, settings.fieldMap]);
        batchHiddenCount = hiddenSelectionCount;
        includeHidden = false;
        batchError = "";
        batchFailedFieldsByItem = {};
        batchOpen = true;
    }

    async function openBatchOrganization(): Promise<void> {
        if (batchOrgOpen || batchBusy || batchOrgBusy || exportingSelected || selectedIds.length === 0) return;
        if (selectionScopePending) { batchError = pendingScopeMessage; return; }
        batchOrgTargets = selectedPeople.map((person) => ({ ...person, tags: [...person.tags] }));
        batchOrgFromFiltered = selectedScope === "filtered";
        batchOrgNeedsRecent = selectedFilteredNeedsRecent;
        batchOrgScopeLabel = selectionScopeLabel;
        batchOrgAnchor = JSON.stringify([settings.avId, settings.dbBlockId, settings.fieldMap]);
        batchOrgHiddenCount = hiddenSelectionCount;
        batchOrgIncludeHidden = false;
        batchOrgError = "";
        batchOrgResult = "";
        batchOrgFailed = [];
        batchOrgDocId = "";
        batchOrgIntent = null;
        batchOrgCandidates = [];
        batchOrgDirectoryVerified = false;
        batchOrgLoading = false;
        batchOrgOpen = true;
        await reloadBatchOrganizations(true);
    }

    function closeBatchOrganization(): void {
        if (batchOrgBusy) return;
        batchOrgOpen = false;
        batchOrgReadGeneration += 1;
        batchOrgLoading = false;
    }

    async function reloadBatchOrganizations(selectInitial = false): Promise<void> {
        if (!peopleAlive || !batchOrgOpen || batchOrgBusy || batchOrgLoading) return;
        const request = ++batchOrgReadGeneration;
        batchOrgDirectoryVerified = false;
        batchOrgError = "";
        if (!onLoadOrgCandidates) {
            batchOrgError = "当前入口未提供组织目录，请从组织页面打开后重试。";
            return;
        }
        batchOrgLoading = true;
        try {
            const candidates = await onLoadOrgCandidates();
            if (!peopleAlive || !batchOrgOpen || request !== batchOrgReadGeneration) return;
            batchOrgCandidates = candidates
                .map((candidate) => ({ docId: candidate.docId.trim(), name: candidate.name.trim(), archived: candidate.archived }))
                .filter((candidate) => candidate.docId && candidate.name)
                .sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));
            const uniqueIds = new Set(batchOrgCandidates.map((candidate) => candidate.docId));
            if (uniqueIds.size !== batchOrgCandidates.length) throw new Error("组织目录包含重复文档身份，目标尚未核实，请重新读取。");
            batchOrgDirectoryVerified = true;
            const first = batchOrgCandidates.find((candidate) => !candidate.archived);
            if (selectInitial && !batchOrgDocId) batchOrgDocId = first?.docId ?? "";
            const targetId = batchOrgIntent?.docId ?? batchOrgDocId;
            if (targetId && !batchOrgCandidates.some((candidate) => candidate.docId === targetId && !candidate.archived)) {
                batchOrgError = "原目标组织已归档或已失效，本批次与失败项已保留；请恢复并重新核实原组织，或取消后重新建立批次。";
            } else if (!first) batchOrgError = batchOrgCandidates.length > 0 ? "当前只有已归档组织，无法登记当前成员。请先恢复组织或新建组织。" : "还没有可加入的组织，请先新建组织。";
        } catch (error) {
            if (peopleAlive && batchOrgOpen && request === batchOrgReadGeneration) {
                batchOrgDirectoryVerified = false;
                batchOrgError = requestErrorMessage(error);
            }
        } finally {
            if (peopleAlive && request === batchOrgReadGeneration) batchOrgLoading = false;
        }
    }

    function changeBatchOrganization(event: Event): void {
        const selector = event.currentTarget as HTMLSelectElement;
        if (batchOrgIntent) { selector.value = batchOrgIntent.docId; return; }
        if (batchOrgBusy || batchOrgLoading || !batchOrgDirectoryVerified) { selector.value = batchOrgDocId; return; }
        batchOrgDocId = selector.value;
        batchOrgError = "";
    }

    async function createBatchOrganization(): Promise<void> {
        if (!onCreateOrganization || batchOrgBusy || batchOrgLoading || batchOrgIntent) return;
        const request = ++batchOrgReadGeneration;
        batchOrgLoading = true;
        batchOrgError = "";
        try {
            const created = await onCreateOrganization();
            if (!peopleAlive || !batchOrgOpen || request !== batchOrgReadGeneration) return;
            // Refresh only the directory. The contact queue and any earlier
            // choice remain owned by this open batch rather than the roster.
            batchOrgLoading = false;
            const reload = reloadBatchOrganizations();
            const reloadRequest = batchOrgReadGeneration;
            await reload;
            if (!peopleAlive || !batchOrgOpen || reloadRequest !== batchOrgReadGeneration || !created || batchOrgIntent) return;
            batchOrgDocId = created.docId;
            if (!batchOrgCandidates.some((org) => org.docId === created.docId && !org.archived)) {
                batchOrgError = "新建组织尚未在目录中核实，请重新读取组织后再加入。";
            }
        } catch (error) {
            if (peopleAlive && batchOrgOpen && request === batchOrgReadGeneration) batchOrgError = requestErrorMessage(error);
        } finally { if (peopleAlive && request === batchOrgReadGeneration) batchOrgLoading = false; }
    }

    async function runBatchOrganization(): Promise<void> {
        if (!peopleAlive || !batchOrgOpen || batchOrgBusy || batchOrgLoading) return;
        if (batchOrgScopePending) { batchOrgError = pendingScopeMessage; return; }
        if (!batchOrgDirectoryVerified) { batchOrgError = "组织目录尚未核实，请重新读取后再继续原批次。"; return; }
        if (!batchOrgDocId) { batchOrgError = "请选择一个未归档组织。"; return; }
        if (batchOrgIntent && batchOrgDocId !== batchOrgIntent.docId) { batchOrgError = "本批次已固定原目标组织，请取消后重新建立其他组织的批次。"; return; }
        if (batchOrgHiddenCount > 0 && !batchOrgIncludeHidden) { batchOrgError = "请确认包含筛选外的已选联系人，或取消后重新选择范围。"; return; }
        if (batchOrgAnchor !== JSON.stringify([settings.avId, settings.dbBlockId, settings.fieldMap])) { batchOrgError = "数据库锚点已变化，请取消后重新核对目标。"; return; }
        const organization = batchOrgCandidates.find((candidate) => candidate.docId === (batchOrgIntent?.docId ?? batchOrgDocId));
        if (!organization || organization.archived) { batchOrgError = "原目标组织已归档或已失效，本批次已保留，请重新读取并核实原组织。"; return; }
        if (!onAddOrgMembership) { batchOrgError = "当前入口未提供组织成员写入服务，请从工作台重新打开。"; return; }
        // An attempted call may already have written before it rejects. Keep
        // that target immutable even when every receipt is initially unknown.
        batchOrgIntent ??= { docId: organization.docId, name: organization.name };
        const intent = { ...batchOrgIntent };
        batchOrgBusy = true;
        batchOrgError = "";
        batchOrgResult = "";
        const retryingFailed = batchOrgFailed.length > 0;
        const targetPeople = retryingFailed ? batchOrgFailed.map((entry) => entry.person) : batchOrgTargets;
        batchOrgFailed = [];
        let succeeded = 0;
        try {
            for (const person of targetPeople) {
                try {
                    await onAddOrgMembership(person.docId, intent.docId, { status: "active" });
                    succeeded += 1;
                } catch (error) {
                    batchOrgFailed = [...batchOrgFailed, { person, message: requestErrorMessage(error) }];
                }
            }
            if (!peopleAlive) return;
            if (batchOrgFailed.length > 0) {
                batchOrgResult = `已加入 ${succeeded} 人，${batchOrgFailed.length} 人失败；失败项可重试。`;
                batchOrgError = batchOrgFailed.map((entry) => `${entry.person.name}：${entry.message}`).join("；");
                await tick();
                batchOrgResultElement?.focus();
            } else {
                batchOrgResult = retryingFailed
                    ? `已重试并将剩余 ${succeeded} 人加入「${organization.name}」，本批次全部完成。`
                    : `已将 ${succeeded} 人加入「${organization.name}」。`;
                batchOrgOpen = false;
                selectedIds = [];
                await refresh();
                await tick();
                batchResult = batchOrgResult;
                batchResultElement?.focus();
            }
        } catch (error) {
            if (!peopleAlive) return;
            batchOrgError = requestErrorMessage(error);
            await tick();
            batchOrgResultElement?.focus();
        } finally {
            if (peopleAlive) batchOrgBusy = false;
        }
    }

    async function runBatchUpdate(onlyFailed = false) {
        if (batchBusy) return;
        if (batchScopePending) { batchError = pendingScopeMessage; return; }
        if (!batchGroupValid) { batchError = text("groupCustomEmpty", "请输入分组名称。"); return; }
        if (batchHiddenCount > 0 && !includeHidden) { batchError = "请确认包含筛选外的已选联系人，或取消后重新选择范围"; return; }
        if (batchAnchor !== JSON.stringify([settings.avId, settings.dbBlockId, settings.fieldMap])) { batchError = "数据库锚点已变化，请取消后重新核对目标"; return; }
        const tagsToAdd = parseTags(batchTagsText);
        const group = batchGroup === GROUP_KEEP_OPTION ? undefined : batchGroup === GROUP_CLEAR_OPTION ? "" : batchGroup;
        if (group === undefined && tagsToAdd.length === 0) {
            batchError = "请选择要修改的分组，或输入至少一个要添加的标签";
            return;
        }
        const targetPeople = onlyFailed
            ? batchTargets.filter((person) => (batchFailedFieldsByItem[person.itemId]?.length ?? 0) > 0)
            : batchTargets;
        if (targetPeople.length === 0) {
            batchError = "没有可重试的失败字段";
            return;
        }
        batchConfirmed = true;
        batchBusy = true;
        batchError = "";
        const verifyBeforeWrite = Object.keys(batchFailedFieldsByItem).length > 0;
        if (!onlyFailed) batchFailedFieldsByItem = {};
        try {
            const results = await batchUpdateContacts(settings, targetPeople.map((person) => ({
                itemId: person.itemId,
                expected: { itemId: person.itemId, docId: person.docId, group: person.group },
                ...(group !== undefined ? { group } : {}),
                ...(tagsToAdd.length > 0 ? { tagsToAdd } : {}),
            })), onlyFailed ? { onlyFieldsByItem: batchFailedFieldsByItem } : { verifyBeforeWrite });
            await refresh();
            if (!peopleAlive) return;
            const failedResults = results.filter((result) => result.report.unresolved.length > 0);
            if (failedResults.length > 0) {
                batchFailedFieldsByItem = Object.fromEntries(failedResults.map((result) => [
                    result.itemId,
                    result.report.unresolved.map((failure) => failure.field),
                ]));
                batchError = `部分字段写入失败：${failedResults.map((result) => {
                    const person = targetPeople.find((item) => item.itemId === result.itemId);
                    const details = result.report.unresolved.map((failure) => `${failure.label}（${failure.message}）`).join("、");
                    return `${person?.name ?? result.itemId}：${details}`;
                }).join("；")}`;
                await tick();
                if (peopleAlive) batchResultElement?.focus();
                return;
            }
            batchOpen = false;
            batchGroup = GROUP_KEEP_OPTION;
            batchGroupValid = true;
            batchTagsText = "";
            batchFailedFieldsByItem = {};
            selectedIds = [];
            batchResult = `批量修改已核实：${targetPeople.length} 人，字段逐项核实完成`;
            await tick();
            if (peopleAlive) batchResultElement?.focus();
        } catch (error) {
            if (!peopleAlive) return;
            batchError = requestErrorMessage(error);
            await tick();
            if (peopleAlive) batchResultElement?.focus();
        } finally {
            if (peopleAlive) batchBusy = false;
        }
    }

    async function exportSelected() {
        if (batchBusy || batchOrgBusy || exportingSelected || selectedIds.length === 0) return;
        if (selectionScopePending) { batchError = pendingScopeMessage; return; }
        if (hiddenSelectionCount > 0 && !window.confirm(`导出手动选中的 ${selectedPeople.length} 人，包含筛选外 ${hiddenSelectionCount} 人；继续导出吗？`)) return;
        exportingSelected = true;
        try {
            const text = await exportVcfText(settings, selectedIds);
            if (!text) return;
            const stamp = new Date().toISOString().slice(0, 10).replaceAll("-", "");
            const blob = new Blob([text], { type: "text/vcard;charset=utf-8" });
            const url = URL.createObjectURL(blob);
            const anchor = document.createElement("a");
            anchor.href = url;
            anchor.download = `小驴人脉_选中_${stamp}.vcf`;
            anchor.click();
            URL.revokeObjectURL(url);
        } catch (error) {
            errorText = requestErrorMessage(error);
        } finally {
            exportingSelected = false;
        }
    }

    async function removeSelected() {
        if (batchBusy || batchOrgBusy || exportingSelected || selectedIds.length === 0) return;
        if (selectionScopePending) { batchError = pendingScopeMessage; return; }
        const names = selectedPeople.map((person) => person.name).slice(0, 5).join("、");
        const suffix = selectedPeople.length > 5 ? ` 等 ${selectedPeople.length} 人` : "";
        if (!window.confirm(`将从人脉名册移除「${names}${suffix}」，共 ${selectedPeople.length} 人（筛选外 ${hiddenSelectionCount} 人）。人物文档和互动记录会保留，确定继续吗？`)) return;
        batchBusy = true;
        batchError = "";
        try {
            await removeContacts(settings, selectedIds);
            selectedIds = [];
            await refresh();
        } catch (error) {
            batchError = requestErrorMessage(error);
        } finally {
            batchBusy = false;
        }
    }
</script>

<div class="lvct-people" bind:this={peopleElement}>
    <!-- B09-1：工具栏控件 snippet 化——桌面原位渲染；移动端收进「筛选与整理」底部弹层（互斥渲染，popover 单挂载） -->
    {#snippet viewMenuControl()}
        <span id="lvct-people-viewsmenu" bind:this={viewsMenuWrap} style="position:relative; display:inline-flex">
            <button class="b3-button b3-button--outline" aria-label={text("peopleViews", "视图")} aria-expanded={viewsOpen} aria-controls={viewsOpen ? "lvct-people-viewsmenu-panel" : undefined} onclick={() => (viewsOpen = !viewsOpen)}>
                <Bookmark size={16}/>{activeViewName ? `${text("peopleViews", "视图")}：${activeViewName}` : text("peopleViews", "视图")}
            </button>
            {#if viewsOpen}
                <!-- Saved views expose independent apply, rename and delete actions;
                     keep native button semantics inside a labelled group. -->
                <div id="lvct-people-viewsmenu-panel" class="lvct-people__moremenu lvct-people__viewsmenu" bind:this={viewsMenuPanel} role="group" aria-label="保存的视图">
                    {#if localViews.length === 0}
                        <p class="lvct-people__viewsmenu-empty">还没有保存的视图。设置筛选条件后，点下方「保存当前筛选为视图」。</p>
                    {/if}
                    {#each localViews as view (view.id)}
                        <div class="lvct-people__viewsmenu-item">
                            <button type="button" class="lvct-people__viewsmenu-apply" title={`应用视图 ${view.name}`} onclick={() => applySavedView(view)}>{view.name}</button>
                            <span class="lvct-people__colmenu-actions">
                                <button type="button" aria-label={`重命名视图 ${view.name}`} onclick={() => renameSavedView(view)}><Pencil size={14}/></button>
                                <button type="button" aria-label={`删除视图 ${view.name}`} onclick={() => deleteSavedView(view)}><Trash2 size={14}/></button>
                            </span>
                        </div>
                    {/each}
                    <div class="lvct-people__colmenu-footer">
                        <button type="button" class="b3-button b3-button--text" onclick={saveCurrentAsView}>保存当前筛选为视图</button>
                    </div>
                </div>
            {/if}
        </span>
    {/snippet}
    {#snippet filterControls()}
        <select class="b3-select" bind:value={groupFilter} aria-label={text("peopleGroupLabel", "分组筛选")} onchange={() => (visibleCount = PAGE_SIZE)}>
            <option value="">{text("peopleAllGroups", "全部分组")}</option>
            {#each groups as group (group)}
                <option value={group}>{group}</option>
            {/each}
        </select>
        <select class="b3-select" bind:value={sortMode} aria-label={text("peopleSortLabel", "排序方式")} onchange={() => (visibleCount = PAGE_SIZE)}>
            <option value="name">{text("peopleSortName", "按姓名")}</option>
            <option value="group">{text("peopleSortGroup", "按分组")}</option>
            <option value="birthday">{text("peopleSortBirthday", "按生日临近")}</option>
            <option value="recent" disabled={recentState !== "ready"}>{recentState === "error" ? "按最近互动（读取失败）" : recentState === "loading" ? "按最近互动（读取中）" : text("peopleSortRecent", "按最近互动")}</option>
        </select>
        <span id="lvct-people-moremenu" bind:this={moreMenuWrap} style="position:relative; display:inline-flex">
            <button
                class="b3-button b3-button--outline"
                aria-expanded={moreOpen}
                aria-controls={moreOpen ? "lvct-people-moremenu-panel" : undefined}
                onclick={() => (moreOpen = !moreOpen)}
            >
                <SlidersHorizontal size={16}/>{text("peopleMoreFilters", "更多筛选")}{isExtraFilterActive(extraFilter) ? " ·" : ""}
            </button>
            {#if moreOpen}
                <div id="lvct-people-moremenu-panel" class="lvct-people__moremenu" bind:this={moreMenuPanel} role="group" aria-label="组合筛选">
                    <p class="lvct-people__menu-title">高级筛选</p>
                    <p class="lvct-people__menu-hint">只显示已核实资料；条件会保留在当前视图中。</p>
                    <label class="lvct-form__item">
                        <span>标签匹配（选中多个标签时）</span>
                        <select class="b3-select fn__block" bind:value={extraFilter.tagMatch}>
                            <option value="all">同时拥有全部所选标签</option>
                            <option value="any">拥有任一所选标签</option>
                        </select>
                    </label>
                    <div class="lvct-form__item">
                        <span>最近互动日期</span>
                        <div style="display:flex; gap:6px; align-items:center">
                            <input type="date" class="b3-text-field fn__block" bind:value={extraFilter.recentFrom} disabled={recentState !== "ready"} title={recentState !== "ready" ? "最近互动尚未核实，读取成功后才能按日期筛选" : undefined} aria-label="最近互动起始日期" />
                            <span>~</span>
                            <input type="date" class="b3-text-field fn__block" bind:value={extraFilter.recentTo} disabled={recentState !== "ready"} title={recentState !== "ready" ? "最近互动尚未核实，读取成功后才能按日期筛选" : undefined} aria-label="最近互动截止日期" />
                        </div>
                    </div>
                    <label class="lvct-people__moremenu-row">
                        <input type="checkbox" bind:checked={extraFilter.neverContacted} disabled={recentState !== "ready"} title={recentState !== "ready" ? "最近互动尚未核实，读取成功后才能筛选从未联系" : undefined} />
                        <span>只看从未联系的人</span>
                    </label>
                    <label class="lvct-form__item">工作单位关键词<input class="b3-text-field" type="text" maxlength="200" value={extraFilter.workQuery ?? ""} oninput={(event) => { extraFilter = { ...extraFilter, workQuery: event.currentTarget.value }; visibleCount = PAGE_SIZE; }} /></label>
                    <label class="lvct-form__item">学校关键词<input class="b3-text-field" type="text" maxlength="200" value={extraFilter.educationQuery ?? ""} oninput={(event) => { extraFilter = { ...extraFilter, educationQuery: event.currentTarget.value }; visibleCount = PAGE_SIZE; }} /></label>
                    <label class="lvct-form__item">与我的关系称谓<input class="b3-text-field" type="text" maxlength="80" value={extraFilter.relationshipLabel ?? ""} oninput={(event) => { extraFilter = { ...extraFilter, relationshipLabel: event.currentTarget.value }; visibleCount = PAGE_SIZE; }} /></label>
                    <p class="ft__smaller">仅匹配已核实的当前分类与当前本人称谓，未知资料不当作未填写。</p>
                    <!-- C03 资料完整度：只按现有九字段判定 -->
                    <div class="lvct-form__item">
                        <span>资料完整度</span>
                        {#each PROFILE_GAPS as gap (gap.key)}
                            <label class="lvct-people__moremenu-row">
                                <input
                                    type="radio"
                                    name="lvct-profile-gap"
                                    checked={extraFilter.profileGap === gap.key}
                                    onchange={() => (extraFilter = { ...extraFilter, profileGap: extraFilter.profileGap === gap.key ? "" : gap.key })}
                                />
                                <span>{gap.label}</span>
                            </label>
                        {/each}
                        {#if extraFilter.profileGap}
                            <button
                                type="button"
                                class="b3-button b3-button--outline"
                                style="margin-top:6px"
                                disabled={!allFilteredScopeReady || filtered.length === 0}
                                title={!allFilteredScopeReady ? "筛选范围待核实，读取完成后再逐个补录" : filtered.length === 0 ? "当前筛选没有可补录的联系人" : undefined}
                                onclick={() => { if (!allFilteredScopeReady) return; if (isMobile) closeMobileSheet(false); completionPeople = filtered.map((person) => ({ ...person, tags: [...person.tags] })); completing = true; }}
                            >逐个补录（{filtered.length}）</button>
                        {/if}
                    </div>
                </div>
            {/if}
        </span>
    {/snippet}
    {#snippet actionControls()}
        <button class="b3-button b3-button--outline" onclick={() => { if (isMobile) closeMobileSheet(false); dupOpen = true; }}>
            {text("peopleCleanup", "整理")}{duplicatePairs.length > 0 ? ` ·${duplicatePairs.length}${duplicatePairsCapped ? "（上限）" : ""}` : ""}
        </button>
        <button class="b3-button b3-button--outline" onclick={() => { if (isMobile) closeMobileSheet(false); importing = true; }}><FolderInput size={16}/>{text("peopleImportDocs", "导入已有文档")}</button>
        <button class="b3-button b3-button--outline" onclick={() => { if (isMobile) closeMobileSheet(false); vcarding = true; }}><ContactRound size={16}/>{text("peopleVcard", "vCard 导入/导出")}</button>
    {/snippet}
    <div class="lvct-people__toolbar lvct-people__control-surface fn__flex">
        {#if isMobile}
            <input
                class="b3-text-field lvct-people__mobile-search"
                type="text"
                aria-label={text("peopleSearchPlaceholder", "搜索联系人")}
                placeholder={text("peopleSearchPlaceholder", "搜索姓名/电话/微信/邮箱/标签…")}
                value={searchText}
                oninput={(event) => { searchText = (event.currentTarget as HTMLInputElement).value; onExternalSearchChange?.(searchText); }}
            />
        {/if}
        {#if !isMobile}
            {@render viewMenuControl()}
            <input
                class="b3-text-field fn__flex-1 lvct-people__desktop-search"
                type="text"
                aria-label={text("peopleSearchPlaceholder", "搜索联系人")}
                placeholder={text("peopleSearchPlaceholder", "搜索姓名/电话/微信/邮箱/标签…")}
                value={searchText}
                oninput={(event) => { searchText = (event.currentTarget as HTMLInputElement).value; onExternalSearchChange?.(searchText); }}
            />
            {@render filterControls()}
        {/if}
        <span class="lvct-people__viewtoggle">
            <span class="lvct-seg" role="group" aria-label="切换卡片/表格" title="切换卡片/表格">
                <button
                    type="button"
                    class="lvct-seg__item"
                    class:lvct-seg__item--active={viewMode === "cards"}
                    aria-pressed={viewMode === "cards"}
                    onclick={() => setViewMode("cards")}
                ><LayoutGrid size={14}/>{text("peopleCards", "卡片")}</button>
                <button
                    type="button"
                    class="lvct-seg__item"
                    class:lvct-seg__item--active={viewMode === "table"}
                    aria-pressed={viewMode === "table"}
                    onclick={() => setViewMode("table")}
                ><List size={14}/>{text("peopleTable", "表格")}</button>
            </span>
            {#if viewMode === "table"}
                <span id="lvct-people-colmenu" bind:this={colMenuWrap} style="position:relative; display:inline-flex">
                    <button
                        class="b3-button b3-button--outline"
                        aria-expanded={colMenuOpen}
                        aria-controls={colMenuOpen ? "lvct-people-colmenu-panel" : undefined}
                        aria-label="表格列设置"
                        title="表格列设置"
                        onclick={() => (colMenuOpen = !colMenuOpen)}
                    ><Columns3 size={16}/>{text("peopleColumnSettings", "列设置")}</button>
                    {#if colMenuOpen}
                        <div id="lvct-people-colmenu-panel" class="lvct-people__colmenu" bind:this={colMenuPanel} role="group" aria-label="表格列显隐与顺序">
                            <p class="lvct-people__menu-title">显示字段</p>
                            <p class="lvct-people__menu-hint">拖动顺序只影响当前表格。</p>
                            <label class="lvct-people__colmenu-row" title="姓名列固定显示">
                                <input type="checkbox" checked disabled />
                                <span>{text("peopleName", "姓名")}</span>
                                <small>固定</small>
                            </label>
                            {#each PEOPLE_TABLE_COLUMNS as key (key)}
                                <div class="lvct-people__colmenu-row">
                                    <input
                                        type="checkbox"
                                        aria-label={`显示${columnLabel(key)}列`}
                                        checked={tableColumns.includes(key)}
                                        onchange={(event) => toggleColumn(key, (event.currentTarget as HTMLInputElement).checked)}
                                    />
                                    <span>{columnLabel(key)}</span>
                                    <span class="lvct-people__colmenu-actions">
                                        <button type="button" aria-label={`上移${columnLabel(key)}列`} title={tableColumns.indexOf(key) <= 0 ? "已经是第一列" : undefined} disabled={tableColumns.indexOf(key) <= 0} onclick={() => moveColumn(key, -1)}>↑</button>
                                        <button type="button" aria-label={`下移${columnLabel(key)}列`} title={tableColumns.indexOf(key) < 0 || tableColumns.indexOf(key) >= tableColumns.length - 1 ? "已经是最后一列" : undefined} disabled={tableColumns.indexOf(key) < 0 || tableColumns.indexOf(key) >= tableColumns.length - 1} onclick={() => moveColumn(key, 1)}>↓</button>
                                    </span>
                                </div>
                            {/each}
                            <div class="lvct-people__colmenu-footer">
                                <button type="button" class="b3-button b3-button--text" onclick={resetDisplayPreferences}>恢复默认显示</button>
                            </div>
                        </div>
                    {/if}
                </span>
            {/if}
        </span>
        {#if !isMobile}
            <button class="b3-button lvct-people__create" onclick={() => (adding = true)}><UserPlus size={16}/>{text("peopleCreate", "新建联系人")}</button>
            <span class="lvct-people__toolbar-actions">
                {@render actionControls()}
            </span>
        {:else}
            <button class="b3-button" onclick={() => (adding = true)} aria-label={text("peopleCreate", "新建联系人")}><UserPlus size={16}/>{text("peopleCreate", "新建")}</button>
            <button
                class="b3-button b3-button--outline"
                aria-label={text("peopleMobileTools", "筛选与整理")}
                aria-expanded={mobileSheetOpen}
                aria-controls={mobileSheetOpen ? "lvct-people-mobile-tools-sheet" : undefined}
                bind:this={mobileSheetTrigger}
                onclick={openMobileSheet}
            ><SlidersHorizontal size={16}/>{text("peopleMobileTools", "筛选与整理")}{isExtraFilterActive(extraFilter) || duplicatePairs.length > 0 ? " ·" : ""}</button>
        {/if}
    </div>
    {#if !isMobile && localViews.length > 0}
        <div class="lvct-people__savedviews" aria-label="已保存视图">
            <span class="lvct-people__savedviews-label">已保存视图</span>
            {#each localViews.slice(0, 3) as view (view.id)}
                <button
                    type="button"
                    class="lvct-people__savedview"
                    class:lvct-people__savedview--active={currentViewId === view.id}
                    aria-pressed={currentViewId === view.id}
                    title={`应用视图 ${view.name}`}
                    onclick={() => applySavedView(view)}
                >{view.name}</button>
            {/each}
            <button type="button" class="b3-button b3-button--text lvct-people__savedviews-manage" onclick={() => (viewsOpen = true)}>
                管理视图
            </button>
        </div>
    {/if}
    {#if isMobile && mobileSheetOpen}
        <div class="lvct-dialog-mask" role="presentation" onclick={(event) => { if (event.target === event.currentTarget) closeMobileSheet(); }}></div>
        <div
            id="lvct-people-mobile-tools-sheet"
            class="lvct-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby={mobileSheetTitleId}
            tabindex="-1"
            bind:this={mobileSheetPanel}
            onkeydown={handleMobileSheetKeydown}
        >
            <div class="lvct-sheet__bar">
                <b id={mobileSheetTitleId}>{text("peopleMobileTools", "筛选与整理")}</b>
                <button type="button" class="b3-button b3-button--text" bind:this={mobileSheetCloseButton} onclick={() => closeMobileSheet()}>{text("dashCollapse", "收起")}</button>
            </div>
            <div class="lvct-sheet__body">
                {@render viewMenuControl()}
                {@render filterControls()}
                {@render actionControls()}
                <button class="b3-button b3-button--outline" onclick={() => { closeMobileSheet(false); adding = true; }}><UserPlus size={16}/>{text("peopleCreate", "新建联系人")}</button>
            </div>
        </div>
    {/if}
    {#if recentState === "loading"}
        <p role="status" aria-live="polite">正在读取最近互动，尚未核实互动日期和从未联系状态。{recentFiltersPaused ? "相关条件已暂停，当前展示其余条件下的联系人，筛选范围待核实。" : "互动状态核实后再显示最近互动。"}</p>
    {:else if recentState === "error"}
        <div class="lvct-form__error" role="alert">
            最近互动读取失败：{recentError}；日期范围、从未联系和按最近互动排序暂时不可用。若此前使用该排序，当前已切回按姓名排序；读取恢复后可重新选择。{recentFiltersPaused ? "相关条件已暂停，当前展示其余条件下的联系人，筛选范围待核实；不能按此范围全选或提交未确认批次。" : "互动状态尚未核实。"}
            <button type="button" class="b3-button b3-button--outline" disabled={loading} title={loading ? "联系人仍在读取中" : undefined} onclick={() => void reloadRecentInteractions()}>重试最近互动</button>
        </div>
    {/if}
    {#if people.some((person) => person.aliasProfile?.state === "unknown")}
        <p role="status">别名读取尚未核实，可按姓名查找；未把失败解释为无别名。</p>
        <button class="b3-button b3-button--text" disabled={loading} title={loading ? "联系人仍在读取中" : undefined} onclick={() => void refresh()}>重新读取别名</button>
    {/if}
    {#if people.some((person) => person.profile?.affiliations.state === "unknown" || person.profile?.relationship.state === "unknown")}
        <p role="status">部分组织或称谓资料尚未核实。原有联系人仍可查看；相关筛选仅使用已核实的值。</p>
        <button class="b3-button b3-button--text" disabled={loading} title={loading ? "联系人仍在读取中" : undefined} onclick={() => void refresh()}>重新读取三项资料</button>
    {/if}
    {#if prefError}
        <div class="lvct-form__error" role="alert">
            显示偏好保存失败：{prefError}
            <button type="button" class="b3-button b3-button--outline" onclick={() => void persistPreferences(preferenceIntent)}>重试保存显示偏好</button>
        </div>
    {/if}

    {#if viewHint}<div class="lvct-people__viewhint" role="status">{viewHint}</div>{/if}

    {#if conditionChips.length > 0}
        <div class="lvct-people__conditions" aria-label={recentFiltersPaused ? "筛选条件（含已暂停条件）" : "生效筛选条件"}>
            <span class="ft__smaller ft__on-surface">{recentFiltersPaused ? "筛选条件（含已暂停）：" : "生效条件："}</span>
            {#each conditionChips as chip (chip.key)}
                <button type="button" class="lvct-people__condition" title="点击清除该条件" onclick={() => clearCondition(chip.key)}>
                    {chip.label} ×
                </button>
            {/each}
            <span class="ft__smaller ft__on-surface">{recentFiltersPaused ? `· 已显示 ${filtered.length} 人，筛选范围待核实` : `· 共 ${filtered.length} 人`}</span>
            <span style="flex:1"></span>
            <button type="button" class="lvct-people__filter-clear" onclick={clearAllConditions}>清除全部</button>
        </div>
    {/if}

    {#if tags.length > 0}
        <div class="lvct-people__filters" aria-label="标签筛选">
            <span class="ft__smaller ft__on-surface">{text("peopleTags", "标签")}</span>
            {#each tags as tag (tag)}
                <button type="button" class="lvct-people__filter" class:lvct-people__filter--active={tagFilter.includes(tag)} aria-pressed={tagFilter.includes(tag)} onclick={() => toggleTag(tag)}>{tag}</button>
            {/each}
            {#if tagFilter.length > 0}
                <button type="button" class="lvct-people__filter-clear" onclick={() => { tagFilter = []; visibleCount = PAGE_SIZE; }}>清除筛选</button>
            {/if}
        </div>
    {/if}

    {#if selectedIds.length > 0}
        <div class="lvct-people__batchbar" role="toolbar" aria-label="批量操作">
            <b>已选 {selectedIds.length} 人</b>
            <span>{selectionScopeLabel}；筛选外 {hiddenSelectionCount} 人</span>
            <button class="b3-button b3-button--outline" onclick={openBatch} disabled={batchBusy || batchOrgBusy || exportingSelected || selectionScopePending} title={selectionScopePending ? pendingScopeMessage : batchBusy || batchOrgBusy || exportingSelected ? "批量操作进行中，请稍候" : undefined}>批量编辑</button>
            <button class="b3-button b3-button--outline" onclick={() => void openBatchOrganization()} disabled={batchBusy || batchOrgBusy || exportingSelected || selectionScopePending} title={selectionScopePending ? pendingScopeMessage : batchBusy || batchOrgBusy || exportingSelected ? "批量操作进行中，请稍候" : undefined}>加入组织</button>
            <button class="b3-button b3-button--outline" onclick={exportSelected} disabled={batchBusy || batchOrgBusy || exportingSelected || selectionScopePending} title={selectionScopePending ? pendingScopeMessage : batchBusy || batchOrgBusy || exportingSelected ? "批量操作进行中，请稍候" : undefined}>导出 vCard</button>
            <button class="b3-button b3-button--cancel lvct-people__remove" onclick={removeSelected} disabled={batchBusy || batchOrgBusy || exportingSelected || selectionScopePending} title={selectionScopePending ? pendingScopeMessage : batchBusy || batchOrgBusy || exportingSelected ? "批量操作进行中，请稍候" : undefined}>从人脉移除</button>
            <button class="b3-button b3-button--text" onclick={() => (selectedIds = [])} disabled={batchBusy || batchOrgBusy || exportingSelected} title={batchBusy || batchOrgBusy || exportingSelected ? "批量操作进行中，请稍候" : undefined}>取消选择</button>
            {#if selectionScopePending}<span role="status">{pendingScopeMessage}</span>{/if}
        </div>
    {/if}

    {#snippet rosterProgress()}
        <div class="lvct-people__progress" role="status" aria-live="polite">
            已加载 {people.length} / {rosterTotal} 人
            {#if rosterLoadingMore}
                · 正在读取后续联系人
                <button type="button" class="b3-button b3-button--text" onclick={stopRosterLoading}>停止继续读取</button>
            {:else if rosterLoadError}
                · 后续读取失败：{rosterLoadError}
                <button type="button" class="b3-button b3-button--text" onclick={resumeRosterLoading}>重试后续读取</button>
            {:else if rosterHasMore}
                · 尚未读取完，本段最多自动读取 {AUTO_ROSTER_PAGE_LIMIT} 页
                <button type="button" class="b3-button b3-button--text" onclick={resumeRosterLoading}>继续读取</button>
            {:else if queryProjectionIncomplete}
                · 搜索资料尚未核实，当前仅为已知结果
            {:else if recentFiltersPaused}
                · 最近互动筛选范围待核实
            {:else if !rosterComplete}
                · 正在核实完整名册
            {:else}
                · 已读取完整名册
            {/if}
        </div>
    {/snippet}
    <div class="lvct-people__list-context">
        <div class="lvct-people__actions" role="group" aria-label="选择联系人范围">
            <button class="b3-button b3-button--text" disabled={batchBusy || batchOrgBusy || exportingSelected || visible.length === 0} title={batchBusy || batchOrgBusy || exportingSelected ? "批量操作进行中，请稍候" : visible.length === 0 ? "当前页没有可选择的联系人" : undefined} onclick={selectVisibleScope}>选择当前页（{visible.length} 人）</button>
            <button class="b3-button b3-button--text" disabled={batchBusy || batchOrgBusy || exportingSelected || !allFilteredScopeReady || filtered.length === 0} title={batchBusy || batchOrgBusy || exportingSelected ? "批量操作进行中，请稍候" : !allFilteredScopeReady ? "筛选范围待核实，名册与相关资料完整读取后再选择全部筛选" : filtered.length === 0 ? "当前筛选没有联系人" : undefined} onclick={selectAllFiltered}>选择全部筛选（{filtered.length} 人）</button>
        </div>
        {#if !loading && !errorText && filtered.length > 0}{@render rosterProgress()}{/if}
    </div>
    {#if batchResult}<p role="status" tabindex="-1" bind:this={batchResultElement}>{batchResult}</p>{/if}
    {#if batchError && !batchOpen}
        <div class="lvct-form__error" role="alert">批量操作失败：{batchError}</div>
    {/if}

    {#if focusLabel}
        <div class="lvct-people__focusbar">
            <span>来自首页：{focusLabel}（{filtered.length} 人）</span>
            <button type="button" onclick={onClearFocus}>清除首页筛选</button>
        </div>
    {/if}

    {#if errorText}
        <div class="lvct-form__error" role="alert">
            <p>联系人加载失败：{errorText}</p>
            <button type="button" class="b3-button b3-button--outline" disabled={loading} onclick={() => void refresh()}>重新加载</button>
        </div>
    {:else if loading && (people.length === 0 || filtered.length === 0)}
        <div class="lvct-people__skeleton" aria-busy="true" aria-label="联系人加载中">
            {#each Array(6) as _, index (index)}
                <div class="lvct-people__skeleton-card">
                    <span class="lvct-skeleton lvct-skeleton--avatar"></span>
                    <span class="lvct-skeleton lvct-skeleton--name"></span>
                    <span class="lvct-skeleton lvct-skeleton--meta"></span>
                </div>
            {/each}
        </div>
    {:else if rosterLoadError && filtered.length === 0}
        <div class="lvct-empty" role="alert">
            <div class="lvct-empty__icon" aria-hidden="true"><ContactRound size={24} strokeWidth={1.8}/></div>
            <b>联系人读取未完成</b>
            <p>已读取 {people.length} 人，后续联系人读取失败：{rosterLoadError}</p>
            <div class="lvct-empty__actions">
                <button type="button" class="b3-button b3-button--outline" disabled={rosterLoadingMore} onclick={resumeRosterLoading}>重试后续读取</button>
            </div>
        </div>
    {:else if recentFiltersPaused && filtered.length === 0}
        <div class="lvct-empty" role="status">
            <div class="lvct-empty__icon" aria-hidden="true"><ContactRound size={24} strokeWidth={1.8}/></div>
            <b>最近互动筛选范围待核实</b>
            <p>当前没有可核实的命中结果；最近互动日期或从未联系状态尚未读取完成，不能判断筛选范围是否为空。</p>
        </div>
    {:else if filtered.length === 0}
        <div class="lvct-empty">
            <div class="lvct-empty__icon" aria-hidden="true"><ContactRound size={24} strokeWidth={1.8}/></div>
            <b>{people.length === 0 && rosterTotal === 0 && rosterComplete ? "还没有联系人" : rosterHasMore ? "联系人读取未完成" : queryProjectionIncomplete ? "搜索资料尚未核实" : !rosterComplete ? "正在核实联系人" : "当前筛选下没有联系人"}</b>
            <p>{people.length === 0 && rosterTotal === 0 && rosterComplete ? "从新建第一个联系人开始，也可以收编笔记或导入 vCard。" : rosterHasMore ? `已读取 ${people.length} / ${rosterTotal} 人，已读范围没有命中，读取完成后再判断。` : queryProjectionIncomplete ? "别名、组织或称谓资料读取未完成，请重新读取核实；当前没有已知命中，不表示没有匹配的联系人。" : !rosterComplete ? "请等待本轮名册核实完成，当前结果尚不能作为完整筛选范围。" : "换个关键词、分组或标签试试。"}</p>
            {#if people.length === 0 && rosterTotal === 0}
                <div class="lvct-empty__actions">
                    <button class="b3-button b3-button--text" onclick={() => (adding = true)}>＋ 新建联系人</button>
                    <button class="b3-button b3-button--outline" onclick={() => (importing = true)}>收编文档</button>
                    <button class="b3-button b3-button--outline" onclick={() => (vcarding = true)}>导入 vCard</button>
                </div>
            {:else if rosterHasMore}
                <div class="lvct-empty__actions">
                    {#if rosterLoadingMore}
                        <button class="b3-button b3-button--outline" onclick={stopRosterLoading}>停止继续读取</button>
                    {:else}
                        <button class="b3-button b3-button--outline" onclick={resumeRosterLoading}>继续读取</button>
                    {/if}
                </div>
            {:else}
                <div class="lvct-empty__actions">
                    <button class="b3-button b3-button--outline" onclick={clearAllConditions}>清除所有筛选</button>
                </div>
            {/if}
        </div>
    {:else if viewMode === "cards"}
        <div class="lvct-people__cards" bind:this={peopleListElement} tabindex="-1" aria-label="联系人列表">
            {#if virtualized}<div class="lvct-people__virtual-spacer" style={`height:${virtualTopSpacer}px`} aria-hidden="true"></div>{/if}
            {#each renderedVisible as person (person.itemId)}
                <PersonCard
                    {person}
                    selected={selectedIdSet.has(person.itemId)}
                    active={activePersonId === person.itemId}
                    recent={recent[person.docId]}
                    recentUnknown={recentState !== "ready"}
                    {onOpenPersonDoc}
                    onToggleSelected={(selected) => toggleSelected(person.itemId, selected)}
                    onOpen={onOpenDetail}
                />
            {/each}
            {#if virtualized}<div class="lvct-people__virtual-spacer" style={`height:${virtualBottomSpacer}px`} aria-hidden="true"></div>{/if}
        </div>
    {:else}
        {#if isMobile}<p class="lvct-people__scroll-hint">左右滑动查看更多字段</p>{/if}
        <!-- svelte-ignore a11y_no_noninteractive_tabindex -- keyboard users need to focus the horizontal scroll region -->
        <div class="lvct-people__table-wrap" bind:this={peopleListElement} role="region" tabindex="0" aria-label="联系人表格，可左右滚动查看更多字段">
            <table class="b3-table">
                <thead>
                    <tr>
                        <th class="lvct-people__select-cell">
                            <input
                                type="checkbox"
                                bind:this={visibleSelectionToggle}
                                aria-label={allVisibleSelected ? "取消选择当前列表联系人" : "选择当前列表联系人"}
                                aria-checked={someVisibleSelected ? "mixed" : allVisibleSelected ? "true" : "false"}
                                checked={allVisibleSelected}
                                onchange={(event) => toggleAllVisible((event.currentTarget as HTMLInputElement).checked)}
                            />
                        </th>
                        <th>{text("peopleName", "姓名")}</th>
                        {#each tableColumns as column (column)}<th>{columnLabel(column)}</th>{/each}
                    </tr>
                </thead>
                <tbody>
                    {#if virtualized}<tr class="lvct-people__virtual-row" aria-hidden="true"><td colspan={tableColumns.length + 2} style={`height:${virtualTopSpacer}px`}></td></tr>{/if}
                    {#each renderedVisible as person (person.itemId)}
                        <tr tabindex="-1" class:lvct-people__row--active={activePersonId === person.itemId} data-person-item-id={person.itemId}
                            onclick={(event) => {
                                if ((event.target as HTMLElement)?.closest("input, button, a")) return;
                                event.currentTarget.focus({ preventScroll: true });
                                onOpenDetail(person);
                            }}>
                            <td class="lvct-people__select-cell">
                                <input
                                    type="checkbox"
                                    aria-label={`选择 ${person.name}`}
                                    checked={selectedIdSet.has(person.itemId)}
                                    onclick={(event) => event.stopPropagation()}
                                    onchange={(event) => toggleSelected(person.itemId, (event.currentTarget as HTMLInputElement).checked)}
                                />
                            </td>
                            <td class="lvct-people__name-cell">
                                <button type="button" class="lvct-people__name-btn" aria-label={`查看 ${person.name} 的详情`} onclick={(event) => { event.stopPropagation(); onOpenDetail(person); }}>
                                    <b>{person.name}</b>
                                </button>
                                {#if onOpenPersonDoc}<button type="button" class="lvct-people__open-doc" title={`打开 ${person.name} 的文档`} aria-label={`打开 ${person.name} 的文档`} onclick={(event) => { event.stopPropagation(); onOpenPersonDoc(person.docId); }}><ExternalLink size={16}/></button>{/if}
                            </td>
                            {#each tableColumns as column (column)}
                                <td>
                                    {#if column === "group"}{person.group || "—"}
                                    {:else if column === "phone"}{person.phone || "—"}
                                    {:else if column === "wechat"}{person.wechat || "—"}
                                    {:else if column === "birthday"}{person.birthday ? formatBirthdayDisplay(person.birthday, person.isLunar) : "—"}
                                    {:else if column === "recent"}{recentState !== "ready" ? "待核实" : recent[person.docId]?.localDate ?? "—"}
                                    {:else if column === "org"}{profileText(person.profile, "work")}
                                    {:else if column === "school"}{profileText(person.profile, "education")}
                                    {:else if column === "relationship"}{profileText(person.profile, "relationship")}
                                    {:else}{person.tags.join(" · ") || "—"}{/if}
                                </td>
                            {/each}
                        </tr>
                    {/each}
                    {#if virtualized}<tr class="lvct-people__virtual-row" aria-hidden="true"><td colspan={tableColumns.length + 2} style={`height:${virtualBottomSpacer}px`}></td></tr>{/if}
                </tbody>
            </table>
        </div>
    {/if}

    {#if filtered.length > visibleCount}
        <button class="b3-button b3-button--outline lvct-people__more" onclick={() => (visibleCount += PAGE_SIZE)}>
            加载更多（已显示 {visible.length} / {filtered.length}）
        </button>
    {/if}

    {#if adding}
        <LvctDialog title="新建联系人" onClose={() => (adding = false)}>
            <AddPersonDialog
                {settings}
                {i18n}
                availableGroups={groups}
                onCreated={() => refresh()}
                {onLoadOrgCandidates}
                {onCreateOrganization}
                {onCreateSelfProfile}
                {onLoadSelfCandidates}
                {onPreviewSelfIdentityChange}
                {onApplySelfIdentityChange}
                {onValidateExtended}
                {onSaveExtended}
                onClose={() => (adding = false)}
            />
        </LvctDialog>
    {/if}

    {#if importing}
        <LvctDialog title="导入已有文档为联系人" wide onClose={() => (importing = false)}>
            <ImportDialog
                {i18n}
                {settings}
                availableGroups={groups}
                onImported={(count) => {
                    if (count > 0) refresh();
                }}
                onClose={() => (importing = false)}
            />
        </LvctDialog>
    {/if}

    {#if vcarding}
        <LvctDialog title="vCard 通讯录导入/导出" wide onClose={() => (vcarding = false)}>
            <VCardDialog
                {settings}
                onImported={(count) => {
                    if (count > 0) refresh();
                }}
                onClose={() => (vcarding = false)}
            />
        </LvctDialog>
    {/if}

    {#if batchOpen}
        <LvctDialog title={`批量编辑 · ${batchTargets.length} 人`} onClose={() => (batchOpen = false)}>
            <div class="lvct-form">
                <p>已固定{batchScopeLabel}的 {batchTargets.length} 人，包含筛选外 {batchHiddenCount} 人。筛选和后台刷新不会增加或替换本次目标。</p>
                {#if batchScopePending}<p role="status">{pendingScopeMessage}</p>{/if}
                {#if batchHiddenCount > 0}<label><input type="checkbox" bind:checked={includeHidden} disabled={batchBusy} />确认包含筛选外 {batchHiddenCount} 人</label>{/if}
                <details><summary>核对目标文档</summary>{#each batchTargets as person (person.itemId)}<p>{person.name} · {person.docId} · {person.itemId}</p>{/each}</details>
                <p class="ft__smaller ft__on-surface">分组会覆盖所选联系人当前值；标签会追加到现有标签并自动去重。</p>
                <GroupField {i18n} value={batchGroup} onValueChange={(value) => (batchGroup = value)} onValidityChange={(valid) => (batchGroupValid = valid)} label={text("batchGroupLabel", "统一分组")} ungroupedLabel={text("formUngrouped", "未分组")} availableGroups={groups} allowKeep allowClear allowUngrouped={false} disabled={batchBusy} />
                <label class="lvct-form__item">
                    <span>追加标签（空格/逗号分隔）</span>
                    <input class="b3-text-field fn__block" type="text" bind:value={batchTagsText} placeholder="重点 客户" disabled={batchBusy} />
                </label>
                {#if !batchBusy && !batchGroupValid}
                    <p class="lvct-people__batch-hint" role="status">请选择有效的分组，或修正自定义分组名称后再应用。</p>
                {:else if !batchBusy && batchHiddenCount > 0 && !includeHidden}
                    <p class="lvct-people__batch-hint" role="status">本次选择包含筛选外联系人；勾选上方确认后才能应用批量修改。</p>
                {/if}
                {#if batchError}<div class="lvct-form__error" role="alert" tabindex="-1" bind:this={batchResultElement}>{batchError}</div>{/if}
                {#if Object.keys(batchFailedFieldsByItem).length > 0}
                    <div class="ft__smaller ft__on-surface">已有 {Object.keys(batchFailedFieldsByItem).length} 人存在失败字段，可只重试这些字段。</div>
                {/if}
                <div class="lvct-form__actions">
                    <button class="b3-button b3-button--cancel" onclick={closeBatch} disabled={batchBusy}>取消</button>
                    {#if Object.keys(batchFailedFieldsByItem).length > 0}
                        <button class="b3-button b3-button--outline" onclick={() => runBatchUpdate(true)} disabled={batchBusy || !batchGroupValid || batchScopePending} title={batchScopePending ? pendingScopeMessage : !batchGroupValid ? "请选择有效的分组后再重试" : undefined}>{batchBusy ? "重试中…" : text("formRetryFailed", "核实并重试未完成字段")}</button>
                    {/if}
                    <button class="b3-button b3-button--text" onclick={() => runBatchUpdate()} disabled={batchBusy || !batchGroupValid || batchScopePending || batchHiddenCount > 0 && !includeHidden} title={batchScopePending ? pendingScopeMessage : batchBusy ? "批量修改保存中" : !batchGroupValid ? "请选择有效的分组后再应用" : batchHiddenCount > 0 && !includeHidden ? "请先确认包含筛选外联系人" : undefined}>{batchBusy ? "保存中…" : "应用到所选联系人"}</button>
                </div>
            </div>
        </LvctDialog>
    {/if}

    {#if batchOrgOpen}
        <LvctDialog title={`批量加入组织 · ${batchOrgTargets.length} 人`} onClose={closeBatchOrganization}>
            <div class="lvct-form">
                <p>已固定{batchOrgScopeLabel}的 {batchOrgTargets.length} 人，包含筛选外 {batchOrgHiddenCount} 人。将为每人登记一条“在职/当前”组织关系；已有同组织当前关系会由服务层幂等核实，不会重复创建。</p>
                {#if batchOrgScopePending}<p role="status">{pendingScopeMessage}</p>{/if}
                {#if batchOrgHiddenCount > 0}
                    <label><input type="checkbox" bind:checked={batchOrgIncludeHidden} disabled={batchOrgBusy || Boolean(batchOrgIntent)} />确认包含筛选外 {batchOrgHiddenCount} 人</label>
                {/if}
                <details><summary>核对目标联系人</summary>{#each batchOrgTargets as person (person.itemId)}<p>{person.name} · {person.docId} · {person.itemId}</p>{/each}</details>
                {#if batchOrgIntent}<p role="status">本批次已固定组织「{batchOrgIntent.name}」 · {batchOrgIntent.docId}。重新读取保留原联系人与失败项；改为其他组织请取消后重新建立批次。</p>{/if}
                {#if batchOrgLoading}
                    <p class="lvct-people__batch-hint" role="status" aria-live="polite">正在读取组织列表…</p>
                {:else if batchOrgCandidates.length > 0 || batchOrgDocId}
                    <label class="lvct-form__item">
                        <span>目标组织</span>
                        <select class="b3-select" value={batchOrgDocId} onchange={changeBatchOrganization} disabled={batchOrgBusy || Boolean(batchOrgIntent) || !batchOrgDirectoryVerified}>
                            <option value="">请选择组织</option>
                            {#if batchOrgDocId && !batchOrgCandidates.some((organization) => organization.docId === batchOrgDocId)}<option value={batchOrgDocId} disabled>{batchOrgIntent?.name ?? "原目标组织"}（待核实） · {batchOrgDocId}</option>{/if}
                            {#each batchOrgCandidates as organization (organization.docId)}
                                <option value={organization.docId} disabled={organization.archived}>{organization.name}{batchOrgCandidates.filter((candidate) => candidate.name === organization.name).length > 1 ? ` · ${organization.docId}` : ""}{organization.archived ? "（已归档）" : ""}</option>
                            {/each}
                        </select>
                    </label>
                {:else}
                    <ViewState compact icon="＋" title="还没有组织" description="先新建一个组织，再为选中的联系人登记成员关系。" />
                {/if}
                {#if batchOrgError}<div class="lvct-form__error" role="alert" tabindex="-1" bind:this={batchOrgResultElement}>{batchOrgError}</div>{/if}
                {#if batchOrgResult}<p role="status" tabindex="-1" bind:this={batchOrgResultElement}>{batchOrgResult}</p>{/if}
                {#if batchOrgFailed.length > 0}
                    <details open>
                        <summary>失败明细（{batchOrgFailed.length} 人）</summary>
                        {#each batchOrgFailed as entry (entry.person.itemId)}<p>{entry.person.name}：{entry.message}</p>{/each}
                    </details>
                {/if}
                <div class="lvct-form__actions">
                    <button class="b3-button b3-button--cancel" onclick={closeBatchOrganization} disabled={batchOrgBusy}>取消</button>
                    {#if onCreateOrganization}
                        <button class="b3-button b3-button--outline" onclick={() => void createBatchOrganization()} disabled={batchOrgBusy || batchOrgLoading || Boolean(batchOrgIntent)} title={batchOrgIntent ? "本批次已固定原组织，改目标请取消后重新建立批次" : undefined}>新建组织</button>
                    {/if}
                    {#if onLoadOrgCandidates}
                        <button class="b3-button b3-button--outline" onclick={() => void reloadBatchOrganizations()} disabled={batchOrgBusy || batchOrgLoading}>重新读取组织</button>
                    {/if}
                    <button class="b3-button" onclick={() => void runBatchOrganization()} disabled={batchOrgBusy || batchOrgLoading || batchOrgScopePending || !batchOrgTargetAvailable || batchOrgHiddenCount > 0 && !batchOrgIncludeHidden} title={batchOrgScopePending ? pendingScopeMessage : undefined}>
                        {batchOrgBusy ? "加入中…" : batchOrgFailed.length > 0 ? "重试失败项" : "加入所选组织"}
                    </button>
                </div>
            </div>
        </LvctDialog>
    {/if}

    {#if dupOpen}
        <LvctDialog title={`重复候选 · ${duplicatePairs.length} 组`} wide onClose={() => (dupOpen = false)}>
            <div class="lvct-form">
                <p class="ft__smaller ft__on-surface">
                    匹配规则：电话去格式后纯数字比较（不猜测补全国家码）、邮箱忽略大小写、姓名同名。
                    同名不等同同人；查看候选零写入，是否合并由你手动编辑决定。
                </p>
                {#if duplicatePairsCapped}
                    <p class="ft__smaller lvct-text-danger" role="status">结果已达到 {DUPLICATE_PAIRS_LIMIT} 组展示上限，可能还有更多；请先用姓名、电话或邮箱搜索缩小名册范围，再重新打开整理。</p>
                {/if}
                {#if duplicatePairs.length === 0}
                    <ViewState compact icon="✓" title="没有发现疑似重复" description="当前名册没有按规则命中的候选组合。" />
                {:else}
                    {#each duplicatePairs as pair (pair.a.itemId + "::" + pair.b.itemId)}
                        <div class="lvct-dup__pair">
                            <div class="lvct-dup__reasons">
                                {#each pair.reasons as reason (reason.kind)}
                                    <span class="lvct-chip lvct-chip--group">{reason.label}</span>
                                {/each}
                            </div>
                            <div class="lvct-dup__side">
                                <b>{pair.a.name}</b>
                                <small>{pair.a.phone || "—"} · {pair.a.email || "—"} · {pair.a.group || "无分组"}</small>
                                <button class="b3-button b3-button--outline" onclick={() => { dupOpen = false; onOpenDetail(pair.a); }}>查看 {pair.a.name}</button>
                            </div>
                            <div class="lvct-dup__side">
                                <b>{pair.b.name}</b>
                                <small>{pair.b.phone || "—"} · {pair.b.email || "—"} · {pair.b.group || "无分组"}</small>
                                <button class="b3-button b3-button--outline" onclick={() => { dupOpen = false; onOpenDetail(pair.b); }}>查看 {pair.b.name}</button>
                            </div>
                        </div>
                    {/each}
                {/if}
            </div>
        </LvctDialog>
    {/if}

    {#if completing}
        <LvctDialog title="逐个补录资料" wide onClose={() => (completing = false)}>
            <ProfileCompletionDialog
                {i18n}
                {settings}
                people={completionPeople}
                scopeLabel="全部筛选"
                onSaved={() => refresh()}
                onClose={() => {
                    completing = false;
                    refresh();
                }}
            />
        </LvctDialog>
    {/if}
</div>
