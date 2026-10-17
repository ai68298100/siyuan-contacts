import { mount, unmount, tick } from "svelte";
import AddPersonDialog from "../../../src/components/people/AddPersonDialog.svelte";
import { emptyDraft } from "../../../src/domain/person";
import { configureVcardKernel } from "./vcard-regression.js";

const ORGS = [
    { docId: "20261017000000-addw001", name: "新建测试工作单位" },
    { docId: "20261017000000-adds001", name: "新建测试归档学校", archived: true },
    { docId: "20261017000000-addf001", name: "家庭" },
];
const copy = (value) => structuredClone(value);
const cards = (root, id) => [...root.querySelectorAll(`.lvct-add-person__org-draft[data-org-doc-id="${id}"]`)];
const trigger = (root) => root.querySelector('button[aria-label="选择组织（可多选）"]');
const search = (root) => root.querySelector('input[aria-label="搜索组织"]');
const chip = (root, id) => root.querySelector(`.lvct-org-multi__chip[data-org-doc-id="${id}"]`);
const control = (root, name) => [...root.querySelectorAll("label")].find((label) => label.querySelector("span")?.textContent.trim() === name)?.querySelector("input,select,textarea");
function set(root, name, value, assert) {
    const input = control(root, name);
    assert(input, `缺少新增组织字段：${name}`);
    const details = input.closest("details");
    if (details && !details.open) details.querySelector("summary").click();
    input.value = value;
    input.dispatchEvent(new Event(input.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
}
async function toggleDetails(details) {
    const toggled = new Promise((resolve) => details.addEventListener("toggle", resolve, { once: true }));
    details.querySelector("summary").click();
    await toggled;
    await tick();
}
async function open(root, until) {
    await until(() => trigger(root) && !trigger(root).disabled, "新建组织多选入口未就绪");
    if (!search(root)) {
        document.querySelector("#results").hidden = true;
        trigger(root).scrollIntoView({ block: "center", behavior: "instant" });
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        trigger(root).click();
    }
    await until(() => search(root), "新建组织多选浮层未打开");
}
async function select(root, orgs, until, input, assert) {
    await open(root, until); input(search(root), ""); await tick();
    for (const org of orgs) {
        const option = [...root.querySelectorAll('.lvct-org-multi__option input[type="checkbox"]')].find((item) => item.getAttribute("aria-label") === org.name || item.getAttribute("aria-label").includes(org.docId));
        assert(option && !option.disabled, `新建候选未启用：${org.name}`);
        if (!option.checked) option.click();
        await until(() => cards(root, org.docId).length, `新建多选没有加入独立经历：${org.name}`);
    }
    trigger(root).click(); await until(() => !search(root), "新建组织浮层未关闭");
}
function setup(settings, kernel, overrides = {}) {
    const data = configureVcardKernel(kernel, settings);
    const state = { candidates: copy(ORGS), details: [], created: [], createRequests: [], createHook: null, saveHook: null, closed: 0 };
    state.props = {
        settings, initial: { ...emptyDraft(), name: "新建多选回归人物", phone: "13800000222" },
        onLoadOrgCandidates: async () => copy(state.candidates),
        onCreateOrganization: async (name) => { state.createRequests.push(name); return state.createHook?.(name); },
        onSaveExtended: async (person, details) => { state.details.push({ person: copy(person), details: copy(details) }); await state.saveHook?.(person, details); },
        onCreated: (person) => { state.created.push(copy(person)); }, onClose: () => { state.closed++; }, ...overrides,
    };
    return { data, state };
}

export async function runAddPersonOrganizationRegression({ test, assert, settings, kernel, fixture, until, button, input }) {
    await test("新建组织多选：同组织当前和历史使用独立身份，折叠与移除前项不串值，失败重试零重复创建", async () => {
        const { data, state } = setup(settings, kernel);
        let rejectExtended = true;
        state.saveHook = async () => { if (rejectExtended) { rejectExtended = false; throw new Error("补充资料首次明确拒绝"); } };
        const instance = mount(AddPersonDialog, { target: fixture, props: state.props });
        try {
            button("补充资料（可选）").click(); await select(fixture, ORGS, until, input, assert);
            const work = cards(fixture, ORGS[0].docId)[0], school = cards(fixture, ORGS[1].docId)[0], family = cards(fixture, ORGS[2].docId)[0];
            assert(!work.querySelector("details").open && !control(work, "归属分类").closest("details") && !control(work, "当前状态").closest("details"), "新增组织没有统一的基础字段和折叠设置");
            set(work, "归属分类", "work", assert); set(work, "部门/院系", "当前部门", assert); set(work, "职位/身份", "当前职位", assert); set(work, "成员备注", "工作当前备注", assert);
            button("补录历史", work).click(); await until(() => cards(fixture, ORGS[0].docId).length === 2, "同组织历史不能独立补录");
            const history = cards(fixture, ORGS[0].docId)[1];
            assert(history.dataset.entryId !== work.dataset.entryId && control(history, "当前状态").value === "former" && control(history, "归属分类").value === "work", "补录历史身份复用、状态或分类不正确");
            assert(control(history, "部门/院系").value === "" && control(history, "成员备注").value === "", "历史经历继承了当前经历私有字段");
            set(history, "开始日期", "2016-01-01", assert); set(history, "结束日期", "2020-01-01", assert); set(history, "成员备注", "工作历史备注", assert);
            set(school, "归属分类", "education", assert); set(school, "开始日期", "2008-09-01", assert); set(school, "结束日期", "2012-06-30", assert); set(school, "成员备注", "学校独立备注", assert);
            assert(control(school, "当前状态").value === "former" && control(school, "当前状态").querySelector('option[value="active"]').disabled, "归档学校仍可登记当前归属");
            assert(control(family, "归属分类").value === "family", "家庭没有默认归属分类");
            set(family, "成员备注", "家庭独立备注", assert);
            const familyNote = control(family, "成员备注"), historyKey = history.dataset.entryId;
            button("移除这条", work).click(); await until(() => fixture.querySelector('[role="alertdialog"][aria-label="取消组织的全部经历"]'), "已填写组织经历移除前没有确认");
            assert(cards(fixture, ORGS[0].docId).length === 2 && control(work, "成员备注").value === "工作当前备注", "移除确认前已删除已填写经历");
            button("确认移除这条经历", fixture.querySelector('[role="alertdialog"]')).click(); await tick();
            assert(cards(fixture, ORGS[0].docId).length === 1 && cards(fixture, ORGS[0].docId)[0] === history && history.dataset.entryId === historyKey, "移除当前经历后历史身份被替换");
            assert(control(family, "成员备注") === familyNote && familyNote.value === "家庭独立备注" && chip(fixture, ORGS[0].docId), "移除前项使其他经历串值或取消整个组织");
            for (const item of [school, family, history]) if (item.querySelector("details").open) await toggleDetails(item.querySelector("details"));
            await tick(); button("创建联系人").click();
            await until(() => fixture.textContent.includes("补充资料首次明确拒绝"), "补充资料失败未保留已创建人物");
            assert(data.creates.length === 1 && state.created.length === 0 && state.details.length === 1, "补充资料失败重复创建或宣称完成");
            const original = state.details[0];
            assert(original.details.orgMemberships.length === 3 && original.details.orgMemberships.find((item) => item.orgDocId === ORGS[0].docId).orgNote === "工作历史备注"
                && original.details.orgMemberships.find((item) => item.orgDocId === ORGS[1].docId).orgNote === "学校独立备注"
                && original.details.orgMemberships.find((item) => item.orgDocId === ORGS[2].docId).orgNote === "家庭独立备注", "折叠保存丢失组织字段或条目串值");
            button("继续保存补充资料").click(); await until(() => state.created.length === 1, "补充资料失败后未复用人物继续保存");
            assert(data.creates.length === 1 && state.details[1].person.docId === original.person.docId
                && JSON.stringify(state.details[1].details) === JSON.stringify(original.details), "重试重复人物或改变已保留的组织草稿");
        } finally { await unmount(instance); }
    });
    await test("新建组织多选：取消整组历史须明确确认，保留与 Esc 零丢失，确认只移除目标组织", async () => {
        const { data, state } = setup(settings, kernel);
        const instance = mount(AddPersonDialog, { target: fixture, props: state.props });
        const confirm = () => fixture.querySelector('[role="alertdialog"][aria-label="取消组织的全部经历"]');
        try {
            button("补充资料（可选）").click(); await select(fixture, [ORGS[0], ORGS[2]], until, input, assert);
            const work = cards(fixture, ORGS[0].docId)[0];
            set(work, "成员备注", "保留当前草稿", assert); button("补录历史", work).click(); await tick();
            const history = cards(fixture, ORGS[0].docId)[1]; set(history, "成员备注", "保留历史草稿", assert);
            const before = [work, history].map((item) => ({ id: item.dataset.entryId, note: control(item, "成员备注").value }));
            chip(fixture, ORGS[0].docId).querySelector("button").click(); await until(confirm, "取消多段组织没有确认明细");
            assert(confirm().textContent.includes("2 条未保存经历") && cards(fixture, ORGS[0].docId).length === 2, "确认前已删除组织经历或数量错误");
            assert(button("创建联系人").disabled && trigger(fixture).disabled, "整组移除未决时仍允许创建人物或更改选择");
            button("创建联系人").click(); await tick();
            assert(data.creates.length === 0 && state.details.length === 0 && state.created.length === 0, "整组移除未决时已写入人物或补充资料");
            button("保留经历", confirm()).click(); await until(() => !confirm(), "保留经历未取消整组移除");
            await until(() => !button("创建联系人").disabled && !trigger(fixture).disabled, "保留经历后创建与多选入口未恢复");
            chip(fixture, ORGS[0].docId).querySelector("button").click(); await until(confirm, "再次整组移除未确认");
            confirm().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
            await until(() => !confirm() && document.activeElement === trigger(fixture), "整组移除 Esc 未保留经历并恢复多选入口");
            assert(!button("创建联系人").disabled && data.creates.length === 0 && state.details.length === 0, "整组移除 Esc 后入口未恢复或产生写入");
            assert(JSON.stringify(cards(fixture, ORGS[0].docId).map((item) => ({ id: item.dataset.entryId, note: control(item, "成员备注").value }))) === JSON.stringify(before), "取消整组移除覆盖了当前或历史草稿");
            chip(fixture, ORGS[0].docId).querySelector("button").click(); await until(confirm, "确认整组移除入口未打开");
            button("确认移除全部经历", confirm()).click(); await until(() => !cards(fixture, ORGS[0].docId).length && !chip(fixture, ORGS[0].docId), "明确确认未取消整组选择");
            assert(cards(fixture, ORGS[2].docId).length === 1 && data.creates.length === 0 && state.details.length === 0, "整组取消影响其他组织或产生人物写入");
        } finally { await unmount(instance); }
    });
    await test("新建组织多选：搜索创建返回按稳定身份加入，取消保留人物与多段经历，重新读取不丢折叠设置", async () => {
        const { data, state } = setup(settings, kernel);
        const created = { docId: "20261017000000-addn001", name: "新建人物里的新组织" };
        const instance = mount(AddPersonDialog, { target: fixture, props: state.props });
        try {
            button("补充资料（可选）").click(); await select(fixture, [ORGS[0]], until, input, assert);
            const work = cards(fixture, ORGS[0].docId)[0]; set(work, "成员备注", "新建组织前的备注", assert);
            set(fixture.querySelector("#lvct-contact-extra-body"), "与我的关系称谓", "新建前称谓", assert);
            const details = work.querySelector("details"); await toggleDetails(details);
            await open(fixture, until); input(search(fixture), created.name); await tick();
            button("新建组织", fixture.querySelector(".lvct-add-person__org-selector")).click();
            await until(() => state.createRequests.length === 1 && !trigger(fixture).disabled, "取消新建后组织入口未恢复");
            assert(state.createRequests[0] === created.name && control(work, "成员备注").value === "新建组织前的备注"
                && control(fixture, "与我的关系称谓").value === "新建前称谓", "取消组织创建丢搜索词或人物草稿");
            state.createHook = async () => { state.candidates.push({ ...created, docId: "20261017000000-addn002" }, created); return created; };
            await open(fixture, until); input(search(fixture), created.name); await tick(); button("新建组织", fixture.querySelector(".lvct-add-person__org-selector")).click();
            await until(() => cards(fixture, created.docId).length === 1, "新建组织未根据回传身份自动加入");
            assert(!cards(fixture, "20261017000000-addn002").length && cards(fixture, ORGS[0].docId)[0] === work, "同名匹配替代了创建身份或重建人物草稿");
            button("重新读取", fixture.querySelector("#lvct-contact-extra-body")).click();
            await until(() => !trigger(fixture).disabled, "组织重新读取没有完成");
            assert(work.querySelector("details") === details && !details.open && control(work, "成员备注").value === "新建组织前的备注", "候选重读丢失折叠状态或经历字段");
            assert(data.creates.length === 0 && state.details.length === 0 && fixture.querySelector('input[type="tel"]').value === "13800000222", "组织创建提前写入人物或覆盖基础资料");
        } finally { await unmount(instance); }
    });
}
