import { mount, tick, unmount } from "svelte";
import { fromStore, writable } from "svelte/store";
import PeopleView from "../../../src/components/people/PeopleView.svelte";
import { DEFAULT_VIEW_PREFERENCES } from "../../../src/domain/preferences";
import { FIELD_SPECS } from "../../../src/domain/fields";
import { bindSelfIdentityStorage } from "../../../src/data/self-identity";
import { PERSON_ALIAS_STORAGE_KEY } from "../../../src/data/person-aliases";
import { ORG_MEMBERSHIP_STORAGE_KEY } from "../../../src/data/org-membership";
import { bindPeopleProfileStorage } from "../../../src/services/people-profiles";
import { bindContactAliasStorage } from "../../../src/services/contact-aliases";
import { configureVcardKernel } from "./vcard-regression.js";

const pause = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
const person = (index, name = `普通人物${String(index).padStart(4, "0")}`, related = []) => ({
    itemId: `20261017000000-r${String(index).padStart(6, "0")}`,
    docId: `20261017000000-p${String(index).padStart(6, "0")}`,
    name, related,
});
const row = (entry) => ({ id: entry.itemId, cells: [
    { valueType: "block", value: { keyID: "name", type: "block", block: { id: entry.docId, content: entry.name } } },
    { valueType: "relation", value: { keyID: "related", type: "relation", relation: { blockIDs: entry.related } } },
] });

/** Models AV's raw-column query and real pagination, rather than returning every row for every request. */
function searchFixture(kernel, settings, people) {
    const state = configureVcardKernel(kernel, settings);
    const fallback = kernel.handler;
    Object.assign(state, {
        people, reads: [], gates: [], duplicatePage: false, effectiveLimit: undefined, aliasFails: false, profileFails: false,
        orgDocId: "20261017000000-org0001", orgName: "独立单位",
        store: new Map([
            [PERSON_ALIAS_STORAGE_KEY, { schemaVersion: 1, aliases: [] }],
            [ORG_MEMBERSHIP_STORAGE_KEY, { schemaVersion: 1, memberships: [] }],
        ]),
    });
    state.plugin = {
        loadData: async (key) => {
            if (key === PERSON_ALIAS_STORAGE_KEY && state.aliasFails) throw new Error("搜索夹具别名读取失败");
            if (key === ORG_MEMBERSHIP_STORAGE_KEY && state.profileFails) throw new Error("搜索夹具单位读取失败");
            return structuredClone(state.store.get(key) ?? "");
        },
        saveData: async () => { throw new Error("搜索完整性回归必须保持只读"); },
    };
    bindSelfIdentityStorage(state.plugin);
    const unbindProfiles = bindPeopleProfileStorage(state.plugin);
    const unbindAliases = bindContactAliasStorage(state.plugin);
    state.holdPage = (page) => {
        let release;
        const gate = { page, started: false, consumed: false, promise: new Promise((resolve) => { release = resolve; }), release: () => release() };
        state.gates.push(gate);
        return gate;
    };
    state.dispose = () => {
        state.gates.forEach((gate) => gate.release());
        unbindAliases(); unbindProfiles();
    };
    kernel.handler = async (route, body) => {
        if (route === "/api/av/renderAttributeView") {
            const request = { page: body.page ?? 1, pageSize: body.pageSize, query: body.query ?? "" };
            state.reads.push(request);
            const keyword = request.query.toLowerCase();
            const matching = state.people.filter((entry) => !keyword || entry.name.toLowerCase().includes(keyword));
            const effectivePageSize = Math.min(request.pageSize, state.effectiveLimit ?? request.pageSize);
            let entries = matching.slice((request.page - 1) * effectivePageSize, request.page * effectivePageSize);
            if (state.duplicatePage && request.page === 2) entries = [matching[0]];
            const response = { view: {
                columns: FIELD_SPECS.map((field) => ({ id: field.key, name: field.nameZh, type: field.type })),
                rows: structuredClone(entries.map(row)), rowCount: matching.length,
            } };
            // Capture the response before waiting: revision replacement must not change this old payload.
            const gate = state.gates.find((candidate) => !candidate.consumed && candidate.page === request.page);
            if (gate) { gate.started = true; gate.consumed = true; await gate.promise; }
            return response;
        }
        if (route === "/api/query/sql") {
            if (body.stmt.includes("GROUP BY root_id")) return [{ root_id: state.orgDocId, ial: '{: custom-lvct-org="1"}', markerCount: 1 }];
            if (body.stmt.includes("id IN")) return [{ id: state.orgDocId, content: state.orgName, hpath: `/${state.orgName}`, box: settings.notebookId }];
        }
        return fallback(route, body);
    };
    return state;
}

