<script lang="ts">
    import { requestErrorMessage } from "../../shared/error-presenter";
    /** B13.3 组织管理：组织列表/新建/成员维护（svelteDialog 直挂）。
     *  数据经 facade（listOrganizations/createOrganization/listOrganizationMembers/
     *  addOrganizationMember/removeOrganizationMember/listContacts），写入语义在 services/org。 */
    import { onDestroy, onMount, tick, untrack } from "svelte";
    import { toLocalDateKey } from "../../domain/interactions";
    import { translateText } from "../../domain/translation";
    import type { ContactsPluginFacade } from "../../types";
    import type { OrganizationWithMembers, OrganizationMember } from "../../services/org";
    import type { ContactSummary } from "../../domain/person";
    import ViewState from "../ViewState.svelte";
    import { useCloseGuard } from "../close-guard";
    import { orgMembershipStatusLabel, pageOrgMemberships } from "../../domain/org-membership";
    import type { OrgAffiliationKind, OrgMembership, OrgMembershipStatus } from "../../domain/org-membership";
    import type { OrgMembershipWriteReport } from "../../services/org-member-writes";
    import OrgMembershipResult from "./OrgMembershipResult.svelte";
    import OrgOperationRecovery from "./OrgOperationRecovery.svelte";
    import PersonPicker from "../people/PersonPicker.svelte";
    import type { PickerItem } from "../people/PersonPicker.svelte";
    import { subscribeDataChanged } from "../../libs/data-events";
    import { organizationOptionLabel } from "../../domain/organization-scan";
    import {
        buildOrganizationMemberCsv,
        buildOrganizationMemberTsv,
        filterOrganizationMemberExportRows,
    } from "../../domain/org-members-export";
    import type { OrganizationMemberExportRow } from "../../domain/org-members-export";
    import { copyPlainText } from "../../shared/clipboard";

    let {
        facade,
        i18n,
        onClose,
        onCreated,
        initialOrgDocId = "",
        onOpenPerson,
        onCreateOrganization,
        onEditOrganization,
        hostCloseChannel,
    }: {
        facade: ContactsPluginFacade;
        i18n?: Readonly<Record<string, string>>;
        onClose: () => void;
        /** 新建组织完成后通知宿主，供联系人表单刷新候选。 */
        onCreated?: (docId: string) => void;
        initialOrgDocId?: string;
        onOpenPerson?: (docId: string, orgDocId: string) => void;
        onCreateOrganization?: () => void;
        onEditOrganization?: (docId: string) => void;
        /** D-40：宿主 X/Esc/遮罩关闭经同一守卫路由，避免绕过未保存提示。 */
        hostCloseChannel?: { request?: (close: () => void) => void };
    } = $props();
    const text = $derived.by(() => (key: string, fallback: string, values?: Record<string, string | number>) =>
        translateText(i18n, key, fallback, values));

    let orgs: OrganizationWithMembers[] = $state([]);
    let currentOrgDocId: string = $state("");
    let members: OrganizationMember[] = $state([]);
    let activeMemberPersonDocIds: string[] = $state([]);
    let memberQuery = $state("");
    let memberStatus = $state<"all" | "active" | "former">("all");
    let memberOffset = $state(0);
    let memberPageSize = $state(20);
    let memberTotal = $state(0);
    let memberHasMore = $state(false);
    let memberAttemptOffset = 0;
    let loadedMemberOrgDocId = "";
    let memberSearchTimer: ReturnType<typeof setTimeout> | undefined;
    let showAddMember = $state(false);
    let expandedMemberId = $state("");
    let memberViewMode: "grid" | "list" = $state("grid");
    let selectedMemberIds = $state<string[]>([]);
    let batchOperating = $state(false);
    let batchActionError = $state("");
    let batchActionMessage = $state("");
    let batchRemoveConfirm = $state(false);

    const allCurrentPageSelected = $derived(
        members.length > 0 && members.every((m) => selectedMemberIds.includes(m.id))
    );

    function toggleSelectAllCurrentPage(checked: boolean) {
        if (checked) {
            const currentIds = new Set(selectedMemberIds);
            for (const m of members) currentIds.add(m.id);
            selectedMemberIds = Array.from(currentIds);
        } else {
            const pageIdSet = new Set(members.map((m) => m.id));
            selectedMemberIds = selectedMemberIds.filter((id) => !pageIdSet.has(id));
        }
    }

    function toggleMemberSelected(id: string, checked: boolean) {
        if (checked) {
            if (!selectedMemberIds.includes(id)) {
                selectedMemberIds = [...selectedMemberIds, id];
            }
        } else {
            selectedMemberIds = selectedMemberIds.filter((item) => item !== id);
        }
    }

    async function batchUpdateStatus(targetStatus: "active" | "former") {
        if (selectedMemberIds.length === 0 || busy || batchOperating) return;
        if (currentOrg?.archived && targetStatus === "active") {
            errorMessage = "组织已归档，不能恢复为在职成员";
            return;
        }
        batchOperating = true;
        batchActionError = "";
        batchActionMessage = "";
        try {
            const today = toLocalDateKey(new Date());
            const targetMembers = members.filter((m) => selectedMemberIds.includes(m.id));
            for (const m of targetMembers) {
                if (m.status === targetStatus) continue;
                const patch = {
                    status: targetStatus,
                    ...(targetStatus === "former" && !m.leftOn ? { leftOn: today } : {}),
                    ...(targetStatus === "active" ? { leftOn: "" } : {}),
                };
                await facade.updateOrganizationMember(m.id, patch, m);
            }
            batchActionMessage = `已将选中的 ${targetMembers.length} 位成员状态更新为「${targetStatus === "active" ? "在职/在读" : "已离开"}」`;
            selectedMemberIds = [];
            await loadOrgs(true);
        } catch (error) {
            batchActionError = requestErrorMessage(error);
        } finally {
            batchOperating = false;
        }
    }

    async function batchRemoveSelected() {
        if (selectedMemberIds.length === 0 || busy || batchOperating) return;
        batchOperating = true;
        batchActionError = "";
        batchActionMessage = "";
        try {
            const targetMembers = members.filter((m) => selectedMemberIds.includes(m.id));
            for (const m of targetMembers) {
                await facade.removeOrganizationMember(m.id, m);
            }
            batchActionMessage = `已移除选中的 ${targetMembers.length} 条成员经历记录`;
            selectedMemberIds = [];
            batchRemoveConfirm = false;
            await loadOrgs(true);
        } catch (error) {
            batchActionError = requestErrorMessage(error);
        } finally {
            batchOperating = false;
        }
    }

    async function exportSelectedMembersTsv() {
        if (selectedMemberIds.length === 0) return;
        const targetMembers = members.filter((m) => selectedMemberIds.includes(m.id));
        const orgName = currentOrg?.name ?? "";
        const rows = targetMembers.map((m) => toMemberExportRow(m, orgName));
        const tsv = buildOrganizationMemberTsv(rows, { includeBom: false });
        await copyPlainText(tsv);
        batchActionMessage = `已复制选中的 ${targetMembers.length} 位成员记录（TSV）`;
        setTimeout(() => { if (alive) batchActionMessage = ""; }, 2500);
    }
    let memberLoading = $state(false);
    let memberError = $state("");
    let membersRequest = 0;
    let organizationsRequest = 0;
    let organizationsRefreshing = $state(false);
    let selectionGuardBusy = $state(false);
    let organizationMissing = $state(false);
    let managerElement: HTMLDivElement | undefined = $state();
    let changesReceived = 0;
    let organizationReadError = $state("");
    let pendingViewport: ReturnType<typeof captureViewport> | undefined;
    const pendingViewportFrames = new Set<() => void>();
    let handledInitialOrgDocId: string | undefined;
    let alive = true;
    onDestroy(() => {
        alive = false;
        membersRequest += 1;
        organizationsRequest += 1;
        rosterRequest += 1;
        clearTimeout(memberSearchTimer);
        for (const finish of pendingViewportFrames) finish();
    });
    let roster: ContactSummary[] = $state([]);
    let rosterError = $state("");
    let rosterLoading = $state(false);
    let rosterRequest = 0;
    let newOrgName = $state("");
    let addPersonId = $state("");
    let formBusy = $state(false);
    let formBusyLabel = $state("");
    let memberExporting = $state(false);
    let memberExportMessage = $state("");
    let memberExportError = $state("");
    let recoveryBusy = $state(false);
    const busy = $derived(formBusy || recoveryBusy || memberExporting);
    let loading = $state(true);
    let errorMessage = $state("");
    let recoveryRefreshKey = $state(0);
    /* B13：归档分组展示开关；B13.4 成员行内编辑 */
    let showArchived = $state(false);
    let showRemoved = $state(false);
    let removingOrganization = $state(false);
    let editingMemberId = $state("");
    let editDepartment = $state("");
    let editTitle = $state("");
    let editJoinedOn = $state("");
    let editLeftOn = $state("");
    let editStatus = $state<"active" | "former">("active");
    let editStatusLabel = $state("");
    let editNote = $state("");
    let addDepartment = $state("");
    let addTitle = $state("");
    let addNote = $state("");
    let addAffiliationKind = $state<OrgAffiliationKind>("unspecified");
    let addStatus = $state<OrgMembershipStatus>("active");
    let addStatusLabel = $state("");
    let addJoinedOn = $state("");
    let addLeftOn = $state("");
    let editAffiliationKind = $state<OrgAffiliationKind>("unspecified");
    let replacementAffiliationKind = $state<OrgAffiliationKind>("unspecified");
    let removingMemberId = $state("");
    let membershipReport = $state<OrgMembershipWriteReport | null>(null);
    let refreshNeeded = $state(false);
    let editingMemberSnapshot = $state<OrgMembership | null>(null);
    let replacingMemberSnapshot = $state<OrgMembership | null>(null);
    let removingMemberSnapshot = $state<OrgMembership | null>(null);
    let movingMemberId = $state("");
    let movingMemberSnapshot = $state<OrgMembership | null>(null);
    let moveTargetOrgId = $state("");
    let replacingMemberId = $state("");
    let replacementPersonId = $state("");
    let replacementDepartment = $state("");
    let replacementTitle = $state("");
    let replacementJoinedOn = $state("");
    let replacementLeftOn = $state("");
    /* B13.4 组织改名 */
    let renaming = $state(false);
    let renameValue = $state("");
    const draftOrg = $derived(orgs.find((org) => org.docId === currentOrgDocId) ?? null);
    const hasDraft = $derived(Boolean(newOrgName.trim() || addPersonId
        || addAffiliationKind !== (draftOrg?.name.trim() === "家庭" ? "family" : "unspecified")
        || addStatus !== (draftOrg?.archived ? "former" : "active")
        || addStatusLabel.trim() || addDepartment.trim() || addTitle.trim() || addNote.trim() || addJoinedOn || addLeftOn || editingMemberId || replacingMemberId || removingMemberId || movingMemberId || renaming || removingOrganization));

    const guardedClose = useCloseGuard({
        busy: () => loading || busy,
        dirty: () => hasDraft,
        changes: () => [text("orgUnsaved", "组织管理中的修改尚未完成")],
    });

    $effect(() => {
        if (hostCloseChannel) hostCloseChannel.request = (close) => guardedClose(close);
    });

    const currentOrg = $derived(draftOrg);
    const memberSummary = $derived.by(() => {
        const records = currentOrg?.memberships ?? [];
        return { people: new Set(records.map((entry) => entry.personDocId)).size,
            active: records.filter((entry) => entry.status === "active").length,
            former: records.filter((entry) => entry.status === "former").length };
    });
    const memberPageCount = $derived(Math.max(1, Math.ceil(memberTotal / memberPageSize)));
    const memberPageNumber = $derived(Math.floor(memberOffset / memberPageSize) + 1);
    const memberControlsDisabled = $derived(busy || hasDraft || selectionGuardBusy || organizationMissing);
    const activeOrgs = $derived(orgs.filter((org) => !org.archived && !org.removed));
    const archivedOrgs = $derived(orgs.filter((org) => org.archived && !org.removed));
    const removedOrgs = $derived(orgs.filter((org) => org.removed));
    const moveTargets = $derived(orgs.filter((org) => !org.removed && org.docId !== currentOrgDocId && (!movingMemberSnapshot || movingMemberSnapshot.status !== "active" || !org.archived)));
    /* 可添加成员 = 名册中未加入当前组织的人（本人档案也可加入组织：本人可以是某公司员工） */
    const addCandidates = $derived(
        roster.filter((person) => addStatus === "former" || !activeMemberPersonDocIds.includes(person.docId)),
    );
    const replacingMember = $derived(members.find((member) => member.id === replacingMemberId) ?? null);
    const replacementCandidates = $derived(
        roster.filter((person) =>
            person.docId !== replacingMember?.personDocId
            && !activeMemberPersonDocIds.includes(person.docId)),
    );
    const pickerItems = (people: readonly ContactSummary[]): PickerItem[] => people.map((person) => ({
        id: person.docId,
        label: person.name,
        hint: [person.group, person.phone || person.email, person.docId].filter(Boolean).join(" · ") || undefined,
        docId: person.docId,
        itemId: person.itemId,
        keywords: [person.group, person.phone, person.email, person.wechat, person.website, ...(person.tags ?? [])]
            .filter(Boolean).join(" ").toLowerCase(),
    }));
    const addPickerItems = $derived(pickerItems(addCandidates));
    const replacementPickerItems = $derived(pickerItems(replacementCandidates));

    function captureViewport() {
        const positions: Array<{ element: HTMLElement; top: number; left: number }> = [];
        let element: HTMLElement | null | undefined = managerElement;
        while (element) {
            positions.push({ element, top: element.scrollTop, left: element.scrollLeft });
            element = element.parentElement;
        }
        const focus = document.activeElement instanceof HTMLElement && managerElement?.contains(document.activeElement) ? document.activeElement : null;
        return { positions, focus };
    }

    async function restoreViewport(snapshot: ReturnType<typeof captureViewport>, isCurrent: () => boolean): Promise<void> {
        await tick();
        if (!alive || !isCurrent()) return;
        const applyScroll = () => {
            for (const position of snapshot.positions) {
                if (position.element.isConnected) { position.element.scrollTop = position.top; position.element.scrollLeft = position.left; }
            }
        };
        applyScroll();
        if (snapshot.focus) {
            const target = snapshot.focus.isConnected ? snapshot.focus : managerElement?.querySelector<HTMLElement>('input[type="search"]');
            target?.focus({ preventScroll: true });
        }
        /* 浏览器滚动锚定可能在焦点恢复后再次调整父滚动容器，下一帧再收口一次。
           后台页会暂停 RAF；这只是视口修正，不能阻塞数据读取和写入 busy 收口。 */
        if (document.visibilityState === "hidden") return;
        await new Promise<void>((resolve) => {
            const finish = () => {
                cancelAnimationFrame(frame);
                clearTimeout(timer);
                document.removeEventListener("visibilitychange", onVisibilityChange);
                pendingViewportFrames.delete(finish);
                resolve();
            };
            const onVisibilityChange = () => { if (document.visibilityState === "hidden") finish(); };
            const timer = setTimeout(finish, 100);
            const frame = requestAnimationFrame(finish);
            pendingViewportFrames.add(finish);
            document.addEventListener("visibilitychange", onVisibilityChange);
        });
        if (!alive || !isCurrent()) return;
        applyScroll();
    }

    async function loadOrgs(keepSelection: boolean = true): Promise<void> {
        const request = ++organizationsRequest;
        const received = changesReceived;
        const previousViewport = pendingViewport ?? captureViewport();
        pendingViewport = undefined;
        const previousFocus = previousViewport.focus;
        let deferredForDraft = false;
        let completedMemberLoad = false;
        organizationsRefreshing = true;
        try {
            const next = await facade.listOrganizations({ includeRemoved: true });
            if (!alive || request !== organizationsRequest) return;
            const viewport = previousViewport;
            orgs = next;
            loading = false;
            if (organizationMissing || errorMessage === organizationReadError) errorMessage = "";
            organizationReadError = "";
            if (!keepSelection || !currentOrgDocId) currentOrgDocId = initialOrgDocId || orgs[0]?.docId || "";
            const selectedOrg = orgs.find((org) => org.docId === currentOrgDocId);
            if (!addPersonId) {
                addAffiliationKind = selectedOrg?.name.trim() === "家庭" ? "family" : "unspecified";
                addStatus = selectedOrg?.archived ? "former" : "active";
                addStatusLabel = "";
                addDepartment = "";
                addTitle = "";
                addNote = "";
                addJoinedOn = "";
                addLeftOn = "";
            }
            if (currentOrgDocId && !orgs.some((org) => org.docId === currentOrgDocId)) {
                organizationMissing = true;
                membersRequest += 1;
                memberLoading = false;
                errorMessage = text("orgContextMissing", "原组织 {id} 不可达或未登记，未切换到其他组织。请重新读取核对。", { id: currentOrgDocId });
                await restoreViewport(viewport, () => request === organizationsRequest);
                return;
            }
            organizationMissing = false;
            if (orgs.find((org) => org.docId === currentOrgDocId)?.archived) showArchived = true;
            if (selectedOrg?.removed) showRemoved = true;
            if (!alive || request !== organizationsRequest) return;
            await loadMembers(true, keepSelection, previousViewport);
            completedMemberLoad = true;
        } catch (error) {
            if (!alive || request !== organizationsRequest) return;
            organizationReadError = requestErrorMessage(error);
            errorMessage = organizationReadError;
        } finally {
            if (alive && request === organizationsRequest) {
                refreshNeeded = deferredForDraft || received !== changesReceived;
                if (!completedMemberLoad) {
                    const viewport = previousViewport;
                    viewport.focus ??= previousFocus;
                    await restoreViewport(viewport, () => request === organizationsRequest);
                }
                organizationsRefreshing = false;
            }
        }
    }

    const unsubscribeChanges = subscribeDataChanged(() => {
        changesReceived += 1;
        /* 在响应式刷新排队前保存滚动与焦点，避免浏览器先完成滚动锚定后
           才进入 loadOrgs，导致用户看到列表跳到最大滚动位置。 */
        pendingViewport ??= captureViewport();
        refreshNeeded = true;
    });
    onDestroy(unsubscribeChanges);

    $effect(() => {
        if (!refreshNeeded || busy || loading || organizationsRefreshing || selectionGuardBusy || memberLoading || hasDraft) return;
        refreshNeeded = false;
        void loadOrgs(true).catch((error) => { if (alive) errorMessage = requestErrorMessage(error); });
    });

    $effect(() => {
        const requested = initialOrgDocId;
        if (loading || busy || selectionGuardBusy || requested === handledInitialOrgDocId) return;
        handledInitialOrgDocId = requested;
        if (requested) void untrack(() => selectOrg(requested, true));
    });

    async function loadMembers(reset = true, preservePage = false, preservedViewport?: ReturnType<typeof captureViewport>, requestedOffset?: number): Promise<void> {
        if (!alive) return;
        const request = ++membersRequest;
        const previousFocus = captureViewport().focus;
        const docId = currentOrgDocId;
        const query = memberQuery;
        const status = memberStatus;
        let offset = requestedOffset ?? (reset && !preservePage ? 0 : memberOffset);
        const limit = memberPageSize;
        memberAttemptOffset = offset;
        let viewport: ReturnType<typeof captureViewport> | undefined;
        if (!docId) {
            members = [];
            activeMemberPersonDocIds = [];
            memberOffset = 0;
            memberTotal = 0;
            memberHasMore = false;
            return;
        }
        memberLoading = true;
        memberError = "";
        expandedMemberId = "";
        try {
            let page;
            let activeIds: string[];
            if (facade.listOrganizationMembersPage) {
                // A refresh reads only the visible page. If its last record was
                // removed, clamp to the last valid page before presenting it.
                for (let attempt = 0; ; attempt += 1) {
                    page = await facade.listOrganizationMembersPage(docId, { query, status, offset, limit });
                    if (!alive || request !== membersRequest) return;
                    if (page.offset !== offset || page.items.length > limit || !Number.isSafeInteger(page.total) || page.total < 0
                        || page.hasMore && page.items.length === 0) throw new Error("成员分页未前进，结果尚未核实");
                    const lastOffset = Math.max(0, Math.floor((page.total - 1) / limit) * limit);
                    if (offset <= lastOffset) break;
                    if (attempt >= 2) throw new Error("成员列表持续变化，请重新读取");
                    offset = lastOffset;
                    memberAttemptOffset = offset;
                }
                activeIds = page.activePersonDocIds;
            } else {
                const all = await facade.listOrganizationMembers(docId);
                if (!alive || request !== membersRequest) return;
                const filtered = query.trim()
                    ? all.filter((member) => [member.personName, member.department, member.title, member.statusLabel ?? "", member.note ?? ""]
                        .some((value) => value.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))) : all;
                page = pageOrgMemberships(filtered, { status, offset, limit });
                const lastOffset = Math.max(0, Math.floor((page.total - 1) / limit) * limit);
                if (offset > lastOffset) page = pageOrgMemberships(filtered, { status, offset: lastOffset, limit });
                activeIds = all.filter((member) => member.status === "active").map((member) => member.personDocId);
            }
            if (hasDraft) { refreshNeeded = true; return; }
            viewport = preservedViewport ?? captureViewport();
            viewport.focus ??= previousFocus;
            members = page.items;
            activeMemberPersonDocIds = activeIds;
            memberOffset = page.offset;
            memberAttemptOffset = page.offset;
            memberTotal = page.total;
            memberHasMore = page.hasMore;
            if (loadedMemberOrgDocId !== docId) {
                showAddMember = page.total === 0 && !query.trim() && status === "all";
                loadedMemberOrgDocId = docId;
            }
        } catch (error) {
            if (alive && request === membersRequest) memberError = requestErrorMessage(error);
        } finally {
            if (alive && request === membersRequest) {
                if (viewport) await restoreViewport(viewport, () => request === membersRequest);
                memberLoading = false;
            }
        }
    }

    function reloadMembers(debounce = false): void {
        if (busy || loading || selectionGuardBusy || hasDraft || organizationMissing) return;
        clearTimeout(memberSearchTimer);
        memberExportMessage = "";
        memberExportError = "";
        // Invalidate an older query as soon as typing starts, before the next
        // debounced request, so late results cannot flash as a confirmed match.
        membersRequest += 1;
        memberLoading = true;
        expandedMemberId = "";
        if (debounce) memberSearchTimer = setTimeout(() => { void loadMembers(true); }, 180);
        else void loadMembers(true);
    }

    function changeMemberPage(offset: number): void {
        if (memberControlsDisabled || memberLoading || memberError || offset < 0 || offset >= memberTotal) return;
        void loadMembers(false, false, undefined, offset);
    }

    function retryMembers(): void {
        if (busy || loading || memberLoading || organizationsRefreshing || selectionGuardBusy || hasDraft || organizationMissing) return;
        void loadMembers(false, true, undefined, memberAttemptOffset);
    }

    function reloadOrganizations(): void {
        if (busy || loading || memberLoading || organizationsRefreshing || selectionGuardBusy || hasDraft) return;
        void loadOrgs(true).catch((error) => { if (alive) errorMessage = requestErrorMessage(error); });
    }

    function toMemberExportRow(member: OrganizationMember, organizationName: string): OrganizationMemberExportRow {
        return {
            id: member.id,
            orgDocId: member.orgDocId,
            organizationName,
            personDocId: member.personDocId,
            personName: member.personName,
            department: member.department,
            title: member.title,
            joinedOn: member.joinedOn,
            leftOn: member.leftOn,
            status: member.status,
            statusLabel: member.statusLabel,
            affiliationKind: member.affiliationKind,
            note: member.note,
        };
    }

    async function loadMembersForExport(): Promise<OrganizationMemberExportRow[]> {
        const docId = currentOrgDocId;
        if (!docId) return [];
        const query = memberQuery.trim();
        const status = memberStatus;
        const organizationName = currentOrg?.name ?? "";
        /* 旧宿主没有分页 facade 时，沿用已有全量读取并在本地复现筛选语义。 */
        if (!facade.listOrganizationMembersPage) {
            const all = await facade.listOrganizationMembers(docId);
            return filterOrganizationMemberExportRows(all.map((member) => toMemberExportRow(member, organizationName)), { query, status });
        }
        const pageSize = 200;
        const rows: OrganizationMember[] = [];
        const rowIds = new Set<string>();
        let offset = 0;
        let expectedTotal: number | undefined;
        for (let pageIndex = 0; pageIndex < 5000; pageIndex += 1) {
            const page = await facade.listOrganizationMembersPage(docId, { query, status, offset, limit: pageSize });
            const reportedLimit = Number.isSafeInteger(page.limit) ? page.limit : pageSize;
            if (page.offset !== offset || !Array.isArray(page.items) || !Number.isSafeInteger(page.total) || page.total < 0
                || !Number.isSafeInteger(reportedLimit) || reportedLimit < 1 || reportedLimit > 500
                || page.items.length > reportedLimit || typeof page.hasMore !== "boolean") {
                throw new Error("成员导出分页结果尚未核实，请重新读取后重试");
            }
            expectedTotal ??= page.total;
            if (page.total !== expectedTotal) throw new Error("成员列表在导出期间发生变化，请重新读取后重试");
            if (page.items.some((item) => rowIds.has(item.id))) throw new Error("成员导出分页出现重复记录，请重新读取后重试");
            page.items.forEach((item) => rowIds.add(item.id));
            rows.push(...page.items);
            if (!page.hasMore) {
                if (rows.length !== expectedTotal) throw new Error("成员导出未读取完整，结果尚未核实");
                return rows.map((member) => toMemberExportRow(member, organizationName));
            }
            if (page.items.length === 0) throw new Error("成员导出分页未前进，结果尚未核实");
            offset += page.items.length;
        }
        throw new Error("成员数量过大，导出已停止；请缩小筛选范围后重试");
    }

    async function exportFilteredMembers(kind: "csv" | "copy-tsv"): Promise<void> {
        if (memberExporting || busy || loading || organizationsRefreshing || selectionGuardBusy || memberLoading || !currentOrgDocId) return;
        memberExporting = true;
        memberExportMessage = "";
        memberExportError = "";
        try {
            const exported = await loadMembersForExport();
            if (!alive) return;
            if (kind === "copy-tsv") {
                await copyPlainText(buildOrganizationMemberTsv(exported, { includeBom: false }));
                if (alive) memberExportMessage = `已复制当前筛选的 ${exported.length} 条成员记录（TSV）`;
                return;
            }
            const organizationName = currentOrg?.name ?? "";
            const stamp = new Date().toISOString().slice(0, 10).replaceAll("-", "");
            const safeOrganizationName = (organizationName || "组织")
                .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_").trim().replace(/[. ]+$/g, "") || "组织";
            const blob = new Blob([buildOrganizationMemberCsv(exported)], { type: "text/csv;charset=utf-8" });
            const url = URL.createObjectURL(blob);
            const anchor = document.createElement("a");
            anchor.href = url;
            anchor.download = `小驴人脉_${safeOrganizationName}_成员_${stamp}.csv`;
            anchor.click();
            setTimeout(() => URL.revokeObjectURL(url), 0);
            memberExportMessage = `已下载当前筛选的 ${exported.length} 条成员记录（CSV）`;
        } catch (error) {
            if (alive) memberExportError = requestErrorMessage(error);
        } finally {
            if (alive) memberExporting = false;
        }
    }

    async function loadRoster(): Promise<void> {
        const request = ++rosterRequest;
        rosterLoading = true;
        rosterError = "";
        try {
            const next = await facade.listContacts();
            if (!alive || request !== rosterRequest) return;
            roster = next;
        } catch (error) {
            if (alive && request === rosterRequest) rosterError = requestErrorMessage(error);
        } finally {
            if (alive && request === rosterRequest) rosterLoading = false;
        }
    }

    onMount(() => {
        void (async () => {
            loading = true;
            try {
                if (initialOrgDocId && !/^\d{14}-[0-9a-z]{7}$/.test(initialOrgDocId)) throw new Error("组织导航 ID 非法");
                currentOrgDocId = initialOrgDocId;
                const rosterTask = loadRoster();
                await loadOrgs(true);
                await rosterTask;
            } catch (error) {
                if (alive) errorMessage = requestErrorMessage(error);
            } finally {
                if (alive) loading = false;
            }
        })();
    });

    async function run(task: () => Promise<void>, label = "处理中…"): Promise<void> {
        /* 成员初次读取与组织列表刷新可以与已展示的编辑草稿并行；写操作自身
         * 通过 formBusy 串行化，完成后统一重新读取。这样早到的“编辑”点击不会
         * 因后台刷新标记短暂为 true 而无反馈。 */
        if (busy || loading || selectionGuardBusy || organizationMissing) return;
        formBusy = true;
        formBusyLabel = label;
        errorMessage = "";
        try {
            await task();
        } catch (error) {
            if (alive) errorMessage = requestErrorMessage(error);
        } finally {
            if (alive) { formBusy = false; formBusyLabel = ""; recoveryRefreshKey += 1; }
            await tick();
        }
    }

    /* 归档/恢复只改组织标记，不依赖成员分页完成；成员列表会在随后统一重读。 */
    async function runOrganizationStateTask(task: () => Promise<void>, label = "保存中…"): Promise<void> {
        if (busy || loading || selectionGuardBusy || organizationMissing) return;
        formBusy = true;
        formBusyLabel = label;
        errorMessage = "";
        try { await task(); }
        catch (error) { if (alive) errorMessage = requestErrorMessage(error); }
        finally {
            if (alive) { formBusy = false; formBusyLabel = ""; }
            await tick();
        }
    }

    async function selectOrg(docId: string, fromInitialProp = false): Promise<void> {
        if (busy || loading || selectionGuardBusy || docId === currentOrgDocId) return;
        if (!/^\d{14}-[0-9a-z]{7}$/.test(docId)) { errorMessage = "组织导航 ID 非法"; return; }
        selectionGuardBusy = true;
        try {
            await guardedClose(() => {
                if (!alive || fromInitialProp && initialOrgDocId !== docId) return;
                newOrgName = "";
                addPersonId = "";
                const selectedOrg = orgs.find((org) => org.docId === docId);
                addAffiliationKind = selectedOrg?.name.trim() === "家庭" ? "family" : "unspecified";
                addStatus = selectedOrg?.archived ? "former" : "active";
                addStatusLabel = "";
                addDepartment = "";
                addTitle = "";
                addNote = "";
                addJoinedOn = "";
                addLeftOn = "";
                editingMemberId = "";
                editingMemberSnapshot = null;
                replacingMemberId = "";
                replacingMemberSnapshot = null;
                removingMemberId = "";
                removingMemberSnapshot = null;
                movingMemberId = "";
                movingMemberSnapshot = null;
                moveTargetOrgId = "";
                renaming = false;
                removingOrganization = false;
                organizationsRequest += 1;
                organizationsRefreshing = false;
                currentOrgDocId = docId;
                members = [];
                memberOffset = 0;
                memberAttemptOffset = 0;
                loadedMemberOrgDocId = "";
                memberQuery = "";
                memberStatus = "all";
                memberExportMessage = "";
                memberExportError = "";
                showAddMember = false;
                expandedMemberId = "";
                clearTimeout(memberSearchTimer);
                memberTotal = 0;
                memberHasMore = false;
                activeMemberPersonDocIds = [];
                memberError = "";
                errorMessage = "";
                organizationMissing = !orgs.some((org) => org.docId === docId);
                if (organizationMissing) {
                    membersRequest += 1;
                    memberLoading = false;
                    errorMessage = text("orgContextMissing", "原组织 {id} 不可达或未登记，未切换到其他组织。请重新读取核对。", { id: docId });
                    return;
                }
                if (orgs.find((org) => org.docId === docId)?.archived) showArchived = true;
                if (selectedOrg?.removed) showRemoved = true;
                void loadMembers().catch((error) => { if (alive) errorMessage = requestErrorMessage(error); });
            });
        } finally {
            if (alive) selectionGuardBusy = false;
        }
    }

    function createOrg(): void {
        const name = newOrgName.trim();
        if (!name || busy) return;
        formBusy = true;
        formBusyLabel = "创建中…";
        errorMessage = "";
        void (async () => {
            try {
                const created = await facade.createOrganization(name);
                if (!alive) return;
                newOrgName = "";
                currentOrgDocId = created.docId;
                memberOffset = 0;
                memberQuery = "";
                memberStatus = "all";
                /* 创建写入已完成，组织刷新是只读收口；允许新组织的成员入口
                   在列表出现后立即可用，不把后台成员读取误报成写入忙态。 */
                formBusy = false;
                formBusyLabel = "";
                await loadOrgs(true);
                onCreated?.(created.docId);
            } catch (error) {
                if (alive) errorMessage = requestErrorMessage(error);
            } finally {
                if (alive) { formBusy = false; formBusyLabel = ""; recoveryRefreshKey += 1; }
                await tick();
            }
        })();
    }

    function addMember(): void {
        if (!addPersonId || busy || !currentOrgDocId) return;
        if (currentOrg?.archived && addStatus !== "former") {
            errorMessage = "组织已归档，只能补录已离开或毕业的历史记录";
            return;
        }
        if (addStatus === "active" && activeMemberPersonDocIds.includes(addPersonId)) {
            errorMessage = "该联系人已有当前归属，请编辑原记录；如补录历史期间，请选择已离开/毕业状态。";
            return;
        }
        void run(async () => {
            const report = await facade.addOrganizationMember(currentOrgDocId, addPersonId, { department: addDepartment, title: addTitle,
                affiliationKind: addAffiliationKind, status: addStatus, statusLabel: addStatusLabel.trim(), note: addNote.trim(), joinedOn: addJoinedOn, leftOn: addLeftOn });
            if (!alive) return;
            membershipReport = report ?? null;
            addPersonId = "";
            addAffiliationKind = "unspecified";
            addStatus = "active";
            addStatusLabel = "";
            addDepartment = "";
            addTitle = "";
            addNote = "";
            addJoinedOn = "";
            addLeftOn = "";
            await loadOrgs(true);
        }, "添加中…");
    }

    function removeMember(id: string): void {
        if (busy || removingMemberId !== id) return;
        void run(async () => {
            const report = await facade.removeOrganizationMember(id, removingMemberSnapshot ?? undefined);
            if (!alive) return;
            membershipReport = report ?? null;
            removingMemberId = "";
            removingMemberSnapshot = null;
            await loadOrgs(true);
        }, "移除中…");
    }

    /** B13.4：进入成员编辑（表单初始化自当前记录） */
    function startEditMember(member: OrganizationMember): void {
        if (busy || hasDraft || memberError) return;
        expandedMemberId = "";
        editingMemberId = member.id;
        editingMemberSnapshot = { ...member };
        editDepartment = member.department;
        editTitle = member.title;
        editJoinedOn = member.joinedOn;
        editLeftOn = member.leftOn;
        editStatus = member.status;
        editStatusLabel = member.statusLabel ?? "";
        editNote = member.note ?? "";
        editAffiliationKind = member.affiliationKind ?? "unspecified";
    }

    function cancelEditMember(): void {
        editingMemberId = "";
        editingMemberSnapshot = null;
    }

    /** B13.4：保存成员字段（部门/职位/入职/离职/状态；身份字段不可变） */
    function saveEditMember(): void {
        const id = editingMemberId;
        if (!id || busy) return;
        const patch = {
            department: editDepartment,
            title: editTitle,
            joinedOn: editJoinedOn,
            leftOn: editLeftOn,
            status: editStatus,
            statusLabel: editStatusLabel,
            affiliationKind: editAffiliationKind,
            ...((editNote.trim() || editingMemberSnapshot?.note !== undefined) ? { note: editNote } : {}),
        };
        void run(async () => {
            const report = await facade.updateOrganizationMember(id, patch, editingMemberSnapshot ?? undefined);
            if (!alive) return;
            membershipReport = report ?? null;
            editingMemberId = "";
            editingMemberSnapshot = null;
            await loadOrgs(true);
        }, "保存中…");
    }

    function startMoveMember(member: OrganizationMember): void {
        if (busy || hasDraft || memberError || !facade.moveOrganizationMember) return;
        expandedMemberId = "";
        movingMemberId = member.id;
        movingMemberSnapshot = { ...member };
        moveTargetOrgId = "";
        editingMemberId = "";
        replacingMemberId = "";
    }

    function cancelMoveMember(): void {
        movingMemberId = "";
        movingMemberSnapshot = null;
        moveTargetOrgId = "";
    }

    function saveMoveMember(): void {
        const id = movingMemberId;
        if (!id || !moveTargetOrgId || busy || !facade.moveOrganizationMember) return;
        void run(async () => {
            const report = await facade.moveOrganizationMember?.(id, moveTargetOrgId, movingMemberSnapshot ?? undefined);
            if (!alive) return;
            membershipReport = report ?? null;
            const target = moveTargetOrgId;
            cancelMoveMember();
            currentOrgDocId = target;
            memberOffset = 0;
            memberQuery = "";
            memberStatus = "all";
            await loadOrgs(true);
        }, "移动中…");
    }

    function startReplaceMember(member: OrganizationMember): void {
        if (busy || memberLoading || organizationsRefreshing || hasDraft || memberError || member.status !== "active") return;
        expandedMemberId = "";
        const today = toLocalDateKey(new Date());
        replacingMemberId = member.id;
        replacingMemberSnapshot = { ...member };
        replacementPersonId = "";
        replacementDepartment = member.department;
        replacementTitle = member.title;
        replacementJoinedOn = today;
        replacementLeftOn = today;
        editingMemberId = "";
        replacementAffiliationKind = "unspecified";
    }

    function cancelReplaceMember(): void {
        replacingMemberId = "";
        replacingMemberSnapshot = null;
    }

    function saveReplaceMember(): void {
        const formerMembershipId = replacingMemberId;
        if (!formerMembershipId || !replacementPersonId || !replacementJoinedOn || !replacementLeftOn || busy) return;
        void run(async () => {
            const report = await facade.replaceOrganizationMember(formerMembershipId, replacementPersonId, {
                department: replacementDepartment,
                title: replacementTitle,
                joinedOn: replacementJoinedOn,
                leftOn: replacementLeftOn,
                affiliationKind: replacementAffiliationKind,
            }, replacingMemberSnapshot ?? undefined);
            if (!alive) return;
            membershipReport = report ?? null;
            replacingMemberId = "";
            replacingMemberSnapshot = null;
            await loadOrgs(true);
        }, "接替中…");
    }

    /** B13：归档当前组织（文档与成员记录保留，可恢复） */
    function archiveCurrentOrg(): void {
        const docId = currentOrgDocId;
        if (!docId || busy) return;
        void runOrganizationStateTask(async () => {
            await facade.archiveOrganization(docId);
            /* 组织状态写入已完成；让恢复/重试入口在成员分页重读期间保持可用。 */
            await loadOrgs(true);
        }, "归档中…");
    }

    /** B13：恢复归档组织 */
    function restoreCurrentOrg(): void {
        const docId = currentOrgDocId;
        if (!docId || busy) return;
        void runOrganizationStateTask(async () => {
            await facade.restoreOrganization(docId);
            await loadOrgs(true);
        }, "恢复中…");
    }

    function removeCurrentOrg(): void {
        const docId = currentOrgDocId;
        if (!docId || busy || !facade.removeOrganization) return;
        void runOrganizationStateTask(async () => {
            await facade.removeOrganization?.(docId);
            if (!alive) return;
            removingOrganization = false;
            showRemoved = true;
            await loadOrgs(true);
        }, "移除中…");
    }

    /** B13.4：组织改名（同名检查与标记块文案同步在服务层） */
    function startRename(): void {
        if (!currentOrg || busy || hasDraft) return;
        renameValue = currentOrg.name;
        renaming = true;
    }

    function saveRename(): void {
        const docId = currentOrgDocId;
        const name = renameValue.trim();
        if (!docId || !name || busy) return;
        void run(async () => {
            await facade.renameOrganization(docId, name);
            if (!alive) return;
            renaming = false;
            await loadOrgs(true);
        }, "保存中…");
    }

    function cancelRename(): void {
        renaming = false;
    }

    function affiliationLabel(kind: OrgAffiliationKind | undefined): string {
        return kind === "family" ? "家庭" : kind === "work" ? text("orgAffiliationWork", "工作单位") : kind === "education" ? text("orgAffiliationEducation", "学校") : text("orgAffiliationUnspecified", "未分类");
    }

    function changeAddStatus(status: OrgMembershipStatus): void {
        addStatus = status;
        if (status === "active") addLeftOn = "";
    }

    function changeEditStatus(status: OrgMembershipStatus): void {
        editStatus = status;
        if (status === "active") editLeftOn = "";
    }

    function resetAddDraft(): void {
        addPersonId = "";
        addAffiliationKind = currentOrg?.name.trim() === "家庭" ? "family" : "unspecified";
        addStatus = currentOrg?.archived ? "former" : "active";
        addStatusLabel = "";
        addDepartment = "";
        addTitle = "";
        addNote = "";
        addJoinedOn = "";
        addLeftOn = "";
    }

    async function toggleAddMember(): Promise<void> {
        if (showAddMember) {
            await guardedClose(() => { resetAddDraft(); showAddMember = false; });
        } else {
            expandedMemberId = "";
            showAddMember = true;
            await tick();
            managerElement?.querySelector<HTMLButtonElement>(".lvct-org-manager__add .lvct-picker__trigger")?.focus();
        }
    }

    function closeMemberActions(restoreFocus = false): void {
        const id = expandedMemberId;
        expandedMemberId = "";
        if (restoreFocus && id) {
            const row = [...(managerElement?.querySelectorAll<HTMLElement>(".lvct-org-manager__member") ?? [])]
                .find((element) => element.dataset.membershipId === id);
            row?.querySelector<HTMLButtonElement>(".lvct-org-manager__member-more")?.focus({ preventScroll: true });
        }
    }

    async function toggleMemberActions(id: string): Promise<void> {
        if (expandedMemberId === id) { closeMemberActions(); return; }
        expandedMemberId = id;
        await tick();
        document.getElementById(`lvct-member-actions-${id}`)?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
    }

    function dismissMemberActions(event: PointerEvent): void {
        if (expandedMemberId && event.target instanceof Element && !event.target.closest("[data-member-actions]")) closeMemberActions();
    }

    function handleMemberKeydown(event: KeyboardEvent): void {
        if (event.key === "Escape" && expandedMemberId) {
            event.preventDefault();
            event.stopPropagation();
            closeMemberActions(true);
        }
    }
