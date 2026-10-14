import assert from "node:assert/strict";
import test from "node:test";
import { AsyncAbortError, AsyncTimeoutError } from "../src/shared/async.ts";
import {
    KernelPermissionError,
    KernelProtocolError,
    KernelResponseError,
    KernelTransportError,
} from "../src/api/kernel-contract.ts";
import { presentRequestError, requestErrorMessage } from "../src/shared/error-presenter.ts";

test("请求错误文案将 401 与 403 分别指向宿主登录和数据权限", () => {
    const expired = presentRequestError(new KernelPermissionError("/api/query/sql", 401, "unauthorized"));
    assert.equal(expired.kind, "permission");
    assert.equal(expired.retryable, true);
    assert.match(expired.message, /登录状态可能已失效/);
    assert.match(expired.message, /思源中/);

    const forbidden = presentRequestError(new KernelPermissionError("/api/query/sql", 403, "forbidden"));
    assert.equal(forbidden.kind, "permission");
    assert.equal(forbidden.retryable, true);
    assert.match(forbidden.message, /没有访问这部分数据的权限/);
    assert.match(forbidden.message, /数据库权限/);
});

test("请求错误文案区分超时、传输失败和主动取消", () => {
    const timeout = presentRequestError(new AsyncTimeoutError("联系人读取", 15_000));
    assert.equal(timeout.kind, "timeout");
    assert.equal(timeout.retryable, true);
    assert.match(timeout.message, /超时/);

    const transport = presentRequestError(new KernelTransportError("/api/query/sql", new Error("offline")));
    assert.equal(transport.kind, "transport");
    assert.equal(transport.retryable, true);
    assert.match(transport.message, /无法连接思源内核/);

    const cancelled = presentRequestError(new AsyncAbortError("联系人读取"));
    assert.equal(cancelled.kind, "cancelled");
    assert.equal(cancelled.retryable, false);
});

test("协议与业务拒绝不会伪装为空结果，并提供可理解的处置建议", () => {
    const protocol = presentRequestError(new KernelProtocolError("/api/query/sql", "响应不是数组"));
    assert.equal(protocol.kind, "protocol");
    assert.match(protocol.message, /未按空结果处理/);
    assert.match(protocol.message, /版本兼容性/);

    const kernel = presentRequestError(new KernelResponseError("/api/query/sql", -1, "数据库暂不可用"));
    assert.equal(kernel.kind, "kernel");
    assert.equal(kernel.retryable, true);
    assert.match(kernel.message, /数据库暂不可用/);
    assert.match(kernel.message, /核对数据状态/);
});

test("未知异常不向界面泄漏原始对象内容，仍提供清晰的人工重试建议", () => {
    const presented = presentRequestError({ secret: "private", toString: () => "raw error" });
    assert.deepEqual(presented, {
        kind: "unknown",
        message: "读取未完成。请检查思源状态后重试。",
        retryable: true,
    });
});

test("页面错误入口统一翻译内核权限错误，同时保留可定位的业务错误", () => {
    assert.match(requestErrorMessage(new KernelPermissionError("/api/query/sql", 403, "forbidden")), /没有访问这部分数据的权限/);
    assert.equal(requestErrorMessage(new Error("组织名称不能为空")), "组织名称不能为空");
    assert.equal(requestErrorMessage({ private: "not shown" }), "操作未完成，请检查后重试。");
});

test("跨 Realm 的可恢复错误仍保留具体重试指引", () => {
    assert.match(requestErrorMessage({ name: "StoreLockTimeoutError", message: "此次操作尚未执行，请稍后重试" }), /此次操作尚未执行/);
    assert.equal(requestErrorMessage({ name: "UnknownThing", message: "" }), "操作未完成，请检查后重试。");
});
