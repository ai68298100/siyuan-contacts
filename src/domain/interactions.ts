/**
 * 互动事件投影（纯函数）：谁最近联系过、"久未联系"筛选。
 * 数据契约见 docs/DATA-CONTRACT.md §3：事件只追加、删除写墓碑、
 * source+externalRef 构成幂等身份。
 */
import type { ContactSummary } from "./person";

export type InteractionSource = "manual" | "diary" | "api";

export interface InteractionEvent {
    id: string;
    personDocId: string;
    /** 事件发生时刻（毫秒） */
    occurredAt: number;
    /** 用户本地日 YYYY-MM-DD（全库日期契约，禁止用毫秒差取整推算） */
    localDate: string;
    source: InteractionSource;
    /** 跨窗口/跨来源幂等键（与 source 配合） */
    externalRef?: string;
    note?: string;
}

export interface InteractionStore {
    schemaVersion: 1;
    events: InteractionEvent[];
    /** 已删除事件的 id 墓碑：同步重放不得复活 */
    tombstones: string[];
}

export const INTERACTION_STORE_VERSION = 1;

/** 读时归一：任何脏数据降级为空库，绝不抛错 */
export function normalizeInteractionStore(raw: unknown): InteractionStore {
    if (raw === null || typeof raw !== "object") return emptyStore();
    const record = raw as Partial<InteractionStore>;
    if (record.schemaVersion !== INTERACTION_STORE_VERSION) return emptyStore();
    const tombstones = Array.isArray(record.tombstones) ? record.tombstones.filter((id) => typeof id === "string") : [];
    const events = Array.isArray(record.events)
        ? record.events.filter((event): event is InteractionEvent => {
              if (event === null || typeof event !== "object") return false;
              if (typeof event.id !== "string" || event.id.length === 0) return false;
              if (typeof event.personDocId !== "string" || event.personDocId.length === 0) return false;
              if (typeof event.occurredAt !== "number" || !Number.isFinite(event.occurredAt)) return false;
              if (typeof event.localDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(event.localDate)) return false;
              return event.source === "manual" || event.source === "diary" || event.source === "api";
          })
        : [];
    const seenTombstones = new Set(tombstones);
    const deduped = new Map<string, InteractionEvent>();
    for (const event of events) {
        if (seenTombstones.has(event.id)) continue;
        const identity = event.externalRef ? `${event.source}:${event.externalRef}` : event.id;
        if (deduped.has(identity)) continue;
        deduped.set(identity, event);
    }
    return { schemaVersion: INTERACTION_STORE_VERSION, events: [...deduped.values()], tombstones };
}

export function emptyStore(): InteractionStore {
    return { schemaVersion: INTERACTION_STORE_VERSION, events: [], tombstones: [] };
}

/** 幂等判定：同 id 或同 source+externalRef 视为同一条 */
export function isDuplicateEvent(store: InteractionStore, event: InteractionEvent): boolean {
    if (store.tombstones.includes(event.id)) return true;
    return store.events.some(
        (existing) =>
            existing.id === event.id ||
            (event.externalRef !== undefined && existing.source === event.source && existing.externalRef === event.externalRef),
    );
}

/** 增量加入事件（纯函数返回新 store） */
export function appendEvent(store: InteractionStore, event: InteractionEvent): InteractionStore {
    if (isDuplicateEvent(store, event)) return store;
    return { ...store, events: [...store.events, event] };
}

/** 墓碑删除（纯函数） */
export function removeEvent(store: InteractionStore, eventId: string): InteractionStore {
    if (!store.events.some((event) => event.id === eventId)) return store;
    return {
        ...store,
        events: store.events.filter((event) => event.id !== eventId),
        tombstones: store.tombstones.includes(eventId) ? store.tombstones : [...store.tombstones, eventId],
    };
}

export interface StalenessInfo {
    person: ContactSummary;
    /** 最近一次互动的本地日；从未互动为 undefined */
    lastLocalDate?: string;
    /** 距今天数；从未互动为 undefined */
    lastDaysAgo?: number;
}

