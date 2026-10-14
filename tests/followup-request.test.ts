import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import ts from "typescript";
import { fileURLToPath } from "node:url";

const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
        if (specifier === "siyuan") return { shortCircuit: true, url: "data:text/javascript," + encodeURIComponent("export function fetchPost() {}") };
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
const { createFollowUpRecord } = await import("../src/data/followups.ts");
const { FollowUpWriteUnknownError } = await import("../src/domain/followups.ts");

test.after(() => hooks.deregister());

const PERSON = "20261014000000-per0001";
const REQUEST = "20261014000000-req0001";

function fixture(options: { failReadAfterWrite?: boolean } = {}) {
    let stored: unknown = null;
    let writes = 0;
    let failReadAfterWrite = options.failReadAfterWrite ?? false;
    const plugin = {
        async loadData() {
            if (failReadAfterWrite && writes > 0) throw new Error("回读断开");
            return structuredClone(stored);
        },
        async saveData(_key: string, value: unknown) {
            writes += 1;
            stored = structuredClone(value);
        },
    } as never;
    return { plugin, writes: () => writes, setReadFailure: (value: boolean) => { failReadAfterWrite = value; } };
}

test("跟进创建同一 requestId 幂等：重复调用不追加，内容改变拒绝覆盖", async () => {
    const state = fixture();
    const input = { requestId: REQUEST, personDocId: PERSON, title: "回电", dueDate: "2026-10-20" };
    const first = await createFollowUpRecord(state.plugin, input);
    const writes = state.writes();
    const second = await createFollowUpRecord(state.plugin, input);
    assert.equal(second.id, first.id);
    assert.equal(state.writes(), writes);
    await assert.rejects(
        createFollowUpRecord(state.plugin, { ...input, title: "改后的内容" }),
        /同一跟进保存请求已存在不同内容/,
    );
    assert.equal(state.writes(), writes);
});

test("跟进创建必须显式提供稳定 requestId，不能由数据层临时生成", async () => {
    const state = fixture();
    await assert.rejects(
        createFollowUpRecord(state.plugin, { personDocId: PERSON, title: "回电", dueDate: "2026-10-20" } as never),
        /跟进保存请求 ID 无效/,
    );
    assert.equal(state.writes(), 0);
});

test("跟进写后回读未知：错误保留 requestId，恢复后用原 key 重试可核实原记录", async () => {
    const state = fixture({ failReadAfterWrite: true });
    const input = { requestId: REQUEST, personDocId: PERSON, title: "回电", dueDate: "2026-10-20" };
    await assert.rejects(createFollowUpRecord(state.plugin, input), (error: unknown) => {
        assert.ok(error instanceof FollowUpWriteUnknownError);
        assert.equal((error as FollowUpWriteUnknownError).requestId, REQUEST);
        return true;
    });
    state.setReadFailure(false);
    const retried = await createFollowUpRecord(state.plugin, input);
    assert.equal(retried.id, REQUEST);
});
