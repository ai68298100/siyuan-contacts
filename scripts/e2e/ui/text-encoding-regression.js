import { createContact } from "../../../src/services/contacts";
import { createOrganization, renameOrganization } from "../../../src/services/org";
import { initializeWorkspace } from "../../../src/services/init";
import { importVcfContacts, retryVcfContacts } from "../../../src/services/vcard";
import { emptyDraft } from "../../../src/domain/person";
import { FIELD_SPECS } from "../../../src/domain/fields";
import { renameDoc } from "../../../src/api/client";

export async function runTextEncodingRegression({ test, assert, kernel, settings }) {
    await test("名称实际 API：嵌套文档改名使用核实路径，未知或错误笔记本零写入", async () => {
        const docId = "20261004000000-org0001";
        const physicalPath = `/20261004000000-parent1/${docId}.sy`;
        const requests = [];
        let row = { path: physicalPath, box: settings.notebookId, content: "旧名" };
        let skipRename = false;
        kernel.handler = async (route, body) => {
            if (route === "/api/sqlite/flushTransaction") return null;
            if (route === "/api/query/sql") return [row];
            if (route === "/api/filetree/renameDoc") { requests.push(body); if (!skipRename) row.content = body.title; return null; }
            throw new Error(`改名夹具拒绝 ${route}`);
        };
        await renameDoc(settings.notebookId, docId, "中文 [甲](乙)#");
        assert(requests.length === 1 && requests[0].path === physicalPath && requests[0].title === "中文 [甲](乙)#", "嵌套文档使用了臆造根目录路径或改变了原标题");
        await renameDoc(settings.notebookId, docId, row.content);
        assert(requests.length === 1, "重复改名仍写入");
        for (const invalid of [{ ...row, box: "20261004000000-other01" }, { ...row, path: "/../escape.sy" }, { ...row, path: "/20261004000000-other01.sy" }]) {
            row = invalid;
            let error;
            try { await renameDoc(settings.notebookId, docId, "新名"); } catch (cause) { error = cause; }
            assert(error?.message.includes("未写入") && requests.length === 1, "未核实改名目标仍写入");
        }
        row = { path: physicalPath, box: settings.notebookId, content: "旧名" };
        skipRename = true;
        let unknown;
        try { await renameDoc(settings.notebookId, docId, "新名"); } catch (cause) { unknown = cause; }
        assert(unknown?.message.includes("结果未知") && requests.length === 2, "code=0 未改名被宣称成功或自动重放");
    });
    await test("名称实际服务：手动、组织、初始化、vCard 与重试对不支持名称均零写入", async () => {
        let writes = 0;
        kernel.handler = async (route) => {
            if (route === "/api/av/renderAttributeView") return { view: {
                columns: FIELD_SPECS.map((field) => ({ id: field.key, name: field.nameZh, type: field.type })), rows: [],
            } };
            if (route === "/api/query/sql") return [];
            writes += 1;
            throw new Error(`名称拒绝期间不应调用 ${route}`);
        };
        for (const name of ["甲/乙", "甲\n乙", "甲\r乙", "甲\t乙"]) {
            for (const run of [
                () => createContact(settings, { ...emptyDraft(), name }),
                () => createOrganization(settings, name),
                () => renameOrganization("20261004000000-org0001", name),
                () => initializeWorkspace({}, { notebookName: name }, () => {}),
            ]) {
                let error;
                try { await run(); } catch (cause) { error = cause; }
                assert(error?.message.includes("无法原文保留"), "服务没有明确拒绝内核无法保真的名称");
            }
            const draft = { ...emptyDraft(), name };
            const entries = [{ planIndex: 0, plan: { draft, contact: draft, duplicate: false } }];
            const imported = await importVcfContacts(settings, entries);
            const retried = await retryVcfContacts(settings, entries);
            assert(imported.failed.length === 1 && retried[0]?.status === "failed", "vCard 对无效名称未逐项报告失败");
        }
        assert(writes === 0, "名称校验失败期间进行了写入");
    });
}
