<script lang="ts">
    /** C03 串行补录：一人一屏，只显示该人缺失的字段（按现有九字段契约）；
     *  保存先核实原人物与最新字段，再逐字段 setCell + 写后回读，保存即进下一位。
     *  跳过不写入；中途关闭经 B06 守卫确认。 */
    import { PRESET_GROUPS } from "../../services/contacts";
    import { writeImportFields } from "../../services/import";
    import type { WritableContactField } from "../../domain/contact-write.ts";
    import { emptyDraft } from "../../domain/person";
    import { importAnchor, snapshotCompletionPeople } from "../../domain/import.ts";
    import { untrack } from "svelte";
    import type { ContactDraft, ContactSummary } from "../../domain/person";
    import type { ContactsSettings } from "../../domain/model";
    import { useCloseGuard } from "../close-guard";
    import { CheckCircle2 } from "@lucide/svelte";
    import { translateText } from "../../domain/translation";

    let {
        settings,
        i18n,
        people,
        scopeLabel = "调用方确认名单",
        onSaved,
        onClose,
    }: {
        settings: ContactsSettings;
        i18n?: Readonly<Record<string, string>>;
        /** 待补录名单（调用方按筛选结果传入；组件不重复筛） */
        people: readonly ContactSummary[];
        scopeLabel?: string;
        /** 每次保存后回调（父层刷新名册/首页提醒） */
        onSaved?: () => void;
        onClose: () => void;
    } = $props();
    const text = $derived.by(() => (key: string, fallback: string, values?: Record<string, string | number>) =>
        translateText(i18n, key, fallback, values));

    let index = $state(0);
    const queue = untrack(() => snapshotCompletionPeople(people));
    const queuedScopeLabel = untrack(() => scopeLabel);
    const queueAnchor = untrack(() => importAnchor(settings));
    let draft: ContactDraft = $state(emptyDraft());
    let tagsText = $state("");
    let running = $state(false);
    let errorText = $state("");
    let failedFields: WritableContactField[] = $state([]);
    let submittedRequest = $state.raw<{ draft: ContactDraft; fields: WritableContactField[] } | null>(null);
    let paused = $state(false);
    let results = $state<Record<string, string>>({});
    let savedCount = $state(0);
    let skippedCount = $state(0);
    let done = $state(queue.length === 0);

    const currentPerson = $derived(queue[index] ?? null);
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
        failedFields = [];
        submittedRequest = null;
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
        if (queueAnchor !== importAnchor(settings)) throw new Error("补录锚点已变化，原人物队列未执行，请关闭后重新核对");
        if (!submittedRequest) {
            const fields: WritableContactField[] = [];
            for (const field of ["phone", "email", "wechat", "website", "group"] as const) {
                if (!currentPerson[field].trim() && draft[field].trim()) fields.push(field);
            }
            if (!currentPerson.birthday && draft.birthday) fields.push("birthday", "lunarBirthday");
            const tags = tagsText.split(/[，,、\s]+/).map((tag) => tag.trim()).filter(Boolean);
            if (tags.length) fields.push("tags");
            submittedRequest = { draft: { ...currentPerson, ...draft, name: currentPerson.name, tags }, fields };
        }
        const result = await writeImportFields(settings, currentPerson, currentPerson, submittedRequest.draft,
            failedFields.length ? failedFields : submittedRequest.fields);
        const report = result.report;
        if (!report.complete) {
            failedFields = report.unresolved.map((failure) => failure.field);
            results[currentPerson.docId] = report.unknown.length ? "未知，需核实" : result.conflicts.length ? "冲突，最新字段保留" : "部分失败";
            throw new Error(`字段尚未完成：${report.unresolved.map((failure) => `${failure.label}（${failure.message}）`).join("、")}；请核实并重试未完成字段`);
        }
        failedFields = [];
        results[currentPerson.docId] = "已核实成功";
        savedCount += 1;
        onSaved?.();
    }

    async function retryCurrent(): Promise<void> {
        if (running || paused || !currentPerson || failedFields.length === 0) return;
        running = true;
        errorText = "";
        try {
            await persistCurrent();
            advance();
        } catch (error) {
            errorText = error instanceof Error ? error.message : String(error);
            if (currentPerson && !results[currentPerson.docId]) results[currentPerson.docId] = "未核实，原输入保留";
        } finally {
            running = false;
        }
    }
    useCloseGuard({
        busy: () => running,
        dirty: () => !done || Object.values(results).some((status) => status.includes("未完成")),
        changes: () => ["补录队列及原输入只保留本窗口；关闭不删除已保存字段，重开不自动续做"],
    });

    async function saveAndNext(): Promise<void> {
        if (running || paused) return;
        running = true;
        errorText = "";
        try {
            await persistCurrent();
            advance();
        } catch (error) {
            errorText = error instanceof Error ? error.message : String(error);
            if (currentPerson && !results[currentPerson.docId]) results[currentPerson.docId] = "未核实，原输入保留";
        } finally {
            running = false;
        }
    }
    function skip(): void {
        if (running || paused) return;
        if (currentPerson) results[currentPerson.docId] = failedFields.length ? "保留未完成字段，跳过" : "已跳过";
        skippedCount += 1;
        advance();
    }
    function advance(): void {
        if (index + 1 >= queue.length) {
            done = true;
        } else {
            index += 1;
        }
    }
