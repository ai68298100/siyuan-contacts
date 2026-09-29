/**
 * 本人档案服务（B11）：初始化向导数据库确认后，默认建立「我自己」人物文档并写入身份标记。
 * 幂等续建：标记已存在 → 核验名册仍含该文档（丢失仅告警，改绑走 B11.5 修复流程）；
 * 无标记但有同名「我自己」已绑定联系人 → 复用该行不改资料；
 * 残留未绑定同名文档 → createContact 断点语义自动复用（不产生重复文档）。
 * 建档/标记失败不阻断初始化（console 记录；身份可后续通过设置页指定，B11.3）。
 */
import type { Plugin } from "siyuan";
import { createContact } from "./contacts";
import { loadSelfIdentity, saveSelfIdentity, SelfIdentityConflictError } from "../data/self-identity";
import type { SelfIdentity } from "../domain/self-identity";
import { isSelfDoc } from "../domain/self-identity";
import { listContacts } from "./contacts";
import { invalidateRoster } from "./roster";
import type { ContactsSettings } from "../domain/model";

export const SELF_PERSON_NAME = "我自己";

/** 确保本人档案与身份标记存在（幂等）。返回当前身份；无法建立时返回 null（已告警）。 */
export async function ensureSelfIdentity(plugin: Plugin, settings: ContactsSettings): Promise<SelfIdentity | null> {
    const existing = await loadSelfIdentity(plugin);
    if (existing) {
        /* 核验名册仍含本人文档；丢失（文档被删/移动）仅告警——改绑/找回属 B11.5 修复流程 */
        try {
            const roster = await listContacts(settings);
            if (!roster.some((person) => isSelfDoc(existing, person.docId))) {
                console.warn(`[lvct] 本人文档 ${existing.selfDocId} 不在名册中（可能已删除/移动）；身份标记保留，请通过设置页修复`);
            }
        } catch (error) {
            console.warn("[lvct] 本人身份核验的名册读取失败", error);
        }
        return existing;
    }

    try {
        /* 同名「我自己」已绑定联系人 → 复用该行（不改资料）；未绑定残留/全新 → createContact
           断点语义建文档+绑行+写字段（空草稿，仅姓名） */
        invalidateRoster();
        const roster = await listContacts(settings);
        const sameName = roster.find((person) => person.name === SELF_PERSON_NAME);
        const created = sameName
            ? sameName
            : await createContact(settings, {
                name: SELF_PERSON_NAME, phone: "", email: "", wechat: "", website: "",
                birthday: "", isLunar: false, group: "", tags: [],
            });
        return await saveSelfIdentity(plugin, { selfDocId: created.docId, selfItemId: created.itemId });
    } catch (error) {
        if (error instanceof SelfIdentityConflictError) {
            /* 并发窗口另一上下文已标记：重新读取返回其身份 */
            return await loadSelfIdentity(plugin);
        }
        console.warn("[lvct] 本人档案建立失败（初始化继续，身份可稍后在设置页指定）", error);
        return null;
    }
}
