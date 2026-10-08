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
            "export function fetchPost(route,body,callback){globalThis.__lvctVcardServiceRequest(route,body).then(callback,error=>callback({code:-1,msg:String(error),data:null}));}"), };
        if (specifier.startsWith(".") && context.parentURL?.startsWith("file:")) {
            const candidate = new URL(specifier + ".ts", context.parentURL);
            if (existsSync(fileURLToPath(candidate))) return nextResolve(candidate.href, context);
        }
        return nextResolve(specifier, context);
    },
    load(url, context, nextLoad) {
        if (url.endsWith(".svelte")) return { shortCircuit: true, format: "module", source: "export default null;" };
        if (url.startsWith("file:") && url.endsWith(".ts")) return { shortCircuit: true, format: "module", source:
            ts.transpileModule(readFileSync(fileURLToPath(url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext } }).outputText };
        return nextLoad(url, context);
    },
});
const { configureVcardKernel } = await import("../scripts/e2e/ui/vcard-regression.js");
const { buildVcfImportPlan, importVcfContacts, retryVcfContacts } = await import("../src/services/vcard.ts");
test.after(() => { hooks.deregister(); Reflect.deleteProperty(globalThis, "__lvctVcardServiceRequest"); });

const settings = {
    schemaVersion: 1, notebookName: "虚构人脉", notebookId: "20261004000000-book001", hostDocId: "20261004000000-host001",
    avId: "20261004000000-av00001", dbBlockId: "20261004000000-table01", initializedAt: "2026-10-04T00:00:00Z",
    fieldMap: Object.fromEntries(FIELD_SPECS.map((field) => [field.key, field.key])),
} as ContactsSettings;
const name = "虚构同名";
const externalDocId = "20261004000000-other01";
const externalUnboundId = "20261004000000-unbound";
const source = (phone: string) => `BEGIN:VCARD\r\nVERSION:3.0\r\nFN:${name}\r\nTEL:${phone}\r\nEND:VCARD\r\n`;
let fixtureNumber = 0;

function fixture() {
    settings.avId = `20261004000000-v${String(++fixtureNumber).padStart(6, "0")}`;
    const kernel = { handler: async (_route: string, _body: Record<string, unknown>): Promise<unknown> => undefined };
    const state = configureVcardKernel(kernel, settings);
    Reflect.set(globalThis, "__lvctVcardServiceRequest", async (route: string, body: Record<string, unknown>) => ({ code: 0, msg: "", data: await kernel.handler(route, body) }));
    return { kernel, state };
}

async function entries(allowSameName = false) {
    const plans = await buildVcfImportPlan(settings, source("13800000005") + source("13800000006"));
    if (allowSameName) plans.forEach((plan) => { plan.allowSameName = true; });
    return plans.map((plan, planIndex) => ({ plan, planIndex }));
}

test("批量入口：明确确认同批同名建两份独立文档，仍合并绑行批次且不写外部同名人", async () => {
    const { state } = fixture();
    state.sameName(name);
    state.docs.set(externalDocId, { id: externalDocId, name });
    const originalRow = structuredClone(state.rows.get("row-other"));
    const chosen = await entries(true);
    const report = await importVcfContacts(settings, chosen);
    assert.equal(report.imported, 2);
    assert.equal(report.unknown.length + report.failed.length, 0);
    assert.equal(state.creates.length, 2);
    assert.equal(state.rows.size, 3);
    assert.equal(state.binds.length, 1);
    assert.equal(state.binds[0].srcs.length, 2);
    const checkpoints = chosen.map((entry) => entry.plan.checkpoint!);
    assert.equal(new Set(checkpoints.map((checkpoint) => checkpoint.docId)).size, 2);
    assert.equal(new Set(checkpoints.map((checkpoint) => checkpoint.requestId)).size, 2);
    assert.ok(checkpoints.every((checkpoint) => checkpoint.state === "verified" && checkpoint.itemId && checkpoint.docId !== externalDocId));
    assert.deepEqual(state.rows.get("row-other"), originalRow);
    assert.equal(state.writes.length, 2);
    assert.deepEqual(state.writes.map((write) => write.itemID), checkpoints.map((checkpoint) => checkpoint.itemId));
    assert.deepEqual(state.writes.map((write) => write.value.phone.content), ["13800000005", "13800000006"]);
});

test("未明确确认的名册同名项默认跳过，零建档/绑定/资料写入", async () => {
    const { state } = fixture();
    state.sameName(name);
    const chosen = await entries();
    assert.ok(chosen.every((entry) => entry.plan.duplicate));
    const report = await importVcfContacts(settings, chosen);
    assert.equal(report.imported, 0);
    assert.equal(state.creates.length + state.binds.length + state.writes.length, 0);
    assert.ok(chosen.every((entry) => !entry.plan.checkpoint));
});

