<script lang="ts">
    /** 首页仪表盘：统计 + 近期生日（公/农历）+ 久未联系 */
    import type { ContactsPluginFacade } from "../../types";
    import { Users, Share2, Cake, UserX } from "@lucide/svelte";
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
    import PersonProfileSummary from "../people/PersonProfileSummary.svelte";
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

    /** FUNC-01.12：readFailures 模块键 → 展示名 */
    const MODULE_LABELS: Record<string, readonly [string, string]> = {
        interactions: ["storeModuleInteractions", "互动记录"],
        followUps: ["storeModuleFollowUps", "跟进计划"],
        cadences: ["storeModuleCadences", "联系节奏"],
        dismissals: ["storeModuleDismissals", "提醒暂缓"],
        registry: ["storeModuleRegistry", "收编时间"],
        self: ["selfSectionTitle", "本人档案"],
    };
    function moduleLabel(key: string): string {
        const entry = MODULE_LABELS[key];
        return entry ? text(entry[0], entry[1]) : key;
    }

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
    // C06：会话内撤销——只保留最近一次操作的反向闭包，跨刷新/重启不保留
    let undoAction: { run: () => Promise<void> } | null = $state(null);
    function setUndo(message: string, run: () => Promise<void>): void {
        alMessage = message;
        undoAction = { run };
    }
    async function runUndo(): Promise<void> {
        const action = undoAction;
        if (!action || alBusy) return;
        alBusy = true;
        alError = "";
        try {
            await action.run();
            undoAction = null;
            alMessage = "已撤销";
            await refresh();
        } catch (error) {
            alError = error instanceof Error ? error.message : String(error);
        } finally {
            alBusy = false;
        }
    }
    function toggleRowMenu(key: string): void {
        rowMenuKey = rowMenuKey === key ? "" : key;
    }
    function isNeverCard(card: ActionCard): boolean {
        return card.reasons.some((reason) => reason.neverContacted);
    }
    async function dismissBirthday(person: ContactSummary): Promise<void> {
        const year = new Date().getFullYear();
        const until = `${year}-12-31`;
        /* C06：覆盖已有暂缓前先快照，撤销时精确恢复 */
        const previous = (await facade.loadReminderDismissals())
            .find((entry) => entry.personDocId === person.docId && entry.kind === "birthday");
        await facade.dismissReminder(person.docId, "birthday", until);
        setUndo(
            `已跳过「${person.name}」本年生日提醒，跨年自动恢复`,
            previous
                ? () => facade.dismissReminder(person.docId, "birthday", previous.until)
                : () => facade.resumeReminder(person.docId, "birthday"),
        );
        rowMenuKey = "";
        await refresh();
    }
    async function dismissStaleReminder(person: ContactSummary): Promise<void> {
        const previous = (await facade.loadReminderDismissals())
            .find((entry) => entry.personDocId === person.docId && entry.kind === "stale");
        await facade.dismissReminder(person.docId, "stale", "");
        setUndo(
            `已不再提醒「${person.name}」，可在设置-提醒中恢复`,
            previous
                ? () => facade.dismissReminder(person.docId, "stale", previous.until)
                : () => facade.resumeReminder(person.docId, "stale"),
        );
        rowMenuKey = "";
        await refresh();
    }
    async function dismissNeverToday(person: ContactSummary): Promise<void> {
        const previous = (await facade.loadReminderDismissals())
            .find((entry) => entry.personDocId === person.docId && entry.kind === "stale");
        await facade.dismissReminder(person.docId, "stale", toLocalToday());
        setUndo(
            `今天先跳过「${person.name}」的提醒`,
            previous
                ? () => facade.dismissReminder(person.docId, "stale", previous.until)
                : () => facade.resumeReminder(person.docId, "stale"),
        );
        rowMenuKey = "";
        await refresh();
    }
    async function snoozeStale(person: ContactSummary, days: number): Promise<void> {
        const info = data?.stale.find((item) => item.person.docId === person.docId);
        const lastDays = info?.lastDaysAgo ?? 0;
        const existing = await facade.getPersonCadence(person.docId);
        const target = Math.min(365, lastDays + days);
        await facade.savePersonCadence(person.docId, { days: target, paused: existing?.paused ?? false });
        setUndo(
            `「${person.name}」已顺延：${target} 天内不再提醒`,
            () => facade.savePersonCadence(person.docId, existing),
        );
        rowMenuKey = "";
        await refresh();
    }
    async function createFollowUpFor(person: ContactSummary): Promise<void> {
        const due = addDaysToToday(7);
        await facade.createFollowUp(person.docId, "联系一下", due);
        /* C07：默认标题「联系一下」+7 天（D-0020）；不自动为生日/久未联系批量生成 */
        alMessage = `已为「${person.name}」建跟进「联系一下」，到期 ${due}`;
        undoAction = null;
        rowMenuKey = "";
        await refresh();
    }
    function toLocalToday(): string {
        const now = new Date();
        const pad = (value: number) => String(value).padStart(2, "0");
        return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    }
    // C02 批量安顿：「从未互动」组整体暂缓 30 天；撤销只携带本批前值并做冲突核对。
    type SettleUndoEntry = { personDocId: string; kind: "stale"; previous?: ReminderDismissal };
    type SettleUndo = { until: string; entries: SettleUndoEntry[] };
    type SettleRetry = { until: string; cards: ActionCard[]; entries: SettleUndoEntry[] };
    let settleUndo: SettleUndo | null = $state(null);
    let settleRetry: SettleRetry | null = $state(null);

    async function settleCards(
        cards: readonly ActionCard[],
        until: string,
        preserved: readonly SettleUndoEntry[] = [],
        previousOverrides: readonly SettleUndoEntry[] = [],
    ): Promise<void> {
        if (cards.length === 0) return;
        if (preserved.length === 0) settleUndo = null;
        settleRetry = null;
        const snapshot = await facade.loadReminderDismissals();
        const previousByKey = new Map<string, ReminderDismissal>(
            snapshot
                .filter((entry) => entry.kind === "stale")
                .map((entry) => [`${entry.personDocId}|${entry.kind}`, entry] as const),
        );
        const retryConflicts: string[] = [];
        const blockedRetryKeys = new Set<string>();
        for (const entry of previousOverrides) {
            const key = `${entry.personDocId}|${entry.kind}`;
            const actual = previousByKey.get(key);
            const expected = entry.previous;
            const matches = expected
                ? actual?.until === expected.until
                : !actual;
            if (!matches) {
                blockedRetryKeys.add(key);
                retryConflicts.push(entry.personDocId);
                continue;
            }
            if (expected) previousByKey.set(key, expected);
            else previousByKey.delete(key);
        }
        const completed: SettleUndoEntry[] = [...preserved];
        const failed: ActionCard[] = [];
        const failedEntries: SettleUndoEntry[] = [];
        const errors: string[] = [];
        for (const card of cards) {
            if (blockedRetryKeys.has(`${card.person.docId}|stale`)) continue;
            try {
                await facade.dismissReminder(card.person.docId, "stale", until);
                completed.push({
                    personDocId: card.person.docId,
                    kind: "stale",
                    ...(previousByKey.get(`${card.person.docId}|stale`) ? { previous: previousByKey.get(`${card.person.docId}|stale`) } : {}),
                });
            } catch (error) {
                failed.push(card);
                const previous = previousByKey.get(`${card.person.docId}|stale`);
                failedEntries.push({
                    personDocId: card.person.docId,
                    kind: "stale",
                    ...(previous ? { previous } : {}),
                });
                errors.push(`${card.person.name}：${error instanceof Error ? error.message : String(error)}`);
            }
        }
        if (completed.length > 0) settleUndo = { until, entries: completed };
        if (failed.length > 0) settleRetry = { until, cards: failed, entries: failedEntries };
        if (failed.length === 0 && retryConflicts.length === 0) {
            alMessage = `已把 ${completed.length} 位从未互动的提醒整体暂缓 30 天`;
            alError = "";
        } else {
            const conflictMessage = retryConflicts.length > 0 ? `另有 ${retryConflicts.length} 位在重试前已被修改，已保留现状` : "";
            alMessage = failed.length > 0
                ? `已完成 ${completed.length} 位，${failed.length} 位失败；可重试失败项`
                : `批量暂缓已完成，${conflictMessage}`;
            alError = [...errors, ...retryConflicts.map((docId) => `${docId}：重试前已被其他窗口修改`)].join("；");
        }
    }

    async function settleNeverGroup(): Promise<void> {
        const group = actionGroupsOf(data).find((item) => item.key === "never");
        if (!group || group.cards.length === 0 || alBusy) return;
        alBusy = true;
        alError = "";
        try {
            await settleCards(group.cards, addDaysToToday(30));
            rowMenuKey = "";
            await refresh();
        } catch (error) {
            alError = error instanceof Error ? error.message : String(error);
        } finally {
            alBusy = false;
        }
    }

    async function retrySettle(): Promise<void> {
        const retry = settleRetry;
        if (!retry || alBusy) return;
        const preserved = settleUndo?.entries ?? [];
        alBusy = true;
        alError = "";
        try {
            await settleCards(retry.cards, retry.until, preserved, retry.entries);
            await refresh();
        } catch (error) {
            alError = error instanceof Error ? error.message : String(error);
        } finally {
            alBusy = false;
        }
    }

    async function undoSettle(): Promise<void> {
        if (!settleUndo || alBusy) return;
        const batch = settleUndo;
        alBusy = true;
        alError = "";
        try {
            const current = await facade.loadReminderDismissals();
            const currentByKey = new Map<string, ReminderDismissal>(current.map((entry) => [`${entry.personDocId}|${entry.kind}`, entry]));
            let conflicts = 0;
            let restored = 0;
            for (const entry of batch.entries) {
                const key = `${entry.personDocId}|${entry.kind}`;
                const currentEntry = currentByKey.get(key);
                // 只有本批写入仍在当前位置时才恢复，避免覆盖另一窗口的修改或新增。
                if (!currentEntry || currentEntry.until !== batch.until) {
                    conflicts += 1;
                    continue;
                }
                if (entry.previous) await facade.dismissReminder(entry.personDocId, entry.kind, entry.previous.until);
                else await facade.resumeReminder(entry.personDocId, entry.kind);
                restored += 1;
            }
            settleUndo = null;
            alMessage = conflicts > 0
                ? `已撤销 ${restored} 位；${conflicts} 位已被其他窗口修改，保留现状`
                : `已撤销批量暂缓（${restored} 位）`;
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
        preferences.reminderGraceDays;
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
    const completeFollowUp = (id: string, title: string) => runFollowUp(async () => {
        /* C06：完成可撤销（待办列表只列 open，恢复即重新打开） */
        await facade.setFollowUpStatus(id, "done");
        setUndo(`已完成「${title}」`, () => facade.setFollowUpStatus(id, "open"));
    }, `已完成「${title}」`);
    const skipFollowUp = (id: string, title: string) => runFollowUp(async () => {
        await facade.setFollowUpStatus(id, "cancelled");
        setUndo(`已跳过「${title}」，可在人物详情中重新打开`, () => facade.setFollowUpStatus(id, "open"));
    }, `已跳过「${title}」，可在人物详情中重新打开`);
    const snoozeFollowUp = (id: string, option: "tomorrow" | "threeDays" | "nextMonday" | "nextMonth", label: string, title: string, previousDueDate: string) =>
        runFollowUp(async () => {
            await facade.snoozeFollowUp(id, option);
            /* C06：推迟可撤销（恢复原到期日） */
            setUndo(`已将「${title}」推迟到${label}`, () => facade.snoozeFollowUp(id, "custom", previousDueDate));
            fuSnoozeForId = "";
        }, `已将「${title}」推迟到${label}`);
    const snoozeFollowUpCustom = (id: string, title: string) => runFollowUp(async () => {
        /* 推迟前的到期日快照必须在动作前取（此后 refresh 会覆盖 data） */
        const previousDue = (data?.followUps ?? []).find((entry) => entry.item.id === id)?.item.dueDate ?? toLocalToday();
        await facade.snoozeFollowUp(id, "custom", fuCustomDate);
        setUndo(`已将「${title}」推迟到指定日期`, () => facade.snoozeFollowUp(id, "custom", previousDue));
        fuSnoozeForId = "";
        fuCustomDate = "";
    }, `已将「${title}」推迟到指定日期`);

    // ---- 今日行动清单（F07） ----
    let alBusy = $state(false);
    let alError = $state("");
    let alMessage = $state("");
    type OverdueRetry = { ids: string[]; today: string; titles: string[] };
    let overdueRetry = $state<OverdueRetry | null>(null);
    const actions: ActionCard[] = $derived(pickActions(data));
    const overdueFollowUpIds: string[] = $derived(actions.flatMap((card: ActionCard) =>
        card.reasons
            .filter((reason) => reason.kind === "followup" && reason.bucket === "overdue" && reason.followUpId)
            .map((reason) => reason.followUpId as string)));
    const overdueCount: number = $derived(overdueFollowUpIds.length);

    function overdueTitle(id: string): string {
        return actions
            .flatMap((card) => card.reasons)
            .find((reason) => reason.kind === "followup" && reason.followUpId === id)
            ?.label ?? id;
    }

    async function postponeOverdue(ids: readonly string[], today: string): Promise<void> {
        let done = 0;
        const failed: Array<{ id: string; title: string; error: string }> = [];
        for (const id of ids) {
            try {
                await facade.snoozeFollowUp(id, "custom", today);
                done += 1;
            } catch (error) {
                const title = overdueTitle(id);
                failed.push({ id, title, error: error instanceof Error ? error.message : String(error) });
            }
        }
        if (failed.length > 0) {
            overdueRetry = { ids: failed.map((item) => item.id), today, titles: failed.map((item) => item.title) };
            alMessage = `已顺延 ${done} 条，${failed.length} 条失败；可重试失败项`;
            alError = failed.map((item) => `${item.title}：${item.error}`).join("；");
        } else {
            overdueRetry = null;
            alMessage = `已把 ${done} 条逾期跟进顺延到今天`;
            alError = "";
        }
    }

    async function postponeOverdueToToday() {
        if (alBusy || overdueCount === 0) return;
        alBusy = true;
        alError = "";
        alMessage = "";
        const pad = (value: number) => String(value).padStart(2, "0");
        const now = new Date();
        const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
        try {
            await postponeOverdue(overdueFollowUpIds, today);
            await refresh();
        } catch (error) {
            alError = error instanceof Error ? error.message : String(error);
        } finally {
            alBusy = false;
        }
    }

    async function retryOverdue() {
        const retry = overdueRetry;
        if (!retry || alBusy) return;
        alBusy = true;
        alError = "";
        try {
            await postponeOverdue(retry.ids, retry.today);
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
    let summaryError = $state("");
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
        summaryError = "";
        try {
            await onPreferencesChange?.({ ...preferences, summaryDismissedOn: localTodayKey });
            summaryHiddenThisSession = true;
        } catch (error) {
            summaryError = error instanceof Error ? error.message : String(error);
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
    {#if data?.readFailures?.length}
        <StatusNotice
            error
            message={text("dashReadFailure", "部分数据读取失败，以下模块可能显示不完整：{modules}", { modules: data.readFailures.map((key) => moduleLabel(key)).join("、") })}
            actionLabel={text("dashReload", "重新加载")}
            onAction={refresh}
        />
    {/if}
    {#if data?.ordinaryScopeUnknown}
        <StatusNotice error message={text("dashSelfUnknown", "本人身份尚未核实，普通联系人统计与提醒暂停。请在设置中核实身份后重新加载。")} />
    {:else if data?.excludedSelfDocId}
        <StatusNotice message={text("dashSelfExcluded", "统计、生日和待联系提醒已排除本人；本人档案及跟进记录仍保留在联系人详情。")} />
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
                <StatusNotice error message={summaryError ? `今日隐藏保存失败：${summaryError}，请重试。` : ""} />
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
            <button class="lvct-dash__stat" onclick={() => onOpenPeople()}>
                <span class="lvct-dash__stat-ic" aria-hidden="true"><Users size={14} /></span>
                <b>{data.ordinaryScopeUnknown ? "—" : data.people}</b>
                <span>{text("dashStatPeople", "联系人")}</span>
                {#if data.relations > 0}<span class="lvct-dash__stat-ft">{text("dashStatPeopleFt", "其中 {n} 人从未互动", { n: data.neverContacted })}</span>{/if}
            </button>
            <button class="lvct-dash__stat" onclick={onOpenGraph}>
                <span class="lvct-dash__stat-ic" aria-hidden="true"><Share2 size={14} /></span>
                <b>{data.ordinaryScopeUnknown ? "—" : data.relations}</b>
                <span>{text("dashStatRelations", "关系")}</span>
                {#if data.people > 0}<span class="lvct-dash__stat-ft">{text("dashStatRelationsFt", "人均 {n} 条", { n: (data.relations / data.people).toFixed(1) })}</span>{/if}
            </button>
            <button class="lvct-dash__stat" onclick={openBirthdayPeople} disabled={data.ordinaryScopeUnknown}>
                <span class="lvct-dash__stat-ic lvct-dash__stat-ic--hl" aria-hidden="true"><Cake size={14} /></span>
                <b>{data.ordinaryScopeUnknown ? "—" : data.birthdaysThisWeek}</b>
                <span>{text("dashStatBirthdaysWeek", "本周生日")}</span>
                {#if data.birthdays.length > data.birthdaysThisWeek}<span class="lvct-dash__stat-ft">{text("dashStatBirthdaysFt", "窗口内共 {n} 人", { n: data.birthdays.length })}</span>{/if}
            </button>
            <button class="lvct-dash__stat" onclick={openNeverContactedPeople} disabled={data.ordinaryScopeUnknown}>
                <span class="lvct-dash__stat-ic lvct-dash__stat-ic--warn" aria-hidden="true"><UserX size={14} /></span>
                <b>{data.ordinaryScopeUnknown ? "—" : data.neverContacted}</b>
                <span>{text("dashStatNever", "从未互动")}</span>
                {#if data.staleTotal > data.neverContacted}<span class="lvct-dash__stat-ft">{text("dashStatNeverFt", "另有久未联系 {n} 人", { n: data.staleTotal })}</span>{/if}
            </button>
        </div>

        <div class="lvct-home__card lvct-dash__actions">
            <div class="lvct-dash__actions-head">
                <h3>{text("dashActionsTitle", "今日行动")}</h3>
                <span class="ft__smaller ft__on-surface">{text("dashActionsSub", "生日 · 联系节奏 · 跟进事项")}</span>
                <span style="flex:1"></span>
                <button class="b3-button b3-button--outline lvct-dash__head-action" onclick={() => (reviewOpen = true)}>{text("dashReview", "交往回顾")}</button>
                {#if overdueCount > 0 && !overdueRetry}
                    <button class="b3-button b3-button--outline lvct-dash__head-action" onclick={postponeOverdueToToday} disabled={alBusy}>
                        {alBusy ? text("dashPostponing", "顺延中…") : text("dashPostponeOverdue", "把 {n} 条逾期跟进顺延到今天", { n: overdueCount })}
                    </button>
                {/if}
                {#if overdueRetry}
                    <button class="b3-button b3-button--text lvct-dash__head-action" onclick={retryOverdue} disabled={alBusy} title={overdueRetry.titles.join("、")}>
                        重试失败项（{overdueRetry.ids.length}）
                    </button>
                {/if}
            </div>
            <StatusNotice message={alError ? text("dashOpFailed", "操作失败：{msg}", { msg: alError }) : ""} error />
            <StatusNotice message={alMessage} actionLabel={undoAction ? "撤销" : undefined} onAction={undoAction ? runUndo : undefined} onDismiss={() => { alMessage = ""; undoAction = null; }} />
            {#if data.ordinaryScopeUnknown}
                <ViewState compact title={text("dashSelfUnverifiedTitle", "提醒范围尚未核实")} description={text("dashSelfUnverifiedDesc", "核实本人身份后可恢复统计和提醒；原始记录保留。")} />
            {:else if actions.length === 0}
                <ViewState compact icon="✅" title={text("dashActionsEmptyTitle", "今天没有需要处理的事")} description={text("dashActionsEmptyDesc", "生日、联系节奏和跟进计划都安顿好了。")}>
                    <button class="b3-button b3-button--outline" onclick={() => onOpenPeople()}>{text("dashBrowsePeople", "浏览联系人")}</button>
                </ViewState>
            {:else}
                {#snippet actionRow(card: ActionCard)}
                    <div class="lvct-dash__rowwrap">
                        <div class="lvct-dash__row">
                            <button class="lvct-dash__row-main" onclick={() => onOpenDetail(card.person)}>
                                <span class="lvct-dash__row-primary">
                                    <b>{card.person.name}</b>
                                    <PersonProfileSummary profile={card.person.profile} compact />
                                </span>
                                <span class="lvct-dash__reasons">
                                    {#each card.reasons as reason (reason.kind + (reason.followUpId ?? ""))}
                                        <span class="lvct-chip lvct-action-chip lvct-action-chip--{reason.bucket}">{reason.label}</span>
                                    {/each}
                                </span>
                            </button>
                            <button class="b3-button b3-button--outline lvct-dash__quick-button" onclick={() => onOpenDetail(card.person)}>
                                {card.bucket === "stale" ? text("dashTakeALook", "去看看") : text("dashProcess", "处理")}
                            </button>
                            <button
                                class="b3-button b3-button--outline lvct-dash__quick-button lvct-dash__quick-button--more"
                                aria-label={`更多处置：${card.person.name}`}
                                aria-expanded={rowMenuKey === `action:${card.person.docId}`}
                                onclick={() => toggleRowMenu(`action:${card.person.docId}`)}
                            >⋯</button>
                        </div>
                        {#if rowMenuKey === `action:${card.person.docId}`}
                            <div class="lvct-dash__quick-form lvct-dash__rowmenu">
                                {#if isNeverCard(card)}
                                    <button class="b3-button b3-button--outline" disabled={alBusy} onclick={() => runRowAction(() => dismissNeverToday(card.person))}>今天先跳过</button>
                                {:else if card.bucket === "stale"}
                                    <button class="b3-button b3-button--outline" disabled={alBusy} onclick={() => runRowAction(() => snoozeStale(card.person, 3))}>顺延 3 天</button>
                                    <button class="b3-button b3-button--outline" disabled={alBusy} onclick={() => runRowAction(() => snoozeStale(card.person, 7))}>顺延 1 周</button>
                                    <button class="b3-button b3-button--outline" disabled={alBusy} onclick={() => runRowAction(() => snoozeStale(card.person, 30))}>顺延 1 个月</button>
                                {:else if card.reasons.some((reason) => reason.kind === "birthday")}
                                    <button class="b3-button b3-button--outline" disabled={alBusy} onclick={() => runRowAction(() => dismissBirthday(card.person))}>跳过本年</button>
                                {/if}
                                <button class="b3-button b3-button--outline" disabled={alBusy} onclick={() => runRowAction(() => createFollowUpFor(card.person))}>建跟进（联系一下）</button>
                                {#if card.bucket === "stale"}
                                    <button class="b3-button b3-button--cancel" disabled={alBusy} onclick={() => runRowAction(() => dismissStaleReminder(card.person))}>不再提醒</button>
                                {/if}
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
                                    {#if settleRetry}
                                        <button class="b3-button b3-button--text lvct-dash__quick-button" disabled={alBusy} onclick={retrySettle}>重试失败项（{settleRetry.cards.length}）</button>
                                    {/if}
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
                {#if data.ordinaryScopeUnknown}
                    <ViewState compact title={text("dashSelfUnverifiedTitle", "提醒范围尚未核实")} description={text("dashSelfUnverifiedDesc", "核实本人身份后可恢复统计和提醒；原始记录保留。")} />
                {:else if data.birthdays.length === 0}
                    <ViewState compact icon="🎂" title="提醒窗口内没有生日" description="可以到联系人档案补充生日，或在设置中调整提醒天数。">
                        <button class="b3-button b3-button--outline" onclick={() => onOpenPeople()}>查看联系人</button>
                    </ViewState>
                {:else}
                    <div class="lvct-dash__list">
                        {#each previewList(data?.birthdays ?? [], showAllBirthdays, BIRTHDAY_PREVIEW_LIMIT) as item (item.person.itemId)}
                            <div class="lvct-dash__row">
                                <button type="button" class="lvct-dash__row-main" onclick={() => onOpenDetail(item.person)}>
                                    <b>{item.person.name}</b>
                                    <PersonProfileSummary profile={item.person.profile} compact />
                                    <span class="ft__smaller ft__on-surface">{item.projection.label}{item.person.isLunar ? "（农历）" : ""}</span>
                                    <span class="lvct-bucket {bucketStyles[item.bucket]}">
                                        {item.projection.daysUntil === 0 ? text("dashFuToday", "今天") : text("dashDaysUntilN", "{n}天", { n: item.projection.daysUntil })}
                                    </span>
                                </button>
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

            <div class="lvct-home__card lvct-dash__secondary-card lvct-dash__stale-card">
                <h3>{text("dashStaleTitle", "久未联系")}</h3>
                <StatusNotice message={quickError ? text("dashRecordFail", "记录失败：{msg}", { msg: quickError }) : ""} error />
                <StatusNotice message={quickMessage} onDismiss={() => (quickMessage = "")} />
                {#if data.ordinaryScopeUnknown}
                    <ViewState compact title={text("dashSelfUnverifiedTitle", "提醒范围尚未核实")} description={text("dashSelfUnverifiedDesc", "核实本人身份后可恢复统计和提醒；原始记录保留。")} />
                {:else if data.stale.length === 0}
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
                                    <PersonProfileSummary profile={item.person.profile} compact />
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

            <div class="lvct-home__card lvct-dash__secondary-card lvct-dash__followup-card">
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
                                        <button class="b3-button b3-button--outline" disabled={fuBusy} onclick={() => snoozeFollowUp(card.item.id, "tomorrow", text("dashSnoozeTomorrow", "明天"), card.item.title || text("dashKeepInTouch", "保持联系"), card.item.dueDate)}>{text("dashSnoozeTomorrow", "明天")}</button>
                                        <button class="b3-button b3-button--outline" disabled={fuBusy} onclick={() => snoozeFollowUp(card.item.id, "threeDays", text("dashSnoozeThreeDays", "三天后"), card.item.title || text("dashKeepInTouch", "保持联系"), card.item.dueDate)}>{text("dashSnoozeThreeDays", "三天后")}</button>
                                        <button class="b3-button b3-button--outline" disabled={fuBusy} onclick={() => snoozeFollowUp(card.item.id, "nextMonday", text("dashSnoozeNextMonday", "下周一"), card.item.title || text("dashKeepInTouch", "保持联系"), card.item.dueDate)}>{text("dashSnoozeNextMonday", "下周一")}</button>
                                        <button class="b3-button b3-button--outline" disabled={fuBusy} onclick={() => snoozeFollowUp(card.item.id, "nextMonth", text("dashSnoozeNextMonth", "一个月后"), card.item.title || text("dashKeepInTouch", "保持联系"), card.item.dueDate)}>{text("dashSnoozeNextMonth", "一个月后")}</button>
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

        <!-- B09-7：工作空间/联动为低频区块——移动端默认折叠（details），桌面强制展开 -->
        <details class="lvct-dash__lowfreq">
            <summary>{text("dashLowFreqTitle", "工作空间与联动")}</summary>
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
        </details>
    {/if}
</div>

{#if reviewOpen}
    <LvctDialog title="交往回顾报表" wide onClose={() => (reviewOpen = false)}>
        <ReviewReportDialog i18n={facade.i18n} buildReport={(range) => facade.buildReviewReport(range.from, range.to)} />
    </LvctDialog>
{/if}
