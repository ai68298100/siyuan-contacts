import { test } from "node:test";
import assert from "node:assert/strict";
import { buildGraph, buildOrgAugmentation, capGraph, groupColor, queryGraphRelations } from "../src/domain/graph.ts";
import type { ContactSummary } from "../src/domain/person.ts";
import { shortestGraphPath, secondDegreeGraphIds } from "../src/domain/graph-path.ts";

test("二度邻接：排除中心与直接关系，循环与重复不放大结果", () => {
    const graph = {
        nodes: ["a", "b", "c", "d", "e", "isolated"].map((id) => ({ id, label: id, group: "", degree: 0 })),
        edges: [{ source: "a", target: "b" }, { source: "b", target: "c" },
            { source: "c", target: "a" }, { source: "b", target: "d" },
            { source: "d", target: "c" }, { source: "b", target: "d" },
            { source: "d", target: "e" }, { source: "a", target: "a" }, { source: "a", target: "missing" }],
    };
    const original = structuredClone(graph);
    assert.deepEqual(secondDegreeGraphIds(graph, "a"), ["d"]);
    assert.deepEqual(secondDegreeGraphIds(graph, "isolated"), []);
    assert.deepEqual(secondDegreeGraphIds(graph, "missing"), []);
    assert.deepEqual(secondDegreeGraphIds({ nodes: [], edges: [] }, "a"), []);
    assert.deepEqual(graph, original);
});

test("无关系人物：有效入边也计关系，自环与悬空关系不计", () => {
    const graph = buildGraph([
        person({ itemId: "a", docId: "a", name: "a", relatedItemIds: ["b", "a", "missing"] }),
        person({ itemId: "b", docId: "b", name: "b" }),
        person({ itemId: "c", docId: "c", name: "c", relatedItemIds: ["missing", "c"] }),
    ]);
    assert.deepEqual(graph.nodes.filter((node) => node.degree === 0).map((node) => node.id), ["c"]);
});

test("最短路径：优先较短链路、支持反向关系且不改变输入", () => {
    const graph = {
        nodes: ["a", "b", "c", "d", "e"].map((id) => ({ id, label: id, group: "", degree: 0 })),
        edges: [{ source: "a", target: "b" }, { source: "b", target: "c" },
            { source: "c", target: "e" }, { source: "a", target: "d" }, { source: "e", target: "d" }],
    };
    const original = structuredClone(graph);
    assert.deepEqual(shortestGraphPath(graph, "a", "e"), ["a", "d", "e"]);
    assert.deepEqual(shortestGraphPath(graph, "e", "a"), ["e", "d", "a"]);
    assert.deepEqual(shortestGraphPath(graph, "a", "b"), ["a", "b"]);
    assert.deepEqual(shortestGraphPath({
        nodes: graph.nodes.filter((node) => ["a", "e"].includes(node.id)), edges: graph.edges,
    }, "a", "e"), []);
    assert.deepEqual(graph, original);
});

test("最短路径：800 人链路完整且等长备选只返回一条最短链", () => {
    const nodes = Array.from({ length: 800 }, (_, index) => ({ id: `n${index}`, label: String(index), group: "", degree: 0 }));
    const edges = nodes.slice(0, -1).map((node, index) => ({ source: node.id, target: nodes[index + 1].id }));
    assert.deepEqual(shortestGraphPath({ nodes, edges }, "n0", "n799"), nodes.map((node) => node.id));
    const graph = {
        nodes: nodes.slice(0, 4),
        edges: [{ source: "n0", target: "n1" }, { source: "n1", target: "n3" },
            { source: "n0", target: "n2" }, { source: "n2", target: "n3" }],
    };
    const result = shortestGraphPath(graph, "n0", "n3");
    assert.equal(result.length, 3);
    assert.equal(result[0], "n0");
    assert.equal(result[2], "n3");
    assert.ok(["n1", "n2"].includes(result[1]));
});

