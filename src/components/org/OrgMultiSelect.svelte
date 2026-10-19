<script lang="ts">
    import { tick } from "svelte";
    import { attachPopover } from "../../libs/popover";
    import { registerDialogEscapeScope } from "../../libs/dialog-escape-scope";
    import { getFrontend } from "siyuan";
    import { Check, ChevronDown, Plus, Search, X } from "@lucide/svelte";

    let { items, value, existingIds = [], lockedIds = [], disabled = false, creating = false, onToggle, onCreate }: {
        items: readonly { docId: string; name: string; archived?: boolean }[];
        value: readonly string[];
        existingIds?: readonly string[];
        lockedIds?: readonly string[];
        disabled?: boolean;
        creating?: boolean;
        onToggle: (docId: string) => void;
        onCreate?: (name: string) => void;
    } = $props();
    let open = $state(false);
    let query = $state("");
    let wrap: HTMLElement | undefined = $state();
    let panel: HTMLElement | undefined = $state();
    let trigger: HTMLButtonElement | undefined = $state();
    let search: HTMLInputElement | undefined = $state();
    const id = `lvct-org-multi-${Math.random().toString(36).slice(2)}`;
    const frontend = getFrontend();
    const selected = $derived([...new Set(value)].map((docId) => items.find((item) => item.docId === docId) ?? { docId, name: "组织待核实", missing: true }));
    const existingCount = $derived(new Set(existingIds).size);
    const filtered = $derived(items.filter((item) => `${item.name} ${item.docId}`.toLowerCase().includes(query.trim().toLowerCase())));
    const duplicateNames = $derived.by(() => {
        const names = new Set<string>();
        const duplicates = new Set<string>();
        for (const item of items) { if (names.has(item.name)) duplicates.add(item.name); names.add(item.name); }
        return duplicates;
    });
    $effect(() => {
        if (!open || !panel || !wrap) return;
        return attachPopover(panel, wrap, close, { anchor: trigger,
            ...(frontend === "mobile" || frontend === "browser-mobile" ? { closeOnResize: false, closeOnScroll: false } : {}) });
    });
    $effect(() => { if (disabled || creating) open = false; });
    $effect(() => {
        if (open && wrap) return registerDialogEscapeScope(wrap, closeAndFocus);
    });
    function close(): void { open = false; }
    function closeAndFocus(): void {
        close();
        void tick().then(() => trigger?.isConnected && trigger.focus({ preventScroll: true }));
    }
    async function toggle(): Promise<void> {
        if (open) { close(); return; }
        open = true;
        await tick();
        search?.focus({ preventScroll: true });
    }
    function onKeydown(event: KeyboardEvent): void {
        if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            closeAndFocus();
            return;
        }
        const target = event.target;
        const options = [...(panel?.querySelectorAll<HTMLInputElement>('.lvct-org-multi__option input:not([disabled])') ?? [])];
        const index = options.indexOf(target as HTMLInputElement);
        // 搜索中的空格和 Home/End 属于文本编辑；候选仍使用原生 checkbox 的 Tab/Space。
        if (target === search && event.key === "Enter") {
            event.preventDefault();
            event.stopPropagation();
        } else if ((target === search || index >= 0) && (event.key === "ArrowDown" || event.key === "ArrowUp" || (index >= 0 && (event.key === "Home" || event.key === "End")))) {
            event.preventDefault();
            event.stopPropagation();
            if (!options.length) return;
            const next = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1
                : index < 0 ? (event.key === "ArrowUp" ? options.length - 1 : 0)
                : Math.max(0, Math.min(options.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)));
            options[next].focus({ preventScroll: true });
            const list = panel?.querySelector<HTMLElement>(".lvct-org-multi__options");
            if (list) {
                const itemRect = options[next].getBoundingClientRect(), listRect = list.getBoundingClientRect();
                if (itemRect.top < listRect.top) list.scrollTop -= listRect.top - itemRect.top;
                else if (itemRect.bottom > listRect.bottom) list.scrollTop += itemRect.bottom - listRect.bottom;
            }
        } else if (index >= 0 && event.key === "Enter") {
            event.preventDefault();
            event.stopPropagation();
            options[index].click();
        }
    }
    function create(): void {
        const name = query.trim();
        close();
        onCreate?.(name);
    }
    function toggleOption(event: Event, docId: string): void {
        const checkbox = event.currentTarget as HTMLInputElement;
        onToggle(docId);
        // 父表单可能先要求确认取消多段经历；复选状态始终以实际草稿为准。
        void tick().then(() => { if (checkbox.isConnected) checkbox.checked = value.includes(docId) || existingIds.includes(docId); });
    }
