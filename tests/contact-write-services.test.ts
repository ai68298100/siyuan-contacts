import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import type { Plugin } from "siyuan";
import type { AvRow, AvValue } from "../src/api/av.ts";
import type { ContactsSettings } from "../src/domain/model.ts";
import type { PersonRelationshipLabels } from "../src/domain/person-relationship-labels.ts";
import type { ContactSummary } from "../src/domain/person.ts";
import type { DocumentImportQueue } from "../src/domain/import.ts";

const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
        if (specifier === "siyuan") return { shortCircuit: true, url: "data:text/javascript," + encodeURIComponent(
            "export function fetchPost(route,body,callback,timeout,failure){globalThis.__lvctContactWriteTestRequest(route,body).then(callback,failure);}"), };
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

const { updateContactFields, retryContactFields, batchUpdateContacts, writeDraftCells, listContactPage } = await import("../src/services/contacts.ts");
const { bindPeopleProfileStorage, loadPersonRelationshipLabels, savePersonRelationshipLabels } = await import("../src/services/people-profiles.ts");
const { withStoreLock } = await import("../src/data/storage.ts");
const { loadRelationshipLabelStore, RELATIONSHIP_LABEL_STORAGE_KEY } = await import("../src/data/person-relationship-labels.ts");
const { importMigrationBundle, MIGRATION_BUNDLE_STORAGE_KEY, MIGRATION_COVERAGE } = await import("../src/services/migration-bundle.ts");
const { invalidateRoster } = await import("../src/services/roster.ts");
const { runDocumentImportQueue, writeImportFields } = await import("../src/services/import.ts");
const { importAnchor } = await import("../src/domain/import.ts");
const { FIELD_SPECS } = await import("../src/domain/fields.ts");
const { emptyDraft } = await import("../src/domain/person.ts");
const { changedContactWriteFields } = await import("../src/domain/contact-write.ts");
const { MigrationWriteUnknownError } = await import("../src/domain/migration-records.ts");
test.after(() => hooks.deregister());

const personDocId = "20261004000000-person1";
const personItemId = "20261004000000-prow001";
const selfDocId = "20261004000000-self001";
const selfItemId = "20261004000000-srow001";
let fixtureNumber = 0;

function fixture(options: { wrappedSetterResponse?: boolean } = {}) {
    fixtureNumber += 1;
    invalidateRoster();
    const fieldMap = Object.fromEntries(FIELD_SPECS.map((field) => [field.key, field.key])) as ContactsSettings["fieldMap"];
    const settings: ContactsSettings = {
        schemaVersion: 1, notebookId: "20261004000000-book001", notebookName: "隔离夹具",
        hostDocId: "20261004000000-host001", dbBlockId: "20261004000000-db00001",
        avId: `20261004000000-av${String(fixtureNumber).padStart(5, "0")}`, fieldMap, initializedAt: "2026-10-04",
    };
    const personRow: AvRow = { id: personItemId, cells: [
        { valueType: "block", value: { keyID: "primary", type: "block", block: { id: personDocId, content: "人物" } } },
        { valueType: "phone", value: { keyID: "phone", type: "phone", phone: { content: "old-phone" } } },
        { valueType: "email", value: { keyID: "email", type: "email", email: { content: "old@example.com" } } },
        { valueType: "mSelect", value: { keyID: "tags", type: "mSelect", mSelect: [{ content: "原标签" }] } },
    ] };
    const state = {
        columns: FIELD_SPECS.map((field) => ({ id: String(field.key), type: String(field.type), name: field.nameZh })),
        rows: [personRow, { id: selfItemId, cells: [
            { valueType: "block", value: { keyID: "primary", type: "block", block: { id: selfDocId, content: "本人" } } },
        ] } as AvRow],
        docs: new Set([personDocId, selfDocId]), store: new Map<string, unknown>(),
        mappingOverrides: new Map<string, string>(),
        outcomes: new Map<string, "reject" | "permission" | "transport" | "accepted_stale" | "bad_response">(),
        writes: [] as { itemId: string; field: string; value: unknown }[], jsonWrites: 0, renders: 0, queries: [] as string[],
        failRender: false, failDocuments: false, failReadback: false, dropLabels: false,
        lastLabels: undefined as unknown,
        onJsonSave: undefined as (() => void) | undefined,
        onCell: undefined as (() => Promise<void>) | undefined,
        onLabelRead: undefined as (() => void) | undefined,
    };
    state.store.set("contacts-settings.json", settings);
    state.store.set("self-identity.json", { schemaVersion: 1, selfDocId, selfItemId, createdAt: "2026-10-04" });
    const plugin = {
        async loadData(key: string) {
            if (key === RELATIONSHIP_LABEL_STORAGE_KEY) state.onLabelRead?.();
            if (state.failReadback && state.jsonWrites && key === RELATIONSHIP_LABEL_STORAGE_KEY) throw new Error("回读断开");
            return structuredClone(state.store.get(key) ?? null);
        },
        async saveData(key: string, value: unknown) {
            state.jsonWrites += 1;
            if (key === RELATIONSHIP_LABEL_STORAGE_KEY) state.lastLabels = structuredClone(value);
            if (!state.dropLabels || key !== RELATIONSHIP_LABEL_STORAGE_KEY) state.store.set(key, structuredClone(value));
            state.onJsonSave?.();
        },
    } as unknown as Plugin;
    const accepted = (data: unknown = null) => ({ code: 0, msg: "", data });
    const handler = async (route: string, body: Record<string, any>) => {
        if (route === "/api/av/renderAttributeView") {
            state.renders += 1;
            if (state.failRender) throw new Error("渲染断开");
            const page = typeof body.page === "number" ? body.page : undefined;
            const pageSize = typeof body.pageSize === "number" ? body.pageSize : undefined;
            const query = typeof body.query === "string" ? body.query : "";
            state.queries.push(query);
            const sourceRows = query
                ? state.rows.filter((row) => row.cells.some((cell) => cell.value.block?.content?.includes(query)))
                : state.rows;
            const rows = page !== undefined && pageSize !== undefined
                ? sourceRows.slice((page - 1) * pageSize, page * pageSize)
                : sourceRows;
            return accepted({ view: {
                columns: state.columns,
                rows: structuredClone(rows),
                ...(page !== undefined ? { rowCount: sourceRows.length } : {}),
            } });
        }
        if (route === "/api/av/getAttributeViewItemIDsByBoundIDs") {
            return accepted(Object.fromEntries(body.blockIDs.flatMap((docId: string) => {
                const row = state.rows.find((entry) => entry.cells.some((cell) => cell.value.block?.id === docId));
                return row ? [[docId, state.mappingOverrides.get(docId) ?? row.id]] : [];
            })));
        }
        if (route === "/api/av/setAttributeViewBlockAttr") {
            state.writes.push({ itemId: body.itemID, field: body.keyID, value: structuredClone(body.value) });
            await state.onCell?.();
            const outcome = state.outcomes.get(body.keyID);
            if (outcome === "reject" || outcome === "permission") return { code: -1, msg: outcome === "permission" ? "permission denied" : "明确拒绝", data: null };
            if (outcome === "transport") throw new Error("连接断开，内核可能稍后写入");
            const type = FIELD_SPECS.find((field) => field.key === body.keyID)!.type;
            const value: AvValue = { keyID: body.keyID, blockID: body.itemID, type, ...structuredClone(body.value) };
            if (outcome !== "accepted_stale") {
                const row = state.rows.find((entry) => entry.id === body.itemID)!;
                row.cells = row.cells.filter((cell) => cell.value.keyID !== body.keyID);
                row.cells.push({ valueType: type, value: structuredClone(value) });
            }
            return outcome === "bad_response" ? accepted({ invalid: true })
                : accepted(options.wrappedSetterResponse ? { value } : null);
        }
        if (route === "/api/sqlite/flushTransaction") return accepted();
        if (route === "/api/query/sql") {
            if (state.failDocuments) throw new Error("文档事实读取断开");
            if (body.stmt.includes("root_id")) return accepted([]);
            const docId = body.stmt.match(/id\s*=\s*'([^']+)'/)?.[1];
            const row = state.rows.find((entry) => entry.cells.some((cell) => cell.value.block?.id === docId));
            const content = row?.cells.find((cell) => cell.value.block?.id === docId)?.value.block?.content ?? "人物";
            return accepted(state.docs.has(docId) ? [{ id: docId, content }] : []);
        }
        throw new Error(`未配置测试端点 ${route}`);
    };
    (globalThis as unknown as { __lvctContactWriteTestRequest: typeof handler }).__lvctContactWriteTestRequest = handler;
    return {
        state, settings, plugin,
        target: { docId: personDocId, itemId: personItemId },
        draft: { ...emptyDraft(), name: "人物", phone: "new-phone", email: "new@example.com", tags: ["原标签"] },
        phone: () => personRow.cells.find((cell) => cell.value.keyID === "phone")!.value.phone!,
        tags: () => personRow.cells.find((cell) => cell.value.keyID === "tags")!.value.mSelect!.map((tag) => tag.content),
    };
}

