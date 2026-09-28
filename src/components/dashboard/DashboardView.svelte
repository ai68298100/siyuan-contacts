<script lang="ts">
    /** 首页仪表盘：统计 + 近期生日（公/农历）+ 久未联系 */
    import type { ContactsPluginFacade } from "../../types";
    import { pickActions, pickSummaryCounts } from "../../services/dashboard";
    import type { DashboardData } from "../../services/dashboard";
    import type { ActionCard } from "../../domain/action-list";
    import { groupActionCards } from "../../domain/action-list";
    import type { ActionGroup } from "../../domain/action-list";
    import type { ReminderDismissal } from "../../domain/reminder-dismissals";
    import type { ContactSummary } from "../../domain/person";
    import type { ViewPreferences } from "../../domain/preferences";
    import { detectCheckinBridge } from "../../bridge/checkin";
    import ViewState from "../ViewState.svelte";
    import StatusNotice from "../StatusNotice.svelte";
    import LvctDialog from "../LvctDialog.svelte";
    import ReviewReportDialog from "./ReviewReportDialog.svelte";
    import { translateText } from "../../domain/translation";

    let {
        facade,
        i18n,
        preferences,
        revision = 0,
        onOpenDetail,
        onOpenPeople,
        onOpenGraph,
        onPreferencesChange,
    }: {
        facade: ContactsPluginFacade;
        i18n?: Readonly<Record<string, string>>;
        preferences: ViewPreferences;
        revision?: number;
        onOpenDetail: (person: ContactSummary) => void;
        onOpenPeople: (focus?: { itemIds: readonly string[]; label: string; sort?: "name" | "group" | "birthday" }) => void;
        onOpenGraph: () => void;
        /** 摘要忽略等偏好写入（F08）；未接线时「当日不再展示」退化为本次隐藏 */
        onPreferencesChange?: (preferences: ViewPreferences) => Promise<ViewPreferences>;
    } = $props();
    const text = $derived.by(() => (key: string, fallback: string, values?: Record<string, string | number>) =>
        translateText(i18n, key, fallback, values));

    let data: DashboardData | null = $state(null);
    let errorText: string = $state("");
    let bridge = $state(detectCheckinBridge());
    let quickPersonId = $state("");
    let quickNote = $state("");
    let quickBusy = $state(false);
    let quickDoneId = $state("");
    let quickError = $state("");
    let quickMessage = $state("");
    let refreshVersion = 0;
    // 待办跟进（F05）
    let fuSnoozeForId = $state("");
    let fuCustomDate = $state("");
    let fuBusy = $state(false);
    let fuError = $state("");
    let fuMessage = $state("");
    // FUNC-01.1：服务层返回全量，首屏只展开前 N 条；「查看全部」就地处达，不静默截断
    const BIRTHDAY_PREVIEW_LIMIT = 8;
    const STALE_PREVIEW_LIMIT = 8;
    const FOLLOW_UP_PREVIEW_LIMIT = 12;
    let showAllBirthdays = $state(false);
    let showAllStale = $state(false);
    let showAllFollowUps = $state(false);
    const previewList = <T>(all: readonly T[], expanded: boolean, limit: number): readonly T[] =>
        (expanded ? all : all.slice(0, limit));
    // B01：行动分组与折叠（会话内保持；「从未互动」默认折叠，组头计数即展开入口）
    // C02：neverOrder（收编日期映射）→ never 组按最近收编倒序
    const actionGroupsOf = (dashboardData: DashboardData | null): ActionGroup[] =>
        groupActionCards(pickActions(dashboardData), new Map(Object.entries(dashboardData?.neverOrder ?? {})));
    let groupOverrides = $state(new Set<string>());
    function isGroupCollapsed(group: ActionGroup): boolean {
        const overridden = groupOverrides.has(group.key);
        return group.defaultCollapsed ? !overridden : overridden;
    }
    function toggleGroup(group: ActionGroup): void {
        const next = new Set(groupOverrides);
        if (next.has(group.key)) next.delete(group.key);
        else next.add(group.key);
        groupOverrides = next;
    }

    // ---- B08 行内快捷处置（生日跳过本年 / 久未联系顺延与不再提醒 / 从未互动跳过今天） ----
    let rowMenuKey = $state("");
    function toggleRowMenu(key: string): void {
        rowMenuKey = rowMenuKey === key ? "" : key;
    }
    function isNeverCard(card: ActionCard): boolean {
        return card.reasons.some((reason) => reason.neverContacted);
    }
    async function dismissBirthday(person: ContactSummary): Promise<void> {
        const year = new Date().getFullYear();
        await facade.dismissReminder(person.docId, "birthday", `${year}-12-31`);
        alMessage = `已跳过「${person.name}」本年生日提醒，跨年自动恢复`;
        rowMenuKey = "";
        await refresh();
    }
    async function dismissStaleReminder(person: ContactSummary): Promise<void> {
        await facade.dismissReminder(person.docId, "stale", "");
        alMessage = `已不再提醒「${person.name}」，可在设置-提醒中恢复`;
        rowMenuKey = "";
        await refresh();
    }
    async function dismissNeverToday(person: ContactSummary): Promise<void> {
        await facade.dismissReminder(person.docId, "stale", toLocalToday());
        alMessage = `今天先跳过「${person.name}」的提醒`;
        rowMenuKey = "";
        await refresh();
    }
    async function snoozeStale(person: ContactSummary, days: number): Promise<void> {
        const info = data?.stale.find((item) => item.person.docId === person.docId);
        const lastDays = info?.lastDaysAgo ?? 0;
        const existing = await facade.getPersonCadence(person.docId);
        const target = Math.min(365, lastDays + days);
        await facade.savePersonCadence(person.docId, { days: target, paused: existing?.paused ?? false });
        alMessage = `「${person.name}」已顺延：${target} 天内不再提醒`;
        rowMenuKey = "";
        await refresh();
    }
    function toLocalToday(): string {
        const now = new Date();
        const pad = (value: number) => String(value).padStart(2, "0");
        return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    }
    // C02 批量安顿：「从未互动」组整体暂缓 30 天（dismissal），保留此前暂缓快照供一次性撤销
    let settleUndo: ReminderDismissal[] | null = $state(null);
    async function settleNeverGroup(): Promise<void> {
        const group = actionGroupsOf(data).find((item) => item.key === "never");
        if (!group || group.cards.length === 0 || alBusy) return;
        alBusy = true;
        alError = "";
        try {
            const snapshot = await facade.loadReminderDismissals();
            const until = addDaysToToday(30);
            for (const card of group.cards) {
                await facade.dismissReminder(card.person.docId, "stale", until);
            }
            settleUndo = snapshot;
            alMessage = `已把 ${group.cards.length} 位从未互动的提醒整体暂缓 30 天`;
            rowMenuKey = "";
            await refresh();
        } catch (error) {
            alError = error instanceof Error ? error.message : String(error);
        } finally {
            alBusy = false;
        }
    }
    async function undoSettle(): Promise<void> {
        if (!settleUndo || alBusy) return;
        alBusy = true;
        try {
            /* 一次性撤销：把批量暂缓前的暂缓快照原样写回（覆盖式恢复） */
            const current = await facade.loadReminderDismissals();
            for (const entry of current) {
                if (!settleUndo.some((item) => item.personDocId === entry.personDocId && item.kind === entry.kind)) {
                    await facade.resumeReminder(entry.personDocId, entry.kind);
                }
            }
            for (const entry of settleUndo) {
                await facade.dismissReminder(entry.personDocId, entry.kind, entry.until);
            }
            settleUndo = null;
            alMessage = "已撤销批量暂缓";
            await refresh();
        } catch (error) {
            alError = error instanceof Error ? error.message : String(error);
        } finally {
            alBusy = false;
        }
    }
    function addDaysToToday(days: number): string {
        const date = new Date();
        date.setDate(date.getDate() + days);
        const pad = (value: number) => String(value).padStart(2, "0");
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    }
    async function runRowAction(action: () => Promise<void>): Promise<void> {
        alBusy = true;
        alError = "";
        try {
            await action();
        } catch (error) {
            alError = error instanceof Error ? error.message : String(error);
        } finally {
            alBusy = false;
        }
    }

    const greetingKey = (() => {
        const hour = new Date().getHours();
        if (hour < 6) return "dashGreetingNight";
        if (hour < 12) return "dashGreetingMorning";
        if (hour < 18) return "dashGreetingAfternoon";
        return "dashGreetingEvening";
    })();
    const todayLabel = new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "short" }).format(new Date());
    const todayBirthdays = $derived.by(() => data?.birthdays.filter((item) => item.bucket === "today") ?? []);

    async function refresh() {
        const version = ++refreshVersion;
        errorText = "";
        try {
            const result = await facade.loadDashboard({
                birthdayWindowDays: preferences.birthdayWindowDays,
                staleThresholdDays: preferences.staleThresholdDays,
                reminderGraceDays: preferences.reminderGraceDays,
            });
            if (version === refreshVersion) data = result;
        } catch (error) {
            if (version === refreshVersion) errorText = error instanceof Error ? error.message : String(error);
        }
    }

    $effect(() => {
        revision;
        preferences.birthdayWindowDays;
        preferences.staleThresholdDays;
        void refresh();
    });

    function openBirthdayPeople() {
        if (!data) return;
        onOpenPeople({
            itemIds: data.birthdays.filter((item) => item.bucket === "today" || item.bucket === "week").map((item) => item.person.itemId),
            label: "本周生日",
            sort: "birthday",
        });
    }

    function openNeverContactedPeople() {
        if (!data) return;
        onOpenPeople({ itemIds: data.neverContactedItemIds, label: "从未互动" });
    }

    async function recordQuick(person: ContactSummary) {
        if (quickBusy) return;
        quickBusy = true;
        quickError = "";
        quickMessage = "";
        try {
            await facade.recordInteraction(person.docId, quickNote.trim() || undefined);
            quickDoneId = person.itemId;
            quickPersonId = "";
            quickNote = "";
            quickMessage = `已记录与「${person.name}」的互动`;
            await refresh();
        } catch (error) {
            quickError = error instanceof Error ? error.message : String(error);
        } finally {
            quickBusy = false;
        }
    }

    // ---- 待办跟进（F05） ----
    async function runFollowUp(action: () => Promise<void>, message: string) {
        if (fuBusy) return;
        fuBusy = true;
        fuError = "";
        fuMessage = "";
        try {
            await action();
            fuMessage = message;
            await refresh();
        } catch (error) {
            fuError = error instanceof Error ? error.message : String(error);
        } finally {
            fuBusy = false;
        }
    }
    const completeFollowUp = (id: string, title: string) => runFollowUp(() => facade.setFollowUpStatus(id, "done"), `已完成「${title}」`);
    const skipFollowUp = (id: string, title: string) => runFollowUp(() => facade.setFollowUpStatus(id, "cancelled"), `已跳过「${title}」，可在人物详情中重新打开`);
    const snoozeFollowUp = (id: string, option: "tomorrow" | "threeDays" | "nextMonday" | "nextMonth", label: string, title: string) =>
        runFollowUp(async () => {
            await facade.snoozeFollowUp(id, option);
            fuSnoozeForId = "";
        }, `已将「${title}」推迟到${label}`);
    const snoozeFollowUpCustom = (id: string, title: string) =>
        runFollowUp(async () => {
            await facade.snoozeFollowUp(id, "custom", fuCustomDate);
            fuSnoozeForId = "";
            fuCustomDate = "";
        }, `已将「${title}」推迟到指定日期`);

    // ---- 今日行动清单（F07） ----
    let alBusy = $state(false);
    let alError = $state("");
    let alMessage = $state("");
    const actions: ActionCard[] = $derived(pickActions(data));
    const overdueFollowUpIds: string[] = $derived(actions.flatMap((card: ActionCard) =>
        card.reasons
            .filter((reason) => reason.kind === "followup" && reason.bucket === "overdue" && reason.followUpId)
            .map((reason) => reason.followUpId as string)));
    const overdueCount: number = $derived(overdueFollowUpIds.length);

    async function postponeOverdueToToday() {
        if (alBusy || overdueCount === 0) return;
        alBusy = true;
        alError = "";
        alMessage = "";
        const pad = (value: number) => String(value).padStart(2, "0");
        const now = new Date();
        const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
        try {
            let done = 0;
            for (const id of overdueFollowUpIds) {
                try {
                    await facade.snoozeFollowUp(id, "custom", today);
                    done += 1;
                } catch (error) {
                    console.warn("顺延单条逾期跟进失败", error);
                }
            }
            alMessage = `已把 ${done} 条逾期跟进顺延到今天`;
            await refresh();
        } catch (error) {
            alError = error instanceof Error ? error.message : String(error);
        } finally {
            alBusy = false;
        }
    }

    // ---- 打开工作台时的关注摘要（F08） ----
    let reviewOpen = $state(false);
    let summaryHiddenThisSession = $state(false);
    let summaryBusy = $state(false);
    const localTodayKey = $derived.by(() => {
        const now = new Date();
        const pad = (value: number) => String(value).padStart(2, "0");
        return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    });
    const summaryVisible = $derived.by(() => {
        if (!preferences.summaryEnabled) return false;
        if (summaryHiddenThisSession) return false;
        if (preferences.summaryDismissedOn === localTodayKey) return false;
        if (!data) return false;
        // 空清单不出横幅
        return actions.length > 0;
    });
    const summary = $derived(pickSummaryCounts(data, actions));

    async function dismissSummaryToday() {
        if (summaryBusy) return;
        summaryBusy = true;
        try {
            await onPreferencesChange?.({ ...preferences, summaryDismissedOn: localTodayKey });
            summaryHiddenThisSession = true;
        } finally {
            summaryBusy = false;
        }
    }

    const bucketStyles: Record<string, string> = {
        today: "lvct-bucket--today",
        week: "lvct-bucket--week",
        month: "lvct-bucket--month",
        later: "lvct-bucket--later",
    };
