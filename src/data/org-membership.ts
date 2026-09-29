/**
 * 组织成员关系存储（B13.2）：org-membership.json 的读写，经 storage 纪律层
 * （锁 + 严格读 + 写后回读）。契约见 docs/DATA-CONTRACT.md §8——
 * 展示读失败上抛（FUNC-01.12）；损坏当前库拒绝覆盖。
 */
import type { Plugin } from "siyuan";
import { loadJsonStrict, saveJsonVerified, withStoreLock } from "./storage";
import { normalizeOrgMembershipStore, normalizeOrgMembershipStoreForWrite, appendMembership, removeMembership } from "../domain/org-membership";
import type { OrgMembership, OrgMembershipStore } from "../domain/org-membership";
import { newNodeId } from "../api/client";

export const ORG_MEMBERSHIP_STORAGE_KEY = "org-membership.json";

/** 严格展示读（FUNC-01.12）：读取失败/损坏抛错，不按空索引处理 */
export async function loadOrgMembershipStore(plugin: Plugin): Promise<OrgMembershipStore> {
    return normalizeOrgMembershipStore(await loadJsonStrict(plugin, ORG_MEMBERSHIP_STORAGE_KEY));
}

export interface AddMembershipInput {
    orgDocId: string;
    personDocId: string;
    department?: string;
    title?: string;
    joinedOn?: string;
}

/** 新增成员记录：id 锁内生成；锁内严格读（损坏当前库拒绝覆盖）+ 写后回读 */
export async function addOrgMembership(plugin: Plugin, input: AddMembershipInput): Promise<OrgMembership> {
    return withStoreLock(ORG_MEMBERSHIP_STORAGE_KEY, async () => {
        const store = normalizeOrgMembershipStoreForWrite(await loadJsonStrict(plugin, ORG_MEMBERSHIP_STORAGE_KEY));
        const membership: OrgMembership = {
            id: newNodeId(),
            orgDocId: input.orgDocId,
            personDocId: input.personDocId,
            department: input.department?.trim() ?? "",
            title: input.title?.trim() ?? "",
            joinedOn: input.joinedOn ?? "",
            leftOn: "",
            status: "active",
        };
        const next = appendMembership(store, membership);
        if (next !== store) {
            await saveJsonVerified(plugin, ORG_MEMBERSHIP_STORAGE_KEY, next);
        }
        return membership;
    });
}

/** 移除成员记录（锁内严格读 + 写后回读）；找不到 id 抛错 */
export async function removeOrgMembership(plugin: Plugin, id: string): Promise<void> {
    await withStoreLock(ORG_MEMBERSHIP_STORAGE_KEY, async () => {
        const store = normalizeOrgMembershipStoreForWrite(await loadJsonStrict(plugin, ORG_MEMBERSHIP_STORAGE_KEY));
        const next = removeMembership(store, id);
        if (next === store) throw new Error(`成员记录 ${id} 不存在`);
        await saveJsonVerified(plugin, ORG_MEMBERSHIP_STORAGE_KEY, next);
    });
}
