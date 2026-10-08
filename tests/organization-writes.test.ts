import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import ts from "typescript";
import { fileURLToPath } from "node:url";
import type { Plugin } from "siyuan";
import type { ContactsSettings } from "../src/domain/model.ts";
import type { OrganizationCreateOperation, OrganizationRenameOperation } from "../src/domain/organization-operations.ts";
import { organizationIalAttributes, organizationMarkerMarkdown, parseOrganizationOperationStore } from "../src/domain/organization-operations.ts";

type KernelEnvelope = { code: number; msg: string; data: unknown };
const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
        if (specifier === "siyuan") return { shortCircuit: true, url: "data:text/javascript," + encodeURIComponent(
            "export function fetchPost(route,body,callback){globalThis.__lvctOrgTestRequest(route,body).then(value=>{if(value!==undefined)callback(value)},()=>{});}"), };
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
const { startOrganizationCreate, startOrganizationRename, inspectOrganizationOperation, listPendingOrganizationOperations, resumeOrganizationOperation } = await import("../src/services/organization-writes.ts");
const { archiveOrganization, createOrganization, renameOrganization } = await import("../src/services/org.ts");
const { ORGANIZATION_OPERATIONS_STORAGE_KEY, saveOrganizationOperation, loadOrganizationOperations } = await import("../src/data/organization-operations.ts");
const { kernelConfig } = await import("../src/api/client.ts");
test.after(() => hooks.deregister());

const notebookId = "20261004000000-book001";
const docId = "20261004000000-org0001";
const markerId = "20261004000000-mark001";
const settings = { notebookId } as ContactsSettings;

