/**
 * 关系查询结果说明与导出（F16）：把图谱查询（最短路径/共同联系人/直接与二度关系）
 * 的结果渲染为链式呈现与 Markdown 说明。只读投影，无新存储；generatedAt 注入保证
 * 相同输入与时间产出一致；范围明确限定「当前图内」，不表示引荐意愿、关系强弱或
 * 现实社交结论。纯函数：无 DOM、无 IO，node --test 直接可测。
 */

import { escapeMarkdown } from "./format.ts";
import { graphEdgeLabel } from "./graph-query.ts";
import type { GraphQuerySnapshot } from "./graph-query.ts";

export type GraphQueryKind = "path" | "common" | "second" | "direct";

export interface GraphPathSegment {
    from: string;
    to: string;
}

export interface GraphResultExportInput {
    kind: GraphQueryKind;
    centerName: string;
    compareName?: string;
    /** path 模式：链上人物名（含两端，按顺序）；无路径为空数组 */
    pathNames: readonly string[];
    /** direct/common/second 模式：结果人物名 */
    resultNames: readonly string[];
    nodeCount: number;
    edgeCount: number;
    truncated: boolean;
    filters: { search: string; group: string; isolatedOnly: boolean };
    generatedAt: string;
}

/** 链式路径分段：相邻人物组成关系段（FamilySearch 链式卡数据） */
export function pathSegments(pathNames: readonly string[]): GraphPathSegment[] {
    const segments: GraphPathSegment[] = [];
    for (let index = 0; index + 1 < pathNames.length; index += 1) {
        segments.push({ from: pathNames[index], to: pathNames[index + 1] });
    }
    return segments;
}

function queryLabel(input: GraphResultExportInput): string {
    switch (input.kind) {
        case "path": return `最短路径（${input.centerName} → ${input.compareName ?? "?"}）`;
        case "common": return `共同联系人（${input.centerName} 与 ${input.compareName ?? "?"}）`;
        case "second": return `二度关系（${input.centerName}）`;
        default: return `直接关系（${input.centerName}）`;
    }
}

function summaryLine(input: GraphResultExportInput): string {
    const segments = pathSegments(input.pathNames);
    if (input.kind === "path") {
        if (input.pathNames.length === 1) return `${input.centerName} 与 ${input.compareName ?? ""} 为同一人物。`;
        if (input.pathNames.length === 0) return `当前图内未找到 ${input.centerName} 与 ${input.compareName ?? ""} 的连接（可能因筛选或规模裁剪），可清除筛选后重试。`;
        return `${input.centerName} 与 ${input.compareName ?? ""} 之间为 ${segments.length} 段关系（当前图内）。`;
    }
    if (input.kind === "common") return `${input.centerName} 与 ${input.compareName ?? ""} 有 ${input.resultNames.length} 位共同联系人（当前图内）。`;
    if (input.kind === "second") return `${input.centerName} 的二度联系人有 ${input.resultNames.length} 人（当前图内）。`;
    return `${input.centerName} 的直接关系有 ${input.resultNames.length} 人（当前图内）。`;
}

export function renderGraphResultMarkdown(input: GraphResultExportInput): string {
    input = { ...input, centerName: safeGraphText(input.centerName), compareName: input.compareName === undefined ? undefined : safeGraphText(input.compareName),
        pathNames: input.pathNames.map(safeGraphText), resultNames: input.resultNames.map(safeGraphText),
        filters: { ...input.filters, search: safeGraphText(input.filters.search), group: safeGraphText(input.filters.group) }, generatedAt: safeGraphText(input.generatedAt) };
    const lines: string[] = [];
    lines.push("# 关系查询结果");
    lines.push("");
    lines.push(`- 生成时间：${input.generatedAt}`);
    lines.push(`- 查询：${queryLabel(input)}`);
    lines.push(`- 总结：${summaryLine(input)}`);

    if (input.kind === "path" && input.pathNames.length > 0) {
        lines.push("");
        lines.push("## 路径链");
        lines.push(`- ${input.pathNames.join(" — ")}`);
    }

    if (input.kind !== "path" && input.resultNames.length > 0) {
        lines.push("");
        lines.push(`## 结果人物（${input.resultNames.length} 人）`);
        for (const name of input.resultNames) lines.push(`- ${name}`);
    }

    lines.push("");
    lines.push("## 图规模与筛选");
    lines.push(`- 节点 ${input.nodeCount} · 边 ${input.edgeCount}${input.truncated ? "（已按关系数截断至 800）" : ""}`);
    const filterParts: string[] = [];
    if (input.filters.search) filterParts.push(`搜索「${input.filters.search}」`);
    if (input.filters.group) filterParts.push(`分组「${input.filters.group}」`);
    if (input.filters.isolatedOnly) filterParts.push("仅看无关系");
    lines.push(`- 筛选：${filterParts.length > 0 ? filterParts.join("；") : "无"}`);
    if (input.pathNames.length === 0 && input.kind === "path") {
        lines.push("- 无路径时可清除筛选或缩小分组范围后重试。");
    }

    lines.push("");
    lines.push("---");
    lines.push("范围说明：结果仅限当前展示图（经筛选与规模裁剪），不代表现实社交关系、引荐意愿或关系强弱。");
    return lines.join("\n");
}

