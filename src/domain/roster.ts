/**
 * 名册投影纯函数：新鲜度判定与渲染响应→名册的投影。
 * 有状态的缓存壳在 services/roster.ts（TTL + 写失效）。
 */
import type { AvRenderResult } from "../api/av";
import type { ContactsSettings } from "./model";
import type { ContactSummary } from "./person";
import { invertFieldMap, summaryFromRow } from "./person.ts";

export const ROSTER_TTL_MS = 30_000;

export interface RosterEntry {
    people: ContactSummary[];
    avId: string;
    fetchedAt: number;
}

/** 纯判定：缓存是否可用（avId 匹配 + TTL 内） */
export function isRosterFresh(entry: RosterEntry | null, avId: string, now: number, ttl: number = ROSTER_TTL_MS): boolean {
    return entry !== null && entry.avId === avId && now - entry.fetchedAt < ttl;
}

/** 从渲染响应投影名册（缓存重建与测试共用） */
export function rosterFromRender(rendered: AvRenderResult, fieldMap: ContactsSettings["fieldMap"]): ContactSummary[] {
    const keyToField = invertFieldMap(fieldMap);
    return (rendered.view?.rows ?? []).map((row) => summaryFromRow(row, keyToField));
}
