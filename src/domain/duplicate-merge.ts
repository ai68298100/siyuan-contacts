/**
 * E-31 重复人物定点字段级安全合并向导（Deduplication & Deep Merge Wizard）
 * 提供主次人物选择、逐字段比对保留、标签/关系合并与可撤销审计快照。
 * 纯函数：无 DOM、无 IO，node --test 直接可测。
 */

import type { ContactDraft, ContactSummary } from "./person.ts";

export type MergeFieldChoice = "primary" | "secondary" | "custom";

export interface FieldMergeSelection {
    choice: MergeFieldChoice;
    customValue?: string;
}

export interface ContactMergePlan {
    /** 保留的主人物（存活方，保留其 docId 与数据库绑定） */
    primary: ContactSummary;
    /** 被合并的次人物（其属性合并入主人物后从名册解绑） */
    secondary: ContactSummary;
    /** 字段级合并选择 */
    fields: {
        name: FieldMergeSelection;
        phone: FieldMergeSelection;
        email: FieldMergeSelection;
        wechat: FieldMergeSelection;
        website: FieldMergeSelection;
        birthday: FieldMergeSelection;
        group: FieldMergeSelection;
    };
    /** 标签合并模式：union（并集去重，默认）| primary（仅主人物）| secondary（仅次人物） */
    tagsMode: "union" | "primary" | "secondary";
    /** 补充自定义标签 */
    additionalTags?: string[];
}

export interface MergeAuditSnapshot {
    timestamp: number;
    primaryDocId: string;
    secondaryDocId: string;
    primaryBefore: ContactSummary;
    secondaryBefore: ContactSummary;
    mergedResult: ContactDraft;
}

/**
 * 校验合并计划的安全约束：
 * 1. 两者不能是同一文档或同一行；
 * 2. 若次人物是本人档案（isSelf），禁止合并（本人身份不可被销毁）；
 * 3. 姓名不能为空。
 */
export function validateMergePlan(plan: ContactMergePlan): string[] {
    const errors: string[] = [];
    if (plan.primary.docId === plan.secondary.docId) {
        errors.push("主人物与次人物不能是同一篇文档");
    }
    if (plan.primary.itemId === plan.secondary.itemId) {
        errors.push("主人物与次人物不能是同一数据库行");
    }
    if (plan.secondary.isSelf) {
        errors.push("次人物为本人身份，禁止被合并移除（本人身份不可被销毁）；请将本人设为主人物");
    }

    const resolvedName = resolveFieldValue(plan.fields.name, plan.primary.name, plan.secondary.name).trim();
    if (!resolvedName) {
        errors.push("合并后的姓名不能为空");
    }

    return errors;
}

function resolveFieldValue(selection: FieldMergeSelection, primaryVal: string = "", secondaryVal: string = ""): string {
    if (selection.choice === "custom") return selection.customValue ?? "";
    return selection.choice === "secondary" ? secondaryVal : primaryVal;
}

/**
 * 根据主次人物生成默认推荐的合并计划：
 * - 优先保留非空值；
 * - 两者均有值时默认取主人物；
 * - 标签默认取两者的去重并集。
 */
export function buildDefaultMergePlan(primary: ContactSummary, secondary: ContactSummary): ContactMergePlan {
    const pickChoice = (pVal: string = "", sVal: string = ""): FieldMergeSelection => {
        if (!pVal.trim() && sVal.trim()) return { choice: "secondary" };
        return { choice: "primary" };
    };

    return {
        primary,
        secondary,
        fields: {
            name: { choice: "primary" },
            phone: pickChoice(primary.phone, secondary.phone),
            email: pickChoice(primary.email, secondary.email),
            wechat: pickChoice(primary.wechat, secondary.wechat),
            website: pickChoice(primary.website, secondary.website),
            birthday: pickChoice(primary.birthday, secondary.birthday),
            group: pickChoice(primary.group, secondary.group),
        },
        tagsMode: "union",
    };
}

/**
 * 执行合并计划求值，输出最终写回主人物的 ContactDraft 及可逆审计快照
 */
export function resolveMergePlan(plan: ContactMergePlan, nowTime: number = Date.now()): {
    draft: ContactDraft;
    auditSnapshot: MergeAuditSnapshot;
} {
    const errors = validateMergePlan(plan);
    if (errors.length > 0) {
        throw new Error(`合并计划校验失败：${errors.join("；")}`);
    }

    const { primary, secondary, fields } = plan;

    // 字段值决议
    const name = resolveFieldValue(fields.name, primary.name, secondary.name).trim();
    const phone = resolveFieldValue(fields.phone, primary.phone, secondary.phone).trim();
    const email = resolveFieldValue(fields.email, primary.email, secondary.email).trim();
    const wechat = resolveFieldValue(fields.wechat, primary.wechat, secondary.wechat).trim();
    const website = resolveFieldValue(fields.website, primary.website, secondary.website).trim();
    const birthday = resolveFieldValue(fields.birthday, primary.birthday, secondary.birthday).trim();
    const group = resolveFieldValue(fields.group, primary.group, secondary.group).trim();

    // 生日农历历法：若选择了次人物生日，历法跟随次人物；否则跟随主人物
    const isLunar = fields.birthday.choice === "secondary" ? Boolean(secondary.isLunar) : Boolean(primary.isLunar);

    // 标签决议
    let tags: string[] = [];
    if (plan.tagsMode === "union") {
        tags = [...new Set([...primary.tags, ...secondary.tags, ...(plan.additionalTags ?? [])])];
    } else if (plan.tagsMode === "secondary") {
        tags = [...new Set([...secondary.tags, ...(plan.additionalTags ?? [])])];
    } else {
        tags = [...new Set([...primary.tags, ...(plan.additionalTags ?? [])])];
    }

    const draft: ContactDraft = {
        name,
        phone,
        email,
        wechat,
        website,
        birthday,
        isLunar,
        group,
        tags,
    };

    const auditSnapshot: MergeAuditSnapshot = {
        timestamp: nowTime,
        primaryDocId: primary.docId,
        secondaryDocId: secondary.docId,
        primaryBefore: JSON.parse(JSON.stringify(primary)) as ContactSummary,
        secondaryBefore: JSON.parse(JSON.stringify(secondary)) as ContactSummary,
        mergedResult: JSON.parse(JSON.stringify(draft)) as ContactDraft,
    };

    return { draft, auditSnapshot };
}
