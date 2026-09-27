<script lang="ts">
    /** 从笔记捕获人脉：识别出链联系人 + 新人收编 + 共同交集（互动事件）+ 参与人区块 */
    import { toLocalDateKey } from "../../domain/interactions";
    import type { CapturePreview, CaptureResult } from "../../services/capture";
    import type { ContactsPluginFacade } from "../../types";
    import ViewState from "../ViewState.svelte";
    import { translateText } from "../../domain/translation";

    let {
        facade,
        i18n,
        docId,
        onClose,
    }: {
        facade: ContactsPluginFacade;
        i18n?: Readonly<Record<string, string>>;
        docId: string;
        onClose: () => void;
    } = $props();
    const text = $derived.by(() => (key: string, fallback: string, values?: Record<string, string | number>) =>
        translateText(i18n, key, fallback, values));

    let preview: CapturePreview | null = $state(null);
    let checked: Record<string, boolean> = $state({});
    let newNamesText: string = $state("");
    let date: string = $state(toLocalDateKey());
    let place: string = $state("");
    let note: string = $state("");
    let running: boolean = $state(false);
    let errorText: string = $state("");
    let result: CaptureResult | null = $state(null);
    let loadError: string = $state("");
    let aiRunning: boolean = $state(false);
    let aiError: string = $state("");
    let aiDone: boolean = $state(false);
    let aiMatchedIds: string[] = $state([]);
    let aiUnknownNames: string[] = $state([]);
    let step: 1 | 2 | 3 = $state(1);

    const checkedIds = $derived(Object.entries(checked).filter(([, on]) => on).map(([id]) => id));
    const hasTarget = $derived(checkedIds.length > 0 || newNamesText.trim().length > 0);
    const createdPeople = $derived.by(() => {
        const current = result;
        if (!current) return [] as { name: string; docId: string }[];
        return current.createdNames
            .map((name: string, index: number) => ({ name, docId: current.createdDocIds[index] }))
            .filter((item): item is { name: string; docId: string } => Boolean(item.docId));
    });

    async function load() {
        loadError = "";
        try {
            preview = await facade.previewCapture(docId);
            const initial: Record<string, boolean> = {};
            for (const person of preview.linked) initial[person.docId] = true;
            checked = initial;
            aiMatchedIds = [];
            aiUnknownNames = [];
        } catch (error) {
            loadError = error instanceof Error ? error.message : String(error);
        }
    }

    load();

    /** AI 只提名不做决定：抽取结果全部进表单，由用户确认后才落库 */
    async function runAi() {
        if (aiRunning) return;
        aiRunning = true;
        aiError = "";
        try {
            const outcome = await facade.aiExtractFromDoc(docId);
            if (!outcome.extraction) {
                aiError = outcome.likelyUnconfigured
                    ? text("captureAiUnconfigured", "思源 AI 可能未配置：请到 设置 → 人工智能 中配置模型后重试")
                    : text("captureAiNoResult", "AI 未返回有效结果，请重试或手工填写");
                return;
            }
            for (const person of outcome.matched) {
                checked[person.docId] = true;
            }
            aiMatchedIds = [...new Set([...aiMatchedIds, ...outcome.matched.map((person) => person.docId)])];
            aiUnknownNames = [...new Set([...aiUnknownNames, ...outcome.unknownNames])];
            const existing = new Set(
                newNamesText.split(/[，,、\s]+/).map((name) => name.trim()).filter((name) => name.length > 0),
            );
            for (const name of outcome.unknownNames) {
                existing.add(name);
            }
            newNamesText = [...existing].join(" ");
            if (outcome.extraction.date && !date) date = outcome.extraction.date;
            if (outcome.extraction.place && !place) place = outcome.extraction.place;
            aiDone = true;
        } catch (error) {
            aiError = error instanceof Error ? error.message : String(error);
        } finally {
            aiRunning = false;
        }
    }

    async function submit() {
        if (running || !hasTarget) return;
        running = true;
        errorText = "";
        try {
            const newNames = newNamesText.split(/[，,、\s]+/).map((name) => name.trim()).filter((name) => name.length > 0);
            result = await facade.captureDoc(docId, {
                personDocIds: checkedIds,
                newNames,
                date: date || toLocalDateKey(),
                place: place.trim() || undefined,
                note: note.trim() || undefined,
            });
            step = 3;
        } catch (error) {
            errorText = error instanceof Error ? error.message : String(error);
        } finally {
            running = false;
        }
    }
