import assert from "node:assert/strict";
import test from "node:test";
import { guardScratch, isScratchName, kernelTokenFromConfig, resolveTarget, sweepOrphans } from "../scripts/lib/smoke-kernel.mjs";

test("写型冒烟前缀只匹配本项目临时库", () => {
    assert.equal(isScratchName("lvct-contacts-smoke-123"), true);
    assert.equal(isScratchName("lvct-contacts-e2e-123"), true);
    assert.equal(isScratchName("人脉-E2E-123"), false);
    assert.equal(isScratchName("人脉-E2E"), false);
    assert.equal(isScratchName("RenmaiSpike"), false);
    assert.equal(isScratchName("RenmaiSpikeBackup"), false);
    assert.equal(isScratchName("人脉"), false);
    assert.equal(isScratchName("lvct-other-plugin-smoke-123"), false);
});

test("目标解析不生成默认 token", () => {
    const oldBase = process.env.SIYUAN_BASE_URL;
    const oldToken = process.env.SIYUAN_TOKEN;
    try {
        delete process.env.SIYUAN_BASE_URL;
        delete process.env.SIYUAN_TOKEN;
        assert.throws(() => resolveTarget(), /缺少思源地址/);
        process.env.SIYUAN_BASE_URL = "http://127.0.0.1:6807/";
        assert.throws(() => resolveTarget(), /缺少思源 token/);
        process.env.SIYUAN_TOKEN = "lab-token";
        assert.deepEqual(resolveTarget(), { base: "http://127.0.0.1:6807", token: "lab-token" });
        assert.deepEqual(resolveTarget({ baseArg: "http://127.0.0.1:6808/", tokenArg: "argv-token" }), { base: "http://127.0.0.1:6808", token: "argv-token" });
    } finally {
        if (oldBase === undefined) delete process.env.SIYUAN_BASE_URL; else process.env.SIYUAN_BASE_URL = oldBase;
        if (oldToken === undefined) delete process.env.SIYUAN_TOKEN; else process.env.SIYUAN_TOKEN = oldToken;
    }
});

test("兼容新旧隔离内核的 token 配置位置", () => {
    assert.equal(kernelTokenFromConfig({ api: { token: "new-token" }, accessAuthCode: "old-token" }), "new-token");
    assert.equal(kernelTokenFromConfig({ accessAuthCode: "old-token" }), "old-token");
    assert.equal(kernelTokenFromConfig({ api: { token: "" }, accessAuthCode: "" }), "");
});

test("共享靶场包含真实笔记本时拒绝写入", async () => {
    const api = async (route) => route === "/api/notebook/lsNotebooks"
        ? { code: 0, data: { notebooks: [{ id: "a", name: "日常库" }] } }
        : { code: 0, data: null };
    const old = process.env.SIYUAN_E2E_ALLOW_SHARED;
    delete process.env.SIYUAN_E2E_ALLOW_SHARED;
    await assert.rejects(guardScratch(api, { base: "http://127.0.0.1:6807" }), /拒绝写型冒烟|隔离靶场/);
    if (old === undefined) delete process.env.SIYUAN_E2E_ALLOW_SHARED; else process.env.SIYUAN_E2E_ALLOW_SHARED = old;
});

test("残留清扫只删除注册前缀", async () => {
    const calls = [];
    const api = async (route, body) => {
        if (route === "/api/notebook/lsNotebooks") return { code: 0, data: { notebooks: [
            { id: "a", name: "lvct-contacts-smoke-old" },
            { id: "b", name: "人脉-E2E" },
            { id: "c", name: "RenmaiSpike" },
            { id: "d", name: "日常库" },
        ] } };
        calls.push({ route, body });
        return { code: 0, data: null };
    };
    await sweepOrphans(api);
    assert.deepEqual(calls, [{ route: "/api/notebook/removeNotebook", body: { notebook: "a" } }]);
});

test("残留清扫失败时阻止后续写入", async () => {
    const api = async (route) => route === "/api/notebook/lsNotebooks"
        ? { code: 0, data: { notebooks: [{ id: "a", name: "lvct-contacts-smoke-old" }] } }
        : { code: -1, msg: "拒绝删除" };
    await assert.rejects(sweepOrphans(api), /临时库清扫失败/);
});
