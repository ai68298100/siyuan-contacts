import { mount, unmount, tick } from "svelte";
import PersonEditDialog from "../../../src/components/people/PersonEditDialog.svelte";
import ProfileCompletionDialog from "../../../src/components/people/ProfileCompletionDialog.svelte";
import AddPersonDialog from "../../../src/components/people/AddPersonDialog.svelte";
import { emptyDraft } from "../../../src/domain/person";
import { kernelConfig } from "../../../src/api/client";
import { configureImportKernel } from "./import-regression.js";
import { configureVcardKernel } from "./vcard-regression.js";

function existingPerson(kernel, settings, index = 71) {
    const state = configureImportKernel(kernel, settings);
    const docId = state.addDoc(index, `保存边界人物${index}`);
    const itemId = state.addRow(docId);
    return { state, person: { ...emptyDraft(), name: `保存边界人物${index}`, docId, itemId, relatedItemIds: [] } };
}
const field = (root, label) => [...root.querySelectorAll("label")].find((node) => node.querySelector("span")?.textContent.trim() === label)?.querySelector("input,select,textarea");
const phoneValue = (state, person) => state.rows.get(person.itemId)?.cells.find((cell) => cell.value.keyID === "phone")?.value.phone?.content;
const saveButton = (root) => root.querySelector('.lvct-form > .lvct-form__actions .b3-button--primary');