test("真实 setter data.value 与省略空选项支持完整编辑生日，接受状态仍由独立回读核实", async () => {
    const { state, settings, target, draft } = fixture({ wrappedSetterResponse: true });
    delete state.rows[0].cells.find((cell) => cell.value.keyID === "tags")!.value.mSelect;
    state.rows[0].cells.push({ valueType: "select", value: { keyID: "group", type: "select" } });
    const submitted = { ...draft, birthday: "1990-05-20", isLunar: true, group: "", tags: [] };
    const report = await updateContactFields(settings, personItemId, submitted, { expected: target });
    assert.equal(report.complete, true);
    assert.deepEqual(report.unresolved, []);
    assert.deepEqual(report.accepted, ["phone", "email", "birthday", "lunarBirthday"]);
    assert.deepEqual(state.writes.map((write) => write.field), report.accepted);
    for (const field of ["group", "tags"] as const) {
        const result = report.results.find((entry) => entry.field === field)!;
        assert.equal(result.status, "applied");
        assert.equal(result.requestStatus, "not_sent");
        assert.equal(Object.hasOwn(state.rows[0].cells.find((cell) => cell.value.keyID === field)!.value, "mSelect"), false);
    }
    assert.equal(state.rows[0].cells.find((cell) => cell.value.keyID === "birthday")!.value.date!.content,
        new Date(1990, 4, 20).getTime());
    assert.equal(state.rows[0].cells.find((cell) => cell.value.keyID === "lunarBirthday")!.value.checkbox!.checked, true);
});

test("真实 setter data.value 已接受不能代替回读，旧值保持未知且重试零重发", async () => {
    const { state, settings, target, draft, phone } = fixture({ wrappedSetterResponse: true });
    state.outcomes.set("phone", "accepted_stale");
    const first = await updateContactFields(settings, personItemId, draft, { expected: target, onlyFields: ["phone"] });
    assert.deepEqual(first.accepted, ["phone"]);
    assert.deepEqual(first.unknown.map((entry) => entry.field), ["phone"]);
    assert.deepEqual(first.failed, []);
    assert.equal(first.complete, false);
    state.outcomes.delete("phone");
    const pending = await retryContactFields(settings, personItemId, draft, ["phone"], target);
    assert.equal(pending.complete, false);
    assert.equal(state.writes.length, 1);
    assert.equal(phone().content, "old-phone");
    phone().content = draft.phone;
    const verified = await retryContactFields(settings, personItemId, draft, ["phone"], target);
    assert.equal(verified.complete, true);
    assert.equal(state.writes.length, 1);
});

