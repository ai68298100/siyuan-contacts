/**
 * 组织服务（B13.2）：组织文档扫描（custom-lvct-org 标记区块，零写入）与成员关系查询投影。
 * 契约见 docs/DATA-CONTRACT.md §8——组织 = 文档 + 标记区块；成员关系存 org-membership.json；
 * 组织维度不写 related；扫描读取失败保持未知（不静默按无组织处理）。
 */
import type { Plugin } from "siyuan";
import { flushBlockIndex, readOrganizationFact, updateBlockMd, upsertMarkedBlock, findBlockIdByCustomAttr, deleteBlock } from "../api/blocks";
import { querySql } from "../api/client";
import { withStoreLock } from "../data/storage";
import { loadOrganizationOperations } from "../data/organization-operations";
import { organizationOperationComplete } from "../domain/organization-operations";
import { organizationMarkerStates, organizationsFromDocs } from "../domain/organization-scan";
import type { OrganizationSummary } from "../domain/organization-scan";
export type { OrganizationSummary } from "../domain/organization-scan";
import { escapeMarkdown, validateDocumentTitle } from "../domain/format";
import { startOrganizationCreate, startOrganizationRename } from "./organization-writes";
import {
    addOrgMembership,
    loadOrgMembershipStore,
    loadOrgMembershipStoreBound,
    removeOrgMembership,
    updateOrgMembership,
    replaceOrgMembership,
} from "../data/org-membership";
import type { OrgMembership, OrgMembershipPatch, OrgMembershipStatusFilter } from "../domain/org-membership";
import { buildCommonOrgBackground, pageOrgMemberships, sortOrgMemberships, buildOrgLinksSection } from "../domain/org-membership";
import type { CommonOrgBackground } from "../domain/org-membership";
import type { ContactsSettings } from "../domain/model";
import { getRoster } from "./roster";
import { listOrganizationMarkerPage, readOrganizationDocuments } from "../api/organization";
import { loadOrganizationProfile, loadOrganizationProfiles, saveOrganizationProfile } from "../data/organization-profiles";
import { organizationTemplateDraft } from "../domain/organization-profile";
import type { OrganizationProfileDraft } from "../domain/organization-profile";

export const ORG_SECTION_ATTR = "custom-lvct-org";
/** B13 归档语义：标记区块值 custom-lvct-org="archived" 表示组织已归档（文档与成员记录保留） */
export const ORG_ARCHIVED_VALUE = "archived";
export const ORG_LINKS_SECTION_ATTR = "custom-lvct-org-links";

/** 全库组织文档列举（单 SQL 找标记含归档值 + 单 SQL 取文档名，性能预算见 §4；零写入） */
export async function scanOrganizations(): Promise<OrganizationSummary[]> {
    const roots = await querySql<unknown>(
        `SELECT root_id, ial, COUNT(*) AS markerCount FROM blocks WHERE ial LIKE '%${ORG_SECTION_ATTR}="%' GROUP BY root_id, ial ORDER BY root_id, ial`,
    );
    const states = organizationMarkerStates(roots);
    const ids = [...states.keys()];
    if (ids.length === 0) return [];
    const idList = ids.map((id) => `'${id}'`).join(",");
    const docs = await querySql<unknown>(
        `SELECT id, content, hpath, box FROM blocks WHERE type='d' AND id IN (${idList})`,
    );
    return organizationsFromDocs(states, docs);
}

/** B13.9：组织标记冲突体检数据源。 */
export async function countOrgMarkers(): Promise<Map<string, number>> {
    const rows = await querySql<{ root_id: string; markers: number }>(
        `SELECT root_id, COUNT(id) AS markers FROM blocks WHERE ial LIKE '%${ORG_SECTION_ATTR}="%' GROUP BY root_id`,
    );
    return new Map(rows.map((row) => [row.root_id, Number(row.markers)]));
}

