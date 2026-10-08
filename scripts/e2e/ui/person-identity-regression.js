import { mount, unmount, tick } from "svelte";
import { configureVcardKernel } from "./vcard-regression.js";
import { ContactCreationError, ContactNameAmbiguityError, createContact, previewContactCreation } from "../../../src/services/contacts";
import { buildVcfImportPlan, retryVcfContacts, runVcfImportQueue } from "../../../src/services/vcard";
import { disposeExternalBridge, initExternalBridge } from "../../../src/bridge/external-bridge";
import { emptyDraft } from "../../../src/domain/person";
import { kernelConfig } from "../../../src/api/client";
import { extractFromDoc, prepareAiExtraction } from "../../../src/services/ai-extract";
import AddPersonDialog from "../../../src/components/people/AddPersonDialog.svelte";
import PersonPicker from "../../../src/components/people/PersonPicker.svelte";
import VCardDialog from "../../../src/components/people/VCardDialog.svelte";
import CaptureDialog from "../../../src/components/capture/CaptureDialog.svelte";

async function failure(operation) {
    try { await operation(); } catch (error) { return error; }
    throw new Error("预期操作停止，但实际成功");
}

function changeInput(element, value) {
    element.value = value;
    element.dispatchEvent(new Event("input", { bubbles: true }));
}

