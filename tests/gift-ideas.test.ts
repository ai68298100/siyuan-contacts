import assert from "node:assert/strict";
import test from "node:test";
import {
    addGiftIdeaToStore,
    convertGiftIdeaToExchange,
    emptyGiftIdeaStore,
    filterPendingGiftIdeas,
    filterPreferences,
    newGiftIdeaId,
    normalizeGiftIdeaStore,
    normalizeGiftIdeaStoreForWrite,
    removeGiftIdeaFromStore,
    updateGiftIdeaInStore,
    validateGiftIdea,
    MAX_GIFT_IDEAS_PER_PERSON,
    type GiftIdeaItem,
} from "../src/domain/gift-ideas.ts";
import { StoreIntegrityError } from "../src/domain/store-integrity.ts";
import {
    addPersonGiftIdea,
    loadGiftIdeaStoreStrict,
    loadPersonGiftIdeas,
    removePersonGiftIdea,
    updatePersonGiftIdea,
    GIFT_IDEAS_STORAGE_KEY,
} from "../src/data/gift-ideas.ts";
import type { Plugin } from "siyuan";

const personDocId = "20261019000000-doc0001";

function mockIdea(partial: Partial<GiftIdeaItem> = {}): GiftIdeaItem {
    return {
        id: "20261019000000-idea001",
        personDocId,
        type: "idea",
        status: "idea",
        title: "思源笔记定制手账本",
        priceEstimate: 120,
        note: "硬皮精装",
        targetOccasion: "生日",
        createdAt: 1700000000000,
        updatedAt: 1700000000000,
        ...partial,
    };
}

test("E-26 gift: validateGiftIdea 校验约束与防御", () => {
    const valid = mockIdea();
    assert.deepEqual(validateGiftIdea(valid), []);

    // 标题为空
    assert.ok(validateGiftIdea({ ...valid, title: "" }).some((e) => e.includes("不能为空")));
    assert.ok(validateGiftIdea({ ...valid, title: "字".repeat(121) }).some((e) => e.includes("不能超过 120")));

    // 人物文档 ID 非法
    assert.ok(validateGiftIdea({ ...valid, personDocId: "bad-id" }).some((e) => e.includes("文档 ID 无效")));

    // 金额为负
    assert.ok(validateGiftIdea({ ...valid, priceEstimate: -10 }).some((e) => e.includes("非负有效数值")));
});

test("E-26 gift: add/update/remove 与单人上限保护", () => {
    let store = emptyGiftIdeaStore();

    // 添加点子与偏好
    const idea1 = mockIdea({ id: "i1", title: "降噪耳机", type: "idea", status: "idea" });
    const pref1 = mockIdea({ id: "i2", title: "喜欢黑咖啡无糖", type: "preference", status: "idea" });

    store = addGiftIdeaToStore(store, idea1);
    store = addGiftIdeaToStore(store, pref1);
    assert.equal(store.ideas[personDocId].length, 2);

    // 过滤活跃点子 vs 偏好
    const pending = filterPendingGiftIdeas(store.ideas[personDocId]);
    assert.equal(pending.length, 1);
    assert.equal(pending[0].title, "降噪耳机");

    const prefs = filterPreferences(store.ideas[personDocId]);
    assert.equal(prefs.length, 1);
    assert.equal(prefs[0].title, "喜欢黑咖啡无糖");

    // 更新状态为已采购
    store = updateGiftIdeaInStore(store, personDocId, "i1", { status: "purchased", priceEstimate: 1299 }, 1700000010000);
    const updated = store.ideas[personDocId].find((i) => i.id === "i1")!;
    assert.equal(updated.status, "purchased");
    assert.equal(updated.priceEstimate, 1299);
    assert.equal(updated.updatedAt, 1700000010000);

    // 移除偏好
    store = removeGiftIdeaFromStore(store, personDocId, "i2");
    assert.equal(store.ideas[personDocId].length, 1);

    // 上限保护（30 条）
    let fullStore = emptyGiftIdeaStore();
    for (let i = 0; i < MAX_GIFT_IDEAS_PER_PERSON; i++) {
        fullStore = addGiftIdeaToStore(fullStore, mockIdea({ id: `item-${i}`, title: `礼物 ${i}` }));
    }
    assert.throws(
        () => addGiftIdeaToStore(fullStore, mockIdea({ id: "overflow", title: "溢出礼物" })),
        /最多保留 30 条/,
    );
});

