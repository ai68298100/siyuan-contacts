/** 工作台视图偏好：仅影响界面默认行为，不改变联系人数据库。 */

export const VIEW_PREFERENCES_STORAGE_KEY = "view-preferences.json";
export const VIEW_PREFERENCES_VERSION = 1;

export type DefaultView = "home" | "people" | "graph";
export type PeopleSortMode = "name" | "group" | "birthday";

export interface ViewPreferences {
    readonly schemaVersion: number;
    readonly defaultView: DefaultView;
    readonly peopleSort: PeopleSortMode;
    readonly openOnStartup: boolean;
    readonly aiEnabled: boolean;
    readonly birthdayWindowDays: number;
    readonly staleThresholdDays: number;
}

export const DEFAULT_VIEW_PREFERENCES: ViewPreferences = {
    schemaVersion: VIEW_PREFERENCES_VERSION,
    defaultView: "home",
    peopleSort: "name",
    openOnStartup: false,
    aiEnabled: true,
    birthdayWindowDays: 30,
    staleThresholdDays: 30,
};

function isDefaultView(value: unknown): value is DefaultView {
    return value === "home" || value === "people" || value === "graph";
}

function isPeopleSortMode(value: unknown): value is PeopleSortMode {
    return value === "name" || value === "group" || value === "birthday";
}

function boundedDays(value: unknown, fallback: number): number {
    if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
    return Math.max(0, Math.min(365, Math.round(value)));
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
    };
}
