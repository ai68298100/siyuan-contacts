/**
 * E-31 重复人物字段级合并落地与实体关联迁移服务（Duplicate Merge Service）
 * 执行主次人物字段写回、次人物自管数据无损迁移至主人物、次人物移入回收站安全缓冲并解绑。
 */

import type { Plugin } from "siyuan";
import type { ContactsSettings } from "../domain/model.ts";
import type { ContactDraft } from "../domain/person.ts";
import {
    resolveMergePlan,
    validateMergePlan,
    type ContactMergePlan,
    type MergeAuditSnapshot,
} from "../domain/duplicate-merge.ts";
import { writeDraftCells } from "./contacts.ts";
import { removeContactToTrash } from "./trash.ts";
import { invalidateRoster } from "./roster.ts";
import { emitDataChanged } from "../libs/data-events.ts";
import { saveJsonVerified, withStoreLock } from "../data/storage.ts";
import { INTERACTION_STORAGE_KEY, loadInteractionStoreStrict } from "../data/interactions.ts";
import { FOLLOW_UP_STORAGE_KEY, loadFollowUpStoreStrict } from "../data/followups.ts";
import { TOPICS_STORAGE_KEY, loadTopicsStoreStrict } from "../data/topics.ts";
import { GIFT_IDEAS_STORAGE_KEY, loadGiftIdeaStoreStrict } from "../data/gift-ideas.ts";
import { EXCHANGE_STORAGE_KEY } from "../data/exchanges.ts";
import { normalizeExchangeStoreForWrite } from "../domain/exchanges.ts";
import { loadJsonStrict } from "../data/storage.ts";
import { ORG_MEMBERSHIP_STORAGE_KEY, loadOrgMembershipStore } from "../data/org-membership.ts";

export interface ExecuteMergeResult {
    primaryDocId: string;
    secondaryDocId: string;
    mergedDraft: ContactDraft;
    auditSnapshot: MergeAuditSnapshot;
    migrated: {
        interactions: number;
        followUps: number;
        topics: number;
        giftIdeas: number;
        exchanges: number;
        memberships: number;
    };
}

/**
 * 执行定点字段级合并服务：
 * 1. 计划合法性校验（防同文档、防同行、防本人被销毁、防空姓名）；
 * 2. 计算决议 draft 与可逆审计快照；
 * 3. 写回主人物在属性视图（AV）中的字段；
 * 4. 锁内事务化迁移次人物的所有关联自管数据（互动事件、跟进待办、人情往来账本、谈资备忘、礼物点子偏好、组织归属）；
 * 5. 将次人物移入回收站缓冲 30 天，并从主库解绑行（思源人物文档安全保留）；
 * 6. 失效名册缓存并广播变更事件。
 */
