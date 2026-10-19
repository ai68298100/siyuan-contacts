/**
 * E-30 群体活动与场合实体服务层（Occasions & Multi-attendee Clustering Service）
 * 支持群体活动创建、自动为所有参与者派生互动事件、列表查询与删除。
 */

import type { Plugin } from "siyuan";
import {
    deriveOccasionInteractionEvents,
    newOccasionId,
    validateOccasion,
    type OccasionEntity,
    type OccasionType,
    type OccasionAttendee,
} from "../domain/occasion-cluster.ts";
import {
    listOccasionEntities,
    removeOccasionEntity,
    saveOccasionEntity,
} from "../data/occasions.ts";
import { appendInteractionBatch } from "../data/interactions.ts";

export interface CreateOccasionInput {
    title: string;
    type: OccasionType;
    date: string;
    endDate?: string;
    place?: string;
    sourceDocId?: string;
    attendees: OccasionAttendee[];
    exchangeIds?: string[];
    note?: string;
    /** 是否自动为所有参与者派生时间线互动事件（默认 true） */
    deriveInteractions?: boolean;
}

/**
 * 创建群体活动实体：
 * 1. 严格业务与安全校验；
 * 2. 保存到 occasions.json；
 * 3. 若 deriveInteractions 为 true，调用 deriveOccasionInteractionEvents 为各参与者派生互动事件并批量写入 interaction-events.json；
 * 4. 返回新建的场合实体。
 */
export async function createOccasion(
    plugin: Plugin,
    input: CreateOccasionInput,
): Promise<OccasionEntity> {
    const now = Date.now();
    const occasion: OccasionEntity = {
        id: newOccasionId(),
        title: input.title.trim(),
        type: input.type,
        date: input.date,
        endDate: input.endDate,
        place: input.place?.trim() || undefined,
        sourceDocId: input.sourceDocId,
        attendees: input.attendees,
        exchangeIds: input.exchangeIds,
        note: input.note?.trim() || undefined,
        createdAt: now,
        updatedAt: now,
    };

    const errors = validateOccasion(occasion);
    if (errors.length > 0) {
        throw new Error(`创建群体活动失败：${errors.join("；")}`);
    }

    await saveOccasionEntity(plugin, occasion);

    if (input.deriveInteractions !== false) {
        const events = deriveOccasionInteractionEvents(occasion);
        await appendInteractionBatch(plugin, events);
    }

    return occasion;
}

/** 列出所有群体活动记录 */
export async function listOccasions(plugin: Plugin): Promise<OccasionEntity[]> {
    return listOccasionEntities(plugin);
}

/** 删除群体活动记录 */
export async function deleteOccasion(plugin: Plugin, occasionId: string): Promise<void> {
    await removeOccasionEntity(plugin, occasionId);
}
