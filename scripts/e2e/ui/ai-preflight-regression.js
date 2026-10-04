import { mount, unmount, tick } from "svelte";
import CaptureDialog from "../../../src/components/capture/CaptureDialog.svelte";
import { aiFixtureSourceDocId as sourceDocId, configureAiKernel } from "./ai-extraction-fixture.js";

function findButton(root, label) {
    const element = [...root.querySelectorAll("button")].find((candidate) => candidate.textContent.includes(label));
    if (!element) throw new Error(`缺少按钮 ${label}`);
    return element;
}
function input(element, value) {
    element.value = value;
    element.dispatchEvent(new Event("input", { bubbles: true }));
}
async function waitFor(check, state) {
    for (let attempt = 0; attempt < 100; attempt += 1) {
        await tick();
        if (check()) return;
        await new Promise((resolveWait) => setTimeout(resolveWait, 20));
    }
    throw new Error(`AI 定向界面状态未达预期（${state?.failureCode || "无服务错误类别"}）`);
}
async function mounted(fixture, facade, operation) {
    fixture.innerHTML = "";
    const component = mount(CaptureDialog, { target: fixture, props: { facade, docId: sourceDocId, onClose: () => {} } });
    try {
        await waitFor(() => fixture.textContent.includes("新人员名单"));
        await operation();
    } finally { await unmount(component); }
}

