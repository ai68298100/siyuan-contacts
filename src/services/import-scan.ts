import { listNotebookDocs, NOTEBOOK_DOC_PAGE_SIZE } from "../api/blocks";
import { mapBoundDocIds } from "../api/av";
import { querySql } from "../api/client";
import { importAnchor, matchesFolderPrefix, normalizeFolderPrefix } from "../domain/import.ts";
import type { ImportDocumentCandidate } from "../domain/import.ts";
import type { ContactsSettings } from "../domain/model";

export interface ImportScanSnapshot {
    scope: string;
    afterDocId?: string;
    scanned: number;
    candidates: ImportDocumentCandidate[];
    state: "complete" | "truncated" | "failed";
    error?: string;
}

export async function scanImportCandidates(
    settings: ContactsSettings,
    notebookId: string,
    options: { keyword?: string; folderPrefix?: string; previous?: ImportScanSnapshot; maxDocuments?: number } = {},
): Promise<ImportScanSnapshot> {
    const keyword = options.keyword?.trim().toLowerCase() ?? "";
    const folder = normalizeFolderPrefix(options.folderPrefix ?? "");
    const scope = JSON.stringify([importAnchor(settings), settings.hostDocId, notebookId, keyword, folder]);
    if (options.previous && options.previous.scope !== scope) throw new Error("扫描来源或筛选已变化，请重新扫描，不能复用原游标");
    const maxDocuments = options.maxDocuments ?? 1000;
    if (!Number.isSafeInteger(maxDocuments) || maxDocuments < 1 || maxDocuments > 10000) throw new Error("单次扫描预算须为 1–10000 篇");
    const snapshot: ImportScanSnapshot = {
        scope, afterDocId: options.previous?.afterDocId, scanned: options.previous?.scanned ?? 0,
        candidates: (options.previous?.candidates ?? []).map((candidate) => ({ ...candidate })), state: "truncated",
    };
    if (options.previous?.state === "complete") return { ...snapshot, state: "complete" };
    let scannedThisCall = 0;
    try {
        while (scannedThisCall < maxDocuments) {
            const limit = Math.min(NOTEBOOK_DOC_PAGE_SIZE, maxDocuments - scannedThisCall);
            const rows = await listNotebookDocs(notebookId, limit, 0, snapshot.afterDocId);
            if (rows.length > limit) throw new Error("文档分页超过请求上限，候选范围尚未核实");
            if (rows.some((row, index) => snapshot.afterDocId && row.id <= snapshot.afterDocId || index > 0 && row.id <= rows[index - 1].id)) {
                throw new Error("文档分页未前进，请核对来源后重试");
            }
            const eligible = rows.filter((row) => row.id !== settings.hostDocId && row.content.trim()
                && matchesFolderPrefix(row.hpath, folder)
                && (!keyword || row.content.toLowerCase().includes(keyword) || row.hpath.toLowerCase().includes(keyword)));
            const ids = eligible.map((row) => row.id);
            const bindings: Record<string, string> = {};
            for (let offset = 0; offset < ids.length; offset += 200) Object.assign(bindings, await mapBoundDocIds(settings.avId, ids.slice(offset, offset + 200)));
            const unbound = ids.filter((docId) => !bindings[docId]);
            const orgs = unbound.length ? await querySql<{ root_id: unknown }>(
                `SELECT DISTINCT root_id FROM blocks WHERE root_id IN (${unbound.map((docId) => `'${docId}'`).join(",")}) AND ial LIKE '%custom-lvct-org="%'`,
            ) : [];
            if (orgs.some((row) => typeof row.root_id !== "string" || !unbound.includes(row.root_id))) throw new Error("组织标记读取形状异常，候选范围尚未核实");
            const orgIds = new Set(orgs.map((row) => row.root_id));
            const seen = new Set(snapshot.candidates.map((candidate) => candidate.docId));
            snapshot.candidates.push(...eligible.filter((row) => !bindings[row.id] && !orgIds.has(row.id) && !seen.has(row.id))
                .map((row) => ({ docId: row.id, name: row.content.trim(), hpath: row.hpath })));
            snapshot.scanned += rows.length;
            scannedThisCall += rows.length;
            if (rows.length) snapshot.afterDocId = rows[rows.length - 1].id;
            if (rows.length < limit) return { ...snapshot, state: "complete" };
        }
        return snapshot;
    } catch (error) {
        return { ...snapshot, state: "failed", error: error instanceof Error ? error.message : String(error) };
    }
}

export async function discoverAllImportCandidates(
    settings: ContactsSettings, notebookId: string, keyword = "", folderPrefix = "",
): Promise<ImportDocumentCandidate[]> {
    let previous: ImportScanSnapshot | undefined;
    do {
        previous = await scanImportCandidates(settings, notebookId, { keyword, folderPrefix, previous });
        if (previous.state === "failed") throw new Error(previous.error ?? "候选扫描失败，未核实完整范围");
    } while (previous.state !== "complete");
    return previous.candidates;
}
