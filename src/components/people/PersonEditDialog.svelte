<script lang="ts">
    /** 编辑资料：全字段更新（空值清空对应单元格） */
    import { updateContactFields, PRESET_GROUPS } from "../../services/contacts";
    import type { ContactDraft } from "../../domain/person";
    import type { ContactSummary } from "../../domain/person";
    import type { ContactsSettings } from "../../domain/model";
    import { useCloseGuard } from "../close-guard";
    import { translateText } from "../../domain/translation";
    import QuickFillDialog from "./QuickFillDialog.svelte";
    import { ClipboardPaste } from "@lucide/svelte";

    let {
        settings,
        i18n,
        person,
        hostCloseChannel,
        onSaved,
        onClose,
    }: {
        settings: ContactsSettings;
        i18n?: Readonly<Record<string, string>>;
        person: ContactSummary;
        /** D-40：libs/dialog 注入的宿主关闭通道（X/Esc/遮罩经守卫路由）；缺省保持宿主原行为 */
        hostCloseChannel?: { request?: (close: () => void) => void };
        onSaved: () => void;
        onClose: () => void;
    } = $props();
    const text = $derived.by(() => (key: string, fallback: string, values?: Record<string, string | number>) => translateText(i18n, key, fallback, values));

    // 有意取打开弹窗时的快照（编辑表单不随外部变化）
    // svelte-ignore state_referenced_locally
    let draft: ContactDraft = $state({
        name: person.name,
        phone: person.phone,
        email: person.email,
        wechat: person.wechat,
        website: person.website,
        birthday: person.birthday,
        isLunar: person.isLunar,
        group: person.group,
        tags: [...person.tags],
    });
    // svelte-ignore state_referenced_locally
    let tagsText: string = $state(person.tags.join(" "));
    let running: boolean = $state(false);
    let errorText: string = $state("");
    const original = JSON.stringify(draft);
    // svelte-ignore state_referenced_locally
    const originalTags = tagsText;
    let saved = $state(false);
    // FAST-01.1：粘贴并识别（识别结果经勾选后回填草稿，不直接写库）
    let quickFillOpen = $state(false);
    function applyQuickFill(patch: {
        name?: string; phone?: string; email?: string; wechat?: string;
        website?: string; birthday?: string; isLunar?: boolean; group?: string;
        tagsAppend: string[];
    }) {
        if (patch.name !== undefined) draft.name = patch.name;
        if (patch.phone !== undefined) draft.phone = patch.phone;
        if (patch.email !== undefined) draft.email = patch.email;
        if (patch.wechat !== undefined) draft.wechat = patch.wechat;
        if (patch.website !== undefined) draft.website = patch.website;
        if (patch.birthday !== undefined) draft.birthday = patch.birthday;
        if (patch.isLunar) draft.isLunar = true;
        if (patch.group !== undefined) draft.group = patch.group;
        if (patch.tagsAppend.length) {
            const tags = tagsText.split(/[，,、\s]+/).map((tag) => tag.trim()).filter(Boolean);
            for (const tag of patch.tagsAppend) if (!tags.includes(tag)) tags.push(tag);
            tagsText = tags.join(" ");
        }
    }
    // B06：字段级改动明细 + 「保存并离开」（persist 抛错则留在原地）
    async function persist(): Promise<void> {
        const tags = tagsText.split(/[，,、\s]+/).map((tag) => tag.trim()).filter((tag) => tag.length > 0);
        await updateContactFields(settings, person.itemId, { ...draft, tags });
        saved = true;
        onSaved();
    }
    function draftChanges(): string[] {
        if (saved) return [];
        const changes: string[] = [];
        const empty = text("guardEmpty", "（空）");
        const fields = [
            [text("formName", "姓名"), "name"], [text("formPhone", "电话"), "phone"],
            [text("formEmail", "邮箱"), "email"], [text("formWechat", "微信"), "wechat"],
            [text("formWebsite", "网站"), "website"], [text("formBirthday", "生日"), "birthday"],
        ] as const;
        for (const [label, key] of fields) {
            if (draft[key] !== person[key]) {
                changes.push(text("guardFieldChange", "{field}：{from} → {to}", { field: label, from: String(person[key]) || empty, to: String(draft[key]) || empty }));
            }
        }
        if (draft.isLunar !== person.isLunar) {
            changes.push(text("guardFieldChange", "{field}：{from} → {to}", { field: text("formLunar", "农历生日"), from: person.isLunar ? "✓" : empty, to: draft.isLunar ? "✓" : empty }));
        }
        if (draft.group !== person.group) {
            changes.push(text("guardFieldChange", "{field}：{from} → {to}", { field: text("formGroup", "分组"), from: person.group || empty, to: draft.group || empty }));
        }
        if (tagsText !== originalTags) {
            changes.push(text("guardTagsChange", "标签：{from} → {to}", { from: originalTags || empty, to: tagsText || empty }));
        }
        return changes;
    }
    const guardedClose = useCloseGuard({
        busy: () => running,
        dirty: () => !saved && (JSON.stringify(draft) !== original || tagsText !== originalTags),
        changes: draftChanges,
        save: persist,
    });
    /* D-40：宿主 X/Esc/遮罩经同一守卫路由（返回 Promise 供拦截层重入门） */
    $effect(() => {
        if (hostCloseChannel) hostCloseChannel.request = (close) => guardedClose(close);
    });

    async function submit() {
        if (running) return;
        running = true;
        errorText = "";
        try {
            await persist();
            onClose();
        } catch (error) {
            errorText = error instanceof Error ? error.message : String(error);
        } finally {
            running = false;
        }
    }
