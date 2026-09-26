/**
 * 小驴人脉插件入口（薄壳）：生命周期、UI 挂载。
 * 业务编排在 services/，内核交互在 api/，自管数据在 data/，纯函数在 domain/，
 * 组件只依赖 types.ts 的 facade 接口，不反向 import 本文件（避免循环）。
 */
import { Plugin, getFrontend, openTab, showMessage, Dialog, getAllEditor } from "siyuan";
import { mount, unmount } from "svelte";
import "./index.scss";

import WorkbenchRoot from "./components/WorkbenchRoot.svelte";
import CaptureDialog from "./components/capture/CaptureDialog.svelte";
import { initializeWorkspace, loadSettings } from "./services/init";
import { loadDashboard, DEFAULT_DASHBOARD_OPTIONS } from "./services/dashboard";
import { recordInteraction } from "./data/interactions";
import { captureFromDoc, previewCapture } from "./services/capture";
import { handleProtyleEvent, type PanelContext } from "./panels/person-panel";
import { svelteDialog } from "./libs/dialog";
import type { ContactsSettings } from "./domain/model";
import type { ContactsPluginFacade } from "./types";

const TAB_TYPE = "workbench";

export default class LvContactsPlugin extends Plugin implements ContactsPluginFacade {
    isMobile = false;
    settings: ContactsSettings | null = null;

    private workbenchDialog: Dialog | null = null;
    private dialogInstance: ReturnType<typeof mount> | null = null;

    async onload() {
        const frontend = getFrontend();
        this.isMobile = frontend === "mobile" || frontend === "browser-mobile";

        this.addIcons(`<symbol id="iconLvContacts" viewBox="0 0 32 32">
<path d="M12 4c3.314 0 6 2.686 6 6s-2.686 6-6 6-6-2.686-6-6 2.686-6 6-6zM12 6.4A3.6 3.6 0 1 0 12 13.6 3.6 3.6 0 0 0 12 6.4z"/>
<path d="M22.4 8.8c2.651 0 4.8 2.149 4.8 4.8s-2.149 4.8-4.8 4.8-4.8-2.149-4.8-4.8 2.149-4.8 4.8-4.8zM22.4 11.2a2.4 2.4 0 1 0 0 4.8 2.4 2.4 0 0 0 0-4.8z"/>
<path d="M12 18c4.26 0 8.4 1.772 8.4 4.8V26H3.6v-3.2C3.6 19.772 7.74 18 12 18zm0 2.4c-3.42 0-6 1.276-6 2.4V23.6h12v-0.8c0-1.124-2.58-2.4-6-2.4z"/>
<path d="M23.2 20.4c2.94 0 6 1.176 6 3.2V26h-6.133v-2.4h3.733v-0.16c-.46-.44-1.76-.8-3.4-.86a9.79 9.79 0 0 0-1.6-2.18h1.4z"/>
</symbol>`);

        // 自管设置只在此处加载一次；tab / dialog 都读这个缓存
        this.settings = await loadSettings(this);

        const plugin = this;
        this.addTab({
            type: TAB_TYPE,
            init() {
                const container = document.createElement("div");
                container.className = "lvct-tab-root fn__flex-1";
                this.element.appendChild(container);
                const instance = mount(WorkbenchRoot, { target: container, props: { facade: plugin } });
                (this as { __lvctInstance?: ReturnType<typeof mount> }).__lvctInstance = instance;
            },
            destroy() {
                const state = this as { __lvctInstance?: ReturnType<typeof mount> | null };
                if (state.__lvctInstance) {
                    unmount(state.__lvctInstance);
                    state.__lvctInstance = null;
                }
            },
        });

        this.addCommand({
            langKey: "openWorkbench",
            callback: () => this.openWorkbench(),
        });

        this.addCommand({
            langKey: "captureFromNote",
            callback: () => this.captureFromCurrentNote(),
        });

        // 编辑器右键菜单：捕获本文人员
        this.eventBus.on("open-menu-content", this.onMenuContent);

        // 人物文档档案条：文档加载/切换时按 rootID 判定是否注入
        this.eventBus.on("loaded-protyle-static", this.onProtyleEvent);
        this.eventBus.on("loaded-protyle-dynamic", this.onProtyleEvent);
        this.eventBus.on("switch-protyle", this.onProtyleEvent);
    }

    onLayoutReady() {
        this.addTopBar({
            icon: "iconLvContacts",
            title: this.i18n.openWorkbench ?? "小驴人脉",
            position: "right",
            callback: () => this.openWorkbench(),
        });
    }

