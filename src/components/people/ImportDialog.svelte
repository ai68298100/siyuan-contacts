<script lang="ts">
    /** 存量文档收编：选笔记本 → 勾选"人名"文档 → 批量绑定为联系人 */
    import { adoptDocs, discoverImportCandidates, listImportNotebooks } from "../../services/contacts";
    import type { ImportCandidate } from "../../services/contacts";
    import type { ContactsSettings } from "../../domain/model";

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
    let candidates: ImportCandidate[] = $state([]);
    let selected: Record<string, boolean> = $state({});
    let loading: boolean = $state(false);
    let importing: boolean = $state(false);
    let errorText: string = $state("");
    let loaded = $state(false);

    let searchTimer: ReturnType<typeof setTimeout> | undefined;

    const selectedIds = $derived(Object.entries(selected).filter(([, on]) => on).map(([id]) => id));

    async function loadNotebooks() {
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
        if (!notebookId) return;
        loading = true;
        errorText = "";
        try {
            candidates = await discoverImportCandidates(settings, notebookId, keyword);
            selected = {};
            loaded = true;
        } catch (error) {
            errorText = error instanceof Error ? error.message : String(error);
        } finally {
            loading = false;
        }
    }

    function onKeywordInput() {
        clearTimeout(searchTimer);
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
        if (importing || selectedIds.length === 0) return;
        importing = true;
        errorText = "";
        try {
            const chosen = candidates.filter((candidate) => selected[candidate.docId]);
            const count = await adoptDocs(settings, chosen);
            onImported(count);
            onClose();
        } catch (error) {
            errorText = error instanceof Error ? error.message : String(error);
        } finally {
            importing = false;
        }
    }

    loadNotebooks();
</script>

<div class="lvct-import">
    <div class="lvct-people__toolbar fn__flex">
        <select class="b3-select" bind:value={notebookId} onchange={() => search()} disabled={loading || importing}>
            {#each notebooks as notebook (notebook.id)}
                <option value={notebook.id}>{notebook.name}</option>
            {/each}
        </select>
        <input
            class="b3-text-field fn__flex-1"
            type="text"
            placeholder="按文档名过滤…"
            bind:value={keyword}
            oninput={onKeywordInput}
            disabled={loading || importing}
        />
    </div>

    {#if errorText}
        <div class="lvct-form__error">{errorText}</div>
    {:else if loading || !loaded}
        <div class="lvct-placeholder">扫描中…</div>
    {:else if candidates.length === 0}
        <div class="lvct-placeholder">该笔记本下没有可收编的文档（已绑定或无文档）。</div>
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
    {/if}

    <div class="lvct-form__actions">
        <button class="b3-button b3-button--cancel" onclick={onClose}>取消</button>
        <button class="b3-button b3-button--text" onclick={runImport} disabled={importing || selectedIds.length === 0}>
            {importing ? "收编中…" : `收编为联系人（${selectedIds.length}）`}
        </button>
    </div>
    <p class="ft__smaller ft__on-surface lvct-form__hint">
        收编不会移动或修改文档本身，只是把它绑定为数据库一行（文档标题即姓名）。
    </p>
</div>
