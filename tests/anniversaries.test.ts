import assert from "node:assert/strict";
import test from "node:test";
import {
    addAnniversaryToStore,
    emptyAnniversaryStore,
    newAnniversaryId,
    nextAnniversary,
    normalizeAnniversaryStore,
    normalizeAnniversaryStoreForWrite,
    removeAnniversaryFromStore,
    upcomingAnniversaries,
    updateAnniversaryInStore,
    validateAnniversary,
    MAX_ANNIVERSARIES_PER_PERSON,
    type AnniversaryItem,
} from "../src/domain/anniversaries.ts";
import { StoreIntegrityError } from "../src/domain/store-integrity.ts";
import {
    addPersonAnniversary,
    listUpcomingAnniversaries,
    loadAnniversaryStoreStrict,
    loadPersonAnniversaries,
    removePersonAnniversary,
    updatePersonAnniversary,
    ANNIVERSARIES_STORAGE_KEY,
} from "../src/data/anniversaries.ts";
import type { Plugin } from "siyuan";

const personDocId = "20261019000000-doc0001";

function mockAnniv(partial: Partial<AnniversaryItem> = {}): AnniversaryItem {
    return {
        id: "20261020000000-anniv01",
        personDocId,
        title: "结婚五周年",
        category: "wedding",
        date: "2021-10-25",
        isLunar: false,
        remindDaysBefore: 7,
        note: "预定餐厅庆祝",
        createdAt: 1700000000000,
        updatedAt: 1700000000000,
        ...partial,
    };
}

test("E-36 anniversary: validateAnniversary 校验与防御", () => {
    const valid = mockAnniv();
    assert.deepEqual(validateAnniversary(valid), []);

    // 标题为空或超长
    assert.ok(validateAnniversary({ ...valid, title: "" }).some((e) => e.includes("不能为空")));
    assert.ok(validateAnniversary({ ...valid, title: "长".repeat(81) }).some((e) => e.includes("不能超过 80")));

    // 人物文档 ID 非法
    assert.ok(validateAnniversary({ ...valid, personDocId: "bad-id" }).some((e) => e.includes("文档 ID 无效")));

    // 日期格式非法
    assert.ok(validateAnniversary({ ...valid, date: "2021-13-45" }).some((e) => e.includes("有效")));

    // 提醒天数超出范围
    assert.ok(validateAnniversary({ ...valid, remindDaysBefore: 35 }).some((e) => e.includes("0 到 30 天")));
});

test("E-36 anniversary: nextAnniversary 公历周年换算、届数与平闰年顺延", () => {
    // 假设当前时间为 2026-10-20
    const now = new Date(2026, 9, 20); // 10月20日

    // 1. 同年未来日期：2021-10-25 结婚，2026 年是第 5 周年，还有 5 天
    const item = mockAnniv({ date: "2021-10-25", isLunar: false });
    const proj = nextAnniversary(item, now);
    assert.ok(proj);
    assert.equal(proj.daysUntil, 5);
    assert.equal(proj.yearsCount, 5);
    assert.equal(proj.displayDate, "10月25日");
    assert.equal(proj.nextDate.getFullYear(), 2026);

    // 2. 今年已过日期：2020-05-20，跨入下一年 (2027年，第 7 周年)
    const passed = mockAnniv({ date: "2020-05-20", isLunar: false });
    const passedProj = nextAnniversary(passed, now);
    assert.ok(passedProj);
    assert.equal(passedProj.nextDate.getFullYear(), 2027);
    assert.equal(passedProj.yearsCount, 7);

    // 3. 公历 2月29日闰日纪念：平年顺延至 3月1日
    const leapItem = mockAnniv({ date: "2024-02-29", isLunar: false });
    const leapProj = nextAnniversary(leapItem, new Date(2027, 0, 1));
    assert.ok(leapProj);
    assert.equal(leapProj.nextDate.getFullYear(), 2027);
    assert.equal(leapProj.nextDate.getMonth(), 2);
    assert.equal(leapProj.nextDate.getDate(), 1);
});

test("E-36 anniversary: nextAnniversary 农历纪念日循环换算", () => {
    // 假设当前时间为 2026-01-01
    const now = new Date(2026, 0, 1);
    // 农历正月初一相识纪念日
    const lunarItem = mockAnniv({
        date: "2020-01-01",
        isLunar: true,
        title: "农历新年相聚",
        category: "acquaintance",
    });
    const proj = nextAnniversary(lunarItem, now);
    assert.ok(proj);
    assert.match(proj.displayDate, /正月初一/);
    assert.ok(proj.daysUntil >= 0);
    assert.ok(proj.yearsCount && proj.yearsCount >= 6);
});

