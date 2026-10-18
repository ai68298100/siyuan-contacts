<script lang="ts">
    /** 本地草稿带编辑基线保存；冲突/未知保留输入，重读仅作核对，不自动换基线。 */
    import { newTemplateId, TEMPLATES_LIMIT } from "../../domain/interaction-templates";
    import type { NoteTemplate } from "../../domain/interaction-templates";
    import StatusNotice from "../StatusNotice.svelte";
    import { useCloseGuard } from "../close-guard";
    import { translateText } from "../../domain/translation";
    import { requestErrorMessage } from "../../shared/error-presenter";
    import { confirmDialog } from "../../libs/confirm-dialog";

    let {
        templates,
        i18n,
        onSave,
        onReload,
        onClose,
    }: {
        templates: readonly NoteTemplate[];
        i18n?: Readonly<Record<string, string>>;
        onSave: (templates: NoteTemplate[], expected: readonly NoteTemplate[]) => Promise<NoteTemplate[]>;
        onReload?: () => Promise<NoteTemplate[]>;
        onClose: () => void;
    } = $props();
    const text = $derived.by(() => (key: string, fallback: string, values?: Record<string, string | number>) =>
        translateText(i18n, key, fallback, values));

    // svelte-ignore state_referenced_locally
    let draft: NoteTemplate[] = $state(templates.map((item) => ({ ...item })));
    let busy = $state(false);
    let errorText = $state("");
    let savedMessage = $state("");
    let latestTemplates: NoteTemplate[] | null = $state(null);
    // svelte-ignore state_referenced_locally
    let savedDraft: NoteTemplate[] = $state(templates.map((item) => ({ ...item })));

    function isDirty(): boolean {
        return JSON.stringify(draft) !== JSON.stringify(savedDraft);
    }

    const guardedClose = useCloseGuard({
        busy: () => busy,
        dirty: isDirty,
        changes: () => [text("tplManagerUnsaved", "互动备注模板修改尚未保存")],
        save: () => save(true),
    });

    function addTemplate() {
        if (busy || draft.length >= TEMPLATES_LIMIT) return;
        draft = [...draft, { id: newTemplateId(), name: "", content: "" }];
    }

    async function removeTemplate(id: string) {
        const confirmed = await confirmDialog({
            title: "删除模板",
            message: text("tplManagerDeleteConfirm", "删除这个模板？已保存的互动不受影响。"),
            confirmLabel: "删除",
            cancelLabel: "取消",
            danger: true,
        });
        if (!confirmed) return;
        draft = draft.filter((item) => item.id !== id);
        savedMessage = "";
    }

    async function reload() {
        if (busy || !onReload) return;
        busy = true;
        savedMessage = "";
        try {
            const latest = (await onReload()).map((item) => ({ ...item }));
            const cleaned = draft.map((item) => ({ ...item, name: item.name.trim(), content: item.content.trim() }));
            if (cleaned.every((item) => item.name.length > 0) && JSON.stringify(latest) === JSON.stringify(cleaned)) {
                // 核实未知保存：当前库已是原目标，不需要重复写入。
                draft = latest.map((item) => ({ ...item }));
                savedDraft = latest.map((item) => ({ ...item }));
                latestTemplates = null;
                errorText = "";
                savedMessage = text("tplManagerVerified", "已重新读取并核实：当前草稿已保存");
            } else {
                latestTemplates = latest;
                savedMessage = text("tplManagerCompared", "已读取当前版本供核对；编辑草稿与原基线保持保留");
            }
        } catch (error) {
            latestTemplates = null;
            errorText = requestErrorMessage(error);
        } finally {
            busy = false;
        }
    }

    async function useLatest() {
        if (busy || latestTemplates === null) return;
        if (isDirty()) {
            const confirmed = await confirmDialog({
                title: "载入最新版本",
                message: text("tplManagerReloadConfirm", "放弃当前未保存的模板草稿，载入刚读取的版本吗？此操作不会写入存储。"),
                confirmLabel: "放弃并载入",
                cancelLabel: "保留草稿",
            });
            if (!confirmed) return;
        }
        draft = latestTemplates.map((item) => ({ ...item }));
        savedDraft = latestTemplates.map((item) => ({ ...item }));
        latestTemplates = null;
        errorText = "";
        savedMessage = text("tplManagerReloaded", "已载入当前版本；可重新编辑后保存");
    }

    async function save(rethrowOnFailure = false) {
        if (busy) return;
        const cleaned = draft
            .map((item) => ({ ...item, name: item.name.trim(), content: item.content.trim() }))
            .filter((item) => item.name.length > 0);
        if (cleaned.length !== draft.length) {
            const confirmed = await confirmDialog({
                title: "丢弃空名称模板",
                message: text("tplManagerDropEmptyConfirm", "名称为空的模板会被丢弃，继续保存吗？"),
                confirmLabel: "继续保存",
                cancelLabel: "返回编辑",
            });
            if (!confirmed) {
                if (rethrowOnFailure) throw new Error("模板保存已取消");
                return;
            }
        }
        busy = true;
        errorText = "";
        savedMessage = "";
        try {
            draft = await onSave(cleaned, savedDraft.map((item) => ({ ...item })));
            savedDraft = draft.map((item) => ({ ...item }));
            latestTemplates = null;
            savedMessage = text("tplManagerSaved", "模板已保存");
        } catch (error) {
            errorText = requestErrorMessage(error);
            if (rethrowOnFailure) throw error;
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
        <button class="b3-button b3-button--outline" onclick={addTemplate} disabled={busy || draft.length >= TEMPLATES_LIMIT}>{text("tplManagerAdd", "＋ 新增模板")}</button>
        {#if onReload}<button class="b3-button b3-button--outline" onclick={() => void reload()} disabled={busy}>{text("tplManagerReload", "重新读取当前版本")}</button>{/if}
        <span style="flex:1"></span>
        <button class="b3-button b3-button--cancel" onclick={() => void guardedClose(onClose)} disabled={busy}>{text("tplManagerClose", "关闭")}</button>
        <button class="b3-button b3-button--text" onclick={() => void save()} disabled={busy}>{busy ? text("tplManagerSaving", "保存中…") : text("tplManagerSave", "保存模板")}</button>
    </div>
    {#if draft.length >= TEMPLATES_LIMIT}<p class="ft__smaller ft__on-surface" role="status">{text("tplManagerLimit", "最多保存 {limit} 条模板；删除一条后可继续新增。", { limit: TEMPLATES_LIMIT })}</p>{/if}
    <StatusNotice message={savedMessage} onDismiss={() => (savedMessage = "")} />
    {#if errorText}<div class="lvct-form__error" role="alert">{text("tplManagerSaveFail", "保存失败：{msg}", { msg: errorText })}</div>{/if}
    {#if latestTemplates !== null}
        <details open class="lvct-templates__latest">
            <summary>{text("tplManagerLatest", "当前已保存版本（只读核对）")}</summary>
            <p class="ft__smaller ft__on-surface">{text("tplManagerKeepDraft", "上方草稿尚未替换。可先复制需要保留的修改；载入下方版本会放弃当前草稿，再按新版本重新编辑。")}</p>
            {#each latestTemplates as item, index (item.id)}
                <div class="lvct-templates__item">
                    <strong>{item.name}</strong>
                    <textarea class="b3-text-field fn__block lvct-templates__content" rows="3" aria-label={text("tplLatestContentAria", "当前版本模板 {n} 内容", { n: index + 1 })} value={item.content} readonly></textarea>
                </div>
            {:else}
                <p>{text("tplManagerLatestEmpty", "当前已保存版本没有模板。")}</p>
            {/each}
            <button class="b3-button b3-button--outline" onclick={useLatest} disabled={busy}>{text("tplManagerUseLatest", "放弃草稿并载入当前版本")}</button>
        </details>
    {/if}
</div>