</script>

<svelte:window onpointerdown={dismissMemberActions} />

{#snippet memberIdentity(member: OrganizationMember)}
    <span class="lvct-org-manager__member-avatar" aria-hidden="true">
        {member.personName.slice(0, 1)}
    </span>
    <span class="lvct-org-manager__member-name">
        <span class="lvct-org-manager__member-primary"><strong>{member.personName}</strong>
            <span class="lvct-org-manager__member-status" class:lvct-org-manager__member-status--active={member.status === "active"}>{orgMembershipStatusLabel(member)}</span>
        </span>
        <span class="lvct-org-manager__member-meta">{[affiliationLabel(member.affiliationKind), member.department, member.title].filter(Boolean).join(" · ")}</span>
        {#if member.joinedOn || member.leftOn}
            <span class="lvct-org-manager__member-period">{member.joinedOn || "加入日期未填"} — {member.leftOn || (member.status === "active" ? "至今" : "离开日期未填")}</span>
        {/if}
        {#if member.note}<span class="lvct-org-manager__member-note">{member.note}</span>{/if}
    </span>
{/snippet}

{#snippet memberPagination()}
    <nav class="lvct-org-manager__pagination" aria-label="成员分页">
        <span class="lvct-org-manager__page-summary" role="status" aria-live="polite" aria-atomic="true">
            {memberLoading ? text("orgMembersLoading", "正在加载成员…") : memberError ? "成员读取失败，当前页待核实" : `${memberTotal ? memberOffset + 1 : 0}–${memberOffset + members.length} / ${memberTotal} 条`}
        </span>
        <label class="lvct-org-manager__page-size"><span>每页</span>
            <select class="b3-select" aria-label="每页成员条数" bind:value={memberPageSize} onchange={() => reloadMembers()} disabled={memberControlsDisabled || memberLoading}>
                <option value={20}>20 条</option><option value={50}>50 条</option><option value={100}>100 条</option>
            </select>
        </label>
        <div class="lvct-org-manager__page-buttons">
            <button type="button" class="b3-button b3-button--outline" onclick={() => changeMemberPage(memberOffset - memberPageSize)}
                disabled={memberControlsDisabled || memberLoading || !!memberError || memberOffset === 0}>上一页</button>
            <span>第 {memberPageNumber} / {memberPageCount} 页</span>
            <button type="button" class="b3-button b3-button--outline" onclick={() => changeMemberPage(memberOffset + memberPageSize)}
                disabled={memberControlsDisabled || memberLoading || !!memberError || !memberHasMore}>下一页</button>
        </div>
    </nav>
{/snippet}

<div class="lvct-dialog-root lvct-org-manager" role="dialog" tabindex="-1" aria-label="组织管理" data-org-doc-id={currentOrgDocId} aria-busy={busy} bind:this={managerElement} onkeydown={handleMemberKeydown}>
    {#if busy}<p class="ft__smaller ft__on-surface" role="status" aria-live="polite">{formBusyLabel || "正在处理…"}</p>{/if}
    {#if refreshNeeded}<p class="lvct-org-manager__refresh" role="status">{text("orgMembershipRefreshNeeded", "成员或组织有新变化，重新读取后核对。未保存的表单保留。")}</p>{/if}
    <div class="lvct-org-manager__layout">
        <div class="lvct-org-manager__list">
            <b>{text("orgListTitle", "组织")}</b>
            {#if organizationReadError}
                <ViewState compact error title={text("orgLoadFail", "组织列表加载失败")} description={organizationReadError}>
                    <button type="button" class="b3-button b3-button--outline" onclick={reloadOrganizations} disabled={organizationsRefreshing || busy}>
                        {text("orgMembershipReloadAll", "重新读取组织和成员")}
                    </button>
                </ViewState>
            {/if}
            {#if loading}
                <ViewState compact loading title={text("orgLoading", "正在加载组织…")} />
            {:else if organizationReadError && orgs.length === 0}
                <!-- 错误和重试入口已在列表标题下方显示。 -->
            {:else if orgs.length === 0 && !organizationMissing && !errorMessage}
                <p class="ft__smaller ft__on-surface">{text("orgEmpty", "暂无组织。输入名称新建第一个组织。")}</p>
            {:else}
                <ul class="lvct-org-manager__orgs">
                    {#each activeOrgs as org (org.docId)}
                        <li>
                            <button
                                type="button"
                                class="lvct-org-manager__org-item"
                                class:lvct-org-manager__org-item--active={org.docId === currentOrgDocId}
                                disabled={busy || loading || selectionGuardBusy}
                                onclick={() => selectOrg(org.docId)}
                            >{org.name}<small>（{org.memberships.length}）</small></button>
                        </li>
                    {/each}
                </ul>
                {#if archivedOrgs.length > 0}
                    <button type="button" class="b3-button b3-button--text" onclick={() => (showArchived = !showArchived)}>
                        {showArchived ? text("orgArchivedHide", "收起已归档") : text("orgArchivedShow", "已归档（{n}）", { n: archivedOrgs.length })}
                    </button>
                    {#if showArchived}
                        <ul class="lvct-org-manager__orgs">
                            {#each archivedOrgs as org (org.docId)}
                                <li>
                                    <button
                                        type="button"
                                        class="lvct-org-manager__org-item"
                                        class:lvct-org-manager__org-item--active={org.docId === currentOrgDocId}
                                        disabled={busy || loading || selectionGuardBusy}
                                        onclick={() => selectOrg(org.docId)}
                                    >{org.name}<small>（{text("orgArchivedTag", "已归档")}）</small></button>
                                </li>
                            {/each}
                        </ul>
                    {/if}
                {/if}
                {#if removedOrgs.length > 0}
                    <button type="button" class="b3-button b3-button--text" aria-expanded={showRemoved} onclick={() => (showRemoved = !showRemoved)}>
                        {showRemoved ? "收起已移除" : `已移除（${removedOrgs.length}）`}
                    </button>
                    {#if showRemoved}
                        <ul class="lvct-org-manager__orgs">
                            {#each removedOrgs as org (org.docId)}
                                <li><button type="button" class="lvct-org-manager__org-item"
                                    class:lvct-org-manager__org-item--active={org.docId === currentOrgDocId}
                                    disabled={busy || loading || selectionGuardBusy} onclick={() => selectOrg(org.docId)}>
                                    {org.name}<small>（已移除）</small>
                                </button></li>
                            {/each}
                        </ul>
                    {/if}
                {/if}
            {/if}
            <div class="lvct-org-manager__create">
                {#if onCreateOrganization}
                    <button type="button" class="b3-button b3-button--primary" disabled={busy || loading || selectionGuardBusy} onclick={onCreateOrganization}>
                        {text("orgCreateProfile", "新建组织资料")}</button>
                {:else}
                    <label class="lvct-org-manager__create-field">
                        <span>{text("orgCreateLabel", "新建组织名称")}</span>
                        <input
                            class="b3-text-field fn__block"
                            placeholder={text("orgCreatePlaceholder", "组织名称…")}
                            bind:value={newOrgName}
                            disabled={busy || loading || selectionGuardBusy}
                            aria-label={text("orgCreateLabel", "新建组织名称")}
                        />
                    </label>
                    <button class="b3-button b3-button--text"
                        disabled={busy || loading || selectionGuardBusy || !newOrgName.trim()}
                        title={busy || loading || selectionGuardBusy ? "组织列表仍在读取或保存，请稍候" : !newOrgName.trim() ? "请输入组织名称后再创建" : undefined}
                        onclick={createOrg}>
                        {text("orgCreate", "新建组织")}</button>
                {/if}
            </div>
        </div>

        <div class="lvct-org-manager__detail">
            {#if currentOrg}
                {#if renaming}
                    <div class="fn__flex" style="gap: 8px; align-items: center;">
                        <input class="b3-text-field fn__flex-1" bind:value={renameValue} disabled={busy}
                            aria-label={text("orgRenameLabel", "新组织名称")}
                            onkeydown={(event) => { if (event.key === "Enter") saveRename(); }} />
                        <button type="button" class="b3-button b3-button--text" disabled={busy || !renameValue.trim()}
                            onclick={saveRename}>{text("orgRenameSave", "保存名称")}</button>
                        <button type="button" class="b3-button b3-button--cancel" disabled={busy}
                            onclick={cancelRename}>{text("orgMemberCancel", "取消")}</button>
                    </div>
                {:else}
                    <div class="fn__flex" style="align-items: center; gap: 8px;">
                        <b class="fn__flex-1">{currentOrg.name}{currentOrg.removed ? "（已移除）" : currentOrg.archived ? text("orgArchivedTag", "（已归档）") : ""}</b>
                        {#if onEditOrganization && !currentOrg.removed}
                            <button type="button" class="b3-button b3-button--text" disabled={busy || organizationsRefreshing || memberLoading || hasDraft}
                                onclick={() => onEditOrganization?.(currentOrg.docId)}>{text("orgEditProfile", "编辑资料")}</button>
                        {/if}
                        {#if !currentOrg.removed}<button type="button" class="b3-button b3-button--text" disabled={busy || hasDraft}
                            onclick={startRename}>{text("orgRename", "改名")}</button>
                        {/if}
                        {#if currentOrg.archived}
                            <button type="button" class="b3-button b3-button--text" disabled={busy || hasDraft}
                                onclick={restoreCurrentOrg}>{text("orgRestore", "恢复组织")}</button>
                        {:else}
                            <button type="button" class="b3-button b3-button--cancel" disabled={busy || hasDraft}
                                onclick={archiveCurrentOrg}>{text("orgArchive", "归档组织")}</button>
                        {/if}
                        {#if facade.removeOrganization && !currentOrg.removed}
                            <button type="button" class="b3-button b3-button--cancel" disabled={busy || loading || organizationsRefreshing || memberLoading || hasDraft}
                                onclick={() => { removingOrganization = true; }}>移除组织</button>
                        {/if}
                    </div>
                {/if}
                {#if removingOrganization}
                    <div class="lvct-org-manager__remove-confirm" role="group" aria-label="移除组织确认">
                        <b>从插件移除「{currentOrg.name}」？</b>
                        <p>组织将从日常列表和选组织入口隐藏。原始组织文档、组织资料和全部成员历史均保留；从“已移除”中恢复后，组织会回到活跃状态。</p>
                        <p>保留文档：<button type="button" class="b3-button b3-button--text" onclick={() => facade.openDoc(currentOrg.docId)}>{currentOrg.name}</button>
                            · 当前成员 {currentOrg.memberships.filter((entry) => entry.status === "active").length} 条
                            · 历史成员 {currentOrg.memberships.filter((entry) => entry.status === "former").length} 条</p>
                        <div class="fn__flex" style="gap: 8px; flex-wrap: wrap;">
                            <button type="button" class="b3-button b3-button--cancel" disabled={busy} onclick={() => { removingOrganization = false; }}>取消</button>
                            <button type="button" class="b3-button b3-button--primary" disabled={busy || organizationsRefreshing} onclick={removeCurrentOrg}>确认移除组织</button>
                        </div>
                    </div>
                {/if}
                {#if currentOrg.removed}
                    <p class="ft__smaller ft__on-surface" role="status">此组织已从插件移除。组织文档及 {currentOrg.memberships.length} 条成员历史已保留；恢复后组织回到活跃状态，可继续管理。</p>
                    <button type="button" class="b3-button b3-button--text" onclick={() => facade.openDoc(currentOrg.docId)}>打开保留的组织文档</button>
                    <div class="lvct-org-manager__members lvct-org-manager__members--removed" aria-busy={memberLoading}>
                        <div class="fn__flex" style="gap: 8px; align-items: center; flex-wrap: wrap;">
                            <b>已保留的成员历史</b>
                            <span class="ft__smaller ft__on-surface">{memberTotal} 条记录 · 只读</span>
                        </div>
                        {#if memberError}
                            <ViewState compact error title={text("orgMembersError", "成员读取失败，结果尚未核实")} description={memberError}>
                                <button type="button" class="b3-button b3-button--outline" onclick={retryMembers} disabled={busy || memberLoading || organizationsRefreshing || hasDraft || selectionGuardBusy}>{text("commonRetry", "重试")}</button>
                            </ViewState>
                        {:else if memberLoading && members.length === 0}
                            <ViewState compact loading title={text("orgMembersLoading", "正在加载成员…")} />
                        {:else if members.length === 0}
                            <p class="ft__smaller ft__on-surface">暂无可显示的成员历史。</p>
                        {:else}
                            <ul class="lvct-org-manager__member-list" aria-label="已移除组织的成员历史">
                                {#each members as member (member.id)}
                                    <li class="lvct-org-manager__member" data-membership-id={member.id} data-person-doc-id={member.personDocId}>
                                        {@render memberIdentity(member)}
                                        {#if onOpenPerson}
                                            <button type="button" class="b3-button b3-button--text" disabled={busy || memberLoading || organizationsRefreshing || selectionGuardBusy}
                                                onclick={() => onOpenPerson?.(member.personDocId, currentOrgDocId)}>{text("orgCommonOpen", "查看详情")}</button>
                                        {/if}
                                    </li>
                                {/each}
                            </ul>
                            {@render memberPagination()}
                        {/if}
                    </div>
                {:else}
                <div class="lvct-org-manager__members" aria-busy={busy}>
                    <div class="fn__flex" style="gap: 8px; align-items: center; flex-wrap: wrap;">
                        <b>{text("orgMembersTitle", "成员")}</b>
                        <span class="ft__smaller ft__on-surface">{memberSummary.people} 人 · {memberSummary.active} 条当前 · {memberSummary.former} 条历史</span>
                        <button type="button" class="b3-button b3-button--outline"
                            disabled={busy || loading || organizationsRefreshing || memberLoading || selectionGuardBusy || !!memberError || memberTotal === 0}
                            title={memberTotal === 0 ? "当前筛选没有可导出的成员" : undefined}
                            onclick={() => void exportFilteredMembers("csv")}>{memberExporting ? "准备导出…" : "下载 CSV"}</button>
                        <button type="button" class="b3-button b3-button--outline"
                            disabled={busy || loading || organizationsRefreshing || memberLoading || selectionGuardBusy || !!memberError || memberTotal === 0}
                            title={memberTotal === 0 ? "当前筛选没有可复制的成员" : undefined}
                            onclick={() => void exportFilteredMembers("copy-tsv")}>{memberExporting ? "处理中…" : "复制 TSV"}</button>
                        <button type="button" class="b3-button b3-button--primary lvct-org-manager__add-toggle"
                            disabled={busy || loading || memberError !== "" || selectionGuardBusy || !!editingMemberId || !!replacingMemberId || !!movingMemberId || !!removingMemberId}
                            onclick={toggleAddMember}>
                            {showAddMember ? text("orgMemberAddCollapse", "收起添加") : text("orgMemberAdd", "添加成员")}</button>
                    </div>
                    <div class="fn__flex lvct-org-manager__member-controls" style="gap: 8px; margin: 8px 0; align-items: center; flex-wrap: wrap;">
                        <label class="lvct-org-manager__select-all" style="display: inline-flex; align-items: center; gap: 6px; cursor: pointer;">
                            <input
                                type="checkbox"
                                checked={allCurrentPageSelected}
                                onchange={(event) => toggleSelectAllCurrentPage((event.currentTarget as HTMLInputElement).checked)}
                                disabled={members.length === 0 || busy}
                            />
                            <span class="ft__smaller">全选本页</span>
                        </label>
                        <input class="b3-text-field fn__flex-1" type="search" bind:value={memberQuery}
                            placeholder={text("orgMemberSearch", "搜索姓名、部门、职位、状态或备注")}
                            aria-label={text("orgMemberSearch", "搜索姓名、部门、职位、状态或备注")}
                            oninput={() => reloadMembers(true)} disabled={busy || hasDraft || selectionGuardBusy} />
                        <select class="b3-select" bind:value={memberStatus} onchange={() => reloadMembers()} disabled={busy || hasDraft || selectionGuardBusy}
                            aria-label={text("orgMemberStatusFilter", "成员状态") }>
                            <option value="all">{text("orgMemberStatusAll", "全部状态")}</option>
                            <option value="active">{text("orgStatusActive", "在职/在读")}</option>
                            <option value="former">{text("orgStatusFormer", "已离开")}</option>
                        </select>
                        <span class="lvct-seg" role="group" aria-label="成员视图切换">
                            <button
                                type="button"
                                class="lvct-seg__item"
                                class:lvct-seg__item--active={memberViewMode === "grid"}
                                onclick={() => (memberViewMode = "grid")}
                                title="网格小卡片视图"
                            >卡片</button>
                            <button
                                type="button"
                                class="lvct-seg__item"
                                class:lvct-seg__item--active={memberViewMode === "list"}
                                onclick={() => (memberViewMode = "list")}
                                title="精简单列列表视图"
                            >列表</button>
                        </span>
                    </div>

                    <!-- 批量操作栏（当有选中成员时出现） -->
                    {#if selectedMemberIds.length > 0}
                        <div class="lvct-org-manager__batch-bar fn__flex" role="toolbar" aria-label="批量成员操作">
                            <span class="lvct-org-manager__batch-count">已选 <b>{selectedMemberIds.length}</b> 人</span>
                            <button
                                type="button"
                                class="b3-button b3-button--outline b3-button--small"
                                disabled={busy || batchOperating || currentOrg?.archived}
                                onclick={() => void batchUpdateStatus("active")}
                                title="批量设为在职/在读状态"
                            >设为在职</button>
                            <button
                                type="button"
                                class="b3-button b3-button--outline b3-button--small"
                                disabled={busy || batchOperating}
                                onclick={() => void batchUpdateStatus("former")}
                                title="批量设为已离开状态"
                            >设为离开</button>
                            <button
                                type="button"
                                class="b3-button b3-button--outline b3-button--small"
                                disabled={busy || batchOperating}
                                onclick={exportSelectedMembersTsv}
                                title="复制选中成员的 TSV 格式表格"
                            >复制 TSV</button>
                            <button
                                type="button"
                                class="b3-button b3-button--cancel b3-button--small"
                                disabled={busy || batchOperating}
                                onclick={() => (batchRemoveConfirm = !batchRemoveConfirm)}
                            >批量移除</button>
                            <button
                                type="button"
                                class="b3-button b3-button--text b3-button--small"
                                disabled={busy || batchOperating}
                                onclick={() => { selectedMemberIds = []; batchRemoveConfirm = false; }}
                            >取消选择</button>
                        </div>
                        {#if batchActionMessage}<p class="ft__smaller lvct-text-success" style="margin: 4px 0;" role="status">{batchActionMessage}</p>{/if}
                        {#if batchActionError}<p class="lvct-form__error" style="margin: 4px 0;" role="alert">{batchActionError}</p>{/if}
                        {#if batchRemoveConfirm}
                            <div class="lvct-org-manager__member-confirm" role="group" aria-label="确认批量移除">
                                <p>确定批量移除选中的 {selectedMemberIds.length} 条成员历史记录吗？将删除成员关系并重建双链，人物和组织文档均完整保留。</p>
                                <button class="b3-button b3-button--cancel" disabled={batchOperating || busy} onclick={batchRemoveSelected}>
                                    {batchOperating ? "批量移除中…" : `确认移除选中的 ${selectedMemberIds.length} 条记录`}
                                </button>
                                <button class="b3-button b3-button--outline" disabled={batchOperating || busy} onclick={() => (batchRemoveConfirm = false)}>取消</button>
                            </div>
                        {/if}
                    {/if}
                    {#if memberExportMessage}<p class="ft__smaller ft__on-surface" role="status" aria-live="polite">{memberExportMessage}</p>{/if}
                    {#if memberExportError}<p class="lvct-form__error" role="alert">{memberExportError}</p>{/if}
                    {#if showAddMember}
                        <div class="lvct-org-manager__add" class:lvct-org-manager__add--loading={memberLoading} aria-label={text("orgMemberAddPanel", "添加成员") }>
                            <p class="ft__smaller ft__on-surface">{text("orgMembershipAddImpact", "添加会登记新期间并更新双方当前双链；已离开的期间保留，重复添加当前成员不新增记录。")}</p>
                            {#if rosterError}
                                <p class="lvct-form__error" role="alert">{text("orgRosterReadError", "联系人名册读取失败") }：{rosterError}</p>
                                <button type="button" class="b3-button b3-button--outline" disabled={rosterLoading} onclick={() => void loadRoster()}>{text("orgRosterRetry", "重新读取联系人名册")}</button>
                            {:else if rosterLoading}
                                <p class="ft__smaller ft__on-surface" role="status">{text("orgRosterLoading", "正在读取联系人名册…")}</p>
                            {/if}
                            {#if !rosterLoading}
                                <PersonPicker
                                    items={addPickerItems}
                                    value={addPersonId}
                                    placeholder={text("orgAddMemberPick", "选择联系人…")}
                                    emptyText={text("orgPickerEmpty", "没有可选联系人")}
                                    searchText={text("orgPickerSearch", "输入姓名、电话、微信或文档 ID 筛选")}
                                    ariaLabel={text("orgAddMemberLabel", "选择要添加的联系人")}
                                    i18n={i18n}
                                    disabled={busy || !!memberError || !!rosterError || selectionGuardBusy || !!editingMemberId || !!replacingMemberId || !!removingMemberId || !!movingMemberId || renaming}
                                    onSelect={(personDocId) => (addPersonId = personDocId)}
                                />
                            {/if}
                            <label><span>{text("orgAffiliationKind", "归属分类")}</span>
                                <select class="b3-select fn__block" bind:value={addAffiliationKind} disabled={busy || !!memberError || !!rosterError || rosterLoading || selectionGuardBusy || !!editingMemberId || !!replacingMemberId || !!removingMemberId || !!movingMemberId || renaming} aria-label={text("orgAffiliationKind", "归属分类")}>
                                    <option value="work">{affiliationLabel("work")}</option><option value="education">{affiliationLabel("education")}</option><option value="family">{affiliationLabel("family")}</option><option value="unspecified">{affiliationLabel("unspecified")}</option>
                                </select></label>
                            <label><span>{text("orgMemberDeptLabel", "部门")}</span>
                                <input class="b3-text-field fn__block" bind:value={addDepartment} disabled={busy || !!memberError || !!rosterError || rosterLoading || selectionGuardBusy || !!editingMemberId || !!replacingMemberId || !!removingMemberId || !!movingMemberId || renaming}
                                    aria-label={text("orgMemberDeptLabel", "部门")} placeholder={text("orgMemberDeptPlaceholder", "可选，例如：产品部")} /></label>
                            <label><span>{text("orgMemberTitleLabel", "职位")}</span>
                                <input class="b3-text-field fn__block" bind:value={addTitle} disabled={busy || !!memberError || !!rosterError || rosterLoading || selectionGuardBusy || !!editingMemberId || !!replacingMemberId || !!removingMemberId || !!movingMemberId || renaming}
                                    aria-label={text("orgMemberTitleLabel", "职位")} placeholder={text("orgMemberTitlePlaceholder", "可选，例如：项目负责人")} /></label>
                            <label><span>{text("orgMemberStatusLabel", "状态")}</span>
                                <select class="b3-select fn__block" value={addStatus} onchange={(event) => changeAddStatus(event.currentTarget.value as OrgMembershipStatus)} disabled={busy || !!memberError || !!rosterError || rosterLoading || selectionGuardBusy || !!editingMemberId || !!replacingMemberId || !!removingMemberId || !!movingMemberId || renaming} aria-label={text("orgMemberStatusLabel", "状态")}>
                                    <option value="active" disabled={Boolean(currentOrg?.archived)}>{text("orgStatusActive", "在职/在读")}</option><option value="former">{text("orgStatusFormer", "已离开/毕业")}</option>
                                </select></label>
                            <label><span>{text("orgMemberCustomStatus", "自定义状态")}</span><input class="b3-text-field fn__block" maxlength="40" bind:value={addStatusLabel} disabled={busy || !!memberError || !!rosterError || rosterLoading || selectionGuardBusy || !!editingMemberId || !!replacingMemberId || !!removingMemberId || !!movingMemberId || renaming} placeholder={text("orgMemberCustomStatusPlaceholder", "例如：实习、兼职、休学")} /></label>
                            <label><span>{text("orgMemberJoinedLabel", "加入日期")}</span><input class="b3-text-field fn__block" type="date" bind:value={addJoinedOn} disabled={busy || !!memberError || !!rosterError || rosterLoading || selectionGuardBusy || !!editingMemberId || !!replacingMemberId || !!removingMemberId || !!movingMemberId || renaming} aria-label={text("orgMemberJoinedLabel", "加入日期")} /></label>
                            <label><span>{text("orgMemberLeftLabel", "离开日期")}</span><input class="b3-text-field fn__block" type="date" bind:value={addLeftOn} disabled={busy || addStatus === "active" || !!memberError || !!rosterError || rosterLoading || selectionGuardBusy || !!editingMemberId || !!replacingMemberId || !!removingMemberId || !!movingMemberId || renaming} aria-label={text("orgMemberLeftLabel", "离开日期")} /></label>
                            <label class="lvct-org-manager__add-note"><span>{text("orgMemberNote", "成员备注")}</span><input class="b3-text-field fn__block" maxlength="240" bind:value={addNote} disabled={busy || !!memberError || !!rosterError || rosterLoading || selectionGuardBusy || !!editingMemberId || !!replacingMemberId || !!removingMemberId || !!movingMemberId || renaming} placeholder={text("orgMemberNotePlaceholder", "仅记录这段组织经历")} /></label>
                            {#if currentOrg?.archived}<p class="ft__smaller ft__on-surface">{text("orgArchivedAddHistoryOnly", "组织已归档，只能补录历史成员记录。")} </p>{/if}
                            <button class="b3-button b3-button--text"
                                disabled={busy || !!memberError || !!rosterError || rosterLoading || selectionGuardBusy || !addPersonId}
                                title={busy || rosterLoading ? "联系人名册仍在读取，请稍候" : memberError || rosterError ? "请先重新读取联系人名册或成员列表" : selectionGuardBusy ? "正在核对组织关系，请稍候" : !addPersonId ? "请选择联系人后再添加成员" : undefined}
                                onclick={addMember}>{busy && formBusyLabel === "添加中…" ? "添加中…" : text("orgMemberAdd", "添加成员")}</button>
                        </div>
                    {/if}
                    {#if memberError}
                        <ViewState compact error title={text("orgMembersError", "成员读取失败，结果尚未核实")} description={memberError}>
                            <button type="button" class="b3-button b3-button--outline" onclick={retryMembers} disabled={busy || memberLoading || organizationsRefreshing || hasDraft || selectionGuardBusy}>{text("commonRetry", "重试")}</button>
                        </ViewState>
                    {/if}
                    {#if memberLoading && members.length === 0}
                        <ViewState compact loading title={text("orgMembersLoading", "正在加载成员…")} />
                    {:else if members.length === 0 && !memberError}
                        <p class="ft__smaller ft__on-surface">{memberQuery.trim() || memberStatus !== "all" ? text("orgMembersNoMatch", "当前筛选没有匹配成员。") : text("orgMembersEmpty", "暂无成员。从下方添加。")}</p>
                    {:else if members.length > 0}
                        <ul class="lvct-org-manager__member-list" class:lvct-org-manager__member-list--grid={memberViewMode === "grid"}>
                            {#each members as member (member.id)}
                                <li class="lvct-org-manager__member" class:lvct-org-manager__member--selected={selectedMemberIds.includes(member.id)} data-membership-id={member.id} data-person-doc-id={member.personDocId}>
                                    {#if replacingMemberId === member.id}
                                        <div class="lvct-org-manager__member-edit">
                                            <p class="ft__smaller ft__on-surface">{text("orgMemberReplaceHint", "关闭原成员的在职记录，并以一次原子操作登记接替成员。")}</p>
                                            <label>{text("orgMemberReplacementPick", "接替联系人")}
                                                <PersonPicker
                                                    items={replacementPickerItems}
                                                    value={replacementPersonId}
                                                    placeholder={text("orgAddMemberPick", "选择联系人…")}
                                                    emptyText={text("orgPickerEmpty", "没有可选联系人")}
                                                    searchText={text("orgPickerSearch", "输入姓名、电话、微信或文档 ID 筛选")}
                                                    ariaLabel={text("orgMemberReplacementPick", "接替联系人")}
                                                    i18n={i18n}
                                                    disabled={busy || rosterLoading || !!rosterError}
                                                    onSelect={(personDocId) => (replacementPersonId = personDocId)}
                                                />
                                            </label>
                                            <label>{text("orgMemberDeptLabel", "部门")}
                                                <input class="b3-text-field fn__block" bind:value={replacementDepartment} disabled={busy}
                                                    aria-label={text("orgMemberDeptLabel", "部门")} /></label>
                                            <label>{text("orgMemberTitleLabel", "职位")}
                                                <input class="b3-text-field fn__block" bind:value={replacementTitle} disabled={busy}
                                                    aria-label={text("orgMemberTitleLabel", "职位")} /></label>
                                            <label>{text("orgAffiliationKind", "归属分类")}
                                                <select class="b3-select fn__block" bind:value={replacementAffiliationKind} disabled={busy} aria-label={text("orgAffiliationKind", "归属分类")}>
                                                    <option value="work">{affiliationLabel("work")}</option>
                                                    <option value="education">{affiliationLabel("education")}</option>
                                                    <option value="family">{affiliationLabel("family")}</option>
                                                    <option value="unspecified">{affiliationLabel("unspecified")}</option>
                                                </select></label>
                                            <label>{text("orgMemberFormerLeftLabel", "原成员离开日期")}
                                                <input class="b3-text-field fn__block" type="date" bind:value={replacementLeftOn} disabled={busy}
                                                    aria-label={text("orgMemberFormerLeftLabel", "原成员离开日期")} /></label>
                                            <label>{text("orgMemberReplacementJoinedLabel", "接替成员加入日期")}
                                                <input class="b3-text-field fn__block" type="date" bind:value={replacementJoinedOn} disabled={busy}
                                                    aria-label={text("orgMemberReplacementJoinedLabel", "接替成员加入日期")} /></label>
                                            <div class="fn__flex" style="gap: 8px;">
                                                <button type="button" class="b3-button b3-button--text"
                                                    disabled={busy || !replacementPersonId || !replacementJoinedOn || !replacementLeftOn}
                                                    title={busy ? "成员资料保存中，请稍候" : !replacementPersonId ? "请选择接替联系人" : !replacementJoinedOn || !replacementLeftOn ? "请填写接替成员加入日期和原成员离开日期" : undefined}
                                                    onclick={saveReplaceMember}>{busy && formBusyLabel === "接替中…" ? "接替中…" : text("orgMemberReplaceSave", "保存接替")}</button>
                                                <button type="button" class="b3-button b3-button--cancel" disabled={busy}
                                                    onclick={cancelReplaceMember}>{text("orgMemberReplaceCancel", "取消")}</button>
                                            </div>
                                        </div>
                                    {:else if movingMemberId === member.id}
                                        <div class="lvct-org-manager__member-edit">
                                            <p class="ft__smaller ft__on-surface">{text("orgMemberMoveHint", "移动会保留这段成员经历的职位、日期、状态和备注，只改变所属组织。")}</p>
                                            <label><span>{text("orgMemberMoveTarget", "移动到组织")}</span>
                                                <select class="b3-select fn__block" bind:value={moveTargetOrgId} disabled={busy} aria-label={text("orgMemberMoveTarget", "移动到组织")}>
                                                    <option value="">{text("orgMemberMoveTargetPlaceholder", "选择目标组织…")}</option>
                                                    {#each moveTargets as target (target.docId)}
                                                        <option value={target.docId} title={organizationOptionLabel(target, orgs)}>{organizationOptionLabel(target, orgs)}{target.archived ? `（${text("orgArchivedTag", "已归档")}）` : ""}</option>
                                                    {/each}
                                                </select>
                                            </label>
                                            <div class="fn__flex" style="gap: 8px; flex-wrap: wrap;">
                                                <button type="button" class="b3-button b3-button--text"
                                                    disabled={busy || !moveTargetOrgId}
                                                    title={busy ? "成员资料保存中，请稍候" : !moveTargetOrgId ? "请选择目标组织后再移动" : undefined}
                                                    onclick={saveMoveMember}>{busy && formBusyLabel === "移动中…" ? "移动中…" : text("orgMemberMoveSave", "确认移动")}</button>
                                                <button type="button" class="b3-button b3-button--cancel" disabled={busy} onclick={cancelMoveMember}>{text("orgMemberMoveCancel", "取消移动")}</button>
                                            </div>
                                        </div>
                                    {:else if editingMemberId === member.id}
                                        <div class="lvct-org-manager__member-edit">
                                            <label>{text("orgMemberDeptLabel", "部门")}
                                                <input class="b3-text-field fn__block" bind:value={editDepartment} disabled={busy}
                                                    aria-label={text("orgMemberDeptLabel", "部门")} /></label>
                                            <label>{text("orgMemberTitleLabel", "职位")}
                                                <input class="b3-text-field fn__block" bind:value={editTitle} disabled={busy}
                                                    aria-label={text("orgMemberTitleLabel", "职位")} /></label>
                                            <label>{text("orgMemberJoinedLabel", "加入日期")}
                                                <input class="b3-text-field fn__block" type="date" bind:value={editJoinedOn} disabled={busy}
                                                    aria-label={text("orgMemberJoinedLabel", "加入日期")} /></label>
                                            <label>{text("orgMemberLeftLabel", "离开日期")}
                                                <input class="b3-text-field fn__block" type="date" bind:value={editLeftOn} disabled={busy || editStatus === "active"}
                                                    aria-label={text("orgMemberLeftLabel", "离开日期")} /></label>
                                            <label>{text("orgMemberStatusLabel", "状态")}
                                                <select class="b3-select fn__block" value={editStatus} onchange={(event) => changeEditStatus(event.currentTarget.value as OrgMembershipStatus)} disabled={busy}
                                                    aria-label={text("orgMemberStatusLabel", "状态")}>
                                                    <option value="active" disabled={Boolean(currentOrg?.archived) && editingMemberSnapshot?.status !== "active"}>{text("orgStatusActive", "当前在职/就读")}</option>
                                                    <option value="former">{text("orgStatusFormer", "已离开/毕业")}</option>
                                                </select></label>
                                            <label><span>{text("orgMemberCustomStatus", "自定义状态")}</span><input class="b3-text-field fn__block" maxlength="40" bind:value={editStatusLabel} disabled={busy} placeholder={text("orgMemberCustomStatusPlaceholder", "例如：实习、兼职、休学")} /></label>
                                            <label><span>{text("orgMemberNote", "成员备注")}</span><input class="b3-text-field fn__block" maxlength="240" bind:value={editNote} disabled={busy} placeholder={text("orgMemberNotePlaceholder", "仅记录这段组织经历")} /></label>
                                            <label>{text("orgAffiliationKind", "归属分类")}
                                                <select class="b3-select fn__block" bind:value={editAffiliationKind} disabled={busy} aria-label={text("orgAffiliationKind", "归属分类")}>
                                                    <option value="work">{affiliationLabel("work")}</option>
                                                    <option value="education">{affiliationLabel("education")}</option>
                                                    <option value="family">{affiliationLabel("family")}</option>
                                                    <option value="unspecified">{affiliationLabel("unspecified")}</option>
                                                </select></label>
                                                <p class="ft__smaller ft__on-surface">{currentOrg?.archived ? "该组织已归档，可保留原状态维护现存记录；只有明确改为已离开才会结束该段经历。不能新增当前归属或将历史记录恢复为当前。" : text("orgMembershipEditImpact", "保存会更新这段成员记录及双方当前双链；离开保留历史。恢复在职/在学须清空离开日期。")}</p>
                                            <div class="fn__flex" style="gap: 8px;">
                                                <button type="button" class="b3-button b3-button--text" disabled={busy}
                                                    onclick={saveEditMember}>{busy && formBusyLabel === "保存中…" ? "保存中…" : text("orgMemberSave", "保存")}</button>
                                                <button type="button" class="b3-button b3-button--cancel" disabled={busy}
                                                    onclick={cancelEditMember}>{text("orgMemberCancel", "取消")}</button>
                                            </div>
                                        </div>
                                    {:else}
                                        <div class="lvct-org-manager__member-card-body fn__flex" style="align-items: flex-start; gap: 8px; width: 100%;">
                                            <span class="lvct-org-manager__member-checkbox-wrap" role="presentation" onclick={(event) => event.stopPropagation()} style="margin-top: 3px;">
                                                <input
                                                    type="checkbox"
                                                    class="lvct-org-manager__member-checkbox"
                                                    checked={selectedMemberIds.includes(member.id)}
                                                    aria-label={`选择 ${member.personName}`}
                                                    onclick={(event) => event.stopPropagation()}
                                                    onchange={(event) => toggleMemberSelected(member.id, (event.currentTarget as HTMLInputElement).checked)}
                                                />
                                            </span>
                                            {@render memberIdentity(member)}
                                        </div>
                                        <span class="lvct-org-manager__member-actions" data-member-actions>
                                            {#if onOpenPerson}
                                                <button type="button" class="b3-button b3-button--text" disabled={busy || memberLoading || organizationsRefreshing || hasDraft || selectionGuardBusy || !!movingMemberId}
                                                    onclick={() => onOpenPerson?.(member.personDocId, currentOrgDocId)}>{text("orgCommonOpen", "查看详情")}</button>
                                            {/if}
                                            <button type="button" class="b3-button b3-button--text" disabled={busy || hasDraft || !!memberError || !!movingMemberId}
                                                onclick={() => startEditMember(member)}>{text("orgMemberEdit", "编辑")}</button>
                                            <button type="button" class="b3-button b3-button--text lvct-org-manager__member-more"
                                                aria-expanded={expandedMemberId === member.id} aria-controls={`lvct-member-actions-${member.id}`}
                                                aria-label={`更多成员操作：${member.personName}`}
                                                disabled={busy || hasDraft || !!memberError || !!movingMemberId}
                                                onclick={() => void toggleMemberActions(member.id)}>更多</button>
                                            {#if expandedMemberId === member.id}
                                                <span id={`lvct-member-actions-${member.id}`} class="lvct-org-manager__member-menu" role="group" aria-label={`更多成员操作：${member.personName}`}>
                                                    {#if facade.moveOrganizationMember}
                                                        <button type="button" class="b3-button b3-button--text" disabled={busy || hasDraft || !!memberError || !!movingMemberId}
                                                            onclick={() => startMoveMember(member)}>{text("orgMemberMove", "移动")}</button>
                                                    {/if}
                                                    {#if member.status === "active" && !currentOrg?.archived}
                                                        <button type="button" class="b3-button b3-button--text" disabled={busy || hasDraft || !!memberError || !!movingMemberId}
                                                            onclick={() => startReplaceMember(member)}>{text("orgMemberReplace", "接替")}</button>
                                                    {/if}
                                                    <button type="button" class="b3-button b3-button--cancel" disabled={busy || hasDraft || !!memberError || !!movingMemberId}
                                                        onclick={() => { removingMemberId = member.id; expandedMemberId = ""; removingMemberSnapshot = { ...member }; }}>
                                                        {text("orgMemberRemove", "移除")}</button>
                                                </span>
                                            {/if}
                                        </span>
                                        {#if removingMemberId === member.id}
                                            <div class="lvct-org-manager__member-confirm" role="group" aria-label={text("orgMembershipRemoveConfirm", "确认移除这段成员历史")}>
                                                <p>{text("orgMembershipRemoveImpact", "将删除这段成员历史并重建双方当前双链。普通离职请编辑为已离开；人物和组织文档保留。")}</p>
                                                <button class="b3-button b3-button--cancel" disabled={busy} onclick={() => removeMember(member.id)}>{busy && formBusyLabel === "移除中…" ? "移除中…" : text("orgMembershipRemoveConfirm", "确认移除这段成员历史")}</button>
                                                <button class="b3-button b3-button--outline" disabled={busy} onclick={() => (removingMemberId = "")}>{text("orgMemberCancel", "取消")}</button>
                                            </div>
                                        {/if}
                                    {/if}
                                </li>
                            {/each}
                        </ul>
                        {@render memberPagination()}
                    {/if}
                </div>
                {/if}
            {:else if organizationReadError && orgs.length === 0}
                <p class="ft__smaller ft__on-surface" role="status">组织列表读取失败，请先在左侧重新读取后再查看成员。</p>
            {:else}
                <p class="ft__smaller ft__on-surface">{text("orgPickHint", "从左侧选择一个组织查看成员。")}</p>
            {/if}
        </div>
    </div>
    {#if (errorMessage && errorMessage !== organizationReadError) || refreshNeeded}
        {#if errorMessage && errorMessage !== organizationReadError}<div class="lvct-form__error" role="alert">{errorMessage}</div>{/if}
        <button class="b3-button b3-button--outline" disabled={busy || loading || memberLoading || organizationsRefreshing || selectionGuardBusy || hasDraft} onclick={reloadOrganizations}>{text("orgMembershipReloadAll", "重新读取组织和成员")}</button>
    {/if}
    <OrgMembershipResult report={membershipReport} {i18n} />
    <OrgOperationRecovery {facade} refreshKey={recoveryRefreshKey} disabled={busy || loading || organizationsRefreshing || memberLoading || selectionGuardBusy || hasDraft}
        onBusyChange={(value) => { recoveryBusy = value; }}
        onRecovered={async (docId) => {
            if (!alive) return;
            currentOrgDocId = docId;
            await loadOrgs(true);
        }} />
    <div class="lvct-org-manager__footer">
        <button class="b3-button b3-button--cancel" onclick={() => void guardedClose(onClose)} disabled={busy || selectionGuardBusy}>{text("orgClose", "关闭")}</button>
    </div>
</div>
