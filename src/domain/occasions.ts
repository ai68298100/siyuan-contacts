/**
 * 生日/纪念日投影：从联系人的生日字段算"下一次 occurrence"。
 * 纯函数，本地时区日期；农历生日按"存储日期的月日为农历月日"换算
 * （WOLB/时光序同语义），年龄按公历粗算。
 */
import { lunarToSolar, solarToLunar, formatLunar } from "./lunar.ts";
import type { ContactSummary } from "./person";

export interface BirthdayProjection {
    /** 下一次生日的本地日期（零点） */
    date: Date;
    /** 距今天数（今天=0） */
    daysUntil: number;
    /** 届时满的周岁 */
    age: number;
    /** 展示用日期文本（农历生日显示农历月日） */
    label: string;
}

/** YYYY-MM-DD → 本地零点 Date；非法返回 undefined */
function parseLocalDate(value: string): Date | undefined {
    const parts = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!parts) return undefined;
    const [year, month, day] = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
    const date = new Date(year, month - 1, day);
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return undefined;
    return date;
}

function startOfToday(now: Date): Date {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function daysBetween(from: Date, to: Date): number {
    return Math.round((to.getTime() - from.getTime()) / 86400000);
}

/** 计算某农历月日在"目标农历年"的公历日期；目标年无效则顺延一年 */
function lunarOccurrenceIn(lunarYear: number, month: number, day: number): Date | undefined {
    return lunarToSolar(lunarYear, month, day) ?? lunarToSolar(lunarYear + 1, month, day);
}

/**
 * 下一次生日。birthday 为 "YYYY-MM-DD"；isLunar=true 时该日期按农历解读。
 * 公历 2月29日生日在平年顺延到 3月1日（保守可预期）。
 */
export function nextBirthday(birthday: string, isLunar: boolean, now: Date = new Date()): BirthdayProjection | undefined {
    const parsed = parseLocalDate(birthday);
    if (!parsed) return undefined;
    const today = startOfToday(now);

    if (!isLunar) {
        let target = new Date(today.getFullYear(), parsed.getMonth(), parsed.getDate());
        // 2/29 → 平年自动变成 3/1（Date 规范化），保持顺延语义即可
        if (daysBetween(today, target) < 0) {
            target = new Date(today.getFullYear() + 1, parsed.getMonth(), parsed.getDate());
        }
        return {
            date: target,
            daysUntil: daysBetween(today, target),
            age: target.getFullYear() - parsed.getFullYear(),
            label: `${parsed.getMonth() + 1}月${parsed.getDate()}日`,
        };
    }

    // 农历：取存储日期的农历月日（以出生那年为准），在"今年农历年"与"明年农历年"里找下一次
    const birthLunar = solarToLunar(parsed);
    if (!birthLunar) return undefined;
    const todayLunar = solarToLunar(today);
    if (!todayLunar) return undefined;

    let target = lunarOccurrenceIn(todayLunar.year, birthLunar.month, birthLunar.day);
    if (!target || daysBetween(today, target) < 0) {
        target = lunarOccurrenceIn(todayLunar.year + 1, birthLunar.month, birthLunar.day);
    }
    if (!target) return undefined;
    return {
        date: target,
        daysUntil: daysBetween(today, target),
        age: todayLunar.year - parsed.getFullYear() + 1, // 农历虚岁口径按周岁近似：年份差
        label: formatLunar(birthLunar),
    };
}

/** 提醒分桶：今天 / 7 天内 / 30 天内 / 更远 */
export type BirthdayBucket = "today" | "week" | "month" | "later";

export function bucketOf(daysUntil: number): BirthdayBucket {
    if (daysUntil <= 0) return "today";
    if (daysUntil <= 7) return "week";
    if (daysUntil <= 30) return "month";
    return "later";
}

export interface UpcomingBirthday {
    person: ContactSummary;
    projection: BirthdayProjection;
    bucket: BirthdayBucket;
}

/** 全员生日投影，按天数升序，过滤无生日者 */
export function upcomingBirthdays(people: readonly ContactSummary[], now: Date = new Date()): UpcomingBirthday[] {
    const result: UpcomingBirthday[] = [];
    for (const person of people) {
        if (!person.birthday) continue;
        const projection = nextBirthday(person.birthday, person.isLunar, now);
        if (!projection) continue;
        result.push({ person, projection, bucket: bucketOf(projection.daysUntil) });
    }
    result.sort((a, b) => a.projection.daysUntil - b.projection.daysUntil);
    return result;
}
