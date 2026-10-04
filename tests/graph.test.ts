import { test } from "node:test";
import assert from "node:assert/strict";
import { buildGraph, buildOrgAugmentation, capGraph, groupColor, queryGraphRelations } from "../src/domain/graph.ts";
import type { ContactSummary } from "../src/domain/person.ts";
import { shortestGraphPath, secondDegreeGraphIds } from "../src/domain/graph-path.ts";
import { buildGraphQuerySnapshot, resolveGraphCenter } from "../src/domain/graph-query.ts";
import type { GraphQuery, GraphSources } from "../src/domain/graph-query.ts";

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

function graphFixture(): { sources: GraphSources; query: GraphQuery } {
    return { sources: {
        people: [person({ itemId: "item-a", docId: "a", name: "同名", relatedItemIds: ["item-b"] }),
            person({ itemId: "item-b", docId: "b", name: "同名", relatedItemIds: ["item-c"] }),
            person({ itemId: "item-c", docId: "c", name: "丙" }), person({ itemId: "item-d", docId: "d", name: "孤立" })],
        organizations: [{ docId: "org", name: "组织", archived: false, memberships: [{ personDocId: "a", status: "active" }, { personDocId: "c", status: "active" }, { personDocId: "d", status: "former" }] }],
        selfDocId: "a", status: { roster: "verified", organizations: "verified", self: "verified" }, errors: {}, revision: 7,
    }, query: { mode: "relations", scope: "global", centerDocId: "", orgDocId: "", search: "", group: "", isolatedOnly: false,
        showOrgs: true, depth: "direct", focusId: "a", compareId: "c", queryMode: "path" } };
}

test("图快照：related/member/ref 分源，成员或引用不能缩短人物路径", () => {
    const { sources, query } = graphFixture();
    const snapshot = buildGraphQuerySnapshot(sources, query);
    assert.equal(snapshot.state, "ready");
    assert.deepEqual(snapshot.result.pathIds, ["a", "b", "c"]);
    assert.equal(snapshot.counts.displayedNodes, 5);
    assert.equal(snapshot.counts.displayedEdges, 4);
    assert.equal(snapshot.graph.edges.filter((edge) => edge.kind === "member").length, 2);
    const mixed = { ...snapshot.graph, edges: [...snapshot.graph.edges, { source: "a", target: "c", kind: "ref" as const }] };
    assert.deepEqual(shortestGraphPath(mixed, "a", "c"), ["a", "b", "c"]);
    assert.deepEqual(secondDegreeGraphIds(mixed, "a"), ["c"]);
    assert.deepEqual(queryGraphRelations(mixed, "a").neighborIds, ["b"]);
});

test("图快照：输入乱序、同名和等长路径仍保持确定结果，不改事实", () => {
    const { sources, query } = graphFixture();
    const before = structuredClone(sources);
    const first = buildGraphQuerySnapshot(sources, query);
    const reversed = { ...sources, people: [...sources.people].reverse(), organizations: sources.organizations.map((org) => ({ ...org, memberships: [...org.memberships].reverse() })) };
    assert.deepEqual(buildGraphQuerySnapshot(reversed, query), first);
    assert.deepEqual(sources, before);
    assert.equal(first.people.filter((entry) => entry.name === "同名").length, 2);
    const graph = { nodes: ["a", "b", "c", "d"].map((id) => ({ id, label: id, group: "", degree: 0 })),
        edges: [{ source: "a", target: "c" }, { source: "c", target: "d" }, { source: "a", target: "b" }, { source: "b", target: "d" }] };
    assert.deepEqual(shortestGraphPath(graph, "a", "d"), ["a", "b", "d"]);
    assert.deepEqual(shortestGraphPath({ nodes: [...graph.nodes].reverse(), edges: [...graph.edges].reverse() }, "a", "d"), ["a", "b", "d"]);
});

test("图快照：800 预算包含组织且保留低度中心，计数与丢弃边可核对", () => {
    const { sources, query } = graphFixture();
    sources.people = Array.from({ length: 1001 }, (_, index) => person({ itemId: `item-${index}`, docId: String(index).padStart(4, "0"), name: `人物${index}` }));
    sources.organizations = [{ docId: "org", name: "组织", archived: false, memberships: sources.people.map((entry) => ({ personDocId: entry.docId, status: "active" })) }];
    sources.selfDocId = "1000";
    const snapshot = buildGraphQuerySnapshot(sources, { ...query, scope: "self", focusId: "", compareId: "" });
    assert.deepEqual(snapshot.graph.nodes.map((node) => node.id).sort(), ["1000", "org"]);
    const global = buildGraphQuerySnapshot(sources, { ...query, focusId: "1000", compareId: "", orgDocId: "org" });
    assert.equal(global.graph.nodes.length, 800);
    assert(global.graph.nodes.some((node) => node.id === "1000"));
    assert(global.graph.nodes.some((node) => node.id === "org"));
    assert.equal(global.counts.clippedNodes, 202);
    assert.equal(global.counts.clippedEdges, 202);
    assert.equal(global.graph.nodes.find((node) => node.id === "org")?.degree, 799);
    assert.equal(global.counts.filteredNodes, global.counts.displayedNodes + global.counts.clippedNodes);
    assert.deepEqual(buildGraphQuerySnapshot({ ...sources, people: [...sources.people].reverse() }, { ...query, focusId: "1000", compareId: "", orgDocId: "org" }).graph, global.graph);
});

