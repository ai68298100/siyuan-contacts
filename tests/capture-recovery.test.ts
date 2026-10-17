import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import type { Plugin } from "siyuan";
import type { ContactsSettings } from "../src/domain/model.ts";

const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
        if (specifier === "siyuan") return { shortCircuit: true, url: "data:text/javascript," + encodeURIComponent(
            "export function fetchPost(route,body,callback,timeout,failure){globalThis.__lvctCaptureRecovery(route,body).then(callback,failure);}") };
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

const { captureFromDoc } = await import("../src/services/capture.ts");
const { MarkedBlockWriteUnknownError, upsertMarkedBlock } = await import("../src/api/blocks.ts");
const { KernelPermissionError, KernelResponseError } = await import("../src/api/client.ts");
const { invalidateRoster } = await import("../src/services/roster.ts");
const { FIELD_SPECS } = await import("../src/domain/fields.ts");
const { occasionDiaryPath } = await import("../src/domain/occasion-links.ts");

test.after(() => { hooks.deregister(); Reflect.deleteProperty(globalThis, "__lvctCaptureRecovery"); });

const sourceId = "20261016000000-source1";
const personId = "20261016000000-person1";
const diaryId = "20261016000000-diary01";
const blockId = "20261016000000-block01";
const attrName = "custom-lvct-attendees";
const date = "2026-10-16";
const settings = {
    schemaVersion: 1, notebookId: "20261016000000-book001", notebookName: "隔离夹具",
    hostDocId: "20261016000000-host001", dbBlockId: "20261016000000-table01", avId: "20261016000000-av00001",
    fieldMap: Object.fromEntries(FIELD_SPECS.map((field) => [field.key, field.key])), initializedAt: date,
} as ContactsSettings;

