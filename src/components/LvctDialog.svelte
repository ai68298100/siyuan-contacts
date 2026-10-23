<script lang="ts">
    import { onMount, tick } from "svelte";
    import type { Snippet } from "svelte";
    import { createCloseScope } from "./close-guard";
    import { getFocusableElements } from "../shared/focusable-elements";

    let {
        title,
        closeLabel = "关闭",
        wide = false,
        modal = true,
        closeOnBackdrop = true,
        beforeClose,
        onClose,
        children,
    }: {
        title: string;
        closeLabel?: string;
        wide?: boolean;
        modal?: boolean;
        closeOnBackdrop?: boolean;
        /** 子窗口可使用自身编辑器的守卫，避免被等待其结果的父窗口 busy 阻断。 */
        beforeClose?: () => Promise<boolean>;
        onClose: () => void;
        children: Snippet;
    } = $props();

    let panel: HTMLDivElement | undefined = $state();
    let closing = false;
    let lastContentFocus: HTMLElement | null = null;
    const canClose = createCloseScope();
    const titleId = `lvct-dialog-title-${Math.random().toString(36).slice(2)}`;
    const previousActive = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    function focusables(): HTMLElement[] {
        return panel ? getFocusableElements(panel) : [];
    }

    async function requestClose() {
        if (closing) return;
        const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const fields = [...(panel?.querySelectorAll<HTMLElement>(
            "input:not([disabled]), textarea:not([disabled]), select:not([disabled])",
        ) ?? [])];
        const editableFields = fields.filter((field) => field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement);
        const draftField = editableFields.find((field) => field.getAttribute("aria-label") === "新增别名")
            ?? editableFields.find((field) => String((field as HTMLInputElement).value ?? "").length > 0)
            ?? editableFields[0]
            ?? fields[0]
            ?? null;
        const restoreTarget = lastContentFocus?.isConnected
            ? lastContentFocus
            : active && panel?.contains(active) && !active.classList.contains("lvct-dialog-panel__close") ? active : draftField;
        closing = true;
        try {
            // B06：聚合作用域内全部脏项，弹一次三选一（保存并离开/放弃/取消）
            const allowed = await (beforeClose ? beforeClose() : canClose.requestClose());
            if (!allowed) {
                await tick();
                if (restoreTarget?.isConnected) {
                    // A draft can live inside a collapsed details block. Open
                    // its owning disclosure before asking the browser to focus it.
                    let disclosure = restoreTarget.parentElement?.closest("details");
                    while (disclosure) {
                        disclosure.open = true;
                        disclosure = disclosure.parentElement?.closest("details");
                    }
                    await tick();
                    restoreTarget.focus({ preventScroll: true });
                }
                return;
            }
            onClose();
        } finally {
            closing = false;
        }
    }

    function handleKeydown(event: KeyboardEvent) {
        // 选人器等子浮层已处理 Esc 时，只收起该浮层。
        if (event.defaultPrevented) return;
        // 嵌套编辑窗口各自处理键盘焦点与 Esc。
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

        // 移动端虚拟键盘避让 (visualViewport)
        const updateViewport = () => {
            if (typeof window !== "undefined" && window.visualViewport && panel) {
                const offset = window.innerHeight - window.visualViewport.height;
                if (offset > 120) {
                    panel.style.marginBottom = `${offset}px`;
                    panel.style.maxHeight = `${window.visualViewport.height - 32}px`;
                } else {
                    panel.style.marginBottom = "";
                    panel.style.maxHeight = "";
                }
            }
        };
        if (typeof window !== "undefined" && window.visualViewport) {
            window.visualViewport.addEventListener("resize", updateViewport);
            window.visualViewport.addEventListener("scroll", updateViewport);
        }

        return () => {
            if (typeof window !== "undefined" && window.visualViewport) {
                window.visualViewport.removeEventListener("resize", updateViewport);
                window.visualViewport.removeEventListener("scroll", updateViewport);
            }
            previousActive?.focus();
        };
    });
</script>

<svelte:window onkeydown={handleKeydown} />

<div
    class="lvct-dialog-mask"
    role="presentation"
    onclick={(event) => {
        if (closeOnBackdrop && event.target === event.currentTarget) void requestClose();
    }}
>
    <div
        class:lvct-dialog-panel--wide={wide}
        class="lvct-dialog-panel"
        role="dialog"
        aria-modal={modal ? "true" : undefined}
        aria-labelledby={titleId}
        bind:this={panel}
        onfocusin={(event) => {
            const target = event.target;
            if (target instanceof HTMLElement && panel?.contains(target) && !target.classList.contains("lvct-dialog-panel__close")) {
                lastContentFocus = target;
            }
        }}
    >
        <div class="lvct-dialog-panel__header">
            <div class="lv-dialog-title-wrap">
                <span class="lv-dialog-title-badge" aria-hidden="true">驴</span>
                <h2 id={titleId} class="lvct-dialog-panel__title">{title}</h2>
            </div>
            <button class="lvct-dialog-panel__close" type="button" aria-label={closeLabel} title={closeLabel}
                onmousedown={(event) => {
                    const active = document.activeElement;
                    if (active instanceof HTMLElement && panel?.contains(active) && !active.classList.contains("lvct-dialog-panel__close")) lastContentFocus = active;
                    event.preventDefault();
                }}
                onclick={() => void requestClose()}>×</button>
        </div>
        {@render children()}
    </div>
</div>
