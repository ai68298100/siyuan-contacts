import { fieldSpec } from "./fields.ts";
import type { FieldKey } from "./fields.ts";
import type { ContactDraft } from "./person.ts";
import { birthdayToMs, msToBirthday } from "./person.ts";
import type { AvRow } from "../api/av";

export const WRITABLE_CONTACT_FIELDS = [
    "phone",
    "email",
    "wechat",
    "website",
    "birthday",
    "lunarBirthday",
    "group",
    "tags",
] as const satisfies readonly FieldKey[];

export type WritableContactField = (typeof WRITABLE_CONTACT_FIELDS)[number];
export type ContactWriteMode = "create" | "edit";

export type ContactFieldWriteValue = string | number | boolean | null | readonly string[];

export interface ContactFieldWrite {
    field: WritableContactField;
    label: string;
    value: ContactFieldWriteValue;
}

export type ContactFieldStatus = "applied" | "failed" | "unknown" | "skipped";

export interface ContactFieldResult {
    field: WritableContactField;
    label: string;
    status: ContactFieldStatus;
    message?: string;
    requestStatus?: "accepted" | "failed" | "unknown" | "not_sent";
}

export interface ContactWriteFailure {
    field: WritableContactField;
    label: string;
    message: string;
}

export interface ContactWriteReport {
    mode: ContactWriteMode;
    results: readonly ContactFieldResult[];
    applied: readonly WritableContactField[];
    accepted: readonly WritableContactField[];
    failed: readonly ContactWriteFailure[];
    unknown: readonly ContactWriteFailure[];
    unresolved: readonly ContactWriteFailure[];
    skipped: readonly WritableContactField[];
    complete: boolean;
}

export interface ContactWritePlan {
    mode: ContactWriteMode;
    writes: readonly ContactFieldWrite[];
    skipped: readonly ContactFieldResult[];
}

const labelOf = (field: WritableContactField): string => fieldSpec(field).nameZh;

function selectedFields(onlyFields?: readonly WritableContactField[]): readonly WritableContactField[] {
    if (!onlyFields) return WRITABLE_CONTACT_FIELDS;
    const allowed = new Set(WRITABLE_CONTACT_FIELDS);
    const seen = new Set<WritableContactField>();
    return onlyFields.filter((field): field is WritableContactField => {
        if (!allowed.has(field) || seen.has(field)) return false;
        seen.add(field);
        return true;
    });
}

function normalizedTags(tags: readonly string[]): string[] {
    return [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))];
}

export function buildContactWritePlan(
    draft: ContactDraft,
    mode: ContactWriteMode,
    onlyFields?: readonly WritableContactField[],
): ContactWritePlan {
    const selected = new Set(selectedFields(onlyFields));
    const writes: ContactFieldWrite[] = [];
    const skipped: ContactFieldResult[] = [];
    const add = (field: WritableContactField, value: ContactFieldWriteValue, hasValue: boolean): void => {
        if (!selected.has(field)) return;
        if (mode === "create" && !hasValue) {
            skipped.push({ field, label: labelOf(field), status: "skipped" });
            return;
        }
        writes.push({ field, label: labelOf(field), value });
    };

    const phone = draft.phone.trim();
    const email = draft.email.trim();
    const wechat = draft.wechat.trim();
    const website = draft.website.trim();
    const group = draft.group.trim();
    const tags = normalizedTags(draft.tags);
    const birthday = draft.birthday.trim();
    const birthdayMs = birthday ? birthdayToMs(birthday) : null;

    add("phone", phone, phone.length > 0);
    add("email", email, email.length > 0);
    add("wechat", wechat, wechat.length > 0);
    add("website", website, website.length > 0);
    add("birthday", birthdayMs, birthday.length > 0);
    add("lunarBirthday", draft.isLunar, draft.isLunar);
    add("group", group, group.length > 0);
    add("tags", tags, tags.length > 0);

    return { mode, writes, skipped };
}

