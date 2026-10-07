import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_VIEW_PREFERENCES, normalizeTableColumns, normalizeViewPreferences } from "../src/domain/preferences.ts";
import type { ViewPreferences } from "../src/domain/preferences.ts";
import type { Plugin } from "siyuan";
import { applyPreferencePatch, decodeViewPreferences, diffViewPreferences, rebasePreferenceDraft } from "../src/domain/preferences-concurrency.ts";
import { createPreferenceRequests, loadViewPreferences, saveViewPreferences } from "../src/services/preferences.ts";
import { emitDataChanged, LVCT_DATA_CHANGED, subscribeDataChangedDebounced } from "../src/libs/data-events.ts";

test("视图偏好：空存储回退默认值", () => {
    assert.deepEqual(normalizeViewPreferences(null), DEFAULT_VIEW_PREFERENCES);
});

test("视图偏好：非法枚举回退，数值限制在 0-365", () => {
    const result = normalizeViewPreferences({
        defaultView: "unknown",
        peopleSort: "unknown",
        openOnStartup: "yes",
        birthdayWindowDays: 999,
        staleThresholdDays: -8,
    });
    assert.equal(result.defaultView, "home");
    assert.equal(result.peopleSort, "name");
    assert.equal(result.openOnStartup, false);
    assert.equal(result.aiEnabled, true);
    assert.equal(result.birthdayWindowDays, 365);
    assert.equal(result.staleThresholdDays, 0);
});

test("显示偏好：旧偏好缺字段回退默认形态与全列", () => {
    const result = normalizeViewPreferences({ peopleSort: "recent" });
    assert.equal(result.peopleView, DEFAULT_VIEW_PREFERENCES.peopleView);
    assert.deepEqual(result.tableColumns, DEFAULT_VIEW_PREFERENCES.tableColumns);
    assert.equal(result.peopleSort, "recent");
});

test("显示偏好：非法形态回退卡片，非法键与重复键剔除且保留用户顺序", () => {
    const result = normalizeViewPreferences({
        peopleView: "grid",
        tableColumns: ["phone", "phone", "name", "秘密列", "tags", "group", 42, null],
    });
    assert.equal(result.peopleView, "card");
    assert.deepEqual(result.tableColumns, ["phone", "tags", "group"]);
});

test("显示偏好：全部列无效或显式清空时回退全列默认", () => {
    assert.deepEqual(normalizeTableColumns(["name", "wechat", "wechat"]), ["wechat"]);
    assert.deepEqual(normalizeViewPreferences({ tableColumns: [] }), { ...DEFAULT_VIEW_PREFERENCES, tableColumns: DEFAULT_VIEW_PREFERENCES.tableColumns });
    assert.deepEqual(normalizeViewPreferences({ tableColumns: "phone" }).tableColumns, DEFAULT_VIEW_PREFERENCES.tableColumns);
});

test("显示偏好：合法自定义顺序原样保留", () => {
    const result = normalizeViewPreferences({ peopleView: "table", tableColumns: ["birthday", "phone"] });
    assert.equal(result.peopleView, "table");
    assert.deepEqual(result.tableColumns, ["birthday", "phone"]);
});

test("显示偏好：摘要开关与当日忽略标记归一化", () => {
    const result = normalizeViewPreferences({
        summaryEnabled: false,
        summaryDismissedOn: "2026-09-28",
    });
    assert.equal(result.summaryEnabled, false);
    assert.equal(result.summaryDismissedOn, "2026-09-28");
    // 旧偏好缺字段：默认开启、未忽略
    const legacy = normalizeViewPreferences({ peopleSort: "recent" });
    assert.equal(legacy.summaryEnabled, true);
    assert.equal(legacy.summaryDismissedOn, "");
    // 非法日期串归一化为空串
    assert.equal(normalizeViewPreferences({ summaryDismissedOn: "09/28" }).summaryDismissedOn, "");
});

test("显示偏好：图谱数据源模式归一化（B14.5，缺省关系图）", () => {
    assert.equal(normalizeViewPreferences({ graphMode: "native" }).graphMode, "native");
    assert.equal(normalizeViewPreferences({ graphMode: "relations" }).graphMode, "relations");
    // 旧偏好缺字段回退默认；非法值不采用
    assert.equal(normalizeViewPreferences({}).graphMode, DEFAULT_VIEW_PREFERENCES.graphMode);
    assert.equal(normalizeViewPreferences({ graphMode: "cytoscape" }).graphMode, DEFAULT_VIEW_PREFERENCES.graphMode);
});

