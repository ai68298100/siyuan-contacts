/**
 * 本人身份存储（B11）：self-identity.json 的读写，经 storage 纪律层（锁 + 严格读 + 写后回读）。
 * 契约见 docs/DATA-CONTRACT.md §3 self-identity.json——身份唯一事实源；不静默改绑。
 */
import type { Plugin } from "siyuan";
import { loadJsonStrict, saveJsonVerified, withStoreLock } from "./storage";
import { normalizeSelfIdentity } from "../domain/self-identity";
import { toLocalDateKey } from "../domain/interactions";
import type { SelfIdentity } from "../domain/self-identity";

export const SELF_IDENTITY_STORAGE_KEY = "self-identity.json";

/** 严格展示读（FUNC-01.12）：键不存在返回 null（无本人），读取失败/损坏抛错 */
export async function loadSelfIdentity(plugin: Plugin): Promise<SelfIdentity | null> {
    return normalizeSelfIdentity(await loadJsonStrict(plugin, SELF_IDENTITY_STORAGE_KEY));
}

export class SelfIdentityConflictError extends Error {
    constructor(public readonly existingDocId: string) {
        super(`本人身份已存在（${existingDocId}）；换绑属修复流程，需显式操作并预览影响，已拒绝静默改绑`);
    }
}

/** 写入本人标记：已有**不同** selfDocId 时拒绝（防静默改绑）；相同则幂等跳过。须在锁内。 */
export async function saveSelfIdentity(
    plugin: Plugin,
    identity: { selfDocId: string; selfItemId: string; createdAt?: string },
): Promise<SelfIdentity> {
    return withStoreLock(SELF_IDENTITY_STORAGE_KEY, async () => {
        const existing = normalizeSelfIdentity(await loadJsonStrict(plugin, SELF_IDENTITY_STORAGE_KEY));
        if (existing && existing.selfDocId !== identity.selfDocId) {
            throw new SelfIdentityConflictError(existing.selfDocId);
        }
        const next: SelfIdentity = existing ?? {
            schemaVersion: 1,
            selfDocId: identity.selfDocId,
            selfItemId: identity.selfItemId,
            createdAt: identity.createdAt ?? toLocalDateKey(new Date()),
        };
        await saveJsonVerified(plugin, SELF_IDENTITY_STORAGE_KEY, next);
        return next;
    });
}
