<script lang="ts">
    import { onDestroy } from "svelte";
    import type { ContactsPluginFacade } from "../../types";
    import type { OrganizationOperationReport } from "../../domain/organization-operations";

    let { facade, refreshKey = 0, disabled = false, onRecovered, onBusyChange }: {
        facade: ContactsPluginFacade;
        refreshKey?: number;
        disabled?: boolean;
        onRecovered?: (docId: string) => void | Promise<void>;
        onBusyChange?: (busy: boolean) => void;
    } = $props();
    let reports = $state<OrganizationOperationReport[]>([]);
    let errorMessage = $state("");
    let busy = $state(false);
    let alive = true;
    let request = 0;
    onDestroy(() => { alive = false; request += 1; onBusyChange?.(false); });
    $effect(() => { onBusyChange?.(busy); });

    async function readPending(): Promise<void> {
        if (!facade.listPendingOrganizationOperations) return;
        const currentRequest = ++request;
        busy = true;
        try {
            const next = await facade.listPendingOrganizationOperations();
            if (!alive || currentRequest !== request) return;
            reports = next;
            errorMessage = "";
        } catch (error) {
            if (alive && currentRequest === request) errorMessage = error instanceof Error ? error.message : String(error);
        } finally {
            if (alive && currentRequest === request) busy = false;
        }
    }

    $effect(() => { void refreshKey; void readPending(); });

    async function act(requestId: string, resume: boolean): Promise<void> {
        if (busy || disabled) return;
        const action = resume ? facade.resumeOrganizationOperation : facade.inspectOrganizationOperation;
        if (!action) return;
        const currentRequest = ++request;
        busy = true;
        errorMessage = "";
        try {
            const result = await action.call(facade, requestId);
            if (!alive || currentRequest !== request) return;
            reports = reports.map((entry) => entry.operation.requestId === requestId ? result : entry);
            if (result.status === "complete" && result.docId) await onRecovered?.(result.docId);
        } catch (error) {
            if (alive && currentRequest === request) errorMessage = error instanceof Error ? error.message : String(error);
        } finally {
            if (alive && currentRequest === request) busy = false;
        }
    }

    function stepLabel(state: string): string {
        return state === "verified" ? "已核实" : state === "pending" ? "发送结果未知" : state === "rejected" ? "明确未执行" : "尚未发送";
    }
</script>

{#if facade.listPendingOrganizationOperations && (reports.length || errorMessage)}
    <section class="lvct-org-recovery" aria-label="组织操作续做" aria-busy={busy}>
        <strong>组织操作续做</strong>
        <p>重开窗口先只读核实原请求。未知结果不会再次创建或改写；继续只补尚未发送或明确拒绝的步骤。</p>
        {#if errorMessage}<p class="lvct-form__error" role="alert">{errorMessage}</p>{/if}
        <button class="b3-button b3-button--outline" disabled={busy || disabled} onclick={() => void readPending()}>只读核实待处理操作</button>
        {#each reports as entry (entry.operation.requestId)}
            <article class="lvct-org-recovery__entry" data-request-id={entry.operation.requestId}>
                <strong>{entry.operation.kind === "create" ? "创建" : "改名"}：{entry.operation.name}</strong>
                <div class="ft__smaller">请求：{entry.operation.requestId}</div>
                <div class="ft__smaller">文档：{entry.docId || "尚未核实"}</div>
                {#if entry.operation.kind === "create"}
                    <div>创建：{stepLabel(entry.operation.createState)}</div>
                {:else}
                    <div>原标题：{entry.operation.originalName}</div>
                    <div>标题：{stepLabel(entry.operation.titleState)}；标记：{stepLabel(entry.operation.markerState)}</div>
                {/if}
                <p role="status">{entry.message}</p>
                <button class="b3-button b3-button--outline" disabled={busy || disabled} onclick={() => void act(entry.operation.requestId, false)}>只读核实原请求</button>
                {#if entry.canResume && facade.resumeOrganizationOperation}
                    <button class="b3-button" disabled={busy || disabled} onclick={() => void act(entry.operation.requestId, true)}>继续未完成步骤</button>
                {/if}
            </article>
        {/each}
    </section>
{/if}

<style>
    .lvct-org-recovery { padding: var(--lvct-sp-3); border: 1px solid var(--lvct-border-subtle); border-radius: var(--lvct-r-sm); }
    .lvct-org-recovery__entry { padding: 10px 0; border-top: 1px solid var(--lvct-border-subtle); overflow-wrap: anywhere; }
</style>
