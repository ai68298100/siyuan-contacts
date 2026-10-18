import { mount, unmount, tick } from "svelte";
import { fromStore, writable } from "svelte/store";
import OrgManagerDialog from "../../../src/components/org/OrgManagerDialog.svelte";
import OrgsView from "../../../src/components/org/OrgsView.svelte";
import Workbench from "../../../src/components/Workbench.svelte";
import { DEFAULT_VIEW_PREFERENCES } from "../../../src/domain/preferences";
import { emitDataChanged } from "../../../src/libs/data-events";
import { invalidateRoster } from "../../../src/services/roster";

function contextFixture() {
    const orgA = "20261004000000-ctxorga";
    const orgB = "20261004000000-ctxorgb";
    const members = Array.from({ length: 1001 }, (_, index) => ({
        id: `20261004000000-m${String(index).padStart(6, "0")}`,
        orgDocId: orgB, personDocId: `20261004000000-p${String(index).padStart(6, "0")}`,
        personName: index === 0 || index === 350 ? "上下文同名人物" : `上下文成员${index}`,
        department: "研发", title: "成员", affiliationKind: "work", joinedOn: "2026-01-01",
        leftOn: index < 801 ? "" : "2026-09-30", status: index < 801 ? "active" : "former",
    }));
    const otherMember = { ...members[0], id: "20261004000000-ctxmem1", orgDocId: orgA,
        personDocId: "20261004000000-ctxper1", personName: "另一组织成员" };
    const state = {
        orgA, orgB, members, otherMember, orgReads: 0, pages: [], fullReads: [], writes: [],
        failOrganizations: false, failMembers: false, pageHook: null, updateHook: null, insightDocs: [],
    };
    state.organizations = [
        { docId: orgA, name: "同名单位", archived: false, memberships: [otherMember] },
        { docId: orgB, name: "同名单位", archived: false, memberships: members },
    ];
    state.people = [otherMember, ...members].map((member, index) => ({
        docId: member.personDocId, itemId: `20261004000000-i${String(index).padStart(6, "0")}`,
        name: member.personName, phone: "", email: "", wechat: "", website: "", birthday: "",
        isLunar: false, group: "朋友", tags: [], relatedItemIds: [],
    }));
    state.page = (docId, options) => {
        const all = docId === orgA ? [otherMember] : docId === orgB ? members : [];
        const query = (options.query ?? "").trim().toLocaleLowerCase();
        const filtered = all.filter((member) => (!options.status || options.status === "all" || member.status === options.status)
            && (!query || [member.personName, member.department, member.title].some((value) => value.toLocaleLowerCase().includes(query))));
        const offset = options.offset ?? 0;
        const limit = options.limit ?? 200;
        const items = structuredClone(filtered.slice(offset, offset + limit));
        return { items, offset, limit, total: filtered.length, hasMore: offset + items.length < filtered.length,
            personDocIds: all.map((member) => member.personDocId),
            activePersonDocIds: all.filter((member) => member.status === "active").map((member) => member.personDocId) };
    };
    state.facade = {
        listContacts: async () => structuredClone(state.people),
        listOrganizations: async () => {
            state.orgReads += 1;
            if (state.failOrganizations) throw new Error("组织上下文隔离读取失败");
            return structuredClone(state.organizations);
        },
        listOrganizationMembersPage: async (docId, options) => {
            state.pages.push({ docId, ...options });
            if (state.pageHook) return state.pageHook(docId, options);
            if (state.failMembers) throw new Error("成员上下文隔离读取失败");
            return state.page(docId, options);
        },
        listOrganizationMembers: async (docId) => {
            state.fullReads.push(docId);
            if (state.failMembers) throw new Error("成员上下文隔离读取失败");
            return structuredClone(docId === orgA ? [otherMember] : members);
        },
        updateOrganizationMember: async (id, patch, expected) => {
            state.writes.push(JSON.parse(JSON.stringify({ id, patch, expected })));
            if (state.updateHook) await state.updateHook();
            Object.assign(members.find((member) => member.id === id), patch);
            emitDataChanged({ topics: ["memberships"], docIds: [orgB] });
        },
        listPersonOrgMemberships: async () => [],
        listCommonOrgBackground: async (docId) => docId === members[0].personDocId ? [] : [{
            orgDocId: orgB, orgName: "同名单位", peers: [{
                docId: members[0].personDocId, name: members[0].personName, overlapText: "2026-01-01 至今", samePeriod: true,
                contact: { ...state.people[1], docId: otherMember.personDocId, name: "过期人物快照" },
            }],
        }],
        loadPersonInsights: async (docId) => { state.insightDocs.push(docId); return { timeline: [], coAttendance: [], totalEvents: 0 }; },
        listPersonFollowUps: async () => [], listPersonExchanges: async () => [], listPersonAliases: async () => [],
        getPersonCadence: async () => null, listTemplates: async () => [], loadSelfIdentity: async () => null,
        loadRecentInteractions: async () => new Map(),
    };
    return state;
}

