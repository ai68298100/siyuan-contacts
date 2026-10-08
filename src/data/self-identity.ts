/**
 * 本人身份存储（B11）：self-identity.json 的读写，经 storage 纪律层（锁 + 严格读 + 写后回读）。
 * 契约见 docs/DATA-CONTRACT.md §3 self-identity.json——身份唯一事实源；不静默改绑。
 */
import type { Plugin } from "siyuan";
import { loadJsonStrict, saveJsonVerified, withStoreLock } from "./storage";
import { parseSelfIdentity } from "../domain/self-identity";
import { toLocalDateKey } from "../domain/interactions";
import type { SelfIdentity } from "../domain/self-identity";
import { MigrationWriteUnknownError } from "../domain/migration-records.ts";
import type { MigrationRecordSummary } from "../domain/migration-records.ts";

export const SELF_IDENTITY_STORAGE_KEY = "self-identity.json";

/** 模块级插件绑定：无 plugin 句柄的调用方（如 roster 投影）经此读取身份；
 *  由 index.ts onload 调用 bindSelfIdentityStorage 装配。未装配时按无身份处理。 */
let identityPlugin: Plugin | undefined;

export function bindSelfIdentityStorage(plugin: Plugin): void {
    identityPlugin = plugin;
}

function requirePlugin(): Plugin {
    if (!identityPlugin) throw new Error("self-identity 存储尚未绑定插件实例");
    return identityPlugin;
}

/** 绑定插件的严格展示读（roster 投影用；FUNC-01.12：失败上抛不按无本人处理） */
export async function loadSelfIdentityBound(): Promise<SelfIdentity | null> {
    if (!identityPlugin) return null;
    return parseSelfIdentity(await loadJsonStrict(requirePlugin(), SELF_IDENTITY_STORAGE_KEY));
}

/** 严格展示读（FUNC-01.12）：键不存在返回 null（无本人），读取失败/损坏抛错 */
export async function loadSelfIdentity(plugin: Plugin): Promise<SelfIdentity | null> {
    return parseSelfIdentity(await loadJsonStrict(plugin, SELF_IDENTITY_STORAGE_KEY));
}

export class SelfIdentityConflictError extends Error {
    constructor(public readonly existingDocId: string) {
        super(`本人身份已存在（${existingDocId}）；换绑属修复流程，需显式操作并预览影响，已拒绝静默改绑`);
    }
}

export interface SaveSelfIdentityOptions {
    /** B11.3/B11.5：显式改绑（设置页指定/修复流程）——覆盖已有不同 selfDocId */
    allowRebind?: boolean;
}

/** 写入本人标记：已有**不同** selfDocId 时默认拒绝（防静默改绑）；相同则幂等跳过。
 *  显式改绑须传 allowRebind: true（设置页指定/修复流程）。须在锁内。 */
export async function saveSelfIdentity(
    plugin: Plugin,
    identity: { selfDocId: string; selfItemId: string; createdAt?: string },
    options: SaveSelfIdentityOptions = {},
): Promise<SelfIdentity> {
    const submitted = parseSelfIdentity({ schemaVersion: 1, ...identity, createdAt: identity.createdAt ?? toLocalDateKey(new Date()) });
    if (!submitted) throw new Error("本人身份输入无效，未写入");
    return withStoreLock(SELF_IDENTITY_STORAGE_KEY, async () => {
        const existing = await loadSelfIdentity(plugin);
        if (existing && existing.selfDocId !== identity.selfDocId && !options.allowRebind) {
            throw new SelfIdentityConflictError(existing.selfDocId);
        }
        const next: SelfIdentity = {
            schemaVersion: 1,
            selfDocId: submitted.selfDocId,
            selfItemId: submitted.selfItemId,
            createdAt: existing?.createdAt ?? submitted.createdAt,
        };
        if (existing && JSON.stringify(existing) === JSON.stringify(next)) return existing;
        await saveJsonVerified(plugin, SELF_IDENTITY_STORAGE_KEY, next);
        return next;
    });
}

export async function mergeSelfIdentity(
    plugin: Plugin,
    incoming: SelfIdentity,
    targetItemId: string | null,
): Promise<MigrationRecordSummary> {
    const identity = parseSelfIdentity(incoming);
    if (!identity) throw new Error("本人恢复输入无效，未写入");
    return withStoreLock(SELF_IDENTITY_STORAGE_KEY, async () => {
        const current = await loadSelfIdentity(plugin);
        const reason = current && current.selfDocId !== identity.selfDocId ? "conflict" : targetItemId === null ? "unreachable" : null;
        if (reason) return { merged: 0, skipped: 1, removed: 0, issues: [{
            id: identity.selfDocId, personDocId: identity.selfDocId, reason,
            message: reason === "conflict" ? "当前本人是另一份档案，未覆盖；请核对后在设置中显式换绑"
                : "原本人文档不在当前数据库，未按同名替代；请恢复原文档并重绑后重试",
        }] };
        const next = parseSelfIdentity({ ...identity, selfItemId: targetItemId, createdAt: current?.createdAt ?? identity.createdAt });
        if (!next) throw new Error("本人目标绑定无效，未写入");
        if (current && JSON.stringify(current) === JSON.stringify(next)) return { merged: 0, skipped: 1, removed: 0, issues: [] };
        try {
            await saveJsonVerified(plugin, SELF_IDENTITY_STORAGE_KEY, next);
        } catch (cause) {
            throw new MigrationWriteUnknownError(cause);
        }
        return { merged: 1, skipped: 0, removed: 0, issues: [] };
    });
}

export async function changeSelfIdentityVerified(
    plugin: Plugin,
    expected: SelfIdentity | null,
    next: SelfIdentity | null,
): Promise<SelfIdentity | null> {
    const previous = parseSelfIdentity(expected);
    const submitted = parseSelfIdentity(next);
    return withStoreLock(SELF_IDENTITY_STORAGE_KEY, async () => {
        const current = await loadSelfIdentity(plugin);
        if (JSON.stringify(current) === JSON.stringify(submitted)) return current;
        if (JSON.stringify(current) !== JSON.stringify(previous)) throw new Error("本人身份已在预览后变化，未覆盖；请重新预览");
        try {
            await saveJsonVerified(plugin, SELF_IDENTITY_STORAGE_KEY, submitted);
        } catch (cause) {
            throw new Error("本人身份保存结果未知，请保留预览并先核实后重试", { cause });
        }
        return submitted;
    });
}
