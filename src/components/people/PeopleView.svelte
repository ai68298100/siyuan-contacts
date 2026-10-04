<script lang="ts">
    /** 联系人视图：名册缓存 + 客户端过滤/分页 + 卡片/表格双形态；详情弹窗由 Workbench 统一承载 */
    import { batchUpdateContacts, filterContacts, listContactPage, PAGE_SIZE, PRESET_GROUPS, removeContacts } from "../../services/contacts";
    import { profileText } from "../../domain/people-profiles";
    import { onDestroy, tick } from "svelte";
    import { exportVcfText } from "../../services/vcard";
    import { nextBirthday } from "../../domain/occasions";
    import type { ContactSummary } from "../../domain/person";
    import type { WritableContactField } from "../../domain/contact-write.ts";
    import type { ContactsSettings } from "../../domain/model";
    import { DEFAULT_VIEW_PREFERENCES, normalizeTableColumns, PEOPLE_TABLE_COLUMNS } from "../../domain/preferences";
    import type { PeopleTableColumn, ViewPreferences } from "../../domain/preferences";
    import { applyPeopleFilters, EMPTY_PEOPLE_FILTER, isExtraFilterActive, matchTags } from "../../domain/people-filters";
    import type { PeopleFilterState } from "../../domain/people-filters";
    import { findDuplicatePairs } from "../../domain/duplicate-check";
    import type { DuplicatePair } from "../../domain/duplicate-check";
    import { findSavedViewByName, missingTags, normalizeSavedViews } from "../../domain/saved-views";
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
        createRequested = 0,
        onClearFocus,
        onOpenDetail,
        activePersonId = "",
        onOrderChange,
        onOpenPersonDoc,
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
        createRequested?: number;
        onClearFocus?: () => void;
        onOpenDetail: (person: ContactSummary) => void;
        activePersonId?: string;
        onOrderChange?: (people: ContactSummary[]) => void;
        onOpenPersonDoc?: (docId: string) => void;
        onPreferencesChange: (preferences: ViewPreferences) => Promise<ViewPreferences>;
        /** B09-1：移动端工具栏收纳（常驻搜索/视图切换/新建，其余收进底部弹层） */
        isMobile?: boolean;
    } = $props();
    const text = $derived.by(() => (key: string, fallback: string) => translateText(i18n, key, fallback));

    let people: ContactSummary[] = $state([]);
    let loading: boolean = $state(true);
    let errorText: string = $state("");
    let searchText: string = $state("");
    $effect(() => { searchText = externalSearch; });
    $effect(() => { if (createRequested > 0) adding = true; });
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
    // svelte-ignore state_referenced_locally
    let sortMode: "name" | "group" | "birthday" | "recent" = $state(initialSort);
    let recent: Record<string, { occurredAt: number; localDate: string }> = $state({});
    let recentGeneration = 0;
    let recentError = $state("");
    // svelte-ignore state_referenced_locally
    let viewMode: "cards" | "table" = $state(preferences.peopleView === "table" ? "table" : "cards");
    // svelte-ignore state_referenced_locally
    let tableColumns: PeopleTableColumn[] = $state(normalizeTableColumns(preferences.tableColumns));
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
        viewMode = preferences.peopleView === "table" ? "table" : "cards";
        tableColumns = normalizeTableColumns(preferences.tableColumns);
    });

    async function persistPreferences(next: ViewPreferences) {
        prefError = "";
        try {
            await onPreferencesChange(next);
        } catch (error) {
            prefError = error instanceof Error ? error.message : String(error);
        }
    }

    function setViewMode(mode: "cards" | "table") {
        if (viewMode === mode) return;
        viewMode = mode;
        void persistPreferences({ ...preferences, peopleView: mode === "table" ? "table" : "card" });
    }

    function toggleColumn(key: PeopleTableColumn, visible: boolean) {
        const next = visible
            ? [...tableColumns, key]
            : tableColumns.filter((column) => column !== key);
        tableColumns = normalizeTableColumns(next);
        void persistPreferences({ ...preferences, tableColumns });
    }

    function moveColumn(key: PeopleTableColumn, offset: -1 | 1) {
        const index = tableColumns.indexOf(key);
        const target = index + offset;
        if (index < 0 || target < 0 || target >= tableColumns.length) return;
        const next = [...tableColumns];
        next.splice(index, 1);
        next.splice(target, 0, key);
        tableColumns = next;
        void persistPreferences({ ...preferences, tableColumns });
    }

    function resetDisplayPreferences() {
        viewMode = "cards";
        tableColumns = [...DEFAULT_VIEW_PREFERENCES.tableColumns];
        colMenuOpen = false;
        void persistPreferences({
            ...preferences,
            peopleView: DEFAULT_VIEW_PREFERENCES.peopleView,
            tableColumns: [...DEFAULT_VIEW_PREFERENCES.tableColumns],
        });
    }

    // 列设置浮层：fixed 定位原语（B02）——absolute 面板会被滚动祖先裁剪，宿主菜单同样用 fixed
    $effect(() => {
        const wrap = colMenuWrap;
        const panel = colMenuPanel;
        if (!colMenuOpen || !wrap || !panel) return;
        return attachPopover(panel, wrap, () => (colMenuOpen = false));
    });
    let adding: boolean = $state(false);
    let importing: boolean = $state(false);
    let vcarding: boolean = $state(false);
    // C03 串行补录：对当前筛选列表逐个补缺失字段
    let completing: boolean = $state(false);
    let completionPeople: ContactSummary[] = $state([]);
    // B09-1：移动端「筛选与整理」底部弹层
    let mobileSheetOpen: boolean = $state(false);
    let batchOpen: boolean = $state(false);
    let batchBusy: boolean = $state(false);
    let exportingSelected: boolean = $state(false);
    let batchError: string = $state("");
    let batchGroup: string = $state("__keep");
    let batchTagsText: string = $state("");
    let batchFailedFieldsByItem: Record<string, readonly WritableContactField[]> = $state({});
    let batchTargets: ContactSummary[] = $state([]);
    let batchAnchor = $state("");
    let batchHiddenCount = $state(0);
    let includeHidden = $state(false);
    let batchResult = $state("");
    let batchResultElement: HTMLElement | undefined = $state();
    let peopleAlive = true;
    onDestroy(() => { peopleAlive = false; refreshGeneration += 1; recentGeneration += 1; rosterLoadGeneration += 1; });
    const guardedClose = useCloseGuard({
        busy: () => batchBusy || exportingSelected,
        dirty: () => batchOpen && (batchGroup !== "__keep" || !!batchTagsText.trim()),
        changes: () => [text("guardBatchDraft", "批量编辑尚未应用")],
    });
    function closeBatch() {
        void guardedClose(() => (batchOpen = false));
    }
    let selectedIds: string[] = $state([]);
    let selectedScope = $state<"manual" | "page" | "filtered">("manual");
    let batchScopeLabel = $state("");
    const selectionScopeLabel = $derived(selectedScope === "page" ? "当前页" : selectedScope === "filtered" ? "全部筛选" : "手动选中");
    let visibleCount: number = $state(PAGE_SIZE);
    let rosterTotal: number = $state(0);
    let rosterPage: number = $state(0);
    let rosterHasMore: boolean = $state(false);
    let rosterLoadingMore: boolean = $state(false);
    let rosterLoadError: string = $state("");
    let rosterLoadGeneration = 0;

    const groups = $derived.by(() => {
        const set = new Set<string>();
        for (const person of people) {
            if (person.group) set.add(person.group);
        }
        return [...set].sort();
    });
    const tags = $derived([...new Set(people.flatMap((person) => person.tags))].sort((a, b) => a.localeCompare(b, "zh-CN")));

    const filtered = $derived.by(() => {
        const focus = new Set(focusIds);
        const result = filterContacts(people, searchText, groupFilter)
            .filter((person) => !focusLabel || focus.has(person.itemId))
            .filter((person) => matchTags(person, tagFilter, extraFilter.tagMatch));
        const final = applyPeopleFilters(result, recent, extraFilter);
        const birthdayDays = new Map(final.map((person) => [person.itemId, nextBirthday(person.birthday, person.isLunar)?.daysUntil ?? Infinity]));
        final.sort((a, b) => {
            if (sortMode === "group") return a.group.localeCompare(b.group, "zh-CN") || a.name.localeCompare(b.name, "zh-CN");
            if (sortMode === "birthday") return (birthdayDays.get(a.itemId) ?? Infinity) - (birthdayDays.get(b.itemId) ?? Infinity) || a.name.localeCompare(b.name, "zh-CN");
            if (sortMode === "recent") return (recent[b.docId]?.occurredAt ?? -Infinity) - (recent[a.docId]?.occurredAt ?? -Infinity) || a.name.localeCompare(b.name, "zh-CN");
            return a.name.localeCompare(b.name, "zh-CN");
        });
        return final;
    });
    const visible = $derived(filtered.slice(0, visibleCount));
    $effect(() => { onOrderChange?.(filtered); });

    // 生效条件行（F03）：搜索/分组/标签与更多筛选的可视化，可单项清除
    type ConditionChip = { key: string; label: string };
    const conditionChips: ConditionChip[] = $derived.by(() => {
        const chips: ConditionChip[] = [];
        if (activeViewName) chips.push({ key: "view", label: `视图：${activeViewName}` });
        if (searchText.trim()) chips.push({ key: "search", label: `搜索「${searchText.trim()}」` });
        if (groupFilter) chips.push({ key: "group", label: `分组：${groupFilter}` });
        if (tagFilter.length > 0) chips.push({ key: "tags", label: `标签${extraFilter.tagMatch === "any" ? "（任一）" : ""}：${tagFilter.join(" / ")}` });
        if (extraFilter.recentFrom || extraFilter.recentTo) chips.push({ key: "recentRange", label: `最近互动 ${extraFilter.recentFrom || "早期"} ~ ${extraFilter.recentTo || "至今"}` });
        if (extraFilter.neverContacted) chips.push({ key: "neverContacted", label: "从未联系" });
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
        if (key === "search") searchText = "";
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
        return attachPopover(panel, wrap, () => (moreOpen = false));
    });

    // 视图浮层：fixed 定位原语（B02）——absolute 面板会被滚动祖先裁剪，宿主菜单同样用 fixed
    $effect(() => {
        const wrap = viewsMenuWrap;
        const panel = viewsMenuPanel;
        if (!viewsOpen || !wrap || !panel) return;
        return attachPopover(panel, wrap, () => (viewsOpen = false));
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
        try {
            await onPreferencesChange({ ...preferences, savedViews: next });
            return true;
        } catch (error) {
            prefError = error instanceof Error ? error.message : String(error);
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
    const selectedPeople = $derived(people.filter((person) => selectedIds.includes(person.itemId)));
    const hiddenSelectionCount = $derived(selectedPeople.filter((person) => !filtered.some((item) => item.itemId === person.itemId)).length);
    const allVisibleSelected = $derived(visible.length > 0 && visible.every((person) => selectedIds.includes(person.itemId)));

    /* FUNC-01.7-a 请求代际：revision 连续变化时只有最新一次刷新落位，乱序响应丢弃 */
    let refreshGeneration = 0;
    /* B12：人物 → 单位显示串（来自 org-membership 成员索引；加载失败降级为空） */
    async function refresh() {
        const request = ++refreshGeneration;
        rosterLoadGeneration += 1;
        const pageGeneration = rosterLoadGeneration;
        loading = true;
        errorText = "";
        rosterLoadError = "";
        rosterLoadingMore = false;
        rosterPage = 0;
        rosterTotal = 0;
        rosterHasMore = false;
        try {
            const next = await listContactPage(settings, 1, PAGE_SIZE);
            if (request !== refreshGeneration) return; /* 旧响应不得覆盖新数据 */
            people = next.people;
            rosterPage = next.page;
            rosterTotal = next.total;
            rosterHasMore = next.hasMore;
            const available = new Set(people.map((person) => person.itemId));
            selectedIds = selectedIds.filter((itemId) => available.has(itemId));
            loading = false;
            void loadRemainingRosterPages(request, pageGeneration);
        } catch (error) {
            if (request !== refreshGeneration) return;
            /* 刷新失败保留旧列表内容，仅以横幅提示（可再次刷新重试） */
            errorText = error instanceof Error ? error.message : String(error);
            loading = false;
        }
    }

    async function loadRemainingRosterPages(request: number, expectedGeneration = rosterLoadGeneration) {
        if (!rosterHasMore || expectedGeneration !== rosterLoadGeneration) return;
        rosterLoadingMore = true;
        rosterLoadError = "";
        try {
            while (rosterHasMore && request === refreshGeneration && expectedGeneration === rosterLoadGeneration && peopleAlive) {
                const next = await listContactPage(settings, rosterPage + 1, PAGE_SIZE);
                if (request !== refreshGeneration || expectedGeneration !== rosterLoadGeneration || !peopleAlive) return;
                if (next.people.length === 0 && next.hasMore) throw new Error("联系人分页返回空页但仍有后续数据，已停止继续读取");
                const known = new Set(people.map((person) => person.itemId));
                const duplicate = next.people.find((person) => known.has(person.itemId));
                if (duplicate) throw new Error(`联系人分页出现重复行「${duplicate.name}」，已停止继续读取以避免重复展示`);
                people = [...people, ...next.people];
                rosterPage = next.page;
                rosterTotal = Math.max(rosterTotal, next.total);
                rosterHasMore = next.hasMore;
                const available = new Set(people.map((person) => person.itemId));
                selectedIds = selectedIds.filter((itemId) => available.has(itemId));
            }
        } catch (error) {
            if (request === refreshGeneration && expectedGeneration === rosterLoadGeneration) {
                rosterLoadError = error instanceof Error ? error.message : String(error);
            }
        } finally {
            if (expectedGeneration === rosterLoadGeneration) rosterLoadingMore = false;
        }
    }

    function stopRosterLoading() {
        rosterLoadGeneration += 1;
        rosterLoadingMore = false;
    }

    function resumeRosterLoading() {
        if (!rosterHasMore || rosterLoadingMore) return;
        void loadRemainingRosterPages(refreshGeneration, ++rosterLoadGeneration);
    }

    $effect(() => {
        revision;
        void refresh();
        /* FUNC-01.7-a 请求代际：recent 读取无共享缓存去重，须自行挡乱序响应 */
        const request = ++recentGeneration;
        void loadRecentInteractions().then((value) => {
            if (request !== recentGeneration) return;
            recent = value;
            recentError = "";
        }).catch((error) => {
            if (request !== recentGeneration) return;
            recentError = error instanceof Error ? error.message : String(error);
        });
    });

    function toggleTag(tag: string) {
        tagFilter = tagFilter.includes(tag) ? tagFilter.filter((item) => item !== tag) : [...tagFilter, tag];
        visibleCount = PAGE_SIZE;
    }

    function toggleSelected(itemId: string, selected: boolean) {
        selectedScope = "manual";
        selectedIds = selected
            ? [...new Set([...selectedIds, itemId])]
            : selectedIds.filter((id) => id !== itemId);
    }

    function toggleAllVisible(selected: boolean) {
        selectedScope = "manual";
        const visibleIds = new Set(visible.map((person) => person.itemId));
        selectedIds = selected
            ? [...new Set([...selectedIds, ...visibleIds])]
            : selectedIds.filter((id) => !visibleIds.has(id));
    }

    function parseTags(value: string): string[] {
        return [...new Set(value.split(/[，,、\s]+/).map((tag) => tag.trim()).filter((tag) => tag.length > 0))];
    }

    function selectAllFiltered(): void {
        if (batchBusy || exportingSelected) return;
        selectedIds = filtered.map((person) => person.itemId);
        selectedScope = "filtered";
    }

    function selectVisibleScope(): void {
        if (batchBusy || exportingSelected) return;
        selectedIds = visible.map((person) => person.itemId);
        selectedScope = "page";
    }

    function openBatch(): void {
        if (batchBusy || exportingSelected) return;
        batchTargets = selectedPeople.map((person) => ({ ...person, tags: [...person.tags] }));
        batchScopeLabel = selectionScopeLabel;
        batchAnchor = JSON.stringify([settings.avId, settings.dbBlockId, settings.fieldMap]);
        batchHiddenCount = hiddenSelectionCount;
        includeHidden = false;
        batchError = "";
        batchFailedFieldsByItem = {};
        batchOpen = true;
    }

    async function runBatchUpdate(onlyFailed = false) {
        if (batchBusy) return;
        if (batchHiddenCount > 0 && !includeHidden) { batchError = "请确认包含筛选外的已选联系人，或取消后重新选择范围"; return; }
        if (batchAnchor !== JSON.stringify([settings.avId, settings.dbBlockId, settings.fieldMap])) { batchError = "数据库锚点已变化，请取消后重新核对目标"; return; }
        const tagsToAdd = parseTags(batchTagsText);
        const group = batchGroup === "__keep" ? undefined : batchGroup === "__clear" ? "" : batchGroup;
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
            batchGroup = "__keep";
            batchTagsText = "";
            batchFailedFieldsByItem = {};
            selectedIds = [];
            batchResult = `批量修改已核实：${targetPeople.length} 人，字段逐项核实完成`;
            await tick();
            if (peopleAlive) batchResultElement?.focus();
        } catch (error) {
            if (!peopleAlive) return;
            batchError = error instanceof Error ? error.message : String(error);
            await tick();
            if (peopleAlive) batchResultElement?.focus();
        } finally {
            if (peopleAlive) batchBusy = false;
        }
    }

    async function exportSelected() {
        if (batchBusy || exportingSelected || selectedIds.length === 0) return;
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
            errorText = error instanceof Error ? error.message : String(error);
        } finally {
            exportingSelected = false;
        }
    }

    async function removeSelected() {
        if (batchBusy || exportingSelected || selectedIds.length === 0) return;
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
            batchError = error instanceof Error ? error.message : String(error);
        } finally {
            batchBusy = false;
        }
    }
