import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import type { Plugin } from "siyuan";

// src/data/interactions.ts 使用无扩展名相对导入（vite 构建正常）；node --test 直跑需 resolve 钩子补 .ts。
const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
        if (specifier === "siyuan") return { shortCircuit: true, url: "data:text/javascript," + encodeURIComponent("export default {};export function fetchPost(){}export function fetchSyncPost(){}") };
        if (specifier.startsWith(".") && context.parentURL?.startsWith("file:")) {
            const candidate = new URL(specifier + ".ts", context.parentURL);
            if (existsSync(fileURLToPath(candidate))) return nextResolve(candidate.href, context);
        }
        return nextResolve(specifier, context);
    },
    load(url, context, nextLoad) {
        if (url.startsWith("file:") && url.endsWith(".ts")) return { shortCircuit: true, format: "module", source:
            ts.transpileModule(readFileSync(fileURLToPath(url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext } }).outputText };
        return nextLoad(url, context);
    },
});
process.on("exit", () => hooks.deregister());

const {
    addOccasionToStore,
    deriveOccasionInteractionEvents,
    emptyOccasionStore,
    newOccasionId,
    normalizeOccasionStore,
    normalizeOccasionStoreForWrite,
    removeOccasionFromStore,
    updateOccasionInStore,
    validateOccasion,
    MAX_OCCASIONS,
} = await import("../src/domain/occasion-cluster.ts");
type OccasionEntity = import("../src/domain/occasion-cluster.ts").OccasionEntity;
const { StoreIntegrityError } = await import("../src/domain/store-integrity.ts");
const {
    listOccasionEntities,
    loadOccasionStoreStrict,
    removeOccasionEntity,
    saveOccasionEntity,
    updateOccasionEntity,
    OCCASIONS_STORAGE_KEY,
} = await import("../src/data/occasions.ts");
const { createOccasion, deleteOccasion, listOccasions } = await import("../src/services/occasions.ts");

const doc1 = "20261019000000-doc0001";
const doc2 = "20261019000000-doc0002";
const doc3 = "20261019000000-doc0003";

test("E-30 occasion: validateOccasion 严格校验约束", () => {
    // 1. 基础有效场合
    const valid: OccasionEntity = {
        id: "20261019000000-occ0001",
        title: "2026 年终技术研讨会",
        type: "meeting",
        date: "2026-10-19",
        place: "会议室 A",
        attendees: [
            { personDocId: doc1, name: "张三", role: "host" },
            { personDocId: doc2, name: "李四", role: "guest" },
        ],
        createdAt: 1700000000000,
        updatedAt: 1700000000000,
    };
    assert.deepEqual(validateOccasion(valid), []);

    // 2. 标题为空或超长
    assert.ok(validateOccasion({ ...valid, title: "" }).some((e) => e.includes("标题不能为空")));
    assert.ok(validateOccasion({ ...valid, title: "字".repeat(121) }).some((e) => e.includes("不能超过 120")));

    // 3. 非法日期
    assert.ok(validateOccasion({ ...valid, date: "2026-02-30" }).some((e) => e.includes("有效")));
    assert.ok(validateOccasion({ ...valid, date: "bad-date" }).some((e) => e.includes("有效")));

    // 4. 结束日期倒挂
    assert.ok(validateOccasion({ ...valid, date: "2026-10-19", endDate: "2026-10-18" }).some((e) => e.includes("不能早于发生日期")));

    // 5. 地点含斜杠或换行
    assert.ok(validateOccasion({ ...valid, place: "北京/上海" }).some((e) => e.includes("不能包含换行、控制字符或斜杠")));

    // 6. 参与人为空或重复
    assert.ok(validateOccasion({ ...valid, attendees: [] }).some((e) => e.includes("至少需要选择 1 位")));
    assert.ok(validateOccasion({
        ...valid,
        attendees: [
            { personDocId: doc1, name: "张三" },
            { personDocId: doc1, name: "张三" },
        ],
    }).some((e) => e.includes("存在重复参与人")));

    // 7. 参与人文档 ID 非法
    assert.ok(validateOccasion({
        ...valid,
        attendees: [{ personDocId: "bad-doc", name: "张三" }],
    }).some((e) => e.includes("文档 ID 无效")));
});