test("新姓名同批第二卡未确认时不自动另建，确认仅作用于具体卡片", async () => {
    const { state } = fixture();
    const chosen = await entries();
    assert.equal(chosen[0].plan.duplicate, false);
    assert.equal(chosen[1].plan.sameNameInBatch, true);
    const report = await importVcfContacts(settings, chosen);
    assert.equal(report.imported, 1);
    assert.equal(state.creates.length, 1);
    assert.equal(chosen[1].plan.checkpoint, undefined);
});

test("显式同名确认不忽略外部未绑定文档或其他请求标记", async () => {
    const { state } = fixture();
    state.docs.set(externalUnboundId, { id: externalUnboundId, name, requestId: "20261004000000-extmark" });
    const chosen = await entries(true);
    const report = await importVcfContacts(settings, chosen);
    assert.equal(report.imported, 0);
    assert.equal(report.unknown.length, 2);
    assert.equal(state.creates.length + state.binds.length + state.writes.length, 0);
    assert.ok(chosen.every((entry) => !entry.plan.checkpoint));
});

test("首卡核实后并发出现外部未绑定同名，第二卡仍停止而不冒充本批请求", async () => {
    const { kernel, state } = fixture();
    const chosen = await entries(true);
    const baseHandler = kernel.handler;
    kernel.handler = async (route, body) => {
        const result = await baseHandler(route, body);
        if (route === "/api/filetree/createDocWithMd") state.docs.set(externalUnboundId, { id: externalUnboundId, name });
        return result;
    };
    const report = await importVcfContacts(settings, chosen);
    assert.equal(report.imported, 1);
    assert.equal(report.unknown[0].planIndex, 1);
    assert.equal(state.creates.length, 1);
    assert.equal(chosen[1].plan.checkpoint, undefined);
    assert.ok(state.binds[0].srcs.every((item) => item.id !== externalUnboundId));
});

test("本批首卡请求未核实也不排除残留；原 checkpoint 可读后只续原请求", async () => {
    const { state } = fixture();
    const chosen = await entries(true);
    state.hideMarker = true;
    const report = await importVcfContacts(settings, chosen);
    assert.equal(report.unknown.length, 2);
    assert.equal(state.creates.length, 1);
    assert.equal(state.binds.length + state.writes.length, 0);
    const original = { ...chosen[0].plan.checkpoint! };
    assert.equal(original.state, "unknown");
    await retryVcfContacts(settings, chosen);
    assert.equal(state.creates.length, 1);
    state.hideMarker = false;
    const recovered = await retryVcfContacts(settings, chosen);
    assert.ok(recovered.every((result) => result.status === "imported"));
    assert.equal(state.creates.length, 2);
    assert.equal(chosen[0].plan.checkpoint!.requestId, original.requestId);
    assert.equal(chosen[0].plan.checkpoint!.docId, original.docId);
});

test("批量绑定失败后同名原 checkpoint 逐项续做，重试与重入不重新建档或重写已存值", async () => {
    const { state } = fixture();
    const chosen = await entries(true);
    state.failBind = true;
    const report = await importVcfContacts(settings, chosen);
    assert.equal(report.unknown.length, 2);
    assert.equal(state.creates.length, 2);
    assert.equal(state.writes.length, 0);
    const original = chosen.map((entry) => ({ requestId: entry.plan.checkpoint!.requestId, docId: entry.plan.checkpoint!.docId }));
    state.sameName(name);
    const externalRow = structuredClone(state.rows.get("row-other"));
    state.failBind = false;
    const recovered = await retryVcfContacts(settings, chosen);
    assert.ok(recovered.every((result) => result.status === "imported"));
    const writes = state.writes.length;
    const binds = state.binds.length;
    const repeated = await importVcfContacts(settings, chosen);
    assert.equal(repeated.imported, 2);
    assert.equal(state.creates.length, 2);
    assert.equal(state.writes.length, writes);
    assert.equal(state.binds.length, binds);
    assert.deepEqual(chosen.map((entry) => ({ requestId: entry.plan.checkpoint!.requestId, docId: entry.plan.checkpoint!.docId })), original);
    assert.deepEqual(state.rows.get("row-other"), externalRow);
});

test("原绑定行变化时不把同名新行当原 checkpoint，零重复建档或资料写入", async () => {
    const { state } = fixture();
    const chosen = await entries(true);
    await importVcfContacts(settings, chosen);
    const checkpoint = { ...chosen[0].plan.checkpoint! };
    const row = state.rows.get(checkpoint.itemId!);
    state.rows.delete(checkpoint.itemId!);
    state.rows.set("changed-row", { ...row, id: "changed-row" });
    const writes = state.writes.length;
    const report = await retryVcfContacts(settings, chosen);
    assert.equal(report[0].status, "unknown");
    assert.match(report[0].reason!, /原文档的绑定行已变化/);
    assert.equal(state.creates.length, 2);
    assert.equal(state.writes.length, writes);
    assert.equal(chosen[0].plan.checkpoint!.itemId, checkpoint.itemId);
    assert.equal(chosen[0].plan.checkpoint!.docId, checkpoint.docId);
});
