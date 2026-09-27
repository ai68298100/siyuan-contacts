import type { Plugin } from "siyuan";
import { INTERACTION_STORAGE_KEY } from "../data/interactions";
import { loadJson, loadJsonStrict, saveJsonVerified, withStoreLock } from "../data/storage";
import { normalizeInteractionStoreForWrite } from "../domain/interactions";
import { mergeInteractionBackup, parseInteractionBackup } from "../domain/interaction-backup";
import type { InteractionImportSummary } from "../domain/interaction-backup";
import { diffInteractionImport } from "../domain/interaction-backup";
import type { InteractionImportDiff } from "../domain/interaction-backup";
import { getRoster } from "./roster";
import type { ContactsSettings } from "../domain/model";

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

/**
 * 差异明细预览（F15）：按人物/日期展开将新增、将跳过与删除标记影响；
 * 只读（宽容读取），零写入；确认合并仍走 importInteractionJson 的锁内严格重读。
 */
export async function previewInteractionImportDiff(
    plugin: Plugin,
    settings: ContactsSettings,
    text: string,
): Promise<InteractionImportDiff> {
    const incoming = parseInteractionBackup(text);
    const current = normalizeInteractionStoreForWrite(await loadJson(plugin, INTERACTION_STORAGE_KEY));
    const roster = await getRoster(settings);
    const nameByDoc = new Map(roster.map((person) => [person.docId, person.name]));
    return diffInteractionImport(current, incoming, nameByDoc);
}
