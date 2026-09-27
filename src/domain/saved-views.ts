/**
 * 保存的联系人视图（F04）：命名保存组合筛选条件与排序，规则快照而非人物 ID 快照。
 * 应用时对当次名册重新求值；存储契约见 docs/DATA-CONTRACT.md §3 view-preferences.json#savedViews。
 * 纯函数：无 DOM、无 IO，node --test 直接可测。
 */
import type { PeopleSortMode } from "./preferences";
import type { TagMatchMode } from "./people-filters";

export interface SavedViewQuery {
    search: string;
    group: string;
    tags: string[];
    tagMatch: TagMatchMode;
    /** YYYY-MM-DD 或空串 */
    recentFrom: string;
    recentTo: string;
    neverContacted: boolean;
    sort: PeopleSortMode;
}

export interface SavedView {
    id: string;
    name: string;
    query: SavedViewQuery;
}

/** 保存视图数量上限：防止偏好文件无界增长 */
export const SAVED_VIEWS_LIMIT = 50;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isTagMatchMode(value: unknown): value is TagMatchMode {
    return value === "all" || value === "any";
}

function isPeopleSortMode(value: unknown): value is PeopleSortMode {
    return value === "name" || value === "group" || value === "birthday" || value === "recent";
}

function normalizeQuery(raw: unknown): SavedViewQuery | null {
    if (raw === null || typeof raw !== "object") return null;
    const record = raw as Record<string, unknown>;
    if (typeof record.search !== "string" || typeof record.group !== "string" ||
        !Array.isArray(record.tags) || !record.tags.every((tag) => typeof tag === "string") ||
        !isTagMatchMode(record.tagMatch) ||
        typeof record.neverContacted !== "boolean" ||
        !isPeopleSortMode(record.sort)) return null;
    return {
        search: record.search,
        group: record.group,
        tags: [...record.tags],
        tagMatch: record.tagMatch,
        recentFrom: typeof record.recentFrom === "string" && DATE_RE.test(record.recentFrom) ? record.recentFrom : "",
        recentTo: typeof record.recentTo === "string" && DATE_RE.test(record.recentTo) ? record.recentTo : "",
        neverContacted: record.neverContacted,
        sort: record.sort,
    };
}

/** 归一化：丢弃非法条目、按 id 去重、name 去首尾空白、截断到上限；非法输入回退空数组 */
export function normalizeSavedViews(raw: unknown): SavedView[] {
    if (!Array.isArray(raw)) return [];
    const seenIds = new Set<string>();
    const result: SavedView[] = [];
    for (const item of raw) {
        if (result.length >= SAVED_VIEWS_LIMIT) break;
        if (item === null || typeof item !== "object") continue;
        const record = item as Record<string, unknown>;
        if (typeof record.id !== "string" || record.id.length === 0 || typeof record.name !== "string") continue;
        const name = record.name.trim();
        if (!name) continue;
        const query = normalizeQuery(record.query);
        if (!query || seenIds.has(record.id)) continue;
        seenIds.add(record.id);
        result.push({ id: record.id, name, query });
    }
    return result;
}

/** 空名称或重名（大小写/空白敏感的精确同名）在保存通道由调用方用本函数给出确定行为 */
export function findSavedViewByName(views: readonly SavedView[], name: string): SavedView | undefined {
    const trimmed = name.trim();
    return views.find((view) => view.name === trimmed);
}

/** 求出视图中已不在可用标签集合里的标签（失效标签提示） */
export function missingTags(query: SavedViewQuery, availableTags: readonly string[]): string[] {
    const available = new Set(availableTags);
    return query.tags.filter((tag) => !available.has(tag));
}
