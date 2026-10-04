import { mount, unmount, tick } from "svelte";
import Workbench from "../../../src/components/Workbench.svelte";
import { DEFAULT_VIEW_PREFERENCES } from "../../../src/domain/preferences";
import { createLifecycleToken, LIFECYCLE_CONTEXT } from "../../../src/domain/lifecycle";
import { requestPersonNavigation } from "../../../src/libs/data-events";
import { invalidateRoster } from "../../../src/services/roster";

function documentFixture(kernel, settings) {
    const personA = {
        docId: "20261004000000-navdoca", itemId: "20261004000000-navrowa", name: "文档导航同名人物",
        phone: "13000000001", email: "", wechat: "", website: "", birthday: "", isLunar: false,
        group: "", tags: [], relatedItemIds: [],
    };
    const personB = { ...personA, docId: "20261004000000-navdocb", itemId: "20261004000000-navrowb", phone: "13900000002" };
    const state = {
        personA, personB, people: [personA, personB], contactReads: 0, organizationReads: 0,
        insightDocs: [], openedDocs: [], writes: [], kernelWrites: [], contactHook: null,
    };
    state.snapshot = () => JSON.parse(JSON.stringify(state.people));
    state.facade = {
        listContacts: async () => {
            const request = ++state.contactReads;
            return state.contactHook ? state.contactHook(request) : state.snapshot();
        },
        listOrganizations: async () => { state.organizationReads += 1; return []; },
        listPersonOrgMemberships: async () => [], listCommonOrgBackground: async () => [],
        listPersonExchanges: async () => [], listPersonAliases: async () => [], listPersonFollowUps: async () => [],
        loadPersonInsights: async (docId) => { state.insightDocs.push(docId); return { timeline: [], coAttendance: [], totalEvents: 0 }; },
        getPersonCadence: async () => null, listTemplates: async () => [], loadSelfIdentity: async () => null,
        loadRecentInteractions: async () => new Map(),
    };
    for (const method of [
        "recordInteraction", "deleteInteraction", "createPersonExchange", "changePersonExchangeStatus",
        "addPersonAlias", "removePersonAlias", "savePersonRelationshipLabels", "addOrganizationMember",
        "updateOrganizationMember", "removeOrganizationMember", "createFollowUp", "setFollowUpStatus",
        "snoozeFollowUp", "savePersonCadence", "saveTemplates", "saveViewPreferences",
    ]) {
        state.facade[method] = async (...args) => {
            state.writes.push(JSON.parse(JSON.stringify({ method, args })));
            throw new Error(`文档导航只读夹具拒绝写入：${method}`);
        };
    }
    if (kernel) {
        kernel.handler = async (route, body) => {
            if (route === "/api/av/renderAttributeView") return { view: { columns: [], rows: [personB, personA].map((person) => ({
                id: person.itemId, cells: [
                    { valueType: "block", value: { keyID: "primary", type: "block", block: { id: person.docId, content: person.name } } },
                    { valueType: "phone", value: { keyID: settings.fieldMap.phone, type: "phone", phone: { content: person.phone } } },
                ],
            })) } };
            if (route === "/api/query/sql" && /^\s*SELECT\b/i.test(body.stmt)) return [];
            if (route === "/api/sqlite/flushTransaction") return null;
            state.kernelWrites.push(JSON.parse(JSON.stringify({ route, body })));
            throw new Error(`文档导航只读夹具拒绝请求：${route}`);
        };
    }
    return state;
}

function documentEntry(target, state, docId, token) {
    const scroll = document.createElement("div");
    scroll.style.height = "120px";
    scroll.style.overflow = "auto";
    const before = document.createElement("div");
    before.style.height = "260px";
    const strip = document.createElement("div");
    strip.className = "lvct-doc-strip";
    strip.dataset.personDocId = docId;
    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.dataset.lvctPersonEntry = "";
    trigger.textContent = "查看人物详情";
    trigger.addEventListener("click", () => requestPersonNavigation(state.facade, { docId, source: "document", trigger }, token));
    strip.append(trigger);
    const after = document.createElement("div");
    after.style.height = "260px";
    scroll.append(before, strip, after);
    target.append(scroll);
    return { scroll, strip, trigger };
}