test("编辑重试只补失败邮箱，已完成电话被并发修改后保持当前值", async () => {
    const { state, settings, target, draft, phone } = fixture();
    state.outcomes.set("email", "reject");
    const first = await updateContactFields(settings, personItemId, draft, { expected: target });
    assert.deepEqual(first.unresolved.map((failure) => failure.field), ["email"]);
    phone().content = "concurrent-phone";
    state.outcomes.delete("email");
    const retry = await retryContactFields(settings, personItemId, draft, first.unresolved.map((failure) => failure.field), target);
    assert.equal(retry.complete, true);
    assert.equal(phone().content, "concurrent-phone");
    assert.deepEqual(state.writes.map((write) => write.field), ["phone", "email", "email"]);
});

test("明确拒绝可重试，拒绝后基线被改变则禁止覆盖", async () => {
    for (const outcome of ["reject", "permission"] as const) {
        const { state, settings, target, draft, phone } = fixture();
        state.outcomes.set("phone", outcome);
        const first = await updateContactFields(settings, personItemId, draft, { expected: target, onlyFields: ["phone"] });
        assert.equal(first.failed.length, 1);
        phone().content = "concurrent";
        state.outcomes.delete("phone");
        const retry = await retryContactFields(settings, personItemId, draft, ["phone"], target);
        assert.equal(retry.complete, false);
        assert.equal(state.writes.length, 1);
        assert.equal(phone().content, "concurrent");
    }
});

test("传输未知及已接受但旧值回读均不盲重发，换输入也不能绕过", async () => {
    for (const outcome of ["transport", "accepted_stale"] as const) {
        const { state, settings, target, draft, phone } = fixture();
        state.outcomes.set("phone", outcome);
        const first = await updateContactFields(settings, personItemId, draft, { expected: target, onlyFields: ["phone"] });
        assert.equal(first.unknown.length, 1);
        state.outcomes.delete("phone");
        assert.equal((await retryContactFields(settings, personItemId, draft, ["phone"], target)).complete, false);
        assert.equal((await writeDraftCells(settings, personItemId, { ...draft, phone: "different" }, { mode: "edit", onlyFields: ["phone"], expected: target })).complete, false);
        assert.equal(state.writes.length, 1);
        phone().content = draft.phone;
        assert.equal((await retryContactFields(settings, personItemId, draft, ["phone"], target)).complete, true);
        assert.equal(state.writes.length, 1);
    }
});

test("写后读取失败保持未知，坏响应实际已落库可以回读核实", async () => {
    const { state, settings, draft, target } = fixture();
    state.onCell = async () => { state.failRender = true; };
    const first = await updateContactFields(settings, personItemId, draft, { expected: target, onlyFields: ["phone"] });
    assert.equal(first.unknown.length, 1);
    state.failRender = false;
    state.onCell = undefined;
    assert.equal((await retryContactFields(settings, personItemId, draft, ["phone"], target)).complete, true);
    assert.equal(state.writes.length, 1);
    state.outcomes.set("email", "bad_response");
    assert.equal((await updateContactFields(settings, personItemId, draft, { expected: target, onlyFields: ["email"] })).complete, true);
});

test("无原请求证据的重试只读；人物行换绑、字段键变化都不能转移原请求", async () => {
    const { state, settings, draft, target } = fixture();
    assert.equal((await retryContactFields(settings, personItemId, draft, ["phone"], target)).complete, false);
    assert.equal(state.writes.length, 0);
    state.outcomes.set("phone", "reject");
    await updateContactFields(settings, personItemId, draft, { expected: target, onlyFields: ["phone"] });
    const block = state.rows[0].cells.find((cell) => cell.value.type === "block")!.value.block!;
    block.id = "20261004000000-other01";
    assert.equal((await retryContactFields(settings, personItemId, draft, ["phone"], target)).complete, false);
    assert.equal(state.writes.length, 1);
    block.id = personDocId;
    state.columns.push({ id: "phone-new", type: "phone", name: "新电话字段" });
    const changedSettings = { ...settings, fieldMap: { ...settings.fieldMap, phone: "phone-new" } };
    assert.equal((await retryContactFields(changedSettings, personItemId, draft, ["phone"], target)).complete, false);
    assert.equal(state.writes.length, 1);
});

test("批量标签追加并发读改写保留双方标签，同批同人两项也不覆盖", async () => {
    const { state, settings, tags, target } = fixture();
    const results = await Promise.all([
        batchUpdateContacts(settings, [{ itemId: personItemId, tagsToAdd: ["甲"], expected: { ...target, group: "" } }]),
        batchUpdateContacts(settings, [{ itemId: personItemId, tagsToAdd: ["乙"], expected: { ...target, group: "" } }]),
    ]);
    assert.equal(results.every(([entry]) => entry.report.complete), true);
    assert.deepEqual(new Set(tags()), new Set(["原标签", "甲", "乙"]));
    await batchUpdateContacts(settings, [{ itemId: personItemId, tagsToAdd: ["丙"] }, { itemId: personItemId, tagsToAdd: ["丁"] }]);
    assert.deepEqual(new Set(tags()), new Set(["原标签", "甲", "乙", "丙", "丁"]));
    assert.equal(state.writes.length, 4);
});

test("标签替换与追加共用写锁，追加基于已核实的替换结果", async () => {
    const { state, settings, target, draft, tags } = fixture();
    await Promise.all([
        updateContactFields(settings, personItemId, { ...draft, tags: ["替换"] }, { expected: target, onlyFields: ["tags"] }),
        batchUpdateContacts(settings, [{ itemId: personItemId, tagsToAdd: ["追加"] }]),
    ]);
    assert.deepEqual(tags(), ["替换", "追加"]);
    assert.equal(state.writes.length, 2);
});

