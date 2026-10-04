import { DEFAULT_VIEW_PREFERENCES, normalizeViewPreferences, VIEW_PREFERENCES_VERSION } from "./preferences.ts";
import type { ViewPreferences } from "./preferences";

export type PreferencePatch = Partial<Omit<ViewPreferences, "schemaVersion" | "revision">>;

export function decodeViewPreferences(raw: unknown): ViewPreferences {
    if (raw === null || raw === "") return normalizeViewPreferences({});
    if (typeof raw !== "object" || Array.isArray(raw)) throw new Error("偏好存储损坏，请先核实原文件");
    const record = raw as Record<string, unknown>;
    if (record.schemaVersion !== undefined && record.schemaVersion !== VIEW_PREFERENCES_VERSION) {
        throw new Error("偏好存储版本不兼容，请先核实原文件");
    }
    if (record.revision !== undefined && (typeof record.revision !== "number" || !Number.isSafeInteger(record.revision) || record.revision < 0)) {
        throw new Error("偏好存储 revision 非法，请先核实原文件");
    }
    return normalizeViewPreferences(record);
}

export function diffViewPreferences(baseline: ViewPreferences, next: ViewPreferences): PreferencePatch {
    const previous = normalizeViewPreferences(baseline);
    const submitted = normalizeViewPreferences(next);
    const patch: Record<string, unknown> = {};
    for (const key of Object.keys(DEFAULT_VIEW_PREFERENCES) as (keyof ViewPreferences)[]) {
        if (key === "schemaVersion" || key === "revision") continue;
        if (JSON.stringify(previous[key]) !== JSON.stringify(submitted[key])) patch[key] = submitted[key];
    }
    return patch as PreferencePatch;
}

export function rebasePreferenceDraft(latest: ViewPreferences, draft: ViewPreferences, baseline: ViewPreferences): ViewPreferences {
    return normalizeViewPreferences({ ...latest, ...diffViewPreferences(baseline, draft) });
}

export function applyPreferencePatch(latest: ViewPreferences, patch: PreferencePatch): ViewPreferences {
    const merged = normalizeViewPreferences({ ...latest, ...patch });
    if (Object.keys(diffViewPreferences(latest, merged)).length === 0) return latest;
    if (latest.revision === Number.MAX_SAFE_INTEGER) throw new Error("偏好 revision 已达上限，操作已停止");
    return { ...merged, revision: latest.revision + 1 };
}
