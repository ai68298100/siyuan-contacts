<script lang="ts">
    /** 存量文档收编：选笔记本 → 勾选"人名"文档 → 批量绑定为联系人 */
    import { adoptDocs, discoverImportCandidates, listImportNotebooks, PRESET_GROUPS } from "../../services/contacts";
    import type { ImportCandidate } from "../../services/contacts";
    import type { ContactsSettings } from "../../domain/model";
    import { onDestroy } from "svelte";
    import ViewState from "../ViewState.svelte";
    import { normalizeImportTags } from "../../domain/import";

    let {
        settings,
        onImported,
        onClose,
    }: {
        settings: ContactsSettings;
        onImported: (count: number) => void;
        onClose: () => void;
    } = $props();

    type Notebook = { id: string; name: string };

    let notebooks: Notebook[] = $state([]);
    let notebookId: string = $state("");
    let keyword: string = $state("");
    let folderPrefix: string = $state("");
    let importGroup: string = $state("");
    let importTagsText: string = $state("");
    let candidates: ImportCandidate[] = $state([]);
    let selected: Record<string, boolean> = $state({});
    let loading: boolean = $state(false);
    let importing: boolean = $state(false);
    let errorText: string = $state("");
    let loaded = $state(false);
    let importedCount: number | null = $state(null);

    let searchTimer: ReturnType<typeof setTimeout> | undefined;
    let searchVersion = 0;
    onDestroy(() => {
        clearTimeout(searchTimer);
        searchVersion += 1;
    });

    const selectedIds = $derived(Object.entries(selected).filter(([, on]) => on).map(([id]) => id));

    async function loadNotebooks() {
        errorText = "";
        loaded = false;
        try {
            notebooks = await listImportNotebooks(settings);
            if (notebooks.length > 0) {
                notebookId = notebooks[0].id;
                await search();
            } else {
                loaded = true;
            }
        } catch (error) {
            errorText = error instanceof Error ? error.message : String(error);
            loaded = true;
        }
    }

    async function search() {
        clearTimeout(searchTimer);
        if (!notebookId) return;
        const version = ++searchVersion;
        loading = true;
        selected = {};
        errorText = "";
        try {
            const result = await discoverImportCandidates(settings, notebookId, keyword, folderPrefix);
            if (version !== searchVersion) return;
            candidates = result;
            loaded = true;
        } catch (error) {
            if (version === searchVersion) errorText = error instanceof Error ? error.message : String(error);
        } finally {
            if (version === searchVersion) loading = false;
        }
    }

    function onKeywordInput() {
        clearTimeout(searchTimer);
        searchVersion += 1;
        selected = {};
        loading = !!notebookId;
        searchTimer = setTimeout(() => search(), 400);
    }

    function onFolderInput() {
        clearTimeout(searchTimer);
        searchVersion += 1;
        selected = {};
        loading = !!notebookId;
        searchTimer = setTimeout(() => search(), 400);
    }

    function toggleAll(on: boolean) {
        const next: Record<string, boolean> = {};
        if (on) {
            for (const candidate of candidates) next[candidate.docId] = true;
        }
        selected = next;
    }

    async function runImport() {
        if (importing || loading || errorText || importedCount !== null || selectedIds.length === 0) return;
        importing = true;
        errorText = "";
        try {
            const chosen = candidates.filter((candidate) => selected[candidate.docId]);
            const tags = normalizeImportTags(importTagsText);
            const count = await adoptDocs(settings, chosen, {
                group: importGroup || undefined,
                tags,
            });
            importedCount = count;
            onImported(count);
        } catch (error) {
            errorText = error instanceof Error ? error.message : String(error);
        } finally {
            importing = false;
        }
    }

    loadNotebooks();
</script>

