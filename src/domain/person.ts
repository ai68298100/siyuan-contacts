/**
 * 人（联系人）的纯函数域逻辑：草稿校验、字段映射换算、行→摘要投影。
 * 无 DOM、无 IO，node --test 直接可测。
 */
import type { AvRow, AvValue } from "../api/av";
import type { FieldKey } from "./fields";

/** 新建联系人表单草稿 */
export interface ContactDraft {
    name: string;
    phone: string;
    email: string;
    wechat: string;
    website: string;
    /** YYYY-MM-DD（公历语义；isLunar 时表示农历日期） */
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
    if (!draft.name.trim()) errors.push("姓名不能为空");
    if (draft.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.email)) errors.push("邮箱格式不正确");
    if (draft.birthday && !/^\d{4}-\d{2}-\d{2}$/.test(draft.birthday)) errors.push("生日日期格式不正确");
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
    if (!ms || ms <= 0) return "";
    const date = new Date(ms);
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
    /** YYYY-MM-DD；空串表示未填 */
    birthday: string;
    isLunar: boolean;
    group: string;
    tags: string[];
    /** 相关人 itemID 列表（M3 图谱直接消费） */
    relatedItemIds: string[];
    /** B11：该条目是本人档案（名册投影时按 self-identity 标记） */
    isSelf?: boolean;
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
                summary.birthday = msToBirthday(value.date?.isNotEmpty === false ? 0 : value.date?.content);
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