test("最短路径：断开、缺失端点、空图和相同人物", () => {
    const graph = { nodes: ["a", "b"].map((id) => ({ id, label: id, group: "", degree: 0 })), edges: [] };
    assert.deepEqual(shortestGraphPath(graph, "a", "b"), []);
    assert.deepEqual(shortestGraphPath(graph, "missing", "b"), []);
    assert.deepEqual(shortestGraphPath(graph, "a", "missing"), []);
    assert.deepEqual(shortestGraphPath({ nodes: [], edges: [] }, "a", "a"), []);
    assert.deepEqual(shortestGraphPath(graph, "a", "a"), ["a"]);
});

test("最短路径：循环、重复、自环与悬空边不影响合法链路", () => {
    const graph = {
        nodes: ["a", "b", "c", "d"].map((id) => ({ id, label: id, group: "", degree: 0 })),
        edges: [{ source: "a", target: "b" }, { source: "a", target: "b" },
            { source: "b", target: "c" }, { source: "c", target: "a" },
            { source: "c", target: "d" }, { source: "a", target: "a" }, { source: "a", target: "missing" }],
    };
    assert.deepEqual(shortestGraphPath(graph, "a", "d"), ["a", "c", "d"]);
});

function person(partial: Partial<ContactSummary> & { itemId: string; docId: string; name: string }): ContactSummary {
    return {
        phone: "", email: "", wechat: "", website: "", birthday: "", isLunar: false,
        group: "", tags: [], relatedItemIds: [],
        ...partial,
    };
}

test("关系查询：无向邻接与共同联系人按节点顺序去重，不修改原图", () => {
    const graph = {
        nodes: ["a", "b", "c", "d", "isolated"].map((id) => ({ id, label: id, group: "", degree: 0 })),
        edges: [{ source: "a", target: "c" }, { source: "c", target: "b" },
            { source: "c", target: "a" }, { source: "a", target: "b" },
            { source: "a", target: "d" }, { source: "a", target: "a" },
            { source: "a", target: "missing" }],
    };
    const original = structuredClone(graph);
    assert.deepEqual(queryGraphRelations(graph, "a", "b"), { neighborIds: ["b", "c", "d"], commonIds: ["c"] });
    assert.deepEqual(queryGraphRelations(graph, "b", "a"), { neighborIds: ["a", "c"], commonIds: ["c"] });
    assert.deepEqual(queryGraphRelations(graph, "a", "a").commonIds, []);
    assert.deepEqual(queryGraphRelations(graph, "a", "missing").commonIds, []);
    assert.deepEqual(queryGraphRelations(graph, "missing"), { neighborIds: [], commonIds: [] });
    assert.deepEqual(queryGraphRelations(graph, "isolated", "a"), { neighborIds: [], commonIds: [] });
    assert.deepEqual(graph, original);
});

test("buildGraph：relatedItemIds(itemID) 换算为 docId 边，度数累计，自环与未知目标丢弃", () => {
    const a = person({ itemId: "i-a", docId: "d-a", name: "张三", group: "朋友", relatedItemIds: ["i-b", "i-c", "i-a"] });
    const b = person({ itemId: "i-b", docId: "d-b", name: "李四" });
    const c = person({ itemId: "i-c", docId: "d-c", name: "王五", relatedItemIds: ["i-b"] });
    const graph = buildGraph([a, b, c]);

    assert.equal(graph.nodes.length, 3);
    // i-c 指向的人（d-c 相关的另一端）不存在于 people 中？i-c 存在 → 边 a-c 保留；自环 i-a 丢弃
    const edgeKeys = graph.edges.map((edge) => `${edge.source}->${edge.target}`).sort();
    assert.deepEqual(edgeKeys, ["d-a->d-b", "d-a->d-c", "d-c->d-b"]);
    const nodeA = graph.nodes.find((node) => node.id === "d-a");
    assert.equal(nodeA?.degree, 2);
    const nodeB = graph.nodes.find((node) => node.id === "d-b");
    assert.equal(nodeB?.degree, 2);
});

