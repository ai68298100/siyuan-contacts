import { mount, unmount } from "svelte";
import { configureVcardKernel } from "./vcard-regression.js";
import { scanImportCandidates } from "../../../src/services/import-scan";
import { runDocumentImportQueue, writeImportFields } from "../../../src/services/import";
import { buildVcfImportPlan, runVcfImportQueue } from "../../../src/services/vcard";
import { importAnchor, snapshotImportQueue } from "../../../src/domain/import.ts";
import { emptyDraft } from "../../../src/domain/person";
import { invalidateRoster } from "../../../src/services/roster";
import ImportDialog from "../../../src/components/people/ImportDialog.svelte";
import ProfileCompletionDialog from "../../../src/components/people/ProfileCompletionDialog.svelte";
import QuickFillDialog from "../../../src/components/people/QuickFillDialog.svelte";
import { parseContactText } from "../../../src/domain/quick-fill.ts";

export function configureImportKernel(kernel, settings) {
    const state = configureVcardKernel(kernel, settings);
    const base = kernel.handler;
    state.pages = [];
    state.failAfterId = null;
    state.failMappings = false;
    state.failGroup = false;
    state.sourceNotebookId = "20261004000000-import1";
    state.addDoc = (index, name = `人物 ${index}`, notebookId = settings.notebookId) => {
        const id = `20261004000000-${String(index).padStart(7, "0")}`;
        state.docs.set(id, { id, name, notebookId });
        return id;
    };
    state.addRow = (docId, fields = {}) => {
        const rowId = `20261005000000-${docId.slice(-7)}`;
        const cells = [{ valueType: "block", value: { type: "block", keyID: "name", block: { id: docId, content: state.docs.get(docId).name } } }];
        for (const [field, value] of Object.entries(fields)) cells.push({ valueType: field === "tags" ? "mSelect" : field, value: {
            type: field === "tags" ? "mSelect" : field, keyID: field,
            ...(field === "tags" ? { mSelect: value.map((content) => ({ content })) } : { [field]: { content: value } }),
        } });
        state.rows.set(rowId, { id: rowId, cells });
        invalidateRoster();
        return rowId;
    };
    kernel.handler = async (route, body) => {
        if (route === "/api/notebook/lsNotebooks") return { notebooks: [{ id: state.sourceNotebookId, name: "导入来源" }] };
        if (route === "/api/query/sql" && body.stmt.includes("SELECT id, content, hpath")) {
            const afterId = body.stmt.match(/id > '([^']+)'/)?.[1] ?? "";
            const notebookId = body.stmt.match(/box='([^']+)'/)?.[1];
            const limit = Number(body.stmt.match(/LIMIT (\d+)/)?.[1]);
            state.pages.push({ afterId, limit, notebookId });
            if (state.failAfterId === afterId) throw new Error("本页读取失败");
            return [...state.docs.values()].filter((doc) => doc.id > afterId && (doc.notebookId ?? settings.notebookId) === notebookId)
                .sort((left, right) => left.id.localeCompare(right.id)).slice(0, limit)
                .map((doc) => ({ id: doc.id, content: doc.name, hpath: `/${doc.name}` }));
        }
        if (route === "/api/query/sql" && body.stmt.includes("root_id IN")) {
            return [...state.markedOrganizations].filter((docId) => body.stmt.includes(`'${docId}'`)).map((root_id) => ({ root_id }));
        }
        if (route === "/api/query/sql" && body.stmt.includes("SELECT id, content FROM")) {
            const docId = body.stmt.match(/\bid\s*=\s*'([^']+)'/)?.[1];
            const notebookId = body.stmt.match(/box='([^']+)'/)?.[1];
            const doc = state.docs.get(docId);
            return doc && (doc.notebookId ?? settings.notebookId) === notebookId ? [{ id: docId, content: doc.name }] : [];
        }
        if (route === "/api/av/getAttributeViewItemIDsByBoundIDs" && state.failMappings) throw new Error("绑定映射读取失败");
        if (route === "/api/av/setAttributeViewBlockAttr" && state.failGroup && body.keyID === "group") throw new Error("分组写入失败");
        return base(route, body);
    };
    return state;
}

