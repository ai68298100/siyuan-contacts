import assert from "node:assert/strict";
import test from "node:test";
import { createDebouncer, createThrottler } from "../src/domain/debounce.ts";

/** 安装可控时钟：手动推进时间，避免真实等待导致的 flaky */
function useFakeTimers() {
    const timers: Array<{ id: number; at: number; fn: () => void }> = [];
    let now = 0;
    let nextId = 1;
    const originalSetTimeout = globalThis.setTimeout;
    const originalClearTimeout = globalThis.clearTimeout;

    (globalThis as unknown as { setTimeout: typeof setTimeout }).setTimeout = ((fn: () => void, ms?: number) => {
        const id = nextId++;
        timers.push({ id, at: now + (typeof ms === "number" ? ms : 0), fn });
        return id;
    }) as typeof setTimeout;
    (globalThis as unknown as { clearTimeout: typeof clearTimeout }).clearTimeout = ((id: unknown) => {
        const index = timers.findIndex((timer) => timer.id === id);
        if (index >= 0) timers.splice(index, 1);
    }) as typeof clearTimeout;

    return {
        advance(ms: number) {
            const target = now + ms;
            // 按到期时间顺序触发，保证时序正确
            const due = timers.filter((timer) => timer.at <= target).sort((a, b) => a.at - b.at);
            for (const timer of due) {
                const index = timers.indexOf(timer);
                if (index >= 0) timers.splice(index, 1);
                now = Math.max(now, timer.at);
                timer.fn();
            }
            now = Math.max(now, target);
        },
        restore() {
            (globalThis as unknown as { setTimeout: typeof setTimeout }).setTimeout = originalSetTimeout;
            (globalThis as unknown as { clearTimeout: typeof clearTimeout }).clearTimeout = originalClearTimeout;
        },
    };
}

test("debounce：高频输入只提交稳定后的最后一次值", () => {
    const clock = useFakeTimers();
    try {
        const committed: string[] = [];
        const debouncer = createDebouncer<string>({ waitMs: 200, onCommit: (value) => committed.push(value) });

        // 模拟连续输入 5 次（每次间隔 50ms，均小于 200ms 窗口）
        for (const text of ["张", "张三", "张三的", "张三的电", "张三的电话"]) {
            debouncer.schedule(text);
            clock.advance(50);
        }
        assert.equal(committed.length, 0, "窗口内不应提交");

        // 最后一次输入后等待满 200ms
        clock.advance(200);
        assert.deepEqual(committed, ["张三的电话"], "只提交稳定后的最后一次值");
        assert.equal(debouncer.pending, false, "提交后无挂起");
    } finally {
        clock.restore();
    }
});

test("debounce：flush 立即提交挂起值，cancel 丢弃且不再提交", () => {
    const clock = useFakeTimers();
    try {
        const committed: string[] = [];
        const debouncer = createDebouncer<string>({ waitMs: 200, onCommit: (value) => committed.push(value) });

        // flush：立即提交
        debouncer.schedule("立即提交");
        assert.equal(debouncer.pending, true);
        debouncer.flush();
        assert.deepEqual(committed, ["立即提交"], "flush 应立刻提交");
        assert.equal(debouncer.pending, false);
        // flush 后即使时间推进也不再重复提交
        clock.advance(500);
        assert.equal(committed.length, 1, "flush 后不应重复提交");

        // cancel：丢弃挂起值
        debouncer.schedule("将被丢弃");
        debouncer.cancel();
        clock.advance(500);
        assert.deepEqual(committed, ["立即提交"], "cancel 后不应提交");

        // 无挂起时 flush 是安全的空操作
        debouncer.flush();
        assert.equal(committed.length, 1);
    } finally {
        clock.restore();
    }
});

test("debounce：dispose 后所有方法幂等，杜绝卸载后迟到提交（防泄漏）", () => {
    const clock = useFakeTimers();
    try {
        const committed: string[] = [];
        const debouncer = createDebouncer<string>({ waitMs: 200, onCommit: (value) => committed.push(value) });

        debouncer.schedule("卸载前输入");
        debouncer.dispose();
        clock.advance(1000);
        assert.deepEqual(committed, [], "dispose 后不应提交挂起值");

        // dispose 后继续 schedule/flush 均无副作用
        debouncer.schedule("卸载后输入");
        debouncer.flush();
        clock.advance(1000);
        assert.deepEqual(committed, [], "dispose 后完全静默");
        assert.equal(debouncer.pending, false);
    } finally {
        clock.restore();
    }
});

test("debounce：waitMs 非法值钳制（负数归 0，超大钳到上限，NaN 用默认 200）", () => {
    const clock = useFakeTimers();
    try {
        // 负数 → 归 0（下次宏任务即提交）
        const zero: string[] = [];
        const zeroDebouncer = createDebouncer<string>({ waitMs: -100, onCommit: (v) => zero.push(v) });
        zeroDebouncer.schedule("零等待");
        clock.advance(0);
        assert.deepEqual(zero, ["零等待"], "waitMs 为负时应归 0");

        // NaN → 默认 200
        const nan: string[] = [];
        const nanDebouncer = createDebouncer<string>({ waitMs: Number.NaN, onCommit: (v) => nan.push(v) });
        nanDebouncer.schedule("默认等待");
        clock.advance(100);
        assert.equal(nan.length, 0, "NaN 应回退默认 200ms，100ms 时不提交");
        clock.advance(100);
        assert.deepEqual(nan, ["默认等待"]);

        // 超大 → 钳到 5000 上限
        const huge: string[] = [];
        const hugeDebouncer = createDebouncer<string>({ waitMs: 999999, onCommit: (v) => huge.push(v) });
        hugeDebouncer.schedule("超大等待");
        clock.advance(5000);
        assert.deepEqual(huge, ["超大等待"], "超大 waitMs 应被钳制到 5000");
    } finally {
        clock.restore();
    }
});

test("throttle：按窗口节奏提交，尾随提交保证最后一次不丢失", () => {
    const clock = useFakeTimers();
    try {
        const committed: number[] = [];
        const throttler = createThrottler<number>(100, (value) => committed.push(value));

        // 第 1 次立即通过（lastCommitAt 初始为 0，elapsed 足够大）
        throttler.schedule(1);
        assert.deepEqual(committed, [1], "首次应立即提交");

        // 紧接着的两次在窗口内：不立即提交，只安排尾随
        throttler.schedule(2);
        throttler.schedule(3);
        assert.deepEqual(committed, [1], "窗口内不重复提交");

        // 推进到窗口结束：尾随提交最后一次值
        clock.advance(100);
        assert.deepEqual(committed, [1, 3], "尾随应提交最后一次输入");

        throttler.dispose();
        throttler.schedule(4);
        clock.advance(500);
        assert.deepEqual(committed, [1, 3], "dispose 后静默");
    } finally {
        clock.restore();
    }
});
