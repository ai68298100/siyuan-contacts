/**
 * 关系查询结果说明与导出（F16）：把图谱查询（最短路径/共同联系人/直接与二度关系）
 * 的结果渲染为链式呈现与 Markdown 说明。只读投影，无新存储；generatedAt 注入保证
 * 相同输入与时间产出一致；范围明确限定「当前图内」，不表示引荐意愿、关系强弱或
 * 现实社交结论。纯函数：无 DOM、无 IO，node --test 直接可测。
 */

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
