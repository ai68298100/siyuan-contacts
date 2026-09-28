<script lang="ts">
    /** B03 可搜索选人器：输入即筛 + 键盘上下/回车 + 分组·标签提示 + 空态提示。
     *  浮层复用 popover 定位原语（B02），在 Peek/工作台滚动容器内不被裁剪。
     *  只改选择交互，不改变调用方的写入语义（选中后由调用方走既有服务）。 */
    import { tick } from "svelte";
    import { attachPopover } from "../../libs/popover";
    import { translateText } from "../../domain/translation";

    export interface PickerItem {
        id: string;
        label: string;
        /** 次要行：分组 · 标签 */
        hint?: string;
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
    let inputEl: HTMLInputElement | undefined = $state();

    const selected = $derived(items.find((item) => item.id === value) ?? null);
    const filtered = $derived.by(() => {
        const needle = query.trim().toLowerCase();
        if (!needle) return items;
        return items.filter((item) =>
            item.label.toLowerCase().includes(needle) || (item.keywords ?? "").includes(needle));
    });

    $effect(() => {
        if (!open || !wrap || !panel) return;
        return attachPopover(panel, wrap, () => (open = false));
    });

    export function openPicker(): void {
        if (!disabled) void show();
    }

    async function show(): Promise<void> {
        query = "";
        highlight = 0;
        open = true;
        await tick();
        inputEl?.focus();
    }
    function choose(item: PickerItem): void {
        open = false;
        onSelect(item.id);
    }
    function onSearchKeydown(event: KeyboardEvent): void {
        if (event.key === "ArrowDown") {
            event.preventDefault();
            highlight = Math.min(highlight + 1, filtered.length - 1);
        } else if (event.key === "ArrowUp") {
            event.preventDefault();
            highlight = Math.max(highlight - 1, 0);
        } else if (event.key === "Enter") {
            event.preventDefault();
            const item = filtered[highlight];
            if (item) choose(item);
        }
    }
</script>

<div class="lvct-picker" bind:this={wrap}>
    <button
        type="button"
        class="b3-select lvct-picker__trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        disabled={disabled}
        onclick={() => (open ? (open = false) : void show())}
    >
        <span class="lvct-picker__value" class:lvct-picker__placeholder={!selected}>
            {selected ? selected.label : placeholder}
        </span>
        <span class="lvct-picker__caret" aria-hidden="true">▾</span>
    </button>
    {#if open}
        <div class="lvct-picker__panel" bind:this={panel}>
            <input
                class="b3-text-field lvct-picker__search"
                type="text"
                bind:this={inputEl}
                bind:value={query}
                placeholder={text("pickerSearch", searchText)}
                aria-label={text("pickerSearch", searchText)}
                role="combobox"
                aria-expanded="true"
                aria-controls="lvct-picker-listbox"
                onkeydown={onSearchKeydown}
                oninput={() => (highlight = 0)}
            />
            {#if filtered.length === 0}
                <div class="lvct-picker__empty" role="status">{emptyText}</div>
            {:else}
                <ul class="lvct-picker__list" id="lvct-picker-listbox" role="listbox">
                    {#each filtered as item, index (item.id)}
                        <li role="none">
                            <button
                                type="button"
                                role="option"
                                aria-selected={item.id === value}
                                class="lvct-picker__option"
                                class:lvct-picker__option--active={index === highlight}
                                onmouseenter={() => (highlight = index)}
                                onclick={() => choose(item)}
                            >
                                <span class="lvct-picker__label">{item.label}</span>
                                {#if item.hint}<span class="lvct-picker__hint">{item.hint}</span>{/if}
                            </button>
                        </li>
                    {/each}
                </ul>
            {/if}
        </div>
    {/if}
</div>
