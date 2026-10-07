<script lang="ts">
    import type { ContactsPluginFacade } from "../types";
    import type { WorkspaceState } from "../domain/workspace-state";
    import type { ContactsSettings } from "../domain/model";
    import type { AnchorCandidate } from "../services/init";
    import type { AnchorScanCursor } from "../domain/init-plan";
    import type { SettingsRebindPreview, SettingsAnchorPatch } from "../services/settings-health";

    let { facade, workspace, onReady, onRetry, onStartInit }: {
        facade: ContactsPluginFacade;
        workspace: WorkspaceState;
        onReady: (settings: ContactsSettings) => void;
        onRetry: () => void | Promise<void>;
        onStartInit: () => void;
    } = $props();

    let scanning = $state(false);
    let retrying = $state(false);
    let busy = $state(false);
    let message = $state("");
    let candidates = $state<AnchorCandidate[]>([]);
    let scanCursor = $state<AnchorScanCursor | null>(null);
    let selected = $state<AnchorCandidate | null>(null);
    let preview = $state<SettingsRebindPreview | null>(null);

    const labels: Record<WorkspaceState["kind"], string> = {
        uninitialized: "尚未初始化",
        ready: "已就绪",
        "settings-invalid": "设置文件无效",
        "settings-read-failed": "设置文件读取失败",
        "anchor-missing": "联系人数据锚点已失效",
        "anchor-unknown": "联系人数据锚点暂时无法核实",
    };

    function mergeCandidates(previous: readonly AnchorCandidate[], incoming: readonly AnchorCandidate[]): AnchorCandidate[] {
        const merged = new Map<string, AnchorCandidate>();
        for (const candidate of [...previous, ...incoming]) {
            merged.set(`${candidate.notebookId}/${candidate.hostDocId}/${candidate.dbBlockId}/${candidate.avId}`, candidate);
        }
        return [...merged.values()].sort((left, right) => right.matchedFields - left.matchedFields);
    }

    async function retryWorkspace(): Promise<void> {
        if (retrying || busy || scanning) return;
        retrying = true;
        message = "";
        try {
            await onRetry();
        } catch (error) {
            message = error instanceof Error ? error.message : String(error);
        } finally {
            retrying = false;
        }
    }

    async function scan(resume = false) {
        scanning = true;
        message = "";
        try {
            const result = await facade.scanAnchorCandidates(resume && scanCursor
                ? { cursor: scanCursor, maxDocuments: 1000 }
                : { maxDocuments: 1000 });
            candidates = mergeCandidates(resume ? candidates : [], result.candidates);
            scanCursor = result.cursor;
            const issueHint = result.issues.length ? `另有 ${result.issues.length} 个位置读取失败，未纳入候选。` : "";
            message = result.status === "blocked"
                ? `扫描被暂停：${result.issues[0]?.message ?? "请稍后重试"}${issueHint}`
                : result.status === "truncated"
                    ? `本轮已到扫描上限，暂有 ${candidates.length} 个候选；可继续扫描。${issueHint}`
                    : candidates.length ? `找到 ${candidates.length} 个候选，请核对后再重绑。${issueHint}` : `没有找到字段证据完整的候选数据库。${issueHint}`;
        } catch (error) {
            message = error instanceof Error ? error.message : String(error);
        } finally {
            scanning = false;
        }
    }

    async function previewCandidate(candidate: AnchorCandidate) {
        if (busy) return;
        busy = true;
        message = "";
        selected = candidate;
        preview = null;
        try {
            const patch: SettingsAnchorPatch = { notebookId: candidate.notebookId, hostDocId: candidate.hostDocId, dbBlockId: candidate.dbBlockId, avId: candidate.avId };
            preview = await facade.previewRebindSettings(patch);
        } catch (error) {
            message = error instanceof Error ? error.message : String(error);
        } finally {
            busy = false;
        }
    }

    async function confirmRebind() {
        if (!selected || !preview || busy) return;
        busy = true;
        try {
            const patch: SettingsAnchorPatch = { notebookId: selected.notebookId, hostDocId: selected.hostDocId, dbBlockId: selected.dbBlockId, avId: selected.avId };
            const settings = await facade.rebindSettings(patch, preview);
            onReady(settings);
        } catch (error) {
            message = error instanceof Error ? error.message : String(error);
        } finally {
            busy = false;
        }
    }
</script>

<section class="lvct-recovery" aria-live="polite">
    <div class="lvct-recovery__icon">!</div>
    <h1>{labels[workspace.kind]}</h1>
    <p class="lvct-recovery__message">{workspace.message ?? "插件已暂停读取联系人数据库，原有文档和插件数据不会被删除。"}</p>
    <p class="lvct-recovery__rule">请先重新核验或扫描原数据库。插件不会把读取失败当成空库，也不会自动创建第二套联系人数据库。</p>
    <div class="lvct-recovery__actions">
        <button class="b3-button" disabled={busy || scanning || retrying} onclick={() => void retryWorkspace()}>{retrying ? "核验中…" : "重新读取并核验"}</button>
        <button class="b3-button" disabled={busy || scanning || retrying} onclick={() => void scan(false)}>{scanning ? "扫描中…" : "扫描全库候选"}</button>
        {#if scanCursor}<button class="b3-button" disabled={busy || scanning || retrying} onclick={() => void scan(true)}>{scanning ? "扫描中…" : "继续扫描"}</button>{/if}
        <button class="b3-button" disabled={busy || scanning || retrying} onclick={onStartInit}>进入初始化向导（明确新建或复用）</button>
    </div>
    {#if message}<p class="lvct-recovery__message">{message}</p>{/if}
    {#if candidates.length}
        <div class="lvct-recovery__candidates">
            <h2>候选数据库</h2>
            {#each candidates as candidate (candidate.dbBlockId)}
                <article class:selected={selected?.dbBlockId === candidate.dbBlockId}>
                    <div><strong>{candidate.notebookName}</strong> · {candidate.hpath}</div>
                    <small>宿主 {candidate.hostDocId} · 数据库块 …{candidate.dbBlockId.slice(-7)} · 匹配字段 {candidate.matchedFields}</small>
                    <button class="b3-button" disabled={busy} onclick={() => previewCandidate(candidate)}>预览重绑</button>
                </article>
            {/each}
        </div>
    {/if}
    {#if preview && selected}
        <div class="lvct-recovery__confirm">
            <p>已核实「{preview.notebookName} / {preview.hostDocName}」及字段关系。将更新设置锚点，不会删除联系人文档。</p>
            <button class="b3-button b3-button--text" disabled={busy} onclick={confirmRebind}>确认重绑并恢复工作台</button>
        </div>
    {/if}
</section>