function mountPeople(fixture, settings, query = "") {
    const revision = writable(0);
    const currentRevision = fromStore(revision);
    const component = mount(PeopleView, { target: fixture, props: {
        settings, preferences: { ...DEFAULT_VIEW_PREFERENCES, peopleView: "card" },
        get revision() { return currentRevision.current; }, externalSearch: query,
        initialSort: "name", loadRecentInteractions: async () => ({}),
        onOpenDetail() {}, onPreferencesChange: async (next) => next,
    } });
    return { component, revision };
}

function search(fixture, value) {
    const input = fixture.querySelector("input[placeholder*='搜索姓名']");
    if (!input) throw new Error("搜索完整性夹具缺少联系人搜索框");
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
}
const cards = (fixture) => [...fixture.querySelectorAll(".lvct-person-card")].map((entry) => entry.dataset.personItemId);
const allButton = (fixture) => [...fixture.querySelectorAll("button")].find((entry) => entry.textContent.trim().startsWith("选择全部筛选（"));
const complete = (fixture) => fixture.textContent.includes("已读取完整名册");
const finalEmpty = (fixture) => fixture.textContent.includes("当前筛选下没有联系人") || fixture.textContent.includes("还没有联系人");
function readBudget(assert, state, expectedPages, expectedSizes = expectedPages.map(() => 200)) {
    assert(state.reads.every((entry, index) => entry.query === "" && entry.pageSize === expectedSizes[index]), `搜索向 AV 下推 query 或分页越界：${JSON.stringify(state.reads)}`);
    assert(JSON.stringify(state.reads.map((entry) => entry.page)) === JSON.stringify(expectedPages), `名册重复读取或遗漏页：${JSON.stringify(state.reads)}`);
}
async function dispose(component, state) {
    await unmount(component);
    state.dispose();
    await tick();
}

