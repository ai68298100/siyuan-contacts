/**
 * 小驴人脉插件入口（薄壳）：生命周期、UI 挂载。
 * 业务编排在 services/，内核交互在 api/，自管数据在 data/，纯函数在 domain/，
 * 组件只依赖 types.ts 的 facade 接口，不反向 import 本文件（避免循环）。
 */
import { Plugin, getFrontend, openTab, showMessage, Dialog, getActiveEditor } from "siyuan";
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
import { bindOrgMembershipStorage } from "./data/org-membership";
import { bindPeopleProfileStorage, loadPersonRelationshipLabels, savePersonRelationshipLabels } from "./services/people-profiles";
import { bindContactAliasStorage } from "./services/contact-aliases";
import { initializeWorkspace, inspectWorkspace, readSettingsState, scanAnchorCandidates } from "./services/init";
import { configureCloseGuardI18n } from "./components/close-guard";
import type { InitProgressStep, WorkspaceSnapshot } from "./services/init";
import { loadDashboard, DEFAULT_DASHBOARD_OPTIONS } from "./services/dashboard";
import { deleteInteraction, recordInteraction, loadInteractionStore } from "./data/interactions";
import { captureFromDoc, previewCapture, resolveRecognizeTarget } from "./services/capture";
import { extractFromDoc, prepareAiExtraction } from "./services/ai-extract";
import type { AiExtractionConfirmation } from "./services/ai-extract";
import { AiExtractionError } from "./domain/ai-preflight";
import type { AiPreflightOptions } from "./domain/ai-preflight";
import { loadPersonInsights } from "./services/insights";
import { loadPersonNote, savePersonNote } from "./services/person-note";
import { checkSettingsHealth, previewMissingFields, previewRebindSettings, probeSettingsAnchor, rebuildMissingFields, rebindSettings, repairFieldMap } from "./services/settings-health";
import type { FieldRebuildPreview, SettingsRebindPreview } from "./services/settings-health";
import { auditWorkspaceData, auditWorkspaceDataReport, retryFailedHealthAuditModules } from "./services/health-audit";
import { reconcileFollowUpTasksFromDoc } from "./services/followup-sync";
import { updateContactFields, applyContactCandidateFields, listContacts as listContactsService } from "./services/contacts";
import { ensureSelfIdentity, designateSelfIdentity, previewSelfIdentityChange, applySelfIdentityChange } from "./services/self-identity";
import { loadSelfIdentity } from "./data/self-identity";
import {
    listOrganizationsWithMembers,
    listOrganizationsPage,
    createOrganization,
    listOrganizationMembers,
    listOrganizationMembersPage,
    archiveOrganization,
    restoreOrganization,
    renameOrganization,
    removeOrgLinkBlocks,
    listPersonOrgMemberships,
    listCommonOrgBackground,
} from "./services/org";
import { exportMigrationBundle, importMigrationBundle, previewMigrationImport } from "./services/migration-bundle";
import { previewOrganizationProjections, repairOrganizationProjection } from "./services/org-projections";
import { listPendingOrganizationOperations, inspectOrganizationOperation, resumeOrganizationOperation } from "./services/organization-writes";
import { saveOrganizationMember, editOrganizationMember, deleteOrganizationMember, replaceOrganizationMemberWithProjection } from "./services/org-member-writes";
import { loadViewPreferences, saveViewPreferences, createPreferenceRequests } from "./services/preferences";
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
import { listPersonExchanges, createPersonExchange, updatePersonExchange, changePersonExchangeStatus } from "./services/exchanges";
import { listPersonAliases, addPersonAlias, removePersonAlias, resolveAlias } from "./services/person-aliases";
import { buildReview } from "./services/review-report";
import { importInteractionJson, previewInteractionImport } from "./services/interaction-import";
import { previewInteractionImportDiff } from "./services/interaction-import";
import { initExternalBridge, disposeExternalBridge } from "./bridge/external-bridge";
import { handleProtyleEvent, type PanelContext } from "./panels/person-panel";
import { svelteDialog } from "./libs/dialog";
import { emitDataChanged, emitWorkspaceState } from "./libs/data-events";
import type { ContactsSettings } from "./domain/model";
import type { ContactSummary } from "./domain/person";
import { emptyDraft } from "./domain/person";
import { DEFAULT_VIEW_PREFERENCES, type ViewPreferences } from "./domain/preferences";
import { createLifecycleToken, LIFECYCLE_CONTEXT, type LifecycleToken } from "./domain/lifecycle";
import type { ContactsPluginFacade, WorkbenchView } from "./types";
import type { WorkspaceState } from "./domain/workspace-state";

const TAB_TYPE = "workbench";

interface WorkbenchTabState {
    element: Element;
    __lvctDispose?: (() => void) | null;
}

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

function visibleEditorRootId(): string | undefined {
    const activeEditor = document.activeElement?.closest<HTMLElement>(".protyle[data-node-id]");
    if (activeEditor && activeEditor.getBoundingClientRect().width > 0 && activeEditor.getBoundingClientRect().height > 0) {
        return activeEditor.dataset.nodeId || undefined;
    }
    const editors = [...document.querySelectorAll<HTMLElement>(".protyle[data-node-id]")]
        .filter((editor) => {
            const rect = editor.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0 && editor.dataset.nodeId;
        });
    return editors.length === 1 ? editors[0].dataset.nodeId : undefined;
}

export default class LvContactsPlugin extends Plugin implements ContactsPluginFacade {
    isMobile = false;
    settings: ContactsSettings | null = null;
    workspaceState: WorkspaceState = { kind: "uninitialized" };
    /** 锚点失效时仅供显式扫描/重绑使用；普通业务门禁通过 settings=null。 */
    private recoverySettings: ContactsSettings | null = null;
    viewPreferences: ViewPreferences = DEFAULT_VIEW_PREFERENCES;

