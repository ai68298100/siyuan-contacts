import { buildCoAttendance, buildTimeline } from "./interactions.ts";
import type { InteractionEvent } from "./interactions.ts";
import type { ContactSummary } from "./person.ts";

export interface MeetingBriefingItem {
    label: string;
    value: string;
}

/**
 * 会前简报只投影已有事实：最近互动、显式关系和共同出席。
 * 不做关系强弱推断，也不生成不存在于本地数据中的建议。
 */
export function buildMeetingBriefing(
    person: ContactSummary,
    roster: readonly ContactSummary[],
    events: readonly InteractionEvent[],
    /** B12：可选的追加行（如「单位」组织归属投影），按传入顺序附加在末尾 */
    extraRows: readonly MeetingBriefingItem[] = [],
): MeetingBriefingItem[] {
    const items: MeetingBriefingItem[] = [];
    const timeline = buildTimeline(events, person.docId);
    const latest = timeline[0];
    if (latest) {
        const detail = latest.note?.trim() || "互动记录";
        const group = latest.groupSize > 1 ? ` · ${latest.groupSize} 人同场` : "";
        items.push({ label: "最近互动", value: `${latest.localDate} · ${detail}${group}` });
    }

    const byItem = new Map(roster.map((item) => [item.itemId, item]));
    const relatedNames = person.relatedItemIds
        .map((itemId) => byItem.get(itemId)?.name ?? "")
        .filter(Boolean)
        .slice(0, 5);
    if (relatedNames.length > 0) {
        items.push({ label: "相关人物", value: relatedNames.join("、") });
    }

    const nameByDoc = new Map(roster.map((item) => [item.docId, item.name]));
    const coAttendance = buildCoAttendance(events, person.docId)
        .map((item) => ({ ...item, name: nameByDoc.get(item.otherDocId) ?? "" }))
        .filter((item) => item.name)
        .slice(0, 5);
    if (coAttendance.length > 0) {
        items.push({
            label: "共同出席",
            value: coAttendance.map((item) => `${item.name} ${item.count} 次`).join("、"),
        });
    }
    items.push(...extraRows);
    return items;
}