test("E-30 occasion: deriveOccasionInteractionEvents 投影为各参与者互动事件", () => {
    const occasion: OccasionEntity = {
        id: "20261019000000-occ0001",
        title: "新季度技术研讨与午餐交流",
        type: "meal",
        date: "2026-10-19",
        place: "西贝餐厅",
        attendees: [
            { personDocId: doc1, name: "张三" },
            { personDocId: doc2, name: "李四" },
            { personDocId: doc3, name: "王五" },
        ],
        note: "讨论了下一阶段的重构计划",
        createdAt: 1700000000000,
        updatedAt: 1700000000000,
    };

    const events = deriveOccasionInteractionEvents(occasion);
    assert.equal(events.length, 3, "每位参与者应生成一条互动事件");

    // 共用外部引用与来源
    for (const event of events) {
        assert.equal(event.externalRef, occasion.id, "必须共享同一个 externalRef 标识");
        assert.equal(event.source, "diary", "统一使用 diary 来源以便多参与者聚类");
        assert.equal(event.localDate, "2026-10-19");
        assert.ok(event.note?.includes("[聚餐] 新季度技术研讨与午餐交流 @ 西贝餐厅"));
        assert.ok(event.note?.includes("讨论了下一阶段的重构计划"));
    }

    // 张三的事件中同行者包含李四、王五，但不包含自己
    const eventDoc1 = events.find((e) => e.personDocId === doc1);
    assert.ok(eventDoc1?.note?.includes("（同行: 李四、王五）"));
    assert.ok(!eventDoc1?.note?.includes("（同行: 张三"));

    // 李四的事件中同行者包含张三、王五
    const eventDoc2 = events.find((e) => e.personDocId === doc2);
    assert.ok(eventDoc2?.note?.includes("（同行: 张三、王五）"));

    // 王五的事件中同行者包含张三、李四
    const eventDoc3 = events.find((e) => e.personDocId === doc3);
    assert.ok(eventDoc3?.note?.includes("（同行: 张三、李四）"));
});

test("E-30 occasion: newOccasionId 格式符合合法 ID", () => {
    const id = newOccasionId();
    assert.match(id, /^\d{14}-[0-9a-z]{7}$/);
});

function mockOccasion(partial: Partial<OccasionEntity> = {}): OccasionEntity {
    return {
        id: "20261019000000-occ0001",
        title: "季度技术研讨",
        type: "meeting",
        date: "2026-10-19",
        attendees: [{ personDocId: doc1, name: "张三" }],
        createdAt: 1700000000000,
        updatedAt: 1700000000000,
        ...partial,
    };
}

test("E-30 occasion store: add/update/remove 与全库上限保护", () => {
    let store = emptyOccasionStore();

    // 新增两条
    store = addOccasionToStore(store, mockOccasion({ id: "o1", title: "会议 A" }));
    store = addOccasionToStore(store, mockOccasion({ id: "o2", title: "聚餐 B", type: "meal" }));
    assert.equal(store.occasions.length, 2);
    assert.equal(store.occasions[0].id, "o2", "新增置顶");
    assert.equal(store.occasions[0].type, "meal", "类型应保留");

    // 更新
    store = updateOccasionInStore(store, "o1", { title: "会议 A（改名）", place: "会议室 3" }, 1700000010000);
    const updated = store.occasions.find((item) => item.id === "o1")!;
    assert.equal(updated.title, "会议 A（改名）");
    assert.equal(updated.place, "会议室 3");
    assert.equal(updated.updatedAt, 1700000010000);

    // 更新非法数据抛错
    assert.throws(() => updateOccasionInStore(store, "o1", { title: "" }), /标题不能为空/);

    // 移除
    store = removeOccasionFromStore(store, "o1");
    assert.equal(store.occasions.length, 1);
    assert.equal(store.occasions[0].id, "o2");

    // 全库上限保护
    let fullStore = emptyOccasionStore();
    for (let i = 0; i < MAX_OCCASIONS; i++) {
        fullStore = addOccasionToStore(fullStore, mockOccasion({ id: `occ-${i}`, title: `场合 ${i}` }));
    }
    assert.throws(
        () => addOccasionToStore(fullStore, mockOccasion({ id: "overflow", title: "溢出场合" })),
        /最多保留 500 条/,
    );
});

