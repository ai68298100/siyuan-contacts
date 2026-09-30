<script lang="ts">
    /** B13.5a 组织视图：组织卡片列表（活跃/归档），管理动作经组织管理弹窗承载。
     *  数据经 facade（listOrganizations），读取失败显式错误可重试（读故障显式化）。 */
    import { Building2, Plus } from "@lucide/svelte";
    import ViewState from "../ViewState.svelte";
    import { translateText } from "../../domain/translation";
    import type { ContactsPluginFacade } from "../../types";
    import type { OrganizationWithMembers } from "../../services/org";

    let {
        facade,
        revision = 0,
        i18n,
        onOpenOrgManager,
    }: {
        facade: ContactsPluginFacade;
        revision?: number;
        i18n?: Readonly<Record<string, string>>;
        onOpenOrgManager: () => void;
    } = $props();
    const text = $derived.by(() => (key: string, fallback: string, values?: Record<string, string | number>) =>
        translateText(i18n, key, fallback, values));

    let orgs: OrganizationWithMembers[] = $state([]);
    let loading = $state(true);
    let errorText = $state("");
    let refreshVersion = 0;

    async function refresh() {
        const version = ++refreshVersion;
        loading = true;
        errorText = "";
        try {
            const result = await facade.listOrganizations();
            if (version === refreshVersion) orgs = result;
        } catch (error) {
            if (version === refreshVersion) errorText = error instanceof Error ? error.message : String(error);
        } finally {
            if (version === refreshVersion) loading = false;
        }
    }

    $effect(() => {
        revision;
        void refresh();
    });

    /* 卡片排序：活跃在前（名称序），归档垫底 */
    const sortedOrgs = $derived.by(() => {
        const active = orgs.filter((org) => !org.archived).sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN"));
        const archived = orgs.filter((org) => org.archived).sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN"));
        return [...active, ...archived];
    });
    const activeCountOf = (org: OrganizationWithMembers) => org.memberships.filter((membership) => membership.status === "active").length;
</script>

<div class="lvct-orgs-view">
    <div class="lvct-people__toolbar fn__flex">
        <span class="ft__smaller ft__on-surface">
            {text("orgsViewSummary", "共 {total} 个组织，{archived} 个已归档。成员的加入与离开在组织管理中维护。", { total: orgs.length, archived: orgs.filter((org) => org.archived).length })}
        </span>
        <span class="fn__flex-1"></span>
        <button type="button" class="b3-button b3-button--text" onclick={onOpenOrgManager}>
            <Plus size={15} />{text("orgsManage", "组织管理")}
        </button>
    </div>

    {#if errorText}
        <ViewState error title={text("orgsLoadFailTitle", "组织列表加载失败")} description={errorText}>
            <button type="button" class="b3-button b3-button--outline" onclick={() => void refresh()}>{text("graphReload", "重新加载")}</button>
        </ViewState>
    {:else if loading}
        <ViewState loading title={text("orgsLoading", "正在加载组织…")} />
    {:else if sortedOrgs.length === 0}
        <ViewState title={text("orgsEmptyTitle", "还没有组织")}
            description={text("orgsEmptyDesc", "在组织管理中新建组织（公司/学校等），再为联系人登记归属。")}>
            <button type="button" class="b3-button b3-button--outline" onclick={onOpenOrgManager}>{text("orgsCreateFirst", "新建组织")}</button>
        </ViewState>
    {:else}
        <div class="lvct-orgs-view__grid">
            {#each sortedOrgs as org (org.docId)}
                <div class="lvct-orgs-view__card" class:lvct-orgs-view__card--archived={org.archived}>
                    <div class="lvct-orgs-view__card-head">
                        <span class="lvct-orgs-view__card-icon" aria-hidden="true"><Building2 size={16} /></span>
                        <b class="lvct-orgs-view__card-name">{org.name}</b>
                        {#if org.archived}<span class="lvct-chip lvct-chip--group">{text("orgArchivedTag", "已归档")}</span>{/if}
                    </div>
                    <div class="ft__smaller ft__on-surface">
                        {text("orgsCardMembers", "{n} 名在职/在读成员", { n: activeCountOf(org) })}
                    </div>
                    <div class="lvct-orgs-view__card-actions">
                        <button type="button" class="b3-button b3-button--text" onclick={onOpenOrgManager}>
                            {text("orgsManageOrg", "管理")}</button>
                    </div>
                </div>
            {/each}
        </div>
    {/if}
</div>
