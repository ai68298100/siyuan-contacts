<script lang="ts">
    /** 组织资料编辑器原型：可嵌入新建/编辑组织页面。保存由宿主通过 onSave 接入，组件不直接写入内核。 */
    import { Plus, Trash2, Upload, X } from "@lucide/svelte";
    import type { OrganizationProfileDraft, OrganizationDepartment, OrganizationCustomField } from "../../domain/organization-profile";
    import { emptyOrganizationProfileDraft, ORGANIZATION_TEMPLATES, organizationTemplateDraft, validateOrganizationProfile } from "../../domain/organization-profile";
    import { useCloseGuard } from "../close-guard";

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
    let logoError = $state("");
    let logoInput: HTMLInputElement | undefined = $state();
    let logoReadRequest = 0;

    function applyPreset(id: string): void {
        selectedPreset = id;
        const preset = PRESETS.find((item) => item.id === id);
        if (!preset) return;
        if (!draft.name.trim() || PRESETS.some((item) => item.label === draft.name.trim())) draft.name = preset.label;
        const template = organizationTemplateDraft(id as import("../../domain/organization-profile").OrganizationTemplateKey);
        if (template.description) draft.description = template.description;
        if (id === "family" && draft.departments.length === 0) {
            draft.departments = [department("核心家庭"), department("亲属")];
        }
        if (["primary-school", "middle-school", "high-school", "university"].includes(id) && draft.departments.length === 0) {
            draft.departments = [department("同学"), department("教师")];
        }
        if (id === "company" && draft.departments.length === 0) {
            draft.departments = [department("管理层"), department("业务部门")];
        }
    }

    function addDepartment(): void { draft.departments = [...draft.departments, department()]; }
    function removeDepartment(id: string): void { draft.departments = draft.departments.filter((item) => item.id !== id).map((item) => item.parentId === id ? { ...item, parentId: null } : item); }
    function addCustomField(): void { draft.customFields = [...draft.customFields, customField()]; }
    function removeCustomField(id: string): void { draft.customFields = draft.customFields.filter((item) => item.id !== id); }

    function handleLogoFile(event: Event): void {
        const target = event.currentTarget;
        if (!(target instanceof HTMLInputElement) || !target.files?.[0]) return;
        const file = target.files[0];
        const request = ++logoReadRequest;
        logoError = "";
        if (!file.type.startsWith("image/")) { logoError = "请选择图片文件"; return; }
        if (file.size > 2 * 1024 * 1024) { logoError = "图片不能超过 2 MB"; return; }
        const reader = new FileReader();
        reader.onload = () => {
            if (request !== logoReadRequest) return;
            draft.logoDataUrl = typeof reader.result === "string" ? reader.result : "";
        };
        reader.onerror = () => { if (request === logoReadRequest) logoError = "图片读取失败，请重试"; };
        reader.readAsDataURL(file);
    }
    function clearLogo(): void {
        // 让尚未完成的 FileReader 结果失效，避免点击“移除”后旧文件又回填。
        logoReadRequest += 1;
        draft.logoUrl = "";
        draft.logoDataUrl = "";
        if (logoInput) logoInput.value = "";
    }
    function logoPreview(): string { return draft.logoDataUrl || draft.logoUrl; }
    function validUrl(value: string): boolean {
        if (!value.trim()) return true;
        try { const url = new URL(value); return url.protocol === "https:" || url.protocol === "http:"; } catch { return false; }
    }
    async function submit(): Promise<void> {
        validationError = "";
        const name = draft.name.trim();
        if (!name) { validationError = "组织名称为必填项"; return; }
        if (name.length > 80) { validationError = "组织名称不能超过 80 个字符"; return; }
        if (!validUrl(draft.qccUrl)) { validationError = "企查查链接格式不正确，请填写 http(s) 地址"; return; }
        if (!validUrl(draft.logoUrl)) { validationError = "Logo 链接格式不正确，请填写 http(s) 地址"; return; }
        const normalized: OrganizationProfileDraft = { ...draft, name, shortName: draft.shortName.trim(), qccUrl: draft.qccUrl.trim(), logoUrl: draft.logoUrl.trim(), description: draft.description.trim(), departments: draft.departments.map((item) => ({ ...item, name: item.name.trim(), description: item.description.trim(), parentId: item.parentId?.trim() || null })).filter((item) => item.name), customFields: draft.customFields.map((item) => ({ ...item, label: item.label.trim(), value: item.value.trim() })).filter((item) => item.label) };
        const checked = validateOrganizationProfile(normalized);
        if (!checked.valid) { validationError = checked.errors[0] ?? "组织资料未通过校验"; return; }
        try {
            await onSave(normalized);
        } catch (error) {
            // onSave 通常由宿主负责展示错误，但编辑器也要兜底处理接入方的 rejected Promise。
            validationError = error instanceof Error ? error.message : String(error);
        }
    }

    const guardedClose = useCloseGuard({
        busy: () => saving,
        dirty: () => JSON.stringify(draft) !== initialSnapshot,
        changes: () => [mode === "create" ? "新建组织资料尚未保存" : "组织资料修改尚未保存"],
    });

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
        </section>
    {/if}

    <section class="lvct-org-profile-editor__section" aria-labelledby="org-basic-title">
        <div class="lvct-org-profile-editor__section-head"><div><h4 id="org-basic-title">基本资料</h4><span class="ft__smaller ft__on-surface">名称会显示在组织列表和联系人归属中。</span></div><span class="lvct-org-profile-editor__required">* 必填</span></div>
        <div class="lvct-org-profile-editor__form-grid">
            <label class="lvct-org-profile-editor__field lvct-org-profile-editor__field--required">组织名称 *<input class="b3-text-field" bind:value={draft.name} maxlength="80" placeholder="例如：远山科技" aria-label="组织名称（必填）" disabled={saving || readOnly} /></label>
            <label class="lvct-org-profile-editor__field">简称<input class="b3-text-field" bind:value={draft.shortName} maxlength="30" placeholder="例如：远山" aria-label="组织简称" disabled={saving || readOnly} /></label>
            <label class="lvct-org-profile-editor__field lvct-org-profile-editor__field--wide">企查查链接<input class="b3-text-field" type="url" bind:value={draft.qccUrl} placeholder="https://www.qcc.com/..." aria-label="企查查链接" disabled={saving || readOnly} /><small>可粘贴企查查企业详情页链接，便于回查工商信息。</small></label>
            <label class="lvct-org-profile-editor__field lvct-org-profile-editor__field--wide">介绍<textarea class="b3-text-field" rows="3" bind:value={draft.description} maxlength="1000" placeholder="记录组织定位、合作背景或你希望记住的内容" aria-label="组织介绍" disabled={saving || readOnly}></textarea></label>
        </div>
    </section>

    <section class="lvct-org-profile-editor__section" aria-labelledby="org-logo-title">
        <div class="lvct-org-profile-editor__section-head"><div><h4 id="org-logo-title">Logo</h4><span class="ft__smaller ft__on-surface">支持上传本地图片，或填写公开图片链接。</span></div></div>
        <div class="lvct-org-profile-editor__logo-row">
            <div class="lvct-org-profile-editor__logo-preview">{#if logoPreview()}<img src={logoPreview()} alt="组织 Logo 预览" />{:else}<span aria-hidden="true">{draft.shortName?.slice(0, 2) || draft.name?.slice(0, 2) || "组"}</span>{/if}</div>
            <div class="lvct-org-profile-editor__logo-actions">
                <input bind:this={logoInput} class="lvct-org-profile-editor__file" type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" onchange={handleLogoFile} disabled={saving || readOnly} aria-label="上传组织 Logo" />
                <button type="button" class="b3-button b3-button--outline" onclick={() => logoInput?.click()} disabled={saving || readOnly}><Upload size={15} />上传图片</button>
                <label class="lvct-org-profile-editor__field">Logo 链接<input class="b3-text-field" type="url" bind:value={draft.logoUrl} placeholder="https://.../logo.png" aria-label="Logo 链接" disabled={saving || readOnly} /></label>
                {#if logoPreview()}<button type="button" class="b3-button b3-button--text" onclick={clearLogo} disabled={saving || readOnly}>移除 Logo</button>{/if}
                {#if logoError}<p class="lvct-form__error" role="alert">{logoError}</p>{/if}
            </div>
        </div>
    </section>

    <section class="lvct-org-profile-editor__section" aria-labelledby="org-dept-title">
        <div class="lvct-org-profile-editor__section-head"><div><h4 id="org-dept-title">部门设置</h4><span class="ft__smaller ft__on-surface">可先搭建常用部门，成员归属时可直接选择。</span></div><button type="button" class="b3-button b3-button--text" onclick={addDepartment} disabled={saving || readOnly}><Plus size={15} />添加部门</button></div>
        {#if draft.departments.length === 0}<p class="lvct-org-profile-editor__empty">暂未设置部门，稍后可在组织详情中继续添加。</p>{/if}
        <div class="lvct-org-profile-editor__repeat-list">
            {#each draft.departments as item, index (item.id)}
                <div class="lvct-org-profile-editor__repeat-row"><span class="lvct-org-profile-editor__index">{index + 1}</span><input class="b3-text-field" bind:value={item.name} placeholder="部门名称，如产品部" aria-label={`部门 ${index + 1} 名称`} disabled={saving || readOnly} /><select class="b3-select" bind:value={item.parentId} aria-label={`部门 ${index + 1} 上级部门`} disabled={saving || readOnly}><option value="">无上级部门</option>{#each draft.departments.filter((candidate) => candidate.id !== item.id && candidate.name.trim()) as candidate (candidate.id)}<option value={candidate.id}>{candidate.name}</option>{/each}</select><input class="b3-text-field" bind:value={item.description} placeholder="部门说明（可选）" aria-label={`部门 ${index + 1} 说明`} disabled={saving || readOnly} /><button type="button" class="b3-button b3-button--text" aria-label={`删除部门 ${index + 1}`} onclick={() => removeDepartment(item.id)} disabled={saving || readOnly}><Trash2 size={15} /></button></div>
            {/each}
        </div>
    </section>

    <section class="lvct-org-profile-editor__section" aria-labelledby="org-custom-title">
        <div class="lvct-org-profile-editor__section-head"><div><h4 id="org-custom-title">自定义内容</h4><span class="ft__smaller ft__on-surface">用键值对记录行业、地址、官网、成立时间等信息。</span></div><button type="button" class="b3-button b3-button--text" onclick={addCustomField} disabled={saving || readOnly}><Plus size={15} />添加字段</button></div>
        {#if draft.customFields.length === 0}<p class="lvct-org-profile-editor__empty">还没有自定义字段。</p>{/if}
        <div class="lvct-org-profile-editor__repeat-list">
            {#each draft.customFields as item, index (item.id)}<div class="lvct-org-profile-editor__repeat-row"><input class="b3-text-field" bind:value={item.label} placeholder="字段名称，如官网" aria-label={`自定义字段 ${index + 1} 名称`} disabled={saving || readOnly} /><input class="b3-text-field" bind:value={item.value} placeholder="字段内容" aria-label={`自定义字段 ${index + 1} 内容`} disabled={saving || readOnly} /><button type="button" class="b3-button b3-button--text" aria-label={`删除自定义字段 ${index + 1}`} onclick={() => removeCustomField(item.id)} disabled={saving || readOnly}><Trash2 size={15} /></button></div>{/each}
        </div>
    </section>

    {#if validationError || error}<p class="lvct-form__error" role="alert" tabindex="-1">{validationError || error}{#if readOnly && onRetry}<button type="button" class="b3-button b3-button--outline" onclick={onRetry} disabled={saving}>重新读取组织资料</button>{/if}</p>{/if}
    <div class="lvct-org-profile-editor__footer"><span class="ft__smaller ft__on-surface">保存后可在组织列表、联系人归属和关系图中使用。</span><span class="fn__flex-1"></span>{#if onCancel}<button type="button" class="b3-button b3-button--cancel" onclick={requestCancel} disabled={saving}>取消</button>{/if}<button type="button" class="b3-button b3-button--primary" onclick={submit} disabled={saving || readOnly || !draft.name.trim()}>{saving ? "保存中…" : readOnly ? "等待读取" : mode === "create" ? "创建组织" : "保存资料"}</button></div>
</div>
