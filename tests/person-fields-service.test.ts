import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { emptyPersonFields, personFieldsKey } from "../src/domain/person-fields.ts";
import type { PersonFieldsSnapshot } from "../src/domain/person-fields.ts";

const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
        if (specifier === "siyuan") return { shortCircuit: true, url: "data:text/javascript," + encodeURIComponent(
            "export function fetchPost(route,body,callback,timeout,failure){globalThis.__lvctPersonFieldsTest(route,body).then(callback,failure);}") };
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
const { loadPersonFields, savePersonFields, PersonFieldsProjectionUnknownError } = await import("../src/services/person-fields.ts");
const { readPersonFieldsBlocks } = await import("../src/api/person-fields.ts");
test.after(() => hooks.deregister());

let fixtureIndex = 0;
const blockId = "20261017000000-fields1";
const secondBlockId = "20261017000000-fields2";
const groupId = "00000000-0000-4000-8000-000000000001";
const entryId = "00000000-0000-4000-8000-000000000002";
interface TestBlock { id: string; root_id: string; parent_id: string; type: string; content: string; ial: string }

function snapshot(docId: string, value = "虚构号码"): PersonFieldsSnapshot {
    return { schemaVersion: 1, ownerDocId: docId, items: [
        { id: groupId, kind: "group", label: "联系方式" },
        { id: entryId, kind: "entry", label: "备用电话", value, parentId: groupId },
    ] };
}

function block(docId: string, value: PersonFieldsSnapshot, overrides: Partial<TestBlock> = {}): TestBlock {
    return { id: blockId, root_id: docId, parent_id: docId, type: "p", content: `补充资料\n${personFieldsKey(value)}`,
        ial: `{: id="${blockId}" custom-lvct-person-fields="1" custom-lvct-person-fields-format="1"}`, ...overrides };
}

function fixture(initial?: (docId: string) => TestBlock[]) {
    const docId = `20261017000000-per${String(++fixtureIndex).padStart(4, "0")}`;
    const state = {
        docId, blocks: initial?.(docId) ?? [], exists: true, rootsDuplicate: false,
        calls: [] as Array<{ route: string; body: Record<string, any> }>,
        writes: [] as Array<{ route: string; body: Record<string, any> }>,
        ignoreWrite: false, loseResponse: false, failReadback: false, permissionReadback: false,
        rejectCode: 0, returnWrongId: false, replaceWrittenId: false,
    };
    const accepted = (data: unknown = null) => ({ code: 0, msg: "", data });
    const handler = async (route: string, body: Record<string, any>) => {
        state.calls.push({ route, body: structuredClone(body) });
        if (route === "/api/sqlite/flushTransaction") return accepted();
        if (route === "/api/query/sql") {
            assert.match(body.stmt, /LIMIT 2$/);
            if (state.writes.length && state.permissionReadback) return { code: 403, msg: "权限拒绝", data: null };
            if (state.writes.length && state.failReadback) throw new Error("虚构回读断开");
            if (!body.stmt.includes("root_id")) return accepted(state.exists ? [{ id: docId }, ...(state.rootsDuplicate ? [{ id: docId }] : [])] : []);
            assert.match(body.stmt, /ial LIKE '%custom-lvct-person-fields="%' OR content LIKE '补充资料' \|\| char\(10\) \|\| '\{%'/);
            return accepted(structuredClone(state.blocks.filter((row) => row.ial.includes('custom-lvct-person-fields="') || row.content.startsWith("补充资料\n{"))));
        }
        if (route === "/api/block/insertBlock" || route === "/api/block/updateBlock") {
            state.writes.push({ route, body: structuredClone(body) });
            if (state.rejectCode) return { code: state.rejectCode, msg: state.rejectCode === 403 ? "权限拒绝" : "明确拒绝", data: null };
            assert.equal(body.dataType, "dom");
            const id = body.data.match(/data-node-id="([^"]+)"/)![1];
            if (route.endsWith("insertBlock")) assert.equal(body.parentID, docId);
            else assert.equal(body.id, id);
            assert.match(body.data, /custom-lvct-person-fields="1" custom-lvct-person-fields-format="1"/);
            const encoded = body.data.match(/<br \/>([\s\S]*)<\/div><\/div>$/)![1];
            const json = encoded.replace(/&#39;/g, "'").replace(/&quot;/g, '"')
                .replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&amp;/g, "&");
            const writtenId = state.replaceWrittenId ? secondBlockId : id;
            if (!state.ignoreWrite) state.blocks = [block(docId, JSON.parse(json), {
                id: writtenId, ial: `{: id="${writtenId}" custom-lvct-person-fields="1" custom-lvct-person-fields-format="1"}`,
            })];
            if (state.loseResponse) throw new Error("虚构响应丢失");
            return accepted(route.endsWith("insertBlock") ? [{ doOperations: [{ id: state.returnWrongId ? secondBlockId : id, action: "insert" }] }] : null);
        }
        throw new Error(`未配置端点 ${route}`);
    };
    (globalThis as unknown as { __lvctPersonFieldsTest: typeof handler }).__lvctPersonFieldsTest = handler;
    return state;
}

