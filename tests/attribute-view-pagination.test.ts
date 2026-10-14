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
                "export function fetchPost(route,body,callback,timeout,failure){globalThis.__lvctPaginationRequest(route,body).then(callback,failure);}",
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

const { renderView } = await import("../src/api/av.ts");

test.after(() => hooks.deregister());

const avId = "20261014000000-av00001";
const dbBlockId = "20261014000000-db00001";

function row(index: number) {
    return {
        id: `2026101400${String(index).padStart(4, "0")}-row0001`,
        cells: [{
            valueType: "block",
            value: {
                keyID: "primary",
                type: "block",
                blockID: `2026101400${String(index).padStart(4, "0")}-doc0001`,
                block: { id: `2026101400${String(index).padStart(4, "0")}-doc0001`, content: `联系人 ${index}` },
            },
        }],
    };
}

test("renderView 跨越思源默认 50 行分页读取完整名册", async () => {
    const sourceRows = Array.from({ length: 401 }, (_, index) => row(index + 1));
    const requests: Array<{ page: number; pageSize: number; createIfNotExist: boolean }> = [];
    (globalThis as unknown as { __lvctPaginationRequest: (route: string, body: Record<string, unknown>) => Promise<unknown> })
        .__lvctPaginationRequest = async (route, body) => {
            assert.equal(route, "/api/av/renderAttributeView");
            const page = Number(body.page);
            const requestedPageSize = Number(body.pageSize);
            // 模拟思源 3.8.6：即使客户端请求 500，服务端按视图默认大小 50 返回。
            const effectivePageSize = Math.min(requestedPageSize, 50);
            requests.push({ page, pageSize: requestedPageSize, createIfNotExist: Boolean(body.createIfNotExist) });
            return {
                code: 0,
                msg: "",
                data: {
                    view: {
                        columns: [{ id: "primary", name: "姓名", type: "block" }],
                        rows: sourceRows.slice((page - 1) * effectivePageSize, page * effectivePageSize),
                        rowCount: sourceRows.length,
                    },
                },
            };
        };

    const result = await renderView(avId, dbBlockId);
    assert.equal(result.view.rows.length, sourceRows.length);
    assert.deepEqual(result.view.rows.map((entry) => entry.id), sourceRows.map((entry) => entry.id));
    assert.equal(result.view.rowCount, sourceRows.length);
    assert.equal(requests[0].page, 1);
    assert.equal(requests[0].pageSize, 500);
    assert.equal(requests[0].createIfNotExist, false);
    assert.equal(requests.length, 9);
});

test("renderView 在旧响应缺少 rowCount 时按短页收口", async () => {
    const sourceRows = Array.from({ length: 550 }, (_, index) => row(index + 1));
    const pages: number[] = [];
    (globalThis as unknown as { __lvctPaginationRequest: (route: string, body: Record<string, unknown>) => Promise<unknown> })
        .__lvctPaginationRequest = async (_route, body) => {
            const page = Number(body.page);
            pages.push(page);
            const effectivePageSize = 500;
            return {
                code: 0,
                msg: "",
                data: {
                    view: {
                        columns: [{ id: "primary", name: "姓名", type: "block" }],
                        rows: sourceRows.slice((page - 1) * effectivePageSize, page * effectivePageSize),
                    },
                },
            };
        };

    const result = await renderView(avId, dbBlockId);
    assert.equal(result.view.rows.length, sourceRows.length);
    assert.deepEqual(pages, [1, 2]);
});