export async function runPersonIdentityRegression({ test, assert, kernel, settings, fixture, until, button }) {
    await test("AG-B12-003 手动同名先消歧，独立人物并存且明确收编原文档", async () => {
        const state = configureVcardKernel(kernel, settings);
        state.sameName("同名人物");
        const draft = { ...emptyDraft(), name: "同名人物", phone: "13800000001" };
        const error = await failure(() => createContact(settings, draft));
        assert(error instanceof ContactNameAmbiguityError && error.preview.existing[0].docId === "20261004000000-other01", "同名未返回稳定候选");
        assert(state.creates.length === 0 && state.binds.length === 0, "未确认人物便发出写入");
        const first = await createContact(settings, draft, { allowSameName: true });
        const second = await createContact(settings, { ...draft, phone: "13800000002" }, { allowSameName: true });
        assert(first.docId !== second.docId && first.itemId !== second.itemId && state.rows.size === 3, "同名独立人物被合并");
        const chosenId = "20261004000000-choose1";
        state.docs.set(chosenId, { id: chosenId, name: "待收编" });
        const chosenDraft = { ...emptyDraft(), name: "待收编", email: "chosen@example.test" };
        const review = await failure(() => createContact(settings, chosenDraft));
        assert(review instanceof ContactNameAmbiguityError && review.preview.unbound[0].docId === chosenId, "未绑定同名文档被自动收编");
        const adopted = await createContact(settings, chosenDraft, { reuseDocId: chosenId });
        assert(adopted.docId === chosenId && state.creates.length === 2, "明确收编未使用所选 ID");
    });

    await test("AG-B12-003 501 文档候选分页完整，扫描失败零新建", async () => {
        const state = configureVcardKernel(kernel, settings);
        for (let index = 0; index < 501; index += 1) {
            const id = `20261004000000-${String(index).padStart(7, "0")}`;
            state.docs.set(id, { id, name: index === 500 ? "最后候选" : `其他文档 ${index}` });
        }
        const preview = await previewContactCreation(settings, "最后候选");
        assert(preview.unbound.length === 1 && preview.unbound[0].docId === "20261004000000-0000500", "首 500 条截断掩盖了候选");
        const error = await failure(() => createContact(settings, { ...emptyDraft(), name: "最后候选" }));
        assert(error instanceof ContactNameAmbiguityError && state.creates.length === 0, "未选具体文档即创建");
        state.markedOrganizations.add("20261004000000-0000500");
        const organizationPreview = await previewContactCreation(settings, "最后候选");
        assert(organizationPreview.unbound.length === 0, "组织文档被作为人物收编候选");
        await failure(() => createContact(settings, { ...emptyDraft(), name: "最后候选" }, { reuseDocId: "20261004000000-0000500" }));
        assert(state.creates.length === 0 && state.binds.length === 0, "显式 ID 允许把组织收编为人物");
        state.failLookup = true;
        await failure(() => createContact(settings, { ...emptyDraft(), name: "新人物" }, { allowSameName: true }));
        assert(state.creates.length === 0 && state.binds.length === 0, "扫描失败被当作没有残留");
    });

    await test("AG-B12-003 创建未知保留请求，恢复及改名后只补原人物", async () => {
        const state = configureVcardKernel(kernel, settings);
        state.loseCreate = true;
        state.hideMarker = true;
        const draft = { ...emptyDraft(), name: "原人物", phone: "13800000003" };
        const originalTimeout = kernelConfig.timeoutMs;
        kernelConfig.timeoutMs = 50;
        try {
            const first = await failure(() => createContact(settings, draft));
            assert(first instanceof ContactCreationError && first.request.checkpoint.state === "unknown", "未知创建缺原请求");
            await failure(() => createContact(settings, draft, { request: first.request }));
            assert(state.creates.length === 1 && state.binds.length === 0, "未知创建重发或擅自绑定");
            state.hideMarker = false;
            state.loseCreate = false;
            const docId = [...state.docs.keys()][0];
            state.docs.get(docId).name = "已改名的原人物";
            const created = await createContact(settings, draft, { request: first.request });
            assert(created.docId === docId && created.name === "已改名的原人物" && state.creates.length === 1, "改名让请求改绑或重建");
            const before = state.writes.length;
            await createContact(settings, draft, { request: first.request });
            assert(state.creates.length === 1 && state.binds.length === 1 && state.writes.length === before, "同请求核实仍重复写入");
        } finally { kernelConfig.timeoutMs = originalTimeout; }
    });

    await test("AG-B12-003 绑定丢响应先核实，字段失败和并发重试不写同名他人", async () => {
        const state = configureVcardKernel(kernel, settings);
        state.sameName("共享姓名");
        state.loseBind = true;
        state.failField = true;
        const draft = { ...emptyDraft(), name: "共享姓名", phone: "13800000004" };
        const originalTimeout = kernelConfig.timeoutMs;
        kernelConfig.timeoutMs = 50;
        try {
            const error = await failure(() => createContact(settings, draft, { allowSameName: true }));
            assert(error instanceof ContactCreationError && error.request.bindingState === "verified" && error.request.checkpoint.itemId, "丢绑定响应未核实原行");
            state.failField = false;
            state.loseBind = false;
            const repeated = await Promise.all([createContact(settings, draft, { request: error.request }), createContact(settings, draft, { request: error.request })]);
            assert(repeated[0].docId === repeated[1].docId && state.creates.length === 1 && state.binds.length === 1, "并发补写重复建人");
            assert(state.writes.every((write) => write.itemID === error.request.checkpoint.itemId), "字段补写写到了另一个同名人");
            const before = state.writes.length;
            await failure(() => createContact(settings, { ...draft, phone: "different" }, { request: error.request }));
            const changedSettings = { ...settings, dbBlockId: "20261004000000-newdb01" };
            await failure(() => createContact(changedSettings, draft, { request: error.request }));
            state.rows.delete(error.request.checkpoint.itemId);
            await failure(() => createContact(settings, draft, { request: error.request }));
            assert(state.creates.length === 1 && state.binds.length === 1 && state.writes.length === before, "改输入/锚点/解绑后重建或改写");
        } finally { kernelConfig.timeoutMs = originalTimeout; }
    });

    await test("AG-B12-003 明确绑定拒绝可续做，重复标记或删除原文档不创建替代", async () => {
        const state = configureVcardKernel(kernel, settings);
        state.failBind = true;
        const draft = { ...emptyDraft(), name: "原请求" };
        const error = await failure(() => createContact(settings, draft));
        assert(error instanceof ContactCreationError && error.request.bindingState === "rejected", "明确内核拒绝被当成功");
        state.failBind = false;
        const created = await createContact(settings, draft, { request: error.request });
        assert(created.docId === error.request.checkpoint.docId && state.creates.length === 1, "拒绝后重建了人物");
        state.duplicateMarker = true;
        await failure(() => createContact(settings, draft, { request: error.request }));
        state.duplicateMarker = false;
        state.docs.delete(created.docId);
        await failure(() => createContact(settings, draft, { request: error.request }));
        assert(state.creates.length === 1 && state.binds.length === 2, "歧义或删除后创建替代");
    });

    await test("AG-B12-003 绑定接受但无原行保持未知，只读重试不重发绑定", async () => {
        const state = configureVcardKernel(kernel, settings);
        state.skipBind = true;
        const draft = { ...emptyDraft(), name: "绑定未知" };
        const error = await failure(() => createContact(settings, draft));
        assert(error instanceof ContactCreationError && error.request.bindingState === "unknown", "无原行被报为确定完成或失败");
        state.skipBind = false;
        await failure(() => createContact(settings, draft, { request: error.request }));
        assert(state.creates.length === 1 && state.binds.length === 1 && state.writes.length === 0, "未知绑定被重放");
        const docId = error.request.checkpoint.docId;
        const itemId = "20261004000000-later01";
        state.rows.set(itemId, { id: itemId, cells: [{ valueType: "block", value: {
            type: "block", keyID: "name", block: { id: docId, content: draft.name },
        } }] });
        const verified = await createContact(settings, draft, { request: error.request });
        assert(verified.itemId === itemId && state.binds.length === 1, "原行后来可见时未只读恢复");
    });

    await test("AG-B12-003 vCard 同名默认跳过，人工确认独立人物与重试保留原 ID", async () => {
        const state = configureVcardKernel(kernel, settings);
        state.sameName("同名导入");
        const source = "BEGIN:VCARD\r\nVERSION:3.0\r\nFN:同名导入\r\nTEL:13800000005\r\nEND:VCARD\r\n";
        const plans = await buildVcfImportPlan(settings, source + source);
        assert(plans.length === 2 && plans.every((plan) => plan.duplicate) && plans[1].sameNameInBatch, "同批同名边界缺失");
        assert(plans[0].existingCandidates[0].docId === "20261004000000-other01", "导入预览缺稳定 ID");
        const entries = plans.map((plan, planIndex) => ({ plan, planIndex }));
        const skipped = await runVcfImportQueue(settings, entries);
        assert(skipped.imported === 0 && state.creates.length === 0, "未确认同名便导入");
        plans.forEach((plan) => { plan.allowSameName = true; });
        const imported = await runVcfImportQueue(settings, entries);
        assert(imported.imported === 2 && state.creates.length === 2 && state.rows.size === 3 && plans[0].checkpoint.docId !== plans[1].checkpoint.docId,
            `独立同名卡片未各自完成：${JSON.stringify(imported.results.map((result) => ({ planIndex: result.planIndex, status: result.status, reason: result.reason })))}`);
        const before = state.writes.length;
        const repeated = await retryVcfContacts(settings, entries);
        assert(repeated.every((result) => result.status === "imported" && result.checkpoint.docId === plans[result.planIndex].checkpoint.docId)
            && state.creates.length === 2 && state.writes.length === before, "导入重试依姓名写到别的人");
    });

    await test("AG-B12-003 桥同名拒绝返回首人，getPerson 按稳定 ID 返回原人", async () => {
        const state = configureVcardKernel(kernel, settings);
        state.sameName("桥同名");
        const firstRow = state.rows.get("row-other");
        state.rows.delete("row-other");
        firstRow.id = "20261004000000-brow001";
        state.rows.set(firstRow.id, firstRow);
        state.docs.set("20261004000000-other01", { id: "20261004000000-other01", name: "桥同名" });
        state.docs.set("20261004000000-other02", { id: "20261004000000-other02", name: "桥同名" });
        state.rows.set("20261004000000-brow002", { id: "20261004000000-brow002", cells: [{ valueType: "block", value: {
            type: "block", keyID: "name", block: { id: "20261004000000-other02", content: "桥同名" },
        } }] });
        initExternalBridge({ loadData: async () => "", saveData: async () => {} }, () => settings);
        try {
            const error = await failure(() => window.LvContacts.ensurePerson("桥同名"));
            assert(error.code === "person_ambiguous" && error.candidates.length === 2, "桥仍按名返回第一人");
            const selected = await window.LvContacts.getPerson("20261004000000-other02");
            assert(selected.docId === "20261004000000-other02" && selected.itemId === "20261004000000-brow002" && state.creates.length === 0, "桥按 ID 取人发生改绑");
        } finally { disposeExternalBridge(); }
    });

    await test("AG-B12-003 选人器同名证据、键盘和搜索保持稳定选择", async () => {
        let selected = "";
        const items = [
            { id: "row-first", docId: "20261004000000-other01", itemId: "row-first", label: "同名", hint: "公司甲 · 13800000006" },
            { id: "row-second", docId: "20261004000000-other02", itemId: "row-second", label: "同名", hint: "公司乙 · 13800000007" },
        ];
        const component = mount(PersonPicker, { target: fixture, props: { items, onSelect: (id) => { selected = id; } } });
        try {
            fixture.querySelector(".lvct-picker__trigger").click();
            await until(() => document.body.querySelector(".lvct-picker__search"), "选人器未打开");
            const panel = document.body.querySelector(".lvct-picker__panel");
            assert(panel.textContent.includes(items[0].docId) && panel.textContent.includes(items[1].docId), "同名选项没有稳定 ID");
            const search = panel.querySelector("input");
            changeInput(search, items[1].docId);
            await tick();
            search.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
            assert(selected === "row-second", "按文档 ID 搜索后键盘选择了错误行");
        } finally { await unmount(component); }
    });

    await test("AG-B12-003 新建界面先核对同名，未知保留草稿断点与取消", async () => {
        const state = configureVcardKernel(kernel, settings);
        state.sameName("界面同名");
        const draft = { ...emptyDraft(), name: "界面同名", phone: "13800000008" };
        let created;
        const component = mount(AddPersonDialog, { target: fixture, props: { settings, initial: draft, onCreated: (person) => { created = person; }, onClose() {} } });
        try {
            button("创建联系人").click();
            await until(() => fixture.textContent.includes("同名候选，请核对"), "未显示同名核对");
            assert(fixture.textContent.includes("20261004000000-other01") && state.creates.length === 0, "确认前写入或缺 ID");
            const choice = fixture.querySelector('input[type="radio"][value="new"]');
            choice.checked = true;
            choice.dispatchEvent(new Event("change", { bubbles: true }));
            state.hideMarker = true;
            await tick();
            button("创建联系人").click();
            await until(() => fixture.textContent.includes("已保留原请求"), "未知请求断点未显示");
            assert(fixture.querySelector("fieldset").disabled && fixture.querySelector('input[type="tel"]').value === draft.phone, "未知状态丢草稿或可修改原请求");
            button("取消").click();
            await until(() => document.body.querySelector(".lvct-closeguard"), "未知关闭未提示保留断点");
            const cancel = [...document.body.querySelectorAll(".lvct-closeguard button")].find((item) => item.textContent.includes("取消"));
            cancel.click();
            assert(!created && state.creates.length === 1, "取消重发或删除了请求");
            state.hideMarker = false;
            button("核实并继续原请求").click();
            await until(() => created, "恢复可读后无法续做");
            assert(created.docId === [...state.docs.keys()][0] && state.creates.length === 1, "界面续做创建替代人物");
        } finally { await unmount(component); document.body.querySelector(".lvct-closeguard")?.remove(); }
    });

    await test("AG-B12-003 vCard 界面逐项确认同名，候选和卡片序号可核对", async () => {
        const state = configureVcardKernel(kernel, settings);
        state.sameName("界面导入");
        let imported = 0;
        const component = mount(VCardDialog, { target: fixture, props: { settings, onImported: (count) => { imported += count; }, onClose() {} } });
        try {
            const source = "BEGIN:VCARD\r\nVERSION:3.0\r\nFN:界面导入\r\nEND:VCARD\r\n";
            const transfer = new DataTransfer();
            transfer.items.add(new File([source], "same-name.vcf", { type: "text/vcard" }));
            const file = fixture.querySelector('input[type="file"]');
            file.files = transfer.files;
            file.dispatchEvent(new Event("change", { bubbles: true }));
            await until(() => fixture.querySelector(".lvct-import__row"), "导入预览未出现");
            const checkbox = fixture.querySelector('.lvct-import__row--dup input[type="checkbox"]');
            assert(!checkbox.checked && !checkbox.disabled && fixture.textContent.includes("20261004000000-other01"), "同名项没有显式确认入口或稳定 ID");
            checkbox.click();
            await until(() => [...fixture.querySelectorAll("button")].some((item) => item.textContent.includes("导入为联系人") && item.textContent.includes("1") && !item.disabled),
                `同名勾选后导入按钮未启用：${[...fixture.querySelectorAll("button")].map((item) => item.textContent).join("/")}`);
            [...fixture.querySelectorAll("button")].find((item) => item.textContent.includes("导入为联系人") && !item.disabled).click();
            await until(() => imported === 1, "明确同名导入未成功");
            assert(state.creates.length === 1 && state.rows.size === 2, "UI 导入覆盖同名原人");
        } finally { await unmount(component); }
    });

    await test("AG-B12-003 AI 同名候选不预选、不自动指派资料和跟进", async () => {
        const state = configureVcardKernel(kernel, settings);
        state.sameName("AI同名");
        const candidates = [
            { ...emptyDraft(), docId: "20261004000000-other01", itemId: "row-other", name: "AI同名", relatedItemIds: [] },
            { ...emptyDraft(), docId: "20261004000000-other02", itemId: "row-second", name: "AI同名", relatedItemIds: [] },
        ];
        state.rows.set("row-second", { id: "row-second", cells: [{ valueType: "block", value: {
            type: "block", keyID: "name", block: { id: candidates[1].docId, content: "AI同名" },
        } }] });
        const baseHandler = kernel.handler;
        let aiRequests = 0;
        let facadeWrites = 0;
        const sourceDocId = "20261004000000-source1";
        kernel.handler = async (route, body) => {
            if (route === "/api/export/exportMdContent") {
                assert(body.id === sourceDocId, "AI 读取了其他来源");
                return { hPath: "/会议", content: "与AI同名一起讨论，2026-10-05联系。" };
            }
            if (route === "/api/ai/chatGPT") {
                aiRequests += 1;
                assert(Object.keys(body).join(",") === "msg", "AI 发送夹具添加了隐藏上下文");
                return JSON.stringify({ version: 2, people: [{ name: "AI同名", evidence: "AI同名" }],
                    profileCandidates: [{ person: "AI同名", field: "phone", value: "13800000009" }],
                    followUpCandidates: [{ person: "AI同名", title: "联系", dueDate: "2026-10-05", evidence: "与AI同名一起讨论，2026-10-05联系。" }] });
            }
            return baseHandler(route, body);
        };
        const preflight = await prepareAiExtraction(settings, sourceDocId);
        assert(aiRequests === 0, "预检未确认便调用 AI");
        const actual = await extractFromDoc(settings, sourceDocId, { preflight, confirmed: true });
        assert(actual.matched.length === 0 && actual.unknownNames.length === 0 && actual.ambiguousCandidates[0].people.length === 2, "实际 AI 服务仍把同名折叠为最后一人或当作新人");
        assert(actual.candidates.length === 3 && actual.candidates.every((candidate) => candidate.targets.length === 2
            && candidate.selectedDocId === "" && !candidate.checked && candidate.decision === "pending"), "同名资料或跟进默认绑定了人物");
        const facade = {
            settings,
            viewPreferences: { aiEnabled: true },
            previewCapture: async () => ({ docName: "AI会议", sourceDocId, sourceStatus: "available", linked: [] }),
            prepareAiExtraction: (docId, options) => prepareAiExtraction(settings, docId, options),
            aiExtractFromDoc: (docId, confirmation) => extractFromDoc(settings, docId, confirmation),
            captureDoc: async () => { facadeWrites += 1; throw new Error("候选预览不得写入"); },
            updatePersonCandidateFields: async () => { facadeWrites += 1; throw new Error("候选决定不得写入"); },
            createFollowUp: async () => { facadeWrites += 1; throw new Error("候选决定不得创建跟进"); },
        };
        const component = mount(CaptureDialog, { target: fixture, props: { facade, docId: sourceDocId, onClose() {} } });
        try {
            await until(() => [...fixture.querySelectorAll("button")].some((item) => item.textContent.includes("AI 分析本页")), "捕获预览未加载");
            [...fixture.querySelectorAll("button")].find((item) => item.textContent.includes("AI 分析本页")).click();
            await until(() => fixture.querySelector("textarea[readonly]") && !button("确认发送本次文本", fixture).disabled, "同名预检未就绪");
            assert(aiRequests === 1, "界面预检提前调用 AI");
            button("确认发送本次文本", fixture).click();
            await until(() => fixture.textContent.includes("AI 提名含同名候选"), "AI 歧义提示未显示");
            assert(fixture.textContent.includes(candidates[0].docId) && fixture.textContent.includes(candidates[1].docId), "AI 候选缺稳定 ID");
            const checkboxes = [...fixture.querySelectorAll('.lvct-capture__list input[type="checkbox"]')];
            assert(checkboxes.length === 2 && checkboxes.every((input) => !input.checked), "AI 按名字自动选中或自动指派写入候选");
            const drafts = [...fixture.querySelectorAll("[data-ai-kind]")];
            assert(drafts.length === 3 && drafts.every((draft) => draft.querySelector("select").value === ""), "同名草稿没有逐项选择稳定目标");
            const personDraft = fixture.querySelector('[data-ai-kind="person"]');
            assert(button("接受本项", personDraft).disabled, "未消歧人物可以直接接受");
            const target = personDraft.querySelector("select");
            target.value = candidates[1].docId;
            target.dispatchEvent(new Event("change", { bubbles: true }));
            await tick();
            button("接受本项", personDraft).click();
            await tick();
            const selected = fixture.querySelectorAll('.lvct-capture__list input[type="checkbox"]');
            assert(!selected[0].checked && selected[1].checked, "手选稳定 ID 后选择了同名他人");
            assert(fixture.querySelector('[data-ai-kind="profile"] select').value === ""
                && fixture.querySelector('[data-ai-kind="followup"] select').value === "", "选人后自动指派了资料或跟进");
            assert(aiRequests === 2 && facadeWrites === 0 && state.writes.length === 0 && state.creates.length === 0, "AI 同名候选决定写入了事实");
        } finally { await unmount(component); }
    });
}
