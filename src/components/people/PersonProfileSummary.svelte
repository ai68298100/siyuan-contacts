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
            {#each compactRows as row (row.label)}
                <span title={`${row.label}：${row.value}`}>
                    <b>{row.label}：</b>{row.value}
                </span>
            {/each}
            {#if hideEmpty && compactRows.length === 0}<span>资料待补充</span>{/if}
        </span>
    {:else}
    <dl class="lvct-profile-summary" aria-label="组织成员与本人称谓资料">
        <div><dt>家庭</dt><dd>{profileText(profile, "family")}</dd></div>
        <div><dt>工作单位</dt><dd>{profileText(profile, "work")}</dd></div>
        <div><dt>学校</dt><dd>{profileText(profile, "education")}</dd></div>
        <div><dt>与我的关系</dt><dd>{profileText(profile, "relationship")}</dd></div>
    </dl>
    {/if}
{/if}

<style>
    .lvct-profile-summary {
        margin: var(--lvct-sp-2) 0;
        padding: 12px 14px;
        background: var(--lvct-bg-surface);
        border: 1px solid color-mix(in srgb, var(--lvct-border-subtle) 80%, transparent);
        border-radius: var(--lvct-r-lg);
        color: var(--lvct-text-2);
        font-size: var(--lvct-fs-caption);
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(min(100%, 240px), 1fr));
        gap: 8px 16px;
    }
    .lvct-profile-summary div { display: flex; gap: 8px; margin: 0; align-items: baseline; }
    .lvct-profile-summary dt { flex: 0 0 70px; color: var(--lvct-text-3); font-weight: 500; }
    .lvct-profile-summary dd { margin: 0; min-width: 0; overflow-wrap: anywhere; color: var(--lvct-text-1); font-weight: 550; }
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
        max-width: 100%;
        font-size: 11px;
        line-height: 1.4;
        padding: 1px 7px;
        border-radius: var(--lvct-r-sm, 4px);
        background: color-mix(in srgb, var(--lvct-accent) 8%, var(--lvct-bg-app));
        color: var(--lvct-text-2);
        box-sizing: border-box;
    }
</style>
