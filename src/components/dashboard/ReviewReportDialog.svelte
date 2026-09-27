<script lang="ts">
    /** 交往回顾报表（F12）：区间互动统计与明细，只读投影；可解释口径，无评分 */
    import { monthToDateRange } from "../../domain/review-report";
    import type { ReviewRange, ReviewReport } from "../../domain/review-report";
    import { toLocalDateKey } from "../../domain/interactions";
    import ViewState from "../ViewState.svelte";
    import StatusNotice from "../StatusNotice.svelte";
    import { translateText } from "../../domain/translation";

    let {
        i18n,
        buildReport,
    }: {
        i18n?: Readonly<Record<string, string>>;
        buildReport: (range: ReviewRange) => Promise<ReviewReport>;
    } = $props();
    const text = $derived.by(() => (key: string, fallback: string, values?: Record<string, string | number>) =>
        translateText(i18n, key, fallback, values));

    let mode: "month" | "30" | "90" | "custom" = $state("month");
    let customFrom = $state("");
    let customTo = $state("");
    let report: ReviewReport | null = $state(null);
    let loading = $state(true);
    let errorText = $state("");
    let showEntries = $state(false);
    let request = 0;

    const todayKey = toLocalDateKey(new Date());

    function currentRange(): ReviewRange {
        if (mode === "month") return monthToDateRange(todayKey);
        if (mode === "30") return { from: shift(todayKey, -29), to: todayKey };
        if (mode === "90") return { from: shift(todayKey, -89), to: todayKey };
        return { from: customFrom, to: customTo };
    }
    function shift(dateKey: string, days: number): string {
        const [year, month, day] = dateKey.split("-").map(Number);
        const date = new Date(year, month - 1, day + days);
        const pad = (value: number) => String(value).padStart(2, "0");
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    }

    async function load() {
        const current = ++request;
        loading = true;
        errorText = "";
        try {
            const range = currentRange();
            if (mode === "custom" && (!range.from || !range.to)) {
                if (current === request) { report = null; loading = false; }
                return;
            }
            const result = await buildReport(range);
            if (current === request) report = result;
        } catch (error) {
            if (current === request) errorText = error instanceof Error ? error.message : String(error);
        } finally {
            if (current === request) loading = false;
        }
    }
    load();

    const deltaLabel = $derived.by(() => {
        if (!report) return "";
        if (report.delta > 0) return text("reviewDeltaMore", "比上一周期多 {n} 次", { n: report.delta });
        if (report.delta < 0) return text("reviewDeltaLess", "比上一周期少 {n} 次", { n: Math.abs(report.delta) });
        return text("reviewDeltaFlat", "与上一周期持平");
    });
    const summaryLine = $derived.by(() => {
        if (!report) return "";
        const top = report.topPeople[0];
        const topText = top ? text("reviewTopSentence", "最常联系：{name}（{count} 次）。", { name: top.name || text("reviewUnknownPerson", "（未知名下人物）"), count: top.count }) : "";
        return text("reviewLine", "本周期与 {people} 位联系人互动 {total} 次（{activities} 场活动），{delta}。{top}", {
            people: report.contactedPeople,
            total: report.total,
            activities: report.activities,
            delta: deltaLabel,
            top: topText,
        });
    });
    const sourceLabels: Record<string, string> = $derived.by(() => ({
        manual: text("reviewSourceManual", "手动记录"),
        diary: text("reviewSourceDiary", "笔记捕获"),
        api: text("reviewSourceApi", "外部联动"),
    }));
</script>

