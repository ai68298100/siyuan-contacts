import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { buildPersonNoteDom, normalizeLegacyPersonNoteSnapshot, normalizePersonNote, parsePersonNoteBlock } from "../src/domain/person-note.ts";
import type { PersonNoteBlock } from "../src/domain/person-note.ts";

const docId = "20261016000000-person1";
const noteId = "20261016000000-note001";
const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
        if (specifier === "siyuan") return { shortCircuit: true, url: "data:text/javascript," + encodeURIComponent(
            "export function fetchPost(route,body,callback,timeout,failure){globalThis.__lvctPersonNoteTest(route,body).then(callback,failure);}") };
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
const { loadPersonNote, savePersonNote, inspectLegacyPersonNote, detachLegacyPersonNote, PersonNoteProjectionUnknownError } = await import("../src/services/person-note.ts");
test.after(() => hooks.deregister());

function block(note: string, overrides: Partial<PersonNoteBlock> = {}): PersonNoteBlock {
    return { id: noteId, markdown: `**人物备注**\n${note}`, content: `人物备注\n${note}`, type: "p", format: "2", ...overrides };
}

function fixture(initial: PersonNoteBlock[] = []) {
    const state = {
        blocks: structuredClone(initial), writes: [] as string[], exists: true,
        staleWrite: false, failReadback: false, loseWriteResponse: false, legacyTitle: true,
    };
    const accepted = (data: unknown = null) => ({ code: 0, msg: "", data });
    const handler = async (route: string, body: Record<string, any>) => {
        if (route === "/api/sqlite/flushTransaction") return accepted();
        if (route === "/api/query/sql") {
            if (state.writes.length && state.failReadback) throw new Error("回读断开");
            if (!body.stmt.includes("root_id")) return accepted(state.exists ? [{ id: docId }] : []);
            return accepted(state.blocks.map((entry) => ({ ...entry, root_id: docId, parent_id: docId,
                ial: `{: id="${entry.id}" custom-lvct-person-note="1"${entry.format === undefined ? "" : ` custom-lvct-person-note-format="${entry.format}"`}}`,
            })));
        }
        if (route === "/api/block/getChildBlocks") return accepted([
            ...(state.legacyTitle ? [{ id: "20261016000000-title01", type: "p", markdown: "**人物备注**" }] : []),
            ...state.blocks,
        ]);
        if (route === "/api/block/deleteBlock") {
            state.writes.push(route);
            if (!state.staleWrite) state.blocks = state.blocks.filter((entry) => entry.id !== body.id);
            return accepted();
        }
        if (route === "/api/block/insertBlock" || route === "/api/block/updateBlock") {
            state.writes.push(route);
            assert.equal(body.dataType, "dom");
            const id = body.data.match(/data-node-id="([^"]+)"/)![1];
            const encoded = body.data.match(/<br \/>([\s\S]*)<\/div><\/div>$/)![1];
            const note = encoded.replace(/<br \/>/g, "\n").replace(/&#39;/g, "'").replace(/&quot;/g, '"')
                .replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&amp;/g, "&");
            if (!state.staleWrite) state.blocks = [block(note, { id })];
            if (state.loseWriteResponse) throw new Error("响应断开");
            return accepted(route.endsWith("insertBlock") ? [{ doOperations: [{ id, action: "insert" }] }] : null);
        }
        throw new Error(`未配置端点 ${route}`);
    };
    (globalThis as unknown as { __lvctPersonNoteTest: typeof handler }).__lvctPersonNoteTest = handler;
    return state;
}

test("人物备注规范化保留多行并统一换行", () => {
    assert.equal(normalizePersonNote("  第一行\r\n第二行  "), "第一行\n第二行");
});

test("人物备注 DOM 编码用户 HTML，换行留在同一段落", () => {
    const dom = buildPersonNoteDom('<div>&amp; "\'\n\n- [ ] 待办\n{: custom-lvct-org="1"}', noteId);
    assert.equal((dom.match(/data-node-id=/g) ?? []).length, 1);
    assert.ok(dom.includes('&lt;div&gt;&amp;amp; &quot;&#39;<br /><br />- [ ] 待办'));
    assert.ok(dom.includes('custom-lvct-person-note-format="2"'));
    assert.equal(parsePersonNoteBlock(block("内部\n\n  缩进\t与空格  \n下一行")), "内部\n\n  缩进\t与空格  \n下一行");
});