test("补充资料创建、重读、更新和清空保留同一块，未变快照零写入", async () => {
    const state = fixture();
    const empty = await loadPersonFields(state.docId);
    assert.deepEqual(empty, { snapshot: emptyPersonFields(state.docId) });
    assert.deepEqual(await savePersonFields(state.docId, empty.snapshot, empty), empty);
    assert.equal(state.writes.length, 0);
    const value = snapshot(state.docId, '<标签>&amp; "\'\n\n多行\t{: custom-x="1"}😀');
    const created = await savePersonFields(state.docId, value, empty);
    assert.ok(created.blockId);
    assert.deepEqual(created.snapshot, value);
    assert.deepEqual(await loadPersonFields(state.docId), created);
    const updated = await savePersonFields(state.docId, snapshot(state.docId, "修改"), created);
    assert.equal(updated.blockId, created.blockId);
    const cleared = await savePersonFields(state.docId, emptyPersonFields(state.docId), updated);
    assert.equal(cleared.blockId, created.blockId);
    assert.deepEqual(cleared.snapshot.items, []);
    assert.deepEqual(await loadPersonFields(state.docId), cleared);
    assert.deepEqual(state.writes.map((write) => write.route), ["/api/block/insertBlock", "/api/block/updateBlock", "/api/block/updateBlock"]);
    await savePersonFields(state.docId, cleared.snapshot, cleared);
    assert.equal(state.writes.length, 3);
});

test("外部改值和同内容换块都使旧基线冲突，零覆盖", async () => {
    const state = fixture((docId) => [block(docId, snapshot(docId, "旧值"))]);
    const baseline = await loadPersonFields(state.docId);
    state.blocks = [block(state.docId, snapshot(state.docId, "外部改动"))];
    await assert.rejects(savePersonFields(state.docId, snapshot(state.docId, "草稿"), baseline), /其他窗口变化/);
    state.blocks = [block(state.docId, baseline.snapshot, { id: secondBlockId,
        ial: `{: id="${secondBlockId}" custom-lvct-person-fields="1" custom-lvct-person-fields-format="1"}` })];
    await assert.rejects(savePersonFields(state.docId, snapshot(state.docId, "草稿"), baseline), /其他窗口变化/);
    assert.equal(state.writes.length, 0);
});

test("普通补充资料标题或正文不误当结构化快照候选", async () => {
    const state = fixture((docId) => [
        { id: blockId, root_id: docId, parent_id: docId, type: "h", content: "补充资料", ial: `{: id="${blockId}"}` },
        { id: secondBlockId, root_id: docId, parent_id: docId, type: "p", content: "补充资料：普通原生正文", ial: `{: id="${secondBlockId}"}` },
    ]);
    const empty = await loadPersonFields(state.docId);
    assert.deepEqual(empty, { snapshot: emptyPersonFields(state.docId) });
    await savePersonFields(state.docId, snapshot(state.docId), empty);
    assert.equal(state.writes.length, 1);
});

test("多个候选、丢 marker、错误格式和间接子块均拒绝读取与追加", async () => {
    const state = fixture();
    const empty = await loadPersonFields(state.docId);
    const valid = block(state.docId, snapshot(state.docId));
    for (const invalid of [
        [valid, { ...valid, id: secondBlockId }],
        [{ ...valid, ial: `{: id="${blockId}" custom-lvct-person-fields-format="1"}` }],
        [{ ...valid, ial: `{: id="${blockId}" custom-lvct-person-fields="0" custom-lvct-person-fields-format="1"}` }],
        [{ ...valid, ial: `{: id="${blockId}" custom-lvct-person-fields="1" custom-lvct-person-fields-format="2"}` }],
        [{ ...valid, parent_id: secondBlockId }], [{ ...valid, type: "l" }],
        [{ ...valid, root_id: secondBlockId }],
        [{ ...valid, ial: `{: id="${secondBlockId}" custom-lvct-person-fields="1" custom-lvct-person-fields-format="1"}` }],
        [{ ...valid, ial: `{: custom-lvct-person-fields="1" custom-lvct-person-fields="1" custom-lvct-person-fields-format="1"}` }],
    ]) {
        state.blocks = invalid;
        await assert.rejects(loadPersonFields(state.docId));
        await assert.rejects(savePersonFields(state.docId, snapshot(state.docId), empty));
    }
    assert.equal(state.writes.length, 0);
});

