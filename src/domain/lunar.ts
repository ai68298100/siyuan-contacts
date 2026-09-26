/* 公历 ↔ 农历换算（1900–2100，压缩表算法，无网络依赖）。
   移植自小驴打卡（siyuan-checkin）src/lunar.ts，同作者同许可（MIT）。
   表值编码：bit16 = 闰月天数（1 为 30 天），bits 15..4 = 正月至腊月大小，
   bits 3..0 = 闰月月份（0 表示无闰月）。 */

const LUNAR_INFO = [
    0x04bd8, 0x04ae0, 0x0a570, 0x054d5, 0x0d260, 0x0d950, 0x16554, 0x056a0, 0x09ad0, 0x055d2,
    0x04ae0, 0x0a5b6, 0x0a4d0, 0x0d250, 0x1d255, 0x0b540, 0x0d6a0, 0x0ada2, 0x095b0, 0x14977,
    0x04970, 0x0a4b0, 0x0b4b5, 0x06a50, 0x06d40, 0x1ab54, 0x02b60, 0x09570, 0x052f2, 0x04970,
    0x06566, 0x0d4a0, 0x0ea50, 0x06e95, 0x05ad0, 0x02b60, 0x186e3, 0x092e0, 0x1c8d7, 0x0c950,
    0x0d4a0, 0x1d8a6, 0x0b550, 0x056a0, 0x1a5b4, 0x025d0, 0x092d0, 0x0d2b2, 0x0a950, 0x0b557,
    0x06ca0, 0x0b550, 0x15355, 0x04da0, 0x0a5b0, 0x14573, 0x052b0, 0x0a9a8, 0x0e950, 0x06aa0,
    0x0aea6, 0x0ab50, 0x04b60, 0x0aae4, 0x0a570, 0x05260, 0x0f263, 0x0d950, 0x05b57, 0x056a0,
    0x096d0, 0x04dd5, 0x04ad0, 0x0a4d0, 0x0d4d4, 0x0d250, 0x0d558, 0x0b540, 0x0b6a0, 0x195a6,
    0x095b0, 0x049b0, 0x0a974, 0x0a4b0, 0x0b27a, 0x06a50, 0x06d40, 0x0af46, 0x0ab60, 0x09570,
    0x04af5, 0x04970, 0x064b0, 0x074a3, 0x0ea50, 0x06b58, 0x05ac0, 0x0ab60, 0x096d5, 0x092e0,
    0x0c960, 0x0d954, 0x0d4a0, 0x0da50, 0x07552, 0x056a0, 0x0abb7, 0x025d0, 0x092d0, 0x0cab5,
    0x0a950, 0x0b4a0, 0x0baa4, 0x0ad50, 0x055d9, 0x04ba0, 0x0a5b0, 0x15176, 0x052b0, 0x0a930,
    0x07954, 0x06aa0, 0x0ad50, 0x05b52, 0x04b60, 0x0a6e6, 0x0a4e0, 0x0d260, 0x0ea65, 0x0d530,
    0x05aa0, 0x076a3, 0x096d0, 0x04afb, 0x04ad0, 0x0a4d0, 0x1d0b6, 0x0d250, 0x0d520, 0x0dd45,
    0x0b5a0, 0x056d0, 0x055b2, 0x049b0, 0x0a577, 0x0a4b0, 0x0aa50, 0x1b255, 0x06d20, 0x0ada0,
    0x14b63, 0x09370, 0x049f8, 0x04970, 0x064b0, 0x168a6, 0x0ea50, 0x06b20, 0x1a6c4, 0x0aae0,
    0x0a2e0, 0x0d2e3, 0x0c960, 0x0d557, 0x0d4a0, 0x0da50, 0x05d55, 0x056a0, 0x0a6d0, 0x055d4,
    0x052d0, 0x0a9b8, 0x0a950, 0x0b4a0, 0x0b6a6, 0x0ad50, 0x055a0, 0x0aba4, 0x0a5b0, 0x052b0,
    0x0b273, 0x06930, 0x07337, 0x06aa0, 0x0ad50, 0x14b55, 0x04b60, 0x0a570, 0x054e4, 0x0d160,
    0x0e968, 0x0d520, 0x0daa0, 0x16aa6, 0x056d0, 0x04ae0, 0x0a9d4, 0x0a2d0, 0x0d150, 0x0f252,
    0x0d520,
];

const LUNAR_BASE_YEAR = 1900;
const LUNAR_BASE_DATE = new Date(1900, 0, 31); // 1900-01-31 = 正月初一

export interface LunarDate {
    year: number;
    month: number;
    day: number;
    leap: boolean;
}