</script>

<div class="lvct-form">
    {#if loadError}
        <ViewState compact error title={text("captureLoadFail", "笔记分析失败")} description={loadError}>
            <button class="b3-button b3-button--outline" onclick={load}>{text("captureRetry", "重试")}</button>
            <button class="b3-button b3-button--cancel" onclick={onClose}>关闭</button>
        </ViewState>
    {:else if !preview}
        <ViewState compact loading title={text("captureAnalyzing", "正在分析笔记中的联系人")} />
    {:else if result}
        <div class="lvct-capture__steps" aria-label="捕获进度">
            <span class="lvct-capture__step--done"><b>1</b> {text("captureStepIdentify", "识别")}</span>
            <i aria-hidden="true">›</i>
            <span class="lvct-capture__step--done"><b>2</b> {text("captureStepConfirm", "确认")}</span>
            <i aria-hidden="true">›</i>
            <span class="lvct-capture__step--active"><b>3</b> {text("captureStepDone", "完成")}</span>
        </div>
        <div class="lvct-form__hint">
            <p>✓ {text("captureDoneInteractions", "已记录 {n} 条互动", { n: result.interactions })}</p>
            {#if result.createdNames.length > 0}<p>✦ {text("captureDoneCreated", "新增联系人：{n}", { n: result.createdNames.join("、") })}</p>{/if}
            {#if result.attendeeBlockWritten}<p>✦ {text("captureDoneBlock", "笔记已写入「参与人员」双链区块")}</p>{/if}
            <p class="ft__smaller ft__on-surface">{text("captureDoneIdempotent", "同一篇笔记重复捕获不会重复记录。")}</p>
        </div>
        <div class="lvct-form__actions lvct-capture__result-actions">
            <button class="b3-button b3-button--outline" onclick={() => facade.openDoc(docId)}>{text("captureOpenNote", "打开原笔记")}</button>
            {#each createdPeople as person (person.docId)}
                <button class="b3-button b3-button--outline" onclick={() => facade.openPersonDoc(person.docId)}>{text("captureOpenPerson", "打开{nm}", { nm: person.name })}</button>
            {/each}
        </div>
        <div class="lvct-form__actions">
            <button class="b3-button b3-button--text" onclick={onClose}>{text("captureDone", "完成")}</button>
        </div>
    {:else}
        <div class="lvct-capture__steps" aria-label="捕获进度">
            <span class:lvct-capture__step--active={step === 1}><b>1</b> {text("captureStepIdentify", "识别")}</span>
            <i aria-hidden="true">›</i>
            <span class:lvct-capture__step--active={step === 2}><b>2</b> {text("captureStepConfirm", "确认")}</span>
            <i aria-hidden="true">›</i>
            <span><b>3</b> {text("captureStepDone", "完成")}</span>
        </div>
        <p class="ft__smaller ft__on-surface lvct-form__hint">
            {text("captureSourceNote", "笔记：")}{preview.docName || docId}
        </p>

        {#if step === 1}
        <div class="lvct-form__item">
            <span>{text("captureLinkedCount", "已识别的人脉联系人（{n}，来自笔记内双链）", { n: preview.linked.length })}</span>
            {#if preview.linked.length === 0}
                <p class="ft__smaller ft__on-surface">
                    {text("captureNoLinked", "本笔记没有链接到任何联系人。可先在笔记里用 [[姓名]] 链接联系人，或在下方直接输入新人名单。")}
                </p>
            {:else}
                <div class="lvct-capture__list">
                    {#each preview.linked as person (person.docId)}
                        <label class="lvct-import__row">
                            <input class="b3-switch" type="checkbox" bind:checked={checked[person.docId]} />
                            <span><b>{person.name}</b></span>
                            <span class="ft__smaller ft__on-surface">{person.group || text("captureUngrouped", "未分组")}</span>
                            <span class="lvct-capture__source-badge">{text("captureBadgeLink", "双链")}</span>
                            {#if aiMatchedIds.includes(person.docId)}<span class="lvct-capture__source-badge lvct-capture__source-badge--ai">{text("captureBadgeAi", "AI 提名")}</span>{/if}
                        </label>
                    {/each}
                </div>
            {/if}
            {#if facade.viewPreferences.aiEnabled}
                <button class="b3-button b3-button--outline" style="margin-top: 6px;" onclick={runAi} disabled={aiRunning}>
                    {aiRunning ? text("captureAiRunning", "AI 分析中…") : aiDone ? text("captureAiDone", "AI 已分析（可再次分析）") : text("captureAiButton", "AI 分析本页（识别未链接的人名/日期/地点）")}
                </button>
                {#if aiRunning}
                    <div class="lvct-capture__ai-progress" role="status" aria-live="polite" aria-busy="true">
                        <span class="lvct-skeleton" aria-hidden="true"></span>
                        {text("captureAiProgress", "正在读取笔记并核对联系人名册…")}
                    </div>
                {/if}
                {#if aiError}
                    <p class="ft__smaller lvct-text-danger">{aiError}</p>
                {/if}
            {/if}
        </div>

        <label class="lvct-form__item">
            <span>{text("captureNewNamesLabel", "新人员名单（不在人脉库中，将按名新建；空格/逗号分隔）")}</span>
            <input class="b3-text-field fn__block" type="text" bind:value={newNamesText} placeholder={text("captureNewNamesPlaceholder", "王五 赵六")} />
            {#if aiUnknownNames.length > 0}
                <span class="lvct-capture__source-note"><b>{text("captureBadgeAi", "AI 提名")}</b>：{aiUnknownNames.join("、")}，{text("captureAiConfirmNote", "请确认后再记录。")}</span>
            {/if}
        </label>
        {/if}

        {#if step === 2}
        <div class="lvct-form__grid">
            <label class="lvct-form__item">
                <span>{text("captureOccasionDate", "场合日期")}</span>
                <input class="b3-text-field fn__block" type="date" bind:value={date} />
            </label>
            <label class="lvct-form__item">
                <span>{text("capturePlaceLabel", "地点（可选）")}</span>
                <input class="b3-text-field fn__block" type="text" bind:value={place} placeholder={text("capturePlacePlaceholder", "会议室 / 餐厅…")} />
            </label>
        </div>
        <label class="lvct-form__item">
            <span>{text("captureNoteLabel", "备注（可选）")}</span>
            <input class="b3-text-field fn__block" type="text" bind:value={note} placeholder={text("captureNotePlaceholder", "产品发布会")} />
        </label>

        {#if errorText}
            <div class="lvct-form__error">{errorText}</div>
        {/if}

        {#if running}
            <div class="lvct-capture__ai-progress" role="status" aria-live="polite" aria-busy="true">
                <span class="lvct-skeleton" aria-hidden="true"></span>
                {text("captureWritingProgress", "正在写入互动和参与人员区块…")}
            </div>
        {/if}

        <div class="lvct-form__actions">
            <button class="b3-button b3-button--cancel" onclick={() => (step = 1)} disabled={running}>{text("captureBackToIdentify", "返回识别")}</button>
            <button class="b3-button b3-button--text" onclick={submit} disabled={running || !hasTarget}>
                {running ? text("captureRecording", "记录中…") : text("captureRecordAndWrite", "记录互动并写入参与人员")}
            </button>
        </div>
        <p class="ft__smaller ft__on-surface lvct-form__hint">
            {text("captureSubmitHint", "将为每位参与者记录一条互动（含时间/地点/备注），并在本笔记末尾写入「参与人员」双链区块。")}
        </p>
        {:else}
        <div class="lvct-form__actions">
            <button class="b3-button b3-button--cancel" onclick={onClose}>{text("captureCancel", "取消")}</button>
            <button class="b3-button b3-button--text" onclick={() => (step = 2)} disabled={!hasTarget || aiRunning}>{text("captureNextConfirm", "下一步：确认记录")}</button>
        </div>
        {/if}
    {/if}
</div>
