import { bindDocsAsRows, mapBoundDocIds } from "../api/av";
import { KernelPermissionError, KernelResponseError } from "../api/client";
import { readMarkedBlocks, readNotebookDocument } from "../api/blocks";
import { withStoreLock } from "../data/storage";
import { emptyDraft, validateDraft } from "../domain/person";
import type { ContactDraft, ContactSummary } from "../domain/person";
import { importAnchor, resolveImportFields } from "../domain/import.ts";
import type { DocumentImportQueue } from "../domain/import.ts";
import { buildContactWritePlan, summarizeContactWriteResults } from "../domain/contact-write.ts";
import type { ContactFieldResult, ContactWriteReport, WritableContactField } from "../domain/contact-write.ts";
import type { ContactsSettings } from "../domain/model";
import { assertContactWriteReady, retryContactFields, writeDraftCells } from "./contacts";
import { getRoster, invalidateRoster } from "./roster";

export interface ImportQueueControl {
    retryOnly?: boolean;
    shouldPause?: () => boolean;
    onProgress?: (done: number, total: number) => void;
}

async function readImportPerson(settings: ContactsSettings, docId: string, itemId: string): Promise<ContactSummary> {
    const mapping = await mapBoundDocIds(settings.avId, [docId]);
    if (mapping[docId] !== itemId) throw new Error("原人物的绑定行已变化或已解绑，未按同名重绑");
    invalidateRoster();
    const matches = (await getRoster(settings)).filter((person) => person.docId === docId || person.itemId === itemId);
    if (matches.length !== 1 || matches[0].docId !== docId || matches[0].itemId !== itemId) throw new Error("原人物没有唯一稳定绑定，未写入字段");
    return matches[0];
}

export interface ImportFieldReport {
    report: ContactWriteReport;
    conflicts: WritableContactField[];
    unresolvedFields: WritableContactField[];
}

const importFieldRequests = new Map<string, Array<{ draft: ContactDraft; fields: readonly WritableContactField[] }>>();

export async function writeImportFields(
    settings: ContactsSettings,
    target: Pick<ContactSummary, "docId" | "itemId">,
    baseline: ContactDraft,
    submitted: ContactDraft,
    onlyFields: readonly WritableContactField[],
    options: { retry?: boolean } = {},
): Promise<ImportFieldReport> {
    const errors = validateDraft(submitted);
    if (errors.length) throw new Error(errors.join("；"));
    const input = { ...submitted, tags: [...submitted.tags] };
    const requestKey = JSON.stringify([importAnchor(settings), target.docId, target.itemId,
        buildContactWritePlan(baseline, "edit").writes, buildContactWritePlan(input, "edit").writes]);
    return withStoreLock(`import-fields-${settings.avId}-${target.docId}`, async () => {
        const fresh = await readImportPerson(settings, target.docId, target.itemId);
        const resolution = resolveImportFields(fresh, baseline, input, onlyFields);
        const labels = buildContactWritePlan(input, "edit", onlyFields).writes;
        const requests = importFieldRequests.get(requestKey) ?? [];
        const original = requests.find((request) => labels.every((write) => request.fields.includes(write.field)))?.draft;
        const retry = options.retry || original !== undefined;
        const blockedFields = retry ? resolution.conflicts.filter((field) => field === "birthday" || field === "lunarBirthday") : resolution.conflicts;
        const retryFields = labels.map((write) => write.field).filter((field) => !blockedFields.includes(field));
        if (!retry) {
            requests.push({ draft: { ...resolution.draft, tags: [...resolution.draft.tags] }, fields: labels.map((write) => write.field) });
            importFieldRequests.set(requestKey, requests);
        }
        const written = retry
            ? await retryContactFields(settings, target.itemId, original ?? input, retryFields, target)
            : resolution.fields.length
                ? await writeDraftCells(settings, target.itemId, resolution.draft, { mode: "edit", onlyFields: resolution.fields, expected: target })
                : summarizeContactWriteResults("edit", []);
        const verified = (retry ? [] : resolution.verified).map((field): ContactFieldResult => ({
            field, label: labels.find((write) => write.field === field)!.label, status: "skipped", requestStatus: "not_sent",
        }));
        const conflicts = blockedFields.map((field): ContactFieldResult => ({
            field, label: labels.find((write) => write.field === field)!.label, status: retry ? "unknown" : "failed", requestStatus: "not_sent",
            message: retry ? "原生日与历法参照已变化，原请求结果尚未核实；未重发" : "当前字段已由其他操作改变，已保留最新值；请重新读取后人工确认",
        }));
        const report = summarizeContactWriteResults("edit", [...written.results, ...verified, ...conflicts]);
        return { report, conflicts: retry ? [] : resolution.conflicts, unresolvedFields: report.unresolved.map((failure) => failure.field) };
    });
}