    private workbenchDialog: Dialog | null = null;
    private dialogInstance: ReturnType<typeof mount> | null = null;
    private requestedWorkbenchView: WorkbenchView | undefined;
    private dataChangeTimer = 0;
    private startupTimer = 0;
    private viewRequestTimer = 0;
    private lifecycleToken: LifecycleToken = createLifecycleToken();
    private workbenchDialogToken: LifecycleToken | null = null;
    private readonly tabDisposers = new Set<() => void>();
    private readonly tabMounts = new Map<Element, LifecycleToken>();
    private readonly ownedDialogDisposers = new Set<() => void>();
    private eventCleanup: (() => void) | null = null;
    private layoutReady = false;
    private preferencesActive = true;
    private preferencesEpoch = 0;
    private dataChangeRequest = 0;
    /** 合并同时触发的工作区核验，避免批量 dataChange 造成并行宿主读取。 */
    private workspaceStateReloadPromise: Promise<WorkspaceState> | null = null;
    private workspaceStateReloadVersion = 0;
    private preferencesVerified = false;
    private preferenceRequests = this.createPreferenceRequests(this.lifecycleToken);

    private createPreferenceRequests(token: LifecycleToken) {
        return createPreferenceRequests({
            load: () => loadViewPreferences(this),
            save: (preferences, baseline) => saveViewPreferences(this, preferences, baseline),
            apply: (preferences) => {
                if (!this.isLifecycleActive(token)) return;
                this.viewPreferences = preferences;
                this.preferencesVerified = true;
            },
            saved: (preferences) => emitDataChanged({ preferencesRevision: preferences.revision }, token),
        });
    }

    private isLifecycleActive(token: LifecycleToken = this.lifecycleToken): boolean {
        return this.lifecycleToken === token && token.isAlive();
    }

    async onload() {
        this.disposeLifecycle();
        this.lifecycleToken = createLifecycleToken();
        const lifecycleToken = this.lifecycleToken;
        this.requestedWorkbenchView = undefined;
        this.preferencesActive = true;
        this.preferencesVerified = false;
        const preferencesEpoch = ++this.preferencesEpoch;
        this.preferenceRequests = this.createPreferenceRequests(lifecycleToken);
        const frontend = getFrontend();
        this.isMobile = frontend === "mobile" || frontend === "browser-mobile";
        bindSelfIdentityStorage(this); /* B11：roster 投影的 isSelf 标记依赖身份存储 */
        bindOrgMembershipStorage(this); /* B12：卡片「单位」行依赖成员索引 */
        lifecycleToken.onDispose(bindPeopleProfileStorage(this));
        lifecycleToken.onDispose(bindContactAliasStorage(this));

        this.addIcons(`<symbol id="iconLvContacts" viewBox="0 0 32 32">
<path d="M12 4c3.314 0 6 2.686 6 6s-2.686 6-6 6-6-2.686-6-6 2.686-6 6-6zM12 6.4A3.6 3.6 0 1 0 12 13.6 3.6 3.6 0 0 0 12 6.4z"/>
<path d="M22.4 8.8c2.651 0 4.8 2.149 4.8 4.8s-2.149 4.8-4.8 4.8-4.8-2.149-4.8-4.8 2.149-4.8 4.8-4.8zM22.4 11.2a2.4 2.4 0 1 0 0 4.8 2.4 2.4 0 0 0 0-4.8z"/>
<path d="M12 18c4.26 0 8.4 1.772 8.4 4.8V26H3.6v-3.2C3.6 19.772 7.74 18 12 18zm0 2.4c-3.42 0-6 1.276-6 2.4V23.6h12v-0.8c0-1.124-2.58-2.4-6-2.4z"/>
<path d="M23.2 20.4c2.94 0 6 1.176 6 3.2V26h-6.133v-2.4h3.733v-0.16c-.46-.44-1.76-.8-3.4-.86a9.79 9.79 0 0 0-1.6-2.18h1.4z"/>
</symbol>`);

        configureCloseGuardI18n(this.i18n);

        // 关键设置严格读取并先核验原生锚点；失效时挂载恢复界面，禁止旧工作台继续访问 AV。
        const settingsRead = await readSettingsState(this);
        let settings: ContactsSettings | null = settingsRead.settings;
        if (settingsRead.status === "valid" && settings) {
            const anchor = await probeSettingsAnchor(settings);
            if (anchor.status === "verified") {
                this.workspaceState = { kind: "ready" };
            } else {
                this.recoverySettings = settings;
                this.workspaceState = { kind: anchor.status === "missing" ? "anchor-missing" : "anchor-unknown", message: anchor.message };
                settings = null;
            }
        } else if (settingsRead.status === "missing") {
            this.workspaceState = { kind: "uninitialized" };
            settings = null;
        } else if (settingsRead.status === "invalid") {
            this.workspaceState = { kind: "settings-invalid", message: "联系人设置文件格式无效，原文件已保留" };
            settings = null;
        } else {
            this.workspaceState = { kind: "settings-read-failed", message: settingsRead.error?.message ?? "联系人设置文件读取失败" };
            settings = null;
        }
        if (!this.isLifecycleActive(lifecycleToken) || !this.preferencesActive || preferencesEpoch !== this.preferencesEpoch) return;
        this.settings = settings;
        emitWorkspaceState(this.workspaceState);
        try {
            await this.loadViewPreferences();
        } catch (error) {
            if (this.isLifecycleActive(lifecycleToken) && this.preferencesActive && preferencesEpoch === this.preferencesEpoch) {
                showMessage(`偏好读取失败，当前值尚未核实：${error instanceof Error ? error.message : String(error)}`, 6000, "error");
            }
        }
        if (!this.isLifecycleActive(lifecycleToken) || !this.preferencesActive || preferencesEpoch !== this.preferencesEpoch) return;

        const plugin = this;
        this.addTab({
            type: TAB_TYPE,
            init() {
                if (!plugin.isLifecycleActive(lifecycleToken)) return;
                const state = this as WorkbenchTabState;
                if (plugin.tabMounts.get(state.element)?.isAlive()) return;
                state.__lvctDispose?.();
                const tabToken = createLifecycleToken(lifecycleToken);
                const container = document.createElement("div");
                container.className = "lvct-tab-root fn__flex-1";
                this.element.appendChild(container);
                const initialView = plugin.requestedWorkbenchView;
                plugin.requestedWorkbenchView = undefined;
                let instance: ReturnType<typeof mount> | null = null;
                const dispose = () => {
                    tabToken.invalidate();
                    const mounted = instance;
                    instance = null;
                    if (mounted) void unmount(mounted);
                    container.remove();
                    if (plugin.tabMounts.get(state.element) === tabToken) plugin.tabMounts.delete(state.element);
                    plugin.tabDisposers.delete(dispose);
                    if (state.__lvctDispose === dispose) state.__lvctDispose = null;
                };
                state.__lvctDispose = dispose;
                plugin.tabMounts.set(state.element, tabToken);
                plugin.tabDisposers.add(dispose);
                try {
                    instance = mount(WorkbenchRoot, {
                        target: container,
                        props: { facade: plugin, initialView },
                        context: new Map([[LIFECYCLE_CONTEXT, tabToken]]),
                    });
                } catch (error) {
                    dispose();
                    throw error;
                }
            },
            destroy() {
                if (!plugin.isLifecycleActive(lifecycleToken)) return;
                (this as WorkbenchTabState).__lvctDispose?.();
            },
        });

        this.addCommand({
            langKey: "openWorkbench",
            callback: () => {
                if (this.isLifecycleActive(lifecycleToken)) this.openWorkbench();
            },
        });

        this.addCommand({
            langKey: "captureFromNote",
            callback: () => {
                if (this.isLifecycleActive(lifecycleToken)) this.captureFromCurrentNote();
            },
        });

        // 编辑器右键菜单：捕获本文人员
        const onMenuContent = (event: Parameters<typeof this.onMenuContent>[0]) => {
            if (this.isLifecycleActive(lifecycleToken)) this.onMenuContent(event);
        };
        const onProtyleEvent = (event: Parameters<typeof this.onProtyleEvent>[0]) => {
            if (this.isLifecycleActive(lifecycleToken)) this.onProtyleEvent(event);
        };
        this.eventBus.on("open-menu-content", onMenuContent);

        // 人物文档档案条：文档加载/切换时按 rootID 判定是否注入
        this.eventBus.on("loaded-protyle-static", onProtyleEvent);
        this.eventBus.on("loaded-protyle-dynamic", onProtyleEvent);
        this.eventBus.on("switch-protyle", onProtyleEvent);
        this.eventCleanup = () => {
            this.eventBus.off("open-menu-content", onMenuContent);
            this.eventBus.off("loaded-protyle-static", onProtyleEvent);
            this.eventBus.off("loaded-protyle-dynamic", onProtyleEvent);
            this.eventBus.off("switch-protyle", onProtyleEvent);
        };

        // 对外人员服务桥（任务管理等插件经 window.LvContacts 查人/建人/记交集）
        initExternalBridge(this, () => this.settings);
    }