test("空备注生成删除语义", () => {
    assert.equal(buildPersonNoteDom("  \n", noteId), "");
    assert.equal(parsePersonNoteBlock(block("", { content: "普通正文" })), null);
});

test("人物备注创建、重新加载、更新和清空只改标记块", async () => {
    const state = fixture();
    const note = '偏好 *安静* &amp; <br>\n\n  [下次] 带资料\n{: custom-lvct-followup="fake"}\n😀';
    assert.equal(await savePersonNote(docId, note, ""), note);
    assert.equal(await loadPersonNote(docId), note);
    const insertedId = state.blocks[0].id;
    assert.equal(await savePersonNote(docId, "修改\n\n保留", note), "修改\n\n保留");
    assert.equal(state.blocks[0].id, insertedId);
    assert.equal(await savePersonNote(docId, "", "修改\n\n保留"), "");
    assert.equal(await loadPersonNote(docId), "");
    assert.deepEqual(state.writes, ["/api/block/insertBlock", "/api/block/updateBlock", "/api/block/deleteBlock"]);
});

test("人物备注旧单段落可恢复；旧多段末段和未知形状阻止覆盖", async () => {
    let state = fixture([block("旧正文", { format: undefined, content: "旧正文", markdown: "旧正文" })]);
    assert.equal(await loadPersonNote(docId), "旧正文");
    assert.equal(await savePersonNote(docId, "更新", "旧正文"), "更新");
    assert.equal(state.blocks[0].format, "2");
    state = fixture([block("只有末段", { format: undefined, content: "只有末段", markdown: "只有末段" })]);
    state.legacyTitle = false;
    await assert.rejects(loadPersonNote(docId), PersonNoteProjectionUnknownError);
    await assert.rejects(savePersonNote(docId, "覆盖", ""), PersonNoteProjectionUnknownError);
    assert.equal(state.writes.length, 0);
    for (const bad of [[block("a"), block("b")], [block("a", { format: "3" })], [block("a", { type: "l" })]]) {
        state = fixture(bad);
        await assert.rejects(savePersonNote(docId, "覆盖"), PersonNoteProjectionUnknownError);
        assert.equal(state.writes.length, 0);
    }
});

let legacyFixtureIndex = 0;
function legacyFixture() {
    const ownerId = `20261017000000-leg${String(++legacyFixtureIndex).padStart(4, "0")}`;
    const sourceId = "20261017000000-legacy1";
    const source = { id: sourceId, root_id: ownerId, parent_id: ownerId, type: "p", content: "末段 原文\n保留空白  ", markdown: "末段 原文  \n保留空白", attrs: { "custom-lvct-person-note": "1", "custom-user-proof": "保留" } as Record<string, string> };
    const state = { ownerId, sourceId, blocks: [source], exists: true, legacyTitle: false, writes: [] as Array<{ route: string; body: Record<string, any> }>, ignoreDetach: false, loseResponse: false, failReadback: false, rejectCode: 0, mutateAfterDetach: false };
    const accepted = (data: unknown = null) => ({ code: 0, msg: "", data });
    const handler = async (route: string, body: Record<string, any>) => {
        if (route === "/api/sqlite/flushTransaction") return accepted();
        if (route === "/api/query/sql") {
            if (state.writes.length && state.failReadback) throw new Error("回读断开");
            if (!body.stmt.includes("root_id")) return accepted(state.exists ? [{ id: ownerId }] : []);
            const rows = body.stmt.includes("WHERE id =") ? state.blocks.filter((item) => body.stmt.includes(`'${item.id}'`))
                : state.blocks.filter((item) => Object.hasOwn(item.attrs, "custom-lvct-person-note"));
            return accepted(rows.map(({ attrs, ...item }) => ({ ...item, ial: `{: id="${item.id}" ${Object.entries(attrs).map(([key, value]) => `${key}="${value}"`).join(" ")}}` })));
        }
        if (route === "/api/block/getChildBlocks") return accepted([
            ...(state.legacyTitle ? [{ id: "20261017000000-title01", type: "p", markdown: "**人物备注**" }] : []), ...state.blocks,
        ]);
        if (route === "/api/attr/setBlockAttrs") {
            state.writes.push({ route, body: structuredClone(body) });
            assert.deepEqual(body.attrs, { "custom-lvct-person-note": "", "custom-lvct-person-note-detached": "1" });
            if (state.rejectCode) return { code: state.rejectCode, msg: "明确拒绝", data: null };
            const target = state.blocks.find((item) => item.id === body.id)!;
            if (!state.ignoreDetach) for (const [key, value] of Object.entries(body.attrs)) {
                if (value === "") delete target.attrs[key]; else target.attrs[key] = value as string;
            }
            if (state.mutateAfterDetach) target.content = "外部新值";
            if (state.loseResponse) throw new Error("响应断开");
            return accepted();
        }
        throw new Error(`未配置端点 ${route}`);
    };
    (globalThis as unknown as { __lvctPersonNoteTest: typeof handler }).__lvctPersonNoteTest = handler;
    return state;
}

