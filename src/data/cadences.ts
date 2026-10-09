/**
 * 按人物联系节奏存储（插件自管 JSON）：Web Lock 临界区 + 写后回读。
 * 键：person-cadences.json（契约见 docs/DATA-CONTRACT.md §3）。
 */
import type { Plugin } from "siyuan";
import { loadJson, loadJsonStrict, saveJsonVerified, withStoreLock } from "./storage.ts";
import { isPersonDocId, normalizeCadenceMap, normalizeCadenceMapForWrite } from "../domain/cadence.ts";
import type { PersonCadence } from "../domain/cadence.ts";

export const CADENCE_STORAGE_KEY = "person-cadences.json";

/** 展示用容错读取 */
export async function loadCadenceMap(plugin: Plugin): Promise<Record<string, PersonCadence>> {
    return normalizeCadenceMap(await loadJson(plugin, CADENCE_STORAGE_KEY));
}

/** FUNC-01.12 严格展示读：键不存在返回空映射；读取失败/损坏抛错（首页据此显式降级提示） */
export async function loadCadenceMapStrict(plugin: Plugin): Promise<Record<string, PersonCadence>> {
    return normalizeCadenceMap(await loadJsonStrict(plugin, CADENCE_STORAGE_KEY));
}

/**
 * 读某人的覆盖项；未登记返回 null（跟随全局）。
 *
 * 详情页需要把“读取失败”与“没有覆盖项”区分开，否则磁盘故障会被
 * 容错读伪装成“跟随全局”，并让页面的重试反馈永远无法触发。
 */
export async function loadPersonCadence(plugin: Plugin, docId: string): Promise<PersonCadence | null> {
    const map = await loadCadenceMapStrict(plugin);
    return map[docId] ?? null;
}

/** 写入覆盖项；cadence 传 null 即清除回退全局。损坏当前库拒绝写入。 */
export async function savePersonCadence(
    plugin: Plugin,
    docId: string,
    cadence: PersonCadence | null,
): Promise<void> {
    if (!isPersonDocId(docId)) throw new Error("人物文档 ID 无效");
    return withStoreLock(CADENCE_STORAGE_KEY, async () => {
        const store = normalizeCadenceMapForWrite(await loadJsonStrict(plugin, CADENCE_STORAGE_KEY));
        if (cadence === null) {
            if (!(docId in store)) return;
            delete store[docId];
        } else {
            store[docId] = { days: cadence.days, paused: cadence.paused };
        }
        await saveJsonVerified(plugin, CADENCE_STORAGE_KEY, {
            schemaVersion: 1,
            cadences: Object.keys(store).length > 0 ? store : {},
        });
    });
}

/** C08 迁移包恢复：包内条目覆盖合并（同 personDocId 覆盖、新增补入）；损坏当前库拒绝写入 */
export async function mergeCadenceMap(
    plugin: Plugin,
    incoming: Record<string, { days: number; paused: boolean }>,
): Promise<number> {
    return withStoreLock(CADENCE_STORAGE_KEY, async () => {
        const store = normalizeCadenceMapForWrite(await loadJsonStrict(plugin, CADENCE_STORAGE_KEY));
        let merged = 0;
        for (const [docId, cadence] of Object.entries(incoming)) {
            store[docId] = { days: cadence.days, paused: cadence.paused };
            merged += 1;
        }
        await saveJsonVerified(plugin, CADENCE_STORAGE_KEY, {
            schemaVersion: 1,
            cadences: Object.keys(store).length > 0 ? store : {},
        });
        return merged;
    });
}