export async function runAiPreflightRegression({ test, assert, kernel, settings, fixture }) {
    await test("AG-AI-001 AI 预检展示最终文本，取消零发送", async () => {
        const state = configureAiKernel(kernel, settings);
        await mounted(fixture, state.facade, async () => {
            findButton(fixture, "AI 分析本页").click();
            await waitFor(() => fixture.querySelector("textarea[readonly]"));
            const finalText = fixture.querySelector("textarea[readonly]").value;
            assert(finalText.includes(state.source) && fixture.textContent.includes("/api/ai/chatGPT"), "最终文本或端点不可见");
            assert(state.requests.every((request) => request.route !== "/api/ai/chatGPT"), "预检前已外发");
            findButton(fixture, "取消，不发送").click();
            await tick();
            assert(!fixture.querySelector("textarea[readonly]") && state.captures.length === 0, "取消保留可发送预检或发生写入");
        });
    });

    await test("AG-AI-001 原文变化使预检失效，确认只发送重建全文", async () => {
        const state = configureAiKernel(kernel, settings);
        await mounted(fixture, state.facade, async () => {
            findButton(fixture, "AI 分析本页").click();
            await waitFor(() => fixture.querySelector("textarea[readonly]"));
            input(fixture.querySelector("textarea:not([readonly])"), "仅样例甲选段");
            await tick();
            assert(findButton(fixture, "确认发送本次文本").disabled, "修改后仍可发送旧预检");
            findButton(fixture, "重新生成发送预览").click();
            await waitFor(() => fixture.querySelector("textarea[readonly]"));
            const expected = fixture.querySelector("textarea[readonly]").value;
            findButton(fixture, "确认发送本次文本").click();
            await waitFor(() => fixture.querySelector("[data-ai-kind]"), state);
            const sent = state.requests.find((request) => request.route === "/api/ai/chatGPT");
            assert(sent.body.msg === expected && !sent.body.msg.includes(state.source), "发送与最终预览不一致");
            assert(Object.keys(sent.body).join(",") === "msg", "附带隐藏上下文或猜测参数");
            assert(state.confirmedPreflight === state.preparedOriginal, "Svelte 深状态/弹窗状态改变了预检 WeakMap 身份");
        });
    });

    await test("AG-AI-002 字段范围未选 people 时不加入人物匹配候选", async () => {
        const state = configureAiKernel(kernel, settings);
        await mounted(fixture, state.facade, async () => {
            findButton(fixture, "AI 分析本页").click();
            await waitFor(() => fixture.querySelector("textarea[readonly]"));
            for (const field of fixture.querySelectorAll("fieldset input[type=checkbox]")) {
                if (field.value === "profile") continue;
                field.checked = false;
                field.dispatchEvent(new Event("change", { bubbles: true }));
            }
            await tick();
            findButton(fixture, "重新生成发送预览").click();
            await waitFor(() => fixture.querySelector("textarea[readonly]"));
            findButton(fixture, "确认发送本次文本").click();
            await waitFor(() => fixture.querySelector('[data-ai-kind="profile"]'), state);
            assert(!fixture.querySelector('[data-ai-kind="person"]') && !fixture.querySelector(".lvct-capture__list input[type=checkbox]"), "字段范围以外人物进入匹配或参与者");
        });
    });

    await test("AG-AI-001 清空原文不回退发送整篇文档", async () => {
        const state = configureAiKernel(kernel, settings);
        await mounted(fixture, state.facade, async () => {
            findButton(fixture, "AI 分析本页").click();
            await waitFor(() => fixture.querySelector("textarea[readonly]"));
            input(fixture.querySelector("textarea:not([readonly])"), "");
            await tick();
            findButton(fixture, "重新生成发送预览").click();
            await waitFor(() => fixture.textContent.includes("重新预览并明确确认"));
            assert(findButton(fixture, "确认发送本次文本").disabled, "清空原文后仍能发送");
            assert(state.requests.filter((request) => request.route === "/api/export/exportMdContent").length === 1, "清空后重新读取整篇正文");
            assert(state.requests.every((request) => request.route !== "/api/ai/chatGPT"), "清空后有外发");
        });
    });

    await test("AG-AI-002 候选不自动填事实，逐项接受/拒绝/编辑，新人草稿保留", async () => {
        const state = configureAiKernel(kernel, settings);
        await mounted(fixture, state.facade, async () => {
            findButton(fixture, "AI 分析本页").click();
            await waitFor(() => fixture.querySelector("textarea[readonly]"));
            findButton(fixture, "确认发送本次文本").click();
            await waitFor(() => fixture.querySelector('[data-ai-kind="person"]'), state);
            const participant = fixture.querySelector(".lvct-capture__list input[type=checkbox]");
            assert(participant && !participant.checked, "AI 匹配人物被自动勾选");
            const profile = fixture.querySelector('[data-ai-kind="profile"]');
            assert(profile?.textContent.includes("新人") && profile.textContent.includes("未绑定"), "新人资料草稿被丢弃");
            const personCandidate = fixture.querySelector('[data-ai-kind="person"]');
            findButton(personCandidate, "接受本项").click();
            await tick();
            assert(fixture.querySelector(".lvct-capture__list input[type=checkbox]").checked, "接受人物没有进入参与者");
            input(personCandidate.querySelector("input"), "编辑后的样例甲");
            await tick();
            assert(!fixture.querySelector(".lvct-capture__list input[type=checkbox]").checked, "编辑后旧接受仍留在参与者");
            const occasion = fixture.querySelector('[data-ai-kind="occasion"]');
            findButton(occasion, "接受本项").click();
            await tick();
            findButton(occasion, "拒绝本项").click();
            await tick();
            assert(state.captures.length === 0, "候选决定直接写入事实");
        });
    });

    await test("AG-AI-002 撤销草稿保留双链参与者、手动新人及场合输入", async () => {
        const state = configureAiKernel(kernel, settings);
        state.linked = [state.person];
        state.reply = JSON.stringify({ version: 2, people: ["样例甲", "新人"], place: "AI地点" });
        await mounted(fixture, state.facade, async () => {
            const names = [...fixture.querySelectorAll("input")].find((element) => element.placeholder.includes("王五"));
            input(names, "新人 另一个手动新人");
            await tick();
            findButton(fixture, "下一步").click();
            await tick();
            const placeLabel = [...fixture.querySelectorAll("label")].find((element) => element.querySelector("span")?.textContent === "地点（可选）");
            input(placeLabel.querySelector("input"), "手动地点");
            await tick();
            findButton(fixture, "返回识别").click();
            await tick();
            findButton(fixture, "AI 分析本页").click();
            await waitFor(() => fixture.querySelector("textarea[readonly]"));
            findButton(fixture, "确认发送本次文本").click();
            await waitFor(() => fixture.querySelectorAll('[data-ai-kind="person"]').length === 2, state);
            const [known, newcomer] = fixture.querySelectorAll('[data-ai-kind="person"]');
            findButton(known, "接受本项").click();
            await tick();
            input(known.querySelector("input"), "编辑后的已链接人物");
            await tick();
            assert(fixture.querySelector(".lvct-capture__list input[type=checkbox]").checked, "编辑 AI 提名撤销了原双链勾选");
            findButton(newcomer, "接受本项").click();
            await tick();
            findButton(newcomer, "拒绝本项").click();
            await tick();
            const remainingNames = [...fixture.querySelectorAll("input")].find((element) => element.placeholder.includes("王五"));
            assert(remainingNames.value === "新人 另一个手动新人", "拒绝 AI 新人删除了原手动名单");
            const occasion = fixture.querySelector('[data-ai-kind="occasion"]');
            findButton(occasion, "接受本项").click();
            await tick();
            findButton(occasion, "拒绝本项").click();
            await tick();
            findButton(fixture, "下一步").click();
            await tick();
            const restoredPlace = [...fixture.querySelectorAll("label")].find((element) => element.querySelector("span")?.textContent === "地点（可选）");
            assert(restoredPlace.querySelector("input").value === "手动地点" && state.captures.length === 0, "拒绝场合未恢复原手动输入或提前写入");
        });
    });

    await test("AG-AI-001 取消、超时和卸载后的迟到响应零回填", async () => {
        for (const mode of ["cancel", "timeout", "unmount"]) {
            const state = configureAiKernel(kernel, settings);
            let release;
            state.delayed = new Promise((resolveReply) => { release = resolveReply; });
            if (mode === "timeout") state.timeoutMs = 20;
            let component;
            fixture.innerHTML = "";
            component = mount(CaptureDialog, { target: fixture, props: { facade: state.facade, docId: sourceDocId, onClose: () => {} } });
            try {
                await waitFor(() => fixture.textContent.includes("新人员名单"));
                findButton(fixture, "AI 分析本页").click();
                await waitFor(() => fixture.querySelector("textarea[readonly]"));
                findButton(fixture, "确认发送本次文本").click();
                await waitFor(() => state.requests.some((request) => request.route === "/api/ai/chatGPT"));
                if (mode === "cancel") findButton(fixture, "取消 AI").click();
                if (mode === "timeout") await waitFor(() => fixture.textContent.includes("请求超时"));
                if (mode === "unmount") { await unmount(component); component = null; }
                release(state.reply);
                await tick();
                await new Promise((resolveWait) => setTimeout(resolveWait, 30));
                await tick();
                assert(!fixture.querySelector("[data-ai-kind]") && state.captures.length === 0, `${mode} 迟到响应被回填或写入`);
            } finally { release(state.reply); if (component) await unmount(component); }
        }
    });

    await test("AG-AI-001 AI 关闭仍能完整手动捕获，未配置显示本地回退", async () => {
        const disabled = configureAiKernel(kernel, settings);
        disabled.facade.viewPreferences.aiEnabled = false;
        await mounted(fixture, disabled.facade, async () => {
            assert(![...fixture.querySelectorAll("button")].some((candidate) => candidate.textContent.includes("AI 分析")), "关闭后仍有外发入口");
            const names = [...fixture.querySelectorAll("input")].find((element) => element.placeholder.includes("王五"));
            input(names, "手动虚构新人");
            await tick();
            findButton(fixture, "下一步").click();
            await tick();
            findButton(fixture, "记录互动并建立事项双链").click();
            await waitFor(() => disabled.captures.length === 1 && fixture.textContent.includes("已记录"));
            assert(disabled.captures[0].newNames[0] === "手动虚构新人" && disabled.requests.length === 0, "手动路径依赖 AI 或有隐藏请求");
        });
        const unconfigured = configureAiKernel(kernel, settings);
        unconfigured.reply = "";
        await mounted(fixture, unconfigured.facade, async () => {
            findButton(fixture, "AI 分析本页").click();
            await waitFor(() => fixture.querySelector("textarea[readonly]"));
            findButton(fixture, "确认发送本次文本").click();
            await waitFor(() => fixture.textContent.includes("可能未配置"));
            assert(!fixture.querySelector("[data-ai-kind]") && unconfigured.captures.length === 0, "未配置仍产生候选事实");
        });
    });
}
