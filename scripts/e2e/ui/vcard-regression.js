import { importVcfContacts, retryVcfContacts } from "../../../src/services/vcard";
import { emptyDraft } from "../../../src/domain/person";
import { FIELD_SPECS } from "../../../src/domain/fields";
import { kernelConfig } from "../../../src/api/client";
import { invalidateRoster } from "../../../src/services/roster";
import { mount, unmount } from "svelte";
import VCardDialog from "../../../src/components/people/VCardDialog.svelte";

let vcardFixtureNumber = 0;

export function configureVcardKernel(kernel, settings) {
    settings.avId = `20261004000000-v${String(++vcardFixtureNumber).padStart(6, "0")}`;
    invalidateRoster();
    const state = {
        docs: new Map(), rows: new Map(), creates: [], binds: [], writes: [],
        markedOrganizations: new Set(),
        rejectCreate: false, loseCreate: false, hideMarker: false, failLookup: false,
        failBind: false, loseBind: false, skipBind: false, duplicateMarker: false, failField: false,
        lookupGate: null, lookupStarted: false, releaseLookup: null,
    };
    kernel.handler = async (route, body) => {
        if (route === "/api/av/renderAttributeView") return { view: {
            columns: FIELD_SPECS.map((field) => ({ id: field.key, name: field.nameZh, type: field.type })),
            rows: structuredClone([...state.rows.values()]),
        } };
        if (route === "/api/sqlite/flushTransaction") return null;
        if (route === "/api/query/sql") {
            if (state.failLookup) throw new Error("请求标记暂不可读");
            if (body.stmt.includes("SELECT DISTINCT root_id")) {
                if (state.lookupGate) {
                    state.lookupStarted = true;
                    await state.lookupGate;
                    state.lookupGate = null;
                }
                if (state.hideMarker) return [];
                const requestId = body.stmt.match(/custom-lvct-(?:vcard|contact-draft)="([^"]+)"/)?.[1];
                const docs = [...state.docs.values()].filter((doc) => doc.requestId === requestId);
                const roots = docs.map((doc) => ({ root_id: doc.id }));
                if (state.duplicateMarker && roots.length) roots.push({ root_id: "20261004000000-other01" });
                return roots;
            }
            if (body.stmt.includes("SELECT id, content, hpath")) {
                const afterId = body.stmt.match(/id > '([^']+)'/)?.[1] ?? "";
                return [...state.docs.values()].filter((doc) => doc.id > afterId)
                    .sort((left, right) => left.id.localeCompare(right.id)).slice(0, 500)
                    .map((doc) => ({ id: doc.id, content: doc.name, hpath: `/${doc.name}` }));
            }
            const markedId = body.stmt.match(/root_id = '([^']+)'/)?.[1];
            if (markedId) return state.markedOrganizations.has(markedId) && body.stmt.includes("custom-lvct-org")
                ? [{ id: "20261004000000-orgmark", markdown: '**组织**：组织\n{: custom-lvct-org="1"}' }] : [];
            const docId = body.stmt.match(/\bid\s*=\s*'([^']+)'/)?.[1];
            const doc = state.docs.get(docId);
            return doc ? [{ id: doc.id, content: doc.name }] : [];
        }
        if (route === "/api/filetree/createDocWithMd") {
            state.creates.push(body);
            if (state.rejectCreate) throw new Error("内核明确拒绝建档");
            const id = `20261004000000-vcf${String(state.creates.length).padStart(4, "0")}`;
            const requestId = body.markdown.match(/custom-lvct-(?:vcard|contact-draft)="([^"]+)"/)?.[1];
            const name = body.path.split("/").at(-1);
            state.docs.set(id, { id, requestId, name });
            if (state.loseCreate) return new Promise(() => {});
            return id;
        }
        if (route === "/api/av/getAttributeViewItemIDsByBoundIDs") {
            return Object.fromEntries(body.blockIDs.flatMap((docId) => {
                const row = [...state.rows.values()].find((candidate) => candidate.cells[0].value.block.id === docId);
                return row ? [[docId, row.id]] : [];
            }));
        }
        if (route === "/api/av/addAttributeViewBlocks") {
            state.binds.push(body);
            if (state.failBind) throw new Error("绑定失败");
            if (state.skipBind) return null;
            for (const source of body.srcs) {
                const itemId = `row-${source.id}`;
                state.rows.set(itemId, { id: itemId, cells: [{ valueType: "block", value: {
                    type: "block", keyID: "name", block: { id: source.id, content: source.content },
                } }] });
            }
            if (state.loseBind) return new Promise(() => {});
            return null;
        }
        if (route === "/api/av/setAttributeViewBlockAttr") {
            state.writes.push(body);
            if (state.failField) throw new Error("字段失败");
            const row = state.rows.get(body.itemID);
            if (!row) throw new Error("字段目标不存在");
            const spec = FIELD_SPECS.find((field) => field.key === body.keyID);
            row.cells = row.cells.filter((cell) => cell.value.keyID !== body.keyID);
            row.cells.push({ valueType: spec.type, value: { type: spec.type, keyID: body.keyID, ...body.value } });
            return null;
        }
        throw new Error(`vCard 夹具拒绝 ${route}`);
    };
    state.entries = (name = "稳定人物", fields = {}) => {
        const draft = { ...emptyDraft(), name, ...fields };
        return [{ planIndex: 0, plan: { draft, contact: { ...draft }, duplicate: false } }];
    };
    state.sameName = (name) => state.rows.set("row-other", { id: "row-other", cells: [{ valueType: "block", value: {
        type: "block", keyID: "name", block: { id: "20261004000000-other01", content: name },
    } }] });
    return state;
}

