import type { ContactDraft, ContactSummary } from "./person.ts";
import type { WritableContactField } from "./contact-write.ts";
import { buildContactWritePlan } from "./contact-write.ts";
import type { QuickFillItem, QuickFillResult } from "./quick-fill.ts";

/** 将用户输入的 hpath 前缀规范化为 `/文件夹`；空值表示不筛选。 */
export function normalizeFolderPrefix(value: string): string {
    const trimmed = value.trim().replace(/\\/g, "/");
    if (!trimmed || trimmed === "/") return "";
    return `/${trimmed.replace(/^\/+|\/+$/g, "")}`;
}

/** hpath 必须位于目标文件夹之下，不把同名的兄弟文件夹误算进去。 */
export function matchesFolderPrefix(hpath: string, folderPrefix: string): boolean {
    const folder = normalizeFolderPrefix(folderPrefix);
    if (!folder) return true;
    const path = hpath.trim().replace(/\\/g, "/").replace(/\/+$/, "");
    return path.startsWith(`${folder}/`);
}

/** 标签输入按空白/中英文逗号切分，去空、去重并保留首次出现顺序。 */
export function normalizeImportTags(value: string): string[] {
    return [...new Set(value.split(/[，,、\s]+/).map((tag) => tag.trim()).filter(Boolean))];
}

export type ImportSource = "document" | "vcard" | "paste" | "table" | "completion";
export type ImportItemStatus = "pending" | "applied" | "skipped" | "failed" | "unknown" | "conflict";

export interface ImportMapping {
    sourceField: string;
    targetField?: keyof ContactDraft;
    value: string;
    state: "mapped" | "ignored" | "review" | "conflict";
}

const VCARD_FIELDS: Partial<Record<keyof ContactDraft, string>> = {
    name: "FN/N", phone: "TEL", email: "EMAIL", website: "URL", birthday: "BDAY / X-LVCT-BDAY-LUNAR", tags: "CATEGORIES",
};

export function draftImportMappings(
    source: ImportSource,
    draft: ContactDraft,
    ignored: readonly string[] = [],
    review: readonly string[] = [],
): ImportMapping[] {
    const mappings: ImportMapping[] = [];
    for (const [field, rawValue] of Object.entries(draft)) {
        if (field === "isLunar") continue;
        const value = Array.isArray(rawValue) ? rawValue.join("、") : String(rawValue).trim();
        if (!value) continue;
        const targetField = field as keyof ContactDraft;
        mappings.push({ sourceField: source === "vcard" ? VCARD_FIELDS[targetField] ?? field : field, targetField, value, state: "mapped" });
    }
    return [...mappings, ...ignored.map((sourceField): ImportMapping => ({ sourceField, value: "", state: "ignored" })),
        ...review.map((sourceField): ImportMapping => ({ sourceField, value: "", state: "review" }))];
}

export function quickFillCanSelect(item: QuickFillItem): boolean {
    return item.field !== "birthday" || !/^\d{2}-\d{2}$/.test(item.value);
}

export function quickFillDefaultIndexes(result: QuickFillResult, existing: Partial<ContactDraft>): number[] {
    const values = new Map<string, Set<string>>();
    for (const item of result.items) {
        if (item.field === "tags") continue;
        const fieldValues = values.get(item.field) ?? new Set<string>();
        fieldValues.add(item.field === "birthday" ? JSON.stringify([item.value, Boolean(item.note?.includes("农历"))]) : item.value);
        values.set(item.field, fieldValues);
    }
    return result.items.flatMap((item, index) => {
        if (!quickFillCanSelect(item)) return [];
        if (item.field === "tags") return (existing.tags ?? []).includes(item.value) ? [] : [index];
        if ((values.get(item.field)?.size ?? 0) > 1) return [];
        const current = String(existing[item.field] ?? "").trim();
        return current ? [] : [index];
    });
}

export interface ImportDocumentCandidate {
    docId: string;
    name: string;
    hpath: string;
    notebookId?: string;
}

export interface DocumentImportItem extends ImportDocumentCandidate {
    notebookId: string;
    binding: "pending" | "verified" | "unknown" | "rejected";
    status: ImportItemStatus;
    itemId?: string;
    message?: string;
    baseline?: ContactDraft;
    unresolvedFields?: WritableContactField[];
}

export interface DocumentImportQueue {
    anchor: string;
    group: string;
    tags: string[];
    items: DocumentImportItem[];
}

export function importAnchor(settings: { notebookId: string; avId: string; dbBlockId: string }): string {
    return `${settings.notebookId}/${settings.avId}/${settings.dbBlockId}`;
}

