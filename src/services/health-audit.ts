/**
 * FUNC-01.4/C04 资料体检服务：聚合名册/互动/跟进/组织四类只读数据，跑域层体检。
 * 零写入；与设置页字段健康检查（settings-health，查数据库结构）互为补充——
 * 本服务查数据内容质量，字段健康查库表结构。
 * C04 余项：并入疑似重复（复用 F13 findDuplicatePairs）与长期无互动（默认 90 天）。
 * B13.9：并入组织体检（孤儿成员/组织不可达/期间倒挂/重复在职/冲突标记）。
 */
import type { Plugin } from "siyuan";
import { listContacts } from "./contacts";
import { loadSelfIdentity } from "../data/self-identity";
import { excludeSelf } from "../domain/self-identity";
import { loadInteractionStoreStrict } from "../data/interactions";
import { loadFollowUpStoreStrict } from "../data/followups";
import { loadOrgMembershipStore } from "../data/org-membership";
import { countOrgMarkers, findOrgLinkBlocks, scanOrganizations } from "./org";
import { runHealthAudit, runOrgHealthAudit, DEFAULT_LONG_INACTIVE_DAYS } from "../domain/health-audit";
import type { AuditIssue } from "../domain/health-audit";
import type { ContactsSettings } from "../domain/model";
import { findDuplicatePairs } from "../domain/duplicate-check";

export async function auditWorkspaceData(plugin: Plugin, settings: ContactsSettings): Promise<AuditIssue[]> {
    /* FUNC-01.12：模块读取失败时指名受影响模块并中止体检，不得把故障当作空数据出报告 */
    const [peopleResult, storeResult, followUpResult, orgMembersResult, orgScanResult, markersResult, orgLinksResult] = await Promise.allSettled([
        listContacts(settings),
        loadInteractionStoreStrict(plugin),
        loadFollowUpStoreStrict(plugin),
        loadOrgMembershipStore(plugin),
        scanOrganizations(),
        countOrgMarkers(),
        findOrgLinkBlocks(),
    ]);
    const failed: string[] = [];
    if (peopleResult.status === "rejected") failed.push("名册");
    if (storeResult.status === "rejected") failed.push("互动记录");
    if (followUpResult.status === "rejected") failed.push("跟进计划");
    if (orgMembersResult.status === "rejected") failed.push("组织成员");
    if (orgScanResult.status === "rejected") failed.push("组织扫描");
    if (markersResult.status === "rejected") failed.push("组织标记统计");
    if (orgLinksResult.status === "rejected") failed.push("组织链接区块");
    if (failed.length > 0
        || peopleResult.status !== "fulfilled" || storeResult.status !== "fulfilled" || followUpResult.status !== "fulfilled"
        || orgMembersResult.status !== "fulfilled" || orgScanResult.status !== "fulfilled" || markersResult.status !== "fulfilled"
        || orgLinksResult.status !== "fulfilled") {
        throw new Error(`资料体检无法完成，以下数据读取失败：${failed.join("、") || "未知模块"}`);
    }
    const peopleAll = peopleResult.value;
    const people = excludeSelf(peopleAll, await loadSelfIdentity(plugin).catch(() => null)); /* B11.4：普通体检默认排除本人 */
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
    const personIssues = runHealthAudit({
        people,
        interactionCounts,
        lastInteractionAt,
        duplicatePairs,
        longInactiveDays: DEFAULT_LONG_INACTIVE_DAYS,
        followUps: followUpStore.items,
    });
    /* B13.9 组织体检：孤儿判定用全名册（本人可加入组织，排除在前）；组织扫描含归档（可达性） */
    const orgIssues = runOrgHealthAudit({
        memberships: orgMembersResult.value.memberships,
        rosterDocIds: new Set(peopleAll.map((person) => person.docId)),
        reachableOrgDocIds: new Set(orgScanResult.value.map((org) => org.docId)),
        orgNames: new Map(orgScanResult.value.map((org) => [org.docId, org.name] as const)),
        personNames: new Map(peopleAll.map((person) => [person.docId, person.name] as const)),
        markerCounts: markersResult.value,
        orgLinkBlockRoots: orgLinksResult.value,
        activePersonDocIds: new Set(
            orgMembersResult.value.memberships
                .filter((membership) => membership.status === "active")
                .map((membership) => membership.personDocId),
        ),
    });
    return [...personIssues, ...orgIssues];
}
