import { mount, unmount, tick } from "svelte";
import Workbench from "../../../src/components/Workbench.svelte";
import { DEFAULT_VIEW_PREFERENCES } from "../../../src/domain/preferences";
import { FIELD_SPECS } from "../../../src/domain/fields";
import { emitDataChanged, requestPersonNavigation } from "../../../src/libs/data-events";

function renderPeople(people) {
    return { view: {
        columns: FIELD_SPECS.map((field) => ({ id: field.key, name: field.nameZh, type: field.type })),
        rows: people.map((person) => ({ id: person.itemId, cells: [{ valueType: "block", value: {
            type: "block", keyID: "name", block: { id: person.docId, content: person.name },
        } }] })), rowCount: people.length,
    } };
}

function readOnlyFacade(settings, people) {
    return {
        settings, viewPreferences: DEFAULT_VIEW_PREFERENCES,
        listContacts: async () => people, loadRecentInteractions: async () => ({}),
        loadPersonInsights: async () => ({ timeline: [], coAttendance: [], totalEvents: 0 }),
        loadPersonNote: async () => "", listPersonExchanges: async () => [], listPersonAliases: async () => [],
        listPersonOrgMemberships: async () => [], listCommonOrgBackground: async () => [], listOrganizations: async () => [],
        listPersonFollowUps: async () => [], getPersonCadence: async () => null, listTemplates: async () => [],
    };
}