test("未知标签追加重试冻结原组合，不根据新快照重算并覆盖", async () => {
    const { state, settings, target } = fixture();
    state.outcomes.set("tags", "transport");
    const update = { itemId: personItemId, tagsToAdd: ["甲"], expected: { ...target, group: "" } };
    assert.equal((await batchUpdateContacts(settings, [update]))[0].report.unknown.length, 1);
    state.outcomes.delete("tags");
    state.rows[0].cells.find((cell) => cell.value.keyID === "tags")!.value.mSelect!.push({ content: "并发" });
    const retry = await batchUpdateContacts(settings, [update], { onlyFieldsByItem: { [personItemId]: ["tags"] } });
    assert.equal(retry[0].report.complete, false);
    const changed = await batchUpdateContacts(settings, [{ ...update, tagsToAdd: ["乙"] }], { verifyBeforeWrite: true });
    assert.equal(changed[0].report.complete, false);
    assert.equal(state.writes.length, 1);
});

test("已核实字段即使被错误列入重试也不回退并发值", async () => {
    const { state, settings, target, draft, phone } = fixture();
    await updateContactFields(settings, personItemId, draft, { expected: target, onlyFields: ["phone"] });
    phone().content = "concurrent";
    assert.equal((await retryContactFields(settings, personItemId, draft, ["phone"], target)).complete, false);
    assert.equal(phone().content, "concurrent");
    assert.equal(state.writes.length, 1);
});

function importQueue(settings: ContactsSettings, unresolvedFields?: DocumentImportQueue["items"][number]["unresolvedFields"]): DocumentImportQueue {
    return {
        anchor: importAnchor(settings), group: "客户", tags: ["本次"],
        items: [{ docId: personDocId, itemId: personItemId, name: "人物", notebookId: settings.notebookId,
            hpath: "/人物", binding: "verified", status: unresolvedFields ? "unknown" : "pending",
            baseline: { ...emptyDraft(), name: "人物" }, ...(unresolvedFields ? { unresolvedFields } : {}),
        }],
    };
}

test("导入队列未知字段重试只核实原请求，不触碰已完成标签及并发修改", async () => {
    const { state, settings, tags } = fixture();
    const queue = importQueue(settings);
    state.outcomes.set("group", "transport");
    await runDocumentImportQueue(settings, queue);
    assert.equal(queue.items[0].status, "unknown");
    assert.deepEqual(queue.items[0].unresolvedFields, ["group"]);
    state.outcomes.delete("group");
    state.rows[0].cells.find((cell) => cell.value.keyID === "tags")!.value.mSelect!.push({ content: "并发" });
    await runDocumentImportQueue(settings, queue, { retryOnly: true });
    assert.equal(queue.items[0].status, "unknown");
    assert.deepEqual(state.writes.map((write) => write.field), ["group", "tags"]);
    assert.deepEqual(new Set(tags()), new Set(["原标签", "本次", "并发"]));
    state.rows[0].cells.push({ valueType: "select", value: { keyID: "group", type: "select", mSelect: [{ content: "客户" }] } });
    await runDocumentImportQueue(settings, queue, { retryOnly: true });
    assert.equal(queue.items[0].status, "applied");
    assert.equal(state.writes.length, 2);
});

test("导入队列仅明确拒绝且保留原证据的标签可补写，成功分组并发改变不回退", async () => {
    const { state, settings, tags } = fixture();
    const queue = importQueue(settings);
    state.outcomes.set("tags", "reject");
    await runDocumentImportQueue(settings, queue);
    assert.equal(queue.items[0].status, "failed");
    assert.deepEqual(queue.items[0].unresolvedFields, ["tags"]);
    const group = state.rows[0].cells.find((cell) => cell.value.keyID === "group")!;
    group.value.mSelect = [{ content: "并发分组" }];
    state.outcomes.delete("tags");
    await runDocumentImportQueue(settings, queue, { retryOnly: true });
    assert.equal(queue.items[0].status, "applied");
    assert.deepEqual(group.value.mSelect, [{ content: "并发分组" }]);
    assert.deepEqual(new Set(tags()), new Set(["原标签", "本次"]));
    assert.deepEqual(state.writes.map((write) => write.field), ["group", "tags", "tags"]);
});

test("导入重试无原内存证据时保持未知、零写入，匹配当前值可以只读收口", async () => {
    const { state, settings, target, draft, phone } = fixture();
    const queue = importQueue(settings, ["group", "tags"]);
    await runDocumentImportQueue(settings, queue, { retryOnly: true });
    assert.equal(queue.items[0].status, "unknown");
    assert.equal(state.writes.length, 0);
    const baseline = { ...draft, phone: "old-phone" };
    const first = await writeImportFields(settings, target, baseline, draft, ["phone"], { retry: true });
    assert.equal(first.report.unknown.length, 1);
    assert.equal(state.writes.length, 0);
    phone().content = draft.phone;
    const recovered = await writeImportFields(settings, target, baseline, draft, ["phone"], { retry: true });
    assert.equal(recovered.report.complete, true);
    assert.equal(state.writes.length, 0);
});

test("导入服务保留未知标签原组合，不根据新标签重算请求，回读原组合后零重写", async () => {
    const { state, settings, target, draft, tags } = fixture();
    const submitted = { ...draft, tags: ["本次"] };
    state.outcomes.set("tags", "accepted_stale");
    const first = await writeImportFields(settings, target, draft, submitted, ["tags"]);
    assert.equal(first.report.unknown.length, 1);
    state.outcomes.delete("tags");
    const cell = state.rows[0].cells.find((entry) => entry.value.keyID === "tags")!;
    cell.value.mSelect!.push({ content: "并发" });
    const second = await writeImportFields(settings, target, draft, submitted, ["tags"]);
    assert.equal(second.report.unknown.length, 1);
    assert.deepEqual(tags(), ["原标签", "并发"]);
    assert.equal(state.writes.length, 1);
    cell.value.mSelect = [{ content: "原标签" }, { content: "本次" }];
    assert.equal((await writeImportFields(settings, target, draft, submitted, ["tags"])).report.complete, true);
    assert.equal(state.writes.length, 1);
});