/** B13.9：人物文档组织链接区块反查与逐块清理。 */
export async function findOrgLinkBlocks(): Promise<Map<string, string>> {
    const rows = await querySql<{ root_id: string; id: string }>(
        `SELECT root_id, id FROM blocks WHERE ial LIKE '%${ORG_LINKS_SECTION_ATTR}="%'`,
    );
    return new Map(rows
        .filter((row) => typeof row.root_id === "string" && typeof row.id === "string")
        .map((row) => [row.root_id, row.id] as const));
}

export async function removeOrgLinkBlocks(blockIds: readonly string[]): Promise<Array<{ id: string; message: string }>> {
    const failures: Array<{ id: string; message: string }> = [];
    for (const id of blockIds) {
        try { await deleteBlock(id); } catch (error) { failures.push({ id, message: error instanceof Error ? error.message : String(error) }); }
    }
    return failures;
}

export async function syncPersonOrgLinksSection(plugin: Plugin, personDocId: string): Promise<void> {
    if (!/^\d{14}-[0-9a-z]{7}$/.test(personDocId)) throw new Error("personDocId 不是合法的思源 ID");
    const memberships = (await membershipsByPerson(plugin)).get(personDocId) ?? [];
    const names = new Map((await scanOrganizations()).filter((org) => !org.archived).map((org) => [org.docId, org.name] as const));
    const entries = memberships.filter((m) => m.status === "active" && names.has(m.orgDocId)).map((m) => ({
        orgDocId: m.orgDocId, orgName: names.get(m.orgDocId) ?? "", department: m.department, title: m.title,
    }));
    const existingId = await findBlockIdByCustomAttr(personDocId, ORG_LINKS_SECTION_ATTR);
    await upsertMarkedBlock(personDocId, ORG_LINKS_SECTION_ATTR, buildOrgLinksSection(entries), existingId);
}

export async function refreshPersonOrgLinkSections(plugin: Plugin, docIds: readonly string[]): Promise<Array<{ docId: string; message: string }>> {
    const failures: Array<{ docId: string; message: string }> = [];
    for (const docId of [...new Set(docIds)]) {
        try { await syncPersonOrgLinksSection(plugin, docId); }
        catch (error) { failures.push({ docId, message: error instanceof Error ? error.message : String(error) }); }
    }
    return failures;
}

/**
 * B12：人物 → 单位显示串（active 优先，其次最近一条成员记录）。
 * 形态：组织名 或 组织名 · 部门。供联系人卡片/选人提示等投影。
 */
export async function buildOrgDisplayByPerson(): Promise<Map<string, string>> {
    const [orgs, store] = await Promise.all([
        scanOrganizations(),
        loadOrgMembershipStoreBound(),
    ]);
    /* 单位行是活跃事实投影：归档组织不再参与（成员记录仍保留可核对） */
    const nameByDoc = new Map(orgs.filter((org) => !org.archived).map((org) => [org.docId, org.name]));
    const byPerson = new Map<string, OrgMembership[]>();
    for (const membership of store.memberships) {
        const list = byPerson.get(membership.personDocId) ?? [];
        list.push(membership);
        byPerson.set(membership.personDocId, list);
    }
    const display = new Map<string, string>();
    for (const [personDocId, list] of byPerson) {
        const eligible = sortOrgMemberships(list.filter((membership) => nameByDoc.has(membership.orgDocId)));
        const active = eligible.find((membership) => membership.status === "active") ?? eligible[eligible.length - 1];
        if (!active) continue;
        const orgName = nameByDoc.get(active.orgDocId);
        if (!orgName) continue;
        display.set(personDocId, active.department ? `${orgName} · ${active.department}` : orgName);
    }
    return display;
}

