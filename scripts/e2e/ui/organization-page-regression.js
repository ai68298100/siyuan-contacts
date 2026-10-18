import { mount, unmount, tick, createRawSnippet } from "svelte";
import OrgManagerDialog from "../../../src/components/org/OrgManagerDialog.svelte";
import OrgsView from "../../../src/components/org/OrgsView.svelte";
import OrganizationProfileEditor from "../../../src/components/org/OrganizationProfileEditor.svelte";
import LvctDialog from "../../../src/components/LvctDialog.svelte";
import GroupFieldFixture from "./GroupFieldFixture.svelte";
import { GROUP_CUSTOM_OPTION } from "../../../src/domain/contact-group";
import { listOrganizationMembersPage } from "../../../src/services/org";
import { listContacts } from "../../../src/services/contacts";
import { invalidateRoster } from "../../../src/services/roster";
import { DEFAULT_VIEW_PREFERENCES } from "../../../src/domain/preferences";

export async function runOrganizationPageRegression({ test, assert, kernel, settings, fixture, until, button }) {
    await test("分组选项：已有自定义分组进入选择器并去重，内部选项不泄漏", async () => {
        const instance = mount(GroupFieldFixture, { target: fixture });
        try {
            const select = fixture.querySelector("select[aria-label='分组']");
            assert(select, "分组选择器未渲染");
            const values = [...select.options].map((option) => option.value);
            assert(values.filter((value) => value === "客户").length === 1, "已有自定义分组没有去重");
            assert(values.includes("校友会") && !values.includes("__lvct_group_option__:stale"), "已有分组候选或内部选项处理错误");
            select.value = "客户";
            select.dispatchEvent(new Event("change", { bubbles: true }));
            await tick();
            assert(fixture.querySelector("[data-group-value]")?.textContent === "客户", "选择已有自定义分组没有回填草稿");
        } finally {
            await unmount(instance);
        }
    });

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

    await test("组织资料编辑器：空名称触发定位错误，Logo 读取完成前锁定提交", async () => {
        const saved = [];
        const instance = mount(OrganizationProfileEditor, { target: fixture, props: {
            onSave: async (draft) => { saved.push(draft); },
        } });
        const readerDescriptor = Object.getOwnPropertyDescriptor(window, "FileReader");
        let pendingReader;
        try {
            const name = fixture.querySelector('[aria-label="组织名称（必填）"]');
            const submit = button("创建组织", fixture);
            assert(name && submit && !submit.disabled, "空名称时应允许提交以展示必填校验");
            submit.click();
            await until(() => name.getAttribute("aria-invalid") === "true" && document.activeElement === name,
                "空组织名称未展示错误并聚焦到字段");

            class DeferredFileReader {
                result = "data:image/png;base64,aGVsbG8=";
                onload = null;
                onerror = null;
                readAsDataURL() { pendingReader = this; }
            }
            Object.defineProperty(window, "FileReader", { configurable: true, writable: true, value: DeferredFileReader });
            name.value = "图片读取测试组织";
            name.dispatchEvent(new Event("input", { bubbles: true }));
            const data = new DataTransfer();
            data.items.add(new File(["png"], "logo.png", { type: "image/png" }));
            const fileInput = fixture.querySelector('input[aria-label="上传组织 Logo"]');
            fileInput.files = data.files;
            fileInput.dispatchEvent(new Event("change", { bubbles: true }));
            await until(() => fixture.textContent.includes("正在读取 Logo…"), "Logo 读取中状态未显示");
            assert(submit.disabled && saved.length === 0, "Logo 尚未读取完成时提交没有锁定");
            assert(fixture.querySelector('[role="status"][aria-live="polite"]')?.textContent.includes("正在读取 Logo"), "Logo 读取状态没有被辅助技术播报");

            pendingReader.onerror?.();
            await until(() => fixture.querySelector('[role="alert"]')?.textContent.includes("图片读取失败，请重试"), "Logo 读取失败没有显示可理解的错误");
            assert(!submit.disabled && saved.length === 0, "Logo 读取失败后提交仍被锁定或已经误提交");
            const failedReader = pendingReader;
            const retryData = new DataTransfer();
            retryData.items.add(new File(["png"], "logo.png", { type: "image/png" }));
            fileInput.files = retryData.files;
            fileInput.dispatchEvent(new Event("change", { bubbles: true }));
            await until(() => pendingReader !== failedReader, "读取失败后无法重新选择同一图片");
            await until(() => fixture.textContent.includes("正在读取 Logo…"), "重新选择图片后没有恢复读取状态");

            pendingReader.result = "data:image/png;base64,aGVsbG8=";
            pendingReader.onload?.();
            await until(() => !submit.disabled, "Logo 读取完成后提交仍被锁定");
            submit.click();
            await until(() => saved.length === 1, "资料保存未完成");
            assert(saved[0].logoDataUrl === "data:image/png;base64,aGVsbG8=", "Logo 读取完成后提交的数据未包含图片");
        } finally {
            if (readerDescriptor) Object.defineProperty(window, "FileReader", readerDescriptor);
            else delete window.FileReader;
            await unmount(instance);
        }
    });

    await test("组织资料编辑器：已有草稿套用模板前预览并选择合并方式", async () => {
        const saved = [];
        const instance = mount(OrganizationProfileEditor, { target: fixture, props: {
            initial: { name: "已有组织", description: "保留我的介绍", departments: [], customFields: [] },
            onSave: async (draft) => { saved.push(draft); },
        } });
        try {
            const preset = [...fixture.querySelectorAll(".lvct-org-profile-editor__preset")].find((item) => item.textContent.includes("家庭"));
            assert(preset, "家庭模板入口未渲染");
            preset.click();
            await until(() => fixture.querySelector('[role="alertdialog"][aria-label="预览组织模板"]'), "已有草稿点击模板没有打开预览");
            const preview = fixture.querySelector('[role="alertdialog"][aria-label="预览组织模板"]');
            assert(preview.textContent.includes("核心家庭") && preview.textContent.includes("亲属")
                && preview.textContent.includes("仅填空白") && preview.textContent.includes("覆盖模板字段"), "模板预览未列出实际部门或缺少合并选项");
            button("取消", preview).click();
            await tick();
            assert(!fixture.querySelector('[role="alertdialog"][aria-label="预览组织模板"]'), "取消模板预览没有关闭");

            preset.click();
            await until(() => fixture.querySelector('[role="alertdialog"][aria-label="预览组织模板"]'), "再次点击模板没有打开预览");
            button("仅填空白", fixture.querySelector('[role="alertdialog"][aria-label="预览组织模板"]')).click();
            await tick();
            assert(fixture.querySelector('[aria-label="组织名称（必填）"]').value === "已有组织", "仅填空白覆盖了已有组织名称");
            assert(fixture.querySelectorAll('input[aria-label^="部门 "][aria-label$="名称"]').length === 2, "仅填空白没有补充空部门列表");

            const company = [...fixture.querySelectorAll(".lvct-org-profile-editor__preset")].find((item) => item.textContent.includes("工作单位"));
            company.click();
            await until(() => fixture.querySelector('[role="alertdialog"][aria-label="预览组织模板"]'), "已有部门时切换模板没有打开预览");
            button("覆盖模板字段", fixture.querySelector('[role="alertdialog"][aria-label="预览组织模板"]')).click();
            await tick();
            assert(fixture.querySelector('[aria-label="组织名称（必填）"]').value === "工作单位", "覆盖模板字段没有替换组织名称");
        } finally { await unmount(instance); }
    });

    await test("组织资料编辑器：删除有下级的部门先确认，保存前可撤销", async () => {
        const instance = mount(OrganizationProfileEditor, { target: fixture, props: {
            initial: { name: "层级组织", departments: [
                { id: "dept-root", name: "总部", parentId: null, description: "" },
                { id: "dept-child", name: "研发", parentId: "dept-root", description: "" },
            ], customFields: [] },
            onSave() {},
        } });
        try {
            const remove = fixture.querySelector('button[aria-label="删除部门 1"]');
            remove.click();
            await until(() => fixture.querySelector('[role="alertdialog"][aria-label="确认删除部门"]'), "删除有下级部门没有打开影响确认");
            assert(fixture.querySelectorAll('input[aria-label^="部门 "][aria-label$="名称"]').length === 2, "打开确认前部门已被立即删除");
            const confirm = fixture.querySelector('[role="alertdialog"][aria-label="确认删除部门"]');
            assert(confirm.textContent.includes("1 个下级部门") && confirm.textContent.includes("保留"), "部门删除影响说明不完整");
            button("确认删除部门", confirm).click();
            await tick();
            assert(fixture.querySelectorAll('input[aria-label^="部门 "][aria-label$="名称"]').length === 1, "确认删除后目标部门仍在");
            assert(fixture.querySelector('input[aria-label="部门 1 名称"]').value === "研发", "确认删除后下级部门没有保留");
            assert(fixture.querySelector('select[aria-label="部门 1 上级部门"]').value === "", "确认删除后下级部门仍指向已删除上级");
            button("撤销“总部”", fixture).click();
            await tick();
            assert(fixture.querySelectorAll('input[aria-label^="部门 "][aria-label$="名称"]').length === 2, "部门撤销没有恢复原行");
            assert(fixture.querySelector('select[aria-label="部门 2 上级部门"]').value === "dept-root", "部门撤销没有恢复下级归属");
        } finally { await unmount(instance); }
    });

    await test("组织资料编辑器：自定义字段删除后显示撤销并恢复原顺序", async () => {
        const instance = mount(OrganizationProfileEditor, { target: fixture, props: {
            initial: { name: "字段组织", departments: [], customFields: [
                { id: "field-a", label: "官网", value: "https://example.com" },
                { id: "field-b", label: "行业", value: "软件" },
            ] },
            onSave() {},
        } });
        try {
            fixture.querySelector('button[aria-label="删除自定义字段 1"]').click();
            await tick();
            assert(fixture.querySelectorAll('input[aria-label^="自定义字段 "][aria-label$="名称"]').length === 1, "删除字段后的字段行数不正确");
            assert(fixture.querySelector('input[aria-label="自定义字段 1 名称"]').value === "行业", "删除字段后后续字段没有前移");
            const undo = [...fixture.querySelectorAll("button")].find((item) => item.textContent.includes("撤销“官网”"));
            assert(undo, "删除字段后没有撤销入口");
            undo.click();
            await tick();
            assert(fixture.querySelector('input[aria-label="自定义字段 1 名称"]').value === "官网"
                && fixture.querySelector('input[aria-label="自定义字段 2 名称"]').value === "行业", "撤销字段没有恢复原顺序和内容");
        } finally { await unmount(instance); }
    });

    await test("Issue #31：组织管理/资料弹窗在桌面放大，移动端保持全屏", async () => {
        const instance = mount(LvctDialog, { target: fixture, props: {
            title: "编辑组织资料",
            wide: true,
            onClose() {},
            children: createRawSnippet(() => ({ render: () => '<div class="lvct-org-profile-editor"></div>' })),
        } });
        try {
            /* 对话框入场动画会先以 96% 缩放，待动画完成后再核对真实工作区尺寸。 */
            await new Promise((resolve) => setTimeout(resolve, 240));
            const panel = fixture.querySelector(".lvct-dialog-panel");
            assert(panel, "组织资料弹窗容器未渲染");
            const rect = panel.getBoundingClientRect();
            if (window.innerWidth > 640) {
                assert(rect.width >= Math.min(920, window.innerWidth * .96) - 2,
                    `组织资料弹窗桌面宽度不足：${rect.width}（视口 ${window.innerWidth}）`);
                assert(parseFloat(getComputedStyle(panel).maxHeight) >= Math.min(window.innerHeight * .92, 960) - 2,
                    `组织资料弹窗桌面高度不足：${getComputedStyle(panel).maxHeight}`);
            } else {
                assert(Math.abs(rect.width - window.innerWidth) <= 2 && Math.abs(rect.height - window.innerHeight) <= 2,
                    `组织资料弹窗移动端未保持全屏：${rect.width}x${rect.height}`);
            }
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
            const name = cardHead?.querySelector(".lvct-orgs-view__card-name");
            const badges = [...(cardHead?.querySelectorAll(".lvct-chip") ?? [])];
            const style = logo ? getComputedStyle(logo) : null;
            const headStyle = cardHead ? getComputedStyle(cardHead) : null;
            assert(style?.width === "40px" && style.height === "40px"
                && style.objectFit === "contain", "组织 Logo 未限制为固定尺寸或未使用 contain");
            assert(name && badges.length === 1 && headStyle?.minWidth === "0px", "组织名称或简称区域未渲染");
            const headRect = cardHead.getBoundingClientRect();
            const logoRect = logo.getBoundingClientRect();
            const nameRect = name.getBoundingClientRect();
            assert(nameRect.width >= 80 && logoRect.right <= nameRect.left + 1, "组织 Logo 挤压或覆盖了名称");
            assert(name.textContent === "厦门大学超长组织名称", "组织名称在渲染时被截断");
            for (const node of [logo, name, ...badges]) {
                const rect = node.getBoundingClientRect();
                assert(rect.left >= headRect.left - 1 && rect.right <= headRect.right + 1
                    && rect.top >= headRect.top - 1 && rect.bottom <= headRect.bottom + 1, "组织标题或徽标越出卡片头部");
            }
            for (const badge of badges) {
                const rect = badge.getBoundingClientRect();
                const overlaps = rect.left < nameRect.right - 1 && rect.right > nameRect.left + 1
                    && rect.top < nameRect.bottom - 1 && rect.bottom > nameRect.top + 1;
                assert(!overlaps, "组织简称徽标与完整名称重叠");
            }
            logo.dispatchEvent(new Event("error"));
            await tick();
            assert(!fixture.querySelector(".lvct-orgs-view__card-logo")
                && fixture.querySelector(".lvct-orgs-view__card-icon"), "组织 Logo 加载失败后没有回退到默认组织图标");
        } finally {
            await unmount(instance);
        }
    });

    await test("组织视图旧版全量读取：卸载后迟到结果不回填", async () => {
        const org = (name) => ({
            docId: `20261005000000-${name}`,
            name,
            hpath: `/${name}`,
            notebookId: "20261005000000-book001",
            archived: false,
            memberships: [],
        });
        let releaseOld;
        let calls = 0;
        const facade = {
            listOrganizations: () => {
                calls += 1;
                return calls === 1
                    ? new Promise((resolve) => { releaseOld = resolve; })
                    : Promise.resolve([org("最新组织")]);
            },
        };
        const stale = mount(OrgsView, { target: fixture, props: { facade, onOpenOrgManager() {} } });
        try {
            await until(() => calls === 1, "旧版组织读取未发起");
        } finally {
            await unmount(stale);
        }
        const fresh = mount(OrgsView, { target: fixture, props: { facade, onOpenOrgManager() {} } });
        try {
            await until(() => fixture.querySelector('[data-org-doc-id$="最新组织"]'), "新组织视图未完成读取");
            releaseOld([org("旧组织")]);
            await tick();
            assert(fixture.textContent.includes("最新组织") && !fixture.textContent.includes("旧组织"), "卸载后的旧请求回填了组织列表");
        } finally {
            await unmount(fresh);
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
            await until(() => fixture.querySelectorAll(".lvct-org-manager__member").length === 20
                && fixture.textContent.includes("1–20 / 1001 条"), "首屏未按默认每页 20 条记录");
            const pageSize = fixture.querySelector('[aria-label="每页成员条数"]');
            assert(pageSize?.value === "20", "成员分页默认值不是每页 20 条");
            pageSize.value = "50";
            pageSize.dispatchEvent(new Event("change", { bubbles: true }));
            await until(() => fixture.querySelectorAll(".lvct-org-manager__member").length === 50
                && fixture.textContent.includes("1–50 / 1001 条"), "切换每页 50 条未生效");
            const nextPage = button("下一页", fixture);
            assert(!nextPage.disabled, "首分页未提供下一页");
            const firstPageIds = [...fixture.querySelectorAll(".lvct-org-manager__member")].map((row) => row.dataset.membershipId);
            nextPage.click();
            await until(() => fixture.querySelectorAll(".lvct-org-manager__member").length === 50
                && fixture.textContent.includes("51–100 / 1001 条"), "下一页未切到稳定第二页");
            const secondPageIds = [...fixture.querySelectorAll(".lvct-org-manager__member")].map((row) => row.dataset.membershipId);
            assert(secondPageIds.length === 50 && secondPageIds[0] && secondPageIds[0] !== firstPageIds[0]
                && secondPageIds.at(-1) !== firstPageIds.at(-1), "第二页首尾成员 ID 不稳定");
            const previousPage = button("上一页", fixture);
            previousPage.click();
            await until(() => fixture.textContent.includes("1–50 / 1001 条"), "上一页未回到首分页");
            assert([...fixture.querySelectorAll(".lvct-org-manager__member")].map((row) => row.dataset.membershipId).join(",") === firstPageIds.join(","), "上一页未恢复原首尾成员身份");
            pageSize.value = "100";
            pageSize.dispatchEvent(new Event("change", { bubbles: true }));
            await until(() => fixture.querySelectorAll(".lvct-org-manager__member").length === 100
                && fixture.textContent.includes("1–100 / 1001 条"), "切换每页 100 条未生效");
            button("下一页", fixture).click();
            await until(() => fixture.textContent.includes("101–200 / 1001 条"), "每页 100 条下一页未生效");
            window.__stage = "organization-page-search";
            const search = fixture.querySelector('input[type="search"]');
            search.value = "唯一部门";
            search.dispatchEvent(new Event("input", { bubbles: true }));
            await until(() => fixture.querySelectorAll(".lvct-org-manager__member").length === 1
                && fixture.textContent.includes("1–1 / 1 条"), "搜索未重置分页");
            window.__stage = "organization-page-assert";
            assert(fixture.textContent.includes("成员999") && fixture.textContent.includes("1–1 / 1 条"), "筛选后的对象或计数错误");
            const addToggle = button("添加成员", fixture);
            assert(addToggle && !addToggle.disabled, "已有成员未提供按需添加入口");
            addToggle.click();
            await until(() => fixture.querySelector('[aria-label="选择要添加的联系人"]'), "按需添加区未展开");
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

    await test("组织成员界面：添加按需展开、更多菜单 Esc 还原焦点、长文字不横溢", async () => {
        const member = {
            id: "20261017000000-longmem1", orgDocId: "20261017000000-longorg1",
            personDocId: "20261017000000-longper1", personName: "超长成员姓名".repeat(8),
            department: "超长部门名称".repeat(12), title: "超长职位名称".repeat(12),
            joinedOn: "2026-01-01", leftOn: "", status: "active",
            note: "超长成员备注".repeat(20), affiliationKind: "work",
        };
        const facade = {
            listContacts: async () => [],
            listOrganizations: async () => [{ docId: member.orgDocId, name: "长文字组织", hpath: "/长文字组织", notebookId: settings.notebookId, archived: false, memberships: [member] }],
            listOrganizationMembersPage: async (_docId, options) => ({
                items: [member], offset: options.offset ?? 0, limit: options.limit, total: 1, hasMore: false,
                personDocIds: [member.personDocId], activePersonDocIds: [member.personDocId],
            }),
        };
        const host = document.createElement("div");
        host.style.width = "390px";
        host.style.maxWidth = "100%";
        fixture.append(host);
        const instance = mount(OrgManagerDialog, { target: host, props: { facade, onClose() {} } });
        try {
            await until(() => host.querySelector(`[data-membership-id="${member.id}"]`), "长文字成员行未加载");
            const row = host.querySelector(`[data-membership-id="${member.id}"]`);
            assert(!host.querySelector(".lvct-org-manager__add"), "已有成员时添加区应默认收起");
            const add = button("添加成员", host);
            assert(add && !add.disabled, "已有成员缺少按需添加入口");
            add.click();
            await until(() => host.querySelector('.lvct-org-manager__add .lvct-picker__trigger[aria-label="选择要添加的联系人"]'), "按需添加区未展开");
            add.click();
            await until(() => !host.querySelector(".lvct-org-manager__add"), "再次点击添加成员未收起草稿区");
            const more = row.querySelector(".lvct-org-manager__member-more");
            assert(more?.getAttribute("aria-label") === `更多成员操作：${member.personName}`, "更多成员操作 aria-label 未包含稳定姓名");
            more.click();
            await until(() => host.querySelector(`#lvct-member-actions-${member.id}`), "成员更多菜单未展开");
            const menuButton = host.querySelector(`#lvct-member-actions-${member.id} button`);
            menuButton.focus({ preventScroll: true });
            menuButton.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
            await until(() => !host.querySelector(`#lvct-member-actions-${member.id}`) && document.activeElement === more, "更多菜单 Esc 未关闭或未还原焦点");
            const overflowNodes = [row, ...row.querySelectorAll("span,button")]
                .filter((node) => !node.classList.contains("lvct-org-manager__member-note") && node.scrollWidth > node.clientWidth + 2);
            assert(overflowNodes.length === 0, `390px 长成员姓名/部门/职位/备注横向溢出：${overflowNodes.map((node) => `${node.className || node.tagName}:${node.scrollWidth}/${node.clientWidth}`).join(",")}`);
            const note = row.querySelector(".lvct-org-manager__member-note");
            const noteStyle = note && getComputedStyle(note);
            assert(noteStyle?.overflow === "hidden" && noteStyle.textOverflow === "ellipsis" && noteStyle.whiteSpace === "nowrap", "长成员备注未采用可读的省略策略");
        } finally {
            await unmount(instance);
            host.remove();
        }
    });

    await test("组织成员移动：同名目标显示稳定文档 ID，确认后按选定身份提交", async () => {
        const currentId = "20261017000000-orgcur01";
        const targetA = "20261017000000-orgsame1";
        const targetB = "20261017000000-orgsame2";
        const member = {
            id: "20261017000000-move001", orgDocId: currentId, personDocId: "20261017000000-person1",
            personName: "待移动成员", department: "研发", title: "工程师", joinedOn: "2024-01-01", leftOn: "", status: "active",
        };
        const organizations = [
            { docId: currentId, name: "当前组织", hpath: "/当前组织", notebookId: settings.notebookId, archived: false, memberships: [member] },
            { docId: targetA, name: "同名组织", hpath: "/工作/同名组织", notebookId: settings.notebookId, archived: false, memberships: [] },
            { docId: targetB, name: "同名组织", hpath: "/学习/同名组织", notebookId: settings.notebookId, archived: false, memberships: [] },
        ];
        const moveCalls = [];
        const facade = {
            settings, viewPreferences: DEFAULT_VIEW_PREFERENCES,
            listContacts: async () => [{ docId: member.personDocId, itemId: "row-move", name: member.personName, isSelf: false }],
            listOrganizations: async () => organizations.map((organization) => ({ ...organization, memberships: organization.memberships.filter((item) => item.id !== member.id || item.orgDocId === organization.docId) })),
            listOrganizationMembers: async (orgDocId) => organizations.find((organization) => organization.docId === orgDocId)?.memberships.map((item) => ({ ...item })) ?? [],
            moveOrganizationMember: async (id, targetOrgDocId) => {
                moveCalls.push({ id, targetOrgDocId });
                const index = organizations[0].memberships.findIndex((item) => item.id === id);
                if (index >= 0) {
                    const moved = { ...organizations[0].memberships[index], orgDocId: targetOrgDocId };
                    organizations[0].memberships.splice(index, 1);
                    organizations.find((organization) => organization.docId === targetOrgDocId).memberships.push(moved);
                }
                return { fact: "verified", membership: { ...member, orgDocId: targetOrgDocId }, projections: [] };
            },
        };
        const instance = mount(OrgManagerDialog, { target: fixture, props: { facade, onClose() {} } });
        try {
            await until(() => fixture.querySelector('.lvct-org-manager__member[data-membership-id="20261017000000-move001"]'), "待移动成员未加载");
            const row = fixture.querySelector('.lvct-org-manager__member[data-membership-id="20261017000000-move001"]');
            const more = row.querySelector('.lvct-org-manager__member-more');
            assert(more?.getAttribute("aria-label") === "更多成员操作：待移动成员", "移动成员缺少按行更多操作入口");
            more.click();
            await until(() => row.querySelector(`#lvct-member-actions-${member.id}`), "更多成员操作菜单未展开");
            button("移动", row).click();
            await until(() => fixture.querySelector('select[aria-label="移动到组织"]'), "移动目标选择器未打开");
            const select = fixture.querySelector('select[aria-label="移动到组织"]');
            const options = [...select.querySelectorAll("option")];
            const first = options.find((option) => option.value === targetA);
            const second = options.find((option) => option.value === targetB);
            assert(first?.textContent.includes(targetA) && second?.textContent.includes(targetB), "同名组织候选未显示稳定文档 ID");
            assert(first.textContent !== second.textContent, "同名组织候选仍无法区分");
            select.value = targetB;
            select.dispatchEvent(new Event("change", { bubbles: true }));
            await tick();
            button("确认移动", row).click();
            await until(() => moveCalls.length === 1, "移动未提交");
            assert(moveCalls[0].id === member.id && moveCalls[0].targetOrgDocId === targetB, "移动提交了错误的同名组织身份");
        } finally { await unmount(instance); }
    });
}
