<script lang="ts">
    /** 组织资料编辑器原型：可嵌入新建/编辑组织页面。保存由宿主通过 onSave 接入，组件不直接写入内核。 */
    import { Plus, Trash2, Upload, X } from "@lucide/svelte";
    import { onDestroy, tick } from "svelte";
    import type { OrganizationProfileDraft, OrganizationDepartment, OrganizationCustomField } from "../../domain/organization-profile";
    import { emptyOrganizationProfileDraft, ORGANIZATION_TEMPLATES, organizationTemplateDraft, validateOrganizationProfile } from "../../domain/organization-profile";
    import { useCloseGuard } from "../close-guard";
    import { requestErrorMessage } from "../../shared/error-presenter";

    const PRESETS = ORGANIZATION_TEMPLATES.map((item) => ({
        id: item.key,
        label: item.label,
        description: item.draft.description || "可从这里开始建立组织档案",
        icon: item.key === "family" ? "⌂" : item.key === "company" ? "职" : item.key === "community" ? "群" : "学",
    }));

    const createId = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
    const department = (name = "", parentId: string | null = null, description = ""): OrganizationDepartment => ({ id: createId("dept"), name, parentId, description });
    const customField = (label = "", value = ""): OrganizationCustomField => ({ id: createId("field"), label, value });

    let {
        initial = {},
        mode = "create",
        saving = false,
        error = "",
        readOnly = false,
        onRetry,
        onSave,
        onCancel,
    }: {
        initial?: Partial<OrganizationProfileDraft>;
        mode?: "create" | "edit";
        saving?: boolean;
        error?: string;
        /** 初始资料未核实前只允许重新读取，避免用回退草稿覆盖未知字段。 */
        readOnly?: boolean;
        onRetry?: () => void;
        onSave: (draft: OrganizationProfileDraft) => void | Promise<void>;
        onCancel?: () => void;
    } = $props();

    // 组织编辑器把 initial 作为打开时的草稿快照；保存期间不随父层异步回读覆盖用户输入。
    // svelte-ignore state_referenced_locally
    let draft = $state<OrganizationProfileDraft>({ ...emptyOrganizationProfileDraft(), ...initial,
        departments: initial.departments?.map((item) => ({ ...item })) ?? [],
        customFields: initial.customFields?.map((item) => ({ ...item })) ?? [],
    });
    const initialSnapshot = JSON.stringify(draft);
    let selectedPreset = $state("");
    let validationError = $state("");
    let validationErrorField = $state<"name" | "qccUrl" | "logoUrl" | null>(null);
    let logoError = $state("");
    let logoPreviewError = $state("");
    let logoReading = $state(false);
    let logoInput: HTMLInputElement | undefined = $state();
    let nameInput: HTMLInputElement | undefined = $state();
    let qccUrlInput: HTMLInputElement | undefined = $state();
    let logoUrlInput: HTMLInputElement | undefined = $state();
    let validationSummary: HTMLElement | undefined = $state();
    type PendingDepartmentDelete = {
        department: OrganizationDepartment;
        index: number;
        childParentIds: Record<string, string | null>;
    };
    type RemovedDepartment = PendingDepartmentDelete & { childCount: number };
    type RemovedCustomField = { field: OrganizationCustomField; index: number };
    let pendingDepartmentDelete = $state<PendingDepartmentDelete | null>(null);
    let departmentDeletePanel: HTMLElement | undefined = $state();
    let removedDepartments = $state<RemovedDepartment[]>([]);
    let removedCustomFields = $state<RemovedCustomField[]>([]);
    let editNotice = $state("");
    let pendingPresetId = $state("");
    let presetPreviewPanel: HTMLElement | undefined = $state();
    let logoReadRequest = 0;
    // 弹窗关闭后让尚未完成的本地文件读取失效，避免迟到结果回填旧草稿。
    onDestroy(() => { logoReadRequest += 1; });

    $effect(() => {
        /* 输入新的 URL 或重新上传后，允许预览重新尝试加载。 */
        draft.logoUrl;
        draft.logoDataUrl;
        logoPreviewError = "";
    });

    function isDraftBlank(): boolean {
        return !draft.name.trim() && !draft.shortName.trim() && !draft.qccUrl.trim() && !draft.logoUrl.trim()
            && !draft.logoDataUrl.trim() && !draft.description.trim()
            && draft.departments.length === 0 && draft.customFields.length === 0;
    }

    function cloneTemplateList<T extends OrganizationDepartment | OrganizationCustomField>(items: readonly T[]): T[] {
        return items.map((item) => ({ ...item, id: createId("parentId" in item ? "dept" : "field") })) as T[];
    }

    function templateSummary(id: string): string {
        if (!id) return "";
        const template = organizationTemplateDraft(id as import("../../domain/organization-profile").OrganizationTemplateKey);
        const suggestedDepartments = template.departments.length > 0
            ? template.departments.map((item) => item.name).filter(Boolean)
            : id === "family" ? ["核心家庭", "亲属"]
                : ["primary-school", "middle-school", "high-school", "university"].includes(id) ? ["同学", "教师"]
                    : id === "company" ? ["管理层", "业务部门"] : [];
        const fields = [
            template.name && `名称“${template.name}”`,
            template.shortName && `简称“${template.shortName}”`,
            template.description && "组织介绍",
            suggestedDepartments.length > 0 && `${suggestedDepartments.length} 个部门建议（${suggestedDepartments.join("、")}）`,
            template.customFields.length > 0 && `${template.customFields.length} 个自定义字段建议`,
        ].filter(Boolean);
        return fields.join("、") || "当前模板暂无预填内容";
    }

    function applyPresetValues(id: string, strategy: "blank" | "fill" | "overwrite"): void {
        const preset = PRESETS.find((item) => item.id === id);
        if (!preset) return;
        const template = organizationTemplateDraft(id as import("../../domain/organization-profile").OrganizationTemplateKey);
        const canApply = (value: string) => strategy === "overwrite" || !value.trim();
        if (strategy === "overwrite" || !draft.name.trim()) draft.name = template.name || preset.label;
        if (canApply(draft.shortName) && template.shortName) draft.shortName = template.shortName;
        if (canApply(draft.qccUrl) && template.qccUrl) draft.qccUrl = template.qccUrl;
        if (canApply(draft.logoUrl) && template.logoUrl) draft.logoUrl = template.logoUrl;
        if (canApply(draft.logoDataUrl) && template.logoDataUrl) draft.logoDataUrl = template.logoDataUrl;
        if (canApply(draft.description) && template.description) draft.description = template.description;
        if ((strategy === "overwrite" || draft.departments.length === 0) && template.departments.length > 0) {
            draft.departments = cloneTemplateList(template.departments);
        }
        if ((strategy === "overwrite" || draft.customFields.length === 0) && template.customFields.length > 0) {
            draft.customFields = cloneTemplateList(template.customFields);
        }
        // 兼容现有内置建议：这些部门并非持久化模板字段，只在空列表时提供起点。
        if ((strategy === "overwrite" || draft.departments.length === 0) && template.departments.length === 0) {
            if (id === "family") draft.departments = [department("核心家庭"), department("亲属")];
            if (["primary-school", "middle-school", "high-school", "university"].includes(id)) draft.departments = [department("同学"), department("教师")];
            if (id === "company") draft.departments = [department("管理层"), department("业务部门")];
        }
        selectedPreset = id;
        pendingPresetId = "";
        editNotice = strategy === "overwrite" ? `已应用“${preset.label}”模板字段，仍可继续修改。` : `已应用“${preset.label}”模板的空白字段。`;
    }

    async function applyPreset(id: string): Promise<void> {
        if (isDraftBlank()) {
            applyPresetValues(id, "blank");
            return;
        }
        pendingPresetId = id;
        await tick();
        presetPreviewPanel?.focus();
    }

    function cancelPresetPreview(): void { pendingPresetId = ""; }
    function onPresetPreviewKeydown(event: KeyboardEvent): void {
        if (event.key === "Escape") { event.preventDefault(); cancelPresetPreview(); }
    }

    function addDepartment(): void { draft.departments = [...draft.departments, department()]; }
    async function requestRemoveDepartment(id: string): Promise<void> {
        if (saving || readOnly) return;
        const index = draft.departments.findIndex((item) => item.id === id);
        const target = draft.departments[index];
        if (!target) return;
        const childParentIds = Object.fromEntries(draft.departments.filter((item) => item.parentId === id).map((item) => [item.id, item.parentId])) as Record<string, string | null>;
        pendingDepartmentDelete = { department: { ...target }, index, childParentIds };
        await tick();
        departmentDeletePanel?.focus();
    }
    function cancelDepartmentDelete(): void { pendingDepartmentDelete = null; }
    function onDepartmentDeleteKeydown(event: KeyboardEvent): void {
        if (event.key === "Escape") { event.preventDefault(); cancelDepartmentDelete(); }
    }
    function confirmDepartmentDelete(): void {
        const pending = pendingDepartmentDelete;
        if (!pending || saving || readOnly) return;
        const childCount = Object.keys(pending.childParentIds).length;
        draft.departments = draft.departments.filter((item) => item.id !== pending.department.id).map((item) => item.parentId === pending.department.id ? { ...item, parentId: null } : item);
        removedDepartments = [...removedDepartments, { ...pending, childCount }];
        pendingDepartmentDelete = null;
        editNotice = childCount > 0
            ? `已删除部门“${pending.department.name || "未命名部门"}”，${childCount} 个下级部门已保留并解除上级归属。`
            : `已删除部门“${pending.department.name || "未命名部门"}”，保存前仍可撤销。`;
    }
    function undoDepartmentDelete(index: number): void {
        const removed = removedDepartments[index];
        if (!removed || draft.departments.some((item) => item.id === removed.department.id)) return;
        const insertAt = Math.max(0, Math.min(removed.index, draft.departments.length));
        const restored = { ...removed.department };
        draft.departments = [...draft.departments.slice(0, insertAt), restored, ...draft.departments.slice(insertAt)].map((item) => {
            const originalParent = removed.childParentIds[item.id];
            return originalParent !== undefined && item.parentId === null ? { ...item, parentId: originalParent } : item;
        });
        removedDepartments = removedDepartments.filter((_, itemIndex) => itemIndex !== index);
        editNotice = `已撤销删除部门“${restored.name || "未命名部门"}”。`;
    }
    function addCustomField(): void { draft.customFields = [...draft.customFields, customField()]; }
    function removeCustomField(id: string): void {
        if (saving || readOnly) return;
        const index = draft.customFields.findIndex((item) => item.id === id);
        const field = draft.customFields[index];
        if (!field) return;
        draft.customFields = draft.customFields.filter((item) => item.id !== id);
        removedCustomFields = [...removedCustomFields, { field: { ...field }, index }];
        editNotice = `已删除字段“${field.label || "未命名字段"}”，保存前仍可撤销。`;
    }
    function undoCustomField(index: number): void {
        const removed = removedCustomFields[index];
        if (!removed || draft.customFields.some((item) => item.id === removed.field.id)) return;
        const insertAt = Math.max(0, Math.min(removed.index, draft.customFields.length));
        draft.customFields = [...draft.customFields.slice(0, insertAt), { ...removed.field }, ...draft.customFields.slice(insertAt)];
        removedCustomFields = removedCustomFields.filter((_, itemIndex) => itemIndex !== index);
        editNotice = `已撤销删除字段“${removed.field.label || "未命名字段"}”。`;
    }

    function handleLogoFile(event: Event): void {
        const target = event.currentTarget;
        if (!(target instanceof HTMLInputElement) || !target.files?.[0]) return;
        const file = target.files[0];
        const request = ++logoReadRequest;
        logoError = "";
        logoReading = false;
        if (!file.type.startsWith("image/")) { logoError = "请选择图片文件"; target.value = ""; return; }
        if (file.size > 2 * 1024 * 1024) { logoError = "图片不能超过 2 MB"; target.value = ""; return; }
        logoReading = true;
        const reader = new FileReader();
        reader.onload = () => {
            if (request !== logoReadRequest) return;
            logoReading = false;
            draft.logoDataUrl = typeof reader.result === "string" ? reader.result : "";
            if (logoInput) logoInput.value = "";
        };
        reader.onerror = () => {
            if (request !== logoReadRequest) return;
            logoReading = false;
            logoError = "图片读取失败，请重试";
            if (logoInput) logoInput.value = "";
        };
        reader.readAsDataURL(file);
    }
    function clearLogo(): void {
        // 让尚未完成的 FileReader 结果失效，避免点击“移除”后旧文件又回填。
        logoReadRequest += 1;
        logoReading = false;
        logoError = "";
        draft.logoUrl = "";
        draft.logoDataUrl = "";
        if (logoInput) logoInput.value = "";
    }
    function handleLogoPreviewError(): void {
        logoPreviewError = "Logo 暂时无法加载，保存后仍会保留链接。";
    }
    function logoPreview(): string { return draft.logoDataUrl || draft.logoUrl; }
    async function showFieldError(field: "name" | "qccUrl" | "logoUrl", message: string): Promise<void> {
        validationError = message;
        validationErrorField = field;
        await tick();
        ({ name: nameInput, qccUrl: qccUrlInput, logoUrl: logoUrlInput })[field]?.focus();
    }
    async function showSummaryError(message: string): Promise<void> {
        validationError = message;
        validationErrorField = null;
        await tick();
        validationSummary?.focus();
    }
    function clearFieldError(field: "name" | "qccUrl" | "logoUrl"): void {
        if (validationErrorField !== field) return;
        validationError = "";
        validationErrorField = null;
    }
    function validUrl(value: string): boolean {
        if (!value.trim()) return true;
        try { const url = new URL(value); return url.protocol === "https:" || url.protocol === "http:"; } catch { return false; }
    }
    async function submit(): Promise<void> {
        if (saving || readOnly) return;
        validationError = "";
        validationErrorField = null;
        if (logoReading) {
            await showSummaryError("Logo 正在读取，请稍候再保存");
            return;
        }
        const name = draft.name.trim();
        if (!name) { await showFieldError("name", "组织名称为必填项"); return; }
        if (name.length > 80) { await showFieldError("name", "组织名称不能超过 80 个字符"); return; }
        if (!validUrl(draft.qccUrl)) { await showFieldError("qccUrl", "企查查链接格式不正确，请填写 http(s) 地址"); return; }
        if (!validUrl(draft.logoUrl)) { await showFieldError("logoUrl", "Logo 链接格式不正确，请填写 http(s) 地址"); return; }
        if (draft.departments.some((item) => !item.name.trim() && (item.description.trim() || item.parentId?.trim()
            || draft.departments.some((child) => child.parentId === item.id && (child.name.trim() || child.description.trim()))))) {
            await showSummaryError("已有内容或下级部门的部门必须填写名称，请补全后再保存");
            return;
        }
        if (draft.customFields.some((item) => !item.label.trim() && item.value.trim())) {
            await showSummaryError("已有内容的自定义项必须填写名称，请补全后再保存");
            return;
        }
        const normalized: OrganizationProfileDraft = { ...draft, name, shortName: draft.shortName.trim(), qccUrl: draft.qccUrl.trim(), logoUrl: draft.logoUrl.trim(), description: draft.description.trim(), departments: draft.departments.map((item) => ({ ...item, name: item.name.trim(), description: item.description.trim(), parentId: item.parentId?.trim() || null })).filter((item) => item.name), customFields: draft.customFields.map((item) => ({ ...item, label: item.label.trim(), value: item.value.trim() })).filter((item) => item.label) };
        const checked = validateOrganizationProfile(normalized);
        if (!checked.valid) {
            const message = checked.errors[0] ?? "组织资料未通过校验";
            const field = message.includes("组织名称") ? "name" : message.includes("企查查链接") ? "qccUrl" : message.includes("Logo 链接") ? "logoUrl" : null;
            if (field) await showFieldError(field, message);
            else await showSummaryError(message);
            return;
        }
        try {
            await onSave(normalized);
            // 保存成功后撤销记录已经失去作用，避免继续点击撤销又把已保存的字段插回草稿。
            removedDepartments = [];
            removedCustomFields = [];
            editNotice = "";
        } catch (error) {
            // onSave 通常由宿主负责展示错误，但编辑器也要兜底处理接入方的 rejected Promise。
            await showSummaryError(requestErrorMessage(error));
        }
    }

    const guardedClose = useCloseGuard({
        busy: () => saving,
        dirty: () => logoReading || JSON.stringify(draft) !== initialSnapshot,
        changes: () => [mode === "create" ? "新建组织资料尚未保存" : "组织资料修改尚未保存"],
    });

    /** X、Esc 与取消使用同一个局部守卫，父编辑器可能正在等待此窗口完成。 */
    export async function requestClose(): Promise<boolean> {
        let allowed = false;
        await guardedClose(() => { allowed = true; });
        return allowed;
    }

    function requestCancel(): void {
        if (!onCancel) return;
        void guardedClose(onCancel);
    }