    onLayoutReady() {
        if (!this.isLifecycleActive() || !this.preferencesActive) return;
        const lifecycleToken = this.lifecycleToken;
        if (!this.layoutReady) this.addTopBar({
            icon: "iconLvContacts",
            title: this.i18n.openWorkbench ?? "小驴人脉",
            position: "right",
            callback: () => {
                if (this.isLifecycleActive(lifecycleToken)) this.openWorkbench();
            },
        });
        this.layoutReady = true;
        window.clearTimeout(this.startupTimer);
        if (this.preferencesVerified && this.viewPreferences.openOnStartup) {
            const epoch = this.preferencesEpoch;
            const lifecycleToken = this.lifecycleToken;
            this.startupTimer = window.setTimeout(() => {
                if (!this.isLifecycleActive(lifecycleToken) || !this.preferencesActive || epoch !== this.preferencesEpoch) return;
                this.startupTimer = 0;
                this.openWorkbench();
            }, 0);
        }
    }

    async onunload() {
        this.disposeLifecycle();
    }

    private disposeLifecycle(): void {
        const lifecycleToken = this.lifecycleToken;
        lifecycleToken.invalidate();
        this.preferencesActive = false;
        this.preferencesEpoch += 1;
        this.dataChangeRequest += 1;
        this.workspaceStateReloadVersion += 1;
        this.workspaceStateReloadPromise = null;
        this.requestedWorkbenchView = undefined;
        this.preferenceRequests.dispose();
        this.layoutReady = false;
        window.clearTimeout(this.dataChangeTimer);
        window.clearTimeout(this.startupTimer);
        window.clearTimeout(this.viewRequestTimer);
        this.dataChangeTimer = 0;
        this.startupTimer = 0;
        this.viewRequestTimer = 0;
        disposeExternalBridge();
        const eventCleanup = this.eventCleanup;
        this.eventCleanup = null;
        eventCleanup?.();
        for (const dispose of [...this.tabDisposers]) dispose();
        for (const dispose of [...this.ownedDialogDisposers]) dispose();
        const workbenchDialog = this.workbenchDialog;
        const dialogInstance = this.dialogInstance;
        this.workbenchDialog = null;
        this.dialogInstance = null;
        this.workbenchDialogToken?.invalidate();
        this.workbenchDialogToken = null;
        if (dialogInstance) unmount(dialogInstance);
        workbenchDialog?.destroy();
    }

    private readonly onProtyleEvent = (event: { detail?: { protyle?: { element: HTMLElement; block?: { rootID?: string } } } }): void => {
        if (!this.isLifecycleActive()) return;
        const context: PanelContext = { plugin: this, settings: this.settings, i18n: this.i18n, lifecycleToken: this.lifecycleToken };
        handleProtyleEvent(context, event);
    };

