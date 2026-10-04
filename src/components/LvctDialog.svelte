<script lang="ts">
    import { onMount, tick } from "svelte";
    import type { Snippet } from "svelte";
    import { createCloseScope } from "./close-guard";

    let {
        title,
        closeLabel = "关闭",
        wide = false,
        peek = false,
        modal = !peek,
        closeOnBackdrop = true,
        onClose,
        children,
    }: {
        title: string;
        closeLabel?: string;
        wide?: boolean;
        peek?: boolean;
        modal?: boolean;
        closeOnBackdrop?: boolean;
        onClose: () => void;
        children: Snippet;
    } = $props();

    let panel: HTMLDivElement | undefined = $state();
    let closing = false;
    const canClose = createCloseScope();
    const titleId = `lvct-dialog-title-${Math.random().toString(36).slice(2)}`;
    const previousActive = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    function focusables(): HTMLElement[] {
        if (!panel) return [];
        return [...panel.querySelectorAll<HTMLElement>(
            "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])",
        )];
    }

    async function requestClose() {
        if (closing) return;
        closing = true;
        try {
            // B06：聚合作用域内全部脏项，弹一次三选一（保存并离开/放弃/取消）
            const allowed = await canClose.requestClose();
            if (!allowed) return;
            onClose();
        } finally {
            closing = false;
        }
    }

    function handleKeydown(event: KeyboardEvent) {
        // Nested dialogs (例如 Peek 内的编辑窗口) 各自处理键盘焦点与 Esc。
        // 外层弹层不能抢走内层的按键，否则 Esc 会连关两层窗口。
        const activePanel = document.activeElement instanceof HTMLElement
            ? document.activeElement.closest(".lvct-dialog-panel")
            : null;
        if (activePanel && activePanel !== panel) return;
        if (event.key === "Escape") {
            event.preventDefault();
            void requestClose();
            return;
        }
        if (event.key !== "Tab" || !modal) return;
        const items = focusables();
        if (items.length === 0) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    }

    onMount(() => {
        void tick().then(() => focusables()[0]?.focus());
        return () => previousActive?.focus();
    });
</script>

<svelte:window onkeydown={handleKeydown} />

<div
    class="lvct-dialog-mask"
    class:lvct-dialog-mask--peek={peek}
    role="presentation"
    onclick={(event) => {
        if (closeOnBackdrop && event.target === event.currentTarget) void requestClose();
    }}
>
    <div
        class:lvct-dialog-panel--wide={wide}
        class:lvct-dialog-panel--peek={peek}
        class="lvct-dialog-panel"
        role="dialog"
        aria-modal={modal ? "true" : undefined}
        aria-labelledby={titleId}
        bind:this={panel}
    >
        <div class="lvct-dialog-panel__header">
            <h2 id={titleId} class="lvct-dialog-panel__title">{title}</h2>
            <button class="lvct-dialog-panel__close" type="button" aria-label={closeLabel} onclick={() => void requestClose()}>×</button>
        </div>
        {@render children()}
    </div>
</div>
