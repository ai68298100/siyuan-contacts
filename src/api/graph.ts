/**
 * 思源原生双链的只读文档投影。refs 表与回链语义已由 B14 隔离内核实证。
 * 不调用 getGraph/getLocalGraph：官方实现会保存传入 conf，覆盖宿主图设置。
 * 所有读取限定登记 ID/中心；按文档对聚合、keyset 分页，不取整库图。
 */
import { assertKernelRecord, querySql } from "./client";
import { KernelProtocolError } from "./kernel-contract";

export interface NativeGraphNode {
    id: string;
    label: string;
    type: string;
    /** 此次文档投影的有向引用计数，展示度数由域层重算。 */
    refs: number;
    defs: number;
}

export interface NativeGraphLink {
    from: string;
    to: string;
    ref?: boolean;
}

export interface NativeGraphData {
    id?: string;
    nodes: NativeGraphNode[];
    links: NativeGraphLink[];
}

const ID_PATTERN = /^\d{14}-[0-9a-z]{7}$/;
const DOC_BATCH_SIZE = 100;
const LINK_PAGE_SIZE = 200;
const MAX_READ_LINKS = 50_000;
/** 限制每次 SQL 白名单体积；局部图按此线性分批，全局超过上限须改中心范围。 */
const MAX_REFERENCE_FILTER_DOCS = 10_000;
const SQL_ROUTE = "/api/query/sql";

function registeredIds(docIds: ReadonlySet<string>): string[] {
    const ids = [...docIds];
    if (ids.some((id) => !ID_PATTERN.test(id))) throw new Error("引用图登记文档 ID 集合无效");
    return ids.sort();
}

function batches(ids: readonly string[], size = DOC_BATCH_SIZE): string[][] {
    const result: string[][] = [];
    for (let start = 0; start < ids.length; start += size) result.push(ids.slice(start, start + size));
    return result;
}

function idList(ids: readonly string[]): string {
    return ids.map((id) => `'${id}'`).join(",");
}

async function readDocuments(ids: readonly string[]): Promise<NativeGraphNode[]> {
    const nodes: NativeGraphNode[] = [];
    for (const batch of batches(ids)) {
        const allowed = new Set(batch);
        const seen = new Set<string>();
        const rows = await querySql<unknown>(`SELECT id, content FROM blocks WHERE type='d' AND id IN (${idList(batch)}) ORDER BY id LIMIT ${DOC_BATCH_SIZE + 1}`);
        for (const raw of rows) {
            const row = assertKernelRecord(SQL_ROUTE, raw);
            if (typeof row.id !== "string" || !allowed.has(row.id) || seen.has(row.id) || typeof row.content !== "string") {
                throw new KernelProtocolError(SQL_ROUTE, "引用图文档回读异常或超出登记范围");
            }
            seen.add(row.id);
            nodes.push({ id: row.id, label: row.content || row.id, type: "NodeDocument", refs: 0, defs: 0 });
        }
    }
    return nodes.sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
}

async function readReferencePairs(
    where: string,
    inScope: (from: string, to: string) => boolean,
    links: Map<string, NativeGraphLink>,
    budget: { read: number },
): Promise<void> {
    let previous = "";
    let afterFrom = "";
    let afterTo = "";
    while (true) {
        const cursor = afterFrom ? ` AND (root_id > '${afterFrom}' OR (root_id = '${afterFrom}' AND def_block_root_id > '${afterTo}'))` : "";
        const rows = await querySql<unknown>(`SELECT root_id, def_block_root_id FROM refs WHERE (${where})${cursor} GROUP BY root_id, def_block_root_id ORDER BY root_id, def_block_root_id LIMIT ${LINK_PAGE_SIZE + 1}`);
        if (rows.length > LINK_PAGE_SIZE + 1) throw new KernelProtocolError(SQL_ROUTE, "引用图分页响应超出读取上限");
        const decoded = rows.map((raw) => {
            const row = assertKernelRecord(SQL_ROUTE, raw);
            if (typeof row.root_id !== "string" || !ID_PATTERN.test(row.root_id)
                || typeof row.def_block_root_id !== "string" || !ID_PATTERN.test(row.def_block_root_id)
                || !inScope(row.root_id, row.def_block_root_id)) {
                throw new KernelProtocolError(SQL_ROUTE, "引用图索引返回异常或超出查询范围");
            }
            return { from: row.root_id, to: row.def_block_root_id, ref: true };
        });
        let pagePrevious = previous;
        for (const link of decoded) {
            const key = `${link.from}~${link.to}`;
            if (key <= pagePrevious) throw new KernelProtocolError(SQL_ROUTE, "引用图分页游标未前进或文档对重复");
            pagePrevious = key;
        }
        for (const link of decoded.slice(0, LINK_PAGE_SIZE)) {
            budget.read += 1;
            if (budget.read > MAX_READ_LINKS) throw new Error("文档引用超过 50,000 个文档对，请切换以人物或组织为中心的范围后重试");
            const key = `${link.from}~${link.to}`;
            links.set(key, link);
            previous = key;
            afterFrom = link.from;
            afterTo = link.to;
        }
        if (decoded.length <= LINK_PAGE_SIZE) return;
    }
}

