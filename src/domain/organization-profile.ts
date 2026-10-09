/**
 * 组织资料域模型（无 IO、无 DOM）。
 *
 * 组织文档/成员关系仍由 B13 既有服务维护；本模块只描述组织自身的
 * 可编辑资料，供新建组织页、组织详情和组织选择器共用。
 */

export interface OrganizationDepartment {
    /** 稳定的本地标识；新建表单可用随机 ID，持久化后不得按名称推断身份。 */
    id: string;
    name: string;
    parentId: string | null;
    description: string;
}

export interface OrganizationCustomField {
    /** 稳定的本地标识；同一组织内唯一。 */
    id: string;
    label: string;
    value: string;
}

export interface OrganizationProfileDraft {
    /** 必填；同时作为组织文档标题。 */
    name: string;
    shortName: string;
    /** 企查查组织主页链接。 */
    qccUrl: string;
    /** 外部图片地址；与 logoDataUrl 二选一或同时保存（展示时优先 data URL）。 */
    logoUrl: string;
    /** 上传图片的 data URL；只接受 image/* 的 base64 data URL。 */
    logoDataUrl: string;
    description: string;
    departments: OrganizationDepartment[];
    customFields: OrganizationCustomField[];
}

export interface OrganizationProfile extends OrganizationProfileDraft {
    docId: string;
}

export interface OrganizationProfileValidation {
    valid: boolean;
    errors: string[];
}

/** 内置组织模板只是创建时的建议值，用户可以修改名称和全部资料。 */
export type OrganizationTemplateKey = "family" | "primary-school" | "middle-school" | "high-school" | "university" | "company" | "community";

export interface OrganizationTemplate {
    key: OrganizationTemplateKey;
    label: string;
    draft: OrganizationProfileDraft;
}

const emptyProfile = (name: string): OrganizationProfileDraft => ({
    name,
    shortName: "",
    qccUrl: "",
    logoUrl: "",
    logoDataUrl: "",
    description: "",
    departments: [],
    customFields: [],
});

/**
 * 建议模板。不要直接修改此数组中的对象；调用 organizationTemplateDraft
 * 获取副本后再填充表单。
 */
export const ORGANIZATION_TEMPLATES: readonly OrganizationTemplate[] = Object.freeze([
    { key: "family", label: "家庭", draft: emptyProfile("家庭") },
    { key: "primary-school", label: "小学", draft: emptyProfile("小学") },
    { key: "middle-school", label: "初中", draft: emptyProfile("初中") },
    { key: "high-school", label: "高中", draft: emptyProfile("高中") },
    { key: "university", label: "大学", draft: emptyProfile("大学") },
    { key: "company", label: "工作单位", draft: emptyProfile("工作单位") },
    { key: "community", label: "社区/社团", draft: emptyProfile("社区/社团") },
]);

function cloneDraft(draft: OrganizationProfileDraft): OrganizationProfileDraft {
    return {
        ...draft,
        departments: draft.departments.map((department) => ({ ...department })),
        customFields: draft.customFields.map((field) => ({ ...field })),
    };
}

/** 获取可编辑的内置模板副本。 */
export function organizationTemplateDraft(key: OrganizationTemplateKey): OrganizationProfileDraft {
    const template = ORGANIZATION_TEMPLATES.find((item) => item.key === key);
    if (!template) throw new Error(`未知组织模板：${key}`);
    return cloneDraft(template.draft);
}

/** 空白组织表单；名称由用户填写。 */
export function emptyOrganizationProfileDraft(): OrganizationProfileDraft {
    return emptyProfile("");
}

function isHttpUrl(value: string): boolean {
    try {
        const url = new URL(value);
        return url.protocol === "http:" || url.protocol === "https:";
    } catch {
        return false;
    }
}

function isLogoDataUrl(value: string): boolean {
    // 只接受图片 base64 data URL，拒绝可执行内容和超大输入（约 2 MiB）。
    return /^data:image\/(?:png|jpe?g|gif|webp|svg\+xml);base64,[A-Za-z0-9+/]+={0,2}$/.test(value)
        && value.length <= 2_800_000;
}

