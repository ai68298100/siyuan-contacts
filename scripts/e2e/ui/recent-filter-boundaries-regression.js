import { mount, tick, unmount } from "svelte";
import { SvelteMap } from "svelte/reactivity";
import PeopleView from "../../../src/components/people/PeopleView.svelte";
import { DEFAULT_VIEW_PREFERENCES } from "../../../src/domain/preferences";
import { bindSelfIdentityStorage } from "../../../src/data/self-identity";
import { bindPeopleProfileStorage } from "../../../src/services/people-profiles";
import { bindContactAliasStorage } from "../../../src/services/contact-aliases";
import { configureVcardKernel } from "./vcard-regression.js";

function deferred() {
    let resolve, reject;
    const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
    return { promise, resolve, reject };
}

function configure(kernel, settings) {
    const plugin = { loadData: async () => "" };
    bindSelfIdentityStorage(plugin);
    bindPeopleProfileStorage(undefined);
    const unbindAliases = bindContactAliasStorage(plugin);
    const state = configureVcardKernel(kernel, settings);
    state.people = [1, 2].map((number) => {
        const suffix = String(number).padStart(4, "0");
        const person = { itemId: `20261004000000-row${suffix}`, docId: `20261004000000-doc${suffix}`, name: `互动范围${suffix}` };
        state.rows.set(person.itemId, { id: person.itemId, cells: [
            { valueType: "block", value: { type: "block", keyID: "name", block: { id: person.docId, content: person.name } } },
            { valueType: "select", value: { type: "select", keyID: "group", mSelect: [{ content: "朋友" }] } },
            { valueType: "mSelect", value: { type: "mSelect", keyID: "tags", mSelect: [] } },
        ] });
        return person;
    });
    state.revisions = new SvelteMap([["value", 0]]);
    state.bumpRevision = () => state.revisions.set("value", state.revisions.get("value") + 1);
    state.snapshot = (both = false) => Object.fromEntries(state.people.slice(0, both ? 2 : 1).map((person) => [person.docId, { occurredAt: 1791331200000, localDate: "2026-10-07" }]));
    state.reads = 0;
    state.read = async () => state.snapshot();
    state.organizationCalls = [];
    state.addMembership = async () => {};
    state.dispose = unbindAliases;
    return state;
}

function mountPeople(fixture, settings, state, never = false) {
    const query = { search: "", group: "", tags: [], tagMatch: "all", recentFrom: never ? "" : "2026-10-01", recentTo: never ? "" : "2026-10-31", neverContacted: never, sort: "name" };
    return mount(PeopleView, { target: fixture, props: {
        settings, preferences: { ...DEFAULT_VIEW_PREFERENCES, savedViews: [{ id: "recent-scope", name: "互动范围视图", query }] },
        get revision() { return state.revisions.get("value"); }, initialSort: "name", onOpenDetail() {},
        loadRecentInteractions: async () => { state.reads += 1; return state.read(); }, onPreferencesChange: async (next) => next,
        onLoadOrgCandidates: async () => [{ docId: "20261004000000-org0001", name: "互动范围组织" }],
        onAddOrgMembership: async (...args) => { state.organizationCalls.push(args); return state.addMembership(...args); },
    } });
}

const allButton = (fixture) => [...fixture.querySelectorAll("button")].find((node) => node.textContent.startsWith("选择全部筛选"));
const dialog = (fixture) => fixture.querySelector("[role='dialog']");
const pausedChips = (fixture) => [...fixture.querySelectorAll(".lvct-people__condition")].filter((node) => /最近互动|从未联系/.test(node.textContent));
function enterTags(fixture) {
    const node = dialog(fixture).querySelector("input[placeholder='重点 客户']");
    node.value = "核对标签"; node.dispatchEvent(new Event("input", { bubbles: true }));
}
async function activateView({ fixture, until, button }) {
    await until(() => fixture.querySelectorAll(".lvct-person-card").length === 2, "互动范围名册未加载");
    button("互动范围视图").click(); await tick();
}

