import { test } from "node:test";
import assert from "node:assert/strict";
import { withTimeout } from "../src/shared/async.ts";

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
        /\/api\/query\/sql 请求超时（20ms）/,
    );
});
