import type { ContactsSettings } from "./domain/model";
import type { DashboardData, DashboardOptions } from "./services/dashboard";
import type { CaptureOptions, CapturePreview, CaptureResult } from "./services/capture";
import type { AiExtractOutcome } from "./services/ai-extract";
import type { PersonInsights } from "./services/insights";
import type { FieldMapPatch, SettingsAnchorPatch, SettingsHealth } from "./services/settings-health";
import type { ViewPreferences } from "./domain/preferences";
import type { InteractionImportSummary } from "./domain/interaction-backup";
import type { FollowUpItem, SnoozeOption } from "./domain/followups";
import type { PersonCadence } from "./domain/cadence";
import type { NoteTemplate } from "./domain/interaction-templates";
import type { ReviewReport } from "./domain/review-report";
import type { FollowUpImportPreview } from "./services/followups";
import type { InteractionImportDiff } from "./domain/interaction-backup";
import type { ExportSummary } from "./services/export-center";
import type { InitProgressStep, WorkspaceSnapshot } from "./services/init";

export type WorkbenchView = "home" | "people" | "graph" | "settings";

/**
 * 插件实例暴露给组件层的结构化视图（避免组件 import 插件入口造成循环依赖）。
 */
export interface ContactsPluginFacade {
    readonly i18n?: Readonly<Record<string, string>>;
    readonly settings: ContactsSettings | null;
    readonly viewPreferences: ViewPreferences;
    readonly isMobile: boolean;
    /** 执行工作空间初始化并向导日志回调进度；幂等可续建，失败抛错 */
    initialize(notebookName: string, onProgress: (step: InitProgressStep) => void): Promise<ContactsSettings>;
    /** 初始化前预检：同名笔记本/宿主文档/数据库/可复用字段（向导据此提示将复用哪些内容） */
    previewInitialize(notebookName: string): Promise<WorkspaceSnapshot>;
    /** 仪表盘聚合（近期生日/久未联系/统计） */
    loadDashboard(options?: Partial<DashboardOptions>): Promise<DashboardData>;
    /** 记一笔互动（幂等） */
    recordInteraction(personDocId: string, note?: string): Promise<void>;
    deleteInteraction(personDocId: string, eventId: string): Promise<void>;
    /** 人物洞察：互动时间线 + 共同出席统计 */
    loadPersonInsights(docId: string): Promise<PersonInsights>;
    loadRecentInteractions(): Promise<Record<string, { occurredAt: number; localDate: string }>>;
    /** 检查固化字段 ID 是否仍存在于联系人数据库 */
    checkSettingsHealth(): Promise<SettingsHealth>;
    /** 显式补建健康检查发现的缺失字段，并返回新的字段映射 */
    rebuildMissingFields(): Promise<ContactsSettings>;
    /** 显式验证并重新绑定已有联系人数据库的文档/数据库/视图锚点 */
    rebindSettings(patch: SettingsAnchorPatch): Promise<ContactsSettings>;
    repairFieldMap(patch: FieldMapPatch): Promise<ContactsSettings>;
    /** 导出插件自管互动事件，不修改当前存储 */
    exportInteractionJson(): Promise<string>;
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
    /** 从笔记捕获：确认执行（互动事件 + 参与人区块 + 新人收编） */
    captureDoc(docId: string, options: CaptureOptions): Promise<CaptureResult>;
    /** AI 抽取本页人名/日期/地点（需思源内置 AI；结果须经确认 UI） */
    aiExtractFromDoc(docId: string): Promise<AiExtractOutcome>;
    /** 打开任意思源文档（捕获完成页等快捷入口使用） */
    openDoc(docId: string): void;
    openHostDoc(): void;
    /** 打开人物文档（联系人详情页 = 人物文档） */
    openPersonDoc(docId: string): void;
    openSettings(): void;
}