export function summarizeContactWriteResults(
    mode: ContactWriteMode,
    results: readonly ContactFieldResult[],
): ContactWriteReport {
    const applied = results.filter((result) => result.status === "applied").map((result) => result.field);
    const failureOf = (result: ContactFieldResult): ContactWriteFailure => ({
        field: result.field, label: result.label, message: result.message ?? "字段结果尚未核实",
    });
    const failed = results.filter((result) => result.status === "failed").map(failureOf);
    const unknown = results.filter((result) => result.status === "unknown").map(failureOf);
    const unresolved = results.filter((result) => result.status === "failed" || result.status === "unknown").map(failureOf);
    const skipped = results.filter((result) => result.status === "skipped").map((result) => result.field);
    return {
        mode,
        results,
        applied,
        accepted: results.filter((result) => result.requestStatus === "accepted").map((result) => result.field),
        failed,
        unknown,
        unresolved,
        skipped,
        complete: unresolved.length === 0,
    };
}

export function changedContactWriteFields(previous: ContactDraft, next: ContactDraft): WritableContactField[] {
    const before = buildContactWritePlan(previous, "edit");
    return buildContactWritePlan(next, "edit").writes.filter((write) =>
        JSON.stringify(write.value) !== JSON.stringify(before.writes.find((entry) => entry.field === write.field)!.value),
    ).map((write) => write.field);
}

export function settleContactFieldResult(
    verified: ContactFieldResult,
    request: ContactFieldResult,
): ContactFieldResult {
    if (verified.status === "applied") return { ...verified, requestStatus: request.requestStatus };
    if (request.requestStatus === "failed") return { ...request, status: "failed" };
    return {
        ...verified, status: "unknown", requestStatus: request.requestStatus,
        message: verified.status === "failed" ? "请求可能已写入，回读尚未匹配；只核实原请求，未自动重发" : verified.message,
    };
}

export function verifyContactField(write: ContactFieldWrite, row: AvRow | undefined, keyId: string): ContactFieldResult {
    const result = (status: ContactFieldStatus, message?: string): ContactFieldResult => ({
        field: write.field, label: write.label, status, ...(message ? { message } : {}),
    });
    if (!row) return result("unknown", "无法核实数据库行，请刷新后核对");
    const cells = row.cells.filter((cell) => cell.value.keyID === keyId);
    if (cells.length > 1) return result("unknown", "同字段存在多个单元格，未自动采纳");
    if (cells.length === 0) {
        const empty = write.value === null || write.value === "" || write.value === false
            || Array.isArray(write.value) && write.value.length === 0;
        return empty ? result("applied") : result("failed", "回读仍为空，未保存预期值");
    }
    const { value, valueType } = cells[0];
    const expectedType = fieldSpec(write.field).type;
    const allowedTypes = write.field === "group" ? ["select", "mSelect"] : [expectedType];
    if (!allowedTypes.includes(value.type) || !allowedTypes.includes(valueType)) {
        return result("unknown", "回读单元格类型与字段契约不一致");
    }
    let matches: boolean;
    if (write.field === "birthday") {
        const date = value.date;
        if (!date || typeof date.isNotEmpty !== "boolean"
            || date.isNotEmpty && (typeof date.content !== "number" || !Number.isFinite(date.content) || !msToBirthday(date.content))) {
            return result("unknown", "回读生日结构异常");
        }
        matches = write.value === null ? !date.isNotEmpty
            : date.isNotEmpty && msToBirthday(date.content) === msToBirthday(Number(write.value));
    } else if (write.field === "lunarBirthday") {
        if (typeof value.checkbox?.checked !== "boolean") return result("unknown", "回读农历标记结构异常");
        matches = value.checkbox.checked === write.value;
    } else if (write.field === "tags" || write.field === "group") {
        const options = Object.hasOwn(value, "mSelect") ? value.mSelect : [];
        if (!Array.isArray(options) || options.some((option) => typeof option?.content !== "string")) {
            return result("unknown", "回读选项结构异常");
        }
        const actual = normalizedTags(options.map((option) => option.content));
        const expected = write.field === "tags" ? normalizedTags(write.value as readonly string[])
            : write.value ? [String(write.value)] : [];
        matches = actual.length === expected.length && expected.every((option) => actual.includes(option));
    } else {
        const content = write.field === "wechat" ? value.text?.content : write.field === "website" ? value.url?.content
            : write.field === "phone" ? value.phone?.content : value.email?.content;
        if (typeof content !== "string") return result("unknown", "回读文本结构异常");
        matches = content === write.value;
    }
    return matches ? result("applied") : result("failed", "回读值与预期不一致，已保存的其他字段保留");
}