export async function runFormSaveBoundariesRegression({ test, assert, kernel, settings, fixture, until, button, input }) {
    await test("表单保存边界：识别预填与原人物分离，直接保存写入而取消仍有守卫", async () => {
        const { state, person } = existingPerson(kernel, settings);
        let closed = 0;
        const app = mount(PersonEditDialog, { target: fixture, props: {
            settings, person, initialPatch: { phone: "13800000071", tags: ["识别预填"] },
            onLoadRelationshipLabels: async () => ({ selfDocId: "", record: null }), onSaved() {}, onClose() { closed++; },
        } });
        try {
            await until(() => saveButton(fixture) && !saveButton(fixture).disabled, "预填编辑未就绪");
            assert(field(fixture, "电话").value === "13800000071", "识别预填未进入草稿");
            assert(person.phone === "" && person.tags.length === 0, "预填修改了原人物基线");
            button("取消").click();
            await until(() => document.querySelector('.lvct-closeguard [data-choice="cancel"]'), "预填草稿关闭未给出确认");
            document.querySelector('.lvct-closeguard [data-choice="cancel"]').click();
            await tick();
            assert(closed === 0 && field(fixture, "电话").value === "13800000071", "取消离开丢失预填草稿");
            saveButton(fixture).click();
            await until(() => closed === 1, "预填编辑未完成保存");
            assert(phoneValue(state, person) === "13800000071", "未手工再编辑时预填被当成已保存，实际没有写入");
            assert(state.writes.some((write) => write.keyID === "tags" && write.value.mSelect?.some((tag) => tag.content === "识别预填")), "预填标签未写入");
        } finally { await unmount(app); }
    });

    await test("表单保存边界：基础资料成功而称谓失败后，再修改基础字段仍会保存", async () => {
        const { state, person } = existingPerson(kernel, settings, 72);
        let relationAttempts = 0, closed = 0;
        const app = mount(PersonEditDialog, { target: fixture, props: {
            settings, person,
            onLoadRelationshipLabels: async () => ({ selfDocId: "20261017000000-self001", record: null }),
            onSaveRelationshipLabels: async (personDocId, selfDocId, labels) => {
                if (++relationAttempts === 1) throw new Error("称谓首次保存失败");
                return { id: "20261017000000-labe071", personDocId, selfDocId, labels, createdAt: 1, updatedAt: 2 };
            }, onSaved() {}, onClose() { closed++; },
        } });
        try {
            await until(() => saveButton(fixture) && !saveButton(fixture).disabled, "复合编辑未就绪");
            input(field(fixture, "电话"), "13800000072");
            input(fixture.querySelector('.lvct-person-edit__profile input[maxlength="1600"]'), "同事");
            await tick(); saveButton(fixture).click();
            await until(() => fixture.textContent.includes("称谓首次保存失败") && !saveButton(fixture).disabled, "首次部分保存失败未保留编辑器");
            assert(phoneValue(state, person) === "13800000072" && closed === 0, "基础字段未先保存或部分失败关闭了表单");
            input(field(fixture, "电话"), "13900000072");
            await tick(); saveButton(fixture).click();
            await until(() => closed === 1, "部分失败后再次保存未完成");
            assert(phoneValue(state, person) === "13900000072", "永久 saved 标记跳过了成功保存后的新基础修改");
        } finally { await unmount(app); }
    });

    await test("表单保存边界：补录邮箱校验失败可修正，未发请求前不锁住输入", async () => {
        const { state, person } = existingPerson(kernel, settings, 73);
        const app = mount(ProfileCompletionDialog, { target: fixture, props: { settings, people: [person], onClose() {} } });
        try {
            await until(() => fixture.querySelector('input[type="email"]'), "补录邮箱未显示");
            input(fixture.querySelector('input[type="email"]'), "错误邮箱");
            await tick(); button("保存并下一位").click();
            await until(() => fixture.textContent.includes("邮箱格式不正确"), "补录没有报告邮箱校验失败");
            const email = fixture.querySelector('input[type="email"]');
            assert(!email.disabled && state.writes.length === 0, "请求前校验失败已锁定输入或发送写入");
            input(email, "fixed73@example.test");
            await tick(); button("保存并下一位").click();
            await until(() => fixture.textContent.includes("保存 1 人，跳过 0 人"), "修正邮箱后无法继续补录");
            assert(state.rows.get(person.itemId).cells.some((cell) => cell.value.email?.content === "fixed73@example.test"), "修正后的邮箱未写入");
        } finally { await unmount(app); }
    });

    await test("表单保存边界：补录真正未知请求保持原输入锁定，核实后不重复发送", async () => {
        const { state, person } = existingPerson(kernel, settings, 74);
        const base = kernel.handler;
        let unknown = true;
        kernel.handler = async (route, body) => {
            if (route === "/api/av/setAttributeViewBlockAttr" && body.keyID === "phone" && unknown) {
                await base(route, body);
                state.failMappings = true;
                return new Promise(() => {});
            }
            return base(route, body);
        };
        const originalTimeout = kernelConfig.timeoutMs;
        kernelConfig.timeoutMs = 50;
        const app = mount(ProfileCompletionDialog, { target: fixture, props: { settings, people: [person], onClose() {} } });
        try {
            await until(() => fixture.querySelector('input[type="tel"]'), "未知补录电话未显示");
            input(fixture.querySelector('input[type="tel"]'), "13800000074");
            await tick(); button("保存并下一位").click();
            await until(() => fixture.textContent.includes("字段尚未完成"), "真实未知写入未保留待核实状态");
            assert(fixture.querySelector('input[type="tel"]').disabled && fixture.querySelector('input[type="tel"]').value === "13800000074", "未知写入错误解锁或更改原请求输入");
            unknown = false; state.failMappings = false;
            button("核实并重试未完成字段").click();
            await until(() => fixture.textContent.includes("保存 1 人，跳过 0 人"), "未知写入未只读核实原字段");
            assert(state.writes.filter((write) => write.keyID === "phone").length === 1, "未知写入核实重发了已保存字段");
        } finally { kernelConfig.timeoutMs = originalTimeout; await unmount(app); }
    });

    await test("表单保存边界：人物已创建而补充资料失败后锁基础字段，只续写原人物", async () => {
        const state = configureVcardKernel(kernel, settings);
        let extendedAttempts = 0, closed = 0;
        const details = [], created = [];
        const app = mount(AddPersonDialog, { target: fixture, props: {
            settings, initial: { ...emptyDraft(), name: "创建后续写边界", phone: "13800000075", group: "同事", tags: ["原标签"] },
            onSaveExtended: async (person, detail) => {
                details.push({ person: structuredClone(person), detail: structuredClone(detail) });
                if (++extendedAttempts === 1) throw new Error("补充资料首次保存失败");
            }, onCreated: (person) => created.push(structuredClone(person)), onClose() { closed++; },
        } });
        try {
            button("补充资料（可选）").click();
            await tick(); input(fixture.querySelector('textarea[maxlength="5000"]'), "重试前的补充资料");
            await tick(); saveButton(fixture).click();
            await until(() => fixture.textContent.includes("联系人已创建，但补充资料保存失败") && !saveButton(fixture).disabled, "创建成功补充失败没有保留窗口");
            const baseFields = fixture.querySelector("fieldset");
            assert(baseFields.disabled && [...baseFields.querySelectorAll("input,select,button")].every((node) => node.matches(":disabled")), "已创建人物的基础资料仍可编辑但重试不会保存");
            assert(button("粘贴并识别").disabled, "已创建人物仍可识别回填基础字段");
            assert(fixture.textContent.includes("联系人已创建，仅继续保存补充资料"), "未说明人物已创建及基础资料后续编辑出口");
            assert(fixture.querySelector('textarea[maxlength="5000"]').value === "重试前的补充资料" && !fixture.querySelector('textarea[maxlength="5000"]').disabled, "补充草稿被锁定或丢失");
            input(fixture.querySelector('textarea[maxlength="5000"]'), "重试后补充资料");
            await tick(); saveButton(fixture).click();
            await until(() => closed === 1, "补充资料重试未完成");
            assert(state.creates.length === 1 && created.length === 1 && details.length === 2, "补充重试重复创建或错误完成回调");
            assert(details[0].person.docId === details[1].person.docId && details[1].detail.note === "重试后补充资料", "重试换人物或丢补充修改");
        } finally { await unmount(app); }
    });
}