</script>

<div class="lvct-org-multi" bind:this={wrap}>
    <button type="button" class="b3-select lvct-org-multi__trigger" bind:this={trigger}
        data-lvct-escape-scope={open ? "popover" : undefined} onkeydown={(event) => { if (open) onKeydown(event); }}
        aria-label="选择组织（可多选）" aria-describedby={`${id}-status`} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined}
        disabled={disabled || creating} onclick={() => void toggle()}>
        <span>{selected.length ? `待保存 ${selected.length} 个组织` : existingCount ? `已有 ${existingCount} 个当前归属，继续添加…` : "搜索并选择组织，可多选…"}</span>
        <ChevronDown size={16} aria-hidden="true" />
    </button>
    {#if open}
        <div class="lvct-picker__panel lvct-org-multi__panel" id={id} role="dialog" aria-label="选择组织" data-lvct-escape-scope="popover" tabindex="-1" bind:this={panel} onkeydown={onKeydown}>
            <label class="lvct-org-multi__search"><Search size={16} aria-hidden="true" />
                <input class="b3-text-field" type="search" aria-label="搜索组织" placeholder="搜索组织名称…" bind:value={query} bind:this={search} />
            </label>
            <p class="lvct-org-multi__result-count ft__smaller ft__on-surface">找到 {filtered.length} 个组织；可用方向键移动、空格勾选</p>
            <div class="lvct-org-multi__options" role="group" aria-label="可选择的组织">
                {#each filtered as org (org.docId)}
                    <label class="lvct-org-multi__option" class:lvct-org-multi__option--selected={value.includes(org.docId) || existingIds.includes(org.docId)}>
                        <input type="checkbox" checked={value.includes(org.docId) || existingIds.includes(org.docId)}
                            aria-label={duplicateNames.has(org.name) ? `${org.name} · ${org.docId}` : org.name}
                            disabled={disabled || existingIds.includes(org.docId) || lockedIds.includes(org.docId)} onchange={(event) => toggleOption(event, org.docId)} />
                        <span><strong>{org.name}</strong>
                            {#if duplicateNames.has(org.name)}<small>{org.docId}</small>{/if}
                            {#if existingIds.includes(org.docId)}<small>已有当前归属，可在下方编辑</small>
                            {:else if lockedIds.includes(org.docId)}<small>原保存结果待核实</small>
                            {:else if org.archived}<small>已归档 · 仅补录历史经历</small>{/if}
                        </span>
                        {#if value.includes(org.docId)}<Check size={15} aria-hidden="true" />{/if}
                    </label>
                {:else}
                    <p class="lvct-org-multi__empty">{query.trim() ? (onCreate ? "没有匹配的组织，可以直接新建。" : "没有匹配的组织，请尝试其他名称。") : (onCreate ? "还没有组织，可以先新建一个。" : "还没有可选择的组织。")}</p>
                {/each}
            </div>
            <div class="lvct-org-multi__footer">
                {#if onCreate}<button type="button" class="b3-button b3-button--text" disabled={disabled || creating} onclick={create}><Plus size={15} aria-hidden="true" />新建组织{query.trim() ? `「${query.trim()}」` : ""}</button>{/if}
                <button type="button" class="b3-button b3-button--outline" onclick={() => { close(); trigger?.focus({ preventScroll: true }); }}>完成选择</button>
            </div>
        </div>
    {/if}
    {#if selected.length}
        <div class="lvct-org-multi__selected" aria-label="本次选择的组织">
            {#each selected as org (org.docId)}
                <span class="lvct-org-multi__chip" data-org-doc-id={org.docId}>
                    <span title={org.docId}>{org.name}{duplicateNames.has(org.name) || "missing" in org ? ` · ${org.docId}` : ""}{lockedIds.includes(org.docId) ? " · 待核实" : ""}</span>
                    <button type="button" class="b3-button b3-button--text" aria-label={`取消选择${org.name}${duplicateNames.has(org.name) || "missing" in org ? ` · ${org.docId}` : ""}`}
                        disabled={disabled || creating || lockedIds.includes(org.docId)} onclick={() => onToggle(org.docId)}><X size={14} aria-hidden="true" /></button>
                </span>
            {/each}
        </div>
    {/if}
    <p class="lvct-org-multi__status ft__smaller ft__on-surface" id={`${id}-status`} role="status" aria-live="polite" aria-atomic="true">{open ? `找到 ${filtered.length} 个组织。` : ""}本次待保存 {selected.length} 个组织{existingCount ? `，已有 ${existingCount} 个当前归属` : ""}。</p>
    <div class="lvct-org-multi__summary">
        <span class="ft__smaller ft__on-surface">可选择家庭、单位、学校、社团等，在下方分别设置经历。</span>
        {#if onCreate}<button type="button" class="b3-button b3-button--text" disabled={disabled || creating} onclick={create}>{creating ? "组织创建中…" : "新建组织"}</button>{/if}
    </div>
</div>

<style>
    .lvct-org-multi { position: relative; min-width: 0; }
    .lvct-org-multi__trigger { display: flex; align-items: center; justify-content: space-between; gap: 8px; width: 100%; min-height: 40px; text-align: left; }
    .lvct-org-multi__trigger span { white-space: normal; overflow-wrap: anywhere; }
    .lvct-org-multi__panel { width: min(420px, calc(100vw - 16px)); max-width: calc(100vw - 16px); padding: 8px; box-sizing: border-box; }
    .lvct-org-multi__search { display: flex; align-items: center; gap: 8px; }
    .lvct-org-multi__search input { flex: 1; min-width: 0; }
    .lvct-org-multi__options { max-height: min(280px, 40vh); overflow: auto; margin: 8px 0; }
    .lvct-org-multi__result-count { margin: 4px 0 0; }
    .lvct-org-multi__selected { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 8px; }
    .lvct-org-multi__chip { display: inline-flex; align-items: center; gap: 2px; max-width: 100%; padding: 0 2px 0 10px; border-radius: 16px; background: var(--lvct-accent-soft); }
    .lvct-org-multi__chip > span { min-width: 0; overflow-wrap: anywhere; }
    .lvct-org-multi__chip button { flex-shrink: 0; width: 32px; height: 32px; padding: 0; }
    .lvct-org-multi__status { margin: 6px 0; }
    .lvct-org-multi__option:focus-within { outline: 2px solid var(--lvct-accent); outline-offset: -2px; }
    .lvct-org-multi__option { display: flex; align-items: center; gap: 10px; min-height: 44px; padding: 8px; box-sizing: border-box; border-radius: 6px; cursor: pointer; }
    .lvct-org-multi__option:hover { background: var(--lvct-bg-hover); }
    .lvct-org-multi__option--selected { background: var(--lvct-accent-soft); }
    .lvct-org-multi__option span { flex: 1; min-width: 0; overflow-wrap: anywhere; }
    .lvct-org-multi__option small { display: block; color: var(--lvct-text-2); }
    .lvct-org-multi__empty { padding: 12px 8px; color: var(--lvct-text-2); }
    .lvct-org-multi__footer, .lvct-org-multi__summary { display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap; }
    .lvct-org-multi__footer { border-top: 1px solid var(--lvct-border-subtle); padding-top: 8px; }
    .lvct-org-multi__footer button { white-space: normal; overflow-wrap: anywhere; }
    .lvct-org-multi__summary { margin-top: 6px; }
    @media (max-width: 640px) { .lvct-org-multi__chip button { width: 44px; height: 44px; } }
</style>
