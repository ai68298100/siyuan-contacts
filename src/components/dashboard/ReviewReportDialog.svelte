<script lang="ts">
    import { onMount, onDestroy } from "svelte";
    /** 交往回顾报表（F12）：区间互动统计与明细，只读投影；可解释口径，无评分 */
    import { monthToDateRange } from "../../domain/review-report";
    import type { ReviewRange, ReviewReport } from "../../domain/review-report";
    import { toLocalDateKey } from "../../domain/interactions";
    import ViewState from "../ViewState.svelte";
    import StatusNotice from "../StatusNotice.svelte";
    import { useCloseGuard } from "../close-guard";
    import { translateText } from "../../domain/translation";
    import type { AuditModuleKey, AuditModuleResult, AuditIssue, AuditIssueKind, HealthAuditReport } from "../../domain/health-audit";

    let {
        i18n,
        buildReport,
        buildAuditReport,
        retryFailedAuditModules,
        onOpenPeople,
    }: {
        i18n?: Readonly<Record<string, string>>;
        buildReport?: (range: ReviewRange) => Promise<ReviewReport>;
        buildAuditReport?: (previous?: HealthAuditReport) => Promise<HealthAuditReport>;
        retryFailedAuditModules?: (report: HealthAuditReport) => Promise<HealthAuditReport>;
        onOpenPeople?: (focus: { itemIds: readonly string[]; label: string }) => void;
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
    let auditReport: HealthAuditReport | null = $state(null);
    let auditLoading = $state(false);
    let auditErrorText = $state("");
    let auditRequest = 0;
    let auditPreviewIssue: AuditIssue | null = $state(null);
    let alive = true;
    const auditJumpLabels: Partial<Record<AuditIssueKind, string>> = {
        missingPhone: "缺电话", missingBirthday: "缺生日", missingContact: "缺全部联系方式",
        noGroupNoTags: "无分组且无标签", suspiciousBirthday: "可疑生日", danglingRelation: "悬空关系", longInactive: "长期无互动",
    };
    onDestroy(() => {
        alive = false;
        request += 1;
        auditRequest += 1;
    });
    useCloseGuard({
        busy: () => loading || auditLoading,
        dirty: () => false,
    });

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
        if (!buildReport) return;
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

    async function loadAudit() {
        if (!buildAuditReport) return;
        const current = ++auditRequest;
        auditLoading = true;
        auditErrorText = "";
        try {
            const result = await buildAuditReport(auditReport ?? undefined);
            if (alive && current === auditRequest) { auditReport = result; auditPreviewIssue = null; }
        } catch (error) {
            if (current === auditRequest) auditErrorText = error instanceof Error ? error.message : String(error);
        } finally {
            if (current === auditRequest) auditLoading = false;
        }
    }

    async function retryFailedAudit() {
        if (!auditReport || !retryFailedAuditModules || auditLoading) return;
        if (!Object.values(auditReport.modules).some((module) => module.state === "failed")) return;
        auditLoading = true;
        auditErrorText = "";
        const current = ++auditRequest;
        try {
            const result = await retryFailedAuditModules(auditReport);
            if (alive && current === auditRequest) { auditReport = result; auditPreviewIssue = null; }
        } catch (error) {
            if (alive && current === auditRequest) auditErrorText = error instanceof Error ? error.message : String(error);
        } finally {
            if (alive && current === auditRequest) auditLoading = false;
        }
    }

    function moduleLabel(module: AuditModuleKey): string {
        return {
            roster: "名册",
            interactions: "互动",
            followUps: "跟进",
            organizationMembers: "组织成员",
            selfIdentity: "本人身份",
        }[module];
    }

    function moduleStateLabel(module: AuditModuleResult): string {
        if (module.state === "failed") return module.readStatus === "bad_json" ? "失败 · 坏 JSON" : "失败 · 读取失败";
        if (module.state === "unknown") return module.readStatus === "timed_out" ? "未知 · 超时" : "未知 · 未核实";
        return module.readStatus === "not_found" ? "已核实 · 未发现" : "成功 · 已核实";
    }

    function moduleDescription(module: AuditModuleResult): string {
        if (module.message) return module.message;
        if (module.readStatus === "not_found") return "读取成功，当前没有该模块数据；这不是读取故障。";
        return `已读取 ${module.count} 项，结果可用于本次体检。`;
    }

    onMount(() => {
        if (buildAuditReport) {
            loading = false;
            void loadAudit();
        } else {
            void load();
        }
    });

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
    {#if buildAuditReport}
        <StatusNotice message={auditErrorText ? `资料体检读取失败：${auditErrorText}` : ""} error />
        {#if auditLoading}
            <ViewState compact loading title="正在读取体检模块" />
        {:else if auditErrorText && !auditReport}
            <ViewState compact error title="资料体检无法核实" description="读取故障未被当作空结果，请修复后重新运行。" />
            <div class="lvct-review__section">
                <button type="button" class="b3-button b3-button--outline" onclick={loadAudit}>重新读取体检</button>
            </div>
        {:else if auditReport}
            <div class="lvct-review__section">
                <b>资料体检</b>
                <p class="ft__smaller ft__on-surface">只读检查；当前报告写入数：{auditReport.writes}。修复预览不会修改任何数据。</p>
                <button type="button" class="b3-button b3-button--outline" onclick={loadAudit} disabled={auditLoading}>重新核实全部模块</button>
                {#if retryFailedAuditModules && Object.values(auditReport.modules).some((module) => module.state === "failed")}
                    <button type="button" class="b3-button b3-button--text" onclick={retryFailedAudit} disabled={auditLoading}>只重试失败模块</button>
                {/if}
            </div>
            {#each Object.values(auditReport.modules) as module (module.module)}
                <section class="lvct-review__section" data-health-module={module.module}>
                    <div class="lvct-between">
                        <b>{moduleLabel(module.module)}</b>
                        <span class="lvct-chip">{moduleStateLabel(module)}</span>
                    </div>
                    <p class="ft__smaller ft__on-surface">{moduleDescription(module)}</p>
                    {#if module.state === "unknown"}
                        <p class="ft__smaller ft__on-surface">本模块未核实，不能显示为正常空态。</p>
                    {/if}
                    {#if module.stale}<p class="ft__smaller ft__on-surface">以下为上次已核实问题，本次故障期间保留，当前仍待复核。</p>{/if}
                    {#if module.issues.length > 0}
                        <ul class="lvct-settings__missing">
                            {#each module.issues as issue (issue.kind)}
                                <li>
                                    <div class="ft__smaller ft__on-surface">{issue.samples.length > 0 ? issue.samples.join("、") : "已定位对象"}</div>
                                    <div>{issue.reason}</div>
                                    <button type="button" class="b3-button b3-button--text" onclick={() => (auditPreviewIssue = issue)}>预览修复范围</button>
                                    {#if onOpenPeople && auditJumpLabels[issue.kind] && !module.stale && module.state === "success"}
                                        <button type="button" class="b3-button b3-button--text" onclick={() => onOpenPeople?.({ itemIds: issue.itemIds, label: auditJumpLabels[issue.kind]! })}>查看这 {issue.itemIds.length} 人</button>
                                    {/if}
                                </li>
                            {/each}
                        </ul>
                    {:else if module.state === "success" && module.readStatus !== "not_found"}
                        <p class="ft__smaller ft__on-surface">本模块未发现体检问题。</p>
                    {/if}
                </section>
            {/each}
            {#if auditPreviewIssue}
                <div class="lvct-review__section" role="status">
                    <b>修复预览：{auditPreviewIssue.repair.action}</b>
                    <p class="ft__smaller ft__on-surface">目标 {auditPreviewIssue.repair.targetIds.length} 项；{auditPreviewIssue.repair.impact}确认前写入数：{auditPreviewIssue.repair.writes}。</p>
                    <ul>{#each auditPreviewIssue.repair.targetIds as target}<li>{target}</li>{/each}</ul>
                    {#if auditPreviewIssue.repair.targetDocIds?.length}
                        <p class="ft__smaller ft__on-surface">涉及文档：{auditPreviewIssue.repair.targetDocIds.join("、")}</p>
                    {/if}
                    <button type="button" class="b3-button b3-button--text" onclick={() => (auditPreviewIssue = null)}>关闭预览</button>
                </div>
            {/if}
            {#if auditReport.issues.length === 0 && Object.values(auditReport.modules).every((module) => module.state === "success")}
                <p class="ft__smaller ft__on-surface">所有模块均已核实，未发现资料质量问题。</p>
            {:else if Object.values(auditReport.modules).some((module) => module.state !== "success")}
                <p class="ft__smaller ft__on-surface">报告仍有模块失败或未知，不能据此判定没有问题。</p>
            {/if}
        {:else}
            <ViewState compact title="尚未生成体检报告" description="读取完成后才会显示模块结果。" />
        {/if}
    {:else}
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
    {:else if errorText && !report}
        <ViewState compact error title={text("reviewErrorTitle", "交往回顾读取失败")} description={errorText}>
            <button type="button" class="b3-button b3-button--outline" onclick={load}>{text("reviewRetry", "重试读取报表")}</button>
        </ViewState>
    {:else if !report}
        <ViewState compact title={text("reviewPickRange", "选择区间后生成报表")} description={text("reviewPickRangeDesc", "选择「自定义」并填写起止日期，即可生成本区间回顾。")} />
    {:else}
        {#if errorText}
            <p class="ft__smaller ft__on-surface">当前展示上次成功生成的报表，本次所选区间仍待核实。</p>
            <button type="button" class="b3-button b3-button--outline" onclick={load}>{text("reviewRetry", "重试读取报表")}</button>
        {/if}
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
    {/if}
</div>
