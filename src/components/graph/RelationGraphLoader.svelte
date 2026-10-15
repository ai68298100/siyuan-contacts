<script lang="ts">
    import RelationGraph from "./RelationGraph.svelte";
    import type { ContactsSettings } from "../../domain/model";
    import type { ViewPreferences } from "../../domain/preferences";
    import type { ContactSummary } from "../../domain/person";
    import type { ContactsPluginFacade } from "../../types";

    let {
        settings,
        revision = 0,
        facade,
        preferences,
        onPreferencesChange,
        onOpenDetail,
        onOpenPeople,
        onOpenCreatePerson,
        onOpenOrgs,
    }: {
        settings: ContactsSettings;
        revision?: number;
        facade: ContactsPluginFacade;
        preferences: ViewPreferences;
        onPreferencesChange: (next: ViewPreferences) => Promise<ViewPreferences>;
        onOpenDetail: (person: ContactSummary) => void;
        onOpenPeople: () => void;
        onOpenCreatePerson?: () => void;
        onOpenOrgs: (orgDocId?: string) => void;
    } = $props();

</script>

<!-- 思源插件必须保持单入口 CJS；关系图组件静态导入，避免宿主无法解析运行时 chunk。 -->
<RelationGraph
    {settings}
    {revision}
    {facade}
    i18n={facade.i18n}
    {preferences}
    {onPreferencesChange}
    {onOpenDetail}
    {onOpenPeople}
    {onOpenCreatePerson}
    {onOpenOrgs}
/> 
