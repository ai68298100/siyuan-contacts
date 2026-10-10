import { mount, unmount, tick } from "svelte";
import OrgManagerDialog from "../../../src/components/org/OrgManagerDialog.svelte";
import OrgsView from "../../../src/components/org/OrgsView.svelte";
import GroupFieldFixture from "./GroupFieldFixture.svelte";
import { GROUP_CUSTOM_OPTION } from "../../../src/domain/contact-group";
import { listOrganizationMembersPage } from "../../../src/services/org";
import { listContacts } from "../../../src/services/contacts";
import { invalidateRoster } from "../../../src/services/roster";

export async function runOrganizationPageRegression({ test, assert, kernel, settings, fixture, until, button }) {
    await test("分组自定义选项：选择后显示输入框并回填自定义文字", async () => {
        const instance = mount(GroupFieldFixture, { target: fixture });
        try {
            const select = fixture.querySelector("select[aria-label='分组']");
            assert(select, "分组选择器未渲染");
            select.value = GROUP_CUSTOM_OPTION;
            select.dispatchEvent(new Event("change", { bubbles: true }));
            await tick();
            const input = fixture.querySelector("input[aria-label='自定义分组名称']");
            assert(input, `选择自定义后没有显示文字输入框（选择值=${select.value}，选项=${[...select.options].map((option) => option.value).join("|")}）`);
            await until(() => document.activeElement === input, "选择自定义后没有将焦点移到输入框");
            assert(fixture.querySelector("[data-group-valid]")?.textContent === "false", "自定义分组空值没有进入待填写状态");
            input.value = "校友会";
            input.dispatchEvent(new Event("input", { bubbles: true }));
            await tick();
            assert(fixture.querySelector("[data-group-valid]")?.textContent === "true"
                && fixture.querySelector("[data-group-value]")?.textContent === "校友会", "自定义分组文字没有回填到草稿");
        } finally {
            await unmount(instance);
        }
    });

    await test("组织卡片列表按稳定游标先展示首批，后台续读不重复", async () => {
        const org = (index, archived = false) => ({
            docId: `20261005000000-org${String(index).padStart(4, "0")}`,
            name: `组织${index}`, hpath: `/组织${index}`, notebookId: "20261005000000-book001", archived, memberships: [],
        });
        const calls = [];
        const facade = {
            listOrganizations: async () => { throw new Error("不应走旧全量组织入口"); },
            listOrganizationsPage: async (options = {}) => {
                calls.push(options);
                return options.afterRootId
                    ? { organizations: [org(2, true)], hasMore: false, nextRootId: null }
                    : { organizations: [org(1)], hasMore: true, nextRootId: org(1).docId };
            },
        };
        const instance = mount(OrgsView, { target: fixture, props: { facade, onOpenOrgManager() {} } });
        try {
            await until(() => fixture.querySelectorAll(".lvct-orgs-view__card").length === 2, "组织卡片后台续读未完成");
            assert(calls.length === 2 && calls[1].afterRootId === org(1).docId, "组织分页没有沿用稳定游标");
            assert(fixture.textContent.includes("组织1") && fixture.textContent.includes("组织2"), "组织卡片分页丢失或重复");
            const search = fixture.querySelector('input[type="search"]');
            search.value = "组织2";
            search.dispatchEvent(new Event("input", { bubbles: true }));
            await until(() => fixture.querySelectorAll(".lvct-orgs-view__card").length === 1, "组织搜索未收窄卡片");
            assert(fixture.querySelector('[data-org-doc-id$="org0002"]'), "组织搜索结果缺少目标组织");
            const status = fixture.querySelector('select[aria-label="组织状态"]');
            search.value = "";
            search.dispatchEvent(new Event("input", { bubbles: true }));
            status.value = "active";
            status.dispatchEvent(new Event("change", { bubbles: true }));
            await until(() => fixture.querySelectorAll(".lvct-orgs-view__card").length === 1, "组织状态筛选未收窄卡片");
            assert(fixture.querySelector('[data-org-doc-id$="org0001"]'), "活跃组织筛选错误");
            button("清除筛选").click();
            await until(() => fixture.querySelectorAll(".lvct-orgs-view__card").length === 2, "组织清除筛选未恢复卡片");
        } finally { await unmount(instance); }
    });

    await test("组织卡片 Logo 固定尺寸，不挤压名称和简称", async () => {
        const facade = {
            listOrganizations: async () => [{
                docId: "20261005000000-logo001",
                name: "厦门大学超长组织名称",
                hpath: "/厦门大学超长组织名称",
                notebookId: "20261005000000-book001",
                archived: false,
                memberships: [],
                profile: {
                    name: "厦门大学超长组织名称",
                    shortName: "厦大",
                    logoUrl: "https://example.com/large-logo.png",
                    logoDataUrl: "",
                    qccUrl: "",
                    description: "",
                    departments: [],
                    customFields: [],
                },
            }],
        };
        const instance = mount(OrgsView, { target: fixture, props: { facade, onOpenOrgManager() {} } });
        try {
            await until(() => fixture.querySelector(".lvct-orgs-view__card-logo"), "组织 Logo 未渲染");
            const logo = fixture.querySelector(".lvct-orgs-view__card-logo");
            const cardHead = logo?.closest(".lvct-orgs-view__card-head");
            const style = logo ? getComputedStyle(logo) : null;
            const headStyle = cardHead ? getComputedStyle(cardHead) : null;
            assert(style?.width === "40px" && style.height === "40px"
                && style.objectFit === "contain", "组织 Logo 未限制为固定尺寸或未使用 contain");
            assert((cardHead?.getBoundingClientRect().height ?? 0) <= 48
                && (headStyle?.minWidth ?? "") === "0px", "组织 Logo 仍然挤压组织名称区域");
        } finally {
            await unmount(instance);
        }
    });

    await test("组织成员实际服务和界面：1001 条稳定分页、状态搜索与完整候选身份", async () => {
        const orgDocId = "20261004000000-org0001";
        const memberships = Array.from({ length: 1001 }, (_, index) => ({
            id: `20261004000000-m${String(index).padStart(6, "0")}`,
            personDocId: `20261004000000-p${String(index).padStart(6, "0")}`,
            orgDocId, department: index === 999 ? "唯一部门" : "研发", title: "成员",
            joinedOn: "2026-01-01", leftOn: "", status: index % 2 === 0 ? "active" : "former",
        }));
        const plugin = { loadData: async () => ({ schemaVersion: 1, memberships: structuredClone(memberships) }) };
        kernel.handler = async (route) => {
            if (route !== "/api/av/renderAttributeView") throw new Error(`成员分页夹具拒绝请求：${route}`);
            return { view: { columns: [], rows: memberships.map((member, index) => ({
                id: `20261004000000-i${String(index).padStart(6, "0")}`,
                cells: [{ valueType: "block", value: { keyID: "name", type: "block", block: { id: member.personDocId, content: `成员${index}` } } }],
            })) } };
        };
        invalidateRoster();
        const ids = [];
        for (let offset = 0; offset < 1001; offset += 200) {
            const page = await listOrganizationMembersPage(plugin, settings, orgDocId, { offset, limit: 200 });
            ids.push(...page.items.map((item) => item.id));
            assert(page.total === 1001 && page.personDocIds.length === 1001 && page.activePersonDocIds.length === 501, "分页计数或全部成员身份不一致");
        }
        assert(new Set(ids).size === 1001, "千人分页漏项或重复");
        const active = await listOrganizationMembersPage(plugin, settings, orgDocId, { status: "active", limit: 200 });
        assert(active.total === 501 && active.items.every((item) => item.status === "active"), "状态筛选混入历史记录");
        const matched = await listOrganizationMembersPage(plugin, settings, orgDocId, { query: "唯一部门" });
        assert(matched.total === 1 && matched.items[0].personName === "成员999", "部门搜索无法定位成员");

        const facade = {
            listContacts: () => listContacts(settings),
            listOrganizations: async () => [{ docId: orgDocId, name: "千人组织", archived: false, memberships }],
            listOrganizationMembers: async () => (await listOrganizationMembersPage(plugin, settings, orgDocId, { limit: 500 })).items,
            listOrganizationMembersPage: (docId, options) => listOrganizationMembersPage(plugin, settings, docId, options),
        };
        const instance = mount(OrgManagerDialog, { target: fixture, props: { facade, onClose() {} } });
        try {
            await until(() => fixture.querySelectorAll(".lvct-org-manager__member").length === 200, "首屏未限制为 200 条记录");
            button("加载更多").click();
            await until(() => fixture.querySelectorAll(".lvct-org-manager__member").length === 400, "加载更多未追加第二页");
            window.__stage = "organization-page-search";
            const search = fixture.querySelector('input[type="search"]');
            search.value = "唯一部门";
            search.dispatchEvent(new Event("input", { bubbles: true }));
            await until(() => fixture.querySelectorAll(".lvct-org-manager__member").length === 1, "搜索未重置分页");
            window.__stage = "organization-page-assert";
            assert(fixture.textContent.includes("成员999") && fixture.textContent.includes("1 条记录"), "筛选后的对象或计数错误");
            const addPicker = fixture.querySelector('[aria-label="选择要添加的联系人"]');
            addPicker.click();
            await until(() => fixture.querySelector(".lvct-picker__panel"), "组织成员候选器未打开");
            const addOptions = [...fixture.querySelectorAll(".lvct-picker__option")];
            assert(addOptions.length === 500 && addOptions.some((option) => option.textContent.includes(memberships[999].personDocId))
                && !addOptions.some((option) => option.textContent.includes(memberships[1000].personDocId)), "分页后当前成员成为候选，或历史成员不能重新加入");
            fixture.querySelector(".lvct-picker__search")?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
            await tick();
        } finally {
            window.__stage = "organization-page-unmount";
            await unmount(instance);
            window.__stage = "organization-page-unmounted";
        }
    });

    await test("组织成员界面：快速切组织和搜索只接受最新请求，失败保持未知并可重试", async () => {
        const orgA = "20261004000000-orga001";
        const orgB = "20261004000000-orgb001";
        let releaseOld;
        let fail = false;
        let requests = 0;
        const member = {
            id: "20261004000000-m000001", orgDocId: orgB, personDocId: "20261004000000-pers001",
            personName: "最新成员", department: "", title: "", joinedOn: "", leftOn: "", status: "active",
        };
        const page = (items) => ({ items, offset: 0, limit: 200, total: items.length, hasMore: false,
            personDocIds: items.map((item) => item.personDocId), activePersonDocIds: items.map((item) => item.personDocId) });
        const instance = mount(OrgManagerDialog, { target: fixture, props: { onClose() {}, facade: {
            listContacts: async () => [],
            listOrganizations: async () => [{ docId: orgA, name: "慢组织", memberships: [], archived: false }, { docId: orgB, name: "新组织", memberships: [], archived: false }],
            listOrganizationMembersPage: async (docId, options) => {
                requests += 1;
                if (docId === orgA) return new Promise((resolve) => { releaseOld = resolve; });
                if (fail) throw new Error("隔离权限失败");
                return page(options.query === "无人匹配" ? [] : [member]);
            },
        } } });
        try {
            await until(() => releaseOld, "旧组织请求没有挂起");
            button("新组织（0）").click();
            await until(() => fixture.textContent.includes("最新成员"), "新组织没有加载最新成员");
            releaseOld(page([{ ...member, personName: "过期成员" }]));
            await tick();
            assert(!fixture.textContent.includes("过期成员"), "旧组织响应覆盖当前组织");
            fail = true;
            const search = fixture.querySelector('input[type="search"]');
            search.value = "失败";
            search.dispatchEvent(new Event("input", { bubbles: true }));
            await until(() => fixture.textContent.includes("成员读取失败，结果尚未核实"), "读取失败被当空成员");
            assert(!fixture.textContent.includes("暂无成员"), "故障同时显示正常空态");
            fail = false;
            button("重试").click();
            await until(() => !fixture.textContent.includes("成员读取失败，结果尚未核实"), "只读重试未恢复成员");
            assert(requests >= 4 && search.value === "失败", "重试丢弃搜索上下文");
        } finally { await unmount(instance); }
    });
}
