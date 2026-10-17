import { mount, unmount, tick } from "svelte";
import PersonCard from "../../../src/components/people/PersonCard.svelte";
import PersonDetail from "../../../src/components/people/PersonDetail.svelte";
import Workbench from "../../../src/components/Workbench.svelte";
import { FIELD_SPECS } from "../../../src/domain/fields";
import { DEFAULT_VIEW_PREFERENCES } from "../../../src/domain/preferences";
import { invalidateRoster } from "../../../src/services/roster";
import { kernel } from "./siyuan-mock.js";

const person = {
    docId: "20261011000000-person1", itemId: "20261011000000-row0001", name: "卡片资料核对",
    phone: "", email: "", wechat: "", website: "", birthday: "", isLunar: false,
    group: "", tags: [], relatedItemIds: [],
};

function affiliations(patch = {}) {
    return { family: [], work: [], education: [], unspecified: [], history: [], unresolved: [], ...patch };
}

function knownProfile(value = affiliations()) {
    return {
        readAt: 1791676800000,
        affiliations: { state: "known", value },
        relationship: { state: "known", labels: [], recordId: null, updatedAt: null },
    };
}

function membership(patch = {}) {
    return {
        id: "20261011000000-member1", orgDocId: "20261011000000-org0001", personDocId: person.docId,
        department: "", title: "", joinedOn: "", leftOn: "", status: "active",
        affiliationKind: "unspecified", orgName: "社区读书会", scope: "current", ...patch,
    };
}

async function withCard(fixture, data, inspect) {
    const host = document.createElement("div");
    host.style.width = "min(260px, 100%)";
    fixture.appendChild(host);
    const instance = mount(PersonCard, { target: host, props: {
        person: data, onOpen() {}, onOpenPersonDoc() {},
    } });
    try {
        await tick();
        await inspect(host.querySelector(".lvct-person-card"));
    } finally {
        await unmount(instance);
        host.remove();
    }
}

const summaryRows = (card) => [...card.querySelectorAll(".lvct-profile-summary--compact > span")].map((node) => node.textContent);
const setInput = (node, value) => { node.value = value; node.dispatchEvent(new Event("input", { bubbles: true })); };
const setSelect = (node, value) => { node.value = value; node.dispatchEvent(new Event("change", { bubbles: true })); };
const findButton = (root, label) => [...(root?.querySelectorAll("button") ?? [])].find((node) => node.textContent.trim() === label);
const personalNote = (fixture) => fixture.querySelector(".lvct-detail__person-note");
const noteInput = (fixture) => personalNote(fixture)?.querySelector('textarea[aria-label="个人备注"]');
const noteConfirm = (fixture) => personalNote(fixture)?.querySelector('[aria-label="重新读取个人备注前确认草稿"]');
async function waitFor(predicate, message) {
    const end = Date.now() + 4000;
    while (!predicate()) {
        if (Date.now() > end) throw new Error(message);
        await new Promise((resolve) => setTimeout(resolve, 20));
    }
    await tick();
}

function noteFixture() {
    const settings = {
        schemaVersion: 1, notebookName: "个人备注回归", notebookId: "20261011000000-book001",
        hostDocId: "20261011000000-host001", dbBlockId: "20261011000000-block01", avId: "20261011000000-view001",
        initializedAt: "2026-10-11T00:00:00Z", fieldMap: Object.fromEntries(FIELD_SPECS.map((field) => [field.key, field.key])),
    };
    const second = { ...person, docId: "20261011000000-person2", itemId: "20261011000000-row0002", name: "另一位备注人物" };
    kernel.handler = async (route) => {
        if (route === "/api/av/renderAttributeView") return { view: {
            columns: FIELD_SPECS.map((field) => ({ id: field.key, name: field.nameZh, type: field.type })), rowCount: 2,
            rows: [person, second].map((entry) => ({ id: entry.itemId, cells: [{ valueType: "block", value: {
                type: "block", keyID: "name", block: { id: entry.docId, content: entry.name },
            } }] })),
        } };
        throw new Error(`个人备注 UI 夹具不允许内核写入 ${route}`);
    };
    invalidateRoster();
    return { settings, second };
}

