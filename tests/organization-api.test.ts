import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
        if (specifier === "siyuan") return { shortCircuit: true, url: "data:text/javascript," + encodeURIComponent(
            "export function fetchPost(route,body,callback,failure){globalThis.__lvctOrganizationApiRequest(route,body).then(callback,failure);}"), };
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

const { listOrganizationMarkerPage } = await import("../src/api/organization.ts");
test.after(() => hooks.deregister());

const id = (index: number) => `20261005000000-org${String(index).padStart(4, "0")}`;
const marker = (index: number) => ({ root_id: id(index), ial: '{: custom-lvct-org="1"}', maxIal: '{: custom-lvct-org="1"}', markerCount: 1 });

test("组织分页 API：多取一行判断后续页并冻结 root_id 游标", async () => {
    const calls: Record<string, unknown>[] = [];
    (globalThis as unknown as { __lvctOrganizationApiRequest: (route: string, body: Record<string, unknown>) => Promise<unknown> }).__lvctOrganizationApiRequest = async (_route, body) => {
        calls.push(body);
        return { code: 0, msg: "", data: [marker(1), marker(2), marker(3)] };
    };
    const page = await listOrganizationMarkerPage(id(1), 2);
    assert.equal(page.rows.length, 2);
    assert.equal(page.hasMore, true);
    assert.equal(page.nextRootId, id(2));
    assert.match(String(calls[0].stmt), /root_id > '20261005000000-org0001'/);
    assert.match(String(calls[0].stmt), /LIMIT 3$/);
});

test("组织分页 API：重复标记计数不降级为空组织", async () => {
    (globalThis as unknown as { __lvctOrganizationApiRequest: (route: string, body: Record<string, unknown>) => Promise<unknown> }).__lvctOrganizationApiRequest = async () => ({
        code: 0, msg: "", data: [{ ...marker(1), markerCount: 2, maxIal: '{: custom-lvct-org="archived"}' }],
    });
    await assert.rejects(listOrganizationMarkerPage("", 200), /重复或不一致/);
});

test("组织分页 API：非法游标和大小在请求前拒绝", async () => {
    let requests = 0;
    (globalThis as unknown as { __lvctOrganizationApiRequest: () => Promise<unknown> }).__lvctOrganizationApiRequest = async () => {
        requests += 1;
        return { code: 0, msg: "", data: [] };
    };
    await assert.rejects(listOrganizationMarkerPage("bad", 200), /游标/);
    await assert.rejects(listOrganizationMarkerPage("", 501), /1-500/);
    assert.equal(requests, 0);
});
