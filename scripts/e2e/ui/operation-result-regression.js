import { mount, unmount } from "svelte";
import { configureVcardKernel } from "./vcard-regression.js";
import { batchUpdateContacts } from "../../../src/services/contacts";
import { DEFAULT_VIEW_PREFERENCES } from "../../../src/domain/preferences";
import { bindSelfIdentityStorage } from "../../../src/data/self-identity";
import { bindPeopleProfileStorage } from "../../../src/services/people-profiles";
import PeopleView from "../../../src/components/people/PeopleView.svelte";
import SettingsView from "../../../src/components/SettingsView.svelte";

function batchFixture(kernel, settings) {
    bindSelfIdentityStorage({ loadData: async () => "" });
    bindPeopleProfileStorage(undefined);
    const state = configureVcardKernel(kernel, settings);
    for (const [suffix, name] of [["0000001", "批量甲"], ["0000002", "批量乙"]]) {
        const id = `20261004000000-${suffix}`;
        state.rows.set(id, { id, cells: [{ valueType: "block", value: { type: "block", keyID: "name", block: { id, content: name } } },
            { valueType: "select", value: { type: "select", keyID: "group", mSelect: [{ content: "朋友" }] } },
            { valueType: "mSelect", value: { type: "mSelect", keyID: "tags", mSelect: [{ content: "并发新增" }] } },
        ] });
    }
    return state;
}

export async function runOperationResultRegression({ test, assert, kernel, settings, fixture, until, button }) {
    await test("批量实际服务：新标签按最新值追加，旧分组与绑定变更逐项零覆盖", async () => {
        const state = batchFixture(kernel, settings);
        const itemId = "20261004000000-0000001";
        const result = await batchUpdateContacts(settings, [{ itemId, group: "家人", tagsToAdd: ["本次追加"], expected: { itemId, docId: itemId, group: "同学" } }]);
        assert(result[0].report.failed.some((entry) => entry.field === "group") && result[0].report.applied.includes("tags"), "并发分组覆盖或标签被阻断");
        const tags = state.rows.get(itemId).cells.find((cell) => cell.value.keyID === "tags").value.mSelect.map((entry) => entry.content);
        assert(tags.includes("并发新增") && tags.includes("本次追加"), "旧列表回退并发标签");
        const writes = state.writes.length;
        state.rows.get(itemId).cells[0].value.block.id = "20261004000000-other01";
        const stale = await batchUpdateContacts(settings, [{ itemId, group: "家人", tagsToAdd: ["错误目标"], expected: { itemId, docId: itemId, group: "朋友" } }]);
        assert(stale[0].report.unknown.length === 2 && state.writes.length === writes, "绑定换人后仍批量写入");
    });

    await test("批量联系人界面：范围文本、隐藏行确认、固定队列与取消零写入", async () => {
        const state = batchFixture(kernel, settings);
        const component = mount(PeopleView, { target: fixture, props: {
            settings, preferences: DEFAULT_VIEW_PREFERENCES, revision: 0, initialSort: "name", loadRecentInteractions: async () => ({}), onOpenDetail() {}, onPreferencesChange: async (next) => next,
        } });
        try {
            await until(() => fixture.querySelectorAll(".lvct-person-card").length === 2, "批量人物未加载");
            button("选择全部筛选（2 人）").click();
            await until(() => fixture.textContent.includes("已选 2 人"), "全部筛选范围未选中");
            const search = fixture.querySelector("input[placeholder*='搜索姓名']");
            search.value = "批量甲";
            search.dispatchEvent(new Event("input", { bubbles: true }));
            await until(() => fixture.textContent.includes("筛选外 1 人"), "隐藏已选行没有可见说明");
            button("批量编辑").click();
            await until(() => fixture.textContent.includes("已固定全部筛选的 2 人"), "没有固定目标");
            assert(button("应用到所选联系人").disabled, "没有确认隐藏行便启用批量写入");
            const dialog = fixture.querySelector(".lvct-dialog");
            const hidden = [...fixture.querySelectorAll("label")].find((label) => label.textContent.includes("确认包含筛选外"));
            hidden.querySelector("input").click();
            await until(() => !button("应用到所选联系人").disabled, "确认隐藏范围未启用操作");
            const cancel = [...fixture.querySelectorAll("button")].find((entry) => entry.textContent.trim() === "取消");
            cancel.click();
            await until(() => !fixture.textContent.includes("已固定全部筛选的"), "取消没有退出批量预览");
            assert(state.writes.length === 0 && fixture.textContent.includes("已选 2 人"), "取消写入或静默删除选择");
            assert(!dialog || !dialog.isConnected, "取消后批量对话框仍连接");
        } finally { await unmount(component); }
    });

    await test("设置迁移界面：模块级失败/未知和稳定 ID 明细可读，结果获得焦点", async () => {
        const report = { modules: [{ key: "registry", label: "收编索引", merged: 1, skipped: 0 }],
            failed: [{ key: "aliases", label: "人物别名", status: "unknown", message: "写后核实失败" }],
            skipped: { interactions: 0, followUps: 0 }, issues: [{ key: "orgMemberships", label: "组织成员", id: "20261004000000-member1", personDocId: "20261004000000-person1", orgDocId: "20261004000000-org0001", reason: "unreachable", message: "组织不可达" }] };
        const component = mount(SettingsView, { target: fixture, props: {
            settings, preferences: DEFAULT_VIEW_PREFERENCES,
            facade: { checkSettingsHealth: async () => ({ ok: true, issues: [] }), loadExportSummary: async () => ({ peopleCount: 1, interactionCount: 0 }), loadReminderDismissals: async () => [],
                previewMigrationImport: async () => [{ key: "aliases", label: "人物别名", count: 1 }], importMigrationBundle: async () => report },
            onSettingsUpdated() {}, onPreferencesUpdated() {}, onBack() {},
        } });
        try {
            button("数据与字段").click();
            await until(() => fixture.querySelector("#lvct-migration-bundle"), "设置迁移入口缺失");
            const transfer = new DataTransfer();
            transfer.items.add(new File(["{}"], "isolated.json", { type: "application/json" }));
            const input = fixture.querySelector("#lvct-migration-bundle");
            input.files = transfer.files;
            input.dispatchEvent(new Event("change", { bubbles: true }));
            await until(() => fixture.textContent.includes("人物别名：1 条"), "迁移预览缺失");
            button("确认恢复（现状优先合并）").click();
            await until(() => fixture.querySelector("[aria-label='未完成模块']"), "没有分模块结果");
            assert(fixture.textContent.includes("结果未知，先核实") && fixture.textContent.includes("已核实新增 1 条"), "未知与成功未分别表达");
            assert(document.activeElement?.getAttribute("aria-label") === "迁移模块结果", "结果没有获得焦点");
            fixture.querySelector(".lvct-settings__migration-result summary").click();
            assert(fixture.textContent.includes("20261004000000-org0001"), "冲突明细缺组织 ID");
            assert(fixture.scrollWidth <= fixture.clientWidth + 1, "长 ID 造成横向溢出");
        } finally { await unmount(component); }
    });
}
