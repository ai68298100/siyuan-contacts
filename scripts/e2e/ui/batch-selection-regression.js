import { mount, tick, unmount } from "svelte";
import PeopleView from "../../../src/components/people/PeopleView.svelte";
import { DEFAULT_VIEW_PREFERENCES } from "../../../src/domain/preferences";
import { bindSelfIdentityStorage } from "../../../src/data/self-identity";
import { bindPeopleProfileStorage } from "../../../src/services/people-profiles";
import { bindContactAliasStorage } from "../../../src/services/contact-aliases";
import { configureVcardKernel } from "./vcard-regression.js";

function addPerson(state, index) {
    const suffix = String(index).padStart(4, "0");
    const person = { itemId: `20261004000000-row${suffix}`, docId: `20261004000000-doc${suffix}`, name: `选择边界${suffix}` };
    state.rows.set(person.itemId, { id: person.itemId, cells: [
        { valueType: "block", value: { type: "block", keyID: "name", block: { id: person.docId, content: person.name } } },
        { valueType: "select", value: { type: "select", keyID: "group", mSelect: [{ content: "朋友" }] } },
        { valueType: "mSelect", value: { type: "mSelect", keyID: "tags", mSelect: [{ content: "原标签" }] } },
    ] });
    return person;
}

function configureBatchSelection(kernel, settings, count) {
    const plugin = { loadData: async () => "" };
    bindSelfIdentityStorage(plugin);
    bindPeopleProfileStorage(undefined);
    const unbindAliases = bindContactAliasStorage(plugin);
    const state = configureVcardKernel(kernel, settings);
    state.people = Array.from({ length: count }, (_, index) => addPerson(state, index + 1));
    const handler = kernel.handler;
    let nextWrite;
    kernel.handler = async (route, body) => {
        if (route === "/api/av/setAttributeViewBlockAttr" && nextWrite) {
            const gate = nextWrite;
            nextWrite = undefined;
            gate.started = true;
            await gate.promise;
        }
        return handler(route, body);
    };
    state.holdNextWrite = () => {
        let release;
        const promise = new Promise((resolve) => { release = resolve; });
        nextWrite = { promise, release, started: false };
        return nextWrite;
    };
    state.dispose = unbindAliases;
    return state;
}

function mountPeople(fixture, settings) {
    return mount(PeopleView, { target: fixture, props: {
        settings, preferences: { ...DEFAULT_VIEW_PREFERENCES, peopleView: "card" }, revision: 0,
        initialSort: "name", loadRecentInteractions: async () => ({}), onOpenDetail() {},
        onPreferencesChange: async (next) => next,
    } });
}

function setSearch(fixture, value) {
    const input = fixture.querySelector("input[placeholder*='搜索姓名']");
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
}

function batchDialog(fixture) {
    return fixture.querySelector("[role='dialog']");
}

function targets(dialog) {
    if (!dialog) return [];
    return [...dialog.querySelectorAll("details p")].map((entry) => entry.textContent);
}

function setTags(dialog, value) {
    const input = dialog.querySelector("input[placeholder='重点 客户']");
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
}

function assertWrites(assert, state, people, tag) {
    const expected = new Set(people.map((person) => person.itemId));
    assert(state.writes.length === people.length && new Set(state.writes.map((write) => write.itemID)).size === people.length,
        "批量目标重复或数量与固定范围不同");
    assert(state.writes.every((write) => expected.has(write.itemID) && write.keyID === "tags"), "批量写入了范围外行或使用文档 ID 写单元格");
    for (const person of people) {
        const values = state.rows.get(person.itemId).cells.find((cell) => cell.value.keyID === "tags").value.mSelect.map((entry) => entry.content);
        assert(values.includes("原标签") && values.includes(tag), `目标标签未核实或旧标签丢失：${person.itemId}`);
    }
}

async function disposePeople(component, state, fixture, until, gate) {
    gate?.release();
    try {
        if (gate?.started) await until(() => !fixture.textContent.includes("保存中…"), "批量保存未退出，不能切换夹具");
    } finally {
        await unmount(component);
        state.dispose();
    }
}

