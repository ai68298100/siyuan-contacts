import { test } from "node:test";
import assert from "node:assert/strict";
import {
    appendPersonAlias,
    emptyPersonAliasStore,
    normalizePersonAliasStore,
    normalizePersonAliasStoreForWrite,
    parsePersonAliasStore,
    removePersonAlias,
    resolvePersonAlias,
    resolvePersonIdentity,
    validatePersonAlias,
} from "../src/domain/person-aliases.ts";
import type { PersonAlias } from "../src/domain/person-aliases.ts";
import { mergeAliasBackup } from "../src/domain/migration-records.ts";
import { emptyDraft } from "../src/domain/person.ts";

const PERSON = "20261002000000-per0001";
const OTHER = "20261002000000-per0002";

test("姓名与别名联合核对：同人合并来源，撞他人姓名不自动选择别名优先", () => {
    const person = { ...emptyDraft(), name: "张三", docId: PERSON, itemId: "20261002000000-item001", relatedItemIds: [] };
    const peer = { ...person, name: "老张", docId: OTHER, itemId: "20261002000000-item002" };
    const store = { schemaVersion: 1 as const, aliases: [alias({ alias: " 老张 " })] };
    assert.deepEqual(resolvePersonIdentity(store, [person], "老张"), { status: "resolved", personDocId: PERSON, alias: "老张" });
    assert.deepEqual(resolvePersonIdentity(store, [person, peer], "老张"), { status: "ambiguous", personDocIds: [PERSON, OTHER], alias: "老张" });
    assert.equal(resolvePersonIdentity(store, [person, { ...peer, name: "张三" }], "张三").status, "ambiguous");
    assert.equal(resolvePersonIdentity(store, [person], "新人").status, "missing");
});

test("别名大小写与失效身份：孤儿或多重绑定不按缺失新人处理", () => {
    const person = { ...emptyDraft(), name: "张三", docId: PERSON, itemId: "20261002000000-item001", relatedItemIds: [] };
    const store = { schemaVersion: 1 as const, aliases: [alias({ alias: "Alice" })] };
    assert.equal(resolvePersonIdentity(store, [person], " ALICE ").status, "resolved");
    assert.equal(resolvePersonIdentity(store, [], "alice").status, "unavailable");
    assert.equal(resolvePersonIdentity(store, [person, { ...person, itemId: "20261002000000-item002" }], "Alice").status, "unavailable");
    assert.equal(validatePersonAlias("昵称\n另一称呼", PERSON).length > 0, true);
});

test("别名迁移：旧库兼容，删除墓碑阻止旧包复活，重复恢复保留并发新增", () => {
    const first = alias({ id: "20261002000000-alias01" });
    const backup = { schemaVersion: 1 as const, aliases: [first] };
    assert.deepEqual(parsePersonAliasStore(backup), backup);
    const removed = removePersonAlias(backup, first.id)!;
    assert.deepEqual(removed.tombstones, [first.id]);
    const concurrent = alias({ id: "20261002000000-alias02", alias: "张同学" });
    const current = { ...removed, aliases: [concurrent] };
    const result = mergeAliasBackup(current, backup, new Set([PERSON]));
    assert.deepEqual(result.store, current);
    assert.equal(result.summary.merged, 0);
    const deletion = mergeAliasBackup(backup, removed, new Set());
    assert.equal(deletion.summary.removed, 1);
    assert.deepEqual(deletion.store, removed);
    assert.equal(mergeAliasBackup(deletion.store, removed, new Set()).summary.removed, 0);
    assert.throws(() => parsePersonAliasStore({ ...backup, tombstones: ["bad"] }), /删除标记/);
    assert.throws(() => parsePersonAliasStore({ ...backup, tombstones: [first.id, first.id] }), /删除标记/);
});

