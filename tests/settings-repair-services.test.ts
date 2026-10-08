import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { FIELD_SPECS } from "../src/domain/fields.ts";
import type { ContactsSettings } from "../src/domain/model.ts";

const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
        if (specifier === "siyuan") return { shortCircuit: true, url: "data:text/javascript," + encodeURIComponent(
            "export function fetchPost(route,body,callback,timeout,failure){globalThis.__lvctSettingsRepairTestRequest(route,body).then(callback,failure);}") };
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

const { runSettingsRepairServiceRegression } = await import("../scripts/e2e/ui/settings-repair-fixture.js");
test.after(() => { hooks.deregister(); Reflect.deleteProperty(globalThis, "__lvctSettingsRepairTestRequest"); });

const settings: ContactsSettings = { schemaVersion: 1, notebookId: "20261004000000-book001", notebookName: "纯服务夹具",
    hostDocId: "20261004000000-host001", dbBlockId: "20261004000000-table01", avId: "20261004000000-av00001",
    initializedAt: "2026-10-04", fieldMap: Object.fromEntries(FIELD_SPECS.map((spec) => [spec.key, spec.key])) as ContactsSettings["fieldMap"] };
const kernel: { handler?: (route: string, body: Record<string, unknown>) => Promise<unknown> } = {};
Reflect.set(globalThis, "__lvctSettingsRepairTestRequest", async (route: string, body: Record<string, unknown>) => {
    try {
        const data = await kernel.handler!(route, body);
        return { code: 0, msg: "", data };
    } catch (error) {
        return { code: -1, msg: error instanceof Error ? error.message : String(error), data: null };
    }
});

test("设置修复真实服务与内存内核边界", async (context) => {
    await runSettingsRepairServiceRegression({ test: context.test.bind(context), assert: (condition: unknown, message: string) => assert.ok(condition, message), kernel, settings });
});