    private readonly onMenuContent = (event: { detail: { protyle?: { element?: HTMLElement; block?: { rootID?: string } }; menu: { addItem: (item: unknown) => void } } }): void => {
        const lifecycleToken = this.lifecycleToken;
        if (!this.isLifecycleActive(lifecycleToken)) return;
        const rootId = event.detail.protyle?.block?.rootID;
        if (!rootId) return;
        event.detail.menu.addItem({
            id: "lvct-capture",
            iconHTML: "",
            label: this.i18n.captureFromNote ?? "人脉：捕获本文人员",
            click: () => {
                if (this.isLifecycleActive(lifecycleToken)) this.openCaptureDialog(rootId);
            },
        });
        /* FAST-01.3：识别资料——选中文本（有选区才显示）与整篇文档；选区只读当前编辑器，不误读其他窗口 */
        const protyleElement = event.detail.protyle?.element;
        const selectionText = protyleElement ? readSelectionWithin(protyleElement) : "";
        if (selectionText.trim()) {
            event.detail.menu.addItem({
                id: "lvct-recognize-selection",
                iconHTML: "",
                label: `人脉：识别资料（选中文本，${[...selectionText.trim()].length} 字）`,
                click: () => {
                    if (this.isLifecycleActive(lifecycleToken)) void this.openRecognizeDialog(selectionText, rootId);
                },
            });
        }
        event.detail.menu.addItem({
            id: "lvct-recognize-doc",
            iconHTML: "",
            label: "人脉：识别资料（整篇文档）",
            click: () => {
                if (this.isLifecycleActive(lifecycleToken)) void this.openRecognizeDialog(protyleElement?.innerText ?? "", rootId);
            },
        });
    };

    /** 打开"从笔记捕获"：需当前有一篇打开的笔记 */
    captureFromCurrentNote(): void {
        if (!this.isLifecycleActive()) return;
        const editor = getActiveEditor(true);
        const rootId = editor?.protyle?.block?.rootID || visibleEditorRootId();
        if (!rootId) {
            showMessage("请先打开一篇笔记再捕获人员", 3000);
            return;
        }
        this.openCaptureDialog(rootId);
    }

    private openCaptureDialog(docId: string): void {
        if (!this.isLifecycleActive()) return;
        if (!this.settings) {
            showMessage("请先完成人脉工作空间初始化", 3000);
            return;
        }
        this.openOwnedDialog({
            title: "从笔记捕获人脉",
            width: "560px",
            component: CaptureDialog,
            props: { facade: this, i18n: this.i18n, docId },
        });
    }

    /** FAST-01.3：识别资料 → 预览确认 → 目标落点（人物文档=补充此联系人；普通笔记=新建） */
    private async openRecognizeDialog(rawText: string, rootDocId: string): Promise<void> {
        const lifecycleToken = this.lifecycleToken;
        if (!this.isLifecycleActive(lifecycleToken)) return;
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
        if (!this.isLifecycleActive(lifecycleToken)) return;
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
        const dialogToken = createLifecycleToken(lifecycleToken);
        let closed = false;
        let component: ReturnType<typeof mount> | null = null;
        const close = () => {
            if (closed) return;
            closed = true;
            dialogToken.invalidate();
            if (component) void unmount(component);
            component = null;
            container.remove();
            this.ownedDialogDisposers.delete(close);
        };
        this.ownedDialogDisposers.add(close);
        component = mount(QuickFillDialog, {
            target: container,
            props: {
                i18n: this.i18n,
                existing,
                initialResult: result,
                onApply: (patch: QuickFillPatch) => {
                    if (!this.isLifecycleActive(lifecycleToken) || !dialogToken.isAlive()) return;
                    close();
                    if (person) this.openPersonEditPrefilled(person, patch);
                    else this.openPersonCreatePrefilled(patch);
                },
                onClose: close,
            },
        });
    }

    private openOwnedDialog(args: Parameters<typeof svelteDialog>[0]): void {
        if (!this.isLifecycleActive()) return;
        const dialogToken = createLifecycleToken(this.lifecycleToken);
        const props = { ...args.props };
        for (const name of ["onSaved", "onCreated", "onChanged"]) {
            const callback = props[name];
            if (typeof callback === "function") {
                props[name] = (...values: unknown[]) => {
                    if (dialogToken.isAlive()) return callback(...values);
                };
            }
        }
        let closed = false;
        const owned = svelteDialog({
            ...args,
            props,
            callback: () => {
                if (closed) return;
                closed = true;
                dialogToken.invalidate();
                this.ownedDialogDisposers.delete(dispose);
                args.callback?.();
            },
        });
        const dispose = () => {
            if (!closed) owned.close();
        };
        this.ownedDialogDisposers.add(dispose);
    }

    /** 识别结果落到既有联系人：编辑弹窗预填勾选值，保存仍走既有 updateContactFields 与 B06 守卫 */
    private openPersonEditPrefilled(person: ContactSummary, patch: QuickFillPatch): void {
        const lifecycleToken = this.lifecycleToken;
        if (!this.isLifecycleActive(lifecycleToken)) return;
        if (!this.settings) return;
        const merged: ContactSummary = {
            ...person,
            name: patch.name ?? person.name,
            phone: patch.phone ?? person.phone,
            email: patch.email ?? person.email,
            wechat: patch.wechat ?? person.wechat,
            website: patch.website ?? person.website,
            birthday: patch.birthday ?? person.birthday,
            isLunar: patch.isLunar ?? person.isLunar,
            group: patch.group ?? person.group,
            tags: [...new Set([...person.tags, ...patch.tagsAppend])],
        };
        this.openOwnedDialog({
            title: `识别资料 · 补充「${person.name}」`,
            width: "560px",
            component: PersonEditDialog,
            props: {
                settings: this.settings,
                i18n: this.i18n,
                person: merged,
                onSaved: () => {
                    if (this.isLifecycleActive(lifecycleToken)) emitDataChanged({}, lifecycleToken);
                },
            },
        });
    }

