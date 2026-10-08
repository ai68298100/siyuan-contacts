<script lang="ts">
    /** 从笔记捕获人脉：识别出链联系人 + 新人收编 + 共同交集（互动事件）+ 参与人区块 */
    import { toLocalDateKey } from "../../domain/interactions";
    import type { CapturePreview, CaptureResult } from "../../services/capture";
    import type { ContactsPluginFacade } from "../../types";
    import ViewState from "../ViewState.svelte";
    import { useCloseGuard } from "../close-guard";
    import { CheckCircle2, Sparkles } from "@lucide/svelte";
    import { translateText } from "../../domain/translation";
    import { onDestroy } from "svelte";
    import { AI_CANDIDATE_FIELDS } from "../../domain/ai-extract";
    import type { AiCandidateField } from "../../domain/ai-extract";
    import { AiExtractionError } from "../../domain/ai-preflight";
    import type { AiPreflight, AiSourceKind } from "../../domain/ai-preflight";
    import { acceptAiCandidateInCapture, aiCandidateCanAccept, captureAiCandidateEffect, decideAiCandidate, resetAiCandidate, restoreAiCandidateInCapture } from "../../domain/ai-candidates";
    import type { AiCandidateCaptureEffect, AiCandidateDraft, AiCaptureDraft } from "../../domain/ai-candidates";
    import { applyAcceptedAiDrafts } from "../../services/ai-extract";
    import type { ContactSummary } from "../../domain/person";

    let {
        facade,
        i18n,
        docId,
        hostCloseChannel,
        onClose,
    }: {
        facade: ContactsPluginFacade;
        i18n?: Readonly<Record<string, string>>;
        docId: string;
        /** D-40：libs/dialog 注入的宿主关闭通道（X/Esc/遮罩经守卫路由）；缺省保持宿主原行为 */
        hostCloseChannel?: { request?: (close: () => void) => void };
        onClose: () => void;
    } = $props();
    const text = $derived.by(() => (key: string, fallback: string, values?: Record<string, string | number>) =>
        translateText(i18n, key, fallback, values));

    let preview: CapturePreview | null = $state(null);
    let checked: Record<string, boolean> = $state({});
    let linkedDocIds: string[] = $state([]);
    let newNamesText: string = $state("");
    let date: string = $state(toLocalDateKey());
    let place: string = $state("");
    let note: string = $state("");
    let loading: boolean = $state(true);
    let running: boolean = $state(false);
    let errorText: string = $state("");
    let result: CaptureResult | null = $state(null);
    let loadError: string = $state("");
    let aiRunning: boolean = $state(false);
    let aiError: string = $state("");
    let aiDone: boolean = $state(false);
    let aiMatchedIds: string[] = $state([]);
    let aiCandidates: AiCandidateDraft[] = $state([]);
    const aiProfileCandidates = $derived(aiCandidates.filter((candidate) => candidate.kind === "profile"));
    const aiFollowUpCandidates = $derived(aiCandidates.filter((candidate) => candidate.kind === "followup"));
    let aiAvailableTargets: ContactSummary[] = $state([]);
    let aiPreflight: AiPreflight | null = $state.raw(null);
    let aiPreflightOpen = $state(false);
    let aiSourceKind: AiSourceKind = $state("document");
    let aiSourceText = $state("");
    let aiSourceProvided = $state(false);
    let aiRejected = $state(0);
    let aiRemoveContacts = $state(true);
    let aiFields: AiCandidateField[] = $state([...AI_CANDIDATE_FIELDS]);
    let aiSequence = 0;
    let aiController: AbortController | null = null;
    let disposed = false;
    const aiDraftEffects = new Map<string, AiCandidateCaptureEffect>();
    let extrasError: string = $state("");
    let aiExtrasApplied: boolean = $state(false);
    let step: 1 | 2 | 3 = $state(1);
    onDestroy(() => {
        disposed = true;
        aiSequence += 1;
        aiController?.abort();
    });
    $effect(() => {
        if (!facade.viewPreferences.aiEnabled) {
            cancelAi();
            aiCandidates = [];
            aiPreflightOpen = false;
        }
    });
    /* CODE-02.1：捕获挂起（主流程/AI 分析）期间关闭按钮静默阻断——失败草稿与步骤保持可见 */
    /* V-19：关闭守卫的真实脏态——与载入完成时的基线比对（识别勾选/新人名单/日期/地点/备注）。
       AI 回填与手工修改都使当前值偏离基线（关闭需经守卫确认放弃）；主捕获成功后草稿已被
       消费（result 就绪），关闭不再拦截。 */
    let dirtyBaseline = { checkedIds: [] as string[], newNames: "", date: toLocalDateKey(), place: "", note: "" };
    function markClean(): void {
        dirtyBaseline = {
            checkedIds: Object.entries(checked).filter(([, on]) => on).map(([id]) => id),
            newNames: newNamesText,
            date,
            place,
            note,
        };
    }
    function hasUnsavedDraft(): boolean {
        if (result) return false;
        const baseIds = new Set(dirtyBaseline.checkedIds);
        if (checkedIds.length !== dirtyBaseline.checkedIds.length) return true;
        if (checkedIds.some((id) => !baseIds.has(id))) return true;
        return newNamesText.trim() !== dirtyBaseline.newNames.trim()
            || date !== dirtyBaseline.date
            || place.trim() !== dirtyBaseline.place.trim()
            || note.trim() !== dirtyBaseline.note.trim();
    }
    /* CODE-02.1：捕获挂起（主流程/AI 分析）期间关闭按钮静默阻断——失败草稿与步骤保持可见 */
    const guardedClose = useCloseGuard({
        busy: () => loading || running || aiRunning,
        dirty: () => hasUnsavedDraft(),
    });
    function closeIfIdle(): void {
        void guardedClose(onClose);
    }
    /* D-40：宿主 X/Esc/遮罩经同一守卫路由（通道由 libs/dialog 注入）；
       返回 Promise 供拦截层做重入门（三选一期间不再重复拦截） */
    $effect(() => {
        if (hostCloseChannel) hostCloseChannel.request = (close) => guardedClose(close);
    });

    function openOptionalDoc(docId: string | undefined): void {
        if (docId) void facade.openDoc(docId);
    }

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
        loading = true;
        loadError = "";
        try {
            preview = await facade.previewCapture(docId);
            const initial: Record<string, boolean> = {};
            for (const person of preview.linked) initial[person.docId] = true;
            checked = initial;
            linkedDocIds = preview.linked.map((person) => person.docId);
            aiMatchedIds = [];
            aiCandidates = [];
            /* V-19：初始勾选不算草稿——基线在此刻落定（重试重载同样复基线） */
            markClean();
        } catch (error) {
            loadError = error instanceof Error ? error.message : String(error);
        } finally {
            loading = false;
        }
    }

    load();

    function cancelAi(): void {
        aiSequence += 1;
        aiController?.abort();
        aiController = null;
        aiRunning = false;
        aiPreflight = null;
        aiError = "";
    }

    function invalidatePreflight(): void {
        aiPreflight = null;
    }

    function editAiSource(): void {
        aiSourceProvided = true;
        invalidatePreflight();
    }

    async function runAi(): Promise<void> {
        if (aiRunning || !facade.viewPreferences.aiEnabled) return;
        aiPreflightOpen = true;
        aiError = "";
        await refreshPreflight();
    }

    async function refreshPreflight(): Promise<void> {
        if (aiRunning || !facade.viewPreferences.aiEnabled) return;
        const sequence = ++aiSequence;
        aiRunning = true;
        aiError = "";
        try {
            const preflight = await facade.prepareAiExtraction(docId, {
                sourceKind: aiSourceKind,
                ...(aiSourceKind !== "document" || aiSourceProvided ? { sourceText: aiSourceText } : {}),
                removeContacts: aiRemoveContacts, fields: aiFields,
            });
            if (disposed || sequence !== aiSequence || !facade.viewPreferences.aiEnabled) return;
            aiSourceText = preflight.sourceText;
            aiSourceProvided = true;
            aiPreflight = preflight;
        } catch (error) {
            if (sequence === aiSequence && !disposed) aiError = error instanceof AiExtractionError ? error.message : "来源预览失败，未发送。";
        } finally {
            if (sequence === aiSequence) aiRunning = false;
        }
    }

    async function confirmAi(): Promise<void> {
        if (aiRunning || !aiPreflight || !facade.viewPreferences.aiEnabled) return;
        const sequence = ++aiSequence;
        const preflight = aiPreflight;
        aiController = new AbortController();
        aiRunning = true;
        aiError = "";
        aiPreflight = null;
        try {
            const outcome = await facade.aiExtractFromDoc(docId, { preflight, confirmed: true, signal: aiController.signal });
            if (disposed || sequence !== aiSequence || !facade.viewPreferences.aiEnabled || outcome.preflightId !== preflight.id) return;
            if (!outcome.extraction) {
                aiError = outcome.likelyUnconfigured
                    ? text("captureAiUnconfigured", "思源 AI 可能未配置：请到 设置 → 人工智能 中配置模型后重试")
                    : text("captureAiNoResult", "AI 未返回有效结果，请重试或手工填写");
                return;
            }
            const ambiguousPeople = (outcome.ambiguousCandidates ?? []).flatMap((candidate) => candidate.people);
            if (preview) {
                const displayed = new Map(preview.linked.map((person) => [person.docId, person]));
                for (const person of [...outcome.matched, ...ambiguousPeople]) displayed.set(person.docId, person);
                preview = { ...preview, linked: [...displayed.values()] };
            }
            if (ambiguousPeople.length) aiError = text("captureAiNameAmbiguous", "AI 提名含同名候选，请按文档 ID 手动勾选；其资料和跟进未自动指派。");
            aiMatchedIds = [...new Set([...aiMatchedIds, ...outcome.matched.map((person) => person.docId)])];
            aiCandidates = [...aiCandidates, ...outcome.candidates];
            aiRejected = outcome.extraction.rejected;
            if (outcome.candidates.length === 0) aiError = "没有可接受的 AI 候选，请继续手动填写。";
            aiAvailableTargets = [...new Map(outcome.candidates.flatMap((candidate) => candidate.targets).map((person) => [person.docId, person])).values()];
            aiDone = true;
            aiPreflightOpen = false;
        } catch (error) {
            if (!disposed && sequence === aiSequence) aiError = error instanceof AiExtractionError ? error.message : "AI 请求失败，可继续手动捕获。";
        } finally {
            if (sequence === aiSequence) aiRunning = false;
        }
    }

    function decideCandidate(candidate: AiCandidateDraft, decision: "accepted" | "rejected"): void {
        aiCandidates = decideAiCandidate(aiCandidates, candidate.id, decision);
        const updated = aiCandidates.find((entry) => entry.id === candidate.id);
        if (!updated || updated.decision !== decision) return;
        if (decision === "rejected") {
            restoreCandidateEffect(candidate);
            return;
        }
        if (!aiDraftEffects.has(candidate.id)) {
            aiDraftEffects.set(candidate.id, captureAiCandidateEffect(candidate, captureDraftState()));
        }
        applyCaptureDraftState(acceptAiCandidateInCapture(updated, captureDraftState()));
    }

    function captureDraftState(): AiCaptureDraft {
        return { checked, newNamesText, date, place, note };
    }

    function applyCaptureDraftState(draft: AiCaptureDraft): void {
        checked = draft.checked;
        newNamesText = draft.newNamesText;
        date = draft.date;
        place = draft.place;
        note = draft.note;
    }

    function restoreCandidateEffect(candidate: AiCandidateDraft): void {
        const effect = aiDraftEffects.get(candidate.id);
        if (!effect) return;
        applyCaptureDraftState(restoreAiCandidateInCapture(candidate, effect, captureDraftState()));
        aiDraftEffects.delete(candidate.id);
    }

    function editCandidate(candidate: AiCandidateDraft): void {
        restoreCandidateEffect(candidate);
        resetAiCandidate(candidate);
    }

    /** C07/FUNC：主捕获完成后执行勾选的资料补充与建跟进（失败不阻断主结果，单独提示） */
    async function applyAiExtras(): Promise<void> {
        extrasError = "";
        if (!facade.viewPreferences.aiEnabled) return;
        if (aiCandidates.some((candidate) => candidate.checked && (candidate.kind === "profile" || candidate.kind === "followup"))) {
            try { aiAvailableTargets = await facade.listContacts(); }
            catch { extrasError = "人物目标读取失败，保留候选，未写入。"; return; }
        }
        await applyAcceptedAiDrafts(facade, aiCandidates, result?.complete !== false && result !== null);
        const failures = [...aiProfileCandidates, ...aiFollowUpCandidates]
            .filter((candidate) => candidate.checked && candidate.status !== "applied" && candidate.status !== "skipped")
            .map((candidate) => `${candidate.personName}：${candidate.error ?? "尚未核实"}`);
        extrasError = failures.join("；");
    }

    /* D-35：错误出现时焦点迁入错误块 */
    let errorEl: HTMLElement | undefined = $state();
    $effect(() => {
        if (errorText && errorEl) errorEl.focus();
    });

    async function submit() {
        if (running || !hasTarget) return;
        running = true;
        errorText = "";
        try {
            const newNames = newNamesText.split(/[，,、\s]+/).map((name) => name.trim()).filter((name) => name.length > 0);
            const input = {
                personDocIds: checkedIds,
                newNames,
                date: date || toLocalDateKey(),
                place: place.trim() || undefined,
                note: note.trim() || undefined,
            };
            const captured = await facade.captureDoc(docId, input);
            result = {
                ...captured,
                complete: captured.complete ?? true,
                occasionLinkFailures: captured.occasionLinkFailures ?? [],
                checkpoint: captured.checkpoint ?? {
                    requestId: "legacy",
                    generation: 1,
                    sourceDocId: docId,
                    anchor: "legacy",
                    input,
                    people: [],
                    projections: [],
                },
            };
            if (result.complete !== false && !aiExtrasApplied) {
                await applyAiExtras();
                aiExtrasApplied = !extrasError;
            }
            step = 3;
        } catch (error) {
            errorText = error instanceof Error ? error.message : String(error);
        } finally {
            running = false;
        }
    }

    async function retryIncomplete(): Promise<void> {
        if (running || !result || result.complete !== false || !result.checkpoint) return;
        running = true;
        errorText = "";
        try {
            const input = result.checkpoint.input;
            result = await facade.captureDoc(docId, { ...input, checkpoint: result.checkpoint });
            if (result.complete !== false && !aiExtrasApplied) {
                await applyAiExtras();
                aiExtrasApplied = !extrasError;
            }
        } catch (error) {
            errorText = error instanceof Error ? error.message : String(error);
        } finally {
            running = false;
        }
    }

    function stageText(status: string): string {
        if (status === "applied") return "已完成";
        if (status === "skipped") return "已核实，跳过";
        if (status === "failed") return "失败";
        if (status === "unknown") return "未知，需核实";
        return "待处理";
    }

    function aiExtrasComplete(): boolean {
        return [...aiProfileCandidates, ...aiFollowUpCandidates]
            .filter((candidate) => candidate.checked)
            .every((candidate) => candidate.status === "applied" || candidate.status === "skipped");
    }

    async function retryAiExtras(): Promise<void> {
        if (running || !result || result.complete === false) return;
        running = true;
        try {
            await applyAiExtras();
            aiExtrasApplied = aiExtrasComplete();
        } finally {
            running = false;
        }
    }
