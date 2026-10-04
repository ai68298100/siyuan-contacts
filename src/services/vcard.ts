/**
 * vCard 导入导出服务：解析预览（对名册查重）→ 批量建人；名册 → .vcf 文本。
 * 写放大控制对齐收编路径（DATA-CONTRACT §4）：逐篇建文档不可避免，
 * 绑行 200/批合并、绑定映射一次批量、单元格写入复用 contacts 的 writeDraftCells。
 */
import { parseVcfForImport, serializeVcf } from "../domain/vcard.ts";
import type { VCardContact, VcfDocumentCheckpoint } from "../domain/vcard.ts";
import { emptyDraft, validateDraft } from "../domain/person";
import type { ContactDraft } from "../domain/person";
import type { WritableContactField } from "../domain/contact-write.ts";
import { buildContactWritePlan } from "../domain/contact-write.ts";
import type { ContactsSettings } from "../domain/model";
import { VCARD_REQUEST_ATTR } from "../api/blocks";
import { ensurePersonRequestDocument, PersonCreationUnknownError } from "./person-document";
import { bindDocsAsRows, mapBoundDocIds } from "../api/av";
import { getRoster, invalidateRoster } from "./roster";
import { assertContactWriteReady, previewContactCreation } from "./contacts";
import { withStoreLock } from "../data/storage";
import { draftImportMappings, importAnchor } from "../domain/import.ts";
import type { ImportMapping } from "../domain/import.ts";
import { writeImportFields } from "./import";
import type { ImportQueueControl } from "./import";
import { discoverAllImportCandidates } from "./import-scan";

const BIND_CHUNK = 200;

export interface VcfImportPlan {
    contact: VCardContact;
    draft: ContactDraft;
    /** 与名册（或本批次在前项）同名：默认不勾选，导入时跳过（D-0007 防重同源语义） */
    duplicate: boolean;
    allowSameName?: boolean;
    existingCandidates?: Array<{ docId: string; itemId: string; name: string }>;
    sameNameInBatch?: boolean;
    checkpoint?: VcfDocumentCheckpoint;
    mappings?: ImportMapping[];
    unresolvedDocIds?: string[];
    anchor?: string;
}

export type VcfItemStatus = "imported" | "skipped" | "failed" | "unknown" | "pending";

/** 逐项导入结果（F14 三段报告单）：
 * imported=完全成功；skipped=同名跳过或核对后已存在；
 * failed=确定未写入（建文档失败）；unknown=文档可能已建但绑定/字段未确认（重试前先核对名册） */
export interface VcfItemResult {
    /** plans 数组中的下标，用于重试定位 */
    planIndex: number;
    name: string;
    status: VcfItemStatus;
    reason?: string;
    failedFields?: readonly WritableContactField[];
    checkpoint?: VcfDocumentCheckpoint;
}

async function ensureVcfDocument(settings: ContactsSettings, plan: VcfImportPlan): Promise<string> {
    return ensurePersonRequestDocument(settings, plan, VCARD_REQUEST_ATTR);
}

function vcfResult(planIndex: number, plan: VcfImportPlan, status: VcfItemStatus, reason?: string, failedFields?: readonly WritableContactField[]): VcfItemResult {
    return { planIndex, name: plan.draft.name, status, ...(reason ? { reason } : {}), ...(failedFields ? { failedFields } : {}), ...(plan.checkpoint ? { checkpoint: { ...plan.checkpoint } } : {}) };
}

export interface VcfImportReport {
    imported: number;
    duplicates: string[];
    failed: { name: string; reason: string }[];
    /** 未知结果项：文档可能已创建，重试前需核对名册，禁止盲重试 */
    unknown: { name: string; reason: string; planIndex: number; failedFields?: readonly WritableContactField[] }[];
    /** 逐项结果 */
    results: VcfItemResult[];
    expected?: number;
    paused?: boolean;
}

