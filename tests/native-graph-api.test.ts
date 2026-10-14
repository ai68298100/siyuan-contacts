import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
        if (specifier === "siyuan") return { shortCircuit: true, url: "data:text/javascript," + encodeURIComponent(
            "export function fetchPost(route,body,callback,_headers,failure){globalThis.__lvctNativeGraphRequest(route,body).then(callback,failure);}"), };
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
const { fetchLocalGraph, fetchGlobalGraph } = await import("../src/api/graph.ts");
test.after(() => hooks.deregister());

type RefRow = { root_id: string; def_block_root_id: string };
const id = (index: number) => `20261012000000-g${String(index).padStart(6, "0")}`;
const ref = (from: number, to: number): RefRow => ({ root_id: id(from), def_block_root_id: id(to) });

function fixture(documents: readonly number[], references: readonly RefRow[]) {
    const calls: { route: string; stmt: string }[] = [];
    const requested = async (route: string, body: Record<string, unknown>) => {
        const stmt = String(body.stmt);
        calls.push({ route, stmt });
        assert.equal(route, "/api/query/sql", "原生引用视图不得调用会保存宿主设置的 graph 端点");
        if (stmt.includes("FROM blocks")) {
            const batch = [...stmt.matchAll(/'(\d{14}-[0-9a-z]{7})'/g)].map((match) => match[1]);
            return { code: 0, msg: "", data: documents.filter((index) => batch.includes(id(index))).map((index) => ({ id: id(index), content: `人物 ${index}` })) };
        }
        assert.match(stmt, /GROUP BY root_id, def_block_root_id ORDER BY root_id, def_block_root_id LIMIT 201$/);
        const center = stmt.match(/WHERE \(\(\(root_id = '(\d{14}-[0-9a-z]{7})' AND def_block_root_id IN/)?.[1];
        const batch = stmt.match(/root_id IN \(([^)]+)\)/)?.[1];
        const sourceIds = batch ? [...batch.matchAll(/'(\d{14}-[0-9a-z]{7})'/g)].map((match) => match[1]) : [];
        const targetBatch = stmt.match(/def_block_root_id IN \(([^)]+)\)/)?.[1] ?? "";
        const targetIds = [...targetBatch.matchAll(/'(\d{14}-[0-9a-z]{7})'/g)].map((match) => match[1]);
        const cursor = stmt.match(/root_id > '([^']+)' OR \(root_id = '\1' AND def_block_root_id > '([^']+)'\)/);
        const after = cursor ? `${cursor[1]}~${cursor[2]}` : "";
        const unique = new Map(references.map((row) => [`${row.root_id}~${row.def_block_root_id}`, row]));
        const data = [...unique.entries()].filter(([key, row]) => key > after && row.root_id !== row.def_block_root_id && (center
            ? row.root_id === center && targetIds.includes(row.def_block_root_id) || row.def_block_root_id === center && sourceIds.includes(row.root_id)
            : sourceIds.includes(row.root_id) && targetIds.includes(row.def_block_root_id)))
            .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).slice(0, 201).map(([, row]) => row);
        return { code: 0, msg: "", data };
    };
    (globalThis as unknown as { __lvctNativeGraphRequest: typeof requested }).__lvctNativeGraphRequest = requested;
    return calls;
}

test("原生引用 API：双向一度、白名单、重复块引用与自引用，不写宿主图设置", async () => {
    const calls = fixture([0, 1, 2, 3], [ref(0, 1), ref(0, 1), ref(2, 0), ref(0, 3), ref(0, 0), ref(1, 2)]);
    const graph = await fetchLocalGraph(id(0), new Set([id(0), id(1), id(2)]));
    assert.deepEqual(graph.nodes.map((node) => node.id), [id(0), id(1), id(2)]);
    assert.deepEqual(graph.links, [{ from: id(0), to: id(1), ref: true }, { from: id(2), to: id(0), ref: true }]);
    assert.equal(graph.id, id(0));
    assert.equal(graph.nodes[0].refs, 1);
    assert.equal(graph.nodes[0].defs, 1);
    assert.equal(calls.length, 2);
    assert(calls.every((call) => !call.stmt.includes(id(3))));
});

test("原生引用 API：超过一页的引用按复合游标完整读取，中心和最后一人不丢", async () => {
    const documents = Array.from({ length: 206 }, (_, index) => index);
    const calls = fixture(documents, documents.slice(1).map((index) => ref(0, index)));
    const graph = await fetchLocalGraph(id(0), new Set(documents.map(id)));
    assert.equal(graph.links.length, 205);
    assert.equal(graph.nodes.length, 206);
    const pages = calls.filter((call) => call.stmt.includes("FROM refs"));
    assert.equal(pages.length, 2);
    assert.match(pages[1].stmt, new RegExp(`def_block_root_id > '${id(200)}'`));
    assert(graph.nodes.some((node) => node.id === id(205)));
});