function workbench(state, target, settings, token) {
    const root = document.createElement("div");
    target.append(root);
    const instance = mount(Workbench, {
        target: root, context: new Map([[LIFECYCLE_CONTEXT, token]]),
        props: {
            facade: state.facade, settings, preferences: DEFAULT_VIEW_PREFERENCES, initialView: "orgs", isMobile: false,
            onPreferencesUpdated() {}, onOpenPersonDoc: (docId) => { state.openedDocs.push(docId); },
        },
    });
    let destroyed = false;
    return { root, async destroy() { if (!destroyed) { destroyed = true; await unmount(instance); root.remove(); } } };
}

async function settle() {
    for (let turn = 0; turn < 4; turn += 1) await tick();
}

async function opened({ root, state, until, button }) {
    await until(() => {
        const detail = root.querySelector(".lvct-detail");
        return detail?.querySelector(`a[href="tel:${state.personB.phone}"]`)
            && state.insightDocs.at(-1) === state.personB.docId;
    }, "同名人物未按目标稳定文档显示预期电话及洞察 callback");
    const detail = root.querySelector(".lvct-detail");
    await until(() => detail.querySelector(`a[href="tel:${state.personB.phone}"]`)
        && button("上一位", detail).disabled && !button("下一位", detail).disabled,
    "名册未完成读取或绑定 item 身份未核实，目标人物的上一位/下一位状态不一致");
    await until(() => !button("返回原文档", detail.querySelector(":scope > .lvct-form__actions")).disabled, "人物返回原文档出口未就绪");
    return detail;
}

function zeroWrites(assert, state) {
    assert(state.writes.length === 0 && state.kernelWrites.length === 0, "文档只读导航发起了 facade 或内核写入");
}

