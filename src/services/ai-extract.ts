import { aiChat } from "../api/ai";
import { fetchDocMarkdown } from "../api/blocks";
import { KernelError } from "../api/client";
import { parseExtraction } from "../domain/ai-extract.ts";
import type { ExtractionResult } from "../domain/ai-extract";
import { buildAiCandidateDrafts } from "../domain/ai-candidates";
import type { AiCandidateDraft } from "../domain/ai-candidates";
import { AiExtractionError, buildAiPreflight } from "../domain/ai-preflight";
import type { AiPreflight, AiPreflightOptions } from "../domain/ai-preflight";
import type { ContactSummary } from "../domain/person";
import type { ContactsSettings } from "../domain/model";
import type { ContactsPluginFacade } from "../types";
import { PROFILE_FIELDS } from "../domain/ai-extract";
import type { ProfileField } from "../domain/ai-extract";
import { AsyncOperationError } from "../shared/async";
import { getRoster, invalidateRoster } from "./roster";
import { withStoreLock } from "../data/storage";

export type { ExtractionResult };

export interface AiExtractOutcome {
    extraction: ExtractionResult | null;
    likelyUnconfigured: boolean;
    matched: ContactSummary[];
    unknownNames: string[];
    ambiguousCandidates?: Array<{ name: string; people: ContactSummary[] }>;
    candidates: AiCandidateDraft[];
    preflightId: string;
}

export interface AiExtractionConfirmation {
    preflight: AiPreflight;
    confirmed: true;
    signal?: AbortSignal;
    timeoutMs?: number;
}

const prepared = new WeakMap<AiPreflight, string>();

function anchor(settings: ContactsSettings, docId: string): string {
    return `${settings.notebookId}/${settings.avId}/${settings.dbBlockId}/${docId}`;
}

export async function prepareAiExtraction(settings: ContactsSettings, docId: string, options: AiPreflightOptions = {}): Promise<AiPreflight> {
    if (!/^\d{14}-[a-z0-9]{7}$/.test(docId)) throw new AiExtractionError("source_unavailable");
    if (options.sourceKind && options.sourceKind !== "document" && options.sourceText === undefined) throw new AiExtractionError("source_unavailable");
    let content: string;
    try {
        content = options.sourceText ?? (await fetchDocMarkdown(docId)).content;
    } catch {
        throw new AiExtractionError("source_unavailable");
    }
    const preflight = buildAiPreflight(crypto.randomUUID(), docId, content, options);
    if (!preflight.sentText.trim() || preflight.fields.length === 0) throw new AiExtractionError("confirmation_required");
    prepared.set(preflight, anchor(settings, docId));
    return preflight;
}

function publicError(error: unknown): AiExtractionError {
    if (error instanceof AiExtractionError) return error;
    if (error instanceof AsyncOperationError) return new AiExtractionError(error.kind === "timeout" ? "timeout" : "cancelled");
    if (error instanceof KernelError) {
        if (error.kind === "permission") return new AiExtractionError("permission");
        if (error.kind === "protocol") return new AiExtractionError("protocol");
        if (/未配置|请先|密钥|API key|token|not configured|config.*AI|AI.*config/i.test(error.responseMessage ?? "")) return new AiExtractionError("unconfigured");
    }
    return new AiExtractionError("request_failed");
}

export async function extractFromDoc(settings: ContactsSettings, docId: string, confirmation?: AiExtractionConfirmation): Promise<AiExtractOutcome> {
    if (!confirmation || confirmation.confirmed !== true || prepared.get(confirmation.preflight) !== anchor(settings, docId)) {
        throw new AiExtractionError("confirmation_required");
    }
    const { preflight, signal, timeoutMs } = confirmation;
    prepared.delete(preflight);
    if (signal?.aborted) throw new AiExtractionError("cancelled");
    try {
        const reply = await aiChat(preflight, true, { signal, timeoutMs });
        if (signal?.aborted) throw new AiExtractionError("cancelled");
        const extraction = parseExtraction(reply.trim());
        const likelyUnconfigured = extraction === null && (reply.trim().length === 0 || /未配置|请先|密钥|not configured/i.test(reply.slice(0, 200)));
        if (!extraction) return { extraction: null, likelyUnconfigured, matched: [], unknownNames: [], candidates: [], preflightId: preflight.id };
        const roster = await getRoster(settings);
        if (signal?.aborted) throw new AiExtractionError("cancelled");
        const matched: ContactSummary[] = [];
        const unknownNames: string[] = [];
        const ambiguousCandidates: NonNullable<AiExtractOutcome["ambiguousCandidates"]> = [];
        for (const name of preflight.fields.includes("people") ? extraction.names : []) {
            const candidates = roster.filter((person) => person.name === name);
            if (candidates.length > 1) ambiguousCandidates.push({ name, people: candidates });
            else if (candidates.length === 1) matched.push(candidates[0]);
            else unknownNames.push(name);
        }
        return { extraction, likelyUnconfigured, matched, unknownNames, ambiguousCandidates,
            candidates: buildAiCandidateDrafts(extraction, preflight, roster), preflightId: preflight.id };
    } catch (error) {
        throw publicError(error);
    }
}

