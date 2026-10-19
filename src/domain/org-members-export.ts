/**
 * 组织成员表格导出（只读工作流快捷方式）。
 *
 * 导出内容来自当前组织、当前搜索词和当前状态筛选的同一份快照，
 * 不写入成员事实，也不把显示名称当成身份。CSV 适合下载后归档，
 * TSV 适合直接粘贴到表格或任务系统。
 */
import { orgMembershipStatusLabel } from "./org-membership.ts";
import type { OrgAffiliationKind, OrgMembershipStatus } from "./org-membership.ts";

export interface OrganizationMemberExportRow {
    id: string;
    orgDocId: string;
    organizationName: string;
    personDocId: string;
    personName: string;
    department: string;
    title: string;
    joinedOn: string;
    leftOn: string;
    status: OrgMembershipStatus;
    statusLabel?: string;
    affiliationKind?: OrgAffiliationKind;
    note?: string;
}

export interface OrganizationMemberExportOptions {
    /** 用于兼容旧调用方：传入时覆盖行上的组织名称。 */
    organizationName?: string;
    includeBom?: boolean;
}

export const ORGANIZATION_MEMBER_EXPORT_HEADERS = [
    "组织名称", "成员姓名", "状态", "自定义状态", "归属分类", "部门", "职位",
    "加入日期", "离开日期", "成员备注", "人物文档 ID", "成员记录 ID", "组织文档 ID",
] as const;

function normalizeCell(value: unknown): string {
    return String(value ?? "").replace(/[\t\r\n]+/g, " ").trim();
}

/** Prevent spreadsheet formula execution while preserving the displayed value. */
function safeSpreadsheetCell(value: unknown): string {
    const normalized = normalizeCell(value);
    return /^[=+\-@]/.test(normalized) ? `'${normalized}` : normalized;
}

export function escapeCsvCell(value: unknown): string {
    return `"${safeSpreadsheetCell(value).replace(/"/g, '""')}"`;
}

function affiliationLabel(kind: OrgAffiliationKind | undefined): string {
    if (kind === "family") return "家庭";
    if (kind === "work") return "工作单位";
    if (kind === "education") return "学校";
    return "未分类";
}

function exportValues(row: OrganizationMemberExportRow, organizationName?: string): string[] {
    return [
        organizationName ?? row.organizationName,
        row.personName,
        orgMembershipStatusLabel(row),
        row.statusLabel ?? "",
        affiliationLabel(row.affiliationKind),
        row.department,
        row.title,
        row.joinedOn,
        row.leftOn,
        row.note ?? "",
        row.personDocId,
        row.id,
        row.orgDocId,
    ];
}

export function buildOrganizationMemberTsv(
    rows: readonly OrganizationMemberExportRow[],
    options: OrganizationMemberExportOptions = {},
): string {
    const lines = [ORGANIZATION_MEMBER_EXPORT_HEADERS.join("\t")];
    for (const row of rows) lines.push(exportValues(row, options.organizationName).map(safeSpreadsheetCell).join("\t"));
    return `${options.includeBom === false ? "" : "\uFEFF"}${lines.join("\r\n")}\r\n`;
}

export function buildOrganizationMemberCsv(
    rows: readonly OrganizationMemberExportRow[],
    options: OrganizationMemberExportOptions = {},
): string {
    const lines = [ORGANIZATION_MEMBER_EXPORT_HEADERS.map(escapeCsvCell).join(",")];
    for (const row of rows) lines.push(exportValues(row, options.organizationName).map(escapeCsvCell).join(","));
    /* BOM keeps Chinese headers readable in common desktop spreadsheet apps. */
    return `${options.includeBom === false ? "" : "\uFEFF"}${lines.join("\r\n")}\r\n`;
}

/** 与组织管理成员搜索保持一致的本地筛选语义，供旧宿主回退和导出复用。 */
export function matchesOrganizationMemberQuery(
    member: Pick<OrganizationMemberExportRow, "personName" | "department" | "title" | "statusLabel" | "note">,
    query: string,
): boolean {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return true;
    return [member.personName, member.department, member.title, member.statusLabel ?? "", member.note ?? ""]
        .some((value) => value.toLocaleLowerCase().includes(normalized));
}

export function filterOrganizationMemberExportRows(
    members: readonly OrganizationMemberExportRow[],
    options: { query?: string; status?: "all" | "active" | "former" } = {},
): OrganizationMemberExportRow[] {
    const status = options.status ?? "all";
    return members.filter((member) => (status === "all" || member.status === status)
        && matchesOrganizationMemberQuery(member, options.query ?? ""));
}

/** 旧调用方名称，保留以避免已有宿主适配层断裂。 */
export function serializeOrganizationMembersTsv(
    members: readonly OrganizationMemberExportRow[],
    options: OrganizationMemberExportOptions = {},
): string {
    return buildOrganizationMemberTsv(members, options);
}
