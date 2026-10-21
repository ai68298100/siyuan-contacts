import assert from "node:assert/strict";
import test from "node:test";
import { loadPersonCadence } from "../src/data/cadences.ts";
import {
    computeRelationshipHealth,
    computeRelationshipHealthDistribution,
    relationshipHeatColorClass as heatLevelColorClass,
    normalizeCadenceMap,
    normalizeCadenceMapForWrite,
} from "../src/domain/cadence.ts";
import { staleContacts } from "../src/domain/interactions.ts";
import type { ContactSummary } from "../src/domain/person.ts";
import type { InteractionEvent } from "../src/domain/interactions.ts";

const DOC_A = "20260928000000-aaaaaaa";
const DOC_B = "20260928000000-bbbbbbb";

function person(docId: string, name: string): ContactSummary {
    return {
        docId, itemId: `item-${docId}`, name, phone: "", email: "", wechat: "", website: "",
        birthday: "", isLunar: false, group: "", tags: [], relatedItemIds: [],
    };
}

function event(personDocId: string, occurredAt: number, localDate: string): InteractionEvent {
    return { id: `e-${personDocId}-${occurredAt}`, personDocId, occurredAt, localDate, source: "manual" };
}

test("节奏归一化：非法键与非法值丢弃，days 钳制 1–365，paused 缺省 false", () => {
    const map = normalizeCadenceMap({
        schemaVersion: 1,
        cadences: {
            [DOC_A]: { days: 7, paused: true },
            [DOC_B]: { days: 999 },
            "bad-id": { days: 7 },
            "20260928000000-ccccccc": { days: "many" },
            "20260928000000-ddddddd": null,
        },
    });
    assert.deepEqual(map[DOC_A], { days: 7, paused: true });
    assert.equal(map[DOC_B].days, 365);
    assert.equal(map["bad-id"], undefined);
    assert.equal(map["20260928000000-ccccccc"], undefined);
    assert.equal(normalizeCadenceMap(null).constructor, Object);
    assert.deepEqual(normalizeCadenceMap("junk"), {});
});

test("节奏存储：写前包络检查，损坏抛错、空串可首次保存", () => {
    assert.throws(() => normalizeCadenceMapForWrite({ schemaVersion: 2, cadences: {} }));
    assert.throws(() => normalizeCadenceMapForWrite({ schemaVersion: 1, cadences: { [DOC_A]: { days: "many" } } }));
    assert.throws(() => normalizeCadenceMapForWrite({ schemaVersion: 1, cadences: { bad: { days: 7 } } }));
    // days 越界按契约钳制（0 → 1、999 → 365），不视为损坏
    assert.equal(normalizeCadenceMapForWrite({ schemaVersion: 1, cadences: { [DOC_A]: { days: 0 } } })[DOC_A].days, 1);
    assert.deepEqual(normalizeCadenceMapForWrite(""), {});
    assert.deepEqual(normalizeCadenceMapForWrite(null), {});
});

test("人物节奏读取：磁盘读取失败必须保留错误，不能伪装成跟随全局", async () => {
    const failing = {
        loadData: async () => { throw new Error("模拟磁盘故障"); },
    } as never;
    await assert.rejects(loadPersonCadence(failing, DOC_A), /存储读取失败.*person-cadences\.json/);

    const missing = { loadData: async () => null } as never;
    assert.equal(await loadPersonCadence(missing, DOC_A), null);
});