    /** 识别结果落到新建：预填草稿（识别后继续编辑），创建仍走既有 createContact 查重路径 */
    private openPersonCreatePrefilled(patch: QuickFillPatch): void {
        const lifecycleToken = this.lifecycleToken;
        if (!this.isLifecycleActive(lifecycleToken)) return;
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
        this.openOwnedDialog({
            title: "识别资料 · 新建联系人",
            width: "560px",
            component: AddPersonDialog,
            props: {
                settings: this.settings,
                i18n: this.i18n,
                initial: draft,
                onCreated: () => {
                    if (this.isLifecycleActive(lifecycleToken)) emitDataChanged({}, lifecycleToken);
                },
            },
        });
    }

    /**
     * 覆写 onDataChanged：不覆写时宿主在同步 dataChange 后会整插件重载（打卡库 D-222）。
     * FUNC-01.7-a：先失效名册缓存（缓存可随时重建，不等 30s TTL），再防抖合并广播给
     * 本窗口工作台/档案条原地刷新（libs/data-events）；跨窗口投递依赖宿主对每个窗口
     * 实例的推送（Host pending）。
     */
    onDataChanged() {
        const lifecycleToken = this.lifecycleToken;
        if (!this.isLifecycleActive(lifecycleToken) || !this.preferencesActive) return;
        const epoch = this.preferencesEpoch;
        const request = ++this.dataChangeRequest;
        this.preferenceRequests.invalidate();
        console.debug("[lvct] storage data changed");
        invalidateRoster();
        if (this.dataChangeTimer) window.clearTimeout(this.dataChangeTimer);
        this.dataChangeTimer = window.setTimeout(async () => {
            if (!this.isLifecycleActive(lifecycleToken) || !this.preferencesActive || epoch !== this.preferencesEpoch || request !== this.dataChangeRequest) return;
            this.dataChangeTimer = 0;
            try {
                await this.reloadWorkspaceState();
                await this.loadViewPreferences();
                if (this.isLifecycleActive(lifecycleToken) && this.preferencesActive && epoch === this.preferencesEpoch && request === this.dataChangeRequest) {
                    emitDataChanged({ preferencesRevision: this.viewPreferences.revision }, lifecycleToken);
                }
            } catch (error) {
                if (this.isLifecycleActive(lifecycleToken) && this.preferencesActive && epoch === this.preferencesEpoch && request === this.dataChangeRequest) {
                    emitDataChanged({ preferencesError: error instanceof Error ? error.message : String(error) }, lifecycleToken);
                }
            }
        }, 600);
    }

    async reloadWorkspaceState(): Promise<WorkspaceState> {
        this.workspaceStateReloadVersion += 1;
        if (this.workspaceStateReloadPromise) return this.workspaceStateReloadPromise;
        const lifecycleToken = this.lifecycleToken;
        const reloadPromise = (async (): Promise<WorkspaceState> => {
            while (this.isLifecycleActive(lifecycleToken)) {
                const observedVersion = this.workspaceStateReloadVersion;
                const read = await readSettingsState(this);
                if (!this.isLifecycleActive(lifecycleToken)) return this.workspaceState;
                let next: WorkspaceState;
                let nextSettings: ContactsSettings | null;
                let nextRecoverySettings: ContactsSettings | null;
                if (read.status === "valid" && read.settings) {
                    const anchor = await probeSettingsAnchor(read.settings);
                    if (!this.isLifecycleActive(lifecycleToken)) return this.workspaceState;
                    if (anchor.status === "verified") {
                        nextRecoverySettings = null;
                        nextSettings = read.settings;
                        next = { kind: "ready" };
                    } else {
                        nextRecoverySettings = read.settings;
                        nextSettings = null;
                        next = { kind: anchor.status === "missing" ? "anchor-missing" : "anchor-unknown", message: anchor.message };
                    }
                } else if (read.status === "missing") {
                    nextRecoverySettings = null;
                    nextSettings = null;
                    next = { kind: "uninitialized" };
                } else if (read.status === "invalid") {
                    nextRecoverySettings = null;
                    nextSettings = null;
                    next = { kind: "settings-invalid", message: "联系人设置文件格式无效，原文件已保留" };
                } else {
                    nextRecoverySettings = null;
                    nextSettings = null;
                    next = { kind: "settings-read-failed", message: read.error?.message ?? "联系人设置文件读取失败" };
                }
                if (observedVersion !== this.workspaceStateReloadVersion) continue;
                this.recoverySettings = nextRecoverySettings;
                this.settings = nextSettings;
                this.workspaceState = next;
                emitWorkspaceState(next);
                return next;
            }
            return this.workspaceState;
        })();
        this.workspaceStateReloadPromise = reloadPromise;
        try {
            return await reloadPromise;
        } finally {
            if (this.workspaceStateReloadPromise === reloadPromise) this.workspaceStateReloadPromise = null;
        }
    }

