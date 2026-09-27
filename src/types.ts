import type { ContactsSettings } from "./domain/model";
import type { DashboardData, DashboardOptions } from "./services/dashboard";
import type { CaptureOptions, CapturePreview, CaptureResult } from "./services/capture";
import type { AiExtractOutcome } from "./services/ai-extract";
import type { PersonInsights } from "./services/insights";
import type { FieldMapPatch, SettingsAnchorPatch, SettingsHealth } from "./services/settings-health";
import type { ViewPreferences } from "./domain/preferences";
import type { InteractionImportSummary } from "./domain/interaction-backup";
import type { ExportSummary } from "./services/export-center";

export type WorkbenchView = "home" | "people" | "graph" | "settings";

/**
 * 插件实例暴露给组件层的结构化视图（避免组件 import 插件入口造成循环依赖）。
 */
export interface ContactsPluginFacade {
    readonly i18n?: Readonly<Record<string, string>>;
    readonly settings: ContactsSettings | null;
    readonly viewPreferences: ViewPreferences;
    readonly isMobile: boolean;
    /** 执行工作空间初始化并向导日志回调进度；失败抛错 */
    initialize(notebookName: string, onProgress: (message: string) => void): Promise<ContactsSettings>;
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
    /** 导出中心摘要：名册人数与活跃互动条数（展示用，容错读取） */
    loadExportSummary(): Promise<ExportSummary>;
    /** 导出全量名册为 vCard 3.0 文本（联系人页选中导出外的设置页统一入口） */
    exportRosterVcf(): Promise<string>;
    previewInteractionImport(text: string): Promise<InteractionImportSummary>;
    importInteractionJson(text: string): Promise<InteractionImportSummary>;
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
