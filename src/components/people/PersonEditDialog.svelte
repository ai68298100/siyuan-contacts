<script lang="ts">
    /** 编辑资料：全字段更新（空值清空对应单元格） */
    import { retryContactFields, updateContactFields } from "../../services/contacts";
    import type { ContactWriteReport, WritableContactField } from "../../domain/contact-write.ts";
    import { changedContactWriteFields } from "../../domain/contact-write.ts";
    import type { ContactDraft } from "../../domain/person";
    import type { ContactSummary } from "../../domain/person";
    import type { ContactsSettings } from "../../domain/model";
    import { orgMembershipStatusLabel } from "../../domain/org-membership";
    import type { OrgAffiliationKind, OrgMembership, OrgMembershipPatch, OrgMembershipStatus } from "../../domain/org-membership";
    import type { RelationshipLabelEditorState } from "../../services/people-profiles";
    import { useCloseGuard } from "../close-guard";
    import { translateText } from "../../domain/translation";
    import QuickFillDialog from "./QuickFillDialog.svelte";
    import GroupField from "./GroupField.svelte";
    import BirthdayField from "./BirthdayField.svelte";
    import { ClipboardPaste } from "@lucide/svelte";
    import { onDestroy, onMount, untrack } from "svelte";

    let {
        settings,
        i18n,
        person,
        onLoadRelationshipLabels,
        onSaveRelationshipLabels,
        onLoadOrgMemberships,
        onLoadOrgCandidates,
        onCreateOrganization,
        onAddOrgMembership,
        onUpdateOrgMembership,
        onRemoveOrgMembership,
        hostCloseChannel,
        onSaved,
        onClose,
    }: {
        settings: ContactsSettings;
        i18n?: Readonly<Record<string, string>>;
        person: ContactSummary;
        /** B12：编辑弹窗内可直接补充关系称谓及工作/学校归属。 */
        onLoadRelationshipLabels?: (personDocId: string) => Promise<RelationshipLabelEditorState>;
        onSaveRelationshipLabels?: (personDocId: string, selfDocId: string, labels: string[], expected: import("../../domain/person-relationship-labels").PersonRelationshipLabels | null) => Promise<import("../../domain/person-relationship-labels").PersonRelationshipLabels>;
        onLoadOrgMemberships?: (personDocId: string) => Promise<import("../../services/org").PersonOrgMembershipView[]>;
        onLoadOrgCandidates?: () => Promise<ReadonlyArray<{ docId: string; name: string; archived?: boolean }>>;
        onCreateOrganization?: () => void | Promise<void>;
        onAddOrgMembership?: (personDocId: string, orgDocId: string, extra?: { department?: string; title?: string; joinedOn?: string; leftOn?: string; status?: OrgMembershipStatus; statusLabel?: string; affiliationKind?: OrgAffiliationKind; note?: string }) => Promise<unknown>;
        onUpdateOrgMembership?: (membershipId: string, patch: OrgMembershipPatch, expected?: OrgMembership) => Promise<unknown>;
        onRemoveOrgMembership?: (membershipId: string, expected?: OrgMembership) => Promise<unknown>;
        /** D-40：libs/dialog 注入的宿主关闭通道（X/Esc/遮罩经守卫路由）；缺省保持宿主原行为 */
        hostCloseChannel?: { request?: (close: () => void) => void };
        onSaved: () => void;
        onClose: () => void;
    } = $props();
    const text = $derived.by(() => (key: string, fallback: string, values?: Record<string, string | number>) => translateText(i18n, key, fallback, values));

    // 有意取打开弹窗时的快照（编辑表单不随外部变化）
    // svelte-ignore state_referenced_locally
    let draft: ContactDraft = $state({
        name: person.name,
        phone: person.phone,
        email: person.email,
        wechat: person.wechat,
        website: person.website,
        birthday: person.birthday,
        isLunar: person.isLunar,
        group: person.group,
        tags: [...person.tags],
    });
    // svelte-ignore state_referenced_locally
    let tagsText: string = $state(person.tags.join(" "));
    let running: boolean = $state(false);
    let groupValid = $state(true);
    let errorText: string = $state("");
    let failedFields: WritableContactField[] = $state([]);
    let pending: { draft: ContactDraft; report: ContactWriteReport } | undefined;
    const target = untrack(() => ({ docId: person.docId, itemId: person.itemId }));
    const writeSettings = untrack(() => ({ ...settings, fieldMap: { ...settings.fieldMap } }));
    let alive = true;
    onDestroy(() => { alive = false; });
    const original = JSON.stringify(draft);
    // svelte-ignore state_referenced_locally
    const originalTags = tagsText;
    let saved = $state(false);
    // B12：编辑页面直接填写/选择组织归属与本人称谓。组织归属仍以 membership 为唯一事实源。
    // 资料区在首次挂载时先保持加载态，避免生命周期读取开始前短暂显示未初始化的输入框。
    let profileLoading = $state(true);
    let profileBusy = $state(false);
    let profileError = $state("");
    let profileMessage = $state("");
    let relationshipSnapshot = $state<RelationshipLabelEditorState | null>(null);
    let relationshipDraft = $state("");
    let orgCandidates = $state<ReadonlyArray<{ docId: string; name: string; archived?: boolean }>>([]);
    let orgMemberships = $state<import("../../services/org").PersonOrgMembershipView[]>([]);
    /* 常用入口保留两个轻量选择器；详细经历通过“添加其他组织经历”展开。 */
    let workOrgDocId = $state("");
    let educationOrgDocId = $state("");
    let otherOrgOpen = $state(false);
    let selectedOrgDocId = $state("");
    let selectedOrgKind = $state<OrgAffiliationKind>("unspecified");
    let selectedOrgStatus = $state<OrgMembershipStatus>("active");
    let selectedOrgStatusLabel = $state("");
    let selectedOrgDepartment = $state("");
    let selectedOrgTitle = $state("");
    let selectedOrgJoinedOn = $state("");
    let selectedOrgLeftOn = $state("");
    let selectedOrgNote = $state("");
    let editingMembershipId = $state("");
    let editingMembershipSnapshot = $state<OrgMembership | null>(null);
    let editingOrgDepartment = $state("");
    let editingOrgTitle = $state("");
    let editingOrgJoinedOn = $state("");
    let editingOrgLeftOn = $state("");
    let editingOrgStatus = $state<OrgMembershipStatus>("active");
    let editingOrgStatusLabel = $state("");
    let editingOrgNote = $state("");
    let editingOrgKind = $state<OrgAffiliationKind>("unspecified");
    let creatingOrganization = $state(false);
    function validateEditDraft(value: ContactDraft): string[] {
        const errors: string[] = [];
        if (!value.name.trim()) errors.push("姓名不能为空");
        if (value.email.trim() && !/^\S+@\S+\.\S+$/.test(value.email.trim())) errors.push("邮箱格式不正确");
        if (value.birthday.trim()) {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(value.birthday.trim())) errors.push("生日日期格式不正确");
            else {
                const [year, month, day] = value.birthday.split("-").map(Number);
                const date = new Date(year, month - 1, day);
                if (!value.isLunar && (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day)) errors.push("生日不是有效日期");
            }
        }
        return errors;
    }
    // 使用 .by 形式与编辑器逻辑的无 Svelte 运行时测试夹具保持兼容；
    // 这里的派生值仍会由 Svelte 编译器按依赖追踪更新。
    const profileSupported = $derived.by(() => Boolean(onLoadRelationshipLabels || (onLoadOrgCandidates && onAddOrgMembership)));
    const activeOrgIds = $derived.by(() => new Set(orgMemberships.filter((membership) => membership.status === "active").map((membership) => membership.orgDocId)));
    /* 已有当前归属不再出现在快捷候选中，避免误建重复 current；历史记录仍可在已有经历中编辑。 */
    const availableOrgCandidates = $derived.by(() => orgCandidates.filter((org) => !activeOrgIds.has(org.docId)));
    const quickOrgCandidates = $derived.by(() => availableOrgCandidates.filter((org) => !org.archived));
    const selectedOrgCandidate = $derived.by(() => availableOrgCandidates.find((org) => org.docId === selectedOrgDocId));
    function affiliationLabel(kind: OrgAffiliationKind | undefined): string {
        return kind === "family" ? "家庭" : kind === "work" ? "工作单位" : kind === "education" ? "学校" : "其他组织";
    }
    function changeSelectedOrg(docId: string): void {
        selectedOrgDocId = docId;
        const candidate = availableOrgCandidates.find((org) => org.docId === docId);
        if (candidate?.archived) {
            selectedOrgStatus = "former";
            selectedOrgLeftOn = "";
        }
        if (candidate?.name.trim() === "家庭") selectedOrgKind = "family";
    }
    function changeSelectedOrgStatus(status: OrgMembershipStatus): void {
        selectedOrgStatus = status;
        if (status === "active") selectedOrgLeftOn = "";
    }
    function changeEditingOrgStatus(status: OrgMembershipStatus): void {
        editingOrgStatus = status;
        if (status === "active") editingOrgLeftOn = "";
    }
    const profileDirty = $derived.by(() =>
        Boolean(relationshipSnapshot && onSaveRelationshipLabels && relationshipDraft !== (relationshipSnapshot.record?.labels ?? []).join("、"))
            || Boolean(workOrgDocId || educationOrgDocId || selectedOrgDocId || selectedOrgDepartment || selectedOrgTitle || selectedOrgJoinedOn || selectedOrgLeftOn || selectedOrgStatusLabel || selectedOrgNote || editingMembershipId),
    );
    async function loadProfileEditor(): Promise<void> {
        if (!profileSupported) return;
        profileLoading = true;
        profileError = "";
        try {
            // 本人档案没有“与我的关系”这一条关系事实；跳过该读取，避免
            // verifiedReferences 将 selfDocId === personDocId 判定为非法并阻断组织资料。
            const [memberships, candidates] = await Promise.all([
                onLoadOrgMemberships ? onLoadOrgMemberships(person.docId) : Promise.resolve([]),
                onLoadOrgCandidates ? onLoadOrgCandidates() : Promise.resolve([]),
            ]);
            orgMemberships = memberships;
            orgCandidates = candidates;
            if (!person.isSelf && onLoadRelationshipLabels) {
                const relationship = await onLoadRelationshipLabels(person.docId);
                relationshipSnapshot = relationship;
                relationshipDraft = relationship?.record?.labels.join("、") ?? "";
            } else {
                relationshipSnapshot = null;
                relationshipDraft = "";
            }
        } catch (error) {
            profileError = error instanceof Error ? error.message : String(error);
        } finally { profileLoading = false; }
    }
    /** 新建组织后留在编辑页，并立即刷新候选，避免用户看到过期的“暂无组织”。 */
    async function createOrganizationFromEditor(): Promise<void> {
        if (!onCreateOrganization || creatingOrganization || profileBusy || profileLoading) return;
        creatingOrganization = true;
        profileError = "";
        try {
            await onCreateOrganization();
            await loadProfileEditor();
        } catch (error) {
            profileError = error instanceof Error ? error.message : String(error);
        } finally {
            creatingOrganization = false;
        }
    }
    function membershipSnapshot(membership: import("../../services/org").PersonOrgMembershipView): OrgMembership {
        return { id: membership.id, orgDocId: membership.orgDocId, personDocId: person.docId,
            department: membership.department, title: membership.title, joinedOn: membership.joinedOn,
            leftOn: membership.leftOn, status: membership.status, ...(membership.statusLabel ? { statusLabel: membership.statusLabel } : {}),
            ...(membership.affiliationKind ? { affiliationKind: membership.affiliationKind } : {}),
            ...(membership.note ? { note: membership.note } : {}) };
    }
    function startEditMembership(membership: import("../../services/org").PersonOrgMembershipView): void {
        if (profileBusy || profileLoading) return;
        editingMembershipId = membership.id;
        editingMembershipSnapshot = membershipSnapshot(membership);
        editingOrgDepartment = membership.department;
        editingOrgTitle = membership.title;
        editingOrgJoinedOn = membership.joinedOn;
        editingOrgLeftOn = membership.leftOn;
        editingOrgStatus = membership.archived ? "former" : membership.status;
        editingOrgStatusLabel = membership.statusLabel ?? "";
        editingOrgNote = membership.note ?? "";
        editingOrgKind = membership.affiliationKind ?? "unspecified";
    }
    function cancelEditMembership(): void {
        editingMembershipId = "";
        editingMembershipSnapshot = null;
    }
    async function saveEditMembership(): Promise<void> { await saveProfileEditor(); }
    async function removeMembership(membership: import("../../services/org").PersonOrgMembershipView): Promise<void> {
        if (!onRemoveOrgMembership || profileBusy || profileLoading) return;
        if (!window.confirm(`确定删除「${membership.orgName}」的这段组织经历吗？正常离职或毕业请编辑状态并保留历史。`)) return;
        profileBusy = true;
        profileError = "";
        try {
            await onRemoveOrgMembership(membership.id, membershipSnapshot(membership));
            profileMessage = "组织归属已删除";
            onSaved();
            await loadProfileEditor();
        } catch (error) { profileError = error instanceof Error ? error.message : String(error); }
        finally { profileBusy = false; }
    }
    // 运行时由 Svelte 注入 onMount；控制逻辑单测以无生命周期夹具执行，需安全跳过。
    if (typeof onMount === "function") onMount(() => { if (profileSupported) void loadProfileEditor(); });
    async function saveProfileEditor(): Promise<void> {
        if (profileBusy || profileLoading || !profileDirty) return;
        profileBusy = true;
        profileError = "";
        profileMessage = "";
        try {
            const quickSelections: Array<{ docId: string; kind: OrgAffiliationKind }> = [
                { docId: workOrgDocId, kind: "work" as const },
                { docId: educationOrgDocId, kind: "education" as const },
            ].filter((item) => item.docId);
            /* 所有本次新增的当前归属先统一做冲突核对，避免先写快捷入口
               后才发现详细经历重复，留下部分保存。若正在把原经历改为
               已离开/毕业，则释放该组织的当前名额，允许同次新增新期间。 */
            const reservedActiveOrgIds = new Set(activeOrgIds);
            if (editingMembershipSnapshot?.status === "active" && editingOrgStatus === "former") {
                reservedActiveOrgIds.delete(editingMembershipSnapshot.orgDocId);
            }
            for (const selection of quickSelections) {
                if (reservedActiveOrgIds.has(selection.docId)) throw new Error("该组织已有当前归属，请编辑已有经历；如需补录旧经历，请在已有经历中编辑并保留历史。");
                reservedActiveOrgIds.add(selection.docId);
            }
            if (selectedOrgDocId && selectedOrgStatus === "active" && reservedActiveOrgIds.has(selectedOrgDocId)) {
                throw new Error("该组织已有当前归属，请编辑已有经历；如需补录旧经历，请将状态设为已离开/毕业后添加。");
            }
            if (editingMembershipId && editingMembershipSnapshot && onUpdateOrgMembership) {
                const patch = { department: editingOrgDepartment, title: editingOrgTitle,
                    joinedOn: editingOrgJoinedOn, leftOn: editingOrgLeftOn, status: editingOrgStatus,
                    statusLabel: editingOrgStatusLabel, affiliationKind: editingOrgKind,
                    ...((editingOrgNote.trim() || editingMembershipSnapshot.note !== undefined) ? { note: editingOrgNote } : {}) };
                await onUpdateOrgMembership(editingMembershipId, patch, editingMembershipSnapshot);
                editingMembershipId = "";
                editingMembershipSnapshot = null;
            }
            if (relationshipSnapshot && onSaveRelationshipLabels && onLoadRelationshipLabels && relationshipSnapshot.selfDocId
                && relationshipDraft !== (relationshipSnapshot.record?.labels ?? []).join("、")) {
                const record = await onSaveRelationshipLabels(person.docId, relationshipSnapshot.selfDocId,
                    relationshipDraft.split(/[、,，\n]/).map((label) => label.trim()).filter(Boolean),
                    relationshipSnapshot.record ? { ...relationshipSnapshot.record, labels: [...relationshipSnapshot.record.labels] } : null);
                relationshipSnapshot = { selfDocId: record.selfDocId, record };
                relationshipDraft = record.labels.join("、");
            }
            if (onAddOrgMembership) {
                for (const selection of quickSelections) {
                    await onAddOrgMembership(person.docId, selection.docId, { affiliationKind: selection.kind, status: "active" });
                }
                workOrgDocId = "";
                educationOrgDocId = "";
            }
            if (selectedOrgDocId && onAddOrgMembership) {
                await onAddOrgMembership(person.docId, selectedOrgDocId, {
                    affiliationKind: selectedOrgKind,
                    status: selectedOrgStatus,
                    statusLabel: selectedOrgStatusLabel.trim(),
                    department: selectedOrgDepartment.trim(), title: selectedOrgTitle.trim(),
                    joinedOn: selectedOrgJoinedOn, leftOn: selectedOrgLeftOn,
                    note: selectedOrgNote.trim(),
                });
                selectedOrgDocId = "";
                selectedOrgKind = "unspecified";
                selectedOrgStatus = "active";
                selectedOrgStatusLabel = "";
                selectedOrgDepartment = "";
                selectedOrgTitle = "";
                selectedOrgJoinedOn = "";
                selectedOrgLeftOn = "";
                selectedOrgNote = "";
            }
            profileMessage = "组织经历或关系称谓已保存";
            onSaved();
        } catch (error) {
            profileError = error instanceof Error ? error.message : String(error);
        } finally {
            profileBusy = false;
            if (!profileError) await loadProfileEditor();
        }
    }
    // FAST-01.1：粘贴并识别（识别结果经勾选后回填草稿，不直接写库）
    let quickFillOpen = $state(false);
    function applyQuickFill(patch: {
        name?: string; phone?: string; email?: string; wechat?: string;
        website?: string; birthday?: string; isLunar?: boolean; group?: string;
        tagsAppend: string[];
    }) {
        if (patch.name !== undefined) draft.name = patch.name;
        if (patch.phone !== undefined) draft.phone = patch.phone;
        if (patch.email !== undefined) draft.email = patch.email;
        if (patch.wechat !== undefined) draft.wechat = patch.wechat;
        if (patch.website !== undefined) draft.website = patch.website;
        if (patch.birthday !== undefined) draft.birthday = patch.birthday;
        if (patch.isLunar !== undefined) draft.isLunar = patch.isLunar;
        if (patch.group !== undefined) draft.group = patch.group;
        if (patch.tagsAppend.length) {
            const tags = tagsText.split(/[，,、\s]+/).map((tag) => tag.trim()).filter(Boolean);
            for (const tag of patch.tagsAppend) if (!tags.includes(tag)) tags.push(tag);
            tagsText = tags.join(" ");
        }
    }
    // B06：字段级改动明细 + 「保存并离开」（persist 抛错则留在原地）
    async function persist(retrying = false): Promise<void> {
        if (!alive) throw new Error("编辑窗口已关闭，未发送新写入");
        if (!groupValid) throw new Error(text("groupCustomEmpty", "请输入分组名称。"));
        const tags = tagsText.split(/[，,、\s]+/).map((tag) => tag.trim()).filter((tag) => tag.length > 0);
        const next = { ...draft, tags };
        const validationErrors = validateEditDraft(next);
        if (validationErrors.length > 0) throw new Error(validationErrors.join("；"));
        const changed = pending ? changedContactWriteFields(pending.draft, next) : [];
        if (pending && changed.length > 0 && (retrying || pending.report.unknown.length > 0)) {
            throw new Error("草稿与原请求不同；未知字段请先恢复原输入并核实，明确失败后修改输入请使用保存");
        }
        const fields = pending?.report.unresolved.map((failure) => failure.field);
        const report = pending && changed.length === 0
            ? await retryContactFields(writeSettings, target.itemId, pending.draft, fields!, target, () => alive)
            : await updateContactFields(writeSettings, target.itemId, next, {
                expected: target, canWrite: () => alive,
                ...(pending ? { onlyFields: [...new Set([...fields!, ...changed])] } : {}),
            });
        if (!alive) return;
        pending = { draft: { ...next, tags: [...tags] }, report };
        failedFields = report.unresolved.map((failure) => failure.field);
        if (!report.complete) {
            throw new Error(`字段尚未完成：${report.unresolved.map((failure) => `${failure.label}（${failure.message}）`).join("、")}；已核实字段保留，请核实并重试未完成字段`);
        }
        saved = true;
        onSaved();
    }

    async function retryFailed(): Promise<void> {
        if (running || failedFields.length === 0) return;
        running = true;
        errorText = "";
        try {
            await persist(true);
            if (alive) onClose();
        } catch (error) {
            if (alive) errorText = error instanceof Error ? error.message : String(error);
        } finally {
            running = false;
        }
    }
    function draftChanges(): string[] {
        if (saved) return [];
        const changes: string[] = [];
        const empty = text("guardEmpty", "（空）");
        const fields = [
            [text("formName", "姓名"), "name"], [text("formPhone", "电话"), "phone"],
            [text("formEmail", "邮箱"), "email"], [text("formWechat", "微信"), "wechat"],
            [text("formWebsite", "网站"), "website"], [text("formBirthday", "生日"), "birthday"],
        ] as const;
        for (const [label, key] of fields) {
            if (draft[key] !== person[key]) {
                changes.push(text("guardFieldChange", "{field}：{from} → {to}", { field: label, from: String(person[key]) || empty, to: String(draft[key]) || empty }));
            }
        }
        if (draft.isLunar !== person.isLunar) {
            changes.push(text("guardFieldChange", "{field}：{from} → {to}", { field: text("formLunar", "农历生日"), from: person.isLunar ? "✓" : empty, to: draft.isLunar ? "✓" : empty }));
        }
        if (draft.group !== person.group) {
            changes.push(text("guardFieldChange", "{field}：{from} → {to}", { field: text("formGroup", "分组"), from: person.group || empty, to: draft.group || empty }));
        }
        if (tagsText !== originalTags) {
            changes.push(text("guardTagsChange", "标签：{from} → {to}", { from: originalTags || empty, to: tagsText || empty }));
        }
        return changes;
    }
    const profileChanges = (): string[] => profileDirty ? ["工作单位、学校或与我的关系有未保存修改"] : [];
    const baseDraftDirty = (): boolean => !saved && (JSON.stringify(draft) !== original || tagsText !== originalTags);
    async function persistAll(): Promise<void> {
        if (baseDraftDirty()) await persist();
        if (profileDirty) {
            await saveProfileEditor();
            if (profileError) throw new Error(profileError);
        }
    }
    const guardedClose = useCloseGuard({
        busy: () => running || profileBusy || profileLoading || creatingOrganization,
        dirty: () => baseDraftDirty() || profileDirty,
        changes: () => [...draftChanges(), ...profileChanges()],
        save: persistAll,
    });
    /* D-40：宿主 X/Esc/遮罩经同一守卫路由（返回 Promise 供拦截层重入门） */
    // svelte-ignore state_referenced_locally
    if (hostCloseChannel) hostCloseChannel.request = (close) => guardedClose(close);

    /* D-35：错误出现时焦点迁入错误块 */
    let errorEl: HTMLElement | undefined = $state();
    function focusError(): void {
        queueMicrotask(() => errorEl?.focus());
    }

    async function submit() {
        if (running) return;
        running = true;
        errorText = "";
        try {
            await persistAll();
            if (alive) onClose();
        } catch (error) {
            if (alive) errorText = error instanceof Error ? error.message : String(error);
            if (alive) focusError();
        } finally {
            running = false;
        }
    }
