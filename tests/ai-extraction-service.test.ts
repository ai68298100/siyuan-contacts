import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { buildAiCandidateDrafts, decideAiCandidate } from "../src/domain/ai-candidates.ts";
import { AiExtractionError, buildAiPreflight } from "../src/domain/ai-preflight.ts";
import { parseExtraction } from "../src/domain/ai-extract.ts";
import { emptyDraft } from "../src/domain/person.ts";
import { FIELD_SPECS } from "../src/domain/fields.ts";
import type { ContactsSettings } from "../src/domain/model.ts";
import type { ContactSummary } from "../src/domain/person.ts";
import type { ContactsPluginFacade } from "../src/types.ts";
import type { AiCandidateDraft } from "../src/domain/ai-candidates.ts";

const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
        if (specifier === "siyuan") return { shortCircuit: true, url: "data:text/javascript," + encodeURIComponent(
            "export function fetchPost(route,body,callback){globalThis.__lvctAiTestRequest(route,body).then(callback,error=>callback({code:-1,msg:String(error),data:null}));}"), };
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
const { prepareAiExtraction, extractFromDoc, applyAcceptedAiDrafts } = await import("../src/services/ai-extract.ts");
const { invalidateRoster } = await import("../src/services/roster.ts");
const { previewCapture, captureFromDoc } = await import("../src/services/capture.ts");
const { flushBlockIndex } = await import("../src/api/blocks.ts");
const { proxy, state: svelteState, set: setSvelteState, get: getSvelteState } = await import("svelte/internal/client");
const { configureAiKernel } = await import("../scripts/e2e/ui/ai-extraction-fixture.js");
test.after(() => { hooks.deregister(); Reflect.deleteProperty(globalThis, "__lvctAiTestRequest"); });

const docId = "20261004000000-source1";
const settings = { notebookId: "20261004000000-book001", avId: "20261004000000-av00001", dbBlockId: "20261004000000-table01",
    fieldMap: Object.fromEntries(FIELD_SPECS.map((field) => [field.key, field.key])) } as ContactsSettings;
const person = (id: string, name = "样例甲"): ContactSummary => ({ ...emptyDraft(), name, docId: id, itemId: `row-${id}`, relatedItemIds: [] });
type Envelope = { code: number; msg: string; data: unknown };
function fixture() {
    invalidateRoster();
    const state = { content: "样例甲于2026-10-04交流。", people: [person("20261004000000-person1")],
        requests: [] as { route: string; body: Record<string, unknown> }[], failSource: false, unavailable: false,
        response: { code: 0, msg: "", data: '{"version":2,"people":[{"name":"样例甲","evidence":"样例甲"}]}' } as Envelope,
        delayed: undefined as Promise<Envelope> | undefined };
    Reflect.set(globalThis, "__lvctAiTestRequest", async (route: string, body: Record<string, unknown>) => {
        state.requests.push({ route, body });
        if (route === "/api/sqlite/flushTransaction") return { code: 0, msg: "", data: null };
        if (route === "/api/export/exportMdContent") {
            assert.equal(body.id, docId);
            return state.failSource ? { code: -1, msg: "姓名 联系方式 /private/path", data: null } : { code: 0, msg: "", data: { hPath: "/虚构", content: state.content } };
        }
        if (route === "/api/ai/chatGPT") return state.delayed ?? state.response;
        if (route === "/api/av/renderAttributeView") return { code: 0, msg: "", data: { view: {
            columns: FIELD_SPECS.map((field) => ({ id: field.key, name: field.nameZh, type: field.type })),
            rows: state.people.map((entry) => ({ id: entry.itemId, cells: [{ valueType: "block", value: { keyID: "name", type: "block", block: { id: entry.docId, content: entry.name } } }] })),
        } } };
        if (route === "/api/query/sql") return { code: 0, msg: "", data: body.stmt && String(body.stmt).includes("SELECT content") && !state.unavailable ? [{ content: "虚构来源" }] : [] };
        throw new Error("隔离夹具拒绝未授权端点");
    });
    return state;
}
async function failure(action: () => Promise<unknown>): Promise<AiExtractionError> {
    try { await action(); } catch (error) { assert.ok(error instanceof AiExtractionError); return error; }
    throw new Error("预期拒绝但操作成功");
}

