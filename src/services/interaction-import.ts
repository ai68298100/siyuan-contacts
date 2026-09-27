import type { Plugin } from "siyuan";
import { INTERACTION_STORAGE_KEY } from "../data/interactions";
import { loadJsonStrict, saveJsonVerified, withStoreLock } from "../data/storage";
import { normalizeInteractionStoreForWrite } from "../domain/interactions";
import { mergeInteractionBackup, parseInteractionBackup } from "../domain/interaction-backup";
import type { InteractionImportSummary } from "../domain/interaction-backup";

async function mergeBackup(plugin: Plugin, text: string, save: boolean): Promise<InteractionImportSummary> {
    const incoming = parseInteractionBackup(text);
    return withStoreLock(INTERACTION_STORAGE_KEY, async () => {
        const current = normalizeInteractionStoreForWrite(await loadJsonStrict(plugin, INTERACTION_STORAGE_KEY));
        const result = mergeInteractionBackup(current, incoming);
        if (save && JSON.stringify(result.store) !== JSON.stringify(current)) {
            await saveJsonVerified(plugin, INTERACTION_STORAGE_KEY, result.store);
        }
        return result.summary;
    });
}

export function previewInteractionImport(plugin: Plugin, text: string): Promise<InteractionImportSummary> {
    return mergeBackup(plugin, text, false);
}

export function importInteractionJson(plugin: Plugin, text: string): Promise<InteractionImportSummary> {
    return mergeBackup(plugin, text, true);
}
