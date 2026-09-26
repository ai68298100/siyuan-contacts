/**
 * 仪表盘服务：近期生日、久未联系、统计概览。
 * plugin 显式传参（同 init.ts 惯例），组件侧经 facade 调用。
 */
import type { Plugin } from "siyuan";
import { listContacts } from "./contacts";
import { loadInteractionStore } from "../data/interactions";
import { staleContacts } from "../domain/interactions";
import { upcomingBirthdays } from "../domain/occasions";
import type { UpcomingBirthday } from "../domain/occasions";
import type { StalenessInfo } from "../domain/interactions";
import type { ContactsSettings } from "../domain/model";
import type { ContactSummary } from "../domain/person";

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

export interface DashboardData {
    people: number;
    /** 无向关系条数（related 字段双向各记一次，除以 2） */
    relations: number;
    birthdays: UpcomingBirthday[];
    birthdaysThisWeek: number;
    stale: StalenessInfo[];
    neverContacted: number;
}

export async function loadDashboard(
    plugin: Plugin,
    settings: ContactsSettings,
    options: DashboardOptions = DEFAULT_DASHBOARD_OPTIONS,
): Promise<DashboardData> {
    const [people, store] = await Promise.all([
        listContacts(settings),
        loadInteractionStore(plugin),
    ]);
    const birthdays: UpcomingBirthday[] = upcomingBirthdays(people)
        .filter((item) => item.projection.daysUntil <= options.birthdayWindowDays);
    return {
        people: people.length,
        relations: Math.round(people.reduce((sum, person) => sum + person.relatedItemIds.length, 0) / 2),
        birthdays,
        birthdaysThisWeek: birthdays.filter((item) => item.bucket === "today" || item.bucket === "week").length,
        stale: staleContacts(store, people, options.staleThresholdDays).slice(0, 20),
        neverContacted: countNeverContacted(store.events.map((event) => event.personDocId), people),
    };
}

function countNeverContacted(contactedDocIds: readonly string[], people: readonly ContactSummary[]): number {
    const contacted = new Set(contactedDocIds);
    return people.filter((person) => !contacted.has(person.docId)).length;
}
