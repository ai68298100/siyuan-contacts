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

const runId = randomUUID();
const workspace = path.join(os.tmpdir(), `SiYuan-Lvct-Note-Detach-${runId}`);
const host = "127.0.0.1";
const kernel = ["D:/RJ/SiYuan/resources/kernel/SiYuan-Kernel.exe", "D:/biji/SiYuan/resources/kernel/SiYuan-Kernel.exe"].find((item) => fs.existsSync(item));
if (!kernel) throw new Error("未找到隔离内核");
const appDir = path.resolve(path.dirname(kernel), "..");
const port = await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen({ host, port: 0 }, () => { const assigned = server.address().port; server.close((error) => error ? reject(error) : resolve(assigned)); });
});
await assertTestPortAvailable(host, port);
prepareIsolatedWorkspace(workspace, "person-note-detach-spike.json", "lvct note detach isolated probe");
const child = spawn(kernel, ["--workspace", workspace, "serve", "--wd", appDir, "--port", String(port)], {
    stdio: ["ignore", "pipe", "pipe"], windowsHide: true, env: { ...process.env, SIYUAN_WORKSPACE_PATH: workspace },
});
const assertRunning = observeTestKernel(child);
const logTail = [];
for (const stream of [child.stdout, child.stderr]) stream.on("data", (chunk) => { logTail.push(String(chunk)); if (logTail.length > 15) logTail.shift(); });
const result = { runId, workspace, kernel, port, fictionalOnly: true, startedAt: new Date().toISOString() };
const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
        if (specifier === "siyuan") return { shortCircuit: true, url: "data:text/javascript," + encodeURIComponent(
            "export function fetchPost(route,body,callback,timeout,failure){globalThis.__lvctNoteDetachSpike(route,body).then(callback,failure);}") };
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
    const response = await fetch(`http://${host}:${port}${route}`, { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Token ${token}` } : {}) }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
    assertRunning();
    const payload = await response.json();
    if (payload.code !== 0) throw new Error(`${route}: ${payload.code} ${payload.msg}`);
    return payload.data;
}
async function readRows(docId) {
    assert.match(docId, /^\d{14}-[0-9a-z]{7}$/);
    await request("/api/sqlite/flushTransaction");
    return request("/api/query/sql", { stmt: `SELECT id, root_id, parent_id, type, content, markdown, ial FROM blocks WHERE root_id='${docId}' ORDER BY id` });
}
async function waitForChildExit(timeoutMs) {
    if (child.exitCode !== null || child.signalCode !== null) return true;
    return new Promise((resolve) => {
        const finish = (exited) => { clearTimeout(timer); child.removeListener("exit", onExit); resolve(exited); };
        const onExit = () => finish(true);
        const timer = setTimeout(() => finish(false), timeoutMs);
        child.once("exit", onExit);
    });
}
try {
    const deadline = Date.now() + 60000;
    while (true) {
        const config = path.join(workspace, "conf", "conf.json");
        if (fs.existsSync(config)) token = JSON.parse(fs.readFileSync(config, "utf8")).api?.token ?? "";
        const boot = await request("/api/system/bootProgress").catch(() => undefined);
        if (boot?.progress >= 100) break;
        if (Date.now() > deadline) throw new Error("隔离内核启动超时");
        await new Promise((resolve) => setTimeout(resolve, 300));
    }
    result.version = await request("/api/system/version");
    const name = `Fictional legacy note ${runId}`;
    await request("/api/notebook/createNotebook", { name });
    const notebook = (await request("/api/notebook/lsNotebooks")).notebooks.find((item) => item.name === name);
    assert.ok(notebook);
    const legacyMarkdown = '保留正文\n\n**人物备注**\n\n第一段\n\n末段\n{: custom-lvct-person-note="1" custom-user-proof="保留"}\n';
    const docId = await request("/api/filetree/createDocWithMd", { notebook: notebook.id, path: "/legacy-split", markdown: legacyMarkdown });
    const before = await readRows(docId);
    const marked = before.filter((item) => item.ial.includes('custom-lvct-person-note="1"'));
    assert.equal(marked.length, 1);
    const original = marked[0];
    await request("/api/attr/setBlockAttrs", { id: original.id, attrs: { "custom-lvct-person-note": "", "custom-lvct-person-note-detached": "1" } });
    const after = await readRows(docId);
    const detached = after.find((item) => item.id === original.id);
    assert.ok(detached && !detached.ial.includes('custom-lvct-person-note="'));
    assert.ok(detached.ial.includes('custom-lvct-person-note-detached="1"'));
    assert.ok(detached.ial.includes('custom-user-proof="保留"'));
    assert.deepEqual(after.map(({ ial, ...row }) => row), before.map(({ ial, ...row }) => row));
    result.attributeProbe = { docId, before, after, emptyValueRemovesMarker: true, detachedMarkerPresent: true, unrelatedAttributePreserved: true, allTextAndBlocksPreserved: true };

    // A separate real legacy document exercises the production service, including
    // a successful mutation whose response is deliberately lost in transport.
    const serviceDocId = await request("/api/filetree/createDocWithMd", { notebook: notebook.id, path: "/service-legacy-split", markdown: legacyMarkdown });
    const serviceBefore = await readRows(serviceDocId);
    let detachRequestCount = 0;
    let loseNextDetachReply = true;
    globalThis.__lvctNoteDetachSpike = async (route, body) => {
        const isDetach = route === "/api/attr/setBlockAttrs" && body.attrs?.["custom-lvct-person-note-detached"] === "1";
        if (isDetach) detachRequestCount += 1;
        const data = await request(route, body);
        if (isDetach && loseNextDetachReply) {
            loseNextDetachReply = false;
            throw new Error("fictional lost detach response after applied mutation");
        }
        return { code: 0, msg: "", data };
    };
    const { loadPersonNote, savePersonNote, inspectLegacyPersonNote, detachLegacyPersonNote, PersonNoteProjectionUnknownError } = await import("../../src/services/person-note.ts");
    await assert.rejects(loadPersonNote(serviceDocId), PersonNoteProjectionUnknownError);
    const snapshot = await inspectLegacyPersonNote(serviceDocId);
    assert.equal(snapshot.content, "末段");
    assert.equal(snapshot.markdown, "末段");
    assert.equal(detachRequestCount, 0);
    await assert.rejects(detachLegacyPersonNote(serviceDocId, snapshot), PersonNoteProjectionUnknownError);
    assert.equal(detachRequestCount, 1);
    await detachLegacyPersonNote(serviceDocId, snapshot);
    assert.equal(detachRequestCount, 1, "lost-response retry must verify rather than resend");
    const serviceDetached = await readRows(serviceDocId);
    assert.deepEqual(serviceDetached.map(({ ial, ...row }) => row), serviceBefore.map(({ ial, ...row }) => row));
    const oldTail = serviceDetached.find((row) => row.id === snapshot.blockId);
    assert.ok(oldTail.ial.includes('custom-lvct-person-note-detached="1"'));
    assert.ok(oldTail.ial.includes('custom-user-proof="保留"'));
    assert.equal(await loadPersonNote(serviceDocId), "");
    const completeNote = "第一段\n\n末段";
    assert.equal(await savePersonNote(serviceDocId, completeNote, ""), completeNote);
    assert.equal(await loadPersonNote(serviceDocId), completeNote);
    const serviceAfter = await readRows(serviceDocId);
    for (const { ial, ...originalRow } of serviceBefore) {
        const { ial: currentIal, ...currentRow } = serviceAfter.find((row) => row.id === originalRow.id) ?? {};
        assert.deepEqual(currentRow, originalRow, "creating a replacement note must preserve every old block and its text");
    }
    const activeNotes = serviceAfter.filter((row) => row.ial.includes('custom-lvct-person-note="1"'));
    assert.equal(activeNotes.length, 1);
    assert.ok(activeNotes[0].ial.includes('custom-lvct-person-note-format="2"'));
    assert.notEqual(activeNotes[0].id, snapshot.blockId);
    result.serviceProbe = { docId: serviceDocId, snapshot, before: serviceBefore, detached: serviceDetached, after: serviceAfter,
        unreadableLegacyBlocked: true, inspectionReadOnly: true, appliedResponseLost: true, sameRequestRetryVerifiedWithoutResend: true,
        detachRequestCount, allOldTextAndBlocksPreserved: true, unrelatedAttributePreserved: true, emptyBaselineReread: true, completeNoteSavedAndLoaded: true };
    result.passed = true;
} catch (error) {
    result.error = error.message;
    result.logTail = logTail;
    process.exitCode = 1;
} finally {
    const cleanup = { pid: child.pid, exitRequested: false, forcedTermination: false, exited: false, portReleased: false };
    try {
        cleanup.exitRequested = true;
        await request("/api/system/exit", { force: true }).catch(() => {});
        cleanup.exited = await waitForChildExit(5000);
        if (!cleanup.exited) {
            cleanup.forcedTermination = true;
            child.kill();
            cleanup.exited = await waitForChildExit(5000);
        }
        assert.ok(cleanup.exited, "本次启动的隔离内核未退出");
        cleanup.exitCode = child.exitCode;
        cleanup.signalCode = child.signalCode;
        await assertTestPortAvailable(host, port);
        cleanup.portReleased = true;
    } catch (error) {
        cleanup.error = error.message;
        result.passed = false;
        process.exitCode = 1;
    }
    result.cleanup = cleanup;
    result.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(import.meta.dirname, "person-note-detach-results.json"), JSON.stringify(result, null, 2) + "\n");
    delete globalThis.__lvctNoteDetachSpike;
    hooks.deregister();
}
console.log(JSON.stringify({ passed: result.passed ?? false, runId, version: result.version, error: result.error }));