export async function runDocumentNavigationRegression({ test, assert, kernel, settings, fixture, until, button }) {
    for (const exit of ["X", "Esc", "footer"]) {
        await test(`文档导航 Workbench：${exit === "X" ? "cold mount" : "live"}同名稳定 doc/item，${exit}返回原文档及触发焦点`, async () => {
            const state = documentFixture(kernel, settings);
            const token = createLifecycleToken();
            const entry = documentEntry(fixture, state, state.personB.docId, token);
            let host;
            invalidateRoster();
            try {
                if (exit === "X") {
                    const oldToken = createLifecycleToken(token);
                    requestPersonNavigation(state.facade, { docId: state.personA.docId, source: "document", trigger: entry.trigger }, oldToken);
                    entry.trigger.focus({ preventScroll: true });
                    entry.scroll.scrollTop = 173;
                    entry.trigger.click();
                    oldToken.invalidate();
                    assert(state.contactReads === 0, "cold mount 之前请求被其他 owner 消费");
                    host = workbench(state, fixture, settings, token);
                } else {
                    host = workbench(state, fixture, settings, token);
                    await until(() => state.organizationReads === 1 && host.root.querySelector("h1")?.textContent === "组织", "真实 Workbench 未挂载");
                    entry.trigger.focus({ preventScroll: true });
                    entry.scroll.scrollTop = 173;
                    entry.trigger.click();
                }
                const scrollTop = entry.scroll.scrollTop;
                assert(scrollTop > 0, "原文档入口未形成真实滚动上下文");
                const detail = await opened({ root: host.root, state, until, button });
                assert(state.personB.docId !== state.personB.itemId && state.contactReads === 1
                    && state.insightDocs.join() === state.personB.docId, "同名选择错误、doc/item 混用或 cold pending 被重复消费");
                assert(button("上一位", detail).disabled && !button("下一位", detail).disabled
                    && !detail.querySelector(`a[href="tel:${state.personA.phone}"]`), "详情未保持绑定 item 身份或按同名首项回填");
                const panel = detail.closest(".lvct-dialog-panel");
                assert(panel.querySelector('.lvct-dialog-panel__close[aria-label="返回原文档"]'), "X 关闭出口未标明原文档");
                button("打开文档", detail).click();
                assert(state.openedDocs.join() === state.personB.docId, "真实打开文档 callback 收到 itemID 或另一同名文档");
                const returns = state.openedDocs.length;
                if (exit === "X") panel.querySelector(".lvct-dialog-panel__close").click();
                else if (exit === "Esc") {
                    panel.querySelector(".lvct-dialog-panel__close").focus({ preventScroll: true });
                    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
                } else button("返回原文档", detail.querySelector(":scope > .lvct-form__actions")).click();
                await until(() => !host.root.querySelector(".lvct-detail") && document.activeElement === entry.trigger, `${exit}关闭未恢复原文档触发焦点`);
                assert(state.openedDocs.length === returns + 1 && state.openedDocs.at(-1) === state.personB.docId
                    && entry.scroll.scrollTop === scrollTop && host.root.querySelector("h1")?.textContent === "组织", "返回 callback 重复、返回另一同名文档或丢失原入口上下文");
                zeroWrites(assert, state);
            } finally { token.invalidate(); await host?.destroy(); entry.scroll.remove(); invalidateRoster(); }
        });
    }

    await test("文档导航 Workbench：live 两个 owner 完全隔离，各自返回 callback 与触发焦点", async () => {
        const first = documentFixture(kernel, settings);
        const second = documentFixture(null, settings);
        const firstToken = createLifecycleToken();
        const secondToken = createLifecycleToken();
        const firstEntry = documentEntry(fixture, first, first.personB.docId, firstToken);
        const secondEntry = documentEntry(fixture, second, second.personB.docId, secondToken);
        const firstHost = workbench(first, fixture, settings, firstToken);
        const secondHost = workbench(second, fixture, settings, secondToken);
        invalidateRoster();
        try {
            await until(() => first.organizationReads === 1 && second.organizationReads === 1, "双 owner 工作台未完成挂载");
            firstEntry.trigger.focus({ preventScroll: true });
            firstEntry.trigger.click();
            const firstDetail = await opened({ root: firstHost.root, state: first, until, button });
            assert(second.contactReads === 0 && second.insightDocs.length === 0 && !secondHost.root.querySelector(".lvct-detail"), "第一 owner 导航被第二 owner 消费");
            secondEntry.trigger.focus({ preventScroll: true });
            secondEntry.trigger.click();
            const secondDetail = await opened({ root: secondHost.root, state: second, until, button });
            assert(first.contactReads === 1 && firstHost.root.querySelector(".lvct-detail") === firstDetail, "第二 owner 导航覆盖第一详情");
            button("返回原文档", secondDetail.querySelector(":scope > .lvct-form__actions")).click();
            await until(() => !secondHost.root.querySelector(".lvct-detail") && document.activeElement === secondEntry.trigger, "第二 owner 返回焦点串到第一入口");
            assert(second.openedDocs.join() === second.personB.docId && first.openedDocs.length === 0, "第二 owner 返回 callback 串台");
            button("返回原文档", firstDetail.querySelector(":scope > .lvct-form__actions")).click();
            await until(() => !firstHost.root.querySelector(".lvct-detail") && document.activeElement === firstEntry.trigger, "第一 owner 返回没有恢复自身入口");
            assert(first.openedDocs.join() === first.personB.docId && second.openedDocs.length === 1, "第一 owner 返回 callback 串台或重复");
            zeroWrites(assert, first); zeroWrites(assert, second);
        } finally {
            firstToken.invalidate(); secondToken.invalidate();
            await secondHost.destroy(); await firstHost.destroy();
            firstEntry.scroll.remove(); secondEntry.scroll.remove(); invalidateRoster();
        }
    });

    await test("文档导航 Workbench：cold pending token 已失效不投递，live 无效 token 不消费，原 owner 可接新请求", async () => {
        const state = documentFixture(kernel, settings);
        const parent = createLifecycleToken();
        const expired = createLifecycleToken(parent);
        const staleEntry = documentEntry(fixture, state, state.personA.docId, expired);
        const entry = documentEntry(fixture, state, state.personB.docId, parent);
        staleEntry.trigger.click();
        expired.invalidate();
        const host = workbench(state, fixture, settings, parent);
        invalidateRoster();
        try {
            await until(() => state.organizationReads === 1, "cold 工作台未挂载");
            await settle();
            assert(state.contactReads === 0 && !host.root.querySelector(".lvct-detail"), "失效 cold pending 仍消费名册或打开人物");
            staleEntry.trigger.click();
            await settle();
            assert(state.contactReads === 0, "live 失效 token 请求仍投递");
            entry.trigger.focus({ preventScroll: true });
            entry.trigger.click();
            const detail = await opened({ root: host.root, state, until, button });
            button("返回原文档", detail.querySelector(":scope > .lvct-form__actions")).click();
            await until(() => !host.root.querySelector(".lvct-detail") && document.activeElement === entry.trigger, "取消旧 pending 后新请求没有正常出口");
            assert(state.contactReads === 1 && state.openedDocs.join() === state.personB.docId, "旧请求复活或新请求重复消费");
            zeroWrites(assert, state);
        } finally { parent.invalidate(); await host.destroy(); staleEntry.scroll.remove(); entry.scroll.remove(); invalidateRoster(); }
    });

    for (const response of ["成功", "失败"]) {
        await test(`文档导航 Workbench：旧名册请求迟到${response}不能覆盖最新稳定目标与返回来源`, async () => {
            const state = documentFixture(kernel, settings);
            const token = createLifecycleToken();
            const oldEntry = documentEntry(fixture, state, state.personA.docId, token);
            const entry = documentEntry(fixture, state, state.personB.docId, token);
            let pending;
            state.contactHook = (request) => request === 1
                ? new Promise((resolve, reject) => { pending = { resolve, reject }; }) : state.snapshot();
            const host = workbench(state, fixture, settings, token);
            invalidateRoster();
            try {
                await until(() => state.organizationReads === 1, "工作台未挂载");
                oldEntry.trigger.focus({ preventScroll: true });
                oldEntry.trigger.click();
                await until(() => pending, "旧导航没有进入名册挂起请求");
                entry.trigger.focus({ preventScroll: true });
                entry.trigger.click();
                const detail = await opened({ root: host.root, state, until, button });
                if (response === "成功") pending.resolve(state.snapshot());
                else pending.reject(new Error("旧文档名册迟到失败"));
                await settle();
                assert(host.root.querySelector(".lvct-detail") === detail && state.contactReads === 2
                    && state.insightDocs.join() === state.personB.docId && !host.root.querySelector(".lvct-notice--error"), "旧响应覆盖新人物、回填故障或重复导航");
                button("返回原文档", detail.querySelector(":scope > .lvct-form__actions")).click();
                await until(() => !host.root.querySelector(".lvct-detail") && document.activeElement === entry.trigger, "最新目标未恢复自己的文档入口");
                assert(state.openedDocs.join() === state.personB.docId, "迟到旧请求改写返回原文档 ID");
                zeroWrites(assert, state);
            } finally { token.invalidate(); pending?.resolve(state.snapshot()); await host.destroy(); oldEntry.scroll.remove(); entry.scroll.remove(); invalidateRoster(); }
        });
    }

    for (const response of ["成功", "失败"]) {
        await test(`文档导航 Workbench：实例失效及卸载后迟到${response}零回填，不抢新实例焦点，旧 token 不重放`, async () => {
            const state = documentFixture(kernel, settings);
            const oldToken = createLifecycleToken();
            const oldEntry = documentEntry(fixture, state, state.personA.docId, oldToken);
            let pending;
            state.contactHook = (request) => request === 1
                ? new Promise((resolve, reject) => { pending = { resolve, reject }; }) : state.snapshot();
            const oldHost = workbench(state, fixture, settings, oldToken);
            let freshHost;
            const freshToken = createLifecycleToken();
            const entry = documentEntry(fixture, state, state.personB.docId, freshToken);
            invalidateRoster();
            try {
                await until(() => state.organizationReads === 1, "旧工作台未挂载");
                oldEntry.trigger.click();
                await until(() => pending, "旧导航未挂起");
                oldToken.invalidate();
                await oldHost.destroy();
                freshHost = workbench(state, fixture, settings, freshToken);
                await until(() => state.organizationReads === 2, "新工作台未挂载");
                entry.trigger.focus({ preventScroll: true });
                entry.trigger.click();
                const detail = await opened({ root: freshHost.root, state, until, button });
                const focus = button("编辑", detail);
                focus.focus({ preventScroll: true });
                if (response === "成功") pending.resolve(state.snapshot());
                else pending.reject(new Error("卸载后的名册迟到失败"));
                oldEntry.trigger.click();
                await settle();
                assert(!oldHost.root.isConnected && !oldHost.root.querySelector(".lvct-workbench, .lvct-detail") && freshHost.root.querySelector(".lvct-detail") === detail
                    && document.activeElement === focus && state.contactReads === 2 && state.insightDocs.join() === state.personB.docId
                    && state.openedDocs.length === 0 && !freshHost.root.querySelector(".lvct-notice--error"), "卸载后旧请求重放、更新新实例或抢走焦点");
                button("返回原文档", detail.querySelector(":scope > .lvct-form__actions")).click();
                await until(() => !freshHost.root.querySelector(".lvct-detail") && document.activeElement === entry.trigger, "新实例正常返回出口受旧请求影响");
                assert(state.openedDocs.join() === state.personB.docId, "旧实例调用了宿主文档 callback");
                zeroWrites(assert, state);
            } finally {
                oldToken.invalidate(); freshToken.invalidate(); pending?.resolve(state.snapshot());
                await freshHost?.destroy(); await oldHost.destroy(); oldEntry.scroll.remove(); entry.scroll.remove(); invalidateRoster();
            }
        });
    }

    for (const identity of ["丢失文档", "重复 docId", "非法 itemId", "itemId 误作文档"]) {
        await test(`文档导航 Workbench：${identity}保持未核实，零同名回退，恢复后只进原稳定文档`, async () => {
            const state = documentFixture(kernel, settings);
            const token = createLifecycleToken();
            const docId = identity === "itemId 误作文档" ? state.personB.itemId : state.personB.docId;
            if (identity === "丢失文档") state.people = [state.personA];
            else if (identity === "重复 docId") state.people = [state.personA, state.personB, { ...state.personB, itemId: "20261004000000-navrowc" }];
            else if (identity === "非法 itemId") state.people = [state.personA, { ...state.personB, itemId: "row-legacy" }];
            const failedEntry = documentEntry(fixture, state, docId, token);
            const entry = documentEntry(fixture, state, state.personB.docId, token);
            const host = workbench(state, fixture, settings, token);
            invalidateRoster();
            try {
                await until(() => state.organizationReads === 1, "工作台未挂载");
                failedEntry.trigger.focus({ preventScroll: true });
                failedEntry.trigger.click();
                await until(() => host.root.querySelector(".lvct-notice--error")?.textContent.includes("未按同名跳转"), "无效身份未显示明确未核实");
                assert(state.contactReads === 1 && state.insightDocs.length === 0 && state.openedDocs.length === 0
                    && !host.root.querySelector(".lvct-detail"), "目标失联或不唯一后按同名人物打开");
                state.people = [state.personA, state.personB];
                entry.trigger.focus({ preventScroll: true });
                entry.trigger.click();
                const detail = await opened({ root: host.root, state, until, button });
                assert(!host.root.querySelector(".lvct-notice--error"), "身份恢复仍显示旧导航错误");
                button("返回原文档", detail.querySelector(":scope > .lvct-form__actions")).click();
                await until(() => !host.root.querySelector(".lvct-detail") && document.activeElement === entry.trigger, "恢复稳定目标未恢复文档出口");
                assert(state.contactReads === 2 && state.openedDocs.join() === state.personB.docId, "恢复时错误请求重发、返回 itemId 或同名首项");
                zeroWrites(assert, state);
            } finally { token.invalidate(); await host.destroy(); failedEntry.scroll.remove(); entry.scroll.remove(); invalidateRoster(); }
        });
    }

    await test("文档导航 Workbench：原入口卸载后按原 docId 找重建档案条，返回 callback 与新触发焦点一致", async () => {
        const state = documentFixture(kernel, settings);
        const token = createLifecycleToken();
        const entry = documentEntry(fixture, state, state.personB.docId, token);
        const host = workbench(state, fixture, settings, token);
        let replacement;
        invalidateRoster();
        try {
            await until(() => state.organizationReads === 1, "工作台未挂载");
            entry.trigger.focus({ preventScroll: true });
            entry.trigger.click();
            const detail = await opened({ root: host.root, state, until, button });
            entry.scroll.remove();
            replacement = documentEntry(fixture, state, state.personB.docId, token);
            button("返回原文档", detail.querySelector(":scope > .lvct-form__actions")).click();
            await until(() => !host.root.querySelector(".lvct-detail") && document.activeElement === replacement.trigger, "原入口失联后没有按原 docId 恢复新档案条焦点");
            assert(state.contactReads === 1 && state.openedDocs.join() === state.personB.docId, "返回重建入口误发导航读取或使用另一文档");
            zeroWrites(assert, state);
        } finally { token.invalidate(); await host.destroy(); entry.scroll.remove(); replacement?.scroll.remove(); invalidateRoster(); }
    });
}
