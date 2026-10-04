import { test } from "node:test";
import assert from "node:assert/strict";
import { withStoreLock, storeLockConfig, StoreLockTimeoutError, loadJson, loadJsonStrict, saveJsonVerified } from "../src/data/storage.ts";
import type { Plugin } from "siyuan";

async function withNavigator(value: unknown, action: () => Promise<void>): Promise<void> {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    Object.defineProperty(globalThis, "navigator", { configurable: true, value });
    try { await action(); } finally {
        if (descriptor) Object.defineProperty(globalThis, "navigator", descriptor);
        else Reflect.deleteProperty(globalThis, "navigator");
    }
}

async function withLockConfig(config: Partial<typeof storeLockConfig>, action: () => Promise<void>): Promise<void> {
    const previous = { ...storeLockConfig };
    Object.assign(storeLockConfig, config);
    try { await action(); } finally { Object.assign(storeLockConfig, previous); }
}

test("P0-020 已保存但回读失败是未知结果，不重发写入；严格读可核实原事实", async () => {
    let writes = 0;
    let stored: unknown;
    let failRead = true;
    const plugin = {
        saveData: async (_key: string, value: unknown) => { writes += 1; stored = structuredClone(value); },
        loadData: async () => { if (failRead) throw new Error("读取断开"); return stored; },
    } as unknown as Plugin;
    await assert.rejects(saveJsonVerified(plugin, "unknown.json", { events: ["原事实"] }), /存储读取失败/);
    assert.equal(writes, 1);
    failRead = false;
    assert.deepEqual(await loadJsonStrict(plugin, "unknown.json"), { events: ["原事实"] });
    assert.equal(writes, 1);
});

test("P0-020 已核实未应用才允许有界重试，写请求拒绝不自动重发", async () => {
    let writes = 0;
    let stored: unknown = null;
    const plugin = {
        saveData: async (_key: string, value: unknown) => { writes += 1; if (writes === 2) stored = value; },
        loadData: async () => stored,
    } as unknown as Plugin;
    await saveJsonVerified(plugin, "not-applied.json", { value: "核实后重试" });
    assert.equal(writes, 2);
    writes = 0;
    plugin.saveData = async () => { writes += 1; throw new Error("保存拒绝"); };
    await assert.rejects(saveJsonVerified(plugin, "rejected.json", {}), /保存拒绝/);
    assert.equal(writes, 1);
});

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

test("P0-019 存储锁：全部等待耗尽返回占用超时，回调零执行且不接管", async () => {
    await withLockConfig({ acquireTimeoutMs: 15, acquireRetryCount: 1 }, async () => {
        let calls = 0;
        let runs = 0;
        await withNavigator({ locks: { request: (key: string, options: LockOptions) => {
            assert.equal(key, "lvct-stuck");
            assert.equal(options.steal, undefined);
            calls += 1;
            return new Promise((_resolve, reject) => {
                options.signal!.addEventListener("abort", () => reject(options.signal!.reason), { once: true });
            });
        } } }, async () => {
            await assert.rejects(withStoreLock("stuck", async () => { runs += 1; }), (error: unknown) =>
                error instanceof StoreLockTimeoutError && error.name === "StoreLockTimeoutError"
                && error.key === "stuck" && error.timeoutMs === 15 && error.attempts === 2
                && error.message.includes("此次操作尚未执行") && error.message.includes("核实结果后重试"));
            assert.equal(calls, 2);
            assert.equal(runs, 0);
        });
    });
});

test("P0-019 存储锁：首次等待超时后可排队获得锁，业务只执行一次", async () => {
    await withLockConfig({ acquireTimeoutMs: 15, acquireRetryCount: 1 }, async () => {
        let calls = 0;
        let runs = 0;
        await withNavigator({ locks: { request: (_key: string, options: LockOptions, action: () => Promise<string>) => {
            assert.equal(options.steal, undefined);
            calls += 1;
            if (calls === 1) return new Promise<string>((_resolve, reject) => {
                options.signal!.addEventListener("abort", () => reject(options.signal!.reason), { once: true });
            });
            return Promise.resolve().then(action);
        } } }, async () => {
            assert.equal(await withStoreLock("slow-holder", async () => { runs += 1; return "ok"; }), "ok");
            assert.equal(calls, 2);
            assert.equal(runs, 1);
        });
    });
});