test("无确认旧调用和伪造预检零读取零外发", async () => {
    const state = fixture();
    assert.equal((await failure(() => extractFromDoc(settings, docId))).code, "confirmation_required");
    const fake = buildAiPreflight("fake", docId, "虚构文本");
    assert.equal((await failure(() => extractFromDoc(settings, docId, { preflight: fake, confirmed: true }))).code, "confirmation_required");
    assert.equal(state.requests.length, 0);
});

test("准备只读指定来源；确认实际 msg 完全相等且不隐式发送名册", async () => {
    const state = fixture();
    state.people.push(person("20261004000000-person2", "未出现在正文的隐私名字"));
    const preflight = await prepareAiExtraction(settings, docId);
    assert.deepEqual(state.requests.map((item) => item.route), ["/api/export/exportMdContent"]);
    state.content = "随后被修改的正文";
    const outcome = await extractFromDoc(settings, docId, { preflight, confirmed: true });
    const sent = state.requests.find((item) => item.route === "/api/ai/chatGPT")!;
    assert.deepEqual(sent.body, { msg: preflight.msg });
    assert.ok(!preflight.msg.includes("未出现在正文的隐私名字"));
    assert.equal(state.requests.filter((item) => item.route === "/api/export/exportMdContent").length, 1);
    assert.equal(outcome.preflightId, preflight.id);
    assert.ok(outcome.candidates.every((candidate) => !candidate.checked));
});

test("复制、锚点变更、来源变更和已消费预检不能发送", async () => {
    const state = fixture();
    const preflight = await prepareAiExtraction(settings, docId);
    for (const operation of [
        () => extractFromDoc(settings, docId, { preflight: { ...preflight }, confirmed: true as const }),
        () => extractFromDoc({ ...settings, avId: "changed" }, docId, { preflight, confirmed: true as const }),
        () => extractFromDoc(settings, "20261004000000-other01", { preflight, confirmed: true as const }),
    ]) assert.equal((await failure(operation)).code, "confirmation_required");
    await extractFromDoc(settings, docId, { preflight, confirmed: true });
    assert.equal((await failure(() => extractFromDoc(settings, docId, { preflight, confirmed: true }))).code, "confirmation_required");
    assert.equal(state.requests.filter((item) => item.route === "/api/ai/chatGPT").length, 1);
});

test("真实 Svelte 深代理和状态存储保留预检 WeakMap 身份，一次确认仍严格有效", async () => {
    const state = fixture();
    const preflight = await prepareAiExtraction(settings, docId);
    const plainFrozen = Object.freeze({ id: "frozen-plain" });
    assert.notEqual(proxy(plainFrozen), plainFrozen);
    assert.equal(proxy(preflight), preflight);
    const nested = proxy({ step: { preflight } });
    assert.equal(nested.step.preflight, preflight);
    const stored = svelteState({ preflight });
    setSvelteState(stored, { preflight: nested.step.preflight }, true);
    const restored = getSvelteState(stored).preflight;
    assert.equal(restored, preflight);
    const outcome = await extractFromDoc(settings, docId, { preflight: restored, confirmed: true });
    assert.equal(outcome.preflightId, preflight.id);
    assert.equal((await failure(() => extractFromDoc(settings, docId, { preflight: restored, confirmed: true }))).code, "confirmation_required");
    assert.equal(state.requests.filter((request) => request.route === "/api/ai/chatGPT").length, 1);
    assert.deepEqual(state.requests.find((request) => request.route === "/api/ai/chatGPT")?.body, { msg: preflight.msg });
});

test("字段范围收窄时，额外 people 不进入既有/新人/同名匹配列表", async () => {
    const state = fixture();
    state.people.push(person("20261004000000-person2"));
    state.response.data = JSON.stringify({ version: 2, people: ["样例甲", "范围外新人"], date: "2026-10-04",
        profileCandidates: [{ person: "样例甲", field: "wechat", value: "fictional-only" }] });
    const preflight = await prepareAiExtraction(settings, docId, { fields: ["profile"] });
    const outcome = await extractFromDoc(settings, docId, { preflight, confirmed: true });
    assert.deepEqual(outcome.matched, []);
    assert.deepEqual(outcome.unknownNames, []);
    assert.deepEqual(outcome.ambiguousCandidates, []);
    assert.deepEqual(outcome.candidates.map((candidate) => candidate.kind), ["profile"]);
    assert.equal(outcome.candidates[0].targets.length, 2);
});