    async onunload() {
        this.eventBus.off("open-menu-content", this.onMenuContent);
        this.eventBus.off("loaded-protyle-static", this.onProtyleEvent);
        this.eventBus.off("loaded-protyle-dynamic", this.onProtyleEvent);
        this.eventBus.off("switch-protyle", this.onProtyleEvent);
        this.workbenchDialog?.destroy();
        this.workbenchDialog = null;
    }

    private readonly onProtyleEvent = (event: { detail?: { protyle?: { element: HTMLElement; block?: { rootID?: string } } } }): void => {
        const context: PanelContext = { plugin: this, settings: this.settings };
        handleProtyleEvent(context, event);
    };

    private readonly onMenuContent = (event: { detail: { protyle?: { block?: { rootID?: string } }; menu: { addItem: (item: unknown) => void } } }): void => {
        const rootId = event.detail.protyle?.block?.rootID;
        if (!rootId) return;
        event.detail.menu.addItem({
            id: "lvct-capture",
            iconHTML: "",
            label: this.i18n.captureFromNote ?? "人脉：捕获本文人员",
            click: () => this.openCaptureDialog(rootId),
        });
    };

    /** 打开"从笔记捕获"：需当前有一篇打开的笔记 */
    captureFromCurrentNote(): void {
        const editor = getAllEditor().find((item) => item?.protyle?.block?.rootID);
        const rootId = editor?.protyle?.block?.rootID;
        if (!rootId) {
            showMessage("请先打开一篇笔记再捕获人员", 3000);
            return;
        }
        this.openCaptureDialog(rootId);
    }

    private openCaptureDialog(docId: string): void {
        if (!this.settings) {
            showMessage("请先完成人脉工作空间初始化", 3000);
            return;
        }
        svelteDialog({
            title: "从笔记捕获人脉",
            width: "560px",
            component: CaptureDialog,
            props: { facade: this, docId },
        });
    }

    /**
     * 覆写 onDataChanged：不覆写时宿主在同步 dataChange 后会整插件重载（打卡库 D-222）。
     * M1 只记录事件；M4 互动事件同步在此接线。
     */
    onDataChanged() {
        console.debug("[lvct] storage data changed");
    }

    openWorkbench() {
        if (this.isMobile) {
            this.openWorkbenchDialog();
        } else {
            openTab({
                app: this.app,
                custom: {
                    icon: "iconLvContacts",
                    title: this.i18n.tabTitle ?? "小驴人脉",
                    id: `${this.name}${TAB_TYPE}`,
                },
            });
        }
    }

    async initialize(
        notebookName: string,
        onProgress: (message: string) => void,
    ): Promise<ContactsSettings> {
        const settings = await initializeWorkspace(this, { notebookName }, onProgress);
        this.settings = settings;
        return settings;
    }

    async loadDashboard(options?: Partial<typeof DEFAULT_DASHBOARD_OPTIONS>) {
        if (!this.settings) throw new Error("人脉工作空间尚未初始化");
        return loadDashboard(this, this.settings, { ...DEFAULT_DASHBOARD_OPTIONS, ...options });
    }

    async recordInteraction(personDocId: string, note?: string): Promise<void> {
        await recordInteraction(this, { personDocId, note });
    }

    async previewCapture(docId: string) {
        if (!this.settings) throw new Error("人脉工作空间尚未初始化");
        return previewCapture(this.settings, docId);
    }

    async captureDoc(docId: string, options: Parameters<typeof captureFromDoc>[3]) {
        if (!this.settings) throw new Error("人脉工作空间尚未初始化");
        return captureFromDoc(this, this.settings, docId, options);
    }

    openHostDoc() {
        if (!this.settings) return;
        openTab({ app: this.app, doc: { id: this.settings.hostDocId } });
    }

    openPersonDoc(docId: string) {
        if (!docId) return;
        openTab({ app: this.app, doc: { id: docId } });
    }

    openSettings() {
        showMessage("设置面板在后续里程碑开放", 2500);
    }

    private openWorkbenchDialog() {
        if (this.workbenchDialog) return;
        this.workbenchDialog = new Dialog({
            title: this.i18n.tabTitle ?? "小驴人脉",
            content: '<div class="lvct-dialog-root" style="height:100%;"></div>',
            width: "100vw",
            height: "100%",
            destroyCallback: () => {
                if (this.dialogInstance) {
                    unmount(this.dialogInstance);
                    this.dialogInstance = null;
                }
                this.workbenchDialog = null;
            },
        });
        const target = this.workbenchDialog.element.querySelector<HTMLElement>(".lvct-dialog-root");
        if (!target) throw new Error("dialog 容器缺失");
        this.dialogInstance = mount(WorkbenchRoot, { target, props: { facade: this } });
    }
}