<div class="lvct-import">
    {#if importedCount === null}
    <div class="lvct-people__toolbar fn__flex">
        <select class="b3-select" aria-label="选择待收编文档的笔记本" bind:value={notebookId} onchange={() => search()} disabled={importing || !loaded}>
            {#each notebooks as notebook (notebook.id)}
                <option value={notebook.id}>{notebook.name}</option>
            {/each}
        </select>
        <input
            class="b3-text-field fn__flex-1"
            type="text"
            placeholder="按文档名过滤…"
            aria-label="按文档名过滤"
            bind:value={keyword}
            oninput={onKeywordInput}
            disabled={importing || !notebookId}
        />
        <input
            class="b3-text-field"
            type="text"
            placeholder="按文件夹前缀过滤…"
            aria-label="按文件夹前缀过滤"
            bind:value={folderPrefix}
            oninput={onFolderInput}
            disabled={importing || !notebookId}
        />
    </div>
    {/if}

    {#if importedCount !== null}
        <div class="lvct-empty lvct-empty--compact">
            <div class="lvct-empty__icon" aria-hidden="true">✓</div>
            <b>收编完成</b>
            <p>已将 {importedCount} 篇文档绑定为联系人，原文档内容没有移动或修改。</p>
        </div>
    {:else if errorText}
        <ViewState compact error title="文档收编未完成" description={errorText}>
            <button class="b3-button b3-button--outline" onclick={() => notebookId ? search() : loadNotebooks()}>重新扫描</button>
        </ViewState>
    {:else if loading || !loaded}
        <ViewState compact loading title="正在扫描可收编的文档" />
    {:else if candidates.length === 0}
        <ViewState compact title={notebooks.length === 0 ? "没有可扫描的笔记本" : "没有可收编的文档"}
            description={keyword ? "当前关键词没有匹配文档，可以清除关键词后再试。" : "可以换一本笔记本，或先创建人物文档，再回来扫描。"}>
            {#if keyword}
                <button class="b3-button b3-button--outline" onclick={() => { keyword = ""; void search(); }}>清除关键词</button>
            {/if}
            <button class="b3-button b3-button--outline" onclick={loadNotebooks}>刷新笔记本</button>
        </ViewState>
    {:else}
        <div class="lvct-import__list">
            <label class="lvct-import__row lvct-import__row--head">
                <input
                    class="b3-switch"
                    type="checkbox"
                    checked={selectedIds.length === candidates.length}
                    onchange={(event) => toggleAll((event.currentTarget as HTMLInputElement).checked)}
                />
                <span>全选（{candidates.length} 篇）</span>
            </label>
            {#each candidates as candidate (candidate.docId)}
                <label class="lvct-import__row">
                    <input class="b3-switch" type="checkbox" bind:checked={selected[candidate.docId]} />
                    <span class="lvct-import__name"><b>{candidate.name}</b></span>
                    <span class="ft__smaller ft__on-surface lvct-import__path">{candidate.hpath}</span>
                </label>
            {/each}
        </div>
        <div class="lvct-form__grid lvct-import__options">
            <label class="lvct-form__item">
                <span>收编后分组（可选）</span>
                <select class="b3-select fn__block" bind:value={importGroup} disabled={importing}>
                    <option value="">不设置分组</option>
                    {#each PRESET_GROUPS as group (group)}<option value={group}>{group}</option>{/each}
                </select>
            </label>
            <label class="lvct-form__item">
                <span>收编后标签（可选）</span>
                <input class="b3-text-field fn__block" type="text" bind:value={importTagsText} placeholder="客户 重点" disabled={importing} />
            </label>
        </div>
    {/if}

    <div class="lvct-form__actions">
        {#if importedCount !== null}
            <button class="b3-button b3-button--text" onclick={onClose}>完成</button>
        {:else}
            <button class="b3-button b3-button--cancel" onclick={onClose}>取消</button>
            <button class="b3-button b3-button--text" onclick={runImport} disabled={importing || loading || !!errorText || selectedIds.length === 0}>
                {importing ? "收编中…" : `收编为联系人（${selectedIds.length}）`}
            </button>
        {/if}
    </div>
    <p class="ft__smaller ft__on-surface lvct-form__hint">
        收编不会移动或修改文档本身，只是把它绑定为数据库一行（文档标题即姓名）。
    </p>
</div>
