import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { registerHooks } from "node:module";
import ts from "typescript";

const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
        if (specifier === "siyuan") return { shortCircuit: true, url: "data:text/javascript," + encodeURIComponent("export function fetchPost() { throw new Error('not expected'); }") };
        if (specifier.startsWith(".") && context.parentURL?.startsWith("file:")) {
            const candidate = new URL(specifier + ".ts", context.parentURL);
            if (existsSync(fileURLToPath(candidate))) return nextResolve(candidate.href, context);
        }
        return nextResolve(specifier, context);
    },
    load(url, context, nextLoad) {
        if (url.startsWith("file:") && url.endsWith(".ts")) return { shortCircuit: true, format: "module", source:
            ts.transpileModule(readFileSync(fileURLToPath(url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext } }).outputText };
        return nextLoad(url, context);
    },
});

const { readSettingsState } = await import("../src/services/init.ts");
const { KernelResponseError } = await import("../src/api/kernel-contract.ts");
const { isAttributeViewCarrierMissingError } = await import("../src/api/av.ts");

test.after(() => hooks.deregister());

const valid = {
    schemaVersion: 1,
    notebookId: "20261006000000-book001",
    notebookName: "人脉",
    hostDocId: "20261006000000-host001",
    dbBlockId: "20261006000000-table01",
    avId: "20261006000000-av00001",
    initializedAt: "2026-10-06",
    fieldMap: { birthday: "20261006000000-key0001" },
};

test("readSettingsState 保留 missing/invalid/read_failed/valid 四态", async () => {
    const plugin = { loadData: async () => undefined } as never;
    assert.equal((await readSettingsState(plugin)).status, "missing");
    const invalid = { loadData: async () => ({ schemaVersion: 99 }) } as never;
    assert.equal((await readSettingsState(invalid)).status, "invalid");
    const failed = { loadData: async () => { throw new Error("permission denied"); } } as never;
    const failedState = await readSettingsState(failed);
    assert.equal(failedState.status, "read_failed");
    assert.match(failedState.error?.message ?? "", /存储读取失败/);
    const validState = await readSettingsState({ loadData: async () => valid } as never);
    assert.equal(validState.status, "valid");
    assert.equal(validState.settings?.dbBlockId, valid.dbBlockId);
});

test("carrier 缺失只识别精确的 renderAttributeView 错误", () => {
    const exact = new KernelResponseError("/api/av/renderAttributeView", -1, "resolve attribute view carrier: block [20261006000000-table01] not found");
    assert.equal(isAttributeViewCarrierMissingError(exact), true);
    const unrelated = new KernelResponseError("/api/av/renderAttributeView", -1, "attribute view not found");
    assert.equal(isAttributeViewCarrierMissingError(unrelated), false);
});

test("工作区重读在每个宿主读取后检查生命周期，并延迟到统一提交点写入状态", () => {
    const source = readFileSync(fileURLToPath(new URL("../src/index.ts", import.meta.url)), "utf8");
    const start = source.indexOf("    async reloadWorkspaceState(): Promise<WorkspaceState> {");
    const end = source.indexOf("\n    openWorkbench(", start);
    assert.ok(start >= 0 && end > start, "找不到工作区重读实现");
    const reload = source.slice(start, end).replace(/\r\n/g, "\n");

    const readSettings = "const read = await readSettingsState(this);";
    const readSettingsGuard = "if (!this.isLifecycleActive(lifecycleToken)) return this.workspaceState;";
    const probeAnchor = "const anchor = await probeSettingsAnchor(read.settings);";
    const probeAnchorGuard = "if (!this.isLifecycleActive(lifecycleToken)) return this.workspaceState;";
    assert.ok(reload.includes(`${readSettings}\n                ${readSettingsGuard}`), "设置读取后必须先检查生命周期");
    assert.ok(reload.includes(`${probeAnchor}\n                    ${probeAnchorGuard}`), "锚点读取后必须先检查生命周期");

    /* 异步读取阶段只能写 next* 局部变量；真实插件状态必须在最后的版本门禁后统一提交。 */
    assert.equal(reload.includes("this.recoverySettings = read.settings"), false);
    assert.equal(reload.includes("this.settings = read.settings"), false);
    const versionGuard = reload.indexOf("if (observedVersion !== this.workspaceStateReloadVersion) continue;");
    const settingsCommit = reload.indexOf("this.settings = nextSettings;");
    const workspaceCommit = reload.indexOf("this.workspaceState = next;");
    assert.ok(versionGuard >= 0, "工作区重读必须丢弃过期请求");
    assert.ok(versionGuard < settingsCommit && settingsCommit < workspaceCommit, "状态提交必须位于版本门禁之后且顺序稳定");
});

