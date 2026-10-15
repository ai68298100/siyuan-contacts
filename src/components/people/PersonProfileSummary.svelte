<script lang="ts">
    import type { PersonProfile } from "../../domain/people-profiles";
    import { profileText } from "../../domain/people-profiles";
    let { profile, compact = false, hideEmpty = false }: { profile?: PersonProfile; compact?: boolean; hideEmpty?: boolean } = $props();
    const compactRows = $derived.by(() => {
        if (!profile) return [];
        const fields = [
            { key: "family", label: "家庭" }, { key: "work", label: "工作单位" },
            { key: "education", label: "学校" }, { key: "relationship", label: "与我的关系" },
            ...(hideEmpty ? [{ key: "unspecified" as const, label: "其他组织" }] : []),
        ] as const;
        const rows = fields.flatMap(({ key, label }) => {
            if (hideEmpty && profile.affiliations.state === "unknown" && key !== "relationship") {
                return key === "family" ? [{ label: "组织归属", value: profileText(profile, key) }] : [];
            }
            const value = profileText(profile, key);
            return hideEmpty && value === "未填写" ? [] : [{ label, value }];
        });
        if (hideEmpty && profile.affiliations.state === "known") {
            const { history, unresolved } = profile.affiliations.value;
            if (history.length) rows.push({ label: "历史组织", value: `${history.length} 条经历，详情可查看` });
            if (unresolved.length) rows.push({ label: "待核对组织", value: `${unresolved.length} 条，详情可核对` });
        }
        return rows;
    });
</script>

{#if profile}
    {#if compact}
        <span class="lvct-profile-summary lvct-profile-summary--compact" aria-label="组织成员与本人称谓资料">
            {#each compactRows as row (row.label)}<span>{row.label}：{row.value}</span>{/each}
            {#if hideEmpty && compactRows.length === 0}<span>资料待补充</span>{/if}
        </span>
    {:else}
    <dl class="lvct-profile-summary" aria-label="组织成员与本人称谓资料">
        <div><dt>家庭</dt><dd>{profileText(profile, "family")}</dd></div>
        <div><dt>工作单位</dt><dd>{profileText(profile, "work")}</dd></div>
        <div><dt>学校</dt><dd>{profileText(profile, "education")}</dd></div>
        <div><dt>与我的关系</dt><dd>{profileText(profile, "relationship")}</dd></div>
            <div><dt>资料来源</dt><dd>组织成员分类；本人参照下的人工称谓。核对时间 {new Date(profile.readAt).toLocaleString()}</dd></div>
            {#if profile.affiliations.state === "known"}
                <div><dt>历史与待核对</dt><dd>历史/归档 {profile.affiliations.value.history.length} 条，组织不可达 {profile.affiliations.value.unresolved.length} 条；在组织归属中核对具体期间。</dd></div>
            {/if}
    </dl>
    {/if}
{/if}

<style>
    .lvct-profile-summary { margin: var(--lvct-sp-2) 0; color: var(--lvct-text-2); font-size: var(--lvct-fs-caption); }
    .lvct-profile-summary div { display: flex; gap: 8px; margin: 4px 0; }
    .lvct-profile-summary dt { flex: 0 0 84px; color: var(--lvct-text-3); }
    .lvct-profile-summary dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
    .lvct-profile-summary--compact {
        display: inline-flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 4px;
        max-width: 100%;
        margin: 2px 0;
        vertical-align: middle;
    }
    .lvct-profile-summary--compact > span {
        display: inline-flex;
        align-items: center;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 180px;
        font-size: 11px;
        line-height: 1.4;
        padding: 1px 6px;
        border-radius: 4px;
        background: color-mix(in srgb, var(--lvct-accent) 8%, var(--lvct-bg-app));
        color: var(--lvct-text-2);
    }
</style>
