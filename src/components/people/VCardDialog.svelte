<script lang="ts">
    /** vCard (.vcf) 导入导出：文件解析预览（同名默认跳过）→ 批量建人；名册导出为 .vcf 下载。
     * F14：逐项三段报告单（成功/跳过/失败/未知），失败与未知项可核对名册后重试 */
    import { buildVcfImportPlan, exportVcfText, importVcfContacts, mergeVcfRetryResults, pickItemResults, pickRetryCount, retryVcfContacts } from "../../services/vcard";
    import type { VcfImportPlan, VcfImportReport, VcfItemResult } from "../../services/vcard";
    import type { ContactsSettings } from "../../domain/model";
    import ViewState from "../ViewState.svelte";
    import { useCloseGuard } from "../close-guard";

    let {
        settings,
        onImported,
        onClose,
    }: {
        settings: ContactsSettings;
        onImported: (count: number) => void;
        onClose: () => void;
    } = $props();

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
    const guardedClose = useCloseGuard(() => importing || parsing || exporting || retrying, () => report === null && plans !== null && selectedCount > 0);

    const selectedCount = $derived.by(() => {
        if (!plans) return 0;
        return Object.entries(selected).filter(([, on]) => on).length;
    });
    const duplicateCount = $derived.by(() => {
        if (!plans) return 0;
        return plans.filter((plan) => plan.duplicate).length;
    });

    async function onFileChange(event: Event) {
        const input = event.currentTarget as HTMLInputElement;
        const file = input.files?.[0];
        if (!file) return;
        if (importing || exporting || parsing) return;
        parsing = true;
        plans = null;
        selected = {};
        errorText = "";
        statusText = "";
        report = null;
        try {
            const text = await file.text();
            const result = await buildVcfImportPlan(settings, text);
            plans = result;
            const next: Record<number, boolean> = {};
            result.forEach((plan, index) => (next[index] = !plan.duplicate));
            selected = next;
            if (result.length === 0) {
                statusText = "没有解析到可导入的联系人（vCard 卡片需包含 FN 或 N 姓名属性）。";
            }
        } catch (error) {
            errorText = error instanceof Error ? error.message : String(error);
        } finally {
            parsing = false;
            input.value = "";
        }
    }

    function toggleAll(on: boolean) {
        if (!plans) return;
        const next: Record<number, boolean> = {};
        plans.forEach((plan, index) => {
            if (!plan.duplicate && on) next[index] = true;
        });
        selected = next;
    }

    async function runImport() {
        if (importing || parsing || exporting || errorText || report || !plans || selectedCount === 0) return;
        importing = true;
        errorText = "";
        try {
            // 记录勾选项与其全局下标（服务层 results.planIndex 原样回传，重试据此定位）
            const chosenEntries = plans
                .map((plan, planIndex) => ({ plan, planIndex }))
                .filter(({ planIndex }) => selected[planIndex]);
            lastChosen = chosenEntries;
            const result = await importVcfContacts(settings, chosenEntries, (done, total) => {
                statusText = `导入中 ${done}/${total}…`;
            });
            // 同名未勾选项不在服务入参内，在此补进逐项报告（planIndex 指回 plans）
            plans.forEach((plan, planIndex) => {
                if (plan.duplicate && !selected[planIndex]) {
                    result.results.unshift({ planIndex, name: plan.contact.name, status: "skipped", reason: "名册已有同名，默认跳过" });
                }
            });
            report = result;
            statusText = "";
            if (report.imported > 0) onImported(report.imported);
        } catch (error) {
            errorText = error instanceof Error ? error.message : String(error);
        } finally {
            importing = false;
        }
    }

    // ---- F14 三段报告单 ----
    const reportResults: VcfItemResult[] = $derived(pickItemResults(report));
    const reportImported = $derived(reportResults.filter((item) => item.status === "imported"));
    const reportSkipped = $derived(reportResults.filter((item) => item.status === "skipped"));
    const reportFailed = $derived(reportResults.filter((item) => item.status === "failed"));
    const reportUnknown = $derived(reportResults.filter((item) => item.status === "unknown"));
    const retryable: boolean = $derived(pickRetryCount(report) > 0);

    async function runRetry() {
        if (retrying || !plans || !report) return;
        const failedNames = new Set([...report.failed.map((item) => item.name), ...report.unknown.map((item) => item.name)]);
        const retryPlans = report.results
            .filter((item) => (item.status === "failed" || item.status === "unknown") && failedNames.has(item.name) && item.planIndex >= 0)
            .map((item) => {
                const entry = lastChosen.find((chosen) => chosen.planIndex === item.planIndex);
                return entry ? { planIndex: item.planIndex, plan: entry.plan } : null;
            })
            .filter((entry): entry is { planIndex: number; plan: VcfImportPlan } => Boolean(entry));
        if (retryPlans.length === 0) return;
        retrying = true;
        errorText = "";
        try {
            const retryResults: VcfItemResult[] = await retryVcfContacts(settings, retryPlans);
            const merged = mergeVcfRetryResults(report, retryResults);
            report = merged.report;
            if (merged.newlyImported > 0) onImported(merged.newlyImported);
        } catch (error) {
            errorText = error instanceof Error ? error.message : String(error);
        } finally {
            retrying = false;
        }
    }

    async function runExport() {
        if (exporting) return;
        exporting = true;
        errorText = "";
        statusText = "";
        try {
            const text = await exportVcfText(settings);
            if (!text) {
                statusText = "还没有可导出的联系人。";
                return;
            }
            downloadVcf(text);
            statusText = "已导出 vCard 文件（浏览器下载）。";
        } catch (error) {
            errorText = error instanceof Error ? error.message : String(error);
        } finally {
            exporting = false;
        }
    }

    function downloadVcf(text: string) {
        const pad = (value: number) => String(value).padStart(2, "0");
        const now = new Date();
        const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
        const blob = new Blob([text], { type: "text/vcard;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `小驴人脉_${stamp}.vcf`;
        anchor.click();
        URL.revokeObjectURL(url);
    }
</script>

<div class="lvct-import lvct-vcard">
    <div class="lvct-vcard__export">
        <div class="lvct-vcard__section-title">导出</div>
        <div class="fn__flex">
            <button class="b3-button b3-button--outline" onclick={runExport} disabled={exporting || parsing || importing}>
                {exporting ? "导出中…" : "导出全部联系人为 .vcf"}
            </button>
            <span class="ft__smaller ft__on-surface lvct-vcard__note">含电话/邮箱/网站/生日/标签；微信不导出（无标准属性）</span>
        </div>
    </div>

    <div class="lvct-vcard__section-title">导入</div>
    <div class="lvct-people__toolbar fn__flex">
        <button class="b3-button b3-button--outline" onclick={() => fileInput?.click()} disabled={parsing || importing || exporting}>
            {parsing ? "解析中…" : "选择 .vcf 文件…"}
        </button>
        <input
            bind:this={fileInput}
            class="lvct-vcard__file"
            type="file"
            accept=".vcf,text/vcard,text/x-vcard"
            onchange={onFileChange}
        />
        <span class="ft__smaller ft__on-surface fn__flex-1 lvct-vcard__note">
            支持通讯录应用导出的 vCard 2.1/3.0/4.0；只读 FN/N、TEL、EMAIL、URL、BDAY、CATEGORIES。
        </span>
    </div>

    {#if parsing}
        <ViewState compact loading title="正在解析通讯录并检查重名" />
    {:else if importing}
        <ViewState compact loading title="正在导入联系人" description={statusText} />
    {:else if errorText}
        <ViewState compact error title="通讯录处理失败" description={errorText}>
            <button class="b3-button b3-button--outline" onclick={() => fileInput?.click()}>重新选择文件</button>
        </ViewState>
    {:else if report}
        <ViewState compact icon={retryable ? "!" : "✓"}
            title={retryable ? "导入结束，部分联系人未完成" : "导入完成"}
            description={`新增 ${report.imported} 人，跳过 ${reportSkipped.length} 人，失败 ${reportFailed.length} 人，待核对 ${reportUnknown.length} 人。`}>
            <button class="b3-button b3-button--text" onclick={onClose}>返回联系人</button>
            <button class="b3-button b3-button--outline" onclick={() => fileInput?.click()}>选择其他文件</button>
            {#if retryable}
                <button class="b3-button b3-button--outline" onclick={runRetry} disabled={retrying}>
                    {retrying ? "核对并重试中…" : `核对名册并重试（${reportFailed.length + reportUnknown.length} 项）`}
                </button>
            {/if}
        </ViewState>

        <div class="lvct-vcard__report">
            {#if reportImported.length > 0}
                <details open>
                    <summary>✓ 成功（{reportImported.length}）</summary>
                    <ul>{#each reportImported as item (item.planIndex)}<li>{item.name}</li>{/each}</ul>
                </details>
            {/if}
            {#if reportSkipped.length > 0}
                <details>
                    <summary>⊘ 跳过（{reportSkipped.length}）</summary>
                    <ul>{#each reportSkipped as item (item.planIndex)}<li>{item.name}：{item.reason}</li>{/each}</ul>
                </details>
            {/if}
            {#if reportFailed.length > 0}
                <details open>
                    <summary>! 失败（{reportFailed.length}）</summary>
                    <ul>{#each reportFailed as item (item.planIndex)}<li>{item.name}：{item.reason}</li>{/each}</ul>
                </details>
            {/if}
            {#if reportUnknown.length > 0}
                <details open>
                    <summary>? 待核对（{reportUnknown.length}）</summary>
                    <ul>{#each reportUnknown as item (item.planIndex)}<li>{item.name}：{item.reason}（文档可能已创建，重试前会先核对名册）</li>{/each}</ul>
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
        <div class="lvct-import__list">
            <label class="lvct-import__row lvct-import__row--head">
                <input
                    class="b3-switch"
                    type="checkbox"
                    checked={selectedCount === plans.length - duplicateCount && selectedCount > 0}
                    onchange={(event) => toggleAll((event.currentTarget as HTMLInputElement).checked)}
                />
                <span>全选（{selectedCount}/{plans.length} 人{duplicateCount > 0 ? `，${duplicateCount} 人同名已跳过` : ""}）</span>
            </label>
            {#each plans as plan, index (index)}
                <label class="lvct-import__row" class:lvct-import__row--dup={plan.duplicate}>
                    <input
                        class="b3-switch"
                        type="checkbox"
                        checked={plan.duplicate ? false : !!selected[index]}
                        disabled={plan.duplicate}
                        onchange={(event) => (selected[index] = (event.currentTarget as HTMLInputElement).checked)}
                    />
                    <span class="lvct-import__name"><b>{plan.contact.name}</b></span>
                    <span class="ft__smaller ft__on-surface lvct-import__path">
                        {plan.contact.phone || "—"}{plan.contact.birthday ? ` · ${plan.contact.birthday}${plan.contact.isLunar ? "（农历）" : ""}` : ""}
                    </span>
                    {#if plan.duplicate}
                        <span class="ft__smaller ft__on-surface">已存在，跳过</span>
                    {/if}
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
        <button class="b3-button b3-button--cancel" onclick={() => guardedClose(onClose)} disabled={importing || parsing || exporting}>关闭</button>
        <button class="b3-button b3-button--text" onclick={runImport} disabled={importing || parsing || exporting || !!errorText || !plans || selectedCount === 0 || report !== null}>
            {importing ? "导入中…" : report ? "导入完成" : `导入为联系人（${selectedCount}）`}
        </button>
    </div>
</div>
