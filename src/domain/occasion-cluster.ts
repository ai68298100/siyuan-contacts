/**
 * E-30 群体活动与独立场合实体（Occasion & Multi-attendee Clustering）
 * 将包含多位联系人、共同地点、日期的群体活动（项目会议/聚餐/婚礼等）抽象为统一场合记录，
 * 一次性生成参与者名单、人情往来账本关联与互动事件投影。
 * 纯函数：无 DOM、无 IO，node --test 直接可测。
 */

import { isValidDateKey } from "./date-key.ts";
import type { InteractionEvent } from "./interactions.ts";

export type OccasionType = "meeting" | "meal" | "wedding" | "party" | "trip" | "conference" | "other";

export const OCCASION_TYPES: readonly OccasionType[] = [
    "meeting",
    "meal",
    "wedding",
    "party",
    "trip",
    "conference",
    "other",
];

const DOC_ID_RE = /^\d{14}-[0-9a-z]{7}$/;

export interface OccasionAttendee {
    personDocId: string;
    name: string;
    role?: "host" | "guest" | "organizer";
}

export interface OccasionEntity {
    /** 稳定场合 ID（例如 14位时间戳-随机串） */
    id: string;
    /** 场合标题（例如：项目技术评审会 / 晓明婚礼 / 周五团队聚餐） */
    title: string;
    /** 场合分类 */
    type: OccasionType;
    /** 发生日期（必须为真实公历 YYYY-MM-DD） */
    date: string;
    /** 结束日期（若跨天，必须为真实公历 YYYY-MM-DD 且 >= date） */
    endDate?: string;
    /** 地点名称（不可含换行或路径分隔符） */
    place?: string;
    /** 关联的思源来源笔记文档 ID */
    sourceDocId?: string;
    /** 参与者列表（至少 1 位） */
    attendees: OccasionAttendee[];
    /** 关联的往来账本记录 ID（例如礼金、聚餐 AA 等） */
    exchangeIds?: string[];
    /** 场合备注内容 */
    note?: string;
    /** 创建时间戳（毫秒） */
    createdAt: number;
    /** 更新时间戳（毫秒） */
    updatedAt: number;
}

export function newOccasionId(): string {
    const stamp = new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);
    const random = Math.random().toString(36).slice(2, 9).padEnd(7, "0");
    return `${stamp}-${random}`;
}

/** 校验场合实体的业务与安全约束 */
export function validateOccasion(occasion: Partial<OccasionEntity>): string[] {
    const errors: string[] = [];

    const title = occasion.title?.trim() ?? "";
    if (!title) {
        errors.push("场合标题不能为空");
    } else if (title.length > 120) {
        errors.push("场合标题不能超过 120 个字符");
    }

    if (!occasion.type || !OCCASION_TYPES.includes(occasion.type)) {
        errors.push("未知的场合类型");
    }

    if (!occasion.date || !isValidDateKey(occasion.date)) {
        errors.push("发生日期必须是有效的 YYYY-MM-DD 公历日期");
    }

    if (occasion.endDate) {
        if (!isValidDateKey(occasion.endDate)) {
            errors.push("结束日期必须是有效的 YYYY-MM-DD 公历日期");
        } else if (occasion.date && occasion.endDate < occasion.date) {
            errors.push("结束日期不能早于发生日期");
        }
    }

    if (occasion.place) {
        const place = occasion.place.trim();
        if (place.length > 120) {
            errors.push("地点不能超过 120 个字符");
        }
        if (/[\u0000-\u001f\u007f\\/]/.test(place)) {
            errors.push("地点不能包含换行、控制字符或斜杠");
        }
    }

    if (occasion.sourceDocId && !DOC_ID_RE.test(occasion.sourceDocId)) {
        errors.push("来源笔记文档 ID 无效");
    }

    if (!Array.isArray(occasion.attendees) || occasion.attendees.length === 0) {
        errors.push("至少需要选择 1 位参与人员");
    } else {
        const seenDocIds = new Set<string>();
        for (let i = 0; i < occasion.attendees.length; i++) {
            const attendee = occasion.attendees[i];
            if (!attendee || typeof attendee !== "object") {
                errors.push(`第 ${i + 1} 位参与人格式无效`);
                continue;
            }
            if (!DOC_ID_RE.test(attendee.personDocId)) {
                errors.push(`参与人 ${attendee.name || i + 1} 的文档 ID 无效`);
            }
            if (seenDocIds.has(attendee.personDocId)) {
                errors.push(`存在重复参与人（${attendee.name || attendee.personDocId}）`);
            }
            seenDocIds.add(attendee.personDocId);
        }
    }

    return errors;
}

/**
 * 将群体场合投影为各参与者的互动事件（InteractionEvent）：
 * 每位参与者分配一条独立事件，共用外部引用 externalRef=occasion.id，
 * 使得时间线、共同出席洞察与图谱能够自动联动。
 */
export function deriveOccasionInteractionEvents(occasion: OccasionEntity): InteractionEvent[] {
    const errors = validateOccasion(occasion);
    if (errors.length > 0) {
        throw new Error(`无法派生互动事件：${errors.join("；")}`);
    }

    const typeLabels: Record<OccasionType, string> = {
        meeting: "会议",
        meal: "聚餐",
        wedding: "婚礼",
        party: "聚会",
        trip: "出行",
        conference: "论坛讲座",
        other: "活动",
    };

    const summaryPrefix = `[${typeLabels[occasion.type] ?? "活动"}] ${occasion.title}`;
    const baseNote = occasion.note?.trim() ? ` · ${occasion.note.trim()}` : "";
    const placeSuffix = occasion.place?.trim() ? ` @ ${occasion.place.trim()}` : "";

    const timestamp = new Date(`${occasion.date}T12:00:00`).getTime() || occasion.createdAt;

    return occasion.attendees.map((attendee) => {
        const otherNames = occasion.attendees
            .filter((a) => a.personDocId !== attendee.personDocId)
            .map((a) => a.name.trim())
            .filter(Boolean)
            .join("、");
        const withOthers = otherNames ? `（同行: ${otherNames}）` : "";

        return {
            id: `occ-${occasion.id}-${attendee.personDocId.slice(-7)}`,
            personDocId: attendee.personDocId,
            occurredAt: timestamp,
            localDate: occasion.date,
            source: "diary", // 与既有多人事项统一使用 diary source
            externalRef: occasion.id,
            note: `${summaryPrefix}${placeSuffix}${withOthers}${baseNote}`,
        };
    });
}