</script>

<div class="lvct-form">
    {#if loadError}
        <ViewState compact error title={text("captureLoadFail", "笔记分析失败")} description={loadError}>
            <button class="b3-button b3-button--outline" onclick={load}>{text("captureRetry", "重试")}</button>
            <button class="b3-button b3-button--cancel" onclick={closeIfIdle}>关闭</button>
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
            {#if result.occasionLinksWritten > 0}<p class="lvct-capture__done-line"><Sparkles size={14}/> {text("captureDoneOccasionLinks", "已完成 {n} 个事项双链区块", { n: result.occasionLinksWritten })}</p>{/if}
            {#if result.dateDocId || result.placeDocId}<p class="lvct-capture__done-line"><Sparkles size={14}/> {text("captureDoneOccasionDocuments", "已关联当日日记与地点文档")}</p>{/if}
            {#if result.occasionLinkFailures.length > 0}
                <p class="ft__smaller lvct-text-danger">
                    {text("captureDoneOccasionFailures", "有 {n} 个事项双链投影未完成，可重试捕获：{details}", {
                        n: result.occasionLinkFailures.length,
                        details: result.occasionLinkFailures.map((failure) => `${failure.target}：${failure.message}`).join("；"),
                    })}
                </p>
            {/if}
            {#if result.checkpoint}
            <div class="lvct-capture__checkpoint" aria-live="polite">
                <p class="ft__smaller"><b>{text("captureCheckpointTitle", "逐人处理结果")}</b></p>
                {#each result.checkpoint.people as person}
                    <p class="ft__smaller">
                        {person.name}：{text("captureCheckpointContact", "建档 {status}", { status: stageText(person.contact.status) })}，{text("captureCheckpointInteraction", "互动 {status}", { status: stageText(person.interaction.status) })}
                        {#if person.contact.message || person.interaction.message}<span class="lvct-text-danger">（{person.contact.message || person.interaction.message}）</span>{/if}
                    </p>
                {/each}
                {#if result.checkpoint.projections.some((projection) => projection.status === "failed" || projection.status === "unknown")}
                    <p class="ft__smaller lvct-text-danger">{text("captureCheckpointProjection", "事项投影仍有失败或未知项，重试前会先核对原标记区块。")}</p>
                {/if}
            </div>
            {/if}
            {#if aiExtrasComplete() && (aiProfileCandidates.some((c) => c.checked) || aiFollowUpCandidates.some((c) => c.checked))}
                <p class="lvct-capture__done-line"><Sparkles size={14}/> {text("captureAiExtrasDone", "AI 候选的资料补充与建跟进已完成")}</p>
            {/if}
            {#if extrasError}<p class="ft__smaller lvct-text-danger" role="alert">{extrasError}</p>{/if}
            {#each [...aiProfileCandidates, ...aiFollowUpCandidates] as candidate}
                {#if candidate.checked}
                    <div class="lvct-capture__candidate">
                        <p class="ft__smaller">AI 已接受草稿 · {candidate.personName} · {candidate.kind === "profile" ? `${candidate.field}：${candidate.value}` : `${candidate.title} · ${candidate.dueDate}`} · {stageText(candidate.status)}</p>
                        {#if candidate.writeCheckpoint}<p class="ft__smaller">目标 {candidate.writeCheckpoint.docId} · {candidate.writeCheckpoint.itemId}</p>{/if}
                        {#if !candidate.writeCheckpoint && candidate.status === "pending"}
                            <label class="lvct-form__item">
                                <span>选择已建立的人物目标（不按姓名自动关联）</span>
                                <select class="b3-select" bind:value={candidate.selectedDocId} disabled={running}>
                                    <option value="">待选择稳定人物 ID</option>
                                    {#each aiAvailableTargets as target (target.docId)}
                                        <option value={target.docId}>{target.name} · {target.docId} · {target.itemId}</option>
                                    {/each}
                                </select>
                            </label>
                            <button class="b3-button b3-button--cancel" onclick={() => decideCandidate(candidate, "rejected")} disabled={running}>拒绝本项</button>
                        {/if}
                        {#if candidate.error}<p class="ft__smaller lvct-text-danger" role="alert">{candidate.error}</p>{/if}
                    </div>
                {/if}
            {/each}
            <p class="ft__smaller ft__on-surface">{text("captureDoneIdempotent", "同一篇笔记重复捕获不会重复记录。")}</p>
        </div>
        <div class="lvct-form__actions lvct-capture__result-actions">
            <button class="b3-button b3-button--outline" onclick={() => facade.openDoc(docId)}>{text("captureOpenNote", "打开原笔记")}</button>
            {#if result.dateDocId}<button class="b3-button b3-button--outline" onclick={() => openOptionalDoc(result?.dateDocId)}>{text("captureOpenDiary", "打开当日日记")}</button>{/if}
            {#if result.placeDocId}<button class="b3-button b3-button--outline" onclick={() => openOptionalDoc(result?.placeDocId)}>{text("captureOpenPlace", "打开地点")}</button>{/if}
            {#each createdPeople as person (person.docId)}
                <button class="b3-button b3-button--outline" onclick={() => facade.openPersonDoc(person.docId)}>{text("captureOpenPerson", "打开{nm}", { nm: person.name })}</button>
            {/each}
        </div>
        {#if result.complete === false}
            <div class="lvct-form__actions">
                <button class="b3-button b3-button--outline" onclick={retryIncomplete} disabled={running}>
                    {running ? text("captureRetrying", "核实并重试中…") : text("captureRetryIncomplete", "仅重试未完成项")}
                </button>
            </div>
        {/if}
        {#if !aiExtrasComplete() && (aiProfileCandidates.some((c) => c.checked) || aiFollowUpCandidates.some((c) => c.checked))}
            <div class="lvct-form__actions">
                <button class="b3-button b3-button--outline" onclick={retryAiExtras} disabled={running}>
                    {running ? text("captureRetryingAi", "核实 AI 写入中…") : text("captureRetryAi", "仅重试未核实的 AI 写入")}
                </button>
            </div>
        {/if}
        <div class="lvct-form__actions">
            <button class="b3-button b3-button--text" onclick={closeIfIdle}>{text("captureDone", "完成")}</button>
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
        <p class="ft__smaller">来源 {docId} · 双链按文档 ID 核对。保留原文，仅追加/更新插件标记区块。</p>

        {#if step === 1}
        <div class="lvct-form__item">
            <span>{text("captureCandidateCount", "联系人候选（{n}，来源见各项标记）", { n: preview.linked.length })}</span>
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
                            {#if preview.linked.filter((candidate) => candidate.name === person.name).length > 1}
                                <small>{person.phone || person.email || "—"} · {person.docId} · {person.itemId}</small>
                            {/if}
                            <span class="ft__smaller ft__on-surface">{person.group || text("captureUngrouped", "未分组")}</span>
                            {#if linkedDocIds.includes(person.docId)}<span class="lvct-capture__source-badge">{text("captureBadgeLink", "双链")}</span>{/if}
                            {#if aiMatchedIds.includes(person.docId) || !linkedDocIds.includes(person.docId)}<span class="lvct-capture__source-badge lvct-capture__source-badge--ai">{text("captureBadgeAi", "AI 提名")}</span>{/if}
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
                        {text("captureAiProgress", "正在准备或分析本次文本…")}
                    </div>
                    <button class="b3-button b3-button--cancel" onclick={cancelAi}>取消 AI，忽略结果</button>
                {/if}
                {#if aiError}
                    <p class="ft__smaller lvct-text-danger" role="alert">{aiError}</p>
                {/if}
            {/if}
        </div>

        {#if aiPreflightOpen && facade.viewPreferences.aiEnabled}
            <section class="lvct-capture__preflight" aria-label="AI 外发预检">
                <p><b>AI 调用前确认</b> · 尚未发送</p>
                <label class="lvct-form__item">
                    <span>正文范围与来源</span>
                    <select class="b3-select" bind:value={aiSourceKind} onchange={invalidatePreflight} disabled={aiRunning}>
                        <option value="document">当前文档（可编辑缩小）</option>
                        <option value="selection">我提供的选段</option>
                        <option value="paste">我粘贴的文本</option>
                    </select>
                </label>
                <label class="lvct-form__item">
                    <span>本次原文（修改后需重新生成预览）</span>
                    <textarea class="b3-text-field fn__block" rows="6" bind:value={aiSourceText} oninput={editAiSource} disabled={aiRunning}></textarea>
                </label>
                <label class="lvct-import__row"><input type="checkbox" bind:checked={aiRemoveContacts} onchange={invalidatePreflight} disabled={aiRunning} />去除可识别电话/邮箱（默认）</label>
                <fieldset class="lvct-capture__fields">
                    <legend>允许的候选字段</legend>
                    {#each AI_CANDIDATE_FIELDS as field}
                        <label><input type="checkbox" value={field} bind:group={aiFields} onchange={invalidatePreflight} disabled={aiRunning} />{field}</label>
                    {/each}
                </fieldset>
                <p class="ft__smaller">只发送下方最终全文，名册仅本地核对。去除策略不能保证识别自由文本中的微信号或秘密，请自行核对。原文/回复不写日志。</p>
                {#if aiPreflight}
                    <p class="ft__smaller">POST {aiPreflight.endpoint} · 下游地址/宿主附加上下文未验证（HOST pending）</p>
                    <p class="ft__smaller">来源 {aiPreflight.sourceDocId} · {aiPreflight.sourceKind} · 字段 {aiPreflight.fields.join("、")}</p>
                    <p class="ft__smaller">最终 {aiPreflight.characters} 字符 / {aiPreflight.bytes} UTF-8 字节；去除联系方式 {aiPreflight.removed.contacts} 项、元数据 {aiPreflight.removed.metadata} 项；截断 {aiPreflight.removed.truncated} 字符</p>
                    <label class="lvct-form__item"><span>最终实际发送文本（包含提示词）</span><textarea class="b3-text-field fn__block" rows="9" readonly value={aiPreflight.msg}></textarea></label>
                {/if}
                <div class="lvct-form__actions">
                    <button class="b3-button b3-button--cancel" onclick={() => { cancelAi(); aiPreflightOpen = false; }}>取消，不发送</button>
                    <button class="b3-button b3-button--outline" onclick={refreshPreflight} disabled={aiRunning || aiFields.length === 0}>重新生成发送预览</button>
                    <button class="b3-button" onclick={confirmAi} disabled={aiRunning || !aiPreflight || aiFields.length === 0}>确认发送本次文本</button>
                </div>
            </section>
        {/if}

        <label class="lvct-form__item">
            <span>{text("captureNewNamesLabel", "新人员名单（不在人脉库中，将按名新建；空格/逗号分隔）")}</span>
            <input class="b3-text-field fn__block" type="text" bind:value={newNamesText} placeholder={text("captureNewNamesPlaceholder", "王五 赵六")} />
        </label>

        {#if aiDone && aiCandidates.length > 0}
            <div class="lvct-form__item" aria-label="AI 结构化候选">
                <span><b>AI 草稿（每项初始未接受，编辑后需再次确认）</b></span>
                {#if aiRejected > 0}<p class="ft__smaller">已丢弃 {aiRejected} 个非法或超限候选。</p>{/if}
                {#each aiCandidates as candidate (candidate.id)}
                    <section class="lvct-capture__candidate" data-ai-kind={candidate.kind}>
                        <p><b>{candidate.personName || "场合"}</b> · {candidate.kind} / {candidate.field} · {candidate.decision}</p>
                        <p class="ft__smaller">来源 {candidate.evidence.sourceKind} · {candidate.evidence.sourceDocId} · 证据 {candidate.evidence.status} · 位置 {candidate.evidence.start ?? "未知"}</p>
                        <blockquote>{candidate.evidence.quote || "无可核实原文证据；需人工核对。"}</blockquote>
                        {#if candidate.conflict}<p class="ft__smaller lvct-text-danger">同人同字段存在不同建议，只能接受一项。</p>{/if}
                        {#if candidate.kind === "relation"}
                            <p class="ft__smaller">{candidate.personName} ↔ {candidate.personB}（{candidate.value}）· 仅展示草稿，不写关系或笔记</p>
                        {:else}
                            {#if candidate.kind === "followup"}
                                <label class="lvct-form__item"><span>跟进标题</span><input class="b3-text-field" bind:value={candidate.title} oninput={() => editCandidate(candidate)} /></label>
                                <label class="lvct-form__item"><span>跟进日期</span><input class="b3-text-field" type="date" bind:value={candidate.dueDate} oninput={() => editCandidate(candidate)} /></label>
                            {:else}
                                <label class="lvct-form__item"><span>建议值</span><input class="b3-text-field" bind:value={candidate.value} oninput={() => editCandidate(candidate)} /></label>
                            {/if}
                            {#if candidate.kind !== "occasion" && candidate.targets.length > 0}
                                <label class="lvct-form__item">
                                    <span>人物目标（docId / itemId）</span>
                                    <select class="b3-select" bind:value={candidate.selectedDocId} onchange={() => editCandidate(candidate)}>
                                        <option value="">待消歧，请选稳定 ID</option>
                                        {#each candidate.targets as target (target.docId)}
                                            <option value={target.docId}>{target.name} · {target.docId} · {target.itemId}</option>
                                        {/each}
                                    </select>
                                </label>
                            {:else if candidate.kind === "profile" || candidate.kind === "followup"}
                                <p class="ft__smaller">新人/未绑定目标草稿保留，主捕获完成后选择已建立人物 ID 才能写入。</p>
                            {/if}
                            <button class="b3-button b3-button--outline" onclick={() => decideCandidate(candidate, "accepted")} disabled={!aiCandidateCanAccept(candidate) || candidate.checked}>接受本项</button>
                        {/if}
                        <button class="b3-button b3-button--cancel" onclick={() => decideCandidate(candidate, "rejected")}>拒绝本项</button>
                    </section>
                {/each}
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
            <!-- D-35：读屏即时播报 + 焦点迁移 -->
            <div class="lvct-form__error" role="alert" tabindex="-1" bind:this={errorEl}>{errorText}</div>
        {/if}

        {#if running}
            <div class="lvct-capture__ai-progress" role="status" aria-live="polite" aria-busy="true">
                <span class="lvct-skeleton" aria-hidden="true"></span>
                {text("captureWritingProgress", "正在写入互动、日记、地点和参与人员双链…")}
            </div>
        {/if}

        <div class="lvct-form__actions">
            <button class="b3-button b3-button--cancel" onclick={() => (step = 1)} disabled={running}>{text("captureBackToIdentify", "返回识别")}</button>
            <button class="b3-button b3-button--text" onclick={submit} disabled={running || !hasTarget}>
                {running ? text("captureRecording", "记录中…") : text("captureRecordAndWrite", "记录互动并建立事项双链")}
            </button>
        </div>
        <p class="ft__smaller ft__on-surface lvct-form__hint">
            {text("captureSubmitHint", "将为每位参与者记录一条互动，并关联当日日记、地点文档、人物文档与本笔记；重复捕获不会重复写入。")}
        </p>
        <p class="ft__smaller ft__on-surface lvct-form__hint">
            {text("captureProjectionPolicy", "变更日期、地点或参与者时，历史互动不改；旧日记、旧地点和被移除人物中的插件投影保留，只更新本次目标。纠错请先预览，再删除错误互动并重新记录。")}
        </p>
        {:else}
        <div class="lvct-form__actions">
            <button class="b3-button b3-button--cancel" onclick={closeIfIdle}>{text("captureCancel", "取消")}</button>
            <button class="b3-button b3-button--text" onclick={() => (step = 2)} disabled={!hasTarget || aiRunning}>{text("captureNextConfirm", "下一步：确认记录")}</button>
        </div>
        {/if}
    {/if}
</div>

<style>
    .lvct-capture__preflight, .lvct-capture__candidate {
        padding: 12px;
        margin: 8px 0;
        border: 1px solid var(--lvct-border-subtle);
        border-radius: var(--lvct-r-sm);
        overflow-wrap: anywhere;
    }
    .lvct-capture__preflight {
        border-color: color-mix(in srgb, var(--lvct-highlight) 42%, var(--lvct-border-subtle));
        border-radius: var(--lvct-r-md);
        background: var(--lvct-highlight-soft);
    }
    .lvct-capture__candidate {
        background: var(--lvct-bg-elevated);
    }
    .lvct-capture__fields {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        border: 1px solid var(--lvct-border-subtle);
    }
    .lvct-capture__candidate blockquote {
        margin: 8px 0;
        padding-left: 8px;
        border-left: 2px solid var(--lvct-accent);
        color: var(--lvct-text-2);
    }
</style>
