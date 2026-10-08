/** 工作台视图偏好：仅影响界面默认行为，不改变联系人数据库。 */
import { normalizeSavedViews } from "./saved-views.ts";
import type { SavedView } from "./saved-views";

export const VIEW_PREFERENCES_STORAGE_KEY = "view-preferences.json";
export const VIEW_PREFERENCES_VERSION = 1;

export type DefaultView = "home" | "people" | "graph" | "orgs";
export type PeopleSortMode = "name" | "group" | "birthday" | "recent";
/** 联系人默认形态（F02）：卡片 / 表格 */
export type PeopleViewMode = "card" | "table";
/** 表格可选列（F02）。「姓名」是固定列，不参与显隐与排序，恒为首列。
 *  B12 新增「org」虚拟列：值来自成员索引投影（组织名 · 部门），不在数据库 fieldMap 中。 */
export type PeopleTableColumn = "group" | "phone" | "wechat" | "birthday" | "recent" | "tags" | "org" | "school" | "relationship";
/** 图谱数据源模式（B14.5）：relations=关系图（related 边）；native=文档引用图（内核图数据，边=块引用） */
export type GraphViewMode = "relations" | "native";
/** 文档引用图范围（B14.8/B14.4）：self=以本人为中心一度；person=以指定联系人为中心一度；global=全部登记文档 */
export type NativeGraphScope = "self" | "person" | "global";

/** 表格可选列的展示顺序默认值（常用常驻、次要折叠的排序基础） */
export const PEOPLE_TABLE_COLUMNS: readonly PeopleTableColumn[] = ["group", "phone", "wechat", "birthday", "recent", "tags", "org", "school", "relationship"];

export interface ViewPreferences {
    readonly schemaVersion: number;
    readonly revision: number;
    readonly defaultView: DefaultView;
    readonly peopleSort: PeopleSortMode;
    readonly openOnStartup: boolean;
    readonly aiEnabled: boolean;
    readonly birthdayWindowDays: number;
    readonly staleThresholdDays: number;
    readonly peopleView: PeopleViewMode;
    /** 表格可见列（有序）。归一化保证只含可选键、无重复且非空。 */
    readonly tableColumns: PeopleTableColumn[];
    /** 图谱数据源模式（B14.5）：重开工作台仍使用用户选定模式 */
    readonly graphMode: GraphViewMode;
    /** 文档引用图范围（B14.8）：中心语义与 global 入口，重开保留 */
    readonly nativeScope: NativeGraphScope;
    /** 文档引用图中心人物文档 ID（nativeScope="person" 时生效；失效由加载侧回退本人） */
    readonly nativeCenterDocId: string;
    /** 保存的联系人视图（F04）：规则快照，应用时重新求值 */
    readonly savedViews: readonly SavedView[];
    /** 打开工作台时的关注摘要开关（F08） */
    readonly summaryEnabled: boolean;
    /** 摘要「当日不再展示」标记（YYYY-MM-DD）；空串表示未忽略 */
    readonly summaryDismissedOn: string;
    /** C02 收编宽限期（天）：新收编联系人在此期限内不计入「从未互动」提醒；0 = 关闭 */
    readonly reminderGraceDays: number;
}

export const DEFAULT_VIEW_PREFERENCES: ViewPreferences = {
    schemaVersion: VIEW_PREFERENCES_VERSION,
    revision: 0,
    defaultView: "home",
    peopleSort: "name",
    openOnStartup: false,
    aiEnabled: true,
    birthdayWindowDays: 30,
    staleThresholdDays: 30,
    peopleView: "card",
    tableColumns: ["group", "phone", "wechat", "birthday", "recent", "tags", "org"],
    graphMode: "relations",
    nativeScope: "self",
    nativeCenterDocId: "",
    savedViews: [],
    summaryEnabled: true,
    summaryDismissedOn: "",
    reminderGraceDays: 14,
};

function isDefaultView(value: unknown): value is DefaultView {
    return value === "home" || value === "people" || value === "graph" || value === "orgs";
}

function isPeopleSortMode(value: unknown): value is PeopleSortMode {
    return value === "name" || value === "group" || value === "birthday" || value === "recent";
}

function isPeopleViewMode(value: unknown): value is PeopleViewMode {
    return value === "card" || value === "table";
}