test("工作区恢复重读：异步核验期间按钮锁定且等待真实 Promise 完成", () => {
    const recovery = readFileSync(fileURLToPath(new URL("../src/components/WorkspaceRecovery.svelte", import.meta.url)), "utf8").replace(/\r\n/g, "\n");
    const root = readFileSync(fileURLToPath(new URL("../src/components/WorkbenchRoot.svelte", import.meta.url)), "utf8").replace(/\r\n/g, "\n");
    assert.ok(recovery.includes("let retrying = $state(false);"), "恢复页必须有独立的重读进行中状态");
    assert.ok(recovery.includes("await onRetry();"), "恢复页必须等待重读 Promise 完成，避免提前解锁");
    assert.ok(recovery.includes("onRetry: () => void | Promise<void>;"), "恢复页必须接收可等待的重读 Promise");
    assert.ok(recovery.includes("if (retrying || busy || scanning) return;"), "重复点击必须在发起前被拦截");
    assert.ok(recovery.includes("disabled={busy || scanning || retrying}"), "重读期间其他恢复动作也必须锁定");
    assert.ok(recovery.includes("retrying ? \"核验中…\" : \"重新读取并核验\""), "重读期间必须向用户反馈当前状态");
    assert.ok(root.includes("onRetry={async () => { await facade.reloadWorkspaceState(); }}"), "根组件必须把真实重读 Promise 交给恢复页等待");
});

test("工作区恢复重读：并发点击只发起一次请求，完成或失败后均释放忙碌态", async () => {
    const source = readFileSync(fileURLToPath(new URL("../src/components/WorkspaceRecovery.svelte", import.meta.url)), "utf8")
        .replace(/\r\n/g, "\n");
    const functionSource = source.match(/async function retryWorkspace\(\): Promise<void> \{[\s\S]*?\n    \}(?=\n\n    async function scan)/)?.[0];
    assert.ok(functionSource, "找不到工作区重读控制函数");
    const runnable = ts.transpileModule(functionSource, { compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.None } }).outputText;
    const makeController = (onRetry: () => Promise<void>) => new Function("onRetry", `
        let retrying = false;
        let busy = false;
        let scanning = false;
        let message = "旧消息";
        ${runnable}
        return { retryWorkspace, state: () => ({ retrying, message }) };
    `)(onRetry) as { retryWorkspace: () => Promise<void>; state: () => { retrying: boolean; message: string } };

    let resolveRetry!: () => void;
    let calls = 0;
    const controller = makeController(() => {
        calls += 1;
        return new Promise<void>((resolve) => { resolveRetry = resolve; });
    });
    const pending = controller.retryWorkspace();
    assert.deepEqual(controller.state(), { retrying: true, message: "" });
    await controller.retryWorkspace();
    assert.equal(calls, 1, "挂起的核验不能被重复触发");
    resolveRetry();
    await pending;
    assert.deepEqual(controller.state(), { retrying: false, message: "" });

    const failed = makeController(async () => { throw new Error("核验失败"); });
    await failed.retryWorkspace();
    assert.deepEqual(failed.state(), { retrying: false, message: "核验失败" });
});
