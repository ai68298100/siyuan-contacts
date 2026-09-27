<script lang="ts">
    import { onDestroy } from "svelte";
    import { CheckCircle2, CircleAlert } from "@lucide/svelte";

    let { message, error = false, onDismiss, actionLabel, onAction }: {
        message: string;
        error?: boolean;
        onDismiss?: () => void;
        actionLabel?: string;
        onAction?: () => void;
    } = $props();

    let timer: ReturnType<typeof setTimeout> | undefined;
    $effect(() => {
        clearTimeout(timer);
        if (message && !error && onDismiss) timer = setTimeout(onDismiss, 4000);
    });
    onDestroy(() => clearTimeout(timer));
</script>

{#if message}
    <div class="lvct-notice" class:lvct-notice--error={error} role={error ? "alert" : "status"}>
        {#if error}<CircleAlert size={16}/>{:else}<CheckCircle2 size={16}/>{/if}
        <span>{message}</span>
        {#if actionLabel && onAction}<button type="button" class="lvct-notice__action" onclick={onAction}>{actionLabel}</button>{/if}
    </div>
{/if}
