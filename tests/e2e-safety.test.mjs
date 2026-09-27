import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import net from "node:net";
import { EventEmitter } from "node:events";
import { prepareIsolatedWorkspace, assertIsolatedPath, assertTestPortAvailable, observeTestKernel } from "../scripts/e2e/kernel-safety.mjs";

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
