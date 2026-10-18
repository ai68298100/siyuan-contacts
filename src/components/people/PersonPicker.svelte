<script lang="ts">
    /** B03 可搜索选人器：输入即筛 + 键盘上下/回车 + 分组·标签提示 + 空态提示。
     *  浮层复用 popover 定位原语（B02），在 Peek/工作台滚动容器内不被裁剪。
     *  只改选择交互，不改变调用方的写入语义（选中后由调用方走既有服务）。 */
    import { onDestroy, tick } from "svelte";
    import { getFrontend } from "siyuan";
    import { attachPopover } from "../../libs/popover";
    import { registerDialogEscapeScope } from "../../libs/dialog-escape-scope";
    import { translateText } from "../../domain/translation";
    import { loadContactAliasIndex } from "../../services/contact-aliases";
    import { X } from "@lucide/svelte";

    export interface PickerItem {
        id: string;
        label: string;
        /** 次要行：分组 · 标签 */
        hint?: string;
        docId?: string;
        itemId?: string;
        /** 参与搜索的附加关键词（电话/微信/邮箱），调用方拼好小写 */
        keywords?: string;
    }

    let {
        items,
        value = "",
        placeholder = "选择联系人…",
        emptyText = "没有匹配的联系人",
        searchText = "输入姓名、电话、微信筛选",
        ariaLabel = "选择联系人",
        clearable = true,
        clearLabel = "",
        disabled = false,
        i18n,
        onSelect,
    }: {
        items: readonly PickerItem[];
        /** 当前选中 id（受控显示；选中经 onSelect 回交调用方） */
        value?: string;
        placeholder?: string;
        emptyText?: string;
        searchText?: string;
        ariaLabel?: string;
        clearable?: boolean;
        clearLabel?: string;
        disabled?: boolean;
        i18n?: Readonly<Record<string, string>>;
        onSelect: (id: string) => void;
    } = $props();
    const text = $derived.by(() => (key: string, fallback: string) => translateText(i18n, key, fallback));
    const frontend = getFrontend();
    const keepOpenOnViewportChange = frontend === "mobile" || frontend === "browser-mobile";

    let open = $state(false);
    let query = $state("");
    let highlight = $state(0);
    let wrap: HTMLElement | undefined = $state();
    let panel: HTMLElement | undefined = $state();
    let triggerEl: HTMLButtonElement | undefined = $state();
    let inputEl: HTMLInputElement | undefined = $state();
    let listEl: HTMLUListElement | undefined = $state();
    let aliasKeywords = $state<Record<string, string>>({});
    let aliasLoading = $state(false);
    let aliasError = $state(false);
    let aliasRequest = 0;
    let openTimer: ReturnType<typeof setTimeout> | undefined;
    const listboxId = `lvct-picker-${Math.random().toString(36).slice(2)}`;
    const statusId = `${listboxId}-status`;
    onDestroy(() => {
        aliasRequest += 1;
        clearTimeout(openTimer);
    });

    async function loadAliases(): Promise<void> {
        const request = ++aliasRequest;
        aliasLoading = true;
        try {
            const index = await loadContactAliasIndex();
            if (request !== aliasRequest) return;
            const keywords: Record<string, string> = {};
            for (const entry of index?.aliases ?? []) keywords[entry.personDocId] = `${keywords[entry.personDocId] ?? ""} ${entry.alias.toLowerCase()}`;
            aliasKeywords = keywords;
            aliasError = false;
        } catch {
            if (request !== aliasRequest) return;
            aliasKeywords = {};
            aliasError = true;
        } finally {
            if (request === aliasRequest) aliasLoading = false;
        }
    }

    const selected = $derived(items.find((item) => item.id === value) ?? null);
    const ambiguousLabels = $derived.by(() => {
        const counts = new Map<string, number>();
        for (const item of items) counts.set(item.label, (counts.get(item.label) ?? 0) + 1);
        return new Set([...counts].filter(([, count]) => count > 1).map(([label]) => label));
    });
    const filtered = $derived.by(() => {
        const needle = query.trim().toLowerCase();
        if (!needle) return items;
        return items.filter((item) =>
            item.label.toLowerCase().includes(needle) || (item.keywords ?? "").includes(needle)
            || (aliasKeywords[item.docId ?? item.id] ?? "").includes(needle)
            || (item.docId ?? item.id).includes(needle) || (item.itemId ?? "").includes(needle));
    });

    $effect(() => {
        if (!open || !wrap || !panel) return;
        // 移动端聚焦搜索框会唤起输入法并触发 viewport resize/scroll；
        // 这些变化不代表用户要关闭选人器，否则浮层会在键盘出现后立即消失。
        return attachPopover(panel, wrap, closeAndFocus, keepOpenOnViewportChange ? {
            closeOnScroll: false,
            closeOnResize: false,
        } : undefined);
    });

    $effect(() => {
        if (!disabled) return;
        clearTimeout(openTimer);
        aliasRequest += 1;
        if (open) closeAndFocus();
    });

    $effect(() => {
        const length = filtered.length;
        if (length === 0) {
            if (highlight !== 0) highlight = 0;
        } else if (highlight >= length) {
            highlight = length - 1;
        }
    });

    $effect(() => {
        if (open && wrap) return registerDialogEscapeScope(wrap, closeAndFocus);
    });

    function closeAndFocus(): void {
        open = false;
        void tick().then(() => triggerEl?.isConnected && triggerEl.focus({ preventScroll: true }));
    }
    function onPickerKeydown(event: KeyboardEvent): void {
        if (!open || event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        closeAndFocus();
    }

    export function openPicker(): void {
        if (disabled) return;
        /*
         * The empty-state CTA lives outside this component's wrapper. If it
         * opens the picker synchronously, attachPopover installs its global
         * click listener before the original click finishes bubbling and
         * immediately treats that same click as an outside click. Native
         * events can run microtasks between listeners, so queueMicrotask is
         * not enough. A new task waits for the whole click to finish.
         */
        clearTimeout(openTimer);
        openTimer = setTimeout(() => {
            openTimer = undefined;
            if (!disabled) void show();
        }, 0);
    }

    async function show(): Promise<void> {
        if (disabled) return;
        query = "";
        highlight = 0;
        open = true;
        void loadAliases();
        await tick();
        if (disabled || !open) return;
        // 已按触发器定位浮层，避免自动聚焦滚动父窗口而触发关闭。
        inputEl?.focus({ preventScroll: true });
    }
    function choose(item: PickerItem): void {
        if (disabled) return;
        open = false;
        onSelect(item.id);
        void tick().then(() => triggerEl?.focus());
    }
    function clearSelection(): void {
        if (disabled || !value) return;
        open = false;
        query = "";
        onSelect("");
        void tick().then(() => triggerEl?.focus());
    }
    function onSearchKeydown(event: KeyboardEvent): void {
        if (event.key === "ArrowDown") {
            if (filtered.length === 0) return;
            event.preventDefault();
            highlight = Math.min(highlight + 1, filtered.length - 1);
            void tick().then(() => document.getElementById(`${listboxId}-option-${highlight}`)?.scrollIntoView({ block: "nearest" }));
        } else if (event.key === "ArrowUp") {
            if (filtered.length === 0) return;
            event.preventDefault();
            highlight = Math.max(highlight - 1, 0);
            void tick().then(() => document.getElementById(`${listboxId}-option-${highlight}`)?.scrollIntoView({ block: "nearest" }));
        } else if (event.key === "Enter") {
            event.preventDefault();
            const item = filtered[highlight];
            if (item) choose(item);
        } else if (event.key === "Escape") {
            onPickerKeydown(event);
        }
    }

    function optionId(item: PickerItem, index: number): string {
        // Keep the active-descendant target unique even when two records have
        // the same label or an item id contains punctuation that is awkward in
        // a CSS selector. The index is scoped to this rendered result set.
        const safeId = item.id.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 48);
        return `${listboxId}-option-${index}-${safeId || "item"}`;
    }
