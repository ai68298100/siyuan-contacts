<script lang="ts">
    import type { ContactsPluginFacade } from "../types";
    import type { ContactsSettings } from "../domain/model";
    import type { ViewPreferences } from "../domain/preferences";
    import type { InteractionImportSummary } from "../domain/interaction-backup";
    import { useCloseGuard } from "./close-guard";
    import StatusNotice from "./StatusNotice.svelte";
    import { SlidersHorizontal, Database, Bell, Sparkles, Plug, Info } from "@lucide/svelte";
    import { translateText } from "../domain/translation";
    import { DEFAULT_VIEW_PREFERENCES } from "../domain/preferences";
    import pluginManifest from "../../plugin.json";
    import type { FieldMapPatch, SettingsAnchorPatch, SettingsHealth } from "../services/settings-health";
    import type { ExportSummary } from "../services/export-center";
    import type { InteractionImportDiff } from "../domain/interaction-backup";

    let {
        facade,
        i18n,
        settings,
        preferences,
        onSettingsUpdated,
        onPreferencesUpdated,
        onBack,
        onInteractionsUpdated = () => {},
    }: {
        facade: ContactsPluginFacade;
        i18n?: Readonly<Record<string, string>>;
        settings: ContactsSettings;
        preferences: ViewPreferences;
        onSettingsUpdated: (settings: ContactsSettings) => void;
        onPreferencesUpdated: (preferences: ViewPreferences) => void;
        onBack: () => void;
        onInteractionsUpdated?: () => void;
    } = $props();
    const text = $derived.by(() => (key: string, fallback: string) => translateText(i18n, key, fallback));

    type SectionId = "general" | "data" | "reminder" | "ai" | "bridge" | "about";

    const sections: readonly { id: SectionId; label: string }[] = $derived([
        { id: "general", label: text("settingsGeneral", "通用") },
        { id: "data", label: text("settingsData", "数据与字段") },
        { id: "reminder", label: text("settingsReminder", "提醒") },
        { id: "ai", label: text("settingsAiPrivacy", "AI 与隐私") },
        { id: "bridge", label: text("settingsBridge", "服务桥") },
        { id: "about", label: text("settingsAbout", "关于") },
    ]);

    let activeSection: SectionId = $state("general");
    let health: SettingsHealth | null = $state(null);
    let checking = $state(false);
    let rebuilding = $state(false);
    let savingPreferences = $state(false);
    let preferencesMessage = $state("");
    let rebinding = $state(false);
    let rebindOpen = $state(false);
    let rebindMessage = $state("");
    let exportingInteractions = $state(false);
    let exportMessage = $state("");
    let exportingRoster = $state(false);
    let rosterExportMessage = $state("");
    let exportSummary: ExportSummary | null = $state(null);
    let loadingSummary = $state(false);
    let summaryRequest = 0;
    // 跟进事项导出与合并恢复（F05）
    let exportingFollowUps = $state(false);
    let followUpsExportMessage = $state("");
    let fuImportPreview: { added: number; skipped: number } | null = $state(null);
    let fuImportText = "";
    let fuImportRequest = 0;
    let fuPreviewing = $state(false);
    let fuImporting = $state(false);
    let fuImportMessage = $state("");
    let fuFileInput = $state<HTMLInputElement>();
    let importPreview: InteractionImportSummary | null = $state(null);
    let importDiff: InteractionImportDiff | null = $state(null);
    let importDiffOpen = $state(false);
    let importText = "";
    let importRequest = 0;
    let previewingImport = $state(false);
    let importingInteractions = $state(false);
    let importMessage = $state("");
    let importFileInput = $state<HTMLInputElement>();
    let mappingDraft: Record<string, string> = $state({});
    let mappingBusy = $state(false);
    // svelte-ignore state_referenced_locally
    let draft: ViewPreferences = $state({ ...preferences });
    // svelte-ignore state_referenced_locally
    let savedDraft: ViewPreferences = $state({ ...preferences });
    // svelte-ignore state_referenced_locally
    let anchorDraft: SettingsAnchorPatch = $state({
        hostDocId: settings.hostDocId,
        dbBlockId: settings.dbBlockId,
        avId: settings.avId,
    });
    let errorText = $state("");
    const guardedClose = useCloseGuard({
        busy: () => savingPreferences || rebinding || mappingBusy || importingInteractions,
        dirty: () => JSON.stringify(draft) !== JSON.stringify(savedDraft) || importText.trim().length > 0,
        changes: () => [
            ...(JSON.stringify(draft) !== JSON.stringify(savedDraft) ? [text("guardPrefsDraft", "显示偏好尚未保存")] : []),
            ...(importText.trim().length > 0 ? [text("guardImportTextDraft", "互动合并输入尚未处理")] : []),
        ],
    });

    function setHealth(value: SettingsHealth) {
        health = value;
        const next = { ...mappingDraft };
        for (const item of value.missing) {
            if (next[item.key] === undefined) next[item.key] = "";
        }
        mappingDraft = next;
    }

    async function runHealthCheck() {
        if (checking) return;
        checking = true;
        errorText = "";
        try {
            setHealth(await facade.checkSettingsHealth());
        } catch (error) {
            errorText = error instanceof Error ? error.message : String(error);
        } finally {
            checking = false;
        }
    }

    async function runRebuild() {
        if (rebuilding) return;
        rebuilding = true;
        errorText = "";
        try {
            const updated = await facade.rebuildMissingFields();
            onSettingsUpdated(updated);
            setHealth(await facade.checkSettingsHealth());
        } catch (error) {
            errorText = error instanceof Error ? error.message : String(error);
        } finally {
            rebuilding = false;
        }
    }

    async function savePreferences() {
        if (savingPreferences) return;
        savingPreferences = true;
        errorText = "";
        preferencesMessage = "";
        try {
            const updated = await facade.saveViewPreferences(draft);
            draft = { ...updated };
            savedDraft = { ...updated };
            onPreferencesUpdated(updated);
            preferencesMessage = "偏好已保存";
        } catch (error) {
            errorText = error instanceof Error ? error.message : String(error);
        } finally {
            savingPreferences = false;
        }
    }

    async function runRebind() {
        if (rebinding) return;
        if (!window.confirm("将切换插件当前使用的数据锚点。请确认这三个 ID 指向已有联系人数据库，继续吗？")) return;
        rebinding = true;
        errorText = "";
        rebindMessage = "";
        try {
            const updated = await facade.rebindSettings({ ...anchorDraft });
            anchorDraft = {
                hostDocId: updated.hostDocId,
                dbBlockId: updated.dbBlockId,
                avId: updated.avId,
            };
            onSettingsUpdated(updated);
            setHealth(await facade.checkSettingsHealth());
            rebindMessage = "锚点已更新，已重新检查字段健康状态";
        } catch (error) {
            errorText = error instanceof Error ? error.message : String(error);
        } finally {
            rebinding = false;
        }
    }

    async function refreshExportSummary() {
        const request = ++summaryRequest;
        loadingSummary = true;
        try {
            const summary = await facade.loadExportSummary();
            if (request === summaryRequest) exportSummary = summary;
        } catch {
            // 数量仅辅助展示；读取失败降级为不显示，不阻塞导出动作
            if (request === summaryRequest) exportSummary = null;
        } finally {
            if (request === summaryRequest) loadingSummary = false;
        }
    }

    $effect(() => {
        if (activeSection === "data") void refreshExportSummary();
    });

    async function runExportInteractions() {
        if (exportingInteractions) return;
        exportingInteractions = true;
        errorText = "";
        exportMessage = "";
        try {
            const text = await facade.exportInteractionJson();
            const blob = new Blob([text], { type: "application/json;charset=utf-8" });
            const url = URL.createObjectURL(blob);
            const anchor = document.createElement("a");
            anchor.href = url;
            anchor.download = `小驴人脉_互动事件_${new Date().toISOString().slice(0, 10)}.json`;
            anchor.click();
            URL.revokeObjectURL(url);
            exportMessage = "互动事件与原始数据快照已导出";
        } catch (error) {
            errorText = error instanceof Error ? error.message : String(error);
        } finally {
            exportingInteractions = false;
        }
    }

    async function runExportRoster() {
        if (exportingRoster) return;
        exportingRoster = true;
        errorText = "";
        rosterExportMessage = "";
        try {
            const vcf = await facade.exportRosterVcf();
            const blob = new Blob([vcf], { type: "text/vcard;charset=utf-8" });
            const url = URL.createObjectURL(blob);
            const anchor = document.createElement("a");
            anchor.href = url;
            anchor.download = `小驴人脉_联系人_${new Date().toISOString().slice(0, 10)}.vcf`;
            anchor.click();
            URL.revokeObjectURL(url);
            rosterExportMessage = "全量名册已导出为 vCard 3.0";
        } catch (error) {
            errorText = error instanceof Error ? error.message : String(error);
        } finally {
            exportingRoster = false;
        }
    }

    async function runExportFollowUps() {
        if (exportingFollowUps) return;
        exportingFollowUps = true;
        errorText = "";
        followUpsExportMessage = "";
        try {
            const text = await facade.exportFollowUpsJson();
            const blob = new Blob([text], { type: "application/json;charset=utf-8" });
            const url = URL.createObjectURL(blob);
            const anchor = document.createElement("a");
            anchor.href = url;
            anchor.download = `小驴人脉_跟进事项_${new Date().toISOString().slice(0, 10)}.json`;
            anchor.click();
            URL.revokeObjectURL(url);
            followUpsExportMessage = "跟进事项与原始数据快照已导出";
        } catch (error) {
            errorText = error instanceof Error ? error.message : String(error);
        } finally {
            exportingFollowUps = false;
        }
    }

    async function selectFollowUpBackup(event: Event) {
        if (fuImporting) return;
        const request = ++fuImportRequest;
        const file = (event.currentTarget as HTMLInputElement).files?.[0];
        fuImportPreview = null;
        fuImportText = "";
        fuImportMessage = "";
        errorText = "";
        fuPreviewing = Boolean(file);
        if (!file) return;
        try {
            const text = await file.text();
            if (request !== fuImportRequest) return;
            const preview = await facade.previewFollowUpsImport(text);
            if (request !== fuImportRequest) return;
            fuImportText = text;
            fuImportPreview = preview;
        } catch (error) {
            if (request === fuImportRequest) errorText = error instanceof Error ? error.message : String(error);
        } finally {
            if (request === fuImportRequest) fuPreviewing = false;
        }
    }

    async function runImportFollowUps() {
        if (fuImporting || fuPreviewing || !fuImportPreview) return;
        if (!window.confirm("将合并所选跟进备份：现状优先按事项 ID，只新增缺失条目，不覆盖已有内容。确认继续吗？")) return;
        fuImporting = true;
        errorText = "";
        fuImportMessage = "";
        try {
            const result = await facade.importFollowUpsJson(fuImportText);
            fuImportMessage = `合并完成：新增 ${result.added} 条，跳过 ${result.skipped} 条`;
            fuImportPreview = null;
            fuImportText = "";
            if (fuFileInput) fuFileInput.value = "";
        } catch (error) {
            errorText = error instanceof Error ? error.message : String(error);
        } finally {
            fuImporting = false;
        }
    }

    async function selectInteractionBackup(event: Event) {
        if (importingInteractions) return;
        const request = ++importRequest;
        const file = (event.currentTarget as HTMLInputElement).files?.[0];
        importPreview = null;
        importText = "";
        importMessage = "";
        errorText = "";
        previewingImport = Boolean(file);
        if (!file) return;
        try {
            const text = await file.text();
            if (request !== importRequest) return;
            const preview = await facade.previewInteractionImport(text);
            if (request !== importRequest) return;
            importText = text;
            importPreview = preview;
            try {
                importDiff = await facade.previewInteractionImportDiff(text);
            } catch {
                importDiff = null; // 明细为辅助信息，失败不影响合并
            }
        } catch (error) {
            if (request === importRequest) errorText = error instanceof Error ? error.message : String(error);
        } finally {
            if (request === importRequest) previewingImport = false;
        }
    }

    async function runImportInteractions() {
        if (importingInteractions || previewingImport || !importPreview) return;
        if (!window.confirm("将合并所选互动备份，不覆盖整个库、不创建联系人文档。备份中的删除标记会移除对应互动，已删除记录不会复活。确认继续吗？")) return;
        importingInteractions = true;
        errorText = "";
        importMessage = "";
        try {
            const result = await facade.importInteractionJson(importText);
            importMessage = `合并完成：新增 ${result.added} 条，跳过 ${result.skipped} 条，移除 ${result.removed} 条，新增删除标记 ${result.tombstonesAdded} 条`;
            importPreview = null;
            importDiff = null;
            importDiffOpen = false;
            importText = "";
            if (importFileInput) importFileInput.value = "";
            onInteractionsUpdated();
        } catch (error) {
            errorText = error instanceof Error ? error.message : String(error);
        } finally {
            importingInteractions = false;
        }
    }

    async function runFieldMapRepair() {
        if (mappingBusy || !health) return;
        const patch = {} as FieldMapPatch;
        for (const item of health.missing) {
            const columnId = mappingDraft[item.key];
            if (columnId) (patch as Record<string, string>)[item.key] = columnId;
        }
        if (Object.keys(patch).length === 0) {
            errorText = "请至少为一个缺失字段选择现有列";
            return;
        }
        mappingBusy = true;
        errorText = "";
        try {
            const updated = await facade.repairFieldMap(patch);
            onSettingsUpdated(updated);
            setHealth(await facade.checkSettingsHealth());
        } catch (error) {
            errorText = error instanceof Error ? error.message : String(error);
        } finally {
            mappingBusy = false;
        }
    }