test("E-30 occasion store: 严格读写检查与容错归一化", () => {
    assert.throws(() => normalizeOccasionStoreForWrite({ schemaVersion: 99, occasions: [] }), StoreIntegrityError);

    assert.throws(() => normalizeOccasionStoreForWrite({
        schemaVersion: 1,
        occasions: [{ id: "o1", title: "", type: "meeting", date: "2026-10-19", attendees: [{ personDocId: doc1, name: "张三" }] }],
    }), StoreIntegrityError);

    assert.deepEqual(normalizeOccasionStore(null), emptyOccasionStore());
    assert.deepEqual(normalizeOccasionStore({ schemaVersion: 2, occasions: [] }), emptyOccasionStore());
    // 坏条目被容错过滤
    const normalized = normalizeOccasionStore({
        schemaVersion: 1,
        occasions: [
            { id: "good", title: "有效", type: "meeting", date: "2026-10-19", attendees: [{ personDocId: doc1, name: "张三" }], createdAt: 1, updatedAt: 1 },
            { id: "bad", title: "", type: "meeting", date: "2026-10-19", attendees: [] },
        ],
    });
    assert.equal(normalized.occasions.length, 1);
    assert.equal(normalized.occasions[0].id, "good");
});

test("E-30 occasion 数据层：saveOccasionEntity、listOccasionEntities、update 与 remove 存储闭环", async () => {
    const memory = new Map<string, unknown>();
    const plugin = {
        async loadData(key: string) {
            return memory.has(key) ? structuredClone(memory.get(key)) : null;
        },
        async saveData(key: string, value: unknown) {
            memory.set(key, structuredClone(value));
        },
    } as unknown as Plugin;
    assert.deepEqual(await listOccasionEntities(plugin), []);

    await saveOccasionEntity(plugin, mockOccasion({ id: "o1", title: "会议 A", date: "2026-10-18" }));
    await saveOccasionEntity(plugin, mockOccasion({ id: "o2", title: "聚餐 B", type: "meal", date: "2026-10-20" }));

    const listed = await listOccasionEntities(plugin);
    assert.equal(listed.length, 2);
    assert.equal(listed[0].id, "o2", "按日期倒序排列");

    const afterUpdate = await updateOccasionEntity(plugin, "o1", { place: "线上会议" });
    assert.equal(afterUpdate.find((item) => item.id === "o1")!.place, "线上会议");

    const afterRemove = await removeOccasionEntity(plugin, "o2");
    assert.equal(afterRemove.length, 1);

    memory.set(OCCASIONS_STORAGE_KEY, { schemaVersion: 999, occasions: [] });
    await assert.rejects(() => loadOccasionStoreStrict(plugin), StoreIntegrityError);
});

test("E-30 occasion 服务层：createOccasion 自动派生互动事件，deleteOccasion 清理", async () => {
    const memory = new Map<string, unknown>();
    const plugin = {
        async loadData(key: string) {
            return memory.has(key) ? structuredClone(memory.get(key)) : null;
        },
        async saveData(key: string, value: unknown) {
            memory.set(key, structuredClone(value));
        },
    } as unknown as Plugin;

    const occasion = await createOccasion(plugin, {
        title: "团队季度聚餐",
        type: "meal",
        date: "2026-10-19",
        place: "西贝餐厅",
        attendees: [
            { personDocId: doc1, name: "张三" },
            { personDocId: doc2, name: "李四" },
        ],
    });
    assert.match(occasion.id, /^\d{14}-[0-9a-z]{7}$/);
    assert.equal(occasion.attendees.length, 2);

    // 场合落盘
    const listed = await listOccasions(plugin);
    assert.equal(listed.length, 1);
    assert.equal(listed[0].title, "团队季度聚餐");

    // 互动事件已派生：每位参与者一条
    const interactionStore = memory.get("interaction-events.json") as { events: Array<{ personDocId: string; externalRef?: string }> } | undefined;
    assert.ok(interactionStore, "互动事件库应已写入");
    assert.equal(interactionStore.events.length, 2);
    assert.equal(interactionStore.events[0].externalRef, occasion.id, "互动事件应共享场合 ID 作为外部引用");

    // 删除场合（互动事件保留）→ 幂等删除
    const afterDelete = await deleteOccasion(plugin, occasion.id);
    assert.equal(afterDelete, undefined);
    assert.equal((await listOccasions(plugin)).length, 0);

    // 不派生互动事件的场合
    const silentOccasion = await createOccasion(plugin, {
        title: "静默活动",
        type: "other",
        date: "2026-10-19",
        attendees: [{ personDocId: doc3, name: "王五" }],
        deriveInteractions: false,
    });
    const storeAfterSilent = memory.get("interaction-events.json") as { events: unknown[] };
    assert.equal(storeAfterSilent.events.length, 2, "静默活动不新增互动事件");
    assert.ok(silentOccasion.id);

    // 非法输入拒绝
    await assert.rejects(
        () => createOccasion(plugin, { title: "", type: "meeting", date: "2026-10-19", attendees: [] }),
        /创建群体活动失败/,
    );
});
