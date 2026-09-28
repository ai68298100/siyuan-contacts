/**
 * 联系人组合筛选（F03）：标签匹配模式、最近互动日期范围与从未联系。
 * 纯函数：无 DOM、无 IO，node --test 直接可测。
 * 日期一律用 localDate（YYYY-MM-DD）字符串比较（全库日期契约），范围端点为闭区间；
 * 非法日期串视为该侧不限制。「从未联系」与日期范围同时启用时按 AND 语义为空集（互相矛盾的条件）。
 */
import type { ContactSummary } from "./person";

export type TagMatchMode = "all" | "any";

/** C03 资料完整度：按现有九字段判定的资料缺口（不把未来字段当必填项） */
export type ProfileGap = "phone" | "birthday" | "contact" | "organize";

export const PROFILE_GAPS: readonly { key: ProfileGap; label: string }[] = [
    { key: "phone", label: "缺电话" },
    { key: "birthday", label: "缺生日" },
    { key: "contact", label: "缺全部联系方式" },
    { key: "organize", label: "无分组且无标签" },
];

export interface PeopleFilterState {
    /** 标签匹配：all=同时拥有全部所选标签，any=拥有任一所选标签 */
    tagMatch: TagMatchMode;
    /** 最近互动日期范围（含端点，YYYY-MM-DD）；空串表示该侧不限制 */
    recentFrom: string;
    recentTo: string;
    /** 只看从未互动的人 */
    neverContacted: boolean;
    /** 资料完整度（C03）；空串表示不限 */
    profileGap: ProfileGap | "";
}

export const EMPTY_PEOPLE_FILTER: PeopleFilterState = {
    tagMatch: "all",
    recentFrom: "",
    recentTo: "",
    neverContacted: false,
    profileGap: "",
};

export type ExtraFilterChipKey = "tagMatch" | "recentRange" | "neverContacted" | "profileGap";

export interface ExtraFilterChip {
    key: ExtraFilterChipKey;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isDateKey(value: string): boolean {
    return DATE_RE.test(value);
}

/** 标签交并匹配：未选标签时恒为命中 */
export function matchTags(person: ContactSummary, tags: readonly string[], mode: TagMatchMode): boolean {
    if (tags.length === 0) return true;
    return mode === "any"
        ? tags.some((tag) => person.tags.includes(tag))
        : tags.every((tag) => person.tags.includes(tag));
}

/** C03：该人物是否具有指定资料缺口（只按现有九字段判定） */
export function hasProfileGap(person: ContactSummary, gap: ProfileGap): boolean {
    switch (gap) {
        case "phone": return !person.phone.trim();
        case "birthday": return !person.birthday.trim();
        case "contact": return !person.phone.trim() && !person.email.trim() && !person.wechat.trim();
        case "organize": return !person.group.trim() && person.tags.length === 0;
    }
}

/** 附加筛选（标签模式之外的部分）是否生效 */
export function isExtraFilterActive(filter: PeopleFilterState): boolean {
    return filter.tagMatch !== "all" || !!filter.recentFrom || !!filter.recentTo || filter.neverContacted || !!filter.profileGap;
}

/** 当前生效的附加条件（固定顺序），供生效条件行渲染与单项清除 */
export function extraFilterChips(filter: PeopleFilterState): ExtraFilterChip[] {
    const chips: ExtraFilterChip[] = [];
    if (filter.tagMatch !== "all") chips.push({ key: "tagMatch" });
    if (filter.recentFrom || filter.recentTo) chips.push({ key: "recentRange" });
    if (filter.neverContacted) chips.push({ key: "neverContacted" });
    if (filter.profileGap) chips.push({ key: "profileGap" });
    return chips;
}

/** 最近互动范围 + 从未联系 + 资料完整度过滤（标签匹配请先用 matchTags） */
export function applyPeopleFilters(
    people: readonly ContactSummary[],
    recent: Readonly<Record<string, { occurredAt: number; localDate: string }>>,
    filter: PeopleFilterState,
): ContactSummary[] {
    const from = isDateKey(filter.recentFrom) ? filter.recentFrom : "";
    const to = isDateKey(filter.recentTo) ? filter.recentTo : "";
    const rangeActive = !!(from || to);
    return people.filter((person) => {
        if (filter.profileGap && !hasProfileGap(person, filter.profileGap)) return false;
        const last = recent[person.docId];
        if (filter.neverContacted && last) return false;
        if (rangeActive) {
            if (!last) return false;
            if (from && last.localDate < from) return false;
            if (to && last.localDate > to) return false;
        }
        return true;
    });
}
