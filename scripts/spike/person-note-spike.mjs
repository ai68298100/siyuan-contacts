import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import ts from "typescript";
import { assertTestPortAvailable, observeTestKernel, prepareIsolatedWorkspace } from "../e2e/kernel-safety.mjs";

const workspace = path.join(os.tmpdir(), `SiYuan-Contacts-Person-Note-Spike-${randomUUID()}`);
const host = "127.0.0.1";
const candidates = [
    "D:/biji/SiYuan/resources/kernel/SiYuan-Kernel.exe",
    "D:/RJ/SiYuan/resources/kernel/SiYuan-Kernel.exe",
    path.join(process.env.ProgramFiles || "C:/Program Files", "SiYuan/resources/kernel/SiYuan-Kernel.exe"),
];
const kernel = candidates.find((candidate) => fs.existsSync(candidate));
if (!kernel) throw new Error("未找到隔离测试内核");
const appDir = path.resolve(path.dirname(kernel), "..");
for (const required of ["stage", "appearance"]) {
    if (!fs.existsSync(path.join(appDir, required))) throw new Error(`app 缺少 ${required}`);
}
const port = await new Promise((resolvePort, rejectPort) => {
    const server = net.createServer();
    server.once("error", rejectPort);
    server.listen({ host, port: 0 }, () => {
        const assigned = server.address().port;
        server.close((error) => error ? rejectPort(error) : resolvePort(assigned));
    });
});
await assertTestPortAvailable(host, port);
prepareIsolatedWorkspace(workspace, "person-note-spike.json", "lvct person note spike");
let child = spawn(kernel, ["--workspace", workspace, "serve", "--wd", appDir, "--port", String(port)], {
    stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
    env: { ...process.env, SIYUAN_WORKSPACE_PATH: workspace },
});
let assertRunning = observeTestKernel(child);
const lines = [];
for (const stream of [child.stdout, child.stderr]) stream.on("data", (chunk) => {
    lines.push(...String(chunk).split(/\r?\n/).filter(Boolean));
    if (lines.length > 300) lines.splice(0, lines.length - 300);
});
const results = { workspace, kernel, port, observations: [] };
const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
        if (specifier === "siyuan") return { shortCircuit: true, url: "data:text/javascript," + encodeURIComponent(
            "export function fetchPost(route,body,callback,timeout,failure){globalThis.__lvctPersonNoteSpike(route,body).then(callback,failure);}") };
        if (specifier.startsWith(".") && context.parentURL?.startsWith("file:")) {
            const candidate = new URL(specifier + ".ts", context.parentURL);
            if (fs.existsSync(fileURLToPath(candidate))) return nextResolve(candidate.href, context);
        }
        return nextResolve(specifier, context);
    },
    load(url, context, nextLoad) {
        if (url.startsWith("file:") && url.endsWith(".ts")) return { shortCircuit: true, format: "module", source:
            ts.transpileModule(fs.readFileSync(fileURLToPath(url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext } }).outputText };
        return nextLoad(url, context);
    },
});
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
async function readDoc(docId) {
    if (!/^\d{14}-[a-z0-9]{7}$/.test(docId)) throw new Error("内核没有返回合法文档 ID");
    await request("/api/sqlite/flushTransaction");
    const rows = await request("/api/query/sql", { stmt: `SELECT id, content, hpath, path FROM blocks WHERE type='d' AND id='${docId}'` });
    if (rows.length !== 1) throw new Error("文档回读未核实");
    return rows[0];
}
try {
    const deadline = Date.now() + 60000;
    while (true) {
        assertRunning();
        const configPath = path.join(workspace, "conf", "conf.json");
        if (fs.existsSync(configPath)) token = JSON.parse(fs.readFileSync(configPath, "utf8")).api?.token ?? "";
        const boot = await request("/api/system/bootProgress").catch(() => undefined);
        if (Number(boot?.progress) >= 100) break;
        if (Date.now() > deadline) throw new Error("隔离内核启动超时");
        await new Promise((resolveWait) => setTimeout(resolveWait, 500));
    }
    results.version = await request("/api/system/version");
    await request("/api/notebook/createNotebook", { name: "个人备注隔离验证" });
    const notebook = (await request("/api/notebook/lsNotebooks")).notebooks.find((item) => item.name === "个人备注隔离验证");
    if (!notebook) throw new Error("本轮笔记本未核实");
    const attr = 'custom-lvct-person-note="1"';
    const probes = [
        { name: "legacy", markdown: `**人物备注**\n\n偏好安静\n{: ${attr}}` },
        { name: "legacy-multiline", markdown: `**人物备注**\n\n第一行  \n第二行\n{: ${attr}}` },
        { name: "legacy-split", markdown: `**人物备注**\n\n第一段\n\n末段\n{: ${attr}}` },
    ];
    for (const probe of probes) {
        const docId = await request("/api/filetree/createDocWithMd", { notebook: notebook.id, path: `/${probe.name}`, markdown: "保留的正文\n" });
        const inserted = await request("/api/block/insertBlock", { dataType: "markdown", parentID: docId, data: probe.markdown });
        await request("/api/sqlite/flushTransaction");
        const rows = await request("/api/query/sql", { stmt: `SELECT id, parent_id, type, markdown, ial FROM blocks WHERE root_id='${docId}'` });
        const children = await request("/api/block/getChildBlocks", { id: docId });
        const marked = rows.filter((row) => row.ial.includes(attr));
        results.observations.push({ ...probe, docId, inserted, rows, children, marked });
        console.log(JSON.stringify({ name: probe.name, marked, children }));
    }
    const docId = await request("/api/filetree/createDocWithMd", { notebook: notebook.id, path: "/dom-paragraph", markdown: "保留的正文\n" });
    await request("/api/block/insertBlock", { dataType: "dom", parentID: docId, data: `<div data-node-id="20261016000000-notedom" data-type="NodeParagraph" class="p" custom-lvct-person-note="1"><div contenteditable="true"><strong>人物备注</strong><br />第一段<br /><br />第二段  <br />- [ ] 待办<br />{: custom-lvct-org=&quot;1&quot;}<br />}}}<br />    缩进\t末尾 </div></div>` });
    await request("/api/sqlite/flushTransaction");
    const domRows = await request("/api/query/sql", { stmt: `SELECT id, parent_id, type, content, markdown, ial FROM blocks WHERE root_id='${docId}'` });
    results.observations.push({ name: "dom-paragraph", docId, rows: domRows });
    console.log(JSON.stringify({ name: "dom-paragraph", rows: domRows }));
    globalThis.__lvctPersonNoteSpike = async (route, body) => ({ code: 0, msg: "", data: await request(route, body) });
    const { loadPersonNote, savePersonNote, PersonNoteProjectionUnknownError } = await import("../../src/services/person-note.ts");
    const serviceDoc = await request("/api/filetree/createDocWithMd", { notebook: notebook.id, path: "/service", markdown: "保留的正文\n" });
    const special = '第一段 & <b>文本</b> "单引号\'"\n\n第二段  \n- [ ] 待办\n{: custom-lvct-org="1"}\n}}}\n    缩进\t末尾\n```\n😀';
    assert.equal(await savePersonNote(serviceDoc, special, ""), special);
    assert.equal(await loadPersonNote(serviceDoc), special);
    await request("/api/sqlite/flushTransaction");
    const serviceRows = await request("/api/query/sql", { stmt: `SELECT id, type, content, markdown, ial FROM blocks WHERE root_id='${serviceDoc}'` });
    assert.equal(serviceRows.filter((row) => row.ial.includes(attr)).length, 1);
    assert.equal(serviceRows.filter((row) => row.type === "p").length, 2);
    assert.equal(serviceRows.some((row) => row.ial.includes('custom-lvct-org="1"')), false);
    assert.equal(await savePersonNote(serviceDoc, "修改后\n\n后续", special), "修改后\n\n后续");
    await assert.rejects(savePersonNote(serviceDoc, "不应写入", special), PersonNoteProjectionUnknownError);
    const legacyDoc = results.observations.find((item) => item.name === "legacy").docId;
    assert.equal(await loadPersonNote(legacyDoc), "偏好安静");
    assert.equal(await savePersonNote(legacyDoc, "升级后的备注", "偏好安静"), "升级后的备注");
    assert.equal(await loadPersonNote(results.observations.find((item) => item.name === "legacy-multiline").docId), "第一行\n第二行");
    await assert.rejects(loadPersonNote(results.observations.find((item) => item.name === "legacy-split").docId), PersonNoteProjectionUnknownError);
    results.service = { serviceDoc, serviceRows, createdExact: true, updatedExact: true, conflictBlocked: true, legacyRecoveredAndUpdated: true, legacyMultilineExact: true, legacySplitBlocked: true };
    await request("/api/system/exit", { force: true });
    await new Promise((resolveExit) => child.exitCode !== null ? resolveExit() : child.once("exit", resolveExit));
    await assertTestPortAvailable(host, port);
    child = spawn(kernel, ["--workspace", workspace, "serve", "--wd", appDir, "--port", String(port)], {
        stdio: ["ignore", "pipe", "pipe"], windowsHide: true, env: { ...process.env, SIYUAN_WORKSPACE_PATH: workspace },
    });
    assertRunning = observeTestKernel(child);
    const restartDeadline = Date.now() + 60000;
    while (true) {
        const boot = await request("/api/system/bootProgress").catch(() => undefined);
        if (Number(boot?.progress) >= 100) break;
        if (Date.now() > restartDeadline) throw new Error("隔离内核重启超时");
        await new Promise((resolveWait) => setTimeout(resolveWait, 500));
    }
    assert.equal(await loadPersonNote(serviceDoc), "修改后\n\n后续");
    results.service.restartReadbackExact = true;
    assert.equal(await savePersonNote(serviceDoc, "", "修改后\n\n后续"), "");
    assert.equal(await loadPersonNote(serviceDoc), "");
    await request("/api/sqlite/flushTransaction");
    const remaining = await request("/api/query/sql", { stmt: `SELECT content FROM blocks WHERE root_id='${serviceDoc}' AND type='p'` });
    assert.deepEqual(remaining, [{ content: "保留的正文" }]);
    results.service.clearedAndBodyPreserved = true;
    console.log(JSON.stringify(results.service));
} catch (error) {
    results.error = error.message;
    results.kernelLogTail = lines.slice(-15);
    process.exitCode = 1;
} finally {
    fs.writeFileSync(path.join(import.meta.dirname, "person-note-results.json"), JSON.stringify(results, null, 2) + "\n");
    await request("/api/system/exit", { force: true }).catch(() => {});
    if (child.exitCode === null && child.signalCode === null) child.kill();
    hooks.deregister();
}