test("buildGraph：重复边按无向去重", () => {
    const a = person({ itemId: "i-a", docId: "d-a", name: "A", relatedItemIds: ["i-b"] });
    const b = person({ itemId: "i-b", docId: "d-b", name: "B", relatedItemIds: ["i-a"] });
    const graph = buildGraph([a, b]);
    assert.equal(graph.edges.length, 1);
});

test("groupColor：预设分组有颜色，未知分组回退灰", () => {
    assert.equal(groupColor("家人"), "#e05a5a");
    assert.equal(groupColor("不存在的组"), "#8f8f8f");
});

test("capGraph：超限时按度数保留头部节点，只留两端存活的边", () => {
    const people = [
        person({ itemId: "i-hub", docId: "d-hub", name: "hub", relatedItemIds: ["i-1", "i-2", "i-3"] }),
        person({ itemId: "i-1", docId: "d-1", name: "1" }),
        person({ itemId: "i-2", docId: "d-2", name: "2" }),
        person({ itemId: "i-3", docId: "d-3", name: "3", relatedItemIds: ["i-4"] }),
        person({ itemId: "i-4", docId: "d-4", name: "4" }),
    ];
    const full = buildGraph(people);
    const { graph, truncated } = capGraph(full, 3);
    assert.equal(truncated, true);
    assert.equal(graph.nodes.length, 3);
    assert.ok(graph.nodes[0].degree >= graph.nodes[1].degree, "按度数降序保留");
    for (const edge of graph.edges) {
        assert.ok(
            graph.nodes.some((node) => node.id === edge.source) && graph.nodes.some((node) => node.id === edge.target),
            "边两端节点必须都存活",
        );
    }
    assert.equal(capGraph(full, 10).truncated, false);
});

test("组织增强（B14.6）：成员边只连名册内人物，多段记录合并，kind/degree 正确", () => {
    const roster = new Set(["d-1", "d-2", "d-3"]);
    const augmentation = buildOrgAugmentation([
        { docId: "org-1", name: "曙光科技", memberDocIds: ["d-1", "d-1", "ghost", "", "org-1", "d-2"] },
        { docId: "org-2", name: "无成员组织", memberDocIds: [] },
    ], roster);
    assert.equal(augmentation.nodes.length, 2);
    const org1 = augmentation.nodes.find((node) => node.id === "org-1");
    assert.equal(org1?.kind, "org");
    assert.equal(org1?.group, "组织");
    assert.equal(org1?.degree, 2);
    assert.deepEqual(
        augmentation.edges.filter((edge) => edge.source === "org-1").map((edge) => edge.target).sort(),
        ["d-1", "d-2"],
    );
    for (const edge of augmentation.edges) {
        assert.equal(edge.kind, "member", "成员边必须标记 kind=member");
        assert.notEqual(edge.target, edge.source, "不造自环");
        assert.ok(roster.has(edge.target), "不连名册外人物");
    }
    assert.deepEqual(buildOrgAugmentation([], roster), { nodes: [], edges: [] });
    assert.equal(buildOrgAugmentation([{ docId: "org-3", name: "", memberDocIds: ["d-1"] }], roster).nodes.length, 0, "无名可称的组织跳过");
});

test("组织增强不污染 related 图：成员边不进 buildGraph 产物，查询图保持纯 related", () => {
    const people = [
        person({ itemId: "i-1", docId: "d-1", name: "甲", relatedItemIds: [] }),
        person({ itemId: "i-2", docId: "d-2", name: "乙", relatedItemIds: [] }),
    ];
    const related = buildGraph(people);
    const augmentation = buildOrgAugmentation(
        [{ docId: "org-1", name: "组织", memberDocIds: ["d-1", "d-2"] }],
        new Set(["d-1", "d-2"]),
    );
    /* 关系查询只吃 related 图：甲乙同组织但没有显式 related → 无边、非二度 */
    assert.equal(related.edges.length, 0);
    assert.deepEqual(queryGraphRelations(related, "d-1", "d-2").commonIds, []);
    const merged = [...related.edges, ...augmentation.edges];
    assert.equal(merged.filter((edge) => edge.kind === "member").length, 2);
    assert.equal(merged.filter((edge) => edge.kind === "related").length, 0);
});