test("P0-019 存储锁：零重排队只等一次，超时后必须显式重试", async () => {
    await withLockConfig({ acquireTimeoutMs: 15, acquireRetryCount: 0 }, async () => {
        let calls = 0;
        let runs = 0;
        await withNavigator({ locks: { request: (_key: string, options: LockOptions, action: () => Promise<string>) => {
            assert.equal(options.steal, undefined);
            calls += 1;
            if (calls === 1) return new Promise<string>((_resolve, reject) => {
                options.signal!.addEventListener("abort", () => reject(options.signal!.reason), { once: true });
            });
            return Promise.resolve().then(action);
        } } }, async () => {
            const action = async () => { runs += 1; return "recovered"; };
            await assert.rejects(withStoreLock("retry", action), (error: unknown) =>
                error instanceof StoreLockTimeoutError && error.attempts === 1);
            assert.equal(calls, 1);
            assert.equal(runs, 0);
            assert.equal(await withStoreLock("retry", action), "recovered");
            assert.equal(calls, 2);
            assert.equal(runs, 1);
        });
    });
});

test("P0-019 存储锁：获得锁后慢写不再触发取锁中止", async (context) => {
    context.mock.timers.enable({ apis: ["setTimeout"] });
    await withLockConfig({ acquireTimeoutMs: 30 }, async () => {
        let signal!: AbortSignal;
        let release!: () => void;
        const gate = new Promise<void>((resolve) => { release = resolve; });
        await withNavigator({ locks: { request: (_key: string, options: LockOptions, action: () => Promise<string>) => {
            signal = options.signal!;
            return action();
        } } }, async () => {
            const pending = withStoreLock("writing", async () => { await gate; return "saved"; });
            try {
                context.mock.timers.tick(1000);
                assert.equal(signal.aborted, false, "持锁后取锁定时器仍在运行");
            } finally { release(); }
            assert.equal(await pending, "saved");
        });
    });
});

test("P0-019 存储锁：回调取消或嵌套锁超时原样上抛，不重放业务写入", async () => {
    for (const failure of [new DOMException("保存取消", "AbortError"), new StoreLockTimeoutError("nested", 30, 2)]) {
        let calls = 0;
        let writes = 0;
        await withNavigator({ locks: { request: async (_key: string, _options: LockOptions, action: () => Promise<void>) => {
            calls += 1;
            return action();
        } } }, async () => {
            await assert.rejects(withStoreLock("writing", async () => { writes += 1; throw failure; }),
                (error: unknown) => error === failure);
            assert.equal(calls, 1);
            assert.equal(writes, 1);
        });
    }
});

test("P0-019 存储锁：平台自行拒绝的 AbortError 不视为本次等待超时", async () => {
    const failure = new DOMException("平台拒绝取锁", "AbortError");
    let calls = 0;
    let runs = 0;
    await withNavigator({ locks: { request: async () => { calls += 1; throw failure; } } }, async () => {
        await assert.rejects(withStoreLock("denied", async () => { runs += 1; }), (error: unknown) => error === failure);
        assert.equal(calls, 1);
        assert.equal(runs, 0);
    });
});

test("P0-019 存储锁：请求同步拒绝也清除计时器，不绕过锁", async (context) => {
    context.mock.timers.enable({ apis: ["setTimeout"] });
    const failure = new Error("同步拒绝取锁");
    let signal!: AbortSignal;
    let runs = 0;
    await withNavigator({ locks: { request: (_key: string, options: LockOptions) => {
        signal = options.signal!;
        throw failure;
    } } }, async () => {
        await assert.rejects(withStoreLock("denied", async () => { runs += 1; }), (error: unknown) => error === failure);
        context.mock.timers.tick(10000);
        assert.equal(signal.aborted, false);
        assert.equal(runs, 0);
    });
});

test("P0-019 存储锁：无效等待配置在请求前拒绝，不产生无界重试", async () => {
    let calls = 0;
    await withNavigator({ locks: { request: async () => { calls += 1; } } }, async () => {
        for (const config of [
            { acquireTimeoutMs: 0 }, { acquireTimeoutMs: Infinity }, { acquireTimeoutMs: 2_147_483_648 },
            { acquireRetryCount: -1 }, { acquireRetryCount: 1.5 },
        ]) {
            await withLockConfig(config, async () => {
                await assert.rejects(withStoreLock("config", async () => {}), RangeError);
            });
        }
        assert.equal(calls, 0);
    });
});

test("FUNC-01.12 读取语义：严格读区分键不存在与读取失败；容错读把失败降级为 null（调用方不得据此写空）", async () => {
    const failing = { loadData: async () => { throw new Error("模拟磁盘故障"); } } as unknown as Plugin;
    await assert.rejects(loadJsonStrict(failing, "broken.json"), /存储读取失败.*broken\.json/);
    assert.equal(await loadJson(failing, "broken.json"), null, "容错读失败返回 null");
    const missing = { loadData: async () => null } as unknown as Plugin;
    assert.equal(await loadJsonStrict(missing, "absent.json"), null, "键不存在按 null 返回（正常空态）");
    assert.equal(await loadJson(missing, "absent.json"), null);
});
