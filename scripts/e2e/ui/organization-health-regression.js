import { mount, unmount } from "svelte";
import OrgsView from "../../../src/components/org/OrgsView.svelte";
import { archiveOrganization, restoreOrganization, scanOrganizations, buildOrgDisplayByPerson, listOrganizationsWithMembers } from "../../../src/services/org";
import { bindOrgMembershipStorage } from "../../../src/data/org-membership";

function fixtureState(kernel, settings) {
    const docId = "20261004000000-org0001";
    const blockId = "20261004000000-mark001";
    const state = { docId, blockId, value: "1", count: 1, missing: false, writes: 0, reads: 0, skipWrite: false, failRead: false, failAfterWrite: false, failureAt: 0 };
    state.plugin = { loadData: async () => "" };
    kernel.handler = async (route, body) => {
        if (route === "/api/sqlite/flushTransaction") return null;
        if (route === "/api/query/sql") {
            state.reads += 1;
            if (state.failRead || state.failAfterWrite && state.writes > state.failureAt) throw new Error("隔离组织索引读取失败");
            if (body.stmt.includes("GROUP BY root_id")) return [{ root_id: docId, ial: `{: custom-lvct-org="${state.value}"}`, markerCount: state.count }];
            if (body.stmt.includes("id IN")) return state.missing ? [] : [{ id: docId, content: "测试组织", hpath: "/测试组织", box: settings.notebookId }];
            if (body.stmt.includes("SELECT id, content, box, path")) return state.missing ? [] : [{ id: docId, content: "测试组织", box: settings.notebookId, path: `/${docId}.sy` }];
            if (body.stmt.includes("root_id='")) return state.count === 1 ? [{ id: blockId, root_id: docId, box: settings.notebookId, type: "p", markdown: "**组织**：测试组织", ial: `{: custom-lvct-org="${state.value}"}` }] : [];
            if (body.stmt.includes("AND type = 'd'")) return state.missing ? [] : [{ id: docId }];
            if (body.stmt.includes("root_id =")) return [{ id: blockId, markdown: `**组织**：测试组织\n{: custom-lvct-org="${state.value}"}` }];
            throw new Error(`组织夹具拒绝 SQL ${body.stmt}`);
        }
        if (route === "/api/block/updateBlock") {
            state.writes += 1;
            if (!state.skipWrite) state.value = body.data.match(/custom-lvct-org="([^"]+)"/)[1];
            return null;
        }
        throw new Error(`组织夹具拒绝 ${route}`);
    };
    return state;
}

export async function runOrganizationHealthRegression({ test, assert, kernel, settings, fixture, until, button }) {
    await test("组织健康实际服务：坏标记、重复、不可达与权限故障不冒充空组织", async () => {
        for (const patch of [{ value: "future" }, { count: 2 }, { missing: true }, { failRead: true }]) {
            const state = fixtureState(kernel, settings);
            Object.assign(state, patch);
            let error;
            try { await scanOrganizations(); } catch (cause) { error = cause; }
            assert(error && state.writes === 0, "异常组织被当成合法空列表或自动修改");
        }
    });

    await test("组织健康实际服务：并发归档锁内重读，重复请求零重写，未知结果只读核实", async () => {
        const state = fixtureState(kernel, settings);
        await Promise.all([archiveOrganization(state.docId), archiveOrganization(state.docId)]);
        assert(state.value === "archived" && state.writes === 1, "并发归档重复写入或状态未核实");
        await restoreOrganization(state.docId);
        assert(state.value === "1" && state.writes === 2, "组织恢复未核实");
        for (const failure of ["skipWrite", "failAfterWrite"]) {
            state[failure] = true;
            state.failureAt = state.writes;
            let error;
            const before = state.writes;
            try { await archiveOrganization(state.docId); } catch (cause) { error = cause; }
            assert(error?.message.includes("结果未核实") && state.writes === before + 1, "归档未知结果被报为成功或自动重放");
            state[failure] = false;
        }
        const before = state.writes;
        await archiveOrganization(state.docId);
        assert(state.writes === before, "回读已归档后仍重复写入");
    });

    await test("组织健康实际服务：归档首条成员不遮蔽另一正常组织的单位投影", async () => {
        const firstOrg = "20261004000000-org0001";
        const secondOrg = "20261004000000-org0002";
        const personDocId = "20261004000000-person1";
        const plugin = { loadData: async () => ({ schemaVersion: 1, memberships: [firstOrg, secondOrg].map((orgDocId, index) => ({
            id: `20261004000000-member${index + 1}`, orgDocId, personDocId, status: "active", joinedOn: "2026-01-01", leftOn: "", department: "", title: "",
        })) }) };
        bindOrgMembershipStorage(plugin);
        kernel.handler = async (route, body) => {
            if (route !== "/api/query/sql") throw new Error(`单位夹具拒绝 ${route}`);
            if (body.stmt.includes("GROUP BY root_id")) return [
                { root_id: firstOrg, ial: '{: custom-lvct-org="archived"}', markerCount: 1 },
                { root_id: secondOrg, ial: '{: custom-lvct-org="1"}', markerCount: 1 },
            ];
            return [firstOrg, secondOrg].map((id, index) => ({ id, content: index === 0 ? "已归档" : "正常单位", hpath: "/组织", box: settings.notebookId }));
        };
        assert((await buildOrgDisplayByPerson()).get(personDocId) === "正常单位", "归档首条成员遮蔽了正常单位");
    });

    await test("组织健康界面：异常数量显示待核实，修复原标记后重新读取恢复", async () => {
        const state = fixtureState(kernel, settings);
        state.value = "future";
        const facade = { listOrganizations: () => listOrganizationsWithMembers(state.plugin) };
        const component = mount(OrgsView, { target: fixture, props: { facade, onOpenOrgManager: () => {} } });
        try {
            await until(() => fixture.textContent.includes("组织状态未核实"), "组织错误态未显示");
            assert(fixture.textContent.includes("组织数量待核实") && !fixture.textContent.includes("共 0 个组织"), "未知数量被显示为零组织");
            state.value = "1";
            button("重新加载").click();
            await until(() => fixture.textContent.includes("测试组织") && !fixture.textContent.includes("组织状态未核实"), "组织读取重试未恢复");
            assert(state.writes === 0, "组织健康重试修改了原库");
        } finally { await unmount(component); }
    });
}
