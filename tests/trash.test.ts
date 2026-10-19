import assert from "node:assert/strict";
import test from "node:test";
import {
    addTrashEntry,
    createTrashEntry,
    daysUntilTrashExpiration,
    emptyTrashStore,
    normalizeTrashStore,
    normalizeTrashStoreForWrite,
    pruneExpiredTrash,
    removeTrashEntry,
    TRASH_RETENTION_DAYS,
    TRASH_STORE_VERSION,
} from "../src/domain/trash.ts";
import { StoreIntegrityError } from "../src/domain/store-integrity.ts";
import type { ContactSummary } from "../src/domain/person.ts";
import {
    clearTrashBin,
    dropTrashEntry,
    listTrashEntries,
    loadTrashStoreStrict,
    pushTrashEntry,
    TRASH_STORAGE_KEY,
} from "../src/data/trash.ts";
import type { Plugin } from "siyuan";

const personDocId = "20261019000000-doc0001";

function mockPerson(docId: string = personDocId, name: string = "张三"): ContactSummary {
    return {
        docId,
        itemId: `item-${docId}`,
        name,
        phone: "13800138000",
        email: "zhangsan@example.com",
        wechat: "wx-zhangsan",
        website: "https://example.com",
        birthday: "1990-05-20",
        isLunar: false,
        group: "朋友",
        tags: ["技术", "设计"],
        relatedItemIds: [],
    };
}

test("E-33 trash: createTrashEntry 完整保留元数据快照并设定 30 天过期", () => {
    const now = 1700000000000;
    const person = mockPerson();
    const entry = createTrashEntry(person, now);

    assert.equal(entry.docId, personDocId);
    assert.equal(entry.name, "张三");
    assert.equal(entry.snapshot.phone, "13800138000");
    assert.equal(entry.snapshot.group, "朋友");
    assert.deepEqual(entry.snapshot.tags, ["技术", "设计"]);
    assert.equal(entry.removedAt, now);
    assert.equal(entry.expiresAt, now + TRASH_RETENTION_DAYS * 86400 * 1000);
    assert.equal(daysUntilTrashExpiration(entry, now), 30);
    assert.equal(daysUntilTrashExpiration(entry, now + 10 * 86400 * 1000), 20);
    assert.equal(daysUntilTrashExpiration(entry, now + 35 * 86400 * 1000), 0);
});

test("E-33 trash: addTrashEntry 置顶、同人去重与自动清理过期记录", () => {
    const base = 1700000000000;
    const day = 86400 * 1000;
    let store = emptyTrashStore();

    // 添加第一条
    const e1 = createTrashEntry(mockPerson("20261019000000-doc0001", "甲"), base);
    store = addTrashEntry(store, e1, base);
    assert.equal(store.entries.length, 1);
    assert.equal(store.entries[0].name, "甲");

    // 添加第二条不同人
    const e2 = createTrashEntry(mockPerson("20261019000000-doc0002", "乙"), base + 1000);
    store = addTrashEntry(store, e2, base + 1000);
    assert.equal(store.entries.length, 2);
    assert.equal(store.entries[0].name, "乙", "最新删除的置顶在最前");

    // 再次删除甲（更新为新快照）
    const e1New = createTrashEntry(mockPerson("20261019000000-doc0001", "甲（改名）"), base + 2000);
    store = addTrashEntry(store, e1New, base + 2000);
    assert.equal(store.entries.length, 2, "同 docId 去重合并");
    assert.equal(store.entries[0].name, "甲（改名）", "甲的新快照置顶");

    // 移除乙
    store = removeTrashEntry(store, e2.id);
    assert.equal(store.entries.length, 1);
    assert.equal(store.entries[0].name, "甲（改名）");

    // 31 天后，自动过期清理
    const futureStore = pruneExpiredTrash(store, base + 31 * day);
    assert.equal(futureStore.entries.length, 0, "超过 30 天自动过期");
});

test("E-33 trash: 存储读写严格校验与容错归一化", () => {
    // 坏版本抛错
    assert.throws(() => normalizeTrashStoreForWrite({ schemaVersion: 99, entries: [] }), StoreIntegrityError);

    // 坏 docId 抛错
    assert.throws(() => normalizeTrashStoreForWrite({
        schemaVersion: 1,
        entries: [{ id: "t-1", docId: "bad-doc", itemId: "i-1", name: "张三", removedAt: 1, expiresAt: 2 }],
    }), StoreIntegrityError);

    // 容错读取对损坏数据返回空库
    assert.deepEqual(normalizeTrashStore(null), emptyTrashStore());
    assert.deepEqual(normalizeTrashStore("invalid"), emptyTrashStore());
    assert.deepEqual(normalizeTrashStore({ schemaVersion: 2, entries: [] }), emptyTrashStore());
});

test("E-33 trash 数据层：pushTrashEntry、listTrashEntries、dropTrashEntry 与 clearTrashBin 存储闭环", async () => {
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
    assert.deepEqual(await listTrashEntries(plugin), []);

    // 存入第一个联系人
    const personA = mockPerson("20261019000000-doc0001", "联系人甲");
    const list1 = await pushTrashEntry(plugin, personA);
    assert.equal(list1.length, 1);
    assert.equal(list1[0].name, "联系人甲");
    assert.equal(list1[0].snapshot.phone, "13800138000");

    // 存入第二个联系人
    const personB = mockPerson("20261019000000-doc0002", "联系人乙");
    const list2 = await pushTrashEntry(plugin, personB);
    assert.equal(list2.length, 2);
    assert.equal(list2[0].name, "联系人乙");

    // 列表查询
    const entries = await listTrashEntries(plugin);
    assert.equal(entries.length, 2);

    // 移除一条
    const remaining = await dropTrashEntry(plugin, list1[0].id);
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0].name, "联系人乙");

    // 清空回收站
    await clearTrashBin(plugin);
    assert.deepEqual(await listTrashEntries(plugin), []);

    // 验证严格读取遇到损坏数据抛错
    memory.set(TRASH_STORAGE_KEY, { schemaVersion: 999, entries: [] });
    await assert.rejects(() => loadTrashStoreStrict(plugin), StoreIntegrityError);
});
