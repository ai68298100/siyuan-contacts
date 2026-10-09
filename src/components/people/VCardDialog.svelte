<script lang="ts">
    /** vCard (.vcf) 导入导出：文件解析预览（同名默认跳过）→ 批量建人；名册导出为 .vcf 下载。
     * F14：逐项三段报告单（成功/跳过/失败/未知），失败与未知项可核对名册后重试 */
    import { buildVcfImportPlan, exportVcfText, pickItemResults, pickRetryCount, runVcfImportQueue } from "../../services/vcard";
    import type { VcfImportPlan, VcfImportReport, VcfItemResult } from "../../services/vcard";
    import type { ContactsSettings } from "../../domain/model";
    import ViewState from "../ViewState.svelte";
    import { useCloseGuard } from "../close-guard";
    import { translateText } from "../../domain/translation";
    import { formatBirthdayDisplay } from "../../domain/occasions";
    import { onDestroy } from "svelte";

    let {
        settings,
        i18n,
        hostCloseChannel,
        onImported,
        onClose,
    }: {
        settings: ContactsSettings;
        i18n?: Readonly<Record<string, string>>;
        /** D-40：libs/dialog 注入的宿主关闭通道（X/Esc/遮罩经守卫路由）；缺省保持宿主原行为 */
        hostCloseChannel?: { request?: (close: () => void) => void };
        onImported: (count: number) => void;
        onClose: () => void;
    } = $props();
    const text = $derived.by(() => (key: string, fallback: string, values?: Record<string, string | number>) =>
        translateText(i18n, key, fallback, values));

    let plans: VcfImportPlan[] | null = $state(null);
    let selected: Record<number, boolean> = $state({});
    let parsing: boolean = $state(false);
    let importing: boolean = $state(false);
    let exporting: boolean = $state(false);
    let retrying: boolean = $state(false);
    let errorText: string = $state("");
    let statusText: string = $state("");
    let report: VcfImportReport | null = $state(null);
    let fileInput: HTMLInputElement | undefined = $state();
    let lastChosen: { planIndex: number; plan: VcfImportPlan }[] = $state([]);
    let pauseRequested = $state(false);
    // 文件解析、队列写入和导出均可能跨越弹窗卸载；迟到结果不得回写已销毁实例。
    let alive = true;
    onDestroy(() => {
        alive = false;
        pauseRequested = true;
    });
    const guardedClose = useCloseGuard({
        busy: () => importing || parsing || exporting || retrying,
        dirty: () => report ? pickRetryCount(report) > 0 : plans !== null && selectedCount > 0,
        changes: () => [report
            ? text("vcardCheckpointWarning", "未完成项的重试断点只保留在本窗口。关闭或更换文件前请保存诊断信息；重新导入不会恢复这些断点。")
            : text("guardVcardSelection", "已选择 {n} 位联系人待导入", { n: selectedCount })],
    });
    /* D-40：宿主 X/Esc/遮罩经同一守卫路由（返回 Promise 供拦截层重入门） */
    $effect(() => {
        if (hostCloseChannel) hostCloseChannel.request = (close) => guardedClose(close);
    });

    const selectedCount = $derived.by(() => {
        if (!plans) return 0;
        return Object.entries(selected).filter(([, on]) => on).length;
    });
    const duplicateCount = $derived.by(() => {
        if (!plans) return 0;
        return plans.filter((plan) => plan.duplicate).length;
    });
    const previewStats = $derived.by(() => {
        if (!plans) return { cards: 0, mapped: 0, ignored: 0, review: 0 };
        return plans.reduce((stats, plan, index) => {
            if (!selected[index]) return stats;
            stats.cards += 1;
            stats.mapped += (plan.mappings ?? []).filter((mapping) => mapping.state === "mapped").length;
            stats.ignored += plan.contact.unsupportedProperties?.length ?? 0;
            stats.review += plan.contact.needsReview?.length ?? 0;
            return stats;
        }, { cards: 0, mapped: 0, ignored: 0, review: 0 });
    });

    async function onFileChange(event: Event) {
        const input = event.currentTarget as HTMLInputElement;
        const file = input.files?.[0];
        if (!file || !alive) return;
        if (importing || exporting || parsing || retrying) return;
        parsing = true;
        plans = null;
        selected = {};
        errorText = "";
        statusText = "";
        report = null;
        try {
            const text = await file.text();
            const result = await buildVcfImportPlan(settings, text);
            if (!alive) return;
            plans = result;
            const next: Record<number, boolean> = {};
            result.forEach((plan, index) => (next[index] = !plan.duplicate && !(plan.unresolvedDocIds?.length)));
            selected = next;
            if (result.length === 0) {
                statusText = "没有解析到可导入的联系人（vCard 卡片需包含 FN 或 N 姓名属性）。";
            }
        } catch (error) {
            if (alive) errorText = error instanceof Error ? error.message : String(error);
        } finally {
            if (alive) {
                parsing = false;
                input.value = "";
            }
        }
    }

    function selectPlan(index: number, checked: boolean): void {
        if (!plans) return;
        if (plans[index].unresolvedDocIds?.length) return;
        selected[index] = checked;
        plans[index].allowSameName = plans[index].duplicate && checked;
    }

    function toggleAll(on: boolean) {
        if (!plans) return;
        const next: Record<number, boolean> = {};
        plans.forEach((plan, index) => {
            if (!plan.duplicate && !plan.unresolvedDocIds?.length && on) next[index] = true;
        });
        selected = next;
    }

    async function runImport() {
        if (!alive || importing || parsing || exporting || errorText || report || !plans || selectedCount === 0) return;
        importing = true;
        errorText = "";
        try {
            // 记录勾选项与其全局下标（服务层 results.planIndex 原样回传，重试据此定位）
            const chosenEntries = plans
                .map((plan, planIndex) => ({ plan, planIndex }))
                .filter(({ planIndex }) => selected[planIndex]);
            lastChosen = chosenEntries.map(({ planIndex, plan }) => ({ planIndex, plan: {
                ...plan, draft: { ...plan.draft, tags: [...plan.draft.tags] },
            } }));
            pauseRequested = false;
            const result = await runVcfImportQueue(settings, lastChosen, null, {
                shouldPause: () => pauseRequested,
                onProgress: (done, total) => { if (alive) statusText = `已核实 ${done}/${total} 项…`; },
            });
            if (!alive) return;
            // 同名未勾选项不在服务入参内，在此补进逐项报告（planIndex 指回 plans）
            plans.forEach((plan, planIndex) => {
                if (plan.duplicate && !selected[planIndex]) {
                    result.results.unshift({ planIndex, name: plan.contact.name, status: "skipped", reason: text("vcardDupReason", "名册已有同名，默认跳过") });
                }
            });
            report = result;
            statusText = "";
            if (report.imported > 0) onImported(report.imported);
        } catch (error) {
            if (alive) errorText = error instanceof Error ? error.message : String(error);
        } finally {
            if (alive) importing = false;
        }
    }

    // ---- F14 三段报告单 ----
    const reportResults: VcfItemResult[] = $derived(pickItemResults(report));
    const reportImported = $derived(reportResults.filter((item) => item.status === "imported"));
    const reportSkipped = $derived(reportResults.filter((item) => item.status === "skipped"));
    const reportFailed = $derived(reportResults.filter((item) => item.status === "failed"));
    const reportUnknown = $derived(reportResults.filter((item) => item.status === "unknown"));
    const reportPending = $derived(reportResults.filter((item) => item.status === "pending"));
    const retryable: boolean = $derived(pickRetryCount(report) > 0);
    const operationBusy = $derived(importing || parsing || exporting || retrying);

    async function runRetry(retryOnly = false) {
        if (!alive || retrying || !plans || !report) return;
        retrying = true;
        pauseRequested = false;
        errorText = "";
        try {
            const before = report.imported;
            const nextReport = await runVcfImportQueue(settings, lastChosen, report, {
                retryOnly,
                shouldPause: () => pauseRequested,
                onProgress: (done, total) => { if (alive) statusText = `已核实 ${done}/${total} 项…`; },
            });
            if (!alive) return;
            report = nextReport;
            if (report.imported > before) onImported(report.imported - before);
        } catch (error) {
            if (alive) errorText = error instanceof Error ? error.message : String(error);
        } finally {
            if (alive) retrying = false;
        }
    }

    async function runExport() {
        if (!alive || exporting) return;
        exporting = true;
        errorText = "";
        statusText = "";
        try {
            const text = await exportVcfText(settings);
            if (!alive) return;
            if (!text) {
                statusText = "还没有可导出的联系人。";
                return;
            }
            downloadVcf(text);
            statusText = "已导出 vCard 文件（浏览器下载）。";
        } catch (error) {
            if (alive) errorText = error instanceof Error ? error.message : String(error);
        } finally {
            if (alive) exporting = false;
        }
    }

    function downloadVcf(text: string) {
        const pad = (value: number) => String(value).padStart(2, "0");
        const now = new Date();
        const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
        downloadText(text, `小驴人脉_${stamp}.vcf`, "text/vcard;charset=utf-8");
    }

    function downloadDiagnostics() {
        if (!report || importing || retrying) return;
        const results = report.results.map((item) => ({
            planIndex: item.planIndex, source: "vcard", status: item.status, failedFields: item.failedFields,
            checkpoint: item.checkpoint ? {
                requestId: item.checkpoint.requestId, notebookId: item.checkpoint.notebookId,
                avId: item.checkpoint.avId, dbBlockId: item.checkpoint.dbBlockId,
                docId: item.checkpoint.docId, itemId: item.checkpoint.itemId, state: item.checkpoint.state,
            } : undefined,
        }));
        downloadText(JSON.stringify({ exportedAt: new Date().toISOString(), results }, null, 2), "小驴人脉_vcard诊断.json", "application/json;charset=utf-8");
    }

    function downloadText(content: string, filename: string, type: string) {
        const blob = new Blob([content], { type });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = filename;
        anchor.click();
        URL.revokeObjectURL(url);
    }
