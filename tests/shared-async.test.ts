import { test } from "node:test";
import assert from "node:assert/strict";
import {
    AsyncAbortError,
    AsyncTimeoutError,
    withTimeout,
} from "../src/shared/async.ts";

test("CODE-02.6 withTimeout：正常完成透传值并清除定时器", async () => {
    const result = await withTimeout(async () => "ok", 5_000, "/api/x");
    assert.equal(result, "ok");
});

test("CODE-02.6 withTimeout：底层失败原样上抛（不被超时吞掉）", async () => {
    const failure = new Error("内核 code=1");
    await assert.rejects(
        withTimeout(async () => { throw failure; }, 5_000, "/api/x"),
        (error: unknown) => error === failure,
    );
});

test("CODE-02.6 withTimeout：超时以可识别错误拒绝，错误信息含路由与上限", async () => {
    await assert.rejects(
        withTimeout(() => new Promise<string>(() => {}), 20, "/api/query/sql"),
        (error: unknown) => error instanceof AsyncTimeoutError
            && error.kind === "timeout"
            && error.message === "/api/query/sql 请求超时（20ms）",
    );
});

test("CODE-02.6 withTimeout：AbortSignal 取消独立于超时", async () => {
    const controller = new AbortController();
    const pending = withTimeout(() => new Promise<string>(() => {}), 5_000, "/api/query/sql", {
        signal: controller.signal,
    });
    controller.abort();
    await assert.rejects(
        pending,
        (error: unknown) => error instanceof AsyncAbortError
            && error.kind === "aborted"
            && error.message === "/api/query/sql 请求已取消",
    );
});

test("CODE-02.6 withTimeout：已取消信号不会启动底层任务", async () => {
    const controller = new AbortController();
    controller.abort();
    let started = false;
    await assert.rejects(
        withTimeout(() => {
            started = true;
            return Promise.resolve("unexpected");
        }, 5_000, "/api/x", { signal: controller.signal }),
        AsyncAbortError,
    );
    assert.equal(started, false);
});