test("久未联系：覆盖阈值生效、暂停整体隐藏、从未互动保留、补录不错误覆盖较新记录", () => {
    const people = [person(DOC_A, "甲"), person(DOC_B, "乙")];
    // 乙 20 天前互动；之后补录一条 40 天前的，最近互动仍应取 20 天前那次
    const now = new Date();
    const daysAgoDate = (days: number) => {
        const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - days);
        const pad = (value: number) => String(value).padStart(2, "0");
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    };
    const store = {
        schemaVersion: 1 as const,
        events: [
            event(DOC_B, now.getTime() - 20 * 86400000, daysAgoDate(20)),
            event(DOC_B, now.getTime() - 40 * 86400000, daysAgoDate(40)),
        ],
    };
    // 全局 30 天：乙（20 天）不在久未联系；甲从未互动 → 在
    const global = staleContacts(store, people, 30, now);
    assert.deepEqual(global.map((info) => info.person.docId), [DOC_A]);
    // 乙覆盖为 14 天：乙（20 天 ≥ 14）进入；甲从未互动（视为最久）仍排最前
    const adjusted = staleContacts(store, people, 30, now, { [DOC_B]: { days: 14, paused: false } });
    assert.deepEqual(adjusted.map((info) => info.person.docId), [DOC_A, DOC_B]);
    // 乙覆盖为 30 天：回到仅甲
    const widened = staleContacts(store, people, 30, now, { [DOC_B]: { days: 30, paused: false } });
    assert.deepEqual(widened.map((info) => info.person.docId), [DOC_A]);
    // 甲暂停：从未互动也隐藏
    const paused = staleContacts(store, people, 30, now, { [DOC_A]: { days: 30, paused: true } });
    assert.deepEqual(paused.map((info) => info.person.docId), []);
});

test("E-29 关系健康度与热度分级：客观推导热度、分数、逾期天数与暂停语义", () => {
    const baseNow = 1700000000000;
    const dayMs = 86400 * 1000;

    // 1. hot: 刚刚联系 (5天 / 30天) -> ratio ~ 0.167
    const hotResult = computeRelationshipHealth({
        cadenceDays: 30,
        lastInteractionTime: baseNow - 5 * dayMs,
        nowTime: baseNow,
    });
    assert.equal(hotResult.level, "hot");
    assert.equal(hotResult.elapsedDays, 5);
    assert.equal(hotResult.cadenceDays, 30);
    assert.equal(hotResult.overdue, false);
    assert.equal(hotResult.overdueDays, 0);
    assert.equal(hotResult.score, 92); // (1 - 5/60) * 100 = 91.67 -> 92
    assert.equal(heatLevelColorClass(hotResult.level), "lvct-heat--hot");

    // 2. hot 边界: 刚好周期一半 (15天 / 30天) -> ratio = 0.5
    const halfResult = computeRelationshipHealth({
        cadenceDays: 30,
        lastInteractionTime: baseNow - 15 * dayMs,
        nowTime: baseNow,
    });
    assert.equal(halfResult.level, "hot");
    assert.equal(halfResult.score, 75); // (1 - 0.25) * 100 = 75

    // 3. warm: 周期过半但未到期 (20天 / 30天) -> ratio ~ 0.667
    const warmResult = computeRelationshipHealth({
        cadenceDays: 30,
        lastInteractionTime: baseNow - 20 * dayMs,
        nowTime: baseNow,
    });
    assert.equal(warmResult.level, "warm");
    assert.equal(warmResult.overdue, false);
    assert.equal(warmResult.score, 67); // (1 - 20/60) * 100 = 66.67 -> 67
    assert.equal(heatLevelColorClass(warmResult.level), "lvct-heat--warm");

    // 4. warm 到期日: (30天 / 30天) -> ratio = 1.0
    const dueResult = computeRelationshipHealth({
        cadenceDays: 30,
        lastInteractionTime: baseNow - 30 * dayMs,
        nowTime: baseNow,
    });
    assert.equal(dueResult.level, "warm");
    assert.equal(dueResult.overdue, false);
    assert.equal(dueResult.score, 50);

    // 5. cool: 轻度逾期 (40天 / 30天) -> ratio = 1.333
    const coolResult = computeRelationshipHealth({
        cadenceDays: 30,
        lastInteractionTime: baseNow - 40 * dayMs,
        nowTime: baseNow,
    });
    assert.equal(coolResult.level, "cool");
    assert.equal(coolResult.overdue, true);
    assert.equal(coolResult.overdueDays, 10);
    assert.equal(coolResult.score, 33); // (1 - 40/60) * 100 = 33.33 -> 33
    assert.equal(heatLevelColorClass(coolResult.level), "lvct-heat--cool");

    // 6. cold: 深度逾期 (75天 / 30天) -> ratio = 2.5
    const coldResult = computeRelationshipHealth({
        cadenceDays: 30,
        lastInteractionTime: baseNow - 75 * dayMs,
        nowTime: baseNow,
    });
    assert.equal(coldResult.level, "cold");
    assert.equal(coldResult.overdue, true);
    assert.equal(coldResult.overdueDays, 45);
    assert.equal(coldResult.score, 0); // 截断到 0
    assert.equal(heatLevelColorClass(coldResult.level), "lvct-heat--cold");

    // 7. unknown: 从未联系
    const neverResult = computeRelationshipHealth({
        cadenceDays: 30,
        lastInteractionTime: null,
        nowTime: baseNow,
    });
    assert.equal(neverResult.level, "unknown");
    assert.equal(neverResult.score, 0);
    assert.equal(neverResult.elapsedDays, null);
    assert.equal(neverResult.overdue, true);
    assert.equal(neverResult.overdueDays, 0);
    assert.equal(heatLevelColorClass(neverResult.level), "lvct-heat--muted");

    // 8. paused: 已暂停
    const pausedResult = computeRelationshipHealth({
        cadenceDays: 30,
        lastInteractionTime: baseNow - 100 * dayMs,
        nowTime: baseNow,
        paused: true,
    });
    assert.equal(pausedResult.level, "paused");
    assert.equal(pausedResult.score, 100);
    assert.equal(pausedResult.overdue, false);
    assert.equal(pausedResult.overdueDays, 0);
    assert.equal(heatLevelColorClass(pausedResult.level), "lvct-heat--muted");
});

