import { mount, unmount } from "svelte";
import TemplateManager from "../../../src/components/people/TemplateManager.svelte";
import { listTemplates, saveTemplates } from "../../../src/services/templates";
import { mergeTemplatesStore, TEMPLATES_STORAGE_KEY } from "../../../src/data/templates";

const clone = (value) => JSON.parse(JSON.stringify(value));
const namedButton = (root, label) => [...root.querySelectorAll("button")].find((node) => node.textContent.trim() === label);
const input = (element, value) => { element.value = value; element.dispatchEvent(new Event("input", { bubbles: true })); };

function memoryTemplates(initial) {
    let stored = clone(initial);
    let writes = 0;
    let failRead = false;
    let failReply = false;
    return {
        writes: () => writes,
        failNextRead: () => { failRead = true; },
        failNextReply: () => { failReply = true; },
        plugin: {
            async loadData(key) {
                if (key !== TEMPLATES_STORAGE_KEY) throw new Error(`模板夹具拒绝读取 ${key}`);
                if (failRead) { failRead = false; throw new Error("模板核实读取中断"); }
                return clone(stored);
            },
            async saveData(key, value) {
                if (key !== TEMPLATES_STORAGE_KEY) throw new Error(`模板夹具拒绝写入 ${key}`);
                writes += 1;
                stored = clone(value);
                if (failReply) { failReply = false; throw new Error("模板保存回应中断"); }
            },
        },
    };
}

