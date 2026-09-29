/**
 * FUNC-01.4/C04 资料体检服务：聚合名册/互动/跟进三类只读数据，跑域层体检。
 * 零写入；与设置页字段健康检查（settings-health，查数据库结构）互为补充——
 * 本服务查数据内容质量，字段健康查库表结构。
 * C04 余项：并入疑似重复（复用 F13 findDuplicatePairs）与长期无互动（默认 90 天）。
 */
import type { Plugin } from "siyuan";
import { listContacts } from "./contacts";
import { loadSelfIdentity } from "../data/self-identity";
import { excludeSelf } from "../domain/self-identity";
import { loadInteractionStoreStrict } from "../data/interactions";
import { loadFollowUpStoreStrict } from "../data/followups";
import { runHealthAudit, DEFAULT_LONG_INACTIVE_DAYS } from "../domain/health-audit";
import type { AuditIssue } from "../domain/health-audit";
import type { ContactsSettings } from "../domain/model";
import { findDuplicatePairs } from "../domain/duplicate-check";

export async function auditWorkspaceData(plugin: Plugin, settings: ContactsSettings): Promise<AuditIssue[]> {
    /* FUNC-01.12：插件库读取失败时指名受影响模块并中止体检，不得把故障当作空数据出报告 */
    const [peopleResult, storeResult, followUpResult] = await Promise.allSettled([
        listContacts(settings),
        loadInteractionStoreStrict(plugin),
        loadFollowUpStoreStrict(plugin),
    ]);
    const failed: string[] = [];
    if (peopleResult.status === "rejected") failed.push("名册");
    if (storeResult.status === "rejected") failed.push("互动记录");
    if (followUpResult.status === "rejected") failed.push("跟进计划");
    if (failed.length > 0 || peopleResult.status !== "fulfilled" || storeResult.status !== "fulfilled" || followUpResult.status !== "fulfilled") {
        throw new Error(`资料体检无法完成，以下数据读取失败：${failed.join("、") || "未知模块"}`);
    }
    const people = excludeSelf(peopleResult.value, await loadSelfIdentity(plugin).catch(() => null)); /* B11.4：普通体检默认排除本人 */
    const store = storeResult.value;
    const followUpStore = followUpResult.value;
    const tombstoned = new Set(store.tombstones);
    const interactionCounts: Record<string, number> = {};
    const lastInteractionAt: Record<string, number> = {};
    for (const event of store.events) {
        if (tombstoned.has(event.id)) continue;
        interactionCounts[event.personDocId] = (interactionCounts[event.personDocId] ?? 0) + 1;
        const known = lastInteractionAt[event.personDocId] ?? 0;
        if (event.occurredAt > known) lastInteractionAt[event.personDocId] = event.occurredAt;
    }
    const duplicatePairs: { a: { itemId: string; name: string }; b: { itemId: string; name: string } }[] =
        findDuplicatePairs(people).map((pair) => ({
            a: { itemId: pair.a.itemId, name: pair.a.name },
            b: { itemId: pair.b.itemId, name: pair.b.name },
        }));
    return runHealthAudit({
        people,
        interactionCounts,
        lastInteractionAt,
        duplicatePairs,
        longInactiveDays: DEFAULT_LONG_INACTIVE_DAYS,
        followUps: followUpStore.items,
    });
}
