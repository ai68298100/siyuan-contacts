import assert from "node:assert/strict";
import test from "node:test";
import { createLifecycleToken } from "../src/domain/lifecycle.ts";
import { emitDataChanged, LVCT_DATA_CHANGED, subscribeDataChangedDebounced } from "../src/libs/data-events.ts";

test("生命周期 token：失效后不可再次触发回调", () => {
    const token = createLifecycleToken();
    assert.equal(token.isAlive(), true);
    token.invalidate();
    token.invalidate();
    assert.equal(token.isAlive(), false);
});

test("父实例关闭：子实例清理一次，独立实例继续存活", () => {
    const parent = createLifecycleToken();
    const child = createLifecycleToken(parent);
    const replacement = createLifecycleToken();
    let cleanups = 0;
    child.onDispose(() => { cleanups += 1; });
    parent.invalidate();
    child.invalidate();
    assert.equal(child.isAlive(), false);
    assert.equal(cleanups, 1);
    assert.equal(replacement.isAlive(), true);
});

test("已销毁父实例不能登记新数据监听，订阅关闭可重复执行", (context) => {
    context.mock.timers.enable({ apis: ["setTimeout"] });
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
    const target = new EventTarget();
    Object.defineProperty(globalThis, "window", { configurable: true, value: target });
    try {
        const token = createLifecycleToken();
        token.invalidate();
        let registrations = 0;
        let callbacks = 0;
        context.mock.method(target, "addEventListener", () => { registrations += 1; });
        const unsubscribe = subscribeDataChangedDebounced(() => { callbacks += 1; }, { token });
        emitDataChanged();
        context.mock.timers.tick(400);
        unsubscribe();
        unsubscribe();
        assert.equal(registrations, 0);
        assert.equal(callbacks, 0);
    } finally {
        if (descriptor) Object.defineProperty(globalThis, "window", descriptor);
        else Reflect.deleteProperty(globalThis, "window");
    }
});

test("数据事件：销毁 token 后清理延迟回调与事件副作用", (context) => {
    context.mock.timers.enable({ apis: ["setTimeout"] });
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
    const target = new EventTarget();
    Object.defineProperty(globalThis, "window", { configurable: true, value: target });
    try {
        const token = createLifecycleToken();
        let refreshes = 0;
        let invalidations = 0;
        const unsubscribe = subscribeDataChangedDebounced(() => {
            refreshes += 1;
        }, { delayMs: 400, token, invalidate: () => { invalidations += 1; } });

        emitDataChanged({ preferencesRevision: 1 }, token);
        token.invalidate();
        context.mock.timers.tick(400);
        emitDataChanged({ preferencesRevision: 2 }, token);

        assert.equal(refreshes, 0);
        assert.equal(invalidations, 1);
        unsubscribe();
        assert.equal(target.dispatchEvent(new CustomEvent(LVCT_DATA_CHANGED, { detail: { revision: 3 } })), true);
        assert.equal(refreshes, 0);
    } finally {
        if (descriptor) Object.defineProperty(globalThis, "window", descriptor);
        else Reflect.deleteProperty(globalThis, "window");
    }
});

test("数据事件：重复挂载只保留仍存活的订阅", (context) => {
    context.mock.timers.enable({ apis: ["setTimeout"] });
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
    const target = new EventTarget();
    Object.defineProperty(globalThis, "window", { configurable: true, value: target });
    try {
        const firstToken = createLifecycleToken();
        const secondToken = createLifecycleToken();
        let firstRefreshes = 0;
        let secondRefreshes = 0;
        const firstUnsubscribe = subscribeDataChangedDebounced(() => { firstRefreshes += 1; }, { delayMs: 400, token: firstToken });
        const secondUnsubscribe = subscribeDataChangedDebounced(() => { secondRefreshes += 1; }, { delayMs: 400, token: secondToken });

        firstToken.invalidate();
        emitDataChanged({}, secondToken);
        context.mock.timers.tick(400);

        assert.equal(firstRefreshes, 0);
        assert.equal(secondRefreshes, 1);
        firstUnsubscribe();
        secondUnsubscribe();
    } finally {
        if (descriptor) Object.defineProperty(globalThis, "window", descriptor);
        else Reflect.deleteProperty(globalThis, "window");
    }
});