export async function runTemplateSaveRegression({ test, assert, fixture, until }) {
    await test("模板保存基线：另一编辑窗口新增后旧草稿冲突，重读对照、取消放弃及新基线重编", async () => {
        const store = memoryTemplates({ schemaVersion: 1, templates: [{ id: "base", name: "已有模板", content: "原备注" }] });
        const left = document.createElement("div");
        const right = document.createElement("div");
        fixture.append(left, right);
        const baseline = await listTemplates(store.plugin);
        const props = { templates: baseline, onSave: (draft, expected) => saveTemplates(store.plugin, draft, expected), onReload: () => listTemplates(store.plugin), onClose() {} };
        const first = mount(TemplateManager, { target: left, props });
        const second = mount(TemplateManager, { target: right, props });
        const originalConfirm = window.confirm;
        let confirmAnswer = false;
        window.confirm = () => confirmAnswer;
        try {
            namedButton(left, "＋ 新增模板").click();
            await until(() => left.querySelector('input[aria-label="模板 2 名称"]'), "第一窗口没有新模板行");
            input(left.querySelector('input[aria-label="模板 2 名称"]'), "其他窗口新增");
            input(left.querySelector('textarea[aria-label="模板 2 内容"]'), "不能丢的新增原文");
            namedButton(left, "保存模板").click();
            await until(() => left.textContent.includes("模板已保存"), "第一窗口没有完成保存");
            input(right.querySelector('textarea[aria-label="模板 1 内容"]'), "右侧尚未保存的修改");
            namedButton(right, "保存模板").click();
            await until(() => right.textContent.includes("本次未保存"), "旧窗口没有明确冲突反馈");
            assert(store.writes() === 1, "旧窗口冲突仍执行了写入");
            assert(right.querySelector('textarea[aria-label="模板 1 内容"]').value === "右侧尚未保存的修改", "冲突丢失草稿");
            namedButton(right, "重新读取当前版本").click();
            await until(() => right.textContent.includes("当前已保存版本（只读核对）"), "没有显示最新版本的只读对照");
            assert(right.querySelector('textarea[aria-label="当前版本模板 2 内容"]').value === "不能丢的新增原文", "重读遗漏并发新增");
            assert(right.querySelector('textarea[aria-label="模板 1 内容"]').value === "右侧尚未保存的修改", "只读核对重置了草稿");
            namedButton(right, "放弃草稿并载入当前版本").click();
            assert(right.querySelector('textarea[aria-label="模板 1 内容"]').value === "右侧尚未保存的修改", "取消放弃仍丢失草稿");
            assert(store.writes() === 1, "只读对照或取消操作写入了存储");
            confirmAnswer = true;
            namedButton(right, "放弃草稿并载入当前版本").click();
            await until(() => right.querySelector('input[aria-label="模板 2 名称"]')?.value === "其他窗口新增", "明确放弃后未载入当前版本");
            input(right.querySelector('textarea[aria-label="模板 1 内容"]'), "按最新版本重编");
            namedButton(right, "保存模板").click();
            await until(() => right.textContent.includes("模板已保存"), "重编后没有更新基线，仍无法保存");
            const saved = await listTemplates(store.plugin);
            assert(saved.length === 2 && saved[0].content === "按最新版本重编" && saved[1].content === "不能丢的新增原文", "重编覆盖了并发新增或未保存修改");
            assert(store.writes() === 2, "正常重编没有且仅有一次写入");
        } finally {
            window.confirm = originalConfirm;
            await unmount(first);
            await unmount(second);
        }
    });

    await test("模板未知保存：首次默认草稿保留，重读核实已应用目标，不重复写入且关闭无未保存警告", async () => {
        const store = memoryTemplates(null);
        let closed = 0;
        const instance = mount(TemplateManager, { target: fixture, props: {
            templates: await listTemplates(store.plugin),
            onSave: (draft, expected) => saveTemplates(store.plugin, draft, expected),
            onReload: () => listTemplates(store.plugin), onClose() { closed += 1; },
        } });
        try {
            input(fixture.querySelector('textarea[aria-label="模板 1 内容"]'), "未知保存的原意图\n第二段");
            store.failNextReply();
            namedButton(fixture, "保存模板").click();
            await until(() => fixture.textContent.includes("保存结果尚未核实"), "未知保存未明确提示");
            assert(fixture.querySelector('textarea[aria-label="模板 1 内容"]').value === "未知保存的原意图\n第二段", "未知保存后草稿丢失");
            assert(store.writes() === 1, "未知保存被自动重写");
            namedButton(fixture, "重新读取当前版本").click();
            await until(() => fixture.textContent.includes("当前草稿已保存"), "重读没有核实已应用目标");
            assert(store.writes() === 1 && !fixture.querySelector('[role="alert"]'), "核实重复写入或未清除未知提示");
            namedButton(fixture, "关闭").click();
            await until(() => closed === 1, "核实成功后仍当作未保存草稿阻止关闭");
            assert(!document.querySelector(".lvct-closeguard"), "已核实成功还弹出未保存守卫");
        } finally { await unmount(instance); }
    });

    await test("模板恢复冲突：重读失败保留草稿与基线，直接重试不能丢弃恢复模板", async () => {
        const base = [{ id: "base", name: "已有", content: "原内容" }];
        const store = memoryTemplates({ schemaVersion: 1, templates: base });
        const instance = mount(TemplateManager, { target: fixture, props: {
            templates: await listTemplates(store.plugin),
            onSave: (draft, expected) => saveTemplates(store.plugin, draft, expected),
            onReload: () => listTemplates(store.plugin), onClose() {},
        } });
        try {
            input(fixture.querySelector('textarea[aria-label="模板 1 内容"]'), "冲突草稿原文");
            await mergeTemplatesStore(store.plugin, [{ id: "restored", name: "恢复模板", content: "迁移带来的原文" }]);
            namedButton(fixture, "保存模板").click();
            await until(() => fixture.textContent.includes("本次未保存"), "恢复竞争没有提示冲突");
            store.failNextRead();
            namedButton(fixture, "重新读取当前版本").click();
            await until(() => fixture.textContent.includes("存储读取失败"), "核实读失败被当成空模板");
            assert(fixture.querySelector('textarea[aria-label="模板 1 内容"]').value === "冲突草稿原文", "核实失败丢失草稿");
            namedButton(fixture, "保存模板").click();
            await until(() => fixture.textContent.includes("本次未保存"), "重读失败悄悄换了基线，旧草稿被允许覆盖");
            assert(store.writes() === 1 && (await listTemplates(store.plugin)).some((item) => item.id === "restored"), "重读失败后的重试删除恢复模板");
        } finally { await unmount(instance); }
    });
}