test("浏览器同源夹具主键独立于 fieldMap，严格解码后实际候选可返回", async () => {
    for (const mode of ["changed-source", "profile-only", "candidate-review", "undo-draft"] as const) {
        const kernel = { handler: async (_route: string, _body: Record<string, unknown>): Promise<unknown> => undefined };
        const state = configureAiKernel(kernel, settings);
        Reflect.set(globalThis, "__lvctAiTestRequest", async (route: string, body: Record<string, unknown>) => ({ code: 0, msg: "", data: await kernel.handler(route, body) }));
        await flushBlockIndex();
        assert.ok(!Object.hasOwn(settings.fieldMap, "name"));
        if (mode === "undo-draft") state.reply = JSON.stringify({ version: 2, people: ["样例甲", "新人"], place: "AI地点" });
        const preflight = await state.facade.prepareAiExtraction(docId, {
            ...(mode === "changed-source" ? { sourceText: "仅样例甲选段" } : {}),
            ...(mode === "profile-only" ? { fields: ["profile"] } : {}),
        });
        const outcome = await state.facade.aiExtractFromDoc(docId, { preflight, confirmed: true });
        assert.equal(state.failureCode, "");
        assert.equal(state.confirmedPreflight, state.preparedOriginal);
        assert.ok(outcome.candidates.length > 0, mode);
        const render = await kernel.handler("/api/av/renderAttributeView", {});
        assert.equal((render as { view: { rows: { cells: { value: { keyID: string } }[] }[] } }).view.rows[0].cells[0].value.keyID, "name");
        if (mode === "profile-only") {
            assert.deepEqual(outcome.matched, []);
            assert.deepEqual(outcome.candidates.map((candidate: AiCandidateDraft) => candidate.kind), ["profile"]);
        } else {
            assert.equal(outcome.matched[0].docId, state.person.docId);
            assert.equal(outcome.candidates.filter((candidate: AiCandidateDraft) => candidate.kind === "person").length, mode === "undo-draft" ? 2 : 1);
        }
    }
});

test("选段必须显式提供文本，粘贴不读取文档；来源失败脱敏且零发送", async () => {
    const state = fixture();
    assert.equal((await failure(() => prepareAiExtraction(settings, docId, { sourceKind: "selection" }))).code, "source_unavailable");
    assert.equal(state.requests.length, 0);
    await prepareAiExtraction(settings, docId, { sourceKind: "paste", sourceText: "仅虚构粘贴" });
    assert.equal(state.requests.length, 0);
    state.failSource = true;
    const error = await failure(() => prepareAiExtraction(settings, docId));
    assert.equal(error.code, "source_unavailable");
    assert.ok(!error.message.includes("private") && !error.message.includes("姓名"));
});

test("真实实证未配置空回复返回手动回退；拒答和非法版本零候选", async () => {
    for (const reply of ["", "无法协助", '{"version":99,"people":["猜测"]}']) {
        const state = fixture();
        state.response.data = reply;
        const preflight = await prepareAiExtraction(settings, docId);
        const outcome = await extractFromDoc(settings, docId, { preflight, confirmed: true });
        assert.equal(outcome.extraction, null);
        assert.equal(outcome.likelyUnconfigured, reply === "");
        assert.deepEqual(outcome.candidates, []);
    }
});

test("权限/密钥错误不传播宿主正文或秘密", async () => {
    for (const [code, msg, expected] of [[403, "permission 姓名13800000000/private", "permission"], [-1, "API key 密钥=secret", "unconfigured"]] as const) {
        const state = fixture();
        state.response = { code, msg, data: null };
        const preflight = await prepareAiExtraction(settings, docId);
        const error = await failure(() => extractFromDoc(settings, docId, { preflight, confirmed: true }));
        assert.equal(error.code, expected);
        assert.ok(!error.message.includes("secret") && !error.message.includes("13800000000") && !error.message.includes("private"));
    }
});

