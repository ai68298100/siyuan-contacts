<script lang="ts">
    /** B03 可搜索选人器：输入即筛 + 键盘上下/回车 + 分组·标签提示 + 空态提示。
     *  浮层复用 popover 定位原语（B02），在 Peek/工作台滚动容器内不被裁剪。
     *  只改选择交互，不改变调用方的写入语义（选中后由调用方走既有服务）。 */
    import { onDestroy, tick } from "svelte";
    import { attachPopover } from "../../libs/popover";
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
    const listboxId = `lvct-picker-${Math.random().toString(36).slice(2)}`;
    onDestroy(() => { aliasRequest += 1; });

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
        return attachPopover(panel, wrap, () => (open = false));
    });

    // 浮层由全局 Escape 监听关闭时，把焦点还给触发按钮，避免键盘用户落到页面随机位置。
    $effect(() => {
        if (!open) return;
        const onEscape = (event: KeyboardEvent) => {
            if (event.key !== "Escape") return;
            void tick().then(() => triggerEl?.focus());
        };
        window.addEventListener("keydown", onEscape);
        return () => window.removeEventListener("keydown", onEscape);
    });

    export function openPicker(): void {
        if (!disabled) void show();
    }

    async function show(): Promise<void> {
        query = "";
        highlight = 0;
        open = true;
        void loadAliases();
        await tick();
        inputEl?.focus();
    }
    function choose(item: PickerItem): void {
        open = false;
        onSelect(item.id);
        void tick().then(() => triggerEl?.focus());
    }
    function clearSelection(): void {
        if (disabled || !selected) return;
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
            event.preventDefault();
            open = false;
            void tick().then(() => triggerEl?.focus());
        }
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
            aria-expanded={open}
            aria-label={ariaLabel}
            disabled={disabled}
            onclick={() => (open ? (open = false) : void show())}
        >
            <span class="lvct-picker__value" class:lvct-picker__placeholder={!selected}>
                {selected ? `${selected.label}${ambiguousLabels.has(selected.label) ? ` · ${selected.docId ?? selected.id}` : ""}` : placeholder}
            </span>
            <span class="lvct-picker__caret" aria-hidden="true">▾</span>
        </button>
        {#if selected && clearable}
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
                aria-busy={aliasLoading}
                role="combobox"
                aria-autocomplete="list"
                aria-expanded="true"
                aria-controls={listboxId}
                aria-activedescendant={filtered.length > 0 ? `${listboxId}-option-${highlight}` : undefined}
                onkeydown={onSearchKeydown}
                oninput={() => { highlight = 0; if (listEl) listEl.scrollTop = 0; }}
            />
            {#if aliasLoading}
                <p class="lvct-picker__status" role="status">{text("pickerAliasLoading", "正在读取别名…")}</p>
            {/if}
            {#if filtered.length === 0 && !aliasLoading}
                <div class="lvct-picker__empty" role="status">{emptyText}</div>
            {/if}
            <ul class="lvct-picker__list" id={listboxId} role="listbox" bind:this={listEl}>
                {#each filtered as item, index (item.id)}
                    <li role="none">
                        <button
                            type="button"
                            id={`${listboxId}-option-${index}`}
                            role="option"
                            aria-selected={item.id === value}
                            class="lvct-picker__option"
                            class:lvct-picker__option--active={index === highlight}
                            onmouseenter={() => (highlight = index)}
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