function fixture() {
    const state = {
        docs: new Map<string, { id: string; content: string; box: string; path: string; hpath: string }>(),
        markers: new Map<string, { id: string; root_id: string; box: string; type: string; markdown: string; ial: string }>(),
        store: new Map<string, unknown>(), writes: [] as string[], jsonWrites: 0,
        failStorageReadback: false, failFacts: false, failFactsAfterWrite: false,
        loseCreateResponse: false, skipCreate: false, rejectCreate: false,
        loseTitleResponse: false, rejectTitle: false, loseMarkerResponse: false, rejectMarker: false,
        onJsonSave: undefined as (() => void) | undefined,
        onTitleWrite: undefined as (() => Promise<void>) | undefined,
        userBody: "原用户正文与链接",
    };
    const plugin = {
        async loadData(key: string) {
            if (state.failStorageReadback && state.jsonWrites) throw new Error("断点回读断开");
            return structuredClone(state.store.get(key) ?? null);
        },
        async saveData(key: string, value: unknown) {
            state.jsonWrites += 1;
            state.store.set(key, structuredClone(value));
            state.onJsonSave?.();
        },
    } as unknown as Plugin;
    const accepted = (data: unknown = null): KernelEnvelope => ({ code: 0, msg: "", data });
    const rejected = (): KernelEnvelope => ({ code: -1, msg: "明确内核拒绝", data: null });
    const handler = async (route: string, body: Record<string, string>): Promise<KernelEnvelope | undefined> => {
        if (route === "/api/sqlite/flushTransaction") return accepted();
        if (route === "/api/query/sql") {
            if (state.failFacts || state.failFactsAfterWrite && state.writes.length) return rejected();
            const statement = body.stmt;
            if (statement.includes("GROUP BY root_id")) return accepted([...state.markers.values()].map((marker) => ({ root_id: marker.root_id, ial: marker.ial, markerCount: 1 })));
            if (statement.includes("id IN")) return accepted([...state.docs.values()]);
            if (statement.includes("custom-lvct-org-draft=")) {
                const requestId = statement.match(/custom-lvct-org-draft="([^"]+)"/)![1];
                return accepted([...state.markers.values()].filter((marker) => organizationIalAttributes(marker.ial)["custom-lvct-org-draft"] === requestId));
            }
            if (statement.includes("root_id='")) {
                const rootId = statement.match(/root_id='([^']+)'/)![1];
                return accepted([...state.markers.values()].filter((marker) => marker.root_id === rootId));
            }
            const targetId = statement.match(/AND id='([^']+)'/)![1];
            return accepted(state.docs.has(targetId) ? [state.docs.get(targetId)] : []);
        }
        if (route === "/api/filetree/createDocWithMd") {
            state.writes.push("create");
            assert.equal(parseOrganizationOperationStore(state.store.get(ORGANIZATION_OPERATIONS_STORAGE_KEY)).operations.at(-1)!.kind, "create");
            assert.equal((parseOrganizationOperationStore(state.store.get(ORGANIZATION_OPERATIONS_STORAGE_KEY)).operations.at(-1) as OrganizationCreateOperation).createState, "pending");
            if (state.rejectCreate) return rejected();
            if (!state.skipCreate) {
                state.docs.set(docId, { id: docId, content: body.path.slice(1), box: body.notebook, path: `/${docId}.sy`, hpath: body.path });
                state.markers.set(markerId, { id: markerId, root_id: docId, box: body.notebook, type: "p",
                    markdown: body.markdown.split("\n").find((line) => line.startsWith("**组织**"))!, ial: body.markdown.match(/\{:[^\n]+\}/)![0] });
            }
            return state.loseCreateResponse ? undefined : accepted(docId);
        }
        if (route === "/api/filetree/renameDoc") {
            state.writes.push("title");
            const operation = parseOrganizationOperationStore(state.store.get(ORGANIZATION_OPERATIONS_STORAGE_KEY)).operations.at(-1) as OrganizationRenameOperation;
            assert.equal(operation.titleState, "pending");
            await state.onTitleWrite?.();
            if (state.rejectTitle) return rejected();
            state.docs.get(docId)!.content = body.title;
            return state.loseTitleResponse ? undefined : accepted();
        }
        if (route === "/api/block/updateBlock") {
            state.writes.push("marker");
            if (state.rejectMarker) return rejected();
            state.markers.get(body.id)!.markdown = body.data.split("\n")[0];
            state.markers.get(body.id)!.ial = body.data.split("\n").at(-1)!;
            return state.loseMarkerResponse ? undefined : accepted();
        }
        throw new Error(`未配置测试端点 ${route}`);
    };
    (globalThis as unknown as { __lvctOrgTestRequest: typeof handler }).__lvctOrgTestRequest = handler;
    return { state, plugin, addOrganization() {
        state.docs.set(docId, { id: docId, content: "原组织", box: notebookId, path: `/${docId}.sy`, hpath: "/原组织" });
        state.markers.set(markerId, { id: markerId, root_id: docId, box: notebookId, type: "p", markdown: organizationMarkerMarkdown("原组织"), ial: `{: id="${markerId}" custom-lvct-org="1" custom-user-note="keep"}` });
    } };
}

async function shortTimeout(action: () => Promise<void>) {
    const previous = kernelConfig.timeoutMs;
    kernelConfig.timeoutMs = 20;
    try { await action(); } finally { kernelConfig.timeoutMs = previous; }
}

test("组织创建：pending 持久回读先于内核，响应丢失按请求核实唯一 docId", async () => {
    await shortTimeout(async () => {
        const { state, plugin } = fixture();
        state.loseCreateResponse = true;
        const result = await startOrganizationCreate(plugin, settings, "组织 [甲]#%");
        assert.equal(result.status, "complete");
        assert.equal(result.docId, docId);
        assert.deepEqual(state.writes, ["create"]);
        assert.equal(organizationIalAttributes(state.markers.get(markerId)!.ial)["custom-lvct-org-draft"], result.operation.requestId);
        assert.equal((await inspectOrganizationOperation(plugin, result.operation.requestId)).status, "complete");
        assert.deepEqual(state.writes, ["create"]);
    });
});

test("组织创建：断点回读失败零内核写入，重开只读保留原请求", async () => {
    const { state, plugin } = fixture();
    state.failStorageReadback = true;
    await assert.rejects(startOrganizationCreate(plugin, settings, "组织"), /存储读取失败/);
    assert.equal(state.writes.length, 0);
    state.failStorageReadback = false;
    const pending = await listPendingOrganizationOperations(plugin);
    assert.equal(pending.length, 1);
    assert.equal(pending[0].status, "ready");
    assert.equal((await resumeOrganizationOperation(plugin, settings, pending[0].operation.requestId)).status, "complete");
    assert.equal(state.writes.length, 1);
});

