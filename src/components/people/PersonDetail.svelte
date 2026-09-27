<script lang="ts">
    /** 人物详情 Peek：档案字段、互动与关系列表（增删，内核自动维护双向回链） */
    import { listContacts, removeContact } from "../../services/contacts";
    import { addRelation, removeRelation, refreshPerson } from "../../services/relations";
import LvctDialog from "../LvctDialog.svelte";
import PersonEditDialog from "./PersonEditDialog.svelte";
import ViewState from "../ViewState.svelte";
import StatusNotice from "../StatusNotice.svelte";
    import type { ContactSummary } from "../../domain/person";
    import type { ContactsSettings } from "../../domain/model";
    import { nextBirthday } from "../../domain/occasions";
    import { createCloseScope, useCloseGuard } from "../close-guard";
    import { translateText } from "../../domain/translation";
    import { dueLabel } from "../../domain/followups";
    import type { FollowUpItem, SnoozeOption } from "../../domain/followups";
    import type { PersonCadence } from "../../domain/cadence";
    import { renderTemplate } from "../../domain/interaction-templates";
    import type { NoteTemplate } from "../../domain/interaction-templates";
    import TemplateManager from "./TemplateManager.svelte";
    import { buildBriefingMarkdown } from "../../domain/briefing-export";
    import { addReviewDays, groupByMonth, inDateRange, onThisDay } from "../../domain/date-review";
    import { toLocalDateKey } from "../../domain/interactions";

    let {
        settings,
        i18n,
        person,
        onRecord,
        onDeleteInteraction,
        onLoadInsights,
        onOpenPersonDoc,
        onNavigate,
        navigationOrder,
        onChanged,
        onDeleted,
        onClose,
        onListFollowUps,
        onCreateFollowUp,
        onSetFollowUpStatus,
        onSnoozeFollowUp,
        onGetCadence,
        onSaveCadence,
        onListTemplates,
        onSaveTemplates,
    }: {
        settings: ContactsSettings;
        i18n?: Readonly<Record<string, string>>;
        person: ContactSummary;
        /** 记一笔互动（facade.recordInteraction） */
        onRecord: (personDocId: string, note?: string) => Promise<void>;
        onDeleteInteraction?: (personDocId: string, eventId: string) => Promise<void>;
        /** 人物洞察（时间线+共同出席） */
        onLoadInsights: (docId: string) => Promise<import("../../services/insights").PersonInsights>;
        onOpenPersonDoc: (docId: string) => void;
        onNavigate: (person: ContactSummary) => void;
        navigationOrder?: readonly ContactSummary[];
        onChanged: () => void;
        onDeleted: () => void;
        onClose: () => void;
        /** 跟进计划（F05，可选：未接线时隐藏该区） */
        onListFollowUps?: (personDocId: string) => Promise<FollowUpItem[]>;
        onCreateFollowUp?: (personDocId: string, title: string, dueDate: string) => Promise<FollowUpItem>;
        onSetFollowUpStatus?: (id: string, status: "open" | "done" | "cancelled") => Promise<void>;
        onSnoozeFollowUp?: (id: string, option: SnoozeOption, customDate?: string) => Promise<void>;
        /** 联系节奏（F06，可选：未接线时隐藏该区） */
        onGetCadence?: (personDocId: string) => Promise<PersonCadence | null>;
        onSaveCadence?: (personDocId: string, cadence: PersonCadence | null) => Promise<void>;
        /** 互动备注模板（F09，可选：未接线时隐藏选用入口） */
        onListTemplates?: () => Promise<NoteTemplate[]>;
        onSaveTemplates?: (templates: NoteTemplate[]) => Promise<NoteTemplate[]>;
    } = $props();
    const text = $derived.by(() => (key: string, fallback: string, values?: Record<string, string | number>) =>
        translateText(i18n, key, fallback, values));

    // 有意取打开弹窗时的快照；后续更新走 refreshPerson 回查
    // svelte-ignore state_referenced_locally
    let current: ContactSummary = $state(person);
    let others: ContactSummary[] = $state([]);
    let addChoice: string = $state("");
    let busy: boolean = $state(false);
    let errorText: string = $state("");
    let noteText: string = $state("");
    const canLeave = createCloseScope();
    const guardedClose = useCloseGuard(() => busy || deleting, () => noteText.trim().length > 0);
    function navigate(person: ContactSummary | null) {
        if (person) onNavigate(person);
    }
    let recorded: boolean = $state(false);
    let insights: import("../../services/insights").PersonInsights | null = $state(null);
    let insightsLoading = $state(true);
    let insightsError = $state("");
    let othersLoading = $state(true);
    let othersError = $state("");
    let relationSelect: HTMLSelectElement | undefined = $state();
    let insightsRequest = 0;
    let editing = $state(false);
    let deleting = $state(false);
    let activeTab: "overview" | "activity" | "relations" = $state("overview");
    const tabIds = ["overview", "activity", "relations"] as const;
    function handleTabKeydown(event: KeyboardEvent) {
        if (event.key !== "ArrowRight" && event.key !== "ArrowLeft" && event.key !== "Home" && event.key !== "End") return;
        event.preventDefault();
        const index = tabIds.indexOf(activeTab);
        const next = event.key === "Home" ? 0 : event.key === "End" ? 2 : (index + (event.key === "ArrowRight" ? 1 : 2)) % 3;
        activeTab = tabIds[next];
        (event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('[role="tab"]')[next]?.focus();
    }
    let activitySearch = $state("");
    let activitySource = $state("");
    let activityLimit = $state(20);
    // 日期回顾（F10）
    let activityFrom = $state("");
    let activityTo = $state("");
    const sourceLabels = { manual: "手动记录", diary: "笔记捕获", api: "外部联动" };
    const filteredTimeline = $derived.by(() => {
        const query = activitySearch.trim().toLowerCase();
        return (insights?.timeline ?? [])
            .filter((item) => inDateRange(item.localDate, activityFrom, activityTo))
            .filter((item) => (!activitySource || item.source === activitySource) &&
                (!query || `${item.localDate} ${item.note ?? ""}`.toLowerCase().includes(query)));
    });
    const pagedTimeline = $derived(filteredTimeline.slice(0, activityLimit));
    const monthGroups = $derived(groupByMonth(pagedTimeline));
    const historyToday = $derived.by(() => {
        const timeline = insights?.timeline ?? [];
        return onThisDay(timeline, toLocalDateKey(new Date()));
    });

    function setQuickRange(days: number) {
        const today = toLocalDateKey(new Date());
        activityFrom = addReviewDays(today, -(days - 1));
        activityTo = today;
        activityLimit = 20;
    }

    function clearDateRange() {
        activityFrom = "";
        activityTo = "";
        activityLimit = 20;
    }

    async function deleteTimelineItem(eventId: string) {
        if (busy || !onDeleteInteraction) return;
        if (!window.confirm(`删除「${current.name}」的这条互动吗？只删除本人的记录，其他参与者与人物文档会保留。`)) return;
        busy = true;
        errorText = "";
        try {
            await onDeleteInteraction(current.docId, eventId);
            recorded = false;
            onChanged();
            await loadInsights();
        } catch (error) {
            errorText = error instanceof Error ? error.message : String(error);
        } finally { busy = false; }
    }

    async function loadInsights() {
        const request = ++insightsRequest;
        insightsLoading = true;
        insightsError = "";
        try {
            const result = await onLoadInsights(current.docId);
            if (request === insightsRequest) insights = result;
        } catch (error) {
            if (request === insightsRequest) insightsError = error instanceof Error ? error.message : String(error);
        } finally {
            if (request === insightsRequest) insightsLoading = false;
        }
    }

    loadInsights();

    // ---- 互动备注模板（F09） ----
    const templatesSupported = $derived(Boolean(onListTemplates && onSaveTemplates));
    let templates: NoteTemplate[] = $state([]);
    let templateChoice = $state("");
    let templateManagerOpen = $state(false);

    async function loadTemplates() {
        if (!onListTemplates) return;
        try {
            templates = await onListTemplates();
        } catch {
            // 模板为辅助功能，加载失败静默隐藏选项
            templates = [];
        }
    }
    loadTemplates();

    function applyTemplate() {
        if (!templateChoice) return;
        const template = templates.find((item) => item.id === templateChoice);
        if (!template) return;
        if (noteText.trim() && !window.confirm("应用模板将覆盖当前备注，继续吗？")) {
            templateChoice = "";
            return;
        }
        noteText = renderTemplate(template.content, {
            name: current.name,
            date: toLocalDateKey(new Date()),
            lastInteraction: insights?.timeline?.[0]?.localDate ?? "无",
        });
        recorded = false;
        templateChoice = "";
    }

    async function persistTemplates(list: NoteTemplate[]): Promise<NoteTemplate[]> {
        const saved = await onSaveTemplates!(list);
        templates = saved;
        return saved;
    }

    const relatedPeople = $derived(
        current.relatedItemIds
            .map((itemId) => others.find((item) => item.itemId === itemId))
            .filter((item): item is ContactSummary => Boolean(item)),
    );
    const candidates = $derived(
        others.filter((item) => item.itemId !== current.itemId && !current.relatedItemIds.includes(item.itemId)),
    );
    const orderedPeople = $derived(navigationOrder ?? others);
    const currentIndex = $derived(orderedPeople.findIndex((item) => item.itemId === current.itemId));
    const previousPerson = $derived(currentIndex > 0 ? orderedPeople[currentIndex - 1] : null);
    const nextPerson = $derived(currentIndex >= 0 && currentIndex < orderedPeople.length - 1 ? orderedPeople[currentIndex + 1] : null);
    const birthday = $derived(nextBirthday(current.birthday, current.isLunar));

    async function loadOthers() {
        othersLoading = true;
        othersError = "";
        try {
            const people = await listContacts(settings);
            others = people;
            const fresh = people.find((item) => item.itemId === current.itemId);
            if (fresh) current = fresh;
        } catch (error) {
            othersError = error instanceof Error ? error.message : String(error);
        } finally {
            othersLoading = false;
        }
    }

    loadOthers();

    async function mutate(action: () => Promise<void>) {
        if (busy) return;
        busy = true;
        errorText = "";
        try {
            await action();
            onChanged();
            const fresh = await refreshPerson(settings, current);
            if (fresh) current = fresh;
        } catch (error) {
            errorText = error instanceof Error ? error.message : String(error);
        } finally {
            busy = false;
        }
    }

    async function refreshAfterEdit() {
        await loadOthers();
        await loadInsights();
        onChanged();
    }

    // ---- 会面简报导出（F11） ----
    let briefingExportOpen = $state(false);
    let briefingLimit = $state(10);
    let briefingGeneratedAt = $state("");
    function openBriefingExport() {
        const now = new Date();
        const pad = (value: number) => String(value).padStart(2, "0");
        briefingGeneratedAt = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
        briefingExportOpen = true;
    }
    const briefingPreview = $derived.by(() => {
        if (!briefingExportOpen) return "";
        return buildBriefingMarkdown({
            person: current,
            timeline: insights?.timeline ?? [],
            followUps: openFollowUps.map((item) => ({ title: item.title, dueDate: item.dueDate })),
            relatedNames: relatedPeople.map((item) => item.name),
            coAttendance: insights?.coAttendance ?? [],
            limit: briefingLimit,
            generatedAt: briefingGeneratedAt,
        });
    });
    function downloadBriefing() {
        const blob = new Blob([briefingPreview], { type: "text/markdown;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        const stamp = new Date().toISOString().slice(0, 10);
        anchor.download = `小驴人脉_简报_${current.name}_${stamp}.md`;
        anchor.click();
        URL.revokeObjectURL(url);
    }

    async function confirmDelete() {
        if (deleting || busy) return;
        if (!window.confirm(`确定从人脉名册移除「${current.name}」吗？人物文档会保留。`)) return;
        deleting = true;
        errorText = "";
        try {
            await removeContact(settings, current);
            onDeleted();
        } catch (error) {
            errorText = error instanceof Error ? error.message : String(error);
        } finally {
            deleting = false;
        }
    }

    // ---- 跟进计划（F05） ----
    const followUpSupported = $derived(Boolean(onListFollowUps && onCreateFollowUp && onSetFollowUpStatus && onSnoozeFollowUp));
    let followUps: FollowUpItem[] = $state([]);
    let followUpsLoading = $state(true);
    let followUpTitle = $state("");
    let followUpDate = $state(toLocalDateKey(new Date()));
    let followUpBusy = $state(false);
    let followUpRecorded = $state(false);
    let followUpError = $state("");
    let snoozeForId = $state("");
    let snoozeCustomDate = $state("");
    const todayKey = $derived(toLocalDateKey(new Date()));
    const openFollowUps = $derived(followUps.filter((item) => item.status === "open"));
    const closedFollowUps = $derived(followUps.filter((item) => item.status !== "open"));

    async function loadFollowUps() {
        if (!onListFollowUps) return;
        followUpsLoading = true;
        try {
            followUps = await onListFollowUps(current.docId);
        } catch (error) {
            followUpError = error instanceof Error ? error.message : String(error);
        } finally {
            followUpsLoading = false;
        }
    }

    loadFollowUps();

    async function createFollowUp() {
        if (followUpBusy || !onCreateFollowUp) return;
        followUpBusy = true;
        followUpError = "";
        try {
            await onCreateFollowUp(current.docId, followUpTitle.trim(), followUpDate);
            followUpTitle = "";
            followUpRecorded = true;
            onChanged();
            followUps = await onListFollowUps?.(current.docId) ?? followUps;
        } catch (error) {
            followUpError = error instanceof Error ? error.message : String(error);
        } finally {
            followUpBusy = false;
        }
    }

    async function completeFollowUp(item: FollowUpItem) {
        if (followUpBusy || !onSetFollowUpStatus) return;
        followUpBusy = true;
        followUpError = "";
        try {
            await onSetFollowUpStatus(item.id, "done");
            followUps = await onListFollowUps?.(current.docId) ?? followUps;
            onChanged();
        } catch (error) {
            followUpError = error instanceof Error ? error.message : String(error);
        } finally {
            followUpBusy = false;
        }
    }

    async function cancelFollowUp(item: FollowUpItem) {
        if (followUpBusy || !onSetFollowUpStatus) return;
        if (!window.confirm(`取消跟进「${item.title || text("fuKeepInTouch", "保持联系")}」？取消后不再出现在待办中。`)) return;
        followUpBusy = true;
        followUpError = "";
        try {
            await onSetFollowUpStatus(item.id, "cancelled");
            followUps = await onListFollowUps?.(current.docId) ?? followUps;
            onChanged();
        } catch (error) {
            followUpError = error instanceof Error ? error.message : String(error);
        } finally {
            followUpBusy = false;
        }
    }

    async function snooze(item: FollowUpItem, option: SnoozeOption) {
        if (followUpBusy || !onSnoozeFollowUp) return;
        if (option === "custom" && !snoozeCustomDate) return;
        followUpBusy = true;
        followUpError = "";
        try {
            await onSnoozeFollowUp(item.id, option, option === "custom" ? snoozeCustomDate : undefined);
            snoozeForId = "";
            snoozeCustomDate = "";
            followUps = await onListFollowUps?.(current.docId) ?? followUps;
            onChanged();
        } catch (error) {
            followUpError = error instanceof Error ? error.message : String(error);
        } finally {
            followUpBusy = false;
        }
    }

    // ---- 联系节奏（F06） ----
    const cadenceSupported = $derived(Boolean(onGetCadence && onSaveCadence));
    let cadenceLoaded = $state(false);
    let cadenceMode: "global" | "custom" | "paused" = $state("global");
    let cadenceDays = $state(14);
    let cadenceSaving = $state(false);
    let cadenceMessage = $state("");
    let cadenceError = $state("");
    const lastContactLabel = $derived.by(() => {
        const first = insights?.timeline?.[0];
        return first?.localDate ?? "";
    });

    async function loadCadence() {
        if (!onGetCadence) return;
        try {
            const cadence = await onGetCadence(current.docId);
            cadenceMode = cadence?.paused ? "paused" : cadence ? "custom" : "global";
            if (cadence) cadenceDays = cadence.days;
            cadenceLoaded = true;
        } catch (error) {
            cadenceError = error instanceof Error ? error.message : String(error);
        }
    }
    loadCadence();

    async function saveCadence() {
        if (cadenceSaving || !onSaveCadence) return;
        cadenceSaving = true;
        cadenceError = "";
        cadenceMessage = "";
        try {
            const days = Math.max(1, Math.min(365, Math.round(cadenceDays || 14)));
            const next: PersonCadence | null = cadenceMode === "global" ? null : { days, paused: cadenceMode === "paused" };
            await onSaveCadence(current.docId, next);
            cadenceMessage = cadenceMode === "global"
                ? "已清除覆盖，跟随全局阈值"
                : cadenceMode === "paused"
                    ? "已暂停对该人的联系提醒"
                    : `已设为每 ${days} 天联系一次`;
            onChanged();
        } catch (error) {
            cadenceError = error instanceof Error ? error.message : String(error);
        } finally {
            cadenceSaving = false;
        }
    }
</script>

<div class="lvct-detail">
    <div class="lvct-detail__header">
        <div class="lvct-person-card__avatar" data-avatar>{current.name.slice(0, 1)}</div>
        <div>
            <h3>{current.name}</h3>
            <div class="ft__smaller ft__on-surface">
                {#if current.group}{current.group}{/if}
                {#if current.birthday} · 生日 {current.birthday}{current.isLunar ? "（农历）" : ""}{/if}
            </div>
        </div>
        <div class="lvct-detail__header-actions">
            <button class="b3-button b3-button--outline" onclick={() => (editing = true)} disabled={busy || deleting}>{text("detailEdit", "编辑")}</button>
            <button class="b3-button b3-button--outline" onclick={() => navigate(previousPerson)} disabled={!previousPerson || busy}>{text("detailPrevious", "上一位")}</button>
            <button class="b3-button b3-button--outline" onclick={() => navigate(nextPerson)} disabled={!nextPerson || busy}>{text("detailNext", "下一位")}</button>
        </div>
    </div>

    <div class="lvct-detail__tabs" role="tablist" tabindex="-1" aria-label="人物详情内容" onkeydown={handleTabKeydown}>
        <button type="button" role="tab" aria-selected={activeTab === "overview"} tabindex={activeTab === "overview" ? 0 : -1} class:lvct-detail__tab--active={activeTab === "overview"} onclick={() => (activeTab = "overview")}>{text("detailOverview", "概览")}</button>
        <button type="button" role="tab" aria-selected={activeTab === "activity"} tabindex={activeTab === "activity" ? 0 : -1} class:lvct-detail__tab--active={activeTab === "activity"} onclick={() => (activeTab = "activity")}>{text("detailActivity", "互动")}</button>
        <button type="button" role="tab" aria-selected={activeTab === "relations"} tabindex={activeTab === "relations" ? 0 : -1} class:lvct-detail__tab--active={activeTab === "relations"} onclick={() => (activeTab = "relations")}>{text("detailRelations", "相关人")}</button>
    </div>

    {#if activeTab === "overview"}
    {#if !current.phone && !current.email && !current.wechat && !current.website && current.tags.length === 0}
        <ViewState compact title="联系资料还未填写" description="补充电话、邮箱或标签，方便下次查找。">
            <button class="b3-button b3-button--outline" onclick={() => (editing = true)}>编辑资料</button>
        </ViewState>
    {/if}
    <dl class="lvct-detail__fields">
        {#if current.phone}<div><dt>电话</dt><dd><a href={`tel:${current.phone}`}>{current.phone}</a></dd></div>{/if}
        {#if current.email}<div><dt>邮箱</dt><dd><a href={`mailto:${current.email}`}>{current.email}</a></dd></div>{/if}
        {#if current.wechat}<div><dt>微信</dt><dd>{current.wechat}</dd></div>{/if}
        {#if current.website}<div><dt>网站</dt><dd>{current.website}</dd></div>{/if}
        {#if current.tags.length > 0}<div><dt>标签</dt><dd>{current.tags.join(" · ")}</dd></div>{/if}
        {#if birthday}<div><dt>下次生日</dt><dd>{birthday.date.toLocaleDateString("zh-CN")} · {birthday.daysUntil === 0 ? "今天" : `${birthday.daysUntil} 天后`}</dd></div>{/if}
    </dl>

    <div class="lvct-detail__briefing-row">
        <button class="b3-button b3-button--outline" onclick={openBriefingExport}>导出会面简报</button>
        <span class="ft__smaller ft__on-surface">Markdown：资料 · 最近互动 · 未完成跟进 · 重要日期 · 相关人物 · 共同出席</span>
    </div>

    <section class="lvct-detail__section">
        <h4>{text("detailRecordTitle", "记一笔互动")}</h4>
        {#if templatesSupported}
            <div class="lvct-detail__record fn__flex lvct-detail__template-row">
                <select class="b3-select fn__flex-1" aria-label="选用备注模板" bind:value={templateChoice} onchange={applyTemplate} disabled={busy || templates.length === 0}>
                    <option value="">{templates.length === 0 ? text("tplEmptyHint", "暂无模板，点「管理模板」创建") : text("tplPick", "选用模板…")}</option>
                    {#each templates as template (template.id)}<option value={template.id}>{template.name}</option>{/each}
                </select>
                <button class="b3-button b3-button--outline" onclick={() => (templateManagerOpen = true)} disabled={busy}>{text("tplManage", "管理模板")}</button>
            </div>
        {/if}
        <div class="lvct-detail__record fn__flex">
            <input
                class="b3-text-field fn__flex-1"
                type="text"
                placeholder={text("detailRecordPlaceholder", "做了什么、聊了什么（可留空）")}
                bind:value={noteText}
                oninput={() => (recorded = false)}
                disabled={busy}
            />
            <button
                class="b3-button b3-button--text"
                disabled={busy}
                onclick={() =>
                    mutate(async () => {
                        await onRecord(current.docId, noteText.trim() || undefined);
                        recorded = true;
                        noteText = "";
                        await loadInsights();
                    })}
            >{recorded ? text("detailRecorded", "已记录 ✓") : text("detailRecord", "记录")}</button>
        </div>
        <p class="ft__smaller ft__on-surface">记录后，首页"久未联系"会重新计时。</p>
    </section>

    {#if followUpSupported}
    <section class="lvct-detail__section">
        <h4>{text("fuSectionTitle", "跟进计划")}</h4>
        {#if followUpError}<div class="lvct-form__error" role="alert">{followUpError}</div>{/if}
        {#if followUpsLoading}
            <ViewState compact loading title={text("fuLoading", "正在加载跟进计划")} />
        {:else}
            {#if openFollowUps.length === 0}
                <p class="ft__smaller ft__on-surface">{text("fuEmpty", "没有进行中的跟进计划。安排一个日期，到时来联系 TA。")}</p>
            {:else}
                <div class="lvct-detail__timeline">
                    {#each openFollowUps as item (item.id)}
                        <div class="lvct-detail__timeline-row">
                            <span class="ft__on-surface">{item.dueDate}</span>
                            <span class="lvct-detail__timeline-note">{item.title || text("fuKeepInTouch", "保持联系")}</span>
                            <span class="lvct-chip {item.dueDate < todayKey ? "lvct-bucket--stale" : ""}">{dueLabel(item.dueDate, todayKey)}</span>
                        </div>
                        {#if snoozeForId === item.id}
                            <div class="lvct-detail__snooze">
                                <button type="button" class="b3-button b3-button--outline" disabled={followUpBusy} onclick={() => snooze(item, "tomorrow")}>{text("fuSnoozeTomorrow", "明天")}</button>
                                <button type="button" class="b3-button b3-button--outline" disabled={followUpBusy} onclick={() => snooze(item, "threeDays")}>{text("fuSnoozeThreeDays", "三天后")}</button>
                                <button type="button" class="b3-button b3-button--outline" disabled={followUpBusy} onclick={() => snooze(item, "nextMonday")}>{text("fuSnoozeNextMonday", "下周一")}</button>
                                <button type="button" class="b3-button b3-button--outline" disabled={followUpBusy} onclick={() => snooze(item, "nextMonth")}>{text("fuSnoozeNextMonth", "一个月后")}</button>
                                <span class="lvct-detail__snooze-custom">
                                    <input type="date" class="b3-text-field" aria-label={text("fuSnoozeDateLabel", "指定日期")} bind:value={snoozeCustomDate} />
                                    <button type="button" class="b3-button b3-button--text" disabled={followUpBusy || !snoozeCustomDate} onclick={() => snooze(item, "custom")}>{text("fuSnoozeByDate", "按指定日期推迟")}</button>
                                </span>
                            </div>
                        {/if}
                        <div class="lvct-detail__followup-actions">
                            <button type="button" class="b3-button b3-button--outline" disabled={followUpBusy} onclick={() => { snoozeForId = snoozeForId === item.id ? "" : item.id; snoozeCustomDate = ""; }} aria-expanded={snoozeForId === item.id}>{text("fuPostpone", "推迟")}</button>
                            <button type="button" class="b3-button b3-button--text" disabled={followUpBusy} onclick={() => completeFollowUp(item)}>{text("fuComplete", "完成")}</button>
                            <button type="button" class="b3-button b3-button--cancel" disabled={followUpBusy} onclick={() => cancelFollowUp(item)}>{text("fuCancelPlan", "取消计划")}</button>
                        </div>
                    {/each}
                </div>
            {/if}
            {#if closedFollowUps.length > 0}
                <p class="ft__smaller ft__on-surface">{text("fuRecentlyClosed", "最近关闭：")}{closedFollowUps.slice(0, 3).map((item) => `${item.title || text("fuKeepInTouch", "保持联系")}（${item.status === "done" ? "已完成" : "已取消"}）`).join("、")}</p>
            {/if}
            <div class="lvct-detail__record fn__flex">
                <input
                    class="b3-text-field fn__flex-1"
                    type="text"
                    placeholder={text("fuTitlePlaceholder", "这次想联系什么？（可选，如：问问面试结果）")}
                    bind:value={followUpTitle}
                    disabled={followUpBusy}
                />
                <input type="date" class="b3-text-field" aria-label={text("fuDateLabel", "计划日期")} bind:value={followUpDate} disabled={followUpBusy} />
                <button class="b3-button b3-button--text" disabled={followUpBusy} onclick={createFollowUp}>
                    {followUpBusy ? text("fuAdding", "添加中…") : followUpRecorded ? text("fuAddAnother", "再加一条") : text("fuAddPlan", "添加计划")}
                </button>
            </div>
            <p class="ft__smaller ft__on-surface">到期的计划会出现在首页待办；完成计划不会自动记为互动。</p>
        {/if}
    </section>
    {/if}

    {#if cadenceSupported}
    <section class="lvct-detail__section">
        <h4>{text("cadenceSectionTitle", "联系节奏")}</h4>
        {#if cadenceError}<div class="lvct-form__error" role="alert">{cadenceError}</div>{/if}
        {#if !cadenceLoaded}
            <ViewState compact loading title={text("cadenceLoading", "正在读取联系节奏")} />
        {:else}
            <p class="ft__smaller ft__on-surface">
                {text("cadenceLastLabel", "上次互动：")}{lastContactLabel || text("cadenceNoInteraction", "还没有互动记录")} · {text("cadenceCurrentLabel", "当前：")}
                {cadenceMode === "paused" ? text("cadencePausedDesc", "已暂停提醒") : cadenceMode === "custom" ? text("cadenceCustomDesc", "自定义 {n} 天", { n: cadenceDays }) : text("cadenceGlobalDesc", "跟随全局阈值")}
            </p>
            <div class="lvct-detail__record fn__flex">
                <select class="b3-select fn__flex-1" aria-label={text("cadenceModeLabel", "联系节奏模式")} bind:value={cadenceMode} disabled={cadenceSaving}>
                    <option value="global">{text("cadenceOptionGlobal", "跟随全局阈值")}</option>
                    <option value="custom">{text("cadenceOptionCustom", "自定义天数")}</option>
                    <option value="paused">{text("cadenceOptionPaused", "暂停提醒")}</option>
                </select>
                {#if cadenceMode === "custom"}
                    <input type="number" class="b3-text-field" min="1" max="365" aria-label="自定义天数" bind:value={cadenceDays} disabled={cadenceSaving} />
                {/if}
                <button class="b3-button b3-button--text" onclick={saveCadence} disabled={cadenceSaving}>
                    {cadenceSaving ? text("cadenceSaving", "保存中…") : text("cadenceSave", "保存节奏")}
                </button>
            </div>
            <StatusNotice message={cadenceMessage} onDismiss={() => (cadenceMessage = "")} />
            <p class="ft__smaller ft__on-surface">{text("cadenceNote", "仅影响首页「久未联系」提醒，不写入联系人的数据库字段。")}</p>
        {/if}
    </section>
    {/if}
    {:else if activeTab === "activity"}

    <section class="lvct-detail__section">
        <h4>互动与共同出席{insights ? `（共 ${insights.totalEvents} 条）` : ""}</h4>
        {#if historyToday.length > 0}
            <div class="lvct-detail__history" role="region" aria-label="历史上的今天">
                <b>🗓 历史上的今天</b>
                {#each historyToday as item (item.eventId)}
                    <div class="lvct-detail__timeline-row">
                        <span class="ft__on-surface">{item.localDate}</span>
                        <span class="lvct-detail__timeline-note">{item.note || "互动"}</span>
                    </div>
                {/each}
            </div>
        {/if}
        <div class="lvct-detail__activity-filters">
            <input class="b3-text-field" type="search" aria-label="搜索互动备注或日期" placeholder="搜索备注或日期" bind:value={activitySearch} oninput={() => (activityLimit = 20)} />
            <select class="b3-select" aria-label="互动来源" bind:value={activitySource} onchange={() => (activityLimit = 20)}>
                <option value="">全部来源</option>
                <option value="manual">手动记录</option>
                <option value="diary">笔记捕获</option>
                <option value="api">外部联动</option>
            </select>
        </div>
        <div class="lvct-detail__activity-filters" aria-label="日期范围">
            <input type="date" class="b3-text-field" aria-label="互动开始日期" bind:value={activityFrom} onchange={() => (activityLimit = 20)} />
            <span class="ft__on-surface">~</span>
            <input type="date" class="b3-text-field" aria-label="互动结束日期" bind:value={activityTo} onchange={() => (activityLimit = 20)} />
            <button type="button" class="b3-button b3-button--outline" onclick={() => setQuickRange(30)}>最近 30 天</button>
            <button type="button" class="b3-button b3-button--outline" onclick={() => setQuickRange(90)}>最近 90 天</button>
            {#if activityFrom || activityTo}
                <button type="button" class="b3-button b3-button--text" onclick={clearDateRange}>清除日期</button>
            {/if}
        </div>
        {#if insights && insights.coAttendance.length > 0}
            <div class="lvct-strip__chips" style="margin-bottom: 6px;">
                {#each insights.coAttendance.slice(0, 5) as item (item.otherDocId)}
                    <span class="lvct-chip lvct-chip--group">与 {item.name} 同场 {item.count} 次</span>
                {/each}
            </div>
        {/if}
        {#if insightsLoading}
            <ViewState compact loading title="正在加载互动记录" />
        {:else if insightsError}
            <ViewState compact error title="互动记录加载失败" description={insightsError}>
                <button class="b3-button b3-button--outline" onclick={loadInsights}>重试</button>
            </ViewState>
        {:else if filteredTimeline.length > 0}
            <div class="lvct-detail__timeline">
                {#each monthGroups as group (group.month)}
                    <div class="lvct-detail__month-head">{group.label}（{group.items.length}）</div>
                    {#each group.items as item (item.eventId)}
                        <div class="lvct-detail__timeline-row">
                            <span class="ft__on-surface">{item.localDate}</span>
                            <span class="lvct-detail__timeline-note">{item.note || "互动"}</span>
                            <span class="lvct-detail__timeline-source">{sourceLabels[item.source]}</span>
                            {#if item.groupSize > 1}<span class="lvct-chip">{item.groupSize} 人同场</span>{/if}
                            {#if onDeleteInteraction}
                                <button class="b3-button b3-button--text" title="删除这条互动" aria-label={`删除 ${item.localDate} 的互动`} disabled={busy} onclick={() => deleteTimelineItem(item.eventId)}>删除</button>
                            {/if}
                        </div>
                    {/each}
                {/each}
            </div>
            <div class="lvct-detail__activity-more">
                <span class="ft__smaller ft__on-surface">显示 {Math.min(activityLimit, filteredTimeline.length)} / {filteredTimeline.length} 条</span>
                {#if activityLimit < filteredTimeline.length}
                    <button class="b3-button b3-button--outline" onclick={() => (activityLimit += 20)}>加载更多</button>
                {/if}
            </div>
        {:else if insights && insights.timeline.length > 0}
            <ViewState compact title="没有匹配的互动">
                <button class="b3-button b3-button--outline" onclick={() => { activitySearch = ""; activitySource = ""; activityFrom = ""; activityTo = ""; activityLimit = 20; }}>清除筛选</button>
            </ViewState>
        {:else}
            <ViewState compact title="还没有互动记录" description="从一次聊天或见面开始，记录你们的往来。">
                <button class="b3-button b3-button--text" onclick={() => (activeTab = "overview")}>去记一笔</button>
            </ViewState>
        {/if}
    </section>
    {:else}

    <section class="lvct-detail__section">
        <h4>相关人（{relatedPeople.length}）</h4>
        {#if othersLoading}
            <ViewState compact loading title="正在加载相关人" />
        {:else if othersError}
            <ViewState compact error title="相关人加载失败" description={othersError}>
                <button class="b3-button b3-button--outline" onclick={loadOthers}>重试</button>
            </ViewState>
        {:else if relatedPeople.length === 0}
            <ViewState compact title="还没有建立关系"
                description={candidates.length > 0 ? "选择一位联系人，建立你们之间的关系。" : "先在联系人页添加其他人物，再回来建立关系。"}>
                {#if candidates.length > 0}
                    <button class="b3-button b3-button--outline" onclick={() => relationSelect?.focus()}>选择联系人</button>
                {:else}
                    <button class="b3-button b3-button--outline" onclick={onClose}>返回工作台</button>
                {/if}
            </ViewState>
        {:else}
            <div class="lvct-detail__relations">
                {#each relatedPeople as other (other.itemId)}
                    <span class="lvct-detail__relation">
                        <button class="lvct-detail__relation-name" onclick={() => { onOpenPersonDoc(other.docId); }}>{other.name}</button>
                        <button
                            class="lvct-detail__relation-remove"
                            title="解除关系"
                            disabled={busy}
                            onclick={() => mutate(() => removeRelation(settings, current, other))}
                        >×</button>
                    </span>
                {/each}
            </div>
        {/if}

        <div class="lvct-detail__add fn__flex">
            <select class="b3-select fn__flex-1" bind:this={relationSelect} aria-label="选择要添加关系的联系人" bind:value={addChoice} disabled={busy || othersLoading || !!othersError || candidates.length === 0}>
                <option value="" disabled>{candidates.length === 0 ? "没有可添加的联系人" : "选择联系人…"}</option>
                {#each candidates as candidate (candidate.itemId)}
                    <option value={candidate.itemId}>{candidate.name}</option>
                {/each}
            </select>
            <button
                class="b3-button b3-button--text"
                disabled={busy || !addChoice}
                onclick={() => {
                    const other = others.find((item) => item.itemId === addChoice);
                    if (other) mutate(() => addRelation(settings, current, other));
                    addChoice = "";
                }}
            >添加关系</button>
        </div>
        <p class="ft__smaller ft__on-surface">关系为双向：添加后对方的「被相关人」列会自动出现你。</p>
    </section>
    {/if}

    {#if errorText}
        <div class="lvct-form__error">{errorText}</div>
    {/if}

    <div class="lvct-form__actions">
        <button class="b3-button b3-button--cancel" onclick={() => { if (canLeave()) guardedClose(onClose); }} disabled={busy || deleting}>{text("closeDialog", "关闭")}</button>
        <button class="b3-button b3-button--text" onclick={() => onOpenPersonDoc(current.docId)}>{text("detailOpenDoc", "打开文档")}</button>
        <button class="b3-button b3-button--cancel lvct-detail__delete" onclick={confirmDelete} disabled={busy || deleting}>{deleting ? text("detailRemoving", "移除中…") : text("detailRemove", "从人脉移除")}</button>
    </div>
</div>

{#if editing}
    <LvctDialog title={`编辑资料 · ${current.name}`} onClose={() => (editing = false)}>
        <PersonEditDialog
            {settings}
            person={current}
            onSaved={refreshAfterEdit}
            onClose={() => (editing = false)}
        />
    </LvctDialog>
{/if}

{#if templateManagerOpen}
    <LvctDialog title={text("tplManagerTitle", "管理互动备注模板")} onClose={() => (templateManagerOpen = false)}>
        <TemplateManager templates={templates} onSave={persistTemplates} onClose={() => (templateManagerOpen = false)} />
    </LvctDialog>
{/if}

{#if briefingExportOpen}
    <LvctDialog title={`导出会面简报 · ${current.name}`} wide onClose={() => (briefingExportOpen = false)}>
        <div class="lvct-form">
            <label class="lvct-form__item">
                <span>互动条数范围</span>
                <select class="b3-select fn__block" aria-label="互动条数范围" bind:value={briefingLimit}>
                    <option value={5}>最近 5 条</option>
                    <option value={10}>最近 10 条</option>
                    <option value={20}>最近 20 条</option>
                    <option value={0}>全部互动</option>
                </select>
            </label>
            <pre class="lvct-briefing-preview">{briefingPreview}</pre>
            <div class="lvct-form__actions">
                <button class="b3-button b3-button--cancel" onclick={() => (briefingExportOpen = false)}>关闭</button>
                <button class="b3-button b3-button--text" onclick={downloadBriefing}>下载 .md</button>
            </div>
            <p class="ft__smaller ft__on-surface">预览与下载内容一致；仅含本地记录的事实，交往次数不代表关系亲疏。</p>
        </div>
    </LvctDialog>
{/if}
