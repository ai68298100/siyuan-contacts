import { test } from "node:test";
import assert from "node:assert/strict";
import {
    assertKernelArray,
    assertKernelRecord,
    classifyKernelData,
    decodeKernelResponse,
    KernelPermissionError,
    KernelProtocolError,
    KernelResponseError,
} from "../src/api/kernel-contract.ts";

test("CODE-02.6 协议解码：合法空数组是 empty，不是读故障", () => {
    const response = decodeKernelResponse<unknown[]>("/api/query/sql", { code: 0, msg: "", data: [] });
    assert.deepEqual(response.data, []);
    assert.equal(classifyKernelData(response.data), "empty");
});

test("CODE-02.6 协议解码：成功响应缺 data 显式报告 protocol", () => {
    assert.throws(
        () => decodeKernelResponse("/api/query/sql", { code: 0, msg: "" }),
        (error: unknown) => error instanceof KernelProtocolError && error.kind === "protocol",
    );
});

test("CODE-02.6 协议解码：缺 code/msg 或数据容器错误不会变成空结果", () => {
    assert.throws(
        () => decodeKernelResponse("/api/query/sql", { code: "0", msg: "", data: [] }),
        KernelProtocolError,
    );
    assert.throws(
        () => assertKernelArray("/api/query/sql", { rows: [] }),
        KernelProtocolError,
    );
    assert.throws(
        () => assertKernelRecord("/api/av/getAttributeViewItemIDsByBoundIDs", []),
        KernelProtocolError,
    );
});

test("CODE-02.6 协议解码：权限拒绝与普通内核失败分开", () => {
    assert.throws(
        () => decodeKernelResponse("/api/filetree/createDocWithMd", {
            code: 403,
            msg: "permission denied",
            data: null,
        }),
        (error: unknown) => error instanceof KernelPermissionError && error.kind === "permission",
    );
    assert.throws(
        () => decodeKernelResponse("/api/query/sql", { code: -1, msg: "database unavailable", data: null }),
        (error: unknown) => error instanceof KernelResponseError && error.kind === "kernel",
    );
});

test("CODE-02.6 数据分类：null/undefined/空字符串与有值结果可区分", () => {
    assert.equal(classifyKernelData(null), "empty");
    assert.equal(classifyKernelData(undefined), "empty");
    assert.equal(classifyKernelData("  "), "empty");
    assert.equal(classifyKernelData({}), "value");
    assert.equal(classifyKernelData(["row"]), "value");
});
