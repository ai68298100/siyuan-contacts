/**
 * 跟进备份解析（F05/FUNC-01.6-a）：导出快照与导入解析的往返纪律（纯函数）。
 * rawStore 兼容三种形态——字符串（JSON 文本快照）、对象（真实宿主 loadData 返回已解析对象）、
 * null/空串（首次未创建 = 空快照）；包络级版本校验，条目级由归一化容错过滤。
 * 契约见 docs/DATA-CONTRACT.md §3 follow-ups 行。
 */
import { FOLLOW_UP_STORE_VERSION, normalizeFollowUpStore } from "./followups.ts";
import type { FollowUpItem, FollowUpStore } from "./followups.ts";

/** 包络级兼容检查：版本与 items 数组必须合法 */
function isCompatibleStore(raw: unknown): boolean {
    return raw !== null && typeof raw === "object" &&
        (raw as Partial<FollowUpStore>).schemaVersion === FOLLOW_UP_STORE_VERSION &&
        Array.isArray((raw as Partial<FollowUpStore>).items);
}

/** 解析备份文本：接受新版导出包（含 rawStore）或裸事项库；损坏或未知版本拒绝（零写入） */
export function parseFollowUpBackup(text: string): FollowUpItem[] {
    let raw: unknown;
    try {
        raw = JSON.parse(text);
    } catch {
        throw new Error("备份文件不是有效的 JSON");
    }
    if (raw === null || typeof raw !== "object") throw new Error("备份版本不兼容，已拒绝导入");
    const record = raw as Record<string, unknown>;
    if ("rawStore" in record) {
        const rawStore = record.rawStore;
        /* 首次未创建文件的 null / 空串原样保留，表示空快照 */
        if (rawStore === null || rawStore === "") return [];
        if (typeof rawStore === "string") {
            let inner: unknown;
            try {
                inner = JSON.parse(rawStore);
            } catch {
                throw new Error("备份中的原始快照损坏，已拒绝导入");
            }
            if (!isCompatibleStore(inner)) throw new Error("备份版本不兼容，已拒绝导入");
            return normalizeFollowUpStore(inner).items;
        }
        /* FUNC-01.6-a：真实宿主 loadData 返回已解析对象——对象形态 rawStore 直接校验合并 */
        if (isCompatibleStore(rawStore)) return normalizeFollowUpStore(rawStore).items;
        throw new Error("备份版本不兼容，已拒绝导入");
    }
    if (!isCompatibleStore(raw)) throw new Error("备份版本不兼容，已拒绝导入");
    return normalizeFollowUpStore(raw).items;
}
