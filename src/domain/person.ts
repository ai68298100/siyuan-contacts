/**
 * 人（联系人）的纯函数域逻辑：草稿校验、字段映射换算、行→摘要投影。
 * 无 DOM、无 IO，node --test 直接可测。
 */
import type { AvRow, AvValue } from "../api/av";
import type { FieldKey } from "./fields";
import { validateDocumentTitle } from "./format.ts";
import type { PersonProfile } from "./people-profiles.ts";
import { lunarToSolar } from "./lunar.ts";

/** 新建联系人表单草稿 */
export interface ContactDraft {
    name: string;
    phone: string;
    email: string;
    wechat: string;
    website: string;
    /**
     * YYYY-MM-DD；公历时为完整公历日期，isLunar=true 时年份作为出生年份、月日作为农历月日。
     * 这样同一日期输入不会在换算前被再次当作公历解释。
     */
    birthday: string;
    isLunar: boolean;
    group: string;
    tags: string[];
}

export function emptyDraft(): ContactDraft {
    return { name: "", phone: "", email: "", wechat: "", website: "", birthday: "", isLunar: false, group: "", tags: [] };
}

export function validateDraft(draft: ContactDraft): string[] {
    const errors: string[] = [];
    const nameError = validateDocumentTitle(draft.name);
    if (nameError) errors.push(draft.name.trim() ? nameError : "姓名不能为空");
    const email = draft.email.trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push("邮箱格式不正确");
    const birthday = draft.birthday.trim();
    if (birthday && !/^\d{4}-\d{2}-\d{2}$/.test(birthday)) {
        errors.push("生日日期格式不正确");
    } else if (birthday) {
        const [year, month, day] = birthday.split("-").map(Number);
        if (draft.isLunar) {
            if (!lunarToSolar(year, month, day)) errors.push("农历生日不是有效日期");
            else if (birthdayToMs(birthday) === null) errors.push("农历生日日期暂不支持，请重新选择");
        } else if (birthdayToMs(birthday) === null) {
            errors.push("生日不是有效日期");
        }
    }
    return errors;
}

/** "YYYY-MM-DD" → 当地时区当日零点的毫秒时间戳；无效返回 null */
export function birthdayToMs(birthday: string): number | null {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(birthday)) return null;
    const [year, month, day] = birthday.split("-").map(Number);
    const date = new Date(year, month - 1, day);
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
    return date.getTime();
}

export function msToBirthday(ms: number | undefined): string {
    if (typeof ms !== "number" || !Number.isFinite(ms)) return "";
    const date = new Date(ms);
    if (Number.isNaN(date.getTime())) return "";
    const pad = (value: number) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** fieldMap(稳定键→keyID) 的逆映射：keyID→稳定键，用于渲染行投影视角 */
export function invertFieldMap(fieldMap: Readonly<Record<FieldKey, string>>): Record<string, FieldKey> {
    const inverted: Record<string, FieldKey> = {};
    for (const [key, keyId] of Object.entries(fieldMap)) {
        inverted[keyId] = key as FieldKey;
    }
    return inverted;
}

/** 联系人列表摘要（卡片与表格共用） */
export interface ContactSummary {
    docId: string;
    itemId: string;
    name: string;
    phone: string;
    email: string;
    wechat: string;
    website: string;
    /** YYYY-MM-DD；公历为完整日期，农历时月日按农历解释；空串表示未填 */
    birthday: string;
    isLunar: boolean;
    group: string;
    tags: string[];
    /** 相关人 itemID 列表（M3 图谱直接消费） */
    relatedItemIds: string[];
    /** B11：该条目是本人档案（名册投影时按 self-identity 标记） */
    isSelf?: boolean;
    profile?: PersonProfile;
    aliasProfile?: { state: "known"; values: string[] } | { state: "unknown"; message: string };
}

/** 渲染响应的一行 → 联系人摘要。纯函数，逐单元格容错（缺值/未知字段跳过） */
export function summaryFromRow(row: AvRow, keyToField: Record<string, FieldKey>): ContactSummary {
    const summary: ContactSummary = {
        docId: "",
        itemId: row.id,
        name: "",
        phone: "",
        email: "",
        wechat: "",
        website: "",
        birthday: "",
        isLunar: false,
        group: "",
        tags: [],
        relatedItemIds: [],
    };
    for (const cell of row.cells) {
        const value: AvValue = cell.value;
        if (value.type === "block") {
            summary.docId = value.block?.id ?? "";
            summary.name = value.block?.content ?? "";
            continue;
        }
        const field = keyToField[value.keyID];
        if (!field) continue;
        switch (field) {
            case "phone":
                summary.phone = value.phone?.content ?? "";
                break;
            case "email":
                summary.email = value.email?.content ?? "";
                break;
            case "wechat":
                summary.wechat = value.text?.content ?? "";
                break;
            case "website":
                summary.website = value.url?.content ?? "";
                break;
            case "birthday":
                summary.birthday = value.date?.isNotEmpty === false ? "" : msToBirthday(value.date?.content);
                break;
            case "lunarBirthday":
                summary.isLunar = value.checkbox?.checked === true;
                break;
            case "group":
                summary.group = value.mSelect?.[0]?.content ?? "";
                break;
            case "tags":
                summary.tags = (value.mSelect ?? []).map((option) => option.content);
                break;
            case "related":
                summary.relatedItemIds = value.relation?.blockIDs ?? [];
                break;
        }
    }
    return summary;
}