function fixture(existingPerson = true) {
    invalidateRoster();
    const state = {
        store: new Map<string, unknown>(), blocks: new Map<string, { id: string; markdown: string }>(),
        blockWrites: [] as Array<{ rootId: string; route: string }>, creates: 0,
        failRoster: false, failScan: false, createResponseLost: false, hideSourceMarker: false,
        markedReads: 0, failMarkedReadAt: 0, readCode: 403,
        failFlushAfterWrite: false, writeCode: 0,
    };
    const accepted = (data: unknown = null) => ({ code: 0, msg: "", data });
    const denied = (code: number) => ({ code, msg: code === 403 ? "权限拒绝" : "内核拒绝", data: null });
    const plugin = {
        async loadData(key: string) { return structuredClone(state.store.get(key) ?? null); },
        async saveData(key: string, value: unknown) { state.store.set(key, structuredClone(value)); },
    } as unknown as Plugin;
    const handler = async (route: string, body: Record<string, any>) => {
        if (route === "/api/sqlite/flushTransaction") {
            return state.failFlushAfterWrite && state.blockWrites.length ? denied(state.readCode) : accepted();
        }
        if (route === "/api/av/renderAttributeView") {
            if (state.failRoster) return denied(-1);
            return accepted({ view: { columns: FIELD_SPECS.map((field) => ({ id: field.key, name: field.nameZh, type: field.type })),
                rows: existingPerson ? [{ id: "20261016000000-row0001", cells: [
                    { valueType: "block", value: { keyID: "primary", type: "block", block: { id: personId, content: "人物甲" } } },
                ] }] : [] } });
        }
        if (route === "/api/query/sql") {
            const stmt = String(body.stmt);
            if (stmt.includes("hpath")) {
                if (state.failScan) return denied(-1);
                return accepted([{ id: diaryId, content: date, hpath: occasionDiaryPath(settings.notebookName, date) }]);
            }
            if (stmt.includes("SELECT content")) return accepted([{ content: "虚构文档" }]);
            if (stmt.includes("type = 'd'")) return accepted([{ id: stmt.match(/id = '([^']+)'/)?.[1] }]);
            const rootId = stmt.match(/root_id = '([^']+)'/)?.[1] ?? "";
            if (rootId === sourceId && stmt.includes("SELECT id, markdown")) {
                state.markedReads += 1;
                if (state.markedReads === state.failMarkedReadAt) return denied(state.readCode);
            }
            const block = state.blocks.get(rootId);
            return accepted(block && !(rootId === sourceId && state.hideSourceMarker) ? [block] : []);
        }
        if (route === "/api/filetree/createDocWithMd") {
            state.creates += 1;
            if (state.createResponseLost) throw new Error("创建已发出，响应丢失");
            return accepted(personId);
        }
        if (route === "/api/block/insertBlock") {
            state.blockWrites.push({ rootId: body.parentID, route });
            if (state.writeCode) return denied(state.writeCode);
            const id = body.parentID === sourceId ? blockId : body.parentID.replace(/.{7}$/, "block02");
            state.blocks.set(body.parentID, { id, markdown: String(body.data) });
            return accepted([{ doOperations: [{ id, action: "insert" }] }]);
        }
        if (route === "/api/block/deleteBlock") {
            const entry = [...state.blocks].find(([, block]) => block.id === body.id);
            state.blockWrites.push({ rootId: entry?.[0] ?? sourceId, route });
            if (state.writeCode) return denied(state.writeCode);
            if (entry) state.blocks.delete(entry[0]);
            return accepted();
        }
        throw new Error(`夹具拒绝未登记端点 ${route}`);
    };
    Reflect.set(globalThis, "__lvctCaptureRecovery", handler);
    return { state, plugin };
}

test("标记块已接受后回读权限或内核拒绝均包装为未知，并保留原 cause", async () => {
    for (const readCode of [403, -1]) {
        for (const deleting of [false, true]) {
            const { state } = fixture();
            state.readCode = readCode;
            state.failFlushAfterWrite = true;
            if (deleting) state.blocks.set(sourceId, { id: blockId, markdown: `旧正文\n{: ${attrName}="1"}` });
            await assert.rejects(upsertMarkedBlock(sourceId, attrName, deleting ? "" : "正文", deleting ? blockId : undefined), (error: unknown) => {
                assert.ok(error instanceof MarkedBlockWriteUnknownError);
                assert.ok(error.cause instanceof (readCode === 403 ? KernelPermissionError : KernelResponseError));
                return true;
            });
            assert.equal(state.blockWrites.length, 1);
        }
    }
});

test("标记块写端点明确拒绝仍保留可识别的拒绝类型", async () => {
    for (const writeCode of [403, -1]) {
        const { state } = fixture();
        state.writeCode = writeCode;
        await assert.rejects(upsertMarkedBlock(sourceId, attrName, "正文"), writeCode === 403 ? KernelPermissionError : KernelResponseError);
        assert.equal(state.blocks.size, 0);
    }
});

test("捕获内外两次写后回读被拒绝均保留 unknown，未找到原标记不再插块", async () => {
    for (const readCode of [403, -1]) {
        for (const failMarkedReadAt of [1, 2]) {
            const { state, plugin } = fixture();
            state.readCode = readCode;
            state.failMarkedReadAt = failMarkedReadAt;
            const input = { personDocIds: [personId], newNames: [], date };
            const first = await captureFromDoc(plugin, settings, sourceId, input);
            const projection = first.checkpoint.projections.find((entry) => entry.key === "source");
            assert.equal(projection?.status, "unknown", `${readCode}/${failMarkedReadAt}`);
            assert.equal(first.complete, false);
            const writes = state.blockWrites.filter((entry) => entry.rootId === sourceId).length;
            assert.equal(writes, 1);
            state.failMarkedReadAt = 0;
            state.hideSourceMarker = true;
            const retried = await captureFromDoc(plugin, settings, sourceId, { ...input, checkpoint: first.checkpoint });
            assert.equal(retried.checkpoint.projections.find((entry) => entry.key === "source")?.status, "unknown");
            assert.equal(state.blockWrites.filter((entry) => entry.rootId === sourceId).length, writes);
            assert.equal(retried.interactions, 0, "已核实互动不重放");
        }
    }
});

test("未知建档遇到路径或名册读取故障仍保留 create_unknown，后续未找到文档不能重建", async () => {
    for (const failedRead of ["scan", "roster"] as const) {
        const { state, plugin } = fixture(false);
        const input = { personDocIds: [], newNames: ["新人甲"], date };
        state.createResponseLost = true;
        const first = await captureFromDoc(plugin, settings, sourceId, input);
        assert.equal(first.checkpoint.people[0].contact.code, "create_unknown");
        assert.equal(first.checkpoint.people[0].contact.status, "unknown");
        assert.equal(state.creates, 1);
        state.createResponseLost = false;
        if (failedRead === "scan") state.failScan = true;
        else state.failRoster = true;
        const failed = await captureFromDoc(plugin, settings, sourceId, { ...input, checkpoint: first.checkpoint });
        assert.equal(failed.checkpoint.people[0].contact.code, "create_unknown");
        assert.equal(failed.checkpoint.people[0].contact.status, "unknown");
        state.failScan = false;
        state.failRoster = false;
        const retried = await captureFromDoc(plugin, settings, sourceId, { ...input, checkpoint: failed.checkpoint });
        assert.equal(retried.checkpoint.people[0].contact.code, "create_unknown");
        assert.equal(retried.checkpoint.people[0].contact.status, "unknown");
        assert.equal(state.creates, 1, "原创建请求未核实，不能因读取故障再次发送创建");
        assert.equal(state.blockWrites.length, 0);
    }
});
