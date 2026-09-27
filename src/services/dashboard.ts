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
    stale: StalenessInfo[];
    neverContacted: number;
    neverContactedItemIds: string[];
    /** 待办跟进（F05）：逾期/今天/未来 7 天，open 状态 */
    followUps: FollowUpCard[];
}
export async function loadDashboard(
    plugin: Plugin,
    settings: ContactsSettings,
    options: DashboardOptions = DEFAULT_DASHBOARD_OPTIONS,
): Promise<DashboardData> {
    const [people, store, followUpStore, cadences] = await Promise.all([
        listContacts(settings),
        loadInteractionStore(plugin),
        loadFollowUpStore(plugin),
        loadCadenceMap(plugin),
    ]);
    const birthdays: UpcomingBirthday[] = upcomingBirthdays(people)
        .filter((item) => item.projection.daysUntil <= options.birthdayWindowDays);
    const staleAll = staleContacts(store, people, options.staleThresholdDays, new Date(), cadences);
    const neverContactedPeople = staleAll.filter((item) => item.lastDaysAgo === undefined);

    const today = toLocalDateKey(new Date());
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
    const followUps: FollowUpCard[] = [
        ...buckets.overdue,
        ...buckets.today,
        ...buckets.upcoming,
    ].slice(0, 12).map(withBucket);

    return {
        people: people.length,
        relations: Math.round(people.reduce((sum, person) => sum + person.relatedItemIds.length, 0) / 2),
        birthdays,
        birthdaysThisWeek: birthdays.filter((item) => item.bucket === "today" || item.bucket === "week").length,
        stale: staleAll.slice(0, 20),
        neverContacted: neverContactedPeople.length,
        neverContactedItemIds: neverContactedPeople.map((item) => item.person.itemId),
        followUps,
    };
}