/** 成员关系查询：按组织聚合（active 在前、former 在后，各按加入日排序） */
export async function membershipsByOrganization(
    plugin: Plugin,
): Promise<Map<string, OrgMembership[]>> {
    const store = await loadOrgMembershipStore(plugin);
    const byOrg = new Map<string, OrgMembership[]>();
    for (const membership of store.memberships) {
        const list = byOrg.get(membership.orgDocId) ?? [];
        list.push(membership);
        byOrg.set(membership.orgDocId, list);
    }
    for (const list of byOrg.values()) {
        list.splice(0, list.length, ...sortOrgMemberships(list));
    }
    return byOrg;
}

/** 成员关系查询：按人物聚合（同键语义） */
export async function membershipsByPerson(
    plugin: Plugin,
): Promise<Map<string, OrgMembership[]>> {
    const store = await loadOrgMembershipStore(plugin);
    const byPerson = new Map<string, OrgMembership[]>();
    for (const membership of store.memberships) {
        const list = byPerson.get(membership.personDocId) ?? [];
        list.push(membership);
        byPerson.set(membership.personDocId, list);
    }
    for (const list of byPerson.values()) {
        list.splice(0, list.length, ...sortOrgMemberships(list));
    }
    return byPerson;
}

export interface OrganizationWithMembers extends OrganizationSummary {
    memberships: OrgMembership[];
    profile?: OrganizationProfileDraft;
}

export interface OrganizationPage {
    organizations: OrganizationWithMembers[];
    hasMore: boolean;
    nextRootId: string | null;
}

export interface OrganizationMember extends OrgMembership {
    /** 名册解析出的人物姓名；解绑后为「（已解绑）」 */
    personName: string;
}

export interface OrganizationMemberPage {
    items: OrganizationMember[];
    offset: number;
    limit: number;
    total: number;
    hasMore: boolean;
    /** 全部成员的人物 ID，用于分页时仍准确排除已加入联系人。 */
    personDocIds: string[];
    activePersonDocIds: string[];
}

/** 组织成员列举（join 名册取姓名）；人物已解绑显示「（已解绑）」 */
export async function listOrganizationMembers(
    plugin: Plugin,
    settings: ContactsSettings,
    orgDocId: string,
): Promise<OrganizationMember[]> {
    const memberships = (await membershipsByOrganization(plugin)).get(orgDocId) ?? [];
    const roster = await getRoster(settings);
    const byDoc = new Map(roster.map((person) => [person.docId, person.name]));
    return memberships.map((membership) => ({
        ...membership,
        personName: byDoc.get(membership.personDocId) ?? "（已解绑）",
    }));
}

/** B13.5b：成员筛选与稳定分页；读取失败上抛，空页与故障保持可区分。 */
export async function listOrganizationMembersPage(
    plugin: Plugin,
    settings: ContactsSettings,
    orgDocId: string,
    options: { query?: string; status?: OrgMembershipStatusFilter; offset?: number; limit?: number } = {},
): Promise<OrganizationMemberPage> {
    const all = await listOrganizationMembers(plugin, settings, orgDocId);
    const query = options.query?.trim().toLocaleLowerCase() ?? "";
    const filtered = query
        ? all.filter((member) => [member.personName, member.department, member.title]
            .some((value) => value.toLocaleLowerCase().includes(query)))
        : all;
    const page = pageOrgMemberships(filtered, options);
    return {
        ...page,
        personDocIds: [...new Set(all.map((member) => member.personDocId))],
        activePersonDocIds: [...new Set(all.filter((member) => member.status === "active").map((member) => member.personDocId))],
    };
}

/** 添加组织成员（active；id 锁内生成，重复添加幂等） */
export async function addOrganizationMember(
    plugin: Plugin,
    orgDocId: string,
    personDocId: string,
    extra: { department?: string; title?: string; joinedOn?: string } = {},
): Promise<void> {
    await addOrgMembership(plugin, {
        orgDocId,
        personDocId,
        department: extra.department,
        title: extra.title,
        joinedOn: extra.joinedOn,
    });
}

/** 移除组织成员记录（找不到 id 抛错） */
export async function removeOrganizationMember(plugin: Plugin, id: string): Promise<void> {
    await removeOrgMembership(plugin, id);
}

