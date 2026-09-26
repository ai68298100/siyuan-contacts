<script lang="ts">
    /** 根组件：按初始化状态在 向导 ↔ 工作台 之间切换 */
    import InitWizard from "./InitWizard.svelte";
    import Workbench from "./Workbench.svelte";
    import type { ContactsPluginFacade } from "../types";

    let { facade }: { facade: ContactsPluginFacade } = $props();

    // 有意取挂载时快照：settings 只会经下方向导回调在本组件内更新
    // svelte-ignore state_referenced_locally
    let settings = $state(facade.settings);
</script>

{#if settings}
    <Workbench
        {settings}
        isMobile={facade.isMobile}
        onOpenHostDoc={() => facade.openHostDoc()}
        onOpenSettings={() => facade.openSettings()}
    />
{:else}
    <InitWizard facade={facade} onInitialized={(value) => (settings = value)} />
{/if}