/** 解析 vCard 文本并对名册查重，产出可预览勾选的导入计划 */
export async function buildVcfImportPlan(settings: ContactsSettings, text: string): Promise<VcfImportPlan[]> {
    const parsed = parseVcfForImport(text);
    invalidateRoster();
    const roster = await getRoster(settings);
    const existingNames = new Set(roster.map((person) => person.name));
    const seenInBatch = new Set<string>();
    const unbound = await discoverAllImportCandidates(settings, settings.notebookId);
    return parsed.map((contact) => {
        const sameNameInBatch = seenInBatch.has(contact.name);
        const duplicate = existingNames.has(contact.name) || sameNameInBatch;
        seenInBatch.add(contact.name);
        const draft: ContactDraft = {
            ...emptyDraft(), name: contact.name, phone: contact.phone, email: contact.email,
            website: contact.website, birthday: contact.birthday, isLunar: contact.isLunar, tags: [...contact.tags],
        };
        return {
            contact,
            draft,
            anchor: importAnchor(settings),
            mappings: draftImportMappings("vcard", draft, contact.unsupportedProperties, contact.needsReview),
            duplicate,
            existingCandidates: roster.filter((person) => person.name === contact.name).map((person) => ({ docId: person.docId, itemId: person.itemId, name: person.name })),
            sameNameInBatch,
            unresolvedDocIds: unbound.filter((candidate) => candidate.name === contact.name).map((candidate) => candidate.docId),
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
    return withStoreLock(`person-create-${settings.avId}`, () => importVcfContactsLocked(settings, entries, onProgress));
}

async function importVcfContactsLocked(
    settings: ContactsSettings,
    entries: readonly { planIndex: number; plan: VcfImportPlan }[],
    onProgress?: (done: number, total: number) => void,
): Promise<VcfImportReport> {
    const chosen = entries.filter((entry) => !entry.plan.duplicate || entry.plan.allowSameName === true);
    const failed: { name: string; reason: string }[] = [];
    const unknown: VcfImportReport["unknown"] = [];
    const results: VcfItemResult[] = [];
    const report: VcfImportReport = { imported: 0, duplicates: [], failed, unknown, results };
    if (chosen.length === 0) return report;
    await assertContactWriteReady(settings);
    invalidateRoster();
    const existingNames = new Set((await getRoster(settings)).map((person) => person.name));

    // ① 逐篇建文档（createDocWithMd 单文档语义，无法合并）；失败 → failed（确定未写入）
    const created: { plan: VcfImportPlan; planIndex: number; docId: string; resumed: boolean }[] = [];
    let done = 0;
    for (const { plan, planIndex } of chosen) {
        if (plan.anchor && plan.anchor !== importAnchor(settings)) {
            const reason = "导入锚点已变化，原卡片队列未执行，请重新核对";
            failed.push({ name: plan.draft.name, reason });
            results.push(vcfResult(planIndex, plan, "failed", reason));
            continue;
        }
        const draftErrors = validateDraft(plan.draft);
        if (draftErrors.length > 0) {
            const reason = `资料校验失败，未创建联系人：${draftErrors.join("；")}`;
            failed.push({ name: plan.draft.name, reason });
            results.push(vcfResult(planIndex, plan, "failed", reason));
            done += 1;
            onProgress?.(done, chosen.length);
            continue;
        }
        try {
            const resumed = Boolean(plan.checkpoint);
            if (!resumed) {
                const preview = await previewContactCreation(settings, plan.draft.name);
                const unresolved = preview.unbound.filter((candidate) => plan.allowSameName !== true || !created.some((item) =>
                    item.docId === candidate.docId && item.plan.checkpoint?.state === "verified" && item.plan.checkpoint.docId === item.docId));
                if (unresolved.length) {
                    results.push(vcfResult(planIndex, plan, "unknown", "发现未绑定同名文档，可能为原请求残留；请按文档 ID 核实并收编，未再次建档"));
                    unknown.push({ name: plan.draft.name, reason: "未绑定文档尚未核实，未发送创建", planIndex });
                    done += 1;
                    onProgress?.(done, chosen.length);
                    continue;
                }
            }
            if (!resumed && existingNames.has(plan.draft.name.trim()) && plan.allowSameName !== true) {
                results.push(vcfResult(planIndex, plan, "skipped", "当前名册出现同名候选，请逐项确认独立人物；未自动创建或合并"));
                report.duplicates.push(plan.draft.name);
                done += 1;
                onProgress?.(done, chosen.length);
                continue;
            }
            const docId = await ensureVcfDocument(settings, plan);
            existingNames.add(plan.draft.name.trim());
            created.push({ plan, planIndex, docId, resumed });
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            const status = error instanceof PersonCreationUnknownError ? "unknown" : "failed";
            if (status === "unknown") unknown.push({ name: plan.draft.name, reason, planIndex });
            else failed.push({ name: plan.draft.name, reason });
            results.push(vcfResult(planIndex, plan, status, reason));
        }
        done += 1;
        onProgress?.(done, chosen.length);
    }

    // ② 绑行为联系人（200/批，与收编同款写放大控制）→ ③ 批量映射 → ④ 逐人写单元格。
    // 批量之后的失败无法归因单条写入状态 → unknown（文档可能已建，重试前核对名册）
    for (let start = 0; start < created.length; start += BIND_CHUNK) {
        const chunk = created.slice(start, start + BIND_CHUNK);
        try {
            const currentMap = await mapBoundDocIds(settings.avId, chunk.map((item) => item.docId));
            const unbound = chunk.filter((item) => !currentMap[item.docId]);
            if (unbound.length) await bindDocsAsRows(
                settings.avId, settings.dbBlockId,
                unbound.map((item) => ({ id: item.docId, content: item.plan.draft.name })),
            );
        } catch (error) {
            const reason = `绑定数据库失败：${error instanceof Error ? error.message : String(error)}`;
            for (const item of chunk) {
                unknown.push({ name: item.plan.draft.name, reason, planIndex: item.planIndex });
                results.push(vcfResult(item.planIndex, item.plan, "unknown", reason));
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
                results.push(vcfResult(item.planIndex, item.plan, "unknown", reason));
            }
        }
    }

    for (const item of bound) {
        if (unknown.some((entry) => entry.planIndex === item.planIndex)) continue;
        const itemId = itemMap[item.docId];
        if (!itemId) {
            const reason = "绑定数据库失败（未获得行 ID）";
            unknown.push({ name: item.plan.draft.name, reason, planIndex: item.planIndex });
            results.push(vcfResult(item.planIndex, item.plan, "unknown", reason));
            continue;
        }
        try {
            if (item.plan.checkpoint?.itemId && item.plan.checkpoint.itemId !== itemId) throw new Error("原文档的绑定行已变化，结果未知；未补写字段");
            if (item.plan.checkpoint) item.plan.checkpoint.itemId = itemId;
            const writeReport = (await writeImportFields(settings, { docId: item.docId, itemId },
                { ...emptyDraft(), name: item.plan.draft.name }, item.plan.draft, vcfWritableFields(item.plan.draft))).report;
            if (!writeReport.complete) {
                const failedFields = writeReport.unresolved.map((failure) => failure.field);
                const reason = `写入字段失败：${writeReport.unresolved.map((failure) => `${failure.label}（${failure.message}）`).join("、")}`;
                unknown.push({ name: item.plan.draft.name, reason, planIndex: item.planIndex, failedFields });
                results.push(vcfResult(item.planIndex, item.plan, "unknown", reason, failedFields));
                continue;
            }
            report.imported += 1;
            results.push(vcfResult(item.planIndex, item.plan, "imported"));
        } catch (error) {
            const reason = `写入字段失败：${error instanceof Error ? error.message : String(error)}`;
            unknown.push({ name: item.plan.draft.name, reason, planIndex: item.planIndex });
            results.push(vcfResult(item.planIndex, item.plan, "unknown", reason));
        }
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
    plans: readonly { planIndex: number; plan: VcfImportPlan; failedFields?: readonly WritableContactField[] }[],
): Promise<VcfItemResult[]> {
    return withStoreLock(`person-create-${settings.avId}`, () => retryVcfContactsLocked(settings, plans));
}

async function retryVcfContactsLocked(
    settings: ContactsSettings,
    plans: readonly { planIndex: number; plan: VcfImportPlan; failedFields?: readonly WritableContactField[] }[],
): Promise<VcfItemResult[]> {
    if (plans.length === 0) return [];
    await assertContactWriteReady(settings);
    invalidateRoster();
    const roster = await getRoster(settings);
    const results: VcfItemResult[] = [];
    for (const { planIndex, plan, failedFields } of plans) {
        if (plan.anchor && plan.anchor !== importAnchor(settings)) {
            results.push(vcfResult(planIndex, plan, "failed", "导入锚点已变化，未续做原请求", failedFields));
            continue;
        }
        const draftErrors = validateDraft(plan.draft);
        if (draftErrors.length > 0) {
            results.push(vcfResult(planIndex, plan, "failed", `资料校验失败，未写入：${draftErrors.join("；")}`));
            continue;
        }
        if (!plan.checkpoint && failedFields?.length) {
            results.push(vcfResult(planIndex, plan, "unknown", "缺少原请求文档断点，未按同名联系人补写字段", failedFields));
            continue;
        }
        if (!plan.checkpoint && (await previewContactCreation(settings, plan.draft.name)).unbound.length) {
            results.push(vcfResult(planIndex, plan, "unknown", "未绑定同名文档尚未核实，未用新请求再次建档"));
            continue;
        }
        if (!plan.checkpoint && plan.allowSameName !== true && roster.some((person) => person.name === plan.draft.name.trim())) {
            results.push(vcfResult(planIndex, plan, "skipped", "核对名册：已有同名联系人，跳过重建"));
            continue;
        }
        let docId: string;
        try {
            docId = await ensureVcfDocument(settings, plan);
        } catch (error) {
            results.push(vcfResult(planIndex, plan, error instanceof PersonCreationUnknownError ? "unknown" : "failed", error instanceof Error ? error.message : String(error), failedFields));
            continue;
        }
        try {
            let itemMap = await mapBoundDocIds(settings.avId, [docId]);
            if (!itemMap[docId]) {
                await bindDocsAsRows(settings.avId, settings.dbBlockId, [{ id: docId, content: plan.draft.name }]);
                itemMap = await mapBoundDocIds(settings.avId, [docId]);
            }
            const itemId = itemMap[docId];
            if (!itemId) throw new Error("未获得行 ID");
            if (plan.checkpoint?.itemId && plan.checkpoint.itemId !== itemId) throw new Error("原文档的绑定行已变化，结果未知；未补写字段");
            if (plan.checkpoint) plan.checkpoint.itemId = itemId;
            const retryFields = failedFields ?? vcfWritableFields(plan.draft);
            const report = (await writeImportFields(settings, { docId, itemId },
                { ...emptyDraft(), name: plan.draft.name }, plan.draft, retryFields)).report;
            if (!report.complete) {
                const nextFailedFields = report.unresolved.map((failure) => failure.field);
                const reason = `字段写入失败：${report.unresolved.map((failure) => `${failure.label}（${failure.message}）`).join("、")}`;
                results.push(vcfResult(planIndex, plan, "unknown", reason, nextFailedFields));
            } else {
                results.push(vcfResult(planIndex, plan, "imported"));
            }
        } catch (error) {
            results.push(vcfResult(planIndex, plan, "unknown", error instanceof Error ? error.message : String(error), failedFields));
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
    return (report?.failed.length ?? 0) + (report?.unknown.length ?? 0) + (report?.results.filter((item) => item.status === "pending").length ?? 0);
}

function vcfWritableFields(draft: ContactDraft): WritableContactField[] {
    const fields = buildContactWritePlan(draft, "create").writes.map((write) => write.field);
    if (fields.includes("birthday") && !fields.includes("lunarBirthday")) fields.push("lunarBirthday");
    return fields;
}

export async function runVcfImportQueue(
    settings: ContactsSettings,
    entries: readonly { planIndex: number; plan: VcfImportPlan }[],
    previous: VcfImportReport | null = null,
    control: ImportQueueControl = {},
): Promise<VcfImportReport> {
    const results = new Map<number, VcfItemResult>(previous?.results.map((item) => [item.planIndex, { ...item }]) ?? []);
    const duplicates = [...(previous?.duplicates ?? [])];
    for (const entry of entries) {
        entry.plan.anchor ??= importAnchor(settings);
        if (!results.has(entry.planIndex)) results.set(entry.planIndex, vcfResult(entry.planIndex, entry.plan, "pending"));
    }
    for (const entry of entries) {
        if (control.shouldPause?.()) break;
        const prior = results.get(entry.planIndex)!;
        if (prior.status === "imported" || prior.status === "skipped") continue;
        if (control.retryOnly && prior.status === "pending") continue;
        try {
            if (entry.plan.anchor !== importAnchor(settings)) throw new Error("导入锚点已变化，原卡片队列未执行，请重新核对");
            const report = prior.status === "pending"
                ? await importVcfContacts(settings, [entry])
                : { results: await retryVcfContacts(settings, [{ ...entry, failedFields: prior.failedFields }]), duplicates: [] };
            const result = report.results.find((item) => item.planIndex === entry.planIndex);
            results.set(entry.planIndex, result ?? vcfResult(entry.planIndex, entry.plan, "skipped", "同名项未明确确认，未写入"));
            duplicates.push(...report.duplicates);
        } catch (error) {
            results.set(entry.planIndex, vcfResult(entry.planIndex, entry.plan, entry.plan.checkpoint ? "unknown" : "failed",
                error instanceof Error ? error.message : String(error)));
        }
        control.onProgress?.([...results.values()].filter((item) => item.status === "imported" || item.status === "skipped").length, entries.length);
    }
    const items = [...results.values()].sort((left, right) => left.planIndex - right.planIndex);
    return {
        results: items, imported: items.filter((item) => item.status === "imported").length, duplicates: [...new Set(duplicates)],
        failed: items.filter((item) => item.status === "failed").map((item) => ({ name: item.name, reason: item.reason ?? "" })),
        unknown: items.filter((item) => item.status === "unknown").map((item) => ({ name: item.name, reason: item.reason ?? "", planIndex: item.planIndex, failedFields: item.failedFields })),
        expected: entries.length, paused: items.some((item) => item.status === "pending"),
    };
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
            unknown: merged.filter((item) => item.status === "unknown").map((item) => ({
                name: item.name,
                reason: item.reason ?? "",
                planIndex: item.planIndex,
                failedFields: item.failedFields,
            })),
            results: merged,
        },
        newlyImported,
    };
}
