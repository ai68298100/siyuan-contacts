import { mount, unmount, tick } from "svelte";
import PersonEditDialog from "../../../src/components/people/PersonEditDialog.svelte";
import Workbench from "../../../src/components/Workbench.svelte";
import { DEFAULT_VIEW_PREFERENCES } from "../../../src/domain/preferences";
import { svelteDialog } from "../../../src/libs/dialog";

const ORGS = [
    { docId: "20261017000000-work001", name: "多选测试公司" },
    { docId: "20261017000000-scho001", name: "多选测试学校" },
    { docId: "20261017000000-fami001", name: "多选测试家庭" },
];
const copy = (value) => structuredClone(value);
const card = (root, id) => root.querySelector(`.lvct-person-edit__org-draft[data-org-doc-id="${id}"]`);
const relationInput = (root) => root.querySelector('.lvct-person-edit__profile input[maxlength="1600"]');
const searchInput = (root) => root.querySelector('input[aria-label="搜索组织"]');
const trigger = (root) => root.querySelector('button[aria-label="选择组织（可多选）"]');
const chip = (root, id) => root.querySelector(`.lvct-org-multi__chip[data-org-doc-id="${id}"]`);
const pickerStatus = (root) => root.querySelector('.lvct-org-multi__status[role="status"]');

