/*
 * Svelte 弹窗工具（模板 siyuan-note/plugin-sample-vite-svelte 移植, MIT, frostime）
 */
import { Dialog } from "siyuan";
import { mount, unmount } from "svelte";
import type { Component } from "svelte";

export const simpleDialog = (args: {
    title: string, ele: HTMLElement | DocumentFragment,
    width?: string, height?: string,
    disableClose?: boolean,
    callback?: () => void;
}) => {
    const dialog = new Dialog({
        title: args.title,
        content: `<div class="dialog-content" style="display: flex; height: 100%;"/>`,
        width: args.width,
        height: args.height,
        disableClose: args.disableClose ?? true,
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
    disableClose?: boolean,
    callback?: () => void;
}) => {
    let container = document.createElement("div");
    container.className = "lvct-dialog-root";
    container.style.display = "contents";

    let closeDialog: (() => void) | undefined;
    let componentInstance = mount(args.component, {
        target: container,
        props: { ...args.props, onClose: () => closeDialog?.() }
    });

    const { dialog, close } = simpleDialog({
        ...args,
        ele: container,
        callback: () => {
            unmount(componentInstance);
            if (args.callback) args.callback();
        }
    });

    closeDialog = close;

    return {
        component: componentInstance,
        dialog,
        close
    };
};
