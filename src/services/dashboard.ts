/**
 * 仪表盘服务：近期生日、久未联系、统计概览。
 * plugin 显式传参（同 init.ts 惯例），组件侧经 facade 调用。
 */
import type { Plugin } from "siyuan";
import { listContacts } from "./contacts";
import { loadInteractionStoreStrict } from "../data/interactions";
import { loadFollowUpStoreStrict } from "../data/followups";
import { loadCadenceMapStrict } from "../data/cadences";
import { projectOpenFollowUps } from "../domain/followups";
import type { FollowUpBucket, FollowUpItem } from "../domain/followups";
import { staleContacts } from "../domain/interactions";
import { toLocalDateKey } from "../domain/interactions";
import { loadReminderDismissalsStrict } from "../data/reminder-dismissals";
import { isDismissed } from "../domain/reminder-dismissals";
import { ensureRegistryEntriesSaved, loadRegistryStrict } from "../data/registry";
import { isWithinGrace } from "../domain/registry";
import { buildActionCards } from "../domain/action-list";
import type { ActionCard, ActionPersonInput } from "../domain/action-list";
import { upcomingBirthdays } from "../domain/occasions";
import type { UpcomingBirthday } from "../domain/occasions";
import type { StalenessInfo } from "../domain/interactions";
import { emptyStore } from "../domain/interactions";
import { emptyFollowUpStore } from "../domain/followups";
import type { RegistryStore } from "../domain/registry";
import type { ContactsSettings } from "../domain/model";

export interface DashboardOptions {
    /** 多少天未互动算"久未联系" */
    staleThresholdDays: number;
    /** 生日提醒窗口（天） */
    birthdayWindowDays: number;
    /** C02 收编宽限期（天）：新收编者不计入「从未互动」提醒；0/缺省 = 关闭 */
    reminderGraceDays?: number;
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
    /** C02：「从未互动」行动卡的收编日期映射（docId → YYYY-MM-DD），组内最近收编优先 */
    neverOrder: Record<string, string>;
    /**
     * FUNC-01.12：读取失败的插件存储模块（仅非空时携带）。
     * 受影响模块以空数据参与投影并在 UI 显式提示，绝不把故障静默呈现为正常空态。
     */
    readFailures?: readonly string[];
}

/** 供组件派生使用的取值函数：把可空数据收窄为行动卡列表 */
export function pickActions(data: DashboardData | null): ActionCard[] {
    return data?.actions ?? [];
}

/** FUNC-01.12：单模块严格读；失败记入 readFailures 并以空数据参与投影（显式降级，不冒充正常空态） */
async function readModule<T>(failures: string[], key: string, read: () => Promise<T>, fallback: T): Promise<T> {
    try {
        return await read();
    } catch (error) {
        failures.push(key);
        console.warn(`[lvct] 仪表盘模块读取失败，已显式降级: ${key}`, error);
        return fallback;
    }
}

const EMPTY_REGISTRY: RegistryStore = { schemaVersion: 1, registeredAt: {} };

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
    const readFailures: string[] = [];
    const [people, store, followUpStore, cadences, dismissals] = await Promise.all([
        listContacts(settings),
        readModule(readFailures, "interactions", () => loadInteractionStoreStrict(plugin), emptyStore()),
        readModule(readFailures, "followUps", () => loadFollowUpStoreStrict(plugin), emptyFollowUpStore()),
        readModule(readFailures, "cadences", () => loadCadenceMapStrict(plugin), {}),
        readModule(readFailures, "dismissals", () => loadReminderDismissalsStrict(plugin), []),
    ]);
    const today = toLocalDateKey(new Date());
    // C02：首次发现补记收编时间（幂等，失败按缺失降级）；宽限期内不计入「从未互动」提醒
    await ensureRegistryEntriesSaved(plugin, people.map((person) => person.docId), today);
    const registry = await readModule(readFailures, "registry", () => loadRegistryStrict(plugin), EMPTY_REGISTRY);
    const graceDays = options.reminderGraceDays ?? 0;
    // B08：提醒暂缓只屏蔽呈现——生日与久未联系提醒行过滤，统计与名单口径保持真实
    const birthdays = upcomingBirthdays(people)
        .filter((item) => item.projection.daysUntil <= options.birthdayWindowDays)
        .filter((item) => !isDismissed(dismissals, item.person.docId, "birthday", today));
    const staleAll = staleContacts(store, people, options.staleThresholdDays, new Date(), cadences);
    const staleRemindable = staleAll.filter((info) => {
        if (isDismissed(dismissals, info.person.docId, "stale", today)) return false;
        /* C02：宽限期只豁免「从未互动」（有互动的久未联系不受影响） */
        if (info.lastDaysAgo === undefined && isWithinGrace(registry.registeredAt[info.person.docId], today, graceDays)) return false;
        return true;
    });
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

    const actions = buildActionCards(inputs, today);
    const neverOrder: Record<string, string> = {};
    for (const card of actions) {
        if (card.bucket !== "stale" || !card.reasons.some((reason) => reason.neverContacted)) continue;
        const registeredAt = registry.registeredAt[card.person.docId];
        if (registeredAt) neverOrder[card.person.docId] = registeredAt;
    }

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
        actions,
        neverOrder,
        ...(readFailures.length > 0 ? { readFailures } : {}),
    };
}