export async function runDocumentImportQueue(
    settings: ContactsSettings,
    queue: DocumentImportQueue,
    control: ImportQueueControl = {},
): Promise<DocumentImportQueue> {
    if (queue.anchor !== importAnchor(settings)) throw new Error("导入锚点已变化，原队列未执行");
    return withStoreLock(`person-create-${settings.avId}`, async () => {
        await assertContactWriteReady(settings);
        for (const item of queue.items) {
            if (control.shouldPause?.()) break;
            if (item.status === "applied" || item.status === "skipped") continue;
            if (control.retryOnly && item.status === "pending") continue;
            try {
                if (item.docId === settings.hostDocId) {
                    item.status = "conflict";
                    item.message = "原来源现为人脉数据库文档，未收编为人物";
                    continue;
                }
                const doc = await readNotebookDocument(item.notebookId, item.docId);
                if (!doc || doc.name.trim() !== item.name) {
                    item.status = "conflict";
                    item.message = "来源文档已改名、移动或删除，请重新核对原文档 ID";
                    continue;
                }
                if ((await readMarkedBlocks(item.docId, "custom-lvct-org")).length) {
                    item.status = "conflict";
                    item.message = "来源文档现为组织文档，未收编为人物";
                    continue;
                }
                let itemId = (await mapBoundDocIds(settings.avId, [item.docId]))[item.docId];
                if (item.itemId && itemId !== item.itemId) {
                    item.status = "conflict";
                    item.message = "原绑定行变化，未自动重绑或补写";
                    continue;
                }
                if (item.binding === "pending" && itemId) {
                    item.itemId = itemId;
                    item.binding = "verified";
                    item.status = "skipped";
                    item.message = "其他操作已收编该文档，已保留其字段";
                    continue;
                }
                if (!itemId) {
                    if (item.binding === "unknown" || item.binding === "verified") {
                        item.status = "unknown";
                        item.message = "原绑定请求尚未核实，未再次发送，请稍后只读核实";
                        continue;
                    }
                    item.binding = "unknown";
                    let bindingError: unknown;
                    try { await bindDocsAsRows(settings.avId, settings.dbBlockId, [{ id: item.docId, content: doc.name }]); }
                    catch (error) { bindingError = error; }
                    itemId = (await mapBoundDocIds(settings.avId, [item.docId]))[item.docId];
                    if (!itemId) {
                        if (bindingError instanceof KernelResponseError || bindingError instanceof KernelPermissionError) item.binding = "rejected";
                        item.status = item.binding === "rejected" ? "failed" : "unknown";
                        item.message = item.binding === "rejected" ? "内核明确拒绝绑定，可重试原文档" : "绑定请求已发出，原行尚未核实；未重发";
                        continue;
                    }
                }
                item.itemId = itemId;
                item.binding = "verified";
                item.baseline ??= { ...emptyDraft(), name: item.name };
                const submitted = { ...item.baseline, group: queue.group, tags: [...queue.tags] };
                const retry = item.unresolvedFields !== undefined;
                const fields: WritableContactField[] = item.unresolvedFields ?? [
                    ...(queue.group ? ["group" as const] : []), ...(queue.tags.length ? ["tags" as const] : []),
                ];
                item.unresolvedFields = fields;
                const result = await writeImportFields(settings, { docId: item.docId, itemId }, item.baseline, submitted, fields, { retry });
                item.unresolvedFields = result.unresolvedFields;
                item.status = result.conflicts.length ? "conflict" : result.report.unknown.length ? "unknown" : result.report.complete ? "applied" : "failed";
                item.message = result.report.unresolved.map((failure) => `${failure.label}：${failure.message}`).join("；");
            } catch (error) {
                item.status = item.binding === "unknown" || item.binding === "verified" ? "unknown" : "failed";
                item.message = error instanceof Error ? error.message : String(error);
            } finally {
                invalidateRoster();
                control.onProgress?.(queue.items.filter((entry) => entry.status === "applied" || entry.status === "skipped").length, queue.items.length);
            }
        }
        return queue;
    });
}
