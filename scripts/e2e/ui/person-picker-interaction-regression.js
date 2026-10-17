import { mount, unmount, tick } from "svelte";
import PersonPicker from "../../../src/components/people/PersonPicker.svelte";
import OrgManagerDialog from "../../../src/components/org/OrgManagerDialog.svelte";
import { svelteDialog } from "../../../src/libs/dialog";

export async function runPersonPickerInteractionRegression({ test, assert, fixture, until, person }) {
    await test("人员选择一致性：原生窗口 Esc 只关闭选择浮层，再次 Esc 才关闭外层", async () => {
        const emptyPage = { items: [], offset: 0, limit: 200, total: 0, hasMore: false, personDocIds: [], activePersonDocIds: [] };
        const dialog = svelteDialog({ title: "组织管理", component: OrgManagerDialog, props: { facade: {
            listContacts: async () => [person],
            listOrganizations: async () => [{ docId: "20261017000000-esco001", name: "Esc作用域组织", archived: false, memberships: [] }],
            listOrganizationMembersPage: async () => emptyPage,
        } } });
        const root = dialog.dialog.element;
        const trigger = () => root.querySelector('.lvct-picker__trigger[aria-label="选择要添加的联系人"]');
        try {
            await until(() => trigger() && !trigger().disabled, "原生窗口人员选择未就绪");
            for (const source of ["search", "option", "trigger"]) {
                trigger().click();
                await until(() => root.querySelector(".lvct-picker__search"), "人员选择浮层未打开");
                const target = source === "search" ? root.querySelector(".lvct-picker__search")
                    : source === "option" ? root.querySelector(".lvct-picker__option") : trigger();
                assert(target, "人员选择候选未显示");
                target.focus({ preventScroll: true });
                target.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
                await until(() => !root.querySelector(".lvct-picker__panel"), "Esc未关闭人员选择浮层");
                assert(root.isConnected && !document.querySelector(".lvct-closeguard"), "人员浮层Esc误关闭原生外层或触发关闭守卫");
                await until(() => document.activeElement === trigger(), "人员浮层Esc未归还触发器焦点");
            }
            trigger().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
            await until(() => !root.isConnected, "浮层收起后再次Esc未关闭外层");
        } finally { if (root.isConnected) dialog.close(); }
    });

    await test("人员选择一致性：候选缺失仍展示原ID并允许明确清除", async () => {
        const value = "20261017000000-miss001";
        const selected = [];
        const instance = mount(PersonPicker, { target: fixture, props: { items: [], value, onSelect: (id) => selected.push(id) } });
        try {
            await tick();
            const control = fixture.querySelector(".lvct-picker__trigger");
            assert(control.textContent.includes("待核实") && control.textContent.includes(value), "已有但暂缺的人员身份被伪装成未选择");
            const clear = fixture.querySelector(".lvct-picker__clear");
            assert(clear && !clear.disabled, "候选缺失后无法清除原身份");
            clear.click();
            await tick();
            assert(selected.length === 1 && selected[0] === "", "清除缺失身份未显式返回空选择或重复回调");
        } finally { await unmount(instance); }
    });

    await test("人员选择一致性：外点关闭浮层后焦点回到触发器", async () => {
        const items = [{ id: "person-outside-001", label: "外点焦点测试人物" }];
        const instance = mount(PersonPicker, { target: fixture, props: { items, onSelect: () => {} } });
        const outside = document.createElement("button");
        outside.type = "button";
        outside.textContent = "浮层外按钮";
        document.body.append(outside);
        try {
            await tick();
            const findTrigger = () => fixture.querySelector(".lvct-picker__trigger");
            // Let any preceding popover cleanup and the fixture layout settle
            // before opening. This prevents a same-task scroll/resize from
            // being interpreted as an outside interaction.
            await until(() => {
                const current = findTrigger();
                return Boolean(current?.isConnected && !current.disabled && current.getClientRects().length);
            }, "人员选择触发器未就绪");
            const trigger = findTrigger();
            assert(trigger, "人员选择触发器未挂载");
            const results = document.querySelector("#results");
            if (results) results.hidden = true;
            trigger.scrollIntoView({ block: "center", behavior: "instant" });
            await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            trigger.focus({ preventScroll: true });
            await until(() => document.activeElement === trigger, "人员选择触发器焦点未稳定");
            trigger.click();
            // A preceding dialog may finish its popover cleanup in the same
            // task. Give that listener one turn to detach, then retry the
            // user activation only if the first click did not open the panel.
            await new Promise((resolve) => setTimeout(resolve, 0));
            if (!fixture.querySelector(".lvct-picker__panel")) trigger.click();
            await until(() => fixture.querySelector(".lvct-picker__panel"), "人员选择浮层未打开");
            const panel = fixture.querySelector(".lvct-picker__panel");
            await until(() => panel?.isConnected && panel.getClientRects().length > 0, "人员选择浮层布局未稳定");
            await new Promise((resolve) => requestAnimationFrame(resolve));
            outside.focus({ preventScroll: true });
            outside.click();
            await until(() => !fixture.querySelector(".lvct-picker__panel"), "外点未关闭人员选择浮层");
            await until(() => document.activeElement === trigger, "外点关闭后焦点未回到人员选择触发器");
        } finally {
            outside.remove();
            await unmount(instance);
        }
    });
}