function isGraphViewMode(value: unknown): value is GraphViewMode {
    return value === "relations" || value === "native";
}

function isNativeGraphScope(value: unknown): value is NativeGraphScope {
    return value === "self" || value === "person" || value === "global";
}

function boundedDays(value: unknown, fallback: number): number {
    if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
    return Math.max(0, Math.min(365, Math.round(value)));
}

/** 表格列归一化：剔除非法与重复键，保留用户顺序；全部无效时回退全列默认。 */
export function normalizeTableColumns(raw: unknown): PeopleTableColumn[] {
    if (!Array.isArray(raw)) return [...DEFAULT_VIEW_PREFERENCES.tableColumns];
    const seen = new Set<string>();
    const result: PeopleTableColumn[] = [];
    for (const item of raw) {
        if (typeof item !== "string" || !PEOPLE_TABLE_COLUMNS.includes(item as PeopleTableColumn) || seen.has(item)) continue;
        seen.add(item);
        result.push(item as PeopleTableColumn);
    }
    return result.length > 0 ? result : [...DEFAULT_VIEW_PREFERENCES.tableColumns];
}

export function normalizeViewPreferences(raw: unknown): ViewPreferences {
    if (raw === null || typeof raw !== "object") return DEFAULT_VIEW_PREFERENCES;
    const record = raw as Record<string, unknown>;
    return {
        schemaVersion: VIEW_PREFERENCES_VERSION,
        revision: typeof record.revision === "number" && Number.isSafeInteger(record.revision) && record.revision >= 0 ? record.revision : 0,
        defaultView: isDefaultView(record.defaultView) ? record.defaultView : DEFAULT_VIEW_PREFERENCES.defaultView,
        peopleSort: isPeopleSortMode(record.peopleSort) ? record.peopleSort : DEFAULT_VIEW_PREFERENCES.peopleSort,
        openOnStartup: typeof record.openOnStartup === "boolean" ? record.openOnStartup : DEFAULT_VIEW_PREFERENCES.openOnStartup,
        aiEnabled: typeof record.aiEnabled === "boolean" ? record.aiEnabled : DEFAULT_VIEW_PREFERENCES.aiEnabled,
        birthdayWindowDays: boundedDays(record.birthdayWindowDays, DEFAULT_VIEW_PREFERENCES.birthdayWindowDays),
        staleThresholdDays: boundedDays(record.staleThresholdDays, DEFAULT_VIEW_PREFERENCES.staleThresholdDays),
        peopleView: isPeopleViewMode(record.peopleView) ? record.peopleView : DEFAULT_VIEW_PREFERENCES.peopleView,
        // 旧偏好缺字段取默认；已有值仍逐键校验
        tableColumns: record.tableColumns === undefined ? [...DEFAULT_VIEW_PREFERENCES.tableColumns] : normalizeTableColumns(record.tableColumns),
        graphMode: isGraphViewMode(record.graphMode) ? record.graphMode : DEFAULT_VIEW_PREFERENCES.graphMode,
        nativeScope: isNativeGraphScope(record.nativeScope) ? record.nativeScope : DEFAULT_VIEW_PREFERENCES.nativeScope,
        // 中心文档 ID 透传字符串；加载侧按名册校验，失效回退本人
        nativeCenterDocId: typeof record.nativeCenterDocId === "string" ? record.nativeCenterDocId : "",
        // 旧偏好缺字段取空列表；已有值逐条归一化
        savedViews: record.savedViews === undefined ? [] : normalizeSavedViews(record.savedViews),
        summaryEnabled: typeof record.summaryEnabled === "boolean" ? record.summaryEnabled : DEFAULT_VIEW_PREFERENCES.summaryEnabled,
        summaryDismissedOn: typeof record.summaryDismissedOn === "string" && /^\d{4}-\d{2}-\d{2}$/.test(record.summaryDismissedOn)
            ? record.summaryDismissedOn
            : "",
        reminderGraceDays: clampGraceDays(record.reminderGraceDays),
    };
}

/** C02：宽限期 0–365 天，非法/缺省回退 14 */
function clampGraceDays(value: unknown): number {
    if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_VIEW_PREFERENCES.reminderGraceDays;
    return Math.max(0, Math.min(365, Math.round(value)));
}
