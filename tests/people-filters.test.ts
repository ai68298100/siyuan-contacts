import assert from "node:assert/strict";
import test from "node:test";
import {
    applyPeopleFilters,
    EMPTY_PEOPLE_FILTER,
    extraFilterChips,
    hasProfileGap,
    isExtraFilterActive,
    matchTags,
    PROFILE_GAPS,
} from "../src/domain/people-filters.ts";
import type { ContactSummary } from "../src/domain/person.ts";
import type { PeopleFilterState, ProfileGap } from "../src/domain/people-filters.ts";
import { buildVirtualRows, estimateVirtualHeight, virtualRowAtOffset, virtualRowRange } from "../src/domain/virtual-list.ts";

function person(partial: Partial<ContactSummary> & { docId: string; name: string }): ContactSummary {
    return {
        docId: partial.docId, itemId: partial.itemId ?? partial.docId, name: partial.name,
        phone: "", email: "", wechat: "", website: "", birthday: "", isLunar: false,
        group: partial.group ?? "", tags: partial.tags ?? [], relatedItemIds: [],
        ...partial,
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
    assert.deepEqual(ids(base({ recentFrom: "2026-02-31", recentTo: "" })), ["a", "b", "c"], "不存在的公历日期应视为不限制");
    assert.deepEqual(ids(base({ recentFrom: "2026-02-28", recentTo: "2026-02-30" })), ["a", "b"], "不存在的结束日期应视为不限制");
    assert.deepEqual(ids(base({ recentFrom: null as unknown as string })), ["a", "b", "c"], "非字符串日期应视为不限制");
});

test("从未联系：只保留无互动者；与日期范围同设时按 AND 为空集", () => {
    const base = (patch: Partial<PeopleFilterState>): PeopleFilterState => ({ ...EMPTY_PEOPLE_FILTER, ...patch });
    const ids = (filter: PeopleFilterState) => applyPeopleFilters(people, recent, filter).map((item) => item.docId);
    assert.deepEqual(ids(base({ neverContacted: true })), ["c"]);
    assert.deepEqual(ids(base({ neverContacted: true, recentFrom: "2026-01-01" })), []);
});

test("生效条件：按固定顺序输出 chips，重置后不再生效", () => {
    const filter: PeopleFilterState = { tagMatch: "any", recentFrom: "2026-08-01", recentTo: "", neverContacted: false, profileGap: "" };
    assert.deepEqual(extraFilterChips(filter).map((chip) => chip.key), ["tagMatch", "recentRange"]);
    assert.equal(isExtraFilterActive(filter), true);
    assert.deepEqual(extraFilterChips(EMPTY_PEOPLE_FILTER), []);
    assert.equal(isExtraFilterActive(EMPTY_PEOPLE_FILTER), false);
});

test("资料完整度（C03）：四类缺口判定、筛选与 chips（只按现有九字段）", () => {
    const roster = [
        person({ docId: "ga", name: "全空甲" }),
        person({ docId: "gb", name: "有电话缺生日乙", phone: "13800001111" }),
        person({ docId: "gc", name: "齐全丙", phone: "13900002222", email: "c@x.com", wechat: "c_wx", birthday: "1990-01-01", group: "家人", tags: ["t"] }),
    ];
    const withGap = (gap: ProfileGap) => roster.filter((entry) => hasProfileGap(entry, gap)).map((entry) => entry.docId);
    assert.deepEqual(withGap("phone"), ["ga"]);
    assert.deepEqual(withGap("birthday"), ["ga", "gb"]);
    assert.deepEqual(withGap("contact"), ["ga"]);
    assert.deepEqual(withGap("organize"), ["ga", "gb"]);
    const ids = (gap: ProfileGap | "") => applyPeopleFilters(roster, {}, { ...EMPTY_PEOPLE_FILTER, profileGap: gap }).map((entry) => entry.docId);
    assert.deepEqual(ids("birthday"), ["ga", "gb"]);
    assert.deepEqual(ids(""), ["ga", "gb", "gc"]);
    const filter: PeopleFilterState = { ...EMPTY_PEOPLE_FILTER, profileGap: "birthday" };
    assert.deepEqual(extraFilterChips(filter).map((chip) => chip.key), ["profileGap"]);
    assert.equal(isExtraFilterActive(filter), true);
    assert.equal(PROFILE_GAPS.length, 4);
});

