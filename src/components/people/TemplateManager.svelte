<script lang="ts">
    /** 互动备注模板管理（F09）：本地草稿编辑，保存时全量落盘；失败保留输入可重试 */
    import { newTemplateId } from "../../domain/interaction-templates";
    import type { NoteTemplate } from "../../domain/interaction-templates";
    import StatusNotice from "../StatusNotice.svelte";
    import { useCloseGuard } from "../close-guard";
    import { translateText } from "../../domain/translation";

    let {
        templates,
        i18n,
        onSave,
        onClose,
    }: {
        templates: readonly NoteTemplate[];
        i18n?: Readonly<Record<string, string>>;
        onSave: (templates: NoteTemplate[]) => Promise<NoteTemplate[]>;
        onClose: () => void;
    } = $props();
    const text = $derived.by(() => (key: string, fallback: string, values?: Record<string, string | number>) =>
        translateText(i18n, key, fallback, values));

    // svelte-ignore state_referenced_locally
    let draft: NoteTemplate[] = $state(templates.map((item) => ({ ...item })));
    let busy = $state(false);
    let errorText = $state("");
    let savedMessage = $state("");
    // svelte-ignore state_referenced_locally
    let savedDraft: NoteTemplate[] = $state(templates.map((item) => ({ ...item })));

    function isDirty(): boolean {
        return JSON.stringify(draft) !== JSON.stringify(savedDraft);
    }

    const guardedClose = useCloseGuard({
        busy: () => busy,
        dirty: isDirty,
        changes: () => [text("tplManagerUnsaved", "互动备注模板修改尚未保存")],
        save,
    });

    function addTemplate() {
        draft = [...draft, { id: newTemplateId(), name: "", content: "" }];
    }

    function removeTemplate(id: string) {
        if (!window.confirm(text("tplManagerDeleteConfirm", "删除这个模板？已保存的互动不受影响。"))) return;
        draft = draft.filter((item) => item.id !== id);
        savedMessage = "";
    }

    async function save() {
        if (busy) return;
        const cleaned = draft
            .map((item) => ({ ...item, name: item.name.trim(), content: item.content.trim() }))
            .filter((item) => item.name.length > 0);
        if (cleaned.length !== draft.length && !window.confirm(text("tplManagerDropEmptyConfirm", "名称为空的模板会被丢弃，继续保存吗？"))) return;
        busy = true;
        errorText = "";
        try {
            draft = await onSave(cleaned);
            savedDraft = draft.map((item) => ({ ...item }));
            savedMessage = text("tplManagerSaved", "模板已保存");
        } catch (error) {
            errorText = error instanceof Error ? error.message : String(error);
        } finally {
            busy = false;
        }
    }
</script>

<div class="lvct-form">
    <p class="ft__smaller ft__on-surface">{text("tplManagerIntro", "模板支持占位符 {{姓名}}{{日期}}{{上次互动}}，应用时自动替换；日期与参与者在记录时仍需确认，模板不会自动提交。")}</p>
    {#if draft.length === 0}
        <p class="ft__smaller ft__on-surface">{text("tplManagerEmpty", "还没有模板，点下方「新增模板」创建一个。")}</p>
    {/if}
    {#each draft as item, index (item.id)}
        <div class="lvct-templates__item">
            <div class="lvct-templates__item-head">
                <input class="b3-text-field" type="text" aria-label={text("tplNameAria", "模板 {n} 名称", { n: index + 1 })} placeholder={text("tplNamePlaceholder", "模板名称（如：见面）")} bind:value={item.name} disabled={busy} />
                <button class="b3-button b3-button--cancel" title={text("tplDeleteTitle", "删除模板 {n}", { n: index + 1 })} disabled={busy} onclick={() => removeTemplate(item.id)}>{text("tplManagerDelete", "删除")}</button>
            </div>
            <textarea class="b3-text-field fn__block lvct-templates__content" rows="3" aria-label={text("tplContentAria", "模板 {n} 内容", { n: index + 1 })} placeholder={text("tplContentPlaceholder", "备注内容，可用 {{姓名}} {{日期}} {{上次互动}} 占位")} bind:value={item.content} disabled={busy}></textarea>
        </div>
    {/each}
    <div class="lvct-form__actions">
        <button class="b3-button b3-button--outline" onclick={addTemplate} disabled={busy}>{text("tplManagerAdd", "＋ 新增模板")}</button>
        <span style="flex:1"></span>
        <button class="b3-button b3-button--cancel" onclick={() => void guardedClose(onClose)} disabled={busy}>{text("tplManagerClose", "关闭")}</button>
        <button class="b3-button b3-button--text" onclick={save} disabled={busy}>{busy ? text("tplManagerSaving", "保存中…") : text("tplManagerSave", "保存模板")}</button>
    </div>
    <StatusNotice message={savedMessage} onDismiss={() => (savedMessage = "")} />
    {#if errorText}<div class="lvct-form__error" role="alert">{text("tplManagerSaveFail", "保存失败：{msg}", { msg: errorText })}</div>{/if}
</div>