test("文档失联或根身份不唯一时不会按空资料覆盖", async () => {
    const state = fixture();
    const empty = { snapshot: emptyPersonFields(state.docId) };
    state.exists = false;
    await assert.rejects(loadPersonFields(state.docId), /文档不可达/);
    await assert.rejects(savePersonFields(state.docId, snapshot(state.docId), empty), /文档不可达/);
    state.exists = true;
    state.rootsDuplicate = true;
    await assert.rejects(loadPersonFields(state.docId), /文档不可达/);
    assert.equal(state.writes.length, 0);
});

test("owner副本、坏JSON和未知版本不自动认领或归零", async () => {
    const state = fixture();
    const empty = { snapshot: emptyPersonFields(state.docId) };
    const valid = block(state.docId, snapshot(state.docId));
    for (const content of [
        `补充资料\n${personFieldsKey(snapshot("20261017000000-other01"))}`,
        "补充资料\n{bad}",
        `补充资料\n${JSON.stringify({ schemaVersion: 2, ownerDocId: state.docId, items: [] })}`,
        "普通标题\n{}",
    ]) {
        state.blocks = [{ ...valid, content }];
        await assert.rejects(loadPersonFields(state.docId), PersonFieldsProjectionUnknownError);
        await assert.rejects(savePersonFields(state.docId, snapshot(state.docId), empty));
    }
    assert.equal(state.writes.length, 0);
});

test("发出前非法输入零请求且不产生unknown，随后合法保存正常", async () => {
    const state = fixture();
    const empty = { snapshot: emptyPersonFields(state.docId) };
    await assert.rejects(savePersonFields(state.docId, snapshot("20261017000000-other01"), empty), /所属人物/);
    await assert.rejects(savePersonFields(state.docId, snapshot(state.docId, "\u0000"), empty), /控制字符/);
    await assert.rejects(savePersonFields("bad", snapshot(state.docId), empty), /文档 ID/);
    await assert.rejects(savePersonFields(state.docId, snapshot(state.docId), { ...empty, blockId: "bad" }), /基线/);
    assert.equal(state.calls.length, 0);
    assert.deepEqual((await savePersonFields(state.docId, snapshot(state.docId), empty)).snapshot, snapshot(state.docId));
    assert.equal(state.writes.length, 1);
});

test("响应丢失只核实原ID与完整快照，不重发创建", async () => {
    const state = fixture();
    const empty = await loadPersonFields(state.docId);
    state.loseResponse = true;
    await assert.rejects(savePersonFields(state.docId, snapshot(state.docId), empty), /响应未核实/);
    const ownId = state.blocks[0].id;
    state.loseResponse = false;
    const verified = await savePersonFields(state.docId, snapshot(state.docId), empty);
    assert.equal(verified.blockId, ownId);
    assert.equal(state.writes.length, 1);
});

test("未知创建未落库时相同或换草稿都只读，其他同内容块不能冒认", async () => {
    const state = fixture();
    const empty = await loadPersonFields(state.docId);
    state.ignoreWrite = true;
    state.loseResponse = true;
    await assert.rejects(savePersonFields(state.docId, snapshot(state.docId), empty));
    state.ignoreWrite = false;
    state.loseResponse = false;
    await assert.rejects(savePersonFields(state.docId, snapshot(state.docId), empty), /仅核实原请求/);
    await assert.rejects(savePersonFields(state.docId, snapshot(state.docId, "换草稿"), empty), /仅核实原请求/);
    state.blocks = [block(state.docId, snapshot(state.docId))];
    await assert.rejects(savePersonFields(state.docId, snapshot(state.docId), empty), /仅核实原请求/);
    assert.equal(state.writes.length, 1);
});

test("未知已落库后换草稿仍须新鲜基线，不能用旧空基线继续覆盖", async () => {
    const state = fixture();
    const empty = await loadPersonFields(state.docId);
    state.loseResponse = true;
    await assert.rejects(savePersonFields(state.docId, snapshot(state.docId), empty));
    state.loseResponse = false;
    await assert.rejects(savePersonFields(state.docId, snapshot(state.docId, "新草稿"), empty), /其他窗口变化/);
    assert.equal(state.writes.length, 1);
    const fresh = await loadPersonFields(state.docId);
    const next = await savePersonFields(state.docId, snapshot(state.docId, "新草稿"), fresh);
    assert.equal(next.blockId, fresh.blockId);
    assert.equal(state.writes.length, 2);
});

