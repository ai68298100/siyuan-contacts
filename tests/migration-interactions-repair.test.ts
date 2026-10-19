import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import type { Plugin } from "siyuan";
import type { InteractionEvent } from "../src/domain/interactions.ts";

const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
        if (specifier === "siyuan") return { shortCircuit: true, url: "data:text/javascript," + encodeURIComponent(
            "export function fetchPost(){throw new Error('迁移互动测试不应访问内核');}"), };
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
test.after(() => hooks.deregister());

const { previewMigrationImport, importMigrationBundle } = await import("../src/services/migration-bundle.ts");
const INTERACTIONS = "interaction-events.json";
const TEMPLATES = "interaction-templates.json";
const templateModule = { schemaVersion: 1, templates: [{ id: "migration-repair-template", name: "测试", content: "隔离模板" }] };

function event(id: string): InteractionEvent {
    return { id, personDocId: "20261018000000-person1", occurredAt: 1792252800000, localDate: "2026-10-18", source: "manual" };
}
function store(events: InteractionEvent[] = [], tombstones: string[] = []) {
    return { schemaVersion: 1, events, tombstones };
}
function bundle(interactions: unknown, extra: Record<string, unknown> = {}) {
    return JSON.stringify({ schemaVersion: 1, storageKey: "lvct-migration-bundle", modules: { interactions, ...extra } });
}
function memory(current: unknown = null) {
    const files = new Map<string, unknown>([[INTERACTIONS, current]]);
    const state = { files, writes: [] as string[], failReads: new Set<string>(), failReadback: new Set<string>() };
    const plugin = {
        async loadData(key: string) {
            if (state.failReads.has(key) || state.failReadback.has(key) && state.writes.includes(key)) throw new Error("隔离读取失败");
            return structuredClone(files.get(key) ?? null);
        },
        async saveData(key: string, value: unknown) {
            state.writes.push(key);
            files.set(key, structuredClone(value));
        },
    } as unknown as Plugin;
    return { ...state, plugin };
}

test("互动迁移：纯墓碑必须出现在零写入预览，确认返回实际删除和新增标记", async () => {
    const state = memory(store([event("remove"), event("keep")]));
    const text = bundle(store([], ["remove", "not-present"]));
    assert.deepEqual(previewMigrationImport(text), [{ key: "interactions", label: "互动事件", count: 0, tombstones: 2 }]);
    assert.equal(state.writes.length, 0);
    assert.equal((state.files.get(INTERACTIONS) as ReturnType<typeof store>).events.length, 2);
    const result = await importMigrationBundle(state.plugin, text);
    assert.deepEqual(result.modules, [{ key: "interactions", label: "互动事件", merged: 0, skipped: 0, removed: 1, tombstonesAdded: 2 }]);
    assert.deepEqual(result.failed, []);
    assert.deepEqual(state.files.get(INTERACTIONS), store([event("keep")], ["remove", "not-present"]));
});

test("互动迁移：重复纯删除不再计移除、不重复写，旧事件不可复活", async () => {
    const state = memory(store([event("remove")]));
    const text = bundle(store([], ["remove"]));
    await importMigrationBundle(state.plugin, text);
    const writes = state.writes.length;
    const again = await importMigrationBundle(state.plugin, text);
    assert.equal(again.modules[0].removed, 0);
    assert.equal(again.modules[0].tombstonesAdded, 0);
    assert.equal(state.writes.length, writes);
    const oldBackup = await importMigrationBundle(state.plugin, bundle(store([event("remove")])));
    assert.equal(oldBackup.modules[0].merged, 0);
    assert.equal(oldBackup.modules[0].skipped, 1);
    assert.equal(oldBackup.skipped.interactions, 1);
    assert.equal(state.writes.length, writes);
});

test("互动迁移：混合包在预览列明互动删除，执行结果与其他模块分别报告", async () => {
    const state = memory(store([event("remove")]));
    const text = bundle(store([], ["remove"]), { templates: templateModule });
    assert.deepEqual(previewMigrationImport(text).map(({ key, count, tombstones }) => ({ key, count, tombstones })), [
        { key: "interactions", count: 0, tombstones: 1 }, { key: "templates", count: 1, tombstones: undefined },
    ]);
    const result = await importMigrationBundle(state.plugin, text);
    assert.equal(result.modules.find((module) => module.key === "interactions")?.removed, 1);
    assert.equal(result.modules.find((module) => module.key === "templates")?.merged, 1);
    assert.equal(state.writes.filter((key) => key === INTERACTIONS).length, 1);
    assert.equal(state.writes.filter((key) => key === TEMPLATES).length, 1);
});

test("互动迁移：rawStore 墓碑优先于伪造顶层空投影，预览和执行同一来源", async () => {
    const state = memory(store([event("remove")]));
    const text = bundle({ ...store([event("projection-only")]), rawStore: store([], ["remove"]) });
    assert.deepEqual(previewMigrationImport(text), [{ key: "interactions", label: "互动事件", count: 0, tombstones: 1 }]);
    const result = await importMigrationBundle(state.plugin, text);
    assert.equal(result.modules[0].removed, 1);
    assert.equal(result.modules[0].merged, 0);
    assert.deepEqual(state.files.get(INTERACTIONS), store([], ["remove"]));
});

