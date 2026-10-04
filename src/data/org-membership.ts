/**
 * 组织成员关系存储（B13.2）：org-membership.json 的读写，经 storage 纪律层
 * （锁 + 严格读 + 写后回读）。契约见 docs/DATA-CONTRACT.md §8——
 * 展示读失败上抛（FUNC-01.12）；损坏当前库拒绝覆盖。
 */
import type { Plugin } from "siyuan";
import { loadJsonStrict, saveJsonVerified, withStoreLock } from "./storage";
import { normalizeOrgMembershipStoreForWrite, appendMembership, removeMembership, updateMembership, replaceMembership } from "../domain/org-membership";
import type { OrgAffiliationKind, OrgMembership, OrgMembershipPatch, OrgMembershipStore } from "../domain/org-membership";
import { newNodeId } from "../api/client";
import { mergeOrgMembershipBackup, MigrationWriteUnknownError } from "../domain/migration-records";
import type { MigrationRecordSummary } from "../domain/migration-records";

export const ORG_MEMBERSHIP_STORAGE_KEY = "org-membership.json";

function assertMembershipSnapshot(current: OrgMembership | undefined, expected?: OrgMembership): void {
    if (!expected) return;
    const normalized = normalizeOrgMembershipStoreForWrite({ schemaVersion: 1, memberships: [expected] }).memberships[0];
    if (!current || JSON.stringify(current) !== JSON.stringify(normalized)) throw new Error("成员记录在预览后变化，请重新读取核对；未覆盖新事实，本地草稿保留");
}

/** 模块级插件绑定：无 plugin 句柄的调用方（如 B12 单位投影）经此读取；
 *  由 index.ts onload 调用 bindOrgMembershipStorage 装配。未装配按空索引处理。 */
let membershipPlugin: Plugin | undefined;

export function bindOrgMembershipStorage(plugin: Plugin): void {
    membershipPlugin = plugin;
}

/** 绑定插件的严格展示读（B12 单位投影用；FUNC-01.12：失败上抛） */
export async function loadOrgMembershipStoreBound(): Promise<OrgMembershipStore> {
    return normalizeOrgMembershipStoreForWrite(await loadJsonStrict(requireBound(), ORG_MEMBERSHIP_STORAGE_KEY));
}

function requireBound(): Plugin {
    if (!membershipPlugin) throw new Error("org-membership 存储尚未绑定插件实例");
    return membershipPlugin;
}

/** 严格展示读（FUNC-01.12）：读取失败/损坏抛错，不按空索引处理 */
export async function loadOrgMembershipStore(plugin: Plugin): Promise<OrgMembershipStore> {
    return normalizeOrgMembershipStoreForWrite(await loadJsonStrict(plugin, ORG_MEMBERSHIP_STORAGE_KEY));
}

export interface AddMembershipInput {
    orgDocId: string;
    personDocId: string;
    department?: string;
    title?: string;
    joinedOn?: string;
    affiliationKind?: OrgAffiliationKind;
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
            ...(input.affiliationKind === undefined ? {} : { affiliationKind: input.affiliationKind }),
        };
        normalizeOrgMembershipStoreForWrite({ schemaVersion: 1, memberships: [membership] });
        const existing = store.memberships.find((entry) => entry.orgDocId === membership.orgDocId
            && entry.personDocId === membership.personDocId && entry.status === "active");
        if (existing) return existing;
        if (store.memberships.some((entry) => entry.id === membership.id) || store.tombstones?.includes(membership.id)) throw new Error("新成员 ID 已使用或已删除，未新增记录");
        const next = appendMembership(store, membership);
        if (next !== store) {
            await saveJsonVerified(plugin, ORG_MEMBERSHIP_STORAGE_KEY, next);
        }
        return membership;
    });
}