export async function runBatchSelectionRegression({ test, assert, kernel, settings, fixture, until, button }) {
    await test("批量加入组织：固定联系人范围、核对目标组织并逐人调用成员服务", async () => {
        const state = configureBatchSelection(kernel, settings, 2);
        const calls = [];
        const component = mount(PeopleView, { target: fixture, props: {
            settings, preferences: { ...DEFAULT_VIEW_PREFERENCES, peopleView: "card" }, revision: 0,
            initialSort: "name", loadRecentInteractions: async () => ({}), onOpenDetail() {},
            onPreferencesChange: async (next) => next,
            onLoadOrgCandidates: async () => [{ docId: "20261004000000-org0001", name: "曙光科技" }],
            onAddOrgMembership: async (personDocId, orgDocId, extra) => { calls.push({ personDocId, orgDocId, extra }); },
        } });
        try {
            await until(() => fixture.querySelectorAll(".lvct-person-card").length === 2, "批量组织夹具未加载");
            button("选择当前页（2 人）").click();
            await until(() => fixture.querySelectorAll(".lvct-person-card__select:checked").length === 2, "组织批量目标未选中");
            button("加入组织").click();
            await until(() => fixture.querySelector("[role='dialog']")?.textContent.includes("批量加入组织 · 2 人"), "批量加入组织弹窗未打开");
            const dialog = fixture.querySelector("[role='dialog']");
            await until(() => [...dialog.querySelectorAll("option")].some((option) => option.textContent.includes("曙光科技")), "组织候选未加载");
            button("加入所选组织", dialog).click();
            await until(() => fixture.textContent.includes("已将 2 人加入「曙光科技」") && !fixture.querySelector("[role='dialog']"), "批量组织写入未完成");
            assert(calls.length === 2 && calls.every((call) => call.orgDocId === "20261004000000-org0001" && call.extra?.status === "active"), "批量组织写入未逐人调用当前成员服务");
        } finally { await disposePeople(component, state, fixture, until); }
    });

    await test("批量加入组织部分失败：重试只处理失败联系人，成功项不会重复调用", async () => {
        const state = configureBatchSelection(kernel, settings, 2);
        const calls = [];
        let failFirst = true;
        const component = mount(PeopleView, { target: fixture, props: {
            settings, preferences: { ...DEFAULT_VIEW_PREFERENCES, peopleView: "card" }, revision: 0,
            initialSort: "name", loadRecentInteractions: async () => ({}), onOpenDetail() {},
            onPreferencesChange: async (next) => next,
            onLoadOrgCandidates: async () => [{ docId: "20261004000000-org0001", name: "曙光科技" }],
            onAddOrgMembership: async (personDocId, orgDocId) => {
                calls.push({ personDocId, orgDocId });
                if (personDocId.endsWith("doc0001") && failFirst) { failFirst = false; throw new Error("组织服务暂时不可用"); }
            },
        } });
        try {
            await until(() => fixture.querySelectorAll(".lvct-person-card").length === 2, "部分失败夹具未加载");
            button("选择当前页（2 人）").click();
            await until(() => fixture.querySelectorAll(".lvct-person-card__select:checked").length === 2, "部分失败目标未选中");
            button("加入组织").click();
            const dialog = await (async () => { await until(() => fixture.querySelector("[role='dialog']")?.textContent.includes("批量加入组织"), "部分失败弹窗未打开"); return fixture.querySelector("[role='dialog']"); })();
            await until(() => [...dialog.querySelectorAll("option")].some((option) => option.textContent.includes("曙光科技")), "部分失败组织未加载");
            button("加入所选组织", dialog).click();
            await until(() => dialog.textContent.includes("1 人失败") && Boolean([...dialog.querySelectorAll("button")].find((node) => node.textContent.trim() === "重试失败项")), "部分失败结果未显示可重试入口");
            assert(calls.length === 2, "首次批量加入没有逐人调用");
            button("重试失败项", dialog).click();
            await until(() => !fixture.querySelector("[role='dialog']"), "失败项重试未完成");
            assert(calls.length === 3 && calls.filter((call) => call.personDocId.endsWith("doc0001")).length === 2
                && calls.filter((call) => call.personDocId.endsWith("doc0002")).length === 1, "重试错误地重复调用了成功联系人");
        } finally { await disposePeople(component, state, fixture, until); }
    });

    await test("批量加入组织空态与忙态：无组织可引导新建，保存期间锁定重复操作", async () => {
        const state = configureBatchSelection(kernel, settings, 2);
        let createRequested = 0;
        let hasOrg = false;
        let release;
        const gate = new Promise((resolve) => { release = resolve; });
        const component = mount(PeopleView, { target: fixture, props: {
            settings, preferences: { ...DEFAULT_VIEW_PREFERENCES, peopleView: "card" }, revision: 0,
            initialSort: "name", loadRecentInteractions: async () => ({}), onOpenDetail() {},
            onPreferencesChange: async (next) => next,
            onLoadOrgCandidates: async () => hasOrg ? [{ docId: "20261004000000-org0001", name: "新组织" }] : [],
            onCreateOrganization: () => { createRequested += 1; hasOrg = true; },
            onAddOrgMembership: async () => { await gate; },
        } });
        try {
            await until(() => fixture.querySelectorAll(".lvct-person-card").length === 2, "空态夹具未加载");
            button("选择当前页（2 人）").click();
            await until(() => fixture.querySelectorAll(".lvct-person-card__select:checked").length === 2, "空态批量目标未选中");
            button("加入组织").click();
            const emptyDialog = await (async () => { await until(() => fixture.querySelector("[role='dialog']")?.textContent.includes("还没有组织"), "组织空态未显示"); return fixture.querySelector("[role='dialog']"); })();
            button("新建组织", emptyDialog).click();
            assert(createRequested === 1, "组织空态没有触发新建组织入口");
            emptyDialog.querySelector(".lvct-dialog-panel__close")?.click();
            await until(() => !fixture.querySelector("[role='dialog']"), "空态弹窗关闭失败");
            button("加入组织").click();
            const dialog = await (async () => { await until(() => fixture.querySelector("[role='dialog']")?.textContent.includes("批量加入组织"), "忙态弹窗未打开"); return fixture.querySelector("[role='dialog']"); })();
            await until(() => [...dialog.querySelectorAll("option")].some((option) => option.textContent.includes("新组织")), "新建组织后未重新读取候选");
            button("加入所选组织", dialog).click();
            await until(() => dialog.textContent.includes("加入中…"), "批量加入未进入忙态");
            assert(button("加入中…", dialog).disabled && button("取消", dialog).disabled && button("重新读取组织", dialog).disabled, "批量加入忙态仍可重复触发或修改目标");
            release();
            await until(() => !fixture.querySelector("[role='dialog']"), "忙态批量加入未完成");
        } finally { release(); await disposePeople(component, state, fixture, until); }
    });

    await test("批量加入组织断点：部分成功锁定原组织，重读目录不换联系人范围或重试集合", async () => {
        const state = configureBatchSelection(kernel, settings, 2);
        const organizations = [{ docId: "20261004000000-org0001", name: "原目标组织" }, { docId: "20261004000000-org0002", name: "另一个组织" }];
        const calls = [];
        let firstFailure = true;
        const component = mount(PeopleView, { target: fixture, props: {
            settings, preferences: { ...DEFAULT_VIEW_PREFERENCES, peopleView: "card" }, revision: 0,
            initialSort: "name", loadRecentInteractions: async () => ({}), onOpenDetail() {},
            onPreferencesChange: async (next) => next, onLoadOrgCandidates: async () => organizations.map((org) => ({ ...org })),
            onAddOrgMembership: async (personDocId, orgDocId) => {
                calls.push({ personDocId, orgDocId });
                if (personDocId === state.people[0].docId && firstFailure) { firstFailure = false; throw new Error("保留原组织断点"); }
            },
        } });
        try {
            await until(() => fixture.querySelectorAll(".lvct-person-card").length === 2, "组织断点名册未加载");
            button("选择当前页（2 人）").click(); await tick(); button("加入组织").click();
            await until(() => batchDialog(fixture)?.querySelector("select option[value='20261004000000-org0001']"), "组织断点候选未加载");
            const dialog = batchDialog(fixture); let selector = dialog.querySelector("select");
            selector.value = organizations[0].docId; selector.dispatchEvent(new Event("change", { bubbles: true }));
            button("加入所选组织", dialog).click();
            await until(() => dialog.textContent.includes("1 人失败") && !button("重试失败项", dialog).disabled, "组织断点失败未呈现");
            assert(selector.disabled, "部分成功后仍允许静默更改目标组织");
            const originalTargets = targets(dialog);
            // A new visible selection outside the preview must not replace its fixed queue.
            setSearch(fixture, state.people[1].name);
            await until(() => fixture.querySelectorAll(".lvct-person-card").length === 1, "断点搜索未收窄");
            button("选择当前页（1 人）").click();
            organizations.reverse();
            button("重新读取组织", dialog).click();
            await until(() => !button("重新读取组织", dialog).disabled, "断点目录重读未完成");
            selector = dialog.querySelector("select");
            assert(selector.value === "20261004000000-org0001" && selector.disabled && dialog.textContent.includes("保留原组织断点")
                && JSON.stringify(targets(dialog)) === JSON.stringify(originalTargets), "重读目录改变原组织、联系人或失败集合");
            // Programmatic change events cannot redefine an already-started intent either.
            selector.value = "20261004000000-org0002"; selector.dispatchEvent(new Event("change", { bubbles: true }));
            await tick();
            assert(selector.value === "20261004000000-org0001", "禁用组织选择器被 change 绕过");
            button("重试失败项", dialog).click();
            await until(() => !batchDialog(fixture), "原组织断点没有完成");
            assert(calls.length === 3 && calls.every((call) => call.orgDocId === "20261004000000-org0001")
                && calls.filter((call) => call.personDocId === state.people[1].docId).length === 1, "目录刷新或换目标导致成功项重写或跨组织重试");
        } finally { await disposePeople(component, state, fixture, until); }
    });

    await test("批量加入组织断点：原组织失效或读取失败时零重试，恢复同一身份后只重试原失败人", async () => {
        const state = configureBatchSelection(kernel, settings, 2);
        const original = { docId: "20261004000000-org0001", name: "需核实的原组织" };
        const other = { docId: "20261004000000-org0002", name: original.name };
        let candidates = [original, other], readFails = false, firstFailure = true;
        const calls = [];
        const component = mount(PeopleView, { target: fixture, props: {
            settings, preferences: { ...DEFAULT_VIEW_PREFERENCES, peopleView: "card" }, revision: 0,
            initialSort: "name", loadRecentInteractions: async () => ({}), onOpenDetail() {}, onPreferencesChange: async (next) => next,
            onLoadOrgCandidates: async () => { if (readFails) throw new Error("目录核实失败"); return candidates.map((org) => ({ ...org })); },
            onAddOrgMembership: async (personDocId, orgDocId) => {
                calls.push({ personDocId, orgDocId });
                if (personDocId === state.people[0].docId && firstFailure) { firstFailure = false; throw new Error("原失败人"); }
            },
        } });
        try {
            await until(() => fixture.querySelectorAll(".lvct-person-card").length === 2, "失效目标名册未加载");
            button("选择当前页（2 人）").click(); await tick(); button("加入组织").click();
            await until(() => batchDialog(fixture)?.querySelector(`option[value='${original.docId}']`), "失效目标候选未加载");
            const dialog = batchDialog(fixture); let selector = dialog.querySelector("select");
            assert([...selector.options].filter((option) => option.value).every((option) => option.textContent.includes(option.value)), "同名目标组织缺少稳定身份区分");
            selector.value = original.docId; selector.dispatchEvent(new Event("change", { bubbles: true }));
            button("加入所选组织", dialog).click();
            await until(() => dialog.textContent.includes("原失败人") && !button("重试失败项", dialog).disabled, "失效目标首次断点未出现");
            for (const unavailable of [[{ ...original, archived: true }, other], [{ ...other, name: original.name }]]) {
                candidates = unavailable; button("重新读取组织", dialog).click();
                await until(() => !button("重新读取组织", dialog).disabled, "失效目标重读未完成");
                selector = dialog.querySelector("select");
                assert(button("重试失败项", dialog).disabled && selector.value === original.docId && dialog.textContent.includes("原失败人"), "失效目标被清除、同名替换或重试集合丢失");
                button("重试失败项", dialog).click(); await tick();
                assert(calls.length === 2, "原目标未核实时仍发送组织写入");
            }
            candidates = [original, other]; readFails = true; button("重新读取组织", dialog).click();
            await until(() => dialog.textContent.includes("目录核实失败") && !button("重新读取组织", dialog).disabled, "目录失败没有反馈");
            assert(button("重试失败项", dialog).disabled && calls.length === 2, "目录读取失败沿用旧候选进行写入");
            readFails = false; button("重新读取组织", dialog).click();
            await until(() => !button("重试失败项", dialog).disabled, "同一组织恢复后无法核实并继续");
            button("重试失败项", dialog).click(); await until(() => !batchDialog(fixture), "原组织恢复后断点未完成");
            assert(calls.length === 3 && calls.every((call) => call.orgDocId === original.docId)
                && calls.filter((call) => call.personDocId === state.people[1].docId).length === 1, "恢复后重复成功人或写入替代组织");
        } finally { await disposePeople(component, state, fixture, until); }
    });

    await test("批量选择 200/201 边界：当前页不含第 201 人，加载更多不暗增选择，全部筛选包含下一页", async () => {
        const state = configureBatchSelection(kernel, settings, 201);
        const component = mountPeople(fixture, settings);
        try {
            await until(() => fixture.querySelectorAll(".lvct-person-card").length === 200, "首屏未停在 200 人边界");
            button("选择当前页（200 人）").click();
            await until(() => fixture.querySelectorAll(".lvct-person-card__select:checked").length === 200, "当前页未选中 200 人");
            assert(fixture.querySelector(".lvct-people__batchbar").textContent.includes("当前页；筛选外 0 人"), "当前页范围标签错误");
            button("批量编辑").click();
            await until(() => batchDialog(fixture)?.textContent.includes("已固定当前页的 200 人"), "未固定当前页范围");
            const originalTargets = targets(batchDialog(fixture));
            assert(originalTargets.length === 200 && originalTargets.every((entry) => !entry.includes(state.people[200].docId)), "当前页误含第 201 人");
            setSearch(fixture, state.people[200].name);
            await until(() => fixture.querySelectorAll(".lvct-person-card").length === 1
                && fixture.querySelector(".lvct-people__batchbar").textContent.includes("筛选外 200 人"), "筛选变化暗删当前页选择");
            assert(JSON.stringify(targets(batchDialog(fixture))) === JSON.stringify(originalTargets), "筛选变化替换了预览目标");
            button("取消", batchDialog(fixture)).click();
            await until(() => !batchDialog(fixture), "取消当前页预览失败");
            setSearch(fixture, "");
            await until(() => fixture.querySelectorAll(".lvct-person-card").length === 200, "清除筛选未恢复第一页");
            button("加载更多（已显示 200 / 201）").click();
            await until(() => fixture.querySelectorAll(".lvct-person-card").length === 201, "第 201 人未加载");
            const last = fixture.querySelector(`input[aria-label='选择 ${state.people[200].name}']`);
            assert(!last.checked && fixture.querySelectorAll(".lvct-person-card__select:checked").length === 200, "翻页静默扩充当前页选择");
            button("选择全部筛选（201 人）").click();
            await until(() => fixture.querySelectorAll(".lvct-person-card__select:checked").length === 201, "全部筛选遗漏第 201 人");
            button("批量编辑").click();
            await until(() => batchDialog(fixture)?.textContent.includes("已固定全部筛选的 201 人"), "全部筛选被截为当前页");
            const allTargets = targets(batchDialog(fixture));
            assert(allTargets.length === 201 && allTargets.some((entry) => entry.includes(state.people[200].docId)), "全部筛选预览丢失下一页稳定文档 ID");
            button("取消", batchDialog(fixture)).click();
            await until(() => !batchDialog(fixture), "取消全部筛选预览失败");
            assert(state.writes.length === 0 && fixture.querySelector(".lvct-people__batchbar").textContent.includes("已选 201 人"), "取消产生写入或清空原选择");
        } finally { await disposePeople(component, state, fixture, until); }
    });

    await test("批量全部筛选真实写入 201 人：预览后改筛选和重新选当前页不改队列，保存时范围锁定", async () => {
        const state = configureBatchSelection(kernel, settings, 201);
        const component = mountPeople(fixture, settings);
        let gate;
        try {
            await until(() => fixture.querySelectorAll(".lvct-person-card").length === 200, "批量边界名册未加载");
            button("选择全部筛选（201 人）").click();
            await until(() => fixture.querySelector(".lvct-people__batchbar")?.textContent.includes("已选 201 人"), "全部筛选未选中 201 人");
            button("批量编辑").click();
            await until(() => targets(batchDialog(fixture)).length === 201, "全部筛选队列未固定");
            const originalTargets = targets(batchDialog(fixture));
            const newcomer = addPerson(state, 202);
            setSearch(fixture, state.people[200].name);
            await until(() => fixture.querySelectorAll(".lvct-person-card").length === 1, "预览后的筛选未生效");
            button("选择当前页（1 人）").click();
            await until(() => fixture.querySelector(".lvct-people__batchbar").textContent.includes("已选 1 人"), "预览后的显式范围变化未生效");
            assert(JSON.stringify(targets(batchDialog(fixture))) === JSON.stringify(originalTargets)
                && batchDialog(fixture).textContent.includes("已固定全部筛选的 201 人"), "当前选择范围改写了已确认预览队列");
            setTags(batchDialog(fixture), "全部筛选追加");
            await tick();
            gate = state.holdNextWrite();
            button("应用到所选联系人", batchDialog(fixture)).click();
            await until(() => gate.started && batchDialog(fixture)?.textContent.includes("保存中…"), "真实批量服务没有进入等待写入状态");
            assert(button("选择当前页（1 人）").disabled && button("选择全部筛选（1 人）").disabled
                && button("取消选择").disabled && button("取消", batchDialog(fixture)).disabled, "保存时仍可修改范围或取消队列");
            button("选择全部筛选（1 人）").click();
            button("取消选择").click();
            await tick();
            assert(state.writes.length === 0 && targets(batchDialog(fixture)).length === 201
                && fixture.querySelector(".lvct-people__batchbar").textContent.includes("已选 1 人"), "保存锁内范围被清空或固定队列变化");
            gate.release();
            await until(() => fixture.textContent.includes("批量修改已核实：201 人") && !batchDialog(fixture), "固定的 201 人批量未完成");
            assertWrites(assert, state, state.people, "全部筛选追加");
            assert(!state.writes.some((write) => write.itemID === newcomer.itemId), "预览后新增人物被暗加到队列");
        } finally { await disposePeople(component, state, fixture, until, gate); }
    });

    await test("批量手选隐藏联系人：必须显式勾选筛选外范围，真实保存期间确认与范围不可改", async () => {
        const state = configureBatchSelection(kernel, settings, 3);
        const component = mountPeople(fixture, settings);
        let gate;
        try {
            await until(() => fixture.querySelectorAll(".lvct-person-card").length === 3, "手选夹具未加载");
            for (const person of state.people.slice(0, 2)) fixture.querySelector(`input[aria-label='选择 ${person.name}']`).click();
            await until(() => fixture.querySelector(".lvct-people__batchbar")?.textContent.includes("已选 2 人"), "手选目标未选中");
            setSearch(fixture, state.people[2].name);
            await until(() => fixture.querySelector(".lvct-people__batchbar").textContent.includes("手动选中；筛选外 2 人"), "隐藏手选范围未明示");
            button("批量编辑").click();
            await until(() => batchDialog(fixture)?.textContent.includes("已固定手动选中的 2 人，包含筛选外 2 人"), "手选队列被当前筛选替换");
            const dialog = batchDialog(fixture);
            const confirmLabel = [...dialog.querySelectorAll("label")].find((label) => label.textContent.includes("确认包含筛选外 2 人"));
            const hidden = confirmLabel?.querySelector("input[type='checkbox']");
            assert(hidden && !hidden.checked && button("应用到所选联系人", dialog).disabled, "隐藏范围未要求显式确认");
            setTags(dialog, "隐藏手选追加");
            await tick();
            button("应用到所选联系人", dialog).click();
            await tick();
            assert(state.writes.length === 0 && button("应用到所选联系人", dialog).disabled, "填标签绕过隐藏范围确认");
            hidden.click();
            await until(() => !button("应用到所选联系人", dialog).disabled, "确认筛选外范围未解锁保存");
            hidden.click();
            await until(() => button("应用到所选联系人", dialog).disabled, "取消隐藏范围确认没有重新阻止保存");
            hidden.click();
            await until(() => !button("应用到所选联系人", dialog).disabled, "再次确认未解锁保存");
            gate = state.holdNextWrite();
            button("应用到所选联系人", dialog).click();
            await until(() => gate.started && dialog.textContent.includes("保存中…"), "隐藏目标未进入真实服务保存");
            assert(hidden.disabled && hidden.checked && dialog.querySelector("select").disabled
                && dialog.querySelector("input[placeholder='重点 客户']").disabled && button("取消", dialog).disabled
                && button("选择当前页（1 人）").disabled && button("选择全部筛选（1 人）").disabled, "保存期间仍能改变确认或批量范围");
            hidden.click();
            button("取消", dialog).click();
            button("选择当前页（1 人）").click();
            setSearch(fixture, state.people[0].name);
            await until(() => fixture.querySelector(".lvct-people__batchbar").textContent.includes("手动选中；筛选外 1 人"), "保存中的筛选变化未可观察");
            assert(hidden.checked && targets(dialog).length === 2 && dialog.textContent.includes("已固定手动选中的 2 人，包含筛选外 2 人")
                && targets(dialog).every((entry) => !entry.includes(state.people[2].docId)), "保存期间确认丢失或隐藏目标被替换");
            gate.release();
            await until(() => fixture.textContent.includes("批量修改已核实：2 人") && !batchDialog(fixture), "隐藏手选批量保存未完成");
            assertWrites(assert, state, state.people.slice(0, 2), "隐藏手选追加");
        } finally { await disposePeople(component, state, fixture, until, gate); }
    });
}
