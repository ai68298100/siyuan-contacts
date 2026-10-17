import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import type { ContactsSettings } from "../src/domain/model.ts";

const docId = "20261016000000-person1";
const blockId = "20261016000000-mark001";
const attrName = "custom-lvct-related";

const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
        if (specifier === "siyuan") return { shortCircuit: true, url: "data:text/javascript," + encodeURIComponent(
            "export function fetchPost(route,body,callback,timeout,failure){globalThis.__lvctMarkedBlockTest(route,body).then(callback,failure);}") };
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

const { upsertMarkedBlock } = await import("../src/api/blocks.ts");
const { retryRelationProjections } = await import("../src/services/relations.ts");
test.after(() => hooks.deregister());

function fixture(initial: Array<{ id: string; markdown: string }> = []) {
    const state = {
        blocks: structuredClone(initial), staleWrite: false, writes: 0,
        writeFailure: "none" as "none" | "transport" | "kernel" | "permission", readFailureAfterWrite: false,
    };
    const accepted = (data: unknown = null) => ({ code: 0, msg: "", data });
    const handler = async (route: string, body: Record<string, unknown>) => {
        if (route === "/api/sqlite/flushTransaction") return accepted();
        if (route === "/api/av/renderAttributeView") return accepted({ view: {
            columns: [{ id: "related", type: "relation", name: "相关人" }],
            rows: [
                { id: "20261016000000-item001", cells: [
                    { valueType: "block", value: { keyID: "primary", type: "block", block: { id: docId, content: "甲" } } },
                    { valueType: "relation", value: { keyID: "related", type: "relation", relation: { blockIDs: ["20261016000000-item002"] } } },
                ] },
                { id: "20261016000000-item002", cells: [
                    { valueType: "block", value: { keyID: "primary", type: "block", block: { id: "20261016000000-person2", content: "乙" } } },
                ] },
            ],
        } });
        if (route === "/api/query/sql") {
            if (state.readFailureAfterWrite && state.writes) return { code: 403, msg: "回读权限失败", data: null };
            const statement = String(body.stmt ?? "");
            if (statement.includes("type = 'd'")) return accepted([{ id: docId }]);
            return accepted(state.blocks.map((entry) => ({ ...entry })));
        }
        if (["/api/block/insertBlock", "/api/block/updateBlock", "/api/block/deleteBlock"].includes(route)) {
            state.writes += 1;
            if (state.writeFailure === "kernel") return { code: -1, msg: "拒绝块写入", data: null };
            if (state.writeFailure === "permission") return { code: 403, msg: "拒绝块写入", data: null };
        }
        if (route === "/api/block/insertBlock") {
            assert.equal(body.parentID, docId);
            assert.equal(body.dataType, "markdown");
            if (!state.staleWrite) state.blocks = [{ id: blockId, markdown: String(body.data) }];
            if (state.writeFailure === "transport") throw new Error("写入后响应丢失");
            return accepted([{ doOperations: [{ id: blockId, action: "insert" }] }]);
        }
        if (route === "/api/block/updateBlock") {
            assert.equal(body.dataType, "markdown");
            if (!state.staleWrite) state.blocks = state.blocks.map((entry) => entry.id === body.id
                ? { id: entry.id, markdown: String(body.data) } : entry);
            if (state.writeFailure === "transport") throw new Error("写入后响应丢失");
            return accepted();
        }
        if (route === "/api/block/deleteBlock") {
            if (!state.staleWrite) state.blocks = state.blocks.filter((entry) => entry.id !== body.id);
            if (state.writeFailure === "transport") throw new Error("写入后响应丢失");
            return accepted();
        }
        throw new Error(`未配置端点 ${route}`);
    };
    (globalThis as unknown as { __lvctMarkedBlockTest: typeof handler }).__lvctMarkedBlockTest = handler;
    return state;
}

test("标记块写入会核验多行正文，响应成功但正文未收敛时保持未知", async () => {
    const state = fixture();
    const markdown = "**相关人物**：甲\n第二行备注";
    await upsertMarkedBlock(docId, attrName, markdown);
    assert.equal(state.blocks[0].markdown, `${markdown}\n{: ${attrName}=\"1\"}`);

    state.staleWrite = true;
    await assert.rejects(
        upsertMarkedBlock(docId, attrName, "**相关人物**：乙\n第二行备注", blockId),
        /回读未核实预期内容/,
    );
});

test("标记块清空和重复标记也必须回读收敛", async () => {
    const state = fixture([{ id: blockId, markdown: `正文\n{: ${attrName}=\"1\"}` }]);
    state.staleWrite = true;
    await assert.rejects(upsertMarkedBlock(docId, attrName, "", blockId), /回读未核实预期内容/);

    const duplicate = fixture([
        { id: blockId, markdown: `甲\n{: ${attrName}=\"1\"}` },
        { id: "20261016000000-mark002", markdown: `乙\n{: ${attrName}=\"1\"}` },
    ]);
    await assert.rejects(upsertMarkedBlock(docId, attrName, "新正文", blockId), /回读未核实预期内容/);
    assert.equal(duplicate.blocks.length, 2);
});

test("正文中的 IAL 形态文本不能被回读比较器忽略", async () => {
    const state = fixture([{ id: blockId, markdown: `正文\n{: 用户原文}` }]);
    state.staleWrite = true;
    await assert.rejects(
        upsertMarkedBlock(docId, attrName, "正文\n{: 另一段用户原文}", blockId),
        /回读未核实预期内容/,
    );
    assert.equal(state.blocks[0].markdown, `正文\n{: 用户原文}`);
});

const settings = {
    schemaVersion: 1, notebookId: "20261016000000-book001", notebookName: "隔离测试",
    hostDocId: "20261016000000-host001", dbBlockId: "20261016000000-db00001", avId: "20261016000000-av00001",
    fieldMap: { name: "primary", related: "related" }, initializedAt: "2026-10-16",
} as ContactsSettings;

test("关系投影服务把内层回读不收敛、响应丢失和写后读取拒绝保留为 unknown", async (context) => {
    context.mock.method(console, "warn", () => {});
    for (const failure of ["stale", "transport", "read"] as const) {
        const state = fixture([{ id: blockId, markdown: `旧投影\n{: ${attrName}="1"}` }]);
        if (failure === "stale") state.staleWrite = true;
        if (failure === "transport") state.writeFailure = "transport";
        if (failure === "read") state.readFailureAfterWrite = true;
        const [result] = await retryRelationProjections(settings, [docId]);
        assert.equal(result.status, "unknown", failure);
        assert.equal(result.docId, docId);
        assert.equal(state.writes, 1, "未知结果不得在本次操作中重发块写入");
    }
});

test("关系投影服务保留块写入端点明确拒绝为 failed", async (context) => {
    context.mock.method(console, "warn", () => {});
    for (const failure of ["kernel", "permission"] as const) {
        const state = fixture([{ id: blockId, markdown: `旧投影\n{: ${attrName}="1"}` }]);
        state.writeFailure = failure;
        const [result] = await retryRelationProjections(settings, [docId]);
        assert.equal(result.status, "failed", failure);
        assert.equal(state.writes, 1);
        assert.equal(state.blocks[0].markdown, `旧投影\n{: ${attrName}="1"}`);
    }
});