function safeGraphText(value: string): string {
    return escapeMarkdown(value.replace(/[\r\n\u0000-\u001f\u007f]+/g, " ")).replace(/([|!])/g, "\\$1");
}

export function renderGraphSnapshotMarkdown(snapshot: GraphQuerySnapshot, generatedAt: string): string {
    const { query, counts } = snapshot;
    const byId = new Map(snapshot.graph.nodes.map((node) => [node.id, node]));
    const label = (id: string) => `${safeGraphText(byId.get(id)?.label ?? id)}（${safeGraphText(id)}）`;
    const lines = ["# 图查询结果", "", `- 生成时间：${safeGraphText(generatedAt)}`,
        `- 模式：${query.mode === "relations" ? "关系图" : "文档引用图（不是整库图，未打开原生面板）"}`,
        `- 范围：${query.scope}；中心：${safeGraphText(snapshot.center.label)}（${safeGraphText(snapshot.center.id) || "无中心"}；${snapshot.center.status}）；来源代次 ${snapshot.revision}`,
        `- 组织聚焦：${query.orgDocId ? safeGraphText(query.orgDocId) : "无"}`,
        `- 关系查询中心：${query.focusId ? label(query.focusId) : "未选择"}；对比人物：${query.compareId ? label(query.compareId) : "未选择"}；层级 ${query.depth}；模式 ${query.queryMode}`,
        `- 搜索：${safeGraphText(query.search) || "无"}；分组：${safeGraphText(query.group) || "无"}；仅无关系：${query.isolatedOnly ? "是" : "否"}`,
        `- 组织展示：${query.showOrgs ? "是" : "否"}；${query.mode === "native" ? "分组/无关系/组织展示条件保留但不用于引用图" : "筛选应用于关系图，有效中心优先保留"}`,
        `- 状态：${snapshot.state}；登记 ${counts.registered ?? "未知"}；来源节点 ${counts.sourceNodes ?? "未知"} / 边 ${counts.sourceEdges ?? "未知"}`,
        `- 范围内节点 ${counts.rangeNodes} / 边 ${counts.rangeEdges}；筛选后节点 ${counts.filteredNodes} / 边 ${counts.filteredEdges}`,
        `- 范围排除 ${counts.rangeExcluded ?? "未知"}；筛选排除 ${counts.filterExcluded}`,
        `- 展示节点 ${counts.displayedNodes} / 边 ${counts.displayedEdges}；预算 ${query.maxNodes ?? 800}；裁剪节点 ${counts.clippedNodes} / 边 ${counts.clippedEdges}`,
        `- 来源：${Object.entries(snapshot.sourceStatus).map(([key, status]) => `${key}=${status}`).join("；")}`, "", "## 节点"];
    for (const node of snapshot.graph.nodes) lines.push(`- ${label(node.id)} · ${node.kind === "org" ? "组织" : "人物"} · 图内连接 ${node.degree}`);
    lines.push("", "## 边");
    for (const edge of snapshot.graph.edges) lines.push(`- ${label(edge.source)} — ${label(edge.target)} · ${graphEdgeLabel(edge.kind)}`);
    lines.push("", "## related 查询", `- ${snapshot.result.kind}：${snapshot.result.status}`, `- ${safeGraphText(snapshot.result.reason)}`);
    if (snapshot.result.pathIds.length) lines.push(`- 路径：${snapshot.result.pathIds.map(label).join(" — ")}`);
    else for (const id of snapshot.result.ids) lines.push(`- ${label(id)}`);
    if (snapshot.retainedByRange.length) lines.push(`- 范围外中心优先保留：${snapshot.retainedByRange.map(label).join("、")}（不属于当前范围或组织成员集合，不新增关系事实）`);
    if (snapshot.retainedByFilter.length) lines.push(`- 为保留中心而额外显示：${snapshot.retainedByFilter.map(label).join("、")}`);
    if (snapshot.diagnostics.length) {
        lines.push("", "## 待核实与诊断");
        for (const diagnostic of snapshot.diagnostics) lines.push(`- ${safeGraphText(diagnostic.message)}`);
    }
    lines.push("", "范围说明：节点、边和查询结果来自同一展示快照；仅 related 边参与关系查询，member/ref 不推断人物关系，不代表现实社交关系、引荐意愿或关系强弱。");
    return lines.join("\n");
}
