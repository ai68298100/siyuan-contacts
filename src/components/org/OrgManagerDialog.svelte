<script lang="ts">
    /** B13.3 组织管理：组织列表/新建/成员维护（svelteDialog 直挂）。
     *  数据经 facade（listOrganizations/createOrganization/listOrganizationMembers/
     *  addOrganizationMember/removeOrganizationMember/listContacts），写入语义在 services/org。 */
    import { tick } from "svelte";
    import { translateText } from "../../domain/translation";
    import type { ContactsPluginFacade } from "../../types";
    import type { OrganizationWithMembers, OrganizationMember } from "../../services/org";
    import type { ContactSummary } from "../../domain/person";
    import ViewState from "../ViewState.svelte";

    let {
        facade,
        i18n,
        onClose,
    }: {
        facade: ContactsPluginFacade;
        i18n?: Readonly<Record<string, string>>;
        onClose: () => void;
    } = $props();
    const text = $derived.by(() => (key: string, fallback: string, values?: Record<string, string | number>) =>
        translateText(i18n, key, fallback, values));

    let orgs: OrganizationWithMembers[] = $state([]);
    let currentOrgDocId: string = $state("");
    let members: OrganizationMember[] = $state([]);
    let roster: ContactSummary[] = $state([]);
    let newOrgName = $state("");
    let addPersonId = $state("");
    let busy = $state(false);
    let loading = $state(true);
    let errorMessage = $state("");
    /* B13：归档分组展示开关；B13.4 成员行内编辑 */
    let showArchived = $state(false);
    let editingMemberId = $state("");
    let editDepartment = $state("");
    let editTitle = $state("");
    let editJoinedOn = $state("");
    let editLeftOn = $state("");
    let editStatus = $state<"active" | "former">("active");

    const currentOrg = $derived(orgs.find((org) => org.docId === currentOrgDocId) ?? null);
    const activeOrgs = $derived(orgs.filter((org) => !org.archived));
    const archivedOrgs = $derived(orgs.filter((org) => org.archived));
    /* 可添加成员 = 名册中未加入当前组织的人（本人档案也可加入组织：本人可以是某公司员工） */
    const addCandidates = $derived(
        roster.filter((person) => !members.some((member) => member.personDocId === person.docId)),
    );

    async function loadOrgs(keepSelection: boolean = true): Promise<void> {
        orgs = await facade.listOrganizations();
        if (keepSelection && orgs.some((org) => org.docId === currentOrgDocId)) return;
        currentOrgDocId = orgs[0]?.docId ?? "";
        await loadMembers();
    }

    async function loadMembers(): Promise<void> {
        if (!currentOrgDocId) {
            members = [];
            return;
        }
        members = await facade.listOrganizationMembers(currentOrgDocId);
    }

    $effect(() => {
        void (async () => {
            loading = true;
            try {
                roster = await facade.listContacts();
                await loadOrgs(false);
            } catch (error) {
                errorMessage = error instanceof Error ? error.message : String(error);
            } finally {
                loading = false;
            }
        })();
    });

    async function run(task: () => Promise<void>): Promise<void> {
        if (busy) return;
        busy = true;
        errorMessage = "";
        try {
            await task();
        } catch (error) {
            errorMessage = error instanceof Error ? error.message : String(error);
        } finally {
            busy = false;
            await tick();
        }
    }

    function selectOrg(docId: string): void {
        if (busy || docId === currentOrgDocId) return;
        currentOrgDocId = docId;
        errorMessage = "";
        void (async () => {
            try {
                await loadMembers();
            } catch (error) {
                errorMessage = error instanceof Error ? error.message : String(error);
            }
        })();
    }

    function createOrg(): void {
        const name = newOrgName.trim();
        if (!name || busy) return;
        void run(async () => {
            await facade.createOrganization(name);
            newOrgName = "";
            await loadOrgs(false);
            /* 新建后选中该组织并加载成员（不落回空选择） */
            const created = orgs.find((org) => org.name === name);
            currentOrgDocId = created?.docId ?? orgs[0]?.docId ?? "";
            await loadMembers();
        });
    }

    function addMember(): void {
        if (!addPersonId || busy || !currentOrgDocId) return;
        const department = "";
        const title = "";
        void run(async () => {
            await facade.addOrganizationMember(currentOrgDocId, addPersonId, { department, title });
            addPersonId = "";
            await loadMembers();
        });
    }

    function removeMember(id: string): void {
        if (busy) return;
        void run(async () => {
            await facade.removeOrganizationMember(id);
            await loadMembers();
        });
    }

    /** B13.4：进入成员编辑（表单初始化自当前记录） */
    function startEditMember(member: OrganizationMember): void {
        editingMemberId = member.id;
        editDepartment = member.department;
        editTitle = member.title;
        editJoinedOn = member.joinedOn;
        editLeftOn = member.leftOn;
        editStatus = member.status;
    }

    function cancelEditMember(): void {
        editingMemberId = "";
    }

    /** B13.4：保存成员字段（部门/职位/入职/离职/状态；身份字段不可变） */
    function saveEditMember(): void {
        const id = editingMemberId;
        if (!id || busy) return;
        void run(async () => {
            await facade.updateOrganizationMember(id, {
                department: editDepartment,
                title: editTitle,
                joinedOn: editJoinedOn,
                leftOn: editLeftOn,
                status: editStatus,
            });
            editingMemberId = "";
            await loadMembers();
        });
    }

    /** B13：归档当前组织（文档与成员记录保留，可恢复） */
    function archiveCurrentOrg(): void {
        const docId = currentOrgDocId;
        if (!docId || busy) return;
        void run(async () => {
            await facade.archiveOrganization(docId);
            await loadOrgs(true);
        });
    }

    /** B13：恢复归档组织 */
    function restoreCurrentOrg(): void {
        const docId = currentOrgDocId;
        if (!docId || busy) return;
        void run(async () => {
            await facade.restoreOrganization(docId);
            await loadOrgs(true);
        });
    }