export interface PersonOrgMembershipView {
    /** 成员记录 ID（B13.5 双向编辑：人物详情内移除归属的定位键） */
    id: string;
    orgDocId: string;
    /** 组织名（标记区块扫描解析；组织文档不可达时为占位提示） */
    orgName: string;
    department: string;
    title: string;
    joinedOn: string;
    leftOn: string;
    status: OrgMembership["status"];
    affiliationKind?: OrgMembership["affiliationKind"];
    archived: boolean;
    reachable: boolean;
}

/** B12：某人的单位显示串（组织名 · 部门；无成员记录返回空串） */
export async function getOrgDisplayForDoc(personDocId: string): Promise<string> {
    const display = await buildOrgDisplayByPerson();
    return display.get(personDocId) ?? "";
}

/** B12：某人的组织归属投影（成员记录 join 组织名；组织文档不可达给占位） */
export async function listPersonOrgMemberships(
    plugin: Plugin,
    personDocId: string,
): Promise<PersonOrgMembershipView[]> {
    const memberships = (await membershipsByPerson(plugin)).get(personDocId) ?? [];
    const orgs = await scanOrganizations();
    const byDoc = new Map(orgs.map((org) => [org.docId, org]));
    return memberships.map((membership) => ({
        id: membership.id,
        orgDocId: membership.orgDocId,
        orgName: byDoc.get(membership.orgDocId)?.name ?? "（组织文档不可达）",
        department: membership.department,
        title: membership.title,
        joinedOn: membership.joinedOn,
        leftOn: membership.leftOn,
        status: membership.status,
        affiliationKind: membership.affiliationKind,
        archived: byDoc.get(membership.orgDocId)?.archived ?? false,
        reachable: byDoc.has(membership.orgDocId),
    }));
}

/** 组织列举（带成员记录）；扫描失败保持未知（上抛由调用方呈现） */
export async function listOrganizationsWithMembers(
    plugin: Plugin,
): Promise<OrganizationWithMembers[]> {
    const [orgs, byOrg, profiles] = await Promise.all([
        scanOrganizations(),
        membershipsByOrganization(plugin),
        loadOrganizationProfiles(plugin),
    ]);
    return orgs.map((org) => ({ ...org, memberships: byOrg.get(org.docId) ?? [], profile: profiles[org.docId] }));
}

/** B13.5c：组织标记按根文档游标渐进读取；重复标记由域层拒绝完整结论。 */
export async function listOrganizationsPage(
    plugin: Plugin,
    options: { afterRootId?: string; limit?: number } = {},
): Promise<OrganizationPage> {
    const markerPage = await listOrganizationMarkerPage(options.afterRootId ?? "", options.limit ?? 200);
    const states = organizationMarkerStates(markerPage.rows);
    const docs = await readOrganizationDocuments([...states.keys()]);
    const organizations = organizationsFromDocs(states, docs);
    const [byOrg, profiles] = await Promise.all([membershipsByOrganization(plugin), loadOrganizationProfiles(plugin)]);
    return {
        organizations: organizations.map((org) => ({ ...org, memberships: byOrg.get(org.docId) ?? [], profile: profiles[org.docId] })),
        hasMore: markerPage.hasMore,
        nextRootId: markerPage.nextRootId,
    };
}

/** 新建组织：建文档 + 写 custom-lvct-org 标记区块。同名组织拒绝（防重复建档；含已归档同名——文档仍在）。 */
export async function createOrganization(
    settings: ContactsSettings,
    name: string,
    plugin?: Plugin,
    profile?: OrganizationProfileDraft,
): Promise<{ docId: string; profileSaved?: boolean; profileError?: string }> {
    const titleError = validateDocumentTitle(name);
    if (titleError) throw new Error(titleError);
    const result = await startOrganizationCreate(plugin ?? plugin0(), settings, name);
    if (result.status !== "complete") throw new Error(`${result.message}（请求 ${result.operation.requestId}）`);
    if (!profile) return { docId: result.docId };
    try {
        await saveOrganizationProfile(plugin ?? plugin0(), result.docId, { ...profile, name });
        return { docId: result.docId, profileSaved: true };
    } catch (error) {
        return { docId: result.docId, profileSaved: false, profileError: error instanceof Error ? error.message : String(error) };
    }
}

