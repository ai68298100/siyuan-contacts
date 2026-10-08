<script lang="ts">
    /** 存量文档收编：选笔记本 → 勾选"人名"文档 → 批量绑定为联系人 */
    import { listImportNotebooks } from "../../services/contacts";
    import { scanImportCandidates } from "../../services/import-scan";
    import type { ImportScanSnapshot } from "../../services/import-scan";
    import { runDocumentImportQueue } from "../../services/import";
    import type { ImportCandidate } from "../../services/contacts";
    import type { ContactsSettings } from "../../domain/model";
    import { onDestroy } from "svelte";
    import ViewState from "../ViewState.svelte";
    import GroupField from "./GroupField.svelte";
    import { importAnchor, normalizeImportTags, snapshotImportQueue } from "../../domain/import";
    import type { DocumentImportQueue } from "../../domain/import";
    import { useCloseGuard } from "../close-guard";
    import { translateText } from "../../domain/translation";

    let {
        settings,
        i18n,
        onImported,
        onClose,
    }: {
        settings: ContactsSettings;
        i18n?: Readonly<Record<string, string>>;
        onImported: (count: number) => void;
        onClose: () => void;
    } = $props();
    const text = $derived.by(() => (key: string, fallback: string, values?: Record<string, string | number>) =>
        translateText(i18n, key, fallback, values));

    type Notebook = { id: string; name: string };

    let notebooks: Notebook[] = $state([]);
    let notebookId: string = $state("");
    let keyword: string = $state("");
    let folderPrefix: string = $state("");
    let importGroup: string = $state("");
    let groupValid = $state(true);
    let importTagsText: string = $state("");
    let candidates: ImportCandidate[] = $state([]);
    let selectionPool = $state<Record<string, ImportCandidate & { notebookId: string }>>({});
    let selected: Record<string, boolean> = $state({});
    let loading: boolean = $state(false);
    let importing: boolean = $state(false);
    let errorText: string = $state("");
    let loaded = $state(false);
    let importedCount: number | null = $state(null);
    let scan = $state.raw<ImportScanSnapshot | null>(null);
    let queue = $state.raw<DocumentImportQueue | null>(null);
    let pauseRequested = $state(false);
    let progress = $state("");
    const guardedClose = useCloseGuard({
        busy: () => loading || importing,
        dirty: () => queue ? queue.items.some((item) => item.status !== "applied" && item.status !== "skipped")
            : importedCount === null && (selectedIds.length > 0 || importGroup !== "" || importTagsText.trim() !== ""),
        changes: () => [
            ...(queue ? ["原文档队列与核实断点只保留本窗口，关闭后不自动恢复"] : []),
            ...(selectedIds.length > 0 ? [text("guardAdoptSelection", "已勾选 {n} 篇文档待收编", { n: selectedIds.length })] : []),
            ...(importGroup !== "" || importTagsText.trim() !== "" ? [text("guardAdoptMeta", "收编分组/标签输入尚未应用")] : []),
        ],
    });

    let searchTimer: ReturnType<typeof setTimeout> | undefined;
    let searchVersion = 0;
    onDestroy(() => {
        clearTimeout(searchTimer);
        searchVersion += 1;
    });

    const selectedIds = $derived(Object.entries(selected).filter(([, on]) => on).map(([id]) => id));
    const candidateIdSet = $derived(new Set(candidates.map((candidate) => candidate.docId)));
    const hiddenSelectedCount = $derived(selectedIds.filter((id) => !candidateIdSet.has(id)).length);

    async function loadNotebooks() {
        loading = true;
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
        } finally {
            loading = false;
        }
    }

    async function search(continueScan = false) {
        clearTimeout(searchTimer);
        if (!notebookId) return;
        const version = ++searchVersion;
        loading = true;
        if (!continueScan) { candidates = []; scan = null; }
        errorText = "";
        const sourceNotebookId = notebookId;
        try {
            const result = await scanImportCandidates(settings, notebookId, {
                keyword, folderPrefix, previous: continueScan ? scan ?? undefined : undefined,
            });
            if (version !== searchVersion) return;
            scan = result;
            candidates = result.candidates;
            for (const candidate of result.candidates) {
                if (!selected[candidate.docId]) selectionPool[candidate.docId] = { ...candidate, notebookId: sourceNotebookId };
            }
            errorText = result.state === "failed" ? result.error ?? "扫描读取失败，范围尚未核实" : "";
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
        loading = !!notebookId;
        searchTimer = setTimeout(() => search(), 400);
    }

    function onFolderInput() {
        clearTimeout(searchTimer);
        searchVersion += 1;
        loading = !!notebookId;
        searchTimer = setTimeout(() => search(), 400);
    }

    function toggleAll(on: boolean) {
        const next: Record<string, boolean> = { ...selected };
        for (const candidate of candidates) next[candidate.docId] = on;
        selected = next;
    }

    async function runImport() {
        if (importing || loading || errorText || importedCount !== null || selectedIds.length === 0) return;
        if (!groupValid) return;
        try {
            queue = snapshotImportQueue(importAnchor(settings), notebookId,
                selectedIds.map((docId) => selectionPool[docId]),
                { group: importGroup, tags: normalizeImportTags(importTagsText) });
        } catch (error) {
            errorText = error instanceof Error ? error.message : String(error);
            return;
        }
        await runQueue();
    }

    async function runQueue(retryOnly = false) {
        if (importing || !queue) return;
        importing = true;
        pauseRequested = false;
        errorText = "";
        const currentQueue = queue;
        const before = currentQueue.items.filter((item) => item.status === "applied").length;
        try {
            const result = await runDocumentImportQueue(settings, currentQueue, {
                retryOnly,
                shouldPause: () => pauseRequested,
                onProgress: (done, total) => { progress = `已核实 ${done}/${total} 项`; },
            });
            queue = { ...result, items: result.items.map((item) => ({ ...item })) };
            const added = result.items.filter((item) => item.status === "applied").length - before;
            if (added > 0) onImported(added);
        } catch (error) {
            queue = { ...currentQueue, items: currentQueue.items.map((item) => ({ ...item })) };
            errorText = error instanceof Error ? error.message : String(error);
        } finally {
            importing = false;
        }
    }

    loadNotebooks();
</script>

<div class="lvct-import">
    {#if queue}
        <div role="status" aria-live="polite">
            <b>固定导入队列：{queue.items.length} 篇原文档</b>
            <p>{progress || "队列按文档 ID 保存，继续不会加入新搜索结果。"}</p>
            <p>成功 {queue.items.filter((item) => item.status === "applied").length} · 跳过 {queue.items.filter((item) => item.status === "skipped").length} · 未执行 {queue.items.filter((item) => item.status === "pending").length}</p>
        </div>
        {#if errorText}<p class="lvct-form__error" role="alert">{errorText}</p>{/if}
        <ul>
            {#each queue.items as item (item.docId)}
                <li class={`lvct-import__queue-item lvct-import__queue-item--${item.status}`}>
                    <span class="lvct-import__queue-title">{item.name} · {item.docId}</span>
                    <span class="lvct-import__queue-status">{item.status === "applied" ? "已核实成功" : item.status === "skipped" ? "已绑定，跳过" : item.status === "pending" ? "未执行" : item.status === "unknown" ? "未知，需核实" : item.status === "conflict" ? "目标或字段冲突" : "失败"}</span>
                    <p class="ft__smaller">来源笔记本 {item.notebookId}{item.itemId ? ` · 行 ${item.itemId}` : ""}</p>
                    {#if item.message}<p class="ft__smaller">{item.message}</p>{/if}
                </li>
            {/each}
        </ul>
        <p class="ft__smaller ft__on-surface">断点仅保留本窗口；关闭不会删除已保存文档，但重开不自动恢复队列。暂停在当前项完成后生效。</p>
        <div class="lvct-form__actions">
            {#if importing}<button class="b3-button b3-button--outline" onclick={() => (pauseRequested = true)} disabled={pauseRequested}>{pauseRequested ? "当前项结束后暂停" : "暂停"}</button>
            {:else if queue.items.some((item) => item.status !== "applied" && item.status !== "skipped")}
                <button class="b3-button b3-button--outline" onclick={() => runQueue()}>继续并核实未完成项</button>
                {#if queue.items.some((item) => item.status !== "pending" && item.status !== "applied" && item.status !== "skipped")}
                    <button class="b3-button b3-button--outline" onclick={() => runQueue(true)}>仅重试失败/未知/冲突项</button>
                {/if}
            {/if}
            <button class="b3-button b3-button--cancel" onclick={() => guardedClose(onClose)} disabled={importing}>关闭</button>
        </div>
    {:else}
    {#if importedCount === null}
    <div class="lvct-people__toolbar lvct-people__control-surface fn__flex">
        <select class="b3-select" aria-label={text("importPickNotebook", "选择待收编文档的笔记本")} bind:value={notebookId} onchange={() => search()} disabled={importing || !loaded}>
            {#each notebooks as notebook (notebook.id)}
                <option value={notebook.id}>{notebook.name}</option>
            {/each}
        </select>
        <input
            class="b3-text-field fn__flex-1"
            type="text"
            placeholder={text("importFilterName", "按文档名过滤…")}
            aria-label={text("importFilterNameAria", "按文档名过滤")}
            bind:value={keyword}
            oninput={onKeywordInput}
            disabled={importing || !notebookId}
        />
        <input
            class="b3-text-field"
            type="text"
            placeholder={text("importFilterFolder", "按文件夹前缀过滤…")}
            aria-label={text("importFilterFolderAria", "按文件夹前缀过滤")}
            bind:value={folderPrefix}
            oninput={onFolderInput}
            disabled={importing || !notebookId}
        />
    </div>
    {/if}

    {#if scan && !loading}
        <p class="lvct-import__scan-status" role="status" aria-live="polite">已扫描 {scan.scanned} 篇 · 可收编 {scan.candidates.length} 篇 · {scan.state === "complete" ? "已核实完整范围" : scan.state === "failed" ? "读取失败，保留前页游标与候选" : "尚有未扫描范围"}</p>
        {#if scan.state !== "complete"}<button class="b3-button b3-button--outline" onclick={() => search(true)} disabled={importing || loading}>{scan.state === "failed" ? "从失败页重试扫描" : "继续扫描"}</button>{/if}
        <p class="ft__smaller">全选仅包含已扫描候选；继续不会自动勾选新增项。姓名 → 文档标题；分组/标签 → 已确认字段，原正文保持原位。</p>
    {/if}
    {#if selectedIds.length}
        <p role="status">手动选择 {selectedIds.length} 篇 · 当前范围隐藏 {hiddenSelectedCount} 篇；筛选和来源切换保留原文档与笔记本，导入包含这些已选对象。</p>
        <button class="b3-button b3-button--text" onclick={() => (selected = {})} disabled={importing || loading}>清空全部选择</button>
    {/if}

    {#if importedCount !== null}
        <div class="lvct-empty lvct-empty--compact">
            <div class="lvct-empty__icon" aria-hidden="true">✓</div>
            <b>{text("importDoneTitle", "收编完成")}</b>
            <p>{text("importDoneDesc", "已将 {n} 篇文档绑定为联系人，原文档内容没有移动或修改。", { n: importedCount })}</p>
        </div>
    {:else if errorText}
        <ViewState compact error title={text("importErrorTitle", "文档收编未完成")} description={errorText}>
            <button class="b3-button b3-button--outline" onclick={() => notebookId ? search(Boolean(scan)) : loadNotebooks()}>{text("importRescan", "重新扫描")}</button>
        </ViewState>
    {:else if loading || !loaded}
        <ViewState compact loading title={text("importScanning", "正在扫描可收编的文档")} />
    {:else if candidates.length === 0}
        <ViewState compact title={notebooks.length === 0 ? text("importNoNotebooks", "没有可扫描的笔记本") : text("importNoDocs", "没有可收编的文档")}
            description={keyword ? text("importNoMatchDesc", "当前关键词没有匹配文档，可以清除关键词后再试。") : text("importNoDocsDesc", "可以换一本笔记本，或先创建人物文档，再回来扫描。")}>
            {#if keyword}
                <button class="b3-button b3-button--outline" onclick={() => { keyword = ""; void search(); }}>{text("importClearKeyword", "清除关键词")}</button>
            {/if}
            <button class="b3-button b3-button--outline" onclick={loadNotebooks}>{text("importRefreshNotebooks", "刷新笔记本")}</button>
        </ViewState>
    {:else}
        <div class="lvct-import__list">
            <label class="lvct-import__row lvct-import__row--head">
                <input
                    class="b3-switch"
                    type="checkbox"
                    checked={candidates.length > 0 && candidates.every((candidate) => selected[candidate.docId])}
                    onchange={(event) => toggleAll((event.currentTarget as HTMLInputElement).checked)}
                />
                <span>{text("importSelectAll", "全选（{n} 篇）", { n: candidates.length })}</span>
            </label>
            {#each candidates as candidate (candidate.docId)}
                <label class="lvct-import__row">
                    <input class="b3-switch" type="checkbox" bind:checked={selected[candidate.docId]} />
                    <span class="lvct-import__name"><b>{candidate.name}</b></span>
                    <span class="ft__smaller ft__on-surface lvct-import__path">{candidate.docId} · {candidate.hpath}</span>
                </label>
            {/each}
        </div>
        <div class="lvct-form__grid lvct-import__options">
            <GroupField {i18n} value={importGroup} onValueChange={(value) => (importGroup = value)} onValidityChange={(valid) => (groupValid = valid)} label={text("importGroupLabel", "收编后分组（可选）")} ungroupedLabel={text("importNoGroup", "不设置分组")} disabled={importing} />
            <label class="lvct-form__item">
                <span>{text("importTagsLabel", "收编后标签（可选）")}</span>
                <input class="b3-text-field fn__block" type="text" bind:value={importTagsText} placeholder={text("importTagsPlaceholder", "客户 重点")} disabled={importing} />
            </label>
        </div>
    {/if}

    <div class="lvct-form__actions">
        {#if importedCount !== null}
            <button class="b3-button b3-button--text" onclick={onClose}>{text("importDone", "完成")}</button>
        {:else}
            <button class="b3-button b3-button--cancel" onclick={() => guardedClose(onClose)} disabled={importing}>{text("importCancel", "取消")}</button>
            <button class="b3-button b3-button--text" onclick={runImport} disabled={importing || loading || !!errorText || !groupValid || selectedIds.length === 0}>
                {importing ? text("importAdopting", "收编中…") : text("importAdoptAs", "收编为联系人（{n}）", { n: selectedIds.length })}
            </button>
        {/if}
    </div>
    <p class="ft__smaller ft__on-surface lvct-form__hint">
        {text("importHint", "收编不会移动或修改文档本身，只是把它绑定为数据库一行（文档标题即姓名）。")}
    </p>
    {/if}
</div>
