import type { ContactsSettings } from "./domain/model";

/**
 * 插件实例暴露给组件层的结构化视图（避免组件 import 插件入口造成循环依赖）。
 */
export interface ContactsPluginFacade {
    readonly settings: ContactsSettings | null;
    readonly isMobile: boolean;
    /** 执行工作空间初始化并向导日志回调进度；失败抛错 */
    initialize(notebookName: string, onProgress: (message: string) => void): Promise<ContactsSettings>;
    openHostDoc(): void;
    /** 打开人物文档（联系人详情页 = 人物文档） */
    openPersonDoc(docId: string): void;
    openSettings(): void;
}
