import { mount, unmount, tick } from "svelte";
import { fromStore, writable } from "svelte/store";
import PersonFieldsEditor from "../../../src/components/people/PersonFieldsEditor.svelte";
import PersonDetail from "../../../src/components/people/PersonDetail.svelte";
import Workbench from "../../../src/components/Workbench.svelte";
import { DEFAULT_VIEW_PREFERENCES } from "../../../src/domain/preferences";
import { invalidateRoster } from "../../../src/services/roster";
import { FIELD_SPECS } from "../../../src/domain/fields";
import { kernel } from "./siyuan-mock.js";

const DOC_A = "20261017000000-fields1";
const DOC_B = "20261017000000-fields2";
const BLOCK_A = "20261017000000-fieldb1";
const ID = (index) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
const clone = (value) => JSON.parse(JSON.stringify(value));
const stateFor = (docId = DOC_A, items = []) => ({ ...(items.length ? { blockId: docId === DOC_A ? BLOCK_A : "20261017000000-fieldb2" } : {}), snapshot: { schemaVersion: 1, ownerDocId: docId, items } });
const row = (id, label, value, parentId) => ({ id: ID(id), kind: "entry", label, value, ...(parentId ? { parentId: ID(parentId) } : {}) });
const group = (id, label) => ({ id: ID(id), kind: "group", label });
const input = (element, value) => { element.value = value; element.dispatchEvent(new Event("input", { bubbles: true })); };
const change = (element, value) => { element.value = value; element.dispatchEvent(new Event("change", { bubbles: true })); };
const namedButton = (root, label) => [...root.querySelectorAll("button")].find((node) => node.textContent.trim() === label);
const root = (fixture) => fixture.querySelector(".lvct-person-fields");
const cards = (fixture) => [...root(fixture).querySelectorAll(".lvct-person-fields__item")];
const guardChoice = (choice) => document.querySelector(`.lvct-closeguard button[data-choice="${choice}"]`);
const visibleValues = (fixture) => [...root(fixture).querySelectorAll("[data-field-content]")].map((node) => node.textContent);
const copyButton = (fixture, index) => root(fixture).querySelector(`[data-copy-field-id="${ID(index)}"]`);

function replaceClipboard(value) {
    const descriptor = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    Object.defineProperty(navigator, "clipboard", { configurable: true, value });
    return () => {
        if (descriptor) Object.defineProperty(navigator, "clipboard", descriptor);
        else delete navigator.clipboard;
    };
}

function memoryStore(initial = stateFor()) {
    let saved = clone(initial);
    const writes = [];
    return {
        writes,
        read: () => clone(saved),
        load: async (docId) => {
            if (docId !== saved.snapshot.ownerDocId) return stateFor(docId);
            return clone(saved);
        },
        save: async (docId, snapshot, expected) => {
            writes.push({ docId, snapshot: clone(snapshot), expected: clone(expected) });
            saved = { blockId: saved.blockId ?? BLOCK_A, snapshot: clone(snapshot) };
            return clone(saved);
        },
    };
}

async function cleanup(instance) {
    guardChoice("cancel")?.click();
    if (instance) await unmount(instance);
}

function personFixture(settings) {
    const person = {
        docId: DOC_A, itemId: "20261017000000-fieldr1", name: "资料接线人物",
        phone: "", email: "", wechat: "", website: "", birthday: "", isLunar: false,
        group: "", tags: [], relatedItemIds: [],
    };
    kernel.handler = async (route) => {
        if (route === "/api/av/renderAttributeView") return { view: {
            columns: FIELD_SPECS.map((field) => ({ id: field.key, name: field.nameZh, type: field.type })),
            rows: [{ id: person.itemId, cells: [{ valueType: "block", value: {
                type: "block", keyID: "name", block: { id: person.docId, content: person.name },
            } }] }], rowCount: 1,
        } };
        throw new Error(`补充资料 UI 夹具不允许内核写入 ${route}`);
    };
    invalidateRoster();
    const facade = {
        settings, viewPreferences: DEFAULT_VIEW_PREFERENCES,
        listContacts: async () => [person], loadRecentInteractions: async () => ({}),
        loadPersonInsights: async () => ({ timeline: [], coAttendance: [], totalEvents: 0 }),
        loadPersonNote: async () => "", listPersonExchanges: async () => [], listPersonAliases: async () => [],
        listPersonOrgMemberships: async () => [], listCommonOrgBackground: async () => [], listOrganizations: async () => [],
        listPersonFollowUps: async () => [], getPersonCadence: async () => null, listTemplates: async () => [],
    };
    return { person, facade };
}

