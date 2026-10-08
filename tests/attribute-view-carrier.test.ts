import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
        if (specifier === "siyuan") return {
            shortCircuit: true,
            url: "data:text/javascript," + encodeURIComponent(
                "export function fetchPost(route,body,callback,timeout,failure){globalThis.__lvctCarrierTestRequest(route,body).then(callback,failure);}",
            ),
        };
        if (specifier.startsWith(".") && context.parentURL?.startsWith("file:")) {
            const candidate = new URL(specifier + ".ts", context.parentURL);
            if (existsSync(fileURLToPath(candidate))) return nextResolve(candidate.href, context);
        }
        return nextResolve(specifier, context);
    },
    load(url, context, nextLoad) {
        if (url.startsWith("file:") && url.endsWith(".ts")) return {
            shortCircuit: true,
            format: "module",
            source: ts.transpileModule(readFileSync(fileURLToPath(url), "utf8"), {
                compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext },
            }).outputText,
        };
        return nextLoad(url, context);
    },
});

const { AttributeViewCarrierMissingError, isAttributeViewCarrierMissingError, renderView } = await import("../src/api/av.ts");
const { KernelResponseError } = await import("../src/api/kernel-contract.ts");

test.after(() => hooks.deregister());

const avId = "20261006000000-av00001";
const dbBlockId = "20261006000000-db00001";
const missingMessage = `resolve attribute view carrier: block [${dbBlockId}] not found`;

test("AV carrier 缺块：精确识别并保留锚点与原始错误", async () => {
    const original = new KernelResponseError("/api/av/renderAttributeView", -1, missingMessage);
    assert.equal(isAttributeViewCarrierMissingError(original), true);
    assert.equal(isAttributeViewCarrierMissingError(new KernelResponseError(
        "/api/av/renderAttributeView", -1, "attribute view not found",
    )), false);

    (globalThis as unknown as { __lvctCarrierTestRequest: () => Promise<unknown> }).__lvctCarrierTestRequest = async () => ({ code: -1, msg: missingMessage, data: null });
    await assert.rejects(
        () => renderView(avId, dbBlockId),
        (error: unknown) => error instanceof AttributeViewCarrierMissingError
            && error.avId === avId
            && error.dbBlockId === dbBlockId
            && error.originalError instanceof KernelResponseError
            && error.cause === error.originalError,
    );
});

test("AV carrier 识别不扩大到相似 not-found 文案", () => {
    assert.equal(isAttributeViewCarrierMissingError(new KernelResponseError(
        "/api/query/sql", -1, `resolve attribute view carrier: block [${dbBlockId}] not found: extra detail`,
    )), false);
    assert.equal(isAttributeViewCarrierMissingError(new Error(missingMessage)), false);
});