</script>

<div class="lvct-dash">
    {#if errorText}
        <ViewState compact error title={text("dashLoadFailTitle", "仪表盘加载失败")} description={errorText}>
            <button class="b3-button b3-button--outline" onclick={refresh}>{text("dashReload", "重新加载")}</button>
        </ViewState>
    {/if}
    {#if !data && !errorText}
        <div class="lvct-dash__skeleton" aria-busy="true" aria-label={text("dashSkeletonLabel", "仪表盘加载中")}>
            {#each Array(4) as _, index (index)}<span class="lvct-skeleton"></span>{/each}
            <span class="lvct-skeleton lvct-dash__skeleton-block"></span>
            <span class="lvct-skeleton lvct-dash__skeleton-block"></span>
        </div>
    {:else if data}
        {#if summaryVisible}
            <div class="lvct-dash__summary" role="region" aria-label={text("dashSummaryLabel", "今日关注摘要")}>
                <div class="lvct-dash__summary-main">
                    <b>{text("dashSummaryTitle", "今天有 {n} 件值得处理的事", { n: summary.total })}</b>
                    <span class="lvct-dash__summary-chips">
                        {#if summary.overdue > 0}<span class="lvct-action-chip lvct-action-chip--overdue">{text("dashSummaryOverdue", "逾期跟进 {n}", { n: summary.overdue })}</span>{/if}
                        {#if summary.birthdaysToday > 0}<span class="lvct-action-chip lvct-action-chip--today">{text("dashSummaryBirthdays", "今天生日 {n}", { n: summary.birthdaysToday })}</span>{/if}
                        {#if summary.stale > 0}<span class="lvct-action-chip lvct-action-chip--stale">{text("dashSummaryStale", "久未联系 {n}", { n: summary.stale })}</span>{/if}
                    </span>
                </div>
                <div class="lvct-dash__summary-actions">
                    <button class="b3-button b3-button--text" onclick={() => (summaryHiddenThisSession = true)}>{text("dashCollapse", "收起")}</button>
                    <button class="b3-button b3-button--outline" disabled={summaryBusy} onclick={dismissSummaryToday}>{text("dashDismissToday", "今日不再展示")}</button>
                </div>
            </div>
        {/if}
        <div class="lvct-dash__welcome">
            <div>
                <p class="lvct-dash__greeting">{text(greetingKey, "早上好")}，{text("dashGreetingLine", "今天先联系谁？")}</p>
                <span class="ft__smaller ft__on-surface">{todayLabel}</span>
            </div>
            {#if todayBirthdays.length > 0}
                <button class="lvct-dash__birthday-banner" onclick={openBirthdayPeople} aria-label="查看今天过生日的联系人">
                    <span aria-hidden="true">🎂</span>
                    <span><b>{text("dashBannerToday", "今天生日")}</b> · {todayBirthdays.slice(0, 3).map((item) => item.person.name).join("、")}{todayBirthdays.length > 3 ? ` 等 ${todayBirthdays.length} 人` : ""}</span>
                    <span aria-hidden="true">›</span>
                </button>
            {/if}
        </div>
        <div class="lvct-dash__stats">
            <button class="lvct-dash__stat" onclick={() => onOpenPeople()}><b>{data.people}</b><span>{text("dashStatPeople", "联系人")}</span></button>
            <button class="lvct-dash__stat" onclick={onOpenGraph}><b>{data.relations}</b><span>{text("dashStatRelations", "关系")}</span></button>
            <button class="lvct-dash__stat" onclick={openBirthdayPeople}><b>{data.birthdaysThisWeek}</b><span>{text("dashStatBirthdaysWeek", "本周生日")}</span></button>
            <button class="lvct-dash__stat" onclick={openNeverContactedPeople}><b>{data.neverContacted}</b><span>{text("dashStatNever", "从未互动")}</span></button>
        </div>

        <div class="lvct-home__card lvct-dash__actions">
            <div class="lvct-dash__actions-head">
                <h3>{text("dashActionsTitle", "今日行动")}</h3>
                <span class="ft__smaller ft__on-surface">{text("dashActionsSub", "生日 · 联系节奏 · 跟进事项")}</span>
                <span style="flex:1"></span>
                <button class="b3-button b3-button--outline" onclick={() => (reviewOpen = true)}>{text("dashReview", "交往回顾")}</button>
                {#if overdueCount > 0}
                    <button class="b3-button b3-button--outline" onclick={postponeOverdueToToday} disabled={alBusy}>
                        {alBusy ? text("dashPostponing", "顺延中…") : text("dashPostponeOverdue", "把 {n} 条逾期跟进顺延到今天", { n: overdueCount })}
                    </button>
                {/if}
            </div>
            <StatusNotice message={alError ? text("dashOpFailed", "操作失败：{msg}", { msg: alError }) : ""} error />
            <StatusNotice message={alMessage} onDismiss={() => (alMessage = "")} />
            {#if actions.length === 0}
                <ViewState compact icon="✅" title={text("dashActionsEmptyTitle", "今天没有需要处理的事")} description={text("dashActionsEmptyDesc", "生日、联系节奏和跟进计划都安顿好了。")}>
                    <button class="b3-button b3-button--outline" onclick={() => onOpenPeople()}>{text("dashBrowsePeople", "浏览联系人")}</button>
                </ViewState>
            {:else}
                {#snippet actionRow(card: ActionCard)}
                    <div class="lvct-dash__rowwrap">
                        <div class="lvct-dash__row">
                            <button class="lvct-dash__row-main" onclick={() => onOpenDetail(card.person)}>
                                <b>{card.person.name}</b>
                                <span class="lvct-dash__reasons">
                                    {#each card.reasons as reason (reason.kind + (reason.followUpId ?? ""))}
                                        <span class="lvct-chip lvct-action-chip lvct-action-chip--{reason.bucket}">{reason.label}</span>
                                    {/each}
                                </span>
                            </button>
                            <button class="b3-button b3-button--outline lvct-dash__quick-button" onclick={() => onOpenDetail(card.person)}>
                                {card.bucket === "stale" ? text("dashTakeALook", "去看看") : text("dashProcess", "处理")}
                            </button>
                            {#if card.bucket === "stale"}
                                <button
                                    class="b3-button b3-button--outline lvct-dash__quick-button"
                                    aria-label={`更多处置：${card.person.name}`}
                                    aria-expanded={rowMenuKey === `action:${card.person.docId}`}
                                    onclick={() => toggleRowMenu(`action:${card.person.docId}`)}
                                >⋯</button>
                            {/if}
                        </div>
                        {#if rowMenuKey === `action:${card.person.docId}`}
                            <div class="lvct-dash__quick-form lvct-dash__rowmenu">
                                {#if isNeverCard(card)}
                                    <button class="b3-button b3-button--outline" disabled={alBusy} onclick={() => runRowAction(() => dismissNeverToday(card.person))}>今天先跳过</button>
                                {:else}
                                    <button class="b3-button b3-button--outline" disabled={alBusy} onclick={() => runRowAction(() => snoozeStale(card.person, 3))}>顺延 3 天</button>
                                    <button class="b3-button b3-button--outline" disabled={alBusy} onclick={() => runRowAction(() => snoozeStale(card.person, 7))}>顺延 1 周</button>
                                    <button class="b3-button b3-button--outline" disabled={alBusy} onclick={() => runRowAction(() => snoozeStale(card.person, 30))}>顺延 1 个月</button>
                                {/if}
                                <button class="b3-button b3-button--cancel" disabled={alBusy} onclick={() => runRowAction(() => dismissStaleReminder(card.person))}>不再提醒</button>
                            </div>
                        {/if}
                    </div>
                {/snippet}
                <!-- B01：按原因分组折叠；「从未互动」单独归组且默认折叠，组头计数即展开入口 -->
                <div class="lvct-dash__groups">
                    {#each actionGroupsOf(data) as group (group.key)}
                        <section class="lvct-dash__group">
                            <button
                                type="button"
                                class="lvct-dash__group-head"
                                aria-expanded={!isGroupCollapsed(group)}
                                onclick={() => toggleGroup(group)}
                            >
                                <span class="lvct-dash__group-caret" aria-hidden="true">{isGroupCollapsed(group) ? "▸" : "▾"}</span>
                                <b>{group.label}</b>
                                <span class="lvct-dash__group-count">{group.cards.length}</span>
                            </button>
                            {#if group.key === "never" && !isGroupCollapsed(group)}
                                <div class="lvct-dash__settle">
                                    <button class="b3-button b3-button--outline lvct-dash__quick-button" disabled={alBusy} onclick={settleNeverGroup}>
                                        全部顺延 30 天
                                    </button>
                                    {#if settleUndo}
                                        <button class="b3-button b3-button--text lvct-dash__quick-button" disabled={alBusy} onclick={undoSettle}>撤销</button>
                                    {/if}
                                </div>
                            {/if}
                            {#if !isGroupCollapsed(group)}
                                <div class="lvct-dash__list">
                                    {#each group.cards as card (card.person.docId)}
                                        {@render actionRow(card)}
                                    {/each}
                                </div>
                            {/if}
                        </section>
                    {/each}
                </div>
            {/if}
        </div>

        <div class="lvct-dash__grid">
            <div class="lvct-home__card">
                <h3>近期生日</h3>
                {#if data.birthdays.length === 0}
                    <ViewState compact icon="🎂" title="提醒窗口内没有生日" description="可以到联系人档案补充生日，或在设置中调整提醒天数。">
                        <button class="b3-button b3-button--outline" onclick={() => onOpenPeople()}>查看联系人</button>
                    </ViewState>
                {:else}
                    <div class="lvct-dash__list">
                        {#each previewList(data?.birthdays ?? [], showAllBirthdays, BIRTHDAY_PREVIEW_LIMIT) as item (item.person.itemId)}
                            <div
                                class="lvct-dash__row"
                                role="button"
                                tabindex="0"
                                onclick={() => onOpenDetail(item.person)}
                                onkeydown={(event) => {
                                    if (event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " ")) return;
                                    event.preventDefault();
                                    onOpenDetail(item.person);
                                }}
                            >
                                <b>{item.person.name}</b>
                                <span class="ft__smaller ft__on-surface">{item.projection.label}{item.person.isLunar ? "（农历）" : ""}</span>
                                <span class="lvct-bucket {bucketStyles[item.bucket]}">
                                    {item.projection.daysUntil === 0 ? text("dashFuToday", "今天") : text("dashDaysUntilN", "{n}天", { n: item.projection.daysUntil })}
                                </span>
                                <span style="flex:1"></span>
                                <button
                                    type="button"
                                    class="b3-button b3-button--text lvct-dash__quick-button"
                                    title={`跳过 ${item.person.name} 本年生日提醒`}
                                    onclick={(event) => { event.stopPropagation(); runRowAction(() => dismissBirthday(item.person)); }}
                                >跳过本年</button>
                            </div>
                        {/each}
                    </div>
                    {#if data.birthdays.length > BIRTHDAY_PREVIEW_LIMIT}
                        <button class="lvct-dash__show-all" onclick={() => (showAllBirthdays = !showAllBirthdays)}>
                            {showAllBirthdays ? text("dashShowLess", "收起") : text("dashShowAllN", "查看全部（共 {n} 条）", { n: data.birthdays.length })}
                        </button>
                    {/if}
                {/if}
            </div>

            <div class="lvct-home__card">
                <h3>{text("dashStaleTitle", "久未联系")}</h3>
                <StatusNotice message={quickError ? text("dashRecordFail", "记录失败：{msg}", { msg: quickError }) : ""} error />
                <StatusNotice message={quickMessage} onDismiss={() => (quickMessage = "")} />
                {#if data.stale.length === 0}
                    <ViewState compact icon="✓" title={data.people === 0 ? text("dashStaleEmptyNoPeopleTitle", "先添加一位联系人") : text("dashStaleEmptyTitle", "暂无久未联系的人")}
                        description={data.people === 0 ? text("dashStaleEmptyNoPeopleDesc", "创建或导入联系人后，就能开始记录互动。") : text("dashStaleEmptyDesc", "可以继续在联系人档案中记录新的互动。")}>
                        <button class="b3-button b3-button--outline" onclick={() => onOpenPeople()}>{text("dashGoContacts", "前往联系人")}</button>
                    </ViewState>
                {:else}
                    <div class="lvct-dash__list">
                        {#each previewList(data?.stale ?? [], showAllStale, STALE_PREVIEW_LIMIT) as item (item.person.itemId)}
                            <div class="lvct-dash__row">
                                <button class="lvct-dash__row-main" onclick={() => onOpenDetail(item.person)}>
                                    <b>{item.person.name}</b>
                                    <span class="ft__smaller ft__on-surface">
                                        {item.lastDaysAgo === undefined ? text("dashNeverContacted", "从未互动") : text("dashDaysAgo", "{n} 天前", { n: item.lastDaysAgo })}
                                    </span>
                                    <span class="lvct-bucket lvct-bucket--stale">{text("dashReachOut", "联系一下")}</span>
                                </button>
                                {#if quickPersonId === item.person.itemId}
                                    <div class="lvct-dash__quick-form">
                                        <input class="b3-text-field" type="text" aria-label={text("dashQuickNoteLabel", "与{name}互动的备注", { name: item.person.name })} placeholder={text("dashQuickNotePlaceholder", "备注（可选）")} bind:value={quickNote} disabled={quickBusy} />
                                        <button class="b3-button b3-button--text" onclick={() => recordQuick(item.person)} disabled={quickBusy}>{quickBusy ? text("dashRecording", "记录中…") : text("dashRecord", "记录")}</button>
                                        <button class="b3-button b3-button--cancel" onclick={() => { quickPersonId = ""; quickError = ""; }} disabled={quickBusy}>{text("dashCancel", "取消")}</button>
                                    </div>
                                {:else}
                                    <button class="b3-button b3-button--outline lvct-dash__quick-button" onclick={() => { quickPersonId = item.person.itemId; quickNote = ""; }} disabled={quickBusy || quickDoneId === item.person.itemId}>
                                        {quickDoneId === item.person.itemId ? text("dashRecordedDone", "已记录 ✓") : text("dashQuickRecord", "记一笔")}
                                    </button>
                                {/if}
                                <button
                                    class="b3-button b3-button--outline lvct-dash__quick-button"
                                    aria-label={`更多处置：${item.person.name}`}
                                    aria-expanded={rowMenuKey === `stale:${item.person.docId}`}
                                    onclick={(event) => { event.stopPropagation(); toggleRowMenu(`stale:${item.person.docId}`); }}
                                >⋯</button>
                            </div>
                            {#if rowMenuKey === `stale:${item.person.docId}`}
                                <div class="lvct-dash__quick-form lvct-dash__rowmenu">
                                    <button class="b3-button b3-button--outline" disabled={alBusy} onclick={() => runRowAction(() => snoozeStale(item.person, 3))}>顺延 3 天</button>
                                    <button class="b3-button b3-button--outline" disabled={alBusy} onclick={() => runRowAction(() => snoozeStale(item.person, 7))}>顺延 1 周</button>
                                    <button class="b3-button b3-button--outline" disabled={alBusy} onclick={() => runRowAction(() => snoozeStale(item.person, 30))}>顺延 1 个月</button>
                                    <button class="b3-button b3-button--cancel" disabled={alBusy} onclick={() => runRowAction(() => dismissStaleReminder(item.person))}>不再提醒</button>
                                </div>
                            {/if}
                        {/each}
                    </div>
                    {#if data.stale.length > STALE_PREVIEW_LIMIT}
                        <button class="lvct-dash__show-all" onclick={() => (showAllStale = !showAllStale)}>
                            {showAllStale ? text("dashShowLess", "收起") : text("dashShowAllN", "查看全部（共 {n} 条）", { n: data.stale.length })}
                        </button>
                    {/if}
                {/if}
            </div>

            <div class="lvct-home__card">
                <h3>{text("dashFollowupsTitle", "待办跟进")}</h3>
                <StatusNotice message={fuError ? text("dashOpFailed", "操作失败：{msg}", { msg: fuError }) : ""} error />
                <StatusNotice message={fuMessage} onDismiss={() => (fuMessage = "")} />
                {#if (data.followUps ?? []).length === 0}
                    <ViewState compact icon="🗓" title={text("dashFuEmptyTitle", "没有待办的跟进计划")}
                        description={text("dashFuEmptyDesc", "在联系人详情里可以安排日期型联系计划，到期会出现在这里。")}>
                        <button class="b3-button b3-button--outline" onclick={() => onOpenPeople()}>{text("dashGoContacts", "前往联系人")}</button>
                    </ViewState>
                {:else}
                    <div class="lvct-dash__list">
                        {#each previewList(data?.followUps ?? [], showAllFollowUps, FOLLOW_UP_PREVIEW_LIMIT) as card (card.item.id)}
                            <div class="lvct-dash__row">
                                <button class="lvct-dash__row-main" disabled={!card.reachable || fuBusy}
                                    title={card.reachable ? undefined : text("dashFuUnreachableTitle", "人物文档不可达（可能已解绑），仍可推迟或跳过")}
                                    onclick={() => card.person && onOpenDetail(card.person)}>
                                    <b>{card.item.title || text("dashKeepInTouch", "保持联系")}</b>
                                    <span class="ft__smaller ft__on-surface">{card.person?.name ?? text("dashFuUnreachable", "人物文档不可达")} · {card.item.dueDate}</span>
                                    <span class="lvct-bucket {card.bucket === "overdue" ? "lvct-bucket--stale" : card.bucket === "today" ? "lvct-bucket--today" : "lvct-bucket--week"}">
                                        {card.bucket === "overdue" ? text("dashFuOverdue", "已逾期") : card.bucket === "today" ? text("dashFuToday", "今天") : text("dashFuUpcoming", "近期")}
                                    </span>
                                </button>
                                {#if fuSnoozeForId === card.item.id}
                                    <div class="lvct-dash__quick-form">
                                        <button class="b3-button b3-button--outline" disabled={fuBusy} onclick={() => snoozeFollowUp(card.item.id, "tomorrow", text("dashSnoozeTomorrow", "明天"), card.item.title || text("dashKeepInTouch", "保持联系"))}>{text("dashSnoozeTomorrow", "明天")}</button>
                                        <button class="b3-button b3-button--outline" disabled={fuBusy} onclick={() => snoozeFollowUp(card.item.id, "threeDays", text("dashSnoozeThreeDays", "三天后"), card.item.title || text("dashKeepInTouch", "保持联系"))}>{text("dashSnoozeThreeDays", "三天后")}</button>
                                        <button class="b3-button b3-button--outline" disabled={fuBusy} onclick={() => snoozeFollowUp(card.item.id, "nextMonday", text("dashSnoozeNextMonday", "下周一"), card.item.title || text("dashKeepInTouch", "保持联系"))}>{text("dashSnoozeNextMonday", "下周一")}</button>
                                        <button class="b3-button b3-button--outline" disabled={fuBusy} onclick={() => snoozeFollowUp(card.item.id, "nextMonth", text("dashSnoozeNextMonth", "一个月后"), card.item.title || text("dashKeepInTouch", "保持联系"))}>{text("dashSnoozeNextMonth", "一个月后")}</button>
                                        <input type="date" class="b3-text-field" aria-label={text("dashSnoozeDateLabel", "指定推迟日期")} bind:value={fuCustomDate} disabled={fuBusy} />
                                        <button class="b3-button b3-button--text" disabled={fuBusy || !fuCustomDate} onclick={() => snoozeFollowUpCustom(card.item.id, card.item.title || text("dashKeepInTouch", "保持联系"))}>{text("dashSnoozeByDate", "按日期")}</button>
                                        <button class="b3-button b3-button--cancel" onclick={() => { fuSnoozeForId = ""; fuCustomDate = ""; }} disabled={fuBusy}>{text("dashCollapse", "收起")}</button>
                                    </div>
                                {:else}
                                    <div class="lvct-dash__fu-actions">
                                        {#if card.reachable}
                                            <button class="b3-button b3-button--text" disabled={fuBusy} onclick={() => card.person && onOpenDetail(card.person)}>{text("dashFuProcess", "处理")}</button>
                                        {/if}
                                        <button class="b3-button b3-button--outline" disabled={fuBusy} onclick={() => { fuSnoozeForId = fuSnoozeForId === card.item.id ? "" : card.item.id; fuCustomDate = ""; }} aria-expanded={fuSnoozeForId === card.item.id}>{text("dashFuPostpone", "推迟")}</button>
                                        <button class="b3-button b3-button--outline" disabled={fuBusy} onclick={() => completeFollowUp(card.item.id, card.item.title || text("dashKeepInTouch", "保持联系"))}>{text("dashFuComplete", "完成")}</button>
                                        <button class="b3-button b3-button--cancel" disabled={fuBusy} onclick={() => skipFollowUp(card.item.id, card.item.title || text("dashKeepInTouch", "保持联系"))}>{text("dashFuSkip", "跳过")}</button>
                                    </div>
                                {/if}
                            </div>
                        {/each}
                    </div>
                    {#if (data.followUps ?? []).length > FOLLOW_UP_PREVIEW_LIMIT}
                        <button class="lvct-dash__show-all" onclick={() => (showAllFollowUps = !showAllFollowUps)}>
                            {showAllFollowUps ? text("dashShowLess", "收起") : text("dashShowAllN", "查看全部（共 {n} 条）", { n: (data.followUps ?? []).length })}
                        </button>
                    {/if}
                    <p class="ft__smaller ft__on-surface">{text("dashFuScopeNote", "完成或跳过不会自动记录互动；计划在人物详情里可重新打开。")}</p>
                {/if}
            </div>
        </div>

        <div class="lvct-dash__grid">
            <div class="lvct-home__card">
                <h3>{text("dashWorkspaceTitle", "工作空间")}</h3>
                <div class="lvct-home__row"><span class="ft__on-surface">{text("dashNotebookLabel", "笔记本")}</span><b>{facade.settings?.notebookName ?? "—"}</b></div>
                <div class="lvct-home__actions">
                    <button class="b3-button b3-button--outline" onclick={() => facade.openHostDoc()}>{text("dashOpenHostDoc", "打开联系人总表")}</button>
                </div>
            </div>

            <div class="lvct-home__card">
                <h3>{text("dashBridgeTitle", "小驴打卡联动")}</h3>
                {#if bridge.state === "ready"}
                    <div class="lvct-home__row"><span class="ft__on-surface">{text("dashBridgeStateLabel", "状态")}</span><b>已连接（协议 v{bridge.protocol}）</b></div>
                {:else if bridge.state === "pending"}
                    <div class="lvct-home__row"><span class="ft__on-surface">{text("dashBridgeStateLabel", "状态")}</span><b>检测到旧版打卡（协议 v{bridge.protocol ?? "?"}）</b></div>
                {:else if bridge.state === "failed"}
                    <div class="lvct-home__row"><span class="ft__on-surface">{text("dashBridgeStateLabel", "状态")}</span><b>探测异常</b></div>
                {:else}
                    <div class="lvct-home__row"><span class="ft__on-surface">{text("dashBridgeStateLabel", "状态")}</span><b>未检测到小驴打卡</b></div>
                    <p class="ft__smaller ft__on-surface">安装小驴打卡后，生日可同步为打卡事项提醒。</p>
                {/if}
            </div>
        </div>
    {/if}
</div>

{#if reviewOpen}
    <LvctDialog title="交往回顾报表" wide onClose={() => (reviewOpen = false)}>
        <ReviewReportDialog i18n={facade.i18n} buildReport={(range) => facade.buildReviewReport(range.from, range.to)} />
    </LvctDialog>
{/if}
