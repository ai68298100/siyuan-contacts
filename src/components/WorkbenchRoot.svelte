<script lang="ts">
    /** 根组件：按初始化状态在 向导 ↔ 工作台 之间切换 */
    import InitWizard from "./InitWizard.svelte";
    import Workbench from "./Workbench.svelte";
    import WorkspaceRecovery from "./WorkspaceRecovery.svelte";
    import type { ContactsPluginFacade, WorkbenchView } from "../types";
    import type { ViewPreferences } from "../domain/preferences";
    import type { WorkspaceState } from "../domain/workspace-state";
    import { onMount } from "svelte";
    import { LVCT_WORKSPACE_STATE } from "../libs/data-events";

    let { facade, initialView }: { facade: ContactsPluginFacade; initialView?: WorkbenchView } = $props();

    // settings 仅作为当前工作台 props；任何设置/锚点变化都先切出工作台，避免旧 props 继续请求内核。
    // svelte-ignore state_referenced_locally
    let settings = $state(facade.settings);
    // svelte-ignore state_referenced_locally
    let workspaceState: WorkspaceState = $state(facade.workspaceState);
    // svelte-ignore state_referenced_locally
    let preferences: ViewPreferences = $state(facade.viewPreferences);

    onMount(() => {
        const onState = (event: Event) => {
            const next = (event as CustomEvent<WorkspaceState>).detail;
            if (!next) return;
            workspaceState = next;
            // Recovery states deliberately clear the props.  The facade may retain a
            // recovery snapshot for scanning/rebinding, but it must never be passed
            // back to Workbench while the anchor is unverified.
            settings = next.kind === "ready" ? facade.settings : null;
        };
        window.addEventListener(LVCT_WORKSPACE_STATE, onState);
        return () => window.removeEventListener(LVCT_WORKSPACE_STATE, onState);
    });
</script>

{#if workspaceState.kind === "ready" && settings}
    <Workbench
        {facade}
        {settings}
        {preferences}
        {initialView}
        onPreferencesUpdated={(value) => (preferences = value)}
        isMobile={facade.isMobile}
        onOpenPersonDoc={(docId) => facade.openPersonDoc(docId)}
    />
{:else if workspaceState.kind === "uninitialized"}
    <InitWizard facade={facade} i18n={facade.i18n} onInitialized={(value) => { settings = value; workspaceState = { kind: "ready" }; }} />
{:else}
    <WorkspaceRecovery
        {facade}
        workspace={workspaceState}
        onRetry={() => void facade.reloadWorkspaceState()}
        onStartInit={() => { settings = null; workspaceState = { kind: "uninitialized" }; }}
        onReady={(value) => { settings = value; workspaceState = { kind: "ready" }; }}
    />
{/if}