</script>

{#if done}
    <div class="lvct-qf">
        <p role="status" class="lvct-capture__done-line"><CheckCircle2 size={14}/> {text("qfCompletionDone", "补录结束：保存 {saved} 人，跳过 {skipped} 人。", { saved: savedCount, skipped: skippedCount })}</p>
        <p class="ft__smaller ft__on-surface">{text("qfCompletionDoneHint", "首页生日提醒与久未联系统计会在下次加载时反映补录结果。")}</p>
        <div class="lvct-form__actions">
            <button class="b3-button" onclick={onClose}>{text("formDone", "完成")}</button>
        </div>
    </div>
{:else if currentPerson}
    <div class="lvct-qf">
        <p class="ft__smaller ft__on-surface">
            {index + 1} / {queue.length} · 固定人物队列 · 范围：{queuedScopeLabel} · {text("qfCompletionHint", "只列出缺失字段；Tab 依次填写，回车保存并进下一位。")}
        </p>
        <h3 style="margin:0">{currentPerson.name}</h3>
        <p class="ft__smaller">目标文档 {currentPerson.docId} · 行 {currentPerson.itemId}；来源：补录表单，只写本次填写字段，外部变化会停写冲突项。</p>
        {#if paused}<p role="status">补录已暂停，队列与输入仍保留。继续后先核实原人物。</p>{/if}
        <div class="lvct-form__grid">
            {#each missingText as field (field.key)}
                <label class="lvct-form__item">
                    <span>{field.label}</span>
                    <input class="b3-text-field fn__block" type={field.inputType} placeholder={field.placeholder} bind:value={draft[field.key]} disabled={running || paused || submittedRequest !== null} />
                </label>
            {/each}
            {#if missingBirthday}
                <label class="lvct-form__item">
                    <span>{text("formBirthday", "生日")}</span>
                    <input class="b3-text-field fn__block" type="date" bind:value={draft.birthday} disabled={running || paused || submittedRequest !== null} />
                </label>
                <label class="lvct-form__item lvct-form__item--inline">
                    <span>{text("formLunar", "农历")}</span>
                    <input class="b3-switch" type="checkbox" bind:checked={draft.isLunar} disabled={running || paused || submittedRequest !== null} />
                </label>
            {/if}
            {#if missingGroup}
                <label class="lvct-form__item">
                    <span>{text("formGroup", "分组")}</span>
                    <select class="b3-select fn__block" bind:value={draft.group} disabled={running || paused || submittedRequest !== null}>
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
                    <input class="b3-text-field fn__block" type="text" bind:value={tagsText} placeholder={text("formTagsPlaceholder", "球友 重点")} disabled={running || paused || submittedRequest !== null} />
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
            <button class="b3-button b3-button--outline" disabled={running && paused} onclick={() => (paused = !paused)}>{paused ? running ? "当前项结束后暂停" : "继续补录" : "暂停"}</button>
            <button class="b3-button b3-button--cancel" onclick={skip} disabled={running || paused}>
                {text("qfCompletionSkip", "跳过此人")}
            </button>
            {#if failedFields.length > 0}
                <button class="b3-button b3-button--outline" onclick={retryCurrent} disabled={running || paused}>{text("formRetryFailed", "核实并重试未完成字段")}</button>
            {/if}
            <button class="b3-button b3-button--text" onclick={saveAndNext} disabled={running || paused || !draftIsDirty()}>
                {running ? text("formSaving", "保存中…") : text("qfCompletionSaveNext", "保存并下一位")}
            </button>
        </div>
    </div>
{/if}
{#if Object.keys(results).length}
    <ul aria-label="补录逐项结果">{#each Object.entries(results) as [docId, status] (docId)}<li>{docId} · {status}</li>{/each}</ul>
{/if}
