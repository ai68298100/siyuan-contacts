/** 工作台视图偏好：仅影响界面默认行为，不改变联系人数据库。 */

export const VIEW_PREFERENCES_STORAGE_KEY = "view-preferences.json";
export const VIEW_PREFERENCES_VERSION = 1;

export type DefaultView = "home" | "people" | "graph";
export type PeopleSortMode = "name" | "group" | "birthday" | "recent";
/** 联系人默认形态（F02）：卡片 / 表格 */
export type PeopleViewMode = "card" | "table";
/** 表格可选列（F02）。「姓名」是固定列，不参与显隐与排序，恒为首列。 */
export type PeopleTableColumn = "group" | "phone" | "wechat" | "birthday" | "recent" | "tags";

/** 表格可选列的展示顺序默认值（常用常驻、次要折叠的排序基础） */
export const PEOPLE_TABLE_COLUMNS: readonly PeopleTableColumn[] = ["group", "phone", "wechat", "birthday", "recent", "tags"];

export interface ViewPreferences {
    readonly schemaVersion: number;
    readonly defaultView: DefaultView;
    readonly peopleSort: PeopleSortMode;
    readonly openOnStartup: boolean;
    readonly aiEnabled: boolean;
    readonly birthdayWindowDays: number;
    readonly staleThresholdDays: number;
    readonly peopleView: PeopleViewMode;
    /** 表格可见列（有序）。归一化保证只含可选键、无重复且非空。 */
    readonly tableColumns: PeopleTableColumn[];
}

export const DEFAULT_VIEW_PREFERENCES: ViewPreferences = {
    schemaVersion: VIEW_PREFERENCES_VERSION,
    defaultView: "home",
    peopleSort: "name",
    openOnStartup: false,
    aiEnabled: true,
    birthdayWindowDays: 30,
    staleThresholdDays: 30,
    peopleView: "card",
    tableColumns: [...PEOPLE_TABLE_COLUMNS],
};

function isDefaultView(value: unknown): value is DefaultView {
    return value === "home" || value === "people" || value === "graph";
}

function isPeopleSortMode(value: unknown): value is PeopleSortMode {
    return value === "name" || value === "group" || value === "birthday" || value === "recent";
}

function isPeopleViewMode(value: unknown): value is PeopleViewMode {
    return value === "card" || value === "table";
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
        defaultView: isDefaultView(record.defaultView) ? record.defaultView : DEFAULT_VIEW_PREFERENCES.defaultView,
        peopleSort: isPeopleSortMode(record.peopleSort) ? record.peopleSort : DEFAULT_VIEW_PREFERENCES.peopleSort,
        openOnStartup: typeof record.openOnStartup === "boolean" ? record.openOnStartup : DEFAULT_VIEW_PREFERENCES.openOnStartup,
        aiEnabled: typeof record.aiEnabled === "boolean" ? record.aiEnabled : DEFAULT_VIEW_PREFERENCES.aiEnabled,
        birthdayWindowDays: boundedDays(record.birthdayWindowDays, DEFAULT_VIEW_PREFERENCES.birthdayWindowDays),
        staleThresholdDays: boundedDays(record.staleThresholdDays, DEFAULT_VIEW_PREFERENCES.staleThresholdDays),
        peopleView: isPeopleViewMode(record.peopleView) ? record.peopleView : DEFAULT_VIEW_PREFERENCES.peopleView,
        // 旧偏好缺字段取默认；已有值仍逐键校验
        tableColumns: record.tableColumns === undefined ? [...DEFAULT_VIEW_PREFERENCES.tableColumns] : normalizeTableColumns(record.tableColumns),
    };
}