test("旧备注解除快照严格校验且不修改原文，不接纳缺值或未知属性", () => {
    const raw = { blockId: noteId, content: "  原文\n  ", markdown: "**原文**" };
    assert.deepEqual(normalizeLegacyPersonNoteSnapshot(raw), raw);
    assert.notEqual(normalizeLegacyPersonNoteSnapshot(raw), raw);
    for (const invalid of [null, [], {}, { ...raw, blockId: "bad" }, { ...raw, content: null }, { ...raw, markdown: undefined }, { ...raw, extra: true }]) {
        assert.throws(() => normalizeLegacyPersonNoteSnapshot(invalid), /快照/);
    }
});

test("旧多段备注检查零写入，解除只改确认原块属性，全文和其他属性原样保留", async () => {
    const state = legacyFixture();
    const before = structuredClone(state.blocks);
    const snapshot = await inspectLegacyPersonNote(state.ownerId);
    assert.deepEqual(snapshot, { blockId: state.sourceId, content: before[0].content, markdown: before[0].markdown });
    assert.equal(state.writes.length, 0);
    await detachLegacyPersonNote(state.ownerId, snapshot);
    assert.deepEqual(state.blocks.map(({ attrs, ...row }) => row), before.map(({ attrs, ...row }) => row));
    assert.deepEqual(state.blocks[0].attrs, { "custom-user-proof": "保留", "custom-lvct-person-note-detached": "1" });
    assert.equal(await loadPersonNote(state.ownerId), "");
    assert.deepEqual(state.writes.map((item) => item.route), ["/api/attr/setBlockAttrs"]);
});

test("仅一个直属p且无format的不可解析旧块可解除，其他形态均零写入", async () => {
    for (const invalid of ["readable", "duplicate", "list", "format2", "unknown-format", "nested", "wrong-marker", "missing-doc"]) {
        const state = legacyFixture();
        if (invalid === "readable") state.legacyTitle = true;
        if (invalid === "duplicate") state.blocks.push({ ...structuredClone(state.blocks[0]), id: "20261017000000-legacy2" });
        if (invalid === "list") state.blocks[0].type = "l";
        if (invalid === "format2") state.blocks[0].attrs["custom-lvct-person-note-format"] = "2";
        if (invalid === "unknown-format") state.blocks[0].attrs["custom-lvct-person-note-format"] = "3";
        if (invalid === "nested") state.blocks[0].parent_id = "20261017000000-other01";
        if (invalid === "wrong-marker") state.blocks[0].attrs["custom-lvct-person-note"] = "0";
        if (invalid === "missing-doc") state.exists = false;
        await assert.rejects(inspectLegacyPersonNote(state.ownerId));
        await assert.rejects(detachLegacyPersonNote(state.ownerId, { blockId: state.sourceId, content: state.blocks[0].content, markdown: state.blocks[0].markdown }));
        assert.equal(state.writes.length, 0, invalid);
    }
});

test("旧备注正文、Markdown、块ID或人物归属变化使快照失效，不解除新目标", async () => {
    for (const field of ["content", "markdown", "id", "root_id", "parent_id"]) {
        const state = legacyFixture();
        const snapshot = await inspectLegacyPersonNote(state.ownerId);
        (state.blocks[0] as Record<string, unknown>)[field] = field === "content" || field === "markdown" ? "外部修改" : "20261017000000-other01";
        await assert.rejects(detachLegacyPersonNote(state.ownerId, snapshot));
        assert.equal(state.writes.length, 0, field);
    }
});

