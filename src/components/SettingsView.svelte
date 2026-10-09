<script lang="ts">
    import type { ContactsPluginFacade } from "../types";
    import type { ContactsSettings } from "../domain/model";
    import type { ViewPreferences } from "../domain/preferences";
    import type { InteractionImportSummary } from "../domain/interaction-backup";
    import { useCloseGuard } from "./close-guard";
    import StatusNotice from "./StatusNotice.svelte";
    import { SlidersHorizontal, Database, Bell, Sparkles, Plug, Info } from "@lucide/svelte";
    import { translateText } from "../domain/translation";
    import { DEFAULT_VIEW_PREFERENCES, isValidPreferenceDays, normalizeViewPreferences } from "../domain/preferences";
    import { rebasePreferenceDraft } from "../domain/preferences-concurrency";
    import { savePreferenceChanges } from "../services/preferences";
    import { onDestroy, untrack, tick } from "svelte";
    import pluginManifest from "../../plugin.json";
    import type { FieldMapPatch, FieldRebuildPreview, SettingsRebindPreview, SettingsAnchorPatch, SettingsHealth } from "../services/settings-health";
    import type { AnchorCandidate, AnchorScanResult } from "../services/init";
    import type { ExportSummary } from "../services/export-center";
    import type { InteractionImportDiff } from "../domain/interaction-backup";
    import type { HealthAuditReport } from "../domain/health-audit";
    import ReviewReportDialog from "./dashboard/ReviewReportDialog.svelte";
    import type { ReminderDismissal } from "../domain/reminder-dismissals";
    import { subscribeDataChanged } from "../libs/data-events";
    import type { SelfIdentityChangePreview } from "../domain/self-identity";
    import OrgProjectionRepair from "./org/OrgProjectionRepair.svelte";
    import PersonPicker from "./people/PersonPicker.svelte";
    import type { MigrationImportResult } from "../services/migration-bundle";

    let {
        facade,
        i18n,
        settings,
        preferences,
        onSettingsUpdated,
        onPreferencesUpdated,
        onBack,
        onInteractionsUpdated = () => {},
        onOpenPeople,
    }: {
        facade: ContactsPluginFacade;
        i18n?: Readonly<Record<string, string>>;
        settings: ContactsSettings;
        preferences: ViewPreferences;
        onSettingsUpdated: (settings: ContactsSettings) => void;
        onPreferencesUpdated: (preferences: ViewPreferences) => void;
        onBack: () => void;
        onInteractionsUpdated?: () => void;
        /** C03：体检「查看」跳转联系人页（按人物 itemIds 聚焦筛选） */
        onOpenPeople?: (focus: { itemIds: readonly string[]; label: string }) => void;
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

    /* B11.3/B11.5：本人档案状态与显式改绑入口（通用分区） */
    let selfIdentity: import("../domain/self-identity").SelfIdentity | null = $state(null);
    let identityLoading = $state(true);
    let selfDesignateTarget = $state("");
    let selfBusy = $state(false);
    let selfMessage = $state("");
    let selfReadError = $state("");
    let selfPreview: SelfIdentityChangePreview | null = $state(null);
    let selfAlive = true;
    let selfReadRequest = 0;
    let selfPreviewElement: HTMLElement | undefined = $state();
    onDestroy(() => { selfAlive = false; selfReadRequest += 1; });
    let selfRoster: import("../domain/person").ContactSummary[] = $state([]);
    const selfDisplayName = $derived.by(() => {
        const identity = selfIdentity;
        if (!identity) return "";
        const person = selfRoster.find((item) => item.docId === identity.selfDocId);
        return person ? person.name : identity.selfDocId;
    });
    const designationCandidates = $derived(
        selfRoster.filter((person) => !selfIdentity || person.docId !== selfIdentity.selfDocId || person.itemId !== selfIdentity.selfItemId),
    );
    const designationPickerItems = $derived(designationCandidates.map((person) => ({
        id: person.itemId,
        label: person.name,
        hint: [person.group, person.phone || person.email, ...person.tags].filter(Boolean).join(" · ") || undefined,
        docId: person.docId,
        itemId: person.itemId,
        keywords: [person.group, person.phone, person.email, person.wechat, person.website, ...person.tags]
            .filter(Boolean).join(" ").toLowerCase(),
    })));
    const selfDesignateTargetAvailable = $derived(
        designationPickerItems.some((item) => item.id === selfDesignateTarget),
    );

    async function refreshSelfSection() {
        if (typeof facade.loadSelfIdentity !== "function") {
            identityLoading = false;
            return;
        }
        identityLoading = true;
        const request = ++selfReadRequest;
        try {
            const [identity, roster] = await Promise.all([
                facade.loadSelfIdentity(), typeof facade.listContacts === "function" ? facade.listContacts() : Promise.resolve([]),
            ]);
            if (!selfAlive || request !== selfReadRequest) return;
            selfIdentity = identity;
            selfRoster = roster;
            if (selfDesignateTarget && !roster.some((person) =>
                person.itemId === selfDesignateTarget
                && (!identity || person.docId !== identity.selfDocId || person.itemId !== identity.selfItemId))) {
                selfDesignateTarget = "";
            }
            selfReadError = "";
        } catch (error) {
            if (selfAlive && request === selfReadRequest) selfReadError = error instanceof Error ? error.message : String(error);
        } finally {
            if (selfAlive && request === selfReadRequest) identityLoading = false;
        }
    }
    $effect(() => { void refreshSelfSection(); });
    const unsubscribeSelfChanges = subscribeDataChanged(() => {
        selfReadRequest += 1;
        if (!selfBusy) void refreshSelfSection();
    });
    onDestroy(unsubscribeSelfChanges);

    async function createSelf() {
        if (selfBusy || identityLoading || selfReadError || typeof facade.createSelfProfile !== "function") return;
        selfBusy = true;
        selfMessage = "";
        try {
            const identity = await facade.createSelfProfile();
            if (!selfAlive) return;
            selfIdentity = identity;
            selfMessage = selfIdentity
                ? text("selfCreated", "已创建本人档案「我自己」并标记身份")
                : text("selfCreateFailed", "本人档案建立失败，请稍后重试");
            await refreshSelfSection();
        } catch (error) {
            if (selfAlive) selfMessage = error instanceof Error ? error.message : String(error);
        } finally {
            if (selfAlive) selfBusy = false;
        }
    }

    async function previewSelf(target: string | null) {
        if (selfBusy || identityLoading || selfReadError || typeof facade.previewSelfIdentityChange !== "function") return;
        if (target !== null && !selfDesignateTargetAvailable) {
            selfDesignateTarget = "";
            return;
        }
        selfBusy = true;
        selfMessage = "";
        try {
            const preview = await facade.previewSelfIdentityChange(target);
            if (!selfAlive) return;
            selfPreview = preview;
            await tick();
            selfPreviewElement?.focus();
        } catch (error) {
            if (selfAlive) selfMessage = error instanceof Error ? error.message : String(error);
        } finally {
            if (selfAlive) selfBusy = false;
        }
    }

    async function confirmSelfChange() {
        if (selfBusy || !selfPreview) return;
        selfBusy = true;
        selfMessage = "";
        try {
            const identity = await facade.applySelfIdentityChange(selfPreview);
            if (!selfAlive) return;
            selfIdentity = identity;
            selfPreview = null;
            selfDesignateTarget = "";
            selfMessage = identity ? text("selfDesignated", "本人身份已改绑到所选联系人（原资料保留）")
                : text("selfCleared", "已清除本人身份，人物档案与历史记录保留");
            await refreshSelfSection();
        } catch (error) {
            if (selfAlive) selfMessage = error instanceof Error ? error.message : String(error);
        } finally {
            if (selfAlive) selfBusy = false;
        }
    }

    let checking = $state(false);
    // FUNC-01.4 资料体检：只读巡检，结果按类列出（缺字段/悬空关系/孤儿互动等）
    let auditOpen = $state(false);
    let auditBusy = $state(false);
    let orgProjectionBusy = $state(false);
    let auditAlive = true;
    onDestroy(() => { auditAlive = false; });
    // B08：已暂缓提醒（reminder-dismissals）恢复入口
    let dismissedReminders: ReminderDismissal[] | null = $state(null);
    let dismissalsLoading = $state(false);
    let dismissalsBusy = $state(false);
    let dismissalsError = $state("");
    let dismissalsRequest = 0;
    onDestroy(() => { dismissalsRequest += 1; });
    async function loadDismissedReminders(): Promise<void> {
        if (dismissalsLoading || dismissalsBusy) return;
        const request = ++dismissalsRequest;
        dismissalsLoading = true;
        dismissalsError = "";
        try {
            const result = await facade.loadReminderDismissals();
            if (!selfAlive || request !== dismissalsRequest) return;
            dismissedReminders = result;
        } catch (error) {
            if (selfAlive && request === dismissalsRequest) dismissalsError = error instanceof Error ? error.message : String(error);
        } finally {
            // A resume action can supersede this read so its stale result is
            // ignored, but the read's own loading indicator must still end.
            if (selfAlive) dismissalsLoading = false;
        }
    }
    async function resumeOne(personDocId: string, kind: "birthday" | "stale"): Promise<void> {
        if (dismissalsBusy || dismissalsLoading) return;
        const request = ++dismissalsRequest;
        dismissalsBusy = true;
        dismissalsError = "";
        try {
            await facade.resumeReminder(personDocId, kind);
            const result = await facade.loadReminderDismissals();
            if (!selfAlive || request !== dismissalsRequest) return;
            dismissedReminders = result;
        } catch (error) {
            if (selfAlive && request === dismissalsRequest) dismissalsError = error instanceof Error ? error.message : String(error);
        } finally {
            // A concurrent refresh may advance dismissalsRequest while this
            // write is in flight. The busy guard still belongs to this
            // component operation and must be released on every live exit;
            // otherwise the restore buttons can remain disabled forever.
            if (selfAlive) dismissalsBusy = false;
        }
    }
    let rebuilding = $state(false);
    let rebuildPreview = $state.raw<FieldRebuildPreview | null>(null);
    let rebindPreview = $state.raw<SettingsRebindPreview | null>(null);
    let rebuildPreviewElement: HTMLElement | undefined = $state();
    let rebindPreviewElement: HTMLElement | undefined = $state();
    let savingPreferences = $state(false);
    let preferencesMessage = $state("");
    let rebinding = $state(false);
    let rebindOpen = $state(false);
    // FUNC-01.8 锚点找回：全库只读扫描候选，选中后填入手填框，提交仍走既有验证路径
    let anchorCandidates: AnchorCandidate[] | null = $state(null);
    let anchorScan: AnchorScanResult | null = $state(null);
    let scanningAnchors = $state(false);
    let selectedCandidateKey = $state("");
    function candidateKey(candidate: AnchorCandidate): string {
        return `${candidate.notebookId}/${candidate.hostDocId}/${candidate.dbBlockId}/${candidate.avId}`;
    }
    function mergeAnchorCandidates(previous: readonly AnchorCandidate[], incoming: readonly AnchorCandidate[]): AnchorCandidate[] {
        const merged = new Map<string, AnchorCandidate>();
        for (const candidate of [...previous, ...incoming]) merged.set(candidateKey(candidate), candidate);
        return [...merged.values()].sort((left, right) => right.matchedFields - left.matchedFields);
    }
    async function runAnchorScan(resume = false) {
        if (scanningAnchors) return;
        const cursor = resume ? anchorScan?.cursor : null;
        if (resume && !cursor) return;
        scanningAnchors = true;
        errorText = "";
        try {
            const result = await facade.scanAnchorCandidates(cursor ? { cursor } : undefined);
            if (!selfAlive) return;
            anchorScan = result;
            anchorCandidates = mergeAnchorCandidates(resume ? (anchorCandidates ?? []) : [], result.candidates);
            if (!resume) selectedCandidateKey = "";
        } catch (error) {
            if (selfAlive) errorText = error instanceof Error ? error.message : String(error);
        } finally {
            if (selfAlive) scanningAnchors = false;
        }
    }
    function applySelectedCandidate() {
        const picked = (anchorCandidates ?? []).find((candidate) => candidateKey(candidate) === selectedCandidateKey);
        if (!picked) return;
        anchorDraft = { notebookId: picked.notebookId, hostDocId: picked.hostDocId, dbBlockId: picked.dbBlockId, avId: picked.avId };
        rebindPreview = null;
        rebindMessage = `已填入「${picked.notebookName}」的候选锚点，确认后点「验证并重新绑定」。`;
    }
    let rebindMessage = $state("");
    let exportingInteractions = $state(false);
    let exportMessage = $state("");
    let exportingRoster = $state(false);
    let rosterExportMessage = $state("");
    let exportSummary: ExportSummary | null = $state(null);
    let loadingSummary = $state(false);
    let summaryError = $state("");
    let summaryRequest = 0;
    onDestroy(() => { summaryRequest += 1; });
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
    let importDiffError = $state("");
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
    let preferencesAlive = true;
    let preferencesRequest = 0;
    $effect(() => {
        const latest = preferences;
        untrack(() => {
            if (latest.revision < savedDraft.revision) return;
            draft = rebasePreferenceDraft(latest, draft, savedDraft);
            savedDraft = normalizeViewPreferences(latest);
        });
    });
    onDestroy(() => {
        preferencesAlive = false;
        preferencesRequest += 1;
    });
    // svelte-ignore state_referenced_locally
    let anchorDraft: SettingsAnchorPatch = $state({
        notebookId: settings.notebookId,
        hostDocId: settings.hostDocId,
        dbBlockId: settings.dbBlockId,
        avId: settings.avId,
    });
    let errorText = $state("");
    const guardedClose = useCloseGuard({
        /* CODE-02.1：全部挂起类操作（偏好/重绑/映射/互动与迁移导入导出/扫描/字段重建/体检/提醒恢复）期间不关 */
        busy: () => identityLoading || selfBusy || checking || auditBusy || orgProjectionBusy || dismissalsLoading || dismissalsBusy
            || savingPreferences || rebinding || mappingBusy || importingInteractions || previewingImport
            || scanningAnchors || rebuilding
            || loadingSummary || exportingInteractions || exportingRoster || exportingFollowUps || exportingBundle
            || previewingBundle || importingBundle || fuPreviewing || fuImporting,
        dirty: () => JSON.stringify(draft) !== JSON.stringify(savedDraft) || importText.trim().length > 0 || selfPreview !== null
            || rebuildPreview !== null || rebindPreview !== null,
        changes: () => [
            ...(JSON.stringify(draft) !== JSON.stringify(savedDraft) ? [text("guardPrefsDraft", "显示偏好尚未保存")] : []),
            ...(importText.trim().length > 0 ? [text("guardImportTextDraft", "互动合并输入尚未处理")] : []),
            ...(selfPreview ? [text("selfPreviewPending", "本人身份修复预览尚未确认")] : []),
            ...(rebuildPreview || rebindPreview ? ["设置修复预览尚未确认"] : []),
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
            const next = await facade.checkSettingsHealth();
            if (selfAlive) setHealth(next);
        } catch (error) {
            if (selfAlive) { health = null; errorText = error instanceof Error ? error.message : String(error); }
        } finally {
            if (selfAlive) checking = false;
        }
    }

    async function runDataAudit(previous?: HealthAuditReport): Promise<HealthAuditReport> {
        auditBusy = true;
        try {
            return await facade.runHealthAuditReport(previous);
        } finally {
            if (auditAlive) auditBusy = false;
        }
    }

    async function retryDataAudit(previous: HealthAuditReport): Promise<HealthAuditReport> {
        auditBusy = true;
        try {
            return await facade.retryFailedHealthAuditModules(previous);
        } finally {
            if (auditAlive) auditBusy = false;
        }
    }

    async function runRebuild() {
        if (rebuilding) return;
        rebuilding = true;
        errorText = "";
        try {
            const preview = await facade.previewMissingFields();
            if (!selfAlive) return;
            rebuildPreview = preview;
            await tick();
            if (selfAlive) rebuildPreviewElement?.focus();
        } catch (error) {
            if (selfAlive) errorText = error instanceof Error ? error.message : String(error);
        } finally {
            if (selfAlive) rebuilding = false;
        }
    }

    async function confirmRebuild() {
        if (rebuilding || !rebuildPreview) return;
        rebuilding = true;
        errorText = "";
        try {
            const updated = await facade.rebuildMissingFields(rebuildPreview);
            if (!selfAlive) return;
            onSettingsUpdated(updated);
            rebuildPreview = null;
            const next = await facade.checkSettingsHealth();
            if (selfAlive) setHealth(next);
        } catch (error) {
            if (selfAlive) errorText = error instanceof Error ? error.message : String(error);
        } finally {
            if (selfAlive) rebuilding = false;
        }
    }

    async function savePreferences() {
        if (savingPreferences) return;
        const invalidDays = [
            [draft.birthdayWindowDays, "生日提醒窗口"],
            [draft.staleThresholdDays, "久未联系阈值"],
            [draft.reminderGraceDays, "收编宽限期"],
        ] as const;
        const invalid = invalidDays.find(([value]) => !isValidPreferenceDays(value));
        if (invalid) {
            errorText = `${invalid[1]}必须是 0–365 的整数`;
            preferencesMessage = "";
            return;
        }
        const request = ++preferencesRequest;
        const submitted = normalizeViewPreferences(draft);
        const baseline = normalizeViewPreferences(savedDraft);
        savingPreferences = true;
        errorText = "";
        preferencesMessage = "";
        try {
            const updated = await savePreferenceChanges(facade, submitted, baseline);
            if (!preferencesAlive || request !== preferencesRequest) return;
            const latest = preferences.revision > updated.revision ? preferences : updated;
            draft = rebasePreferenceDraft(latest, draft, submitted);
            savedDraft = normalizeViewPreferences(latest);
            onPreferencesUpdated(latest);
            preferencesMessage = JSON.stringify(draft) === JSON.stringify(savedDraft) ? "偏好已保存" : "本次偏好已保存，后续修改仍未保存";
        } catch (error) {
            if (preferencesAlive && request === preferencesRequest) errorText = error instanceof Error ? error.message : String(error);
        } finally {
            if (preferencesAlive && request === preferencesRequest) savingPreferences = false;
        }
    }

    async function runRebind() {
        if (rebinding) return;
        rebinding = true;
        errorText = "";
        rebindMessage = "";
        try {
            const preview = await facade.previewRebindSettings({ ...anchorDraft });
            if (!selfAlive) return;
            rebindPreview = preview;
            await tick();
            if (selfAlive) rebindPreviewElement?.focus();
        } catch (error) {
            if (selfAlive) errorText = error instanceof Error ? error.message : String(error);
        } finally {
            if (selfAlive) rebinding = false;
        }
    }

    async function confirmRebind() {
        if (rebinding || !rebindPreview) return;
        rebinding = true;
        errorText = "";
        try {
            const updated = await facade.rebindSettings({ ...anchorDraft }, rebindPreview);
            if (!selfAlive) return;
            anchorDraft = {
                notebookId: updated.notebookId,
                hostDocId: updated.hostDocId,
                dbBlockId: updated.dbBlockId,
                avId: updated.avId,
            };
            onSettingsUpdated(updated);
            rebindPreview = null;
            const next = await facade.checkSettingsHealth();
            if (!selfAlive) return;
            setHealth(next);
            rebindMessage = "锚点已更新，已重新检查字段健康状态";
        } catch (error) {
            if (selfAlive) errorText = error instanceof Error ? error.message : String(error);
        } finally {
            if (selfAlive) rebinding = false;
        }
    }

    async function refreshExportSummary() {
        const request = ++summaryRequest;
        loadingSummary = true;
        summaryError = "";
        try {
            const summary = await facade.loadExportSummary();
            if (selfAlive && request === summaryRequest) exportSummary = summary;
        } catch {
            if (selfAlive && request === summaryRequest) { exportSummary = null; summaryError = "导出数量尚未核实，统计读取失败；可重新读取或执行导出核实数据。"; }
        } finally {
            if (selfAlive && request === summaryRequest) loadingSummary = false;
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

    let exportingBundle = $state(false);
    let bundlePreview: { key: string; label: string; count: number; tombstones?: number }[] | null = $state(null);
    let bundlePreviewText = "";
    let previewingBundle = $state(false);
    let importingBundle = $state(false);
    let bundleMessage = $state("");
    let bundleResult: MigrationImportResult | null = $state(null);
    let bundleRequest = 0;
    let bundleResultElement: HTMLElement | undefined = $state();
    onDestroy(() => { bundleRequest += 1; });

    async function runExportBundle() {
        if (exportingBundle) return;
        exportingBundle = true;
        errorText = "";
        try {
            const text = await facade.exportMigrationBundle();
            const blob = new Blob([text], { type: "application/json;charset=utf-8" });
            const url = URL.createObjectURL(blob);
            const anchor = document.createElement("a");
            anchor.href = url;
            anchor.download = `小驴人脉_插件数据迁移包_${new Date().toISOString().slice(0, 10)}.json`;
            anchor.click();
            URL.revokeObjectURL(url);
            bundleMessage = "插件数据迁移包已导出（含账本、别名、本人身份、组织成员和关系称谓；思源原生文档需另行备份）";
        } catch (error) {
            errorText = error instanceof Error ? error.message : String(error);
        } finally {
            exportingBundle = false;
        }
    }
    function selectMigrationBundle(event: Event) {
        const input = event.currentTarget as HTMLInputElement;
        const file = input.files?.[0];
        if (!file) return;
        const request = ++bundleRequest;
        bundleResult = null;
        bundlePreview = null;
        previewingBundle = true;
        bundleMessage = "";
        const reader = new FileReader();
        reader.onload = async () => {
            try {
                const text = String(reader.result ?? "");
                const preview = await facade.previewMigrationImport(text);
                if (!selfAlive || request !== bundleRequest) return;
                bundlePreviewText = text;
                bundlePreview = preview;
            } catch (error) {
                if (!selfAlive || request !== bundleRequest) return;
                bundleMessage = error instanceof Error ? error.message : String(error);
                bundlePreview = [];
            } finally {
                if (selfAlive && request === bundleRequest) previewingBundle = false;
            }
        };
        reader.onerror = () => {
            if (!selfAlive || request !== bundleRequest) return;
            bundleMessage = "迁移包文件读取失败，请重新选择文件";
            bundlePreviewText = "";
            bundlePreview = null;
            previewingBundle = false;
        };
        reader.readAsText(file);
        input.value = "";
    }
    async function runImportBundle(): Promise<void> {
        if (importingBundle || !bundlePreviewText) return;
        const request = ++bundleRequest;
        importingBundle = true;
        try {
            const result = await facade.importMigrationBundle(bundlePreviewText);
            if (!selfAlive || request !== bundleRequest) return;
            bundleResult = result;
            const summary = result.modules.map((module) => `${module.label} +${module.merged}`).join("、") || "没有可合并的模块";
            /* FUNC-01.6-b：失败模块必须可见（指名模块与原因），不把部分失败报成整包成功 */
            const failedNote = result.failed.length > 0
                ? `；恢复失败模块：${result.failed.map((module) => `${module.label}（${module.message}）`).join("、")}`
                : "";
            const issuesNote = result.issues.length > 0
                ? `；待处理：${result.issues.map((entry) => `${entry.label} ${entry.id}（人物 ${entry.personDocId}${entry.orgDocId ? `，组织 ${entry.orgDocId}` : ""}${entry.selfDocId ? `，本人 ${entry.selfDocId}` : ""}；${entry.message}）`).join("、")}`
                : "";
            const skipped = result.skipped.interactions + result.skipped.followUps
                + result.modules.reduce((total, module) => total + (module.skipped ?? 0), 0);
            const removed = result.modules.reduce((total, module) => total + (module.removed ?? 0), 0);
            const prefix = result.failed.length > 0 || result.issues.length > 0 ? "迁移恢复待核实" : "迁移恢复完成";
            bundleMessage = `${prefix}：${summary}${skipped > 0 ? `（跳过 ${skipped} 条）` : ""}${removed > 0 ? `；删除标记移除 ${removed} 条` : ""}${failedNote}${issuesNote}`;
            bundlePreviewText = result.retryBundle ?? "";
            const next = result.retryBundle ? await facade.previewMigrationImport(result.retryBundle) : null;
            if (!selfAlive || request !== bundleRequest) return;
            bundlePreview = next;
            onInteractionsUpdated();
        } catch (error) {
            if (!selfAlive || request !== bundleRequest) return;
            bundleMessage = error instanceof Error ? error.message : String(error);
        } finally {
            if (selfAlive && request === bundleRequest) {
                importingBundle = false;
                await tick();
                if (selfAlive && request === bundleRequest) bundleResultElement?.focus();
            }
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

    async function loadInteractionDiff(request = importRequest): Promise<void> {
        if (!importText) return;
        importDiffError = "";
        try {
            const diff = await facade.previewInteractionImportDiff(importText);
            if (request !== importRequest) return;
            importDiff = diff;
        } catch (error) {
            if (request !== importRequest) return;
            importDiff = null;
            importDiffError = error instanceof Error ? error.message : String(error);
        }
    }

    async function selectInteractionBackup(event: Event) {
        if (importingInteractions) return;
        const request = ++importRequest;
        const file = (event.currentTarget as HTMLInputElement).files?.[0];
        importPreview = null;
        importText = "";
        importDiffError = "";
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
            await loadInteractionDiff(request);
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
            importDiffError = "";
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
        <div class="lvct-settings__heading">
            <h1>{text("settingsPageTitle", "设置与数据")}</h1>
            <p>{text("settingsPageSubtitle", "配置默认行为、数据锚点和提醒，让联系人工作台保持可控。")}</p>
        </div>
    </div>

    <div class="lvct-settings__layout">
        <nav class="lvct-settings__nav" aria-label="设置分区">
            {#each sections as section (section.id)}
                <button
                    class="lvct-settings__nav-item"
                    class:lvct-settings__nav-item--active={activeSection === section.id}
                    aria-current={activeSection === section.id ? "page" : undefined}
                    title={auditBusy ? "资料体检进行中，完成后可切换设置分区" : orgProjectionBusy ? "组织双链核对进行中，完成后可切换设置分区" : undefined}
                    disabled={auditBusy || orgProjectionBusy}
                    onclick={() => { if (!auditBusy && !orgProjectionBusy) activeSection = section.id; }}
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

                    <!-- B11.3/B11.5：本人档案状态与显式指定入口（改绑需经此确认，不静默） -->
                    <div class="lvct-settings__row">
                        <div><b>{text("selfSectionTitle", "本人档案")}</b>
                            <small>{text("selfSectionDesc", "「我自己」的身份标记，统计与提醒默认排除本人")}</small>
                        </div>
                        {#if identityLoading}
                            <span class="lvct-settings__status">…</span>
                        {:else if selfReadError}
                            <span class="lvct-settings__status">{text("selfUnknown", "本人身份尚未核实")}</span>
                        {:else if selfIdentity}
                            <span class="lvct-settings__status">{selfDisplayName}</span>
                        {:else}
                            <button class="b3-button b3-button--text" disabled={selfBusy || selfPreview !== null} onclick={createSelf}>
                                {selfBusy ? "…" : text("selfCreate", "创建本人档案「我自己」")}</button>
                        {/if}
                    </div>
                    {#if !identityLoading && !selfReadError && typeof facade.previewSelfIdentityChange === "function"}
                        <div class="lvct-settings__row lvct-settings__identity-row">
                            <span>{text("selfDesignateLabel", "把本人身份改绑到其他已有联系人（保留原资料）")}</span>
                            <span class="lvct-settings__identity-controls">
                                <PersonPicker
                                    items={designationPickerItems}
                                    value={selfDesignateTarget}
                                    placeholder={text("selfDesignatePick", "选择联系人…")}
                                    emptyText={text("selfDesignateEmpty", "没有可改绑的联系人")}
                                    searchText={text("selfDesignateSearch", "输入姓名、电话、微信或文档 ID 筛选")}
                                    ariaLabel={text("selfDesignatePick", "选择联系人…")}
                                    i18n={i18n}
                                    disabled={selfBusy || selfPreview !== null}
                                    onSelect={(itemId) => (selfDesignateTarget = itemId)}
                                />
                                <button class="b3-button b3-button--outline" disabled={selfBusy || !selfDesignateTargetAvailable || selfPreview !== null}
                                    onclick={() => void previewSelf(selfDesignateTarget)}>{text("selfPreviewChange", "预览指定本人")}</button>
                                {#if selfIdentity}
                                    <button class="b3-button b3-button--text" disabled={selfBusy || selfPreview !== null} onclick={() => void previewSelf(null)}>{text("selfPreviewClear", "预览清除本人身份")}</button>
                                {/if}
                            </span>
                        </div>
                    {/if}
                    {#if selfReadError}
                        <div class="lvct-form__error" role="alert">{selfReadError}</div>
                        <button class="b3-button b3-button--text" disabled={identityLoading || selfBusy} onclick={() => void refreshSelfSection()}>{text("selfRetryRead", "重新核实本人身份")}</button>
                    {/if}
                    {#if selfPreview}
                        <section class="lvct-settings__rebind" tabindex="-1" bind:this={selfPreviewElement} aria-label={text("selfChangePreview", "本人身份影响预览")}>
                            <b>{text("selfChangePreview", "本人身份影响预览")}</b>
                            <p>{selfPreview.previousName} → {selfPreview.target?.name ?? text("selfNone", "未指定本人")}</p>
                            <p class="ft__smaller">{selfPreview.target?.docId ?? selfPreview.previous?.selfDocId}</p>
                            <p>{text("selfOrdinaryScope", "普通联系人统计范围")}: {selfPreview.ordinaryBefore} → {selfPreview.ordinaryAfter}</p>
                            <p>{text("selfChangeImpact", "生日、待联系和普通资料体检将排除新本人；图谱默认中心随本人变化，清除后需手动选择。原人物资料、互动、成员与历史称谓保留，不自动转移到新本人。")}</p>
                            <button class="b3-button" disabled={selfBusy} onclick={confirmSelfChange}>{selfBusy ? text("selfVerifying", "核实并保存中…") : text("selfConfirmChange", "确认本人身份变更")}</button>
                            <button class="b3-button b3-button--text" disabled={selfBusy} onclick={() => { selfPreview = null; selfMessage = ""; }}>{text("selfCancelPreview", "取消本人预览")}</button>
                        </section>
                    {/if}
                    {#if selfMessage}<div class="lvct-form__error" role="status">{selfMessage}</div>{/if}

                    <div class="lvct-settings__form-grid">
                        <label class="lvct-form__item">
                            <span>默认打开页面</span>
                            <select class="b3-select fn__block" bind:value={draft.defaultView}>
                                <option value="home">首页</option>
                                <option value="people">联系人</option>
                                <option value="graph">关系图谱</option>
                                <option value="orgs">组织</option>
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
                        <label class="lvct-form__item">
                            <span>图谱默认数据源</span>
                            <select class="b3-select fn__block" bind:value={draft.graphMode}>
                                <option value="relations">关系图（联系人关系）</option>
                                <option value="native">文档引用图（思源引用）</option>
                            </select>
                            <small>进入关系图谱时使用；页面内仍可临时切换。</small>
                        </label>
                        <label class="lvct-form__item">
                            <span>文档引用图默认范围</span>
                            <select class="b3-select fn__block" bind:value={draft.nativeScope}>
                                <option value="self">以本人为中心</option>
                                <option value="person">以联系人为中心</option>
                                <option value="global">全部登记文档</option>
                            </select>
                            <small>仅在图谱数据源为“文档引用图”时生效；中心联系人可在图谱页选择。</small>
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
                            <p class="lvct-settings__fine-print">仅在迁移或恢复了已有数据库时使用。提交前会验证属性视图并按原 ID 或标准字段名恢复映射，剩余缺失字段可再通过健康检查补建。</p>
                            <div class="lvct-settings__actions">
                                <button class="b3-button b3-button--outline" onclick={() => void runAnchorScan()} disabled={scanningAnchors}>{scanningAnchors ? "扫描中…" : "扫描全库候选（只读）"}</button>
                                <span class="ft__smaller ft__on-surface">当前绑定：文档 …{settings.hostDocId.slice(-6)} · 块 …{settings.dbBlockId.slice(-6)} · 视图 …{settings.avId.slice(-6)}（填错可按此改回）</span>
                            </div>
                            {#if anchorScan !== null}
                                <p class="lvct-settings__inline-hint" role={anchorScan.status === "blocked" ? "alert" : "status"}>
                                    {#if anchorScan.status === "complete"}
                                        扫描完成：已检查 {anchorScan.progress.documentsScanned} / {anchorScan.progress.totalDocuments ?? "未知"} 篇文档，找到 {anchorCandidates?.length ?? 0} 个候选。
                                    {:else if anchorScan.status === "truncated"}
                                        本轮已检查 {anchorScan.progress.documentsScannedThisCall} 篇，累计 {anchorScan.progress.documentsScanned} / {anchorScan.progress.totalDocuments ?? "未知"} 篇文档，达到单次上限 {anchorScan.progress.maxDocuments}；候选已保留，请点击“继续扫描”查看剩余范围。
                                    {:else}
                                        扫描在第 {anchorScan.progress.documentsScanned} 篇文档处暂停，读取结果未知；没有自动绑定或写入，请修复原因后重试当前位置。
                                    {/if}
                                </p>
                                <p class="lvct-settings__inline-hint">扫描期间新增或移动的文档，可能需要重新扫描才能完整核实。</p>
                                {#if anchorScan.issues.length > 0}
                                    <ul class="lvct-settings__missing">
                                        {#each anchorScan.issues as issue}
                                            <li><small class="ft__smaller ft__on-surface">{issue.notebookName}：{issue.message}</small></li>
                                        {/each}
                                    </ul>
                                {/if}
                                {#if anchorScan.status !== "complete" && anchorScan.cursor}
                                    <div class="lvct-settings__actions">
                                        <button class="b3-button b3-button--outline" onclick={() => void runAnchorScan(true)} disabled={scanningAnchors}>
                                            {scanningAnchors ? "扫描中…" : anchorScan.status === "blocked" ? "重试当前位置" : "继续扫描"}
                                        </button>
                                    </div>
                                {/if}
                                {#if anchorCandidates !== null}
                                    {#if anchorCandidates.length === 0}
                                        <p class="lvct-settings__inline-hint" role="status">
                                            {anchorScan.status === "complete"
                                                ? "全库未找到「联系人总表」文档及数据库块。确认笔记本未被删除后，可手动粘贴 ID；扫描零写入，不会自动创建第二套数据。"
                                                : "当前扫描范围暂未找到候选；扫描尚未完成，继续后仍会检查剩余文档。"}
                                        </p>
                                    {:else}
                                        <ul class="lvct-settings__missing">
                                            {#each anchorCandidates as candidate (candidateKey(candidate))}
                                                <li>
                                                    <label class="lvct-settings__candidate">
                                                        <input type="radio" name="lvct-anchor-candidate" value={candidateKey(candidate)} bind:group={selectedCandidateKey} />
                                                        <span>{candidate.notebookName} / {candidate.hpath || "/"} · 可对回字段 {candidate.matchedFields}/9</span>
                                                        <small class="ft__smaller ft__on-surface">文档 …{candidate.hostDocId.slice(-6)} · 块 …{candidate.dbBlockId.slice(-6)}</small>
                                                    </label>
                                                </li>
                                            {/each}
                                        </ul>
                                        <div class="lvct-settings__actions">
                                            <button class="b3-button b3-button--outline" disabled={!selectedCandidateKey} onclick={applySelectedCandidate}>填入所选候选</button>
                                        </div>
                                    {/if}
                                {/if}
                            {/if}
                            <div class="lvct-settings__rebind-grid">
                                <label class="lvct-form__item"><span>笔记本 ID</span><input class="b3-text-field fn__block" bind:value={anchorDraft.notebookId} disabled={rebinding || !!rebindPreview} /></label>
                                <label class="lvct-form__item"><span>宿主文档 ID</span><input class="b3-text-field fn__block" bind:value={anchorDraft.hostDocId} disabled={rebinding || !!rebindPreview} /></label>
                                <label class="lvct-form__item"><span>数据库块 ID</span><input class="b3-text-field fn__block" bind:value={anchorDraft.dbBlockId} disabled={rebinding || !!rebindPreview} /></label>
                                <label class="lvct-form__item"><span>属性视图 ID</span><input class="b3-text-field fn__block" bind:value={anchorDraft.avId} disabled={rebinding || !!rebindPreview} /></label>
                            </div>
                            <div class="lvct-settings__actions">
                                <button class="b3-button b3-button--outline" onclick={runRebind} disabled={rebinding}>{rebinding ? "验证并保存中…" : "验证并重新绑定"}</button>
                                <StatusNotice message={rebindMessage} onDismiss={() => (rebindMessage = "")} />
                            </div>
                            {#if rebindPreview}
                                <section class="lvct-settings__rebind" tabindex="-1" bind:this={rebindPreviewElement} aria-label="数据库重绑影响预览">
                                    <b>数据库重绑影响预览（只读）</b>
                                    <p>目标：{rebindPreview.notebookName} / {rebindPreview.hostDocName} · 已核实 {rebindPreview.matchedFields} 项字段。</p>
                                    <p>当前笔记本：{rebindPreview.previous.notebookId} · 当前文档：{rebindPreview.previous.hostDocId}</p>
                                    <p>当前数据库块：{rebindPreview.previous.dbBlockId} · 当前属性视图：{rebindPreview.previous.avId}</p>
                                    <p>目标笔记本：{rebindPreview.target.notebookId} · 目标文档：{rebindPreview.target.hostDocId}</p>
                                    <p>目标数据库块：{rebindPreview.target.dbBlockId} · 目标属性视图：{rebindPreview.target.avId}</p>
                                    <p>确认后联系人列表和字段写入使用目标数据库。人物文档、本人身份、组织成员、互动和往来记录保留原文档 ID；本次不迁移这些资料。</p>
                                    <details><summary>字段映射影响（{rebindPreview.impacts.filter((impact) => impact.changed).length} 项变化）</summary>
                                        <ul class="lvct-settings__missing">{#each rebindPreview.impacts as impact (impact.key)}<li>{impact.key}：{impact.previousKeyId || "未映射"} → {impact.targetKeyId}</li>{/each}</ul>
                                    </details>
                                    <div class="lvct-settings__actions">
                                        <button class="b3-button" onclick={confirmRebind} disabled={rebinding}>确认切换数据库</button>
                                        <button class="b3-button b3-button--cancel" onclick={() => (rebindPreview = null)} disabled={rebinding}>取消重绑预览</button>
                                    </div>
                                </section>
                            {/if}
                        </div>
                    {/if}

                    <div class="lvct-settings__sub-heading">
                        <b>导出中心</b>
                        {#if loadingSummary}<span class="ft__smaller ft__on-surface">统计中…</span>{/if}
                    </div>
                    <p class="lvct-settings__fine-print">人物文档与联系人数据库是思源原生数据，随工作区保留；以下导出文件都不是完整备份。</p>
                    {#if summaryError}
                        <div class="lvct-settings__notice lvct-settings__notice--error" role="alert">
                            <p>{summaryError}</p>
                            <button class="b3-button b3-button--outline" disabled={loadingSummary} onclick={() => void refreshExportSummary()}>
                                {loadingSummary ? "正在重新读取…" : "重新读取导出数量"}
                            </button>
                        </div>
                    {/if}
                    <div class="lvct-settings__row">
                        <div>
                            <b>全量名册 vCard</b>
                            <small>{#if exportSummary}{exportSummary.peopleCount} 位联系人 · {/if}标准 vCard 3.0，通讯录可导入；不含互动与关系，微信号不导出</small>
                        </div>
                        <button class="b3-button b3-button--outline" onclick={runExportRoster} title={exportSummary?.peopleCount === 0 ? "名册为空，请先在联系人页新建或收编联系人" : undefined} disabled={exportingRoster || (exportSummary !== null && exportSummary.peopleCount === 0)}>
                            {exportingRoster ? "导出中…" : "导出 .vcf"}
                        </button>
                    </div>
                    <div class="lvct-settings__row lvct-settings__row--status" role="status" aria-label="在线通讯录同步状态">
                        <div>
                            <b>在线通讯录同步</b>
                            <small>CardDAV 尚未接入；当前通过 .vcf 文件交换。后续同步会单独选择地址簿、方向、字段和冲突策略。</small>
                        </div>
                        <span class="ft__smaller ft__on-surface">未接入</span>
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
                        <div>
                            <b>插件数据迁移包</b>
                            <small>互动、跟进、节奏、提醒暂缓、收编索引、模板、账本、别名和本人身份；包含个人敏感信息，请妥善保管</small>
                        </div>
                        <button class="b3-button b3-button--outline" onclick={runExportBundle} disabled={exportingBundle}>
                            {exportingBundle ? "导出中…" : "导出迁移包"}
                        </button>
                    </div>
                    <p class="lvct-settings__fine-print">本人身份按原文档 ID 核实当前绑定，不覆盖不同本人；组织成员含任职分类、离职历史及删除标记。关系称谓保留原本人参照和明确空值，不转移给其他本人。人物与组织原文、组织归档状态、数据库及原生任务请另行备份思源工作区；界面偏好与数据库锚点不自动恢复。成员恢复后，可在组织双链核对中预览并逐文档重建关联段落。</p>
                    <div class="lvct-settings__migration-result" style="overflow-wrap:anywhere" tabindex="-1" bind:this={bundleResultElement} aria-label="迁移模块结果">
                        <StatusNotice message={bundleMessage} onDismiss={() => (bundleMessage = "")} />
                        {#if bundleResult}
                            <ul aria-label="已核实模块">
                                {#each bundleResult.modules as module (module.key)}
                                    <li>{module.label}：已核实新增 {module.merged} 条，跳过 {module.skipped ?? 0} 条，删除 {module.removed ?? 0} 条。</li>
                                {/each}
                            </ul>
                            {#if bundleResult.failed.length > 0}<ul aria-label="未完成模块">
                                {#each bundleResult.failed as module (module.key)}
                                    <li>{module.label}：{module.status === "unknown" ? "结果未知，先核实" : "失败，可重试"}。{module.message}</li>
                                {/each}
                            </ul>{/if}
                            {#if bundleResult.issues.length > 0}<details><summary>逐项冲突与不可达（{bundleResult.issues.length} 条）</summary>
                                <ul>{#each bundleResult.issues as issue (issue.key + issue.id)}
                                    <li>{issue.label} · {issue.id} · 人物 {issue.personDocId}{issue.selfDocId ? ` · 本人 ${issue.selfDocId}` : ""}{issue.orgDocId ? ` · 组织 ${issue.orgDocId}` : ""}：{issue.message}</li>
                                {/each}</ul>
                            </details>{/if}
                        {/if}
                    </div>
                    <div class="lvct-settings__row">
                        <label for="lvct-migration-bundle"><b>恢复迁移包</b></label>
                        <input id="lvct-migration-bundle" class="b3-text-field lvct-settings__backup-input" type="file" accept=".json,application/json" onchange={selectMigrationBundle} disabled={importingBundle || previewingBundle} />
                    </div>
                    {#if previewingBundle}<p class="lvct-settings__inline-hint" role="status">正在检查迁移包…</p>{/if}
                    {#if bundlePreview && bundlePreview.length > 0}
                        <ul class="lvct-settings__missing">
                            {#each bundlePreview as module (module.key)}
                                <li>{module.label}：{module.count} 条{module.tombstones ? `，删除标记 ${module.tombstones} 条` : ""}</li>
                            {/each}
                        </ul>
                        <div class="lvct-settings__actions">
                            <button class="b3-button b3-button--outline" onclick={runImportBundle} disabled={importingBundle}>
                                {importingBundle ? "恢复中…" : bundleMessage ? "核实并重试未完成模块" : "确认恢复（现状优先合并）"}
                            </button>
                        </div>
                    {:else if bundlePreview !== null && !previewingBundle && !bundleMessage}
                        <p class="lvct-settings__inline-hint" role="status">迁移包为空或没有可恢复的模块。</p>
                    {/if}
                    {#if bundlePreview && bundlePreview.length > 0}
                        <p class="ft__smaller ft__on-surface">先恢复人物与组织原文并重绑数据库；按双方文档 ID 核对，不按姓名自动关联。别名与成员删除标记优先，旧包不会复活已删除记录。只恢复成员事实，关联段落需另行预览重建；未核实项会保留供手动重试。</p>
                    {/if}

                    <div class="lvct-settings__row">
                        <label for="lvct-interaction-backup"><b>合并互动备份</b></label>
                        <input id="lvct-interaction-backup" class="b3-text-field lvct-settings__backup-input" type="file" accept=".json,application/json" bind:this={importFileInput} onchange={selectInteractionBackup} disabled={importingInteractions} />
                    </div>
                    {#if previewingImport}<p class="lvct-settings__inline-hint" role="status">正在检查备份…</p>{/if}
                    {#if importPreview}
                        <p class="lvct-settings__inline-hint">预计新增 {importPreview.added} 条，跳过 {importPreview.skipped} 条，移除 {importPreview.removed} 条，新增删除标记 {importPreview.tombstonesAdded} 条</p>
                        {#if importDiffError}
                            <div class="lvct-form__error" role="alert">
                                差异明细读取失败：{importDiffError}
                                <button type="button" class="b3-button b3-button--outline" disabled={previewingImport || importingInteractions} onclick={() => void loadInteractionDiff(importRequest)}>重试差异明细</button>
                            </div>
                        {:else if importDiff}
                            <button class="b3-button b3-button--text" aria-expanded={importDiffOpen} onclick={() => (importDiffOpen = !importDiffOpen)}>
                                {importDiffOpen ? "收起差异明细" : "查看差异明细"}
                            </button>
                            {#if importDiffOpen}
                                <div class="lvct-settings__diff" role="region" aria-label="备份差异明细">
                                    <div class="lvct-settings__diff-section">
                                        <b>将新增（{importDiff.added.length} 条）</b>
                                        {#if importDiff.added.length === 0}<p class="ft__smaller ft__on-surface">没有新增事件。</p>{/if}
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
                            <b>{health.ok ? "字段完整" : `发现字段问题：缺失 ${health.missing.length} 项、结构异常 ${health.problems.length} 项`}</b>
                            <span>当前数据库列：{health.columns}</span>
                        </div>
                        {#if health.problems.length > 0}
                            <!-- CODE-02.4：结构问题（重复映射/列不存在/类型不一致）以修复态呈现，不静默自愈 -->
                            <ul class="lvct-settings__missing">
                                {#each health.problems as item (item.key + item.message)}<li>{item.message}</li>{/each}
                            </ul>
                        {/if}
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
                        {#if rebuildPreview}
                            <section class="lvct-settings__rebind" tabindex="-1" bind:this={rebuildPreviewElement} aria-label="补列影响预览">
                                <b>补列影响预览（只读）</b>
                                <p>数据库：{rebuildPreview.anchors.avId} · 本次核实 {rebuildPreview.missing.length} 项缺失映射。</p>
                                <ul class="lvct-settings__missing">{#each rebuildPreview.missing as field (field.key)}<li>{field.expectedName} · {field.type} · 原映射 {field.keyId}</li>{/each}</ul>
                                {#if rebuildPreview.requestId}<p>原请求：{rebuildPreview.requestId}。先核实原列；结果未知时保留断点，不重复建列。</p>{/if}
                                <p>确认后逐列补建并回读核实，相关人同时核实双向回链。已完成的列保留，失败后重新核实预览再继续。</p>
                                <div class="lvct-settings__actions">
                                    <button class="b3-button" onclick={confirmRebuild} disabled={rebuilding}>确认补建并核实</button>
                                    <button class="b3-button b3-button--outline" onclick={runRebuild} disabled={rebuilding}>重新核实补列预览</button>
                                    <button class="b3-button b3-button--cancel" onclick={() => (rebuildPreview = null)} disabled={rebuilding}>取消补列预览</button>
                                </div>
                            </section>
                        {/if}
                    {:else}
                        <p class="lvct-settings__inline-hint">建议运行一次检查，确认数据库列没有被删除。</p>
                    {/if}

                    <div class="lvct-settings__sub-heading">
                        <b>资料体检（只读巡检）</b>
                        {#if !auditOpen}<button class="b3-button b3-button--outline" onclick={() => (auditOpen = true)}>运行资料体检</button>{/if}
                    </div>
                    {#if auditOpen}
                        <ReviewReportDialog {i18n} buildAuditReport={runDataAudit} retryFailedAuditModules={retryDataAudit} {onOpenPeople} />
                    {:else}
                        <p class="lvct-settings__inline-hint">检查数据内容质量：缺关键字段、悬空关系、跟进/互动指向不存在的人物等。</p>
                    {/if}
                    {#if facade.previewOrganizationProjections && facade.repairOrganizationProjection}
                        <OrgProjectionRepair {facade} {i18n} onBusyChange={(busy) => (orgProjectionBusy = busy)} />
                    {/if}
                </section>
            {:else if activeSection === "reminder"}
                <section class="lvct-settings__panel">
                    <h2>{text("settingsReminder", "提醒")}</h2>
                    <p class="lvct-settings__desc">首页展示近期公历和农历生日，根据互动事件计算联系间隔。</p>

                    <!-- B08：已暂缓的提醒（reminder-dismissals）一键恢复，避免"点过就找不回" -->
                    <div class="lvct-settings__sub-heading">
                        <b>已暂缓的提醒</b>
                        <button class="b3-button b3-button--outline" onclick={loadDismissedReminders} disabled={dismissalsLoading || dismissalsBusy}>
                            {dismissalsLoading ? "读取中…" : "刷新列表"}
                        </button>
                    </div>
                    {#if dismissalsError}<div class="lvct-form__error" role="alert">{dismissalsError}</div>{/if}
                    {#if dismissedReminders !== null}
                        {#if dismissedReminders.length === 0}
                            <p class="lvct-settings__inline-hint" role="status">当前没有暂缓中的提醒。生日「跳过本年」与「不再提醒」会出现在这里。</p>
                        {:else}
                            <ul class="lvct-settings__missing">
                                {#each dismissedReminders as entry (entry.personDocId + entry.kind)}
                                    <li>
                                        <div>{entry.kind === "birthday" ? "生日提醒" : "久未联系/从未互动提醒"} · 文档 …{entry.personDocId.slice(-6)}</div>
                                        <div class="ft__smaller ft__on-surface">
                                            {entry.until === "" ? "长期暂缓（直到手动恢复）" : `暂缓至 ${entry.until}`}
                                        </div>
                                        <button
                                            type="button"
                                            class="b3-button b3-button--outline"
                                            disabled={dismissalsBusy || dismissalsLoading}
                                            onclick={() => resumeOne(entry.personDocId, entry.kind)}
                                        >恢复提醒</button>
                                    </li>
                                {/each}
                            </ul>
                        {/if}
                    {:else}
                        <p class="lvct-settings__inline-hint">读取暂缓列表后可在此一键恢复被隐藏的提醒；暂缓只影响提醒呈现，不影响统计。</p>
                    {/if}

                    <div class="lvct-settings__form-grid">
                        <label class="lvct-form__item">
                            <span>生日提醒窗口（天）</span>
                            <input class="b3-text-field fn__block" type="number" min="0" max="365" step="1" bind:value={draft.birthdayWindowDays} />
                            <small>请输入 0–365 的整数</small>
                        </label>
                        <label class="lvct-form__item">
                            <span>久未联系阈值（天）</span>
                            <input class="b3-text-field fn__block" type="number" min="0" max="365" step="1" bind:value={draft.staleThresholdDays} />
                            <small>请输入 0–365 的整数</small>
                        </label>
                        <label class="lvct-form__item">
                            <span>收编宽限期（天）</span>
                            <input class="b3-text-field fn__block" type="number" min="0" max="365" step="1" bind:value={draft.reminderGraceDays} />
                            <small>新收编的联系人在此期限内不计入「从未互动」提醒；0 为关闭（C02）</small>
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
