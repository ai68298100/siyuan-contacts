import assert from "node:assert/strict";
import test from "node:test";
import {
    applyPeopleFilters,
    EMPTY_PEOPLE_FILTER,
    extraFilterChips,
    isExtraFilterActive,
    matchTags,
} from "../src/domain/people-filters.ts";
import type { ContactSummary } from "../src/domain/person.ts";
import type { PeopleFilterState } from "../src/domain/people-filters.ts";

function person(partial: Partial<ContactSummary> & { docId: string; name: string }): ContactSummary {
    return {
        docId: partial.docId, itemId: partial.itemId ?? partial.docId, name: partial.name,
        phone: "", email: "", wechat: "", website: "", birthday: "", isLunar: false,
        group: partial.group ?? "", tags: partial.tags ?? [], relatedItemIds: [],
    };
}

const people = [
    person({ docId: "a", name: "甲", tags: ["球友", "家长群"] }),
    person({ docId: "b", name: "乙", tags: ["家长群"] }),
    person({ docId: "c", name: "丙", tags: ["球友"] }),
];

const recent = {
    a: { occurredAt: 1, localDate: "2026-09-01" },
    b: { occurredAt: 2, localDate: "2026-08-15" },
};

test("标签匹配：未选标签恒命中，all 为交集，any 为并集", () => {
    assert.deepEqual(matchTags(people[0], [], "all"), true);
    assert.deepEqual(people.filter((item) => matchTags(item, ["球友", "家长群"], "all")).map((item) => item.docId), ["a"]);
    assert.deepEqual(people.filter((item) => matchTags(item, ["球友", "家长群"], "any")).map((item) => item.docId), ["a", "b", "c"]);
});

test("日期范围：闭区间端点命中，缺侧不限制，无互动者不命中", () => {
    const base = (patch: Partial<PeopleFilterState>): PeopleFilterState => ({ ...EMPTY_PEOPLE_FILTER, ...patch });
    const ids = (filter: PeopleFilterState) => applyPeopleFilters(people, recent, filter).map((item) => item.docId);
    assert.deepEqual(ids(base({ recentFrom: "2026-09-01" })), ["a"], "from 端点未命中");
    assert.deepEqual(ids(base({ recentTo: "2026-08-15" })), ["b"], "to 端点未命中");
    assert.deepEqual(ids(base({ recentFrom: "2026-08-01", recentTo: "2026-08-31" })), ["b"], "区间过滤错误");
    assert.deepEqual(ids(base({ recentFrom: "2026-09-02" })), [], "下界之外应排除");
    assert.deepEqual(ids(base({ recentFrom: "bogus", recentTo: "" })), ["a", "b", "c"], "非法日期应视为不限制");
});

test("从未联系：只保留无互动者；与日期范围同设时按 AND 为空集", () => {
    const base = (patch: Partial<PeopleFilterState>): PeopleFilterState => ({ ...EMPTY_PEOPLE_FILTER, ...patch });
    const ids = (filter: PeopleFilterState) => applyPeopleFilters(people, recent, filter).map((item) => item.docId);
    assert.deepEqual(ids(base({ neverContacted: true })), ["c"]);
    assert.deepEqual(ids(base({ neverContacted: true, recentFrom: "2026-01-01" })), []);
});

test("生效条件：按固定顺序输出 chips，重置后不再生效", () => {
    const filter: PeopleFilterState = { tagMatch: "any", recentFrom: "2026-08-01", recentTo: "", neverContacted: false };
    assert.deepEqual(extraFilterChips(filter).map((chip) => chip.key), ["tagMatch", "recentRange"]);
    assert.equal(isExtraFilterActive(filter), true);
    assert.deepEqual(extraFilterChips(EMPTY_PEOPLE_FILTER), []);
    assert.equal(isExtraFilterActive(EMPTY_PEOPLE_FILTER), false);
});