test("联系人窗口：桌面多列按行内最高实测卡片高度累计", () => {
    const cards = ["a", "b", "c", "d"].map((id) => ({ id }));
    const heights = new Map([["a", 180], ["b", 240], ["c", 190], ["d", 200]]);
    const geometry = buildVirtualRows(cards, 2, (card) => card.id, (id) => heights.get(id), 202, 16);

    assert.deepEqual(geometry.rows.map((row) => row.height), [240, 200]);
    assert.deepEqual(geometry.offsets, [0, 256, 456]);
    assert.equal(virtualRowAtOffset(geometry.offsets, 255), 0);
    assert.equal(virtualRowAtOffset(geometry.offsets, 256), 1);
    assert.deepEqual(virtualRowRange(geometry.offsets, 256, 120, 1, 0), { start: 0, end: 2 });
    assert.equal(geometry.rows[Math.floor(3 / 2)]?.startIndex, 2, "第 4 个联系人焦点应定位到第二行的累计偏移");
});

test("联系人窗口：手机单列支持长资料行高、实测复用与重新排序分组", () => {
    const cards = ["short", "long", "next"].map((id) => ({ id }));
    const heights = new Map([["short", 132], ["long", 348], ["next", 176]]);
    const mobile = buildVirtualRows(cards, 1, (card) => card.id, (id) => heights.get(id), 202, 16);

    assert.deepEqual(mobile.offsets, [0, 148, 512, 688]);
    assert.equal(virtualRowAtOffset(mobile.offsets, 300), 1, "长组织资料所在卡片必须占据真实滚动位置");

    const reordered = buildVirtualRows([cards[2]!, cards[0]!, cards[1]!], 2, (card) => card.id, (id) => heights.get(id), 202, 16);
    assert.deepEqual(reordered.rows.map((row) => row.height), [176, 348]);
    assert.deepEqual(reordered.offsets, [0, 192, 540]);
    assert.deepEqual(virtualRowRange(reordered.offsets, 540, 1, 0, 0), { start: 1, end: 2 });
});

test("联系人窗口：手机长资料首次测量后只修正真实行，后续位置不再按固定估值偏移", () => {
    const cards = Array.from({ length: 701 }, (_, index) => ({ id: `mobile-${index}` }));
    const heights = new Map<string, number>();
    const initial = buildVirtualRows(cards, 1, (card) => card.id, (id) => heights.get(id), 202, 16);
    assert.equal(initial.offsets[600], 130800, "未测量时保持有界估值，便于首屏快速挂载");

    // 模拟滚动到长资料卡片后 ResizeObserver 回填真实高度；只有该卡及其后续行
    // 的累计偏移变化，前面的锚点不应因为全量重排而被重新猜测。
    heights.set("mobile-600", 520);
    const measured = buildVirtualRows(cards, 1, (card) => card.id, (id) => heights.get(id), 202, 16);
    assert.equal(measured.rows[600]?.height, 520);
    assert.equal(measured.offsets[600], initial.offsets[600], "长卡片之前的锚点偏移保持稳定");
    assert.equal(measured.offsets[601], initial.offsets[601] + 318, "只增加真实长卡片相对估值的差值");
    assert.equal(virtualRowAtOffset(measured.offsets, measured.offsets[601]! + 1), 601, "长资料后的下一行按新累计位置定位");
});

test("联系人窗口：未测卡片使用估值，空列表和非法估值保持有界", () => {
    const geometry = buildVirtualRows([{ id: "a" }, { id: "b" }, { id: "c" }], 2, (item) => item.id, () => undefined, 210, 12);
    assert.deepEqual(geometry.rows.map((row) => row.height), [210, 210]);
    assert.deepEqual(geometry.offsets, [0, 222, 432]);
    assert.deepEqual(buildVirtualRows([], 0, (item: { id: string }) => item.id, () => undefined, Number.NaN, -2), {
        rows: [], offsets: [0], totalHeight: 0,
    });
    assert.deepEqual(virtualRowRange([0], 0, 300, 3, 800), { start: 0, end: 0 });
});

test("联系人窗口：已测卡片样本自适应未测行估值并限制极端值", () => {
    assert.equal(estimateVirtualHeight([], 202), 202);
    assert.equal(estimateVirtualHeight([132, 348], 202, 2), 240);
    assert.equal(estimateVirtualHeight([132, 348, 980], 202, 3), 348);
    assert.equal(Math.max(120, Math.min(420, estimateVirtualHeight([132, 348, 980], 202))), 348);
});