export async function runPersonFieldsRegression({ test, assert, fixture, until, button, settings }) {
    await test("补充资料：重复号码微信邮箱与分组保存后重开完整回读", async () => {
        const store = memoryStore(stateFor(DOC_A, [group(1, "联系方式"), row(2, "电话", "11001", 1), row(3, "电话", "11002", 1), row(4, "微信", "work_wechat", 1), row(5, "微信", "home_wechat", 1), row(6, "邮箱", "first@example.test", 1), row(7, "邮箱", "second@example.test", 1)]));
        let instance = mount(PersonFieldsEditor, { target: fixture, props: { personDocId: DOC_A, onLoad: store.load, onSave: store.save, onOpenDocument() {} } });
        try {
            await until(() => namedButton(root(fixture), "编辑补充资料"), "补充资料未完成读取");
            assert(["11001", "11002", "work_wechat", "home_wechat", "first@example.test", "second@example.test"].every((value) => root(fixture).textContent.includes(value)), "相同名称的多条资料被合并或丢失");
            button("编辑补充资料", root(fixture)).click();
            await until(() => cards(fixture).length === 7, "编辑器未保留全部稳定条目");
            const telephone = cards(fixture).find((item) => item.querySelector('[aria-label="内容"]')?.value === "11002");
            input(telephone.querySelector('[aria-label="内容"]'), "11003\n仅工作日联系");
            await tick();
            button("保存补充资料", root(fixture)).click();
            await until(() => store.writes.length === 1 && namedButton(root(fixture), "编辑补充资料"), "完整资料保存未收口");
            assert(store.read().snapshot.items.length === 7 && store.read().snapshot.items.find((item) => item.id === ID(3)).value === "11003\n仅工作日联系", "保存变更重建身份或丢失多行内容");
            await unmount(instance);
            fixture.replaceChildren();
            instance = mount(PersonFieldsEditor, { target: fixture, props: { personDocId: DOC_A, onLoad: store.load, onSave: store.save, onOpenDocument() {} } });
            await until(() => root(fixture)?.textContent.includes("11003"), "保存后重新挂载未从原存储回读");
            assert(root(fixture).textContent.includes("仅工作日联系") && root(fixture).textContent.includes("second@example.test") && root(fixture).textContent.includes("联系方式"), "重开丢失多行、次值或分组");
        } finally { await cleanup(instance); fixture.replaceChildren(); }
    });

    await test("补充资料：新增分组与重复条目，取消编辑由关闭守卫保留草稿", async () => {
        const store = memoryStore();
        const instance = mount(PersonFieldsEditor, { target: fixture, props: { personDocId: DOC_A, onLoad: store.load, onSave: store.save, onOpenDocument() {} } });
        try {
            await until(() => namedButton(root(fixture), "编辑补充资料"), "空资料未完成读取");
            button("编辑补充资料", root(fixture)).click();
            await tick();
            button("添加分组", root(fixture)).click();
            await until(() => root(fixture).querySelector('[aria-label="分组名称"]'), "新增分组未显示");
            input(root(fixture).querySelector('[aria-label="分组名称"]'), "联系方式");
            for (const value of ["11001", "11002"]) {
                button("添加资料条目", root(fixture)).click();
                await tick();
                const item = cards(fixture).at(-1);
                input(item.querySelector('[aria-label="条目名称"]'), "电话");
                input(item.querySelector('[aria-label="内容"]'), value);
                const select = item.querySelector('[aria-label="所属分组"]');
                const option = [...select.options].find((entry) => entry.textContent.includes("联系方式"));
                change(select, option.value);
                await tick();
            }
            button("取消编辑", root(fixture)).click();
            await until(() => guardChoice("cancel"), "取消编辑未保护新建条目");
            guardChoice("cancel").click();
            await until(() => !document.querySelector(".lvct-closeguard"), "取消守卫未恢复编辑器");
            assert(cards(fixture).length === 3 && root(fixture).querySelectorAll('[aria-label="内容"]')[1].value === "11002", "守卫取消丢失重复条目草稿");
            assert(store.writes.length === 0, "守卫取消触发了资料写入");
            button("取消编辑", root(fixture)).click();
            await until(() => guardChoice("discard"), "再次取消没有关闭守卫");
            guardChoice("discard").click();
            await until(() => namedButton(root(fixture), "编辑补充资料"), "放弃草稿后未退出编辑");
            assert(store.writes.length === 0 && store.read().snapshot.items.length === 0, "放弃草稿仍写入新增资料");
        } finally { await cleanup(instance); }
    });

    await test("补充资料：删除分组先预览，取消零改动，保留子项或连删各自明确", async () => {
        const original = stateFor(DOC_A, [group(1, "联系方式"), row(2, "电话", "11001", 1), row(3, "邮箱", "first@example.test", 1), row(4, "备注", "独立保留")]);
        const store = memoryStore(original);
        const instance = mount(PersonFieldsEditor, { target: fixture, props: { personDocId: DOC_A, onLoad: store.load, onSave: store.save, onOpenDocument() {} } });
        try {
            await until(() => namedButton(root(fixture), "编辑补充资料"), "已有分组未完成读取");
            button("编辑补充资料", root(fixture)).click();
            await tick();
            const groupCard = () => cards(fixture).find((item) => item.querySelector('[aria-label="分组名称"]'));
            button("删除", groupCard()).click();
            await until(() => namedButton(root(fixture), "保留子条目（解除分组）"), "删除分组未列出影响选择");
            assert(root(fixture).textContent.includes("2"), "删除影响未显示子条目数量");
            const confirm = root(fixture).querySelector('[role="group"]');
            button("取消", confirm).click();
            await tick();
            assert(cards(fixture).length === 4 && store.writes.length === 0, "取消删除已改变条目或发出写入");
            button("删除", groupCard()).click();
            await until(() => namedButton(root(fixture), "保留子条目（解除分组）"), "再次删除未显示保留选项");
            button("保留子条目（解除分组）", root(fixture)).click();
            await until(() => cards(fixture).length === 3, "解除分组未保留三个条目");
            button("保存补充资料", root(fixture)).click();
            await until(() => store.writes.length === 1 && namedButton(root(fixture), "编辑补充资料"), "解除分组保存未完成");
            assert(store.read().snapshot.items.length === 3 && store.read().snapshot.items.every((item) => item.kind === "entry" && !item.parentId), "解除分组仍残留分组/悬空父项");
        } finally { await cleanup(instance); fixture.replaceChildren(); }

        const deleteStore = memoryStore(original);
        const second = mount(PersonFieldsEditor, { target: fixture, props: { personDocId: DOC_A, onLoad: deleteStore.load, onSave: deleteStore.save, onOpenDocument() {} } });
        try {
            await until(() => namedButton(root(fixture), "编辑补充资料"), "连删场景未就绪");
            button("编辑补充资料", root(fixture)).click();
            await tick();
            const groupCard = cards(fixture).find((item) => item.querySelector('[aria-label="分组名称"]'));
            button("删除", groupCard).click();
            await until(() => namedButton(root(fixture), "连同子条目删除"), "删除分组没有连删选项");
            button("连同子条目删除", root(fixture)).click();
            await tick();
            button("保存补充资料", root(fixture)).click();
            await until(() => deleteStore.writes.length === 1 && namedButton(root(fixture), "编辑补充资料"), "连删保存未完成");
            assert(deleteStore.read().snapshot.items.length === 1 && deleteStore.read().snapshot.items[0].id === ID(4), "连删误删独立项或残留子项");
        } finally { await cleanup(second); }
    });

    await test("补充资料：保存失败保留草稿与原基线，重试后重新读取完整值", async () => {
        const store = memoryStore(stateFor(DOC_A, [row(1, "邮箱", "original@example.test")]));
        let fail = true;
        let attempts = 0;
        const save = async (...arguments_) => { attempts += 1; if (fail) throw new Error("模拟保存失败"); return store.save(...arguments_); };
        const instance = mount(PersonFieldsEditor, { target: fixture, props: { personDocId: DOC_A, onLoad: store.load, onSave: save, onOpenDocument() {} } });
        try {
            await until(() => namedButton(root(fixture), "编辑补充资料"), "失败场景未完成读取");
            button("编辑补充资料", root(fixture)).click();
            await tick();
            input(root(fixture).querySelector('[aria-label="内容"]'), "retry@example.test\n第二行");
            await tick();
            button("保存补充资料", root(fixture)).click();
            await until(() => root(fixture).textContent.includes("模拟保存失败"), "保存失败未显示错误");
            assert(root(fixture).querySelector('[aria-label="内容"]').value === "retry@example.test\n第二行" && store.writes.length === 0, "保存失败丢失草稿或覆盖已存值");
            fail = false;
            button("保存补充资料", root(fixture)).click();
            await until(() => attempts === 2 && namedButton(root(fixture), "编辑补充资料"), "明确重试未保存原草稿");
            assert(store.writes.length === 1 && store.writes[0].expected.snapshot.items[0].value === "original@example.test", "重试未保留编辑基线");
            button("重新读取", root(fixture)).click();
            await until(() => root(fixture).textContent.includes("retry@example.test"), "写后显式回读未保留保存结果");
        } finally { await cleanup(instance); }
    });

    await test("补充资料：revision 变化保留脏草稿，人物切换隔离迟到读取", async () => {
        const doc = writable(DOC_A);
        const activeDoc = fromStore(doc);
        const revision = writable(0);
        const activeRevision = fromStore(revision);
        let reads = 0;
        let release;
        const store = memoryStore(stateFor(DOC_A, [row(1, "电话", "11001")]));
        const load = async (docId) => {
            reads += 1;
            if (docId === DOC_A && reads > 1) return new Promise((resolve) => { release = resolve; });
            return docId === DOC_A ? store.load(docId) : stateFor(DOC_B, [row(2, "微信", "new_person")]);
        };
        const instance = mount(PersonFieldsEditor, { target: fixture, props: { get personDocId() { return activeDoc.current; }, get revision() { return activeRevision.current; }, onLoad: load, onSave: store.save, onOpenDocument() {} } });
        try {
            await until(() => namedButton(root(fixture), "编辑补充资料"), "代际场景未完成读取");
            button("编辑补充资料", root(fixture)).click();
            await tick();
            input(root(fixture).querySelector('[aria-label="内容"]'), "未提交的新草稿");
            revision.set(1);
            await tick();
            assert(root(fixture).querySelector('[aria-label="内容"]').value === "未提交的新草稿" && reads === 1, "revision 覆盖草稿或读取了可能覆盖的旧值");
            button("取消编辑", root(fixture)).click();
            await until(() => guardChoice("discard"), "放弃脏稿未触发守卫");
            guardChoice("discard").click();
            await until(() => namedButton(root(fixture), "编辑补充资料"), "放弃草稿未退出编辑");
            button("重新读取", root(fixture)).click();
            await until(() => release, "显式重新读取未开始");
            doc.set(DOC_B);
            await until(() => root(fixture)?.textContent.includes("new_person"), "新人物被旧读取阻塞");
            release(stateFor(DOC_A, [row(1, "电话", "迟到旧值")]));
            await tick();
            assert(root(fixture).textContent.includes("new_person") && !root(fixture).textContent.includes("迟到旧值"), "旧人物迟到读取覆盖新人物");
        } finally { release?.(store.read()); await cleanup(instance); }
    });

    await test("补充资料：人物切换后的迟到保存不覆盖新人物草稿", async () => {
        const doc = writable(DOC_A);
        const activeDoc = fromStore(doc);
        let release;
        let saved;
        const instance = mount(PersonFieldsEditor, { target: fixture, props: {
            get personDocId() { return activeDoc.current; },
            onLoad: async (docId) => stateFor(docId, [row(docId === DOC_A ? 1 : 2, "微信", docId === DOC_A ? "old_person" : "new_person")]),
            onSave: async (docId, snapshot) => { saved = { blockId: BLOCK_A, snapshot: clone(snapshot) }; return new Promise((resolve) => { release = resolve; }); },
            onOpenDocument() {},
        } });
        try {
            await until(() => namedButton(root(fixture), "编辑补充资料"), "保存切换场景未完成读取");
            button("编辑补充资料", root(fixture)).click();
            await tick();
            input(root(fixture).querySelector('[aria-label="内容"]'), "old_save");
            await tick();
            button("保存补充资料", root(fixture)).click();
            await until(() => release, "原人物保存未挂起");
            doc.set(DOC_B);
            await until(() => root(fixture)?.textContent.includes("new_person"), "新人物未绕开旧保存");
            button("编辑补充资料", root(fixture)).click();
            await tick();
            input(root(fixture).querySelector('[aria-label="内容"]'), "new_draft");
            release(saved);
            await tick();
            assert(root(fixture).querySelector('[aria-label="内容"]').value === "new_draft" && !root(fixture).textContent.includes("old_save"), "旧保存覆盖新人物草稿");
        } finally { release?.(saved); await cleanup(instance); }
    });

    await test("补充资料：读取错误及归属错误不会冒充空态，重新读取恢复且打开原文身份正确", async () => {
        let mode = "error";
        let opens = 0;
        const writes = [];
        const instance = mount(PersonFieldsEditor, { target: fixture, props: {
            personDocId: DOC_A,
            onLoad: async () => { if (mode === "error") throw new Error("模拟读取失败"); return mode === "owner" ? stateFor(DOC_B) : stateFor(DOC_A, [row(1, "电话", "11001")]); },
            onSave: async (...args) => { writes.push(args); throw new Error("不应保存"); },
            onOpenDocument: () => { opens += 1; },
        } });
        try {
            await until(() => root(fixture)?.querySelector('[role="alert"]'), "读取错误未显示");
            assert(root(fixture).textContent.includes("模拟读取失败") && !namedButton(root(fixture), "编辑补充资料") && !root(fixture).textContent.includes("还没有补充资料"), "读取失败被当成空资料提供编辑");
            mode = "owner";
            button("重新读取", root(fixture)).click();
            await until(() => root(fixture)?.querySelector('[role="alert"]'), "错误归属未拦截");
            assert(!namedButton(root(fixture), "编辑补充资料") && writes.length === 0, "错误归属允许编辑/写入");
            mode = "valid";
            button("重新读取", root(fixture)).click();
            await until(() => root(fixture)?.textContent.includes("11001"), "重读没有恢复有效资料");
            button("打开人物文档", root(fixture)).click();
            assert(opens === 1 && writes.length === 0, "打开原文误触发保存或回调遗漏");
        } finally { await cleanup(instance); }
    });

    await test("补充资料：空名称校验保留其他草稿，条目删除取消零写且确认后才移除", async () => {
        const store = memoryStore(stateFor(DOC_A, [row(1, "电话", "11001"), row(2, "电话", "11002")]));
        const instance = mount(PersonFieldsEditor, { target: fixture, props: { personDocId: DOC_A, onLoad: store.load, onSave: store.save } });
        try {
            await until(() => namedButton(root(fixture), "编辑补充资料"), "校验场景未就绪");
            button("编辑补充资料", root(fixture)).click();
            await tick();
            input(cards(fixture)[0].querySelector("input"), "");
            input(cards(fixture)[1].querySelector("textarea"), "11003");
            await tick();
            button("保存补充资料", root(fixture)).click();
            await until(() => root(fixture).querySelector('[aria-invalid="true"]'), "空名称未显示字段校验");
            assert(store.writes.length === 0 && cards(fixture)[1].querySelector("textarea").value === "11003", "名称错误导致写入或清空其他草稿");
            input(cards(fixture)[0].querySelector("input"), "电话");
            await tick();
            button("删除", cards(fixture)[0]).click();
            await until(() => root(fixture).querySelector('[aria-label="确认删除资料条目"]'), "删除条目未先确认");
            button("取消", root(fixture).querySelector('[aria-label="确认删除资料条目"]')).click();
            await tick();
            assert(cards(fixture).length === 2 && store.writes.length === 0, "取消删除仍改了条目");
            button("删除", cards(fixture)[0]).click();
            await tick();
            button("确认删除条目", root(fixture)).click();
            await tick();
            assert(cards(fixture).length === 1 && store.writes.length === 0, "确认删除未只改变草稿");
            button("保存补充资料", root(fixture)).click();
            await until(() => store.writes.length === 1 && namedButton(root(fixture), "编辑补充资料"), "条目删除没有完整保存");
            assert(store.read().snapshot.items[0].id === ID(2) && store.read().snapshot.items[0].value === "11003", "删除误改剩余条目身份或值");
        } finally { await cleanup(instance); }
    });

    await test("补充资料：390px 长名称长内容和删除选择没有横向溢出", async () => {
        const previousWidth = fixture.style.width;
        fixture.style.width = "min(390px,100%)";
        const label = "很长的自定义资料分组名称".repeat(6);
        const value = "https://example.test/" + "long-path-segment".repeat(100) + "\n第二行保留";
        const store = memoryStore(stateFor(DOC_A, [group(1, label), row(2, label, value, 1)]));
        const instance = mount(PersonFieldsEditor, { target: fixture, props: { personDocId: DOC_A, onLoad: store.load, onSave: store.save } });
        const noOverflow = () => [root(fixture), ...root(fixture).querySelectorAll(".lvct-person-fields__group,.lvct-person-fields__value,.lvct-person-fields__item,.lvct-person-fields__confirm,.lvct-person-fields__actions")].every((node) => node.scrollWidth <= node.clientWidth + 1);
        try {
            await until(() => root(fixture)?.textContent.includes("第二行保留"), "长资料未显示");
            assert(noOverflow(), "只读资料长文本横向溢出");
            button("编辑补充资料", root(fixture)).click();
            await tick();
            assert(cards(fixture)[1].querySelector("textarea").value === value && noOverflow(), "编辑丢失长文本或表单横向溢出");
            button("删除", cards(fixture)[0]).click();
            await tick();
            assert(noOverflow(), "窄屏删除选择横向溢出");
            button("取消", root(fixture).querySelector('[aria-label="确认删除分组"]')).click();
            await tick();
        } finally { await cleanup(instance); fixture.style.width = previousWidth; }
    });

    await test("补充资料：PersonDetail 入口传稳定文档身份和编辑基线，打开人物原文", async () => {
        const { person } = personFixture(settings);
        const store = memoryStore(stateFor(DOC_A, [row(1, "电话", "11001")]));
        const readDocs = [];
        const openDocs = [];
        const instance = mount(PersonDetail, { target: fixture, props: {
            settings, person, onRecord: async () => {}, onLoadInsights: async () => ({ timeline: [], coAttendance: [], totalEvents: 0 }),
            onOpenPersonDoc: (docId) => { openDocs.push(docId); }, onNavigate() {}, onChanged() {}, onDeleted() {}, onClose() {},
            onLoadPersonFields: async (docId) => { readDocs.push(docId); return store.load(docId); }, onSavePersonFields: store.save,
        } });
        try {
            await until(() => root(fixture)?.textContent.includes("11001"), "人物详情缺少补充资料入口");
            button("打开人物文档", root(fixture)).click();
            button("编辑补充资料", root(fixture)).click();
            await tick();
            input(root(fixture).querySelector("textarea"), "11002");
            await tick();
            button("保存补充资料", root(fixture)).click();
            await until(() => store.writes.length === 1 && namedButton(root(fixture), "编辑补充资料"), "人物详情没有接通保存");
            assert(readDocs.join() === DOC_A && openDocs.join() === DOC_A && store.writes[0].docId === DOC_A && store.writes[0].expected.blockId === BLOCK_A && store.writes[0].snapshot.items[0].id === ID(1), "详情混用 itemID/docID 或丢失原基线");
        } finally { await cleanup(instance); }
    });

    await test("补充资料：Workbench 人物卡筛中同名次值可复制编辑，外层关闭保留草稿，重开回读", async () => {
        const { facade } = personFixture(settings);
        const store = memoryStore(stateFor(DOC_A, [row(1, "电话", "11001"), row(2, "电话", "11002")]));
        const reads = [];
        const copied = [];
        const restore = replaceClipboard({ writeText: async (value) => { copied.push(value); } });
        facade.loadPersonFields = async (docId) => { reads.push(docId); return store.load(docId); };
        facade.savePersonFields = store.save;
        const instance = mount(Workbench, { target: fixture, props: {
            settings, preferences: clone(DEFAULT_VIEW_PREFERENCES), initialView: "people", isMobile: window.innerWidth <= 640,
            facade, onPreferencesUpdated() {}, onOpenPersonDoc() {},
        } });
        try {
            await until(() => fixture.querySelector(".lvct-person-card"), "真实工作台人物卡未显示");
            fixture.querySelector(".lvct-person-card").click();
            await until(() => root(fixture)?.textContent.includes("11001"), "工作台未传入补充资料回调");
            input(root(fixture).querySelector('[aria-label="筛选补充资料"]'), "11002");
            await tick();
            copyButton(fixture, 2).click();
            await until(() => root(fixture).querySelector(".lvct-person-fields__copy-status"), "工作台筛中次值未完成复制");
            assert(copied.join() === "11002" && visibleValues(fixture).join() === "11002" && store.writes.length === 0, "工作台复制同名次值选错身份或触发写入");
            button("编辑补充资料", root(fixture)).click();
            await tick();
            assert(cards(fixture).length === 2, "工作台从筛选结果编辑没有完整资料");
            input(cards(fixture).find((card) => card.dataset.fieldId === ID(2)).querySelector("textarea"), "11003");
            await tick();
            await until(() => !fixture.querySelector(".lvct-dialog-panel__close")?.disabled, "外层详情尚在读取");
            fixture.querySelector(".lvct-dialog-panel__close").click();
            await until(() => guardChoice("cancel"), "外层关闭没有保护补充资料");
            guardChoice("cancel").click();
            await until(() => !guardChoice("cancel"), "取消外层关闭未退出守卫");
            assert(cards(fixture).find((card) => card.dataset.fieldId === ID(2)).querySelector("textarea").value === "11003" && store.writes.length === 0, "取消关闭丢失草稿或发起写入");
            button("保存补充资料", root(fixture)).click();
            await until(() => store.writes.length === 1 && namedButton(root(fixture), "编辑补充资料"), "工作台补充资料未保存");
            fixture.querySelector(".lvct-dialog-panel__close").click();
            await until(() => !fixture.querySelector(".lvct-detail"), "已保存详情未关闭");
            fixture.querySelector(".lvct-person-card").click();
            await until(() => root(fixture)?.textContent.includes("11003"), "工作台重开没有读回已存资料");
            assert(reads.length === 2 && reads.every((docId) => docId === DOC_A) && store.writes[0].expected.blockId === BLOCK_A && store.read().snapshot.items.length === 2 && root(fixture).textContent.includes("11001"), "工作台文档身份、加载次数、保存基线或其他资料不正确");
        } finally { restore(); await cleanup(instance); }
    });

    await test("补充资料：HTTP 缺少 randomUUID 时仍可新增分组与资料，稳定 UUIDv4 可保存", async () => {
        const descriptor = Object.getOwnPropertyDescriptor(crypto, "randomUUID");
        Object.defineProperty(crypto, "randomUUID", { configurable: true, value: undefined });
        const store = memoryStore();
        let instance;
        try {
            instance = mount(PersonFieldsEditor, { target: fixture, props: { personDocId: DOC_A, onLoad: store.load, onSave: store.save } });
            await until(() => namedButton(root(fixture), "编辑补充资料"), "兼容场景未完成读取");
            button("编辑补充资料", root(fixture)).click();
            await tick();
            button("添加分组", root(fixture)).click();
            await until(() => cards(fixture).length === 1, "缺少 randomUUID 后无法新增分组");
            input(cards(fixture)[0].querySelector("input"), "联系方式");
            await tick();
            button("添加资料条目", root(fixture)).click();
            await until(() => cards(fixture).length === 2, "缺少 randomUUID 后无法新增条目");
            const ids = cards(fixture).map((card) => card.dataset.fieldId);
            input(cards(fixture)[1].querySelector("input"), "电话");
            input(cards(fixture)[1].querySelector("textarea"), "11001");
            change(cards(fixture)[1].querySelector("select"), ids[0]);
            await tick();
            button("保存补充资料", root(fixture)).click();
            await until(() => store.writes.length === 1 && namedButton(root(fixture), "编辑补充资料"), "兼容生成身份没有完成保存");
            const saved = store.read().snapshot.items;
            const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
            assert(saved.every((item, index) => item.id === ids[index] && uuid.test(item.id)) && new Set(ids).size === 2 && saved[1].parentId === ids[0], "fallback身份不符合 UUIDv4、重复或保存时重建");
        } finally {
            if (descriptor) Object.defineProperty(crypto, "randomUUID", descriptor);
            else delete crypto.randomUUID;
            await cleanup(instance);
        }
    });

    await test("补充资料：本地筛选同名次值和分组，清空与无结果明确，编辑保存保留完整资料", async () => {
        const initial = stateFor(DOC_A, [group(1, "工作联系"), row(2, "电话", "11001", 1), row(3, "电话", "11002", 1), row(4, "邮箱", "Second@Example.test", 1), row(5, "微信", "work_wechat"), group(6, "空分组")]);
        const store = memoryStore(initial);
        const instance = mount(PersonFieldsEditor, { target: fixture, props: { personDocId: DOC_A, onLoad: store.load, onSave: store.save } });
        try {
            await until(() => root(fixture)?.querySelector('[aria-label="筛选补充资料"]'), "阅读态没有筛选入口");
            const search = () => root(fixture).querySelector('[aria-label="筛选补充资料"]');
            input(search(), "  11002  ");
            await tick();
            assert(visibleValues(fixture).join() === "11002" && root(fixture).querySelector("h5")?.textContent === "工作联系" && root(fixture).textContent.includes("找到 1 / 4 条资料"), "按同名次值筛选时混入其他号码或丢失分组上下文");
            input(search(), " SECOND@EXAMPLE ");
            await tick();
            assert(visibleValues(fixture).join() === "Second@Example.test", "筛选未忽略大小写或首尾空白");
            input(search(), "工作联系");
            await tick();
            assert(visibleValues(fixture).length === 3 && root(fixture).textContent.includes("找到 3 / 4 条资料"), "组名命中没有展开该组完整子项");
            input(search(), "不存在的关键词");
            await tick();
            assert(visibleValues(fixture).length === 0 && root(fixture).textContent.includes("没有匹配的补充资料") && root(fixture).textContent.includes("找到 0 / 4 条资料"), "无匹配被显示为原始空资料或计数不准确");
            button("清空筛选", root(fixture)).click();
            await tick();
            assert(visibleValues(fixture).length === 4 && search().value === "" && store.writes.length === 0, "清空筛选没有恢复资料或产生了写入");
            input(search(), "空分组");
            await tick();
            assert(root(fixture).querySelector("h5")?.textContent === "空分组" && root(fixture).textContent.includes("分组中还没有条目") && !root(fixture).textContent.includes("没有匹配的补充资料"), "命中空分组被当成无结果");
            input(search(), "11002");
            await tick();
            button("编辑补充资料", root(fixture)).click();
            await tick();
            assert(cards(fixture).length === 6 && !search(), "从筛选结果进入编辑使用了筛选子集");
            input(cards(fixture).find((item) => item.dataset.fieldId === ID(3)).querySelector("textarea"), "11003");
            await tick();
            button("保存补充资料", root(fixture)).click();
            await until(() => store.writes.length === 1 && search(), "编辑完整资料后未回到阅读态");
            assert(store.read().snapshot.items.length === 6 && visibleValues(fixture).length === 4 && search().value === "" && store.read().snapshot.items.find((item) => item.id === ID(2)).value === "11001", "筛选编辑导致其他资料丢失或留下旧筛选");
        } finally { await cleanup(instance); }
    });

    await test("补充资料：按稳定条目复制同名次值的完整多行内容，复制中防重入且空值无按钮", async () => {
        const complete = " 11002\n第二行\t ";
        const store = memoryStore(stateFor(DOC_A, [row(1, "电话", "11001"), row(2, "电话", complete), row(3, "备注", "")]));
        const copied = [];
        let release;
        const restore = replaceClipboard({ writeText: (value) => { copied.push(value); return new Promise((resolve) => { release = resolve; }); } });
        const instance = mount(PersonFieldsEditor, { target: fixture, props: { personDocId: DOC_A, onLoad: store.load, onSave: store.save } });
        try {
            await until(() => copyButton(fixture, 2), "只读资料没有复制按钮");
            copyButton(fixture, 2).focus();
            copyButton(fixture, 2).click();
            copyButton(fixture, 2).click();
            await tick();
            assert(copied.length === 1 && copied[0] === complete && copyButton(fixture, 2).textContent === "复制中…" && copyButton(fixture, 1).disabled && !copyButton(fixture, 3), "复制发生重入、选错同名条目、裁剪多行空白或给空值提供复制");
            assert(document.activeElement === copyButton(fixture, 2), "复制按钮等待期间丢失键盘焦点");
            release();
            await until(() => root(fixture).querySelector(".lvct-person-fields__copy-status"), "复制完成没有上下文反馈");
            assert(document.activeElement === copyButton(fixture, 2), "复制中禁用按钮导致键盘焦点丢失");
            assert(root(fixture).querySelector(".lvct-person-fields__copy-status").closest("[data-field-id]").dataset.fieldId === ID(2) && store.writes.length === 0 && !root(fixture).querySelector(".lvct-form__error"), "复制反馈指向其他条目或影响了保存状态");
        } finally { release?.(); restore(); await cleanup(instance); }
    });

    await test("补充资料：复制拒绝只提示手动复制，资料原值保留且可明确重试", async () => {
        const store = memoryStore(stateFor(DOC_A, [row(1, "微信", "work_wechat\n保留第二行")]));
        let fail = true;
        const copied = [];
        const restore = replaceClipboard({ writeText: async (value) => { copied.push(value); if (fail) throw new Error("剪贴板权限拒绝"); } });
        const instance = mount(PersonFieldsEditor, { target: fixture, props: { personDocId: DOC_A, onLoad: store.load, onSave: store.save } });
        try {
            await until(() => copyButton(fixture, 1), "复制拒绝场景未就绪");
            copyButton(fixture, 1).click();
            await until(() => root(fixture).querySelector(".lvct-person-fields__copy-error"), "剪贴板拒绝未显示错误");
            assert(root(fixture).textContent.includes("请选中上方内容手动复制") && visibleValues(fixture)[0] === "work_wechat\n保留第二行" && !root(fixture).querySelector(".lvct-form__error") && !root(fixture).querySelector(".lvct-person-fields__copy-status") && store.writes.length === 0, "复制错误误报存储失败、丢失原值或出现成功提示");
            fail = false;
            copyButton(fixture, 1).click();
            await until(() => root(fixture).querySelector(".lvct-person-fields__copy-status"), "明确重试复制未恢复");
            assert(copied.length === 2 && copied.every((value) => value === "work_wechat\n保留第二行") && !root(fixture).querySelector(".lvct-person-fields__copy-error"), "重试没有复用完整原值或保留旧错误");
        } finally { restore(); await cleanup(instance); }
    });

    for (const transition of ["编辑", "重新读取", "切换人物"]) {
        await test(`补充资料：复制等待中${transition}隔离旧反馈，筛选不写入`, async () => {
            const doc = writable(DOC_A);
            const activeDoc = fromStore(doc);
            const store = memoryStore(stateFor(DOC_A, [row(1, "电话", "11001"), row(2, "电话", "11002")]));
            let readCount = 0;
            let release;
            let reject;
            const restore = replaceClipboard({ writeText: () => new Promise((resolve, rejectPromise) => { release = resolve; reject = rejectPromise; }) });
            const instance = mount(PersonFieldsEditor, { target: fixture, props: {
                get personDocId() { return activeDoc.current; },
                onLoad: async (docId) => { readCount += 1; return docId === DOC_A ? store.load(docId) : stateFor(DOC_B, [row(3, "微信", "new_person")]); },
                onSave: store.save,
            } });
            try {
                await until(() => copyButton(fixture, 2), "迟到复制场景未就绪");
                input(root(fixture).querySelector('[aria-label="筛选补充资料"]'), "11002");
                await tick();
                copyButton(fixture, 2).click();
                await until(() => release, "复制请求未挂起");
                if (transition === "编辑") {
                    button("编辑补充资料", root(fixture)).click();
                    await tick();
                    reject(new Error("迟到复制错误"));
                    await tick();
                    button("取消编辑", root(fixture)).click();
                    await until(() => root(fixture).querySelector('[aria-label="筛选补充资料"]'), "无修改编辑未正常退出");
                } else if (transition === "重新读取") {
                    const previousCopyButton = copyButton(fixture, 2);
                    button("重新读取", root(fixture)).click();
                    await until(() => readCount === 2 && copyButton(fixture, 2) && copyButton(fixture, 2) !== previousCopyButton && root(fixture).getAttribute("aria-busy") === "false", "刷新后未恢复资料上下文");
                    assert(copyButton(fixture, 2).disabled, "刷新过早放开尚未完成的复制操作");
                    release();
                } else {
                    doc.set(DOC_B);
                    await until(() => root(fixture).textContent.includes("new_person"), "切换人物没有读取新资料");
                    assert(copyButton(fixture, 3).disabled, "切换人物放开尚未完成的旧复制操作");
                    release();
                    assert(root(fixture).querySelector('[aria-label="筛选补充资料"]').value === "", "切换人物保留了旧人物筛选");
                }
                await tick();
                assert(!root(fixture).querySelector(".lvct-person-fields__copy-status,.lvct-person-fields__copy-error") && store.writes.length === 0, "旧复制结果污染当前人物/编辑/刷新或产生写入");
            } finally { release?.(); restore(); await cleanup(instance); }
        });
    }

    await test("补充资料：复制未结束时清空筛选不会再发复制，旧请求完成后才可复制新项", async () => {
        const store = memoryStore(stateFor(DOC_A, [row(1, "电话", "11001"), row(2, "电话", "11002")]));
        const calls = [];
        const releases = [];
        const restore = replaceClipboard({ writeText: (value) => { calls.push(value); return new Promise((resolve) => { releases.push(resolve); }); } });
        const instance = mount(PersonFieldsEditor, { target: fixture, props: { personDocId: DOC_A, onLoad: store.load, onSave: store.save } });
        try {
            await until(() => copyButton(fixture, 2), "复制串行场景未就绪");
            input(root(fixture).querySelector('[aria-label="筛选补充资料"]'), "11002");
            await tick();
            copyButton(fixture, 2).click();
            await until(() => calls.length === 1, "首个复制请求未发出");
            button("清空筛选", root(fixture)).click();
            await tick();
            assert(copyButton(fixture, 1).disabled && root(fixture).textContent.includes("正在完成复制"), "反馈失效后提前放开不可取消的复制操作");
            copyButton(fixture, 1).click();
            await tick();
            assert(calls.join() === "11002", "清空筛选后发出了可乱序写入的第二个复制请求");
            releases[0]();
            await until(() => !copyButton(fixture, 1).disabled, "旧请求完成后没有释放复制入口");
            assert(!root(fixture).querySelector(".lvct-person-fields__copy-status,.lvct-person-fields__copy-error"), "旧请求结束后播报已失效反馈");
            copyButton(fixture, 1).click();
            await until(() => calls.length === 2, "旧请求结束后无法发起新复制");
            assert(calls[1] === "11001" && copyButton(fixture, 1).disabled, "新复制选错稳定条目或未守门");
            releases[1]();
            await until(() => root(fixture).querySelector(".lvct-person-fields__copy-status"), "新复制完成后没有有效反馈");
            assert(root(fixture).querySelector(".lvct-person-fields__copy-status").closest("[data-field-id]").dataset.fieldId === ID(1) && store.writes.length === 0, "旧请求影响新反馈或复制产生存储写入");
        } finally { for (const release of releases) release(); restore(); await cleanup(instance); }
    });

    await test("补充资料：Workbench 关闭重开另一人物时全局复制串行，旧请求结束不污染新反馈", async () => {
        const { person, facade } = personFixture(settings);
        const personB = { ...person, docId: DOC_B, itemId: "20261017000000-fieldr2", name: "另一资料人物" };
        const originalKernel = kernel.handler;
        kernel.handler = async (route, body) => {
            const result = await originalKernel(route, body);
            if (route !== "/api/av/renderAttributeView") return result;
            return { ...result, view: { ...result.view, rowCount: 2, rows: [...result.view.rows, { id: personB.itemId, cells: [{ valueType: "block", value: {
                type: "block", keyID: "name", block: { id: DOC_B, content: personB.name },
            } }] }] } };
        };
        facade.listContacts = async () => [person, personB];
        const storeA = memoryStore(stateFor(DOC_A, [row(1, "电话", "A_person")]));
        const storeB = memoryStore(stateFor(DOC_B, [row(2, "电话", "B_person")]));
        facade.loadPersonFields = async (docId) => docId === DOC_A ? storeA.load(docId) : storeB.load(docId);
        facade.savePersonFields = async (...args) => args[0] === DOC_A ? storeA.save(...args) : storeB.save(...args);
        const calls = [];
        let releaseA;
        const restore = replaceClipboard({ writeText: (value) => {
            calls.push(value);
            return value === "A_person" ? new Promise((resolve) => { releaseA = resolve; }) : Promise.resolve();
        } });
        const instance = mount(Workbench, { target: fixture, props: {
            settings, preferences: clone(DEFAULT_VIEW_PREFERENCES), initialView: "people", isMobile: window.innerWidth <= 640,
            facade, onPreferencesUpdated() {}, onOpenPersonDoc() {},
        } });
        try {
            await until(() => fixture.querySelector(`[data-person-item-id="${person.itemId}"]`) && fixture.querySelector(`[data-person-item-id="${personB.itemId}"]`), "双人物真实工作台卡片未就绪");
            fixture.querySelector(`[data-person-item-id="${person.itemId}"]`).click();
            await until(() => root(fixture) && copyButton(fixture, 1), "A 人物补充资料未显示");
            copyButton(fixture, 1).click();
            await until(() => releaseA, "A 复制请求未挂起");
            await until(() => !fixture.querySelector(".lvct-dialog-panel__close")?.disabled, "A 人物详情仍在读取");
            fixture.querySelector(".lvct-dialog-panel__close").click();
            await until(() => !fixture.querySelector(".lvct-detail"), "A 人物详情未卸载");
            fixture.querySelector(`[data-person-item-id="${personB.itemId}"]`).click();
            await until(() => root(fixture) && copyButton(fixture, 2), "重开 B 人物未生成新的资料组件");
            copyButton(fixture, 2).click();
            await until(() => root(fixture).querySelector(".lvct-person-fields__copy-error"), "跨实例复制尚未完成时没有明确失败反馈");
            const failure = root(fixture).querySelector(".lvct-person-fields__copy-error").textContent;
            assert(calls.join() === "A_person" && failure.includes("请选中上方内容手动复制") && !copyButton(fixture, 2).disabled && !root(fixture).querySelector(".lvct-person-fields__copy-status"), "B 复制被排队、发出第二 API、保持忙碌或误报成功");
            releaseA();
            await tick();
            await tick();
            assert(root(fixture).querySelector(".lvct-person-fields__copy-error")?.textContent === failure && !root(fixture).querySelector(".lvct-person-fields__copy-status") && visibleValues(fixture).join() === "B_person", "A 迟到复制污染 B 原值或反馈");
            copyButton(fixture, 2).click();
            await until(() => root(fixture).querySelector(".lvct-person-fields__copy-status"), "A 结束后 B 明确重试无法成功");
            assert(calls.join() === "A_person,B_person" && !root(fixture).querySelector(".lvct-person-fields__copy-error") && root(fixture).querySelector(".lvct-person-fields__copy-status").closest("[data-field-id]").dataset.fieldId === ID(2) && storeA.writes.length === 0 && storeB.writes.length === 0, "跨实例重试选错人物、保留旧错误或触发数据写入");
        } finally { releaseA?.(); restore(); await cleanup(instance); }
    });

    await test("补充资料：HTTP 剪贴板 fallback 完整复制并恢复筛选框焦点选区", async () => {
        const complete = " 11002\nHTTP次值 ";
        const store = memoryStore(stateFor(DOC_A, [row(1, "电话", complete)]));
        const restore = replaceClipboard(undefined);
        const descriptor = Object.getOwnPropertyDescriptor(document, "execCommand");
        const copied = [];
        Object.defineProperty(document, "execCommand", { configurable: true, value: (command) => { assert(command === "copy", "fallback调用了非复制命令"); copied.push(document.activeElement.value); return true; } });
        const instance = mount(PersonFieldsEditor, { target: fixture, props: { personDocId: DOC_A, onLoad: store.load, onSave: store.save } });
        try {
            await until(() => copyButton(fixture, 1), "HTTP复制场景未就绪");
            const search = root(fixture).querySelector('[aria-label="筛选补充资料"]');
            input(search, "11002");
            await tick();
            search.focus();
            search.setSelectionRange(1, 4);
            copyButton(fixture, 1).click();
            await until(() => root(fixture).querySelector(".lvct-person-fields__copy-status"), "HTTP fallback未报告完成");
            assert(copied.join() === complete && document.activeElement === search && search.selectionStart === 1 && search.selectionEnd === 4 && store.writes.length === 0, "HTTP fallback裁剪值、夺走焦点/选区或写入数据");
        } finally {
            if (descriptor) Object.defineProperty(document, "execCommand", descriptor);
            else delete document.execCommand;
            restore();
            await cleanup(instance);
        }
    });
}