</script>

<div class="lvct-picker" bind:this={wrap}>
    <div class="lvct-picker__control">
        <button
            type="button"
            class="b3-select lvct-picker__trigger"
            bind:this={triggerEl}
            aria-haspopup="listbox"
            aria-controls={open ? listboxId : undefined}
            aria-describedby={open ? statusId : undefined}
            aria-expanded={open}
            aria-label={ariaLabel}
            disabled={disabled}
            onkeydown={onPickerKeydown}
            onclick={() => (open ? (open = false) : void show())}
        >
            <span class="lvct-picker__value" class:lvct-picker__placeholder={!selected && !value}>
                {selected ? `${selected.label}${ambiguousLabels.has(selected.label) ? ` · ${selected.docId ?? selected.id}` : ""}` : value ? `${text("pickerMissing", "人物待核实")} · ${value}` : placeholder}
            </span>
            <span class="lvct-picker__caret" aria-hidden="true">▾</span>
        </button>
        {#if value && clearable}
            <button type="button" class="lvct-picker__clear" aria-label={clearLabel || text("pickerClear", "清除选择")} title={clearLabel || text("pickerClear", "清除选择")} disabled={disabled} onclick={clearSelection}>
                <X size={14} aria-hidden="true" />
            </button>
        {/if}
    </div>
    {#if open}
        <div class="lvct-picker__panel" bind:this={panel}>
            {#if aliasError}
                <p class="lvct-picker__status" role="status">
                    {text("pickerAliasError", "别名读取失败，可按姓名或文档 ID 查找。")}
                </p>
            {/if}
            <input
                class="b3-text-field lvct-picker__search"
                type="text"
                bind:this={inputEl}
                bind:value={query}
                placeholder={text("pickerSearch", searchText)}
                aria-label={text("pickerSearch", searchText)}
                aria-describedby={statusId}
                aria-busy={aliasLoading}
                role="combobox"
                aria-autocomplete="list"
                aria-expanded="true"
                aria-controls={listboxId}
                aria-activedescendant={filtered.length > 0 && highlight < filtered.length ? optionId(filtered[highlight], highlight) : undefined}
                onkeydown={onSearchKeydown}
                oninput={() => { highlight = 0; if (listEl) listEl.scrollTop = 0; }}
            />
            <p id={statusId} class="lvct-picker__status" role="status" aria-live="polite" aria-atomic="true">
                {aliasLoading ? text("pickerAliasLoading", "正在读取别名…") : filtered.length > 0 ? `找到 ${filtered.length} 个联系人，可用方向键移动并按 Enter 选择。` : emptyText}
            </p>
            {#if filtered.length === 0 && !aliasLoading}
                <div class="lvct-picker__empty" aria-hidden="true">{emptyText}</div>
            {/if}
            <ul class="lvct-picker__list" id={listboxId} role="listbox" bind:this={listEl}>
                {#each filtered as item, index (item.id)}
                    <li role="none">
                        <button
                            type="button"
                            id={optionId(item, index)}
                            role="option"
                            tabindex="-1"
                            aria-setsize={filtered.length}
                            aria-posinset={index + 1}
                            aria-selected={item.id === value}
                            class="lvct-picker__option"
                            class:lvct-picker__option--active={index === highlight}
                            onmouseenter={() => (highlight = index)}
                            onkeydown={onPickerKeydown}
                            onclick={() => choose(item)}
                        >
                            <span class="lvct-picker__label">{item.label}</span>
                            {#if item.hint}<span class="lvct-picker__hint">{item.hint}</span>{/if}
                            {#if ambiguousLabels.has(item.label) || query.trim() && filtered.length > 1}
                                <span class="lvct-picker__hint">{item.docId ?? item.id}{item.itemId ? ` · ${item.itemId}` : ""}</span>
                            {/if}
                        </button>
                    </li>
                {/each}
            </ul>
        </div>
    {/if}
</div>
