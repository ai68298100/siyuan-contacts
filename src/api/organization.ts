/** 组织标记读取 API：只封装已在隔离内核 spike 验证过的 SQL 分页形态。 */
import { assertKernelRecord, querySql } from "./client";
import { KernelProtocolError } from "./kernel-contract";

const ID_PATTERN = /^\d{14}-[0-9a-z]{7}$/;

export interface OrganizationMarkerRow {
    root_id: string;
    ial: string;
    maxIal: string;
    markerCount: number;
}

export interface OrganizationMarkerPage {
    rows: OrganizationMarkerRow[];
    hasMore: boolean;
    nextRootId: string | null;
}

function parseCount(value: unknown): number {
    if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value;
    if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
    throw new KernelProtocolError("/api/query/sql", "组织标记计数返回异常");
}

/** 按根文档 keyset 分页；查询多取一行以区分短页结束。 */
export async function listOrganizationMarkerPage(
    afterRootId = "",
    limit = 200,
): Promise<OrganizationMarkerPage> {
    if (afterRootId !== "" && !ID_PATTERN.test(afterRootId)) throw new Error("组织分页游标不是合法的思源 ID");
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new Error("组织分页大小必须为 1-500");
    const cursor = afterRootId ? ` AND root_id > '${afterRootId}'` : "";
    const rows = await querySql<unknown>(
        `SELECT root_id, MIN(ial) AS ial, MAX(ial) AS maxIal, COUNT(*) AS markerCount FROM blocks WHERE ial LIKE '%custom-lvct-org="%'${cursor} GROUP BY root_id ORDER BY root_id LIMIT ${limit + 1}`,
    );
    const decoded = rows.map((raw) => {
        const row = assertKernelRecord("/api/query/sql", raw);
        if (typeof row.root_id !== "string" || !ID_PATTERN.test(row.root_id)
            || typeof row.ial !== "string" || typeof row.maxIal !== "string") {
            throw new KernelProtocolError("/api/query/sql", "组织标记分页返回异常");
        }
        const markerCount = parseCount(row.markerCount);
        if (markerCount !== 1 || row.ial !== row.maxIal) {
            throw new KernelProtocolError("/api/query/sql", "组织标记存在重复或不一致事实");
        }
        return { root_id: row.root_id, ial: row.ial, maxIal: row.maxIal, markerCount };
    });
    const page = decoded.slice(0, limit);
    return { rows: page, hasMore: decoded.length > limit, nextRootId: page.at(-1)?.root_id ?? null };
}

/** 按分页得到的稳定根文档 ID 批量回读文档事实。 */
export async function readOrganizationDocuments(docIds: readonly string[]): Promise<unknown[]> {
    if (docIds.some((docId) => !ID_PATTERN.test(docId)) || new Set(docIds).size !== docIds.length) {
        throw new Error("组织文档 ID 集合无效");
    }
    if (docIds.length === 0) return [];
    return querySql<unknown>(`SELECT id, content, hpath, box FROM blocks WHERE type='d' AND id IN (${docIds.map((docId) => `'${docId}'`).join(",")})`);
}