test("组织创建：pending 已持久但发送未开始，重开仍不猜未发或重建", async () => {
    const { state, plugin } = fixture();
    state.onJsonSave = () => {
        if ((parseOrganizationOperationStore(state.store.get(ORGANIZATION_OPERATIONS_STORAGE_KEY)).operations[0] as OrganizationCreateOperation).createState === "pending") state.failStorageReadback = true;
    };
    await assert.rejects(startOrganizationCreate(plugin, settings, "组织"), /存储读取失败/);
    assert.equal(state.writes.length, 0);
    state.failStorageReadback = false;
    state.onJsonSave = undefined;
    const [pending] = await listPendingOrganizationOperations(plugin);
    assert.equal(pending.status, "unknown");
    assert.equal((await resumeOrganizationOperation(plugin, settings, pending.operation.requestId)).status, "unknown");
    assert.equal(state.writes.length, 0);
});

test("组织创建：未知未找到与同名并发不再发创建，不把同名人对应成旧请求", async () => {
    await shortTimeout(async () => {
        const { state, plugin } = fixture();
        state.skipCreate = true;
        state.loseCreateResponse = true;
        const result = await startOrganizationCreate(plugin, settings, "未知组织");
        assert.equal(result.status, "unknown");
        assert.equal((await resumeOrganizationOperation(plugin, settings, result.operation.requestId)).status, "unknown");
        assert.equal((await startOrganizationCreate(plugin, settings, "未知组织")).status, "conflict");
        assert.equal(state.writes.length, 1);
        state.docs.set(docId, { id: docId, content: "未知组织", box: notebookId, path: `/${docId}.sy`, hpath: "/未知组织" });
        assert.equal((await inspectOrganizationOperation(plugin, result.operation.requestId)).status, "unknown");
        assert.equal(state.writes.length, 1);
    });
    const { state, plugin } = fixture();
    const results = await Promise.allSettled([startOrganizationCreate(plugin, settings, "并发组织"), startOrganizationCreate(plugin, settings, "并发组织")]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.deepEqual(state.writes, ["create"]);
});

test("组织创建：明确拒绝原请求可重试，坏断点零写入", async () => {
    const { state, plugin } = fixture();
    state.rejectCreate = true;
    const first = await startOrganizationCreate(plugin, settings, "拒绝组织");
    assert.equal(first.status, "failed");
    state.rejectCreate = false;
    const second = await resumeOrganizationOperation(plugin, settings, first.operation.requestId);
    assert.equal(second.status, "complete");
    assert.equal(second.operation.requestId, first.operation.requestId);
    state.store.set(ORGANIZATION_OPERATIONS_STORAGE_KEY, { schemaVersion: 1, operations: [{}] });
    await assert.rejects(startOrganizationCreate(plugin, settings, "另一个组织"), /存储内容损坏/);
    assert.deepEqual(state.writes, ["create", "create"]);
});

test("组织创建：跨重启读取 pending 核实已建文档，重复标记与锚点变化零重放", async () => {
    const { state, plugin } = fixture();
    state.failFactsAfterWrite = true;
    const first = await startOrganizationCreate(plugin, settings, "组织");
    assert.equal(first.status, "unknown");
    state.failFactsAfterWrite = false;
    const restartedPlugin = { loadData: plugin.loadData.bind(plugin), saveData: plugin.saveData.bind(plugin) } as Plugin;
    const [recovered] = await listPendingOrganizationOperations(restartedPlugin);
    assert.equal(recovered.status, "complete");
    state.markers.set("20261004000000-mark002", { ...state.markers.get(markerId)!, id: "20261004000000-mark002" });
    assert.equal((await inspectOrganizationOperation(restartedPlugin, first.operation.requestId)).status, "unknown");
    assert.deepEqual(state.writes, ["create"]);
});

test("组织改名：标题响应丢失可回读继续标记，保留属性及正文", async () => {
    await shortTimeout(async () => {
        const { state, plugin, addOrganization } = fixture();
        addOrganization();
        state.loseTitleResponse = true;
        state.loseMarkerResponse = true;
        const result = await startOrganizationRename(plugin, docId, "新组织");
        assert.equal(result.status, "complete");
        assert.deepEqual(state.writes, ["title", "marker"]);
        assert.equal(state.markers.get(markerId)!.markdown, organizationMarkerMarkdown("新组织"));
        assert.equal(organizationIalAttributes(state.markers.get(markerId)!.ial)["custom-user-note"], "keep");
        assert.equal(state.userBody, "原用户正文与链接");
    });
});

test("组织改名：只补明确拒绝标记，原标题不再重发", async () => {
    const { state, plugin, addOrganization } = fixture();
    addOrganization();
    state.rejectMarker = true;
    const first = await startOrganizationRename(plugin, docId, "新组织");
    assert.equal(first.status, "failed");
    assert.equal((first.operation as OrganizationRenameOperation).titleState, "verified");
    await assert.rejects(renameOrganization(docId, "新组织", plugin), /尚未完整核实/);
    state.rejectMarker = false;
    const next = await resumeOrganizationOperation(plugin, settings, first.operation.requestId);
    assert.equal(next.status, "complete");
    assert.deepEqual(state.writes, ["title", "marker", "marker"]);
});

test("组织改名：已核实标题后重启，只读核实不补未发标记，明确继续才补", async () => {
    const { state, plugin, addOrganization } = fixture();
    addOrganization();
    state.onJsonSave = () => {
        const operation = parseOrganizationOperationStore(state.store.get(ORGANIZATION_OPERATIONS_STORAGE_KEY)).operations[0] as OrganizationRenameOperation;
        if (operation.titleState === "verified") state.failStorageReadback = true;
    };
    const first = await startOrganizationRename(plugin, docId, "新组织");
    assert.equal(first.status, "unknown");
    assert.deepEqual(state.writes, ["title"]);
    state.failStorageReadback = false;
    state.onJsonSave = undefined;
    const [pending] = await listPendingOrganizationOperations(plugin);
    assert.equal(pending.status, "ready");
    assert.deepEqual(state.writes, ["title"]);
    assert.equal((await resumeOrganizationOperation(plugin, settings, pending.operation.requestId)).status, "complete");
    assert.deepEqual(state.writes, ["title", "marker"]);
});

test("组织改名：旧标题/标记/归档/路径变化零覆盖", async () => {
    for (const change of ["title", "marker", "archive", "path", "attribute"]) {
        const { state, plugin, addOrganization } = fixture();
        addOrganization();
        state.rejectTitle = true;
        const first = await startOrganizationRename(plugin, docId, "新组织");
        assert.equal(first.status, "failed");
        if (change === "title") state.docs.get(docId)!.content = "用户新标题";
        if (change === "marker") state.markers.get(markerId)!.markdown = "用户新标记正文";
        if (change === "archive") state.markers.get(markerId)!.ial = state.markers.get(markerId)!.ial.replace('org="1"', 'org="archived"');
        if (change === "path") state.docs.get(docId)!.path = `/20261004000000-parent1/${docId}.sy`;
        if (change === "attribute") state.markers.get(markerId)!.ial = state.markers.get(markerId)!.ial.replace('note="keep"', 'note="changed"');
        state.rejectTitle = false;
        assert.equal((await resumeOrganizationOperation(plugin, settings, first.operation.requestId)).status, "conflict", change);
        assert.deepEqual(state.writes, ["title"]);
    }
});

test("组织改名：未知旧值仍然只核实，不重放；归档与改名共用状态锁", async () => {
    const { state, plugin, addOrganization } = fixture();
    addOrganization();
    state.failFactsAfterWrite = true;
    const first = await startOrganizationRename(plugin, docId, "新组织");
    assert.equal(first.status, "unknown");
    state.failFactsAfterWrite = false;
    state.docs.get(docId)!.content = "原组织";
    assert.equal((await resumeOrganizationOperation(plugin, settings, first.operation.requestId)).status, "unknown");
    assert.deepEqual(state.writes, ["title"]);
    await archiveOrganization(docId);
    assert.equal((await inspectOrganizationOperation(plugin, first.operation.requestId)).status, "conflict");
    assert.deepEqual(state.writes, ["title", "marker"]);
});

test("组织改名：用户已修改标记或重复标记，开始前零写入", async () => {
    const { state, plugin, addOrganization } = fixture();
    addOrganization();
    state.markers.get(markerId)!.markdown = "用户标记正文";
    await assert.rejects(startOrganizationRename(plugin, docId, "新组织"), /未覆盖/);
    state.markers.set("20261004000000-mark002", { ...state.markers.get(markerId)!, id: "20261004000000-mark002" });
    await assert.rejects(startOrganizationRename(plugin, docId, "新组织"), /未唯一核实/);
    assert.deepEqual(state.writes, []);
});

test("组织断点：原身份不可变、步骤不可回退、版本和重复请求严格拒绝", async () => {
    const { plugin } = fixture();
    const operation: OrganizationCreateOperation = { kind: "create", requestId: "20261004000000-req0001", notebookId,
        name: "组织", docId: "", createdAt: 1, updatedAt: 1, createState: "pending" };
    await saveOrganizationOperation(plugin, operation);
    await assert.rejects(saveOrganizationOperation(plugin, { ...operation, name: "其他组织" }), /不可变/);
    await assert.rejects(saveOrganizationOperation(plugin, { ...operation, createState: "unissued" }), /不可回退/);
    assert.throws(() => parseOrganizationOperationStore({ schemaVersion: 2, operations: [] }), /存储内容损坏/);
    assert.throws(() => parseOrganizationOperationStore({ schemaVersion: 1, operations: [operation, operation] }), /存储内容损坏/);
    assert.equal((await loadOrganizationOperations(plugin)).operations.length, 1);
});

test("组织归档与改名并发：共用 organization-state 锁，归档读取改名后事实且保留请求属性", async () => {
    const { state, plugin, addOrganization } = fixture();
    addOrganization();
    state.markers.get(markerId)!.ial = state.markers.get(markerId)!.ial.replace("}", 'custom-lvct-org-draft="20261004000000-req0001"}');
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { entered = resolve; });
    state.onTitleWrite = async () => { entered(); await gate; };
    const renaming = startOrganizationRename(plugin, docId, "新组织");
    await started;
    const archiving = archiveOrganization(docId);
    await Promise.resolve();
    assert.deepEqual(state.writes, ["title"]);
    release();
    assert.equal((await renaming).status, "complete");
    await archiving;
    assert.deepEqual(state.writes, ["title", "marker", "marker"]);
    assert.equal(state.markers.get(markerId)!.markdown, organizationMarkerMarkdown("新组织"));
    const attributes = organizationIalAttributes(state.markers.get(markerId)!.ial);
    assert.equal(attributes["custom-lvct-org"], "archived");
    assert.equal(attributes["custom-lvct-org-draft"], "20261004000000-req0001");
});

