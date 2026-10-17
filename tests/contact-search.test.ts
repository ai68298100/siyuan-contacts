import assert from "node:assert/strict";
import test from "node:test";
import { filterContactSearch } from "../src/domain/contact-search.ts";
import type { ContactSummary } from "../src/domain/person.ts";

function person(docId: string, name: string, relatedItemIds: string[] = [], group = ""): ContactSummary {
    return {
        docId, itemId: `item-${docId}`, name, phone: "", email: "", wechat: "", website: "",
        birthday: "", isLunar: false, group, tags: [], relatedItemIds,
    };
}

test("联系人搜索：关键词命中人物时同时保留其显式关联人", () => {
    const people = [
        person("a", "甲", ["item-b"]),
        person("b", "乙"),
        person("c", "丙"),
    ];
    assert.deepEqual(filterContactSearch(people, "甲").map((item) => item.docId), ["a", "b"]);
    assert.deepEqual(filterContactSearch(people, "乙").map((item) => item.docId), ["a", "b"]);
});

test("联系人搜索：单向关系也能从反向关联端收回结果，分组继续生效", () => {
    const people = [
        person("a", "甲", [], "朋友"),
        person("b", "乙", ["item-a"], "同事"),
        person("c", "丙", [], "朋友"),
    ];
    assert.deepEqual(filterContactSearch(people, "甲").map((item) => item.docId), ["a", "b"]);
    assert.deepEqual(filterContactSearch(people, "甲", "朋友").map((item) => item.docId), ["a"]);
});

