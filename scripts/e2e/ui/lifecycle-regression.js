import { mount, unmount, tick } from "svelte";
import Workbench from "../../../src/components/Workbench.svelte";
import { emitDataChanged } from "../../../src/libs/data-events";
import { DEFAULT_VIEW_PREFERENCES } from "../../../src/domain/preferences";
import { createLifecycleToken, LIFECYCLE_CONTEXT } from "../../../src/domain/lifecycle";
import { handleProtyleEvent, disposePersonPanels } from "../../../src/panels/person-panel";
import { bindOrgMembershipStorage } from "../../../src/data/org-membership";
import { kernel } from "./siyuan-mock.js";

function dashboardData() {
    return {
        people: 0,
        relations: 0,
        birthdays: [],
        birthdaysThisWeek: 0,
        stale: [],
        staleTotal: 0,
        neverContacted: 0,
        neverContactedItemIds: [],
        followUps: [],
        actions: [],
        neverOrder: {},
    };
}

function createFacade(counter) {
    return {
        settings: {},
        viewPreferences: DEFAULT_VIEW_PREFERENCES,
        isMobile: false,
        i18n: {},
        loadDashboard: async () => {
            counter.loads += 1;
            return dashboardData();
        },
        loadViewPreferences: async () => DEFAULT_VIEW_PREFERENCES,
        saveViewPreferences: async (value) => value,
        loadRecentInteractions: async () => ({}),
    };
}

