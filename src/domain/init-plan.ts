/**
 * 初始化现场识别：从内核返回的块 markdown 还原数据库锚点。
 * 为什么需要（D-0019）：初始化链必须可续建——第一次中途失败后重跑向导，
 * 要能找回已建成的笔记本/宿主文档/数据库/字段，而不是撞名失败。
 * 库块自身 markdown 含 data-av-id（blocks.markdown 列，v3.8.5 实测），
 * 是"数据库块 ID → avID"唯一可靠的还原通道（块 IAL 里没有 avID）。
 */

const AV_ID_PATTERN = /data-av-id="(\d{14}-[0-9a-z]{7})"/;
const NODE_ID_PATTERN = /^\d{14}-[0-9a-z]{7}$/;

export const ANCHOR_SCAN_CURSOR_VERSION = 1 as const;

/**
 * 初始化锚点扫描的可序列化续做游标。
 * 游标绑定一次扫描时的笔记本集合；集合变化时必须重新开始，避免 OFFSET 漂移漏项。
 */
export interface AnchorScanCursor {
    readonly version: typeof ANCHOR_SCAN_CURSOR_VERSION;
    readonly notebookIds: readonly string[];
    readonly notebookId: string;
    readonly afterDocId: string | null;
    readonly scannedDocuments: number;
    readonly scannedInNotebook: number;
}

export function isAnchorScanCursor(value: unknown): value is AnchorScanCursor {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
    const candidate = value as Record<string, unknown>;
    if (candidate.version !== ANCHOR_SCAN_CURSOR_VERSION) return false;
    if (!Array.isArray(candidate.notebookIds) || candidate.notebookIds.length === 0) return false;
    if (candidate.notebookIds.some((id) => typeof id !== "string" || !NODE_ID_PATTERN.test(id))) return false;
    if (new Set(candidate.notebookIds).size !== candidate.notebookIds.length) return false;
    if (typeof candidate.notebookId !== "string" || !candidate.notebookIds.includes(candidate.notebookId)) return false;
    if (candidate.afterDocId !== null && (typeof candidate.afterDocId !== "string" || !NODE_ID_PATTERN.test(candidate.afterDocId))) return false;
    return Number.isSafeInteger(candidate.scannedDocuments)
        && (candidate.scannedDocuments as number) >= 0
        && Number.isSafeInteger(candidate.scannedInNotebook)
        && (candidate.scannedInNotebook as number) >= 0
        && (candidate.scannedInNotebook as number) <= (candidate.scannedDocuments as number);
}

/** 返回 true 代表当前笔记本没有下一页；总数查询不参与遍历边界判断。 */
export function isAnchorScanNotebookExhausted(pageLength: number, requestedPageSize: number): boolean {
    return Number.isSafeInteger(pageLength)
        && pageLength >= 0
        && Number.isSafeInteger(requestedPageSize)
        && requestedPageSize > 0
        && pageLength < requestedPageSize;
}

export function anchorCandidateKey(candidate: {
    notebookId: string;
    hostDocId: string;
    dbBlockId: string;
    avId: string;
}): string {
    return `${candidate.notebookId}/${candidate.hostDocId}/${candidate.dbBlockId}/${candidate.avId}`;
}

/** 从数据库块的 markdown 还原 avID；不是数据库块或缺 avID 时返回 undefined */
export function parseAvIdFromBlockMarkdown(markdown: unknown): string | undefined {
    if (typeof markdown !== "string") return undefined;
    return AV_ID_PATTERN.exec(markdown)?.[1];
}