export async function runSearchCompletenessRegression({ test, assert, kernel, settings, fixture, until, button }) {
    await test("搜索完整性：姓名、无关系别名和独立单位混合命中，共用一次未过滤投影", async () => {
        const people = [person(1, "星辰姓名"), person(2, "独立别名人物"), person(3, "独立单位人物"), person(4, "不相关人物")];
        const state = searchFixture(kernel, settings, people);
        state.orgName = "星辰单位";
        state.store.set(PERSON_ALIAS_STORAGE_KEY, { schemaVersion: 1, aliases: [{ id: "20261017000000-alias01", personDocId: people[1].docId, alias: "星辰别名", createdAt: 1, updatedAt: 1 }] });
        state.store.set(ORG_MEMBERSHIP_STORAGE_KEY, { schemaVersion: 1, memberships: [{ id: "20261017000000-member1", orgDocId: state.orgDocId, personDocId: people[2].docId, status: "active", affiliationKind: "work", joinedOn: "", leftOn: "", department: "研发", title: "工程师" }] });
        const { component } = mountPeople(fixture, settings, "星辰");
        try {
            await until(() => complete(fixture), "混合搜索名册未完成");
            assert(cards(fixture).length === 3 && people.slice(0, 3).every((entry) => cards(fixture).includes(entry.itemId)), "姓名命中遮蔽了无关系别名或独立单位命中");
            assert(!allButton(fixture).disabled && allButton(fixture).textContent.includes("3 人"), "混合完整结果未允许选择全部筛选");
            readBudget(assert, state, [1]);
        } finally { await dispose(component, state); }
    });

    await test("搜索完整性：201 个基础命中仍包含后页正反关系邻居，每个名册页只读一次", async () => {
        const people = Array.from({ length: 204 }, (_, index) => person(index + 1, index < 201 ? `跨页命中${String(index).padStart(4, "0")}` : `独立邻居${index}`));
        people[0].related = [people[201].itemId];
        people[202].related = [people[0].itemId];
        const state = searchFixture(kernel, settings, people);
        const { component } = mountPeople(fixture, settings, "跨页命中");
        try {
            await until(() => complete(fixture), "201 基础命中的后页未完成");
            assert(allButton(fixture).textContent.includes("203 人") && !allButton(fixture).disabled, "超过 200 个直命中时遗漏后页正向或反向关系邻居");
            const more = [...fixture.querySelectorAll("button")].find((entry) => entry.textContent.includes("加载更多"));
            assert(more, "203 结果缺少显示更多入口"); more.click();
            await until(() => cards(fixture).length === 203, "搜索结果显示更多后未达 203 人");
            assert(cards(fixture).includes(people[201].itemId) && cards(fixture).includes(people[202].itemId) && !cards(fixture).includes(people[203].itemId), "跨页关系扩展范围错误");
            readBudget(assert, state, [1, 2]);
        } finally { await dispose(component, state); }
    });

    await test("搜索完整性：零命中必须等全部页读取，挂起时不宣称空结果或允许全部筛选", async () => {
        const state = searchFixture(kernel, settings, Array.from({ length: 201 }, (_, index) => person(index + 1)));
        const gate = state.holdPage(2);
        const { component } = mountPeople(fixture, settings, "完全不存在");
        try {
            await until(() => gate.started, "零命中未继续读取未过滤后页");
            assert(!finalEmpty(fixture) && !complete(fixture) && allButton(fixture).disabled, "后页挂起时提前宣称零命中或全部完整");
            gate.release();
            await until(() => fixture.textContent.includes("当前筛选下没有联系人"), "完整读取后没有给出真实零命中反馈");
            assert(cards(fixture).length === 0 && allButton(fixture).disabled, "零命中仍有旧卡片或可批量选择");
            readBudget(assert, state, [1, 2]);
        } finally { await dispose(component, state); }
    });

    await test("搜索完整性：跨页重复行拒绝收口，不标完整且禁止全部筛选", async () => {
        const state = searchFixture(kernel, settings, Array.from({ length: 201 }, (_, index) => person(index + 1, `重复校验${index}`)));
        state.duplicatePage = true;
        const { component } = mountPeople(fixture, settings, "重复校验");
        try {
            await until(() => fixture.textContent.includes("分页出现重复行"), "跨页重复没有可恢复错误反馈");
            assert(!complete(fixture) && allButton(fixture).disabled && new Set(cards(fixture)).size === cards(fixture).length, "重复页被当作完整名册或重复展示");
            readBudget(assert, state, [1, 2]);
        } finally { await dispose(component, state); }
    });

    await test("搜索完整性：2001 人按十页预算暂停，显式继续只读第十一页并找回末页命中", async () => {
        const people = Array.from({ length: 2001 }, (_, index) => person(index + 1));
        people[2000].name = "预算后页唯一命中";
        const state = searchFixture(kernel, settings, people);
        const { component } = mountPeople(fixture, settings, "预算后页");
        try {
            await until(() => state.reads.length >= 10 && [...fixture.querySelectorAll("button")].some((entry) => entry.textContent.trim() === "继续读取" && !entry.disabled), "2000 人本段预算没有暂停并提供显式续读");
            assert(!complete(fixture) && !finalEmpty(fixture) && allButton(fixture).disabled && cards(fixture).length === 0, "2000 人预算暂停被误报为完整零结果");
            readBudget(assert, state, Array.from({ length: 10 }, (_, index) => index + 1));
            button("继续读取").click();
            await until(() => complete(fixture) && cards(fixture).join() === people[2000].itemId && !allButton(fixture).disabled, "显式续读后第 2001 人仍未命中或范围未完整");
            readBudget(assert, state, Array.from({ length: 11 }, (_, index) => index + 1));
            assert(allButton(fixture).textContent.includes("1 人"), "预算续读扩张了当前关键词的选择范围");
        } finally { await dispose(component, state); }
    });

    await test("搜索完整性：内核将 200 收窄为 50 时沿有效页宽读取至第五页，201 人无遗漏", async () => {
        const people = Array.from({ length: 201 }, (_, index) => person(index + 1, `收窄分页${String(index).padStart(4, "0")}`));
        const state = searchFixture(kernel, settings, people);
        state.effectiveLimit = 50;
        const { component } = mountPeople(fixture, settings, "收窄分页");
        try {
            await until(() => complete(fixture) && allButton(fixture).textContent.includes("201 人"), "内核限页后未完整读取 201 人");
            assert(!allButton(fixture).disabled, "有效页宽读取完整后仍禁止选择全部筛选");
            readBudget(assert, state, [1, 2, 3, 4, 5], [200, 50, 50, 50, 50]);
            const more = [...fixture.querySelectorAll("button")].find((entry) => entry.textContent.includes("加载更多"));
            assert(more, "内核限页后的完整结果缺少显示更多入口"); more.click();
            await until(() => cards(fixture).length === 201, "限页读取后的第 201 人未展示");
            assert(new Set(cards(fixture)).size === 201 && people.every((entry) => cards(fixture).includes(entry.itemId)), "有效页宽变化导致跨页重复或丢人");
        } finally { await dispose(component, state); }
    });

    await test("搜索完整性：后页挂起切关键词只用最新投影，完整后多次切词零额外名册读取", async () => {
        const people = Array.from({ length: 201 }, (_, index) => person(index + 1));
        people[0].name = "首屏甲"; people[200].name = "后页乙";
        const state = searchFixture(kernel, settings, people);
        const gate = state.holdPage(2);
        const { component } = mountPeople(fixture, settings, "首屏甲");
        try {
            await until(() => gate.started && cards(fixture).includes(people[0].itemId), "切词前首屏或后页挂起未就绪");
            assert(allButton(fixture).disabled, "后页未完成仍允许选择全部筛选");
            search(fixture, "后页乙"); await tick();
            assert(!finalEmpty(fixture) && allButton(fixture).disabled, "切词在未读完时误报最终空结果");
            gate.release();
            await until(() => complete(fixture) && cards(fixture).join() === people[200].itemId, "后页响应沿用了旧关键词或漏掉新关键词命中");
            for (const [query, expected] of [["首屏甲", people[0].itemId], ["后页乙", people[200].itemId], ["完全不存在", ""]]) {
                search(fixture, query);
                await until(() => cards(fixture).join() === expected, "完整投影切词没有立即重新求值");
            }
            // Cover the former 250 ms remote-search debounce, rather than only observing one microtask.
            await pause(350);
            readBudget(assert, state, [1, 2]);
        } finally { await dispose(component, state); }
    });

    await test("搜索完整性：停止后页保留未完成范围，恢复只续原页且迟到响应不串结果", async () => {
        const people = Array.from({ length: 201 }, (_, index) => person(index + 1));
        people[0].name = "暂停首屏"; people[200].name = "恢复后页";
        const state = searchFixture(kernel, settings, people);
        const gate = state.holdPage(2);
        const { component } = mountPeople(fixture, settings, "恢复后页");
        try {
            await until(() => gate.started, "暂停前后页未开始");
            button("停止继续读取").click(); await tick();
            assert(!complete(fixture) && !finalEmpty(fixture) && allButton(fixture).disabled, "主动停止被当作完整零结果");
            gate.release(); await pause(30); await tick();
            assert(!complete(fixture) && cards(fixture).length === 0, "停止后的迟到页仍回填");
            search(fixture, "暂停首屏");
            await until(() => cards(fixture).join() === people[0].itemId, "暂停期间未保留已读投影");
            button("继续读取").click();
            await until(() => complete(fixture), "停止后无法从原页继续读取");
            search(fixture, "恢复后页");
            await until(() => cards(fixture).join() === people[200].itemId && !allButton(fixture).disabled, "恢复后页丢失稳定人物或完整范围门禁未恢复");
            readBudget(assert, state, [1, 2, 2]);
        } finally { await dispose(component, state); }
    });

    await test("搜索完整性：revision 换代丢弃旧后页，迟到响应不覆盖新名册与完整范围", async () => {
        const state = searchFixture(kernel, settings, Array.from({ length: 201 }, (_, index) => person(index + 1, `旧版${index}`)));
        const gate = state.holdPage(2);
        const { component, revision } = mountPeople(fixture, settings, "新版");
        try {
            await until(() => gate.started, "revision 换代前后页未挂起");
            const replacement = person(301, "新版唯一");
            state.people = [replacement]; revision.set(1);
            await until(() => complete(fixture) && cards(fixture).join() === replacement.itemId, "新 revision 未替换名册");
            gate.release(); await pause(50); await tick();
            assert(cards(fixture).join() === replacement.itemId && allButton(fixture).textContent.includes("1 人") && !allButton(fixture).disabled, "旧代后页污染了新代结果或范围");
            readBudget(assert, state, [1, 2, 1]);
        } finally { await dispose(component, state); }
    });

    await test("搜索完整性：别名或组织投影未知时禁止全部筛选，revision 核实恢复后放行", async () => {
        for (const source of ["alias", "profile"]) {
            const state = searchFixture(kernel, settings, [person(1, "投影核实姓名")]);
            state.aliasFails = source === "alias"; state.profileFails = source === "profile";
            const { component, revision } = mountPeople(fixture, settings, "投影核实");
            try {
                await until(() => cards(fixture).length === 1 && fixture.textContent.includes(source === "alias" ? "别名读取尚未核实" : "部分组织或称谓资料尚未核实"), "投影读取未知未呈现");
                assert(allButton(fixture).disabled, `${source} 未知仍把姓名命中当作完整搜索范围`);
                state.aliasFails = false; state.profileFails = false; revision.set(1);
                await until(() => !allButton(fixture).disabled, "投影重新核实后全部筛选门禁未恢复");
                readBudget(assert, state, [1, 1]);
                assert(state.creates.length === 0 && state.binds.length === 0 && state.writes.length === 0, "只读搜索发出了写入");
            } finally { await dispose(component, state); }
        }
    });
}
