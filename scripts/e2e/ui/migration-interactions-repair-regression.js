import { mount, unmount } from "svelte";
import SettingsView from "../../../src/components/SettingsView.svelte";
import { DEFAULT_VIEW_PREFERENCES } from "../../../src/domain/preferences";
import { previewMigrationImport, importMigrationBundle } from "../../../src/services/migration-bundle";

const KEY = "interaction-events.json";
const event = (id) => ({ id, personDocId: "20261018000000-person1", occurredAt: 1792252800000, localDate: "2026-10-18", source: "manual" });
const store = (events = [], tombstones = []) => ({ schemaVersion: 1, events, tombstones });
const bundle = (interactions, extra = {}) => JSON.stringify({ schemaVersion: 1, storageKey: "lvct-migration-bundle", modules: { interactions, ...extra } });

function memory(current) {
    const files = new Map([[KEY, current]]);
    const state = { files, writes: [], imports: [], failReadback: false };
    state.plugin = {
        async loadData(key) {
            if (state.failReadback && key === KEY && state.writes.includes(KEY)) throw new Error("隔离互动回读失败");
            return structuredClone(files.get(key) ?? null);
        },
        async saveData(key, value) { state.writes.push(key); files.set(key, structuredClone(value)); },
    };
    return state;
}

export async function runMigrationInteractionsRepairRegression({ test, assert, settings, fixture, until, button }) {
    const mountSettings = (state) => mount(SettingsView, { target: fixture, props: {
        settings, preferences: DEFAULT_VIEW_PREFERENCES,
        facade: {
            checkSettingsHealth: async () => ({ ok: true, issues: [] }),
            loadExportSummary: async () => ({ people: 1, interactions: 0 }),
            loadReminderDismissals: async () => [],
            previewMigrationImport: async (text) => previewMigrationImport(text),
            importMigrationBundle: async (text) => { state.imports.push(text); return importMigrationBundle(state.plugin, text); },
        }, onSettingsUpdated() {}, onPreferencesUpdated() {}, onBack() {},
    } });
    const choose = async (text) => {
        button("数据与字段").click();
        await until(() => fixture.querySelector("#lvct-migration-bundle"), "互动迁移入口未显示");
        const transfer = new DataTransfer();
        transfer.items.add(new File([text], "migration-interactions.json", { type: "application/json" }));
        const input = fixture.querySelector("#lvct-migration-bundle");
        input.files = transfer.files;
        input.dispatchEvent(new Event("change", { bubbles: true }));
    };
    const find = (text) => [...fixture.querySelectorAll("button")].find((node) => node.textContent?.trim() === text);

    await test("互动迁移修复：纯删除标记可确认，预览说明删除范围且结果报告实际删除", async () => {
        const state = memory(store([event("remove")]));
        const component = mountSettings(state);
        const text = bundle(store([], ["remove", "missing"]));
        try {
            await choose(text);
            await until(() => fixture.textContent.includes("互动事件：0 条，删除标记 2 条"), "纯互动墓碑未列入预览");
            assert(fixture.textContent.includes("互动删除标记会移除当前库中同 ID 的互动") && state.writes.length === 0, "预览漏删范围或已写入");
            const confirm = find("确认恢复（现状优先合并）");
            assert(confirm && !confirm.disabled, "纯删除包没有可用确认入口");
            confirm.click();
            await until(() => fixture.textContent.includes("互动事件：已核实新增 0 条，跳过 0 条，删除 1 条，新增删除标记 2 条"), "实际删除/墓碑回执未展示");
            assert(state.imports[0] === text && state.files.get(KEY).events.length === 0, "确认未执行原预览对象");
        } finally { await unmount(component); }
    });

    await test("互动迁移修复：rawStore 混合包展示真实墓碑，不因模板确认隐性删除", async () => {
        const state = memory(store([event("remove")]));
        const component = mountSettings(state);
        const text = bundle({ ...store(), rawStore: store([], ["remove"]) }, {
            templates: { schemaVersion: 1, templates: [{ id: "repair-ui-template", name: "测试", content: "虚构内容" }] },
        });
        try {
            await choose(text);
            await until(() => fixture.textContent.includes("备注模板：1 条") && fixture.textContent.includes("互动事件：0 条，删除标记 1 条"), "混合包隐藏互动墓碑");
            assert(state.writes.length === 0, "确认前写入");
            find("确认恢复（现状优先合并）").click();
            await until(() => fixture.textContent.includes("互动事件：已核实新增 0 条") && fixture.textContent.includes("备注模板：已核实新增 1 条"), "混合模块回执丢失");
            assert(state.files.get(KEY).tombstones.includes("remove"), "rawStore 墓碑未执行");
        } finally { await unmount(component); }
    });

    await test("互动迁移修复：坏 rawStore 阻断整包确认，模板与互动均零写", async () => {
        const state = memory(store([event("keep")]));
        const component = mountSettings(state);
        try {
            await choose(bundle({ ...store(), rawStore: { schemaVersion: 2, events: [], tombstones: [] } }, {
                templates: { schemaVersion: 1, templates: [{ id: "repair-invalid-template", name: "测试", content: "虚构内容" }] },
            }));
            await until(() => fixture.textContent.includes("互动存储格式或版本不兼容"), "坏快照未显示错误");
            assert(!find("确认恢复（现状优先合并）") && state.writes.length === 0 && state.imports.length === 0, "坏包仍可确认或已写入");
        } finally { await unmount(component); }
    });

    await test("互动迁移修复：unknown 保留纯删除重试入口，核实后不重复计删", async () => {
        const state = memory(store([event("remove")]));
        state.failReadback = true;
        const component = mountSettings(state);
        try {
            await choose(bundle({ ...store(), rawStore: store([], ["remove"]) }));
            await until(() => find("确认恢复（现状优先合并）"), "删除预览未就绪");
            find("确认恢复（现状优先合并）").click();
            await until(() => fixture.textContent.includes("结果未知，先核实") && find("核实并重试未完成模块"), "未知互动写未保留重试");
            assert(fixture.textContent.includes("互动事件：0 条，删除标记 1 条"), "未知写的纯墓碑重试预览丢失");
            const writes = state.writes.length;
            state.failReadback = false;
            find("核实并重试未完成模块").click();
            await until(() => fixture.textContent.includes("互动事件：已核实新增 0 条，跳过 0 条，删除 0 条，新增删除标记 0 条"), "核实重试重复计删或无回执");
            assert(state.writes.length === writes && JSON.parse(state.imports[1]).modules.interactions.rawStore.tombstones[0] === "remove", "重试重复写或丢原快照");
        } finally { await unmount(component); }
    });

    await test("互动迁移修复：重复互动跳过汇总只计一次，同时显示真实删除", async () => {
        const state = memory(store([event("keep"), event("remove")]));
        const component = mountSettings(state);
        try {
            await choose(bundle(store([event("keep")], ["remove"])));
            await until(() => find("确认恢复（现状优先合并）"), "混合互动预览未就绪");
            find("确认恢复（现状优先合并）").click();
            await until(() => fixture.textContent.includes("互动事件：已核实新增 0 条，跳过 1 条，删除 1 条"), "逐模块跳过数不正确");
            const result = fixture.querySelector('[aria-label="迁移模块结果"]')?.textContent ?? "";
            assert(result.includes("（跳过 1 条）") && !result.includes("（跳过 2 条）"), "总计重复累加兼容字段和模块跳过数");
        } finally { await unmount(component); }
    });
}
