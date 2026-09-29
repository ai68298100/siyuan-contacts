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
import OrgManagerDialog from "./components/org/OrgManagerDialog.svelte";
import QuickFillDialog from "./components/people/QuickFillDialog.svelte";
import AddPersonDialog from "./components/people/AddPersonDialog.svelte";
import PersonEditDialog from "./components/people/PersonEditDialog.svelte";
import { parseContactText } from "./domain/quick-fill";
import { invalidateRoster } from "./services/roster";
import { bindSelfIdentityStorage } from "./data/self-identity";
import { initializeWorkspace, inspectWorkspace, loadSettings, scanAnchorCandidates } from "./services/init";
import { configureCloseGuardI18n } from "./components/close-guard";
import type { InitProgressStep, WorkspaceSnapshot } from "./services/init";
import { loadDashboard, DEFAULT_DASHBOARD_OPTIONS } from "./services/dashboard";
import { deleteInteraction, recordInteraction, loadInteractionStore } from "./data/interactions";
import { captureFromDoc, previewCapture, resolveRecognizeTarget } from "./services/capture";
import { extractFromDoc } from "./services/ai-extract";
import { loadPersonInsights } from "./services/insights";
import { checkSettingsHealth, rebuildMissingFields, rebindSettings, repairFieldMap } from "./services/settings-health";
import { auditWorkspaceData } from "./services/health-audit";
import { reconcileFollowUpTasksFromDoc } from "./services/followup-sync";
import { updateContactFields, applyContactCandidateFields, listContacts as listContactsService } from "./services/contacts";
import { ensureSelfIdentity, designateSelfIdentity } from "./services/self-identity";
import { loadSelfIdentity } from "./data/self-identity";
import {
    listOrganizationsWithMembers,
    createOrganization,
    listOrganizationMembers,
    addOrganizationMember,
    removeOrganizationMember,
} from "./services/org";
import { exportMigrationBundle, importMigrationBundle, previewMigrationImport } from "./services/migration-bundle";
import { loadViewPreferences, saveViewPreferences } from "./services/preferences";
import { exportInteractionJson } from "./services/interaction-export";
import { loadExportSummary } from "./services/export-center";
import { exportVcfText } from "./services/vcard";
import {
    createFollowUp,
    exportFollowUpsJson,
    importFollowUpsJson,
    listPersonFollowUps,
    previewFollowUpsImport,
    setFollowUpStatus,
    snoozeFollowUp,
} from "./services/followups";
import type { SnoozeOption } from "./domain/followups";
import { loadPersonCadence, savePersonCadence } from "./data/cadences";
import { dismissReminder, resumeReminder, loadReminderDismissals } from "./data/reminder-dismissals";
import type { ReminderKind } from "./data/reminder-dismissals";
import type { PersonCadence } from "./domain/cadence";
import { listTemplates, saveTemplates } from "./services/templates";
import type { NoteTemplate } from "./domain/interaction-templates";
import { buildReview } from "./services/review-report";
import { importInteractionJson, previewInteractionImport } from "./services/interaction-import";
import { previewInteractionImportDiff } from "./services/interaction-import";
import { initExternalBridge, disposeExternalBridge } from "./bridge/external-bridge";
import { handleProtyleEvent, type PanelContext } from "./panels/person-panel";
import { svelteDialog } from "./libs/dialog";
import { emitDataChanged } from "./libs/data-events";
import type { ContactsSettings } from "./domain/model";
import type { ContactSummary } from "./domain/person";
import { emptyDraft } from "./domain/person";
import { DEFAULT_VIEW_PREFERENCES, type ViewPreferences } from "./domain/preferences";
import type { ContactsPluginFacade, WorkbenchView } from "./types";

const TAB_TYPE = "workbench";

/** QuickFillDialog 回填补丁（与组件 props 结构一致） */
interface QuickFillPatch {
    name?: string;
    phone?: string;
    email?: string;
    wechat?: string;
    website?: string;
    birthday?: string;
    isLunar?: boolean;
    group?: string;
    tagsAppend: string[];
}

/** FAST-01.3：读限定在指定编辑器内的选区；没有选区或选区在别的窗口时返回空串 */
function readSelectionWithin(scope: HTMLElement): string {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) return "";
    const anchor = selection.anchorNode;
    if (!anchor || !scope.contains(anchor)) return "";
    return selection.toString();
}

