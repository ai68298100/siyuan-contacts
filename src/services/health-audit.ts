/**
 * FUNC-01.4 资料体检服务：聚合名册/互动/跟进三类只读数据，跑域层体检。
 * 零写入；与设置页字段健康检查（settings-health，查数据库结构）互为补充——
 * 本服务查数据内容质量，字段健康查库表结构。
 */
import type { Plugin } from "siyuan";
import { listContacts } from "./contacts";
import { loadInteractionStore } from "../data/interactions";
import { loadFollowUpStore } from "../data/followups";
import { runHealthAudit } from "../domain/health-audit";
import type { AuditIssue } from "../domain/health-audit";
import type { ContactsSettings } from "../domain/model";

export async function auditWorkspaceData(plugin: Plugin, settings: ContactsSettings): Promise<AuditIssue[]> {
    const [people, store, followUpStore] = await Promise.all([
        listContacts(settings),
        loadInteractionStore(plugin),
        loadFollowUpStore(plugin),
    ]);
    const tombstoned = new Set(store.tombstones);
    const interactionCounts: Record<string, number> = {};
    for (const event of store.events) {
        if (tombstoned.has(event.id)) continue;
        interactionCounts[event.personDocId] = (interactionCounts[event.personDocId] ?? 0) + 1;
    }
    return runHealthAudit({ people, interactionCounts, followUps: followUpStore.items });
}
