<script lang="ts">
    /** 首页仪表盘：统计 + 近期生日（公/农历）+ 久未联系 */
    import type { ContactsPluginFacade } from "../../types";
    import type { DashboardData } from "../../services/dashboard";
    import type { ContactSummary } from "../../domain/person";
    import type { ViewPreferences } from "../../domain/preferences";
    import { detectCheckinBridge } from "../../bridge/checkin";
    import ViewState from "../ViewState.svelte";
    import StatusNotice from "../StatusNotice.svelte";

    let {
        facade,
        preferences,
        revision = 0,
        onOpenDetail,
        onOpenPeople,
        onOpenGraph,
    }: {
        facade: ContactsPluginFacade;
        preferences: ViewPreferences;
        revision?: number;
        onOpenDetail: (person: ContactSummary) => void;
        onOpenPeople: (focus?: { itemIds: readonly string[]; label: string; sort?: "name" | "group" | "birthday" }) => void;
        onOpenGraph: () => void;
    } = $props();

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

    const greeting = (() => {
        const hour = new Date().getHours();
        if (hour < 6) return "夜深了";
        if (hour < 12) return "早上好";
        if (hour < 18) return "下午好";
        return "晚上好";
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

    const bucketStyles: Record<string, string> = {
        today: "lvct-bucket--today",
        week: "lvct-bucket--week",
        month: "lvct-bucket--month",
        later: "lvct-bucket--later",
    };
</script>

<div class="lvct-dash">
    {#if errorText}
        <ViewState compact error title="仪表盘加载失败" description={errorText}>
            <button class="b3-button b3-button--outline" onclick={refresh}>重新加载</button>
        </ViewState>
    {/if}
    {#if !data && !errorText}
        <div class="lvct-dash__skeleton" aria-busy="true" aria-label="仪表盘加载中">
            {#each Array(4) as _, index (index)}<span class="lvct-skeleton"></span>{/each}
            <span class="lvct-skeleton lvct-dash__skeleton-block"></span>
            <span class="lvct-skeleton lvct-dash__skeleton-block"></span>
        </div>
    {:else if data}
        <div class="lvct-dash__welcome">
            <div>
                <p class="lvct-dash__greeting">{greeting}，今天先联系谁？</p>
                <span class="ft__smaller ft__on-surface">{todayLabel}</span>
            </div>
            {#if todayBirthdays.length > 0}
                <button class="lvct-dash__birthday-banner" onclick={openBirthdayPeople} aria-label="查看今天过生日的联系人">
                    <span aria-hidden="true">🎂</span>
                    <span><b>今天生日</b> · {todayBirthdays.slice(0, 3).map((item) => item.person.name).join("、")}{todayBirthdays.length > 3 ? ` 等 ${todayBirthdays.length} 人` : ""}</span>
                    <span aria-hidden="true">›</span>
                </button>
            {/if}
        </div>
        <div class="lvct-dash__stats">
            <button class="lvct-dash__stat" onclick={() => onOpenPeople()}><b>{data.people}</b><span>联系人</span></button>
            <button class="lvct-dash__stat" onclick={onOpenGraph}><b>{data.relations}</b><span>关系</span></button>
            <button class="lvct-dash__stat" onclick={openBirthdayPeople}><b>{data.birthdaysThisWeek}</b><span>本周生日</span></button>
            <button class="lvct-dash__stat" onclick={openNeverContactedPeople}><b>{data.neverContacted}</b><span>从未互动</span></button>
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
                        {#each data.birthdays.slice(0, 8) as item (item.person.itemId)}
                            <button class="lvct-dash__row" onclick={() => onOpenDetail(item.person)}>
                                <b>{item.person.name}</b>
                                <span class="ft__smaller ft__on-surface">{item.projection.label}{item.person.isLunar ? "（农历）" : ""}</span>
                                <span class="lvct-bucket {bucketStyles[item.bucket]}">
                                    {item.projection.daysUntil === 0 ? "今天" : `${item.projection.daysUntil}天`}
                                </span>
                            </button>
                        {/each}
                    </div>
                {/if}
            </div>

            <div class="lvct-home__card">
                <h3>久未联系</h3>
                <StatusNotice message={quickError ? `记录失败：${quickError}` : ""} error />
                <StatusNotice message={quickMessage} onDismiss={() => (quickMessage = "")} />
                {#if data.stale.length === 0}
                    <ViewState compact icon="✓" title={data.people === 0 ? "先添加一位联系人" : "暂无久未联系的人"}
                        description={data.people === 0 ? "创建或导入联系人后，就能开始记录互动。" : "可以继续在联系人档案中记录新的互动。"}>
                        <button class="b3-button b3-button--outline" onclick={() => onOpenPeople()}>前往联系人</button>
                    </ViewState>
                {:else}
                    <div class="lvct-dash__list">
                        {#each data.stale.slice(0, 8) as item (item.person.itemId)}
                            <div class="lvct-dash__row">
                                <button class="lvct-dash__row-main" onclick={() => onOpenDetail(item.person)}>
                                    <b>{item.person.name}</b>
                                    <span class="ft__smaller ft__on-surface">
                                        {item.lastDaysAgo === undefined ? "从未互动" : `${item.lastDaysAgo} 天前`}
                                    </span>
                                    <span class="lvct-bucket lvct-bucket--stale">联系一下</span>
                                </button>
                                {#if quickPersonId === item.person.itemId}
                                    <div class="lvct-dash__quick-form">
                                        <input class="b3-text-field" type="text" aria-label={`与${item.person.name}互动的备注`} placeholder="备注（可选）" bind:value={quickNote} disabled={quickBusy} />
                                        <button class="b3-button b3-button--text" onclick={() => recordQuick(item.person)} disabled={quickBusy}>{quickBusy ? "记录中…" : "记录"}</button>
                                        <button class="b3-button b3-button--cancel" onclick={() => { quickPersonId = ""; quickError = ""; }} disabled={quickBusy}>取消</button>
                                    </div>
                                {:else}
                                    <button class="b3-button b3-button--outline lvct-dash__quick-button" onclick={() => { quickPersonId = item.person.itemId; quickNote = ""; }} disabled={quickBusy || quickDoneId === item.person.itemId}>
                                        {quickDoneId === item.person.itemId ? "已记录 ✓" : "记一笔"}
                                    </button>
                                {/if}
                            </div>
                        {/each}
                    </div>
                {/if}
            </div>

            <div class="lvct-home__card">
                <h3>待办跟进</h3>
                <StatusNotice message={fuError ? `操作失败：${fuError}` : ""} error />
                <StatusNotice message={fuMessage} onDismiss={() => (fuMessage = "")} />
                {#if (data.followUps ?? []).length === 0}
                    <ViewState compact icon="🗓" title="没有待办的跟进计划"
                        description="在联系人详情里可以安排日期型联系计划，到期会出现在这里。">
                        <button class="b3-button b3-button--outline" onclick={() => onOpenPeople()}>前往联系人</button>
                    </ViewState>
                {:else}
                    <div class="lvct-dash__list">
                        {#each data.followUps ?? [] as card (card.item.id)}
                            <div class="lvct-dash__row">
                                <button class="lvct-dash__row-main" disabled={!card.reachable || fuBusy}
                                    title={card.reachable ? undefined : "人物文档不可达（可能已解绑），仍可推迟或跳过"}
                                    onclick={() => card.person && onOpenDetail(card.person)}>
                                    <b>{card.item.title || "保持联系"}</b>
                                    <span class="ft__smaller ft__on-surface">{card.person?.name ?? "人物文档不可达"} · {card.item.dueDate}</span>
                                    <span class="lvct-bucket {card.bucket === "overdue" ? "lvct-bucket--stale" : card.bucket === "today" ? "lvct-bucket--today" : "lvct-bucket--week"}">
                                        {card.bucket === "overdue" ? "已逾期" : card.bucket === "today" ? "今天" : "近期"}
                                    </span>
                                </button>
                                {#if fuSnoozeForId === card.item.id}
                                    <div class="lvct-dash__quick-form">
                                        <button class="b3-button b3-button--outline" disabled={fuBusy} onclick={() => snoozeFollowUp(card.item.id, "tomorrow", "明天", card.item.title || "保持联系")}>明天</button>
                                        <button class="b3-button b3-button--outline" disabled={fuBusy} onclick={() => snoozeFollowUp(card.item.id, "threeDays", "三天后", card.item.title || "保持联系")}>三天后</button>
                                        <button class="b3-button b3-button--outline" disabled={fuBusy} onclick={() => snoozeFollowUp(card.item.id, "nextMonday", "下周一", card.item.title || "保持联系")}>下周一</button>
                                        <button class="b3-button b3-button--outline" disabled={fuBusy} onclick={() => snoozeFollowUp(card.item.id, "nextMonth", "一个月后", card.item.title || "保持联系")}>一个月后</button>
                                        <input type="date" class="b3-text-field" aria-label="指定推迟日期" bind:value={fuCustomDate} disabled={fuBusy} />
                                        <button class="b3-button b3-button--text" disabled={fuBusy || !fuCustomDate} onclick={() => snoozeFollowUpCustom(card.item.id, card.item.title || "保持联系")}>按日期</button>
                                        <button class="b3-button b3-button--cancel" onclick={() => { fuSnoozeForId = ""; fuCustomDate = ""; }} disabled={fuBusy}>收起</button>
                                    </div>
                                {:else}
                                    <div class="lvct-dash__fu-actions">
                                        {#if card.reachable}
                                            <button class="b3-button b3-button--text" disabled={fuBusy} onclick={() => card.person && onOpenDetail(card.person)}>处理</button>
                                        {/if}
                                        <button class="b3-button b3-button--outline" disabled={fuBusy} onclick={() => { fuSnoozeForId = fuSnoozeForId === card.item.id ? "" : card.item.id; fuCustomDate = ""; }} aria-expanded={fuSnoozeForId === card.item.id}>推迟</button>
                                        <button class="b3-button b3-button--outline" disabled={fuBusy} onclick={() => completeFollowUp(card.item.id, card.item.title || "保持联系")}>完成</button>
                                        <button class="b3-button b3-button--cancel" disabled={fuBusy} onclick={() => skipFollowUp(card.item.id, card.item.title || "保持联系")}>跳过</button>
                                    </div>
                                {/if}
                            </div>
                        {/each}
                    </div>
                    <p class="ft__smaller ft__on-surface">完成或跳过不会自动记录互动；计划在人物详情里可重新打开。</p>
                {/if}
            </div>
        </div>

        <div class="lvct-dash__grid">
            <div class="lvct-home__card">
                <h3>工作空间</h3>
                <div class="lvct-home__row"><span class="ft__on-surface">笔记本</span><b>{facade.settings?.notebookName ?? "—"}</b></div>
                <div class="lvct-home__actions">
                    <button class="b3-button b3-button--outline" onclick={() => facade.openHostDoc()}>打开联系人总表</button>
                </div>
            </div>

            <div class="lvct-home__card">
                <h3>小驴打卡联动</h3>
                {#if bridge.state === "ready"}
                    <div class="lvct-home__row"><span class="ft__on-surface">状态</span><b>已连接（协议 v{bridge.protocol}）</b></div>
                {:else if bridge.state === "pending"}
                    <div class="lvct-home__row"><span class="ft__on-surface">状态</span><b>检测到旧版打卡（协议 v{bridge.protocol ?? "?"}）</b></div>
                {:else if bridge.state === "failed"}
                    <div class="lvct-home__row"><span class="ft__on-surface">状态</span><b>探测异常</b></div>
                {:else}
                    <div class="lvct-home__row"><span class="ft__on-surface">状态</span><b>未检测到小驴打卡</b></div>
                    <p class="ft__smaller ft__on-surface">安装小驴打卡后，生日可同步为打卡事项提醒。</p>
                {/if}
            </div>
        </div>
    {/if}
</div>
