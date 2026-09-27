<script lang="ts">
    /** 编辑资料：全字段更新（空值清空对应单元格） */
    import { updateContactFields, PRESET_GROUPS } from "../../services/contacts";
    import type { ContactDraft } from "../../domain/person";
    import type { ContactSummary } from "../../domain/person";
    import type { ContactsSettings } from "../../domain/model";
    import { useCloseGuard } from "../close-guard";

    let {
        settings,
        person,
        onSaved,
        onClose,
    }: {
        settings: ContactsSettings;
        person: ContactSummary;
        onSaved: () => void;
        onClose: () => void;
    } = $props();

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
    const guardedClose = useCloseGuard(() => running, () => !saved && (JSON.stringify(draft) !== original || tagsText !== originalTags));

    async function submit() {
        if (running) return;
        running = true;
        errorText = "";
        try {
            const tags = tagsText.split(/[，,、\s]+/).map((tag) => tag.trim()).filter((tag) => tag.length > 0);
            await updateContactFields(settings, person.itemId, { ...draft, tags });
            saved = true;
            onSaved();
            onClose();
        } catch (error) {
            errorText = error instanceof Error ? error.message : String(error);
        } finally {
            running = false;
        }
    }
</script>

<div class="lvct-form">
    <div class="lvct-form__grid">
        <label class="lvct-form__item">
            <span>电话</span>
            <input class="b3-text-field fn__block" type="tel" bind:value={draft.phone} />
        </label>
        <label class="lvct-form__item">
            <span>微信</span>
            <input class="b3-text-field fn__block" type="text" bind:value={draft.wechat} />
        </label>
        <label class="lvct-form__item">
            <span>邮箱</span>
            <input class="b3-text-field fn__block" type="email" bind:value={draft.email} />
        </label>
        <label class="lvct-form__item">
            <span>网站</span>
            <input class="b3-text-field fn__block" type="url" bind:value={draft.website} />
        </label>
        <label class="lvct-form__item">
            <span>生日</span>
            <input class="b3-text-field fn__block" type="date" bind:value={draft.birthday} />
        </label>
        <label class="lvct-form__item lvct-form__item--inline">
            <span>农历</span>
            <input class="b3-switch" type="checkbox" bind:checked={draft.isLunar} />
        </label>
        <label class="lvct-form__item">
            <span>分组</span>
            <select class="b3-select fn__block" bind:value={draft.group}>
                <option value="">未分组</option>
                {#each PRESET_GROUPS as group (group)}
                    <option value={group}>{group}</option>
                {/each}
            </select>
        </label>
        <label class="lvct-form__item">
            <span>标签（空格/逗号分隔）</span>
            <input class="b3-text-field fn__block" type="text" bind:value={tagsText} />
        </label>
    </div>

    {#if errorText}
        <div class="lvct-form__error">{errorText}</div>
    {/if}

    <div class="lvct-form__actions">
        <button class="b3-button b3-button--cancel" onclick={() => guardedClose(onClose)} disabled={running}>取消</button>
        <button class="b3-button b3-button--text" onclick={submit} disabled={running}>
            {running ? "保存中…" : "保存"}
        </button>
    </div>
    <p class="ft__smaller ft__on-surface lvct-form__hint">留空即清空对应字段；姓名在思源里改文档名即可。</p>
</div>