test("旧备注解除响应丢失后相同快照只读核实，原文保持且不重复发送", async () => {
    const state = legacyFixture();
    const snapshot = await inspectLegacyPersonNote(state.ownerId);
    state.loseResponse = true;
    await assert.rejects(detachLegacyPersonNote(state.ownerId, snapshot), /响应未核实/);
    state.loseResponse = false;
    await detachLegacyPersonNote(state.ownerId, snapshot);
    assert.equal(state.writes.length, 1);
    assert.equal(await loadPersonNote(state.ownerId), "");
});

test("旧备注解除未应用时相同或换快照均不重发，普通读取保存也不越过未知", async () => {
    const state = legacyFixture();
    const snapshot = await inspectLegacyPersonNote(state.ownerId);
    state.ignoreDetach = true;
    await assert.rejects(detachLegacyPersonNote(state.ownerId, snapshot), /回读未核实/);
    await assert.rejects(detachLegacyPersonNote(state.ownerId, snapshot), /未重复发送/);
    await assert.rejects(detachLegacyPersonNote(state.ownerId, { ...snapshot, content: "新草稿" }), /原请求不同/);
    await assert.rejects(loadPersonNote(state.ownerId), /未重复发送/);
    await assert.rejects(savePersonNote(state.ownerId, "新备注", ""), /未重复发送/);
    assert.equal(state.writes.length, 1);
});

test("旧备注解除明确拒绝可在原快照未变时重试，回读断开只核实不重发", async () => {
    const rejected = legacyFixture();
    const snapshot = await inspectLegacyPersonNote(rejected.ownerId);
    rejected.rejectCode = 403;
    await assert.rejects(detachLegacyPersonNote(rejected.ownerId, snapshot));
    rejected.rejectCode = 0;
    await detachLegacyPersonNote(rejected.ownerId, snapshot);
    assert.equal(rejected.writes.length, 2);
    const unread = legacyFixture();
    const original = await inspectLegacyPersonNote(unread.ownerId);
    unread.failReadback = true;
    await assert.rejects(detachLegacyPersonNote(unread.ownerId, original), /回读未核实/);
    unread.failReadback = false;
    assert.equal(await loadPersonNote(unread.ownerId), "", "普通重读可以核实已应用的原解除请求");
    assert.equal(unread.writes.length, 1);
});

test("旧备注解除后原文变化不报成功，不再发送解除", async () => {
    const state = legacyFixture();
    const snapshot = await inspectLegacyPersonNote(state.ownerId);
    state.mutateAfterDetach = true;
    await assert.rejects(detachLegacyPersonNote(state.ownerId, snapshot), /回读未核实/);
    await assert.rejects(detachLegacyPersonNote(state.ownerId, snapshot), /未重复发送/);
    assert.equal(state.writes.length, 1);
});

test("解除旧标记后普通重读保留另一窗口创建的新备注，不硬置为空", async () => {
    const state = legacyFixture();
    const snapshot = await inspectLegacyPersonNote(state.ownerId);
    state.loseResponse = true;
    await assert.rejects(detachLegacyPersonNote(state.ownerId, snapshot));
    state.blocks.push({ id: "20261017000000-newnote", root_id: state.ownerId, parent_id: state.ownerId, type: "p", content: "人物备注\n其他窗口的新备注", markdown: "**人物备注**\n其他窗口的新备注", attrs: { "custom-lvct-person-note": "1", "custom-lvct-person-note-format": "2" } });
    state.loseResponse = false;
    await detachLegacyPersonNote(state.ownerId, snapshot);
    assert.equal(await loadPersonNote(state.ownerId), "其他窗口的新备注");
    assert.equal(state.writes.length, 1);
});

test("人物备注外部改动冲突、文档失联与非法输入均不写", async () => {
    let state = fixture([block("其他窗口")]);
    await assert.rejects(savePersonNote(docId, "我的草稿", "旧值"), /其他窗口变化/);
    assert.equal(state.writes.length, 0);
    state = fixture();
    state.exists = false;
    await assert.rejects(savePersonNote(docId, "草稿", ""), /文档不可达/);
    assert.equal(state.writes.length, 0);
    state = fixture();
    await assert.rejects(savePersonNote(docId, "\u0000"), /控制字符/);
    await assert.rejects(savePersonNote(docId, "长".repeat(5001)), /5000/);
    assert.equal(state.writes.length, 0);
});