function input(node, value) {
    node.value = value;
    node.dispatchEvent(new Event("input", { bubbles: true }));
}

function ready(root) {
    const name = root.querySelector('[aria-label="新建组织名称"]');
    if (name) return !name.disabled;
    /* Workbench supplies the profile-creation callback, so the manager
       intentionally renders a “新建组织资料” button instead of the legacy
       inline name field.  An enabled organization item is the equivalent
       loaded-state signal for that host entry point. */
    const item = root.querySelector(".lvct-org-manager__org-item");
    return Boolean(item && !item.disabled);
}

function memberIds(root) {
    return [...root.querySelectorAll(".lvct-org-manager__member")].map((row) => row.dataset.membershipId).join(",");
}

async function filterAndExpand({ root, until, button }, targetPage = 1) {
    await until(() => ready(root) && root.querySelectorAll(".lvct-org-manager__member").length === 20
        && root.textContent.includes("1–20 / 1001 条"), "指定组织首屏未完成");
    input(root.querySelector('input[type="search"]'), "研发");
    await until(() => ready(root) && root.querySelectorAll(".lvct-org-manager__member").length === 20
        && root.textContent.includes("1–20 / 1001 条"), "成员搜索未完成");
    const status = root.querySelector('[aria-label="成员状态"]');
    status.value = "active";
    status.dispatchEvent(new Event("change", { bubbles: true }));
    await until(() => ready(root) && root.querySelectorAll(".lvct-org-manager__member").length === 20
        && root.textContent.includes("1–20 / 801 条"), "成员状态未保留或筛选未完成");
    const pageSize = root.querySelector('[aria-label="每页成员条数"]');
    pageSize.value = "100";
    pageSize.dispatchEvent(new Event("change", { bubbles: true }));
    await until(() => ready(root) && root.querySelectorAll(".lvct-org-manager__member").length === 100
        && root.textContent.includes("1–100 / 801 条"), "每页 100 条设置未生效");
    for (let page = 1; page < targetPage; page += 1) {
        button("下一页", root).click();
        const start = page * 100 + 1;
        await until(() => ready(root) && root.querySelectorAll(".lvct-org-manager__member").length === 100
            && root.textContent.includes(`${start}–${start + 99} / 801 条`), "成员分页未前进到目标页");
    }
}

