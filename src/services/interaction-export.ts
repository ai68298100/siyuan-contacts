/** 将插件自管互动事件导出为可审计、可迁移的 JSON 文本。 */
import type { Plugin } from "siyuan";
import { loadInteractionStore } from "../data/interactions";

export async function exportInteractionJson(plugin: Plugin): Promise<string> {
    const store = await loadInteractionStore(plugin);
    return JSON.stringify(
        {
            schemaVersion: 1,
            exportedAt: new Date().toISOString(),
            events: store.events,
            tombstones: store.tombstones,
        },
        null,
        2,
    );
}