export async function executeContactMerge(
    plugin: Plugin,
    settings: ContactsSettings,
    plan: ContactMergePlan,
): Promise<ExecuteMergeResult> {
    const errors = validateMergePlan(plan);
    if (errors.length > 0) {
        throw new Error(`合并计划校验失败：${errors.join("；")}`);
    }

    const { draft, auditSnapshot } = resolveMergePlan(plan);
    const primary = plan.primary;
    const secondary = plan.secondary;

    // 1. 写回主人物属性视图
    await writeDraftCells(settings, primary.itemId, draft, { mode: "edit" });

    const migrated = {
        interactions: 0,
        followUps: 0,
        topics: 0,
        giftIdeas: 0,
        exchanges: 0,
        memberships: 0,
    };

    // 2. 迁移互动事件（interaction-events.json）
    await withStoreLock(INTERACTION_STORAGE_KEY, async () => {
        const store = await loadInteractionStoreStrict(plugin);
        let changed = false;
        for (const event of store.events) {
            if (event.personDocId === secondary.docId) {
                event.personDocId = primary.docId;
                migrated.interactions += 1;
                changed = true;
            }
        }
        if (changed) {
            await saveJsonVerified(plugin, INTERACTION_STORAGE_KEY, store);
        }
    });

    // 3. 迁移跟进事项（follow-ups.json）
    await withStoreLock(FOLLOW_UP_STORAGE_KEY, async () => {
        const store = await loadFollowUpStoreStrict(plugin);
        let changed = false;
        for (const item of store.items) {
            if (item.personDocId === secondary.docId) {
                item.personDocId = primary.docId;
                item.updatedAt = Date.now();
                migrated.followUps += 1;
                changed = true;
            }
        }
        if (changed) {
            await saveJsonVerified(plugin, FOLLOW_UP_STORAGE_KEY, store);
        }
    });

    // 4. 迁移会面谈资与备忘（person-topics.json）
    await withStoreLock(TOPICS_STORAGE_KEY, async () => {
        const store = await loadTopicsStoreStrict(plugin);
        const secondaryTopics = store.topics[secondary.docId];
        if (secondaryTopics && secondaryTopics.length > 0) {
            const primaryList = store.topics[primary.docId] ? [...store.topics[primary.docId]] : [];
            // 将次要人物的话题合并进主人物（保持上限 15 条）
            for (const item of secondaryTopics) {
                if (primaryList.length < 15 && !primaryList.some((t) => t.id === item.id || t.text === item.text)) {
                    primaryList.push(item);
                    migrated.topics += 1;
                }
            }
            store.topics[primary.docId] = primaryList;
            delete store.topics[secondary.docId];
            await saveJsonVerified(plugin, TOPICS_STORAGE_KEY, store);
        }
    });

    // 5. 迁移礼物点子与偏好清单（gift-ideas.json）
    await withStoreLock(GIFT_IDEAS_STORAGE_KEY, async () => {
        const store = await loadGiftIdeaStoreStrict(plugin);
        const secondaryIdeas = store.ideas[secondary.docId];
        if (secondaryIdeas && secondaryIdeas.length > 0) {
            const primaryList = store.ideas[primary.docId] ? [...store.ideas[primary.docId]] : [];
            for (const item of secondaryIdeas) {
                if (primaryList.length < 30 && !primaryList.some((idea) => idea.id === item.id)) {
                    primaryList.push({ ...item, personDocId: primary.docId, updatedAt: Date.now() });
                    migrated.giftIdeas += 1;
                }
            }
            store.ideas[primary.docId] = primaryList;
            delete store.ideas[secondary.docId];
            await saveJsonVerified(plugin, GIFT_IDEAS_STORAGE_KEY, store);
        }
    });

    // 6. 迁移人情往来账本（exchange-records.json）
    await withStoreLock(EXCHANGE_STORAGE_KEY, async () => {
        const raw = await loadJsonStrict(plugin, EXCHANGE_STORAGE_KEY);
        const store = normalizeExchangeStoreForWrite(raw);
        let changed = false;
        for (const record of store.records) {
            if (record.personDocId === secondary.docId) {
                record.personDocId = primary.docId;
                record.updatedAt = Date.now();
                migrated.exchanges += 1;
                changed = true;
            }
        }
        if (changed) {
            await saveJsonVerified(plugin, EXCHANGE_STORAGE_KEY, store);
        }
    });

    // 7. 迁移组织成员归属（org-membership.json）
    await withStoreLock(ORG_MEMBERSHIP_STORAGE_KEY, async () => {
        const store = await loadOrgMembershipStore(plugin);
        let changed = false;
        for (const membership of store.memberships) {
            if (membership.personDocId === secondary.docId) {
                membership.personDocId = primary.docId;
                migrated.memberships += 1;
                changed = true;
            }
        }
        if (changed) {
            await saveJsonVerified(plugin, ORG_MEMBERSHIP_STORAGE_KEY, store);
        }
    });

    // 8. 将次人物移入回收站缓冲 30 天，并从主库解绑
    await removeContactToTrash(plugin, settings, secondary);

    // 9. 失效名册缓存并广播变更
    invalidateRoster();
    emitDataChanged({
        topics: ["people", "memberships"],
        docIds: [primary.docId, secondary.docId],
    });

    return {
        primaryDocId: primary.docId,
        secondaryDocId: secondary.docId,
        mergedDraft: draft,
        auditSnapshot,
        migrated,
    };
}