<div class="lvct-form lvct-review">
    <div class="lvct-review__range">
        <select class="b3-select" aria-label={text("reviewRangeLabel", "统计区间")} bind:value={mode} onchange={() => load()}>
            <option value="month">{text("reviewRangeMonth", "本月")}</option>
            <option value="30">{text("reviewRange30", "最近 30 天")}</option>
            <option value="90">{text("reviewRange90", "最近 90 天")}</option>
            <option value="custom">{text("reviewRangeCustom", "自定义")}</option>
        </select>
        {#if mode === "custom"}
            <input type="date" class="b3-text-field" aria-label={text("reviewFrom", "报表开始日期")} bind:value={customFrom} onchange={() => load()} />
            <span class="ft__on-surface">~</span>
            <input type="date" class="b3-text-field" aria-label={text("reviewTo", "报表结束日期")} bind:value={customTo} onchange={() => load()} />
        {/if}
    </div>

    <StatusNotice message={errorText ? text("reviewFail", "报表生成失败：{msg}", { msg: errorText }) : ""} error />

    {#if loading}
        <ViewState compact loading title={text("reviewLoading", "正在生成报表")} />
    {:else if !report}
        <ViewState compact title={text("reviewPickRange", "选择区间后生成报表")} description={text("reviewPickRangeDesc", "选择「自定义」并填写起止日期，即可生成本区间回顾。")} />
    {:else}
        <div class="lvct-review__hero">
            <b class="lvct-review__big">{report.total}</b>
            <span>{text("reviewHeroUnit", "次互动")} · {deltaLabel}</span>
        </div>
        <p class="lvct-review__line">{summaryLine}</p>
        <div class="lvct-review__grid">
            <div class="lvct-review__cell"><b>{report.activities}</b><span>{text("reviewActivities", "同场活动")}</span></div>
            <div class="lvct-review__cell"><b>{report.contactedPeople}</b><span>{text("reviewPeople", "联系人数")}</span></div>
            <div class="lvct-review__cell"><b>{report.bySource.manual}</b><span>{sourceLabels.manual}</span></div>
            <div class="lvct-review__cell"><b>{report.bySource.diary}</b><span>{sourceLabels.diary}</span></div>
            <div class="lvct-review__cell"><b>{report.bySource.api}</b><span>{sourceLabels.api}</span></div>
        </div>

        {#if report.topPeople.length > 0}
            <div class="lvct-review__section">
                <b>{text("reviewTopTitle", "最常联系 Top {n}", { n: report.topPeople.length })}</b>
                <ol class="lvct-review__top">
                    {#each report.topPeople as item (item.personDocId)}
                        <li>{text("reviewTopEntry", "{name} · {count} 次", { name: item.name || text("reviewUnknownPerson", "（未知名下人物）"), count: item.count })}</li>
                    {/each}
                </ol>
            </div>
        {/if}

        <div class="lvct-review__section">
            <button type="button" class="b3-button b3-button--outline" aria-expanded={showEntries} onclick={() => (showEntries = !showEntries)}>
                {showEntries ? text("reviewToggleHide", "收起明细") : text("reviewToggleShow", "查看明细（{n} 条）", { n: report.entries.length })}
            </button>
            {#if showEntries}
                <div class="lvct-detail__timeline" style="margin-top: 8px;">
                    {#each report.entries as entry (entry.eventId)}
                        <div class="lvct-detail__timeline-row">
                            <span class="ft__on-surface">{entry.localDate}</span>
                            <span class="lvct-detail__timeline-note">{entry.personName || text("reviewUnknownPerson", "（未知名下人物）")} · {entry.note || text("reviewEntryInteraction", "互动")}</span>
                            <span class="lvct-detail__timeline-source">{sourceLabels[entry.source] ?? entry.source}</span>
                            {#if entry.groupSize > 1}<span class="lvct-chip">{text("reviewGroupSize", "{n} 人同场", { n: entry.groupSize })}</span>{/if}
                        </div>
                    {/each}
                </div>
            {/if}
        </div>

        <p class="ft__smaller ft__on-surface">
            {text("reviewScopeNote", "口径说明：人物互动条数按每人每条事件计；同场活动按场合去重，多人同场不重复计为多场；手工记录各自成次。所有数字可从互动记录直接数出，不含关系评分。")}
        </p>
    {/if}
</div>