    openWorkbench(view?: WorkbenchView) {
        if (!this.isLifecycleActive()) return;
        window.clearTimeout(this.viewRequestTimer);
        this.viewRequestTimer = 0;
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
                const epoch = this.preferencesEpoch;
                const lifecycleToken = this.lifecycleToken;
                const tabToken = [...this.tabMounts.values()].at(-1);
                this.viewRequestTimer = window.setTimeout(() => {
                    if (!this.isLifecycleActive(lifecycleToken) || !this.preferencesActive || epoch !== this.preferencesEpoch) return;
                    this.viewRequestTimer = 0;
                    if (!tabToken?.isAlive()) return;
                    window.dispatchEvent(new CustomEvent("lvct-workbench-view", { detail: { view, facade: this, token: tabToken } }));
                    if (this.requestedWorkbenchView === view) this.requestedWorkbenchView = undefined;
                }, 0);
            }
        }
    }

    async initialize(
        notebookName: string,
        onProgress: (step: InitProgressStep) => void,
        options?: { createSelf?: boolean },
    ): Promise<ContactsSettings> {
        const lifecycleToken = this.lifecycleToken;
        const settings = await initializeWorkspace(this, { notebookName, createSelf: options?.createSelf }, (step) => {
            if (this.isLifecycleActive(lifecycleToken)) onProgress(step);
        });
        if (this.isLifecycleActive(lifecycleToken)) {
            this.recoverySettings = null;
            this.settings = settings;
        }
        if (this.isLifecycleActive(lifecycleToken)) {
            this.workspaceState = { kind: "ready" };
            emitWorkspaceState(this.workspaceState);
        }
        return settings;
    }

    async previewInitialize(notebookName: string): Promise<WorkspaceSnapshot> {
        return inspectWorkspace(notebookName);
    }

    async scanAnchorCandidates(options?: import("./services/init").AnchorScanOptions) {
        return scanAnchorCandidates(options);
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

    async listPersonExchanges(personDocId: string) {
        return listPersonExchanges(this, personDocId);
    }

    async createPersonExchange(input: import("./services/exchanges").CreatePersonExchangeInput) {
        return createPersonExchange(this, input);
    }

    async updatePersonExchange(id: string, patch: import("./domain/exchanges").ExchangePatch) {
        return updatePersonExchange(this, id, patch);
    }

    async changePersonExchangeStatus(id: string, status: import("./domain/exchanges").ExchangeStatus, settledOn?: string) {
        return changePersonExchangeStatus(this, id, status, settledOn);
    }

    async listPersonAliases(personDocId: string) {
        return listPersonAliases(this, personDocId);
    }

    async addPersonAlias(personDocId: string, alias: string) {
        if (!this.settings) throw new Error("人脉工作空间尚未初始化");
        const token = this.lifecycleToken;
        const result = await addPersonAlias(this, personDocId, alias, this.settings);
        emitDataChanged({ topics: ["people"], docIds: [personDocId] }, token);
        return result;
    }

    async removePersonAlias(id: string) {
        const token = this.lifecycleToken;
        await removePersonAlias(this, id);
        emitDataChanged({ topics: ["people"] }, token);
    }

    async resolvePersonAlias(alias: string) {
        if (!this.settings) throw new Error("人脉工作空间尚未初始化");
        return resolveAlias(this, alias, this.settings);
    }

    async previewCapture(docId: string) {
        if (!this.settings) throw new Error("人脉工作空间尚未初始化");
        return previewCapture(this.settings, docId);
    }

    async updatePersonFields(personItemId: string, draft: import("./domain/person").ContactDraft) {
        if (!this.settings) throw new Error("人脉工作空间尚未初始化");
        return updateContactFields(this.settings, personItemId, draft);
    }

    /** B11：本人身份读取（null = 未建立） */
    async loadSelfIdentity() {
        return loadSelfIdentity(this);
    }

    /** B11.3：确保本人档案「我自己」存在（幂等；失败返回 null 不抛） */
    async createSelfProfile() {
        if (!this.settings) throw new Error("人脉工作空间尚未初始化");
        const token = this.lifecycleToken;
        const identity = await ensureSelfIdentity(this, this.settings);
        emitDataChanged({}, token);
        return identity;
    }

    /** B11.3/B11.5：把本人身份显式指定到一名已有联系人（显式改绑） */
    async designateSelfIdentity(personItemId: string) {
        if (!this.settings) throw new Error("人脉工作空间尚未初始化");
        const token = this.lifecycleToken;
        const identity = await designateSelfIdentity(this, this.settings, personItemId);
        emitDataChanged({}, token);
        return identity;
    }

    async previewSelfIdentityChange(targetItemId: string | null) {
        if (!this.settings) throw new Error("人脉工作空间尚未初始化");
        return previewSelfIdentityChange(this, this.settings, targetItemId);
    }

    async applySelfIdentityChange(preview: import("./domain/self-identity").SelfIdentityChangePreview) {
        if (!this.settings) throw new Error("人脉工作空间尚未初始化");
        const token = this.lifecycleToken;
        const identity = await applySelfIdentityChange(this, this.settings, preview);
        emitDataChanged({}, token);
        return identity;
    }

    /** B11.3：全量名册（设置页本人档案指定用；未初始化返回空） */
    async listContacts() {
        if (!this.settings) return [];
        return listContactsService(this.settings);
    }

    async loadPersonRelationshipLabels(personDocId: string) {
        if (!this.settings) throw new Error("人脉工作空间尚未初始化");
        return loadPersonRelationshipLabels(this, this.settings, personDocId);
    }

    async savePersonRelationshipLabels(personDocId: string, selfDocId: string, labels: string[], expected: import("./domain/person-relationship-labels").PersonRelationshipLabels | null) {
        if (!this.settings) throw new Error("人脉工作空间尚未初始化");
        const token = this.lifecycleToken;
        const result = await savePersonRelationshipLabels(this, this.settings, personDocId, selfDocId, labels, expected);
        invalidateRoster();
        emitDataChanged({}, token);
        return result;
    }

    /** B13.3：组织列举（含成员记录） */
    async listOrganizations() {
        return listOrganizationsWithMembers(this);
    }

    /** B13.5c：组织标记 keyset 分页 */
    async listOrganizationsPage(options?: { afterRootId?: string; limit?: number }) {
        return listOrganizationsPage(this, options);
    }

    /** B13.3：新建组织（文档 + custom-lvct-org 标记区块；同名拒绝） */
    async createOrganization(name: string) {
        if (!this.settings) throw new Error("人脉工作空间尚未初始化");
        const token = this.lifecycleToken;
        const result = await createOrganization(this.settings, name, this);
        emitDataChanged({ topics: ["organizations"] }, token);
        return result;
    }

    /** B13.3：组织成员列举（join 名册姓名） */
    async listOrganizationMembers(orgDocId: string) {
        if (!this.settings) throw new Error("人脉工作空间尚未初始化");
        return listOrganizationMembers(this, this.settings, orgDocId);
    }

    /** B13.5b：组织成员筛选与稳定分页 */
    async listOrganizationMembersPage(orgDocId: string, options?: { query?: string; status?: "all" | "active" | "former"; offset?: number; limit?: number }) {
        if (!this.settings) throw new Error("人脉工作空间尚未初始化");
        return listOrganizationMembersPage(this, this.settings, orgDocId, options);
    }

    /** B13.3：添加组织成员（active） */
    async addOrganizationMember(orgDocId: string, personDocId: string, extra?: { department?: string; title?: string; joinedOn?: string; affiliationKind?: import("./domain/org-membership").OrgAffiliationKind }) {
        if (!this.settings) throw new Error("人脉工作空间尚未初始化");
        const token = this.lifecycleToken;
        const report = await saveOrganizationMember(this, this.settings, { ...extra, orgDocId, personDocId });
        emitDataChanged({}, token);
        return report;
    }

    /** B13.3：移除组织成员记录 */
    async removeOrganizationMember(id: string, expected?: import("./domain/org-membership").OrgMembership) {
        if (!this.settings) throw new Error("人脉工作空间尚未初始化");
        const token = this.lifecycleToken;
        const report = await deleteOrganizationMember(this, this.settings, id, expected);
        emitDataChanged({}, token);
        return report;
    }

    /** B13.4：更新成员记录字段（部门/职位/入职/离职/状态；身份字段不可变） */
    async updateOrganizationMember(id: string, patch: import("./domain/org-membership").OrgMembershipPatch, expected?: import("./domain/org-membership").OrgMembership) {
        if (!this.settings) throw new Error("人脉工作空间尚未初始化");
        const token = this.lifecycleToken;
        const report = await editOrganizationMember(this, this.settings, id, patch, expected);
        emitDataChanged({}, token);
        return report;
    }

    async replaceOrganizationMember(formerMembershipId: string, successorPersonDocId: string, extra: { department?: string; title?: string; joinedOn: string; leftOn: string; affiliationKind?: import("./domain/org-membership").OrgAffiliationKind }, expected?: import("./domain/org-membership").OrgMembership) {
        if (!this.settings) throw new Error("人脉工作空间尚未初始化");
        const token = this.lifecycleToken;
        const report = await replaceOrganizationMemberWithProjection(this, this.settings, { ...extra, formerId: formerMembershipId, personDocId: successorPersonDocId }, expected);
        emitDataChanged({}, token);
        return report;
    }

    /** B13：归档组织（标记区块值 archived；文档与成员记录保留可恢复） */
    async archiveOrganization(orgDocId: string) {
        const token = this.lifecycleToken;
        await archiveOrganization(orgDocId);
        emitDataChanged({ topics: ["organizations", "memberships"], docIds: [orgDocId] }, token);
    }

    /** B13：恢复归档组织 */
    async restoreOrganization(orgDocId: string) {
        const token = this.lifecycleToken;
        await restoreOrganization(orgDocId);
        emitDataChanged({ topics: ["organizations", "memberships"], docIds: [orgDocId] }, token);
    }

    /** B13.4：组织改名（同名检查；标记块文案同步，归档值保持） */
    async renameOrganization(orgDocId: string, name: string) {
        const token = this.lifecycleToken;
        await renameOrganization(orgDocId, name, this);
        emitDataChanged({ topics: ["organizations", "memberships"], docIds: [orgDocId] }, token);
    }

    async listPendingOrganizationOperations() {
        return listPendingOrganizationOperations(this);
    }

    async inspectOrganizationOperation(requestId: string) {
        return inspectOrganizationOperation(this, requestId);
    }

    async resumeOrganizationOperation(requestId: string) {
        if (!this.settings) throw new Error("人脉工作空间尚未初始化");
        return resumeOrganizationOperation(this, this.settings, requestId);
    }

    /** B13.9：移除悬空的 org-links 区块（体检修复入口；逐块隔离返回失败清单） */
    async removeOrgLinkBlocks(blockIds: readonly string[]) {
        return removeOrgLinkBlocks(blockIds);
    }

    /** B12：某人的组织归属投影（成员记录 join 组织名） */
    async listPersonOrgMemberships(personDocId: string) {
        if (!this.settings) throw new Error("人脉工作空间尚未初始化");
        return listPersonOrgMemberships(this, personDocId);
    }

    async previewOrganizationProjections(docIds?: readonly string[]) {
        if (!this.settings) throw new Error("人脉工作空间尚未初始化");
        return previewOrganizationProjections(this, this.settings, docIds);
    }

    async repairOrganizationProjection(preview: import("./services/org-projections").OrgProjectionPreview, retryKey: string) {
        if (!this.settings) throw new Error("人脉工作空间尚未初始化");
        const token = this.lifecycleToken;
        const result = await repairOrganizationProjection(this, this.settings, preview, retryKey);
        if (result.status === "applied" || result.status === "unchanged") emitDataChanged({}, token);
        return result;
    }

    /** B13.6：共同背景（同组织联系人，重叠期间/同期口径，零写入） */
    async listCommonOrgBackground(personDocId: string) {
        if (!this.settings) throw new Error("人脉工作空间尚未初始化");
        return listCommonOrgBackground(this, this.settings, personDocId);
    }

    /** B13.3：打开组织管理弹窗（B13.6a：携目标组织定位；成员行可跨弹窗导航到工作台人物详情） */
    openOrgManagerDialog(initialOrgDocId?: string): void {
        if (!this.isLifecycleActive()) return;
        if (!this.settings) {
            showMessage("请先完成人脉工作空间初始化", 3000);
            return;
        }
        this.openOwnedDialog({
            title: this.i18n.orgManagerTitle ?? "组织管理",
            /* H-01/V-02：宽屏响应式（原固定 620px 左栏挤迫）；min() 兼顾窄视口不溢出 */
            width: "min(920px, 92vw)",
            component: OrgManagerDialog,
            props: {
                facade: this,
                i18n: this.i18n,
                initialOrgDocId,
                onOpenPerson: (person: unknown) => {
                    /* 组织弹窗为宿主级弹窗，人物详情 Peek 由工作台承载：
                       经窗口事件交给已挂载的工作台打开（组织弹窗先于 Peek 关闭，避免遮挡） */
                    window.dispatchEvent(new CustomEvent("lvct-workbench-person", { detail: { person } }));
                },
            },
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

    async prepareAiExtraction(docId: string, options?: AiPreflightOptions) {
        if (!this.settings) throw new Error("人脉工作空间尚未初始化");
        if (!this.viewPreferences.aiEnabled) throw new AiExtractionError("disabled");
        return prepareAiExtraction(this.settings, docId, options);
    }

    async aiExtractFromDoc(docId: string, confirmation?: AiExtractionConfirmation) {
        if (!this.settings) throw new Error("人脉工作空间尚未初始化");
        if (!this.viewPreferences.aiEnabled) throw new AiExtractionError("disabled");
        const outcome = await extractFromDoc(this.settings, docId, confirmation);
        if (!this.viewPreferences.aiEnabled) throw new AiExtractionError("disabled");
        return outcome;
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

    async runHealthAuditReport(previous?: import("./domain/health-audit").HealthAuditReport) {
        if (!this.settings) throw new Error("人脉工作空间尚未初始化");
        return auditWorkspaceDataReport(this, this.settings, { previous });
    }

    async retryFailedHealthAuditModules(previous: import("./domain/health-audit").HealthAuditReport) {
        if (!this.settings) throw new Error("人脉工作空间尚未初始化");
        return retryFailedHealthAuditModules(this, this.settings, previous);
    }

    async previewMissingFields() {
        if (!this.settings) throw new Error("人脉工作空间尚未初始化");
        return previewMissingFields(this, this.settings);
    }

    async rebuildMissingFields(preview: FieldRebuildPreview) {
        if (!this.settings) throw new Error("人脉工作空间尚未初始化");
        const token = this.lifecycleToken;
        const settings = await rebuildMissingFields(this, this.settings, preview, () => this.isLifecycleActive(token));
        if (this.isLifecycleActive(token)) this.settings = settings;
        return settings;
    }

    async previewRebindSettings(patch: Parameters<typeof rebindSettings>[2]) {
        const settings = this.recoverySettings ?? this.settings;
        if (!settings) throw new Error("人脉工作空间尚未初始化");
        return previewRebindSettings(this, settings, patch);
    }

    async rebindSettings(patch: Parameters<typeof rebindSettings>[2], preview: SettingsRebindPreview) {
        const source = this.recoverySettings ?? this.settings;
        if (!source) throw new Error("人脉工作空间尚未初始化");
        const token = this.lifecycleToken;
        const settings = await rebindSettings(this, source, patch, preview, () => this.isLifecycleActive(token));
        if (this.isLifecycleActive(token)) {
            this.recoverySettings = null;
            this.settings = settings;
            this.workspaceState = { kind: "ready" };
            emitWorkspaceState(this.workspaceState);
        }
        return settings;
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
        /* B07：人物详情打开时读侧对账；失败上抛，由详情页显示未对账并提供重试。 */
        await reconcileFollowUpTasksFromDoc(this, personDocId);
        return listPersonFollowUps(this, personDocId);
    }

    async loadPersonNote(personDocId: string) {
        return loadPersonNote(personDocId);
    }

    async savePersonNote(personDocId: string, note: string, expected?: string) {
        const saved = await savePersonNote(personDocId, note, expected);
        emitDataChanged({ topics: ["people"], docIds: [personDocId] });
        return saved;
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
        const token = this.lifecycleToken;
        const settings = await repairFieldMap(this, this.settings, patch, () => this.isLifecycleActive(token));
        if (this.isLifecycleActive(token)) this.settings = settings;
        return settings;
    }

    async loadViewPreferences() {
        return this.preferenceRequests.load();
    }

    async saveViewPreferences(preferences: ViewPreferences, baseline: ViewPreferences = this.viewPreferences) {
        return this.preferenceRequests.save(preferences, baseline);
    }

    openHostDoc() {
        if (!this.isLifecycleActive() || !this.settings) return;
        openTab({ app: this.app, doc: { id: this.settings.hostDocId } });
    }

    openDoc(docId: string) {
        if (!this.isLifecycleActive() || !docId) return;
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
        if (!this.isLifecycleActive()) return;
        if (this.workbenchDialog) {
            if (initialView) {
                window.clearTimeout(this.viewRequestTimer);
                const epoch = this.preferencesEpoch;
                const lifecycleToken = this.lifecycleToken;
                const dialogToken = this.workbenchDialogToken;
                this.viewRequestTimer = window.setTimeout(() => {
                    if (!this.isLifecycleActive(lifecycleToken) || !this.preferencesActive || epoch !== this.preferencesEpoch
                        || !dialogToken?.isAlive() || this.workbenchDialogToken !== dialogToken) return;
                    this.viewRequestTimer = 0;
                    window.dispatchEvent(new CustomEvent("lvct-workbench-view", { detail: { view: initialView, facade: this, token: dialogToken } }));
                }, 0);
            }
            return;
        }
        const dialogToken = createLifecycleToken(this.lifecycleToken);
        this.workbenchDialogToken = dialogToken;
        this.workbenchDialog = new Dialog({
            title: this.i18n.tabTitle ?? "小驴人脉",
            content: '<div class="lvct-dialog-root" style="height:100%;"></div>',
            width: "100vw",
            height: "100%",
            destroyCallback: () => {
                if (this.workbenchDialogToken !== dialogToken) return;
                dialogToken.invalidate();
                window.clearTimeout(this.viewRequestTimer);
                this.viewRequestTimer = 0;
                if (this.dialogInstance) {
                    unmount(this.dialogInstance);
                    this.dialogInstance = null;
                }
                this.workbenchDialog = null;
                this.workbenchDialogToken = null;
            },
        });
        const target = this.workbenchDialog.element.querySelector<HTMLElement>(".lvct-dialog-root");
        try {
            if (!target) throw new Error("dialog 容器缺失");
            this.dialogInstance = mount(WorkbenchRoot, {
                target, props: { facade: this, initialView },
                context: new Map([[LIFECYCLE_CONTEXT, dialogToken]]),
            });
        } catch (error) {
            this.workbenchDialog?.destroy();
            throw error;
        }
    }
}