test("别名迁移：规范化称呼跨人冲突、同 ID 换绑和孤儿均不写入", () => {
    const first = alias({ id: "20261002000000-alias01", alias: "Alice" });
    const current = { schemaVersion: 1 as const, aliases: [first] };
    const incoming = { schemaVersion: 1 as const, aliases: [
        { ...first, personDocId: OTHER },
        alias({ id: "20261002000000-alias02", alias: " alice ", personDocId: OTHER }),
        alias({ id: "20261002000000-alias03", alias: "张同学", personDocId: OTHER }),
    ] };
    const result = mergeAliasBackup(current, incoming, new Set([PERSON]));
    assert.deepEqual(result.store, current);
    assert.deepEqual(result.summary.issues.map((entry) => entry.reason), ["conflict", "conflict", "unreachable"]);
    assert.equal(result.summary.skipped, 3);
    assert.equal(result.summary.issues.some((entry) => entry.message.includes("Alice")), false);
});

function alias(partial: Partial<PersonAlias> & Pick<PersonAlias, "id">): PersonAlias {
    return { personDocId: PERSON, alias: "老张", createdAt: 1, updatedAt: 1, ...partial };
}

test("人物别名：拒绝王总等模糊职务称呼，保留可唯一识别的别名", () => {
    assert.match(validatePersonAlias("王总", PERSON).join(""), /姓氏加职务/);
    assert.match(validatePersonAlias("经理", PERSON).join(""), /泛称/);
    assert.deepEqual(validatePersonAlias("小王", PERSON), []);
    assert.match(validatePersonAlias("小王", "bad").join(""), /人物文档 ID/);
});

test("人物别名：同一别名只允许一个人物，冲突不覆盖旧归属", () => {
    const first = alias({ id: "20261002000000-alias01" });
    let store = appendPersonAlias(emptyPersonAliasStore(), first);
    assert.equal(store.status, "added");
    const same = appendPersonAlias(store.store, alias({ id: "20261002000000-alias02" }));
    assert.equal(same.status, "exists");
    const conflict = appendPersonAlias(store.store, alias({ id: "20261002000000-alias03", personDocId: OTHER }));
    assert.equal(conflict.status, "conflict");
    assert.equal(conflict.store.aliases[0].personDocId, PERSON);
});

test("人物别名：解析支持缺失、唯一命中和损坏数据中的歧义", () => {
    const first = alias({ id: "20261002000000-alias01" });
    const second = alias({ id: "20261002000000-alias02", personDocId: OTHER });
    const store = normalizePersonAliasStore({ schemaVersion: 1, aliases: [first, second] });
    assert.deepEqual(resolvePersonAlias(store, "不存在"), { status: "missing" });
    assert.deepEqual(resolvePersonAlias(store, " 老张 "), {
        status: "ambiguous",
        alias: "老张",
        personDocIds: [PERSON, OTHER],
    });
    assert.throws(() => normalizePersonAliasStoreForWrite({ schemaVersion: 1, aliases: [{ id: "bad" }] }), /内容损坏/);
    const removed = removePersonAlias(store, first.id);
    assert.ok(removed);
    assert.deepEqual(resolvePersonAlias(removed, "老张"), { status: "resolved", personDocId: OTHER, alias: "老张" });
});

test("人物别名严格读取：坏数据不变为空库，重复 ID 拒绝，跨人同名保持歧义", () => {
    for (const missing of [null, undefined, ""]) assert.deepEqual(parsePersonAliasStore(missing), emptyPersonAliasStore());
    const first = alias({ id: "20261002000000-alias01" });
    for (const raw of [[], "{}", { schemaVersion: 2, aliases: [] }, { schemaVersion: 1, aliases: {} }]) {
        assert.throws(() => parsePersonAliasStore(raw), /存储内容损坏/);
    }
    for (const bad of [null, { ...first, alias: "王总" }, { ...first, alias: "称".repeat(81) }, first]) {
        const raw = { schemaVersion: 1, aliases: [first, bad] };
        const snapshot = JSON.stringify(raw);
        assert.throws(() => parsePersonAliasStore(raw), (error: Error & { originalCount?: number; entryIndex?: number }) => {
            assert.equal(error.originalCount, 2);
            assert.equal(error.entryIndex, 1);
            assert.equal(error.message.includes("老张"), false);
            return true;
        });
        assert.equal(JSON.stringify(raw), snapshot);
    }
    const other = alias({ id: "20261002000000-alias02", personDocId: OTHER });
    assert.equal(resolvePersonAlias(parsePersonAliasStore({ schemaVersion: 1, aliases: [first, other] }), "老张").status, "ambiguous");
});
