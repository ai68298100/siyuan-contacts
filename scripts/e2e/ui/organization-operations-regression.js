import { mount, unmount, tick } from "svelte";
import OrgManagerDialog from "../../../src/components/org/OrgManagerDialog.svelte";
import OrgOperationRecovery from "../../../src/components/org/OrgOperationRecovery.svelte";

function pendingReport(state = "pending") {
    return {
        operation: { kind: "create", requestId: "20261004000000-req0001", notebookId: "20261004000000-book001",
            name: "待核实组织", docId: "", createdAt: 1, updatedAt: 1, createState: state },
        status: state === "pending" ? "unknown" : "failed", canResume: state === "rejected", docId: "",
        message: state === "pending" ? "原请求结果未知，仅只读核实，不重建" : "内核明确拒绝，可继续原请求",
    };
}

export async function runOrganizationOperationsRegression({ test, assert, fixture, until, button }) {
    await test("组织新建 UI 按返回 docId 选中，不按同名第一项定位", async () => {
        const firstId = "20261004000000-org0001";
        const createdId = "20261004000000-org0002";
        let created = false;
        const selected = [];
        const facade = {
            listContacts: async () => [],
            listOrganizations: async () => (created ? [firstId, createdId] : [firstId]).map((docId) => ({ docId,
                name: "同名组织", archived: false, notebookId: "20261004000000-book001", hpath: "/同名组织", memberships: [] })),
            createOrganization: async () => { created = true; return { docId: createdId }; },
            listOrganizationMembers: async (docId) => { selected.push(docId); return []; },
        };
        const instance = mount(OrgManagerDialog, { target: fixture, props: { facade, onClose() {} } });
        try {
            await until(() => fixture.querySelector(".lvct-org-manager__create input") && selected.length > 0, "新建表单未加载");
            const input = fixture.querySelector(".lvct-org-manager__create input");
            input.value = "同名组织";
            input.dispatchEvent(new Event("input", { bubbles: true }));
            await tick();
            const create = [...fixture.querySelectorAll("button")].find((entry) => entry.textContent.trim() === "新建组织");
            assert(create && !create.disabled, "新建按钮不可操作");
            create.click();
            await until(() => selected.at(-1) === createdId, "新建后未按返回 ID 加载成员");
            assert(selected.at(-1) === createdId, "误选同名第一项");
        } finally { await unmount(instance); }
    });

    await test("重开组织续做先只读核实 pending，未知不显示补写按钮", async () => {
        let reads = 0;
        let inspections = 0;
        let writes = 0;
        const facade = {
            listPendingOrganizationOperations: async () => { reads += 1; return [pendingReport()]; },
            inspectOrganizationOperation: async () => { inspections += 1; return pendingReport(); },
            resumeOrganizationOperation: async () => { writes += 1; return pendingReport(); },
        };
        let instance = mount(OrgOperationRecovery, { target: fixture, props: { facade } });
        try {
            await until(() => fixture.textContent.includes("发送结果未知"), "pending 未显示");
            assert(writes === 0 && reads === 1, "挂载误发写请求");
            assert(!fixture.textContent.includes("继续未完成步骤"), "未知步骤出现补写入口");
            button("只读核实原请求").click();
            await until(() => inspections === 1, "只读核实未调用");
            assert(writes === 0, "核实误发写请求");
            await unmount(instance);
            instance = mount(OrgOperationRecovery, { target: fixture, props: { facade } });
            await until(() => reads === 2 && fixture.textContent.includes("发送结果未知"), "重开未读取原断点");
            assert(writes === 0, "重开误重放旧请求");
        } finally { await unmount(instance); }
    });

    await test("组织续做明确拒绝步骤需点击继续，完成按原稳定 docId 回调", async () => {
        let writes = 0;
        let recovered = "";
        const docId = "20261004000000-org0001";
        const facade = {
            listPendingOrganizationOperations: async () => [pendingReport("rejected")],
            resumeOrganizationOperation: async (requestId) => {
                writes += 1;
                const result = pendingReport("verified");
                result.status = "complete";
                result.canResume = false;
                result.operation.docId = docId;
                result.docId = docId;
                assert(requestId === result.operation.requestId, "继续改换请求 ID");
                return result;
            },
        };
        const instance = mount(OrgOperationRecovery, { target: fixture, props: { facade, onRecovered: (id) => { recovered = id; } } });
        try {
            await until(() => fixture.textContent.includes("继续未完成步骤"), "明确拒绝步骤未提供继续入口");
            assert(writes === 0, "挂载自动补写");
            button("继续未完成步骤").click();
            await until(() => recovered === docId, "完成未回调原 docId");
            assert(writes === 1, "补写重复发送");
        } finally { await unmount(instance); }
    });

    await test("组织续做读取损坏明确报错，迟到结果卸载后不更新", async () => {
        let release;
        const facade = { listPendingOrganizationOperations: async () => { throw new Error("组织操作断点存储内容损坏"); } };
        let instance = mount(OrgOperationRecovery, { target: fixture, props: { facade } });
        try {
            await until(() => fixture.textContent.includes("存储内容损坏"), "坏断点被当成空列表");
            await unmount(instance);
            instance = mount(OrgOperationRecovery, { target: fixture, props: { facade: {
                listPendingOrganizationOperations: () => new Promise((resolve) => { release = resolve; }),
            } } });
            await until(() => !!release, "迟到读取未开始");
            await unmount(instance);
            instance = null;
            release([pendingReport()]);
            await tick();
            assert(!fixture.textContent.includes("待核实组织"), "卸载后迟到结果仍更新 UI");
        } finally { if (instance) await unmount(instance); }
    });
}