export async function runOrganizationContextRegression({ test, assert, kernel, settings, fixture, until, button }) {
    await test("组织上下文：同名卡片传稳定 docId，通用入口无目标，刷新保留原卡片节点", async () => {
        const state = contextFixture();
        const revision = writable(0);
        const currentRevision = fromStore(revision);
        const opened = [];
        const instance = mount(OrgsView, { target: fixture, props: {
            facade: state.facade, get revision() { return currentRevision.current; },
            onOpenOrgManager: (docId) => opened.push(docId),
        } });
        try {
            await until(() => fixture.querySelectorAll(".lvct-orgs-view__card").length === 2, "同名卡片未显示");
            const card = fixture.querySelector(`[data-org-doc-id="${state.orgB}"]`);
            const trigger = button("管理", card);
            trigger.focus({ preventScroll: true });
            trigger.click();
            button("组织管理").click();
            assert(opened.length === 2 && opened[0] === state.orgB && opened[1] === undefined, "同名卡片按名称定位或通用入口误传鼠标事件");
            state.failOrganizations = true;
            revision.set(1);
            await until(() => fixture.textContent.includes("组织上下文隔离读取失败"), "组织列表故障没有显式未知");
            assert(card.isConnected && trigger.disabled && fixture.querySelectorAll(".lvct-orgs-view__card").length === 2, "刷新故障销毁原卡片或继续使用未核实入口");
            state.failOrganizations = false;
            button("重新加载").click();
            await until(() => !trigger.disabled, "只读重试未恢复卡片入口");
            assert(fixture.querySelector(`[data-org-doc-id="${state.orgB}"]`) === card, "刷新重建卡片并丢失触发节点");
        } finally { await unmount(instance); }
    });

    await test("组织管理：首次读取失败显示独立错误态，重试后恢复组织列表", async () => {
        const state = contextFixture();
        state.failOrganizations = true;
        const instance = mount(OrgManagerDialog, { target: fixture, props: { facade: state.facade, onClose() {} } });
        try {
            await until(() => fixture.querySelector(".lvct-org-manager__list .lvct-view-state__content")
                ?.textContent.includes("组织列表加载失败"), "首次读取失败没有显示独立错误态");
            assert(fixture.querySelectorAll(".lvct-org-manager__orgs").length === 0, "首次读取失败被渲染为空组织列表");
            assert(fixture.textContent.includes("组织列表读取失败，请先在左侧重新读取后再查看成员。"), "右侧仍提示从左侧选择组织，错误态不一致");
            const retry = button("重新读取组织和成员", fixture);
            assert(retry && !retry.disabled, "组织读取失败后重试入口不可用");
            state.failOrganizations = false;
            retry.click();
            await until(() => ready(fixture) && fixture.querySelectorAll(".lvct-org-manager__org-item").length === 2,
                "组织列表重试成功后没有恢复组织");
            assert(!fixture.textContent.includes("组织列表加载失败")
                && fixture.querySelector(".lvct-org-manager__org-item--active")?.textContent.includes("同名单位"), "重试后仍保留错误态或未选择加载成功的组织");
        } finally { await unmount(instance); }
    });

    await test("组织管理：确认放弃切换组织时清空成员备注草稿", async () => {
        const state = contextFixture();
        const instance = mount(OrgManagerDialog, { target: fixture, props: {
            facade: state.facade, initialOrgDocId: state.orgB, onClose() {},
        } });
        try {
            await until(() => ready(fixture) && fixture.querySelector(".lvct-org-manager__member"), "组织或成员列表未就绪");
            const manager = fixture.querySelector(".lvct-org-manager");
            /* 已有成员默认收起添加区；先显式打开再编辑新增备注草稿。 */
            button("添加成员", fixture).click();
            await until(() => fixture.querySelector(".lvct-org-manager__add-note input"), "按需添加区未展开");
            const note = fixture.querySelector(".lvct-org-manager__add-note input");
            input(note, "仅属于原组织的备注");
            const anotherOrg = [...fixture.querySelectorAll(".lvct-org-manager__org-item")]
                .find((item) => item.textContent.includes("（1）"));
            assert(anotherOrg, "没有找到目标组织入口");
            anotherOrg.click();
            await until(() => document.querySelector('.lvct-closeguard button[data-choice="discard"]'), "切换组织未保护备注草稿");
            document.querySelector('.lvct-closeguard button[data-choice="discard"]').click();
            await until(() => manager.dataset.orgDocId === state.orgA && (!note.isConnected || note.value === ""),
                "放弃原组织草稿后仍把旧备注带入目标组织");
            assert(state.writes.length === 0, "切换组织意外写入成员记录");
        } finally {
            document.querySelector('.lvct-closeguard button[data-choice="cancel"]')?.click();
            await unmount(instance);
        }
    });

    await test("组织上下文：initialOrgDocId 变化先守卫，草稿取消保留，放弃才切换，事件只补刷新一次", async () => {
        const state = contextFixture();
        const target = writable(state.orgB);
        const currentTarget = fromStore(target);
        const instance = mount(OrgManagerDialog, { target: fixture, props: {
            facade: state.facade, get initialOrgDocId() { return currentTarget.current; }, onClose() {},
        } });
        try {
            await until(() => ready(fixture), "指定组织未完成挂载");
            const manager = fixture.querySelector(".lvct-org-manager");
            assert(manager.dataset.orgDocId === state.orgB, "挂载回落首项");
            const row = fixture.querySelector(".lvct-org-manager__member");
            button("编辑", row).click();
            await until(() => row.querySelector('[aria-label="部门"]'), "编辑草稿未展开");
            input(row.querySelector('[aria-label="部门"]'), "尚未提交的部门");
            const reads = state.orgReads;
            emitDataChanged({ topics: ["memberships"], docIds: [state.orgB] });
            emitDataChanged({ topics: ["organizations"], docIds: [state.orgB] });
            target.set(state.orgA);
            await until(() => document.querySelector(".lvct-closeguard"), "目标 prop 变化绕过草稿守卫");
            document.querySelector('.lvct-closeguard button[data-choice="cancel"]').click();
            await tick();
            assert(manager.dataset.orgDocId === state.orgB && row.querySelector('[aria-label="部门"]').value === "尚未提交的部门", "取消切换丢失原组织或草稿");
            assert(state.orgReads === reads && state.writes.length === 0 && !state.pages.some((page) => page.docId === state.orgA), "草稿期间事件刷新或 prop 发起了其他组织请求");
            assert(button("重新读取组织和成员").disabled && fixture.querySelector('input[type="search"]').disabled, "草稿期间允许刷新或筛选销毁编辑行");
            button("取消", row).click();
            await until(() => state.orgReads === reads + 1 && ready(fixture), "取消编辑没有补读合并后的变化");
            await tick();
            assert(state.orgReads === reads + 1, "同一批草稿事件重复刷新");
            target.set(state.orgB);
            await tick();
            input(fixture.querySelector('[aria-label="新建组织名称"]'), "另一个草稿");
            target.set(state.orgA);
            await until(() => document.querySelector(".lvct-closeguard"), "再次修改目标未触发守卫");
            document.querySelector('.lvct-closeguard button[data-choice="discard"]').click();
            await until(() => manager.dataset.orgDocId === state.orgA && ready(fixture), "放弃草稿后未切到指定 docId");
            assert(fixture.querySelector('[aria-label="新建组织名称"]').value === "" && state.writes.length === 0, "放弃草稿误创建或保留旧编辑值");
        } finally {
            document.querySelector('.lvct-closeguard button[data-choice="cancel"]')?.click();
            await unmount(instance);
        }
    });

    await test("组织上下文：新 prop 可越过旧成员慢请求，失联目标保留 ID，迟到响应不能回落首项", async () => {
        const state = contextFixture();
        let releaseOld;
        state.pageHook = (docId, options) => docId === state.orgA
            ? new Promise((resolve) => { releaseOld = resolve; }) : state.page(docId, options);
        const target = writable(state.orgA);
        const currentTarget = fromStore(target);
        const missing = "20261004000000-ctxgone";
        const instance = mount(OrgManagerDialog, { target: fixture, props: {
            facade: state.facade, get initialOrgDocId() { return currentTarget.current; }, onClose() {},
        } });
        try {
            await until(() => releaseOld, "旧成员请求未挂起");
            target.set(state.orgB);
            await until(() => ready(fixture) && fixture.querySelector(".lvct-org-manager").dataset.orgDocId === state.orgB, "新目标被旧成员请求阻塞");
            target.set(missing);
            await until(() => fixture.textContent.includes(missing) && !fixture.querySelector(".lvct-org-manager__org-item--active"), "失联目标被选成其他组织");
            releaseOld(state.page(state.orgA, { offset: 0, limit: 200 }));
            await tick();
            assert(fixture.querySelector(".lvct-org-manager").dataset.orgDocId === missing && !fixture.textContent.includes("另一组织成员"), "旧响应覆盖失联目标");
            assert(!state.pages.some((page) => page.docId === missing), "失联组织仍被当成已核实成员来源");
            target.set(state.orgB);
            await until(() => ready(fixture) && fixture.querySelector(".lvct-org-manager").dataset.orgDocId === state.orgB, "恢复稳定目标失败");
        } finally {
            releaseOld?.(state.page(state.orgA, { offset: 0, limit: 200 }));
            await unmount(instance);
        }
    });

    for (const mode of ["可见页暂停 RAF", "刷新中转入后台"]) {
        await test(`组织上下文：${mode}仍完成刷新和成员保存，保留草稿、滚动与焦点`, async () => {
            const state = contextFixture();
            const scrollHost = document.createElement("div");
            scrollHost.style.height = "240px";
            scrollHost.style.overflow = "auto";
            fixture.append(scrollHost);
            const instance = mount(OrgManagerDialog, { target: scrollHost, props: {
                facade: state.facade, initialOrgDocId: state.orgB, onClose() {}, onEditOrganization() {},
            } });
            const originalRaf = window.requestAnimationFrame;
            const originalCancelRaf = window.cancelAnimationFrame;
            const visibilityDescriptor = Object.getOwnPropertyDescriptor(document, "visibilityState");
            const pendingFrames = new Map();
            const deliveredFrames = [];
            let nextFrame = 0;
            let visibility = "visible";
            try {
                await filterAndExpand({ root: scrollHost, until, button });
                const manager = scrollHost.querySelector(".lvct-org-manager");
                const search = scrollHost.querySelector('input[type="search"]');
                const ids = memberIds(scrollHost);
                search.focus({ preventScroll: true });
                scrollHost.scrollTop = 173;
                const scrollTop = scrollHost.scrollTop;
                assert(scrollTop > 0, "暂停帧回归夹具没有真实滚动窗口");
                window.requestAnimationFrame = (callback) => {
                    const id = ++nextFrame;
                    pendingFrames.set(id, callback);
                    deliveredFrames.push(callback);
                    return id;
                };
                window.cancelAnimationFrame = (id) => pendingFrames.delete(id);
                Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
                const reads = state.orgReads;
                emitDataChanged({ topics: ["organizations"], docIds: [state.orgB] });
                await until(() => nextFrame > 0, "刷新没有进入可见页视口修正");
                if (mode === "刷新中转入后台") {
                    visibility = "hidden";
                    document.dispatchEvent(new Event("visibilitychange"));
                }
                await until(() => state.orgReads === reads + 1 && !button("编辑资料", scrollHost).disabled,
                    "无 RAF 回调时只读刷新仍处于忙态");
                assert(pendingFrames.size === 0, "帧等待结束后未取消悬挂 RAF");
                assert(memberIds(scrollHost) === ids && search.value === "研发"
                    && scrollHost.querySelector('[aria-label="成员状态"]').value === "active"
                    && scrollHost.scrollTop === scrollTop && document.activeElement === search,
                "无帧刷新丢失成员窗口、筛选、滚动或焦点");
                const row = scrollHost.querySelector(".lvct-org-manager__member");
                button("编辑", row).click();
                await until(() => row.querySelector('[aria-label="职位"]'), "成员编辑未打开");
                input(row.querySelector('[aria-label="职位"]'), "后台保存职位");
                emitDataChanged({ topics: ["memberships"], docIds: [state.orgB] });
                await tick();
                assert(state.orgReads === reads + 1 && row.querySelector('[aria-label="职位"]').value === "后台保存职位",
                    "后台事件刷新覆盖未保存草稿");
                button("保存", row).click();
                await until(() => state.writes.length === 1 && manager.getAttribute("aria-busy") === "false"
                    && !button("编辑资料", scrollHost).disabled, "无 RAF 回调时成员保存后 busy 没有解除");
                assert(state.writes[0].patch.title === "后台保存职位" && state.writes[0].expected.title === "成员"
                    && row.textContent.includes("后台保存职位") && memberIds(scrollHost) === ids,
                "成员保存未回读、重复写入或丢失编辑基线和窗口");
                assert(!button("改名", scrollHost).disabled && !button("归档组织", scrollHost).disabled
                    && !button("关闭", scrollHost).disabled && pendingFrames.size === 0,
                "无帧保存完成后组织操作仍不可用或遗留帧回调");
                const afterSaveScroll = Math.min(scrollHost.scrollTop + 31, scrollHost.scrollHeight - scrollHost.clientHeight);
                scrollHost.scrollTop = afterSaveScroll;
                const anotherFocus = scrollHost.querySelector('[aria-label="新建组织名称"]');
                anotherFocus.focus({ preventScroll: true });
                for (const callback of deliveredFrames) callback(performance.now());
                await tick();
                assert(scrollHost.scrollTop === afterSaveScroll && document.activeElement === anotherFocus,
                    "迟到帧回调覆盖用户后续滚动或焦点");
            } finally {
                window.requestAnimationFrame = originalRaf;
                window.cancelAnimationFrame = originalCancelRaf;
                if (visibilityDescriptor) Object.defineProperty(document, "visibilityState", visibilityDescriptor);
                else delete document.visibilityState;
                await unmount(instance);
                scrollHost.remove();
            }
        });
    }

    for (const mode of ["分页 facade", "全量 facade 兼容"]) {
        await test(`组织上下文：${mode}刷新保留当前分页、搜索、状态、滚动和焦点，故障与失联不跳组织`, async () => {
            const state = contextFixture();
            if (mode === "全量 facade 兼容") delete state.facade.listOrganizationMembersPage;
            const scrollHost = document.createElement("div");
            scrollHost.style.height = "240px";
            scrollHost.style.overflow = "auto";
            fixture.append(scrollHost);
            const instance = mount(OrgManagerDialog, { target: scrollHost, props: { facade: state.facade, initialOrgDocId: state.orgB, onClose() {} } });
            try {
                await filterAndExpand({ root: scrollHost, until, button });
                const manager = scrollHost.querySelector(".lvct-org-manager");
                const ids = memberIds(scrollHost);
                const search = scrollHost.querySelector('input[type="search"]');
                search.focus({ preventScroll: true });
                scrollHost.scrollTop = 173;
                const scrollTop = scrollHost.scrollTop;
                assert(scrollTop > 0, "回归夹具未产生真实滚动窗口");
                let reads = state.orgReads;
                const pageStart = state.pages.length;
                state.organizations[1].archived = true;
                emitDataChanged({ topics: ["organizations"], docIds: [state.orgB] });
                await until(() => state.orgReads === reads + 1 && ready(scrollHost), "外部变化未完成只读刷新");
                assert(memberIds(scrollHost) === ids && search.value === "研发" && scrollHost.querySelector('[aria-label="成员状态"]').value === "active", "刷新重置窗口、搜索或状态");
                assert(scrollHost.scrollTop === scrollTop && document.activeElement === search, "刷新丢失滚动或搜索焦点");
                assert(manager.dataset.orgDocId === state.orgB && scrollHost.querySelector(".lvct-org-manager__org-item--active")?.textContent.includes("已归档"), "原组织归档后切到其他组织或丢失归档分组选择");
                if (mode === "分页 facade") assert(state.pages.slice(pageStart).map((page) => page.offset).join(",") === "0", "刷新没有只读取当前页，或重复请求");
                state.failOrganizations = true;
                reads = state.orgReads;
                emitDataChanged({ topics: ["organizations"], docIds: [state.orgB] });
                await until(() => state.orgReads === reads + 1 && ready(scrollHost) && scrollHost.textContent.includes("组织上下文隔离读取失败"), "组织故障未显示未知");
                assert(memberIds(scrollHost) === ids && manager.dataset.orgDocId === state.orgB, "组织读取失败清空窗口或回落首项");
                state.failOrganizations = false;
                button("重新读取组织和成员", scrollHost).click();
                await until(() => ready(scrollHost) && !scrollHost.textContent.includes("组织上下文隔离读取失败"), "组织重试保留过期错误");
                state.failMembers = true;
                reads = state.orgReads;
                emitDataChanged({ topics: ["memberships"], docIds: [state.orgB] });
                await until(() => state.orgReads === reads + 1 && ready(scrollHost) && scrollHost.textContent.includes("成员读取失败，结果尚未核实"), "成员故障被当成空库");
                assert(memberIds(scrollHost) === ids && !scrollHost.textContent.includes("暂无成员"), "成员读取失败销毁旧窗口或显示正常空态");
                state.failMembers = false;
                button("重试", scrollHost).click();
                await until(() => ready(scrollHost) && !scrollHost.textContent.includes("成员读取失败，结果尚未核实"), "成员重试未恢复");
                assert(memberIds(scrollHost) === ids && search.value === "研发", "只读重试退回首屏或丢弃搜索");
                const organizations = state.organizations;
                state.organizations = [organizations[0]];
                const otherRequests = state.pages.filter((page) => page.docId === state.orgA).length + state.fullReads.filter((docId) => docId === state.orgA).length;
                emitDataChanged({ topics: ["organizations"], docIds: [state.orgB] });
                await until(() => ready(scrollHost) && scrollHost.textContent.includes(`原组织 ${state.orgB}`), "原组织失联未显式保留稳定 ID");
                assert(manager.dataset.orgDocId === state.orgB && !scrollHost.querySelector(".lvct-org-manager__org-item--active"), "失联原组织跳到同名首项");
                assert(state.pages.filter((page) => page.docId === state.orgA).length + state.fullReads.filter((docId) => docId === state.orgA).length === otherRequests, "失联后请求了另一组织成员");
                state.organizations = organizations;
                emitDataChanged({ topics: ["organizations"], docIds: [state.orgB] });
                await until(() => ready(scrollHost) && scrollHost.querySelectorAll(".lvct-org-manager__member").length === 100, "原组织恢复未保留当前分页");
                assert(memberIds(scrollHost) === ids && scrollHost.querySelector('input[type="search"]').value === "研发"
                    && scrollHost.querySelector('[aria-label="成员状态"]').value === "active", "原组织恢复丢失筛选或成员身份");
            } finally { await unmount(instance); scrollHost.remove(); }
        });
    }

    await test("组织上下文：成员保存忙态合并外部事件，保留分页和草稿快照，仅一次必要补读", async () => {
        const state = contextFixture();
        let releaseWrite;
        state.updateHook = () => new Promise((resolve) => { releaseWrite = resolve; });
        const instance = mount(OrgManagerDialog, { target: fixture, props: { facade: state.facade, initialOrgDocId: state.orgB, onClose() {} } });
        try {
            await filterAndExpand({ root: fixture, until, button });
            const row = fixture.querySelector(".lvct-org-manager__member");
            button("编辑", row).click();
            await until(() => row.querySelector('[aria-label="职位"]'), "编辑未展开");
            input(row.querySelector('[aria-label="职位"]'), "更新职位");
            const reads = state.orgReads;
            const pageStart = state.pages.length;
            button("保存", row).click();
            await until(() => releaseWrite, "成员写入未挂起");
            for (let eventIndex = 0; eventIndex < 4; eventIndex += 1) emitDataChanged({ topics: ["memberships"], docIds: [state.orgB] });
            await tick();
            assert(state.orgReads === reads && row.querySelector('[aria-label="职位"]').value === "更新职位", "忙态事件提前刷新或覆盖草稿");
            assert(button("重新读取组织和成员").disabled, "忙态手动刷新没有阻断");
            releaseWrite();
            await until(() => state.orgReads === reads + 1 && ready(fixture), "写后必要补读未完成");
            await tick();
            assert(state.writes.length === 1 && state.writes[0].expected.title === "成员", "保存重复写入或未保留原记录快照");
            assert(state.orgReads === reads + 1 && state.pages.slice(pageStart).map((page) => page.offset).join(",") === "0", "写后刷新重复或丢失当前页");
            assert(fixture.querySelectorAll(".lvct-org-manager__member").length === 100 && fixture.textContent.includes("更新职位")
                && fixture.querySelector('input[type="search"]').value === "研发" && fixture.querySelector('[aria-label="成员状态"]').value === "active", "保存后重置组织上下文");
        } finally { releaseWrite?.(); await unmount(instance); }
    });

    await test("组织上下文 Workbench：具体组织到人物与稳定 ID 同伴，再返回原组织和卡片触发焦点", async () => {
        const state = contextFixture();
        kernel.handler = async (route) => {
            if (route === "/api/av/renderAttributeView") return { view: { columns: [], rows: state.people.map((person) => ({
                id: person.itemId, cells: [{ valueType: "block", value: { keyID: settings.fieldMap.name, type: "block", block: { id: person.docId, content: person.name } } }],
            })) } };
            if (route === "/api/query/sql") return [];
            if (route === "/api/sqlite/flushTransaction") return null;
            throw new Error(`组织导航只读夹具拒绝请求：${route}`);
        };
        invalidateRoster();
        const instance = mount(Workbench, { target: fixture, props: {
            facade: state.facade, settings, preferences: DEFAULT_VIEW_PREFERENCES, initialView: "orgs", isMobile: false,
            onPreferencesUpdated() {}, onOpenPersonDoc() {},
        } });
        try {
            await until(() => fixture.querySelectorAll(".lvct-orgs-view__card").length === 2, "Workbench 组织页未显示");
            const cardTrigger = button("管理", fixture.querySelector(`.lvct-orgs-view__card[data-org-doc-id="${state.orgB}"]`));
            cardTrigger.focus({ preventScroll: true });
            cardTrigger.click();
            await until(() => fixture.querySelector(".lvct-org-manager")?.dataset.orgDocId === state.orgB && ready(fixture), "具体组织入口未按卡片 docId 打开");
            const manager = fixture.querySelector(".lvct-org-manager");
            /* 深页返回回归：按页导航到包含稳定成员 350 的第 4 页。 */
            await filterAndExpand({ root: manager, until, button }, 4);
            const ids = memberIds(manager);
            const panel = manager.closest(".lvct-dialog-panel");
            panel.style.maxHeight = "240px";
            panel.style.overflow = "auto";
            const member = state.members[350];
            const memberTrigger = button("查看详情", manager.querySelector(`[data-membership-id="${member.id}"]`));
            memberTrigger.focus({ preventScroll: true });
            panel.scrollTop += memberTrigger.getBoundingClientRect().top - panel.getBoundingClientRect().top - 100;
            const scrollTop = panel.scrollTop;
            assert(scrollTop > 0, "Workbench 回归未产生组织滚动上下文");
            memberTrigger.click();
            await until(() => state.insightDocs.includes(member.personDocId) && fixture.querySelector(".lvct-detail"), "成员稳定 docId 未打开人物详情");
            assert(manager.isConnected && memberIds(manager) === ids, "人物详情销毁原组织窗口");
            await until(() => fixture.querySelector(".lvct-org-common__peer"), "共同背景同伴入口未显示");
            button("查看详情", fixture.querySelector(".lvct-org-common__peer")).click();
            await until(() => state.insightDocs.includes(state.members[0].personDocId), "共同背景没有按同伴稳定 ID 导航");
            assert(!fixture.querySelector(".lvct-detail")?.textContent.includes("过期人物快照"), "共同背景使用过期姓名快照替代稳定 ID");
            const detailPanel = fixture.querySelector(".lvct-detail").closest(".lvct-dialog-panel");
            await until(() => !detailPanel.querySelector('[aria-label="返回原组织"]').disabled, "人物返回入口不可用");
            detailPanel.querySelector('[aria-label="返回原组织"]').click();
            await until(() => !fixture.querySelector(".lvct-detail") && document.activeElement === memberTrigger, "返回原组织未恢复成员触发焦点");
            assert(fixture.querySelector(".lvct-org-manager") === manager && manager.dataset.orgDocId === state.orgB
                && memberIds(manager) === ids && manager.querySelector('input[type="search"]').value === "研发"
                && manager.querySelector('[aria-label="成员状态"]').value === "active" && panel.scrollTop === scrollTop, "人物返回丢失组织、窗口、筛选或滚动");
            button("关闭", manager).click();
            await until(() => !fixture.querySelector(".lvct-org-manager") && document.activeElement === cardTrigger, "关闭原组织未恢复卡片触发焦点");
            assert(fixture.querySelector("h1")?.textContent === "组织" && state.writes.length === 0, "返回出口离开组织页或只读导航发起写入");
        } finally { await unmount(instance); invalidateRoster(); }
    });
}
