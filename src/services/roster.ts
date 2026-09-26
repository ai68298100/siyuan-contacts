/**
 * 名册缓存：全量联系人列表的进程内缓存（TTL + 写失效）。
 *
 * 为什么需要（DATA-CONTRACT §4）：生日提醒、久未联系、图谱、关系候选都是"全员扫描"型需求，
 * 各自全量渲染一次数据库，人数上千就会卡。名册 30 秒 TTL 内复用一次内核渲染；
 * 所有经 services 层的写操作立即失效。多窗口下他人写入最多滞后一个 TTL，
 * 与"派生数据只投影"纪律一致——缓存可随时重建，不是事实源。
 */
import { renderView } from "../api/av";
import { isRosterFresh, rosterFromRender, ROSTER_TTL_MS } from "../domain/roster.ts";
import type { RosterEntry } from "../domain/roster";
import type { ContactsSettings } from "../domain/model";
import type { ContactSummary } from "../domain/person";

let cache: RosterEntry | null = null;

export { ROSTER_TTL_MS };

export function invalidateRoster(): void {
    cache = null;
}

/** 全量名册（缓存优先）。仪表盘/图谱/详情关系候选都应走这里，不要自己再全量渲染 */
export async function getRoster(settings: ContactsSettings): Promise<ContactSummary[]> {
    const now = Date.now();
    const fresh = cache;
    if (fresh !== null && isRosterFresh(fresh, settings.avId, now)) {
        return fresh.people;
    }
    const rendered = await renderView(settings.avId, settings.dbBlockId);
    const people = rosterFromRender(rendered, settings.fieldMap);
    cache = { people, avId: settings.avId, fetchedAt: now };
    return people;
}