export async function applyAcceptedAiDrafts(
    facade: Pick<ContactsPluginFacade, "listContacts" | "updatePersonCandidateFields" | "listPersonFollowUps" | "createFollowUp">,
    drafts: AiCandidateDraft[], mainCaptureComplete: boolean,
): Promise<void> {
    if (!mainCaptureComplete) return;
    for (const candidate of drafts) {
        if (!candidate.checked || candidate.decision !== "accepted" || (candidate.kind !== "profile" && candidate.kind !== "followup")
            || candidate.status === "applied" || candidate.status === "skipped") continue;
        let requestStarted = false;
        try {
            await withStoreLock(`ai-candidate-writes-${candidate.writeCheckpoint?.docId ?? candidate.selectedDocId}`, async () => {
            invalidateRoster();
            const roster = await facade.listContacts();
            const docId = candidate.writeCheckpoint?.docId ?? candidate.selectedDocId;
            const targets = roster.filter((person) => person.docId === docId);
            if (targets.length !== 1 || !docId) {
                candidate.error = "请选择并核实唯一人物文档；未按姓名指派或写入。";
                return;
            }
            const target = targets[0];
            const originalTarget = candidate.targets.find((person) => person.docId === docId);
            if (!candidate.writeCheckpoint && originalTarget && originalTarget.itemId !== target.itemId) {
                candidate.error = "人物绑定行已变化，未写入；请重新核对候选。";
                return;
            }
            if (candidate.kind === "profile" && drafts.some((other) => other.id !== candidate.id && other.kind === "profile" && other.checked
                && other.decision === "accepted" && other.field === candidate.field && other.selectedDocId === docId && other.value !== candidate.value)) {
                candidate.error = "同人物同字段有多个已接受值，请保留一项；未写入。";
                return;
            }
            if (candidate.writeCheckpoint && (candidate.writeCheckpoint.itemId !== target.itemId || candidate.selectedDocId !== candidate.writeCheckpoint.docId
                || candidate.value !== candidate.writeCheckpoint.value || candidate.title !== candidate.writeCheckpoint.title || candidate.dueDate !== candidate.writeCheckpoint.dueDate)) {
                candidate.error = "目标或输入已变化，原候选断点暂停；未重发。";
                return;
            }
            const profileField = candidate.field as ProfileField;
            if (!candidate.writeCheckpoint) {
                const baseline = originalTarget?.[profileField] ?? "";
                candidate.writeCheckpoint = { docId, itemId: target.itemId, value: candidate.value, title: candidate.title, dueDate: candidate.dueDate, baseline };
            }
            const checkpoint = candidate.writeCheckpoint;
            if (candidate.kind === "profile") {
                if (!PROFILE_FIELDS.includes(profileField)) { candidate.error = "资料字段不支持，未写入。"; return; }
                if (target[profileField] === checkpoint.value) { candidate.status = "skipped"; candidate.error = ""; return; }
                if (candidate.status === "unknown") { candidate.error = "上次资料请求结果未知，未重发；请先核实。"; return; }
                if (target[profileField] !== "") { candidate.status = "skipped"; candidate.error = "已有资料保留，请手动核对冲突。"; return; }
                requestStarted = true;
                const applied = await facade.updatePersonCandidateFields(checkpoint.itemId, [{ field: profileField, value: checkpoint.value, baseline: checkpoint.baseline }]);
                if (!applied.report.complete) {
                    candidate.status = applied.report.unknown.length > 0 ? "unknown" : "failed";
                    candidate.error = "资料写后尚未核实，保留原候选和断点。";
                } else {
                    candidate.status = applied.conflicts.length > 0 ? "skipped" : "applied";
                    candidate.error = applied.conflicts.length > 0 ? "资料存在冲突，未覆盖。" : "";
                }
                return;
            }
            const existing = await facade.listPersonFollowUps(docId);
            const matches = existing.filter((item) => item.title === checkpoint.title && item.dueDate === checkpoint.dueDate && item.personDocId === docId);
            if (checkpoint.followUpId) {
                const verified = matches.find((item) => item.id === checkpoint.followUpId);
                if (verified && !verified.docSyncPending) { candidate.status = "applied"; candidate.error = ""; }
                else { candidate.status = "unknown"; candidate.error = "原跟进或文档投影未核实，未重建。"; }
                return;
            }
            if (candidate.status === "unknown") {
                candidate.error = "上次跟进创建结果未知；没有原跟进 ID，未按标题认定归属或重建。";
                return;
            }
            if (matches.length > 0) {
                candidate.status = "skipped";
                candidate.error = "已有同内容跟进，未另行创建。";
                return;
            }
            requestStarted = true;
            const created = await facade.createFollowUp(docId, checkpoint.title, checkpoint.dueDate);
            checkpoint.followUpId = created.id;
            candidate.status = "unknown";
            const verified = (await facade.listPersonFollowUps(docId)).find((item) => item.id === created.id && item.personDocId === docId
                && item.title === checkpoint.title && item.dueDate === checkpoint.dueDate && !item.docSyncPending);
            candidate.status = verified ? "applied" : "unknown";
            candidate.error = verified ? "" : "跟进写后回读或文档投影未核实；未自动重建。";
            });
        } catch {
            if (requestStarted) candidate.status = "unknown";
            candidate.error = requestStarted ? "候选请求结果未知，保留原断点；未自动重发。" : "候选读取失败，未发出写入；保留草稿。";
        }
    }
}
