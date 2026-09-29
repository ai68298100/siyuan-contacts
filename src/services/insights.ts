/**
 * 人物洞察服务：详情页的互动时间线与共同出席统计。
 */
import type { Plugin } from "siyuan";
import { loadInteractionStoreStrict } from "../data/interactions";
import { listContacts } from "./contacts";
import { buildCoAttendance, buildTimeline } from "../domain/interactions";
import type { CoAttendance, TimelineItem } from "../domain/interactions";
import type { ContactsSettings } from "../domain/model";

export interface PersonInsights {
    timeline: TimelineItem[];
    coAttendance: Array<CoAttendance & { name: string }>;
    totalEvents: number;
}

export async function loadPersonInsights(
    plugin: Plugin,
    settings: ContactsSettings,
    docId: string,
): Promise<PersonInsights> {
    const [store, roster] = await Promise.all([
        /* FUNC-01.12：时间线不得把读取失败呈现为空历史，抛错交由详情页错误态重试 */
        loadInteractionStoreStrict(plugin),
        listContacts(settings),
    ]);
    const nameByDoc = new Map(roster.map((person) => [person.docId, person.name]));
    const coAttendance = buildCoAttendance(store.events, docId)
        .map((item) => ({ ...item, name: nameByDoc.get(item.otherDocId) ?? "" }))
        .filter((item) => item.name.length > 0);
    return {
        timeline: buildTimeline(store.events, docId),
        coAttendance,
        totalEvents: store.events.filter((event) => event.personDocId === docId).length,
    };
}