test("computeRelationshipHealthDistribution: 全库关系温度分布统计与人员归集", () => {
    const baseNow = 1700000000000;
    const dayMs = 86400 * 1000;
    const people = [
        { docId: "20261019000001-1111111", itemId: "item-1" }, // hot (5天前)
        { docId: "20261019000002-2222222", itemId: "item-2" }, // warm (20天前)
        { docId: "20261019000003-3333333", itemId: "item-3" }, // cool (40天前)
        { docId: "20261019000004-4444444", itemId: "item-4" }, // cold (80天前)
        { docId: "20261019000005-5555555", itemId: "item-5" }, // unknown (无互动)
        { docId: "20261019000006-6666666", itemId: "item-6" }, // paused (已暂停)
    ];

    const recentInteractions = {
        "20261019000001-1111111": { occurredAt: baseNow - 5 * dayMs },
        "20261019000002-2222222": { occurredAt: baseNow - 20 * dayMs },
        "20261019000003-3333333": { occurredAt: baseNow - 40 * dayMs },
        "20261019000004-4444444": { occurredAt: baseNow - 80 * dayMs },
    };

    const cadences = {
        "20261019000006-6666666": { days: 30, paused: true },
    };

    const dist = computeRelationshipHealthDistribution(people, recentInteractions, cadences, 30, baseNow);

    assert.equal(dist.total, 6);
    assert.equal(dist.hot.count, 1);
    assert.deepEqual(dist.hot.itemIds, ["item-1"]);

    assert.equal(dist.warm.count, 1);
    assert.deepEqual(dist.warm.itemIds, ["item-2"]);

    assert.equal(dist.cool.count, 1);
    assert.deepEqual(dist.cool.itemIds, ["item-3"]);

    assert.equal(dist.cold.count, 1);
    assert.deepEqual(dist.cold.itemIds, ["item-4"]);

    assert.equal(dist.unknown.count, 1);
    assert.deepEqual(dist.unknown.itemIds, ["item-5"]);

    assert.equal(dist.paused.count, 1);
    assert.deepEqual(dist.paused.itemIds, ["item-6"]);
});