test("原生引用 API：全局只分批扫描登记源文档，保留无引用文档且不纳入无关笔记", async () => {
    const documents = Array.from({ length: 205 }, (_, index) => index);
    const calls = fixture([...documents, 999], [ref(0, 1), ref(104, 204), ref(204, 999), ref(999, 0)]);
    const graph = await fetchGlobalGraph(new Set(documents.map(id)));
    assert.equal(graph.nodes.length, 205);
    assert.equal(graph.links.length, 2);
    const docCalls = calls.filter((call) => call.stmt.includes("FROM blocks"));
    const refCalls = calls.filter((call) => call.stmt.includes("FROM refs"));
    assert.equal(docCalls.length, 3);
    assert.equal(refCalls.length, 3);
    assert(refCalls.every((call) => {
        const sourceBatch = call.stmt.match(/root_id IN \(([^)]+)\)/)?.[1] ?? "";
        const targetBatch = call.stmt.match(/def_block_root_id IN \(([^)]+)\)/)?.[1] ?? "";
        return (sourceBatch.match(/'\d{14}-[0-9a-z]{7}'/g)?.length ?? 0) <= 100
            && (targetBatch.match(/'\d{14}-[0-9a-z]{7}'/g)?.length ?? 0) === documents.length;
    }));
    assert.equal(graph.nodes[2].refs, 0);
});

test("原生引用 API：非法 ID、未登记中心和空登记集合在请求前处理", async () => {
    const calls = fixture([], []);
    await assert.rejects(fetchLocalGraph("bad", new Set()), /合法/);
    await assert.rejects(fetchLocalGraph(id(0), new Set([id(1)])), /登记/);
    await assert.rejects(fetchGlobalGraph(new Set(["x' OR 1=1"])), /无效/);
    assert.deepEqual(await fetchGlobalGraph(new Set()), { nodes: [], links: [] });
    assert.equal(calls.length, 0);
});

test("原生引用 API：中心文档失联、索引异常和权限拒绝不能伪装为空图", async () => {
    fixture([], []);
    await assert.rejects(fetchLocalGraph(id(0), new Set([id(0)])), /不可达/);
    (globalThis as unknown as { __lvctNativeGraphRequest: () => Promise<unknown> }).__lvctNativeGraphRequest = async () => ({ code: 0, msg: "", data: [{ root_id: id(1), def_block_root_id: id(2) }] });
    await assert.rejects(fetchLocalGraph(id(0), new Set([id(0)])), /查询范围/);
    (globalThis as unknown as { __lvctNativeGraphRequest: () => Promise<unknown> }).__lvctNativeGraphRequest = async () => ({ code: 403, msg: "permission denied", data: null });
    await assert.rejects(fetchLocalGraph(id(0), new Set([id(0)])), (error: unknown) => error instanceof Error && error.name === "KernelPermissionError");
});

test("原生引用 API：迟滞游标与异常文档回读显式拒绝，不陷入循环", async () => {
    let requests = 0;
    (globalThis as unknown as { __lvctNativeGraphRequest: () => Promise<unknown> }).__lvctNativeGraphRequest = async () => {
        requests += 1;
        return { code: 0, msg: "", data: Array.from({ length: 201 }, (_, index) => ref(0, index + 1)) };
    };
    await assert.rejects(fetchLocalGraph(id(0), new Set(Array.from({ length: 202 }, (_, index) => id(index)))), /未前进/);
    assert.equal(requests, 2);
    (globalThis as unknown as { __lvctNativeGraphRequest: () => Promise<unknown> }).__lvctNativeGraphRequest = async () => ({ code: 0, msg: "", data: [{ id: id(1), content: "范围外文档" }] });
    await assert.rejects(fetchGlobalGraph(new Set([id(0)])), /登记范围/);
});

test("原生引用 API：超过 50k 的非登记引用不进入分页或预算，局部和全局都只读登记两端", async () => {
    const ordinary = Array.from({ length: 50_001 }, (_, index) => ref(0, index + 100));
    const calls = fixture([0, 1, 2], [ref(0, 1), ref(2, 0), ...ordinary, ...ordinary.map((row) => ({ root_id: row.def_block_root_id, def_block_root_id: row.root_id }))]);
    const allowed = new Set([id(0), id(1), id(2)]);
    assert.equal((await fetchLocalGraph(id(0), allowed)).links.length, 2);
    assert.equal((await fetchGlobalGraph(allowed)).links.length, 2);
    assert.equal(calls.filter((call) => call.stmt.includes("FROM refs")).length, 2, "普通笔记不应占分页或读取预算");
});

test("原生引用 API：过大全局白名单先拒绝，局部按线性批次仍可保留中心", async () => {
    const calls = fixture([0], []);
    const allowed = new Set(Array.from({ length: 10_001 }, (_, index) => id(index)));
    await assert.rejects(fetchGlobalGraph(allowed), /10,000/);
    assert.equal(calls.length, 0);
    const local = await fetchLocalGraph(id(0), allowed);
    assert.deepEqual(local.nodes.map((node) => node.id), [id(0)]);
    assert.equal(calls.filter((call) => call.stmt.includes("FROM refs")).length, 2, "局部批次不得形成源乘目标组合");
    assert(calls.every((call) => Buffer.byteLength(call.stmt, "utf8") < 501_000));
});
