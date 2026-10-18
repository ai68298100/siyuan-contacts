import { getFocusableElements } from "../shared/focusable-elements";

export interface ConfirmDialogOptions {
    title?: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
    danger?: boolean;
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

/**
 * K-10：轻量级无障碍确认对话框。
 * 替代原生 window.confirm，提供 alertdialog 语义、焦点圈定、Esc/遮罩取消、
 * 背景元素 aria-hidden/inert 隔离与深浅色主题适配。
 */
export function confirmDialog(options: ConfirmDialogOptions): Promise<boolean> {
    if (typeof document === "undefined") return Promise.resolve(false);

    return new Promise((resolve) => {
        const previousActive = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        let finished = false;

        const onKeydown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                finish(false);
                return;
            }
            if (event.key !== "Tab") return;
            const focusable = getFocusableElements(overlay);
            if (focusable.length === 0) return;
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (!overlay.contains(document.activeElement)) {
                event.preventDefault();
                first.focus();
            } else if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        };

        interface SiblingState {
            element: HTMLElement;
            hadAriaHidden: boolean;
            oldAriaHidden: string | null;
            hadInert: boolean;
        }
        const isolatedSiblings: SiblingState[] = [];

        const finish = (confirmed: boolean) => {
            if (finished) return;
            finished = true;
            document.removeEventListener("keydown", onKeydown, true);
            for (const item of isolatedSiblings) {
                if (!item.element.isConnected) continue;
                if (item.hadAriaHidden && item.oldAriaHidden !== null) {
                    item.element.setAttribute("aria-hidden", item.oldAriaHidden);
                } else {
                    item.element.removeAttribute("aria-hidden");
                }
                if (!item.hadInert) {
                    item.element.removeAttribute("inert");
                }
            }
            overlay.remove();
            if (previousActive?.isConnected) queueMicrotask(() => previousActive.focus());
            resolve(confirmed);
        };

        const overlay = document.createElement("div");
        overlay.className = "lvct-dialog-root lvct-confirm-dialog-root";

        const titleText = options.title || "确认操作";
        const confirmBtnClass = options.danger
            ? "b3-button b3-button--cancel lvct-button--danger"
            : "b3-button b3-button--text";

        overlay.innerHTML = `
            <div class="lvct-confirm-dialog__mask"></div>
            <div class="lvct-confirm-dialog__panel" role="alertdialog" aria-modal="true"
                aria-label="${escapeHtml(titleText)}">
                <h3 class="lvct-confirm-dialog__title">${escapeHtml(titleText)}</h3>
                <p class="lvct-confirm-dialog__message">${escapeHtml(options.message)}</p>
                <div class="lvct-confirm-dialog__actions">
                    <button type="button" class="b3-button b3-button--cancel" data-action="cancel">
                        ${escapeHtml(options.cancelLabel || "取消")}
                    </button>
                    <button type="button" class="${confirmBtnClass}" data-action="confirm">
                        ${escapeHtml(options.confirmLabel || "确认")}
                    </button>
                </div>
            </div>`;

        document.body.appendChild(overlay);

        /* 背景元素隔离：防止屏幕阅读器读取背景控件 */
        for (const child of document.body.children) {
            if (child !== overlay && child instanceof HTMLElement) {
                isolatedSiblings.push({
                    element: child,
                    hadAriaHidden: child.hasAttribute("aria-hidden"),
                    oldAriaHidden: child.getAttribute("aria-hidden"),
                    hadInert: child.hasAttribute("inert"),
                });
                child.setAttribute("aria-hidden", "true");
                child.setAttribute("inert", "");
            }
        }

        const cancelBtn = overlay.querySelector<HTMLButtonElement>("button[data-action='cancel']");
        const confirmBtn = overlay.querySelector<HTMLButtonElement>("button[data-action='confirm']");

        cancelBtn?.addEventListener("click", () => finish(false));
        confirmBtn?.addEventListener("click", () => finish(true));
        overlay.querySelector(".lvct-confirm-dialog__mask")?.addEventListener("click", () => finish(false));

        document.addEventListener("keydown", onKeydown, true);

        // 默认将焦点停留在取消按钮上，避免误触回车误确认危险操作
        (cancelBtn ?? confirmBtn)?.focus();
    });
}