test("图快照：组织聚焦保留 active 事实，former/归档不成边且查询不走成员边", () => {
    const { sources, query } = graphFixture();
    const snapshot = buildGraphQuerySnapshot(sources, { ...query, scope: "org", orgDocId: "org", focusId: "", compareId: "" });
    assert.deepEqual(snapshot.graph.nodes.map((node) => node.id).sort(), ["a", "c", "org"]);
    assert(snapshot.graph.edges.every((edge) => edge.kind === "member"));
    const removed = buildGraphQuerySnapshot({ ...sources, organizations: sources.organizations.map((org) => ({ ...org, archived: true })) }, { ...query, scope: "org", orgDocId: "org" });
    assert.equal(removed.state, "center_missing");
    assert.equal(removed.query.orgDocId, "org");
    assert.equal(removed.graph.nodes.length, 0);
});

test("图快照：缺中心不回退本人；未知来源不会被当作合法空", () => {
    const { sources, query } = graphFixture();
    const missing = buildGraphQuerySnapshot(sources, { ...query, scope: "person", centerDocId: "deleted" });
    assert.equal(missing.state, "center_missing");
    assert.equal(missing.center.id, "deleted");
    const noSelf = buildGraphQuerySnapshot({ ...sources, selfDocId: null }, { ...query, scope: "self" });
    assert.equal(noSelf.state, "center_missing");
    const unknown = { ...sources, status: { ...sources.status, organizations: "unknown" as const }, errors: { organizations: "权限失败" } };
    const partial = buildGraphQuerySnapshot(unknown, query);
    assert.equal(partial.state, "partial");
    assert.equal(partial.counts.registered, null);
    assert.equal(partial.counts.sourceNodes, null);
    assert.equal(partial.graph.edges.filter((edge) => edge.kind === "member").length, 0);
    assert.equal(buildGraphQuerySnapshot(unknown, { ...query, orgDocId: "org" }).state, "unknown");
    assert.equal(buildGraphQuerySnapshot({ ...sources, status: { ...sources.status, roster: "unknown" } }, query).state, "unknown");
});

test("图快照：筛选保中心，重复身份排除，已删除查询端点显示原因", () => {
    const { sources, query } = graphFixture();
    const filtered = buildGraphQuerySnapshot(sources, { ...query, search: "没有匹配" });
    assert.deepEqual(filtered.graph.nodes.map((node) => node.id).sort(), ["a", "c"]);
    assert.deepEqual(filtered.retainedByFilter, ["a", "c"]);
    assert.equal(filtered.result.status, "no_path");
    assert(filtered.result.reason.includes("筛选或裁剪"));
    const duplicate = { ...sources, people: [...sources.people, { ...sources.people[0], itemId: "duplicate" }] };
    assert.equal(resolveGraphCenter(duplicate, { ...query, scope: "person", centerDocId: "a" }).status, "missing");
    const snapshot = buildGraphQuerySnapshot(duplicate, query);
    assert.equal(snapshot.result.status, "center_missing");
    assert(snapshot.diagnostics.some((entry) => entry.code === "ambiguous_identity" && entry.id === "a"));
    assert(!snapshot.graph.nodes.some((node) => node.id === "a"));
    const tooSmall = buildGraphQuerySnapshot(sources, { ...query, orgDocId: "org", maxNodes: 1 });
    assert.equal(tooSmall.state, "unknown");
    assert(tooSmall.diagnostics.some((entry) => entry.code === "budget_unknown"));
});

test("图快照：引用按登记人物与组织收窄，只有 ref；未知引用明确停止", () => {
    const { sources, query } = graphFixture();
    const graph = { nodes: [...buildGraphQuerySnapshot(sources, query).graph.nodes, { id: "note", label: "无关笔记", group: "", degree: 0 }],
        edges: [{ source: "org", target: "a", kind: "ref" as const }, { source: "a", target: "note", kind: "ref" as const }] };
    const nativeQuery = { ...query, mode: "native" as const, scope: "org" as const, orgDocId: "org" };
    const snapshot = buildGraphQuerySnapshot(sources, nativeQuery, { status: "verified", graph });
    assert.deepEqual(snapshot.graph.nodes.map((node) => node.id).sort(), ["a", "c", "org"]);
    assert.equal(snapshot.graph.edges.length, 1);
    assert.equal(snapshot.graph.edges[0].kind, "ref");
    assert.equal(snapshot.result.status, "none");
    const unknown = buildGraphQuerySnapshot(sources, nativeQuery, { status: "unknown", graph: { nodes: [], edges: [] }, error: "内核读取失败" });
    assert.equal(unknown.state, "unknown");
    assert.equal(unknown.counts.sourceNodes, null);
    assert(unknown.diagnostics.some((entry) => entry.code === "references_unknown"));
});

