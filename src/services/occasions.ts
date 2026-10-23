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
import { findBlockIdByCustomAttr, upsertMarkedBlock, deleteBlock } from "../api/blocks.ts";
import { buildOccasionMarkdown, occasionMarkerAttr } from "../domain/occasion-links.ts";

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
    /** 是否在关联的思源主文档中同步受控参与人脉摘要块（默认有 sourceDocId 且此项不为 false 时执行） */
    syncDocumentBlock?: boolean;
}

/**
 * 创建群体活动实体：
 * 1. 严格业务与安全校验；
 * 2. 保存到 occasions.json；
 * 3. 若 deriveInteractions 为 true，调用 deriveOccasionInteractionEvents 为各参与者派生互动事件并批量写入 interaction-events.json；
 * 4. 若指定了 sourceDocId 且 syncDocumentBlock !== false，在思源主文档中幂等插入/更新受控参与人脉双链块；
 * 5. 返回新建的场合实体。
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

    // 关联思源主文档受控双链块投影
    if (input.syncDocumentBlock !== false && occasion.sourceDocId) {
        try {
            await projectOccasionToDocument(occasion);
        } catch (error) {
            console.warn("[LvContacts] 场合文档受控块投影失败:", error);
        }
    }

    return occasion;
}

/**
 * 将群体活动（Occasion）参与者信息投影到关联的思源笔记文档正文：
 * 采用受控双链标记块机制（带 custom-lvct-occasion-${occasionId} 属性），
 * 原地幂等覆盖或在文档末尾追加，确保思源原生反链面板与双链网络可正确索引。
 */
export async function projectOccasionToDocument(
    occasion: OccasionEntity,
    targetDocId?: string,
): Promise<{ docId: string; attrName: string } | null> {
    const docId = (targetDocId || occasion.sourceDocId || "").trim();
    if (!docId) return null;

    const attrName = occasionMarkerAttr(occasion.id);
    const projection = {
        sourceDocId: docId,
        sourceLabel: occasion.title,
        date: occasion.date,
        place: occasion.place,
        note: occasion.note,
        people: occasion.attendees.map((a) => ({
            docId: a.personDocId,
            name: a.name,
        })),
    };
    const markdown = buildOccasionMarkdown("source", projection);

    const existingId = await findBlockIdByCustomAttr(docId, attrName);
    await upsertMarkedBlock(docId, attrName, markdown, existingId);
    return { docId, attrName };
}

/**
 * 移除文档中对应场合的受控标记块（例如删除场合实体时清理）
 */
export async function removeOccasionDocumentProjection(
    occasion: OccasionEntity,
    targetDocId?: string,
): Promise<boolean> {
    const docId = (targetDocId || occasion.sourceDocId || "").trim();
    if (!docId) return false;

    const attrName = occasionMarkerAttr(occasion.id);
    const existingId = await findBlockIdByCustomAttr(docId, attrName);
    if (existingId) {
        await deleteBlock(existingId);
        return true;
    }
    return false;
}

/** 列出所有群体活动记录 */
export async function listOccasions(plugin: Plugin): Promise<OccasionEntity[]> {
    return listOccasionEntities(plugin);
}

/** 删除群体活动记录，并自动清理在思源主文档中的受控标记块 */
export async function deleteOccasion(plugin: Plugin, occasionId: string): Promise<void> {
    const occasions = await listOccasionEntities(plugin);
    const target = occasions.find((o) => o.id === occasionId);
    await removeOccasionEntity(plugin, occasionId);
    if (target?.sourceDocId) {
        try {
            await removeOccasionDocumentProjection(target);
        } catch {
            // 忽略未找到块或文档权限不足情况
        }
    }
}