export async function getOrganizationProfile(plugin: Plugin, docId: string): Promise<OrganizationProfileDraft | null> {
    return loadOrganizationProfile(plugin, docId);
}

export async function updateOrganizationProfile(plugin: Plugin, docId: string, profile: OrganizationProfileDraft): Promise<OrganizationProfileDraft> {
    const organization = (await scanOrganizations()).find((item) => item.docId === docId);
    if (!organization) throw new Error("组织不存在，资料未保存");
    if (organization.name.trim() !== profile.name.trim()) throw new Error("组织名称已变化，请先完成组织改名后再保存资料");
    return saveOrganizationProfile(plugin, docId, profile);
}

/** 初始化时保证内置“家庭”组织存在；重复运行只读检查，不会重复建档。 */
export async function ensureDefaultFamilyOrganization(plugin: Plugin, settings: ContactsSettings): Promise<{ docId: string; created: boolean }> {
    const existing = (await scanOrganizations()).find((org) => org.name.trim() === "家庭");
    if (existing) return { docId: existing.docId, created: false };
    const profile = organizationTemplateDraft("family");
    const created = await createOrganization(settings, profile.name, plugin, profile);
    return { docId: created.docId, created: true };
}

/** 归档组织（B13）：标记区块值写为 archived——活跃分组不再列出，文档与成员记录保留可恢复。
 *  标记块为插件管理区块，重写为标准文案（用户手改的标记块内容不保留）。 */
export async function archiveOrganization(orgDocId: string): Promise<void> {
    await setOrganizationArchived(orgDocId, true);
}

/** 恢复归档组织（B13）：标记区块值写回活跃 */
export async function restoreOrganization(orgDocId: string): Promise<void> {
    await setOrganizationArchived(orgDocId, false);
}

async function setOrganizationArchived(orgDocId: string, archived: boolean): Promise<void> {
    if (!/^\d{14}-[0-9a-z]{7}$/.test(orgDocId)) throw new Error("orgDocId 不是合法的思源 ID");
    await withStoreLock(`organization-state-${orgDocId}`, async () => {
        await flushBlockIndex();
        const org = (await scanOrganizations()).find((item) => item.docId === orgDocId);
        if (!org) throw new Error("组织不存在，未写入");
        if (org.archived === archived) return;
        const fact = await readOrganizationFact(orgDocId);
        if (fact.name !== org.name || (fact.marker.value === ORG_ARCHIVED_VALUE) !== org.archived) throw new Error("组织事实在归档前变化，未写入");
        const ial = fact.marker.ial.replace(/custom-lvct-org="(?:1|archived)"/, `${ORG_SECTION_ATTR}="${archived ? ORG_ARCHIVED_VALUE : "1"}"`);
        let writeError: unknown;
        try {
            await updateBlockMd(fact.marker.id, `**组织**：${escapeMarkdown(org.name)}\n${ial}`);
        } catch (error) {
            writeError = error;
        }
        try {
            await flushBlockIndex();
            const verified = (await scanOrganizations()).find((item) => item.docId === orgDocId);
            if (!verified || verified.archived !== archived) throw new Error("目标归档状态尚未匹配");
        } catch (cause) {
            throw new Error(`组织 ${orgDocId} ${archived ? "归档" : "恢复"}请求已发出但结果未核实；请重新读取核对，未自动重放`, { cause: writeError ?? cause });
        }
    });
}