test("人物备注写后不收敛和回读失败不能报已保存", async () => {
    let state = fixture();
    state.staleWrite = true;
    await assert.rejects(savePersonNote(docId, "新值", ""), /尚未收敛/);
    assert.equal(state.writes.length, 1);
    await assert.rejects(savePersonNote(docId, "新值", ""), /仅核实原请求/);
    await assert.rejects(savePersonNote(docId, "换草稿", ""), /仅核实原请求/);
    assert.equal(state.writes.length, 1);
    state.blocks = [block("新值")];
    assert.equal(await savePersonNote(docId, "新值", ""), "新值");
    state = fixture();
    state.failReadback = true;
    await assert.rejects(savePersonNote(docId, "新值", ""), /回读失败，结果未知/);
    assert.equal(state.writes.length, 1);
    state.failReadback = false;
    assert.equal(await savePersonNote(docId, "新值", ""), "新值");
});

test("人物备注响应丢失后的相同草稿重试只核实，不重复写块", async () => {
    const state = fixture();
    state.loseWriteResponse = true;
    await assert.rejects(savePersonNote(docId, "新值", ""));
    state.loseWriteResponse = false;
    assert.equal(await savePersonNote(docId, "新值", ""), "新值");
    assert.equal(state.writes.length, 1);
});

function detailSaveController(save: (docId: string, draft: string, expected: string) => Promise<string>) {
    const source = readFileSync(new URL("../src/components/people/PersonDetail.svelte", import.meta.url), "utf8")
        .match(/async function savePersonNoteState\(rethrowOnFailure = false\): Promise<void> \{[\s\S]*?\n    \}(?=\n    useCloseGuard)/)![0];
    const body = ts.transpileModule(`
        let current = { docId: "${docId}", itemId: "20261016000000-item001" };
        let detailAlive = true, personNoteSaving = false, personNoteSaved = false;
        let personNote = "旧值", personNoteDraft = "草稿", personNoteError = "", personNoteErrorKind = "";
        let personNoteDraftRevision = 0;
        const requestErrorMessage = (error) => error.message;
        const onChanged = () => {};
        ${source}
        return {
            save: savePersonNoteState,
            state: () => ({ personNote, personNoteDraft, personNoteSaved, personNoteError, personNoteSaving }),
            switchPerson: () => { current = { docId: "20261016000000-other01", itemId: "20261016000000-item002" }; personNote = "新人原值"; personNoteDraft = "新人草稿"; },
            edit: () => { personNoteDraftRevision += 1; personNoteDraft = "新草稿"; },
            dispose: () => { detailAlive = false; },
        };
    `, { compilerOptions: { target: ts.ScriptTarget.ESNext } }).outputText;
    return new Function("onSavePersonNote", body)(save);
}

test("详情个人备注保存迟到时不覆盖切换人物或保存期间产生的新草稿", async () => {
    let resolveSave!: (value: string) => void;
    const controller = detailSaveController(() => new Promise<string>((resolve) => { resolveSave = resolve; }));
    const pending = controller.save();
    controller.switchPerson();
    resolveSave("草稿");
    await pending;
    assert.equal(controller.state().personNoteDraft, "新人草稿");
    assert.equal(controller.state().personNoteSaved, false);
    const edited = detailSaveController(() => new Promise<string>((resolve) => { resolveSave = resolve; }));
    const editingPending = edited.save();
    edited.edit();
    resolveSave("草稿");
    await editingPending;
    assert.equal(edited.state().personNoteDraft, "新草稿");
    assert.equal(edited.state().personNoteSaved, false);
});

test("详情个人备注保存失败保留草稿，销毁后的失败不回写状态", async () => {
    const controller = detailSaveController(async () => { throw new Error("写入未知"); });
    await controller.save();
    assert.equal(controller.state().personNoteDraft, "草稿");
    assert.equal(controller.state().personNote, "旧值");
    assert.equal(controller.state().personNoteError, "写入未知");
    assert.equal(controller.state().personNoteSaved, false);
    let rejectSave!: (error: Error) => void;
    const disposed = detailSaveController(() => new Promise<string>((_resolve, reject) => { rejectSave = reject; }));
    const pending = disposed.save();
    disposed.dispose();
    rejectSave(new Error("迟到失败"));
    await pending;
    assert.equal(disposed.state().personNoteError, "");
});