test("显示偏好：引用图范围与中心人物持久化（B14.8，缺省本人中心）", () => {
    assert.equal(normalizeViewPreferences({ nativeScope: "global" }).nativeScope, "global");
    assert.equal(normalizeViewPreferences({ nativeScope: "person", nativeCenterDocId: "20260930000000-contact1" }).nativeCenterDocId, "20260930000000-contact1");
    // 旧偏好缺字段：范围回退 self、中心为空
    const legacy = normalizeViewPreferences({});
    assert.equal(legacy.nativeScope, DEFAULT_VIEW_PREFERENCES.nativeScope);
    assert.equal(legacy.nativeCenterDocId, "");
    // 非法范围不采用；中心非字符串丢弃
    assert.equal(normalizeViewPreferences({ nativeScope: "universe" }).nativeScope, DEFAULT_VIEW_PREFERENCES.nativeScope);
    assert.equal(normalizeViewPreferences({ nativeCenterDocId: 42 }).nativeCenterDocId, "");
});

function deferred<Value>() {
    let resolve!: (value: Value) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

function preferenceStore(initial: unknown = DEFAULT_VIEW_PREFERENCES) {
    let value: unknown = structuredClone(initial);
    let writes = 0;
    let readFailure = false;
    let failedReadbacks = 0;
    let failAfterSave = false;
    let saveGate: Promise<void> | undefined;
    const handle = () => ({
        async loadData() {
            if (readFailure || failedReadbacks > 0) {
                if (failedReadbacks > 0) failedReadbacks -= 1;
                throw new Error("fixture 读取失败");
            }
            return structuredClone(value);
        },
        async saveData(_key: string, next: unknown) {
            await saveGate;
            writes += 1;
            value = structuredClone(next);
            if (failAfterSave) failedReadbacks += 1;
        },
    } as unknown as Plugin);
    return {
        handle,
        value: () => structuredClone(value) as ViewPreferences,
        writes: () => writes,
        failReads: (fail: boolean) => { readFailure = fail; },
        failReadbacks: (fail: boolean) => { failAfterSave = fail; },
        pauseSave: (gate: Promise<void>) => { saveGate = gate; },
    };
}

test("P0-009：只有不存在的偏好取默认，坏结构、未知版本和非法 revision 拒绝读取", () => {
    assert.deepEqual(decodeViewPreferences(null), DEFAULT_VIEW_PREFERENCES);
    assert.deepEqual(decodeViewPreferences(""), DEFAULT_VIEW_PREFERENCES);
    assert.equal(decodeViewPreferences({ schemaVersion: 1, peopleSort: "recent" }).revision, 0);
    for (const raw of [[], false, "坏文件", 1, { schemaVersion: 2 }, { revision: -1 }, { revision: 0.5 }, { revision: "2" }]) {
        assert.throws(() => decodeViewPreferences(raw));
    }
    assert.throws(() => applyPreferencePatch({ ...DEFAULT_VIEW_PREFERENCES, revision: Number.MAX_SAFE_INTEGER }, { peopleSort: "recent" }), /上限/);
});

test("P0-009：两个实例用旧基线修改不同字段，锁内合并保留双方最新值", async () => {
    const store = preferenceStore();
    const first = store.handle();
    const second = store.handle();
    const [firstBase, secondBase] = await Promise.all([loadViewPreferences(first), loadViewPreferences(second)]);
    await Promise.all([
        saveViewPreferences(first, { ...firstBase, graphMode: "native" }, firstBase),
        saveViewPreferences(second, { ...secondBase, staleThresholdDays: 80 }, secondBase),
    ]);
    assert.equal(store.value().graphMode, "native");
    assert.equal(store.value().staleThresholdDays, 80);
    assert.equal(store.value().revision, 2);
    assert.equal(store.writes(), 2);
});

test("P0-009：挂起保存期间连续切换并回到原值，提交顺序稳定且读取等待最新保存", async () => {
    const store = preferenceStore();
    const plugin = store.handle();
    const base = await loadViewPreferences(plugin);
    const gate = deferred<void>();
    store.pauseSave(gate.promise);
    const firstIntent: ViewPreferences = { ...base, graphMode: "native" };
    const secondIntent: ViewPreferences = { ...firstIntent, staleThresholdDays: 77 };
    const finalIntent: ViewPreferences = { ...secondIntent, graphMode: "relations" };
    const saves = [
        saveViewPreferences(plugin, firstIntent, base),
        saveViewPreferences(plugin, secondIntent, firstIntent),
        saveViewPreferences(plugin, finalIntent, secondIntent),
    ];
    const reread = loadViewPreferences(plugin);
    gate.resolve();
    await Promise.all(saves);
    const latest = await reread;
    assert.equal(latest.graphMode, "relations");
    assert.equal(latest.staleThresholdDays, 77);
    assert.equal(latest.revision, 3);
});

test("P0-009：读取失败或损坏偏好不写入，失败队列恢复后可显式重试", async () => {
    for (const initial of [{ schemaVersion: 999 }, ["损坏"]]) {
        const store = preferenceStore(initial);
        await assert.rejects(saveViewPreferences(store.handle(), { ...DEFAULT_VIEW_PREFERENCES, aiEnabled: false }, DEFAULT_VIEW_PREFERENCES));
        assert.equal(store.writes(), 0);
    }
    const store = preferenceStore();
    const plugin = store.handle();
    const base = await loadViewPreferences(plugin);
    store.failReads(true);
    await assert.rejects(loadViewPreferences(plugin), /存储读取失败/);
    await assert.rejects(saveViewPreferences(plugin, { ...base, peopleView: "table" }, base), /存储读取失败/);
    assert.equal(store.writes(), 0);
    store.failReads(false);
    const saved = await saveViewPreferences(plugin, { ...base, peopleView: "table" }, base);
    assert.equal(saved.peopleView, "table");
});

test("P0-009：已写入但回读失败不报告成功，重新核实后同补丁重试零额外写入", async () => {
    const store = preferenceStore();
    const plugin = store.handle();
    const base = await loadViewPreferences(plugin);
    const next: ViewPreferences = { ...base, birthdayWindowDays: 55 };
    store.failReadbacks(true);
    await assert.rejects(saveViewPreferences(plugin, next, base), /存储读取失败/);
    assert.equal(store.value().birthdayWindowDays, 55);
    assert.equal(store.writes(), 1);
    store.failReadbacks(false);
    const reread = await loadViewPreferences(plugin);
    assert.equal(reread.revision, 1);
    const retried = await saveViewPreferences(plugin, next, base);
    assert.equal(retried.revision, 1);
    assert.equal(store.writes(), 1);
});

test("P0-009：提交快照不可被之后的编辑改写；刷新与旧提交响应都保留新草稿", async () => {
    const store = preferenceStore();
    const plugin = store.handle();
    const base = await loadViewPreferences(plugin);
    const draft = { ...base, staleThresholdDays: 60 };
    const saving = saveViewPreferences(plugin, draft, base);
    draft.staleThresholdDays = 90;
    assert.equal((await saving).staleThresholdDays, 60);
    const external: ViewPreferences = { ...base, revision: 2, graphMode: "native" };
    const rebased = rebasePreferenceDraft(external, draft, base);
    assert.equal(rebased.staleThresholdDays, 90);
    assert.equal(rebased.graphMode, "native");
    const response: ViewPreferences = { ...external, revision: 3, staleThresholdDays: 60 };
    const retained = rebasePreferenceDraft(response, rebased, { ...base, staleThresholdDays: 60 });
    assert.equal(retained.staleThresholdDays, 90);
    assert.equal(retained.graphMode, "native");
    assert.deepEqual(diffViewPreferences(response, retained), { staleThresholdDays: 90 });
});

test("P0-009：乱序读取与旧错误不能覆盖最新请求，失败保留已核实值", async () => {
    const first = deferred<ViewPreferences>();
    const second = deferred<ViewPreferences>();
    const oldError = deferred<ViewPreferences>();
    const latest = deferred<ViewPreferences>();
    const reads = [first, second, oldError, latest];
    const applied: ViewPreferences[] = [];
    const failures: unknown[] = [];
    const requests = createPreferenceRequests({
        load: () => reads.shift()!.promise,
        save: async (value) => value,
        apply: (value) => applied.push(value),
        fail: (error) => failures.push(error),
    });
    const firstLoad = requests.load();
    const secondLoad = requests.load();
    second.resolve({ ...DEFAULT_VIEW_PREFERENCES, revision: 2, peopleView: "table" });
    await secondLoad;
    first.resolve({ ...DEFAULT_VIEW_PREFERENCES, revision: 1 });
    await firstLoad;
    const obsolete = requests.load();
    const current = requests.load();
    oldError.reject(new Error("过期读取失败"));
    await assert.rejects(obsolete);
    latest.reject(new Error("当前读取失败"));
    await assert.rejects(current);
    assert.equal(applied.length, 1);
    assert.equal(applied[0].peopleView, "table");
    assert.equal(failures.length, 1);
    assert.match(String(failures[0]), /当前读取失败/);
});

test("P0-009：保存先后响应乱序、外部失效及卸载后回调均不得回填旧实例", async () => {
    const first = deferred<ViewPreferences>();
    const second = deferred<ViewPreferences>();
    const late = deferred<ViewPreferences>();
    const pending = [first, second, late];
    const applied: ViewPreferences[] = [];
    const published: ViewPreferences[] = [];
    const requests = createPreferenceRequests({
        load: () => late.promise,
        save: () => pending.shift()!.promise,
        apply: (value) => applied.push(value),
        saved: (value) => published.push(value),
    });
    const firstSave = requests.save({ ...DEFAULT_VIEW_PREFERENCES, graphMode: "native" }, DEFAULT_VIEW_PREFERENCES);
    const secondSave = requests.save({ ...DEFAULT_VIEW_PREFERENCES, graphMode: "relations" }, DEFAULT_VIEW_PREFERENCES);
    second.resolve({ ...DEFAULT_VIEW_PREFERENCES, revision: 2 });
    await secondSave;
    first.resolve({ ...DEFAULT_VIEW_PREFERENCES, revision: 1, graphMode: "native" });
    await firstSave;
    assert.equal(applied.length, 1);
    const lateRead = requests.load();
    requests.invalidate();
    requests.dispose();
    late.resolve({ ...DEFAULT_VIEW_PREFERENCES, revision: 3 });
    await lateRead;
    assert.equal(applied.length, 1);
    assert.equal(published.length, 2);
    await assert.rejects(requests.load(), /已关闭/);
});

test("P0-009：连续保存合并待提交意图，旧父层快照不会吞掉前一项改动", async () => {
    const first = deferred<ViewPreferences>();
    const second = deferred<ViewPreferences>();
    const submitted: Array<{ value: ViewPreferences; baseline: ViewPreferences }> = [];
    const pending = [first, second];
    const applied: ViewPreferences[] = [];
    const requests = createPreferenceRequests({
        load: async () => DEFAULT_VIEW_PREFERENCES,
        save: (value, baseline) => {
            submitted.push({ value, baseline });
            return pending.shift()!.promise;
        },
        apply: (value) => applied.push(value),
    });
    const table = { ...DEFAULT_VIEW_PREFERENCES, peopleView: "table" as const };
    const card = { ...DEFAULT_VIEW_PREFERENCES, peopleView: "card" as const, graphMode: "native" as const };
    const firstSave = requests.save(table, DEFAULT_VIEW_PREFERENCES);
    const secondSave = requests.save(card, table);
    assert.equal(submitted.length, 2);
    assert.equal(submitted[0].value.peopleView, "table");
    assert.equal(submitted[1].value.peopleView, "card");
    assert.equal(submitted[1].baseline.peopleView, "table");
    assert.equal(submitted[1].value.graphMode, "native");
    second.resolve({ ...card, revision: 2 });
    first.resolve({ ...table, revision: 1 });
    await Promise.all([firstSave, secondSave]);
    assert.deepEqual(applied.map((value) => value.revision), [2]);
    assert.equal(applied[0].peopleView, "card");
    assert.equal(applied[0].graphMode, "native");
});

test("P0-009：版本通知防抖、拒绝旧事件，销毁后定时器和订阅零副作用", (context) => {
    context.mock.timers.enable({ apis: ["setTimeout"] });
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
    const target = new EventTarget();
    Object.defineProperty(globalThis, "window", { configurable: true, value: target });
    let refreshes = 0;
    let invalidations = 0;
    let preferenceRevision = 0;
    try {
        const unsubscribe = subscribeDataChangedDebounced((change) => {
            refreshes += 1;
            preferenceRevision = change.preferencesRevision ?? 0;
        }, { delayMs: 400, invalidate: () => { invalidations += 1; } });
        emitDataChanged({ preferencesRevision: 1 });
        emitDataChanged({ preferencesRevision: 2 });
        target.dispatchEvent(new CustomEvent(LVCT_DATA_CHANGED, { detail: { revision: 0, preferencesRevision: 99 } }));
        context.mock.timers.tick(400);
        assert.equal(refreshes, 1);
        assert.equal(preferenceRevision, 2);
        assert.equal(invalidations, 2);
        emitDataChanged({ preferencesRevision: 3 });
        unsubscribe();
        context.mock.timers.tick(400);
        emitDataChanged({ preferencesRevision: 4 });
        context.mock.timers.tick(400);
        assert.equal(refreshes, 1);
        assert.equal(invalidations, 3);
    } finally {
        if (descriptor) Object.defineProperty(globalThis, "window", descriptor);
        else Reflect.deleteProperty(globalThis, "window");
    }
});
