<script lang="ts">
    import type { OrgMembershipWriteReport } from "../../services/org-member-writes";
    import { translateText } from "../../domain/translation";
    import { tick, onDestroy } from "svelte";
    let { report, i18n }: { report: OrgMembershipWriteReport | null; i18n?: Readonly<Record<string, string>> } = $props();
    const pending = $derived(report?.projections.filter((projection) => projection.status === "unknown" || projection.status === "failed") ?? []);
    const text = $derived.by(() => (key: string, fallback: string) => translateText(i18n, key, fallback));
    let resultElement: HTMLElement | undefined = $state();
    let alive = true;
    let focusRequest = 0;
    onDestroy(() => { alive = false; focusRequest += 1; });
    $effect(() => {
        const request = ++focusRequest;
        if (report) void tick().then(() => { if (alive && request === focusRequest) resultElement?.focus(); });
    });
</script>

{#if report}
    <div class="lvct-org-membership-result" bind:this={resultElement} tabindex="-1" role="status" aria-live="polite">
        <p>{text("orgMembershipFactSaved", "成员事实已保存并核实。")}
            {#if pending.length === 0}{text("orgMembershipLinksVerified", "双方双链已核实。")}
            {:else}{text("orgMembershipLinksPending", "部分双链尚未核实，成员事实已保留。请到设置 → 数据与字段 → 组织成员双链，核对并只修复段落。")}{/if}
        </p>
        {#if pending.length}
            <details><summary>{text("orgMembershipPendingDetails", "查看待核实文档")}</summary>
                {#each pending as projection (projection.retryKey)}
                    <p>{projection.docId} · {projection.status === "failed" ? text("orgProjectionFailed", "失败") : text("orgProjectionUnknown", "未知，需重新核对")}</p>
                    {#if projection.message}<p>{projection.message}</p>{/if}
                {/each}
            </details>
        {/if}
    </div>
{/if}
