<script lang="ts">
    /** B13.5a 组织视图：组织卡片列表（活跃/归档），管理动作经组织管理弹窗承载。
     *  数据经 facade（listOrganizations），读取失败显式错误可重试（读故障显式化）。 */
    import { Building2, Plus } from "@lucide/svelte";
    import ViewState from "../ViewState.svelte";
    import { translateText } from "../../domain/translation";
    import type { ContactsPluginFacade } from "../../types";
    import type { OrganizationWithMembers } from "../../services/org";
    import { filterOrganizations, type OrganizationStatusFilter } from "../../domain/organization-scan";
    import { onDestroy } from "svelte";

    let {
        facade,
        revision = 0,
        i18n,
        onOpenOrgManager,
        onCreateOrganization,
        onEditOrganization,
    }: {
        facade: ContactsPluginFacade;
        revision?: number;
        i18n?: Readonly<Record<string, string>>;
        onOpenOrgManager: (docId?: string) => void;
        onCreateOrganization?: () => void;
        onEditOrganization?: (docId: string) => void;
    } = $props();
    const text = $derived.by(() => (key: string, fallback: string, values?: Record<string, string | number>) =>
        translateText(i18n, key, fallback, values));

    let orgs: OrganizationWithMembers[] = $state([]);
    let loading = $state(true);
    let errorText = $state("");
    let organizationCursor = $state<string | null>(null);
    let organizationHasMore = $state(false);
    let organizationLoadingMore = $state(false);
    let organizationLoadError = $state("");
    let organizationQuery = $state("");
    let organizationStatus = $state<OrganizationStatusFilter>("all");
    let refreshVersion = 0;
    let organizationLoadGeneration = 0;
    let alive = true;
    onDestroy(() => { alive = false; refreshVersion += 1; organizationLoadGeneration += 1; });

    async function refresh() {
        const version = ++refreshVersion;
        loading = true;
        errorText = "";
        organizationLoadError = "";
        organizationLoadingMore = false;
        organizationCursor = null;
        organizationHasMore = false;
        const generation = ++organizationLoadGeneration;
        try {
            if (facade.listOrganizationsPage) {
                const page = await facade.listOrganizationsPage({ limit: 200 });
                if (!alive || version !== refreshVersion || generation !== organizationLoadGeneration) return;
                if (page.hasMore && !page.nextRootId) throw new Error("组织首屏分页缺少后续游标，已停止继续读取");
                orgs = page.organizations;
                organizationCursor = page.nextRootId;
                organizationHasMore = page.hasMore;
                loading = false;
                void loadRemainingOrganizations(version, generation);
                return;
            }
            const result = await facade.listOrganizations();
            if (version === refreshVersion) orgs = result;
        } catch (error) {
            if (version === refreshVersion) errorText = error instanceof Error ? error.message : String(error);
        } finally {
            if (version === refreshVersion) loading = false;
        }
    }

    async function loadRemainingOrganizations(version: number, generation: number) {
        if (!facade.listOrganizationsPage || !organizationHasMore || !organizationCursor) return;
        organizationLoadingMore = true;
        organizationLoadError = "";
        try {
            while (organizationHasMore && organizationCursor && alive
                && version === refreshVersion && generation === organizationLoadGeneration) {
                const page = await facade.listOrganizationsPage({ afterRootId: organizationCursor, limit: 200 });
                if (!alive || version !== refreshVersion || generation !== organizationLoadGeneration) return;
                if (page.organizations.length === 0 && page.hasMore) throw new Error("组织分页返回空页但仍有后续数据，已停止继续读取");
                const known = new Set(orgs.map((org) => org.docId));
                const duplicate = page.organizations.find((org) => known.has(org.docId));
                if (duplicate) throw new Error(`组织分页出现重复文档「${duplicate.name}」，已停止继续读取`);
                if (page.hasMore && !page.nextRootId) throw new Error("组织分页缺少后续游标，已停止继续读取");
                orgs = [...orgs, ...page.organizations];
                organizationCursor = page.nextRootId;
                organizationHasMore = page.hasMore;
            }
        } catch (error) {
            if (alive && version === refreshVersion && generation === organizationLoadGeneration) {
                organizationLoadError = error instanceof Error ? error.message : String(error);
            }
        } finally {
            if (generation === organizationLoadGeneration) organizationLoadingMore = false;
        }
    }

    function retryRemainingOrganizations() {
        if (organizationLoadingMore || !organizationHasMore || !organizationCursor) return;
        void loadRemainingOrganizations(refreshVersion, organizationLoadGeneration);
    }

    $effect(() => {
        revision;
        void refresh();
    });

    /* 卡片排序：活跃在前（名称序），归档垫底 */
    const sortedOrgs = $derived.by(() => {
        const active = orgs.filter((org) => !org.archived).sort((first, second) => first.name.localeCompare(second.name, "zh-Hans-CN") || first.docId.localeCompare(second.docId));
        const archived = orgs.filter((org) => org.archived).sort((first, second) => first.name.localeCompare(second.name, "zh-Hans-CN") || first.docId.localeCompare(second.docId));
        return [...active, ...archived];
    });
    const filteredOrgs = $derived.by(() => {
        return filterOrganizations(sortedOrgs, { query: organizationQuery, status: organizationStatus });
    });
    const organizationFilterActive = $derived(organizationQuery.trim().length > 0 || organizationStatus !== "all");
    const activeCountOf = (org: OrganizationWithMembers) => org.memberships.filter((membership) => membership.status === "active").length;
    const formerCountOf = (org: OrganizationWithMembers) => org.memberships.filter((membership) => membership.status === "former").length;