</script>

<div class="lvct-form">
    <div class="lvct-form__toolbar">
        <button type="button" class="b3-button b3-button--text lvct-form__toolbar-btn" onclick={() => (quickFillOpen = true)}>
            <ClipboardPaste size={14}/>{text("qfOpen", "粘贴并识别")}
        </button>
    </div>
    <div class="lvct-form__grid">
        <label class="lvct-form__item">
            <span>{text("formPhone", "电话")}</span>
            <input class="b3-text-field fn__block" type="tel" bind:value={draft.phone} />
        </label>
        <label class="lvct-form__item">
            <span>{text("formWechat", "微信")}</span>
            <input class="b3-text-field fn__block" type="text" bind:value={draft.wechat} />
        </label>
        <label class="lvct-form__item">
            <span>{text("formEmail", "邮箱")}</span>
            <input class="b3-text-field fn__block" type="email" bind:value={draft.email} />
        </label>
        <label class="lvct-form__item">
            <span>{text("formWebsite", "网站")}</span>
            <input class="b3-text-field fn__block" type="url" bind:value={draft.website} />
        </label>
        <label class="lvct-form__item">
            <span>{text("formBirthday", "生日")}</span>
            <input class="b3-text-field fn__block" type="date" bind:value={draft.birthday} />
        </label>
        <label class="lvct-form__item lvct-form__item--inline">
            <span>{text("formLunar", "农历")}</span>
            <input class="b3-switch" type="checkbox" bind:checked={draft.isLunar} />
        </label>
        <label class="lvct-form__item">
            <span>{text("formGroup", "分组")}</span>
            <select class="b3-select fn__block" bind:value={draft.group}>
                <option value="">{text("formUngrouped", "未分组")}</option>
                {#each PRESET_GROUPS as group (group)}
                    <option value={group}>{group}</option>
                {/each}
            </select>
        </label>
        <label class="lvct-form__item">
            <span>{text("formTagsLabel", "标签（空格/逗号分隔）")}</span>
            <input class="b3-text-field fn__block" type="text" bind:value={tagsText} />
        </label>
    </div>

    {#if errorText}
        <div class="lvct-form__error">{errorText}</div>
    {/if}

    <div class="lvct-form__actions">
        <button class="b3-button b3-button--cancel" onclick={() => guardedClose(onClose)} disabled={running}>{text("formCancel", "取消")}</button>
        <button class="b3-button b3-button--text" onclick={submit} disabled={running}>
            {running ? text("formSaving", "保存中…") : text("formSave", "保存")}
        </button>
    </div>
    <p class="ft__smaller ft__on-surface lvct-form__hint">{text("formEditHint", "留空即清空对应字段；姓名在思源里改文档名即可。")}</p>
</div>

{#if quickFillOpen}
    <QuickFillDialog
        {i18n}
        existing={{ name: draft.name, phone: draft.phone, email: draft.email, wechat: draft.wechat, website: draft.website, birthday: draft.birthday, group: draft.group, tags: tagsText.split(/[，,、\s]+/).filter(Boolean) }}
        onApply={applyQuickFill}
        onClose={() => (quickFillOpen = false)}
    />
{/if}
