/**
 * E-33 联系人软删除回收站服务层（Trash & Soft Delete Buffer）
 * 支持移入回收站并解绑、一键恢复联系人及元数据快照、列表查询与清空。
 */

import type { Plugin } from "siyuan";
import type { ContactsSettings } from "../domain/model.ts";
import type { ContactDraft, ContactSummary } from "../domain/person.ts";
import { dropTrashEntry, listTrashEntries, loadTrashStoreStrict, pushTrashEntry, clearTrashBin } from "../data/trash.ts";
import type { TrashContactEntry } from "../domain/trash.ts";
import { removeContact, writeDraftCells } from "./contacts.ts";
import { bindDocsAsRows, mapBoundDocIds } from "../api/av.ts";
import { invalidateRoster } from "./roster.ts";

/**
 * 移入回收站并解绑联系人：
 * 1. 存入 30 天回收站缓冲区（元数据快照）；
 * 2. 从属性视图安全解绑数据库行（保留思源人物文档）；
 * 3. 失效名册缓存。
 */
export async function removeContactToTrash(
    plugin: Plugin,
    settings: ContactsSettings,
    person: ContactSummary,
): Promise<void> {
    await pushTrashEntry(plugin, person);
    await removeContact(settings, person);
    invalidateRoster();
}

/**
 * 从回收站一键恢复联系人：
 * 1. 严格读取回收站，按 entryId 找到快照；
 * 2. 检查是否已被重新绑定；未绑定则调用 bindDocsAsRows 重新将文档绑定为数据库行；
 * 3. 换算得到新 itemId，调用 writeDraftCells 写回快照属性（电话/邮箱/微信/标签/生日等）；
 * 4. 从回收站移除该条目；
 * 5. 失效名册缓存。
 */
export async function restoreContactFromTrash(
    plugin: Plugin,
    settings: ContactsSettings,
    entryId: string,
): Promise<{ docId: string; itemId: string; name: string }> {
    const store = await loadTrashStoreStrict(plugin);
    const entry = store.entries.find((item) => item.id === entryId || item.docId === entryId);
    if (!entry) throw new Error("回收站未找到该条目或已被清理");

    // 检查是否已经在数据库中
    const boundMap = await mapBoundDocIds(settings.avId, [entry.docId]);
    let newItemId = boundMap[entry.docId];

    if (!newItemId) {
        // 重新绑行为数据库行
        await bindDocsAsRows(settings.avId, settings.dbBlockId, [{ id: entry.docId, content: entry.name }]);
        const freshBound = await mapBoundDocIds(settings.avId, [entry.docId]);
        newItemId = freshBound[entry.docId];
        if (!newItemId) throw new Error("恢复联系人行绑定未收敛，请重试");
    }

    // 写回快照属性
    const draft: ContactDraft = {
        name: entry.name,
        phone: entry.snapshot.phone ?? "",
        email: entry.snapshot.email ?? "",
        wechat: entry.snapshot.wechat ?? "",
        website: entry.snapshot.website ?? "",
        birthday: entry.snapshot.birthday ?? "",
        isLunar: Boolean(entry.snapshot.isLunar),
        group: entry.snapshot.group ?? "",
        tags: entry.snapshot.tags ?? [],
    };

    await writeDraftCells(settings, newItemId, draft, { mode: "create" });
    await dropTrashEntry(plugin, entry.id);
    invalidateRoster();

    return { docId: entry.docId, itemId: newItemId, name: entry.name };
}

/** 查询当前未过期的回收站条目列表 */
export async function listTrash(plugin: Plugin): Promise<TrashContactEntry[]> {
    return listTrashEntries(plugin);
}

/** 彻底清空回收站 */
export async function emptyTrash(plugin: Plugin): Promise<void> {
    await clearTrashBin(plugin);
}
