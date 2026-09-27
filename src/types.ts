import type { ContactsSettings } from "./domain/model";
import type { DashboardData, DashboardOptions } from "./services/dashboard";
import type { CaptureOptions, CapturePreview, CaptureResult } from "./services/capture";
import type { AiExtractOutcome } from "./services/ai-extract";
import type { PersonInsights } from "./services/insights";

/**
 * 插件实例暴露给组件层的结构化视图（避免组件 import 插件入口造成循环依赖）。
 */
export interface ContactsPluginFacade {
    readonly settings: ContactsSettings | null;
    readonly isMobile: boolean;
    /** 执行工作空间初始化并向导日志回调进度；失败抛错 */
    initialize(notebookName: string, onProgress: (message: string) => void): Promise<ContactsSettings>;
    /** 仪表盘聚合（近期生日/久未联系/统计） */
    loadDashboard(options?: Partial<DashboardOptions>): Promise<DashboardData>;
    /** 记一笔互动（幂等） */
    recordInteraction(personDocId: string, note?: string): Promise<void>;
    /** 人物洞察：互动时间线 + 共同出席统计 */
    loadPersonInsights(docId: string): Promise<PersonInsights>;
    /** 从笔记捕获：预览出链指向的联系人 */
    previewCapture(docId: string): Promise<CapturePreview>;
    /** 从笔记捕获：确认执行（互动事件 + 参与人区块 + 新人收编） */
    captureDoc(docId: string, options: CaptureOptions): Promise<CaptureResult>;
    /** AI 抽取本页人名/日期/地点（需思源内置 AI；结果须经确认 UI） */
    aiExtractFromDoc(docId: string): Promise<AiExtractOutcome>;
    openHostDoc(): void;
    /** 打开人物文档（联系人详情页 = 人物文档） */
    openPersonDoc(docId: string): void;
    openSettings(): void;
}
