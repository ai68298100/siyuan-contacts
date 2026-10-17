<script lang="ts">
    /** 联系人原生弹窗的组织创建流程；底层人物草稿保持挂载。 */
    import { onDestroy } from "svelte";
    import OrganizationProfileEditor from "./OrganizationProfileEditor.svelte";
    import type { ContactsPluginFacade } from "../../types";
    import type { HostCloseChannel } from "../../libs/dialog";
    import type { OrganizationProfileDraft } from "../../domain/organization-profile";
    import { normalizeOrganizationProfileDraft } from "../../domain/organization-profile";
    import { OrganizationProfileConflictError } from "../../data/organization-profiles";
    import { requestErrorMessage } from "../../shared/error-presenter";

    let { facade, initialName = "", hostCloseChannel, onCreated, onClose }: {
        facade: ContactsPluginFacade;
        initialName?: string;
        hostCloseChannel?: HostCloseChannel;
        onCreated: (created: { docId: string; name: string }) => void;
        onClose: () => void;
    } = $props();

    let alive = true;
    onDestroy(() => { alive = false; });
    // svelte-ignore state_referenced_locally
    const initial = { name: initialName.trim() };
    let saving = $state(false);
    let error = $state("");
    let createdDocId = $state("");
    let createdDraft = $state<OrganizationProfileDraft | null>(null);
    let editor: { requestClose: () => Promise<boolean> } | undefined = $state();

    $effect(() => {
        if (!hostCloseChannel) return;
        const request = async (close: () => void) => {
            if (await editor?.requestClose() && alive) close();
        };
        hostCloseChannel.request = request;
        return () => { if (hostCloseChannel.request === request) hostCloseChannel.request = undefined; };
    });

    async function save(draft: OrganizationProfileDraft): Promise<void> {
        if (saving || !alive) return;
        saving = true;
        error = "";
        try {
            let docId = createdDocId;
            if (docId) {
                // 原资料可能已写入但回读失败；先只读核实，不能始终按空资料补写。
                if (!createdDraft || !facade.loadOrganizationProfile || !facade.saveOrganizationProfile) throw new Error("当前环境不能核实组织资料，请重新加载插件后核对；原组织不会再次创建");
                const original = createdDraft;
                const fingerprint = JSON.stringify(normalizeOrganizationProfileDraft(original));
                if (JSON.stringify(normalizeOrganizationProfileDraft(draft)) !== fingerprint) throw new Error("组织资料仍待核实，请恢复首次提交的名称和资料后重试；不能用新输入覆盖原请求");
                const current = (await facade.listOrganizations()).find((org) => org.docId === docId);
                if (!alive) return;
                if (!current || current.name.trim() !== original.name) throw new Error("组织名称或可用状态已变化，请从组织页面重新核对；本次未改名或覆盖资料");
                const profile = await facade.loadOrganizationProfile(docId);
                if (!alive) return;
                if (profile && JSON.stringify(normalizeOrganizationProfileDraft(profile)) !== fingerprint) throw new OrganizationProfileConflictError(docId);
                if (!profile) await facade.saveOrganizationProfile(docId, original, null);
                if (!alive) return;
            } else {
                const created = await facade.createOrganization(draft.name, draft);
                if (!alive) return;
                docId = created.docId;
                createdDocId = docId;
                if (created.profileSaved === false) {
                    createdDraft = normalizeOrganizationProfileDraft(draft);
                    error = `组织已创建，但资料尚未保存：${created.profileError ?? "请重试"}`;
                    return;
                }
            }
            onCreated({ docId, name: draft.name.trim() });
            onClose();
        } catch (cause) {
            if (alive) error = requestErrorMessage(cause);
        } finally { if (alive) saving = false; }
    }
</script>

<div class="lvct-contact-organization-dialog">
    <OrganizationProfileEditor bind:this={editor} {initial} {saving} {error} onSave={save} onCancel={onClose} />
</div>

<style>
    .lvct-contact-organization-dialog { box-sizing: border-box; max-height: 82vh; overflow-y: auto; padding: 16px; }
</style>