export const LUNAR_MONTH_NAMES = ["正", "二", "三", "四", "五", "六", "七", "八", "九", "十", "冬", "腊"];
export const LUNAR_DAY_NAMES = [
    "初一", "初二", "初三", "初四", "初五", "初六", "初七", "初八", "初九", "初十",
    "十一", "十二", "十三", "十四", "十五", "十六", "十七", "十八", "十九", "二十",
    "廿一", "廿二", "廿三", "廿四", "廿五", "廿六", "廿七", "廿八", "廿九", "三十",
];

function infoOf(year: number): number {
    return LUNAR_INFO[year - LUNAR_BASE_YEAR] ?? 0;
}

function lunarMonthDays(year: number, month: number, leap: boolean): number {
    const info = infoOf(year);
    if (leap) return info & 0x10000 ? 30 : 29;
    return info & (0x10000 >> month) ? 30 : 29;
}

function lunarLeapMonth(year: number): number {
    return infoOf(year) & 0xf;
}

function lunarYearDays(year: number): number {
    let total = 0;
    for (let m = 1; m <= 12; m += 1) total += lunarMonthDays(year, m, false);
    const leap = lunarLeapMonth(year);
    if (leap) total += lunarMonthDays(year, leap, true);
    return total;
}

/** 公历 → 农历。越界（1900-01-31 前 / 2100 年底后）返回 undefined。 */
export function solarToLunar(date: Date): LunarDate | undefined {
    const utc = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
    let offset = Math.floor((utc - Date.UTC(1900, 0, 31)) / 86400000);
    if (offset < 0) return undefined;
    let year = LUNAR_BASE_YEAR;
    let daysInYear = lunarYearDays(year);
    while (offset >= daysInYear && year < LUNAR_BASE_YEAR + LUNAR_INFO.length - 1) {
        offset -= daysInYear;
        year += 1;
        daysInYear = lunarYearDays(year);
    }
    if (offset >= daysInYear) return undefined;
    const leapMonth = lunarLeapMonth(year);
    let month = 1;
    while (month <= 12) {
        if (leapMonth > 0 && month === leapMonth) {
            const regular = lunarMonthDays(year, month, false);
            if (offset < regular) return {year, month, day: offset + 1, leap: false};
            offset -= regular;
            const leapLen = lunarMonthDays(year, month, true);
            if (offset < leapLen) return {year, month, day: offset + 1, leap: true};
            offset -= leapLen;
        } else {
            const len = lunarMonthDays(year, month, false);
            if (offset < len) return {year, month, day: offset + 1, leap: false};
            offset -= len;
        }
        month += 1;
    }
    return undefined;
}

/** 农历 → 公历。leap 指定该月是否为闰月；无效组合返回 undefined。
    全程使用 UTC 天数运算，避免历史时区（LMT）造成的本地日期偏移。 */
export function lunarToSolar(year: number, month: number, day: number, leap = false): Date | undefined {
    if (year < LUNAR_BASE_YEAR || year > LUNAR_BASE_YEAR + LUNAR_INFO.length - 1) return undefined;
    if (month < 1 || month > 12 || day < 1 || day > 30) return undefined;
    const leapMonth = lunarLeapMonth(year);
    if (leap && month !== leapMonth) return undefined;
    let offset = 0;
    for (let y = LUNAR_BASE_YEAR; y < year; y += 1) offset += lunarYearDays(y);
    let month_ = 1;
    while (month_ <= 12) {
        if (leapMonth > 0 && month_ === leapMonth) {
            if (!leap && month_ === month) {
                const regular = lunarMonthDays(year, month_, false);
                if (day > regular) return undefined;
                return utcDaysToDate(offset + day - 1);
            }
            offset += lunarMonthDays(year, month_, false);
            if (leap && month_ === month) {
                const leapLen = lunarMonthDays(year, month_, true);
                if (day > leapLen) return undefined;
                return utcDaysToDate(offset + day - 1);
            }
            offset += lunarMonthDays(year, month_, true);
        } else {
            if (month_ === month && !leap) {
                const len = lunarMonthDays(year, month_, false);
                if (day > len) return undefined;
                return utcDaysToDate(offset + day - 1);
            }
            offset += lunarMonthDays(year, month_, false);
        }
        month_ += 1;
    }
    return undefined;
}

function utcDaysToDate(days: number): Date {
    const utc = new Date(Date.UTC(1900, 0, 31) + days * 86400000);
    return new Date(utc.getUTCFullYear(), utc.getUTCMonth(), utc.getUTCDate());
}

export function formatLunar(lunar: LunarDate): string {
    return `${lunar.leap ? "闰" : ""}${LUNAR_MONTH_NAMES[lunar.month - 1]}月${LUNAR_DAY_NAMES[lunar.day - 1]}`;
}

export { LUNAR_BASE_DATE };