</script>

<div class="lvct-org-profile-editor" data-org-profile-mode={mode}>
    <div class="lvct-org-profile-editor__intro">
        <div>
            <p class="lvct-org-profile-editor__eyebrow">{mode === "create" ? "新建组织" : "编辑组织资料"}</p>
            <h3>{mode === "create" ? "建立一个清晰的组织档案" : "完善组织档案"}</h3>
            <p class="ft__smaller ft__on-surface">记录组织的基本信息、架构和自定义内容，方便在联系人、图谱和详情页中统一使用。</p>
        </div>
        {#if onCancel}<button type="button" class="b3-button b3-button--cancel" onclick={requestCancel} disabled={saving}><X size={15} />取消</button>{/if}
    </div>

    {#if mode === "create"}
        <section class="lvct-org-profile-editor__presets" aria-labelledby="org-preset-title">
            <div class="lvct-org-profile-editor__section-head"><div><h4 id="org-preset-title">选择一个起点</h4><span class="ft__smaller ft__on-surface">可先套用模板，名称和内容都能继续修改。</span></div></div>
            <div class="lvct-org-profile-editor__preset-grid">
                {#each PRESETS as preset (preset.id)}
                    <button type="button" class:lvct-org-profile-editor__preset--active={selectedPreset === preset.id} class="lvct-org-profile-editor__preset" onclick={() => applyPreset(preset.id)} disabled={saving || readOnly}>
                        <span class="lvct-org-profile-editor__preset-icon" aria-hidden="true">{preset.icon}</span><span><b>{preset.label}</b><small>{preset.description}</small></span>
                    </button>
                {/each}
            </div>
            {#if pendingPresetId}
                <div class="lvct-org-profile-editor__confirm lvct-org-profile-editor__confirm--preset" role="alertdialog" aria-modal="false" aria-label="预览组织模板" tabindex="-1" bind:this={presetPreviewPanel} onkeydown={onPresetPreviewKeydown}>
                    <strong>预览“{PRESETS.find((item) => item.id === pendingPresetId)?.label ?? "组织"}”模板</strong>
                    <p>当前草稿已有内容。模板将提供：{templateSummary(pendingPresetId)}。请选择如何合并，草稿只在保存时写入。</p>
                    <div class="lvct-org-profile-editor__confirm-actions">
                        <button type="button" class="b3-button b3-button--outline" disabled={saving || readOnly} onclick={() => applyPresetValues(pendingPresetId, "fill")}>仅填空白</button>
                        <button type="button" class="b3-button b3-button--cancel" disabled={saving || readOnly} onclick={() => applyPresetValues(pendingPresetId, "overwrite")}>覆盖模板字段</button>
                        <button type="button" class="b3-button b3-button--text" disabled={saving} onclick={cancelPresetPreview}>取消</button>
                    </div>
                </div>
            {/if}
        </section>
    {/if}

    <section class="lvct-org-profile-editor__section" aria-labelledby="org-basic-title">
        <div class="lvct-org-profile-editor__section-head"><div><h4 id="org-basic-title">基本资料</h4><span class="ft__smaller ft__on-surface">名称会显示在组织列表和联系人归属中。</span></div><span class="lvct-org-profile-editor__required">* 必填</span></div>
        <div class="lvct-org-profile-editor__form-grid">
            <label class="lvct-org-profile-editor__field lvct-org-profile-editor__field--required">组织名称 *<input id="lvct-org-name" class="b3-text-field" bind:this={nameInput} bind:value={draft.name} maxlength="80" placeholder="例如：远山科技" aria-label="组织名称（必填）" aria-invalid={validationErrorField === "name"} aria-describedby={validationErrorField === "name" ? "lvct-org-profile-error" : undefined} oninput={() => clearFieldError("name")} disabled={saving || readOnly} /></label>
            <label class="lvct-org-profile-editor__field">简称<input class="b3-text-field" bind:value={draft.shortName} maxlength="30" placeholder="例如：远山" aria-label="组织简称" disabled={saving || readOnly} /></label>
            <label class="lvct-org-profile-editor__field lvct-org-profile-editor__field--wide">企查查链接<input id="lvct-org-qcc-url" class="b3-text-field" type="url" bind:this={qccUrlInput} bind:value={draft.qccUrl} placeholder="https://www.qcc.com/..." aria-label="企查查链接" aria-invalid={validationErrorField === "qccUrl"} aria-describedby={validationErrorField === "qccUrl" ? "lvct-org-profile-error" : undefined} oninput={() => clearFieldError("qccUrl")} disabled={saving || readOnly} /><small>可粘贴企查查企业详情页链接，便于回查工商信息。</small></label>
            <label class="lvct-org-profile-editor__field lvct-org-profile-editor__field--wide">介绍<textarea class="b3-text-field" rows="3" bind:value={draft.description} maxlength="1000" placeholder="记录组织定位、合作背景或你希望记住的内容" aria-label="组织介绍" disabled={saving || readOnly}></textarea></label>
        </div>
    </section>

    <section class="lvct-org-profile-editor__section" aria-labelledby="org-logo-title">
        <div class="lvct-org-profile-editor__section-head"><div><h4 id="org-logo-title">Logo</h4><span class="ft__smaller ft__on-surface">支持上传本地图片，或填写公开图片链接。</span></div></div>
        <div class="lvct-org-profile-editor__logo-row">
            <div class="lvct-org-profile-editor__logo-preview">{#if logoPreview() && !logoPreviewError}<img src={logoPreview()} alt="组织 Logo 预览" width="48" height="48" decoding="async" onerror={handleLogoPreviewError} />{:else}<span aria-hidden="true">{draft.shortName?.slice(0, 2) || draft.name?.slice(0, 2) || "组"}</span>{/if}</div>
            <div class="lvct-org-profile-editor__logo-actions">
                <input bind:this={logoInput} class="lvct-org-profile-editor__file" type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" onchange={handleLogoFile} disabled={saving || readOnly} aria-label="上传组织 Logo" />
                <button type="button" class="b3-button b3-button--outline" onclick={() => logoInput?.click()} disabled={saving || readOnly}><Upload size={15} />上传图片</button>
                <label class="lvct-org-profile-editor__field">Logo 链接<input id="lvct-org-logo-url" class="b3-text-field" type="url" bind:this={logoUrlInput} bind:value={draft.logoUrl} placeholder="https://.../logo.png" aria-label="Logo 链接" aria-invalid={validationErrorField === "logoUrl"} aria-describedby={validationErrorField === "logoUrl" ? "lvct-org-profile-error" : undefined} oninput={() => clearFieldError("logoUrl")} disabled={saving || readOnly} /></label>
                {#if logoPreview()}<button type="button" class="b3-button b3-button--text" onclick={clearLogo} disabled={saving || readOnly}>移除 Logo</button>{/if}
                {#if logoReading}<p class="ft__smaller ft__on-surface" role="status" aria-live="polite">正在读取 Logo…</p>{/if}
                {#if logoError}<p class="lvct-form__error" role="alert">{logoError}</p>{/if}
                {#if logoPreviewError}<p class="ft__smaller ft__on-surface" role="status">{logoPreviewError}</p>{/if}
            </div>
        </div>
    </section>

    <section class="lvct-org-profile-editor__section" aria-labelledby="org-dept-title">
        <div class="lvct-org-profile-editor__section-head"><div><h4 id="org-dept-title">部门设置</h4><span class="ft__smaller ft__on-surface">可先搭建常用部门，成员归属时可直接选择。</span></div><button type="button" class="b3-button b3-button--text" onclick={addDepartment} disabled={saving || readOnly}><Plus size={15} />添加部门</button></div>
        {#if draft.departments.length === 0}<p class="lvct-org-profile-editor__empty">暂未设置部门，稍后可在组织详情中继续添加。</p>{/if}
        <div class="lvct-org-profile-editor__repeat-list">
            {#each draft.departments as item, index (item.id)}
                <div class="lvct-org-profile-editor__repeat-row"><span class="lvct-org-profile-editor__index">{index + 1}</span><input class="b3-text-field" bind:value={item.name} placeholder="部门名称，如产品部" aria-label={`部门 ${index + 1} 名称`} disabled={saving || readOnly} /><select class="b3-select" bind:value={item.parentId} aria-label={`部门 ${index + 1} 上级部门`} disabled={saving || readOnly}><option value="">无上级部门</option>{#each draft.departments.filter((candidate) => candidate.id !== item.id && candidate.name.trim()) as candidate (candidate.id)}<option value={candidate.id}>{candidate.name}</option>{/each}</select><input class="b3-text-field" bind:value={item.description} placeholder="部门说明（可选）" aria-label={`部门 ${index + 1} 说明`} disabled={saving || readOnly} /><button type="button" class="b3-button b3-button--text" aria-label={`删除部门 ${index + 1}`} onclick={() => void requestRemoveDepartment(item.id)} disabled={saving || readOnly}><Trash2 size={15} /></button></div>
            {/each}
        </div>
        {#if pendingDepartmentDelete}
            <div class="lvct-org-profile-editor__confirm" role="alertdialog" aria-modal="false" aria-label="确认删除部门" tabindex="-1" bind:this={departmentDeletePanel} onkeydown={onDepartmentDeleteKeydown}>
                <strong>确认删除“{pendingDepartmentDelete.department.name || "未命名部门"}”？</strong>
                <p>{Object.keys(pendingDepartmentDelete.childParentIds).length > 0 ? `该部门有 ${Object.keys(pendingDepartmentDelete.childParentIds).length} 个下级部门。删除后下级会保留，并解除上级归属。` : "删除只影响当前草稿，保存前仍可撤销。"}</p>
                <div class="lvct-org-profile-editor__confirm-actions">
                    <button type="button" class="b3-button b3-button--cancel" disabled={saving || readOnly} onclick={confirmDepartmentDelete}>确认删除部门</button>
                    <button type="button" class="b3-button b3-button--text" disabled={saving} onclick={cancelDepartmentDelete}>取消</button>
                </div>
            </div>
        {/if}
        {#if removedDepartments.length > 0}
            <div class="lvct-org-profile-editor__undo" role="status" aria-live="polite"><span>部门删除记录仍在草稿中：</span>{#each removedDepartments as removed, removedIndex (removed.department.id)}<button type="button" class="b3-button b3-button--text" disabled={saving || readOnly} onclick={() => undoDepartmentDelete(removedIndex)}>撤销“{removed.department.name || "未命名部门"}”</button>{/each}</div>
        {/if}
    </section>

    <section class="lvct-org-profile-editor__section" aria-labelledby="org-custom-title">
        <div class="lvct-org-profile-editor__section-head"><div><h4 id="org-custom-title">自定义内容</h4><span class="ft__smaller ft__on-surface">用键值对记录行业、地址、官网、成立时间等信息。</span></div><button type="button" class="b3-button b3-button--text" onclick={addCustomField} disabled={saving || readOnly}><Plus size={15} />添加字段</button></div>
        {#if draft.customFields.length === 0}<p class="lvct-org-profile-editor__empty">还没有自定义字段。</p>{/if}
        <div class="lvct-org-profile-editor__repeat-list">
            {#each draft.customFields as item, index (item.id)}<div class="lvct-org-profile-editor__repeat-row"><input class="b3-text-field" bind:value={item.label} placeholder="字段名称，如官网" aria-label={`自定义字段 ${index + 1} 名称`} disabled={saving || readOnly} /><input class="b3-text-field" bind:value={item.value} placeholder="字段内容" aria-label={`自定义字段 ${index + 1} 内容`} disabled={saving || readOnly} /><button type="button" class="b3-button b3-button--text" aria-label={`删除自定义字段 ${index + 1}`} onclick={() => removeCustomField(item.id)} disabled={saving || readOnly}><Trash2 size={15} /></button></div>{/each}
        </div>
        {#if removedCustomFields.length > 0}
            <div class="lvct-org-profile-editor__undo" role="status" aria-live="polite"><span>字段删除记录仍在草稿中：</span>{#each removedCustomFields as removed, removedIndex (removed.field.id)}<button type="button" class="b3-button b3-button--text" disabled={saving || readOnly} onclick={() => undoCustomField(removedIndex)}>撤销“{removed.field.label || "未命名字段"}”</button>{/each}</div>
        {/if}
    </section>

    {#if editNotice}<p class="lvct-org-profile-editor__notice" role="status" aria-live="polite">{editNotice}</p>{/if}
    {#if validationError || error}<p id="lvct-org-profile-error" class="lvct-form__error" role="alert" tabindex="-1" bind:this={validationSummary}>{validationError || error}{#if readOnly && onRetry}<button type="button" class="b3-button b3-button--outline" onclick={onRetry} disabled={saving}>重新读取组织资料</button>{/if}</p>{/if}
    <div class="lvct-org-profile-editor__footer"><span class="ft__smaller ft__on-surface">保存后可在组织列表、联系人归属和关系图中使用。</span><span class="fn__flex-1"></span>{#if onCancel}<button type="button" class="b3-button b3-button--cancel" onclick={requestCancel} disabled={saving}>取消</button>{/if}<button type="button" class="b3-button b3-button--primary" onclick={submit} disabled={saving || readOnly || logoReading}>{saving ? "保存中…" : logoReading ? "正在读取 Logo…" : readOnly ? "等待读取" : mode === "create" ? "创建组织" : "保存资料"}</button></div>
</div>