test("写后回读权限错误保持unknown，恢复后只核实原块", async () => {
    const state = fixture();
    const empty = await loadPersonFields(state.docId);
    state.permissionReadback = true;
    await assert.rejects(savePersonFields(state.docId, snapshot(state.docId), empty), /回读失败/);
    state.permissionReadback = false;
    await savePersonFields(state.docId, snapshot(state.docId), empty);
    assert.equal(state.writes.length, 1);
});

test("写后传输回读失败保留原请求，恢复后零重复写", async () => {
    const state = fixture();
    const empty = await loadPersonFields(state.docId);
    state.failReadback = true;
    await assert.rejects(savePersonFields(state.docId, snapshot(state.docId), empty), /回读失败/);
    state.failReadback = false;
    await savePersonFields(state.docId, snapshot(state.docId), empty);
    assert.equal(state.writes.length, 1);
});

test("写响应接受但回读落到其他块ID仍保持unknown", async () => {
    const state = fixture();
    const empty = await loadPersonFields(state.docId);
    state.replaceWrittenId = true;
    await assert.rejects(savePersonFields(state.docId, snapshot(state.docId), empty), /尚未收敛/);
    await assert.rejects(savePersonFields(state.docId, snapshot(state.docId), empty), /仅核实原请求/);
    assert.equal(state.writes.length, 1);
});

test("写后旧值或错误块ID保持unknown，不把内容相等当作原请求成功", async () => {
    const state = fixture((docId) => [block(docId, snapshot(docId, "旧值"))]);
    const baseline = await loadPersonFields(state.docId);
    state.ignoreWrite = true;
    await assert.rejects(savePersonFields(state.docId, snapshot(state.docId, "新值"), baseline), /尚未收敛/);
    await assert.rejects(savePersonFields(state.docId, snapshot(state.docId, "新值"), baseline), /仅核实原请求/);
    state.blocks = [block(state.docId, snapshot(state.docId, "新值"), { id: secondBlockId,
        ial: `{: id="${secondBlockId}" custom-lvct-person-fields="1" custom-lvct-person-fields-format="1"}` })];
    await assert.rejects(savePersonFields(state.docId, snapshot(state.docId, "新值"), baseline), /仅核实原请求/);
    assert.equal(state.writes.length, 1);
});

test("创建响应返回错误operationID按unknown保留，但原ID持久块可只读核实", async () => {
    const state = fixture();
    const empty = await loadPersonFields(state.docId);
    state.returnWrongId = true;
    await assert.rejects(savePersonFields(state.docId, snapshot(state.docId), empty), /响应未核实/);
    state.returnWrongId = false;
    const verified = await savePersonFields(state.docId, snapshot(state.docId), empty);
    assert.equal(verified.blockId, state.blocks[0].id);
    assert.equal(state.writes.length, 1);
});

test("明确内核拒绝或权限拒绝清pending，原基线可显式重试", async () => {
    for (const code of [-1, 403]) {
        const state = fixture();
        const empty = await loadPersonFields(state.docId);
        state.rejectCode = code;
        await assert.rejects(savePersonFields(state.docId, snapshot(state.docId), empty), /明确拒绝|权限失败/);
        assert.equal(state.blocks.length, 0);
        state.rejectCode = 0;
        await savePersonFields(state.docId, snapshot(state.docId), empty);
        assert.equal(state.writes.length, 2);
    }
});

test("两个旧基线并发保存被锁串行，后一个冲突不覆盖", async () => {
    const state = fixture();
    const empty = await loadPersonFields(state.docId);
    const first = savePersonFields(state.docId, snapshot(state.docId, "一"), empty);
    const second = savePersonFields(state.docId, snapshot(state.docId, "二"), empty);
    const results = await Promise.allSettled([first, second]);
    assert.equal(results[0].status, "fulfilled");
    assert.equal(results[1].status, "rejected");
    assert.equal(state.writes.length, 1);
    assert.equal((await loadPersonFields(state.docId)).snapshot.items[1].kind, "entry");
    assert.deepEqual((await loadPersonFields(state.docId)).snapshot, snapshot(state.docId, "一"));
});

test("API对非法人物ID在内核请求前拒绝", async () => {
    const state = fixture();
    await assert.rejects(readPersonFieldsBlocks("bad"), /人物文档 ID/);
    assert.equal(state.calls.length, 0);
});