test("导入新增选择字段仍可首次写入，不把未曾选择的字段当未知重试", async () => {
    const { state, settings, target, draft } = fixture();
    const baseline = { ...draft, phone: "old-phone", email: "old@example.com" };
    assert.equal((await writeImportFields(settings, target, baseline, draft, ["phone"])).report.complete, true);
    assert.equal((await writeImportFields(settings, target, baseline, draft, ["email"])).report.complete, true);
    assert.deepEqual(state.writes.map((write) => write.field), ["phone", "email"]);
});

test("导入未知字段在并发值或绑定变化后不改判可重发失败，缺口仍保留", async () => {
    const { state, settings, target, draft, phone } = fixture();
    const baseline = { ...draft, phone: "old-phone" };
    state.outcomes.set("phone", "transport");
    await writeImportFields(settings, target, baseline, draft, ["phone"]);
    state.outcomes.delete("phone");
    phone().content = "并发电话";
    const result = await writeImportFields(settings, target, baseline, draft, ["phone"]);
    assert.equal(result.report.unknown.length, 1);
    assert.equal(result.report.failed.length, 0);
    assert.equal(state.writes.length, 1);
    state.mappingOverrides.set(personDocId, "20261004000000-other01");
    await assert.rejects(writeImportFields(settings, target, baseline, draft, ["phone"], { retry: true }), /绑定行已变化/);
    assert.equal(state.writes.length, 1);
});

test("导入明确拒绝的农历标记遇到生日参照变化后仍禁止补写", async () => {
    const { state, settings, target, draft } = fixture();
    const baseline = { ...draft, birthday: "2001-02-03", isLunar: false };
    state.rows[0].cells.push({ valueType: "date", value: { keyID: "birthday", type: "date", date: { content: new Date(2001, 1, 3).getTime(), isNotEmpty: true } } });
    state.outcomes.set("lunarBirthday", "reject");
    const submitted = { ...baseline, isLunar: true };
    assert.equal((await writeImportFields(settings, target, baseline, submitted, ["lunarBirthday"])).report.failed.length, 1);
    state.rows[0].cells.find((cell) => cell.value.keyID === "birthday")!.value.date!.content = new Date(2002, 1, 3).getTime();
    state.outcomes.delete("lunarBirthday");
    const result = await writeImportFields(settings, target, baseline, submitted, ["lunarBirthday"]);
    assert.equal(result.report.unknown.length, 1);
    assert.equal(state.writes.length, 1);
});

function detailRefreshController(initial: ContactSummary, listContacts: () => Promise<ContactSummary[]>) {
    const source = readFileSync(new URL("../src/components/people/PersonDetail.svelte", import.meta.url), "utf8")
        .replace(/\r\n/g, "\n")
        .match(/async function loadOthers\(\) \{[\s\S]*?\n    \}\n\n    loadOthers\(\);/)![0].replace(/\n\n    loadOthers\(\);$/, "");
    const script = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.None } }).outputText;
    return new Function("listContacts", "initial",
        "let settings={}; let current=initial; let detailAlive=true; let othersRequest=0; let othersLoading=false; let othersError=''; let others=[];\n"
        + script + "\nreturn {loadOthers,state(){return {current,others,othersError}},select(person){current=person},dispose(){detailAlive=false;othersRequest++}};")(listContacts, initial);
}

test("详情实际刷新逻辑：文档与行必须同时唯一匹配，换绑和重复保持原人物", async () => {
    const original: ContactSummary = { ...emptyDraft(), name: "原人物", docId: personDocId, itemId: personItemId, relatedItemIds: [] };
    const other: ContactSummary = { ...original, docId: "20261004000000-other01", name: "换绑人物" };
    for (const people of [[other], [{ ...original, itemId: "20261004000000-other02" }], [original, other], [original, { ...original }], []]) {
        const controller = detailRefreshController(original, async () => people);
        await controller.loadOthers();
        assert.equal(controller.state().current, original);
        assert.match(controller.state().othersError, /绑定已变化或不唯一/);
    }
    const refreshed = { ...original, phone: "最新电话" };
    const controller = detailRefreshController(original, async () => [refreshed]);
    await controller.loadOthers();
    assert.equal(controller.state().current, refreshed);
    assert.equal(controller.state().othersError, "");
});

test("详情实际刷新逻辑：迟到响应不能覆盖已切换人物或已销毁详情", async () => {
    const original: ContactSummary = { ...emptyDraft(), name: "原人物", docId: personDocId, itemId: personItemId, relatedItemIds: [] };
    const next = { ...original, docId: selfDocId, itemId: selfItemId, name: "新人物" };
    let release!: (people: ContactSummary[]) => void;
    const response = new Promise<ContactSummary[]>((resolve) => { release = resolve; });
    const controller = detailRefreshController(original, () => response);
    const pending = controller.loadOthers();
    controller.select(next);
    release([{ ...original, phone: "迟到电话" }]);
    await pending;
    assert.equal(controller.state().current, next);
    assert.deepEqual(controller.state().others, []);
    const disposed = detailRefreshController(original, async () => [{ ...original, phone: "迟到电话" }]);
    const abandoned = disposed.loadOthers();
    disposed.dispose();
    await abandoned;
    assert.equal(disposed.state().current, original);
    let reject!: (error: Error) => void;
    const failure = new Promise<ContactSummary[]>((_resolve, rejectResponse) => { reject = rejectResponse; });
    const failed = detailRefreshController(original, () => failure);
    const delayed = failed.loadOthers();
    failed.select(next);
    reject(new Error("旧人物读取失败"));
    await delayed;
    assert.equal(failed.state().othersError, "");
});

function labelRecord(labels = ["同学"]): PersonRelationshipLabels {
    return { id: "20261004000000-label01", selfDocId, personDocId, labels, createdAt: 1, updatedAt: 1 };
}

function bundle(records: PersonRelationshipLabels[]) {
    return JSON.stringify({ schemaVersion: 1, storageKey: MIGRATION_BUNDLE_STORAGE_KEY, modules: { relationshipLabels: { schemaVersion: 1, labels: records } } });
}