</script>

<div class="lvct-import lvct-vcard">
    <details class="lvct-vcard__boundary" open>
        <summary>通讯录交换边界</summary>
        <div class="lvct-vcard__boundary-grid">
            <div>
                <b>当前支持</b>
                <p>姓名、电话、邮箱、网站、公历生日、标签；本插件导出的农历生日可通过 <code>X-LVCT-BDAY-LUNAR</code> 回读。</p>
            </div>
            <div>
                <b>不会写入 vCard</b>
                <p>组织任职、关系图、互动、跟进、提醒、本人标记、AI 内容、思源文档 ID 和私密资料。</p>
            </div>
            <div>
                <b>导入限制</b>
                <p>当前联系人模型为单电话/邮箱/网站字段；多个电话会合并显示，多个邮箱和网站只取首项。ORG、ADR、NOTE、PHOTO、UID 等会标记为忽略或待核对。</p>
            </div>
            <div>
                <b>在线同步状态</b>
                <p>这里是本地 .vcf 文件交换，当前尚未连接 CardDAV 服务器；CardDAV 需要单独的地址簿、权限、冲突和删除确认流程。</p>
            </div>
        </div>
    </details>
    <div class="lvct-vcard__export">
        <div class="lvct-vcard__section-title">{text("vcardExportTitle", "导出")}</div>
        <div class="fn__flex">
            <button class="b3-button b3-button--outline" onclick={runExport} disabled={exporting || parsing || importing || retrying}>
                {exporting ? text("vcardExporting", "导出中…") : text("vcardExportAll", "导出全部联系人为 .vcf")}
            </button>
            <span class="ft__smaller ft__on-surface lvct-vcard__note">{text("vcardExportNote", "含电话/邮箱/网站/生日/标签；微信不导出（无标准属性）。当前多值电话会作为一个文本字段导出，请核对。")}</span>
        </div>
    </div>

    <div class="lvct-vcard__section-title">{text("vcardImportTitle", "导入")}</div>
    <div class="lvct-people__toolbar fn__flex">
            <button class="b3-button b3-button--outline" onclick={() => guardedClose(() => fileInput?.click())} disabled={parsing || importing || exporting || retrying}>
            {parsing ? text("vcardParsing", "解析中…") : text("vcardPickFile", "选择 .vcf 文件…")}
        </button>
        <input
            bind:this={fileInput}
            class="lvct-vcard__file"
            type="file"
            accept=".vcf,text/vcard,text/x-vcard"
            onchange={onFileChange}
        />
        <span class="ft__smaller ft__on-surface fn__flex-1 lvct-vcard__note">
            {text("vcardFormatsNote", "支持通讯录应用导出的 vCard 2.1/3.0/4.0；读取 FN/N、TEL、EMAIL、URL、BDAY、CATEGORIES，其他字段会在预览中标出。")}
        </span>
    </div>

    {#if parsing}
        <ViewState compact loading title={text("vcardParsingTitle", "正在解析通讯录并检查重名")} />
    {:else if importing}
        <ViewState compact loading title={text("vcardImportingTitle", "正在导入联系人")} description={statusText} />
        <button class="b3-button b3-button--outline" onclick={() => (pauseRequested = true)} disabled={pauseRequested}>{pauseRequested ? "当前项结束后暂停" : "暂停"}</button>
    {:else if errorText && !report}
        <ViewState compact error title={text("vcardErrorTitle", "通讯录处理失败")} description={errorText}>
            <button class="b3-button b3-button--outline" onclick={() => fileInput?.click()}>{text("vcardPickAgain", "重新选择文件")}</button>
        </ViewState>
    {:else if report}
        {#if errorText}<p class="lvct-form__error" role="alert">{errorText}；原队列及断点保留。</p>{/if}
        <p role="status">已确认 {report.expected ?? lastChosen.length} 项；未执行 {reportPending.length} 项。{report.paused ? "已暂停，原队列保留" : "本轮结束"}</p>
        {#if retrying}<p role="status">{statusText}</p><button class="b3-button b3-button--outline" onclick={() => (pauseRequested = true)} disabled={pauseRequested}>当前项结束后暂停</button>{/if}
        <ViewState compact icon={retryable ? "!" : "✓"}
            title={retryable ? text("vcardReportPartialTitle", "导入结束，部分联系人未完成") : text("vcardReportDoneTitle", "导入完成")}
            description={text("vcardReportSummary", "新增 {imported} 人，跳过 {skipped} 人，失败 {failed} 人，待核对 {unknown} 人。", { imported: report.imported, skipped: reportSkipped.length, failed: reportFailed.length, unknown: reportUnknown.length })}>
            <button class="b3-button b3-button--text" onclick={() => guardedClose(onClose)} disabled={operationBusy}>{text("vcardBackToPeople", "返回联系人")}</button>
            <button class="b3-button b3-button--outline" onclick={() => guardedClose(() => fileInput?.click())} disabled={retrying}>{text("vcardPickOtherFile", "选择其他文件")}</button>
            <button class="b3-button b3-button--outline" onclick={downloadDiagnostics} disabled={retrying}>{text("vcardDiagnostics", "保存诊断信息")}</button>
            {#if retryable}
                <button class="b3-button b3-button--outline" onclick={() => runRetry()} disabled={retrying}>
                    {retrying ? text("vcardRetrying", "核对并重试中…") : text("vcardRetryButton", "核对名册并重试（{n} 项）", { n: reportFailed.length + reportUnknown.length + reportPending.length })}
                </button>
                {#if reportFailed.length + reportUnknown.length > 0}
                    <button class="b3-button b3-button--outline" onclick={() => runRetry(true)} disabled={retrying}>仅核实重试失败/未知项</button>
                {/if}
            {/if}
        </ViewState>

        <div class="lvct-vcard__report">
            {#if reportPending.length}<details open><summary>未执行（{reportPending.length}）</summary><ul>{#each reportPending as item (item.planIndex)}<li>卡片 {item.planIndex + 1} · {item.name} · 保留原队列</li>{/each}</ul></details>{/if}
            {#if retryable}
                <p class="ft__smaller ft__on-surface">{text("vcardCheckpointWarning", "未完成项的重试断点只保留在本窗口。关闭或更换文件前请保存诊断信息；重新导入不会恢复这些断点。")}</p>
            {/if}
            {#if reportImported.length > 0}
                <details open>
                    <summary>{text("vcardReportImported", "✓ 成功（{n}）", { n: reportImported.length })}</summary>
                    <ul>{#each reportImported as item (item.planIndex)}<li>{item.name}</li>{/each}</ul>
                </details>
            {/if}
            {#if reportSkipped.length > 0}
                <details>
                    <summary>{text("vcardReportSkipped", "⊘ 跳过（{n}）", { n: reportSkipped.length })}</summary>
                    <ul>{#each reportSkipped as item (item.planIndex)}<li>{text("vcardItemLine", "{name}：{reason}", { name: item.name, reason: item.reason ?? "" })}</li>{/each}</ul>
                </details>
            {/if}
            {#if reportFailed.length > 0}
                <details open>
                    <summary>{text("vcardReportFailed", "! 失败（{n}）", { n: reportFailed.length })}</summary>
                    <ul>{#each reportFailed as item (item.planIndex)}<li>{item.name}：{item.reason}</li>{/each}</ul>
                </details>
            {/if}
            {#if reportUnknown.length > 0}
                <details open>
                    <summary>{text("vcardReportUnknown", "? 待核对（{n}）", { n: reportUnknown.length })}</summary>
                    <ul>{#each reportUnknown as item (item.planIndex)}<li>
                        {text("vcardUnknownLine", "{name}：{reason}（重试前会先核实原请求文档）", { name: item.name, reason: item.reason ?? "" })}
                        {#if item.checkpoint}
                            <p class="ft__smaller ft__on-surface">{text("vcardCheckpointIds", "请求：{request}；文档：{doc}", { request: item.checkpoint.requestId, doc: item.checkpoint.docId ?? text("vcardDocumentUnknown", "尚未核实") })}</p>
                        {/if}
                    </li>{/each}</ul>
                </details>
            {/if}
        </div>
    {:else if plans && plans.length === 0}
        <div class="lvct-empty lvct-empty--compact">
            <div class="lvct-empty__icon" aria-hidden="true">⌁</div>
            <b>没有可导入的联系人</b>
            <p>{statusText || "请选择包含姓名字段的 vCard 文件。"}</p>
            <div class="lvct-empty__actions">
                <button class="b3-button b3-button--outline" onclick={() => fileInput?.click()} disabled={parsing || importing}>重新选择文件</button>
            </div>
        </div>
    {:else if plans}
        <p role="status">来源：vCard 文件；已选择 {selectedCount} 项，目标为逐卡独立请求文档。同名须按下列稳定 ID 核对，勾选同名项表示另建独立人物。</p>
        <div class="lvct-vcard__preview-summary" role="status" aria-label="导入映射摘要">
            <span>已选 {previewStats.cards} 张卡片 · 将写入字段 {previewStats.mapped} 项</span>
            <span>将忽略属性 {previewStats.ignored} 项</span>
            <span class:lvct-vcard__preview-summary--warn={previewStats.review > 0}>待人工核对 {previewStats.review} 项</span>
        </div>
        <div class="lvct-import__list">
            <label class="lvct-import__row lvct-import__row--head">
                <input
                    class="b3-switch"
                    type="checkbox"
                    checked={plans.some((plan) => !plan.duplicate) && plans.every((plan, index) => plan.duplicate || selected[index])}
                    disabled={!plans.some((plan) => !plan.duplicate)}
                    onchange={(event) => toggleAll((event.currentTarget as HTMLInputElement).checked)}
                />
                <span>{text("vcardSelectNonDuplicate", "批量选择非同名项（已选 {selected}/{total}；{duplicates} 项同名需逐项确认）", { selected: selectedCount, total: plans.length, duplicates: duplicateCount })}</span>
            </label>
            {#each plans as plan, index (index)}
                <label class="lvct-import__row" class:lvct-import__row--dup={plan.duplicate}>
                    <input
                        class="b3-switch"
                        type="checkbox"
                        checked={!!selected[index]}
                        disabled={Boolean(plan.unresolvedDocIds?.length)}
                        onchange={(event) => selectPlan(index, (event.currentTarget as HTMLInputElement).checked)}
                    />
                    <span class="lvct-import__name">{index + 1} · <b>{plan.contact.name}</b></span>
                    <span class="ft__smaller ft__on-surface lvct-import__path">
                        {plan.contact.phone || "—"}{plan.contact.birthday ? ` · ${formatBirthdayDisplay(plan.contact.birthday, plan.contact.isLunar)}` : ""}
                    </span>
                    <span class="ft__smaller">{(plan.mappings ?? []).filter((mapping) => mapping.state === "mapped").map((mapping) => `${mapping.sourceField} → ${mapping.targetField}：${mapping.value}`).join("；")}</span>
                    {#if (plan.contact.unsupportedProperties?.length ?? 0) > 0}
                        <span class="ft__smaller ft__on-surface">{text("vcardIgnoredProperties", "已忽略：{properties}", { properties: plan.contact.unsupportedProperties?.join("、") ?? "" })}</span>
                    {/if}
                    {#if (plan.contact.needsReview?.length ?? 0) > 0}
                        <span class="ft__smaller lvct-text-danger">{text("vcardNeedsReview", "需人工核对：{properties}", { properties: plan.contact.needsReview?.join("、") ?? "" })}</span>
                    {/if}
                    {#if plan.duplicate}
                        <span class="ft__smaller ft__on-surface">{text("vcardConfirmDistinct", "同名默认跳过；勾选表示确认作为独立人物导入")}</span>
                        {#each plan.existingCandidates ?? [] as candidate (candidate.docId)}
                            <span class="ft__smaller ft__on-surface">{candidate.docId} · {candidate.itemId}</span>
                        {/each}
                        {#if plan.sameNameInBatch}<span class="ft__smaller">{text("vcardBatchSameName", "本文件中有同名卡片，请核对卡片序号和资料")}</span>{/if}
                    {/if}
                    {#if plan.unresolvedDocIds?.length}<span class="ft__smaller lvct-text-danger">未绑定同名文档尚未核实，已停止新建：{plan.unresolvedDocIds.join("、")}；请在文档收编中按 ID 核对。</span>{/if}
                </label>
            {/each}
        </div>
    {:else}
        <ViewState compact icon="↥" title="导入已有通讯录" description="选择通讯录导出的 .vcf 文件，预览并确认后再导入。">
            <button class="b3-button b3-button--outline" onclick={() => fileInput?.click()} disabled={exporting}>选择文件</button>
        </ViewState>
    {/if}

    {#if statusText && !importing && plans?.length !== 0}
        <div class="ft__smaller ft__on-surface lvct-vcard__status">{statusText}</div>
    {/if}

    <div class="lvct-form__actions">
        <button class="b3-button b3-button--cancel" onclick={() => guardedClose(onClose)} disabled={operationBusy}>关闭</button>
        {#if !report}
            <button class="b3-button b3-button--text" onclick={runImport} disabled={importing || parsing || exporting || !!errorText || !plans || selectedCount === 0}>
                {importing ? "导入中…" : `导入为联系人（${selectedCount}）`}
            </button>
        {/if}
    </div>
</div>
