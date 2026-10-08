import type { ContactsSettings } from "./domain/model";
import type { DashboardData, DashboardOptions } from "./services/dashboard";
import type { CaptureOptions, CapturePreview, CaptureResult } from "./services/capture";
import type { AiExtractOutcome, AiExtractionConfirmation } from "./services/ai-extract";
import type { AiPreflight, AiPreflightOptions } from "./domain/ai-preflight";
import type { PersonInsights } from "./services/insights";
import type { FieldMapPatch, FieldRebuildPreview, SettingsRebindPreview, SettingsAnchorPatch, SettingsHealth } from "./services/settings-health";
import type { ViewPreferences } from "./domain/preferences";
import type { InteractionImportSummary } from "./domain/interaction-backup";
import type { FollowUpItem, SnoozeOption } from "./domain/followups";
import type { PersonCadence } from "./domain/cadence";
import type { NoteTemplate } from "./domain/interaction-templates";
import type { ReviewReport } from "./domain/review-report";
import type { FollowUpImportPreview } from "./services/followups";
import type { InteractionImportDiff } from "./domain/interaction-backup";
import type { MigrationImportResult, MigrationModulePreview } from "./services/migration-bundle";
import type { ExportSummary } from "./services/export-center";
import type { AnchorScanOptions, AnchorScanResult, InitProgressStep, WorkspaceSnapshot } from "./services/init";
import type { CreatePersonExchangeInput, ExchangePatch, ExchangeRecord, ExchangeStatus } from "./services/exchanges";
import type { PersonIdentityResolution as AliasResolution, PersonAlias } from "./services/person-aliases";
import type { WorkspaceState } from "./domain/workspace-state";

export type WorkbenchView = "home" | "people" | "graph" | "orgs" | "settings";

/**
 * 插件实例暴露给组件层的结构化视图（避免组件 import 插件入口造成循环依赖）。
 */