</script>

<div class="lvct-settings">
    <div class="lvct-settings__topbar">
        <button class="b3-button b3-button--outline" onclick={() => guardedClose(onBack)}>← {text("settingsBack", "返回工作台")}</button>
    </div>

    <div class="lvct-settings__layout">
        <nav class="lvct-settings__nav" aria-label="设置分区">
            {#each sections as section (section.id)}
                <button
                    class="lvct-settings__nav-item"
                    class:lvct-settings__nav-item--active={activeSection === section.id}
                    aria-current={activeSection === section.id ? "page" : undefined}
                    onclick={() => (activeSection = section.id)}
                >
                    <span aria-hidden="true">
                        {#if section.id === "general"}<SlidersHorizontal size={16}/>
                        {:else if section.id === "data"}<Database size={16}/>
                        {:else if section.id === "reminder"}<Bell size={16}/>
                        {:else if section.id === "ai"}<Sparkles size={16}/>
                        {:else if section.id === "bridge"}<Plug size={16}/>
                        {:else}<Info size={16}/>{/if}
                    </span>{section.label}
                </button>
            {/each}
        </nav>

        <div class="lvct-settings__body">
            <StatusNotice message={errorText ? `操作失败：${errorText}` : ""} error />

            {#if activeSection === "general"}
                <section class="lvct-settings__panel">
                    <h2>{text("settingsGeneral", "通用")}</h2>
                    <p class="lvct-settings__desc">界面与默认行为偏好，仅存于插件本地 JSON，不影响数据库内容。</p>

                    <div class="lvct-settings__row">
                        <div><b>联系人笔记本</b><small>工作空间的固定数据锚点</small></div>
                        <span class="lvct-settings__status">{settings.notebookName}</span>
                    </div>
                    <div class="lvct-settings__row">
                        <div><b>联系人总表</b><small>数据库宿主文档</small></div>
                        <button class="b3-button b3-button--text" onclick={() => facade.openHostDoc()}>打开文档</button>
                    </div>

                    <div class="lvct-settings__form-grid">
                        <label class="lvct-form__item">
                            <span>默认打开页面</span>
                            <select class="b3-select fn__block" bind:value={draft.defaultView}>
                                <option value="home">首页</option>
                                <option value="people">联系人</option>
                                <option value="graph">关系图谱</option>
                            </select>
                        </label>
                        <label class="lvct-form__item">
                            <span>联系人默认排序</span>
                            <select class="b3-select fn__block" bind:value={draft.peopleSort}>
                                <option value="name">按姓名</option>
                                <option value="group">按分组</option>
                                <option value="birthday">按生日临近</option>
                                <option value="recent">按最近互动</option>
                            </select>
                        </label>
                        <label class="lvct-form__item">
                            <span>联系人默认形态</span>
                            <select class="b3-select fn__block" bind:value={draft.peopleView}>
                                <option value="card">卡片</option>
                                <option value="table">表格</option>
                            </select>
                        </label>
                    </div>

                    <div class="lvct-settings__row">
                        <div><b>联系人显示</b><small>表格列的显隐与顺序在联系人页「列设置」中调整；姓名列固定显示</small></div>
                        <button class="b3-button b3-button--outline" onclick={() => {
                            draft = {
                                ...draft,
                                peopleView: DEFAULT_VIEW_PREFERENCES.peopleView,
                                tableColumns: [...DEFAULT_VIEW_PREFERENCES.tableColumns],
                            };
                        }}>恢复默认显示</button>
                    </div>

                    <label class="lvct-settings__switch-row">
                        <div><b>启动时打开工作台</b><small>思源启动后自动展开人脉首页</small></div>
                        <span class="lvct-switch"><input type="checkbox" bind:checked={draft.openOnStartup} /><span class="lvct-switch__track"><span class="lvct-switch__thumb"></span></span></span>
                    </label>

                    <div class="lvct-settings__actions">
                        <button class="b3-button b3-button--outline" onclick={savePreferences} disabled={savingPreferences}>
                            {savingPreferences ? "保存中…" : "保存偏好"}
                        </button>
                        <StatusNotice message={preferencesMessage} onDismiss={() => (preferencesMessage = "")} />
                    </div>
                </section>
            {:else if activeSection === "data"}
                <section class="lvct-settings__panel">
                    <h2>{text("settingsData", "数据与字段")}</h2>
                    <p class="lvct-settings__desc">字段 ID 固化在设置中，列名可在思源里自由修改；若列被删除可在此恢复或补建。</p>

                    <div class="lvct-settings__row">
                        <div><b>数据锚点</b><small>文档、数据库块和属性视图 ID</small></div>
                        <button class="b3-button b3-button--outline" onclick={() => (rebindOpen = !rebindOpen)}>
                            {rebindOpen ? "收起" : "重新绑定已有数据库"}
                        </button>
                    </div>
                    {#if rebindOpen}
                        <div class="lvct-settings__rebind">
                            <p>仅在迁移或恢复了已有数据库时使用。提交前会验证属性视图并按原 ID 或标准字段名恢复映射，剩余缺失字段可再通过健康检查补建。</p>
                            <div class="lvct-settings__rebind-grid">
                                <label class="lvct-form__item"><span>宿主文档 ID</span><input class="b3-text-field fn__block" bind:value={anchorDraft.hostDocId} /></label>
                                <label class="lvct-form__item"><span>数据库块 ID</span><input class="b3-text-field fn__block" bind:value={anchorDraft.dbBlockId} /></label>
                                <label class="lvct-form__item"><span>属性视图 ID</span><input class="b3-text-field fn__block" bind:value={anchorDraft.avId} /></label>
                            </div>
                            <div class="lvct-settings__actions">
                                <button class="b3-button b3-button--outline" onclick={runRebind} disabled={rebinding}>{rebinding ? "验证并保存中…" : "验证并重新绑定"}</button>
                                <StatusNotice message={rebindMessage} onDismiss={() => (rebindMessage = "")} />
                            </div>
                        </div>
                    {/if}

                    <div class="lvct-settings__sub-heading">
                        <b>导出中心</b>
                        {#if loadingSummary}<span class="ft__smaller ft__on-surface">统计中…</span>{/if}
                    </div>
                    <p class="lvct-settings__inline-hint">人物文档与联系人数据库是思源原生数据，随工作区保留；以下两项导出都不是完整备份。</p>
                    <div class="lvct-settings__row">
                        <div>
                            <b>全量名册 vCard</b>
                            <small>{#if exportSummary}{exportSummary.peopleCount} 位联系人 · {/if}标准 vCard 3.0，通讯录可导入；不含互动与关系，微信号不导出</small>
                        </div>
                        <button class="b3-button b3-button--outline" onclick={runExportRoster} disabled={exportingRoster || (exportSummary !== null && exportSummary.peopleCount === 0)}>
                            {exportingRoster ? "导出中…" : "导出 .vcf"}
                        </button>
                    </div>
                    {#if exportSummary && exportSummary.peopleCount === 0}
                        <p class="lvct-settings__inline-hint">名册为空：先在联系人页新建或收编联系人，再来导出。</p>
                    {/if}
                    <StatusNotice message={rosterExportMessage} onDismiss={() => (rosterExportMessage = "")} actionLabel="再次导出" onAction={runExportRoster} />
                    <div class="lvct-settings__row">
                        <div>
                            <b>互动事件 JSON</b>
                            <small>{#if exportSummary}{exportSummary.interactionCount} 条事件 · {/if}原始数据快照、事件与墓碑；不含人物文档与数据库</small>
                        </div>
                        <button class="b3-button b3-button--outline" onclick={runExportInteractions} disabled={exportingInteractions}>
                            {exportingInteractions ? "导出中…" : "导出 JSON"}
                        </button>
                    </div>
                    <StatusNotice message={exportMessage} onDismiss={() => (exportMessage = "")} actionLabel="再次导出" onAction={runExportInteractions} />
                    <div class="lvct-settings__row">
                        <div>
                            <b>跟进事项 JSON</b>
                            <small>日期型联系计划（含原始快照）；不含人物文档与互动记录</small>
                        </div>
                        <button class="b3-button b3-button--outline" onclick={runExportFollowUps} disabled={exportingFollowUps}>
                            {exportingFollowUps ? "导出中…" : "导出 JSON"}
                        </button>
                    </div>
                    <StatusNotice message={followUpsExportMessage} onDismiss={() => (followUpsExportMessage = "")} actionLabel="再次导出" onAction={runExportFollowUps} />

                    <div class="lvct-settings__row">
                        <label for="lvct-interaction-backup"><b>合并互动备份</b></label>
                        <input id="lvct-interaction-backup" class="b3-text-field lvct-settings__backup-input" type="file" accept=".json,application/json" bind:this={importFileInput} onchange={selectInteractionBackup} disabled={importingInteractions} />
                    </div>
                    {#if previewingImport}<p class="lvct-settings__inline-hint" role="status">正在检查备份…</p>{/if}
                    {#if importPreview}
                        <p class="lvct-settings__inline-hint">预计新增 {importPreview.added} 条，跳过 {importPreview.skipped} 条，移除 {importPreview.removed} 条，新增删除标记 {importPreview.tombstonesAdded} 条</p>
                        {#if importDiff}
                            <button class="b3-button b3-button--text" aria-expanded={importDiffOpen} onclick={() => (importDiffOpen = !importDiffOpen)}>
                                {importDiffOpen ? "收起差异明细" : "查看差异明细"}
                            </button>
                            {#if importDiffOpen}
                                <div class="lvct-settings__diff" role="region" aria-label="备份差异明细">
                                    <div class="lvct-settings__diff-section">
                                        <b>将新增（{importDiff.added.length} 条）</b>
                                        {#if importDiff.added.length === 0}<p class="ft__smaller ft__on-surface">没有将新增的事件。</p>{/if}
                                        {#each importDiff.added as entry (entry.eventId)}
                                            <div class="lvct-settings__diff-row">
                                                {entry.localDate} · {entry.personName ?? "人物不可达（可能已解绑）"} · {entry.note || "互动"} · {entry.source}
                                                {#if !entry.personFound}<span class="lvct-form__error">人物不可达</span>{/if}
                                            </div>
                                        {/each}
                                    </div>
                                    {#if importDiff.skipped.length > 0}
                                        <div class="lvct-settings__diff-section">
                                            <b>将跳过（{importDiff.skipped.length} 条）</b>
                                            {#each importDiff.skipped as entry (entry.eventId)}
                                                <div class="lvct-settings__diff-row">
                                                    {entry.localDate} · {entry.personName ?? "人物不可达（可能已解绑）"} · {entry.note || "互动"} · {entry.reason}
                                                </div>
                                            {/each}
                                        </div>
                                    {/if}
                                    <div class="lvct-settings__diff-section">
                                        <b>删除标记影响（{importDiff.tombstoneHits.length} 个标记）</b>
                                        {#if importDiff.tombstoneHits.length === 0}<p class="ft__smaller ft__on-surface">备份中没有删除标记。</p>{/if}
                                        {#each importDiff.tombstoneHits as hit (hit.tombstoneId)}
                                            <div class="lvct-settings__diff-row">
                                                {#if hit.willRemove}
                                                    将移除：{hit.removed?.localDate} · {hit.removed?.note || "互动"}
                                                {:else}
                                                    当前库中无对应互动，无影响
                                                {/if}
                                            </div>
                                        {/each}
                                    </div>
                                    <p class="ft__smaller ft__on-surface">合计：备份共 {importDiff.incomingTotal} 条事件（新增 {importDiff.added.length} + 跳过 {importDiff.skipped.length}）。</p>
                                </div>
                            {/if}
                        {/if}
                    {/if}
                    <div class="lvct-settings__actions">
                        <button class="b3-button b3-button--outline" onclick={runImportInteractions} disabled={!importPreview || previewingImport || importingInteractions}>
                            {importingInteractions ? "合并中…" : "确认合并备份"}
                        </button>
                        <StatusNotice message={importMessage} onDismiss={() => (importMessage = "")} />
                    </div>

                    <div class="lvct-settings__sub-heading"><b>合并跟进备份</b></div>
                    <div class="lvct-settings__row">
                        <label for="lvct-followup-backup"><b>选择跟进备份文件</b><small>现状优先按事项 ID，只新增缺失条目</small></label>
                        <input id="lvct-followup-backup" class="b3-text-field lvct-settings__backup-input" type="file" accept=".json,application/json" bind:this={fuFileInput} onchange={selectFollowUpBackup} disabled={fuImporting} />
                    </div>
                    {#if fuPreviewing}<p class="lvct-settings__inline-hint" role="status">正在检查备份…</p>{/if}
                    {#if fuImportPreview}
                        <p class="lvct-settings__inline-hint">预计新增 {fuImportPreview.added} 条，跳过 {fuImportPreview.skipped} 条</p>
                    {/if}
                    <div class="lvct-settings__actions">
                        <button class="b3-button b3-button--outline" onclick={runImportFollowUps} disabled={!fuImportPreview || fuPreviewing || fuImporting}>
                            {fuImporting ? "合并中…" : "确认合并备份"}
                        </button>
                        <StatusNotice message={fuImportMessage} onDismiss={() => (fuImportMessage = "")} />
                    </div>

                    <div class="lvct-settings__sub-heading">
                        <b>字段健康检查</b>
                        <button class="b3-button b3-button--outline" onclick={runHealthCheck} disabled={checking}>{checking ? "检查中…" : "检查字段健康"}</button>
                    </div>

                    {#if health}
                        <div class:lvct-settings__health--ok={health.ok} class="lvct-settings__health">
                            <b>{health.ok ? "字段完整" : `发现 ${health.missing.length} 个字段缺失`}</b>
                            <span>当前数据库列：{health.columns}</span>
                        </div>
                        {#if health.missing.length > 0}
                            <ul class="lvct-settings__missing">
                                {#each health.missing as item (item.key)}<li>{item.expectedName} · {item.keyId} · {item.type}</li>{/each}
                            </ul>
                            <div class="lvct-settings__mapping">
                                <b>从现有列恢复映射</b>
                                {#each health.missing as item (item.key)}
                                    <label class="lvct-form__item">
                                        <span>{item.expectedName}（{item.type}）</span>
                                        <select class="b3-select fn__block" bind:value={mappingDraft[item.key]}>
                                            <option value="">不映射</option>
                                            {#each health.availableColumns.filter((column) => column.type === item.type) as column (column.id)}
                                                <option value={column.id}>{column.name || column.id}</option>
                                            {/each}
                                        </select>
                                    </label>
                                {/each}
                                <div class="lvct-settings__actions">
                                    <button class="b3-button b3-button--outline" onclick={runFieldMapRepair} disabled={mappingBusy}>{mappingBusy ? "保存映射中…" : "保存字段映射"}</button>
                                </div>
                            </div>
                            <div class="lvct-settings__actions">
                                <button class="b3-button b3-button--outline" onclick={runRebuild} disabled={rebuilding}>{rebuilding ? "重建中…" : "补建缺失字段"}</button>
                                <span class="ft__smaller ft__on-surface">只补建缺失列，不修改已有字段或联系人数据。</span>
                            </div>
                        {/if}
                    {:else}
                        <p class="lvct-settings__inline-hint">建议运行一次检查，确认数据库列没有被删除。</p>
                    {/if}
                </section>
            {:else if activeSection === "reminder"}
                <section class="lvct-settings__panel">
                    <h2>{text("settingsReminder", "提醒")}</h2>
                    <p class="lvct-settings__desc">首页展示近期公历和农历生日，根据互动事件计算联系间隔。</p>

                    <div class="lvct-settings__form-grid">
                        <label class="lvct-form__item">
                            <span>生日提醒窗口（天）</span>
                            <input class="b3-text-field fn__block" type="number" min="0" max="365" bind:value={draft.birthdayWindowDays} />
                        </label>
                        <label class="lvct-form__item">
                            <span>久未联系阈值（天）</span>
                            <input class="b3-text-field fn__block" type="number" min="0" max="365" bind:value={draft.staleThresholdDays} />
                        </label>
                    </div>

                    <label class="lvct-settings__switch-row">
                        <div><b>打开工作台时显示关注摘要</b><small>页面内卡片展示生日、久未联系与跟进到期，可设置当日不再展示；不发送宿主通知</small></div>
                        <span class="lvct-switch"><input type="checkbox" bind:checked={draft.summaryEnabled} /><span class="lvct-switch__track"><span class="lvct-switch__thumb"></span></span></span>
                    </label>

                    <div class="lvct-settings__actions">
                        <button class="b3-button b3-button--outline" onclick={savePreferences} disabled={savingPreferences}>
                            {savingPreferences ? "保存中…" : "保存偏好"}
                        </button>
                        <StatusNotice message={preferencesMessage} onDismiss={() => (preferencesMessage = "")} />
                    </div>
                </section>
            {:else if activeSection === "ai"}
                <section class="lvct-settings__panel">
                    <h2>{text("settingsAiPrivacy", "AI 与隐私")}</h2>
                    <p class="lvct-settings__desc">AI 一律显式触发，可全局关闭；插件不持有密钥、无后台扫描。</p>

                    <label class="lvct-settings__switch-row">
                        <div>
                            <b>显示 AI 分析入口</b>
                            <small>关闭后，捕获流程中的「AI 分析本页」等入口全部隐藏</small>
                        </div>
                        <span class="lvct-switch"><input type="checkbox" bind:checked={draft.aiEnabled} /><span class="lvct-switch__track"><span class="lvct-switch__thumb"></span></span></span>
                    </label>

                    <p class="lvct-settings__inline-hint">只有开启入口并点击「AI 分析本页」时，才会调用你自己在思源中配置的 AI 端点；笔记内容不会由插件后台扫描，也不会上传到插件维护的服务。</p>

                    <div class="lvct-settings__actions">
                        <button class="b3-button b3-button--outline" onclick={savePreferences} disabled={savingPreferences}>
                            {savingPreferences ? "保存中…" : "保存偏好"}
                        </button>
                        <StatusNotice message={preferencesMessage} onDismiss={() => (preferencesMessage = "")} />
                    </div>
                </section>
            {:else if activeSection === "bridge"}
                <section class="lvct-settings__panel">
                    <h2>{text("settingsBridge", "服务桥")}</h2>
                    <p class="lvct-settings__desc">供其他插件搜索、创建联系人和记录互动。</p>

                    <div class="lvct-settings__row">
                        <div><b>window.LvContacts</b><small>跨插件人员服务协议</small></div>
                        <span class="lvct-settings__status">{window.LvContacts ? `协议 v${window.LvContacts.protocol}` : "未挂载"}</span>
                    </div>
                    <p class="lvct-settings__inline-hint">
                        能力：{window.LvContacts?.capabilities.join("、") ?? "搜索、查人、按名创建和记录互动将在工作台初始化后提供。"}
                    </p>
                </section>
            {:else if activeSection === "about"}
                <section class="lvct-settings__panel">
                    <h2>{text("settingsAbout", "关于")}</h2>
                    <p class="lvct-settings__desc">联系人文档和思源数据库是原生数据；插件互动事件、设置和视图偏好保存在插件数据目录，卸载并删除插件数据时可能丢失。请先导出互动备份。</p>

                    <div class="lvct-settings__row">
                        <div><b>小驴人脉</b><small>数据主权：一人一文档，数据库作主干</small></div>
                        <span class="lvct-settings__status">v{pluginManifest.version}</span>
                    </div>
                    <p class="lvct-settings__inline-hint">
                        <a href="https://github.com/ai68298100/siyuan-contacts" target="_blank" rel="noreferrer">项目主页</a>
                        · 数据契约与桥接协议随仓库文档发布。
                    </p>
                </section>
            {/if}
        </div>
    </div>
</div>
