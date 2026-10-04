import type { Plugin } from "siyuan";
import { SETTINGS_STORAGE_KEY } from "../domain/model.ts";
import type { ContactsSettings } from "../domain/model.ts";
import { parseRepairSettings, parseSettingsRepairCheckpoint, SETTINGS_REPAIR_STORAGE_KEY } from "../domain/settings-repair.ts";
import type { SettingsRepairCheckpoint } from "../domain/settings-repair.ts";
import { loadJsonStrict, saveJsonVerified } from "./storage.ts";

export const SETTINGS_REPAIR_LOCK_KEY = SETTINGS_STORAGE_KEY;

export async function loadRepairSettings(plugin: Plugin): Promise<ContactsSettings> {
    return parseRepairSettings(await loadJsonStrict(plugin, SETTINGS_STORAGE_KEY));
}

export async function loadSettingsRepairCheckpoint(plugin: Plugin): Promise<SettingsRepairCheckpoint | null> {
    return parseSettingsRepairCheckpoint(await loadJsonStrict(plugin, SETTINGS_REPAIR_STORAGE_KEY));
}

export async function saveRepairSettings(plugin: Plugin, settings: ContactsSettings): Promise<void> {
    await saveJsonVerified(plugin, SETTINGS_STORAGE_KEY, parseRepairSettings(settings));
}

export async function saveSettingsRepairCheckpoint(plugin: Plugin, checkpoint: SettingsRepairCheckpoint): Promise<void> {
    await saveJsonVerified(plugin, SETTINGS_REPAIR_STORAGE_KEY, parseSettingsRepairCheckpoint(checkpoint));
}
