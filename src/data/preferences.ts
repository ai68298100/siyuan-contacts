import type { Plugin } from "siyuan";
import { loadJsonStrict, saveJsonVerified, withStoreLock } from "./storage.ts";
import { VIEW_PREFERENCES_STORAGE_KEY } from "../domain/preferences.ts";
import type { ViewPreferences } from "../domain/preferences";
import { applyPreferencePatch, decodeViewPreferences } from "../domain/preferences-concurrency.ts";
import type { PreferencePatch } from "../domain/preferences-concurrency";

export async function readViewPreferences(plugin: Plugin): Promise<ViewPreferences> {
    return decodeViewPreferences(await loadJsonStrict(plugin, VIEW_PREFERENCES_STORAGE_KEY));
}

export async function writeViewPreferencePatch(plugin: Plugin, patch: PreferencePatch): Promise<ViewPreferences> {
    return withStoreLock(VIEW_PREFERENCES_STORAGE_KEY, async () => {
        const latest = await readViewPreferences(plugin);
        const next = applyPreferencePatch(latest, patch);
        if (next !== latest) await saveJsonVerified(plugin, VIEW_PREFERENCES_STORAGE_KEY, next);
        return next;
    });
}