function graphData(nodes: NativeGraphNode[], links: ReadonlyMap<string, NativeGraphLink>, centerDocId?: string): NativeGraphData {
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const keptLinks = [...links.values()].filter((link) => link.from !== link.to && byId.has(link.from) && byId.has(link.to))
        .sort((left, right) => `${left.from}~${left.to}` < `${right.from}~${right.to}` ? -1 : 1);
    for (const link of keptLinks) {
        byId.get(link.from)!.refs += 1;
        byId.get(link.to)!.defs += 1;
    }
    return { ...(centerDocId ? { id: centerDocId } : {}), nodes, links: keptLinks };
}

/** 双向一度：中心的原生块引用及回链，始终保留已核实中心。 */
export async function fetchLocalGraph(docId: string, allowedDocIds: ReadonlySet<string>): Promise<NativeGraphData> {
    if (!ID_PATTERN.test(docId)) throw new Error("docId 不是合法的思源 ID");
    const ids = registeredIds(allowedDocIds);
    if (!allowedDocIds.has(docId)) throw new Error("引用图中心未在当前登记集合中");
    const links = new Map<string, NativeGraphLink>();
    const budget = { read: 0 };
    for (const batch of batches(ids, MAX_REFERENCE_FILTER_DOCS)) {
        const registered = new Set(batch);
        const neighbors = idList(batch);
        const where = `((root_id = '${docId}' AND def_block_root_id IN (${neighbors})) OR (def_block_root_id = '${docId}' AND root_id IN (${neighbors}))) AND root_id <> def_block_root_id`;
        await readReferencePairs(where, (from, to) => from !== to && (from === docId && registered.has(to) || to === docId && registered.has(from)), links, budget);
    }
    const neighbors = new Set([docId]);
    for (const link of links.values()) {
        if (allowedDocIds.has(link.from) && allowedDocIds.has(link.to)) { neighbors.add(link.from); neighbors.add(link.to); }
    }
    const nodes = await readDocuments([...neighbors].sort());
    if (!nodes.some((node) => node.id === docId)) throw new Error("引用图中心文档已不可达，请重新核实或选择其他中心");
    return graphData(nodes, links, docId);
}

/** 全部登记文档之间的原生引用，按 100 个源文档批次读取，绝不请求整库图。 */
export async function fetchGlobalGraph(allowedDocIds: ReadonlySet<string>): Promise<NativeGraphData> {
    const ids = registeredIds(allowedDocIds);
    if (ids.length > MAX_REFERENCE_FILTER_DOCS) {
        throw new Error("全部登记文档超过 10,000 个，当前引用读取范围过大；请切换以人物或组织为中心的范围后重试");
    }
    const nodes = await readDocuments(ids);
    const targets = new Set(nodes.map((node) => node.id));
    const targetFilter = idList([...targets]);
    const links = new Map<string, NativeGraphLink>();
    const budget = { read: 0 };
    for (const batch of batches(nodes.map((node) => node.id))) {
        const sources = new Set(batch);
        await readReferencePairs(`root_id IN (${idList(batch)}) AND def_block_root_id IN (${targetFilter}) AND root_id <> def_block_root_id`,
            (from, to) => from !== to && sources.has(from) && targets.has(to), links, budget);
    }
    return graphData(nodes, links);
}