</script>

<div class="lvct-form">
    <div class="lvct-form__toolbar">
        <button type="button" class="b3-button b3-button--text lvct-form__toolbar-btn" onclick={() => (quickFillOpen = true)} disabled={running}>
            <ClipboardPaste size={14}/>{text("qfOpen", "粘贴并识别")}
        </button>
    </div>
    {#if profileSupported}
        <section class="lvct-detail__section lvct-person-edit__profile" aria-labelledby="lvct-person-edit-profile-title">
            <div class="lvct-detail__section-head">
                <div>
                    <h4 id="lvct-person-edit-profile-title">{person.isSelf ? "工作单位与学校" : "工作单位、学校与我的关系"}</h4>
                    <p class="ft__smaller ft__on-surface">{person.isSelf
        ? "可添加多个家庭、工作单位、学校或其他组织；离职、毕业和自定义状态都会保留历史。"
        : "可直接填写关系称谓，也可添加多个家庭、工作单位、学校或其他组织；每段经历独立保存。"}</p>
                </div>
            </div>
            {#if profileLoading}
                <p role="status">正在读取可编辑资料…</p>
            {:else}
                {#if !person.isSelf && onLoadRelationshipLabels && onSaveRelationshipLabels}
                    <label class="lvct-form__item">
                        <span>与我的关系（多个称谓用顿号分隔）</span>
                        <input class="b3-text-field fn__block" type="text" maxlength="1600" bind:value={relationshipDraft} disabled={profileBusy} placeholder="例如：同事、朋友" />
                    </label>
                {/if}
                {#if onLoadOrgCandidates && onAddOrgMembership}
                    <div class="lvct-form__grid">
                        <label class="lvct-form__item"><span>工作单位</span><select class="b3-select fn__block" bind:value={workOrgDocId} disabled={profileBusy || quickOrgCandidates.length === 0}><option value="">选择组织…</option>{#each quickOrgCandidates as org (org.docId)}<option value={org.docId}>{org.name}</option>{/each}</select></label>
                        <label class="lvct-form__item"><span>学校</span><select class="b3-select fn__block" bind:value={educationOrgDocId} disabled={profileBusy || quickOrgCandidates.length === 0}><option value="">选择组织…</option>{#each quickOrgCandidates as org (org.docId)}<option value={org.docId}>{org.name}</option>{/each}</select></label>
                    </div>
                    <button type="button" class="b3-button b3-button--text" aria-expanded={otherOrgOpen} onclick={() => (otherOrgOpen = !otherOrgOpen)} disabled={profileBusy}>{otherOrgOpen ? "收起详细组织经历" : "添加其他组织经历（可选）"}</button>
                    {#if orgMemberships.length > 0}
                        <div class="lvct-person-edit__org-list">
                            <h5>已有组织经历</h5>
                            {#each orgMemberships as membership (membership.id)}
                                <div class="lvct-person-edit__org-item">
                                    <div class="fn__flex-1">
                                        <strong>{membership.orgName}</strong>
                                        <span class="ft__smaller ft__on-surface"> · {affiliationLabel(membership.affiliationKind ?? (membership.orgName === "家庭" ? "family" : undefined))}</span>
                                        <span class="lvct-chip {membership.status === "former" ? "lvct-bucket--stale" : "lvct-bucket--today"}">{orgMembershipStatusLabel({ ...membership, affiliationKind: membership.affiliationKind ?? (membership.orgName === "家庭" ? "family" : undefined) })}</span>
                                        {#if membership.archived}<span class="lvct-chip lvct-bucket--stale">组织已归档</span>{/if}
                                        {#if membership.reachable === false}<span class="lvct-chip lvct-bucket--stale">组织待核实</span>{/if}
                                        {#if membership.department}<span class="ft__smaller"> · {membership.department}</span>{/if}
                                        {#if membership.title}<span class="ft__smaller"> · {membership.title}</span>{/if}
                                        {#if membership.joinedOn || membership.leftOn}<span class="ft__smaller ft__on-surface"> · {membership.joinedOn || "未知"} – {membership.leftOn || "至今"}</span>{/if}
                                        {#if membership.note}<span class="ft__smaller ft__on-surface" title={membership.note}> · {membership.note}</span>{/if}
                                    </div>
                                    {#if onUpdateOrgMembership}<button type="button" class="b3-button b3-button--text" onclick={() => startEditMembership(membership)} disabled={profileBusy || profileLoading}>编辑</button>{/if}
                                    {#if onRemoveOrgMembership}<button type="button" class="b3-button b3-button--cancel" onclick={() => void removeMembership(membership)} disabled={profileBusy || profileLoading}>删除</button>{/if}
                                </div>
                                {#if editingMembershipId === membership.id}
                                    <div class="lvct-form__grid lvct-person-edit__org-edit">
                                        <label class="lvct-form__item"><span>归属分类</span><select class="b3-select fn__block" bind:value={editingOrgKind} disabled={profileBusy}><option value="family">家庭</option><option value="unspecified">其他组织</option><option value="work">工作单位</option><option value="education">学校</option></select></label>
                                        <label class="lvct-form__item"><span>当前状态</span><select class="b3-select fn__block" value={editingOrgStatus} onchange={(event) => changeEditingOrgStatus(event.currentTarget.value as OrgMembershipStatus)} disabled={profileBusy}><option value="active" disabled={membership.archived}>当前在职/就读</option><option value="former">已离开/毕业</option></select></label>
                                        <label class="lvct-form__item"><span>自定义状态</span><input class="b3-text-field fn__block" maxlength="40" bind:value={editingOrgStatusLabel} disabled={profileBusy} placeholder="例如：实习、兼职、休学" /></label>
                                        <label class="lvct-form__item"><span>{text("orgMemberNote", "成员备注")}</span><input class="b3-text-field fn__block" maxlength="240" bind:value={editingOrgNote} disabled={profileBusy} placeholder={text("orgMemberNotePlaceholder", "仅记录这段组织经历")} /></label>
                                        <label class="lvct-form__item"><span>部门/院系</span><input class="b3-text-field fn__block" bind:value={editingOrgDepartment} disabled={profileBusy} /></label>
                                        <label class="lvct-form__item"><span>职位/身份</span><input class="b3-text-field fn__block" bind:value={editingOrgTitle} disabled={profileBusy} /></label>
                                        <label class="lvct-form__item"><span>开始日期</span><input class="b3-text-field fn__block" type="date" bind:value={editingOrgJoinedOn} disabled={profileBusy} /></label>
                                        <label class="lvct-form__item"><span>结束日期</span><input class="b3-text-field fn__block" type="date" bind:value={editingOrgLeftOn} disabled={profileBusy || editingOrgStatus === "active"} /></label>
                                        <div class="lvct-form__actions"><button type="button" class="b3-button b3-button--text" onclick={() => void saveEditMembership()} disabled={profileBusy}>保存</button><button type="button" class="b3-button b3-button--cancel" onclick={cancelEditMembership} disabled={profileBusy}>取消</button></div>
                                    </div>
                                {/if}
                            {/each}
                        </div>
                    {/if}
                    {#if otherOrgOpen}
                    <div class="lvct-form__grid">
                        <label class="lvct-form__item"><span>新增组织</span><select class="b3-select fn__block" value={selectedOrgDocId} onchange={(event) => changeSelectedOrg(event.currentTarget.value)} disabled={profileBusy || availableOrgCandidates.length === 0}><option value="">选择组织…</option>{#each availableOrgCandidates as org (org.docId)}<option value={org.docId}>{org.name}{org.archived ? "（已归档，仅补录历史）" : ""}</option>{/each}</select></label>
                        <label class="lvct-form__item"><span>归属分类</span><select class="b3-select fn__block" bind:value={selectedOrgKind} disabled={profileBusy || !selectedOrgDocId}><option value="family">家庭</option><option value="unspecified">其他组织</option><option value="work">工作单位</option><option value="education">学校</option></select></label>
                        <label class="lvct-form__item"><span>当前状态</span><select class="b3-select fn__block" value={selectedOrgStatus} onchange={(event) => changeSelectedOrgStatus(event.currentTarget.value as OrgMembershipStatus)} disabled={profileBusy || !selectedOrgDocId}><option value="active" disabled={Boolean(selectedOrgCandidate?.archived)}>当前在职/就读</option><option value="former">已离开/毕业</option></select></label>
                        <label class="lvct-form__item"><span>自定义状态</span><input class="b3-text-field fn__block" maxlength="40" bind:value={selectedOrgStatusLabel} disabled={profileBusy || !selectedOrgDocId} placeholder="例如：实习、兼职、休学" /></label>
                        <label class="lvct-form__item"><span>部门/院系</span><input class="b3-text-field fn__block" bind:value={selectedOrgDepartment} disabled={profileBusy || !selectedOrgDocId} /></label>
                        <label class="lvct-form__item"><span>职位/身份</span><input class="b3-text-field fn__block" bind:value={selectedOrgTitle} disabled={profileBusy || !selectedOrgDocId} /></label>
                        <label class="lvct-form__item"><span>开始日期</span><input class="b3-text-field fn__block" type="date" bind:value={selectedOrgJoinedOn} disabled={profileBusy || !selectedOrgDocId} /></label>
                        <label class="lvct-form__item"><span>结束日期</span><input class="b3-text-field fn__block" type="date" bind:value={selectedOrgLeftOn} disabled={profileBusy || !selectedOrgDocId || selectedOrgStatus === "active"} /></label>
                        <label class="lvct-form__item"><span>{text("orgMemberNote", "成员备注")}</span><input class="b3-text-field fn__block" maxlength="240" bind:value={selectedOrgNote} disabled={profileBusy || !selectedOrgDocId} placeholder={text("orgMemberNotePlaceholder", "仅记录这段组织经历")} /></label>
                    </div>
                    {#if selectedOrgCandidate?.archived}<p class="ft__smaller ft__on-surface">组织已归档，只能登记为历史经历；恢复组织后才可新增当前归属。</p>{/if}
                    {/if}
                    {#if availableOrgCandidates.length === 0}
                        <p class="ft__smaller ft__on-surface">暂无可选择的活跃组织；可先新建组织。已有组织经历可逐条编辑，历史不会被覆盖。</p>
                        {#if onCreateOrganization}<button type="button" class="b3-button b3-button--outline" onclick={() => void createOrganizationFromEditor()} disabled={profileBusy || profileLoading || creatingOrganization}>{creatingOrganization ? "组织创建中…" : text("orgCreateFirst", "新建组织")}</button>{/if}
                    {/if}
                {/if}
                {#if profileError}
                    <p class="lvct-form__error" role="alert">{profileError}</p>
                    <button type="button" class="b3-button b3-button--outline" onclick={() => void loadProfileEditor()} disabled={profileBusy || profileLoading}>
                        {profileLoading ? "重新读取中…" : "重新读取资料"}
                    </button>
                {/if}
                {#if profileMessage}<p role="status">{profileMessage}</p>{/if}
                <button type="button" class="b3-button b3-button--outline" onclick={() => void saveProfileEditor()} disabled={profileBusy || !profileDirty}>
                    {profileBusy ? "保存资料中…" : "保存这些资料"}
                </button>
            {/if}
        </section>
    {/if}
    <div class="lvct-form__grid">
        <label class="lvct-form__item">
            <span>{text("formPhone", "电话")}</span>
            <input class="b3-text-field fn__block" type="tel" bind:value={draft.phone} disabled={running} />
        </label>
        <label class="lvct-form__item">
            <span>{text("formWechat", "微信")}</span>
            <input class="b3-text-field fn__block" type="text" bind:value={draft.wechat} disabled={running} />
        </label>
        <label class="lvct-form__item">
            <span>{text("formEmail", "邮箱")}</span>
            <input class="b3-text-field fn__block" type="email" bind:value={draft.email} disabled={running} />
        </label>
        <label class="lvct-form__item">
            <span>{text("formWebsite", "网站")}</span>
            <input class="b3-text-field fn__block" type="url" bind:value={draft.website} disabled={running} />
        </label>
        <div class="lvct-form__item">
            <span>{text("formBirthday", "生日")}</span>
            <BirthdayField label={text("formBirthday", "生日")} value={draft.birthday} isLunar={draft.isLunar} disabled={running} onValueChange={(value) => (draft.birthday = value)} onModeChange={(isLunar) => (draft.isLunar = isLunar)} />
        </div>
        <GroupField {i18n} value={draft.group} onValueChange={(value) => (draft.group = value)} onValidityChange={(valid) => (groupValid = valid)} label={text("formGroup", "分组")} ungroupedLabel={text("formUngrouped", "未分组")} disabled={running} />
        <label class="lvct-form__item">
            <span>{text("formTagsLabel", "标签（空格/逗号分隔）")}</span>
            <input class="b3-text-field fn__block" type="text" bind:value={tagsText} disabled={running} />
        </label>
    </div>

    {#if errorText}
        <!-- D-35：读屏即时播报 + 焦点迁移 -->
        <div class="lvct-form__error" role="alert" tabindex="-1" bind:this={errorEl}>{errorText}</div>
    {/if}

    <div class="lvct-form__actions">
        <button class="b3-button b3-button--cancel" onclick={() => guardedClose(onClose)} disabled={running}>{text("formCancel", "取消")}</button>
        {#if failedFields.length > 0}
            <button class="b3-button b3-button--outline" onclick={retryFailed} disabled={running || !groupValid}>{text("formRetryFailed", "核实并重试未完成字段")}</button>
        {/if}
        <button class="b3-button b3-button--text" onclick={submit} disabled={running || !groupValid}>
            {running ? text("formSaving", "保存中…") : text("formSave", "保存")}
        </button>
    </div>
    <p class="ft__smaller ft__on-surface lvct-form__hint">{text("formEditHint", "留空即清空对应字段；姓名在思源里改文档名即可。")}</p>
</div>

{#if quickFillOpen}
    <QuickFillDialog
        {i18n}
        existing={{ name: draft.name, phone: draft.phone, email: draft.email, wechat: draft.wechat, website: draft.website, birthday: draft.birthday, isLunar: draft.isLunar, group: draft.group, tags: tagsText.split(/[，,、\s]+/).filter(Boolean) }}
        onApply={applyQuickFill}
        onClose={() => (quickFillOpen = false)}
    />
{/if}
