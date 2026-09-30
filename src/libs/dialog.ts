/*
 * Svelte 弹窗工具（模板 siyuan-note/plugin-sample-vite-svelte 移植, MIT, frostime）
 */
import { Dialog } from "siyuan";
import { mount, unmount } from "svelte";
import type { Component } from "svelte";

/**
 * D-40：宿主关闭通道守卫。
 * 宿主 Dialog 的 X / Esc / 遮罩会直接 destroy 弹窗、绕过组件内 close-guard。
 * svelteDialog 向组件注入 `hostCloseChannel`，组件把自己的守卫（通常 guardedClose）
 * 挂到 `channel.request`；本层以 capture 拦截宿主关闭动作并路由到该守卫——
 * 未挂接（request 为空）时保持宿主原行为，组件无需感知。
 * 隔离 mock（siyuan-mock.js）对齐真实宿主 DOM 类名：.b3-dialog__scrim / .b3-dialog__close；
 * 真实宿主三路径核对 Host pending（D-40）。
 */
export interface HostCloseChannel {
    /** 组件挂接宿主关闭的守卫入口；close = 真正关闭弹窗（走 destroy 链） */
    request?: (close: () => void) => void;
}

export const simpleDialog = (args: {
    title: string, ele: HTMLElement | DocumentFragment,
    width?: string, height?: string,
    callback?: () => void;
}) => {
    const dialog = new Dialog({
        title: args.title,
        content: `<div class="dialog-content" style="display: flex; height: 100%;"/>`,
        width: args.width,
        height: args.height,
        destroyCallback: args.callback
    });
    dialog.element.querySelector(".dialog-content")?.appendChild(args.ele);
    return {
        dialog,
        close: dialog.destroy.bind(dialog)
    };
};

export const svelteDialog = (args: {
    title: string,
    component: Component<any>, // Svelte 5 component constructor
    props?: Record<string, any>,
    width?: string,
    height?: string,
    callback?: () => void;
}) => {
    let container = document.createElement("div");
    container.className = "lvct-dialog-root";
    container.style.display = "contents";

    const hostCloseChannel: HostCloseChannel = {};
    let closeDialog: (() => void) | undefined;
    let componentInstance = mount(args.component, {
        target: container,
        props: { ...args.props, onClose: () => closeDialog?.(), hostCloseChannel }
    });

    const { dialog, close } = simpleDialog({
        ...args,
        ele: container,
        callback: () => {
            teardownHostCloseInterception();
            unmount(componentInstance);
            if (args.callback) args.callback();
        }
    });

    closeDialog = close;

    /* D-40：capture 拦截先于宿主关闭处理器（元素级 capture 先于目标冒泡、
       window capture 先于一切文档/元素处理器）。重入门按守卫浮层在场判定
       （无时序敏感的 pending 标志）：三选一打开期间由其自身 Esc/遮罩逻辑接管。 */
    const intercept = (event: Event) => {
        if (typeof hostCloseChannel.request !== "function") return;
        if (document.querySelector(".lvct-closeguard")) return;
        const target = event.target as HTMLElement | null;
        if (event.type === "keydown") {
            if ((event as KeyboardEvent).key !== "Escape") return;
            /* 焦点不在本弹窗内时可能是更上层浮层的 Esc，保持宿主行为 */
            if (!target || !dialog.element.contains(target)) return;
        } else if (event.type === "click") {
            if (!target?.closest?.(".b3-dialog__scrim, .b3-dialog__close")) return;
        } else {
            return;
        }
        event.stopPropagation();
        event.preventDefault();
        void Promise.resolve(hostCloseChannel.request(() => closeDialog?.())).catch(() => {});
    };
    const listeners: Array<[EventTarget, string]> = [
        [dialog.element, "click"],
        [window, "keydown"],
    ];
    for (const [target, type] of listeners) target.addEventListener(type, intercept, true);
    function teardownHostCloseInterception(): void {
        for (const [target, type] of listeners) target.removeEventListener(type, intercept, true);
    }

    return {
        component: componentInstance,
        dialog,
        close
    };
};