test("E-26 gift: convertGiftIdeaToExchange 转换为正式往来账本记录", () => {
    const givenIdea = mockIdea({
        id: "i-given",
        title: "索尼降噪耳机 XM5",
        priceEstimate: 1999,
        targetOccasion: "生日",
        note: "银色国行",
        status: "given",
    });

    const exchange = convertGiftIdeaToExchange(givenIdea, "2026-10-19", 1700000020000);
    assert.equal(exchange.personDocId, personDocId);
    assert.equal(exchange.kind, "item");
    assert.equal(exchange.direction, "payable", "我方送礼为支出");
    assert.equal(exchange.description, "[赠礼 · 生日] 索尼降噪耳机 XM5");
    assert.equal(exchange.amount, 1999);
    assert.equal(exchange.status, "settled");
    assert.equal(exchange.settledOn, "2026-10-19");
    assert.equal(exchange.note, "银色国行");
    assert.match(exchange.id, /^\d{14}-[0-9a-z]{7}$/);
});

test("E-26 gift: 读写严格检查与容错归一化", () => {
    // 坏版本抛错
    assert.throws(() => normalizeGiftIdeaStoreForWrite({ schemaVersion: 99, ideas: {} }), StoreIntegrityError);

    // 坏 docId 抛错
    assert.throws(() => normalizeGiftIdeaStoreForWrite({
        schemaVersion: 1,
        ideas: { "bad-doc": [] },
    }), StoreIntegrityError);

    // 容错读取
    assert.deepEqual(normalizeGiftIdeaStore(null), emptyGiftIdeaStore());
    assert.deepEqual(normalizeGiftIdeaStore("invalid"), emptyGiftIdeaStore());
});

test("E-26 gift 数据层：addPersonGiftIdea、loadPersonGiftIdeas、update 与 remove 存储闭环", async () => {
    const memory = new Map<string, unknown>();
    const plugin = {
        async loadData(key: string) {
            return memory.has(key) ? structuredClone(memory.get(key)) : null;
        },
        async saveData(key: string, value: unknown) {
            memory.set(key, structuredClone(value));
        },
    } as unknown as Plugin;

    // 初始状态为空
    assert.deepEqual(await loadPersonGiftIdeas(plugin, personDocId), []);

    // 存入第一个礼物点子
    const idea1 = mockIdea({ id: "g1", title: "降噪耳机", type: "idea", priceEstimate: 1299 });
    const list1 = await addPersonGiftIdea(plugin, idea1);
    assert.equal(list1.length, 1);
    assert.equal(list1[0].title, "降噪耳机");

    // 存入一条偏好
    const pref1 = mockIdea({ id: "g2", title: "喜欢乌龙茶", type: "preference" });
    const list2 = await addPersonGiftIdea(plugin, pref1);
    assert.equal(list2.length, 2);

    // 回读验证
    const loaded = await loadPersonGiftIdeas(plugin, personDocId);
    assert.equal(loaded.length, 2);

    // 更新点子状态为已采购
    const updated = await updatePersonGiftIdea(plugin, personDocId, "g1", { status: "purchased" });
    const updatedItem = updated.find((i) => i.id === "g1")!;
    assert.equal(updatedItem.status, "purchased");

    // 移除点子
    const afterRemove = await removePersonGiftIdea(plugin, personDocId, "g1");
    assert.equal(afterRemove.length, 1);
    assert.equal(afterRemove[0].id, "g2");

    // 损坏数据严格拒绝
    memory.set(GIFT_IDEAS_STORAGE_KEY, { schemaVersion: 999, ideas: {} });
    await assert.rejects(() => loadGiftIdeaStoreStrict(plugin), StoreIntegrityError);
});