function validateDepartments(departments: readonly OrganizationDepartment[], errors: string[]): void {
    const ids = new Set<string>();
    for (const department of departments) {
        if (!department || typeof department !== "object") {
            errors.push("部门记录格式不正确");
            continue;
        }
        const id = typeof department.id === "string" ? department.id.trim() : "";
        const name = typeof department.name === "string" ? department.name.trim() : "";
        if (!id) errors.push("部门缺少唯一标识");
        else if (ids.has(id)) errors.push(`部门标识重复：${id}`);
        else ids.add(id);
        if (!name) errors.push("部门名称不能为空");
        else if (name.length > 100) errors.push(`部门名称过长：${name}`);
        if (typeof department.parentId !== "string" && department.parentId !== null) errors.push(`部门 ${id || "（未知）"} 的上级标识无效`);
        if (typeof department.description !== "string") errors.push(`部门 ${id || "（未知）"} 的介绍格式无效`);
    }
    for (const department of departments) {
        if (!department || typeof department !== "object" || department.parentId === null) continue;
        const parentId = department.parentId.trim();
        if (!ids.has(parentId)) errors.push(`部门 ${department.id || "（未知）"} 的上级不存在：${parentId}`);
        const visited = new Set<string>();
        let cursor: string | null = department.id;
        while (cursor) {
            if (visited.has(cursor)) {
                errors.push(`部门层级存在循环：${department.id || "（未知）"}`);
                break;
            }
            visited.add(cursor);
            const current = departments.find((item) => item?.id === cursor);
            cursor = current?.parentId ?? null;
        }
    }
}

/** 校验组织资料；不执行写入，也不会静默修正用户输入。 */
export function validateOrganizationProfile(value: OrganizationProfileDraft): OrganizationProfileValidation {
    const errors: string[] = [];
    if (!value || typeof value !== "object") return { valid: false, errors: ["组织资料格式不正确"] };
    const name = typeof value.name === "string" ? value.name.trim() : "";
    if (!name) errors.push("组织名称不能为空");
    if (name.length > 120) errors.push("组织名称不能超过 120 个字符");
    const shortName = typeof value.shortName === "string" ? value.shortName.trim() : "";
    if (shortName.length > 60) errors.push("组织简称不能超过 60 个字符");
    const qccUrl = typeof value.qccUrl === "string" ? value.qccUrl.trim() : "";
    if (qccUrl && (!isHttpUrl(qccUrl) || !/^(?:https?:\/\/)?(?:www\.)?qcc\.com\//i.test(qccUrl))) {
        errors.push("企查查链接应为 qcc.com 的 http(s) 地址");
    }
    const logoUrl = typeof value.logoUrl === "string" ? value.logoUrl.trim() : "";
    if (logoUrl && !isHttpUrl(logoUrl)) errors.push("Logo 链接应为 http(s) 地址");
    const logoDataUrl = typeof value.logoDataUrl === "string" ? value.logoDataUrl.trim() : "";
    if (logoDataUrl && !isLogoDataUrl(logoDataUrl)) errors.push("Logo 上传内容必须是受支持的图片 data URL");
    if (typeof value.description !== "string") errors.push("组织介绍格式不正确");
    else if (value.description.length > 10_000) errors.push("组织介绍不能超过 10000 个字符");
    if (!Array.isArray(value.departments)) errors.push("部门列表格式不正确");
    else validateDepartments(value.departments, errors);
    if (!Array.isArray(value.customFields)) errors.push("自定义内容格式不正确");
    else {
        const ids = new Set<string>();
        for (const field of value.customFields) {
            const id = typeof field?.id === "string" ? field.id.trim() : "";
            const label = typeof field?.label === "string" ? field.label.trim() : "";
            if (!id) errors.push("自定义内容缺少唯一标识");
            else if (ids.has(id)) errors.push(`自定义内容标识重复：${id}`);
            else ids.add(id);
            if (!label) errors.push("自定义内容名称不能为空");
            else if (label.length > 100) errors.push(`自定义内容名称过长：${label}`);
            if (typeof field?.value !== "string") errors.push(`自定义内容 ${label || id || "（未知）"} 的值格式无效`);
            else if (field.value.length > 10_000) errors.push(`自定义内容 ${label || id || "（未知）"} 过长`);
        }
    }
    return { valid: errors.length === 0, errors };
}

/** 规范化表单空白；调用方应先用 validateOrganizationProfile 检查结果。 */
export function normalizeOrganizationProfileDraft(value: OrganizationProfileDraft): OrganizationProfileDraft {
    return {
        name: value.name.trim(),
        shortName: value.shortName.trim(),
        qccUrl: value.qccUrl.trim(),
        logoUrl: value.logoUrl.trim(),
        logoDataUrl: value.logoDataUrl.trim(),
        description: value.description.trim(),
        departments: value.departments.map((department) => ({
            id: department.id.trim(), name: department.name.trim(),
            parentId: department.parentId === null ? null : department.parentId.trim(),
            description: department.description.trim(),
        })),
        customFields: value.customFields.map((field) => ({ id: field.id.trim(), label: field.label.trim(), value: field.value.trim() })),
    };
}
