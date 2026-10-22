<script lang="ts">
    import { onDestroy, untrack, tick } from "svelte";
    import type { PersonRelationshipLabels } from "../../domain/person-relationship-labels";
    import type { RelationshipLabelEditorState } from "../../services/people-profiles";
    import { useCloseGuard } from "../close-guard";
    import { MigrationWriteUnknownError } from "../../domain/migration-records";
    import { requestErrorMessage } from "../../shared/error-presenter";

    let { personDocId, revision = 0, onLoad, onSave, onChanged }: {
        personDocId: string; revision?: number;
        onLoad: (personDocId: string) => Promise<RelationshipLabelEditorState>;
        onSave: (personDocId: string, selfDocId: string, labels: string[], expected: PersonRelationshipLabels | null) => Promise<PersonRelationshipLabels>;
        onChanged: () => void;
    } = $props();
    let snapshot: RelationshipLabelEditorState | null = $state(null);
    let draft = $state("");
    let loading = $state(true);
    let busy = $state(false);
    let unknown = $state(false);
    let message = $state("");
    let readError = $state("");
    let request = 0;
    let alive = true;
    let resultElement: HTMLElement | undefined = $state();
    const dirty = $derived.by(() => draft !== (snapshot?.record?.labels ?? []).join("、"));
    useCloseGuard({ busy: () => busy || loading, dirty: () => dirty || unknown, changes: () => ["与我的关系称谓有未保存或未核实的修改"] });
    onDestroy(() => { alive = false; request += 1; });

    async function load(preserve = unknown): Promise<void> {
        const generation = ++request;
        const docId = personDocId;
        loading = true;
        readError = "";
        try {
            const next = await onLoad(docId);
            if (!alive || generation !== request || docId !== personDocId) return;
            if (preserve) {
                const desired = draft.split(/[、,，\n]/).map((label) => label.trim()).filter(Boolean);
                if (next.selfDocId === snapshot?.selfDocId && JSON.stringify(next.record?.labels ?? []) === JSON.stringify(desired)) {
                    unknown = false;
                    snapshot = next;
                    draft = (next.record?.labels ?? []).join("、");
                    message = "称谓保存已通过重新读取核实";
                    onChanged();
                } else message = "当前值未匹配原请求，未自动重发；请核对本人参照和当前值，取消草稿后可重新编辑。";
            } else {
                snapshot = next;
                draft = (next.record?.labels ?? []).join("、");
                unknown = false;
            }
        } catch (error) {
            if (alive && generation === request) readError = requestErrorMessage(error);
        } finally { if (alive && generation === request) loading = false; }
    }

    $effect(() => {
        personDocId;
        untrack(() => { snapshot = null; draft = ""; unknown = false; message = ""; void load(false); });
    });
    let seenRevision = untrack(() => revision);
    $effect(() => {
        if (revision === seenRevision) return;
        seenRevision = revision;
        untrack(() => {
            if (busy || loading || dirty || unknown) message = "资料有新变化，当前称谓草稿保留；保存会核对原参照和原记录。";
            else void load(false);
        });
    });

    async function save(): Promise<void> {
        if (!snapshot?.selfDocId || busy || loading || unknown || readError) return;
        const docId = personDocId;
        const generation = request;
        busy = true;
        message = "";
        try {
            const record = await onSave(docId, snapshot.selfDocId, draft.split(/[、,，\n]/).map((label) => label.trim()).filter(Boolean), snapshot.record ? { ...snapshot.record, labels: [...snapshot.record.labels] } : null);
            if (!alive || generation !== request || docId !== personDocId) return;
            snapshot = { selfDocId: record.selfDocId, record };
            draft = record.labels.join("、");
            message = "称谓已保存并核实";
            onChanged();
        } catch (error) {
            if (!alive || generation !== request || docId !== personDocId) return;
            unknown = error instanceof MigrationWriteUnknownError;
            message = requestErrorMessage(error);
        } finally {
            if (alive && generation === request) {
                busy = false;
                await tick();
                if (alive) resultElement?.focus();
            }
        }
    }
</script>

<section class="lvct-detail__section lvct-relationship-labels">
    <div class="lvct-detail__section-head" style="margin-bottom: 8px;">
        <div>
            <h4 style="margin: 0;">与我的关系</h4>
            <p class="ft__smaller ft__on-surface" style="margin: 2px 0 0;">人工填写称谓（如：同事、朋友、表哥，多个用顿号分隔），仅对当前本人档案生效。</p>
        </div>
        <button class="b3-button b3-button--text" disabled={busy || loading || dirty && !unknown} onclick={() => void load()}>重新读取核实称谓</button>
    </div>
    {#if loading}<p role="status" class="ft__smaller">正在核实本人参照与称谓…</p>
    {:else if readError}<p role="alert" class="lvct-form__error">{readError}</p>
    {:else if !snapshot?.selfDocId}<p class="ft__smaller">请先在设置中设置本人档案。</p>
    {:else}
        <div class="fn__flex" style="gap: 8px; align-items: center; flex-wrap: wrap;">
            <input class="b3-text-field fn__flex-1" type="text" placeholder="填写与我的关系称谓，如：同事、朋友" bind:value={draft} disabled={busy || unknown} maxlength="1600" />
            <button class="b3-button b3-button--outline" onclick={() => void save()} disabled={busy || unknown || !dirty}>{busy ? "保存中…" : "保存称谓"}</button>
            <button class="b3-button b3-button--cancel" disabled={busy} onclick={() => { message = ""; void load(false); }}>取消称谓草稿</button>
        </div>
    {/if}
    {#if message}<p role="status" tabindex="-1" class="ft__smaller" style="margin-top: 4px;" bind:this={resultElement}>{message}</p>{/if}
</section>
