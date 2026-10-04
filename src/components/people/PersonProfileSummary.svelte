<script lang="ts">
    import type { PersonProfile } from "../../domain/people-profiles";
    import { profileText } from "../../domain/people-profiles";
    let { profile, compact = false }: { profile?: PersonProfile; compact?: boolean } = $props();
</script>

{#if profile}
    {#if compact}
        <span class="lvct-profile-summary lvct-profile-summary--compact" aria-label="组织成员与本人称谓资料">
            <span>工作单位：{profileText(profile, "work")}</span>
            <span>学校：{profileText(profile, "education")}</span>
            <span>与我的关系：{profileText(profile, "relationship")}</span>
        </span>
    {:else}
    <dl class="lvct-profile-summary" aria-label="组织成员与本人称谓资料">
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
    .lvct-profile-summary { margin: 8px 0; color: var(--b3-theme-on-surface); font-size: 12px; }
    .lvct-profile-summary div { display: flex; gap: 8px; margin: 4px 0; }
    .lvct-profile-summary dt { flex: 0 0 72px; }
    .lvct-profile-summary dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
    .lvct-profile-summary--compact { display: block; margin: 4px 0; }
    .lvct-profile-summary--compact > span { display: block; overflow-wrap: anywhere; }
</style>
