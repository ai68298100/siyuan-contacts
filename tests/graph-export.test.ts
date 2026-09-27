import assert from "node:assert/strict";
import test from "node:test";
import {
    pathSegments,
    renderGraphResultMarkdown,
} from "../src/domain/graph-export.ts";
import type { GraphResultExportInput } from "../src/domain/graph-export.ts";

const base: GraphResultExportInput = {
    kind: "path",
    centerName: "甲",
    compareName: "乙",
    pathNames: ["甲", "共同人物", "乙"],
    resultNames: [],
    nodeCount: 236,
    edgeCount: 418,
    truncated: false,
    filters: { search: "", group: "", isolatedOnly: false },
    generatedAt: "2026-09-28 15:00",
};

test("链式分段：相邻人物组成关系段，单元素无段", () => {
    assert.deepEqual(pathSegments([]), []);
    assert.deepEqual(pathSegments(["甲"]), []);
    assert.deepEqual(pathSegments(["甲", "丙", "乙"]), [
        { from: "甲", to: "丙" },
        { from: "丙", to: "乙" },
    ]);
});

test("路径导出：总结段数、链式行、图规模与范围免责齐全，相同输入一致", () => {
    const first = renderGraphResultMarkdown(base);
    assert.equal(first, renderGraphResultMarkdown(base), "相同输入应产出一致内容");
    assert(first.includes("查询：最短路径（甲 → 乙）"), "查询行缺失");
    assert(first.includes("之间为 2 段关系（当前图内）"), "段数总结错误");
    assert(first.includes("- 甲 — 共同人物 — 乙"), "路径链缺失");
    assert(first.includes("节点 236 · 边 418"), "图规模缺失");
    assert(first.includes("筛选：无"), "筛选缺省文本缺失");
    assert(first.includes("不代表现实社交关系、引荐意愿或关系强弱"), "范围免责缺失");
});

test("无路径：给兜底文案与清除筛选指引，而非报错；同点给同一人物结论", () => {
    const noPath = renderGraphResultMarkdown({ ...base, pathNames: [] });
    assert(noPath.includes("当前图内未找到 甲 与 乙 的连接"), "无路径兜底缺失");
    assert(noPath.includes("可清除筛选后重试"), "清除筛选指引缺失");
    const same = renderGraphResultMarkdown({ ...base, pathNames: ["甲"] });
    assert(same.includes("为同一人物"), "同点结论缺失");
});

test("共同联系人/二度/直接：结果人物列出，筛选条件写入", () => {
    const common = renderGraphResultMarkdown({
        ...base,
        kind: "common",
        pathNames: [],
        resultNames: ["丙", "丁"],
        filters: { search: "陈", group: "同事", isolatedOnly: true },
        truncated: true,
    });
    assert(common.includes("查询：共同联系人（甲 与 乙）"));
    assert(common.includes("有 2 位共同联系人（当前图内）"));
    assert(common.includes("- 丙") && common.includes("- 丁"));
    assert(common.includes("搜索「陈」；分组「同事」；仅看无关系"), "筛选条件缺失");
    assert(common.includes("已按关系数截断至 800"), "截断标注缺失");
    const second = renderGraphResultMarkdown({ ...base, kind: "second", pathNames: [], resultNames: ["丙"] });
    assert(second.includes("二度联系人有 1 人"), "二度总结错误");
    const direct = renderGraphResultMarkdown({ ...base, kind: "direct", pathNames: [], resultNames: ["丙"] });
    assert(direct.includes("直接关系有 1 人"), "直接总结错误");
});
