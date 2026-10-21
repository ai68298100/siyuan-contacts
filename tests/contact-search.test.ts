import assert from "node:assert/strict";
import test from "node:test";
import { filterContactSearch } from "../src/domain/contact-search.ts";
import { projectPersonAffiliations } from "../src/domain/org-membership.ts";
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

test("联系人搜索：姓名与无关系的别名、组织命中同时保留，不因直接姓名命中而截断", () => {
    const named = person("named", "Azure 姓名");
    const alias = { ...person("alias", "乙"), aliasProfile: { state: "known" as const, values: ["Azure Alias"] } };
    const organization = person("organization", "丙");
    organization.profile = {
        readAt: 1, selfDocId: null,
        affiliations: { state: "known", value: projectPersonAffiliations(organization.docId, [{
            id: "membership-work", personDocId: organization.docId, orgDocId: "organization-work",
            department: "研发", title: "工程师", joinedOn: "", leftOn: "", status: "active", affiliationKind: "work",
        }], new Map([["organization-work", { name: "Azure Organization", archived: false }]])) },
        relationship: { state: "self_missing", labels: null },
    };
    const people = [named, person("other", "未命中"), alias, organization];
    assert.deepEqual(filterContactSearch(people, " azure ").map((item) => item.itemId), [named.itemId, alias.itemId, organization.itemId]);
});

for (const size of [0, 1, 200, 201]) {
    test(`联系人搜索：完整投影 ${size} 行在分页边界保留末行别名命中`, () => {
        const people = Array.from({ length: size }, (_, index) => person(`row-${index}`, `人物 ${index}`));
        if (people.length) people[people.length - 1].aliasProfile = { state: "known", values: ["边界别名"] };
        assert.deepEqual(filterContactSearch(people, "边界别名").map((item) => item.itemId),
            people.length ? [people[people.length - 1].itemId] : []);
        assert.equal(filterContactSearch(people, " ").length, size);
    });
}

test("联系人搜索：只扩展双向一步邻居，不将二步关系或悬空文档 ID 当成命中", () => {
    const direct = person("direct", "唯一命中", ["item-outgoing", "item-outgoing", "missing-item"]);
    const outgoing = person("outgoing", "向外一跳", ["item-second-outgoing"]);
    const incoming = person("incoming", "向内一跳", [direct.itemId]);
    const people = [
        person("second-incoming", "向内二跳", [incoming.itemId]), incoming,
        person("doc-only", "文档引用不是关联行", [direct.docId]), direct,
        person("second-outgoing", "向外二跳"), outgoing,
    ];
    assert.deepEqual(filterContactSearch(people, "唯一命中").map((item) => item.itemId), [incoming.itemId, direct.itemId, outgoing.itemId]);
});

test("联系人搜索：分组限定直接命中和最终邻居，同名人物仍按稳定关联行 ID 区分", () => {
    const direct = { ...person("first", "同名", ["item-neighbor", "item-outside"], "朋友"),
        aliasProfile: { state: "known" as const, values: ["独有别名"] } };
    const people = [
        direct, person("second", "同名", [], "朋友"), person("neighbor", "邻居", [], "朋友"),
        person("outside", "组外邻居", [], "同事"),
    ];
    assert.deepEqual(filterContactSearch(people, "独有别名", "朋友").map((item) => item.itemId), [direct.itemId, "item-neighbor"]);
    assert.deepEqual(filterContactSearch(people, "独有别名", "同事"), [], "组外的直接命中不作为当前分组的扩展种子");
});

test("联系人搜索：未知资料提示不作为字段值命中，确定的基础字段仍可搜索", () => {
    const unknown = person("unknown", "可查姓名");
    unknown.aliasProfile = { state: "unknown", message: "别名读取失败，请重新读取核实" };
    unknown.profile = {
        readAt: 1, selfDocId: undefined,
        affiliations: { state: "unknown", message: "组织归属读取失败，请重新读取核实" },
        relationship: { state: "unknown", labels: null },
    };
    for (const query of ["尚未核实", "读取失败", "请先设置本人", "未填写"]) {
        assert.deepEqual(filterContactSearch([unknown], query), [], `提示文案不应当作真实值：${query}`);
    }
    assert.deepEqual(filterContactSearch([unknown], "可查姓名"), [unknown]);
});

test("联系人搜索：保留输入顺序与对象身份，筛选不改写原始名册或关系", () => {
    const direct = person("direct", "唯一命中", ["item-neighbor", "item-neighbor"]);
    const neighbor = person("neighbor", "邻居");
    const people = [neighbor, direct];
    const before = structuredClone(people);
    const results = filterContactSearch(people, "唯一命中");
    assert.deepEqual(people, before);
    assert.equal(results.length, 2);
    assert.equal(results[0], neighbor);
    assert.equal(results[1], direct);
});

test("联系人搜索：支持拼音首字母模糊检索命中姓名与别名", () => {
    const p1 = person("p1", "张三");
    const p2 = person("p2", "李四");
    const p3 = { ...person("p3", "王五"), aliasProfile: { state: "known" as const, values: ["欧阳六"] } };
    const p4 = person("p4", "赵六");
    const people = [p1, p2, p3, p4];

    // 输入 "zs" 命中 "张三"
    assert.deepEqual(filterContactSearch(people, "zs").map((p) => p.docId), ["p1"]);

    // 输入 "ls" 命中 "李四"
    assert.deepEqual(filterContactSearch(people, "ls").map((p) => p.docId), ["p2"]);

    // 输入 "oy" 命中别名 "欧阳六"
    assert.deepEqual(filterContactSearch(people, "oy").map((p) => p.docId), ["p3"]);

    // 输入 "z" 前缀命中 "张三" 与 "赵六"
    assert.deepEqual(filterContactSearch(people, "z").map((p) => p.docId), ["p1", "p4"]);
});

