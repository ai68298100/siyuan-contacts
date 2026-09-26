import { test } from "node:test";
import assert from "node:assert/strict";
import { buildGraph, groupColor } from "../src/domain/graph.ts";
import type { ContactSummary } from "../src/domain/person.ts";

function person(partial: Partial<ContactSummary> & { itemId: string; docId: string; name: string }): ContactSummary {
    return {
        phone: "", email: "", wechat: "", website: "", birthday: "", isLunar: false,
        group: "", tags: [], relatedItemIds: [],
        ...partial,
    };
}

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
