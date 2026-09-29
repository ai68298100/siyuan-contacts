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

export type VcfItemStatus = "imported" | "skipped" | "failed" | "unknown";

/** 逐项导入结果（F14 三段报告单）：
 * imported=完全成功；skipped=同名跳过或核对后已存在；
 * failed=确定未写入（建文档失败）；unknown=文档可能已建但绑定/字段未确认（重试前先核对名册） */
export interface VcfItemResult {
    /** plans 数组中的下标，用于重试定位 */
    planIndex: number;
    name: string;
    status: VcfItemStatus;
    reason?: string;
}

export interface VcfImportReport {
    imported: number;
    duplicates: string[];
    failed: { name: string; reason: string }[];
    /** 未知结果项：文档可能已创建，重试前需核对名册，禁止盲重试 */
    unknown: { name: string; reason: string; planIndex: number }[];
    /** 逐项结果 */
    results: VcfItemResult[];
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
 * 批量导入勾选的计划（F14 逐项诊断）：建文档 → 批量绑行 → 批量映射 → 逐人写单元格。
 * 逐项结果三段区分：建文档失败=failed（确定未写入）；绑行/映射/写值失败=unknown
 * （文档可能已建，重试前先核对名册）；全程不抛错。
 * entries 的 planIndex 为调用方（组件完整 plans 数组）的全局下标，结果原样回传。
 */
export async function importVcfContacts(
    settings: ContactsSettings,
    entries: readonly { planIndex: number; plan: VcfImportPlan }[],
    onProgress?: (done: number, total: number) => void,
): Promise<VcfImportReport> {
    const chosen = entries.filter((entry) => !entry.plan.duplicate);
    const failed: { name: string; reason: string }[] = [];
    const unknown: { name: string; reason: string; planIndex: number }[] = [];
    const results: VcfItemResult[] = [];
    const report: VcfImportReport = { imported: 0, duplicates: [], failed, unknown, results };
    if (chosen.length === 0) return report;

    // ① 逐篇建文档（createDocWithMd 单文档语义，无法合并）；失败 → failed（确定未写入）
    const created: { plan: VcfImportPlan; planIndex: number; docId: string }[] = [];
    let done = 0;
    for (const { plan, planIndex } of chosen) {
        try {
            const docId = await createDocWithMd(
                settings.notebookId,
                `/${settings.notebookName}/${plan.draft.name}`,
                `# ${plan.draft.name}\n\n`,
            );
            if (!docId) throw new Error("创建人物文档失败");
            created.push({ plan, planIndex, docId });
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            failed.push({ name: plan.draft.name, reason });
            results.push({ planIndex, name: plan.draft.name, status: "failed", reason });
        }
        done += 1;
        onProgress?.(done, chosen.length);
    }

    // ② 绑行为联系人（200/批，与收编同款写放大控制）→ ③ 批量映射 → ④ 逐人写单元格。
    // 批量之后的失败无法归因单条写入状态 → unknown（文档可能已建，重试前核对名册）
    for (let start = 0; start < created.length; start += BIND_CHUNK) {
        const chunk = created.slice(start, start + BIND_CHUNK);
        try {
            await bindDocsAsRows(
                settings.avId,
                settings.dbBlockId,
                chunk.map((item) => ({ id: item.docId, content: item.plan.draft.name })),
            );
        } catch (error) {
            const reason = `绑定数据库失败：${error instanceof Error ? error.message : String(error)}`;
            for (const item of chunk) {
                unknown.push({ name: item.plan.draft.name, reason, planIndex: item.planIndex });
                results.push({ planIndex: item.planIndex, name: item.plan.draft.name, status: "unknown", reason });
            }
        }
    }
    const bound = created.filter((item) => !unknown.some((entry) => entry.planIndex === item.planIndex));
    let itemMap: Record<string, string> = {};
    if (bound.length > 0) {
        try {
            itemMap = await mapBoundDocIds(settings.avId, bound.map((item) => item.docId));
        } catch (error) {
            const reason = `绑定映射失败：${error instanceof Error ? error.message : String(error)}`;
            for (const item of bound) {
                unknown.push({ name: item.plan.draft.name, reason, planIndex: item.planIndex });
                results.push({ planIndex: item.planIndex, name: item.plan.draft.name, status: "unknown", reason });
            }
        }
    }

    for (const item of bound) {
        if (unknown.some((entry) => entry.planIndex === item.planIndex)) continue;
        const itemId = itemMap[item.docId];
        if (!itemId) {
            const reason = "绑定数据库失败（未获得行 ID）";
            unknown.push({ name: item.plan.draft.name, reason, planIndex: item.planIndex });
            results.push({ planIndex: item.planIndex, name: item.plan.draft.name, status: "unknown", reason });
            continue;
        }
        try {
            const failedFields = await writeDraftCells(settings, itemId, item.plan.draft);
            if (failedFields.length > 0) throw new Error(`字段写入失败：${failedFields.join("、")}`);
            report.imported += 1;
            results.push({ planIndex: item.planIndex, name: item.plan.draft.name, status: "imported" });
        } catch (error) {
            const reason = `写入字段失败：${error instanceof Error ? error.message : String(error)}`;
            unknown.push({ name: item.plan.draft.name, reason, planIndex: item.planIndex });
            results.push({ planIndex: item.planIndex, name: item.plan.draft.name, status: "unknown", reason });
        }
        done += 1;
        onProgress?.(done, chosen.length);
    }

    invalidateRoster();
    return report;
}

/**
 * 重试失败/未知项（F14）：先重新读名册核对——已有同名一律跳过，禁止盲重试；
 * 其余按单条路径建人（建文档失败=failed，绑行/写值失败=unknown）。
 * 返回逐项结果（planIndex 原样带回），调用方负责合并回报告。
 */
export async function retryVcfContacts(
    settings: ContactsSettings,
    plans: readonly { planIndex: number; plan: VcfImportPlan }[],
): Promise<VcfItemResult[]> {
    const roster = await getRoster(settings);
    const existingNames = new Set(roster.map((person) => person.name));
    const results: VcfItemResult[] = [];
    for (const { planIndex, plan } of plans) {
        if (existingNames.has(plan.contact.name)) {
            results.push({ planIndex, name: plan.contact.name, status: "skipped", reason: "核对名册：已有同名联系人，跳过重建" });
            continue;
        }
        let docId: string;
        try {
            docId = await createDocWithMd(
                settings.notebookId,
                `/${settings.notebookName}/${plan.draft.name}`,
                `# ${plan.draft.name}\n\n`,
            );
            if (!docId) throw new Error("创建人物文档失败");
        } catch (error) {
            results.push({ planIndex, name: plan.contact.name, status: "failed", reason: error instanceof Error ? error.message : String(error) });
            continue;
        }
        try {
            await bindDocsAsRows(settings.avId, settings.dbBlockId, [{ id: docId, content: plan.draft.name }]);
            const itemMap = await mapBoundDocIds(settings.avId, [docId]);
            const itemId = itemMap[docId];
            if (!itemId) throw new Error("未获得行 ID");
            const failedFields = await writeDraftCells(settings, itemId, plan.draft);
            if (failedFields.length > 0) throw new Error(`字段写入失败：${failedFields.join("、")}`);
            results.push({ planIndex, name: plan.contact.name, status: "imported" });
        } catch (error) {
            results.push({ planIndex, name: plan.contact.name, status: "unknown", reason: error instanceof Error ? error.message : String(error) });
        }
    }
    invalidateRoster();
    return results;
}

/** 名册 → vCard 3.0 文本（微信号无标准 vCard 属性，不导出） */
export async function exportVcfText(settings: ContactsSettings, selectedItemIds?: readonly string[]): Promise<string> {
    const people = await getRoster(settings);
    const selected = selectedItemIds ? new Set(selectedItemIds) : null;
    const exportPeople = selected ? people.filter((person) => selected.has(person.itemId)) : people;
    const contacts: VCardContact[] = exportPeople.map((person) => ({
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

/** F14 取值函数：逐项结果（svelte 组件经此消费，避免跨文件新字段解析差异） */
export function pickItemResults(report: VcfImportReport | null): VcfItemResult[] {
    return report?.results ?? [];
}

export function pickRetryCount(report: VcfImportReport | null): number {
    return (report?.failed.length ?? 0) + (report?.unknown.length ?? 0);
}

/** 合并重试结果：按 planIndex 替换原失败/未知项，返回更新后的报告与新增导入数 */
export function mergeVcfRetryResults(
    report: VcfImportReport,
    retryResults: readonly VcfItemResult[],
): { report: VcfImportReport; newlyImported: number } {
    let newlyImported = 0;
    const merged = report.results.map((old) => {
        if (old.status !== "failed" && old.status !== "unknown") return old;
        const replacement = retryResults.find((item) => item.planIndex === old.planIndex);
        if (!replacement) return old;
        if (replacement.status === "imported") newlyImported += 1;
        return replacement;
    });
    return {
        report: {
            ...report,
            imported: report.imported + newlyImported,
            failed: merged.filter((item) => item.status === "failed").map((item) => ({ name: item.name, reason: item.reason ?? "" })),
            unknown: merged.filter((item) => item.status === "unknown").map((item) => ({ name: item.name, reason: item.reason ?? "", planIndex: item.planIndex })),
            results: merged,
        },
        newlyImported,
    };
}
