<script lang="ts">
    /** C03 串行补录：一人一屏，只显示该人缺失的字段（按现有九字段契约）；
     *  保存走既有 updateContactFields（逐字段 setCell + 写后回读），保存即进下一位。
     *  跳过不写入；中途关闭经 B06 守卫确认。 */
    import { updateContactFields, PRESET_GROUPS } from "../../services/contacts";
    import { emptyDraft } from "../../domain/person";
    import type { ContactDraft, ContactSummary } from "../../domain/person";
    import type { ContactsSettings } from "../../domain/model";
    import { useCloseGuard } from "../close-guard";
    import { translateText } from "../../domain/translation";

    let {
        settings,
        i18n,
        people,
        onSaved,
        onClose,
    }: {
        settings: ContactsSettings;
        i18n?: Readonly<Record<string, string>>;
        /** 待补录名单（调用方按筛选结果传入；组件不重复筛） */
        people: readonly ContactSummary[];
        /** 每次保存后回调（父层刷新名册/首页提醒） */
        onSaved?: () => void;
        onClose: () => void;
    } = $props();
    const text = $derived.by(() => (key: string, fallback: string, values?: Record<string, string | number>) =>
        translateText(i18n, key, fallback, values));

    let index = $state(0);
    let draft: ContactDraft = $state(emptyDraft());
    let tagsText = $state("");
    let running = $state(false);
    let errorText = $state("");
    let savedCount = $state(0);
    let skippedCount = $state(0);
    let done = $state(false);

    const currentPerson = $derived(people[index] ?? null);
    /** 该人缺失的字段（字符串字段），按 Tab 顺序排布 */
    const missingText = $derived.by(() => {
        if (!currentPerson) return [] as { key: "phone" | "wechat" | "email" | "website"; label: string; inputType: string; placeholder?: string }[];
        const gaps: { key: "phone" | "wechat" | "email" | "website"; label: string; inputType: string; placeholder?: string }[] = [];
        if (!currentPerson.phone.trim()) gaps.push({ key: "phone", label: text("formPhone", "电话"), inputType: "tel" });
        if (!currentPerson.wechat.trim()) gaps.push({ key: "wechat", label: text("formWechat", "微信"), inputType: "text" });
        if (!currentPerson.email.trim()) gaps.push({ key: "email", label: text("formEmail", "邮箱"), inputType: "email" });
        if (!currentPerson.website.trim()) gaps.push({ key: "website", label: text("formWebsite", "网站"), inputType: "url", placeholder: "https://" });
        return gaps;
    });
    const missingBirthday = $derived(!currentPerson?.birthday.trim());
    const missingGroup = $derived(!currentPerson?.group.trim());
    const missingTags = $derived((currentPerson?.tags.length ?? 0) === 0);

    function loadCurrent(): void {
        draft = emptyDraft();
        tagsText = "";
        errorText = "";
    }
    $effect(() => {
        index;
        loadCurrent();
    });

    function draftIsDirty(): boolean {
        return draft.phone.trim() !== "" || draft.wechat.trim() !== "" || draft.email.trim() !== ""
            || draft.website.trim() !== "" || draft.birthday.trim() !== "" || draft.isLunar
            || draft.group.trim() !== "" || tagsText.trim() !== "";
    }
    async function persistCurrent(): Promise<void> {
        if (!currentPerson) return;
        const tags = tagsText.split(/[，,、\s]+/).map((tag) => tag.trim()).filter(Boolean);
        /* updateContactFields 是全字段写入：以现有值打底，只覆盖本页填写的缺失项，不清空已有资料 */
        await updateContactFields(settings, currentPerson.itemId, {
            name: currentPerson.name,
            phone: draft.phone.trim() || currentPerson.phone,
            email: draft.email.trim() || currentPerson.email,
            wechat: draft.wechat.trim() || currentPerson.wechat,
            website: draft.website.trim() || currentPerson.website,
            birthday: draft.birthday || currentPerson.birthday,
            isLunar: currentPerson.isLunar || draft.isLunar,
            group: draft.group || currentPerson.group,
            tags: tags.length > 0 ? tags : currentPerson.tags,
        });
        savedCount += 1;
        onSaved?.();
    }
    useCloseGuard({
        busy: () => running,
        dirty: () => !done && draftIsDirty(),
        changes: () => [text("qfCompletionUnsaved", "本页补录内容尚未保存")],
    });

    async function saveAndNext(): Promise<void> {
        if (running) return;
        running = true;
        errorText = "";
        try {
            await persistCurrent();
            advance();
        } catch (error) {
            errorText = error instanceof Error ? error.message : String(error);
        } finally {
            running = false;
        }
    }
    function skip(): void {
        skippedCount += 1;
        advance();
    }
    function advance(): void {
        if (index + 1 >= people.length) {
            done = true;
        } else {
            index += 1;
        }
    }
