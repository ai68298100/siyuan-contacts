<script lang="ts">
    import type { Snippet } from "svelte";

    let {
        title,
        description = "",
        icon = "♧",
        loading = false,
        error = false,
        compact = false,
        children,
    }: {
        title: string;
        description?: string;
        icon?: string;
        loading?: boolean;
        error?: boolean;
        compact?: boolean;
        children?: Snippet;
    } = $props();
</script>

<div class="lvct-empty" class:lvct-empty--compact={compact} aria-busy={loading}>
    <div role={error ? "alert" : "status"} class="lvct-view-state__content">
        {#if loading}
            <div class="lvct-view-state__skeleton" aria-hidden="true">
                <span class="lvct-skeleton"></span>
                <span class="lvct-skeleton"></span>
                <span class="lvct-skeleton"></span>
            </div>
        {:else}
            <div class="lvct-empty__icon" aria-hidden="true">{error ? "!" : icon}</div>
        {/if}
        <b>{title}</b>
        {#if description}<p>{description}</p>{/if}
    </div>
    {#if children && !loading}
        <div class="lvct-empty__actions">{@render children()}</div>
    {/if}
</div>
