/**
 * 互动日期回顾（F10）：日期范围过滤、按月分组与「历史上的今天」投影。
 * 复用现有时间线投影，无新存储。日期一律 localDate（YYYY-MM-DD）字符串比较，
 * 范围端点为闭区间；非法日期串视为该侧不限制；空月份不生成分组。
 * 纯函数：无 DOM、无 IO，node --test 直接可测。
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidReviewDate(value: string): boolean {
    return DATE_RE.test(value);
}

/** 闭区间日期范围过滤；非法/空端点视为不限制 */
export function inDateRange(localDate: string, from: string, to: string): boolean {
    const fromKey = isValidReviewDate(from) ? from : "";
    const toKey = isValidReviewDate(to) ? to : "";
    if (fromKey && localDate < fromKey) return false;
    if (toKey && localDate > toKey) return false;
    return true;
}

export interface MonthGroup<T extends { localDate: string }> {
    /** YYYY-MM */
    month: string;
    /** 展示文本：2026年9月 */
    label: string;
    items: T[];
}

/** 按月分组（输入需已按日期倒序，组序沿用输入顺序）；空月份不生成组 */
export function groupByMonth<T extends { localDate: string }>(items: readonly T[]): MonthGroup<T>[] {
    const groups: MonthGroup<T>[] = [];
    const byMonth = new Map<string, MonthGroup<T>>();
    for (const item of items) {
        const month = item.localDate.slice(0, 7);
        let group = byMonth.get(month);
        if (!group) {
            const [year, monthNumber] = month.split("-").map(Number);
            group = { month, label: `${year}年${monthNumber}月`, items: [] };
            byMonth.set(month, group);
            groups.push(group);
        }
        group.items.push(item);
    }
    return groups;
}

/** 「历史上的今天」：月日与今天相同、且早于今天的历史互动，按年份倒序 */
export function onThisDay<T extends { localDate: string }>(items: readonly T[], today: string): T[] {
    if (!isValidReviewDate(today)) return [];
    const suffix = today.slice(5);
    return items
        .filter((item) => item.localDate < today && item.localDate.slice(5) === suffix)
        .sort((a, b) => b.localDate.localeCompare(a.localDate));
}

/** 相对今天的日期键（快捷项：最近 30/90 天起点） */
export function addReviewDays(dateKey: string, days: number): string {
    if (!isValidReviewDate(dateKey)) return "";
    const [year, month, day] = dateKey.split("-").map(Number);
    const date = new Date(year, month - 1, day + days);
    const pad = (value: number) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
