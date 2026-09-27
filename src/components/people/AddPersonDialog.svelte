<script lang="ts">
    /** 新建联系人弹窗 */
    import { createContact, PRESET_GROUPS } from "../../services/contacts";
    import { emptyDraft } from "../../domain/person";
    import type { ContactDraft, ContactSummary } from "../../domain/person";
    import type { ContactsSettings } from "../../domain/model";
    import { useCloseGuard } from "../close-guard";

    let {
        settings,
        onCreated,
        onClose,
    }: {
        settings: ContactsSettings;
        onCreated: (person: ContactSummary) => void;
        onClose: () => void;
    } = $props();

    let draft: ContactDraft = $state(emptyDraft());
    let tagsText: string = $state("");
    let running: boolean = $state(false);
    let errorText: string = $state("");
    let saved = $state(false);
    const guardedClose = useCloseGuard(() => running, () => !saved && (JSON.stringify(draft) !== JSON.stringify(emptyDraft()) || tagsText.trim().length > 0));

    async function submit() {
        if (running) return;
        running = true;
        errorText = "";
        try {
            const tags = tagsText.split(/[，,、\s]+/).map((tag) => tag.trim()).filter((tag) => tag.length > 0);
            const person = await createContact(settings, { ...draft, tags });
            saved = true;
            onCreated(person);
            onClose();
        } catch (error) {
            errorText = error instanceof Error ? error.message : String(error);
        } finally {
            running = false;
        }
    }
</script>

<div class="lvct-form">
    <label class="lvct-form__item">
        <span>姓名 <b class="ft__error">*</b></span>
        <input class="b3-text-field fn__block" type="text" bind:value={draft.name} placeholder="联系人文档名将以此为题" />
    </label>
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
            <input class="b3-text-field fn__block" type="url" bind:value={draft.website} placeholder="https://" />
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
            <input class="b3-text-field fn__block" type="text" bind:value={tagsText} placeholder="球友 重点" />
        </label>
    </div>

    {#if errorText}
        <div class="lvct-form__error">{errorText}</div>
    {/if}

    <div class="lvct-form__actions">
        <button class="b3-button b3-button--cancel" onclick={() => guardedClose(onClose)} disabled={running}>取消</button>
        <button class="b3-button b3-button--text" onclick={submit} disabled={running || draft.name.trim().length === 0}>
            {running ? "创建中…" : "创建联系人"}
        </button>
    </div>
    <p class="ft__smaller ft__on-surface lvct-form__hint">
        将创建文档「{draft.name || "…"}」并绑定为数据库一行；同名未绑定文档会被收编为联系人。
    </p>
</div>
