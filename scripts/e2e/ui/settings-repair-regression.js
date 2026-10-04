import { mount, tick, unmount } from "svelte";
import SettingsView from "../../../src/components/SettingsView.svelte";
import { DEFAULT_VIEW_PREFERENCES } from "../../../src/domain/preferences.ts";
import { SETTINGS_REPAIR_STORAGE_KEY } from "../../../src/domain/settings-repair.ts";
import { checkSettingsHealth, previewMissingFields, rebuildMissingFields, previewRebindSettings, rebindSettings } from "../../../src/services/settings-health.ts";
import { configureSettingsRepairKernel, runSettingsRepairServiceRegression } from "./settings-repair-fixture.js";

export { configureSettingsRepairKernel } from "./settings-repair-fixture.js";

function settingsFacade(state, settings) {
    const facade = {
        settings, loadData: state.plugin.loadData, saveData: state.plugin.saveData,
        viewPreferences: DEFAULT_VIEW_PREFERENCES, loadSelfIdentity: async () => null, listContacts: async () => [],
        loadReminderDismissals: async () => [], loadExportSummary: async () => ({ peopleCount: 0, interactionCount: 0 }),
        checkSettingsHealth: () => checkSettingsHealth(facade.settings),
        previewMissingFields: () => previewMissingFields(state.plugin, facade.settings),
        async rebuildMissingFields(preview) {
            const updated = await rebuildMissingFields(state.plugin, facade.settings, preview);
            facade.settings = updated;
            return updated;
        },
        previewRebindSettings: (patch) => previewRebindSettings(state.plugin, facade.settings, patch),
        async rebindSettings(patch, preview) {
            const updated = await rebindSettings(state.plugin, facade.settings, patch, preview);
            facade.settings = updated;
            return updated;
        },
    };
    return facade;
}

export async function runSettingsRepairRegression(context) {
    const { test, assert, kernel, settings, fixture, until, button } = context;
    await runSettingsRepairServiceRegression(context);

    await test("AG-P0-003 设置页第二列失败保留旧 facade，重新预览原请求后继续无重复", async () => {
        const state = configureSettingsRepairKernel(kernel, settings);
        state.targets[0].columns = state.targets[0].columns.filter((column) => ![settings.fieldMap.phone, settings.fieldMap.email].includes(column.id));
        const facade = settingsFacade(state, settings);
        let saved = null;
        const component = mount(SettingsView, { target: fixture, props: { facade, settings, preferences: DEFAULT_VIEW_PREFERENCES,
            onSettingsUpdated(value) { saved = value; }, onPreferencesUpdated() {}, onBack() {} } });
        try {
            button("数据与字段").click();
            await tick();
            button("检查字段健康").click();
            await until(() => fixture.textContent.includes("缺失 2 项"), "未读到两个缺失字段");
            button("补建缺失字段").click();
            await until(() => fixture.textContent.includes("补列影响预览（只读）"), "未进入补列确认");
            assert(state.jsonWrites.length === 0 && state.adds.length === 0, "设置预览隐藏写入");
            button("取消补列预览").click();
            await tick();
            assert(state.adds.length === 0 && !fixture.textContent.includes("补列影响预览（只读）"), "取消未清预览或触发建列");
            button("补建缺失字段").click();
            await until(() => fixture.textContent.includes("补列影响预览（只读）"), "重开预览失败");
            state.rejectAt = 2;
            button("确认补建并核实").click();
            await until(() => fixture.textContent.includes("明确拒绝") && !button("重新核实补列预览").disabled, "第二列失败未保留界面");
            assert(facade.settings.fieldMap.phone === settings.fieldMap.phone && saved === null, "夹具主动更新 facade 绕过真实失败路径");
            const originalFirstId = state.adds[0].keyID;
            state.rejectAt = 0;
            button("重新核实补列预览").click();
            const requestId = state.store.get(SETTINGS_REPAIR_STORAGE_KEY).requestId;
            await until(() => fixture.textContent.includes(requestId) && !button("确认补建并核实").disabled, "旧 facade 重新预览未核实原断点");
            assert(state.adds.length === 2 && state.jsonWrites.filter((key) => key === "contacts-settings.json").length === 1, "重新预览改写映射或重复建列");
            button("确认补建并核实").click();
            await until(() => saved?.fieldMap.phone === originalFirstId && fixture.textContent.includes("字段完整"), "原请求续做未完成");
            assert(state.adds.length === 3 && state.adds[1].keyID === state.adds[2].keyID, "设置入口重建第一列或为第二列换 ID");
        } finally { await unmount(component); }
    });

    await test("AG-P0-003 设置重绑先预览四层归属，取消零保存再确认切换", async () => {
        const state = configureSettingsRepairKernel(kernel, settings);
        const target = state.addTarget("20261004000000-book002");
        const facade = settingsFacade(state, settings);
        let saved = null;
        const component = mount(SettingsView, { target: fixture, props: { facade, settings, preferences: DEFAULT_VIEW_PREFERENCES,
            onSettingsUpdated(value) { saved = value; }, onPreferencesUpdated() {}, onBack() {} } });
        try {
            button("数据与字段").click();
            await tick();
            button("重新绑定已有数据库").click();
            await tick();
            const inputs = [...fixture.querySelectorAll("label")].filter((label) => label.querySelector("input"));
            for (const [labelText, value] of [["笔记本 ID", target.notebookId], ["宿主文档 ID", target.hostDocId],
                ["数据库块 ID", target.dbBlockId], ["属性视图 ID", target.avId]]) {
                const label = inputs.find((entry) => entry.textContent.trim() === labelText);
                assert(label, `锚点输入不可达：${labelText}`);
                const input = label.querySelector("input");
                input.value = value;
                input.dispatchEvent(new Event("input", { bubbles: true }));
            }
            button("验证并重新绑定").click();
            await until(() => fixture.textContent.includes("数据库重绑影响预览（只读）"), "重绑未显示确认层");
            assert(fixture.textContent.includes(target.notebookId) && fixture.textContent.includes(target.avId) && state.jsonWrites.length === 0, "归属证据隐藏或预览写入");
            button("取消重绑预览").click();
            await tick();
            assert(state.jsonWrites.length === 0 && saved === null, "取消切换了锚点");
            button("验证并重新绑定").click();
            await until(() => fixture.textContent.includes("数据库重绑影响预览（只读）"), "取消后不能重新预览");
            button("确认切换数据库").click();
            await until(() => saved?.avId === target.avId, "确认未切换到明确目标");
            assert(saved.notebookId === target.notebookId && state.adds.length === 0 && state.relations.length === 0, "重绑创建列或错用旧笔记本");
        } finally { await unmount(component); }
    });
}
