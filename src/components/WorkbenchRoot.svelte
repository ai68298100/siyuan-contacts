<script lang="ts">
    /** 根组件：按初始化状态在 向导 ↔ 工作台 之间切换 */
    import InitWizard from "./InitWizard.svelte";
    import Workbench from "./Workbench.svelte";
    import type { ContactsPluginFacade, WorkbenchView } from "../types";
    import type { ViewPreferences } from "../domain/preferences";

    let { facade, initialView }: { facade: ContactsPluginFacade; initialView?: WorkbenchView } = $props();

    // 有意取挂载时快照：settings 只会经下方向导回调在本组件内更新
    // svelte-ignore state_referenced_locally
    let settings = $state(facade.settings);
    // svelte-ignore state_referenced_locally
    let preferences: ViewPreferences = $state(facade.viewPreferences);
</script>

{#if settings}
    <Workbench
        {facade}
        {settings}
        {preferences}
        {initialView}
        onPreferencesUpdated={(value) => (preferences = value)}
        isMobile={facade.isMobile}
        onOpenPersonDoc={(docId) => facade.openPersonDoc(docId)}
    />
{:else}
    <InitWizard facade={facade} onInitialized={(value) => (settings = value)} />
{/if}
