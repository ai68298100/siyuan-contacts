import { organizationIalAttributes } from "./organization-operations.ts";

export interface OrganizationSummary {
    docId: string;
    name: string;
    hpath: string;
    notebookId: string;
    archived: boolean;
    /** 已从插件移除；文档和成员历史保留，只能从管理页恢复。 */
    removed?: boolean;
}

/**
 * 组织选择器的稳定显示文案。同名组织必须带可读位置和稳定文档 ID，
 * 避免转移成员时只凭名称误选目标。
 */
export function organizationOptionLabel<T extends Pick<OrganizationSummary, "docId" | "name" | "hpath" | "notebookId">>(
    organization: T,
    siblings: readonly T[],
): string {
    const name = organization.name.trim();
    const sameName = siblings.filter((item) => item.docId !== organization.docId
        && item.name.trim().toLocaleLowerCase() === name.toLocaleLowerCase());
    if (sameName.length === 0) return name;
    const location = organization.hpath.trim() || organization.notebookId.trim();
    return `${name} · ${location || "位置待核实"} · ${organization.docId}`;
}

export type OrganizationStatusFilter = "all" | "active" | "archived" | "removed";

/** 组织视图的纯筛选规则；不改变输入顺序或对象，便于分页结果增量展示。 */
export function filterOrganizations<T extends Pick<OrganizationSummary, "name" | "archived" | "removed">>(
    organizations: readonly T[],
    options: { query?: string; status?: OrganizationStatusFilter } = {},
): T[] {
    const query = options.query?.trim().toLocaleLowerCase() ?? "";
    const status = options.status ?? "all";
    return organizations.filter((organization) => {
        if (status === "removed" ? !organization.removed : organization.removed) return false;
        if (status === "active" && organization.archived) return false;
        if (status === "archived" && !organization.archived) return false;
        return !query || organization.name.toLocaleLowerCase().includes(query);
    });
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

export type OrganizationMarkerState = boolean | "removed";

export function organizationMarkerStates(rows: readonly unknown[]): Map<string, OrganizationMarkerState> {
    const states = new Map<string, OrganizationMarkerState>();
    for (const raw of rows) {
        const row = record(raw);
        if (typeof row.root_id !== "string" || !DOC_ID.test(row.root_id) || typeof row.ial !== "string") {
            throw new OrganizationScanIncompleteError("标记缺少合法根文档或属性");
        }
        try { organizationIalAttributes(row.ial); }
        catch { throw new OrganizationScanIncompleteError("标记属性形状、重复值或内容未核实", [row.root_id]); }
        const matches = [...row.ial.matchAll(/(?:^|\s)custom-lvct-org="([^"]*)"/g)];
        if (matches.length !== 1 || !["1", "archived"].includes(matches[0][1])) {
            throw new OrganizationScanIncompleteError("标记属性值未知或重复", [row.root_id]);
        }
        const count = typeof row.markerCount === "string" && /^\d+$/.test(row.markerCount) ? Number(row.markerCount) : row.markerCount;
        if (count !== 1 || states.has(row.root_id)) throw new OrganizationScanIncompleteError("存在重复标记或块数量未核实", [row.root_id]);
        const removed = [...row.ial.matchAll(/(?:^|\s)custom-lvct-org-removed="([^"]*)"/g)];
        if (removed.length > 1 || removed.length === 1 && (removed[0][1] !== "1" || matches[0][1] !== "archived")) {
            throw new OrganizationScanIncompleteError("移除属性值未知、重复或与组织状态冲突", [row.root_id]);
        }
        states.set(row.root_id, removed.length ? "removed" : matches[0][1] === "archived");
    }
    return states;
}

export function organizationsFromDocs(states: ReadonlyMap<string, OrganizationMarkerState>, rows: readonly unknown[]): OrganizationSummary[] {
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
        const state = states.get(row.id)!;
        organizations.push({ docId: row.id, name: row.content, hpath: row.hpath, notebookId: row.box, archived: state !== false, ...(state === "removed" ? { removed: true } : {}) });
    }
    const missing = [...states.keys()].filter((docId) => !seen.has(docId));
    if (missing.length) throw new OrganizationScanIncompleteError("标记对应文档不可达", missing);
    return organizations.sort((first, second) => first.docId.localeCompare(second.docId));
}