test("互动迁移：顶层伪造墓碑不可删除 rawStore 未包含的对象", async () => {
    const state = memory(store([event("keep")]));
    const text = bundle({ ...store([], ["keep"]), rawStore: store([event("incoming")]) });
    assert.deepEqual(previewMigrationImport(text), [{ key: "interactions", label: "互动事件", count: 1, tombstones: 0 }]);
    const result = await importMigrationBundle(state.plugin, text);
    assert.equal(result.modules[0].removed, 0);
    assert.equal(result.modules[0].tombstonesAdded, 0);
    assert.deepEqual(state.files.get(INTERACTIONS), store([event("keep"), event("incoming")]));
});

for (const [name, rawStore] of [
    ["未知版本", { schemaVersion: 2, events: [], tombstones: [] }],
    ["坏事件", { schemaVersion: 1, events: [{ id: "bad" }], tombstones: [] }],
    ["坏墓碑", { schemaVersion: 1, events: [], tombstones: [42] }],
    ["缺字段", { schemaVersion: 1, events: [] }],
] as const) {
    test(`互动迁移：${name} rawStore 在其他模块写入前拒绝，不能降级为空投影`, async () => {
        const state = memory(store([event("keep")]));
        const text = bundle({ ...store(), rawStore }, { templates: templateModule });
        assert.throws(() => previewMigrationImport(text), /互动存储/);
        await assert.rejects(importMigrationBundle(state.plugin, text), /互动存储/);
        assert.equal(state.writes.length, 0);
        assert.deepEqual(state.files.get(INTERACTIONS), store([event("keep")]));
    });
}

test("互动迁移：null 和空字符串原始快照保持合法空导入，不执行顶层删除", async () => {
    for (const rawStore of [null, ""]) {
        const state = memory(store([event("keep")]));
        const text = bundle({ ...store([], ["keep"]), rawStore });
        assert.deepEqual(previewMigrationImport(text), []);
        const result = await importMigrationBundle(state.plugin, text);
        assert.equal(result.modules[0].removed, 0);
        assert.equal(state.writes.length, 0);
    }
});

test("互动迁移：坏当前库或读取失败停止互动写入，独立模块继续且保留重试", async () => {
    for (const current of [{ schemaVersion: 2, events: [], tombstones: [] }, store([{} as InteractionEvent]), store()]) {
        const state = memory(current);
        if (current.schemaVersion === 1 && current.events.length === 0) state.failReads.add(INTERACTIONS);
        const text = bundle(store([], ["remove"]), { templates: templateModule });
        const result = await importMigrationBundle(state.plugin, text);
        assert.equal(result.failed[0]?.key, "interactions");
        assert.equal(result.failed[0]?.status, "failed");
        assert.equal(state.writes.includes(INTERACTIONS), false);
        assert.equal(result.modules.find((module) => module.key === "templates")?.merged, 1);
        assert.deepEqual(Object.keys(JSON.parse(result.retryBundle!).modules), ["interactions"]);
        assert.equal(previewMigrationImport(result.retryBundle!)[0].tombstones, 1);
    }
});

test("互动迁移：已写入但回读失败报告 unknown，原始模块重试先核实而非重复删除", async () => {
    const state = memory(store([event("remove")]));
    state.failReadback.add(INTERACTIONS);
    const module = { ...store(), rawStore: store([], ["remove"]) };
    const result = await importMigrationBundle(state.plugin, bundle(module, { templates: templateModule }));
    assert.equal(result.failed[0]?.status, "unknown");
    assert.equal(result.modules.some((entry) => entry.key === "interactions"), false);
    assert.equal(result.modules.find((entry) => entry.key === "templates")?.merged, 1);
    assert.deepEqual(JSON.parse(result.retryBundle!).modules, { interactions: module });
    const writes = state.writes.length;
    state.failReadback.clear();
    const retry = await importMigrationBundle(state.plugin, result.retryBundle!);
    assert.deepEqual(retry.failed, []);
    assert.equal(retry.modules[0].removed, 0);
    assert.equal(retry.modules[0].tombstonesAdded, 0);
    assert.equal(state.writes.length, writes);
});

test("互动迁移：确认后锁内重读当前事实，预览之后的新事件不丢失", async () => {
    const state = memory(store([event("remove")]));
    const text = bundle(store([], ["remove"]));
    previewMigrationImport(text);
    state.files.set(INTERACTIONS, store([event("remove"), event("concurrent")]));
    const result = await importMigrationBundle(state.plugin, text);
    assert.equal(result.modules[0].removed, 1);
    assert.deepEqual(state.files.get(INTERACTIONS), store([event("concurrent")], ["remove"]));
});
