/**
 * vCard 导入导出服务：解析预览（对名册查重）→ 批量建人；名册 → .vcf 文本。
 * 写放大控制对齐收编路径（DATA-CONTRACT §4）：逐篇建文档不可避免，
 * 绑行 200/批合并、绑定映射一次批量、单元格写入复用 contacts 的 writeDraftCells。
 */
import { parseVcf, serializeVcf } from "../domain/vcard.ts";
import type { VCardContact } from "../domain/vcard.ts";
import { emptyDraft } from "../domain/person";
import type { ContactDraft } from "../domain/person";
import type { ContactsSettings } from "../domain/model";
import { createDocWithMd } from "../api/client";
import { bindDocsAsRows, mapBoundDocIds } from "../api/av";
import { getRoster, invalidateRoster } from "./roster";
import { writeDraftCells } from "./contacts";

const BIND_CHUNK = 200;

export interface VcfImportPlan {
    contact: VCardContact;
    draft: ContactDraft;
    /** 与名册（或本批次在前项）同名：默认不勾选，导入时跳过（D-0007 防重同源语义） */
    duplicate: boolean;
}

export interface VcfImportReport {
    imported: number;
    duplicates: string[];
    failed: { name: string; reason: string }[];
}

/** 解析 vCard 文本并对名册查重，产出可预览勾选的导入计划 */
export async function buildVcfImportPlan(settings: ContactsSettings, text: string): Promise<VcfImportPlan[]> {
    const parsed = parseVcf(text);
    const roster = await getRoster(settings);
    const existingNames = new Set(roster.map((person) => person.name));
    const seenInBatch = new Set<string>();
    return parsed.map((contact) => {
        const duplicate = existingNames.has(contact.name) || seenInBatch.has(contact.name);
        seenInBatch.add(contact.name);
        return {
            contact,
            draft: {
                ...emptyDraft(),
                name: contact.name,
                phone: contact.phone,
                email: contact.email,
                website: contact.website,
                birthday: contact.birthday,
                isLunar: contact.isLunar,
                tags: [...contact.tags],
            },
            duplicate,
        };
    });
}

/**
 * 批量导入勾选的计划：建文档 → 批量绑行 → 批量映射 → 写单元格。
 * 单项失败不中断整批（失败原因逐项回报）；全程不抛错。
 */
export async function importVcfContacts(
    settings: ContactsSettings,
    plans: readonly VcfImportPlan[],
    onProgress?: (done: number, total: number) => void,
): Promise<VcfImportReport> {
    const chosen = plans.filter((plan) => !plan.duplicate);
    const duplicates = plans.filter((plan) => plan.duplicate).map((plan) => plan.contact.name);
    const failed: { name: string; reason: string }[] = [];
    const report: VcfImportReport = { imported: 0, duplicates, failed };
    if (chosen.length === 0) return report;

    // ① 逐篇建文档（createDocWithMd 单文档语义，无法合并）
    const created: { draft: ContactDraft; docId: string }[] = [];
    let done = 0;
    for (const plan of chosen) {
        try {
            const docId = await createDocWithMd(
                settings.notebookId,
                `/${settings.notebookName}/${plan.draft.name}`,
                `# ${plan.draft.name}\n\n`,
            );
            if (!docId) throw new Error("创建人物文档失败");
            created.push({ draft: plan.draft, docId });
        } catch (error) {
            failed.push({ name: plan.draft.name, reason: error instanceof Error ? error.message : String(error) });
        }
        done += 1;
        onProgress?.(done, chosen.length);
    }

    // ② 绑行为联系人（200/批，与收编同款写放大控制）
    for (let start = 0; start < created.length; start += BIND_CHUNK) {
        await bindDocsAsRows(
            settings.avId,
            settings.dbBlockId,
            created.slice(start, start + BIND_CHUNK).map((item) => ({ id: item.docId, content: item.draft.name })),
        );
    }

    // ③ 一次批量映射拿全部 itemID，再逐人写单元格
    const itemMap = await mapBoundDocIds(settings.avId, created.map((item) => item.docId));
    for (const item of created) {
        const itemId = itemMap[item.docId];
        if (!itemId) {
            failed.push({ name: item.draft.name, reason: "绑定数据库失败（未获得行 ID）" });
            continue;
        }
        try {
            await writeDraftCells(settings, itemId, item.draft);
            report.imported += 1;
        } catch (error) {
            failed.push({ name: item.draft.name, reason: error instanceof Error ? error.message : String(error) });
        }
    }

    invalidateRoster();
    return report;
}

/** 名册 → vCard 3.0 文本（微信号无标准 vCard 属性，不导出） */
export async function exportVcfText(settings: ContactsSettings): Promise<string> {
    const people = await getRoster(settings);
    const contacts: VCardContact[] = people.map((person) => ({
        name: person.name,
        phone: person.phone,
        email: person.email,
        website: person.website,
        birthday: person.birthday,
        isLunar: person.isLunar,
        tags: person.tags,
    }));
    return serializeVcf(contacts);
}
