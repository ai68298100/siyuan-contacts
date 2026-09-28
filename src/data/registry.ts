/**
 * 收编时间索引存储（插件自管 JSON）：Web Lock 临界区 + 写后回读。
 * 键：person-registry.json（契约见 docs/DATA-CONTRACT.md §3）。
 */
import type { Plugin } from "siyuan";
import { loadJson, loadJsonStrict, saveJsonVerified, withStoreLock } from "./storage";
import { ensureRegistryEntries, normalizeRegistryStore } from "../domain/registry";
import type { RegistryStore } from "../domain/registry";

export const REGISTRY_STORAGE_KEY = "person-registry.json";

/** 展示用容错读取 */
export async function loadRegistry(plugin: Plugin): Promise<RegistryStore> {
    return normalizeRegistryStore(await loadJson(plugin, REGISTRY_STORAGE_KEY));
}

/** 首次发现补记：只补缺失键（幂等），读路径调用失败时静默降级（不阻断首页加载） */
export async function ensureRegistryEntriesSaved(plugin: Plugin, docIds: readonly string[], today: string): Promise<void> {
    try {
        return await withStoreLock(REGISTRY_STORAGE_KEY, async () => {
            const store = normalizeRegistryStore(await loadJsonStrict(plugin, REGISTRY_STORAGE_KEY));
            const { registeredAt, added } = ensureRegistryEntries(store, docIds, today);
            if (added.length === 0) return;
            await saveJsonVerified(plugin, REGISTRY_STORAGE_KEY, { schemaVersion: 1, registeredAt });
        });
    } catch {
        /* 补记失败按缺失处理降级：宽限判断未登记视为首次发现，行为一致 */
    }
}
