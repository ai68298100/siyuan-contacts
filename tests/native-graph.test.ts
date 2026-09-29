import { test } from "node:test";
import assert from "node:assert/strict";
import { mapNativeGraph } from "../src/domain/native-graph.ts";

/* B14 原生图映射：字段名按 spike:b14 E 段实证（节点 id/label、边 from/to） */

test("原生图映射：过滤非登记节点并丢弃其边，保留集合内节点", () => {
    const graph = mapNativeGraph(
        {
            nodes: [
                { id: "self", label: "我自己" },
                { id: "p1", label: "甲" },
                { id: "note-x", label: "无关笔记" },
            ],
            links: [
                { from: "self", to: "p1" },
                { from: "self", to: "note-x" },
            ],
        },
        { allowedDocIds: new Set(["self", "p1"]) },
    );
    assert.deepEqual(graph.nodes.map((node) => node.id).sort(), ["p1", "self"]);
    assert.deepEqual(graph.edges, [{ source: "self", target: "p1" }]);
});

test("原生图映射：度数按图内保留边重算，非全库 refs/defs", () => {
    const graph = mapNativeGraph(
        {
            nodes: [
                { id: "a", label: "A" },
                { id: "b", label: "B" },
                { id: "c", label: "C" },
            ],
            links: [
                { from: "a", to: "b" },
                { from: "a", to: "b" },
                { from: "a", to: "a" },
                { from: "a", to: "missing" },
            ],
        },
        { allowedDocIds: new Set(["a", "b", "c"]) },
    );
    const byId = new Map(graph.nodes.map((node) => [node.id, node]));
    assert.equal(byId.get("a")?.degree, 1);
    assert.equal(byId.get("b")?.degree, 1);
    assert.equal(byId.get("c")?.degree, 0);
    assert.equal(graph.edges.length, 1);
});

test("原生图映射：分组取登记映射，缺省按「其他」；畸形条目跳过", () => {
    const graph = mapNativeGraph(
        {
            nodes: [
                undefined,
                { id: "p1", label: "甲" },
                { id: "self" },
                { id: "", label: "空 id" },
                { id: "dup", label: "重复" },
                { id: "dup", label: "重复2" },
            ] as never,
            links: [
                { from: "p1", to: "self" },
                { from: "", to: "self" },
                undefined as never,
            ],
        },
        { allowedDocIds: new Set(["p1", "self", "dup"]), docGroups: new Map([["p1", "同事"]]) },
    );
    const byId = new Map(graph.nodes.map((node) => [node.id, node]));
    assert.equal(byId.size, 3);
    assert.equal(byId.get("p1")?.group, "同事");
    assert.equal(byId.get("self")?.group, "其他");
    assert.equal(byId.get("self")?.label, "self");
    assert.equal(graph.edges.length, 1);
});

test("原生图映射：空载荷与空集合得空图，不改写输入", () => {
    assert.deepEqual(mapNativeGraph({}, { allowedDocIds: new Set() }), { nodes: [], edges: [] });
    const payload = {
        nodes: [{ id: "a", label: "A" }],
        links: [{ from: "a", to: "a" }],
    };
    const snapshot = structuredClone(payload);
    mapNativeGraph(payload, { allowedDocIds: new Set(["a"]) });
    assert.deepEqual(payload, snapshot);
});
