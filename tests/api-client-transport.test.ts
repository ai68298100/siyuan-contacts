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
                "export function fetchPost(route,body,callback,_headers,failure){Promise.resolve().then(()=>globalThis.__lvctKernelTransportRequest(route,body)).then(callback,failure);}",
            ),
        };
        if (specifier.startsWith(".") && context.parentURL?.startsWith("file:")) {
            const candidate = new URL(specifier.endsWith(".ts") ? specifier : `${specifier}.ts`, context.parentURL);
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

const { kernelPost } = await import("../src/api/client.ts");
test.after(() => hooks.deregister());

type RequestMock = (route: string, body: Record<string, unknown>) => Promise<unknown>;
function setRequestMock(request: RequestMock): void {
    (globalThis as unknown as { __lvctKernelTransportRequest: RequestMock }).__lvctKernelTransportRequest = request;
}

test("API transport deduplicates identical safe reads while requests are in flight", async () => {
    let requests = 0;
    setRequestMock(async () => {
        requests += 1;
        await new Promise((resolve) => setTimeout(resolve, 15));
        return { code: 0, msg: "", data: [{ id: "row" }] };
    });
    const [first, second] = await Promise.all([
        kernelPost<unknown[]>("/api/query/sql", { stmt: "SELECT id FROM blocks" }),
        kernelPost<unknown[]>("/api/query/sql", { stmt: "SELECT id FROM blocks" }),
    ]);
    assert.equal(requests, 1);
    assert.deepEqual(first, [{ id: "row" }]);
    assert.deepEqual(second, first);
});

test("freshness-sensitive callers can bypass in-flight sharing", async () => {
    let requests = 0;
    setRequestMock(async () => {
        requests += 1;
        await new Promise((resolve) => setTimeout(resolve, 10));
        return { code: 0, msg: "", data: [] };
    });
    await Promise.all([
        kernelPost<unknown[]>("/api/query/sql", { stmt: "SELECT fresh" }, { dedupe: false }),
        kernelPost<unknown[]>("/api/query/sql", { stmt: "SELECT fresh" }, { dedupe: false }),
    ]);
    assert.equal(requests, 2);
});

test("API transport retries a safe read once after transport failure", async () => {
    let requests = 0;
    setRequestMock(async () => {
        requests += 1;
        if (requests === 1) throw new Error("temporary network failure");
        return { code: 0, msg: "", data: "ok" };
    });
    assert.equal(await kernelPost<string>("/api/notebook/lsNotebooks"), "ok");
    assert.equal(requests, 2);
});

test("API transport does not retry permission/kernel responses, timeouts, or writes", async () => {
    let requests = 0;
    setRequestMock(async () => {
        requests += 1;
        return { code: 403, msg: "permission denied", data: null };
    });
    await assert.rejects(kernelPost("/api/query/sql", { stmt: "SELECT 1" }), /权限失败/);
    assert.equal(requests, 1);

    setRequestMock(async () => { requests += 1; throw new Error("write transport failure"); });
    await assert.rejects(kernelPost("/api/block/insertBlock", { data: "content" }), /传输失败/);
    assert.equal(requests, 2);

    setRequestMock(async () => {
        requests += 1;
        await new Promise((resolve) => setTimeout(resolve, 30));
        return { code: 0, msg: "", data: [] };
    });
    await assert.rejects(kernelPost("/api/query/sql", { stmt: "SELECT slow" }, { timeoutMs: 5 }), /请求超时/);
    assert.equal(requests, 3);
});

test("querySql only opts in to read optimizations for a single SELECT statement", async () => {
    let requests = 0;
    setRequestMock(async () => {
        requests += 1;
        await new Promise((resolve) => setTimeout(resolve, 10));
        throw new Error("transport failure");
    });
    for (const statement of [
        "UPDATE blocks SET content = 'x' WHERE id = 'id'",
        "-- comment\nSELECT id FROM blocks",
        "/* comment */ SELECT id FROM blocks",
        "WITH rows AS (SELECT id FROM blocks) SELECT id FROM rows",
        "SELECT id FROM blocks; DELETE FROM blocks",
    ]) {
        const results = await Promise.allSettled([
            kernelPost("/api/query/sql", { stmt: statement }),
            kernelPost("/api/query/sql", { stmt: statement }),
        ]);
        assert.equal(results.filter((result) => result.status === "rejected").length, 2);
    }
    // Each unsafe shape above must make two independent transport attempts.
    assert.equal(requests, 10);
});

test("aborting one safe read releases its caller without changing host request semantics", async () => {
    let requests = 0;
    setRequestMock(async () => {
        requests += 1;
        await new Promise((resolve) => setTimeout(resolve, 20));
        return { code: 0, msg: "", data: [] };
    });
    const controller = new AbortController();
    const pending = kernelPost<unknown[]>("/api/query/sql", { stmt: "SELECT delayed" }, { signal: controller.signal });
    await new Promise((resolve) => setTimeout(resolve, 1));
    controller.abort();
    await assert.rejects(pending, /请求已取消/);
    assert.equal(requests, 1);
});

test("pre-aborted API calls do not start a transport request", async () => {
    let requests = 0;
    setRequestMock(async () => {
        requests += 1;
        return { code: 0, msg: "", data: [] };
    });
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(kernelPost("/api/query/sql", { stmt: "SELECT never" }, { signal: controller.signal }), /请求已取消/);
    assert.equal(requests, 0);
});