export async function runRecentFilterBoundariesRegression(context) {
    const { test, assert, kernel, settings, fixture, until, button } = context;

    await test("最近互动范围保护：初次读取未完成，日期条件显示暂停且不能全选放宽范围", async () => {
        const state = configure(kernel, settings), read = deferred(); state.read = () => read.promise;
        const component = mountPeople(fixture, settings, state);
        try {
            await activateView(context);
            assert(allButton(fixture).disabled, "日期依赖未完成仍允许选择全部筛选");
            assert(pausedChips(fixture).length === 1 && pausedChips(fixture)[0].textContent.includes("已暂停"), "未完成日期条件仍显示为生效条件");
            assert(fixture.textContent.includes("筛选范围待核实") && !fixture.querySelector(".lvct-people__conditions").textContent.includes("共 2 人"), "暂停范围仍被计为已核实筛选结果");
            assert(![...fixture.querySelectorAll(".lvct-person-card")].some((node) => node.textContent.includes("暂无互动")), "未完成互动读取被卡片解释成无互动");
            read.resolve(state.snapshot());
            await until(() => fixture.querySelectorAll(".lvct-person-card").length === 1 && !allButton(fixture).disabled, "读取完成后日期范围未恢复");
            assert(!pausedChips(fixture)[0].textContent.includes("已暂停"), "成功后日期条件仍处暂停态");
        } finally { read.resolve(state.snapshot()); await unmount(component); state.dispose(); }
    });

    await test("最近互动范围保护：从未联系读取失败和重试期间保持未知，恢复后重新求值", async () => {
        const state = configure(kernel, settings), retry = deferred();
        state.read = async () => { throw new Error("互动快照读取失败"); };
        const component = mountPeople(fixture, settings, state, true);
        try {
            await activateView(context);
            await until(() => fixture.textContent.includes("互动快照读取失败"), "从未联系依赖失败未显示");
            assert(allButton(fixture).disabled && pausedChips(fixture)[0].textContent.includes("已暂停"), "从未联系读取失败仍可按放宽集合全选");
            state.read = () => retry.promise; button("重试最近互动").click(); await tick();
            assert(allButton(fixture).disabled && fixture.textContent.includes("筛选范围待核实"), "重试未完成期间错误解锁从未联系范围");
            retry.resolve(state.snapshot());
            await until(() => fixture.querySelectorAll(".lvct-person-card").length === 1 && !allButton(fixture).disabled, "从未联系读取恢复后没有重新求值");
            assert(fixture.querySelector(".lvct-person-card").textContent.includes(state.people[1].name), "有互动的人被误归入从未联系");
        } finally { retry.resolve(state.snapshot()); await unmount(component); state.dispose(); }
    });

    await test("最近互动范围保护：全部筛选来源的待确认批量编辑在依赖失效时零写入", async () => {
        const state = configure(kernel, settings), pending = deferred();
        const component = mountPeople(fixture, settings, state);
        try {
            await activateView(context); await until(() => !allButton(fixture).disabled, "日期条件未就绪");
            allButton(fixture).click(); await tick(); button("批量编辑").click(); await tick(); enterTags(fixture); await tick();
            state.read = () => pending.promise; const prior = state.reads; state.bumpRevision();
            await until(() => state.reads > prior, "修订变化未触发互动重读");
            const apply = button("应用到所选联系人", dialog(fixture));
            assert(apply.disabled && dialog(fixture).textContent.includes("筛选范围待核实"), "未确认批次在依赖重读时仍能提交");
            apply.dispatchEvent(new MouseEvent("click", { bubbles: true })); await tick();
            assert(state.writes.length === 0, "依赖待核实仍发生批量字段写入");
            pending.resolve(state.snapshot()); await until(() => !apply.disabled, "恢复读取后原名单不能继续核对");
            apply.click(); await until(() => !dialog(fixture), "原固定批次未完成");
            assert(state.writes.length === 1 && state.writes[0].itemID === state.people[0].itemId, "恢复读取改变了批次固定名单");
        } finally { pending.resolve(state.snapshot()); await unmount(component); state.dispose(); }
    });

    await test("最近互动范围保护：全部筛选选择及未确认组织批次失效时阻止新增写入", async () => {
        const state = configure(kernel, settings), pending = deferred();
        const component = mountPeople(fixture, settings, state);
        try {
            await activateView(context); await until(() => !allButton(fixture).disabled, "组织范围日期依赖未就绪");
            allButton(fixture).click(); await tick(); button("加入组织").click();
            await until(() => dialog(fixture)?.textContent.includes("互动范围组织"), "组织范围弹窗未准备好");
            state.read = () => pending.promise; const prior = state.reads; state.bumpRevision();
            await until(() => state.reads > prior, "组织范围没有重读依赖");
            assert(button("加入所选组织", dialog(fixture)).disabled, "未确认组织批次未拦截失效筛选来源");
            button("加入所选组织", dialog(fixture)).dispatchEvent(new MouseEvent("click", { bubbles: true })); await tick();
            assert(state.organizationCalls.length === 0, "组织批次在筛选范围待核实时写入");
            button("取消", dialog(fixture)).click(); await tick();
            assert(button("批量编辑").disabled && button("加入组织").disabled && button("导出 vCard").disabled && button("从人脉移除").disabled, "全部筛选来源丢失依赖仍能新建其他批量操作");
            pending.resolve(state.snapshot());
        } finally { pending.resolve(state.snapshot()); await unmount(component); state.dispose(); }
    });

    await test("最近互动范围保护：依赖失败时手工明确选中的稳定名单仍可批量编辑", async () => {
        const state = configure(kernel, settings); state.read = async () => { throw new Error("手动名单不依赖互动快照"); };
        const component = mountPeople(fixture, settings, state);
        try {
            await activateView(context); await until(() => fixture.textContent.includes("手动名单不依赖互动快照"), "手工名单故障未显示");
            fixture.querySelector(".lvct-person-card__select").click(); await tick();
            assert(!button("批量编辑").disabled, "故障错误地阻止手工明确名单");
            button("批量编辑").click(); await tick(); enterTags(fixture); await tick();
            button("应用到所选联系人", dialog(fixture)).click(); await until(() => !dialog(fixture), "手工名单批量保存未完成");
            assert(state.writes.length === 1 && state.writes[0].itemID === state.people[0].itemId, "手工名单写入了范围外人物");
        } finally { await unmount(component); state.dispose(); }
    });

    await test("最近互动范围保护：已确认组织批次在互动读取失效后仍只重试原失败人", async () => {
        const state = configure(kernel, settings); state.read = async () => state.snapshot(true);
        let firstFailure = true;
        state.addMembership = async (personDocId) => { if (personDocId === state.people[0].docId && firstFailure) { firstFailure = false; throw new Error("保留组织断点"); } };
        const component = mountPeople(fixture, settings, state);
        try {
            await activateView(context); await until(() => !allButton(fixture).disabled, "已确认组织依赖未就绪");
            allButton(fixture).click(); await tick(); button("加入组织").click();
            await until(() => dialog(fixture)?.textContent.includes("互动范围组织"), "已确认组织目录未加载");
            button("加入所选组织", dialog(fixture)).click();
            await until(() => dialog(fixture)?.textContent.includes("1 人失败"), "已确认组织失败断点未出现");
            state.read = async () => { throw new Error("已确认后的互动读取失败"); }; state.bumpRevision();
            await until(() => fixture.textContent.includes("已确认后的互动读取失败"), "已确认后的依赖没有失效");
            assert(!button("重试失败项", dialog(fixture)).disabled, "依赖失效错误阻止已经确认的固定批次重试");
            button("重试失败项", dialog(fixture)).click(); await until(() => !dialog(fixture), "已确认原失败人不能重试");
            assert(state.organizationCalls.length === 3 && state.organizationCalls.filter((args) => args[0] === state.people[1].docId).length === 1
                && state.organizationCalls.every((args) => args[1] === "20261004000000-org0001"), "已确认批次重试改变名单或原组织");
        } finally { await unmount(component); state.dispose(); }
    });
}