test("图快照：引用重复标签或混入其他来源不改变稳定身份与边语义", () => {
    const { sources, query } = graphFixture();
    const nativeQuery = { ...query, mode: "native" as const, scope: "global" as const };
    const nodes = [{ id: "a", label: "过期标题", group: "", degree: 99 },
        { id: "a", label: "另一个标题", group: "", degree: 0 }, { id: "b", label: "标题", group: "", degree: 0 }];
    const edges = [{ source: "a", target: "b", kind: "ref" as const },
        { source: "a", target: "b", kind: "related" as const }, { source: "a", target: "org", kind: "member" as const }];
    const references = { status: "verified" as const, graph: { nodes, edges } };
    const snapshot = buildGraphQuerySnapshot(sources, nativeQuery, references);
    assert.deepEqual(snapshot.graph.nodes.map((node) => [node.id, node.label, node.degree]), [["a", "同名", 1], ["b", "同名", 1]]);
    assert.deepEqual(snapshot.graph.edges, [{ source: "a", target: "b", kind: "ref" }]);
    assert.deepEqual(buildGraphQuerySnapshot(sources, nativeQuery, { ...references, graph: { nodes: [...nodes].reverse(), edges: [...edges].reverse() } }), snapshot);
    const partial = buildGraphQuerySnapshot({ ...sources, status: { ...sources.status, organizations: "unknown" } }, nativeQuery, references);
    assert.equal(partial.state, "partial");
    assert.equal(partial.counts.sourceNodes, null);
    assert.equal(partial.counts.displayedNodes, 2);
});

test("图快照：范围外关系端点和非组织成员中心保留时明示例外", () => {
    const { sources, query } = graphFixture();
    const snapshot = buildGraphQuerySnapshot(sources, { ...query, scope: "person", centerDocId: "b", orgDocId: "org", focusId: "b", compareId: "d" });
    assert.deepEqual(snapshot.retainedByRange, ["b", "d"]);
    assert(snapshot.graph.nodes.some((node) => node.id === "b"));
    assert(snapshot.graph.nodes.some((node) => node.id === "d"));
    assert(!snapshot.graph.edges.some((edge) => edge.kind === "member" && (edge.source === "b" || edge.target === "b" || edge.source === "d" || edge.target === "d")));
    assert.deepEqual(snapshot.query.orgDocId, "org");
    assert.equal(snapshot.result.status, "no_path");
});

test("图快照：无关系筛选按完整 related 来源判断，隐藏对端不产生孤立事实", () => {
    const { sources, query } = graphFixture();
    const snapshot = buildGraphQuerySnapshot(sources, { ...query, scope: "global", focusId: "", compareId: "", search: "同名", isolatedOnly: true });
    assert.equal(snapshot.counts.isolatedPeople, 1);
    assert.equal(snapshot.graph.nodes.length, 0);
    assert.equal(snapshot.state, "empty");
    const selfUnknown = buildGraphQuerySnapshot({ ...sources, status: { ...sources.status, self: "unknown" }, errors: { self: "身份读取失败" } }, { ...query, scope: "self" });
    assert.equal(selfUnknown.state, "unknown");
    assert.equal(selfUnknown.center.status, "unknown");
    assert.equal(selfUnknown.result.status, "unknown");
});

test("图快照：归档不消除人物/组织身份冲突，重复组织 ID 不可充当中心", () => {
    const { sources, query } = graphFixture();
    const overlap = { ...sources, organizations: [...sources.organizations, { docId: "a", name: "归档组织", archived: true, memberships: [] }] };
    const personCenter = buildGraphQuerySnapshot(overlap, { ...query, scope: "self" });
    assert.equal(personCenter.state, "center_missing");
    assert(personCenter.diagnostics.some((entry) => entry.code === "ambiguous_identity" && entry.id === "a"));
    assert(!personCenter.people.some((entry) => entry.docId === "a"));
    const duplicate = { ...sources, organizations: [...sources.organizations, { ...sources.organizations[0], archived: true }] };
    const orgCenter = buildGraphQuerySnapshot(duplicate, { ...query, scope: "org", orgDocId: "org" });
    assert.equal(orgCenter.state, "center_missing");
    assert(!orgCenter.organizations.some((entry) => entry.id === "org"));
});

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