export async function runImportRegression({ test, assert, kernel, settings, fixture, until, button }) {
    await test("AG-IMP-002 1501 篇三轮扫描，累计与单轮预算独立，末页同名和组织可核对", async () => {
        const state = configureImportKernel(kernel, settings);
        for (let index = 1; index <= 1501; index++) state.addDoc(index, index >= 1500 ? "同名人物" : `人物 ${index}`);
        state.markedOrganizations.add("20261004000000-0001499");
        const first = await scanImportCandidates(settings, settings.notebookId, { maxDocuments: 600 });
        const second = await scanImportCandidates(settings, settings.notebookId, { maxDocuments: 600, previous: first });
        const third = await scanImportCandidates(settings, settings.notebookId, { maxDocuments: 600, previous: second });
        assert(first.scanned === 600 && second.scanned === 1200 && third.scanned === 1501, "跨轮扫描预算或累计不正确");
        assert(third.state === "complete" && third.candidates.length === 1500, "末页遗漏或组织误入人物候选");
        assert(third.candidates.filter((candidate) => candidate.name === "同名人物").length === 2, "同名文档被合并");
        assert(state.pages.every((page) => page.limit > 0 && page.limit <= 500), "扫描请求无界");
    });

    await test("AG-IMP-002 失败页保留游标候选，继续重读而不显示空库", async () => {
        const state = configureImportKernel(kernel, settings);
        for (let index = 1; index <= 501; index++) state.addDoc(index);
        state.failAfterId = "20261004000000-0000500";
        const failed = await scanImportCandidates(settings, settings.notebookId);
        assert(failed.state === "failed" && failed.scanned === 500 && failed.candidates.length === 500, "失败被转为空或前页候选丢失");
        state.failAfterId = null;
        const complete = await scanImportCandidates(settings, settings.notebookId, { previous: failed });
        assert(complete.state === "complete" && complete.scanned === 501 && complete.candidates.length === 501, "未从失败页继续");
        state.failMappings = true;
        const unknown = await scanImportCandidates(settings, settings.notebookId);
        assert(unknown.state === "failed" && unknown.scanned === 0, "映射失败仍推进游标");
    });

    await test("AG-IMP-002 文档队列逐项暂停，未知绑定重试零重发，迟到原行可只读收口", async () => {
        const state = configureImportKernel(kernel, settings);
        const firstDoc = state.addDoc(1, "同名人物");
        const secondDoc = state.addDoc(2, "同名人物");
        const queue = snapshotImportQueue(importAnchor(settings), settings.notebookId,
            [firstDoc, secondDoc].map((docId) => ({ docId, name: "同名人物", hpath: "/同名人物" })));
        let pause = false;
        await runDocumentImportQueue(settings, queue, { shouldPause: () => pause, onProgress: () => { pause = true; } });
        assert(queue.items[0].status === "applied" && queue.items[1].status === "pending" && state.binds.length === 1, "暂停越过下一项");
        state.skipBind = true;
        await runDocumentImportQueue(settings, queue);
        assert(queue.items[1].status === "unknown", "未核实绑定被报成功");
        const writes = state.binds.length;
        await runDocumentImportQueue(settings, queue, { retryOnly: true });
        assert(state.binds.length === writes, "未知绑定被重发");
        state.addRow(secondDoc);
        await runDocumentImportQueue(settings, queue);
        assert(queue.items.every((item) => item.status === "applied") && state.binds.length === writes, "迟到原行未收口或重建");
    });

    await test("AG-IMP-002 已绑定字段部分失败不报成功，重试保留并发标签与已保存字段", async () => {
        const state = configureImportKernel(kernel, settings);
        const docId = state.addDoc(1, "字段人物");
        const queue = snapshotImportQueue(importAnchor(settings), settings.notebookId, [{ docId, name: "字段人物", hpath: "/字段人物" }], { group: "客户", tags: ["本次"] });
        state.failGroup = true;
        await runDocumentImportQueue(settings, queue);
        assert(queue.items[0].status !== "applied" && queue.items[0].binding === "verified", "字段失败被冒充全部成功");
        const row = state.rows.get(queue.items[0].itemId);
        const tags = row.cells.find((cell) => cell.value.keyID === "tags");
        tags.value.mSelect.push({ content: "并发" });
        state.failGroup = false;
        await runDocumentImportQueue(settings, queue);
        assert(queue.items[0].status === "applied" && tags.value.mSelect.some((tag) => tag.content === "并发"), "重试覆盖并发标签");
        assert(state.binds.length === 1, "字段重试重复绑定文档");
    });

    await test("AG-IMP-002 补录服务只写指定字段，外部补齐与稳定绑定变化零覆盖", async () => {
        const state = configureImportKernel(kernel, settings);
        const docId = state.addDoc(1, "补录人物");
        const itemId = state.addRow(docId, { phone: "并发电话" });
        const baseline = { ...emptyDraft(), name: "补录人物" };
        const result = await writeImportFields(settings, { docId, itemId }, baseline,
            { ...baseline, phone: "旧输入", email: "input@example.com" }, ["phone", "email"]);
        assert(result.conflicts.includes("phone") && state.writes.every((write) => write.keyID === "email"), "空基线并发值被覆盖");
        const before = state.writes.length;
        state.rows.delete(itemId);
        let failed = false;
        try { await writeImportFields(settings, { docId, itemId }, baseline, { ...baseline, email: "input@example.com" }, ["email"]); }
        catch { failed = true; }
        assert(failed && state.writes.length === before, "解绑后仍写同名目标");
    });

    await test("AG-IMP-001 vCard 末页未绑定残留阻断新请求，完整映射提示额外邮箱和忽略属性", async () => {
        const state = configureImportKernel(kernel, settings);
        for (let index = 1; index <= 501; index++) state.addDoc(index, index === 501 ? "残留人物" : `其他 ${index}`);
        const plans = await buildVcfImportPlan(settings, "BEGIN:VCARD\nFN:残留人物\nEMAIL:one@example.com\nEMAIL:two@example.com\nORG:组织\nEND:VCARD");
        assert(plans[0].unresolvedDocIds[0] === "20261004000000-0000501", "首 500 掩盖残留");
        assert(plans[0].mappings.some((mapping) => mapping.sourceField === "EMAIL（第 2 项起）" && mapping.state === "ignored"), "额外邮箱静默丢弃");
        const report = await runVcfImportQueue(settings, [{ planIndex: 0, plan: plans[0] }]);
        assert(report.unknown.length === 1 && state.creates.length === 0, "残留未知时重复创建");
    });

    await test("AG-IMP-001 vCard 固定逐卡队列暂停并继续，成功项不重复创建", async () => {
        const state = configureImportKernel(kernel, settings);
        const plans = await buildVcfImportPlan(settings, "BEGIN:VCARD\nFN:甲\nEND:VCARD\nBEGIN:VCARD\nFN:乙\nEND:VCARD");
        const entries = plans.map((plan, planIndex) => ({ plan, planIndex }));
        let pause = false;
        const first = await runVcfImportQueue(settings, entries, null, { shouldPause: () => pause, onProgress: () => { pause = true; } });
        assert(first.imported === 1 && first.results[1].status === "pending" && first.expected === 2, "暂停丢失逐项队列");
        const second = await runVcfImportQueue(settings, entries, first);
        assert(second.imported === 2 && state.creates.length === 2, "继续重建成功项");
    });

    await test("AG-IMP-002 仅重试不执行 pending，锚点变化保持原队列零创建", async () => {
        const state = configureImportKernel(kernel, settings);
        const plans = await buildVcfImportPlan(settings, "BEGIN:VCARD\nFN:原队列人物\nEND:VCARD");
        const entries = plans.map((plan, planIndex) => ({ plan, planIndex }));
        const pending = await runVcfImportQueue(settings, entries, null, { retryOnly: true });
        assert(pending.results[0].status === "pending" && state.creates.length === 0, "仅重试执行了未开始项");
        const stopped = await runVcfImportQueue({ ...settings, notebookId: state.sourceNotebookId }, entries, pending);
        assert(stopped.failed.length === 1 && state.creates.length === 0 && state.binds.length === 0, "锚点变化后执行了原队列");
        const docId = state.addDoc(1, "未执行文档");
        const queue = snapshotImportQueue(importAnchor(settings), settings.notebookId, [{ docId, name: "未执行文档", hpath: "/未执行文档" }]);
        await runDocumentImportQueue(settings, queue, { retryOnly: true });
        assert(queue.items[0].status === "pending" && state.binds.length === 0, "文档仅重试执行了未开始项");
    });

    await test("AG-IMP-002 收编界面显示扫描范围与稳定 ID，继续不勾选新页", async () => {
        const state = configureImportKernel(kernel, settings);
        for (let index = 1; index <= 1001; index++) state.addDoc(index, `候选 ${index}`, state.sourceNotebookId);
        const component = mount(ImportDialog, { target: fixture, props: { settings, onImported() {}, onClose() {} } });
        try {
            await until(() => fixture.textContent.includes("已扫描 1000 篇"), "未显示截断扫描范围");
            const checkbox = fixture.querySelectorAll('input[type="checkbox"]')[1];
            checkbox.checked = true;
            checkbox.dispatchEvent(new Event("change", { bubbles: true }));
            button("继续扫描").click();
            await until(() => fixture.textContent.includes("已扫描 1001 篇"), "继续未跨过初始预算");
            assert(fixture.textContent.includes("20261004000000-0001001"), "候选未显示稳定文档 ID");
            assert(fixture.querySelectorAll('input[type="checkbox"]:checked').length === 1, "新页暗改选择");
            const keyword = fixture.querySelector('input[aria-label="按文档名过滤"]');
            keyword.value = "候选 1001";
            keyword.dispatchEvent(new Event("input", { bubbles: true }));
            await until(() => fixture.textContent.includes("当前范围隐藏 1 篇") && !button("收编为联系人（1）").disabled, "筛选未保留隐藏选择");
            assert(!button("收编为联系人（1）").disabled, "筛选后待执行选择丢失");
        } finally { await unmount(component); }
    });

    await test("AG-IMP-002 补录队列不随父层数组变更，暂停保留输入", async () => {
        configureImportKernel(kernel, settings);
        const people = [{ ...emptyDraft(), name: "原人物", docId: "20261004000000-person1", itemId: "原行", relatedItemIds: [] }];
        const component = mount(ProfileCompletionDialog, { target: fixture, props: { settings, people, onClose() {} } });
        try {
            await until(() => fixture.textContent.includes("原人物"), "补录未加载");
            people[0].name = "父层新名字";
            people.splice(0);
            const input = fixture.querySelector('input[type="tel"]');
            input.value = "13800000001";
            input.dispatchEvent(new Event("input", { bubbles: true }));
            button("暂停").click();
            await until(() => fixture.textContent.includes("补录已暂停"), "未显示暂停状态");
            assert(input.value === "13800000001" && fixture.textContent.includes("原人物"), "暂停丢输入或父层覆盖队列");
        } finally { await unmount(component); }
    });

    await test("AG-IMP-002 补录空范围显示完成出口", async () => {
        const component = mount(ProfileCompletionDialog, { target: fixture, props: { settings, people: [], onClose() {} } });
        try {
            await until(() => fixture.textContent.includes("保存 0 人，跳过 0 人"), "空队列没有明确出口");
            assert([...fixture.querySelectorAll("button")].some((node) => node.textContent.includes("完成")), "空队列不能关闭");
        } finally { await unmount(component); }
    });

    await test("AG-IMP-001 粘贴同字段冲突无默认选择，应用仅回填选中草稿", async () => {
        const parsed = parseContactText("电话：13800000001\n电话：13800000002");
        let applied = null;
        const component = mount(QuickFillDialog, { target: fixture, props: { existing: emptyDraft(), initialResult: parsed, onApply(value) { applied = value; }, onClose() {} } });
        try {
            await until(() => fixture.querySelectorAll('input[type="checkbox"]').length === 2, "冲突候选未展示");
            assert(fixture.querySelectorAll('input[type="checkbox"]:checked').length === 0 && applied === null, "冲突默认选中或隐藏写入");
            fixture.querySelector('input[type="checkbox"]').click();
            await until(() => [...fixture.querySelectorAll("button")].some((node) => node.textContent.includes("应用到表单（1）") && !node.disabled), "选择未生效");
            button("应用到表单（1）").click();
            assert(applied.phone === "13800000001", "选中映射未回填");
        } finally { await unmount(component); }
    });

    await test("AG-IMP-001 粘贴公历生日同时回填 false 历法，不沿用旧农历", async () => {
        let applied = null;
        const component = mount(QuickFillDialog, { target: fixture, props: {
            existing: { ...emptyDraft(), isLunar: true }, initialResult: parseContactText("生日：1990-01-01"),
            onApply(value) { applied = value; }, onClose() {},
        } });
        try {
            await until(() => [...fixture.querySelectorAll("button")].some((node) => node.textContent.includes("应用到表单（1）") && !node.disabled), "生日映射未准备");
            button("应用到表单（1）").click();
            assert(applied.birthday === "1990-01-01" && applied.isLunar === false, "公历日期沿用旧农历标记");
        } finally { await unmount(component); }
    });

}