test("称谓未知清空：记录缺失不能当空墓碑核实，原记录回读后才收敛", async () => {
    const { state, plugin, settings } = fixture();
    state.dropLabels = true;
    await assert.rejects(savePersonRelationshipLabels(plugin, settings, personDocId, selfDocId, [], null), MigrationWriteUnknownError);
    assert.equal(state.jsonWrites, 2);
    await assert.rejects(loadPersonRelationshipLabels(plugin, settings, personDocId), MigrationWriteUnknownError);
    await assert.rejects(savePersonRelationshipLabels(plugin, settings, personDocId, selfDocId, [], null), MigrationWriteUnknownError);
    assert.equal(state.jsonWrites, 2);
    state.store.set(RELATIONSHIP_LABEL_STORAGE_KEY, structuredClone(state.lastLabels));
    const recovered = await loadPersonRelationshipLabels(plugin, settings, personDocId);
    assert.ok(recovered.record?.id);
    assert.deepEqual(recovered.record.labels, []);
    assert.equal(state.jsonWrites, 2);
});

test("称谓未知请求在新数据库锚点上不能核实，即使 doc 与 item 恰好相同", async () => {
    const { state, plugin, settings } = fixture();
    state.failReadback = true;
    await assert.rejects(savePersonRelationshipLabels(plugin, settings, personDocId, selfDocId, ["朋友"], null), MigrationWriteUnknownError);
    state.failReadback = false;
    await assert.rejects(loadPersonRelationshipLabels(plugin, { ...settings, avId: "20261004000000-other01" }, personDocId), /原数据库锚点/);
    assert.deepEqual((await loadPersonRelationshipLabels(plugin, settings, personDocId)).record?.labels, ["朋友"]);
    assert.equal(state.jsonWrites, 1);
});

test("称谓正常清空保留原 id、创建时间，迁移旧非空记录不复活", async () => {
    const { state, plugin, settings } = fixture();
    const original = labelRecord();
    state.store.set(RELATIONSHIP_LABEL_STORAGE_KEY, { schemaVersion: 1, labels: [original] });
    const cleared = await savePersonRelationshipLabels(plugin, settings, personDocId, selfDocId, [], original);
    assert.equal(cleared.id, original.id);
    assert.equal(cleared.createdAt, original.createdAt);
    assert.deepEqual(cleared.labels, []);
    const migration = await importMigrationBundle(plugin, bundle([original]));
    assert.equal(migration.issues[0].reason, "conflict");
    assert.deepEqual((await loadRelationshipLabelStore(plugin)).labels[0].labels, []);
    assert.equal(state.jsonWrites, 1);
});

