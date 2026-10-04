<script lang="ts">
    import { onDestroy, tick } from "svelte";
    import type { ContactsPluginFacade } from "../../types";
    import type { OrgProjectionPreview, OrgProjectionRepairResult } from "../../services/org-projections";
    import { translateText } from "../../domain/translation";
    import { subscribeDataChanged } from "../../libs/data-events";
    import { useCloseGuard } from "../close-guard";

    let { facade, i18n, onBusyChange = () => {} }: {
        facade: ContactsPluginFacade;
        i18n?: Readonly<Record<string, string>>;
        onBusyChange?: (busy: boolean) => void;
    } = $props();
    const text = $derived.by(() => (key: string, fallback: string) => translateText(i18n, key, fallback));
    let busy = $state(false);
    let preview = $state<OrgProjectionPreview | null>(null);
    let results = $state<Record<string, OrgProjectionRepairResult>>({});
    let errorText = $state("");
    let stale = $state(false);
    let visibleCount = $state(20);
    let summaryElement: HTMLElement | undefined = $state();
    let alive = true;
    let generation = 0;
    const visibleTargets = $derived(preview?.targets.slice(0, visibleCount) ?? []);
    useCloseGuard({ busy: () => busy, dirty: () => false });
    $effect(() => { onBusyChange(busy); });
    const unsubscribe = subscribeDataChanged(() => { if (preview) stale = true; });
    onDestroy(() => { alive = false; generation += 1; unsubscribe(); onBusyChange(false); });

    async function loadPreview(): Promise<void> {
        if (busy || !facade.previewOrganizationProjections) return;
        const request = ++generation;
        busy = true;
        errorText = "";
        try {
            const next = await facade.previewOrganizationProjections();
            if (!alive || request !== generation) return;
            preview = next;
            results = {};
            stale = false;
            visibleCount = 20;
            await tick();
            if (alive && request === generation) summaryElement?.focus();
        } catch (error) {
            if (alive && request === generation) { errorText = error instanceof Error ? error.message : String(error); stale = true; }
        } finally { if (alive && request === generation) busy = false; }
    }

    async function repair(retryKey: string): Promise<void> {
        if (busy || stale || !preview || !facade.repairOrganizationProjection) return;
        const request = ++generation;
        busy = true;
        errorText = "";
        try {
            const result = await facade.repairOrganizationProjection(preview, retryKey);
            if (!alive || request !== generation) return;
            results = { ...results, [retryKey]: result };
            if (result.status === "failed" || result.status === "unknown") stale = true;
        } catch (error) {
            if (alive && request === generation) { errorText = error instanceof Error ? error.message : String(error); stale = true; }
        } finally {
            if (alive && request === generation) {
                busy = false;
                await tick();
                if (alive && request === generation) summaryElement?.focus();
            }
        }
    }

    function stateText(state: string): string {
        if (state === "applied") return text("orgProjectionApplied", "已核实修复");
        if (state === "unchanged") return text("orgProjectionUnchanged", "一致");
        if (state === "missing") return text("orgProjectionMissing", "缺失");
        if (state === "different") return text("orgProjectionDifferent", "不同");
        if (state === "failed") return text("orgProjectionFailed", "失败");
        return text("orgProjectionUnknown", "未知，需重新核对");
    }
</script>

<section class="lvct-org-projection" aria-busy={busy}>
    <div class="lvct-settings__sub-heading">
        <b>{text("orgProjectionTitle", "组织成员双链")}</b>
        <button class="b3-button b3-button--outline" disabled={busy} onclick={loadPreview}>
            {busy ? text("orgProjectionBusy", "核对或修复中…") : text("orgProjectionInspect", "只读核对组织双链")}
        </button>
    </div>
    <p class="lvct-settings__inline-hint">{text("orgProjectionScope", "先只读预览差异，再逐项确认。只修改插件双链段落，保留成员事实、任职历史和其他正文；归档组织不生成当前成员投影。")}</p>
    {#if errorText}<p class="lvct-form__error" role="alert">{errorText}</p>{/if}
    {#if preview}
        <p bind:this={summaryElement} tabindex="-1" role="status" aria-live="polite">{text("orgProjectionCount", "已核对文档数")}：{preview.targets.length}
            {#if stale} · {text("orgProjectionStale", "来源或结果需重新核实，请重新预览")}{/if}
        </p>
        {#each visibleTargets as target (target.retryKey)}
            <div class="lvct-org-projection__target">
                <p><b>{target.name}</b> · {target.kind === "organization" ? text("orgProjectionOrganization", "组织") : text("orgProjectionPerson", "人物")}
                    · {stateText(results[target.retryKey]?.status ?? target.state)}<br /><small>{target.docId}</small></p>
                {#if target.message || results[target.retryKey]?.message}<p role="status">{results[target.retryKey]?.message ?? target.message}</p>{/if}
                {#if target.state !== "unchanged" && target.state !== "unknown"}
                    <details>
                        <summary>{text("orgProjectionCompare", "查看现有与预期段落")}</summary>
                        <p>{text("orgProjectionCurrent", "现有插件段落")}</p>
                        <pre class="lvct-org-projection__text">{target.existing?.map((block) => block.markdown).join("\n") || "—"}</pre>
                        <p>{text("orgProjectionExpected", "按当前成员事实生成的段落")}</p>
                        <pre class="lvct-org-projection__text">{target.markdown || text("orgProjectionRemoveEmpty", "清除此插件段落；保留其他正文")}</pre>
                    </details>
                {/if}
                {#if target.state !== "unknown" && (target.state !== "unchanged" || target.checkpointPending)}
                    <button class="b3-button b3-button--outline" disabled={busy || stale || ["applied", "unchanged"].includes(results[target.retryKey]?.status ?? "")} onclick={() => repair(target.retryKey)}>
                        {text("orgProjectionConfirm", "确认修复或核实此段落")}
                    </button>
                {/if}
            </div>
        {/each}
        {#if visibleTargets.length < preview.targets.length}
            <button class="b3-button b3-button--outline" disabled={busy} onclick={() => (visibleCount += 20)}>{text("orgProjectionMore", "显示更多核对结果")}</button>
        {/if}
        <button class="b3-button b3-button--cancel" disabled={busy} onclick={() => { preview = null; results = {}; }}>{text("orgProjectionCancel", "取消预览")}</button>
    {/if}
</section>

<style>
    .lvct-org-projection__target { border-top: 1px solid var(--b3-border-color); padding: 8px 0; overflow-wrap: anywhere; }
    .lvct-org-projection__text { white-space: pre-wrap; overflow-wrap: anywhere; font-size: inherit; margin: 4px 0; }
</style>