</script>

<div class="lvct-dialog-root lvct-org-manager">
    <div class="lvct-org-manager__layout">
        <div class="lvct-org-manager__list">
            <b>{text("orgListTitle", "组织")}</b>
            {#if loading}
                <ViewState compact loading title={text("orgLoading", "正在加载组织…")} />
            {:else if orgs.length === 0}
                <p class="ft__smaller ft__on-surface">{text("orgEmpty", "暂无组织。输入名称新建第一个组织。")}</p>
            {:else}
                <ul class="lvct-org-manager__orgs">
                    {#each activeOrgs as org (org.docId)}
                        <li>
                            <button
                                type="button"
                                class="lvct-org-manager__org-item"
                                class:lvct-org-manager__org-item--active={org.docId === currentOrgDocId}
                                onclick={() => selectOrg(org.docId)}
                            >{org.name}<small>（{org.memberships.length}）</small></button>
                        </li>
                    {/each}
                </ul>
                {#if archivedOrgs.length > 0}
                    <button type="button" class="b3-button b3-button--text" onclick={() => (showArchived = !showArchived)}>
                        {showArchived ? text("orgArchivedHide", "收起已归档") : text("orgArchivedShow", "已归档（{n}）", { n: archivedOrgs.length })}
                    </button>
                    {#if showArchived}
                        <ul class="lvct-org-manager__orgs">
                            {#each archivedOrgs as org (org.docId)}
                                <li>
                                    <button
                                        type="button"
                                        class="lvct-org-manager__org-item"
                                        class:lvct-org-manager__org-item--active={org.docId === currentOrgDocId}
                                        onclick={() => selectOrg(org.docId)}
                                    >{org.name}<small>（{text("orgArchivedTag", "已归档")}）</small></button>
                                </li>
                            {/each}
                        </ul>
                    {/if}
                {/if}
            {/if}
            <div class="lvct-org-manager__create">
                <input
                    class="b3-text-field fn__block"
                    placeholder={text("orgCreatePlaceholder", "组织名称…")}
                    bind:value={newOrgName}
                    disabled={busy}
                    aria-label={text("orgCreateLabel", "新组织名称")}
                />
                <button class="b3-button b3-button--text" disabled={busy || !newOrgName.trim()} onclick={createOrg}>
                    {text("orgCreate", "新建组织")}</button>
            </div>
        </div>

        <div class="lvct-org-manager__detail">
            {#if currentOrg}
                <div class="fn__flex" style="align-items: center; gap: 8px;">
                    <b class="fn__flex-1">{currentOrg.name}{currentOrg.archived ? text("orgArchivedTag", "（已归档）") : ""}</b>
                    {#if currentOrg.archived}
                        <button type="button" class="b3-button b3-button--text" disabled={busy}
                            onclick={restoreCurrentOrg}>{text("orgRestore", "恢复组织")}</button>
                    {:else}
                        <button type="button" class="b3-button b3-button--cancel" disabled={busy}
                            onclick={archiveCurrentOrg}>{text("orgArchive", "归档组织")}</button>
                    {/if}
                </div>
                <div class="lvct-org-manager__members">
                    <b>{text("orgMembersTitle", "成员")}</b>
                    {#if members.length === 0}
                        <p class="ft__smaller ft__on-surface">{text("orgMembersEmpty", "暂无成员。从下方添加。")}</p>
                    {:else}
                        <ul class="lvct-org-manager__member-list">
                            {#each members as member (member.id)}
                                <li class="lvct-org-manager__member">
                                    {#if editingMemberId === member.id}
                                        <div class="lvct-org-manager__member-edit">
                                            <label>{text("orgMemberDeptLabel", "部门")}
                                                <input class="b3-text-field fn__block" bind:value={editDepartment} disabled={busy}
                                                    aria-label={text("orgMemberDeptLabel", "部门")} /></label>
                                            <label>{text("orgMemberTitleLabel", "职位")}
                                                <input class="b3-text-field fn__block" bind:value={editTitle} disabled={busy}
                                                    aria-label={text("orgMemberTitleLabel", "职位")} /></label>
                                            <label>{text("orgMemberJoinedLabel", "加入日期")}
                                                <input class="b3-text-field fn__block" type="date" bind:value={editJoinedOn} disabled={busy}
                                                    aria-label={text("orgMemberJoinedLabel", "加入日期")} /></label>
                                            <label>{text("orgMemberLeftLabel", "离开日期")}
                                                <input class="b3-text-field fn__block" type="date" bind:value={editLeftOn} disabled={busy}
                                                    aria-label={text("orgMemberLeftLabel", "离开日期")} /></label>
                                            <label>{text("orgMemberStatusLabel", "状态")}
                                                <select class="b3-select fn__block" bind:value={editStatus} disabled={busy}
                                                    aria-label={text("orgMemberStatusLabel", "状态")}>
                                                    <option value="active">{text("orgStatusActive", "在职/在读")}</option>
                                                    <option value="former">{text("orgStatusFormer", "已离开")}</option>
                                                </select></label>
                                            <div class="fn__flex" style="gap: 8px;">
                                                <button type="button" class="b3-button b3-button--text" disabled={busy}
                                                    onclick={saveEditMember}>{text("orgMemberSave", "保存")}</button>
                                                <button type="button" class="b3-button b3-button--cancel" disabled={busy}
                                                    onclick={cancelEditMember}>{text("orgMemberCancel", "取消")}</button>
                                            </div>
                                        </div>
                                    {:else}
                                        <span>{member.personName}{member.title ? ` · ${member.title}` : ""}{member.department ? `（${member.department}）` : ""}{member.status === "former" ? text("orgFormer", "（已离开）") : ""}</span>
                                        <span class="fn__flex" style="gap: 4px;">
                                            <button type="button" class="b3-button b3-button--text" disabled={busy}
                                                onclick={() => startEditMember(member)}>{text("orgMemberEdit", "编辑")}</button>
                                            <button
                                                type="button"
                                                class="b3-button b3-button--cancel"
                                                disabled={busy}
                                                onclick={() => removeMember(member.id)}
                                            >{text("orgMemberRemove", "移除")}</button>
                                        </span>
                                    {/if}
                                </li>
                            {/each}
                        </ul>
                    {/if}
                    <div class="lvct-org-manager__add">
                        <select class="b3-select fn__block" bind:value={addPersonId} disabled={busy}
                            aria-label={text("orgAddMemberLabel", "选择要添加的联系人")}>
                            <option value="">{text("orgAddMemberPick", "选择联系人…")}</option>
                            {#each addCandidates as person (person.itemId)}
                                <option value={person.docId}>{person.name}</option>
                            {/each}
                        </select>
                        <button class="b3-button b3-button--text" disabled={busy || !addPersonId} onclick={addMember}>
                            {text("orgMemberAdd", "添加成员")}</button>
                    </div>
                </div>
            {:else}
                <p class="ft__smaller ft__on-surface">{text("orgPickHint", "从左侧选择一个组织查看成员。")}</p>
            {/if}
        </div>
    </div>
    {#if errorMessage}<div class="lvct-form__error" role="alert">{errorMessage}</div>{/if}
    <div class="lvct-org-manager__footer">
        <button class="b3-button b3-button--cancel" onclick={onClose}>{text("orgClose", "关闭")}</button>
    </div>
</div>
