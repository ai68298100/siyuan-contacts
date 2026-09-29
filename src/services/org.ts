/**
 * 组织服务（B13.2）：组织文档扫描（custom-lvct-org 标记区块，零写入）与成员关系查询投影。
 * 契约见 docs/DATA-CONTRACT.md §8——组织 = 文档 + 标记区块；成员关系存 org-membership.json；
 * 组织维度不写 related；扫描读取失败保持未知（不静默按无组织处理）。
 */
import type { Plugin } from "siyuan";
import { upsertMarkedBlock } from "../api/blocks";
import { createDocWithMd, querySql, renameDoc } from "../api/client";
import {
    addOrgMembership,
    loadOrgMembershipStore,
    loadOrgMembershipStoreBound,
    removeOrgMembership,
    updateOrgMembership,
} from "../data/org-membership";
import type { OrgMembership, OrgMembershipPatch } from "../domain/org-membership";
import type { ContactsSettings } from "../domain/model";
import { listContacts } from "./contacts";

export const ORG_SECTION_ATTR = "custom-lvct-org";
/** B13 归档语义：标记区块值 custom-lvct-org="archived" 表示组织已归档（文档与成员记录保留） */
export const ORG_ARCHIVED_VALUE = "archived";

export interface OrganizationSummary {
    docId: string;
    /** 文档标题 = 组织名 */
    name: string;
    hpath: string;
    notebookId: string;
    /** B13：标记区块值为 archived（归档组织不进关系图/单位投影，文档与成员记录保留可恢复） */
    archived: boolean;
}

/** 解析标记区块 IAL 中的归档值；非 archived 值一律按活跃处理（向前兼容） */
function isArchivedIal(ial: string): boolean {
    const match = String(ial ?? "").match(new RegExp(`${ORG_SECTION_ATTR}="([^"]*)"`));
    return match?.[1] === ORG_ARCHIVED_VALUE;
}

/** 全库组织文档列举（单 SQL 找标记含归档值 + 单 SQL 取文档名，性能预算见 §4；零写入） */
export async function scanOrganizations(): Promise<OrganizationSummary[]> {
    const roots = await querySql<{ root_id: string; ial: string }>(
        `SELECT DISTINCT root_id, ial FROM blocks WHERE ial LIKE '%${ORG_SECTION_ATTR}="%'`,
    );
    const ids = roots.map((row) => row.root_id).filter((id) => /^\d{14}-[0-9a-z]{7}$/.test(id));
    if (ids.length === 0) return [];
    const archivedByRoot = new Map(roots.map((row) => [row.root_id, isArchivedIal(row.ial)]));
    const idList = ids.map((id) => `'${id}'`).join(",");
    const docs = await querySql<{ id: string; content: string; hpath: string; box: string }>(
        `SELECT id, content, hpath, box FROM blocks WHERE type='d' AND id IN (${idList})`,
    );
    return docs.map((doc) => ({
        docId: doc.id,
        name: doc.content,
        hpath: doc.hpath,
        notebookId: doc.box ?? "",
        archived: archivedByRoot.get(doc.id) ?? false,
    }));
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
        const active = list.find((membership) => membership.status === "active") ?? list[list.length - 1];
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
        list.sort((a, b) => a.joinedOn.localeCompare(b.joinedOn) || a.id.localeCompare(b.id));
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
        list.sort((a, b) => a.joinedOn.localeCompare(b.joinedOn) || a.id.localeCompare(b.id));
    }
    return byPerson;
}

export interface OrganizationWithMembers extends OrganizationSummary {
    memberships: OrgMembership[];
}

export interface OrganizationMember extends OrgMembership {
    /** 名册解析出的人物姓名；解绑后为「（已解绑）」 */
    personName: string;
}

/** 组织成员列举（join 名册取姓名）；人物已解绑显示「（已解绑）」 */
export async function listOrganizationMembers(
    plugin: Plugin,
    settings: ContactsSettings,
    orgDocId: string,
): Promise<OrganizationMember[]> {
    const memberships = (await membershipsByOrganization(plugin)).get(orgDocId) ?? [];
    const roster = await listContacts(settings);
    const byDoc = new Map(roster.map((person) => [person.docId, person.name]));
    return memberships.map((membership) => ({
        ...membership,
        personName: byDoc.get(membership.personDocId) ?? "（已解绑）",
    }));
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
    orgDocId: string;
    /** 组织名（标记区块扫描解析；组织文档不可达时为占位提示） */
    orgName: string;
    department: string;
    title: string;
    joinedOn: string;
    leftOn: string;
    status: OrgMembership["status"];
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
    const byDoc = new Map(orgs.map((org) => [org.docId, org.name]));
    return memberships.map((membership) => ({
        orgDocId: membership.orgDocId,
        orgName: byDoc.get(membership.orgDocId) ?? "（组织文档不可达）",
        department: membership.department,
        title: membership.title,
        joinedOn: membership.joinedOn,
        leftOn: membership.leftOn,
        status: membership.status,
    }));
}