test("称谓并发修改按原记录比较，不以新草稿覆盖已保存称谓", async () => {
    const { state, plugin, settings } = fixture();
    const initial = labelRecord();
    state.store.set(RELATIONSHIP_LABEL_STORAGE_KEY, { schemaVersion: 1, labels: [initial] });
    const results = await Promise.allSettled([
        savePersonRelationshipLabels(plugin, settings, personDocId, selfDocId, ["朋友"], initial),
        savePersonRelationshipLabels(plugin, settings, personDocId, selfDocId, ["同事"], initial),
    ]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(state.jsonWrites, 1);
    assert.deepEqual((await loadRelationshipLabelStore(plugin)).labels[0].labels, ["朋友"]);
});

test("称谓编辑及恢复必须核实实际文档、唯一绑定和官方 item 映射", async () => {
    for (const fault of ["person_deleted", "self_deleted", "mapping", "duplicate"] as const) {
        const { state, plugin, settings } = fixture();
        if (fault === "person_deleted") state.docs.delete(personDocId);
        if (fault === "self_deleted") state.docs.delete(selfDocId);
        if (fault === "mapping") state.mappingOverrides.set(personDocId, "20261004000000-other01");
        if (fault === "duplicate") state.rows.push({ ...structuredClone(state.rows[0]), id: "20261004000000-other01" });
        await assert.rejects(savePersonRelationshipLabels(plugin, settings, personDocId, selfDocId, ["朋友"], null));
        const result = await importMigrationBundle(plugin, bundle([labelRecord()]));
        assert.equal(result.failed.length, 0, fault);
        assert.equal(result.modules[0].merged, 0, fault);
        assert.equal(result.issues[0].reason, "unreachable", fault);
        assert.equal(state.jsonWrites, 0, fault);
    }
});

test("称谓恢复故障读取不当空库，零写入并保留失败模块重试包", async () => {
    const { state, plugin } = fixture();
    state.failDocuments = true;
    const result = await importMigrationBundle(plugin, bundle([labelRecord()]));
    assert.equal(result.modules.length, 0);
    assert.equal(result.failed[0].status, "failed");
    assert.ok(result.retryBundle);
    assert.equal(state.jsonWrites, 0);
});

test("称谓写后人物换行或本人换绑保持未知，不用新绑定核实旧写入", async () => {
    for (const fault of ["person_row", "self_identity"] as const) {
        const { state, plugin, settings } = fixture();
        state.onJsonSave = () => {
            if (fault === "person_row") state.rows[0].id = "20261004000000-other01";
            else state.store.set("self-identity.json", { schemaVersion: 1, selfDocId: personDocId, selfItemId: personItemId, createdAt: "2026-10-04" });
        };
        await assert.rejects(savePersonRelationshipLabels(plugin, settings, personDocId, selfDocId, ["朋友"], null), MigrationWriteUnknownError);
        await assert.rejects(loadPersonRelationshipLabels(plugin, settings, personDocId));
        assert.equal(state.jsonWrites, 1);
    }
});

test("称谓恢复写后删除、映射变化、锚点变化或回读故障不能报模块成功", async () => {
    for (const fault of ["deleted", "mapping", "settings", "readback", "identity"] as const) {
        const { state, plugin, settings } = fixture();
        state.onJsonSave = () => {
            if (fault === "deleted") state.docs.delete(personDocId);
            if (fault === "mapping") state.mappingOverrides.set(personDocId, "20261004000000-other01");
            if (fault === "settings") state.store.set("contacts-settings.json", { ...settings, avId: "20261004000000-other01" });
            if (fault === "readback") state.failReadback = true;
            if (fault === "identity") state.store.set("self-identity.json", null);
        };
        const result = await importMigrationBundle(plugin, bundle([labelRecord()]));
        assert.equal(result.modules.length, 0, fault);
        assert.equal(result.failed[0].status, "unknown", fault);
        assert.ok(result.retryBundle, fault);
        assert.equal(state.jsonWrites, 1, fault);
    }
});

test("有效称谓恢复逐项核实，明确空记录恢复且重复导入零写入", async () => {
    const { state, plugin } = fixture();
    const incoming = labelRecord([]);
    const first = await importMigrationBundle(plugin, bundle([incoming]));
    assert.equal(first.modules[0].merged, 1);
    assert.equal(first.failed.length, 0);
    assert.equal((await importMigrationBundle(plugin, bundle([incoming]))).modules[0].merged, 0);
    assert.equal(state.jsonWrites, 1);
    assert.deepEqual((await loadRelationshipLabelStore(plugin)).labels[0], incoming);
    assert.ok(MIGRATION_COVERAGE.some((module) => module.key === "bridge-requests.json" && module.status === "excluded"));
});

test("称谓恢复可达与旧本人记录混合时，成功项写后仅核实自己的原参照", async () => {
    const { state, plugin } = fixture();
    const otherDocId = "20261004000000-other01";
    state.docs.add(otherDocId);
    state.rows.push({ id: "20261004000000-other02", cells: [{ valueType: "block", value: {
        keyID: "primary", type: "block", block: { id: otherDocId, content: "其他人物" },
    } }] });
    const result = await importMigrationBundle(plugin, bundle([labelRecord(), {
        ...labelRecord(), id: "20261004000000-label02", selfDocId: "20261004000000-oldself", personDocId: otherDocId,
    }]));
    assert.equal(result.failed.length, 0);
    assert.equal(result.modules[0].merged, 1);
    assert.equal(result.issues[0].reason, "unreachable");
    assert.equal(state.jsonWrites, 1);
});

function editorController(settings: ContactsSettings, draft: ReturnType<typeof emptyDraft>) {
    const source = readFileSync(new URL("../src/components/people/PersonEditDialog.svelte", import.meta.url), "utf8")
        .match(/<script lang="ts">([\s\S]*?)<\/script>/)![1].replace(/^\s*import[^\n]*;\s*$/gm, "");
    const script = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.None } }).outputText;
    let saved = 0;
    let destroy = () => {};
    const controller = new Function("$props", "$state", "$derived", "useCloseGuard", "translateText", "retryContactFields", "updateContactFields", "PRESET_GROUPS", "changedContactWriteFields", "untrack", "onDestroy",
        script + "\nreturn {persist,retryFailed,setDraft(next){draft=next;tagsText=next.tags.join(' ')},getError(){return errorText}};")(
        () => ({ settings, person: { ...draft, docId: personDocId, itemId: personItemId }, onSaved: () => { saved += 1; }, onClose() {} }),
        (value: unknown) => value, { by: (callback: () => unknown) => callback() }, () => {},
        (_i18n: unknown, _key: unknown, fallback: unknown) => fallback, retryContactFields, updateContactFields, [], changedContactWriteFields,
        (callback: () => unknown) => callback(), (callback: () => void) => { destroy = callback; },
    );
    return { controller, saved: () => saved, destroy: () => destroy() };
}

test("编辑器实际控制逻辑：重试只选未完成字段，原电话并发改变不被回退", async () => {
    const { state, settings, draft, phone } = fixture();
    state.outcomes.set("email", "reject");
    const { controller, saved } = editorController(settings, { ...draft, phone: "old-phone", email: "old@example.com" });
    controller.setDraft(draft);
    await assert.rejects(controller.persist());
    phone().content = "concurrent-phone";
    state.outcomes.delete("email");
    await controller.retryFailed();
    assert.equal(saved(), 1);
    assert.equal(phone().content, "concurrent-phone");
    assert.deepEqual(state.writes.map((write) => write.field), ["phone", "email", "email"]);
});

test("编辑器新输入仅保存改动与明确失败字段；未知原请求换输入不写", async () => {
    const { state, settings, draft, phone } = fixture();
    state.outcomes.set("email", "reject");
    const { controller } = editorController(settings, { ...draft, phone: "old-phone", email: "old@example.com" });
    controller.setDraft(draft);
    await assert.rejects(controller.persist());
    phone().content = "concurrent-phone";
    state.outcomes.delete("email");
    controller.setDraft({ ...draft, email: "corrected@example.com" });
    await controller.persist();
    assert.equal(phone().content, "concurrent-phone");
    assert.deepEqual(state.writes.map((write) => write.field), ["phone", "email", "email"]);

    const unknown = fixture();
    unknown.state.outcomes.set("email", "transport");
    const next = editorController(unknown.settings, { ...unknown.draft, phone: "old-phone", email: "old@example.com" });
    next.controller.setDraft(unknown.draft);
    await assert.rejects(next.controller.persist());
    next.controller.setDraft({ ...unknown.draft, email: "changed@example.com" });
    await assert.rejects(next.controller.persist(), /未知字段/);
    assert.equal(unknown.state.writes.length, 2);
});

test("编辑器销毁后排队保存零写入，已发出电话不继续发送邮箱也不回调", async () => {
    const { state, settings, draft } = fixture();
    const editor = editorController(settings, { ...draft, phone: "old-phone", email: "old@example.com" });
    editor.controller.setDraft(draft);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const occupied = withStoreLock(`contact-write-${settings.avId}`, () => gate);
    const pending = editor.controller.persist();
    editor.destroy();
    release();
    await occupied;
    await assert.rejects(pending, /窗口已关闭/);
    assert.equal(state.writes.length, 0);
    assert.equal(editor.saved(), 0);

    const active = fixture();
    const current = editorController(active.settings, { ...active.draft, phone: "old-phone", email: "old@example.com" });
    current.controller.setDraft(active.draft);
    active.state.onCell = async () => current.destroy();
    await current.controller.persist();
    assert.deepEqual(active.state.writes.map((write) => write.field), ["phone"]);
    assert.equal(current.saved(), 0);
});

