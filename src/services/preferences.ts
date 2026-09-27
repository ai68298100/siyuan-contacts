import type { Plugin } from "siyuan";
import {
    DEFAULT_VIEW_PREFERENCES,
    normalizeViewPreferences,
    VIEW_PREFERENCES_STORAGE_KEY,
    type ViewPreferences,
} from "../domain/preferences";
import { loadJson, saveJsonVerified, withStoreLock } from "../data/storage";

export async function loadViewPreferences(plugin: Plugin): Promise<ViewPreferences> {
    return normalizeViewPreferences(await loadJson(plugin, VIEW_PREFERENCES_STORAGE_KEY));
}

export async function saveViewPreferences(plugin: Plugin, preferences: ViewPreferences): Promise<ViewPreferences> {
    const normalized = normalizeViewPreferences(preferences);
    await withStoreLock(VIEW_PREFERENCES_STORAGE_KEY, () => saveJsonVerified(plugin, VIEW_PREFERENCES_STORAGE_KEY, normalized));
    return normalized;
}

export { DEFAULT_VIEW_PREFERENCES };