export function snapshotImportQueue(
    anchor: string,
    notebookId: string,
    candidates: readonly ImportDocumentCandidate[],
    options: { group?: string; tags?: readonly string[] } = {},
): DocumentImportQueue {
    const ids = new Set<string>();
    const items = candidates.map((candidate): DocumentImportItem => {
        if (!/^\d{14}-[0-9a-z]{7}$/.test(candidate.docId) || ids.has(candidate.docId)) throw new Error("导入队列包含非法或重复文档 ID");
        ids.add(candidate.docId);
        const sourceNotebookId = candidate.notebookId ?? notebookId;
        if (!/^\d{14}-[0-9a-z]{7}$/.test(sourceNotebookId)) throw new Error("来源笔记本 ID 非法");
        return { ...candidate, notebookId: sourceNotebookId, binding: "pending", status: "pending" };
    });
    if (!/^\d{14}-[0-9a-z]{7}$/.test(notebookId)) throw new Error("来源笔记本 ID 非法");
    return { anchor, group: options.group?.trim() ?? "", tags: normalizeImportTags((options.tags ?? []).join("、")), items };
}

export function snapshotCompletionPeople(people: readonly ContactSummary[]): ContactSummary[] {
    const ids = new Set<string>();
    return people.map((person) => {
        if (!/^\d{14}-[0-9a-z]{7}$/.test(person.docId) || ids.has(person.docId)) throw new Error("补录队列包含非法或重复人物文档 ID");
        ids.add(person.docId);
        return { ...person, tags: [...person.tags], relatedItemIds: [...person.relatedItemIds] };
    });
}

export interface ImportFieldResolution {
    draft: ContactDraft;
    fields: WritableContactField[];
    conflicts: WritableContactField[];
    verified: WritableContactField[];
}

export function resolveImportFields(
    fresh: ContactDraft,
    baseline: ContactDraft,
    submitted: ContactDraft,
    onlyFields?: readonly WritableContactField[],
): ImportFieldResolution {
    const expected = buildContactWritePlan(submitted, "edit", onlyFields).writes;
    const original = buildContactWritePlan(baseline, "edit").writes;
    const current = buildContactWritePlan(fresh, "edit").writes;
    const result: ImportFieldResolution = { draft: { ...fresh, tags: [...fresh.tags] }, fields: [], conflicts: [], verified: [] };
    for (const write of expected) {
        const originalValue = original.find((entry) => entry.field === write.field)!.value;
        const currentValue = current.find((entry) => entry.field === write.field)!.value;
        if (write.field === "tags") {
            result.draft.tags = [...new Set([...fresh.tags, ...submitted.tags])];
            if (result.draft.tags.length === fresh.tags.length) result.verified.push(write.field);
            else result.fields.push(write.field);
        } else if (JSON.stringify(currentValue) === JSON.stringify(write.value)) {
            result.verified.push(write.field);
        } else if (JSON.stringify(currentValue) !== JSON.stringify(originalValue)
            || write.field === "lunarBirthday" && fresh.birthday !== baseline.birthday && fresh.birthday !== submitted.birthday) {
            result.conflicts.push(write.field);
        } else {
            const draftField = write.field === "lunarBirthday" ? "isLunar" : write.field;
            Object.assign(result.draft, { [draftField]: submitted[draftField] });
            result.fields.push(write.field);
        }
    }
    const birthdaySelected = expected.some((write) => write.field === "birthday");
    const lunarSelected = expected.some((write) => write.field === "lunarBirthday");
    if (birthdaySelected && !lunarSelected && fresh.isLunar !== submitted.isLunar && !result.conflicts.includes("birthday")) result.conflicts.push("birthday");
    if (lunarSelected && !birthdaySelected && fresh.birthday !== submitted.birthday && !result.conflicts.includes("lunarBirthday")) result.conflicts.push("lunarBirthday");
    if (result.conflicts.includes("birthday") || result.conflicts.includes("lunarBirthday")) {
        result.fields = result.fields.filter((field) => field !== "birthday" && field !== "lunarBirthday");
        result.verified = result.verified.filter((field) => field !== "birthday" && field !== "lunarBirthday");
        for (const field of ["birthday", "lunarBirthday"] as const) {
            if (expected.some((write) => write.field === field) && !result.conflicts.includes(field)) result.conflicts.push(field);
        }
        result.draft.birthday = fresh.birthday;
        result.draft.isLunar = fresh.isLunar;
    }
    return result;
}
