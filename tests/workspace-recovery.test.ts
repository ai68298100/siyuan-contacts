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