/** 每人最近互动投影 */
export function lastInteractionByPerson(
    store: InteractionStore,
    people: readonly ContactSummary[],
    now: Date = new Date(),
): Map<string, StalenessInfo> {
    const lastByDoc = new Map<string, InteractionEvent>();
    for (const event of store.events) {
        const current = lastByDoc.get(event.personDocId);
        if (!current || event.occurredAt > current.occurredAt) {
            lastByDoc.set(event.personDocId, event);
        }
    }
    const today = startOfLocalDay(now);
    const result = new Map<string, StalenessInfo>();
    for (const person of people) {
        const last = lastByDoc.get(person.docId);
        if (!last) {
            result.set(person.docId, { person });
            continue;
        }
        const lastDate = parseLocalDay(last.localDate);
        const daysAgo = lastDate ? daysBetweenLocal(lastDate, today) : undefined;
        result.set(person.docId, { person, lastLocalDate: last.localDate, lastDaysAgo: daysAgo });
    }
    return result;
}

/** 久未联系筛选：超过 thresholdDays 未互动（含从未互动），按最久优先排序 */
export function staleContacts(
    store: InteractionStore,
    people: readonly ContactSummary[],
    thresholdDays: number,
    now: Date = new Date(),
): StalenessInfo[] {
    const infos = [...lastInteractionByPerson(store, people, now).values()];
    return infos
        .filter((info) => info.lastDaysAgo === undefined || info.lastDaysAgo >= thresholdDays)
        .sort((a, b) => (b.lastDaysAgo ?? Number.MAX_SAFE_INTEGER) - (a.lastDaysAgo ?? Number.MAX_SAFE_INTEGER));
}

function startOfLocalDay(now: Date): Date {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function parseLocalDay(value: string): Date | undefined {
    const parts = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!parts) return undefined;
    return new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]));
}

function daysBetweenLocal(from: Date, to: Date): number {
    return Math.round((to.getTime() - from.getTime()) / 86400000);
}

/** 本地日 YYYY-MM-DD（唯一实现，禁止毫秒差取整） */
export function toLocalDateKey(now: Date = new Date()): string {
    const pad = (value: number) => String(value).padStart(2, "0");
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** 对外桥 recordInteraction 的确定性默认幂等键（同批人员+同日 → 同键，与人员顺序无关） */
export function defaultBridgeRef(personDocIds: readonly string[], date: string): string {
    return `bridge:${date}:${[...personDocIds].sort().join(",")}`;
}

/* ---------- 人物洞察：互动时间线与共同出席（纯投影） ---------- */

export interface TimelineItem {
    eventId: string;
    localDate: string;
    note?: string;
    source: InteractionSource;
    /** 同场人数（含本人）；同场事件才 >1 */
    groupSize: number;
}

/** 某人的互动时间线（按日期降序；同场事件按 externalRef 聚出人数） */
export function buildTimeline(
    events: readonly InteractionEvent[],
    personDocId: string,
): TimelineItem[] {
    const mine = events.filter((event) => event.personDocId === personDocId);
    const groupSizes = new Map<string, number>();
    for (const event of mine) {
        if (!event.externalRef) continue;
        const size = events.filter(
            (other) => other.externalRef === event.externalRef && other.source === event.source,
        ).length;
        groupSizes.set(event.id, size);
    }
    return mine
        .map((event) => ({
            eventId: event.id,
            localDate: event.localDate,
            ...(event.note ? { note: event.note } : {}),
            source: event.source,
            groupSize: groupSizes.get(event.id) ?? 1,
        }))
        .sort((a, b) => (a.localDate < b.localDate ? 1 : a.localDate > b.localDate ? -1 : 0));
}

export interface CoAttendance {
    otherDocId: string;
    count: number;
}

/**
 * 共同出席统计（D-0011 的可见化）：与 target 共享过同场身份（同 externalRef 且同来源）
 * 的其他联系人，按次数降序。只基于事实数据实时计算，不写入关系字段。
 */
export function buildCoAttendance(
    events: readonly InteractionEvent[],
    targetDocId: string,
): CoAttendance[] {
    const targetRefs = new Set(
        events
            .filter((event) => event.personDocId === targetDocId && event.externalRef)
            .map((event) => `${event.source}:${event.externalRef}`),
    );
    if (targetRefs.size === 0) return [];
    const counts = new Map<string, number>();
    for (const event of events) {
        if (event.personDocId === targetDocId) continue;
        const key = `${event.source}:${event.externalRef}`;
        if (!targetRefs.has(key)) continue;
        counts.set(event.personDocId, (counts.get(event.personDocId) ?? 0) + 1);
    }
    return [...counts.entries()]
        .map(([otherDocId, count]) => ({ otherDocId, count }))
        .sort((a, b) => b.count - a.count);
}
