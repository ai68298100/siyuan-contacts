export interface ConfirmDialogOptions {
    title?: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
    danger?: boolean;
}

/**
 * K-10：统一确认对话框服务。
 * 封装确认消息与选项；在宿主/测试环境中委托 window.confirm 保持事件与断言兼容，
 * 为后续无障碍 DOM 弹窗迁移提供统一调用接口与参数契约。
 */
export function confirmDialog(options: ConfirmDialogOptions): Promise<boolean> {
    if (typeof window !== "undefined" && typeof window.confirm === "function") {
        try {
            const confirmed = window.confirm(options.message);
            return Promise.resolve(Boolean(confirmed));
        } catch {
            return Promise.resolve(false);
        }
    }
    return Promise.resolve(false);
}
