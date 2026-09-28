import assert from "node:assert/strict";
import test from "node:test";
import { buildActionCards, groupActionCards } from "../src/domain/action-list.ts";
import type { ActionPersonInput } from "../src/domain/action-list.ts";
import type { ContactSummary } from "../src/domain/person.ts";

const TODAY = "2026-09-28";

function input(partial: Partial<ActionPersonInput> & { name: string }): ActionPersonInput {
    const docId = `doc-${partial.name}`;
    return {
        person: {
            docId, itemId: `item-${partial.name}`, name: partial.name, phone: "", email: "",
            wechat: "", website: "", birthday: "", isLunar: false, group: "", tags: [], relatedItemIds: [],
        },
        followUps: [],
        ...partial,
    };
}

test("行动清单：多原因只出一张卡并按紧急度取桶、原因按紧急度排序", () => {
    const cards = buildActionCards([
        input({
            name: "甲",
            birthdayDaysUntil: 0,
            birthdayDate: TODAY,
            staleThreshold: 30,
            lastDaysAgo: 60,
            followUps: [{ id: "f1", title: "问问面试", dueDate: "2026-09-20" }],
        }),
    ], TODAY);
    assert.equal(cards.length, 1);
    assert.equal(cards[0].bucket, "overdue");
    assert.deepEqual(cards[0].reasons.map((reason) => reason.kind), ["followup", "birthday", "stale"]);
    assert.equal(cards[0].earliestDate, "2026-09-20");
    assert.equal(cards[0].reasons[2].label, "60 天未联系（阈值 30 天）");
});

test("行动清单：逾期 > 今天 > 本周 > 持续关注 的稳定排序，仅持续关注者无日期排最后", () => {
    const cards = buildActionCards([
        input({ name: "乙", staleThreshold: 30, lastDaysAgo: 40 }),
        input({ name: "丙", followUps: [{ id: "f2", title: "", dueDate: "2026-09-28" }] }),
        input({ name: "丁", birthdayDaysUntil: 5, birthdayDate: "2026-10-03" }),
        input({ name: "甲", followUps: [{ id: "f3", title: "还书", dueDate: "2026-09-25" }] }),
    ], TODAY);
    assert.deepEqual(cards.map((card) => card.person.name), ["甲", "丙", "丁", "乙"]);
    assert.equal(cards[0].bucket, "overdue");
    assert.equal(cards[1].bucket, "today");
    assert.equal(cards[2].bucket, "week");
    assert.equal(cards[3].bucket, "stale");
    assert.equal(cards[3].earliestDate, undefined);
    assert.equal(cards[1].reasons[0].label, "跟进「保持联系」今天到期");
});

test("行动清单：无原因不出卡，窗口外生日与跟进排除，从未互动理由走专用文案", () => {
    const cards = buildActionCards([
        input({ name: "甲", followUps: [{ id: "f9", title: "太远的事", dueDate: "2027-01-01" }] }),
        input({ name: "乙", birthdayDaysUntil: 30 }),
        input({ name: "丙", staleThreshold: 30 }),
    ], TODAY);
    assert.deepEqual(cards.map((card) => card.person.name), ["丙"]);
    assert.equal(cards[0].reasons[0].label, "从未互动");
});

test("groupActionCards（B01）：五组分类、从未互动单独归组、组内保持排序、空组不返回", () => {
    const mkPerson = (name: string) => ({
        docId: `doc-${name}`, itemId: `row-${name}`, name,
        phone: "", email: "", wechat: "", website: "", birthday: "", isLunar: false,
        group: "", tags: [], relatedItemIds: [],
    });
    const cards = buildActionCards([
        { person: mkPerson("逾期甲"), followUps: [{ id: "f1", title: "还书", dueDate: "2026-09-25" }] },
        { person: mkPerson("今天乙"), birthdayDaysUntil: 0, birthdayDate: "2026-09-28", followUps: [] },
        { person: mkPerson("本周丙"), birthdayDaysUntil: 5, birthdayDate: "2026-10-03", followUps: [] },
        { person: mkPerson("久未丁"), lastDaysAgo: 45, staleThreshold: 30, followUps: [] },
        { person: mkPerson("从未戊"), staleThreshold: 30, followUps: [] },
        { person: mkPerson("从未己"), staleThreshold: 30, followUps: [] },
    ], "2026-09-28");
    const groups = groupActionCards(cards);
    assert.deepEqual(groups.map((group) => group.key), ["overdue", "today", "week", "stale", "never"]);
    assert.deepEqual(groups.find((group) => group.key === "never")!.cards.map((card) => card.person.name), ["从未己", "从未戊"]);
    assert.equal(groups.find((group) => group.key === "never")!.defaultCollapsed, true);
    assert.equal(groups.find((group) => group.key === "overdue")!.defaultCollapsed, false);
    /* 从未互动但今天有跟进到期的人：归「今天」组（紧急桶优先），不进 never */
    const mixed = buildActionCards([
        { person: mkPerson("混合庚"), lastDaysAgo: undefined, staleThreshold: 30, followUps: [{ id: "f2", title: "回电", dueDate: "2026-09-28" }] },
    ], "2026-09-28");
    const mixedGroups = groupActionCards(mixed);
    assert.deepEqual(mixedGroups.map((group) => group.key), ["today"]);
});
