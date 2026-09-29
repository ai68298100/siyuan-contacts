import { test } from "node:test";
import assert from "node:assert/strict";
import { withStoreLock, storeLockConfig, loadJson, loadJsonStrict } from "../src/data/storage.ts";
import type { Plugin } from "siyuan";

async function withNavigator(value: unknown, action: () => Promise<void>): Promise<void> {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    Object.defineProperty(globalThis, "navigator", { configurable: true, value });
    try { await action(); } finally {
        if (descriptor) Object.defineProperty(globalThis, "navigator", descriptor);
        else Reflect.deleteProperty(globalThis, "navigator");
    }
}

test("存储降级：同键按顺序排队，不重叠执行，结果传回调用方", async () => {
    for (const navigatorValue of [undefined, {}]) {
        await withNavigator(navigatorValue, async () => {
            const trace: string[] = [];
            let release!: () => void;
            const gate = new Promise<void>((resolve) => { release = resolve; });
            const first = withStoreLock("same-key", async () => {
                trace.push("first-start");
                await gate;
                trace.push("first-end");
                return 1;
            });
            const second = withStoreLock("same-key", async () => { trace.push("second"); return 2; });
            await Promise.resolve();
            assert.deepEqual(trace, ["first-start"]);
            release();
            assert.deepEqual(await Promise.all([first, second]), [1, 2]);
            assert.deepEqual(trace, ["first-start", "first-end", "second"]);
        });
    }
});

test("存储降级：不同键互不阻塞", async () => {
    await withNavigator({}, async () => {
        let release!: () => void;
        const gate = new Promise<void>((resolve) => { release = resolve; });
        const first = withStoreLock("blocked-key", async () => { await gate; return "first"; });
        try {
            assert.equal(await withStoreLock("free-key", async () => "second"), "second");
        } finally { release(); }
        assert.equal(await first, "first");
    });
});

test("存储降级：失败传递原错误，后续排队任务和新任务仍可执行", async () => {
    await withNavigator({}, async () => {
        const failure = new Error("模拟失败");
        const first = withStoreLock("failure-key", async () => { throw failure; });
        const second = withStoreLock("failure-key", async () => "recovered");
        const results = await Promise.allSettled([first, second]);
        assert.deepEqual(results, [{ status: "rejected", reason: failure }, { status: "fulfilled", value: "recovered" }]);
        assert.equal(await withStoreLock("failure-key", async () => "again"), "again");
    });
});

test("存储锁：支持浏览器锁时使用固定命名（options+回调真实签名），锁失败不绕过保护", async () => {
    let name = "";
    let sawSignal = false;
    await withNavigator({ locks: { request: async (key: string, options: { signal: AbortSignal }, action: () => Promise<number>) => {
        name = key;
        sawSignal = options?.signal instanceof AbortSignal;
        return action();
    } } }, async () => {
        assert.equal(await withStoreLock("events", async () => 7), 7);
        assert.equal(name, "lvct-events");
        assert.equal(sawSignal, true);
    });
    let ran = false;
    await withNavigator({ locks: { request: async () => { throw new Error("锁不可用"); } } }, async () => {
        await assert.rejects(withStoreLock("events", async () => { ran = true; }), /锁不可用/);
        assert.equal(ran, false);
    });
});

test("存储锁：取锁超时（AbortError）后以 steal 接管自愈，非中止错误照常抛出", async () => {
    const previousTimeout = storeLockConfig.acquireTimeoutMs;
    storeLockConfig.acquireTimeoutMs = 30;
    try {
        const calls: string[] = [];
        await withNavigator({ locks: { request: (key: string, options: { signal?: AbortSignal; steal?: boolean }, action: () => Promise<string>) => {
            if (options?.steal) {
                calls.push("steal");
                return action();
            }
            calls.push("guarded");
            return new Promise((_resolve, reject) => {
                options?.signal?.addEventListener("abort", () => reject(new DOMException("The operation was aborted.", "AbortError")));
            });
        } } }, async () => {
            assert.equal(await withStoreLock("stuck", async () => "healed"), "healed");
            assert.deepEqual(calls, ["guarded", "steal"]);
        });
    } finally {
        storeLockConfig.acquireTimeoutMs = previousTimeout;
    }
});

test("FUNC-01.12 读取语义：严格读区分键不存在与读取失败；容错读把失败降级为 null（调用方不得据此写空）", async () => {
    const failing = { loadData: async () => { throw new Error("模拟磁盘故障"); } } as unknown as Plugin;
    await assert.rejects(loadJsonStrict(failing, "broken.json"), /存储读取失败.*broken\.json/);
    assert.equal(await loadJson(failing, "broken.json"), null, "容错读失败返回 null");
    const missing = { loadData: async () => null } as unknown as Plugin;
    assert.equal(await loadJsonStrict(missing, "absent.json"), null, "键不存在按 null 返回（正常空态）");
    assert.equal(await loadJson(missing, "absent.json"), null);
});
