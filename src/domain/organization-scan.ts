export interface OrganizationSummary {
    docId: string;
    name: string;
    hpath: string;
    notebookId: string;
    archived: boolean;
}

export class OrganizationScanIncompleteError extends Error {
    readonly targetIds: readonly string[];

    constructor(message: string, targetIds: readonly string[] = []) {
        super(`组织状态未核实：${message}${targetIds.length ? `（${targetIds.join("、")}）` : ""}；请核对文档标记后重试，未自动修改原文`);
        this.name = "OrganizationScanIncompleteError";
        this.targetIds = targetIds;
    }
}

const DOC_ID = /^\d{14}-[a-z0-9]{7}$/;

function record(value: unknown): Record<string, unknown> {
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw new OrganizationScanIncompleteError("查询返回损坏行");
    return value as Record<string, unknown>;
}

export function organizationMarkerStates(rows: readonly unknown[]): Map<string, boolean> {
    const states = new Map<string, boolean>();
    for (const raw of rows) {
        const row = record(raw);
        if (typeof row.root_id !== "string" || !DOC_ID.test(row.root_id) || typeof row.ial !== "string") {
            throw new OrganizationScanIncompleteError("标记缺少合法根文档或属性");
        }
        const matches = [...row.ial.matchAll(/(?:^|\s)custom-lvct-org="([^"]*)"/g)];
        if (matches.length !== 1 || !["1", "archived"].includes(matches[0][1])) {
            throw new OrganizationScanIncompleteError("标记属性值未知或重复", [row.root_id]);
        }
        const count = typeof row.markerCount === "string" && /^\d+$/.test(row.markerCount) ? Number(row.markerCount) : row.markerCount;
        if (count !== 1 || states.has(row.root_id)) throw new OrganizationScanIncompleteError("存在重复标记或块数量未核实", [row.root_id]);
        states.set(row.root_id, matches[0][1] === "archived");
    }
    return states;
}

export function organizationsFromDocs(states: ReadonlyMap<string, boolean>, rows: readonly unknown[]): OrganizationSummary[] {
    const organizations: OrganizationSummary[] = [];
    const seen = new Set<string>();
    for (const raw of rows) {
        const row = record(raw);
        if (typeof row.id !== "string" || !states.has(row.id) || seen.has(row.id)
            || typeof row.content !== "string" || !row.content.trim()
            || typeof row.hpath !== "string" || typeof row.box !== "string" || !DOC_ID.test(row.box)) {
            throw new OrganizationScanIncompleteError("文档查询返回不完整或重复结果");
        }
        seen.add(row.id);
        organizations.push({ docId: row.id, name: row.content, hpath: row.hpath, notebookId: row.box, archived: states.get(row.id)! });
    }
    const missing = [...states.keys()].filter((docId) => !seen.has(docId));
    if (missing.length) throw new OrganizationScanIncompleteError("标记对应文档不可达", missing);
    return organizations.sort((first, second) => first.docId.localeCompare(second.docId));
}
