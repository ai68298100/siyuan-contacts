import assert from "node:assert/strict";
import test from "node:test";
import { loadPersonCadence } from "../src/data/cadences.ts";
import { normalizeCadenceMap, normalizeCadenceMapForWrite } from "../src/domain/cadence.ts";
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
