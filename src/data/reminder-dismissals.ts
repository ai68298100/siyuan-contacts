/**
 * 提醒暂缓存储（插件自管 JSON）：Web Lock 临界区 + 写后回读。
 * 键：reminder-dismissals.json（契约见 docs/DATA-CONTRACT.md §3）。
 * 只屏蔽提醒呈现；统计与名单口径不受影响（D-0020）。
 */
import type { Plugin } from "siyuan";
import { loadJson, loadJsonStrict, saveJsonVerified, withStoreLock } from "./storage";
import {
    normalizeDismissalStore,
    normalizeDismissalStoreForWrite,
} from "../domain/reminder-dismissals";
import { isPersonDocId } from "../domain/cadence";
import { isValidDateKey } from "../domain/date-key";
import type { ReminderDismissal, ReminderDismissalStore, ReminderKind } from "../domain/reminder-dismissals";

export const REMINDER_DISMISSALS_STORAGE_KEY = "reminder-dismissals.json";

/** 展示用容错读取 */
export async function loadReminderDismissals(plugin: Plugin): Promise<ReminderDismissal[]> {
    return normalizeDismissalStore(await loadJson(plugin, REMINDER_DISMISSALS_STORAGE_KEY)).dismissals;
}

/** FUNC-01.12 严格展示读：键不存在返回空列表；读取失败/损坏抛错（首页提醒据此显式降级提示） */
export async function loadReminderDismissalsStrict(plugin: Plugin): Promise<ReminderDismissal[]> {
    return normalizeDismissalStoreForWrite(await loadJsonStrict(plugin, REMINDER_DISMISSALS_STORAGE_KEY)).dismissals;
}

async function readStoreStrict(plugin: Plugin): Promise<ReminderDismissalStore> {
    const raw = await loadJsonStrict(plugin, REMINDER_DISMISSALS_STORAGE_KEY);
    return normalizeDismissalStoreForWrite(raw);
}

/** 暂缓某人的某类提醒；同 personDocId+kind 覆盖。until 为 YYYY-MM-DD 或空串（长期） */
export async function dismissReminder(
    plugin: Plugin,
    personDocId: string,
    kind: ReminderKind,
    until: string,
): Promise<void> {
    if (!isPersonDocId(personDocId)) throw new Error("人物文档 ID 无效");
    if (kind !== "birthday" && kind !== "stale") throw new Error("提醒类型无效");
    if (until !== "" && !isValidDateKey(until)) throw new Error("提醒暂缓日期无效，未写入");
    return withStoreLock(REMINDER_DISMISSALS_STORAGE_KEY, async () => {
        const store = await readStoreStrict(plugin);
        const rest = store.dismissals.filter((entry) => !(entry.personDocId === personDocId && entry.kind === kind));
        rest.push({ personDocId, kind, until });
        await saveJsonVerified(plugin, REMINDER_DISMISSALS_STORAGE_KEY, {
            schemaVersion: 1,
            dismissals: rest,
        });
    });
}

/** 恢复（删除对应条目）；不存在时静默幂等 */
export async function resumeReminder(
    plugin: Plugin,
    personDocId: string,
    kind: ReminderKind,
): Promise<void> {
    if (!isPersonDocId(personDocId)) throw new Error("人物文档 ID 无效");
    return withStoreLock(REMINDER_DISMISSALS_STORAGE_KEY, async () => {
        const store = await readStoreStrict(plugin);
        const rest = store.dismissals.filter((entry) => !(entry.personDocId === personDocId && entry.kind === kind));
        if (rest.length === store.dismissals.length) return;
        await saveJsonVerified(plugin, REMINDER_DISMISSALS_STORAGE_KEY, { schemaVersion: 1, dismissals: rest });
    });
}

/** C08 迁移包恢复：包内条目覆盖合并（同 personDocId+kind 覆盖、新增补入） */
export async function mergeReminderDismissals(
    plugin: Plugin,
    incoming: readonly ReminderDismissal[],
): Promise<number> {
    const safeIncoming = normalizeDismissalStore({ schemaVersion: 1, dismissals: incoming }).dismissals;
    return withStoreLock(REMINDER_DISMISSALS_STORAGE_KEY, async () => {
        const store = await readStoreStrict(plugin);
        const byKey = new Map(store.dismissals.map((entry) => [`${entry.personDocId}|${entry.kind}`, entry]));
        let merged = 0;
        for (const entry of safeIncoming) {
            byKey.set(`${entry.personDocId}|${entry.kind}`, entry);
            merged += 1;
        }
        await saveJsonVerified(plugin, REMINDER_DISMISSALS_STORAGE_KEY, {
            schemaVersion: 1,
            dismissals: [...byKey.values()],
        });
        return merged;
    });
}

export type { ReminderDismissal, ReminderKind };
