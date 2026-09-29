<script lang="ts">
    /** 从笔记捕获人脉：识别出链联系人 + 新人收编 + 共同交集（互动事件）+ 参与人区块 */
    import { toLocalDateKey } from "../../domain/interactions";
    import type { CapturePreview, CaptureResult } from "../../services/capture";
    import type { ContactsPluginFacade } from "../../types";
    import ViewState from "../ViewState.svelte";
    import { CheckCircle2, Sparkles } from "@lucide/svelte";
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
    // FAST-01.4：AI 结构化候选（资料补充/建跟进），勾选确认后写入；关系候选仅展示不写库
    let aiProfileCandidates: { personDocId: string; personItemId: string; personName: string; field: import("../../domain/ai-extract").ProfileField; value: string; checked: boolean }[] = $state([]);
    let aiFollowUpCandidates: { personDocId: string; personName: string; title: string; dueDate: string; checked: boolean }[] = $state([]);
    let aiRelationNote: string = $state("");
    let extrasError: string = $state("");
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
            aiProfileCandidates = [];
            aiFollowUpCandidates = [];
            aiRelationNote = "";
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
            if (outcome.extraction.occasion && !note) note = outcome.extraction.occasion;
            /* FAST-01.4：结构化候选——只对名册已匹配的人生效，默认勾选待确认 */
            aiProfileCandidates = (outcome.extraction.profileCandidates ?? [])
                .map((candidate) => {
                    const target = outcome.matched.find((person) => person.name === candidate.person);
                    if (!target) return null;
                    return {
                        personDocId: target.docId, personItemId: target.itemId, personName: target.name,
                        field: candidate.field, value: candidate.value, checked: true,
                    };
                })
                .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
            aiFollowUpCandidates = (outcome.extraction.followUpCandidates ?? [])
                .map((candidate) => {
                    const target = outcome.matched.find((person) => person.name === candidate.person);
                    if (!target) return null;
                    return {
                        personDocId: target.docId, personName: target.name,
                        title: candidate.title || "联系一下", dueDate: candidate.dueDate, checked: true,
                    };
                })
                .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
            aiRelationNote = (outcome.extraction.relationCandidates ?? [])
                .map((candidate) => `${candidate.personA} ↔ ${candidate.personB}（${candidate.relation}）`)
                .join("；");
            aiDone = true;
        } catch (error) {
            aiError = error instanceof Error ? error.message : String(error);
        } finally {
            aiRunning = false;
        }
    }

    /** C07/FUNC：主捕获完成后执行勾选的资料补充与建跟进（失败不阻断主结果，单独提示） */
    async function applyAiExtras(): Promise<void> {
        extrasError = "";
        /* FUNC-01.14：受限补丁写——只写勾选字段，服务层以最新名册逐字段冲突核对；
           快照仅用于提供冲突核对的基准值，绝不再作为全字段写入的打底 */
        for (const candidate of aiProfileCandidates) {
            if (!candidate.checked) continue;
            try {
                const person = preview?.linked.find((entry) => entry.docId === candidate.personDocId)
                    ?? outcomeSnapshot().find((entry) => entry.docId === candidate.personDocId);
                const result = await facade.updatePersonCandidateFields(candidate.personItemId, [
                    {
                        field: candidate.field,
                        value: candidate.value,
                        baseline: person?.[candidate.field] ?? "",
                    },
                ]);
                if (result.conflicts.length > 0) {
                    extrasError = `资料候选未写入（${candidate.personName} 的 ${result.conflicts.join("、")} 已被其他窗口修改，请打开资料核对后手动确认）`;
                }
            } catch (error) {
                extrasError = `资料补充失败（${candidate.personName}）：${error instanceof Error ? error.message : String(error)}`;
                return;
            }
        }
        for (const candidate of aiFollowUpCandidates) {
            if (!candidate.checked) continue;
            try {
                await facade.createFollowUp(candidate.personDocId, candidate.title, candidate.dueDate);
            } catch (error) {
                extrasError = `建跟进失败（${candidate.personName}）：${error instanceof Error ? error.message : String(error)}`;
                return;
            }
        }
    }
    /** 捕获完成后的名册快照（AI 候选打底用）；preview.linked 优先 */
    function outcomeSnapshot() {
        return preview?.linked ?? [];
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
            /* FAST-01.4：AI 候选的资料补充/建跟进在主捕获成功后执行（失败单独提示不阻断主结果） */
            await applyAiExtras();
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
            <p class="lvct-capture__done-line"><CheckCircle2 size={14}/> {text("captureDoneInteractions", "已记录 {n} 条互动", { n: result.interactions })}</p>
            {#if result.createdNames.length > 0}<p class="lvct-capture__done-line"><Sparkles size={14}/> {text("captureDoneCreated", "新增联系人：{n}", { n: result.createdNames.join("、") })}</p>{/if}
            {#if result.attendeeBlockWritten}<p class="lvct-capture__done-line"><Sparkles size={14}/> {text("captureDoneBlock", "笔记已写入「参与人员」双链区块")}</p>{/if}
            {#if (aiProfileCandidates.some((c) => c.checked) || aiFollowUpCandidates.some((c) => c.checked)) && !extrasError}
                <p class="lvct-capture__done-line"><Sparkles size={14}/> {text("captureAiExtrasDone", "AI 候选的资料补充与建跟进已完成")}</p>
            {/if}
            {#if extrasError}<p class="ft__smaller lvct-text-danger">{extrasError}</p>{/if}
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

        {#if aiDone && (aiProfileCandidates.length > 0 || aiFollowUpCandidates.length > 0 || aiRelationNote)}
            <div class="lvct-form__item" aria-label="AI 结构化候选">
                <span><b class="lvct-capture__source-note">{text("captureAiStructured", "AI 结构化候选（勾选确认后才会写入）")}</b></span>
                {#if aiProfileCandidates.length > 0}
                    <div class="lvct-capture__list">
                        {#each aiProfileCandidates as candidate (candidate.personDocId + candidate.field)}
                            <label class="lvct-import__row">
                                <input class="b3-switch" type="checkbox" bind:checked={candidate.checked} />
                                <span><b>{candidate.personName}</b></span>
                                <span class="ft__smaller ft__on-surface">
                                    {candidate.field === "phone" ? "电话" : candidate.field === "wechat" ? "微信" : candidate.field === "email" ? "邮箱" : candidate.field === "website" ? "网址" : "生日"}：{candidate.value}
                                </span>
                                <span class="lvct-capture__source-badge lvct-capture__source-badge--ai">{text("captureBadgeAi", "AI 提名")}</span>
                            </label>
                        {/each}
                    </div>
                {/if}
                {#if aiFollowUpCandidates.length > 0}
                    <div class="lvct-capture__list">
                        {#each aiFollowUpCandidates as candidate (candidate.personDocId + candidate.title)}
                            <label class="lvct-import__row">
                                <input class="b3-switch" type="checkbox" bind:checked={candidate.checked} />
                                <span><b>{candidate.personName}</b></span>
                                <span class="ft__smaller ft__on-surface">建跟进「{candidate.title}」· {candidate.dueDate}</span>
                                <span class="lvct-capture__source-badge lvct-capture__source-badge--ai">{text("captureBadgeAi", "AI 提名")}</span>
                            </label>
                        {/each}
                    </div>
                {/if}
                {#if aiRelationNote}
                    <p class="ft__smaller ft__on-surface">
                        {text("captureAiRelationNote", "AI 建议的关系（当前版本仅记录在笔记中，不写入人脉）：")}{aiRelationNote}
                    </p>
                {/if}
            </div>
        {/if}
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
