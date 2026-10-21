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
const { buildVcfImportPlan, importVcfContacts, retryVcfContacts, exportVcfText } = await import("../src/services/vcard.ts");
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

test("大批量 vCard 导入按兼容批次绑定并完整核实，不丢失第 51 项之后的联系人", async () => {
    const { state, kernel } = fixture();
    const mapBatchSizes: number[] = [];
    const baseHandler = kernel.handler;
    kernel.handler = async (route, body) => {
        if (route === "/api/av/getAttributeViewItemIDsByBoundIDs") mapBatchSizes.push((body.blockIDs as string[]).length);
        const result = await baseHandler(route, body);
        // 模拟旧宿主/代理只返回前 50 个映射；生产 API 层必须在请求前拆分，
        // 否则第 51 项之后会被误判为未绑定。
        if (route === "/api/av/getAttributeViewItemIDsByBoundIDs") {
            return Object.fromEntries(Object.entries(result as Record<string, string>).slice(0, 50));
        }
        return result;
    };
    const cards = Array.from({ length: 101 }, (_, index) =>
        `BEGIN:VCARD\r\nVERSION:3.0\r\nFN:批量人物 ${index + 1}\r\nEND:VCARD\r\n`).join("");
    const plans = await buildVcfImportPlan(settings, cards);
    const report = await importVcfContacts(settings, plans.map((plan, planIndex) => ({ plan, planIndex })));
    assert.equal(report.imported, 101);
    assert.equal(report.unknown.length + report.failed.length, 0);
    assert.deepEqual(state.binds.map((request) => request.srcs.length), [50, 50, 1]);
    assert.ok(mapBatchSizes.length > 0 && Math.max(...mapBatchSizes) <= 50);
    assert.equal(state.rows.size, 101);
});

test("多联系方式解析预览不进入单值 AV，导入只写显式选择的标量草稿且重试保持原值", async () => {
    const { state } = fixture();
    const [plan] = await buildVcfImportPlan(settings, [
        "BEGIN:VCARD", "VERSION:3.0", "FN:多联系方式服务样例",
        "TEL:11001", "TEL:11002", "EMAIL:first@example.test", "EMAIL:second@example.test",
        "URL:https://first.example.test", "URL:https://second.example.test", "END:VCARD",
    ].join("\r\n"));
    assert.equal(plan.draft.phone, "11001 / 11002", "服务预览继续保留历史电话合并值");
    assert.deepEqual(plan.contact.phoneValues, ["11001", "11002"]);
    assert.deepEqual(plan.contact.emailValues, ["first@example.test", "second@example.test"]);
    assert.deepEqual(plan.contact.websiteValues, ["https://first.example.test", "https://second.example.test"]);
    // UI 冻结本次选择后的 plan；服务只消费现有标量草稿，预览候选不参与写入。
    const chosen = [{ planIndex: 0, plan: { ...plan, draft: { ...plan.draft,
        phone: "11002", email: "second@example.test", website: "https://second.example.test" } } }];
    state.failField = true;
    const report = await importVcfContacts(settings, chosen);
    assert.equal(report.unknown.length, 1);
    const original = { ...chosen[0].plan.checkpoint! };
    assert.deepEqual(state.writes.map((write) => write.keyID).sort(), ["email", "phone", "website"]);
    assert.ok(state.writes.every((write) => !JSON.stringify(write).includes("11001") && !JSON.stringify(write).includes("first.example.test") && !JSON.stringify(write).includes("first@example.test")));
    state.failField = false;
    const retry = await retryVcfContacts(settings, [{ ...chosen[0], failedFields: report.results[0].failedFields }]);
    assert.equal(retry[0].status, "imported");
    assert.equal(state.creates.length, 1);
    assert.equal(chosen[0].plan.checkpoint!.requestId, original.requestId);
    assert.equal(chosen[0].plan.checkpoint!.docId, original.docId);
    const row = state.rows.get(chosen[0].plan.checkpoint!.itemId!);
    assert.equal(row?.cells.find((cell) => cell.value.keyID === "phone")?.value.phone.content, "11002");
    assert.equal(row?.cells.find((cell) => cell.value.keyID === "email")?.value.email.content, "second@example.test");
    assert.equal(row?.cells.find((cell) => cell.value.keyID === "website")?.value.url.content, "https://second.example.test");
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

test("AG-E35-VCARD-EXPORT-SCOPE 服务层：exportVcfText 支持 explicitPeople 与 itemIds 范围选择", async () => {
    fixture();
    const explicitPeople = [
        { docId: "d1", itemId: "i1", name: "张三", phone: "13800000001", email: "z3@example.com", website: "", birthday: "", isLunar: false, group: "", tags: [], relatedItemIds: [] },
        { docId: "d2", itemId: "i2", name: "李四", phone: "13800000002", email: "l4@example.com", website: "", birthday: "", isLunar: false, group: "", tags: [], relatedItemIds: [] },
    ];
    // 1. 显式列表导出（当前筛选或已选人员直接传入）
    const explicitText = await exportVcfText(settings, { explicitPeople });
    assert.match(explicitText, /FN:张三/);
    assert.match(explicitText, /FN:李四/);
    assert.equal(explicitText.split("BEGIN:VCARD").length - 1, 2);

    // 2. 空列表安全降级
    const emptyText = await exportVcfText(settings, { explicitPeople: [] });
    assert.equal(emptyText, "");
});