export async function runReturnFocusRegression({ test, assert, fixture, settings, kernel, until, button }) {
    await test("详情返回焦点：慢刷新期间用户已选择新控件和滚动位置，返回请求取消且不回跳", async () => {
        const person = {
            docId: "20261011000000-focus01", itemId: "20261011000000-focusr1", name: "返回焦点核对",
            phone: "", email: "", wechat: "", website: "", birthday: "", isLunar: false,
            group: "", tags: [], relatedItemIds: [],
        };
        let delayNext = false;
        let refreshStarted = false;
        let releaseRefresh;
        kernel.handler = async (route, payload) => {
            if (route !== "/api/av/renderAttributeView") throw new Error(`返回焦点只读用例拒绝 ${route}`);
            // 详情也会全量读名册；仅拦住联系人页的渐进请求，保持慢刷新状态可验证。
            if (delayNext && payload.page === 1 && payload.pageSize === 200) {
                delayNext = false;
                refreshStarted = true;
                await new Promise((resolve) => { releaseRefresh = resolve; });
            }
            return { view: {
                columns: FIELD_SPECS.map((field) => ({ id: field.key, name: field.nameZh, type: field.type })),
                rows: [{ id: person.itemId, cells: [{ valueType: "block", value: {
                    type: "block", keyID: "name", block: { id: person.docId, content: person.name },
                } }] }], rowCount: 1,
            } };
        };
        const scrollFrame = document.createElement("div");
        scrollFrame.style.cssText = "height:320px;overflow:auto";
        const target = document.createElement("div");
        target.style.height = "720px";
        scrollFrame.appendChild(target);
        fixture.appendChild(scrollFrame);
        const facade = {
            settings, viewPreferences: DEFAULT_VIEW_PREFERENCES,
            listContacts: async () => [person], loadRecentInteractions: async () => ({}),
            loadPersonInsights: async () => ({ timeline: [], coAttendance: [], totalEvents: 0 }),
            loadPersonNote: async () => "", listPersonExchanges: async () => [], listPersonAliases: async () => [],
            listPersonOrgMemberships: async () => [], listCommonOrgBackground: async () => [], listOrganizations: async () => [],
            listPersonFollowUps: async () => [], getPersonCadence: async () => null, listTemplates: async () => [],
        };
        const instance = mount(Workbench, { target, props: {
            settings, preferences: DEFAULT_VIEW_PREFERENCES, initialView: "people", isMobile: window.innerWidth < 700,
            facade, onPreferencesUpdated() {}, onOpenPersonDoc() {},
        } });
        try {
            await until(() => target.querySelector(".lvct-person-card"), "联系人入口未完成首次读取");
            scrollFrame.scrollTop = 40;
            target.querySelector(".lvct-person-card").click();
            await until(() => target.querySelector(".lvct-detail"), "人物详情未打开");
            delayNext = true;
            emitDataChanged();
            await until(() => refreshStarted && target.querySelector(".lvct-person-card") && !target.querySelector(".lvct-people__skeleton"), "数据变化没有触发受控慢刷新或列表出现闪烁骨架");
            button("返回联系人", target.querySelector(".lvct-dialog-panel")).click();
            await until(() => !target.querySelector(".lvct-dialog-panel"), "详情关闭未完成");
            await tick();
            const search = target.querySelector(".lvct-people__desktop-search, .lvct-people__mobile-search");
            assert(search, "慢刷新期间联系人搜索入口消失");
            search.focus({ preventScroll: true });
            scrollFrame.scrollTop = 200;
            const newScrollTop = scrollFrame.scrollTop;
            assert(document.activeElement === search && newScrollTop > 40, "用例没有形成用户新的焦点和滚动位置");
            releaseRefresh();
            releaseRefresh = undefined;
            await until(() => target.querySelector(".lvct-person-card") && !target.querySelector(".lvct-people__skeleton"), "慢刷新没有完成");
            await tick();
            await new Promise((resolve) => requestAnimationFrame(resolve));
            assert(document.activeElement === search, "迟到的返回请求抢走了用户新的搜索焦点");
            assert(scrollFrame.scrollTop === newScrollTop, "迟到的返回请求恢复旧滚动位置，覆盖了用户的新操作");
        } finally {
            releaseRefresh?.();
            await unmount(instance);
            scrollFrame.remove();
        }
    });

    await test("详情返回焦点：编辑姓名后排到第 201 位，自动展开所在页并恢复原人物入口", async () => {
        const people = Array.from({ length: 201 }, (_, index) => ({
            docId: `20261011000000-${String(index).padStart(7, "0")}`,
            itemId: `20261011000001-${String(index).padStart(7, "0")}`,
            name: index === 0 ? "A原人物" : `M联系人${String(index).padStart(3, "0")}`,
            phone: "", email: "", wechat: "", website: "", birthday: "", isLunar: false,
            group: "", tags: [], relatedItemIds: [],
        }));
        const person = people[0];
        let delayNext = false;
        let refreshStarted = false;
        let releaseRefresh;
        kernel.handler = async (route, payload) => {
            if (route !== "/api/av/renderAttributeView") throw new Error(`排序返回只读用例拒绝 ${route}`);
            if (delayNext && payload.page === 1 && payload.pageSize === 200) {
                delayNext = false;
                refreshStarted = true;
                await new Promise((resolve) => { releaseRefresh = resolve; });
            }
            return renderPeople([...people].sort((a, b) => a.name.localeCompare(b.name, "zh-CN")));
        };
        const target = document.createElement("div");
        fixture.appendChild(target);
        const instance = mount(Workbench, { target, props: {
            settings, preferences: DEFAULT_VIEW_PREFERENCES, initialView: "people", isMobile: window.innerWidth < 700,
            facade: readOnlyFacade(settings, people), onPreferencesUpdated() {}, onOpenPersonDoc() {},
        } });
        try {
            await until(() => target.querySelector(".lvct-people__progress")?.textContent.includes("已加载 201 / 201"), "完整名册未加载");
            assert(target.querySelectorAll(".lvct-person-card").length === 200, "初始展示范围并非首屏 200 人");
            target.querySelector(`[data-person-item-id="${person.itemId}"]`).click();
            await until(() => target.querySelector(".lvct-detail"), "原人物详情未打开");
            person.name = "Z原人物已改名";
            delayNext = true;
            emitDataChanged();
            await until(() => refreshStarted && target.querySelector(".lvct-person-card") && !target.querySelector(".lvct-people__skeleton"), "改名没有触发受控名册刷新或列表出现闪烁骨架");
            button("返回联系人", target.querySelector(".lvct-dialog-panel")).click();
            await until(() => !target.querySelector(".lvct-dialog-panel"), "原人物详情未关闭");
            releaseRefresh();
            releaseRefresh = undefined;
            await until(() => target.querySelector(".lvct-people__progress")?.textContent.includes("已加载 201 / 201")
                && target.querySelector(`[data-person-item-id="${person.itemId}"]`) === document.activeElement,
                "排序移出首屏后未自动展开并聚焦原人物");
            assert(target.querySelectorAll(".lvct-person-card").length === 201, "原人物所在页没有实际展开");
            assert(document.activeElement.textContent.includes("Z原人物已改名"), "返回入口仍是改名前的旧卡片");
        } finally {
            releaseRefresh?.();
            await unmount(instance);
            target.remove();
        }
    });

    await test("详情返回焦点：旧返回仍在等名册时打开另一人物，迟到刷新不抢新详情焦点", async () => {
        const people = ["A旧详情", "B新详情"].map((name, index) => ({
            docId: `20261011000002-${String(index).padStart(7, "0")}`,
            itemId: `20261011000003-${String(index).padStart(7, "0")}`,
            name, phone: "", email: "", wechat: "", website: "", birthday: "", isLunar: false,
            group: "", tags: [], relatedItemIds: [],
        }));
        let delayNext = false;
        let refreshStarted = false;
        let releaseRefresh;
        kernel.handler = async (route, payload) => {
            if (route !== "/api/av/renderAttributeView") throw new Error(`新详情返回只读用例拒绝 ${route}`);
            if (delayNext && payload.page === 1 && payload.pageSize === 200) {
                delayNext = false;
                refreshStarted = true;
                await new Promise((resolve) => { releaseRefresh = resolve; });
            }
            return renderPeople(people);
        };
        const target = document.createElement("div");
        fixture.appendChild(target);
        const facade = readOnlyFacade(settings, people);
        const instance = mount(Workbench, { target, props: {
            settings, preferences: DEFAULT_VIEW_PREFERENCES, initialView: "people", isMobile: window.innerWidth < 700,
            facade, onPreferencesUpdated() {}, onOpenPersonDoc() {},
        } });
        try {
            await until(() => target.querySelectorAll(".lvct-person-card").length === 2, "人物入口未加载");
            target.querySelector(`[data-person-item-id="${people[0].itemId}"]`).click();
            await until(() => target.querySelector(".lvct-detail"), "旧人物详情未打开");
            delayNext = true;
            emitDataChanged();
            await until(() => refreshStarted && target.querySelector(".lvct-person-card") && !target.querySelector(".lvct-people__skeleton"), "名册慢刷新未开始或列表出现闪烁骨架");
            button("返回联系人", target.querySelector(".lvct-dialog-panel")).click();
            await until(() => !target.querySelector(".lvct-dialog-panel"), "旧详情未关闭");
            requestPersonNavigation(facade, { docId: people[1].docId, source: "document" });
            await until(() => target.querySelector(".lvct-detail__id")?.textContent.includes("B新详情")
                && target.querySelector(".lvct-dialog-panel")?.contains(document.activeElement), "文档入口未打开并聚焦新人物详情");
            const focus = document.activeElement;
            releaseRefresh();
            releaseRefresh = undefined;
            await until(() => !target.querySelector(".lvct-people__skeleton") && target.querySelectorAll(".lvct-person-card").length === 2,
                "旧名册刷新未完成");
            await tick();
            await new Promise((resolve) => requestAnimationFrame(resolve));
            assert(document.activeElement === focus && target.querySelector(".lvct-dialog-panel").contains(document.activeElement),
                "迟到返回请求把焦点移出了新的详情弹窗");
            assert(target.querySelector(".lvct-detail__id").textContent.includes("B新详情"), "旧请求覆盖了当前的新人物详情");
        } finally {
            releaseRefresh?.();
            await unmount(instance);
            target.remove();
        }
    });
}