test("E-36 anniversary: upcomingAnniversaries 窗口过滤与按到期升序", () => {
    const now = new Date(2026, 9, 20); // 10月20日
    const items = [
        mockAnniv({ id: "a1", date: "2021-10-22", remindDaysBefore: 7 }), // 还有 2 天 (在窗口内)
        mockAnniv({ id: "a2", date: "2021-10-28", remindDaysBefore: 10 }), // 还有 8 天 (在窗口内)
        mockAnniv({ id: "a3", date: "2021-11-30", remindDaysBefore: 7 }), // 还有 41 天 (超出 7 天提醒窗口)
    ];

    const upcoming = upcomingAnniversaries(items, 30, now);
    assert.equal(upcoming.length, 2);
    assert.equal(upcoming[0].item.id, "a1");
    assert.equal(upcoming[0].daysUntil, 2);
    assert.equal(upcoming[1].item.id, "a2");
    assert.equal(upcoming[1].daysUntil, 8);
});

test("E-36 anniversary: add/update/remove 与单人 20 条上限保护", () => {
    let store = emptyAnniversaryStore();

    // 添加纪念日
    const a1 = mockAnniv({ id: "a1", title: "相识纪念日" });
    const a2 = mockAnniv({ id: "a2", title: "入职五周年", category: "work" });
    store = addAnniversaryToStore(store, a1);
    store = addAnniversaryToStore(store, a2);
    assert.equal(store.anniversaries[personDocId].length, 2);

    // 更新
    store = updateAnniversaryInStore(store, personDocId, "a1", { title: "相识六周年", note: "一起去旅行" });
    assert.equal(store.anniversaries[personDocId].find((item) => item.id === "a1")?.title, "相识六周年");

    // 移除
    store = removeAnniversaryFromStore(store, personDocId, "a2");
    assert.equal(store.anniversaries[personDocId].length, 1);
    assert.equal(store.anniversaries[personDocId][0].id, "a1");

    // 单人上限 20 条保护
    for (let i = 1; i < MAX_ANNIVERSARIES_PER_PERSON; i++) {
        store = addAnniversaryToStore(store, mockAnniv({ id: `fill-${i}`, title: `纪念日 ${i}` }));
    }
    assert.equal(store.anniversaries[personDocId].length, MAX_ANNIVERSARIES_PER_PERSON);
    assert.throws(() => addAnniversaryToStore(store, mockAnniv({ id: "overflow", title: "超额" })), /最多保留 20 条/);
});

test("E-36 anniversary: 严格读写检查与容错归一化", () => {
    // 损坏数据严格拒绝
    assert.throws(() => normalizeAnniversaryStoreForWrite({ schemaVersion: 99, anniversaries: {} }), StoreIntegrityError);
    assert.throws(() => normalizeAnniversaryStoreForWrite({
        schemaVersion: 1,
        anniversaries: { [personDocId]: [{ id: "bad", title: "", date: "bad" }] },
    }), StoreIntegrityError);

    // 容错读取对脏数据降级为空库
    assert.deepEqual(normalizeAnniversaryStore(null), emptyAnniversaryStore());
    assert.deepEqual(normalizeAnniversaryStore("garbage"), emptyAnniversaryStore());
    assert.deepEqual(normalizeAnniversaryStore({ schemaVersion: 2, anniversaries: {} }), emptyAnniversaryStore());
});

test("E-36 anniversary 数据层：addPersonAnniversary、loadPersonAnniversaries、update、remove 与 listUpcoming 存储闭环", async () => {
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
    assert.deepEqual(await loadPersonAnniversaries(plugin, personDocId), []);

    // 添加第一条纪念日
    const a1 = mockAnniv({ id: "20261020000000-a001", title: "结婚十周年", date: "2016-10-25" });
    const list1 = await addPersonAnniversary(plugin, a1);
    assert.equal(list1.length, 1);
    assert.equal(list1[0].title, "结婚十周年");

    // 添加第二条纪念日
    const a2 = mockAnniv({ id: "20261020000000-a002", title: "合作启动纪念", category: "work", date: "2023-11-01" });
    const list2 = await addPersonAnniversary(plugin, a2);
    assert.equal(list2.length, 2);

    // 回读验证
    const loaded = await loadPersonAnniversaries(plugin, personDocId);
    assert.equal(loaded.length, 2);

    // 更新
    const afterUpdate = await updatePersonAnniversary(plugin, personDocId, a1.id, { note: "准备送项链" });
    assert.equal(afterUpdate.find((item) => item.id === a1.id)?.note, "准备送项链");

    // 列出即将到来的纪念日
    const now = new Date(2026, 9, 20); // 10月20日
    const upcoming = await listUpcomingAnniversaries(plugin, 30, now);
    assert.ok(upcoming.length >= 1);
    assert.equal(upcoming[0].item.title, "结婚十周年");

    // 移除一条
    const afterRemove = await removePersonAnniversary(plugin, personDocId, a2.id);
    assert.equal(afterRemove.length, 1);
    assert.equal(afterRemove[0].id, a1.id);

    // 损坏数据严格抛错
    memory.set(ANNIVERSARIES_STORAGE_KEY, { schemaVersion: 999, anniversaries: {} });
    await assert.rejects(() => loadAnniversaryStoreStrict(plugin), StoreIntegrityError);
});