export async function runLifecycleRegression({ test, assert, fixture, until, settings }) {
    await test("生命周期：档案条组织读取后才销毁或切文档，迟到结果不回填", async () => {
        for (const mode of ["dispose", "switch"]) {
            const token = createLifecycleToken();
            const personDocId = "20261004000000-person1";
            let finishOrganizations;
            let reads = 0;
            const plugin = { loadData: async () => { reads += 1; return ""; } };
            bindOrgMembershipStorage(plugin);
            kernel.handler = async (route) => {
                if (route === "/api/av/renderAttributeView") return { view: {
                    columns: [], rows: [{ id: "20261004000000-row0001", cells: [
                        { valueType: "block", value: { type: "block", keyID: "name", block: { id: personDocId, content: "迟到档案" } } },
                    ] }],
                } };
                if (route === "/api/query/sql") return new Promise((resolve) => { finishOrganizations = resolve; });
                throw new Error(`生命周期夹具拒绝 ${route}`);
            };
            const element = document.createElement("div");
            element.innerHTML = '<div class="protyle-title"></div>';
            fixture.append(element);
            const protyle = { element, block: { rootID: personDocId } };
            const context = { settings, plugin, lifecycleToken: token };
            try {
                handleProtyleEvent(context, { detail: { protyle } });
                await until(() => !!finishOrganizations, "档案条未进入组织读取");
                if (mode === "dispose") token.invalidate();
                else {
                    protyle.block.rootID = "20261004000000-other01";
                    handleProtyleEvent({ ...context, settings: null }, { detail: { protyle } });
                }
                finishOrganizations([]);
                await new Promise((resolve) => setTimeout(resolve, 30));
                assert(!element.querySelector(".lvct-doc-strip"), "迟到组织读取回填旧文档档案条");
                disposePersonPanels(plugin);
                const before = reads;
                emitDataChanged();
                await new Promise((resolve) => setTimeout(resolve, 30));
                assert(reads === before, "销毁后档案条仍读取旧插件实例");
            } finally {
                token.invalidate(); disposePersonPanels(plugin); element.remove();
            }
        }
    });
    await test("生命周期：父实例卸载阻断挂起偏好回填、取消防抖，不抢新焦点", async () => {
        const token = createLifecycleToken();
        const facade = createFacade({ loads: 0 });
        let reads = 0;
        let applied = 0;
        let release;
        facade.loadViewPreferences = () => {
            reads += 1;
            return new Promise((resolve) => { release = resolve; });
        };
        const focusTarget = document.createElement("button");
        focusTarget.textContent = "新实例焦点";
        document.body.appendChild(focusTarget);
        const component = mount(Workbench, {
            target: fixture,
            context: new Map([[LIFECYCLE_CONTEXT, token]]),
            props: {
                facade, settings: facade.settings, preferences: DEFAULT_VIEW_PREFERENCES, isMobile: false,
                onPreferencesUpdated() { applied += 1; }, onOpenPersonDoc() {},
            },
        });
        try {
            await until(() => reads === 1, "延迟偏好请求未启动");
            emitDataChanged();
            token.invalidate();
            focusTarget.focus();
            release({ ...DEFAULT_VIEW_PREFERENCES, revision: 99 });
            await new Promise((resolve) => setTimeout(resolve, 450));
            assert(applied === 0 && reads === 1, "父实例关闭后偏好回填或防抖请求仍执行");
            assert(document.activeElement === focusTarget, "已失效回调抢走新焦点");
        } finally {
            await unmount(component);
            focusTarget.remove();
        }
    });

    await test("生命周期：连续十二次挂载销毁后数据与视图监听全部移除", async () => {
        const add = window.addEventListener;
        const remove = window.removeEventListener;
        const active = new Set();
        const eventTypes = new Set(["lvct-data-changed", "lvct-workbench-view"]);
        window.addEventListener = function (type, handler, options) {
            if (eventTypes.has(type)) active.add(handler);
            return add.call(this, type, handler, options);
        };
        window.removeEventListener = function (type, handler, options) {
            if (eventTypes.has(type)) active.delete(handler);
            return remove.call(this, type, handler, options);
        };
        try {
            for (let iteration = 0; iteration < 12; iteration += 1) {
                const facade = createFacade({ loads: 0 });
                const component = mount(Workbench, { target: fixture, props: {
                    facade, settings: facade.settings, preferences: DEFAULT_VIEW_PREFERENCES, isMobile: false,
                    onPreferencesUpdated() {}, onOpenPersonDoc() {},
                } });
                await tick();
                emitDataChanged();
                await unmount(component);
                assert(active.size === 0, `第${iteration + 1}次销毁后残留监听`);
            }
        } finally {
            window.addEventListener = add;
            window.removeEventListener = remove;
        }
    });

    await test("生命周期：重复挂载只产生一次活跃刷新订阅，卸载后延迟回调无副作用", async () => {
        const firstCounter = { loads: 0 };
        const secondCounter = { loads: 0 };
        const firstFacade = createFacade(firstCounter);
        const secondFacade = createFacade(secondCounter);
        let firstPreferenceLoads = 0;
        let secondPreferenceLoads = 0;
        firstFacade.loadViewPreferences = async () => { firstPreferenceLoads += 1; return DEFAULT_VIEW_PREFERENCES; };
        secondFacade.loadViewPreferences = async () => { secondPreferenceLoads += 1; return DEFAULT_VIEW_PREFERENCES; };
        const secondFixture = document.createElement("div");
        secondFixture.className = "lvct-lifecycle-fixture";
        document.body.appendChild(secondFixture);
        let first = mount(Workbench, {
            target: fixture,
            props: {
                facade: firstFacade,
                settings: firstFacade.settings,
                preferences: DEFAULT_VIEW_PREFERENCES,
                isMobile: false,
                onPreferencesUpdated() {},
                onOpenPersonDoc() {},
            },
        });
        const second = mount(Workbench, {
            target: secondFixture,
            props: {
                facade: secondFacade,
                settings: secondFacade.settings,
                preferences: DEFAULT_VIEW_PREFERENCES,
                isMobile: false,
                onPreferencesUpdated() {},
                onOpenPersonDoc() {},
            },
        });
        try {
            await until(() => firstPreferenceLoads === 1 && secondPreferenceLoads === 1, "工作台订阅初始化未完成");
            emitDataChanged();
            await until(() => firstPreferenceLoads >= 2 && secondPreferenceLoads >= 2, "数据变化未触发偏好重新核实");
            assert(firstPreferenceLoads === 2, "第一个工作台重复订阅");
            assert(secondPreferenceLoads === 2, "第二个工作台重复订阅");

            await unmount(first);
            first = null;
            emitDataChanged();
            await until(() => secondPreferenceLoads >= 3, "存活工作台未收到数据变化");
            await new Promise((resolve) => setTimeout(resolve, 450));
            assert(firstPreferenceLoads === 2, "已卸载工作台仍执行延迟刷新");
            assert(secondPreferenceLoads === 3, "存活工作台重复执行延迟刷新");
        } finally {
            if (first) await unmount(first);
            await unmount(second);
            secondFixture.remove();
            await tick();
        }
    });

    await test("生命周期：工作台视图事件按插件实例隔离", async () => {
        const counter = { loads: 0 };
        const facade = createFacade(counter);
        const otherCounter = { loads: 0 };
        const otherFacade = createFacade(otherCounter);
        const otherFixture = document.createElement("div");
        document.body.appendChild(otherFixture);
        const first = mount(Workbench, {
            target: fixture,
            props: {
                facade,
                settings: facade.settings,
                preferences: DEFAULT_VIEW_PREFERENCES,
                isMobile: false,
                onPreferencesUpdated() {},
                onOpenPersonDoc() {},
            },
        });
        const other = mount(Workbench, {
            target: otherFixture,
            props: {
                facade: otherFacade,
                settings: otherFacade.settings,
                preferences: DEFAULT_VIEW_PREFERENCES,
                isMobile: false,
                onPreferencesUpdated() {},
                onOpenPersonDoc() {},
            },
        });
        try {
            await until(() => counter.loads >= 1 && otherCounter.loads >= 1, "隔离工作台初始读取未完成");
            window.dispatchEvent(new CustomEvent("lvct-workbench-view", { detail: { facade, view: "people" } }));
            await until(() => fixture.querySelector(".lvct-workbench__nav-item--active")?.textContent?.includes("联系人"), "目标工作台未切换视图");
            assert(otherFixture.querySelector(".lvct-workbench__nav-item--active")?.textContent?.includes("首页"), "其他插件实例被错误切换");
        } finally {
            await unmount(first);
            await unmount(other);
            otherFixture.remove();
        }
    });
}