export async function runProfileCardRegression({ test, assert, fixture }) {
    await test("联系人卡片姓名：常见姓名保持副标题基线，超长姓名完整换行", async () => {
        const offsets = [];
        for (const name of ["短姓名", "跨校联合课程项目协作负责人", "苏婉清 · 跨校联合课程与社区项目协调负责人".repeat(3)]) {
            await withCard(fixture, { ...person, name }, (card) => {
                const title = card.querySelector(".lvct-person-card__name");
                const subtitle = card.querySelector(".lvct-person-card__sub");
                const titleBounds = title.getBoundingClientRect();
                const subtitleBounds = subtitle.getBoundingClientRect();
                assert(title.textContent.trim() === name, "姓名文本不完整");
                assert(title.scrollHeight <= title.clientHeight + 1 && title.scrollWidth <= title.clientWidth + 1, "姓名被固定行数裁切");
                assert(subtitleBounds.top >= titleBounds.bottom - 1, "长姓名与副标题重叠");
                assert(card.scrollWidth <= card.clientWidth + 1, "长姓名撑出卡片宽度");
                offsets.push(subtitleBounds.top - titleBounds.top);
            });
        }
        if (window.innerWidth > 640) assert(Math.abs(offsets[0] - offsets[1]) <= 1, "一至两行姓名的副标题基线不一致");
    });

    await test("联系人卡片精简资料：已核实空资料显示补充提示，不重复四条未填写", async () => {
        await withCard(fixture, { ...person, profile: knownProfile() }, (card) => {
            const rows = summaryRows(card);
            assert(rows.length === 1 && rows[0] === "资料待补充", "空资料未收敛为单条补充提示");
            assert(!card.textContent.includes("：未填写"), "精简卡片仍重复显示空字段");
        });
    });

    const retainedCases = [
        { name: "其他组织", field: "unspecified", item: membership(), expected: "其他组织：社区读书会" },
        { name: "毕业历史", field: "history", item: membership({ status: "former", affiliationKind: "education", orgName: "原就读学校", scope: "former" }), expected: "历史组织：1 条经历" },
        { name: "待核对组织", field: "unresolved", item: membership({ orgName: null, scope: "unreachable" }), expected: "待核对组织：1 条" },
    ];
    for (const entry of retainedCases) {
        await test(`联系人卡片精简资料：仅有${entry.name}仍保留摘要，不误判空资料`, async () => {
            const profile = knownProfile(affiliations({ [entry.field]: [entry.item] }));
            await withCard(fixture, { ...person, profile }, (card) => {
                const rows = summaryRows(card);
                assert(rows.length === 1 && rows[0].includes(entry.expected), `${entry.name}资料未保留在卡片摘要中`);
                assert(!card.textContent.includes("资料待补充"), `${entry.name}被错误显示为空资料`);
            });
        });
    }

    for (const entry of [
        { state: "unknown", expected: "称谓尚未核实", name: "称谓读取异常" },
        { state: "self_missing", expected: "请先设置本人", name: "未设置本人" },
    ]) {
        await test(`联系人卡片精简资料：组织异常合并为一条，${entry.name}提示仍保留`, async () => {
            const profile = {
                readAt: 1791676800000,
                affiliations: { state: "unknown", message: "组织索引读取失败" },
                relationship: { state: entry.state, labels: null },
            };
            await withCard(fixture, { ...person, profile }, (card) => {
                const rows = summaryRows(card);
                assert(rows.length === 2, "读取异常重复成多条组织提示或丢失称谓状态");
                assert(rows.filter((row) => row === "组织归属：组织归属尚未核实").length === 1, "组织未知没有保留且仅保留一条核对提示");
                assert(rows.some((row) => row === `与我的关系：${entry.expected}`), `${entry.name}被隐藏或误判为空资料`);
                assert(!card.textContent.includes("资料待补充"), "异常资料被写成正常空资料");
            });
        });
    }

    await test("联系人卡片联系方式：窄卡片完整换行长电话、微信和邮箱，文字不裁切", async () => {
        const data = {
            ...person,
            phone: "+86 138 0000 0000 / +86 139 0000 0000（工作日联系）",
            wechat: "community_coordinator_".repeat(5),
            email: `${"contact-community-coordination-".repeat(2)}@long-organization-domain.example.test`,
        };
        await withCard(fixture, data, (card) => {
            const values = [...card.querySelectorAll(".lvct-person-card__meta-value")].slice(0, 3);
            assert(values.length === 3, "联系方式文字容器缺失");
            for (const [index, value] of values.entries()) {
                const expected = [data.phone, data.wechat, data.email][index];
                assert(value.textContent === expected, "长联系方式在渲染时被截断");
                const rect = value.getBoundingClientRect();
                const lineHeight = Number.parseFloat(getComputedStyle(value).lineHeight);
                assert(rect.height >= lineHeight * 1.8, `长联系方式没有换行：${expected}`);
                assert(value.scrollWidth <= value.clientWidth + 1 && value.scrollHeight <= value.clientHeight + 1, `联系方式在文字容器中被裁切：${expected}`);
                const range = document.createRange();
                range.selectNodeContents(value);
                assert([...range.getClientRects()].every((line) => line.left >= rect.left - 1 && line.right <= rect.right + 1 && line.top >= rect.top - 1 && line.bottom <= rect.bottom + 1), `部分联系方式文字落在可见容器外：${expected}`);
            }
            assert(card.scrollWidth <= card.clientWidth + 1, "长联系方式撑出了卡片宽度");
            assert(card.querySelector('a[href^="tel:"]')?.getAttribute("href") === `tel:${data.phone}`, "电话链接丢失完整号码");
            assert(card.querySelector('a[href^="mailto:"]')?.getAttribute("href") === `mailto:${data.email}`, "邮箱链接丢失完整地址");
        });
    });

    await test("联系人卡片图标：宿主通用 SVG 填充规则不把 Lucide 描边图标填实", async () => {
        const hostStyle = document.createElement("style");
        hostStyle.textContent = "svg { fill: currentColor; }";
        document.head.appendChild(hostStyle);
        try {
            await withCard(fixture, { ...person, phone: "13800000000", email: "contact@example.test", wechat: "test-contact" }, (card) => {
                const icons = [...card.querySelectorAll("svg")];
                assert(icons.length >= 5, "卡片联系方式和文档图标未完整渲染");
                assert(icons.every((icon) => getComputedStyle(icon).fill === "none"), "宿主样式把卡片描边图标填成实心");
            });
        } finally {
            hostStyle.remove();
        }
    });

    await test("个人备注重读：冲突后取消与保留草稿、放弃后读取失败都不影响其他区域，成功新基线可保存", async () => {
        const { settings } = noteFixture();
        let stored = "最初备注";
        let reads = 0;
        let failRead = false;
        const saves = [];
        const otherWrites = [];
        const fieldsState = { blockId: "20261011000000-fieldb1", snapshot: { schemaVersion: 1, ownerDocId: person.docId, items: [
            { id: "00000000-0000-4000-8000-000000000001", kind: "entry", label: "电话", value: "11001" },
        ] } };
        const instance = mount(PersonDetail, { target: fixture, props: {
            settings, person, onRecord: async () => { otherWrites.push("interaction"); },
            onLoadInsights: async () => ({ timeline: [], coAttendance: [], totalEvents: 0 }),
            onLoadPersonNote: async () => { reads += 1; if (failRead) throw new Error("重读暂时断开"); return stored; },
            onSavePersonNote: async (docId, value, expected) => {
                saves.push({ docId, value, expected });
                if (expected !== stored) throw new Error("人物备注已在其他窗口变化，请重新读取后再保存");
                stored = value;
                return stored;
            },
            onGetCadence: async () => null, onSaveCadence: async () => { otherWrites.push("cadence"); },
            onLoadPersonFields: async () => structuredClone(fieldsState), onSavePersonFields: async () => { otherWrites.push("fields"); throw new Error("不应保存其他资料"); },
            onOpenPersonDoc() {}, onNavigate() {}, onChanged() {}, onDeleted() {}, onClose() {},
        } });
        const pressNote = (label) => { const button = findButton(personalNote(fixture), label); assert(button, `个人备注缺少按钮 ${label}`); button.click(); };
        const assertOtherDrafts = () => {
            assert(fixture.querySelector('[aria-label="互动备注"]').value === "另一区域互动草稿", "重读修改了互动草稿");
            assert(fixture.querySelector('[aria-label="联系节奏模式"]').value === "custom" && fixture.querySelector('[aria-label="自定义天数"]').value === "37", "重读修改了联系节奏草稿");
            assert(fixture.querySelector('.lvct-person-fields textarea[aria-label="内容"]').value === "补充资料尚未保存", "重读修改了补充资料草稿");
            assert(otherWrites.length === 0 && !document.querySelector(".lvct-closeguard"), "就地重读调用了其他保存或全详情守卫");
        };
        try {
            await waitFor(() => noteInput(fixture)?.value === "最初备注" && fixture.querySelector('[aria-label="联系节奏模式"]') && fixture.querySelector(".lvct-person-fields"), "备注或辅助区域未完成读取");
            setInput(fixture.querySelector('[aria-label="互动备注"]'), "另一区域互动草稿");
            setSelect(fixture.querySelector('[aria-label="联系节奏模式"]'), "custom");
            await tick();
            setInput(fixture.querySelector('[aria-label="自定义天数"]'), "37");
            findButton(fixture.querySelector(".lvct-person-fields"), "编辑补充资料").click();
            await tick();
            setInput(fixture.querySelector('.lvct-person-fields textarea[aria-label="内容"]'), "补充资料尚未保存");
            setInput(noteInput(fixture), "我的备注草稿");
            await tick();
            stored = ("其他窗口最新备注\n<img src=x onerror=alert(1)> & 需要核对的长内容" + "长内容".repeat(1700)).slice(0, 5000);
            pressNote("保存备注");
            await waitFor(() => personalNote(fixture).textContent.includes("其他窗口变化"), "冲突未显示");
            pressNote("重新读取");
            await waitFor(() => noteConfirm(fixture), "脏稿重读没有就地确认");
            findButton(noteConfirm(fixture), "取消").click();
            await tick();
            assert(reads === 1 && noteInput(fixture).value === "我的备注草稿", "取消重读改变原稿或发起读取");
            assertOtherDrafts();
            pressNote("重新读取");
            await tick();
            findButton(noteConfirm(fixture), "保留草稿并读取最新").click();
            await waitFor(() => personalNote(fixture).querySelector('[aria-label="最新已存个人备注"]')?.textContent === stored && noteInput(fixture), "保留草稿重读未展示最新已存原文");
            assert(noteInput(fixture).value === "我的备注草稿" && personalNote(fixture).textContent.includes("再次保存会用当前草稿替换这些内容"), "保留模式静默换基线或未保留原稿");
            const latest = personalNote(fixture).querySelector('[aria-label="最新已存个人备注"]');
            assert(latest.textContent.length === 5000 && latest.children.length === 0, "最新已存备注没有按纯文本完整展示5000字符");
            assert(latest.scrollWidth <= latest.clientWidth + 1, "最新已存备注长文本横向溢出");
            assertOtherDrafts();
            failRead = true;
            pressNote("重新读取");
            await tick();
            findButton(noteConfirm(fixture), "放弃草稿并读取最新").click();
            await waitFor(() => personalNote(fixture).textContent.includes("重读暂时断开") && noteInput(fixture), "重读失败没有恢复编辑");
            assert(noteInput(fixture).value === "我的备注草稿", "放弃模式读取失败提前丢弃原稿");
            assertOtherDrafts();
            setInput(noteInput(fixture), "读取失败后继续编辑的草稿");
            await tick();
            assert(findButton(personalNote(fixture), "重新读取") && !personalNote(fixture).textContent.includes("重读暂时断开"), "继续编辑清错后再次丢失重读入口");
            failRead = false;
            stored = "第二次远端最新备注";
            pressNote("重新读取");
            await tick();
            findButton(noteConfirm(fixture), "放弃草稿并读取最新").click();
            await waitFor(() => noteInput(fixture)?.value === "第二次远端最新备注", "确认放弃成功后未替换为新读内容");
            assert(!personalNote(fixture).querySelector('[aria-label="最新已存个人备注"]'), "放弃模式残留过期对照");
            setInput(noteInput(fixture), "已核对后保存的新稿");
            await tick();
            pressNote("保存备注");
            await waitFor(() => personalNote(fixture).querySelector(".lvct-chip")?.textContent.includes("已保存"), "新读基线无法再次保存");
            assert(stored === "已核对后保存的新稿" && saves.at(-1).expected === "第二次远端最新备注" && saves.at(-1).docId === person.docId, "保存没有使用最新核对基线或身份错误");
            assertOtherDrafts();
        } finally { await unmount(instance); }
    });

    await test("个人备注重读：保留草稿读取后可显式保存，旧人物卸载后的迟到重读不污染新人物", async () => {
        const { settings, second } = noteFixture();
        const notes = new Map([[person.docId, "A最初备注"], [second.docId, "B人物备注"]]);
        let hangA = false;
        let releaseA;
        const saves = [];
        const facade = {
            settings, viewPreferences: DEFAULT_VIEW_PREFERENCES,
            listContacts: async () => [person, second], loadRecentInteractions: async () => ({}),
            loadPersonInsights: async () => ({ timeline: [], coAttendance: [], totalEvents: 0 }),
            loadPersonNote: async (docId) => docId === person.docId && hangA ? new Promise((resolve) => { releaseA = resolve; }) : notes.get(docId) ?? "",
            savePersonNote: async (docId, value, expected) => { assert(notes.get(docId) === expected, "保留草稿重读后未使用新基线"); saves.push({ docId, value, expected }); notes.set(docId, value); return value; },
            listPersonExchanges: async () => [], listPersonAliases: async () => [], listPersonOrgMemberships: async () => [],
            listCommonOrgBackground: async () => [], listOrganizations: async () => [], listPersonFollowUps: async () => [],
            getPersonCadence: async () => null, listTemplates: async () => [],
        };
        const mountWorkbench = () => mount(Workbench, { target: fixture, props: {
            settings, preferences: structuredClone(DEFAULT_VIEW_PREFERENCES), initialView: "people", isMobile: window.innerWidth <= 640,
            facade, onPreferencesUpdated() {}, onOpenPersonDoc() {},
        } });
        let instance = mountWorkbench();
        try {
            await waitFor(() => fixture.querySelector(`[data-person-item-id="${person.itemId}"]`), "A卡片未就绪");
            fixture.querySelector(`[data-person-item-id="${person.itemId}"]`).click();
            await waitFor(() => noteInput(fixture)?.value === "A最初备注", "A备注未读取");
            setInput(noteInput(fixture), "A保留草稿");
            await tick();
            notes.set(person.docId, "A远端更新");
            findButton(personalNote(fixture), "重新读取").click();
            await tick();
            findButton(noteConfirm(fixture), "保留草稿并读取最新").click();
            await waitFor(() => noteInput(fixture)?.value === "A保留草稿" && personalNote(fixture).querySelector('[aria-label="最新已存个人备注"]')?.textContent === "A远端更新", "A保留模式没有新基线对照");
            findButton(personalNote(fixture), "保存备注").click();
            await waitFor(() => saves.length === 1 && personalNote(fixture)?.querySelector(".lvct-chip")?.textContent.includes("已保存"), "A保留草稿核对后未保存");
            assert(saves[0].expected === "A远端更新" && notes.get(person.docId) === "A保留草稿", "保留模式未在显式保存后替换原文");
            await waitFor(() => noteInput(fixture), "A保存后刷新未完成");
            hangA = true;
            findButton(personalNote(fixture), "重新读取").click();
            await waitFor(() => releaseA, "A重读没有挂起");
            const next = findButton(fixture.querySelector(".lvct-detail"), "下一位");
            next?.click();
            await tick();
            assert(fixture.querySelector(".lvct-detail")?.textContent.includes(person.name) && !document.querySelector(".lvct-closeguard"), "重读挂起时允许切人或错误调用聚合脏稿守卫");
            await unmount(instance);
            fixture.replaceChildren();
            instance = mountWorkbench();
            await waitFor(() => fixture.querySelector(`[data-person-item-id="${second.itemId}"]`), "重开工作台B卡片未就绪");
            fixture.querySelector(`[data-person-item-id="${second.itemId}"]`).click();
            await waitFor(() => noteInput(fixture)?.value === "B人物备注", "B备注未读取");
            setInput(noteInput(fixture), "B当前草稿");
            await tick();
            releaseA("A迟到旧值");
            await tick();
            assert(noteInput(fixture).value === "B当前草稿" && !personalNote(fixture).textContent.includes("A迟到旧值") && !personalNote(fixture).querySelector('[aria-label="最新已存个人备注"]') && !noteConfirm(fixture), "A迟到重读覆盖B草稿或复活旧确认/对照");
        } finally { releaseA?.("A迟到旧值"); await unmount(instance); }
    });

    await test("旧备注恢复：严格核对失败零解除，核对末段后保留原文、全部草稿及实际新基线", async () => {
        const { settings } = noteFixture();
        const legacySnapshot = { blockId: "20261011000000-legacy1", content: ("旧备注末段\n<img src=x onerror=alert(1)> & " + "长原文".repeat(1700)).slice(0, 5000), markdown: "旧备注末段\n{: custom-lvct-person-note=\"1\"}" };
        let legacy = true;
        let actualNote = "另一窗口刚创建的新备注";
        let inspections = 0;
        let detachAttempts = 0;
        const writes = [];
        const openedDocs = [];
        const fieldsState = { blockId: "20261011000000-fieldb1", snapshot: { schemaVersion: 1, ownerDocId: person.docId, items: [
            { id: "00000000-0000-4000-8000-000000000001", kind: "entry", label: "电话", value: "11001" },
        ] } };
        const instance = mount(PersonDetail, { target: fixture, props: {
            settings, person, onRecord: async () => { writes.push("interaction"); },
            onLoadInsights: async () => ({ timeline: [], coAttendance: [], totalEvents: 0 }),
            onLoadPersonNote: async () => { if (legacy) throw new Error("旧备注多段形态无法确认完整内容"); return actualNote; },
            onSavePersonNote: async (docId, value, expected) => { assert(!legacy && expected === actualNote && docId === person.docId, "恢复后未使用实际新读基线"); writes.push("note"); actualNote = value; return value; },
            onInspectLegacyPersonNote: async (docId) => { assert(docId === person.docId, "核对错误人物"); inspections += 1; if (inspections === 1) throw new Error("旧标记并非单一直属段落"); return structuredClone(legacySnapshot); },
            onDetachLegacyPersonNote: async (docId, expected) => { assert(docId === person.docId && JSON.stringify(expected) === JSON.stringify(legacySnapshot), "解除没有携带原人物核对快照"); detachAttempts += 1; if (detachAttempts === 1) throw new Error("解除响应未确认"); legacy = false; },
            onGetCadence: async () => null, onSaveCadence: async () => { writes.push("cadence"); },
            onLoadPersonFields: async () => structuredClone(fieldsState), onSavePersonFields: async () => { writes.push("fields"); throw new Error("不应保存补充资料"); },
            onOpenPersonDoc: (docId) => openedDocs.push(docId), onNavigate() {}, onChanged() {}, onDeleted() {}, onClose() {},
        } });
        const pressNote = (label) => { const button = findButton(personalNote(fixture), label); assert(button && !button.disabled, `个人备注缺少可用按钮 ${label}`); button.click(); };
        const assertDrafts = () => {
            assert(noteInput(fixture).value === "恢复前已有本地草稿", "旧备注恢复丢弃个人备注草稿");
            assert(fixture.querySelector('[aria-label="互动备注"]').value === "恢复前互动草稿", "旧备注恢复修改互动草稿");
            assert(fixture.querySelector('[aria-label="联系节奏模式"]').value === "custom" && fixture.querySelector('[aria-label="自定义天数"]').value === "37", "旧备注恢复修改联系节奏草稿");
            assert(fixture.querySelector('.lvct-person-fields textarea[aria-label="内容"]').value === "恢复前补充资料草稿", "旧备注恢复修改补充资料草稿");
            assert(writes.length === 0 && !document.querySelector(".lvct-closeguard"), "旧备注恢复保存了其他内容或打开聚合守卫");
        };
        try {
            await waitFor(() => personalNote(fixture)?.textContent.includes("读取失败") && fixture.querySelector('[aria-label="联系节奏模式"]') && findButton(fixture.querySelector(".lvct-person-fields"), "编辑补充资料"), "旧备注错误或辅助区域未就绪");
            setInput(fixture.querySelector('[aria-label="互动备注"]'), "恢复前互动草稿");
            setSelect(fixture.querySelector('[aria-label="联系节奏模式"]'), "custom");
            await tick();
            setInput(fixture.querySelector('[aria-label="自定义天数"]'), "37");
            findButton(fixture.querySelector(".lvct-person-fields"), "编辑补充资料").click();
            await tick();
            setInput(fixture.querySelector('.lvct-person-fields textarea[aria-label="内容"]'), "恢复前补充资料草稿");
            pressNote("核对旧备注");
            await waitFor(() => personalNote(fixture).textContent.includes("原文未操作"), "不支持的旧形态未说明保持原文");
            assert(detachAttempts === 0 && !personalNote(fixture).querySelector('[aria-label="核对旧备注关联"]'), "核对失败仍允许解除");
            pressNote("核对旧备注");
            await waitFor(() => personalNote(fixture).querySelector('[aria-label="旧备注末段原文"]'), "可核对旧末段未展示");
            setInput(noteInput(fixture), "恢复前已有本地草稿");
            await tick();
            const oldText = personalNote(fixture).querySelector('[aria-label="旧备注末段原文"]');
            assert(oldText.textContent === legacySnapshot.content && oldText.children.length === 0 && oldText.scrollWidth <= oldText.clientWidth + 1, "旧末段5000字符纯文本缺失或横溢");
            assert(personalNote(fixture).textContent.includes("不能代表整份备注") && personalNote(fixture).textContent.includes("不会自动拼接、删除或覆盖原块"), "未说明旧末段边界及原文保留");
            pressNote("打开人物文档核对");
            assert(openedDocs.length === 1 && openedDocs[0] === person.docId && detachAttempts === 0, "打开文档错误或提前解除");
            assertDrafts();
            pressNote("取消核对");
            await tick();
            assert(!personalNote(fixture).querySelector('[aria-label="核对旧备注关联"]') && detachAttempts === 0, "取消核对仍解除旧关联或保留操作面板");
            assertDrafts();
            pressNote("重新读取");
            await tick();
            findButton(noteConfirm(fixture), "保留草稿并读取最新").click();
            await waitFor(() => personalNote(fixture).textContent.includes("读取失败") && !personalNote(fixture).textContent.includes("正在读取"), "重读旧形态失败未保持可核对入口");
            pressNote("核对旧备注");
            await waitFor(() => personalNote(fixture).querySelector('[aria-label="核对旧备注关联"]'), "取消后无法重新核对旧末段");
            pressNote("保留原文并解除旧备注关联");
            await waitFor(() => personalNote(fixture).textContent.includes("尚未确认解除") && !findButton(personalNote(fixture), "保留原文并解除旧备注关联").disabled, "解除失败未保留可核实恢复入口");
            assertDrafts();
            pressNote("保留原文并解除旧备注关联");
            await waitFor(() => personalNote(fixture).querySelector(".lvct-detail__person-note-legacy-detached") && personalNote(fixture).querySelector('[aria-label="最新已存个人备注"]')?.textContent === "另一窗口刚创建的新备注", "解除后未重读实际当前备注");
            assertDrafts();
            assert(detachAttempts === 2 && !legacy && !personalNote(fixture).querySelector('[aria-label="旧备注末段原文"]'), "解除成功后残留旧操作或未退出旧形态");
            pressNote("保存备注");
            await waitFor(() => personalNote(fixture).querySelector(".lvct-chip")?.textContent.includes("已保存"), "恢复后草稿无法按实际基线保存");
            assert(actualNote === "恢复前已有本地草稿" && writes.join() === "note", "恢复自动写入其他内容或保存丢稿");
        } finally { await unmount(instance); }
    });

    await test("旧备注恢复：检查和解除挂起时阻止切人，卸载后的迟到结果不污染新人物或继续旧读取", async () => {
        const { settings, second } = noteFixture();
        const snapshot = { blockId: "20261011000000-legacy1", content: "旧备注末段", markdown: "旧备注末段" };
        let hangInspect = true;
        let releaseInspect;
        let releaseDetach;
        let aReads = 0;
        const facade = {
            settings, viewPreferences: DEFAULT_VIEW_PREFERENCES,
            listContacts: async () => [person, second], loadRecentInteractions: async () => ({}),
            loadPersonInsights: async () => ({ timeline: [], coAttendance: [], totalEvents: 0 }),
            loadPersonNote: async (docId) => { if (docId === person.docId) { aReads += 1; throw new Error("旧备注需核对"); } return "B人物已存备注"; },
            savePersonNote: async () => { throw new Error("本回归不应保存"); },
            inspectLegacyPersonNote: async () => hangInspect ? new Promise((resolve) => { releaseInspect = resolve; }) : snapshot,
            detachLegacyPersonNote: async () => new Promise((resolve) => { releaseDetach = resolve; }),
            listPersonExchanges: async () => [], listPersonAliases: async () => [], listPersonOrgMemberships: async () => [],
            listCommonOrgBackground: async () => [], listOrganizations: async () => [], listPersonFollowUps: async () => [],
            getPersonCadence: async () => null, listTemplates: async () => [],
        };
        const mountWorkbench = () => mount(Workbench, { target: fixture, props: {
            settings, preferences: structuredClone(DEFAULT_VIEW_PREFERENCES), initialView: "people", isMobile: window.innerWidth <= 640,
            facade, onPreferencesUpdated() {}, onOpenPersonDoc() {},
        } });
        let instance = mountWorkbench();
        const open = async (entry) => {
            await waitFor(() => fixture.querySelector(`[data-person-item-id="${entry.itemId}"]`), "待核对人物卡片未就绪");
            fixture.querySelector(`[data-person-item-id="${entry.itemId}"]`).click();
            await waitFor(() => noteInput(fixture) && (entry === person ? personalNote(fixture).textContent.includes("读取失败") : noteInput(fixture).value === "B人物已存备注"), "待核对人物备注未就绪");
        };
        const assertBusyNavigation = async () => {
            findButton(fixture.querySelector(".lvct-detail"), "下一位")?.click();
            await tick();
            assert(fixture.querySelector(".lvct-detail")?.textContent.includes(person.name) && !document.querySelector(".lvct-closeguard"), "旧备注操作挂起时切人或错误调用聚合守卫");
        };
        const remountB = async () => {
            await unmount(instance);
            fixture.replaceChildren();
            instance = mountWorkbench();
            await open(second);
            setInput(noteInput(fixture), "B当前草稿");
            await tick();
        };
        const assertB = () => assert(noteInput(fixture).value === "B当前草稿" && !personalNote(fixture).querySelector('[aria-label="核对旧备注关联"]') && !personalNote(fixture).querySelector(".lvct-detail__person-note-legacy-detached"), "旧人物迟到恢复污染B草稿或复活旧操作");
        try {
            await open(person);
            findButton(personalNote(fixture), "核对旧备注").click();
            await waitFor(() => releaseInspect, "旧备注检查未挂起");
            await assertBusyNavigation();
            await remountB();
            releaseInspect(snapshot);
            await tick();
            assertB();
            await unmount(instance);
            fixture.replaceChildren();
            hangInspect = false;
            instance = mountWorkbench();
            await open(person);
            findButton(personalNote(fixture), "核对旧备注").click();
            await waitFor(() => personalNote(fixture).querySelector('[aria-label="核对旧备注关联"]'), "旧备注检查未完成");
            findButton(personalNote(fixture), "保留原文并解除旧备注关联").click();
            await waitFor(() => releaseDetach, "旧备注解除未挂起");
            await assertBusyNavigation();
            const readsBeforeLateDetach = aReads;
            await remountB();
            releaseDetach();
            await tick();
            assertB();
            assert(aReads === readsBeforeLateDetach, "旧人物卸载后仍继续发起解除后的读取");
        } finally { releaseInspect?.(snapshot); releaseDetach?.(); await unmount(instance); }
    });
}
