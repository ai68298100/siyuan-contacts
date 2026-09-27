<script lang="ts">
    /** 互动备注模板管理（F09）：本地草稿编辑，保存时全量落盘；失败保留输入可重试 */
    import { newTemplateId } from "../../domain/interaction-templates";
    import type { NoteTemplate } from "../../domain/interaction-templates";
    import StatusNotice from "../StatusNotice.svelte";

    let {
        templates,
        onSave,
        onClose,
    }: {
        templates: readonly NoteTemplate[];
        onSave: (templates: NoteTemplate[]) => Promise<NoteTemplate[]>;
        onClose: () => void;
    } = $props();

    // svelte-ignore state_referenced_locally
    let draft: NoteTemplate[] = $state(templates.map((item) => ({ ...item })));
    let busy = $state(false);
    let errorText = $state("");
    let savedMessage = $state("");

    function addTemplate() {
        draft = [...draft, { id: newTemplateId(), name: "", content: "" }];
    }

    function removeTemplate(id: string) {
        if (!window.confirm("删除这个模板？已保存的互动不受影响。")) return;
        draft = draft.filter((item) => item.id !== id);
        savedMessage = "";
    }

    async function save() {
        if (busy) return;
        const cleaned = draft
            .map((item) => ({ ...item, name: item.name.trim(), content: item.content.trim() }))
            .filter((item) => item.name.length > 0);
        if (cleaned.length !== draft.length && !window.confirm("名称为空的模板会被丢弃，继续保存吗？")) return;
        busy = true;
        errorText = "";
        try {
            draft = await onSave(cleaned);
            savedMessage = "模板已保存";
        } catch (error) {
            errorText = error instanceof Error ? error.message : String(error);
        } finally {
            busy = false;
        }
    }
</script>

<div class="lvct-form">
    <p class="ft__smaller ft__on-surface">模板支持占位符 {`{{姓名}}`}{`{{日期}}`}{`{{上次互动}}`}，应用时自动替换；日期与参与者在记录时仍需确认，模板不会自动提交。</p>
    {#if draft.length === 0}
        <p class="ft__smaller ft__on-surface">还没有模板，点下方「新增模板」创建一个。</p>
    {/if}
    {#each draft as item, index (item.id)}
        <div class="lvct-templates__item">
            <div class="lvct-templates__item-head">
                <input class="b3-text-field" type="text" aria-label={`模板 ${index + 1} 名称`} placeholder="模板名称（如：见面）" bind:value={item.name} disabled={busy} />
                <button class="b3-button b3-button--cancel" title={`删除模板 ${item.name || index + 1}`} disabled={busy} onclick={() => removeTemplate(item.id)}>删除</button>
            </div>
            <textarea class="b3-text-field fn__block lvct-templates__content" rows="3" aria-label={`模板 ${index + 1} 内容`} placeholder="备注内容，可用 {`{{姓名}}`} {`{{日期}}`} {`{{上次互动}}`} 占位" bind:value={item.content} disabled={busy}></textarea>
        </div>
    {/each}
    <div class="lvct-form__actions">
        <button class="b3-button b3-button--outline" onclick={addTemplate} disabled={busy}>＋ 新增模板</button>
        <span style="flex:1"></span>
        <button class="b3-button b3-button--cancel" onclick={onClose} disabled={busy}>关闭</button>
        <button class="b3-button b3-button--text" onclick={save} disabled={busy}>{busy ? "保存中…" : "保存模板"}</button>
    </div>
    <StatusNotice message={savedMessage} onDismiss={() => (savedMessage = "")} />
    {#if errorText}<div class="lvct-form__error" role="alert">保存失败：{errorText}</div>{/if}
</div>
