<script lang="ts">
    /** 人物详情 Peek：档案字段、互动与关系列表（增删，内核自动维护双向回链） */
    import { onDestroy, untrack } from "svelte";
    import { listContacts, removeContact } from "../../services/contacts";
    import { addRelation, removeRelation, refreshPerson, retryRelationProjections } from "../../services/relations";
    import { resolveRelated } from "../../services/doc-section";
    import type { RelationMutationReport, RelationProjectionResult } from "../../domain/relations";
import LvctDialog from "../LvctDialog.svelte";
import PersonEditDialog from "./PersonEditDialog.svelte";
import ViewState from "../ViewState.svelte";
import StatusNotice from "../StatusNotice.svelte";
    import type { ContactSummary } from "../../domain/person";
    import type { ContactsSettings } from "../../domain/model";
    import { nextBirthday } from "../../domain/occasions";
    import { createCloseScope, useCloseGuard } from "../close-guard";
    import { translateText } from "../../domain/translation";
    import PersonPicker from "./PersonPicker.svelte";
    import type { PickerItem } from "./PersonPicker.svelte";
    import { dueLabel, hasFollowUpDraft } from "../../domain/followups";
    import type { FollowUpItem, SnoozeOption } from "../../domain/followups";
    import type { PersonCadence } from "../../domain/cadence";
    import { renderTemplate } from "../../domain/interaction-templates";
    import type { NoteTemplate } from "../../domain/interaction-templates";
    import TemplateManager from "./TemplateManager.svelte";
    import ExchangeLedger from "./ExchangeLedger.svelte";
    import PersonAliases from "./PersonAliases.svelte";
    import RelationshipLabels from "./RelationshipLabels.svelte";
    import PersonProfileSummary from "./PersonProfileSummary.svelte";
    import { buildBriefingMarkdown } from "../../domain/briefing-export";
    import { addReviewDays, groupByMonth, inDateRange, onThisDay } from "../../domain/date-review";
    import { toLocalDateKey } from "../../domain/interactions";
    import OrgMembershipResult from "../org/OrgMembershipResult.svelte";
    import type { OrgMembershipWriteReport } from "../../services/org-member-writes";
    import type { OrgAffiliationKind, OrgMembership, OrgMembershipPatch } from "../../domain/org-membership";

    let {
        settings,
        i18n,
        person,
        /** FUNC-01.7-a：数据变化代际（Workbench 广播）；变化时原地重载洞察与跟进（写入/编辑中跳过） */
        revision = 0,
        onLoadOrgMemberships,
        onOpenOrgManager,
        onOpenOrganization,
        onLoadOrgCandidates,
        onAddOrgMembership,
        onRemoveOrgMembership,
        onUpdateOrgMembership,
        onLoadCommonOrgs,
        onRecord,
        onDeleteInteraction,
        onLoadInsights,
        onLoadPersonNote,
        onSavePersonNote,
        onOpenPersonDoc,
        onNavigate,
        onNavigateDocId,
        closeLabel,
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
        onLoadExchanges,
        onCreateExchange,
        onChangeExchangeStatus,
        onLoadAliases,
        onAddAlias,
        onRemoveAlias,
        onLoadRelationshipLabels,
        onSaveRelationshipLabels,
    }: {
        settings: ContactsSettings;
        i18n?: Readonly<Record<string, string>>;
        person: ContactSummary;
        revision?: number;
        /** 记一笔互动（facade.recordInteraction） */
        onRecord: (personDocId: string, note?: string) => Promise<void>;
        onDeleteInteraction?: (personDocId: string, eventId: string) => Promise<void>;
        /** 人物洞察（时间线+共同出席） */
        onLoadInsights: (docId: string) => Promise<import("../../services/insights").PersonInsights>;
        onLoadPersonNote?: (docId: string) => Promise<string>;
        onSavePersonNote?: (docId: string, note: string, expected?: string) => Promise<string>;
        /** B12：组织归属投影（可选：未接线时隐藏该区） */
        onLoadOrgMemberships?: (docId: string) => Promise<import("../../services/org").PersonOrgMembershipView[]>;
        /** B13.5 双向编辑（可选）：打开组织管理弹窗维护归属；未接线时隐藏按钮 */
        onOpenOrgManager?: () => void;
        onOpenOrganization?: (docId: string) => void;
        /** B13.5 双向编辑完整版（可选）：归属候选（活跃组织）；未接线时隐藏添加表单 */
        onLoadOrgCandidates?: () => Promise<ReadonlyArray<{ docId: string; name: string }>>;
        /** B13.5：为当前人物添加组织归属（orgDocId 单独传递，避免与 personDocId 混淆） */
        onAddOrgMembership?: (personDocId: string, orgDocId: string, extra?: { department?: string; title?: string; joinedOn?: string; affiliationKind?: OrgAffiliationKind }) => Promise<OrgMembershipWriteReport | void>;
        /** B13.5：移除一条组织归属（membership id） */
        onRemoveOrgMembership?: (membershipId: string, expected?: OrgMembership) => Promise<OrgMembershipWriteReport | void>;
        onUpdateOrgMembership?: (membershipId: string, patch: OrgMembershipPatch, expected?: OrgMembership) => Promise<OrgMembershipWriteReport | void>;
        /** B13.6：共同背景投影（同组织联系人；未接线时隐藏该区） */
        onLoadCommonOrgs?: (docId: string) => Promise<import("../../domain/org-membership").CommonOrgBackground[]>;
        onOpenPersonDoc: (docId: string) => void;
        onNavigate: (person: ContactSummary) => void;
        onNavigateDocId?: (docId: string) => Promise<void>;
        closeLabel?: string;
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
        onLoadExchanges?: (personDocId: string) => Promise<import("../../domain/exchanges").ExchangeRecord[]>;
        onCreateExchange?: (input: import("../../services/exchanges").CreatePersonExchangeInput) => Promise<import("../../domain/exchanges").ExchangeRecord>;
        onChangeExchangeStatus?: (id: string, status: import("../../domain/exchanges").ExchangeStatus, settledOn?: string) => Promise<import("../../domain/exchanges").ExchangeRecord>;
        onLoadAliases?: (personDocId: string) => Promise<import("../../domain/person-aliases").PersonAlias[]>;
        onAddAlias?: (personDocId: string, alias: string) => Promise<import("../../domain/person-aliases").PersonAlias>;
        onRemoveAlias?: (id: string) => Promise<void>;
        onLoadRelationshipLabels?: (personDocId: string) => Promise<import("../../services/people-profiles").RelationshipLabelEditorState>;
        onSaveRelationshipLabels?: (personDocId: string, selfDocId: string, labels: string[], expected: import("../../domain/person-relationship-labels").PersonRelationshipLabels | null) => Promise<import("../../domain/person-relationship-labels").PersonRelationshipLabels>;
    } = $props();
    const text = $derived.by(() => (key: string, fallback: string, values?: Record<string, string | number>) =>
        translateText(i18n, key, fallback, values));

    // 有意取打开弹窗时的快照；后续更新走 refreshPerson 回查
    // svelte-ignore state_referenced_locally
    let current: ContactSummary = $state(person);
    let others: ContactSummary[] = $state([]);
    let detailAlive = true;
    let othersRequest = 0;
    let relationProjections: RelationProjectionResult[] = $state([]);
    const pendingRelationProjections = $derived(relationProjections.filter((item) => item.status !== "applied"));
    onDestroy(() => {
        detailAlive = false;
        othersRequest += 1;
        insightsRequest += 1;
        personNoteRequest += 1;
        followUpRequest += 1;
    });
    /* B03 可搜索选人器：候选（排除本人与已关联）→ 选中即建关系，写入语义不变 */
    const relationCandidates = $derived.by((): PickerItem[] => candidates.map((person) => ({
        id: person.itemId,
        label: person.name,
        docId: person.docId,
        itemId: person.itemId,
        hint: [person.group, person.phone || person.email, ...person.tags].filter(Boolean).join(" · "),
        keywords: `${person.phone} ${person.wechat} ${person.email}`.toLowerCase(),
    })));
    let relationPicker: { openPicker: () => void } | undefined = $state(undefined);
    let busy: boolean = $state(false);
    let errorText: string = $state("");
    let noteText: string = $state("");
    let personNote: string = $state("");
    let personNoteDraft: string = $state("");
    let personNoteLoading = $state(false);
    let personNoteSaving = $state(false);
    let personNoteError = $state("");
    let personNoteErrorKind: "load" | "save" | "" = $state("");
    let personNoteSaved = $state(false);
    // 联系节奏草稿与已保存基线必须在关闭守卫注册前建立，避免守卫首次读取时引用未初始化状态。
    let cadenceMode: "global" | "custom" | "paused" = $state("global");
    let cadenceDays = $state(14);
    let cadenceSavedMode: "global" | "custom" | "paused" = $state("global");
    let cadenceSavedDays = $state(14);
    let cadenceSaving = $state(false);
    let cadenceMessage = $state("");
    let cadenceError = $state("");
    let cadenceLoadError = $state("");
    let cadenceRequest = 0;
    const cadenceDirty = $derived(cadenceMode !== cadenceSavedMode
        || (String(cadenceMode) === "custom" && cadenceDays !== cadenceSavedDays));
    // 备注读取可能跨越 revision 刷新、人物切换或用户开始编辑；只允许
    // 仍属于当前人物且没有被新草稿淘汰的请求提交结果。
    let personNoteRequest = 0;
    let personNoteDraftRevision = 0;
    const canLeave = createCloseScope();
    // B06：互动备注草稿给出明细与「保存并离开」（保存=记录这条互动）
    async function persistNote(): Promise<void> {
        if (!current) throw new Error("当前没有人物");
        await onRecord(current.docId, noteText.trim() || undefined);
        recorded = true;
        noteText = "";
        await loadInsights();
    }

    async function loadPersonNoteState(preserveSaved = false): Promise<void> {
        if (!onLoadPersonNote) return;
        const request = ++personNoteRequest;
        const targetDocId = current.docId;
        const targetItemId = current.itemId;
        const draftRevision = personNoteDraftRevision;
        personNoteLoading = true;
        personNoteError = "";
        personNoteErrorKind = "";
        try {
            const loaded = await onLoadPersonNote(targetDocId);
            if (!detailAlive || request !== personNoteRequest || current.docId !== targetDocId || current.itemId !== targetItemId || personNoteDraftRevision !== draftRevision) return;
            personNote = loaded;
            personNoteDraft = loaded;
            if (!preserveSaved) personNoteSaved = false;
        } catch (error) {
            if (detailAlive && request === personNoteRequest && current.docId === targetDocId && current.itemId === targetItemId && personNoteDraftRevision === draftRevision) {
                personNoteError = error instanceof Error ? error.message : String(error);
                personNoteErrorKind = "load";
            }
        } finally {
            if (detailAlive && request === personNoteRequest) personNoteLoading = false;
        }
    }

    async function savePersonNoteState(rethrowOnFailure = false): Promise<void> {
        if (!onSavePersonNote || personNoteSaving) return;
        personNoteSaving = true;
        personNoteError = "";
        personNoteErrorKind = "";
        personNoteSaved = false;
        try {
            const saved = await onSavePersonNote(current.docId, personNoteDraft, personNote);
            personNote = saved;
            personNoteDraft = saved;
            personNoteSaved = true;
            onChanged();
        } catch (error) {
            personNoteError = error instanceof Error ? error.message : String(error);
            personNoteErrorKind = "save";
            if (rethrowOnFailure) throw error;
        } finally {
            personNoteSaving = false;
        }
    }
    useCloseGuard({
        busy: () => busy || deleting || personNoteSaving || personNoteLoading || followUpBusy || cadenceSaving,
        dirty: () => noteText.trim().length > 0 || personNoteDraft !== personNote || cadenceDirty,
        changes: () => [
            ...(noteText.trim() ? [text("guardNoteDraft", "互动备注尚未记录：{text}", { text: noteText.trim() })] : []),
            ...(personNoteDraft !== personNote ? ["人物独立备注尚未保存"] : []),
            ...(cadenceDirty ? [text("guardCadenceDraft", "联系节奏尚未保存")] : []),
        ],
        save: async () => {
            if (noteText.trim()) await persistNote();
            if (personNoteDraft !== personNote) await savePersonNoteState(true);
            if (cadenceDirty) await saveCadence(true);
        },
    });
    async function navigate(person: ContactSummary | null) {
        if (person && await canLeave.requestClose()) onNavigate(person);
    }
    let recorded: boolean = $state(false);
    let insights: import("../../services/insights").PersonInsights | null = $state(null);
    let insightsLoading = $state(true);
    let insightsError = $state("");
    let othersLoading = $state(true);
    let othersError = $state("");
    let insightsRequest = 0;
    let editing = $state(false);
    let deleting = $state(false);
    let activeTab: "overview" | "activity" | "relations" = $state("overview");
    const tabIds = ["overview", "activity", "relations"] as const;
    async function selectTab(next: typeof activeTab): Promise<boolean> {
        if (next === activeTab) return true;
        if (!(await canLeave.requestClose())) return false;
        activeTab = next;
        return true;
    }
    async function handleTabKeydown(event: KeyboardEvent) {
        if (event.key !== "ArrowRight" && event.key !== "ArrowLeft" && event.key !== "Home" && event.key !== "End") return;
        event.preventDefault();
        const index = tabIds.indexOf(activeTab);
        const next = event.key === "Home" ? 0 : event.key === "End" ? 2 : (index + (event.key === "ArrowRight" ? 1 : 2)) % 3;
        const tablist = event.currentTarget as HTMLElement;
        if (await selectTab(tabIds[next])) tablist.querySelectorAll<HTMLElement>('[role="tab"]')[next]?.focus();
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
    loadPersonNoteState();

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
        resolveRelated(current, others),
    );
    const candidates = $derived(
        others.filter((item) => item.itemId !== current.itemId && !item.isSelf && !relatedPeople.some((related) => related.itemId === item.itemId)),
    );
    const orderedPeople = $derived(navigationOrder ?? others);
    const currentIndex = $derived(orderedPeople.findIndex((item) => item.itemId === current.itemId));
    const previousPerson = $derived(currentIndex > 0 ? orderedPeople[currentIndex - 1] : null);
    const nextPerson = $derived(currentIndex >= 0 && currentIndex < orderedPeople.length - 1 ? orderedPeople[currentIndex + 1] : null);
    const birthday = $derived(nextBirthday(current.birthday, current.isLunar));

    async function loadOthers() {
        if (!detailAlive) return;
        const request = ++othersRequest;
        othersLoading = true;
        othersError = "";
        const target = { docId: current.docId, itemId: current.itemId };
        try {
            const people = await listContacts(settings);
            if (!detailAlive || request !== othersRequest || current.docId !== target.docId || current.itemId !== target.itemId) return;
            others = people;
            const matches = people.filter((item) => item.docId === target.docId || item.itemId === target.itemId);
            if (matches.length === 1 && matches[0].docId === target.docId && matches[0].itemId === target.itemId) current = matches[0];
            else othersError = "原人物的文档与行绑定已变化或不唯一，当前详情保留；请重新核对稳定文档 ID";
        } catch (error) {
            if (detailAlive && request === othersRequest && current.docId === target.docId && current.itemId === target.itemId) {
                othersError = error instanceof Error ? error.message : String(error);
            }
        } finally {
            if (detailAlive && request === othersRequest) othersLoading = false;
        }
    }

    loadOthers();

    function isRelationMutationReport(value: unknown): value is RelationMutationReport {
        return typeof value === "object" && value !== null && "fact" in value && "projections" in value;
    }

    function rememberRelationProjections(results: readonly RelationProjectionResult[]) {
        const merged = new Map(relationProjections.map((item) => [item.docId, item]));
        for (const result of results) merged.set(result.docId, result);
        relationProjections = [...merged.values()];
    }

    async function retryRelatedDocuments() {
        if (busy || !detailAlive) return;
        busy = true;
        errorText = "";
        try {
            const result = await retryRelationProjections(settings, pendingRelationProjections.map((item) => item.docId));
            if (!detailAlive) return;
            rememberRelationProjections(result);
            onChanged();
            await loadOthers();
        } catch (error) {
            if (detailAlive) errorText = error instanceof Error ? error.message : String(error);
        } finally {
            if (detailAlive) busy = false;
        }
    }

    async function mutate(action: () => Promise<unknown>) {
        if (busy) return;
        busy = true;
        errorText = "";
        try {
            const result = await action();
            if (!detailAlive) return;
            onChanged();
            const fresh = await refreshPerson(settings, current);
            if (!detailAlive) return;
            if (fresh) current = fresh;
            if (isRelationMutationReport(result)) {
                rememberRelationProjections(result.projections);
                await loadOthers();
            }
        } catch (error) {
            if (detailAlive) errorText = error instanceof Error ? error.message : String(error);
        } finally {
            if (detailAlive) busy = false;
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
    /* B12：组织归属区块（onLoadOrgMemberships 接线即显示） */
    const orgSectionSupported = $derived(Boolean(onLoadOrgMemberships));
    let followUps: FollowUpItem[] = $state([]);
    let followUpsLoading = $state(true);
    const initialFollowUpDate = toLocalDateKey(new Date());
    let followUpTitle = $state("");
    let followUpDate = $state(initialFollowUpDate);
    let followUpSavedTitle = $state("");
    let followUpSavedDate = $state(initialFollowUpDate);
    let followUpBusy = $state(false);
    let followUpRecorded = $state(false);
    let followUpError = $state("");
    /* 写入已经成功但随后列表回读失败时，不能把成功误报为写入失败。 */
    let followUpActionError = $state("");
    let followUpRefreshWarning = $state("");
    let followUpRequest = 0;
    let snoozeForId = $state("");
    let snoozeCustomDate = $state("");
    const todayKey = $derived(toLocalDateKey(new Date()));
    const followUpPlanDirty = $derived(hasFollowUpDraft({
        title: followUpTitle,
        dueDate: followUpDate,
        savedTitle: followUpSavedTitle,
        savedDueDate: followUpSavedDate,
        snoozeCustomDate: "",
    }));
    const followUpSnoozeDirty = $derived(snoozeCustomDate.trim().length > 0);
    const followUpDraftDirty = $derived(followUpPlanDirty || followUpSnoozeDirty);
    const openFollowUps = $derived(followUps.filter((item) => item.status === "open"));
    const closedFollowUps = $derived(followUps.filter((item) => item.status !== "open"));

    /* 跟进输入没有「保存并离开」：离开确认只能放弃或取消，避免隐式创建/推迟。 */
    useCloseGuard({
        busy: () => busy || deleting || personNoteSaving || personNoteLoading || followUpBusy || cadenceSaving,
        dirty: () => followUpDraftDirty,
        changes: () => [
            ...(followUpPlanDirty ? [text("guardFollowUpDraft", "跟进计划草稿尚未添加")] : []),
            ...(followUpSnoozeDirty ? [text("guardSnoozeDraft", "推迟日期尚未应用")] : []),
        ],
    });

    async function loadFollowUps(): Promise<boolean> {
        if (!onListFollowUps) return false;
        const request = ++followUpRequest;
        const targetDocId = current.docId;
        followUpsLoading = true;
        followUpError = ""; /* FUNC-01.12：重试先清错误态，成功后不得残留旧错误分支 */
        try {
            const next = await onListFollowUps(targetDocId);
            /* 旧请求被新请求取代时，交给当前请求继续显示结果，不制造假失败。 */
            if (!detailAlive || request !== followUpRequest || current.docId !== targetDocId) return true;
            followUps = next;
            followUpRefreshWarning = "";
            return true;
        } catch (error) {
            if (detailAlive && request === followUpRequest && current.docId === targetDocId) {
                followUpError = error instanceof Error ? error.message : String(error);
                return false;
            }
            return true;
        } finally {
            if (detailAlive && request === followUpRequest) followUpsLoading = false;
        }
    }

    async function refreshFollowUpsAfterMutation(): Promise<void> {
        const refreshed = await loadFollowUps();
        if (!refreshed && detailAlive) {
            followUpRefreshWarning = text(
                "fuSavedRefreshFail",
                "已保存，但跟进列表刷新失败。请点击“重试”核实最新状态；不要重复提交。",
            );
        }
    }

    loadFollowUps();

    /* ---- B12：组织归属投影（可选：未接线时隐藏该区） ---- */
    let orgMemberships: import("../../services/org").PersonOrgMembershipView[] = $state([]);
    let orgLoading = $state(false);
    let orgReadError = $state("");
    let orgReadRequest = 0;
    let orgCandidatesRequest = 0;
    let orgCandidatesLoading = $state(false);
    let orgCandidatesError = $state("");
    let orgMembershipReport = $state<OrgMembershipWriteReport | null>(null);
    let removingOrgMembershipId = $state("");
    let editingOrgMembershipId = $state("");
    let editOrgDepartment = $state("");
    let editOrgTitle = $state("");
    let editOrgJoinedOn = $state("");
    let editOrgLeftOn = $state("");
    let editOrgStatus = $state<"active" | "former">("active");
    let editOrgAffiliationKind = $state<OrgAffiliationKind>("unspecified");
    let editingOrgSnapshot = $state<OrgMembership | null>(null);
    let removingOrgSnapshot = $state<OrgMembership | null>(null);

    function orgMembershipSnapshot(membership: import("../../services/org").PersonOrgMembershipView): OrgMembership {
        return { id: membership.id, orgDocId: membership.orgDocId, personDocId: current.docId,
            department: membership.department, title: membership.title, joinedOn: membership.joinedOn,
            leftOn: membership.leftOn, status: membership.status,
            ...(membership.affiliationKind === undefined ? {} : { affiliationKind: membership.affiliationKind }) };
    }
    async function loadOrgMemberships(): Promise<void> {
        if (!onLoadOrgMemberships) return;
        const request = ++orgReadRequest;
        const docId = current.docId;
        orgLoading = true;
        orgReadError = "";
        try {
            const next = await onLoadOrgMemberships(docId);
            if (detailAlive && request === orgReadRequest && docId === current.docId) orgMemberships = next;
        } catch (error) {
            if (detailAlive && request === orgReadRequest && docId === current.docId) orgReadError = error instanceof Error ? error.message : String(error);
        } finally { if (detailAlive && request === orgReadRequest && docId === current.docId) orgLoading = false; }
    }

    loadOrgMemberships();

    /* ---- B13.5 双向编辑完整版：人物详情内直接添加/移除组织归属 ---- */
    const orgAddSupported = $derived(Boolean(onLoadOrgCandidates && onAddOrgMembership));
    const orgRemoveSupported = $derived(Boolean(onRemoveOrgMembership));
    let orgCandidates: ReadonlyArray<{ docId: string; name: string }> = $state([]);
    let addOrgDocId = $state("");
    let addOrgDepartment = $state("");
    let addOrgTitle = $state("");
    let addOrgJoinedOn = $state("");
    let addOrgAffiliationKind = $state<OrgAffiliationKind>("unspecified");
    let addOrgBusy = $state(false);
    let addOrgError = $state("");
    /* 候选 = 活跃组织 − 已加入（含历史 former 记录的组织也在已加入之列，避免重复建档） */
    const orgCandidateOptions = $derived(
        orgCandidates.filter((org) => !orgMemberships.some((membership) => membership.orgDocId === org.docId && membership.status === "active")),
    );
    useCloseGuard({
        busy: () => addOrgBusy || orgLoading || orgCandidatesLoading,
        dirty: () => Boolean(addOrgDocId || addOrgDepartment.trim() || addOrgTitle.trim() || addOrgJoinedOn || addOrgAffiliationKind !== "unspecified"
            || editingOrgMembershipId || removingOrgMembershipId),
        changes: () => [text("orgUnsaved", "组织管理中的修改尚未完成")],
    });
    async function loadOrgCandidates(): Promise<void> {
        if (!onLoadOrgCandidates) return;
        const request = ++orgCandidatesRequest;
        orgCandidatesLoading = true;
        orgCandidatesError = "";
        try {
            const next = await onLoadOrgCandidates();
            if (detailAlive && request === orgCandidatesRequest) orgCandidates = next;
        } catch (error) {
            if (detailAlive && request === orgCandidatesRequest) orgCandidatesError = error instanceof Error ? error.message : String(error);
        } finally { if (detailAlive && request === orgCandidatesRequest) orgCandidatesLoading = false; }
    }
    async function addOrgMembership(): Promise<void> {
        if (!onAddOrgMembership || addOrgBusy || orgLoading || orgReadError || orgCandidatesError || orgCandidatesLoading || addOrgDocId === "") return;
        addOrgBusy = true;
        addOrgError = "";
        try {
            const report = await onAddOrgMembership(current.docId, addOrgDocId, {
                department: addOrgDepartment.trim(),
                title: addOrgTitle.trim(),
                joinedOn: addOrgJoinedOn,
                affiliationKind: addOrgAffiliationKind,
            });
            if (!detailAlive) return;
            orgMembershipReport = report ?? null;
            addOrgDocId = "";
            addOrgDepartment = "";
            addOrgTitle = "";
            addOrgJoinedOn = "";
            addOrgAffiliationKind = "unspecified";
            onChanged();
            await loadOrgMemberships();
            await loadOrgCandidates();
        } catch (error) {
            if (detailAlive) addOrgError = error instanceof Error ? error.message : String(error);
        } finally {
            if (detailAlive) addOrgBusy = false;
        }
    }
    async function removeOrgMembership(membershipId: string): Promise<void> {
        if (!onRemoveOrgMembership || addOrgBusy || orgLoading || orgReadError || removingOrgMembershipId !== membershipId) return;
        addOrgBusy = true;
        addOrgError = "";
        try {
            const report = await onRemoveOrgMembership(membershipId, removingOrgSnapshot ?? undefined);
            if (!detailAlive) return;
            orgMembershipReport = report ?? null;
            removingOrgMembershipId = "";
            onChanged();
            await loadOrgMemberships();
            await loadOrgCandidates();
        } catch (error) {
            if (detailAlive) addOrgError = error instanceof Error ? error.message : String(error);
        } finally {
            if (detailAlive) addOrgBusy = false;
        }
    }

    function startEditOrgMembership(membership: import("../../services/org").PersonOrgMembershipView): void {
        if (addOrgBusy || orgLoading || orgReadError) return;
        editingOrgMembershipId = membership.id;
        editingOrgSnapshot = orgMembershipSnapshot(membership);
        editOrgDepartment = membership.department;
        editOrgTitle = membership.title;
        editOrgJoinedOn = membership.joinedOn;
        editOrgLeftOn = membership.leftOn;
        editOrgStatus = membership.status;
        editOrgAffiliationKind = membership.affiliationKind ?? "unspecified";
    }

    async function saveEditOrgMembership(): Promise<void> {
        if (!onUpdateOrgMembership || addOrgBusy || !editingOrgMembershipId || orgLoading || orgReadError) return;
        addOrgBusy = true;
        addOrgError = "";
        try {
            const report = await onUpdateOrgMembership(editingOrgMembershipId, { department: editOrgDepartment, title: editOrgTitle,
                joinedOn: editOrgJoinedOn, leftOn: editOrgLeftOn, status: editOrgStatus, affiliationKind: editOrgAffiliationKind }, editingOrgSnapshot ?? undefined);
            if (!detailAlive) return;
            orgMembershipReport = report ?? null;
            editingOrgMembershipId = "";
            onChanged();
            await loadOrgMemberships();
            await loadOrgCandidates();
        } catch (error) { if (detailAlive) addOrgError = error instanceof Error ? error.message : String(error); }
        finally { if (detailAlive) addOrgBusy = false; }
    }

    function affiliationLabel(kind: OrgAffiliationKind | undefined): string {
        return kind === "work" ? text("orgAffiliationWork", "工作单位") : kind === "education" ? text("orgAffiliationEducation", "学校") : text("orgAffiliationUnspecified", "未分类");
    }

    loadOrgCandidates();

    /* ---- B13.6 共同背景投影（只读展示，零写入；失败降级隐藏） ---- */
    const commonOrgsSupported = $derived(Boolean(onLoadCommonOrgs));
    let commonOrgs: import("../../domain/org-membership").CommonOrgBackground[] = $state([]);
    let commonOrgsFailed = $state(false);
    let commonOrgsRequest = 0;
    async function loadCommonOrgs(): Promise<void> {
        if (!onLoadCommonOrgs) return;
        const request = ++commonOrgsRequest;
        const docId = current.docId;
        try {
            const next = await onLoadCommonOrgs(docId);
            if (!detailAlive || request !== commonOrgsRequest || docId !== current.docId) return;
            commonOrgs = next;
            commonOrgsFailed = false;
        } catch (error) {
            if (!detailAlive || request !== commonOrgsRequest || docId !== current.docId) return;
            commonOrgs = [];
            commonOrgsFailed = true;
        }
    }

    loadCommonOrgs();

    /* FUNC-01.7-a：数据变化（跨窗口/宿主）→ 原地重载洞察与跟进；写入/操作挂起时跳过
       （Workbench 对草稿场景给出可见提示条），当前人物与输入草稿保留 */
    let lastSeenRevision = untrack(() => revision);
    let refreshPending = $state(false);
    let orgRefreshPending = $state(false);
    $effect(() => {
        if (revision !== lastSeenRevision) {
            lastSeenRevision = revision;
            refreshPending = true;
            orgRefreshPending = true;
        }
        if (busy || followUpBusy || personNoteSaving || cadenceSaving || personNoteDraft !== personNote) return;
        if (refreshPending) {
            refreshPending = false;
            void loadOthers();
            void loadInsights();
            void loadFollowUps();
            void loadPersonNoteState(true);
            if (!cadenceDirty) void loadCadence();
        }
        if (orgRefreshPending && !addOrgBusy && !editingOrgMembershipId && !removingOrgMembershipId && !addOrgDocId) {
            orgRefreshPending = false;
            void loadOrgMemberships();
            void loadOrgCandidates();
            void loadCommonOrgs();
        }
    });

    async function createFollowUp() {
        if (followUpBusy || !onCreateFollowUp) return;
        followUpBusy = true;
        followUpError = "";
        followUpActionError = "";
        followUpRefreshWarning = "";
        try {
            await onCreateFollowUp(current.docId, followUpTitle.trim(), followUpDate);
            followUpTitle = "";
            followUpSavedTitle = "";
            followUpSavedDate = followUpDate;
            followUpRecorded = true;
            onChanged();
            await refreshFollowUpsAfterMutation();
        } catch (error) {
            followUpActionError = error instanceof Error ? error.message : String(error);
        } finally {
            followUpBusy = false;
        }
    }

    async function completeFollowUp(item: FollowUpItem) {
        if (followUpBusy || !onSetFollowUpStatus) return;
        followUpBusy = true;
        followUpError = "";
        followUpActionError = "";
        followUpRefreshWarning = "";
        try {
            await onSetFollowUpStatus(item.id, "done");
            await refreshFollowUpsAfterMutation();
            onChanged();
        } catch (error) {
            followUpActionError = error instanceof Error ? error.message : String(error);
        } finally {
            followUpBusy = false;
        }
    }

    async function cancelFollowUp(item: FollowUpItem) {
        if (followUpBusy || !onSetFollowUpStatus) return;
        if (!window.confirm(`取消跟进「${item.title || text("fuKeepInTouch", "保持联系")}」？取消后不再出现在待办中。`)) return;
        followUpBusy = true;
        followUpError = "";
        followUpActionError = "";
        followUpRefreshWarning = "";
        try {
            await onSetFollowUpStatus(item.id, "cancelled");
            await refreshFollowUpsAfterMutation();
            onChanged();
        } catch (error) {
            followUpActionError = error instanceof Error ? error.message : String(error);
        } finally {
            followUpBusy = false;
        }
    }

    async function snooze(item: FollowUpItem, option: SnoozeOption) {
        if (followUpBusy || !onSnoozeFollowUp) return;
        if (option === "custom" && !snoozeCustomDate) return;
        followUpBusy = true;
        followUpError = "";
        followUpActionError = "";
        followUpRefreshWarning = "";
        try {
            await onSnoozeFollowUp(item.id, option, option === "custom" ? snoozeCustomDate : undefined);
            snoozeForId = "";
            snoozeCustomDate = "";
            await refreshFollowUpsAfterMutation();
            onChanged();
        } catch (error) {
            followUpActionError = error instanceof Error ? error.message : String(error);
        } finally {
            followUpBusy = false;
        }
    }

    // ---- 联系节奏（F06） ----
    const cadenceSupported = $derived(Boolean(onGetCadence && onSaveCadence));
    let cadenceLoaded = $state(false);
    const lastContactLabel = $derived.by(() => {
        const first = insights?.timeline?.[0];
        return first?.localDate ?? "";
    });

    async function loadCadence() {
        if (!onGetCadence) return;
        const request = ++cadenceRequest;
        const targetDocId = current.docId;
        cadenceLoaded = false;
        cadenceError = "";
        cadenceLoadError = "";
        try {
            const cadence = await onGetCadence(targetDocId);
            if (!detailAlive || request !== cadenceRequest || current.docId !== targetDocId) return;
            cadenceMode = cadence?.paused ? "paused" : cadence ? "custom" : "global";
            cadenceDays = cadence?.days ?? 14;
            cadenceSavedMode = cadenceMode;
            cadenceSavedDays = cadenceDays;
            cadenceLoadError = "";
            cadenceLoaded = true;
        } catch (error) {
            if (detailAlive && request === cadenceRequest && current.docId === targetDocId) {
                cadenceLoadError = error instanceof Error ? error.message : String(error);
                cadenceLoaded = true;
            }
        }
    }
    loadCadence();

    async function saveCadence(rethrowOnFailure = false) {
        if (cadenceSaving || !onSaveCadence) return;
        cadenceSaving = true;
        cadenceError = "";
        cadenceMessage = "";
        try {
            const days = Math.max(1, Math.min(365, Math.round(cadenceDays || 14)));
            const next: PersonCadence | null = cadenceMode === "global" ? null : { days, paused: cadenceMode === "paused" };
            await onSaveCadence(current.docId, next);
            cadenceDays = days;
            cadenceSavedMode = cadenceMode;
            cadenceSavedDays = days;
            cadenceMessage = cadenceMode === "global"
                ? "已清除覆盖，跟随全局阈值"
                : cadenceMode === "paused"
                    ? "已暂停对该人的联系提醒"
                    : `已设为每 ${days} 天联系一次`;
            onChanged();
        } catch (error) {
            cadenceError = error instanceof Error ? error.message : String(error);
            if (rethrowOnFailure) throw error;
        } finally {
            cadenceSaving = false;
        }
    }
</script>

<div class="lvct-detail">
    <div class="lvct-detail__header">
        <div class="lvct-detail__avatar" data-group={current.group || "未分组"}>{current.name.slice(0, 1)}</div>
        <div class="lvct-detail__id">
            <h3>{current.name}</h3>
            <div class="lvct-detail__meta">
                {#if current.group}<span class="lvct-detail__group-chip">{current.group}</span>{/if}
                {#if current.birthday}<span class="ft__smaller ft__on-surface">生日 {current.birthday}{current.isLunar ? "（农历）" : ""}</span>{/if}
            </div>
        </div>
        <div class="lvct-detail__header-actions">
            <button class="b3-button b3-button--outline" onclick={() => (editing = true)} disabled={busy || deleting}>{text("detailEdit", "编辑")}</button>
            <button class="b3-button b3-button--outline" onclick={() => navigate(previousPerson)} disabled={!previousPerson || busy}>{text("detailPrevious", "上一位")}</button>
            <button class="b3-button b3-button--outline" onclick={() => navigate(nextPerson)} disabled={!nextPerson || busy}>{text("detailNext", "下一位")}</button>
        </div>
    </div>

    <div class="lvct-detail__tabs" role="tablist" tabindex="-1" aria-label="人物详情内容" onkeydown={handleTabKeydown}>
        <button type="button" role="tab" aria-selected={activeTab === "overview"} tabindex={activeTab === "overview" ? 0 : -1} class:lvct-detail__tab--active={activeTab === "overview"} onclick={() => void selectTab("overview")}>{text("detailOverview", "概览")}</button>
        <button type="button" role="tab" aria-selected={activeTab === "activity"} tabindex={activeTab === "activity" ? 0 : -1} class:lvct-detail__tab--active={activeTab === "activity"} onclick={() => void selectTab("activity")}>{text("detailActivity", "互动")}</button>
        <button type="button" role="tab" aria-selected={activeTab === "relations"} tabindex={activeTab === "relations" ? 0 : -1} class:lvct-detail__tab--active={activeTab === "relations"} onclick={() => void selectTab("relations")}>{text("detailRelations", "相关人")}</button>
    </div>

    {#if activeTab === "overview"}
    <PersonProfileSummary profile={current.profile} />
    {#if onLoadRelationshipLabels && onSaveRelationshipLabels && !current.isSelf}
        <RelationshipLabels personDocId={current.docId} {revision} onLoad={onLoadRelationshipLabels} onSave={onSaveRelationshipLabels} {onChanged} />
    {/if}
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

    {#if onLoadPersonNote && onSavePersonNote}
        <section class="lvct-detail__section lvct-detail__person-note">
            <div class="lvct-detail__section-head">
                <div>
                    <h4>个人备注</h4>
                    <p class="ft__smaller ft__on-surface">记录特殊情况、偏好或下次见面要注意的事。写入该人物文档，不计入互动次数。</p>
                </div>
                {#if personNoteSaved}<span class="lvct-chip lvct-bucket--today">已保存</span>{/if}
            </div>
            {#if personNoteLoading}
                <p class="ft__smaller ft__on-surface" role="status">正在读取个人备注…</p>
            {:else}
                <textarea
                    class="b3-text-field lvct-detail__person-note-input"
                    rows="4"
                    maxlength="5000"
                    aria-label="个人备注"
                    placeholder="例如：偏好安静的环境，下次见面前提醒准备资料"
                    bind:value={personNoteDraft}
                    oninput={() => { personNoteDraftRevision += 1; personNoteSaved = false; personNoteError = ""; personNoteErrorKind = ""; }}
                    disabled={personNoteSaving}
                ></textarea>
                <div class="lvct-detail__person-note-actions">
                    <span class="ft__smaller ft__on-surface">{personNoteDraft.length} / 5000</span>
                    <button type="button" class="b3-button b3-button--text" disabled={personNoteSaving || personNoteDraft === personNote} onclick={() => void savePersonNoteState()}>
                        {personNoteSaving ? "保存中…" : "保存备注"}
                    </button>
                </div>
            {/if}
            {#if personNoteError}
                <div class="lvct-form__error" role="alert">个人备注保存失败：{personNoteError}</div>
                {#if personNoteErrorKind === "save"}
                    <button type="button" class="b3-button b3-button--outline" disabled={personNoteLoading || personNoteSaving} onclick={() => void savePersonNoteState()}>重试保存</button>
                {:else}
                    <button type="button" class="b3-button b3-button--outline" disabled={personNoteLoading || personNoteSaving} onclick={() => void loadPersonNoteState()}>重新读取</button>
                {/if}
            {/if}
        </section>
    {/if}

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
                    mutate(persistNote)}
            >{recorded ? text("detailRecorded", "已记录 ✓") : text("detailRecord", "记录")}</button>
        </div>
        <p class="ft__smaller ft__on-surface">记录后，首页"久未联系"会重新计时。</p>
    </section>

    {#if orgSectionSupported}
    <section class="lvct-detail__section">
        <div class="fn__flex" style="align-items: center; gap: 8px;">
            <h4 class="fn__flex-1">{text("orgSectionTitle", "组织归属")}</h4>
            <!-- B13.5 双向编辑最小版：跳转组织管理弹窗维护归属（弹窗内可添加/编辑/移除） -->
            {#if onOpenOrgManager}
                <button type="button" class="b3-button b3-button--text" onclick={onOpenOrgManager}>
                    {text("orgSectionManage", "管理归属")}</button>
            {/if}
        </div>
        {#if orgReadError}
            <p class="lvct-form__error" role="alert">{text("orgMembershipReadUnknown", "组织归属读取失败，结果尚未核实。")}{orgReadError}</p>
            <button class="b3-button b3-button--outline" disabled={addOrgBusy || orgLoading} onclick={() => void loadOrgMemberships()}>{text("orgMembershipReload", "重新读取归属")}</button>
        {:else if orgLoading}
            <p role="status">{text("orgMembersLoading", "正在加载成员…")}</p>
        {:else if orgMemberships.length === 0}
            <p class="ft__smaller ft__on-surface">{text("orgSectionEmpty", "未加入任何组织")}</p>
        {:else}
            <ul class="lvct-detail__timeline">
                {#each orgMemberships as membership (membership.id)}
                    <li class="lvct-detail__timeline-row lvct-detail__org-timeline-row">
                        <span class="lvct-detail__timeline-note">
                            {membership.orgName}
                            <span class="ft__smaller"> · {affiliationLabel(membership.affiliationKind)}</span>
                            {#if membership.department}<span class="ft__smaller"> · {membership.department}</span>{/if}
                            {#if membership.title}<span class="ft__smaller"> · {membership.title}</span>{/if}
                        </span>
                        <span class="lvct-chip {membership.status === "former" ? "lvct-bucket--stale" : "lvct-bucket--today"}">
                            {membership.reachable === false ? text("orgMembershipUnreachable", "组织待核实") : membership.archived ? text("orgMembershipArchived", "组织已归档") : membership.status === "former" ? text("orgMembershipFormer", "已离开") : text("orgMembershipActive", "在职/在学")}
                        </span>
                        {#if membership.joinedOn || membership.leftOn}
                            <span class="ft__on-surface">{membership.joinedOn || "?"}{membership.leftOn ? ` – ${membership.leftOn}` : " –"}</span>
                        {/if}
                        {#if orgRemoveSupported || onUpdateOrgMembership}
                            <span class="lvct-detail__org-actions">
                                {#if orgRemoveSupported}
                                    <button type="button" class="b3-button b3-button--cancel" disabled={addOrgBusy}
                                        aria-label={text("orgMembershipRemoveLabel", "移除归属 {name}", { name: membership.orgName })}
                                        onclick={() => { removingOrgMembershipId = membership.id; removingOrgSnapshot = orgMembershipSnapshot(membership); }}>{text("orgMembershipRemove", "移除")}</button>
                                {/if}
                                {#if onUpdateOrgMembership}
                                    <button class="b3-button b3-button--text" disabled={addOrgBusy} onclick={() => startEditOrgMembership(membership)}>{text("orgMemberEdit", "编辑")}</button>
                                {/if}
                            </span>
                        {/if}
                        {#if editingOrgMembershipId === membership.id}
                            <div class="lvct-org-add">
                                <input class="b3-text-field" bind:value={editOrgDepartment} disabled={addOrgBusy} aria-label={text("orgMemberDeptLabel", "部门")} />
                                <input class="b3-text-field" bind:value={editOrgTitle} disabled={addOrgBusy} aria-label={text("orgMemberTitleLabel", "职位")} />
                                <input class="b3-text-field" type="date" bind:value={editOrgJoinedOn} disabled={addOrgBusy} aria-label={text("orgMemberJoinedLabel", "加入日期")} />
                                <input class="b3-text-field" type="date" bind:value={editOrgLeftOn} disabled={addOrgBusy} aria-label={text("orgMemberLeftLabel", "离开日期")} />
                                <select class="b3-select" bind:value={editOrgStatus} disabled={addOrgBusy} aria-label={text("orgMemberStatusLabel", "状态")}>
                                    <option value="active">{text("orgStatusActive", "在职/在读")}</option><option value="former">{text("orgStatusFormer", "已离开")}</option>
                                </select>
                                <select class="b3-select" bind:value={editOrgAffiliationKind} disabled={addOrgBusy} aria-label={text("orgAffiliationKind", "归属分类")}>
                                    <option value="unspecified">{affiliationLabel("unspecified")}</option><option value="work">{affiliationLabel("work")}</option><option value="education">{affiliationLabel("education")}</option>
                                </select>
                                <p>{text("orgMembershipEditImpact", "保存会更新这段成员记录及双方当前双链；离开保留历史。恢复在职/在学须清空离开日期。")}</p>
                                <button class="b3-button b3-button--text" disabled={addOrgBusy} onclick={() => void saveEditOrgMembership()}>{text("orgMemberSave", "保存")}</button>
                                <button class="b3-button b3-button--cancel" disabled={addOrgBusy} onclick={() => (editingOrgMembershipId = "")}>{text("orgMemberCancel", "取消")}</button>
                            </div>
                        {/if}
                        {#if removingOrgMembershipId === membership.id}
                            <div role="group" aria-label={text("orgMembershipRemoveConfirm", "确认移除这段成员历史")}>
                                <p>{text("orgMembershipRemoveImpact", "将删除这段成员历史并重建双方当前双链。普通离职请编辑为已离开；人物和组织文档保留。")}</p>
                                <button class="b3-button b3-button--cancel" disabled={addOrgBusy} onclick={() => void removeOrgMembership(membership.id)}>{text("orgMembershipRemoveConfirm", "确认移除这段成员历史")}</button>
                                <button class="b3-button b3-button--outline" disabled={addOrgBusy} onclick={() => (removingOrgMembershipId = "")}>{text("orgMemberCancel", "取消")}</button>
                            </div>
                        {/if}
                    </li>
                {/each}
            </ul>
        {/if}
        {#if orgAddSupported}
            <p>{text("orgMembershipAddImpact", "添加会登记新期间并更新双方当前双链；已离开的期间保留，重复添加当前成员不新增记录。")}</p>
            {#if orgCandidatesError}<p class="lvct-form__error" role="alert">{orgCandidatesError}</p>
                <button class="b3-button b3-button--outline" disabled={addOrgBusy || orgCandidatesLoading} onclick={() => void loadOrgCandidates()}>{text("orgMembershipReloadCandidates", "重新读取组织候选")}</button>
            {/if}
            <div class="lvct-org-add">
                <select class="b3-select" bind:value={addOrgDocId} disabled={addOrgBusy}
                    aria-label={text("orgAddOrgLabel", "选择要加入的组织")}>
                    <option value="">{text("orgAddOrgPick", "选择组织…")}</option>
                    {#each orgCandidateOptions as org (org.docId)}
                        <option value={org.docId}>{org.name} · {org.docId}</option>
                    {/each}
                </select>
                <input class="b3-text-field" placeholder={text("orgMemberDeptLabel", "部门")} bind:value={addOrgDepartment}
                    disabled={addOrgBusy} aria-label={text("orgAddDeptLabel", "归属部门")} />
                <input class="b3-text-field" placeholder={text("orgMemberTitleLabel", "职位")} bind:value={addOrgTitle}
                    disabled={addOrgBusy} aria-label={text("orgAddTitleLabel", "归属职位")} />
                <input class="b3-text-field" type="date" bind:value={addOrgJoinedOn} disabled={addOrgBusy}
                    aria-label={text("orgAddJoinedLabel", "加入日期")} />
                <select class="b3-select" bind:value={addOrgAffiliationKind} disabled={addOrgBusy} aria-label={text("orgAffiliationKind", "归属分类")}>
                    <option value="unspecified">{affiliationLabel("unspecified")}</option><option value="work">{affiliationLabel("work")}</option><option value="education">{affiliationLabel("education")}</option>
                </select>
                <button type="button" class="b3-button b3-button--text" disabled={addOrgBusy || orgLoading || orgCandidatesLoading || !!orgReadError || !!orgCandidatesError || addOrgDocId === ""}
                    onclick={() => void addOrgMembership()}>{text("orgAddSubmit", "添加归属")}</button>
            </div>
        {/if}
        <OrgMembershipResult report={orgMembershipReport} {i18n} />
        {#if addOrgError}
            <p class="lvct-form__error" role="alert">{addOrgError}</p>
            <button class="b3-button b3-button--outline" disabled={addOrgBusy || orgLoading} onclick={() => void loadOrgMemberships()}>{text("orgMembershipReload", "重新读取归属")}</button>
        {/if}
    </section>
    {/if}

    {#if commonOrgsSupported && (commonOrgs.length > 0 || commonOrgsFailed)}
    <section class="lvct-detail__section">
        <h4>{text("orgCommonTitle", "共同背景")}</h4>
        {#if commonOrgsFailed}
            <p class="ft__smaller ft__on-surface">{text("orgCommonFailed", "共同背景读取失败，可在数据刷新后重试。")}</p>
        {:else}
            {#each commonOrgs as entry (entry.orgDocId)}
                <div class="lvct-org-common">
                    <b>{entry.orgName}</b>
                    {#if onOpenOrganization}
                        <button class="b3-button b3-button--text" onclick={() => onOpenOrganization?.(entry.orgDocId)}>{text("routeOpenOrganization", "查看组织")}</button>
                    {/if}
                    {#each entry.peers as peer (peer.docId)}
                        {@const contact = peer.contact}
                        <div class="lvct-org-common__peer">
                            <span>{peer.name}</span>
                            <span class="lvct-chip {peer.samePeriod ? "lvct-bucket--today" : "lvct-bucket--stale"}">
                                {peer.samePeriod ? text("orgCommonSamePeriod", "同期") : text("orgCommonSameOrg", "同组织")}
                            </span>
                            <span class="ft__smaller ft__on-surface">{peer.overlapText}</span>
                            {#if contact}
                                <!-- B13.6 点击同伴开详情（onNavigate 即切换详情弹窗人物） -->
                                <button type="button" class="b3-button b3-button--text"
                                    onclick={() => void (async () => {
                                        if (!detailAlive) return;
                                        if (onNavigateDocId) await onNavigateDocId(peer.docId);
                                        else if (await canLeave.requestClose() && detailAlive) onNavigate(contact);
                                    })()}>{text("orgCommonOpen", "查看详情")}</button>
                            {/if}
                        </div>
                    {/each}
                </div>
            {/each}
            <p class="ft__smaller ft__on-surface">{text("orgCommonNote", "依据为组织成员记录；加入时间未知者只标「同组织」，不推断同期。")}</p>
        {/if}
    </section>
    {/if}

    {#if followUpSupported}
    <section class="lvct-detail__section">
        <h4>{text("fuSectionTitle", "跟进计划")}</h4>
        {#if followUpActionError}
            <div class="lvct-form__error" role="alert">{text("fuActionFail", "跟进操作失败：{msg}", { msg: followUpActionError })}</div>
        {/if}
        {#if followUpRefreshWarning}
            <StatusNotice error message={followUpRefreshWarning} actionLabel={text("commonRetry", "重试")} onAction={() => void loadFollowUps()} />
        {/if}
        {#if followUpError}
            <!-- FUNC-01.12：读取失败显式报错并可重试，不与「没有跟进计划」空态同时呈现 -->
            <ViewState compact error title={text("fuLoadFailTitle", "跟进计划加载失败")} description={followUpError}>
                <button type="button" class="b3-button b3-button--outline" onclick={loadFollowUps}>{text("commonRetry", "重试")}</button>
            </ViewState>
        {:else if followUpsLoading}
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
                            {#if item.docMissing}<span class="lvct-chip lvct-bucket--stale">{text("fuDocMissing", "任务块已移除")}</span>{/if}
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
        {#if cadenceLoadError}
            <ViewState compact error title={text("cadenceLoadFailTitle", "联系节奏读取失败")} description={cadenceLoadError}>
                <button type="button" class="b3-button b3-button--outline" onclick={loadCadence}>{text("commonRetry", "重试")}</button>
            </ViewState>
        {:else if !cadenceLoaded}
            <ViewState compact loading title={text("cadenceLoading", "正在读取联系节奏")} />
        {:else}
            {#if cadenceError}<div class="lvct-form__error" role="alert">{cadenceError}</div>{/if}
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
                <button class="b3-button b3-button--text" onclick={() => void saveCadence()} disabled={cadenceSaving}>
                    {cadenceSaving ? text("cadenceSaving", "保存中…") : text("cadenceSave", "保存节奏")}
                </button>
            </div>
            <StatusNotice message={cadenceMessage} onDismiss={() => (cadenceMessage = "")} />
            <p class="ft__smaller ft__on-surface">{text("cadenceNote", "仅影响首页「久未联系」提醒，不写入联系人的数据库字段。")}</p>
        {/if}
    </section>
    {/if}
    {#if (onLoadExchanges && onCreateExchange && onChangeExchangeStatus) || (onLoadAliases && onAddAlias && onRemoveAlias)}
        <details class="lvct-detail__advanced">
            <summary>
                <span>更多资料与辅助记录</span>
                <span class="ft__smaller ft__on-surface">往来账本 · 别名</span>
            </summary>
            {#if onLoadExchanges && onCreateExchange && onChangeExchangeStatus}
                <ExchangeLedger
                    personDocId={current.docId}
                    {i18n}
                    onLoad={onLoadExchanges}
                    onCreate={onCreateExchange}
                    onChangeStatus={onChangeExchangeStatus}
                    onChanged={onChanged}
                />
            {/if}
            {#if onLoadAliases && onAddAlias && onRemoveAlias}
                <PersonAliases
                    personDocId={current.docId}
                    {i18n}
                    onLoad={onLoadAliases}
                    onAdd={onAddAlias}
                    onRemove={onRemoveAlias}
                    {onChanged}
                />
            {/if}
        </details>
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
                <button class="b3-button b3-button--outline" onclick={loadInsights}>{text("commonRetry", "重试")}</button>
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
                <button class="b3-button b3-button--text" onclick={() => void selectTab("overview")}>去记一笔</button>
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
                    <button class="b3-button b3-button--outline" onclick={() => relationPicker?.openPicker()}>选择联系人</button>
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
            <PersonPicker
                bind:this={relationPicker}
                items={relationCandidates}
                ariaLabel="选择要添加关系的联系人"
                placeholder={candidates.length === 0 ? "没有可添加的联系人" : "搜索并选择联系人…"}
                emptyText={candidates.length === 0 ? "没有可添加的联系人" : "没有匹配的联系人"}
                disabled={busy || othersLoading || !!othersError}
                onSelect={(itemId) => {
                    const other = others.find((item) => item.itemId === itemId);
                    if (other) mutate(() => addRelation(settings, current, other));
                }}
            />
        </div>
        <p class="ft__smaller ft__on-surface">关系为双向：添加后对方的「被相关人」列会自动出现你。</p>
        {#if pendingRelationProjections.length > 0}
            <div role="alert" class="lvct-form__error">
                <p>{text("relationProjectionPending", "关系事实已保存，但部分文档投影尚未核实。")}</p>
                <ul>{#each pendingRelationProjections as item (item.docId)}<li>{item.docId}：{item.message}</li>{/each}</ul>
                <button type="button" class="b3-button b3-button--outline" disabled={busy} onclick={retryRelatedDocuments}>{text("relationProjectionRetry", "只重试未完成文档")}</button>
            </div>
        {/if}
    </section>
    {/if}

    {#if errorText}
        <div class="lvct-form__error" role="alert">{errorText}</div>
    {/if}

    <div class="lvct-form__actions">
        <button class="b3-button b3-button--cancel" onclick={() => void (async () => { if (await canLeave.requestClose()) onClose(); })()} disabled={busy || deleting}>{closeLabel ?? text("closeDialog", "关闭")}</button>
        <button class="b3-button b3-button--text" onclick={() => onOpenPersonDoc(current.docId)}>{text("detailOpenDoc", "打开文档")}</button>
        <button class="b3-button b3-button--cancel lvct-detail__delete" onclick={confirmDelete} disabled={busy || deleting}>{deleting ? text("detailRemoving", "移除中…") : text("detailRemove", "从人脉移除")}</button>
    </div>
</div>

{#if editing}
    <LvctDialog title={`编辑资料 · ${current.name}`} onClose={() => (editing = false)}>
        <PersonEditDialog
            {settings}
            {i18n}
            person={current}
            onSaved={refreshAfterEdit}
            onClose={() => (editing = false)}
        />
    </LvctDialog>
{/if}

{#if templateManagerOpen}
    <LvctDialog title={text("tplManagerTitle", "管理互动备注模板")} onClose={() => (templateManagerOpen = false)}>
        <TemplateManager {i18n} templates={templates} onSave={persistTemplates} onClose={() => (templateManagerOpen = false)} />
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
