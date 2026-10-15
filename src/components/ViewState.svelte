<script lang="ts">
    import type { Snippet } from "svelte";
    import { Cake, CalendarDays, Check } from "@lucide/svelte";

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

<div class="lvct-empty" class:lvct-empty--compact={compact} class:lvct-empty--error={error} aria-busy={loading}>
    <div role={error ? "alert" : "status"} class="lvct-view-state__content">
        {#if loading}
            <div class="lvct-view-state__skeleton" aria-hidden="true">
                <span class="lvct-skeleton lvct-skeleton--l1"></span>
                <span class="lvct-skeleton lvct-skeleton--l2"></span>
                <span class="lvct-skeleton lvct-skeleton--l3"></span>
            </div>
        {:else}
            <div class="lvct-empty__icon" aria-hidden="true">
                {#if error}
                    !
                {:else if icon === "birthday"}
                    <Cake size={20} strokeWidth={1.8} />
                {:else if icon === "calendar"}
                    <CalendarDays size={20} strokeWidth={1.8} />
                {:else if icon === "check"}
                    <Check size={20} strokeWidth={1.8} />
                {:else}
                    {icon}
                {/if}
            </div>
        {/if}
        <b>{title}</b>
        {#if description}<p>{description}</p>{/if}
    </div>
    {#if children && !loading}
        <div class="lvct-empty__actions">{@render children()}</div>
    {/if}
</div>
