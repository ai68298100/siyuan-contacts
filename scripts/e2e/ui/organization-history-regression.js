import { mount, unmount, tick } from "svelte";
import PersonDetail from "../../../src/components/people/PersonDetail.svelte";

const copy = (value) => structuredClone(value);

export async function runOrganizationHistoryRegression({ test, assert, settings, person, fixture, until, button, input }) {
    await test("人物详情：已有当前组织可切换为历史并补录同组织期间", async () => {
        const currentOrg = { docId: "20261017000000-hist001", name: "当前组织" };
        const otherOrg = { docId: "20261017000000-hist002", name: "其他组织" };
        const memberships = [{ id: "20261017000000-hmem01", orgDocId: currentOrg.docId, orgName: currentOrg.name,
            department: "研发", title: "工程师", joinedOn: "2024-01-01", leftOn: "", status: "active" }];
        const addCalls = [];
        const instance = mount(PersonDetail, { target: fixture, props: {
            settings, person, onRecord: async () => {}, onLoadInsights: async () => ({ timeline: [], coAttendance: [], totalEvents: 0 }),
            onLoadOrgMemberships: async () => copy(memberships),
            onLoadOrgCandidates: async () => [currentOrg, otherOrg],
            onAddOrgMembership: async (personDocId, orgDocId, extra) => {
                addCalls.push({ personDocId, orgDocId, extra: copy(extra) });
                memberships.push({ id: `20261017000000-hmem0${memberships.length + 1}`, orgDocId,
                    orgName: orgDocId === currentOrg.docId ? currentOrg.name : otherOrg.name,
                    department: extra?.department ?? "", title: extra?.title ?? "", joinedOn: extra?.joinedOn ?? "",
                    leftOn: extra?.leftOn ?? "", status: extra?.status ?? "active" });
            },
            onOpenPersonDoc() {}, onNavigate() {}, onChanged() {}, onDeleted() {}, onClose() {},
        } });
        try {
            await until(() => fixture.querySelector('select[aria-label="选择要加入的组织"]'), "详情页组织候选未加载");
            const orgSelect = fixture.querySelector('select[aria-label="选择要加入的组织"]');
            const historicalOption = [...orgSelect.options].find((option) => option.value === currentOrg.docId);
            assert(historicalOption && historicalOption.textContent.includes("已有当前归属"), "已有当前组织未提供补录历史入口");
            orgSelect.value = currentOrg.docId;
            orgSelect.dispatchEvent(new Event("change", { bubbles: true }));
            await tick();
            const status = fixture.querySelector('select[aria-label="当前状态"]');
            assert(status.value === "former" && status.querySelector('option[value="active"]').disabled, "选择已有当前组织后未切换到历史模式");
            input(fixture.querySelector('input[aria-label="离开日期"]'), "2025-12-31");
            button("添加归属").click();
            await until(() => addCalls.length === 1, "同组织历史未提交");
            assert(addCalls[0].personDocId === person.docId && addCalls[0].orgDocId === currentOrg.docId
                && addCalls[0].extra.status === "former" && addCalls[0].extra.leftOn === "2025-12-31",
                "同组织历史提交身份或结束日期错误");
            await until(() => fixture.textContent.includes("当前组织") && fixture.textContent.includes("已离开"), "补录历史后详情未回读");
        } finally { await unmount(instance); }
    });
}