test("调用前取消零外发；发送后取消/超时忽略迟到回复", async () => {
    const state = fixture();
    const already = new AbortController();
    already.abort();
    const preview = await prepareAiExtraction(settings, docId);
    assert.equal((await failure(() => extractFromDoc(settings, docId, { preflight: preview, confirmed: true, signal: already.signal }))).code, "cancelled");
    assert.equal(state.requests.filter((item) => item.route === "/api/ai/chatGPT").length, 0);
    for (const mode of ["cancelled", "timeout"] as const) {
        let release!: (envelope: Envelope) => void;
        state.delayed = new Promise((resolveReply) => { release = resolveReply; });
        const controller = new AbortController();
        const preflight = await prepareAiExtraction(settings, docId);
        const pending = failure(() => extractFromDoc(settings, docId, { preflight, confirmed: true, signal: controller.signal, timeoutMs: 20 }));
        if (mode === "cancelled") controller.abort();
        assert.equal((await pending).code, mode);
        release(state.response);
        await Promise.resolve();
    }
});

test("同名本地全部保留，资料人物未出现在 people 仍保留为待裁决草稿", async () => {
    const state = fixture();
    state.people.push(person("20261004000000-person2"));
    state.response.data = JSON.stringify({ people: ["样例甲"], profileCandidates: [{ person: "新人", field: "wechat", value: "fictional" }] });
    const preflight = await prepareAiExtraction(settings, docId);
    const outcome = await extractFromDoc(settings, docId, { preflight, confirmed: true });
    assert.equal(outcome.ambiguousCandidates?.[0].people.length, 2);
    assert.deepEqual(outcome.matched, []);
    assert.ok(outcome.candidates.some((candidate) => candidate.personName === "新人" && candidate.kind === "profile"));
});

function extraFixture() {
    const target = person("20261004000000-person1");
    const raw = parseExtraction(JSON.stringify({ profileCandidates: [{ person: "样例甲", field: "wechat", value: "fictional-one" }, { person: "样例甲", field: "phone", value: "13800000000" }],
        followUpCandidates: [{ person: "样例甲", title: "回传虚构材料", dueDate: "2026-10-08" }] }))!;
    let drafts = buildAiCandidateDrafts(raw, buildAiPreflight("extras-1", docId, "样例甲", { removeContacts: false }), [target]);
    for (const candidate of drafts) drafts = decideAiCandidate(drafts, candidate.id, "accepted");
    const state = { writes: [] as string[], creates: 0, readFailed: false, fieldFailed: false, createLost: false, readbackFailed: false,
        items: [] as { id: string; personDocId: string; title: string; dueDate: string; status: string; docSyncPending: boolean }[] };
    const facade = {
        listContacts: async () => [target],
        updatePersonCandidateFields: async (_itemId: string, patches: { field: "phone" | "wechat"; value: string }[]) => {
            const patch = patches[0]; state.writes.push(patch.field);
            const failed = state.fieldFailed && patch.field === "phone";
            if (!failed) target[patch.field] = patch.value;
            return { conflicts: [], report: { complete: !failed, unknown: [], unresolved: failed ? [{}] : [] } };
        },
        listPersonFollowUps: async () => { if (state.readFailed || state.readbackFailed && state.creates > 0) throw new Error("私有姓名 /private/path"); return state.items; },
        createFollowUp: async (personDocId: string, title: string, dueDate: string) => {
            state.creates += 1;
            const item = { id: `follow-${state.creates}`, personDocId, title, dueDate, status: "open", docSyncPending: false };
            state.items.push(item);
            if (state.createLost) throw new Error("私有姓名 /private/path");
            return item;
        },
    } as unknown as Pick<ContactsPluginFacade, "listContacts" | "updatePersonCandidateFields" | "listPersonFollowUps" | "createFollowUp">;
    return { state, drafts, target, facade };
}

test("未接受草稿和未完成主捕获零附加写入", async () => {
    const { state, drafts, facade } = extraFixture();
    await applyAcceptedAiDrafts(facade, drafts, false);
    assert.equal(state.writes.length + state.creates, 0);
    await applyAcceptedAiDrafts(facade, drafts.map((candidate) => ({ ...candidate, decision: "pending" })), true);
    assert.equal(state.writes.length + state.creates, 0);
});

