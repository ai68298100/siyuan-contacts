import { normalizeInteractionStore, normalizeInteractionStoreForWrite } from "./interactions.ts";
import type { InteractionEvent, InteractionStore } from "./interactions";

export interface InteractionImportSummary {
    added: number;
    skipped: number;
    removed: number;
    tombstonesAdded: number;
}

export function parseInteractionBackup(text: string): InteractionStore {
    let raw: unknown;
    try { raw = JSON.parse(text); } catch { throw new Error("备份不是有效的 JSON 文件"); }
    if (raw === null || typeof raw !== "object" || (raw as { schemaVersion?: unknown }).schemaVersion !== 1) {
        throw new Error("备份格式或版本不兼容");
    }
    const envelope = raw as Record<string, unknown>;
    return normalizeInteractionStoreForWrite(Object.hasOwn(envelope, "rawStore") ? envelope.rawStore : raw);
}

/** 现有记录优先，双方墓碑先合并，避免备份复活已删除事件。 */
export function mergeInteractionBackup(current: InteractionStore, incoming: InteractionStore): {
    store: InteractionStore; summary: InteractionImportSummary;
} {
    const tombstones = [...new Set([...current.tombstones, ...incoming.tombstones])];
    const base = normalizeInteractionStore({ ...current, tombstones });
    const removed = current.events.length - base.events.length;
    // 当前事件排在前面，批量归一化保持当前优先，避免逐条扫描和复制全库。
    const store = normalizeInteractionStore({ ...base, events: [...base.events, ...incoming.events] });
    const added = store.events.length - base.events.length;
    const skipped = incoming.events.length - added;
    return { store, summary: { added, skipped, removed, tombstonesAdded: tombstones.length - new Set(current.tombstones).size } };
}

// ---- F15 备份差异明细：按事件展开新增/跳过与删除标记影响（只读投影） ----

export interface BackupDiffEntry {
    eventId: string;
    localDate: string;
    personDocId: string;
    /** 名册可解析时的人物姓名；人物不可达（已解绑等）时缺省 */
    personName?: string;
    personFound?: boolean;
    source: string;
    note?: string;
    /** skipped 时的原因（现有记录已存在 / 备份内含对应删除标记） */
    reason?: string;
}

export interface TombstoneDiffEntry {
    tombstoneId: string;
    /** 当前库中存在对应事件 → 合并将移除该互动 */
    willRemove: boolean;
    removed?: { localDate: string; personDocId: string; note?: string };
}

export interface InteractionImportDiff {
    /** 将新增的备份事件 */
    added: BackupDiffEntry[];
    /** 将跳过（现状已有同 ID 或幂等身份重复）的备份事件 */
    skipped: BackupDiffEntry[];
    /** 备份中的删除标记及其影响 */
    tombstoneHits: TombstoneDiffEntry[];
    /** 备份内事件总数（added + skipped === incomingTotal） */
    incomingTotal: number;
}

function identityOf(event: InteractionEvent): string {
    return event.externalRef !== undefined
        ? JSON.stringify([event.personDocId, event.source, event.externalRef])
        : JSON.stringify([event.id]);
}

/**
 * 差异投影（纯函数）：对「当前库 × 备份」按与合并完全相同的口径（现状优先、幂等身份、
 * 墓碑防复活）分类备份事件与删除标记影响；nameByDoc 用于解析人物姓名，解析不到的
 * 标注 personFound=false（人物不可达）。合计约束：added.length + skipped.length === incomingTotal。
 */
export function diffInteractionImport(
    current: InteractionStore,
    incoming: InteractionStore,
    nameByDoc?: ReadonlyMap<string, string>,
): InteractionImportDiff {
    const mergedTombstones = [...new Set([...current.tombstones, ...incoming.tombstones])];
    const base = normalizeInteractionStore({ ...current, tombstones: mergedTombstones });
    const baseIdentities = new Set(base.events.map(identityOf));
    const baseIds = new Set(base.events.map((event) => event.id));

    const toEntry = (event: InteractionEvent): BackupDiffEntry => {
        const personName = nameByDoc?.get(event.personDocId);
        return {
            eventId: event.id,
            localDate: event.localDate,
            personDocId: event.personDocId,
            ...(personName ? { personName } : {}),
            source: event.source,
            ...(event.note !== undefined ? { note: event.note } : {}),
        };
    };
    const personFound = (event: InteractionEvent) => Boolean(nameByDoc?.has(event.personDocId));
    const toEntryWithFound = (event: InteractionEvent): BackupDiffEntry & { personFound: boolean } => ({
        ...toEntry(event),
        personFound: personFound(event),
    });

    const added: (BackupDiffEntry & { personFound: boolean })[] = [];
    const skipped: (BackupDiffEntry & { personFound: boolean })[] = [];
    const seenIncoming = new Set<string>();
    for (const event of incoming.events) {
        // 备份内自带对应删除标记：合并时墓碑优先，该事件不会新增（计入跳过保持合计守恒）
        if (mergedTombstones.includes(event.id)) {
            skipped.push({ ...toEntryWithFound(event), eventId: event.id, reason: "备份内含对应删除标记，不会新增" });
            continue;
        }
        if (baseIdentities.has(identityOf(event)) || baseIds.has(event.id) || seenIncoming.has(identityOf(event))) {
            skipped.push({ ...toEntryWithFound(event), eventId: event.id, reason: "本地已存在相同互动" });
        } else {
            seenIncoming.add(identityOf(event));
            added.push({ ...toEntryWithFound(event), eventId: event.id });
        }
    }

    const currentById = new Map(current.events.map((event) => [event.id, event]));
    const tombstoneHits: TombstoneDiffEntry[] = incoming.tombstones.map((tombstoneId) => {
        const target = currentById.get(tombstoneId);
        return target
            ? { tombstoneId, willRemove: true, removed: { localDate: target.localDate, personDocId: target.personDocId, ...(target.note !== undefined ? { note: target.note } : {}) } }
            : { tombstoneId, willRemove: false };
    });

    return { added, skipped, tombstoneHits, incomingTotal: incoming.events.length };
}