</script>

<div class="lvct-orgs-view">
    <div class="lvct-people__toolbar lvct-people__control-surface fn__flex">
        <span class="ft__smaller ft__on-surface">
            {#if loading || errorText}
                <span role="status">{text("orgsCountUnknown", "组织数量待核实")}</span>
            {:else if organizationLoadingMore}
                <span role="status">已读取 {orgs.length} 个组织，正在继续读取…</span>
            {:else if organizationLoadError}
                <span role="alert">后续组织读取失败：{organizationLoadError}</span>
            {:else if organizationHasMore}
                <span role="status">已读取 {orgs.length} 个组织，仍有后续组织待读取。</span>
            {:else}
                {text("orgsViewSummary", "共 {total} 个组织，{archived} 个已归档。成员的加入与离开在组织管理中维护。", { total: orgs.length, archived: orgs.filter((org) => org.archived).length })}
                {#if organizationFilterActive} · {text("orgsFilteredSummary", "当前显示 {shown} 个", { shown: filteredOrgs.length })}{/if}
            {/if}
        </span>
        <span class="fn__flex-1"></span>
        <input
            class="b3-text-field lvct-orgs-view__filter"
            type="search"
            aria-label={text("orgsSearchLabel", "搜索组织")}
            placeholder={text("orgsSearchPlaceholder", "按组织名称搜索")}
            bind:value={organizationQuery}
            disabled={loading || !!errorText}
        />
        <select class="b3-select lvct-orgs-view__filter" aria-label={text("orgsStatusLabel", "组织状态")} bind:value={organizationStatus} disabled={loading || !!errorText}>
            <option value="all">{text("orgsStatusAll", "全部状态")}</option>
            <option value="active">{text("orgsStatusActive", "仅活跃")}</option>
            <option value="archived">{text("orgsStatusArchived", "仅已归档")}</option>
        </select>
        {#if organizationFilterActive}
            <button type="button" class="b3-button b3-button--text" onclick={() => { organizationQuery = ""; organizationStatus = "all"; }}>
                {text("orgsClearFilters", "清除筛选")}
            </button>
        {/if}
        <!-- B13.8：手动对账入口（外部编辑无通知时，打开时对账 + 手动刷新兜底） -->
        <button type="button" class="b3-button b3-button--text" onclick={() => void refresh()} disabled={loading}>
            {text("graphReload", "重新加载")}</button>
        <button type="button" class="b3-button b3-button--text" onclick={() => onOpenOrgManager()}>
            {text("orgsManage", "组织管理")}
        </button>
        {#if onCreateOrganization}<button type="button" class="b3-button b3-button--primary" onclick={onCreateOrganization}><Plus size={15} />{text("orgsCreateFirst", "新建组织")}</button>{/if}
        {#if organizationLoadError}
            <button type="button" class="b3-button b3-button--text" onclick={retryRemainingOrganizations} disabled={organizationLoadingMore}>
                继续读取
            </button>
        {/if}
    </div>

    {#if errorText}
        <ViewState error title={text("orgsLoadFailTitle", "组织列表加载失败")} description={errorText}>
            <button type="button" class="b3-button b3-button--outline" onclick={() => void refresh()}>{text("graphReload", "重新加载")}</button>
        </ViewState>
    {/if}
    {#if loading && orgs.length === 0 && !errorText}
        <ViewState loading title={text("orgsLoading", "正在加载组织…")} />
    {:else if filteredOrgs.length === 0 && !errorText && !loading && organizationLoadError}
        <ViewState error title="组织列表读取未完成" description={`已读取 ${orgs.length} 个组织，后续读取失败：${organizationLoadError}`}>
            <button type="button" class="b3-button b3-button--outline" disabled={organizationLoadingMore} onclick={retryRemainingOrganizations}>
                {organizationLoadingMore ? "正在继续读取…" : "继续读取"}
            </button>
        </ViewState>
    {:else if filteredOrgs.length === 0 && !errorText && !loading && !organizationLoadError && organizationFilterActive}
        <ViewState title={text("orgsNoMatchTitle", "没有匹配的组织")}
            description={text("orgsNoMatchDesc", "试试其他名称或清除筛选条件。")}>
            <button type="button" class="b3-button b3-button--outline" onclick={() => { organizationQuery = ""; organizationStatus = "all"; }}>{text("orgsClearFilters", "清除筛选")}</button>
        </ViewState>
    {:else if filteredOrgs.length === 0 && !errorText && !loading && !organizationLoadError}
        <ViewState title={text("orgsEmptyTitle", "还没有组织")}
            description={text("orgsEmptyDesc", "在组织管理中新建组织（公司/学校等），再为联系人登记归属。")}>
            <button type="button" class="b3-button b3-button--outline" onclick={() => onOpenOrgManager()}>{text("orgsManage", "打开组织管理")}</button>
            {#if onCreateOrganization}<button type="button" class="b3-button b3-button--primary" onclick={onCreateOrganization}>{text("orgsCreateFirst", "新建组织")}</button>{/if}
        </ViewState>
    {:else if filteredOrgs.length > 0}
        <div class="lvct-orgs-view__grid">
            {#each filteredOrgs as org (org.docId)}
                <div class="lvct-orgs-view__card" data-org-doc-id={org.docId} class:lvct-orgs-view__card--archived={org.archived}>
                    <div class="lvct-orgs-view__card-head">
                        {#if org.profile?.logoDataUrl || org.profile?.logoUrl}
                            <img class="lvct-orgs-view__card-logo" src={org.profile.logoDataUrl || org.profile.logoUrl} alt="" />
                        {:else}
                            <span class="lvct-orgs-view__card-icon" aria-hidden="true"><Building2 size={16} /></span>
                        {/if}
                        <b class="lvct-orgs-view__card-name">{org.name}</b>
                        {#if org.profile?.shortName}<span class="lvct-chip lvct-chip--group">{org.profile.shortName}</span>{/if}
                        {#if org.archived}<span class="lvct-chip lvct-chip--group">{text("orgArchivedTag", "已归档")}</span>{/if}
                    </div>
                    {#if org.profile?.description}<p class="lvct-orgs-view__card-description">{org.profile.description}</p>{/if}
                    <div class="ft__smaller ft__on-surface">
                        {text("orgsCardMembers", "{n} 名在职/在读成员", { n: activeCountOf(org) })}
                        {#if formerCountOf(org) > 0}<span class="lvct-orgs-view__card-history"> · {formerCountOf(org)} 条历史</span>{/if}
                    </div>
                    <div class="lvct-orgs-view__card-actions">
                        <button type="button" class="b3-button b3-button--text" disabled={loading || !!errorText} onclick={() => onOpenOrgManager(org.docId)}>
                            {text("orgsManageOrg", "管理")}</button>
                        {#if onEditOrganization}<button type="button" class="b3-button b3-button--text" disabled={loading || !!errorText} onclick={() => onEditOrganization?.(org.docId)}>
                            {text("orgsEditProfile", "编辑资料")}</button>{/if}
                    </div>
                </div>
            {/each}
        </div>
    {/if}
</div>