test("组织创建恢复：锚点变化、请求目标移动或初始名称变化均不覆盖/替建", async () => {
    for (const change of ["anchor", "notebook", "name"]) {
        const { state, plugin } = fixture();
        state.failFactsAfterWrite = true;
        const first = await startOrganizationCreate(plugin, settings, "组织");
        state.failFactsAfterWrite = false;
        if (change === "notebook") state.markers.get(markerId)!.box = "20261004000000-book002";
        if (change === "name") state.docs.get(docId)!.content = "用户新名称";
        const next = await resumeOrganizationOperation(plugin, change === "anchor" ? { notebookId: "20261004000000-book002" } as ContactsSettings : settings, first.operation.requestId);
        assert.equal(next.status, "conflict", change);
        assert.deepEqual(state.writes, ["create"]);
    }
});

test("组织公共入口：无插件句柄也先拒绝非法名称，同标题改名零写入", async () => {
    const { state, addOrganization } = fixture();
    for (const name of ["甲/乙", "甲\n乙", "甲\t乙"]) {
        await assert.rejects(createOrganization(settings, name), /无法原文保留/);
        await assert.rejects(renameOrganization(docId, name), /无法原文保留/);
    }
    addOrganization();
    await renameOrganization(docId, "原组织");
    assert.deepEqual(state.writes, []);
});
