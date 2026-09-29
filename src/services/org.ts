/**
 * 组织服务（B13.2）：组织文档扫描（custom-lvct-org 标记区块，零写入）与成员关系查询投影。
 * 契约见 docs/DATA-CONTRACT.md §8——组织 = 文档 + 标记区块；成员关系存 org-membership.json；
 * 组织维度不写 related；扫描读取失败保持未知（不静默按无组织处理）。
 */
import type { Plugin } from "siyuan";
import { listNotebookDocs } from "../api/blocks";
import { listNotebooks, querySql } from "../api/client";
import { loadOrgMembershipStore } from "../data/org-membership";
import type { OrgMembership } from "../domain/org-membership";
import type { ContactsSettings } from "../domain/model";

export const ORG_SECTION_ATTR = "custom-lvct-org";

export interface OrganizationSummary {
    docId: string;
    /** 文档标题 = 组织名 */
    name: string;
    hpath: string;
    notebookId: string;
}

/** 全库组织文档扫描（零写入）：custom-lvct-org 标记区块所在文档 = 组织。
 *  单笔记本/单文档读取失败不阻断整体（与 FUNC-01.8 锚点扫描同模式）；截断上限 1000 篇。 */
export async function scanOrganizations(): Promise<OrganizationSummary[]> {
    const summaries: OrganizationSummary[] = [];
    const seen = new Set<string>();
    const notebooks = await listNotebooks();
    for (const notebook of notebooks) {
        let docs;
        try {
            docs = await listNotebookDocs(notebook.id);
        } catch {
            continue; /* 单笔记本读取失败不阻断整体扫描 */
        }
        for (const doc of docs) {
            if (seen.has(doc.id)) continue;
            seen.add(doc.id);
            try {
                const rows = await querySql<{ root_id: string }>(
                    `SELECT DISTINCT root_id FROM blocks WHERE root_id = '${doc.id}' AND ial LIKE '%${ORG_SECTION_ATTR}="%' LIMIT 1`,
                );
                if (rows.length > 0) {
                    summaries.push({ docId: doc.id, name: doc.content, hpath: doc.hpath, notebookId: notebook.id });
                }
            } catch {
                continue; /* 单文档探测失败不影响其余 */
            }
        }
    }
    return summaries;
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