</script>

<div class="lvct-people">
    <!-- B09-1：工具栏控件 snippet 化——桌面原位渲染；移动端收进「筛选与整理」底部弹层（互斥渲染，popover 单挂载） -->
    {#snippet viewMenuControl()}
        <span id="lvct-people-viewsmenu" bind:this={viewsMenuWrap} style="position:relative; display:inline-flex">
            <button class="b3-button b3-button--outline" aria-label={text("peopleViews", "视图")} aria-expanded={viewsOpen} onclick={() => (viewsOpen = !viewsOpen)}>
                <Bookmark size={16}/>{activeViewName ? `${text("peopleViews", "视图")}：${activeViewName}` : text("peopleViews", "视图")}
            </button>
            {#if viewsOpen}
                <div class="lvct-people__moremenu lvct-people__viewsmenu" bind:this={viewsMenuPanel} role="menu" aria-label="保存的视图">
                    {#if localViews.length === 0}
                        <p class="lvct-people__viewsmenu-empty">还没有保存的视图。设置筛选条件后，点下方「保存当前筛选为视图」。</p>
                    {/if}
                    {#each localViews as view (view.id)}
                        <div class="lvct-people__viewsmenu-item" role="menuitem">
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
        <select class="b3-select" bind:value={groupFilter} onchange={() => (visibleCount = PAGE_SIZE)}>
            <option value="">{text("peopleAllGroups", "全部分组")}</option>
            {#each groups as group (group)}
                <option value={group}>{group}</option>
            {/each}
        </select>
        <select class="b3-select" bind:value={sortMode} aria-label={text("peopleSortLabel", "排序方式")} onchange={() => (visibleCount = PAGE_SIZE)}>
            <option value="name">{text("peopleSortName", "按姓名")}</option>
            <option value="group">{text("peopleSortGroup", "按分组")}</option>
            <option value="birthday">{text("peopleSortBirthday", "按生日临近")}</option>
            <option value="recent">{text("peopleSortRecent", "按最近互动")}</option>
        </select>
        <span id="lvct-people-moremenu" bind:this={moreMenuWrap} style="position:relative; display:inline-flex">
            <button
                class="b3-button b3-button--outline"
                aria-expanded={moreOpen}
                onclick={() => (moreOpen = !moreOpen)}
            >
                <SlidersHorizontal size={16}/>{text("peopleMoreFilters", "更多筛选")}{isExtraFilterActive(extraFilter) ? " ·" : ""}
            </button>
            {#if moreOpen}
                <div class="lvct-people__moremenu" bind:this={moreMenuPanel} role="group" aria-label="组合筛选">
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
                            <input type="date" class="b3-text-field fn__block" bind:value={extraFilter.recentFrom} aria-label="最近互动起始日期" />
                            <span>~</span>
                            <input type="date" class="b3-text-field fn__block" bind:value={extraFilter.recentTo} aria-label="最近互动截止日期" />
                        </div>
                    </div>
                    <label class="lvct-people__moremenu-row">
                        <input type="checkbox" bind:checked={extraFilter.neverContacted} />
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
                                disabled={filtered.length === 0}
                                onclick={() => { completionPeople = filtered.map((person) => ({ ...person, tags: [...person.tags] })); completing = true; }}
                            >逐个补录（{filtered.length}）</button>
                        {/if}
                    </div>
                </div>
            {/if}
        </span>
    {/snippet}
    {#snippet actionControls()}
        <button class="b3-button b3-button--outline" onclick={() => (dupOpen = true)}>
            {text("peopleCleanup", "整理")}{duplicatePairs.length > 0 ? ` ·${duplicatePairs.length}` : ""}
        </button>
        <button class="b3-button b3-button--outline" onclick={() => (importing = true)}><FolderInput size={16}/>{text("peopleImportDocs", "导入已有文档")}</button>
        <button class="b3-button b3-button--outline" onclick={() => (vcarding = true)}><ContactRound size={16}/>{text("peopleVcard", "vCard 导入/导出")}</button>
    {/snippet}
    <div class="lvct-people__toolbar fn__flex">
        {#if !isMobile}
            {@render viewMenuControl()}
            <input
                class="b3-text-field fn__flex-1"
                type="text"
                placeholder={text("peopleSearchPlaceholder", "搜索姓名/电话/微信/邮箱/标签…")}
                bind:value={searchText}
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
                        aria-label="表格列设置"
                        title="表格列设置"
                        onclick={() => (colMenuOpen = !colMenuOpen)}
                    ><Columns3 size={16}/>{text("peopleColumnSettings", "列设置")}</button>
                    {#if colMenuOpen}
                        <div class="lvct-people__colmenu" bind:this={colMenuPanel} role="group" aria-label="表格列显隐与顺序">
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
                                        <button type="button" aria-label={`上移${columnLabel(key)}列`} disabled={tableColumns.indexOf(key) <= 0} onclick={() => moveColumn(key, -1)}>↑</button>
                                        <button type="button" aria-label={`下移${columnLabel(key)}列`} disabled={tableColumns.indexOf(key) < 0 || tableColumns.indexOf(key) >= tableColumns.length - 1} onclick={() => moveColumn(key, 1)}>↓</button>
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
            {@render actionControls()}
        {/if}
        {#if !isMobile}
            <button class="b3-button b3-button--text" onclick={() => (adding = true)}><UserPlus size={16}/>{text("peopleCreate", "新建联系人")}</button>
        {:else}
            <button class="b3-button b3-button--text" onclick={() => (adding = true)} aria-label={text("peopleCreate", "新建联系人")}><UserPlus size={16}/>{text("peopleCreate", "新建")}</button>
            <button
                class="b3-button b3-button--outline"
                aria-label={text("peopleMobileTools", "筛选与整理")}
                aria-expanded={mobileSheetOpen}
                onclick={() => (mobileSheetOpen = true)}
            ><SlidersHorizontal size={16}/>{text("peopleMobileTools", "筛选与整理")}{isExtraFilterActive(extraFilter) || duplicatePairs.length > 0 ? " ·" : ""}</button>
        {/if}
    </div>
    {#if isMobile && mobileSheetOpen}
        <div class="lvct-dialog-mask" role="presentation" onclick={(event) => { if (event.target === event.currentTarget) mobileSheetOpen = false; }}></div>
        <div class="lvct-sheet" role="dialog" aria-label="筛选与整理">
            <div class="lvct-sheet__bar">
                <b>{text("peopleMobileTools", "筛选与整理")}</b>
                <button type="button" class="b3-button b3-button--text" onclick={() => (mobileSheetOpen = false)}>{text("dashCollapse", "收起")}</button>
            </div>
            <div class="lvct-sheet__body">
                {@render viewMenuControl()}
                {@render filterControls()}
                {@render actionControls()}
                <button class="b3-button b3-button--outline" onclick={() => { mobileSheetOpen = false; adding = true; }}><UserPlus size={16}/>{text("peopleCreate", "新建联系人")}</button>
            </div>
        </div>
    {/if}
    {#if recentError}<div class="lvct-form__error" role="alert">最近互动读取失败：{recentError}</div>{/if}
    {#if people.some((person) => person.aliasProfile?.state === "unknown")}
        <p role="status">别名读取尚未核实，可按姓名查找；未把失败解释为无别名。</p>
        <button class="b3-button b3-button--text" disabled={loading} onclick={() => void refresh()}>重新读取别名</button>
    {/if}
    {#if people.some((person) => person.profile?.affiliations.state === "unknown" || person.profile?.relationship.state === "unknown")}
        <p role="status">部分组织或称谓资料尚未核实。原有联系人仍可查看；相关筛选仅使用已核实的值。</p>
        <button class="b3-button b3-button--text" disabled={loading} onclick={() => void refresh()}>重新读取三项资料</button>
    {/if}
    {#if prefError}<div class="lvct-form__error" role="alert">显示偏好保存失败：{prefError}</div>{/if}

    {#if viewHint}<div class="lvct-people__viewhint" role="status">{viewHint}</div>{/if}

    {#if conditionChips.length > 0}
        <div class="lvct-people__conditions" aria-label="生效筛选条件">
            <span class="ft__smaller ft__on-surface">生效条件：</span>
            {#each conditionChips as chip (chip.key)}
                <button type="button" class="lvct-people__condition" title="点击清除该条件" onclick={() => clearCondition(chip.key)}>
                    {chip.label} ×
                </button>
            {/each}
            <span class="ft__smaller ft__on-surface">· 共 {filtered.length} 人</span>
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
            <button class="b3-button b3-button--outline" onclick={openBatch} disabled={batchBusy || exportingSelected}>批量编辑</button>
            <button class="b3-button b3-button--outline" onclick={exportSelected}>导出 vCard</button>
            <button class="b3-button b3-button--cancel lvct-people__remove" onclick={removeSelected} disabled={batchBusy}>从人脉移除</button>
            <button class="b3-button b3-button--text" onclick={() => (selectedIds = [])} disabled={batchBusy || exportingSelected}>取消选择</button>
        </div>
    {/if}

    <div class="lvct-people__actions" role="group" aria-label="选择联系人范围">
        <button class="b3-button b3-button--text" disabled={batchBusy || exportingSelected || visible.length === 0} onclick={selectVisibleScope}>选择当前页（{visible.length} 人）</button>
        <button class="b3-button b3-button--text" disabled={batchBusy || exportingSelected || rosterHasMore || rosterLoadError !== "" || filtered.length === 0} title={rosterHasMore || rosterLoadError ? "名册尚未完整读取，完成读取后再选择全部筛选" : undefined} onclick={selectAllFiltered}>选择全部筛选（{filtered.length} 人）</button>
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
        <div class="lvct-form__error">加载失败：{errorText}</div>
    {:else if loading}
        <div class="lvct-people__skeleton" aria-busy="true" aria-label="联系人加载中">
            {#each Array(6) as _, index (index)}
                <div class="lvct-people__skeleton-card">
                    <span class="lvct-skeleton lvct-skeleton--avatar"></span>
                    <span class="lvct-skeleton lvct-skeleton--name"></span>
                    <span class="lvct-skeleton lvct-skeleton--meta"></span>
                </div>
            {/each}
        </div>
    {:else if filtered.length === 0}
        <div class="lvct-empty">
            <div class="lvct-empty__icon" aria-hidden="true">♧</div>
            <b>{people.length === 0 && rosterTotal === 0 ? "还没有联系人" : rosterHasMore ? "正在读取更多联系人" : "当前筛选下没有联系人"}</b>
            <p>{people.length === 0 && rosterTotal === 0 ? "从新建第一个联系人开始，也可以收编笔记或导入 vCard。" : rosterHasMore ? `已读取 ${people.length} / ${rosterTotal} 人，当前页没有命中，读取完成后再判断。` : "换个关键词、分组或标签试试。"}</p>
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
        <div class="lvct-people__progress" role="status" aria-live="polite">
            已加载 {people.length} / {rosterTotal} 人
            {#if rosterLoadingMore}
                · 正在读取后续联系人
                <button type="button" class="b3-button b3-button--text" onclick={stopRosterLoading}>停止继续读取</button>
            {:else if rosterLoadError}
                · 后续读取失败：{rosterLoadError}
                <button type="button" class="b3-button b3-button--text" onclick={resumeRosterLoading}>重试后续读取</button>
            {:else if rosterHasMore}
                · 尚未读取完
                <button type="button" class="b3-button b3-button--text" onclick={resumeRosterLoading}>继续读取</button>
            {:else}
                · 已读取完整名册
            {/if}
        </div>
        <div class="lvct-people__cards">
            {#each visible as person (person.itemId)}
                <PersonCard
                    {person}
                    selected={selectedIds.includes(person.itemId)}
                    active={activePersonId === person.itemId}
                    recent={recent[person.docId]}
                    {onOpenPersonDoc}
                    onToggleSelected={(selected) => toggleSelected(person.itemId, selected)}
                    onOpen={onOpenDetail}
                />
            {/each}
        </div>
    {:else}
        <div class="lvct-people__progress" role="status" aria-live="polite">
            已加载 {people.length} / {rosterTotal} 人
            {#if rosterLoadingMore}
                · 正在读取后续联系人
                <button type="button" class="b3-button b3-button--text" onclick={stopRosterLoading}>停止继续读取</button>
            {:else if rosterLoadError}
                · 后续读取失败：{rosterLoadError}
                <button type="button" class="b3-button b3-button--text" onclick={resumeRosterLoading}>重试后续读取</button>
            {:else if rosterHasMore}
                · 尚未读取完
                <button type="button" class="b3-button b3-button--text" onclick={resumeRosterLoading}>继续读取</button>
            {:else}
                · 已读取完整名册
            {/if}
        </div>
        <div class="lvct-people__table-wrap">
            <table class="b3-table">
                <thead>
                    <tr>
                        <th class="lvct-people__select-cell">
                            <input type="checkbox" aria-label="选择当前列表联系人" checked={allVisibleSelected} onchange={(event) => toggleAllVisible((event.currentTarget as HTMLInputElement).checked)} />
                        </th>
                        <th>{text("peopleName", "姓名")}</th>
                        {#each tableColumns as column (column)}<th>{columnLabel(column)}</th>{/each}
                    </tr>
                </thead>
                <tbody>
                    {#each visible as person (person.itemId)}
                        <tr tabindex="0" aria-label={`查看 ${person.name} 的详情`} class:lvct-people__row--active={activePersonId === person.itemId}
                            onclick={() => onOpenDetail(person)}
                            onkeydown={(event) => {
                                if (event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " ")) return;
                                event.preventDefault();
                                onOpenDetail(person);
                            }}>
                            <td class="lvct-people__select-cell">
                                <input
                                    type="checkbox"
                                    aria-label={`选择 ${person.name}`}
                                    checked={selectedIds.includes(person.itemId)}
                                    onclick={(event) => event.stopPropagation()}
                                    onchange={(event) => toggleSelected(person.itemId, (event.currentTarget as HTMLInputElement).checked)}
                                />
                            </td>
                            <td><b>{person.name}</b>{#if onOpenPersonDoc}<button type="button" class="lvct-people__open-doc" title={`打开 ${person.name} 的文档`} aria-label={`打开 ${person.name} 的文档`} onclick={(event) => { event.stopPropagation(); onOpenPersonDoc(person.docId); }}><ExternalLink size={16}/></button>{/if}</td>
                            {#each tableColumns as column (column)}
                                <td>
                                    {#if column === "group"}{person.group || "—"}
                                    {:else if column === "phone"}{person.phone || "—"}
                                    {:else if column === "wechat"}{person.wechat || "—"}
                                    {:else if column === "birthday"}{person.birthday ? `${person.birthday}${person.isLunar ? "（农历）" : ""}` : "—"}
                                    {:else if column === "recent"}{recent[person.docId]?.localDate ?? "—"}
                                    {:else if column === "org"}{profileText(person.profile, "work")}
                                    {:else if column === "school"}{profileText(person.profile, "education")}
                                    {:else if column === "relationship"}{profileText(person.profile, "relationship")}
                                    {:else}{person.tags.join(" · ") || "—"}{/if}
                                </td>
                            {/each}
                        </tr>
                    {/each}
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
                onCreated={() => refresh()}
                onClose={() => (adding = false)}
            />
        </LvctDialog>
    {/if}

    {#if importing}
        <LvctDialog title="导入已有文档为联系人" wide onClose={() => (importing = false)}>
            <ImportDialog
                {i18n}
                {settings}
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
                {#if batchHiddenCount > 0}<label><input type="checkbox" bind:checked={includeHidden} disabled={batchBusy} />确认包含筛选外 {batchHiddenCount} 人</label>{/if}
                <details><summary>核对目标文档</summary>{#each batchTargets as person (person.itemId)}<p>{person.name} · {person.docId} · {person.itemId}</p>{/each}</details>
                <p class="ft__smaller ft__on-surface">分组会覆盖所选联系人当前值；标签会追加到现有标签并自动去重。</p>
                <label class="lvct-form__item">
                    <span>统一分组</span>
                    <select class="b3-select fn__block" bind:value={batchGroup} disabled={batchBusy}>
                        <option value="__keep">保持不变</option>
                        <option value="__clear">清空分组</option>
                        {#each PRESET_GROUPS as group (group)}<option value={group}>{group}</option>{/each}
                        {#each groups.filter((group) => !PRESET_GROUPS.includes(group as typeof PRESET_GROUPS[number])) as group (group)}<option value={group}>{group}</option>{/each}
                    </select>
                </label>
                <label class="lvct-form__item">
                    <span>追加标签（空格/逗号分隔）</span>
                    <input class="b3-text-field fn__block" type="text" bind:value={batchTagsText} placeholder="重点 客户" disabled={batchBusy} />
                </label>
                {#if batchError}<div class="lvct-form__error" role="alert" tabindex="-1" bind:this={batchResultElement}>{batchError}</div>{/if}
                {#if Object.keys(batchFailedFieldsByItem).length > 0}
                    <div class="ft__smaller ft__on-surface">已有 {Object.keys(batchFailedFieldsByItem).length} 人存在失败字段，可只重试这些字段。</div>
                {/if}
                <div class="lvct-form__actions">
                    <button class="b3-button b3-button--cancel" onclick={closeBatch} disabled={batchBusy}>取消</button>
                    {#if Object.keys(batchFailedFieldsByItem).length > 0}
                        <button class="b3-button b3-button--outline" onclick={() => runBatchUpdate(true)} disabled={batchBusy}>{batchBusy ? "重试中…" : text("formRetryFailed", "核实并重试未完成字段")}</button>
                    {/if}
                    <button class="b3-button b3-button--text" onclick={() => runBatchUpdate()} disabled={batchBusy || batchHiddenCount > 0 && !includeHidden}>{batchBusy ? "保存中…" : "应用到所选联系人"}</button>
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