test("联系人分页以权威总数停止，正好整页时不会多读或重复读取", async () => {
    const { state, settings } = fixture();
    bindPeopleProfileStorage(undefined);
    state.rows = Array.from({ length: 400 }, (_, index) => {
        const row = structuredClone(state.rows[index % 2]) as AvRow;
        const suffix = index.toString(36).padStart(7, "0");
        row.id = `20261005000000-${suffix}`;
        const primary = row.cells.find((cell) => cell.value.keyID === "primary")!;
        primary.value.block = { id: `20261005000000-${suffix}`, content: `人物 ${index + 1}` };
        return row;
    });

    const first = await listContactPage(settings, 1, 200);
    const second = await listContactPage(settings, 2, 200);
    assert.equal(first.people.length, 200);
    assert.equal(second.people.length, 200);
    assert.equal(first.total, 400);
    assert.equal(second.total, 400);
    assert.equal(first.hasMore, true);
    assert.equal(second.hasMore, false);
    assert.equal(new Set(first.people.map((person) => person.itemId)).size, 200);
    assert.equal(new Set([...first.people, ...second.people].map((person) => person.itemId)).size, 400);
});

test("联系人关键词下推到 AV 分页并按过滤后总数结束读取", async () => {
    const { state, settings } = fixture();
    bindPeopleProfileStorage(undefined);
    state.rows = Array.from({ length: 400 }, (_, index) => {
        const row = structuredClone(state.rows[index % 2]) as AvRow;
        const suffix = index.toString(36).padStart(7, "0");
        row.id = `20261005000000-${suffix}`;
        const primary = row.cells.find((cell) => cell.value.keyID === "primary")!;
        primary.value.block = { id: `20261005000000-${suffix}`, content: `人物 ${index + 1}` };
        return row;
    });

    const result = await listContactPage(settings, 1, 200, "人物 4");

    assert.equal(result.people.length, 12);
    assert.equal(result.total, 12);
    assert.equal(result.hasMore, false);
    assert.equal(state.queries.at(-1), "人物 4");
    assert.ok(result.people.every((person) => person.name.includes("人物 4")));
});

test("称谓绑定释放阻止排队编辑与恢复，旧释放函数不能清除新生命周期", async () => {
    const { state, settings, plugin } = fixture();
    const dispose = bindPeopleProfileStorage(plugin);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const occupied = withStoreLock("self-identity.json", () => gate);
    const pending = savePersonRelationshipLabels(plugin, settings, personDocId, selfDocId, ["朋友"], null);
    const migration = importMigrationBundle(plugin, bundle([labelRecord()]));
    dispose();
    const disposeNext = bindPeopleProfileStorage(plugin);
    dispose();
    release();
    await occupied;
    await assert.rejects(pending, /生命周期已结束/);
    const result = await migration;
    assert.equal(result.failed[0].status, "failed");
    assert.equal(state.jsonWrites, 0);
    await savePersonRelationshipLabels(plugin, settings, personDocId, selfDocId, ["朋友"], null);
    assert.equal(state.jsonWrites, 1);
    disposeNext();
});

test("称谓读取途中卸载零写入，已发出的存储请求保持未知并可在重挂载后核实", async () => {
    const { state, settings, plugin } = fixture();
    const dispose = bindPeopleProfileStorage(plugin);
    state.onLabelRead = dispose;
    await assert.rejects(savePersonRelationshipLabels(plugin, settings, personDocId, selfDocId, ["朋友"], null), /生命周期已结束/);
    assert.equal(state.jsonWrites, 0);
    state.onLabelRead = undefined;
    const disposeNext = bindPeopleProfileStorage(plugin);
    state.onJsonSave = disposeNext;
    await assert.rejects(savePersonRelationshipLabels(plugin, settings, personDocId, selfDocId, ["朋友"], null), MigrationWriteUnknownError);
    assert.equal(state.jsonWrites, 1);
    state.onJsonSave = undefined;
    const disposeRecovery = bindPeopleProfileStorage(plugin);
    const recovered = await loadPersonRelationshipLabels(plugin, settings, personDocId);
    assert.deepEqual(recovered.record?.labels, ["朋友"]);
    assert.equal(state.jsonWrites, 1);
    disposeRecovery();
});

test("独立桥 E2E 导出在纯服务夹具执行：并发、重挂载、逐项失败和孤儿均沿用真实服务", async (context) => {
    const { settings } = fixture();
    const kernel = { handler: async (_route: string, _body: Record<string, unknown>): Promise<unknown> => null };
    const previousWindow = (globalThis as unknown as { window?: Record<string, unknown> }).window;
    (globalThis as unknown as { window: Record<string, unknown> }).window = {};
    const handler = async (route: string, body: Record<string, unknown>) => {
        try { return { code: 0, msg: "", data: await kernel.handler(route, body) }; }
        catch (error) { return { code: -1, msg: error instanceof Error ? error.message : String(error), data: null }; }
    };
    (globalThis as unknown as { __lvctContactWriteTestRequest: typeof handler }).__lvctContactWriteTestRequest = handler;
    try {
        const { runExternalBridgeRegression } = await import("../scripts/e2e/external-bridge-regression.js");
        await runExternalBridgeRegression({
            test: (name: string, scenario: () => Promise<void>) => context.test(name, scenario),
            assert: (condition: unknown, message: string) => assert.ok(condition, message), kernel, settings,
        });
    } finally {
        if (previousWindow === undefined) delete (globalThis as unknown as { window?: Record<string, unknown> }).window;
        else (globalThis as unknown as { window: Record<string, unknown> }).window = previousWindow;
    }
});
