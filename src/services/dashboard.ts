/**
 * 仪表盘服务：近期生日、久未联系、统计概览。
 * plugin 显式传参（同 init.ts 惯例），组件侧经 facade 调用。
 */
import type { Plugin } from "siyuan";
import { listContacts } from "./contacts";
import { loadInteractionStore } from "../data/interactions";
import { loadFollowUpStore } from "../data/followups";
import { loadCadenceMap } from "../data/cadences";
import { projectOpenFollowUps } from "../domain/followups";
import type { FollowUpBucket, FollowUpItem } from "../domain/followups";
import { staleContacts } from "../domain/interactions";
import { toLocalDateKey } from "../domain/interactions";
import { loadReminderDismissals } from "../data/reminder-dismissals";
import { isDismissed } from "../domain/reminder-dismissals";
import { buildActionCards } from "../domain/action-list";
import type { ActionCard, ActionPersonInput } from "../domain/action-list";
import { upcomingBirthdays } from "../domain/occasions";
import type { UpcomingBirthday } from "../domain/occasions";
import type { StalenessInfo } from "../domain/interactions";
import type { ContactsSettings } from "../domain/model";

export interface DashboardOptions {
    /** 多少天未互动算"久未联系" */
    staleThresholdDays: number;
    /** 生日提醒窗口（天） */
    birthdayWindowDays: number;
}
export const DEFAULT_DASHBOARD_OPTIONS: DashboardOptions = {
    staleThresholdDays: 30,
    birthdayWindowDays: 30,
};

export interface FollowUpCard {
    item: FollowUpItem;
    bucket: FollowUpBucket;
    /** 人物已被解绑（从名册移除）时缺省，此时 reachable 为 false，不指向他人 */
    person?: import("../domain/person").ContactSummary;
    reachable: boolean;
}

export interface DashboardData {
    people: number;
    /** 无向关系条数（related 字段双向各记一次，除以 2） */
    relations: number;
    birthdays: UpcomingBirthday[];
    birthdaysThisWeek: number;
    /** 久未联系提醒行（已剔除提醒暂缓中的人物，B08）；统计真实数见 staleTotal */
    stale: StalenessInfo[];
    /** 久未联系真实总数（含提醒暂缓中的人，D-0020 统计口径不变） */
    staleTotal: number;
    neverContacted: number;
    neverContactedItemIds: string[];
    /** 待办跟进（F05）：逾期/今天/未来 7 天，open 状态 */
    followUps: FollowUpCard[];
    /** 今日/本周行动清单（F07）：生日+节奏+跟进三源按人聚合的只读投影 */
    actions: ActionCard[];
}

/** 供组件派生使用的取值函数：把可空数据收窄为行动卡列表 */
export function pickActions(data: DashboardData | null): ActionCard[] {
    return data?.actions ?? [];
}

export interface SummaryCounts {
    total: number;
    overdue: number;
    birthdaysToday: number;
    stale: number;
}

/** 供组件派生使用的取值函数：摘要计数与首页数据同源 */
export function pickSummaryCounts(data: DashboardData | null, actions: readonly ActionCard[]): SummaryCounts {
    return {
        total: actions.length,
        overdue: actions.filter((card) => card.bucket === "overdue").length,
        birthdaysToday: (data?.birthdays ?? []).filter((item) => item.bucket === "today").length,
        stale: data?.staleTotal ?? data?.stale.length ?? 0,
    };
}
export async function loadDashboard(
    plugin: Plugin,
    settings: ContactsSettings,
    options: DashboardOptions = DEFAULT_DASHBOARD_OPTIONS,
): Promise<DashboardData> {
    const [people, store, followUpStore, cadences, dismissals] = await Promise.all([
        listContacts(settings),
        loadInteractionStore(plugin),
        loadFollowUpStore(plugin),
        loadCadenceMap(plugin),
        loadReminderDismissals(plugin),
    ]);
    const today = toLocalDateKey(new Date());
    // B08：提醒暂缓只屏蔽呈现——生日与久未联系提醒行过滤，统计与名单口径保持真实
    const birthdays = upcomingBirthdays(people)
        .filter((item) => item.projection.daysUntil <= options.birthdayWindowDays)
        .filter((item) => !isDismissed(dismissals, item.person.docId, "birthday", today));
    const staleAll = staleContacts(store, people, options.staleThresholdDays, new Date(), cadences);
    const staleRemindable = staleAll.filter((info) => !isDismissed(dismissals, info.person.docId, "stale", today));
    const neverContactedPeople = staleAll.filter((item) => item.lastDaysAgo === undefined);

    const buckets = projectOpenFollowUps(followUpStore.items, today);
    const peopleByDocId = new Map(people.map((person) => [person.docId, person]));
    const withBucket = (item: FollowUpItem): FollowUpCard => {
        const person = peopleByDocId.get(item.personDocId);
        return {
            item,
            bucket: item.dueDate < today ? "overdue" : item.dueDate === today ? "today" : "upcoming",
            ...(person ? { person } : {}),
            reachable: Boolean(person),
        };
    };
    // FUNC-01.1：服务层返回全量，不静默截断；首屏只展示前 N 条由 UI 层「查看全部」就地处达
    const followUps: FollowUpCard[] = [
        ...buckets.overdue,
        ...buckets.today,
        ...buckets.upcoming,
    ].map(withBucket);

    // 行动清单（F07）：生日 + 节奏 + 跟进三源按人聚合
    const followUpsByDoc = new Map<string, { id: string; title: string; dueDate: string }[]>();
    for (const card of followUps) {
        if (!card.reachable) continue;
        const list = followUpsByDoc.get(card.item.personDocId) ?? [];
        list.push({ id: card.item.id, title: card.item.title, dueDate: card.item.dueDate });
        followUpsByDoc.set(card.item.personDocId, list);
    }
    const inputs: ActionPersonInput[] = people.map((person) => {
        const birthday = birthdays.find((item) => item.person.docId === person.docId);
        /* 被提醒暂缓的人不产生久未联系行动卡（呈现屏蔽）；统计保持真实 */
        const staleInfo = staleRemindable.find((info) => info.person.docId === person.docId);
        return {
            person,
            ...(birthday ? { birthdayDaysUntil: birthday.projection.daysUntil, birthdayDate: toLocalDateKey(birthday.projection.date) } : {}),
            ...(staleInfo ? { lastDaysAgo: staleInfo.lastDaysAgo, staleThreshold: cadences[person.docId]?.days ?? options.staleThresholdDays } : {}),
            followUps: followUpsByDoc.get(person.docId) ?? [],
        };
    });

    return {
        people: people.length,
        relations: Math.round(people.reduce((sum, person) => sum + person.relatedItemIds.length, 0) / 2),
        birthdays,
        birthdaysThisWeek: birthdays.filter((item) => item.bucket === "today" || item.bucket === "week").length,
        stale: staleRemindable,
        staleTotal: staleAll.length,
        neverContacted: neverContactedPeople.length,
        neverContactedItemIds: neverContactedPeople.map((item) => item.person.itemId),
        followUps,
        actions: buildActionCards(inputs, today),
    };
}