/** 移除成员记录（锁内严格读 + 写后回读）；找不到 id 抛错 */
export async function removeOrgMembership(plugin: Plugin, id: string, expected?: OrgMembership): Promise<OrgMembership> {
    return withStoreLock(ORG_MEMBERSHIP_STORAGE_KEY, async () => {
        const store = normalizeOrgMembershipStoreForWrite(await loadJsonStrict(plugin, ORG_MEMBERSHIP_STORAGE_KEY));
        assertMembershipSnapshot(store.memberships.find((membership) => membership.id === id), expected);
        const next = removeMembership(store, id);
        if (next === store) throw new Error(`成员记录 ${id} 不存在`);
        await saveJsonVerified(plugin, ORG_MEMBERSHIP_STORAGE_KEY, next);
        return store.memberships.find((membership) => membership.id === id)!;
    });
}

/** 更新成员记录字段（B13.4；锁内严格读 + 写后回读）。找不到 id 或补丁非法抛错，身份字段不可变 */
export async function updateOrgMembership(plugin: Plugin, id: string, patch: OrgMembershipPatch, expected?: OrgMembership): Promise<OrgMembership> {
    return withStoreLock(ORG_MEMBERSHIP_STORAGE_KEY, async () => {
        const store = normalizeOrgMembershipStoreForWrite(await loadJsonStrict(plugin, ORG_MEMBERSHIP_STORAGE_KEY));
        assertMembershipSnapshot(store.memberships.find((membership) => membership.id === id), expected);
        const next = updateMembership(store, id, patch);
        if (!next) throw new Error(`成员记录 ${id} 不存在或更新内容非法`);
        if (next !== store) {
            await saveJsonVerified(plugin, ORG_MEMBERSHIP_STORAGE_KEY, next);
        }
        return next.memberships.find((membership) => membership.id === id)!;
    });
}

export interface ReplaceMembershipInput {
    formerId: string;
    personDocId: string;
    department?: string;
    title?: string;
    joinedOn: string;
    leftOn: string;
    affiliationKind?: OrgAffiliationKind;
}

export async function replaceOrgMembership(plugin: Plugin, input: ReplaceMembershipInput, expected?: OrgMembership): Promise<OrgMembership> {
    return withStoreLock(ORG_MEMBERSHIP_STORAGE_KEY, async () => {
        const store = normalizeOrgMembershipStoreForWrite(await loadJsonStrict(plugin, ORG_MEMBERSHIP_STORAGE_KEY));
        const former = store.memberships.find((item) => item.id === input.formerId);
        assertMembershipSnapshot(former, expected);
        if (!former) throw new Error(`成员记录 ${input.formerId} 不存在`);
        const successor: OrgMembership = {
            id: newNodeId(),
            orgDocId: former.orgDocId,
            personDocId: input.personDocId,
            department: input.department?.trim() ?? "",
            title: input.title?.trim() ?? "",
            joinedOn: input.joinedOn,
            leftOn: "",
            status: "active",
            ...(input.affiliationKind === undefined ? {} : { affiliationKind: input.affiliationKind }),
        };
        const next = replaceMembership(store, input.formerId, successor, input.leftOn);
        if (!next) throw new Error("成员替换无效：旧成员必须在职，新成员不能已在该组织任职，日期和组织必须匹配");
        await saveJsonVerified(plugin, ORG_MEMBERSHIP_STORAGE_KEY, next);
        return successor;
    });
}

export async function mergeOrgMembershipStore(
    plugin: Plugin, raw: unknown, reachablePeople: ReadonlySet<string>, reachableOrganizations: ReadonlySet<string>,
): Promise<MigrationRecordSummary> {
    const incoming = normalizeOrgMembershipStoreForWrite(raw);
    return withStoreLock(ORG_MEMBERSHIP_STORAGE_KEY, async () => {
        const current = await loadOrgMembershipStore(plugin);
        const { store, summary } = mergeOrgMembershipBackup(current, incoming, reachablePeople, reachableOrganizations);
        if (summary.merged > 0 || summary.removed > 0 || (store.tombstones?.length ?? 0) > (current.tombstones?.length ?? 0)) {
            try { await saveJsonVerified(plugin, ORG_MEMBERSHIP_STORAGE_KEY, normalizeOrgMembershipStoreForWrite(store)); }
            catch (cause) { throw new MigrationWriteUnknownError(cause); }
        }
        return summary;
    });
}