/** 更新成员记录字段（B13.4：部门/职位/入职/离职/状态；身份字段不可变） */
export async function updateOrganizationMember(plugin: Plugin, id: string, patch: OrgMembershipPatch): Promise<void> {
    await updateOrgMembership(plugin, id, patch);
}

export async function replaceOrganizationMember(
    plugin: Plugin,
    formerMembershipId: string,
    successorPersonDocId: string,
    extra: { department?: string; title?: string; joinedOn: string; leftOn: string },
): Promise<void> {
    if (!/^\d{14}-[0-9a-z]{7}$/.test(formerMembershipId) || !/^\d{14}-[0-9a-z]{7}$/.test(successorPersonDocId)) {
        throw new Error("成员记录或联系人文档 ID 无效");
    }
    await replaceOrgMembership(plugin, {
        formerId: formerMembershipId,
        personDocId: successorPersonDocId,
        department: extra.department,
        title: extra.title,
        joinedOn: extra.joinedOn,
        leftOn: extra.leftOn,
    });
}

/**
 * B13.6 共同背景：当前人物与哪些联系人同组织（重叠期间/同期口径，零写入）。
 * 历史事实口径：含 former 成员与归档组织（与单位行的活跃口径不同）。
 * 名册读取失败上抛（读故障显式化）。
 */
export async function listCommonOrgBackground(
    plugin: Plugin,
    settings: ContactsSettings,
    personDocId: string,
): Promise<CommonOrgBackground[]> {
    const [index, orgs, roster] = await Promise.all([
        membershipsByPerson(plugin),
        scanOrganizations(),
        getRoster(settings),
    ]);
    return buildCommonOrgBackground({
        personDocId,
        membershipIndex: index,
        namesByDoc: new Map(roster.map((person) => [person.docId, person.name] as const)),
        orgNames: new Map(orgs.map((org) => [org.docId, org.name] as const)),
        contactsByDoc: new Map(roster.map((person) => [person.docId, person] as const)),
    });
}

/** 组织改名（B13.4 余项；spike:b13 通道7 实证 renameDoc 行为）：同名检查（不含自身、含归档）
 *  → renameDoc 改文档标题（标记块 IAL 保留）→ 标记块文案同步新名（保持归档值）。 */
export async function renameOrganization(orgDocId: string, name: string, plugin?: Plugin): Promise<void> {
    const titleError = validateDocumentTitle(name);
    if (titleError) throw new Error(titleError);
    if ((await readOrganizationFact(orgDocId)).name === name.trim()) {
        const storagePlugin = plugin ?? membershipPlugin;
        const pending = storagePlugin && (await loadOrganizationOperations(storagePlugin)).operations
            .find((operation) => operation.kind === "rename" && operation.docId === orgDocId && !organizationOperationComplete(operation));
        if (pending) throw new Error(`原改名请求尚未完整核实，请继续原步骤（请求 ${pending.requestId}）`);
        return;
    }
    const result = await startOrganizationRename(plugin ?? plugin0(), orgDocId, name);
    if (result.status !== "complete") throw new Error(`${result.message}（请求 ${result.operation.requestId}）`);
}

/** 供设置页/向导显示的组织锚点状态（只读） */
export async function orgAnchorSummary(settings: ContactsSettings): Promise<{ orgCount: number; membershipCount: number }> {
    const [orgs, store] = await Promise.all([
        scanOrganizations(),
        loadOrgMembershipStoreBound(),
    ]);
    void settings;
    return { orgCount: orgs.length, membershipCount: store.memberships.length };
}

/* roster 同款插件绑定模式：org 服务自身无 plugin 句柄，由 index.ts onload 装配 */
let membershipPlugin: import("siyuan").Plugin | undefined;
export function bindOrgMembershipStorage(plugin: import("siyuan").Plugin): void {
    membershipPlugin = plugin;
}
function plugin0(): import("siyuan").Plugin {
    if (!membershipPlugin) throw new Error("org-membership 存储尚未绑定插件实例");
    return membershipPlugin;
}