export default class LvContactsPlugin extends Plugin implements ContactsPluginFacade {
    isMobile = false;
    settings: ContactsSettings | null = null;
    viewPreferences: ViewPreferences = DEFAULT_VIEW_PREFERENCES;

    private workbenchDialog: Dialog | null = null;
    private dialogInstance: ReturnType<typeof mount> | null = null;
    private requestedWorkbenchView: WorkbenchView | undefined;
    private dataChangeTimer = 0;

    async onload() {
        const frontend = getFrontend();
        this.isMobile = frontend === "mobile" || frontend === "browser-mobile";
        bindSelfIdentityStorage(this); /* B11：roster 投影的 isSelf 标记依赖身份存储 */

        this.addIcons(`<symbol id="iconLvContacts" viewBox="0 0 32 32">
<path d="M12 4c3.314 0 6 2.686 6 6s-2.686 6-6 6-6-2.686-6-6 2.686-6 6-6zM12 6.4A3.6 3.6 0 1 0 12 13.6 3.6 3.6 0 0 0 12 6.4z"/>
<path d="M22.4 8.8c2.651 0 4.8 2.149 4.8 4.8s-2.149 4.8-4.8 4.8-4.8-2.149-4.8-4.8 2.149-4.8 4.8-4.8zM22.4 11.2a2.4 2.4 0 1 0 0 4.8 2.4 2.4 0 0 0 0-4.8z"/>
<path d="M12 18c4.26 0 8.4 1.772 8.4 4.8V26H3.6v-3.2C3.6 19.772 7.74 18 12 18zm0 2.4c-3.42 0-6 1.276-6 2.4V23.6h12v-0.8c0-1.124-2.58-2.4-6-2.4z"/>
<path d="M23.2 20.4c2.94 0 6 1.176 6 3.2V26h-6.133v-2.4h3.733v-0.16c-.46-.44-1.76-.8-3.4-.86a9.79 9.79 0 0 0-1.6-2.18h1.4z"/>
</symbol>`);

        configureCloseGuardI18n(this.i18n);

        // 自管设置只在此处加载一次；tab / dialog 都读这个缓存
        this.settings = await loadSettings(this);
        this.viewPreferences = await loadViewPreferences(this);

        const plugin = this;
        this.addTab({
            type: TAB_TYPE,
            init() {
                const container = document.createElement("div");
                container.className = "lvct-tab-root fn__flex-1";
                this.element.appendChild(container);
                const initialView = plugin.requestedWorkbenchView;
                plugin.requestedWorkbenchView = undefined;
                const instance = mount(WorkbenchRoot, { target: container, props: { facade: plugin, initialView } });
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

        // 对外人员服务桥（任务管理等插件经 window.LvContacts 查人/建人/记交集）
        initExternalBridge(this, () => this.settings);
    }

    onLayoutReady() {
        this.addTopBar({
            icon: "iconLvContacts",
            title: this.i18n.openWorkbench ?? "小驴人脉",
            position: "right",
            callback: () => this.openWorkbench(),
        });
        if (this.viewPreferences.openOnStartup) {
            window.setTimeout(() => this.openWorkbench(), 0);
        }
    }

    async onunload() {
        disposeExternalBridge();
        this.eventBus.off("open-menu-content", this.onMenuContent);
        this.eventBus.off("loaded-protyle-static", this.onProtyleEvent);
        this.eventBus.off("loaded-protyle-dynamic", this.onProtyleEvent);
        this.eventBus.off("switch-protyle", this.onProtyleEvent);
        this.workbenchDialog?.destroy();
        this.workbenchDialog = null;
    }

    private readonly onProtyleEvent = (event: { detail?: { protyle?: { element: HTMLElement; block?: { rootID?: string } } } }): void => {
        const context: PanelContext = { plugin: this, settings: this.settings, i18n: this.i18n };
        handleProtyleEvent(context, event);
    };

    private readonly onMenuContent = (event: { detail: { protyle?: { element?: HTMLElement; block?: { rootID?: string } }; menu: { addItem: (item: unknown) => void } } }): void => {
        const rootId = event.detail.protyle?.block?.rootID;
        if (!rootId) return;
        event.detail.menu.addItem({
            id: "lvct-capture",
            iconHTML: "",
            label: this.i18n.captureFromNote ?? "人脉：捕获本文人员",
            click: () => this.openCaptureDialog(rootId),
        });
        /* FAST-01.3：识别资料——选中文本（有选区才显示）与整篇文档；选区只读当前编辑器，不误读其他窗口 */
        const protyleElement = event.detail.protyle?.element;
        const selectionText = protyleElement ? readSelectionWithin(protyleElement) : "";
        if (selectionText.trim()) {
            event.detail.menu.addItem({
                id: "lvct-recognize-selection",
                iconHTML: "",
                label: `人脉：识别资料（选中文本，${[...selectionText.trim()].length} 字）`,
                click: () => void this.openRecognizeDialog(selectionText, rootId),
            });
        }
        event.detail.menu.addItem({
            id: "lvct-recognize-doc",
            iconHTML: "",
            label: "人脉：识别资料（整篇文档）",
            click: () => void this.openRecognizeDialog(protyleElement?.innerText ?? "", rootId),
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
            props: { facade: this, i18n: this.i18n, docId },
        });
    }

    /** FAST-01.3：识别资料 → 预览确认 → 目标落点（人物文档=补充此联系人；普通笔记=新建） */
    private async openRecognizeDialog(rawText: string, rootDocId: string): Promise<void> {
        if (!this.settings) {
            showMessage("请先完成人脉工作空间初始化", 3000);
            return;
        }
        const text = rawText.trim();
        if (!text) {
            showMessage("没有可识别的内容", 3000);
            return;
        }
        const result = parseContactText(text);
        if (result.items.length === 0) {
            showMessage("未识别到可填充的资料字段（原文已保留，未做任何写入）", 3000);
            return;
        }
        /* FAST-01.3a：识别目标裁决——名册读取失败（自动重试一次仍失败）时整单取消：零写入、
           零弹窗，不按「普通笔记新建」处理（会把已绑定人物的笔记建成重复联系人） */
        const resolution = await resolveRecognizeTarget(this.settings, rootDocId);
        if (resolution.status === "failed") {
            showMessage("人脉名册读取失败，本次识别已取消（未做任何写入）；请稍后重新触发「识别资料」", 6000);
            return;
        }
        const person = resolution.status === "bound" ? resolution.person : null;
        const existing = person
            ? { name: person.name, phone: person.phone, email: person.email, wechat: person.wechat, website: person.website, birthday: person.birthday, group: person.group, tags: person.tags }
            : { name: "", phone: "", email: "", wechat: "", website: "", birthday: "", group: "", tags: [] as string[] };
        const container = document.createElement("div");
        container.className = "lvct-dialog-root";
        document.body.appendChild(container);
        const close = () => {
            unmount(component);
            container.remove();
        };
        const component = mount(QuickFillDialog, {
            target: container,
            props: {
                i18n: this.i18n,
                existing,
                initialResult: result,
                onApply: (patch: QuickFillPatch) => {
                    close();
                    if (person) this.openPersonEditPrefilled(person, patch);
                    else this.openPersonCreatePrefilled(patch);
                },
                onClose: close,
            },
        });
    }

    /** 识别结果落到既有联系人：编辑弹窗预填勾选值，保存仍走既有 updateContactFields 与 B06 守卫 */
    private openPersonEditPrefilled(person: ContactSummary, patch: QuickFillPatch): void {
        if (!this.settings) return;
        const merged: ContactSummary = {
            ...person,
            name: patch.name ?? person.name,
            phone: patch.phone ?? person.phone,
            email: patch.email ?? person.email,
            wechat: patch.wechat ?? person.wechat,
            website: patch.website ?? person.website,
            birthday: patch.birthday ?? person.birthday,
            isLunar: person.isLunar || Boolean(patch.isLunar),
            group: patch.group ?? person.group,
            tags: [...new Set([...person.tags, ...patch.tagsAppend])],
        };
        svelteDialog({
            title: `识别资料 · 补充「${person.name}」`,
            width: "560px",
            component: PersonEditDialog,
            props: { settings: this.settings, i18n: this.i18n, person: merged, onSaved: () => emitDataChanged() },
        });
    }

    /** 识别结果落到新建：预填草稿（识别后继续编辑），创建仍走既有 createContact 查重路径 */
    private openPersonCreatePrefilled(patch: QuickFillPatch): void {
        if (!this.settings) return;
        const draft = emptyDraft();
        if (patch.name !== undefined) draft.name = patch.name;
        if (patch.phone !== undefined) draft.phone = patch.phone;
        if (patch.email !== undefined) draft.email = patch.email;
        if (patch.wechat !== undefined) draft.wechat = patch.wechat;
        if (patch.website !== undefined) draft.website = patch.website;
        if (patch.birthday !== undefined) draft.birthday = patch.birthday;
        draft.isLunar = Boolean(patch.isLunar);
        if (patch.group !== undefined) draft.group = patch.group;
        draft.tags = [...patch.tagsAppend];
        svelteDialog({
            title: "识别资料 · 新建联系人",
            width: "560px",
            component: AddPersonDialog,
            props: { settings: this.settings, i18n: this.i18n, initial: draft, onCreated: () => emitDataChanged() },
        });
    }

    /**
     * 覆写 onDataChanged：不覆写时宿主在同步 dataChange 后会整插件重载（打卡库 D-222）。
     * FUNC-01.7-a：先失效名册缓存（缓存可随时重建，不等 30s TTL），再防抖合并广播给
     * 本窗口工作台/档案条原地刷新（libs/data-events）；跨窗口投递依赖宿主对每个窗口
     * 实例的推送（Host pending）。
     */
    onDataChanged() {
        console.debug("[lvct] storage data changed");
        invalidateRoster();
        if (this.dataChangeTimer) window.clearTimeout(this.dataChangeTimer);
        this.dataChangeTimer = window.setTimeout(() => {
            this.dataChangeTimer = 0;
            emitDataChanged();
        }, 600);
    }

    openWorkbench(view?: WorkbenchView) {
        if (this.isMobile) {
            this.openWorkbenchDialog(view);
        } else {
            this.requestedWorkbenchView = view;
            openTab({
                app: this.app,
                custom: {
                    icon: "iconLvContacts",
                    title: this.i18n.tabTitle ?? "小驴人脉",
                    id: `${this.name}${TAB_TYPE}`,
                },
            });
            if (view) {
                window.setTimeout(() => {
                    window.dispatchEvent(new CustomEvent("lvct-workbench-view", { detail: { view } }));
                    if (this.requestedWorkbenchView === view) this.requestedWorkbenchView = undefined;
                }, 0);
            }
        }
    }

    async initialize(
        notebookName: string,
        onProgress: (step: InitProgressStep) => void,
    ): Promise<ContactsSettings> {
        const settings = await initializeWorkspace(this, { notebookName }, onProgress);
        this.settings = settings;
        return settings;
    }

    async previewInitialize(notebookName: string): Promise<WorkspaceSnapshot> {
        return inspectWorkspace(notebookName);
    }

    async scanAnchorCandidates() {
        return scanAnchorCandidates();
    }

    async loadDashboard(options?: Partial<typeof DEFAULT_DASHBOARD_OPTIONS>) {
        if (!this.settings) throw new Error("人脉工作空间尚未初始化");
        return loadDashboard(this, this.settings, { ...DEFAULT_DASHBOARD_OPTIONS, ...options });
    }

    async recordInteraction(personDocId: string, note?: string): Promise<void> {
        await recordInteraction(this, { personDocId, note });
    }

    async deleteInteraction(personDocId: string, eventId: string): Promise<void> {
        await deleteInteraction(this, eventId, personDocId);
    }

    async previewCapture(docId: string) {
        if (!this.settings) throw new Error("人脉工作空间尚未初始化");
        return previewCapture(this.settings, docId);
    }

    async updatePersonFields(personItemId: string, draft: import("./domain/person").ContactDraft) {
        if (!this.settings) throw new Error("人脉工作空间尚未初始化");
        await updateContactFields(this.settings, personItemId, draft);
    }

    /** B11：本人身份读取（null = 未建立） */
    async loadSelfIdentity() {
        return loadSelfIdentity(this);
    }

    /** B11.3：确保本人档案「我自己」存在（幂等；失败返回 null 不抛） */
    async createSelfProfile() {
        if (!this.settings) throw new Error("人脉工作空间尚未初始化");
        return ensureSelfIdentity(this, this.settings);
    }

    /** B11.3/B11.5：把本人身份显式指定到一名已有联系人（显式改绑） */
    async designateSelfIdentity(personItemId: string) {
        if (!this.settings) throw new Error("人脉工作空间尚未初始化");
        return designateSelfIdentity(this, this.settings, personItemId);
    }

    /** B11.3：全量名册（设置页本人档案指定用；未初始化返回空） */
    async listContacts() {
        if (!this.settings) return [];
        return listContactsService(this.settings);
    }

    /** B13.3：组织列举（含成员记录） */
    async listOrganizations() {
        return listOrganizationsWithMembers(this);
    }

    /** B13.3：新建组织（文档 + custom-lvct-org 标记区块；同名拒绝） */
    async createOrganization(name: string) {
        if (!this.settings) throw new Error("人脉工作空间尚未初始化");
        return createOrganization(this.settings, name);
    }

    /** B13.3：组织成员列举（join 名册姓名） */
    async listOrganizationMembers(orgDocId: string) {
        if (!this.settings) throw new Error("人脉工作空间尚未初始化");
        return listOrganizationMembers(this, this.settings, orgDocId);
    }

    /** B13.3：添加组织成员（active） */
    async addOrganizationMember(orgDocId: string, personDocId: string, extra?: { department?: string; title?: string; joinedOn?: string }) {
        if (!this.settings) throw new Error("人脉工作空间尚未初始化");
        await addOrganizationMember(this, orgDocId, personDocId, extra);
    }

    /** B13.3：移除组织成员记录 */
    async removeOrganizationMember(id: string) {
        await removeOrganizationMember(this, id);
    }

    /** B13.3：打开组织管理弹窗 */
    openOrgManagerDialog(): void {
        if (!this.settings) {
            showMessage("请先完成人脉工作空间初始化", 3000);
            return;
        }
        svelteDialog({
            title: this.i18n.orgManagerTitle ?? "组织管理",
            width: "620px",
            component: OrgManagerDialog,
            props: { facade: this, i18n: this.i18n },
        });
    }

    /** FUNC-01.14：AI 资料候选受限补丁写（只写补丁字段，最新名册回读逐字段冲突核对） */
    async updatePersonCandidateFields(personItemId: string, patches: readonly import("./domain/contact-patch").CandidateFieldPatch[]) {
        if (!this.settings) throw new Error("人脉工作空间尚未初始化");
        return applyContactCandidateFields(this.settings, personItemId, patches);
    }

    async captureDoc(docId: string, options: Parameters<typeof captureFromDoc>[3]) {
        if (!this.settings) throw new Error("人脉工作空间尚未初始化");
        return captureFromDoc(this, this.settings, docId, options);
    }

    async aiExtractFromDoc(docId: string) {
        if (!this.settings) throw new Error("人脉工作空间尚未初始化");
        return extractFromDoc(this.settings, docId);
    }

    async loadPersonInsights(docId: string) {
        if (!this.settings) throw new Error("人脉工作空间尚未初始化");
        return loadPersonInsights(this, this.settings, docId);
    }

    async loadRecentInteractions() {
        const store = await loadInteractionStore(this);
        const latest: Record<string, { occurredAt: number; localDate: string }> = {};
        for (const event of store.events) {
            const current = latest[event.personDocId];
            if (!current || event.occurredAt > current.occurredAt) latest[event.personDocId] = { occurredAt: event.occurredAt, localDate: event.localDate };
        }
        return latest;
    }

    async checkSettingsHealth() {
        if (!this.settings) throw new Error("人脉工作空间尚未初始化");
        return checkSettingsHealth(this.settings);
    }

    async runHealthAudit() {
        if (!this.settings) throw new Error("人脉工作空间尚未初始化");
        return auditWorkspaceData(this, this.settings);
    }

    async rebuildMissingFields() {
        if (!this.settings) throw new Error("人脉工作空间尚未初始化");
        this.settings = await rebuildMissingFields(this, this.settings);
        return this.settings;
    }

    async rebindSettings(patch: Parameters<typeof rebindSettings>[2]) {
        if (!this.settings) throw new Error("人脉工作空间尚未初始化");
        this.settings = await rebindSettings(this, this.settings, patch);
        return this.settings;
    }

    async exportInteractionJson() {
        return exportInteractionJson(this);
    }

    async exportMigrationBundle() {
        return exportMigrationBundle(this);
    }

    async previewMigrationImport(text: string) {
        return previewMigrationImport(text);
    }

    async importMigrationBundle(text: string) {
        return importMigrationBundle(this, text);
    }

    async listPersonFollowUps(personDocId: string) {
        /* B07：人物详情打开时读侧对账（文档为准收敛插件库；失败静默按未对账返回） */
        try {
            await reconcileFollowUpTasksFromDoc(this, personDocId);
        } catch (error) {
            console.warn("[lvct] 跟进任务块对账失败（按未对账返回）:", error);
        }
        return listPersonFollowUps(this, personDocId);
    }

    async createFollowUp(personDocId: string, title: string, dueDate: string) {
        return createFollowUp(this, { personDocId, title, dueDate });
    }

    async setFollowUpStatus(id: string, status: "open" | "done" | "cancelled") {
        await setFollowUpStatus(this, id, status);
    }

    async snoozeFollowUp(id: string, option: SnoozeOption, customDate?: string) {
        await snoozeFollowUp(this, id, option, customDate);
    }

    async exportFollowUpsJson() {
        return exportFollowUpsJson(this);
    }

    async previewFollowUpsImport(text: string) {
        return previewFollowUpsImport(this, text);
    }

    async importFollowUpsJson(text: string) {
        return importFollowUpsJson(this, text);
    }

    async getPersonCadence(personDocId: string) {
        return loadPersonCadence(this, personDocId);
    }

    async savePersonCadence(personDocId: string, cadence: PersonCadence | null) {
        await savePersonCadence(this, personDocId, cadence);
    }

    async dismissReminder(personDocId: string, kind: ReminderKind, until: string) {
        await dismissReminder(this, personDocId, kind, until);
    }

    async resumeReminder(personDocId: string, kind: ReminderKind) {
        await resumeReminder(this, personDocId, kind);
    }

    async loadReminderDismissals() {
        return loadReminderDismissals(this);
    }

    async listTemplates() {
        return listTemplates(this);
    }

    async saveTemplates(templates: readonly NoteTemplate[]) {
        return saveTemplates(this, templates);
    }

    async buildReviewReport(from: string, to: string) {
        if (!this.settings) throw new Error("人脉工作空间尚未初始化");
        return buildReview(this, this.settings, { from, to });
    }

    async loadExportSummary() {
        if (!this.settings) throw new Error("人脉工作空间尚未初始化");
        return loadExportSummary(this, this.settings);
    }

    async exportRosterVcf() {
        if (!this.settings) throw new Error("人脉工作空间尚未初始化");
        return exportVcfText(this.settings);
    }

    async previewInteractionImport(text: string) {
        return previewInteractionImport(this, text);
    }

    async previewInteractionImportDiff(text: string) {
        if (!this.settings) throw new Error("人脉工作空间尚未初始化");
        return previewInteractionImportDiff(this, this.settings, text);
    }

    async importInteractionJson(text: string) {
        return importInteractionJson(this, text);
    }

    async repairFieldMap(patch: Parameters<typeof repairFieldMap>[2]) {
        if (!this.settings) throw new Error("人脉工作空间尚未初始化");
        this.settings = await repairFieldMap(this, this.settings, patch);
        return this.settings;
    }

    async loadViewPreferences() {
        this.viewPreferences = await loadViewPreferences(this);
        return this.viewPreferences;
    }

    async saveViewPreferences(preferences: ViewPreferences) {
        this.viewPreferences = await saveViewPreferences(this, preferences);
        return this.viewPreferences;
    }

    openHostDoc() {
        if (!this.settings) return;
        openTab({ app: this.app, doc: { id: this.settings.hostDocId } });
    }

    openDoc(docId: string) {
        if (!docId) return;
        openTab({ app: this.app, doc: { id: docId } });
    }

    openPersonDoc(docId: string) {
        this.openDoc(docId);
    }

    openSettings() {
        if (!this.settings) {
            showMessage("请先完成人脉工作空间初始化", 3000);
            return;
        }
        this.openWorkbench("settings");
    }

    private openWorkbenchDialog(initialView?: WorkbenchView) {
        if (this.workbenchDialog) {
            if (initialView) {
                window.setTimeout(() => {
                    window.dispatchEvent(new CustomEvent("lvct-workbench-view", { detail: { view: initialView } }));
                }, 0);
            }
            return;
        }
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
        this.dialogInstance = mount(WorkbenchRoot, { target, props: { facade: this, initialView } });
    }
}
