/** 全库日期键（YYYY-MM-DD）的严格校验。 */
const DATE_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** 只接受真实存在的公历日期，并避免 JS 对 0–99 年份的特殊解释。 */
export function isValidDateKey(value: unknown): value is string {
    if (typeof value !== "string") return false;
    const match = value.match(DATE_KEY_RE);
    if (!match) return false;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31) return false;
    const date = new Date(0);
    date.setUTCHours(0, 0, 0, 0);
    date.setUTCFullYear(year, month - 1, day);
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