test("逐候选部分失败保留成功；只重试明确失败资料项，跟进零重建", async () => {
    const { state, drafts, facade } = extraFixture();
    state.fieldFailed = true;
    await applyAcceptedAiDrafts(facade, drafts, true);
    assert.deepEqual(drafts.map((candidate) => candidate.status), ["applied", "failed", "applied"]);
    state.fieldFailed = false;
    await applyAcceptedAiDrafts(facade, drafts, true);
    assert.deepEqual(state.writes, ["wechat", "phone", "phone"]);
    assert.equal(state.creates, 1);
    assert.ok(drafts.every((candidate) => candidate.status === "applied"));
});

test("未知跟进创建不能凭相同标题认领或重建；回读失败不能当空库", async () => {
    const first = extraFixture();
    first.state.createLost = true;
    await applyAcceptedAiDrafts(first.facade, first.drafts, true);
    await applyAcceptedAiDrafts(first.facade, first.drafts, true);
    const unknown = first.drafts.find((candidate) => candidate.kind === "followup")!;
    assert.equal(unknown.status, "unknown");
    assert.equal(first.state.creates, 1);
    assert.ok(!unknown.error.includes("private"));
    const second = extraFixture();
    second.state.readFailed = true;
    await applyAcceptedAiDrafts(second.facade, second.drafts, true);
    assert.equal(second.state.creates, 0);
});

test("跟进持有返回 ID 后回读未知，重试只核实原 ID", async () => {
    const { state, drafts, facade } = extraFixture();
    state.readbackFailed = true;
    await applyAcceptedAiDrafts(facade, drafts, true);
    const candidate = drafts.find((entry) => entry.kind === "followup")!;
    assert.equal(candidate.status, "unknown");
    assert.equal(candidate.writeCheckpoint?.followUpId, "follow-1");
    state.readbackFailed = false;
    await applyAcceptedAiDrafts(facade, drafts, true);
    assert.equal(candidate.status, "applied");
    assert.equal(state.creates, 1);
});

test("人物绑定变化和同字段多项已接受均阻止写入", async () => {
    const first = extraFixture();
    first.target.itemId = "changed-row";
    await applyAcceptedAiDrafts(first.facade, first.drafts, true);
    assert.equal(first.state.writes.length + first.state.creates, 0);
    const second = extraFixture();
    const original = second.drafts[0];
    second.drafts = [original, { ...original, id: "conflicting-draft", value: "different" }];
    await applyAcceptedAiDrafts(second.facade, second.drafts, true);
    assert.equal(second.state.writes.length, 0);
});

test("新人候选保留且明确选稳定目标后补写，不按新人姓名找第一人", async () => {
    const { state, drafts, target, facade } = extraFixture();
    const candidate: AiCandidateDraft = { ...drafts[0], targets: [], selectedDocId: "", personName: "新人" };
    await applyAcceptedAiDrafts(facade, [candidate], true);
    assert.equal(state.writes.length, 0);
    candidate.selectedDocId = target.docId;
    await applyAcceptedAiDrafts(facade, [candidate], true);
    assert.equal(state.writes.length, 1);
    assert.equal(candidate.writeCheckpoint?.docId, target.docId);
});

test("来源不可达不能生成空预览，执行保留原 checkpoint 且零写入", async () => {
    const state = fixture();
    state.unavailable = true;
    await assert.rejects(previewCapture(settings, docId), /来源笔记不可达/);
    const plugin = { loadData: async () => null, saveData: async () => { throw new Error("不应写入"); } };
    const result = await captureFromDoc(plugin as never, settings, docId, { personDocIds: [state.people[0].docId], newNames: [], date: "2026-10-04", note: "保留原输入" });
    assert.equal(result.complete, false);
    assert.equal(result.checkpoint.input.note, "保留原输入");
    assert.equal(result.occasionLinkFailures[0].target, "source");
    assert.equal(state.requests.filter((request) => request.route === "/api/sqlite/flushTransaction").length, 2);
    assert.ok(state.requests.every((request) => !/create|insert|setAttribute/.test(request.route)));
});
