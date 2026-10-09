/**
 * 交往回顾报表（F12）：按区间的互动统计只读投影，无新存储。
 * 统计口径（可解释，全部能从原始记录数出来）：
 * - 人物互动条数 total：区间内每人每条事件各计 1 条；
 * - 同场活动数 activities：按 source+externalRef 去重的场合数；无 externalRef 的事件
 *   （如手动记录）各自成场；多人同场不重复计为多场活动；
 * - 联系人数 contactedPeople：区间内有互动的不同人物数；
 * - 对比 delta：total 与前一同长度区间的差值；
 * 不输出人际关系质量评分。
 * 日期一律 localDate（YYYY-MM-DD）字符串闭区间比较。
 * 纯函数：无 DOM、无 IO，node --test 直接可测。
 */
import type { ContactSummary } from "./person.ts";
import type { InteractionEvent } from "./interactions.ts";
import { isValidDateKey } from "./date-key.ts";

export interface ReviewRange {
    from: string;
    to: string;
}

export interface ReviewEntry {
    eventId: string;
    localDate: string;
    personDocId: string;
    personName: string;
    source: string;
    note?: string;
    /** 同场人物数（>1 表示多人同场） */
    groupSize: number;
}

export interface ReviewReport {
    range: ReviewRange;
    previous: ReviewRange;
    /** 人物互动条数 */
    total: number;
    /** 同场活动数（source+externalRef 去重） */
    activities: number;
    contactedPeople: number;
    bySource: { manual: number; diary: number; api: number };
    topPeople: { personDocId: string; name: string; count: number }[];
    entries: ReviewEntry[];
    /** 上一同长度区间的人物互动条数 */
    previousTotal: number;
    /** total - previousTotal */
    delta: number;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidDate(value: string): boolean {
    return DATE_RE.test(value) && isValidDateKey(value);
}

function addDays(dateKey: string, days: number): string {
    const [year, month, day] = dateKey.split("-").map(Number);
    const date = new Date(year, month - 1, day + days);
    const pad = (value: number) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function daysBetween(from: string, to: string): number {
    const [fy, fm, fd] = from.split("-").map(Number);
    const [ty, tm, td] = to.split("-").map(Number);
    return Math.round((new Date(ty, tm - 1, td).getTime() - new Date(fy, fm - 1, fd).getTime()) / 86400000);
}

/** 上一同长度区间（紧邻，不重叠） */
export function previousRange(range: ReviewRange): ReviewRange {
    if (!isValidDate(range.from) || !isValidDate(range.to) || range.from > range.to) return { from: "", to: "" };
    const length = Math.max(0, daysBetween(range.from, range.to)) + 1;
    const from = addDays(range.from, -length);
    return { from, to: addDays(range.to, -length) };
}

/** 本月范围：当月 1 号至今天（供「按月」快捷项） */
export function monthToDateRange(today: string): ReviewRange {
    if (!isValidDate(today)) return { from: today, to: today };
    return { from: `${today.slice(0, 7)}-01`, to: today };
}

/** 同场活动身份键：有 externalRef 用 source+externalRef，否则每条事件自成一场 */
export function activityKey(event: Pick<InteractionEvent, "id" | "source" | "externalRef">): string {
    return event.externalRef ? `${event.source}:${event.externalRef}` : `id:${event.id}`;
}

export function buildReviewReport(params: {
    events: readonly InteractionEvent[];
    roster: readonly ContactSummary[];
    range: ReviewRange;
}): ReviewReport {
    const { roster, range } = params;
    const events = params.events;
    const from = isValidDate(range.from) ? range.from : "";
    const to = isValidDate(range.to) ? range.to : "";
    const inRange = (event: InteractionEvent) =>
        isValidDate(event.localDate) && (!from || event.localDate >= from) && (!to || event.localDate <= to);

    const nameByDoc = new Map(roster.map((person) => [person.docId, person.name]));
    const groupSizeByActivity = new Map<string, Set<string>>();
    for (const event of events) {
        const key = activityKey(event);
        let members = groupSizeByActivity.get(key);
        if (!members) {
            members = new Set();
            groupSizeByActivity.set(key, members);
        }
        members.add(event.personDocId);
    }

    const entries: ReviewEntry[] = [];
    const activityKeys = new Set<string>();
    const peopleSet = new Set<string>();
    const bySource = { manual: 0, diary: 0, api: 0 };
    for (const event of events) {
        if (!inRange(event)) continue;
        const key = activityKey(event);
        activityKeys.add(key);
        peopleSet.add(event.personDocId);
        if (bySource[event.source] !== undefined) bySource[event.source] += 1;
        const groupSize = groupSizeByActivity.get(key)?.size ?? 1;
        entries.push({
            eventId: event.id,
            localDate: event.localDate,
            personDocId: event.personDocId,
            personName: nameByDoc.get(event.personDocId) ?? "",
            source: event.source,
            ...(event.note !== undefined ? { note: event.note } : {}),
            groupSize,
        });
    }
    entries.sort((a, b) => b.localDate.localeCompare(a.localDate) || a.personName.localeCompare(b.personName, "zh-CN"));

    const countsByPerson = new Map<string, number>();
    for (const entry of entries) {
        countsByPerson.set(entry.personDocId, (countsByPerson.get(entry.personDocId) ?? 0) + 1);
    }
    const topPeople = [...countsByPerson.entries()]
        .map(([personDocId, count]) => ({ personDocId, name: nameByDoc.get(personDocId) ?? "", count }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "zh-CN"))
        .slice(0, 5);

    const total = entries.length;
    const previous = previousRange({ from: from || to, to: to || from });
    const previousTotal = events.filter((event) =>
        isValidDate(event.localDate) && (!previous.from || event.localDate >= previous.from) && (!previous.to || event.localDate <= previous.to)).length;

    return {
        range: { from, to },
        previous,
        total,
        activities: activityKeys.size,
        contactedPeople: peopleSet.size,
        bySource,
        topPeople,
        entries,
        previousTotal,
        delta: total - previousTotal,
    };
}