</script>

{#if done}
    <div class="lvct-qf">
        <p role="status">✅ {text("qfCompletionDone", "补录结束：保存 {saved} 人，跳过 {skipped} 人。", { saved: savedCount, skipped: skippedCount })}</p>
        <p class="ft__smaller ft__on-surface">{text("qfCompletionDoneHint", "首页生日提醒与久未联系统计会在下次加载时反映补录结果。")}</p>
        <div class="lvct-form__actions">
            <button class="b3-button" onclick={onClose}>{text("formDone", "完成")}</button>
        </div>
    </div>
{:else if currentPerson}
    <div class="lvct-qf">
        <p class="ft__smaller ft__on-surface">
            {index + 1} / {people.length} · {text("qfCompletionHint", "只列出缺失字段；Tab 依次填写，回车保存并进下一位。")}
        </p>
        <h3 style="margin:0">{currentPerson.name}</h3>
        <div class="lvct-form__grid">
            {#each missingText as field (field.key)}
                <label class="lvct-form__item">
                    <span>{field.label}</span>
                    <input class="b3-text-field fn__block" type={field.inputType} placeholder={field.placeholder} bind:value={draft[field.key]} disabled={running} />
                </label>
            {/each}
            {#if missingBirthday}
                <label class="lvct-form__item">
                    <span>{text("formBirthday", "生日")}</span>
                    <input class="b3-text-field fn__block" type="date" bind:value={draft.birthday} disabled={running} />
                </label>
                <label class="lvct-form__item lvct-form__item--inline">
                    <span>{text("formLunar", "农历")}</span>
                    <input class="b3-switch" type="checkbox" bind:checked={draft.isLunar} disabled={running} />
                </label>
            {/if}
            {#if missingGroup}
                <label class="lvct-form__item">
                    <span>{text("formGroup", "分组")}</span>
                    <select class="b3-select fn__block" bind:value={draft.group} disabled={running}>
                        <option value="">{text("formUngrouped", "未分组")}</option>
                        {#each PRESET_GROUPS as group (group)}
                            <option value={group}>{group}</option>
                        {/each}
                    </select>
                </label>
            {/if}
            {#if missingTags}
                <label class="lvct-form__item">
                    <span>{text("formTagsLabel", "标签（空格/逗号分隔）")}</span>
                    <input class="b3-text-field fn__block" type="text" bind:value={tagsText} placeholder={text("formTagsPlaceholder", "球友 重点")} disabled={running} />
                </label>
            {/if}
        </div>
        {#if missingText.length === 0 && !missingBirthday && !missingGroup && !missingTags}
            <p class="ft__smaller ft__on-surface">{text("qfCompletionComplete", "此人资料已齐全，直接跳过。")}</p>
        {/if}
        {#if errorText}
            <div class="lvct-form__error">{errorText}</div>
        {/if}
        <div class="lvct-form__actions">
            <button class="b3-button b3-button--cancel" onclick={skip} disabled={running}>
                {text("qfCompletionSkip", "跳过此人")}
            </button>
            <button class="b3-button b3-button--text" onclick={saveAndNext} disabled={running || !draftIsDirty()}>
                {running ? text("formSaving", "保存中…") : text("qfCompletionSaveNext", "保存并下一位")}
            </button>
        </div>
    </div>
{/if}
