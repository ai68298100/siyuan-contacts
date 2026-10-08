import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { assertTestPortAvailable, observeTestKernel, prepareIsolatedWorkspace } from "../e2e/kernel-safety.mjs";

const workspace = path.join(os.tmpdir(), `SiYuan-Contacts-Org-Operations-${randomUUID()}`);
const host = "127.0.0.1";
const kernel = [
    "D:/biji/SiYuan/resources/kernel/SiYuan-Kernel.exe",
    "D:/RJ/SiYuan/resources/kernel/SiYuan-Kernel.exe",
    path.join(process.env.ProgramFiles || "C:/Program Files", "SiYuan/resources/kernel/SiYuan-Kernel.exe"),
].find((candidate) => fs.existsSync(candidate));
if (!kernel) throw new Error("未找到隔离测试内核");
const appDir = path.resolve(path.dirname(kernel), "..");
const port = await new Promise((resolvePort, rejectPort) => {
    const server = net.createServer();
    server.once("error", rejectPort);
    server.listen({ host, port: 0 }, () => {
        const assigned = server.address().port;
        server.close((error) => error ? rejectPort(error) : resolvePort(assigned));
    });
});
await assertTestPortAvailable(host, port);
prepareIsolatedWorkspace(workspace, "organization-operations-spike.json", "lvct organization operations spike");
const results = { workspace, kernel, port, hostVerified: false };
let child;
let assertRunning;
let token = "";
async function request(route, body = {}) {
    assertRunning();
    const response = await fetch(`http://${host}:${port}${route}`, {
        method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Token ${token}` } : {}) },
        body: JSON.stringify(body), signal: AbortSignal.timeout(30000),
    });
    assertRunning();
    const payload = await response.json();
    if (payload.code !== 0) throw new Error(`${route}: ${payload.msg}`);
    return payload.data;
}
async function start() {
    child = spawn(kernel, ["--workspace", workspace, "serve", "--wd", appDir, "--port", String(port)], {
        stdio: "ignore", windowsHide: true, env: { ...process.env, SIYUAN_WORKSPACE_PATH: workspace },
    });
    assertRunning = observeTestKernel(child);
    const deadline = Date.now() + 60000;
    while (true) {
        assertRunning();
        const configPath = path.join(workspace, "conf", "conf.json");
        if (fs.existsSync(configPath)) token = JSON.parse(fs.readFileSync(configPath, "utf8")).api?.token ?? "";
        const boot = await request("/api/system/bootProgress").catch(() => undefined);
        if (Number(boot?.progress) >= 100) return;
        if (Date.now() > deadline) throw new Error("隔离内核启动超时");
        await new Promise((resolveWait) => setTimeout(resolveWait, 500));
    }
}
async function stop() {
    const exited = child.exitCode !== null || child.signalCode !== null
        ? Promise.resolve() : new Promise((resolveExit) => child.once("exit", resolveExit));
    await request("/api/system/exit", { force: true }).catch(() => {});
    const timeout = setTimeout(() => child.kill(), 5000);
    await exited;
    clearTimeout(timeout);
}
async function readMarkers(notebookId, requestId) {
    await request("/api/sqlite/flushTransaction");
    return request("/api/query/sql", { stmt: `SELECT id, root_id, box, ial, markdown FROM blocks WHERE box='${notebookId}' AND ial LIKE '%custom-lvct-org-draft="${requestId}"%'` });
}
try {
    await start();
    results.version = await request("/api/system/version");
    await request("/api/notebook/createNotebook", { name: "组织断点隔离验证" });
    const notebook = (await request("/api/notebook/lsNotebooks")).notebooks.find((item) => item.name === "组织断点隔离验证");
    const notebookId = notebook.id;
    assert.match(notebookId, /^\d{14}-[a-z0-9]{7}$/);
    const requestId = "20261004000000-orgreq1";
    const docId = await request("/api/filetree/createDocWithMd", {
        notebook: notebookId, path: "/组织 [甲]#%",
        markdown: `# 组织 \\[甲\\]\\#%\n\n**组织**：组织 \\[甲\\]\\#%\n{: custom-lvct-org-draft="${requestId}" custom-lvct-org="1"}\n\n用户正文保留\n`,
    });
    const markers = await readMarkers(notebookId, requestId);
    assert.equal(markers.length, 1);
    assert.equal(markers[0].root_id, docId);
    assert.match(markers[0].ial, /custom-lvct-org="1"/);
    assert.notEqual(markers[0].id, docId);
    results.atomicCreate = { notebookId, requestId, docId, markers };
    await stop();
    await assertTestPortAvailable(host, port);
    await start();
    const restarted = await readMarkers(notebookId, requestId);
    assert.deepEqual(restarted, markers);
    results.afterRestart = restarted;
    const docs = await request("/api/query/sql", { stmt: `SELECT id, path, content, box FROM blocks WHERE id='${docId}' AND type='d'` });
    await request("/api/filetree/renameDoc", { notebook: notebookId, path: docs[0].path, title: "改名组织" });
    const targetMarkdown = restarted[0].markdown.replace("组织 \\[甲\\]\\#%", "改名组织") + "\n" + restarted[0].ial;
    await request("/api/block/updateBlock", { id: restarted[0].id, dataType: "markdown", data: targetMarkdown });
    const renamedMarkers = await readMarkers(notebookId, requestId);
    assert.equal(renamedMarkers.length, 1);
    assert.equal(renamedMarkers[0].id, markers[0].id);
    assert.match(renamedMarkers[0].ial, /custom-lvct-org="1"/);
    const exported = await request("/api/export/exportMdContent", { id: docId });
    assert.match(exported.content, /用户正文保留/);
    results.renamePreservesMarkerAndBody = { markers: renamedMarkers, exported };
    console.log(JSON.stringify(results));
} catch (error) {
    results.error = error.message;
    process.exitCode = 1;
} finally {
    fs.writeFileSync(path.join(import.meta.dirname, "organization-operations-results.json"), JSON.stringify(results, null, 2) + "\n");
    if (child && child.exitCode === null && child.signalCode === null) await stop();
}
