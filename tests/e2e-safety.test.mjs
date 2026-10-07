import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import net from "node:net";
import { EventEmitter } from "node:events";
import { prepareIsolatedWorkspace, assertIsolatedPath, assertTestPortAvailable, observeTestKernel } from "../scripts/e2e/kernel-safety.mjs";
import { removeIsolatedBrowserProfile, stopIsolatedBrowser } from "../scripts/e2e/browser-cleanup.mjs";
import { fetchPost, kernel } from "../scripts/e2e/ui/siyuan-mock.js";
import { decodeKernelResponse } from "../src/api/kernel-contract.ts";

test("内核验收保护：新工作区可创建，合法标记复用，未标记/损坏/错误标记拒绝且原文件不变", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lvct-safety-"));
    try {
        const workspace = path.join(root, "workspace");
        prepareIsolatedWorkspace(workspace, "marker.json", "test");
        prepareIsolatedWorkspace(workspace, "marker.json", "test");
        const marker = path.join(workspace, "marker.json");
        fs.writeFileSync(marker, "bad");
        assert.throws(() => prepareIsolatedWorkspace(workspace, "marker.json", "test"));
        assert.equal(fs.readFileSync(marker, "utf8"), "bad");
        fs.writeFileSync(marker, JSON.stringify({ createdBy: "other" }));
        assert.throws(() => prepareIsolatedWorkspace(workspace, "marker.json", "test"));
        assert.throws(() => prepareIsolatedWorkspace(root, "missing.json", "test"));
        assertIsolatedPath(workspace, path.join(workspace, "data", "plugins", "new"));
        assert.throws(() => assertIsolatedPath(workspace, root));
        assert.throws(() => prepareIsolatedWorkspace(os.homedir(), "marker.json", "test"));
        assert.throws(() => prepareIsolatedWorkspace(process.cwd(), "marker.json", "test"));
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("内核验收保护：链接不能让安装或数据目标越出工作区", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lvct-links-"));
    try {
        const workspace = path.join(root, "workspace");
        prepareIsolatedWorkspace(workspace, "marker.json", "test");
        const outside = path.join(root, "outside");
        fs.mkdirSync(outside);
        const link = path.join(workspace, "data", "plugins");
        fs.symlinkSync(outside, link, process.platform === "win32" ? "junction" : "dir");
        assert.throws(() => assertIsolatedPath(workspace, path.join(link, "plugin")));
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("内核验收保护：端口占用拒绝，不连接或关闭原服务", async () => {
    let connections = 0;
    const server = net.createServer(() => { connections += 1; });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
        await assert.rejects(assertTestPortAvailable("127.0.0.1", server.address().port));
        assert.equal(connections, 0);
        assert.equal(server.listening, true);
        await assertTestPortAvailable("127.0.0.1", 0);
        await assert.rejects(assertTestPortAvailable("0.0.0.0", 0));
    } finally { await new Promise((resolve) => server.close(resolve)); }
});

test("内核验收保护：启动失败或进程退出立即停止请求", () => {
    const child = Object.assign(new EventEmitter(), { exitCode: null, signalCode: null });
    const check = observeTestKernel(child);
    check();
    child.exitCode = 1;
    assert.throws(check, /已退出/);
    child.exitCode = null;
    child.signalCode = "SIGTERM";
    assert.throws(check, /已退出/);
    child.signalCode = null;
    child.emit("error", new Error("spawn failed"));
    assert.throws(check, /spawn failed/);
});

test("UI mock：成功、空写入与失败信封符合生产解码，坏信封仍拒绝", async () => {
    kernel.handler = async () => [];
    const success = await new Promise((resolve) => fetchPost("/api/query/sql", {}, resolve));
    assert.deepEqual(decodeKernelResponse("/api/query/sql", success).data, []);
    kernel.handler = async () => undefined;
    const empty = await new Promise((resolve) => fetchPost("/api/block/updateBlock", {}, resolve));
    assert.equal(decodeKernelResponse("/api/block/updateBlock", empty).data, undefined);
    kernel.handler = async () => { throw new Error("权限不足"); };
    const failed = await new Promise((resolve) => fetchPost("/api/query/sql", {}, resolve));
    assert.throws(() => decodeKernelResponse("/api/query/sql", failed), /权限不足/);
    assert.throws(() => decodeKernelResponse("/api/query/sql", { code: 0, data: [] }), /msg/);
});

test("UI 清理：仅删除指定临时根下的独立浏览器目录，越界及链接拒绝", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lvct-ui-safety-"));
    try {
        const profile = fs.mkdtempSync(path.join(root, "lvct-ui-"));
        fs.writeFileSync(path.join(profile, "marker"), "fixture");
        await removeIsolatedBrowserProfile(profile, root);
        assert.equal(fs.existsSync(profile), false);
        await removeIsolatedBrowserProfile(profile, root);
        const shotProfile = fs.mkdtempSync(path.join(root, "lvct-shot-"));
        await removeIsolatedBrowserProfile(shotProfile, root);
        assert.equal(fs.existsSync(shotProfile), false);
        const outside = path.join(root, "outside");
        fs.mkdirSync(outside);
        fs.writeFileSync(path.join(outside, "keep"), "unchanged");
        await assert.rejects(removeIsolatedBrowserProfile(outside, root), /拒绝/);
        await assert.rejects(removeIsolatedBrowserProfile(root, root), /拒绝/);
        const link = path.join(root, "lvct-ui-linked");
        fs.symlinkSync(outside, link, process.platform === "win32" ? "junction" : "dir");
        await assert.rejects(removeIsolatedBrowserProfile(link, root), /拒绝/);
        assert.equal(fs.readFileSync(path.join(outside, "keep"), "utf8"), "unchanged");
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("UI 清理：Windows 先终止本轮进程树，等待浏览器与 helper 退出", async () => {
    const browser = Object.assign(new EventEmitter(), { pid: 12345, exitCode: null, signalCode: null });
    const helper = Object.assign(new EventEmitter(), { exitCode: null, signalCode: null });
    let finished = false;
    const stopped = stopIsolatedBrowser(browser, {
        platform: "win32",
        spawnProcess: (command, args, options) => {
            assert.equal(command, "taskkill");
            assert.deepEqual(args, ["/pid", "12345", "/T", "/F"]);
            assert.equal(options.windowsHide, true);
            return helper;
        },
    }).then(() => { finished = true; });
    await Promise.resolve();
    browser.exitCode = 0;
    browser.emit("exit", 0);
    await Promise.resolve();
    assert.equal(finished, false);
    helper.exitCode = 0;
    helper.emit("exit", 0);
    await stopped;
    assert.equal(finished, true);
});

test("UI 清理：普通平台等待退出，迟迟不退出则明确失败", async () => {
    const browser = Object.assign(new EventEmitter(), {
        pid: 12345, exitCode: null, signalCode: null,
        kill() { queueMicrotask(() => { this.signalCode = "SIGTERM"; this.emit("exit", null, "SIGTERM"); }); },
    });
    await stopIsolatedBrowser(browser, { platform: "linux" });
    const stuck = Object.assign(new EventEmitter(), { pid: 12346, exitCode: null, signalCode: null, kill() {} });
    await assert.rejects(stopIsolatedBrowser(stuck, { platform: "linux", timeoutMs: 10 }), /时限/);
});

test("UI 清理：优先通过本轮浏览器通道正常关闭，不调用进程树终止", async () => {
    const browser = Object.assign(new EventEmitter(), { pid: 12345, exitCode: null, signalCode: null });
    await stopIsolatedBrowser(browser, {
        platform: "win32",
        requestClose: () => { browser.exitCode = 0; browser.emit("exit", 0); },
        spawnProcess: () => { throw new Error("正常退出不应终止进程树"); },
    });
    assert.equal(browser.exitCode, 0);
});

test("UI 清理：进程树终止超时后，直接终止必须重新等待实际退出才能成功", async () => {
    const browser = Object.assign(new EventEmitter(), {
        pid: 12345, exitCode: null, signalCode: null,
        kill() { queueMicrotask(() => { this.signalCode = "SIGTERM"; this.emit("exit", null, "SIGTERM"); }); },
    });
    const helper = Object.assign(new EventEmitter(), {
        pid: 12346, exitCode: null, signalCode: null,
        kill() { queueMicrotask(() => { this.signalCode = "SIGTERM"; this.emit("exit", null, "SIGTERM"); }); },
    });
    await stopIsolatedBrowser(browser, { platform: "win32", timeoutMs: 20, spawnProcess: () => helper });
    assert.equal(browser.signalCode, "SIGTERM");
    assert.equal(helper.signalCode, "SIGTERM");
});

test("UI 清理：退出监听注册前已结束的 helper 不会误判超时", async () => {
    const browser = Object.assign(new EventEmitter(), {
        pid: 12345,
        exitCode: null,
        signalCode: null,
        kill() {
            this.signalCode = "SIGTERM";
            this.emit("exit", null, "SIGTERM");
        },
    });
    const helper = Object.assign(new EventEmitter(), { signalCode: null });
    let helperReads = 0;
    Object.defineProperty(helper, "exitCode", {
        configurable: true,
        get() { return ++helperReads >= 2 ? 0 : null; },
    });
    await stopIsolatedBrowser(browser, {
        platform: "win32",
        timeoutMs: 20,
        // The helper has already exited by the time waitForExit observes it.
        spawnProcess: () => helper,
    });
    assert.equal(browser.signalCode, "SIGTERM");
    assert.ok(helperReads >= 2);
});