/** 组织列举（带成员记录）；扫描失败保持未知（上抛由调用方呈现） */
export async function listOrganizationsWithMembers(
    plugin: Plugin,
): Promise<OrganizationWithMembers[]> {
    const [orgs, byOrg] = await Promise.all([
        scanOrganizations(),
        membershipsByOrganization(plugin),
    ]);
    return orgs.map((org) => ({ ...org, memberships: byOrg.get(org.docId) ?? [] }));
}

/** 新建组织：建文档 + 写 custom-lvct-org 标记区块。同名组织拒绝（防重复建档；含已归档同名——文档仍在）。 */
export async function createOrganization(
    settings: ContactsSettings,
    name: string,
): Promise<{ docId: string }> {
    const trimmed = name.trim();
    if (!trimmed) throw new Error("组织名称不能为空");
    const orgs = await scanOrganizations();
    if (orgs.some((org) => org.name === trimmed)) {
        throw new Error(`组织「${trimmed}」已存在`);
    }
    const docId = await createDocWithMd(settings.notebookId, `/${trimmed}`, `# ${trimmed}\n\n`);
    if (!docId) throw new Error(`创建组织文档「${trimmed}」失败`);
    await upsertMarkedBlock(docId, ORG_SECTION_ATTR, `**组织**：${trimmed}`, undefined);
    return { docId };
}

/** 归档组织（B13）：标记区块值写为 archived——活跃分组不再列出，文档与成员记录保留可恢复。
 *  标记块为插件管理区块，重写为标准文案（用户手改的标记块内容不保留）。 */
export async function archiveOrganization(orgDocId: string): Promise<void> {
    if (!/^\d{14}-[0-9a-z]{7}$/.test(orgDocId)) throw new Error("orgDocId 不是合法的思源 ID");
    const org = (await scanOrganizations()).find((item) => item.docId === orgDocId);
    if (!org) throw new Error("组织不存在");
    if (org.archived) throw new Error("组织已处于归档状态");
    await upsertMarkedBlock(orgDocId, ORG_SECTION_ATTR, `**组织**：${org.name}`, undefined, ORG_ARCHIVED_VALUE);
}

/** 恢复归档组织（B13）：标记区块值写回活跃 */
export async function restoreOrganization(orgDocId: string): Promise<void> {
    if (!/^\d{14}-[0-9a-z]{7}$/.test(orgDocId)) throw new Error("orgDocId 不是合法的思源 ID");
    const org = (await scanOrganizations()).find((item) => item.docId === orgDocId);
    if (!org) throw new Error("组织不存在");
    if (!org.archived) throw new Error("组织不在归档状态");
    await upsertMarkedBlock(orgDocId, ORG_SECTION_ATTR, `**组织**：${org.name}`, undefined);
}

/** 更新成员记录字段（B13.4：部门/职位/入职/离职/状态；身份字段不可变） */
export async function updateOrganizationMember(plugin: Plugin, id: string, patch: OrgMembershipPatch): Promise<void> {
    await updateOrgMembership(plugin, id, patch);
}

/** 组织改名（B13.4 余项；spike:b13 通道7 实证 renameDoc 行为）：同名检查（不含自身、含归档）
 *  → renameDoc 改文档标题（标记块 IAL 保留）→ 标记块文案同步新名（保持归档值）。 */
export async function renameOrganization(orgDocId: string, name: string): Promise<void> {
    if (!/^\d{14}-[0-9a-z]{7}$/.test(orgDocId)) throw new Error("orgDocId 不是合法的思源 ID");
    const trimmed = name.trim();
    if (!trimmed) throw new Error("组织名称不能为空");
    const orgs = await scanOrganizations();
    const org = orgs.find((item) => item.docId === orgDocId);
    if (!org) throw new Error("组织不存在");
    if (orgs.some((item) => item.docId !== orgDocId && item.name === trimmed)) {
        throw new Error(`组织「${trimmed}」已存在`);
    }
    if (org.name === trimmed) return;
    await renameDoc(org.notebookId, orgDocId, trimmed);
    await upsertMarkedBlock(
        orgDocId,
        ORG_SECTION_ATTR,
        `**组织**：${trimmed}`,
        undefined,
        org.archived ? ORG_ARCHIVED_VALUE : "1",
    );
}

/** 供设置页/向导显示的组织锚点状态（只读） */
export async function orgAnchorSummary(settings: ContactsSettings): Promise<{ orgCount: number; membershipCount: number }> {
    const [orgs, store] = await Promise.all([
        scanOrganizations(),
        loadOrgMembershipStore(plugin0()).catch(() => null),
    ]);
    void settings;
    return { orgCount: orgs.length, membershipCount: store?.memberships.length ?? 0 };
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