export async function runVcardRegression({ test, assert, kernel, settings, fixture, until, button }) {
    await test("vCard 批量选择非同名项保留逐卡确认的同名选择", async () => {
        const state = configureVcardKernel(kernel, settings);
        state.sameName("手动确认同名");
        const app = mount(VCardDialog, { target: fixture, props: { settings, onImported() {}, onClose() {} } });
        try {
            const source = ["手动确认同名", "批量候选甲", "批量候选乙"].map((name) => `BEGIN:VCARD\nVERSION:3.0\nFN:${name}\nEND:VCARD`).join("\n");
            const transfer = new DataTransfer();
            transfer.items.add(new File([source], "bulk-selection.vcf", { type: "text/vcard" }));
            const file = fixture.querySelector('input[type="file"]');
            file.files = transfer.files;
            file.dispatchEvent(new Event("change", { bubbles: true }));
            await until(() => fixture.querySelectorAll(".lvct-vcard__card").length === 3, "批量选择预览未出现");
            const cards = [...fixture.querySelectorAll('.lvct-vcard__card input[type="checkbox"]')];
            const all = fixture.querySelector('.lvct-import__row--head input[type="checkbox"]');
            assert(!cards[0].checked && cards[1].checked && cards[2].checked, "初始同名与非同名选择不正确");
            cards[0].click();
            cards[1].click();
            await until(() => cards[0].checked && !cards[1].checked && !all.checked, "手动逐卡选择未就绪");
            all.click();
            await until(() => cards[1].checked && cards[2].checked, "批量勾选未选中非同名项");
            assert(cards[0].checked, "批量勾选非同名项清除了已确认的同名选择");
            await until(() => all.checked && fixture.textContent.includes("导入为联系人（3）"), "批量勾选后的总数不正确");
            all.click();
            await until(() => !cards[1].checked && !cards[2].checked, "批量取消未取消非同名项");
            assert(cards[0].checked && fixture.textContent.includes("导入为联系人（1）"), "批量取消非同名项清除了手动同名选择");
            cards[0].click();
            await until(() => !cards[0].checked, "手动取消同名项未生效");
            all.click();
            await until(() => cards[1].checked && cards[2].checked, "再次批量勾选未恢复非同名项");
            assert(!cards[0].checked && state.creates.length === 0 && state.binds.length === 0 && state.writes.length === 0, "批量选择自动确认同名项或提前写入");
        } finally { await unmount(app); }
    });
    await test("vCard 批量选择状态仅计算可选非同名项，待核实卡片不参与全选", async () => {
        const state = configureVcardKernel(kernel, settings);
        state.docs.set("20261004000000-pend001", { id: "20261004000000-pend001", name: "待核实原文档", requestId: "unbound-source" });
        const app = mount(VCardDialog, { target: fixture, props: { settings, onImported() {}, onClose() {} } });
        try {
            const load = async (names) => {
                const source = names.map((name) => `BEGIN:VCARD\nVERSION:3.0\nFN:${name}\nEND:VCARD`).join("\n");
                const transfer = new DataTransfer();
                transfer.items.add(new File([source], "bulk-eligible.vcf", { type: "text/vcard" }));
                const file = fixture.querySelector('input[type="file"]');
                file.files = transfer.files;
                file.dispatchEvent(new Event("change", { bubbles: true }));
                await until(() => fixture.querySelectorAll(".lvct-vcard__card").length === names.length, "待核实卡片预览未出现");
            };
            await load(["可批量选择", "待核实原文档"]);
            const cards = [...fixture.querySelectorAll('.lvct-vcard__card input[type="checkbox"]')];
            const all = fixture.querySelector('.lvct-import__row--head input[type="checkbox"]');
            assert(cards[0].checked && !cards[1].checked && cards[1].disabled, "待核实卡片未被隔离");
            assert(all.checked && !all.disabled, "已选全部可选项时，全选状态被待核实卡片干扰");
            all.click();
            await until(() => !cards[0].checked && !all.checked, "批量取消未更新可选项");
            all.click();
            await until(() => cards[0].checked && all.checked, "批量恢复未更新可选项");
            assert(!cards[1].checked && cards[1].disabled, "批量操作选中了待核实卡片");
            await load(["待核实原文档"]);
            const unavailableAll = fixture.querySelector('.lvct-import__row--head input[type="checkbox"]');
            assert(unavailableAll.disabled && !unavailableAll.checked && state.creates.length === 0 && state.writes.length === 0, "没有可选项时仍可全选或提前写入");
        } finally { await unmount(app); }
    });
    await test("vCard 多联系方式预览选择主值后按单值写入，未知重试沿用已选草稿", async () => {
        const state = configureVcardKernel(kernel, settings);
        state.failField = true;
        const app = mount(VCardDialog, { target: fixture, props: { settings, onImported() {}, onClose() {} } });
        try {
            const fileInput = fixture.querySelector('input[type="file"]');
            const transfer = new DataTransfer();
            transfer.items.add(new File(["BEGIN:VCARD\nVERSION:3.0\nFN:主值选择样例\nTEL:11001\nTEL:11002\nEMAIL:first@example.test\nEMAIL:second@example.test\nURL:https://first.example.test\nURL:https://second.example.test\nEND:VCARD"], "primary.vcf", { type: "text/vcard" }));
            fileInput.files = transfer.files;
            fileInput.dispatchEvent(new Event("change", { bubbles: true }));
            await until(() => fixture.querySelector('select[aria-label="第 1 张卡片的电话主值"]'), "多联系方式主值选择未显示");
            const phone = fixture.querySelector('select[aria-label="第 1 张卡片的电话主值"]');
            assert(phone.value === "-1" && phone.options[0].textContent.includes("11001 / 11002"), "默认兼容合并值发生变化");
            const selected = fixture.querySelector('.lvct-import__row:not(.lvct-import__row--head) input[type="checkbox"]');
            assert(selected?.checked, "非同名卡片未默认勾选");
            for (const field of ["电话", "邮箱", "网址"]) {
                const select = fixture.querySelector(`select[aria-label="第 1 张卡片的${field}主值"]`);
                select.click();
                assert(selected.checked, "点击主值选择框切换了卡片勾选");
                select.value = "1";
                select.dispatchEvent(new Event("change", { bubbles: true }));
            }
            await until(() => fixture.textContent.includes("TEL → phone：11002"), "映射预览未更新为已选主值");
            assert(fixture.textContent.includes("EMAIL → email：second@example.test") && fixture.textContent.includes("URL → website：https://second.example.test"), "邮箱或网址映射仍展示旧主值");
            selected.click();
            await until(() => [...fixture.querySelectorAll("button")].some((node) => node.textContent.trim() === "导入为联系人（0）" && node.disabled), "取消卡片勾选后仍可导入");
            selected.click();
            await until(() => [...fixture.querySelectorAll("button")].some((node) => node.textContent.trim() === "导入为联系人（1）" && !node.disabled), "重新勾选卡片未保留选择");
            assert(phone.value === "1", "取消并重选卡片丢失本卡片主值");
            button("导入为联系人（1）").click();
            await until(() => fixture.textContent.includes("? 待核对（1）"), "字段失败未保留原请求");
            assert(fixture.textContent.includes("未写入 TEL #1：11001") && fixture.textContent.includes("未写入 EMAIL #1：first@example.test") && fixture.textContent.includes("未写入 URL #1：https://first.example.test"), "导入报告未保留未写入联系方式");
            assert(state.writes.some((write) => write.value.phone?.content === "11002") && state.writes.some((write) => write.value.email?.content === "second@example.test") && state.writes.some((write) => write.value.url?.content === "https://second.example.test"), "导入仍写入旧合并值或首项");
            state.failField = false;
            [...fixture.querySelectorAll("button")].find((node) => node.textContent.includes("核对名册并重试")).click();
            await until(() => fixture.textContent.includes("✓ 成功（1）"), "已选主值未通过原请求重试");
            assert(fixture.textContent.includes("未写入 TEL #1：11001") && fixture.textContent.includes("未写入 EMAIL #1：first@example.test") && fixture.textContent.includes("未写入 URL #1：https://first.example.test"), "成功重试后丢失原未写入项说明");
            assert(state.creates.length === 1 && state.writes.every((write) => !JSON.stringify(write).includes("11001 / 11002") && !JSON.stringify(write).includes("first@example.test")), "重试丢失主值选择或重复建档");
        } finally {
            await unmount(app);
            fixture.replaceChildren();
        }
    });
    await test("vCard 多联系方式默认保留合并电话，切换文件后重置主值选择", async () => {
        const state = configureVcardKernel(kernel, settings);
        const app = mount(VCardDialog, { target: fixture, props: { settings, onImported() {}, onClose() {} } });
        const source = (name, prefix) => `BEGIN:VCARD\nVERSION:3.0\nFN:${name}\nTEL:${prefix}001\nTEL:${prefix}002\nEMAIL:first-${prefix}@example.test\nEMAIL:second-${prefix}@example.test\nURL:https://first-${prefix}.example.test\nURL:https://second-${prefix}.example.test\nEND:VCARD`;
        const upload = (text) => {
            const fileInput = fixture.querySelector('input[type="file"]');
            const transfer = new DataTransfer();
            transfer.items.add(new File([text], "replace.vcf", { type: "text/vcard" }));
            fileInput.files = transfer.files;
            fileInput.dispatchEvent(new Event("change", { bubbles: true }));
        };
        try {
            upload(source("文件甲", "120"));
            await until(() => fixture.querySelector('select[aria-label="第 1 张卡片的电话主值"]'), "第一文件多值计划未就绪");
            const firstPhone = fixture.querySelector('select[aria-label="第 1 张卡片的电话主值"]');
            firstPhone.value = "1";
            firstPhone.dispatchEvent(new Event("change", { bubbles: true }));
            await until(() => fixture.textContent.includes("TEL → phone：120002"), "第一文件选择未更新");
            // 调用真实文件 change 路径，确认同下标的新文件不会复用旧文件选择。
            upload(source("文件乙", "130"));
            await until(() => fixture.textContent.includes("文件乙") && !fixture.textContent.includes("文件甲"), "切换文件后旧计划仍显示");
            const phone = fixture.querySelector('select[aria-label="第 1 张卡片的电话主值"]');
            const email = fixture.querySelector('select[aria-label="第 1 张卡片的邮箱主值"]');
            const website = fixture.querySelector('select[aria-label="第 1 张卡片的网址主值"]');
            assert(phone.value === "-1" && email.value === "0" && website.value === "0", `新文件复用了旧主值下标：${phone.value}/${email.value}/${website.value}`);
            assert(fixture.textContent.includes("TEL → phone：130001 / 130002"), "默认合并电话映射已退化");
            button("导入为联系人（1）").click();
            await until(() => fixture.textContent.includes("✓ 成功（1）"), "新文件默认值未导入");
            assert(fixture.textContent.includes("多个电话合并为一个文本字段") && fixture.textContent.includes("未写入 EMAIL #2：second-130@example.test") && fixture.textContent.includes("未写入 URL #2：https://second-130.example.test"), "默认导入报告未说明合并电话与未写入邮箱/网址");
            assert(state.creates.length === 1 && state.creates[0].path.endsWith("/文件乙"), "旧文件被意外创建");
            assert(state.writes.some((write) => write.value.phone?.content === "130001 / 130002"), "默认多电话未按原兼容值写入");
            assert(state.writes.some((write) => write.value.email?.content === "first-130@example.test") && state.writes.some((write) => write.value.url?.content === "https://first-130.example.test"), "默认邮箱或网址主值错误");
            assert(state.writes.every((write) => !JSON.stringify(write).includes("120")), "新文件导入串入旧文件值");
        } finally {
            await unmount(app);
            fixture.replaceChildren();
        }
    });
    await test("AG-P0-014 vCard 创建响应丢失，按请求标记核实原文档", async () => {
        const state = configureVcardKernel(kernel, settings);
        state.loseCreate = true;
        const entries = state.entries();
        const originalTimeout = kernelConfig.timeoutMs;
        kernelConfig.timeoutMs = 50;
        try {
            const report = await importVcfContacts(settings, entries);
            assert(report.imported === 1 && report.failed.length === 0, "已创建的原请求未核实");
            assert(report.results[0].checkpoint?.state === "verified" && report.results[0].checkpoint?.itemId, "报告未保留文档/行断点");
            const repeated = await retryVcfContacts(settings, entries);
            assert(repeated[0].status === "imported" && state.creates.length === 1 && state.binds.length === 1, "重复核实新增了文档或绑定行");
        } finally { kernelConfig.timeoutMs = originalTimeout; }
    });
    await test("AG-P0-014 vCard 未核实创建保持 unknown，重试不再次建档", async () => {
        const state = configureVcardKernel(kernel, settings);
        state.hideMarker = true;
        const entries = state.entries();
        const report = await importVcfContacts(settings, entries);
        const retry = await retryVcfContacts(settings, entries);
        assert(report.unknown.length === 1 && report.failed.length === 0 && retry[0].status === "unknown", "未知结果被当成确定失败");
        assert(state.creates.length === 1 && state.binds.length === 0 && report.results[0].checkpoint?.docId, "未知结果重建或丢失原文档 ID");
        state.hideMarker = false;
        const verified = await retryVcfContacts(settings, entries);
        assert(verified[0].status === "imported" && state.creates.length === 1, "恢复可读后未复用原文档");
    });
    await test("AG-P0-014 vCard 未绑定文档与同名冲突，重试只补原请求人物", async () => {
        const state = configureVcardKernel(kernel, settings);
        state.failBind = true;
        const entries = state.entries("同名人物", { phone: "13900001234" });
        const report = await importVcfContacts(settings, entries);
        assert(report.unknown.length === 1 && report.results[0].checkpoint?.docId, "绑定失败未保留原文档");
        state.sameName("同名人物");
        state.failBind = false;
        const retry = await retryVcfContacts(settings, entries);
        assert(retry[0].status === "imported" && state.creates.length === 1, "未绑定文档重试又创建人物");
        assert(state.writes.length === 1 && state.writes[0].itemID !== "row-other", "同名人物被错误补写");
    });
    await test("AG-P0-014 vCard 绑定响应丢失，回读原行后零重复绑定", async () => {
        const state = configureVcardKernel(kernel, settings);
        state.loseBind = true;
        const entries = state.entries("绑定响应丢失", { birthday: "1960-03-05", isLunar: true, tags: ["测试"] });
        const originalTimeout = kernelConfig.timeoutMs;
        kernelConfig.timeoutMs = 50;
        try {
            const report = await importVcfContacts(settings, entries);
            assert(report.unknown.length === 1 && state.rows.size === 1, "绑定丢失场景未建立");
            state.loseBind = false;
            const retry = await retryVcfContacts(settings, entries);
            assert(retry[0].status === "imported" && state.binds.length === 1 && state.creates.length === 1, "绑定丢失重建了行或文档");
            const writes = state.writes.length;
            await retryVcfContacts(settings, entries);
            assert(state.writes.length === writes, "字段已核实仍重复写入");
        } finally { kernelConfig.timeoutMs = originalTimeout; }
    });
    await test("AG-P0-014 vCard 明确拒绝可重试同请求，变更输入或锚点停止写入", async () => {
        const state = configureVcardKernel(kernel, settings);
        const entries = state.entries("明确拒绝", { phone: "13900001234" });
        state.rejectCreate = true;
        const report = await importVcfContacts(settings, entries);
        assert(report.failed.length === 1 && report.results[0].checkpoint?.state === "rejected", "明确拒绝未保留安全重试断点");
        const requestId = entries[0].plan.checkpoint.requestId;
        state.rejectCreate = false;
        const retry = await retryVcfContacts(settings, entries);
        assert(retry[0].status === "imported" && entries[0].plan.checkpoint.requestId === requestId, "明确拒绝重试未复用请求");
        const writes = state.writes.length;
        entries[0].plan.draft.phone = "13800000000";
        const changed = await retryVcfContacts(settings, entries);
        entries[0].plan.draft.phone = "13900001234";
        const changedAnchor = await retryVcfContacts({ ...settings, dbBlockId: "20261004000000-other01" }, entries);
        assert(changed[0].status === "unknown" && changedAnchor[0].status === "unknown", "变更输入/锚点继续复用原断点");
        assert(state.creates.length === 2 && state.writes.length === writes, "不一致请求进行了写入");
    });
    await test("AG-P0-014 vCard 请求重复标记与回读失败，保留 unknown 不自动选人", async () => {
        const state = configureVcardKernel(kernel, settings);
        const entries = state.entries();
        state.duplicateMarker = true;
        const report = await importVcfContacts(settings, entries);
        assert(report.unknown.length === 1 && state.binds.length === 0, "重复请求标记仍选择首个文档");
        state.duplicateMarker = false;
        state.failLookup = true;
        const retry = await retryVcfContacts(settings, entries);
        assert(retry[0].status === "unknown" && state.creates.length === 1, "回读失败被当作失败重建");
    });
    await test("AG-P0-014 vCard 字段失败按稳定 ID 补写，同名旧报告拒绝盲补", async () => {
        const state = configureVcardKernel(kernel, settings);
        const entries = state.entries("字段同名", { phone: "13900001234" });
        state.failField = true;
        const report = await importVcfContacts(settings, entries);
        assert(report.results[0].failedFields?.[0] === "phone", "字段失败未保留字段断点");
        state.sameName("字段同名");
        state.failField = false;
        const retry = await retryVcfContacts(settings, [{ ...entries[0], failedFields: report.results[0].failedFields }]);
        assert(retry[0].status === "imported" && state.writes.every((write) => write.itemID !== "row-other"), "字段重试选错同名人物");
        const writes = state.writes.length;
        const legacy = state.entries("字段同名", { phone: "13800000000" });
        const refused = await retryVcfContacts(settings, [{ ...legacy[0], failedFields: ["phone"] }]);
        assert(refused[0].status === "unknown" && state.writes.length === writes, "无断点旧报告按同名补写");
    });
    await test("AG-P0-014 vCard 同计划并发导入串行，只有一篇文档与一行", async () => {
        const state = configureVcardKernel(kernel, settings);
        const entries = state.entries();
        const reports = await Promise.all([importVcfContacts(settings, entries), importVcfContacts(settings, entries)]);
        assert(reports.every((report) => report.imported === 1), "串行导入未完成核实");
        assert(state.creates.length === 1 && state.binds.length === 1, "同计划并发重复建档或绑定");
    });
    await test("AG-P0-014 vCard 待核对界面保留请求 ID，关闭守卫与诊断下载可核对", async () => {
        const state = configureVcardKernel(kernel, settings);
        state.hideMarker = true;
        let closed = 0;
        let downloaded;
        let downloads = 0;
        const originalCreate = URL.createObjectURL;
        const originalRevoke = URL.revokeObjectURL;
        const originalClick = HTMLAnchorElement.prototype.click;
        URL.createObjectURL = (blob) => { downloaded = blob; return "blob:vcard-diagnostic"; };
        URL.revokeObjectURL = () => {};
        HTMLAnchorElement.prototype.click = function () { downloads += 1; };
        const app = mount(VCardDialog, { target: fixture, props: { settings, onImported() {}, onClose() { closed += 1; } } });
        try {
            const fileInput = fixture.querySelector('input[type="file"]');
            const transfer = new DataTransfer();
            transfer.items.add(new File(["BEGIN:VCARD\nFN:界面待核对\nTEL:13900001234\nEND:VCARD"], "review.vcf", { type: "text/vcard" }));
            fileInput.files = transfer.files;
            fileInput.dispatchEvent(new Event("change", { bubbles: true }));
            await until(() => fixture.textContent.includes("导入为联系人（1）"), "导入计划未就绪");
            button("导入为联系人（1）").click();
            await until(() => fixture.textContent.includes("? 待核对（1）"), "待核对报告未显示");
            const requestId = state.creates[0].markdown.match(/custom-lvct-vcard="([^"]+)"/)?.[1];
            assert(fixture.textContent.includes(requestId) && fixture.textContent.includes("只保留在本窗口"), "未知报告缺少稳定请求或窗口边界说明");
            button("保存诊断信息").click();
            const diagnostic = JSON.parse(await downloaded.text());
            assert(downloads === 1 && diagnostic.results[0].checkpoint.requestId === requestId, "诊断缺少原请求 ID");
            assert(!JSON.stringify(diagnostic).includes("13900001234"), "诊断意外包含联系方式");
            button("返回联系人").click();
            await until(() => document.querySelector('.lvct-closeguard'), "未完成断点关闭未要求确认");
            assert(closed === 0, "确认前已经关闭");
            document.querySelector('.lvct-closeguard button[data-choice="cancel"]').click();
            await until(() => !document.querySelector('.lvct-closeguard'), "取消未恢复原报告");
            assert(closed === 0 && fixture.textContent.includes(requestId), "取消丢失原请求报告");
            state.hideMarker = false;
            state.lookupGate = new Promise((resolve) => { state.releaseLookup = resolve; });
            [...fixture.querySelectorAll("button")].find((node) => node.textContent.includes("核对名册并重试")).click();
            await until(() => state.lookupStarted, "重试没有进入核实名册阶段");
            assert(button("返回联系人").disabled && [...fixture.querySelectorAll(".lvct-form__actions button")].find((node) => node.textContent.trim() === "关闭")?.disabled,
                "核对重试期间离开按钮仍可点击，但会被关闭守卫静默阻止");
            state.releaseLookup?.();
            await until(() => fixture.textContent.includes("✓ 成功（1）"), "恢复核实未完成导入");
            assert(state.creates.length === 1, "界面重试重复建档");
        } finally {
            document.querySelector('.lvct-closeguard button[data-choice="cancel"]')?.click();
            await unmount(app);
            fixture.replaceChildren();
            URL.createObjectURL = originalCreate;
            URL.revokeObjectURL = originalRevoke;
            HTMLAnchorElement.prototype.click = originalClick;
        }
    });
}
