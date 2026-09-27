/** 将插件自管互动事件导出为可审计、可迁移的 JSON 文本。 */
import type { Plugin } from "siyuan";
import { INTERACTION_STORAGE_KEY } from "../data/interactions";
import { loadJsonStrict, withStoreLock } from "../data/storage";
import { normalizeInteractionStore } from "../domain/interactions";

export async function exportInteractionJson(plugin: Plugin): Promise<string> {
    return withStoreLock(INTERACTION_STORAGE_KEY, async () => {
        const rawStore = await loadJsonStrict(plugin, INTERACTION_STORAGE_KEY);
        const store = normalizeInteractionStore(rawStore);
        return JSON.stringify(
            {
                schemaVersion: 1,
                exportedAt: new Date().toISOString(),
                storageKey: INTERACTION_STORAGE_KEY,
                rawStore,
                events: store.events,
                tombstones: store.tombstones,
            },
            null,
            2,
        );
    });
}