async function trustedOrgKey(root, target, action, assert) {
    const key = { enter: "Enter", space: " ", arrowdown: "ArrowDown", arrowup: "ArrowUp", home: "Home", end: "End" }[action];
    let trusted = false;
    const observe = (event) => { if (root.contains(event.target) && event.key === key) trusted = event.isTrusted; };
    root.addEventListener("keydown", observe, true);
    const requestId = `org-key-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    try {
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => { window.removeEventListener("lvct:trusted-click-done", complete); reject(new Error("组织键盘真实输入超时")); }, 5000);
            function complete(event) {
                if (event.detail?.requestId !== requestId) return;
                clearTimeout(timeout); window.removeEventListener("lvct:trusted-click-done", complete);
                if (event.detail.error) reject(new Error(`${target}/${action}: ${event.detail.error}`)); else resolve();
            }
            window.addEventListener("lvct:trusted-click-done", complete);
            window.__lvctTrustedClick(JSON.stringify({ requestId, target, action }));
        });
        assert(trusted, `组织 ${action} 回归必须使用 Chrome 真实键盘事件`);
        await tick();
    } finally { root.removeEventListener("keydown", observe, true); }
}

function editorState(settings, person, candidates = ORGS, memberships = []) {
    const state = { candidates: copy(candidates), memberships: copy(memberships), added: [], updated: [], removed: [],
        relationship: null, relationReads: 0, relationWrites: [], membershipReads: 0, saved: 0, closed: 0,
        createRequests: [], createHook: null, addHook: null, loadHook: null };
    state.commitMembership = ({ personDocId, orgDocId, extra }) => {
        const membership = { id: `20261017000000-mem${String(state.memberships.length).padStart(4, "0")}`,
            personDocId, orgDocId, orgName: state.candidates.find((org) => org.docId === orgDocId)?.name,
            reachable: true, archived: false, department: "", title: "", joinedOn: "", leftOn: "", ...copy(extra) };
        state.memberships.push(membership);
        return { fact: "verified", membership: copy(membership), projections: [] };
    };
    state.props = {
        settings, person,
        onLoadRelationshipLabels: async () => { state.relationReads++; return { selfDocId: "20261017000000-self001", record: copy(state.relationship) }; },
        onSaveRelationshipLabels: async (personDocId, selfDocId, labels) => {
            state.relationWrites.push(copy(labels));
            state.relationship = { id: "20261017000000-labe001", selfDocId, personDocId, labels: copy(labels), createdAt: 1, updatedAt: 2 };
            return copy(state.relationship);
        },
        onLoadOrgMemberships: async () => {
            state.membershipReads++;
            if (state.loadHook) return state.loadHook();
            // 真实 PersonOrgMembershipView 由人物上下文提供身份，不重复携带 personDocId。
            return copy(state.memberships).map(({ personDocId: _personDocId, ...membership }) => membership);
        },
        onLoadOrgCandidates: async () => copy(state.candidates),
        onCreateOrganization: async (name) => { state.createRequests.push(name); return state.createHook?.(name); },
        onAddOrgMembership: async (personDocId, orgDocId, extra) => {
            const call = { personDocId, orgDocId, extra: copy(extra) };
            state.added.push(call);
            const result = await state.addHook?.(call, () => state.commitMembership(call));
            return result ?? state.commitMembership(call);
        },
        onUpdateOrgMembership: async (...args) => { state.updated.push(copy(args)); },
        onRemoveOrgMembership: async (...args) => { state.removed.push(copy(args)); },
        onSaved: () => { state.saved++; }, onClose: () => { state.closed++; },
    };
    return state;
}

function field(root, name) {
    return [...root.querySelectorAll("label")].find((label) => label.querySelector("span")?.textContent.trim() === name)
        ?.querySelector("input, select, textarea");
}
function setField(root, name, value, assert) {
    const control = field(root, name);
    assert(control, `未找到组织草稿字段：${name}`);
    const details = control.closest("details");
    if (details && !details.open) details.querySelector("summary").click();
    control.value = value;
    control.dispatchEvent(new Event(control instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
}
async function toggleDetails(details) {
    const toggled = new Promise((resolve) => details.addEventListener("toggle", resolve, { once: true }));
    details.querySelector("summary").click();
    // Native toggle is a task, whereas Svelte tick only drains microtasks.
    // Wait for bind:open to observe this user interaction before the next click.
    await toggled;
    await tick();
}
async function openPicker(root, until) {
    await until(() => trigger(root) && !trigger(root).disabled, "组织多选入口未就绪");
    if (!searchInput(root)) {
        // 完整回归的结果位于 fixture 之前；先稳定视口，避免焦点滚动被产品按外部滚动关闭。
        document.querySelector("#results").hidden = true;
        trigger(root).scrollIntoView({ block: "center", behavior: "instant" });
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        trigger(root).click();
    }
    await until(() => searchInput(root), "组织搜索浮层未打开");
}
function checkbox(root, org) {
    return [...root.querySelectorAll('.lvct-org-multi__option input[type="checkbox"]')].find((entry) => {
        const label = entry.getAttribute("aria-label") ?? "";
        return label === org.name || label.includes(org.docId);
    });
}
async function selectOrgs(root, orgs, until, assert, input) {
    await openPicker(root, until);
    input(searchInput(root), "");
    await tick();
    for (const org of orgs) {
        const option = checkbox(root, org);
        assert(option && !option.disabled, `组织候选未启用：${org.name}`);
        if (!option.checked) option.click();
        await until(() => card(root, org.docId), `多选后未生成独立草稿：${org.name}`);
    }
    trigger(root).click();
    await until(() => !searchInput(root), "组织浮层未关闭");
}

export async function runPersonEditOrganizationRegression({ test, assert, settings, person, fixture, until, button, input }) {
    const select = (orgs) => selectOrgs(fixture, orgs, until, assert, input);
    const set = (id, name, value) => setField(card(fixture, id), name, value, assert);
    await test("组织多选编辑：逐项保存工作、学校与家庭的分类、状态、日期和备注", async () => {
        const state = editorState(settings, person);
        const instance = mount(PersonEditDialog, { target: fixture, props: state.props });
        try {
            await until(() => relationInput(fixture), "称谓输入未读取");
            input(relationInput(fixture), "同事、朋友");
            await select(ORGS);
            const values = [
                { affiliationKind: "work", status: "active", department: "研发部", title: "工程师", joinedOn: "2021-04-01", leftOn: "", statusLabel: "兼职", note: "仅工作日联系" },
                { affiliationKind: "education", status: "former", department: "计算机系", title: "学生", joinedOn: "2008-09-01", leftOn: "2012-06-30", statusLabel: "已毕业", note: "保留大学经历" },
                { affiliationKind: "family", status: "active", department: "", title: "家人", joinedOn: "", leftOn: "", statusLabel: "", note: "家庭备注" },
            ];
            for (const [index, org] of ORGS.entries()) {
                set(org.docId, "归属分类", values[index].affiliationKind);
                set(org.docId, "当前状态", values[index].status);
                await tick();
                for (const [label, key] of [["部门/院系", "department"], ["职位/身份", "title"], ["开始日期", "joinedOn"], ["结束日期", "leftOn"], ["自定义状态", "statusLabel"], ["成员备注", "note"]]) set(org.docId, label, values[index][key]);
            }
            button("保存组织与称谓").click();
            await until(() => state.saved > 0 && state.added.length === 3, "多条组织归属未保存");
            assert(state.relationship?.labels.join("、") === "同事、朋友", "多选保存丢失称谓");
            for (const [index, org] of ORGS.entries()) {
                const call = state.added.find((entry) => entry.orgDocId === org.docId);
                assert(call?.personDocId === person.docId, "组织归属写到其他人物");
                for (const [key, value] of Object.entries(values[index])) assert((call.extra[key] ?? "") === value, `${org.name} 的 ${key} 串值`);
            }
            assert(state.updated.length === 0 && state.removed.length === 0, "新增多选修改了已有经历");
            assert(fixture.querySelectorAll(".lvct-person-edit__org-draft").length === 0, "已保存项仍留在待保存队列");
        } finally { await unmount(instance); }
    });
    await test("组织多选编辑：本人可同时选择工作和学校且跳过自身称谓", async () => {
        const state = editorState(settings, { ...person, isSelf: true });
        state.props.onLoadRelationshipLabels = async () => { throw new Error("本人不应读取自身称谓"); };
        const instance = mount(PersonEditDialog, { target: fixture, props: state.props });
        try {
            await select(ORGS.slice(0, 2));
            assert(!relationInput(fixture), "本人仍显示自身称谓");
            set(ORGS[0].docId, "归属分类", "work"); set(ORGS[1].docId, "归属分类", "education");
            button("保存组织与称谓").click();
            await until(() => state.added.length === 2 && state.saved > 0, "本人多条组织归属未保存");
            assert(state.added.every((entry) => entry.personDocId === person.docId), "本人组织归属写到其他人物");
        } finally { await unmount(instance); }
    });
    await test("组织多选编辑：取消并放弃草稿时零成员与称谓写入", async () => {
        const state = editorState(settings, person);
        const instance = mount(PersonEditDialog, { target: fixture, props: state.props });
        try {
            await select(ORGS.slice(0, 2));
            set(ORGS[0].docId, "成员备注", "未保存备注"); input(relationInput(fixture), "未保存称谓");
            button("取消").click();
            await until(() => document.querySelector(".lvct-closeguard"), "取消多选没有保护草稿");
            assert(state.added.length === 0 && state.relationWrites.length === 0, "取消前已经写入");
            document.querySelector('.lvct-closeguard button[data-choice="discard"]').click();
            await until(() => state.closed === 1, "放弃草稿未关闭");
            assert(state.added.length === 0 && state.relationWrites.length === 0 && state.removed.length === 0, "放弃草稿产生写入");
        } finally { await unmount(instance); }
    });
    await test("组织多选编辑原生弹窗：Esc 只收选择浮层，保留称谓与多选草稿且不触发关闭守卫", async () => {
        const state = editorState(settings, person);
        const dialog = svelteDialog({ title: "编辑人物资料", component: PersonEditDialog, props: state.props });
        const root = dialog.dialog.element;
        try {
            await selectOrgs(root, [ORGS[0]], until, assert, input);
            input(relationInput(root), "原生弹窗未保存称谓");
            setField(card(root, ORGS[0].docId), "成员备注", "原生弹窗未保存经历", assert);
            for (const source of ["search", "trigger"]) {
                await openPicker(root, until);
                const target = source === "search" ? searchInput(root) : trigger(root);
                target.focus({ preventScroll: true });
                target.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
                await until(() => !searchInput(root), "原生组织选择浮层未被 Esc 收起");
                assert(root.isConnected && !document.querySelector(".lvct-closeguard"), "选择浮层 Esc 误关闭编辑页或打开关闭守卫");
                assert(document.activeElement === trigger(root), "选择浮层 Esc 未恢复组织入口焦点");
                assert(relationInput(root).value === "原生弹窗未保存称谓"
                    && field(card(root, ORGS[0].docId), "成员备注").value === "原生弹窗未保存经历", "选择浮层 Esc 丢失人物编辑草稿");
            }
            assert(state.added.length === 0 && state.relationWrites.length === 0, "关闭选择浮层产生写入");
            trigger(root).dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
            await until(() => document.querySelector(".lvct-closeguard"), "收起浮层后外层 Esc 未保护人物草稿");
            document.querySelector('.lvct-closeguard button[data-choice="discard"]').click();
            await until(() => !root.isConnected, "放弃人物草稿未关闭原生弹窗");
        } finally { if (root.isConnected) dialog.close(); }
    });
    await test("组织多选编辑：中间一条失败后只重试剩余项，不重发成功组织", async () => {
        const state = editorState(settings, person);
        let rejectSchool = true;
        state.addHook = async ({ orgDocId }) => { if (orgDocId === ORGS[1].docId && rejectSchool) { rejectSchool = false; throw new Error("学校成员明确保存失败"); } };
        const instance = mount(PersonEditDialog, { target: fixture, props: state.props });
        try {
            await select(ORGS);
            for (const org of ORGS) set(org.docId, "成员备注", `${org.name}独立草稿`);
            button("保存组织与称谓").click();
            await until(() => fixture.textContent.includes("学校成员明确保存失败"), "部分失败没有反馈");
            assert(state.added.map((entry) => entry.orgDocId).join() === ORGS.slice(0, 2).map((org) => org.docId).join(), "首次保存未在失败项停止");
            assert(!card(fixture, ORGS[0].docId) && card(fixture, ORGS[1].docId) && card(fixture, ORGS[2].docId), "部分失败丢失剩余项或成功项未出队");
            button("保存组织与称谓").click();
            await until(() => state.added.length === 4 && !card(fixture, ORGS[2].docId), "重试剩余组织未完成");
            assert(state.added.map((entry) => entry.orgDocId).join() === [ORGS[0].docId, ORGS[1].docId, ORGS[1].docId, ORGS[2].docId].join(), "重试重发成功组织或漏项");
            assert(state.memberships.length === 3 && state.added.every((entry) => entry.extra.note === `${state.candidates.find((org) => org.docId === entry.orgDocId).name}独立草稿`), "部分恢复丢备注或重复建成员");
        } finally { await unmount(instance); }
    });
    await test("组织多选编辑：回执丢失后先按完整草稿回读，核实已保存项后继续剩余组织", async () => {
        const state = editorState(settings, person);
        let loseResponse = true;
        state.addHook = async ({ orgDocId }, commit) => {
            if (orgDocId === ORGS[1].docId && loseResponse) {
                loseResponse = false;
                commit();
                throw new Error("组织已写入但保存响应丢失");
            }
        };
        const instance = mount(PersonEditDialog, { target: fixture, props: state.props });
        try {
            await select(ORGS);
            set(ORGS[1].docId, "归属分类", "education");
            set(ORGS[1].docId, "部门/院系", "完整核对院系");
            set(ORGS[1].docId, "成员备注", "回读也必须保留的备注");
            button("保存组织与称谓").click();
            await until(() => fixture.textContent.includes("组织已写入但保存响应丢失"), "未知保存结果未反馈");
            assert(field(card(fixture, ORGS[1].docId), "成员备注").disabled, "未知结果仍允许覆盖原输入");
            await openPicker(fixture, until);
            assert(checkbox(fixture, ORGS[1])?.checked && checkbox(fixture, ORGS[1]).disabled, "待核实草稿仍可在多选浮层取消");
            trigger(fixture).click(); await until(() => !searchInput(fixture), "核实前浮层未关闭");
            const before = state.membershipReads;
            button("保存组织与称谓").click();
            await until(() => !card(fixture, ORGS[2].docId), "核实成功后没有继续剩余组织");
            assert(state.membershipReads > before, "未知结果未先重读成员事实");
            assert(state.added.map((entry) => entry.orgDocId).join() === ORGS.map((org) => org.docId).join(), "回执丢失后重复发送已写入项");
            assert(state.memberships.length === 3 && state.memberships[1].department === "完整核对院系" && state.memberships[1].note === "回读也必须保留的备注", "完整字段核实丢失或重复成员");
        } finally { await unmount(instance); }
    });
    await test("组织多选编辑：未知结果的回读失败不发送重试，恢复读取后沿用原输入", async () => {
        const state = editorState(settings, person);
        let rejectFirst = true;
        state.addHook = async () => { if (rejectFirst) { rejectFirst = false; throw new Error("首次保存响应未知"); } };
        const instance = mount(PersonEditDialog, { target: fixture, props: state.props });
        try {
            await select([ORGS[0]]); set(ORGS[0].docId, "成员备注", "只能重试这份原输入");
            button("保存组织与称谓").click();
            await until(() => fixture.textContent.includes("首次保存响应未知"), "首次未知响应未反馈");
            const attempted = copy(state.added[0]);
            state.loadHook = async () => { throw new Error("核实成员暂不可读取"); };
            button("保存组织与称谓").click();
            await until(() => fixture.textContent.includes("核实成员暂不可读取"), "核实读取失败未反馈");
            assert(state.added.length === 1 && card(fixture, ORGS[0].docId), "回读失败仍重发或丢失待核实草稿");
            state.loadHook = null;
            button("保存组织与称谓").click();
            await until(() => state.added.length === 2 && !card(fixture, ORGS[0].docId), "恢复读取后未完成原输入重试");
            assert(JSON.stringify(state.added[1]) === JSON.stringify(attempted), "重试变更了尚未核实的原输入");
            assert(state.memberships.length === 1, "恢复读取后的重试重复成员");
        } finally { await unmount(instance); }
    });
    await test("组织多选编辑：已验证回执的字段不匹配时保留草稿，不把旧经历当本次成功", async () => {
        const state = editorState(settings, person);
        state.addHook = async (call) => {
            const report = state.commitMembership({ ...call, extra: { ...call.extra, department: "后端原有部门", note: "后端原有备注" } });
            return report;
        };
        const instance = mount(PersonEditDialog, { target: fixture, props: state.props });
        try {
            await select([ORGS[0]]); set(ORGS[0].docId, "部门/院系", "本次新部门"); set(ORGS[0].docId, "成员备注", "本次新备注");
            button("保存组织与称谓").click();
            await until(() => fixture.textContent.includes("已有不同的归属记录"), "不同字段的旧回执被误当本次成功");
            assert(card(fixture, ORGS[0].docId) && field(card(fixture, ORGS[0].docId), "成员备注").value === "本次新备注", "回执冲突丢失本次草稿");
            assert(state.saved === 0 && !fixture.textContent.includes("组织归属与关系称谓已保存"), "回执冲突宣称保存成功");
            button("保存组织与称谓").click();
            await until(() => fixture.textContent.includes("已有当前归属"), "回读冲突没有引导核对已有经历");
            assert(state.added.length === 1 && state.memberships[0].department === "后端原有部门", "冲突重试覆盖原经历或发送重复写入");
        } finally { await unmount(instance); }
    });
    await test("组织多选编辑：所有草稿通过校验前零组织与称谓写入", async () => {
        const state = editorState(settings, person);
        const instance = mount(PersonEditDialog, { target: fixture, props: state.props });
        try {
            await select(ORGS.slice(0, 2)); input(relationInput(fixture), "待保存称谓");
            set(ORGS[1].docId, "当前状态", "former"); await tick();
            set(ORGS[1].docId, "开始日期", "2025-09-01"); set(ORGS[1].docId, "结束日期", "2024-06-30");
            button("保存组织与称谓").click();
            await until(() => fixture.textContent.includes("日期无效"), "无效组织日期未反馈");
            assert(state.added.length === 0 && state.relationWrites.length === 0, "后项校验失败前已写入前项或称谓");
            assert(card(fixture, ORGS[0].docId) && card(fixture, ORGS[1].docId) && relationInput(fixture).value === "待保存称谓", "校验失败丢失草稿");
        } finally { await unmount(instance); }
    });
    await test("组织多选编辑：保留已有当前和归档历史，当前候选已选且禁用", async () => {
        const current = { id: "20261017000000-oldm001", orgDocId: "20261017000000-olda001", personDocId: person.docId, orgName: "已有当前单位", status: "active", affiliationKind: "work", department: "原部门", title: "原职位", joinedOn: "2020-01-01", leftOn: "", note: "原备注", archived: false, reachable: true };
        const history = { ...current, id: "20261017000000-oldm002", orgDocId: "20261017000000-oldh001", orgName: "已有归档学校", status: "former", affiliationKind: "education", joinedOn: "2000-09-01", leftOn: "2004-06-30", archived: true };
        const state = editorState(settings, person, [...ORGS, { docId: current.orgDocId, name: current.orgName }, { docId: history.orgDocId, name: history.orgName, archived: true }], [current, history]);
        const original = JSON.stringify(state.memberships);
        const instance = mount(PersonEditDialog, { target: fixture, props: state.props });
        try {
            await openPicker(fixture, until);
            const option = checkbox(fixture, { docId: current.orgDocId, name: current.orgName });
            assert(option?.checked && option.disabled, "已有当前归属仍可重复选择");
            await select([ORGS[0]]); set(ORGS[0].docId, "归属分类", "work");
            button("保存组织与称谓").click();
            await until(() => state.added.length === 1 && state.saved > 0, "新增组织未完成");
            assert(JSON.stringify(state.memberships.slice(0, 2)) === original && state.updated.length === 0 && state.removed.length === 0, "多选新增覆盖或删除旧经历");
            assert(fixture.textContent.includes(current.orgName) && fixture.textContent.includes(history.orgName), "保存后当前或历史经历消失");
        } finally { await unmount(instance); }
    });
    await test("组织多选编辑：已有当前组织可单独补录历史，归档组织只补录已离开经历", async () => {
        const current = { id: "20261017000000-curm001", orgDocId: ORGS[0].docId, personDocId: person.docId, orgName: ORGS[0].name,
            status: "active", affiliationKind: "work", department: "现在部门", title: "现在职位", joinedOn: "2024-01-01", leftOn: "", note: "保留当前事实", archived: false, reachable: true };
        const archived = { ...ORGS[1], archived: true };
        const state = editorState(settings, person, [ORGS[0], archived], [current]);
        const instance = mount(PersonEditDialog, { target: fixture, props: state.props });
        try {
            await until(() => fixture.querySelector(".lvct-person-edit__org-item"), "当前组织经历未读取");
            button("补录历史", fixture.querySelector(".lvct-person-edit__org-item")).click();
            await until(() => card(fixture, current.orgDocId), "已有当前组织不能补录历史");
            assert(field(card(fixture, current.orgDocId), "当前状态").value === "former", "补录历史默认为当前而非已离开");
            set(current.orgDocId, "归属分类", "work"); set(current.orgDocId, "开始日期", "2017-01-01"); set(current.orgDocId, "结束日期", "2019-01-01");
            set(current.orgDocId, "成员备注", "之前的一段工作经历");
            await select([archived]);
            assert(field(card(fixture, archived.docId), "当前状态").value === "former", "归档组织未默认为历史经历");
            assert(field(card(fixture, archived.docId), "当前状态").querySelector('option[value="active"]').disabled, "归档组织仍允许新增当前归属");
            set(archived.docId, "归属分类", "education"); set(archived.docId, "开始日期", "2006-09-01"); set(archived.docId, "结束日期", "2010-06-30");
            button("保存组织与称谓").click();
            await until(() => state.added.length === 2 && !card(fixture, archived.docId), "历史经历未逐条保存");
            assert(JSON.stringify(state.memberships[0]) === JSON.stringify(current) && state.updated.length === 0 && state.removed.length === 0, "补录历史覆盖或删除当前经历");
            assert(state.added.every((entry) => entry.extra.status === "former") && state.memberships.length === 3, "历史补录生成当前重复事实");
        } finally { await unmount(instance); }
    });
    await test("组织多选编辑：成员事实核实但双链未完成时保留结果边界，零重复成员写入", async () => {
        const state = editorState(settings, person);
        state.addHook = async (_call, commit) => ({ ...commit(), projections: [{ docId: person.docId,
            retryKey: `org-projection:person:${person.docId}`, status: "unknown", message: "双链段落读取暂不可用" }] });
        const instance = mount(PersonEditDialog, { target: fixture, props: state.props });
        try {
            await select([ORGS[0]]); button("保存组织与称谓").click();
            await until(() => !card(fixture, ORGS[0].docId) && fixture.querySelector(".lvct-org-membership-result"), "已核实成员事实未出队或无写后反馈");
            const result = fixture.querySelector(".lvct-org-membership-result");
            assert(result.textContent.includes("成员事实已保存并核实") && result.textContent.includes("部分双链尚未核实"), "双链未知被宣称为完整成功或成员失败");
            assert(!result.textContent.includes("双方双链已核实") && button("保存组织与称谓").disabled, "双链未知仍可重发已完成成员");
            assert(state.added.length === 1 && state.memberships.length === 1, "双链未知重复建立成员");
        } finally { await unmount(instance); }
    });
    await test("组织多选编辑：匹配与无匹配均可新建，取消和创建返回保留草稿", async () => {
        const state = editorState(settings, person);
        const created = { docId: "20261017000000-newc001", name: "新建搜索组织" };
        const instance = mount(PersonEditDialog, { target: fixture, props: state.props });
        try {
            await select([ORGS[0]]); set(ORGS[0].docId, "成员备注", "新建前的组织草稿"); input(relationInput(fixture), "新建前称谓");
            await openPicker(fixture, until); input(searchInput(fixture), ORGS[1].name); await tick();
            assert(button("新建组织") && checkbox(fixture, ORGS[1]), "有匹配时没有新建入口");
            input(searchInput(fixture), created.name); await tick();
            assert(fixture.querySelectorAll('.lvct-org-multi__option input[type="checkbox"]').length === 0 && button("新建组织"), "无匹配时没有新建入口");
            button("新建组织", fixture.querySelector(".lvct-person-edit__profile")).click();
            await until(() => state.createRequests.length === 1 && trigger(fixture) && !trigger(fixture).disabled, "取消创建后入口未恢复");
            assert(state.createRequests[0] === created.name && state.added.length === 0 && state.relationWrites.length === 0, "取消创建丢搜索词或产生写入");
            assert(relationInput(fixture).value === "新建前称谓" && field(card(fixture, ORGS[0].docId), "成员备注").value === "新建前的组织草稿", "取消创建覆盖原草稿");
            state.createHook = async () => { state.candidates.push(created); return created; };
            await openPicker(fixture, until); input(searchInput(fixture), created.name); button("新建组织").click();
            await until(() => card(fixture, created.docId), "创建返回没有按 docId 自动加入待保存队列");
            assert(card(fixture, ORGS[0].docId) && state.relationReads === 1 && relationInput(fixture).value === "新建前称谓", "创建返回丢失原选择或重读覆盖称谓");
            assert(state.added.length === 0, "组织创建后未经保存就写成员");
        } finally { await unmount(instance); }
    });
    await test("组织多选编辑工作台：搜索直达名称表单，取消保留全部草稿，同名创建按返回身份自动选中", async () => {
        const state = editorState(settings, person);
        const created = { docId: "20261017000000-wnew001", name: "工作台新建组织" };
        const sameName = { docId: "20261017000000-wnam001", name: created.name };
        const createdCalls = [];
        const facade = {
            settings, viewPreferences: DEFAULT_VIEW_PREFERENCES, listContacts: async () => [person],
            loadRecentInteractions: async () => ({}), loadPersonInsights: async () => ({ timeline: [], coAttendance: [], totalEvents: 0 }),
            loadPersonNote: async () => "", savePersonNote: async (_docId, note) => note,
            listPersonExchanges: async () => [], listPersonAliases: async () => [], listCommonOrgBackground: async () => [],
            listPersonFollowUps: async () => [], getPersonCadence: async () => null, listTemplates: async () => [],
            listOrganizations: async () => copy(state.candidates), listPersonOrgMemberships: state.props.onLoadOrgMemberships,
            loadPersonRelationshipLabels: state.props.onLoadRelationshipLabels, savePersonRelationshipLabels: state.props.onSaveRelationshipLabels,
            addOrganizationMember: (orgDocId, personDocId, extra) => state.props.onAddOrgMembership(personDocId, orgDocId, extra),
            createOrganization: async (name, profile) => {
                createdCalls.push({ name, profile: copy(profile) }); state.candidates.push(created); return { docId: created.docId };
            },
        };
        const instance = mount(Workbench, { target: fixture, props: {
            settings, preferences: DEFAULT_VIEW_PREFERENCES, initialView: "people", isMobile: window.innerWidth < 700,
            facade, onPreferencesUpdated() {}, onOpenPersonDoc() {},
        } });
        try {
            await until(() => fixture.querySelector(".lvct-person-card"), "工作台人物入口未读取");
            fixture.querySelector(".lvct-person-card").click();
            await until(() => fixture.querySelector(".lvct-detail__header-actions button"), "工作台人物详情未打开");
            fixture.querySelector(".lvct-detail__header-actions button").click();
            await select([ORGS[0]]); set(ORGS[0].docId, "成员备注", "创建前组织草稿");
            input(relationInput(fixture), "创建前称谓"); input(fixture.querySelector('.lvct-form input[type="tel"]'), "13800000123");
            await openPicker(fixture, until); input(searchInput(fixture), created.name); await tick();
            button("新建组织", fixture.querySelector(".lvct-person-edit__profile")).click();
            await until(() => fixture.querySelector('.lvct-org-profile-editor[data-org-profile-mode="create"]'), "新建组织未直接打开名称表单");
            const editor = fixture.querySelector(".lvct-org-profile-editor");
            assert(editor.querySelector('[aria-label="组织名称（必填）"]').value === created.name, "创建名称没有带入搜索词");
            assert(!fixture.querySelector(".lvct-org-manager"), "联系人新建组织打开了组织管理列表");
            button("取消", editor).click();
            await until(() => !fixture.querySelector(".lvct-org-profile-editor") && trigger(fixture) && !trigger(fixture).disabled, "取消组织创建未回到人物编辑");
            assert(createdCalls.length === 0 && state.added.length === 0 && state.relationWrites.length === 0, "取消组织创建产生写入");
            assert(relationInput(fixture).value === "创建前称谓" && fixture.querySelector('.lvct-form input[type="tel"]').value === "13800000123"
                && field(card(fixture, ORGS[0].docId), "成员备注").value === "创建前组织草稿", "取消组织创建覆盖人物草稿");
            state.candidates.push(sameName);
            await openPicker(fixture, until); input(searchInput(fixture), created.name); await tick(); button("新建组织", fixture.querySelector(".lvct-person-edit__profile")).click();
            await until(() => fixture.querySelector(".lvct-org-profile-editor"), "第二次组织名称表单未打开");
            button("创建组织", fixture.querySelector(".lvct-org-profile-editor")).click();
            await until(() => !fixture.querySelector(".lvct-org-profile-editor") && card(fixture, created.docId), "工作台创建返回未按新文档身份选中");
            assert(createdCalls.length === 1 && createdCalls[0].name === created.name && createdCalls[0].profile.name === created.name, "组织创建名称或资料没有经 facade 保存");
            assert(card(fixture, ORGS[0].docId) && !card(fixture, sameName.docId), "同名组织自动选中错误身份或覆盖旧选择");
            assert(relationInput(fixture).value === "创建前称谓" && fixture.querySelector('.lvct-form input[type="tel"]').value === "13800000123"
                && field(card(fixture, ORGS[0].docId), "成员备注").value === "创建前组织草稿", "组织创建成功覆盖人物草稿");
            assert(state.added.length === 0 && state.relationWrites.length === 0, "组织创建完成前未经人物保存就写入成员或称谓");
            button("保存组织与称谓").click();
            await until(() => state.added.length === 2 && !card(fixture, created.docId), "新建组织与原选择未共同保存");
            assert(state.added.map((entry) => entry.orgDocId).join() === [ORGS[0].docId, created.docId].join(), "保存使用同名旧组织身份或漏掉原组织");
        } finally { await unmount(instance); }
    });
    await test("组织多选交互：已选名称和同名身份可见，搜索计数与当前归属独立，移除仅影响指定草稿", async () => {
        const candidates = [ORGS[0], { ...ORGS[1], name: "同名组织" }, { ...ORGS[2], name: "同名组织" },
            { docId: "20261017000000-long001", name: "用于检验窄屏自动换行的很长组织名称".repeat(5) }];
        const current = { id: "20261017000000-kcur001", orgDocId: ORGS[0].docId, orgName: ORGS[0].name,
            status: "active", affiliationKind: "work", department: "", title: "", joinedOn: "", leftOn: "", archived: false, reachable: true };
        const state = editorState(settings, person, candidates, [current]);
        const instance = mount(PersonEditDialog, { target: fixture, props: state.props });
        try {
            await select(candidates.slice(1));
            assert(trigger(fixture).textContent.includes("待保存 3 个组织"), "选择计数混入已有当前归属");
            const status = pickerStatus(fixture);
            assert(status?.textContent.includes("本次待保存 3 个组织") && status.textContent.includes("已有 1 个当前归属"), "选择数量与既有归属未分别说明");
            assert(document.getElementById(trigger(fixture).getAttribute("aria-describedby")) === status, "组织入口未关联选择状态");
            for (const org of candidates.slice(1)) {
                const selected = chip(fixture, org.docId);
                assert(selected?.textContent.includes(org.name), "已选组织没有显示名称");
                if (org.name === "同名组织") assert(selected.textContent.includes(org.docId) && selected.querySelector("button").getAttribute("aria-label").includes(org.docId), "同名芯片或移除按钮缺少稳定身份");
                assert(selected.scrollWidth <= selected.clientWidth + 1, "已选长名称在窄屏横向溢出");
            }
            await openPicker(fixture, until); input(searchInput(fixture), candidates[2].docId); await tick();
            assert(pickerStatus(fixture).textContent.includes("找到 1 个组织") && fixture.querySelectorAll(".lvct-org-multi__option").length === 1, "按身份过滤后的计数与候选不同步");
            input(searchInput(fixture), "不存在的组织关键词"); await tick();
            assert(pickerStatus(fixture).textContent.includes("找到 0 个组织") && fixture.querySelector(".lvct-org-multi__empty"), "空搜索结果未给出准确计数");
            trigger(fixture).click(); await until(() => !searchInput(fixture), "搜索后浮层未关闭");
            chip(fixture, candidates[1].docId).querySelector("button").click();
            await until(() => !card(fixture, candidates[1].docId) && !chip(fixture, candidates[1].docId), "点击芯片移除未同步选择和草稿");
            assert(card(fixture, candidates[2].docId) && chip(fixture, candidates[2].docId) && trigger(fixture).textContent.includes("待保存 2 个组织"), "同名芯片移除影响了另一身份");
            assert(state.added.length === 0 && state.removed.length === 0, "编辑选择芯片改写成员事实");
        } finally { await unmount(instance); }
    });
    await test("组织经历移除：已填写草稿的 checkbox 与按钮均先确认，保留路径不丢输入", async () => {
        const state = editorState(settings, person);
        const instance = mount(PersonEditDialog, { target: fixture, props: state.props });
        const confirm = () => fixture.querySelector('[role="alertdialog"][aria-label="取消组织经历"]');
        try {
            await select([ORGS[0]]);
            set(ORGS[0].docId, "成员备注", "必须保留的组织备注");
            await openPicker(fixture, until);
            checkbox(fixture, ORGS[0]).click();
            await until(confirm, "checkbox 移除已填写经历没有确认");
            assert(card(fixture, ORGS[0].docId) && field(card(fixture, ORGS[0].docId), "成员备注").value === "必须保留的组织备注", "checkbox 确认前丢失组织草稿");
            button("保留经历", confirm()).click();
            await until(() => !confirm(), "保留组织经历后确认面板未关闭");
            assert(card(fixture, ORGS[0].docId) && field(card(fixture, ORGS[0].docId), "成员备注").value === "必须保留的组织备注", "保留组织经历覆盖了原输入");
            await openPicker(fixture, until); checkbox(fixture, ORGS[0]).click();
            await until(confirm, "再次 checkbox 移除没有确认");
            button("确认移除这条经历", confirm()).click();
            await until(() => !card(fixture, ORGS[0].docId) && !chip(fixture, ORGS[0].docId), "确认 checkbox 移除未清除组织草稿");

            await select([ORGS[0]]);
            set(ORGS[0].docId, "成员备注", "按钮移除前的备注");
            button("取消选择", card(fixture, ORGS[0].docId)).click();
            await until(confirm, "移除按钮对已填写经历没有确认");
            assert(card(fixture, ORGS[0].docId), "移除按钮确认前已删除组织草稿");
            button("确认移除这条经历", confirm()).click();
            await until(() => !card(fixture, ORGS[0].docId), "确认按钮移除未清除组织草稿");
            assert(state.added.length === 0 && state.removed.length === 0, "组织草稿移除触发了成员事实写入");
        } finally { await unmount(instance); }
    });
    await test("组织多选真实键盘：方向与首末跳过不可修改项，Enter 和原生空格只切换一次，搜索 Enter 零创建", async () => {
        const last = { docId: "20261017000000-keyl001", name: "最后一个可选组织" };
        const current = { id: "20261017000000-keym001", orgDocId: ORGS[0].docId, orgName: ORGS[0].name,
            status: "active", affiliationKind: "work", department: "", title: "", joinedOn: "", leftOn: "", archived: false, reachable: true };
        const state = editorState(settings, person, [...ORGS, last], [current]);
        state.addHook = async () => { throw new Error("键盘核对的原保存结果未知"); };
        const instance = mount(PersonEditDialog, { target: fixture, props: state.props });
        try {
            await select([ORGS[1]]); button("保存组织与称谓").click();
            await until(() => fixture.textContent.includes("键盘核对的原保存结果未知"), "键盘待核实夹具未建立");
            assert(chip(fixture, ORGS[1].docId)?.textContent.includes("待核实") && chip(fixture, ORGS[1].docId).querySelector("button").disabled, "待核实芯片仍可直接移除");
            await openPicker(fixture, until);
            const key = (target, action) => trustedOrgKey(fixture, target, action, assert);
            await key("org-search", "arrowdown");
            assert(document.activeElement === checkbox(fixture, ORGS[2]), "ArrowDown 没有跳过已有和待核实组织");
            await key("org-focused-option", "end"); assert(document.activeElement === checkbox(fixture, last), "End 未到末个可用组织");
            await key("org-focused-option", "home"); assert(document.activeElement === checkbox(fixture, ORGS[2]), "Home 未到首个可用组织");
            await key("org-focused-option", "arrowup"); assert(document.activeElement === checkbox(fixture, ORGS[2]), "首项 ArrowUp 越过可用边界");
            await key("org-focused-option", "arrowdown"); assert(document.activeElement === checkbox(fixture, last), "ArrowDown 未到下一可用组织");
            await key("org-focused-option", "arrowdown"); assert(document.activeElement === checkbox(fixture, last), "末项 ArrowDown 越过可用边界");
            await key("org-focused-option", "arrowup");
            let spaceChanges = 0;
            const option = checkbox(fixture, ORGS[2]);
            option.addEventListener("change", (event) => { if (event.isTrusted) spaceChanges++; });
            await key("org-focused-option", "enter");
            await until(() => card(fixture, ORGS[2].docId) && option.checked, "候选 Enter 未切换原生复选框");
            const beforeSpace = spaceChanges;
            option.focus({ preventScroll: true });
            await key("org-focused-option", "space");
            await until(() => !card(fixture, ORGS[2].docId) && !option.checked, "原生空格未取消复选框或重复切换");
            assert(spaceChanges === beforeSpace + 1, "原生空格未产生且仅产生一次可信 change");
            option.focus({ preventScroll: true });
            await key("org-focused-option", "space");
            await until(() => card(fixture, ORGS[2].docId) && option.checked, "原生空格未重新选择组织");
            assert(spaceChanges === beforeSpace + 2, "第二次空格重复切换复选框");
            searchInput(fixture).focus({ preventScroll: true }); input(searchInput(fixture), ORGS[2].name); await tick();
            await key("org-search", "enter");
            assert(card(fixture, ORGS[2].docId) && searchInput(fixture), "搜索 Enter 意外切换当前选择或关闭浮层");
            input(searchInput(fixture), "没有匹配的新组织"); await tick(); await key("org-search", "enter");
            assert(state.createRequests.length === 0 && state.added.length === 1 && state.relationWrites.length === 0, "搜索 Enter 误建组织或保存人物");
            console.log("组织多选键盘 Arrow/Home/End/Enter/Space isTrusted=true");
        } finally { await unmount(instance); }
    });
    await test("组织多选更多设置：分类状态保持可见，折叠和候选重绘保留原控件，隐藏错误自动展开定位", async () => {
        const state = editorState(settings, person);
        const instance = mount(PersonEditDialog, { target: fixture, props: state.props });
        try {
            await select(ORGS.slice(0, 2));
            const first = card(fixture, ORGS[0].docId), second = card(fixture, ORGS[1].docId);
            const more = first.querySelector("details.lvct-person-edit__org-more");
            assert(more && !more.open && more.querySelector("summary").textContent.includes("更多设置"), "组织卡未默认折叠更多设置");
            assert(!field(first, "归属分类").closest("details") && !field(first, "当前状态").closest("details"), "基础分类或状态被放入更多设置");
            const department = field(first, "部门/院系");
            // Chrome preserves a layout rect for closed native details content;
            // visibility must include its content-visibility state, not rect count.
            assert(department?.closest("details") === more && !department.checkVisibility({ contentVisibilityAuto: true }), "扩展字段未在折叠区保留隐藏挂载");
            set(ORGS[0].docId, "归属分类", "work"); set(ORGS[0].docId, "部门/院系", "折叠仍保留的部门");
            set(ORGS[0].docId, "成员备注", "第一段独立备注");
            await toggleDetails(more);
            assert(!more.open && more.querySelector("summary").textContent.includes("已填写 2 项"), "更多设置没有填写数量摘要或折叠失败");
            await openPicker(fixture, until); input(searchInput(fixture), ORGS[2].name); await tick(); trigger(fixture).click(); await tick();
            assert(field(first, "部门/院系") === department && department.value === "折叠仍保留的部门" && !more.open, "候选过滤重建了隐藏控件或重置折叠状态");
            set(ORGS[1].docId, "当前状态", "former"); await tick();
            set(ORGS[1].docId, "开始日期", "2025-01-01"); set(ORGS[1].docId, "结束日期", "2024-01-01");
            const invalidMore = second.querySelector("details"); await toggleDetails(invalidMore);
            button("保存组织与称谓").click();
            await until(() => fixture.textContent.includes("日期无效") && invalidMore.open, "隐藏的无效日期未展开定位");
            assert(invalidMore.contains(document.activeElement), "扩展字段错误未聚焦对应更多设置中的控件");
            assert(document.activeElement.getAttribute("aria-invalid") === "true", "扩展字段错误未关联到无效控件");
            assert(state.added.length === 0, "隐藏日期校验前已写入其他组织");
            // Even immediate save before native toggle flushes must reopen the
            // invalid field instead of trusting the still-open bound state.
            invalidMore.querySelector("summary").click(); button("保存组织与称谓").click();
            await until(() => invalidMore.open && invalidMore.contains(document.activeElement), "立即收起后保存未重新展开无效字段");
            assert(document.activeElement.getAttribute("aria-invalid") === "true" && state.added.length === 0, "立即收起后保存丢失错误定位或提前写入");
            set(ORGS[1].docId, "结束日期", "2026-01-01"); await toggleDetails(invalidMore);
            button("保存组织与称谓").click();
            await until(() => state.added.length === 2 && !card(fixture, ORGS[1].docId), "折叠设置修正后未保存");
            assert(state.added[0].extra.department === "折叠仍保留的部门" && state.added[0].extra.note === "第一段独立备注" && state.added[1].extra.leftOn === "2026-01-01", "折叠保存丢失字段或条目串值");
        } finally { await unmount(instance); }
    });
}