export interface ContactsPluginFacade {
    readonly i18n?: Readonly<Record<string, string>>;
    readonly settings: ContactsSettings | null;
    readonly workspaceState: WorkspaceState;
    readonly viewPreferences: ViewPreferences;
    readonly isMobile: boolean;
    reloadWorkspaceState(): Promise<WorkspaceState>;
    loadPersonRelationshipLabels(personDocId: string): Promise<import("./services/people-profiles").RelationshipLabelEditorState>;
    savePersonRelationshipLabels(personDocId: string, selfDocId: string, labels: string[], expected: import("./domain/person-relationship-labels").PersonRelationshipLabels | null): Promise<import("./domain/person-relationship-labels").PersonRelationshipLabels>;
    /** 执行工作空间初始化并向导日志回调进度；幂等可续建，失败抛错 */
    initialize(notebookName: string, onProgress: (step: InitProgressStep) => void, options?: { createSelf?: boolean }): Promise<ContactsSettings>;
    /** 初始化前预检：同名笔记本/宿主文档/数据库/可复用字段（向导据此提示将复用哪些内容） */
    previewInitialize(notebookName: string): Promise<WorkspaceSnapshot>;
    /** FUNC-01.8：分页只读扫描可复用锚点；返回游标后由设置页显式续做 */
    scanAnchorCandidates(options?: AnchorScanOptions): Promise<AnchorScanResult>;
    /** 仪表盘聚合（近期生日/久未联系/统计） */
    loadDashboard(options?: Partial<DashboardOptions>): Promise<DashboardData>;
    /** 记一笔互动（幂等） */
    recordInteraction(personDocId: string, note?: string): Promise<void>;
    deleteInteraction(personDocId: string, eventId: string): Promise<void>;
    /** 人物洞察：互动时间线 + 共同出席统计 */
    loadPersonInsights(docId: string): Promise<PersonInsights>;
    /** 人物独立备注：写入对应人物文档的 custom-lvct-person-note 标记块，不计入互动统计 */
    loadPersonNote(personDocId: string): Promise<string>;
    savePersonNote(personDocId: string, note: string, expected?: string): Promise<string>;
    loadRecentInteractions(): Promise<Record<string, { occurredAt: number; localDate: string }>>;
    /** 个人往来账本：金钱、物品、人情均按人物独立记录 */
    listPersonExchanges(personDocId: string): Promise<ExchangeRecord[]>;
    createPersonExchange(input: CreatePersonExchangeInput): Promise<ExchangeRecord>;
    updatePersonExchange(id: string, patch: ExchangePatch): Promise<ExchangeRecord>;
    changePersonExchangeStatus(id: string, status: ExchangeStatus, settledOn?: string): Promise<ExchangeRecord>;
    listPersonAliases(personDocId: string): Promise<PersonAlias[]>;
    addPersonAlias(personDocId: string, alias: string): Promise<PersonAlias>;
    removePersonAlias(id: string): Promise<void>;
    resolvePersonAlias(alias: string): Promise<AliasResolution>;
    /** 检查固化字段 ID 是否仍存在于联系人数据库 */
    checkSettingsHealth(): Promise<SettingsHealth>;
    /** FUNC-01.4 资料体检：只读巡检名册数据质量（缺字段/悬空关系/孤儿互动等），零写入 */
    runHealthAudit(): Promise<import("./domain/health-audit").AuditIssue[]>;
    runHealthAuditReport(previous?: import("./domain/health-audit").HealthAuditReport): Promise<import("./domain/health-audit").HealthAuditReport>;
    retryFailedHealthAuditModules(previous: import("./domain/health-audit").HealthAuditReport): Promise<import("./domain/health-audit").HealthAuditReport>;
    /** 显式补建健康检查发现的缺失字段，并返回新的字段映射 */
    previewMissingFields(): Promise<FieldRebuildPreview>;
    rebuildMissingFields(preview: FieldRebuildPreview): Promise<ContactsSettings>;
    /** 显式验证并重新绑定已有联系人数据库的文档/数据库/视图锚点 */
    previewRebindSettings(patch: SettingsAnchorPatch): Promise<SettingsRebindPreview>;
    rebindSettings(patch: SettingsAnchorPatch, preview: SettingsRebindPreview): Promise<ContactsSettings>;
    repairFieldMap(patch: FieldMapPatch): Promise<ContactsSettings>;
    /** 导出插件自管互动事件，不修改当前存储 */
    exportInteractionJson(): Promise<string>;
    exportMigrationBundle(): Promise<string>;
    previewMigrationImport(text: string): Promise<MigrationModulePreview[]>;
    importMigrationBundle(text: string): Promise<MigrationImportResult>;
    /** 跟进事项（F05）：日期型联系计划，独立于互动事实 */
    listPersonFollowUps(personDocId: string): Promise<FollowUpItem[]>;
    /** 创建跟进计划；dueDate 为 YYYY-MM-DD，非法日期抛错 */
    createFollowUp(personDocId: string, title: string, dueDate: string): Promise<FollowUpItem>;
    /** 状态变更：open（重新打开）/ done（完成）/ cancelled（取消）；完成不自动写互动 */
    setFollowUpStatus(id: string, status: "open" | "done" | "cancelled"): Promise<void>;
    /** 语义化推迟：tomorrow/threeDays/nextMonday/nextMonth 或 custom（需合法日期） */
    snoozeFollowUp(id: string, option: SnoozeOption, customDate?: string): Promise<void>;
    exportFollowUpsJson(): Promise<string>;
    previewFollowUpsImport(text: string): Promise<FollowUpImportPreview>;
    importFollowUpsJson(text: string): Promise<FollowUpImportPreview>;
    /** 联系节奏（F06）：按人覆盖久未联系阈值或暂停；未登记返回 null（跟随全局），保存 null 清除覆盖 */
    getPersonCadence(personDocId: string): Promise<PersonCadence | null>;
    savePersonCadence(personDocId: string, cadence: PersonCadence | null): Promise<void>;
    /** B08 提醒暂缓（reminder-dismissals.json）：只屏蔽提醒呈现，统计口径不变 */
    dismissReminder(personDocId: string, kind: "birthday" | "stale", until: string): Promise<void>;
    resumeReminder(personDocId: string, kind: "birthday" | "stale"): Promise<void>;
    /** 已暂缓提醒列表（设置页恢复入口用） */
    loadReminderDismissals(): Promise<import("./domain/reminder-dismissals").ReminderDismissal[]>;
    /** 互动备注模板（F09）：空存储返回内置默认；全量保存（增改删统一入口） */
    listTemplates(): Promise<NoteTemplate[]>;
    saveTemplates(templates: readonly NoteTemplate[]): Promise<NoteTemplate[]>;
    /** 交往回顾报表（F12）：区间互动统计（只读投影，人物条数与同场活动分口径） */
    buildReviewReport(from: string, to: string): Promise<ReviewReport>;
    /** 导出中心摘要：名册人数与活跃互动条数（展示用，容错读取） */
    loadExportSummary(): Promise<ExportSummary>;
    /** 导出全量名册为 vCard 3.0 文本（联系人页选中导出外的设置页统一入口） */
    exportRosterVcf(): Promise<string>;
    previewInteractionImport(text: string): Promise<InteractionImportSummary>;
    importInteractionJson(text: string): Promise<InteractionImportSummary>;
    /** 备份差异明细（F15）：按事件展开将新增/将跳过与删除标记影响（零写入） */
    previewInteractionImportDiff(text: string): Promise<InteractionImportDiff>;
    loadViewPreferences(): Promise<ViewPreferences>;
    saveViewPreferences(preferences: ViewPreferences): Promise<ViewPreferences>;
    /** 从笔记捕获：预览出链指向的联系人 */
    previewCapture(docId: string): Promise<CapturePreview>;
    /** FAST-01.4：按全字段更新联系人资料（编辑弹窗语义，空=清空） */
    updatePersonFields(personItemId: string, draft: import("./domain/person").ContactDraft): Promise<import("./domain/contact-write").ContactWriteReport>;
    /** B11：本人身份读取（null = 未建立） */
    loadSelfIdentity(): Promise<import("./domain/self-identity").SelfIdentity | null>;
    /** B11.3：确保本人档案「我自己」存在（幂等；失败返回 null） */
    createSelfProfile(): Promise<import("./domain/self-identity").SelfIdentity | null>;
    /** B11.3/B11.5：把本人身份显式指定到一名已有联系人（显式改绑，原资料保留） */
    designateSelfIdentity(personItemId: string): Promise<import("./domain/self-identity").SelfIdentity>;
    previewSelfIdentityChange(targetItemId: string | null): Promise<import("./domain/self-identity").SelfIdentityChangePreview>;
    applySelfIdentityChange(preview: import("./domain/self-identity").SelfIdentityChangePreview): Promise<import("./domain/self-identity").SelfIdentity | null>;
    /** B11.3：全量名册（设置页本人档案指定用） */
    listContacts(): Promise<import("./domain/person").ContactSummary[]>;
    /** B13.3：组织列举（含成员记录） */
    listOrganizations(): Promise<import("./services/org").OrganizationWithMembers[]>;
    /** B13.5c：组织标记 keyset 分页；旧宿主未提供时由组织页回退全量列举 */
    listOrganizationsPage?(options?: { afterRootId?: string; limit?: number }): Promise<import("./services/org").OrganizationPage>;
    /** B13.3：新建组织（文档 + custom-lvct-org 标记区块；同名拒绝） */
    createOrganization(name: string): Promise<{ docId: string }>;
    /** B13.3：组织成员列举（join 名册姓名） */
    listOrganizationMembers(orgDocId: string): Promise<import("./services/org").OrganizationMember[]>;
    /** B13.5b：组织成员稳定分页与筛选；旧宿主未提供时由 UI 回退全量列举 */
    listOrganizationMembersPage?(orgDocId: string, options?: { query?: string; status?: "all" | "active" | "former"; offset?: number; limit?: number }): Promise<import("./services/org").OrganizationMemberPage>;
    /** B13.3：添加组织成员（active） */
    addOrganizationMember(orgDocId: string, personDocId: string, extra?: { department?: string; title?: string; joinedOn?: string; affiliationKind?: import("./domain/org-membership").OrgAffiliationKind }): Promise<import("./services/org-member-writes").OrgMembershipWriteReport | void>;
    /** B13.3：移除组织成员记录 */
    removeOrganizationMember(id: string, expected?: import("./domain/org-membership").OrgMembership): Promise<import("./services/org-member-writes").OrgMembershipWriteReport | void>;
    /** B13.4：更新成员记录字段（部门/职位/入职/离职/状态；身份字段不可变） */
    updateOrganizationMember(id: string, patch: import("./domain/org-membership").OrgMembershipPatch, expected?: import("./domain/org-membership").OrgMembership): Promise<import("./services/org-member-writes").OrgMembershipWriteReport | void>;
    replaceOrganizationMember(formerMembershipId: string, successorPersonDocId: string, extra: { department?: string; title?: string; joinedOn: string; leftOn: string; affiliationKind?: import("./domain/org-membership").OrgAffiliationKind }, expected?: import("./domain/org-membership").OrgMembership): Promise<import("./services/org-member-writes").OrgMembershipWriteReport | void>;
    /** B13：归档组织（标记区块值 archived；文档与成员记录保留可恢复） */
    archiveOrganization(orgDocId: string): Promise<void>;
    /** B13：恢复归档组织 */
    restoreOrganization(orgDocId: string): Promise<void>;
    /** B13.4：组织改名（同名检查；标记块文案同步，归档值保持） */
    renameOrganization(orgDocId: string, name: string): Promise<void>;
    listPendingOrganizationOperations?(): Promise<import("./domain/organization-operations").OrganizationOperationReport[]>;
    inspectOrganizationOperation?(requestId: string): Promise<import("./domain/organization-operations").OrganizationOperationReport>;
    resumeOrganizationOperation?(requestId: string): Promise<import("./domain/organization-operations").OrganizationOperationReport>;
    /** B13.9：移除悬空的 org-links 区块（体检修复入口；逐块隔离返回失败清单） */
    removeOrgLinkBlocks(blockIds: readonly string[]): Promise<Array<{ id: string; message: string }>>;
    /** B13.3：打开组织管理弹窗（B13.5 人物详情维护入口复用；B13.6a 可携目标组织定位，目标缺失回退首个） */
    openOrgManagerDialog(initialOrgDocId?: string): void;
    /** B12：某人的组织归属投影（成员记录 join 组织名） */
    listPersonOrgMemberships(personDocId: string): Promise<import("./services/org").PersonOrgMembershipView[]>;
    previewOrganizationProjections?(docIds?: readonly string[]): Promise<import("./services/org-projections").OrgProjectionPreview>;
    repairOrganizationProjection?(preview: import("./services/org-projections").OrgProjectionPreview, retryKey: string): Promise<import("./services/org-projections").OrgProjectionRepairResult>;
    /** B13.6：共同背景（同组织联系人，重叠期间/同期口径，零写入） */
    listCommonOrgBackground(personDocId: string): Promise<import("./domain/org-membership").CommonOrgBackground[]>;
    /** FUNC-01.14：AI 资料候选受限补丁写——只写补丁字段，最新名册回读逐字段冲突核对 */
    updatePersonCandidateFields(personItemId: string, patches: readonly import("./domain/contact-patch").CandidateFieldPatch[]): Promise<import("./services/contacts").CandidateFieldApplyResult>;
    /** 从笔记捕获：确认执行（互动事件 + 参与人区块 + 新人收编） */
    captureDoc(docId: string, options: CaptureOptions): Promise<CaptureResult>;
    /** AI 抽取本页人名/日期/地点（需思源内置 AI；结果须经确认 UI） */
    prepareAiExtraction(docId: string, options?: AiPreflightOptions): Promise<AiPreflight>;
    aiExtractFromDoc(docId: string, confirmation?: AiExtractionConfirmation): Promise<AiExtractOutcome>;
    /** 打开任意思源文档（捕获完成页等快捷入口使用） */
    openDoc(docId: string): void;
    openHostDoc(): void;
    /** 打开人物文档（联系人详情页 = 人物文档） */
    openPersonDoc(docId: string): void;
    openSettings(): void;
}
