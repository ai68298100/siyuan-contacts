/**
 * Production person-fields service against a new fictional-only SiYuan Kernel.
 * LVCT_RUN_PERSON_FIELDS_SPIKE=1 opts in; default/import/--dry-run do not launch,
 * bind a port, write files, or call HTTP. This is service evidence, not UI/CAS.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { assertIsolatedPath, assertTestPortAvailable, observeTestKernel, prepareIsolatedWorkspace } from "../e2e/kernel-safety.mjs";

const HOST = "127.0.0.1";
const MARKER = "person-fields-spike.json";
const CREATED_BY = "lvct production person fields isolated service verification";
const OUTPUT = fileURLToPath(new URL("./person-fields-results.json", import.meta.url));
const NODE_ID = /^\d{14}-[0-9a-z]{7}$/;
const ALLOWED = new Set([
    "/api/system/bootProgress", "/api/system/version", "/api/system/exit",
    "/api/notebook/createNotebook", "/api/notebook/lsNotebooks", "/api/filetree/createDocWithMd",
    "/api/sqlite/flushTransaction", "/api/query/sql", "/api/block/getChildBlocks",
    "/api/block/insertBlock", "/api/block/updateBlock",
]);
const WRITE_ROUTES = new Set(["/api/block/insertBlock", "/api/block/updateBlock"]);

export async function runPersonFieldsSpike() {
    assert.equal(process.platform, "win32", "Owned-listener checks require Windows");
    const runId = randomUUID();
    const tempRoot = fs.realpathSync(os.tmpdir());
    const workspace = path.join(tempRoot, `SiYuan-Lvct-Person-Fields-${runId}`);
    assert.equal(fs.existsSync(workspace), false, "Fresh UUID workspace must not exist");
    assert.equal(path.dirname(workspace), tempRoot);
    const candidates = ["D:/biji/SiYuan/resources/kernel/SiYuan-Kernel.exe", "D:/RJ/SiYuan/resources/kernel/SiYuan-Kernel.exe",
        path.join(process.env.ProgramFiles || "C:/Program Files", "SiYuan/resources/kernel/SiYuan-Kernel.exe")];
    const found = candidates.find((candidate) => fs.existsSync(candidate));
    assert.ok(found, "Validated Kernel executable not found");
    const kernel = fs.realpathSync(found);
    const appDir = path.resolve(path.dirname(kernel), "..");
    assert.equal(path.basename(kernel), "SiYuan-Kernel.exe");
    for (const name of ["stage", "appearance"]) assert.ok(fs.existsSync(path.join(appDir, name)));
    const port = await new Promise((resolve, reject) => {
        const server = net.createServer();
        server.once("error", reject);
        server.listen({ host: HOST, port: 0, exclusive: true }, () => {
            const selected = server.address().port;
            server.close((error) => error ? reject(error) : resolve(selected));
        });
    });
    await assertTestPortAvailable(HOST, port);
    prepareIsolatedWorkspace(workspace, MARKER, CREATED_BY);
    const marker = { createdBy: CREATED_BY, runId, workspace, port, kernel };
    fs.writeFileSync(path.join(workspace, MARKER), JSON.stringify(marker) + "\n", "utf8");
    const result = {
        runId, workspace, kernel, port, fictionalOnly: true, source: "current production service",
        uiVerified: false, nativeEditorCasVerified: false, serviceHostVerified: false,
        startedAt: new Date().toISOString(), kernelRequests: 0, listenerOwnershipChecks: 0,
        ownKernelPids: [], requests: [], observations: [], checks: {},
        cleanup: { ownKernelExited: false, portReleased: false, workspaceRetained: true },
    };
    let child, assertRunning, token = "", source = "service", discardOwnUpdateResponse = false, hooks;
    let interrupted = false, signalShutdown;
    function redact(error) { return String(error?.stack ?? error).replaceAll(token || "[NO-TOKEN]", "[REDACTED]"); }
    function assertWorkspace() {
        assert.equal(fs.lstatSync(workspace).isSymbolicLink(), false);
        assert.equal(fs.realpathSync(workspace), workspace);
        assertIsolatedPath(workspace, path.join(workspace, MARKER));
        assertIsolatedPath(workspace, path.join(workspace, "data"));
        assert.deepEqual(JSON.parse(fs.readFileSync(path.join(workspace, MARKER), "utf8")), marker);
    }
    function assertListener() {
        assertRunning();
        const listing = execFileSync(path.join(process.env.SystemRoot || "C:/Windows", "System32", "netstat.exe"), ["-ano", "-p", "tcp"],
            { encoding: "utf8", windowsHide: true, timeout: 5000, maxBuffer: 2 * 1024 * 1024 });
        const owners = new Set(listing.split(/\r?\n/).map((line) => line.trim().split(/\s+/))
            .filter((parts) => parts.length === 5 && parts[0] === "TCP" && parts[3] === "LISTENING"
                && Number(parts[1].match(/:(\d+)$/)?.[1]) === port).map((parts) => Number(parts[4])));
        assert.ok(owners.size === 1 && owners.has(child.pid), "Listener is not this script's owned live child; HTTP refused");
        assertRunning();
        result.listenerOwnershipChecks += 1;
    }
    async function envelope(route, body = {}, requestSource = "fixture", timeout = 15000) {
        assertWorkspace();
        assert.ok(ALLOWED.has(route), "Unregistered Kernel route refused");
        assert.ok(!interrupted || route === "/api/system/exit", "Interrupted; no new fixture work");
        assert.ok(result.kernelRequests < 200, "Kernel request budget exceeded");
        if (route === "/api/query/sql") assert.ok(/^SELECT\b/.test(body.stmt) && !body.stmt.includes(";"), "Only single SELECT allowed");
        assertListener();
        const record = { sequence: ++result.kernelRequests, source: requestSource, pid: child.pid, route, body };
        result.requests.push(record);
        try {
            const response = await fetch(`http://${HOST}:${port}${route}`, {
                method: "POST", redirect: "error", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Token ${token}` } : {}) },
                body: JSON.stringify(body), signal: AbortSignal.timeout(timeout),
            });
            assert.equal(response.ok, true, `Kernel HTTP ${response.status}`);
            record.response = await response.json();
            return record.response;
        } catch (error) { record.error = redact(error); throw error; }
    }
    async function request(route, body = {}, requestSource = "fixture", timeout = 15000) {
        const payload = await envelope(route, body, requestSource, timeout);
        assert.equal(payload.code, 0, `${route}: Kernel code ${payload.code}`);
        return payload.data;
    }
    async function start() {
        assertWorkspace();
        await assertTestPortAvailable(HOST, port);
        token = "";
        child = spawn(kernel, ["--workspace", workspace, "serve", "--wd", appDir, "--port", String(port)], {
            stdio: ["ignore", "pipe", "pipe"], windowsHide: true, env: { ...process.env, SIYUAN_WORKSPACE_PATH: workspace },
        });
        result.ownKernelPids.push(child.pid);
        result.cleanup.ownKernelExited = false;
        result.cleanup.portReleased = false;
        assertRunning = observeTestKernel(child);
        for (const stream of [child.stdout, child.stderr]) stream.on("data", () => {});
        const deadline = Date.now() + 60000;
        while (true) {
            assertRunning();
            const config = path.join(workspace, "conf", "conf.json");
            assertIsolatedPath(workspace, config);
            if (fs.existsSync(config)) token = JSON.parse(fs.readFileSync(config, "utf8")).api?.token ?? "";
            const boot = await request("/api/system/bootProgress", {}, "startup", 2000).catch(() => undefined);
            if (Number(boot?.progress) >= 100) return;
            assert.ok(Date.now() < deadline, "Isolated Kernel startup timed out");
            await new Promise((resolve) => setTimeout(resolve, 250));
        }
    }
    async function stop() {
        if (!child) return;
        const ownChild = child;
        const exited = () => ownChild.exitCode !== null || ownChild.signalCode !== null;
        if (!exited()) await request("/api/system/exit", { force: true }, "cleanup", 2000).catch((error) => { result.cleanup.httpExitError = redact(error); });
        if (!exited()) await new Promise((resolve) => {
            const timer = setTimeout(resolve, 3000);
            ownChild.once("exit", () => { clearTimeout(timer); resolve(); });
        });
        if (!exited()) {
            ownChild.kill("SIGKILL");
            await new Promise((resolve) => {
                if (exited()) return resolve();
                const timer = setTimeout(resolve, 3000);
                ownChild.once("exit", () => { clearTimeout(timer); resolve(); });
            });
        }
        assert.ok(exited(), "Owned child has not exited; unrelated processes will not be stopped");
        child = undefined;
        assertRunning = undefined;
        result.cleanup.ownKernelExited = true;
        await assertTestPortAvailable(HOST, port);
        result.cleanup.portReleased = true;
    }
    const onSignal = () => { interrupted = true; process.exitCode = 130; signalShutdown ??= stop().catch((error) => { result.cleanup.error = redact(error); }); };
    const onExit = () => { if (child && child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); };
    process.on("SIGINT", onSignal); process.on("SIGTERM", onSignal); process.on("exit", onExit);
    const serviceWriteCount = () => result.requests.filter((entry) => entry.source === "service" && WRITE_ROUTES.has(entry.route)).length;
    async function raw(docId) {
        assert.match(docId, NODE_ID);
        await request("/api/sqlite/flushTransaction");
        const rows = await request("/api/query/sql", { stmt: `SELECT id, root_id, parent_id, type, content, markdown, ial FROM blocks WHERE root_id='${docId}' ORDER BY id LIMIT 129` });
        const children = await request("/api/block/getChildBlocks", { id: docId });
        assert.ok(Array.isArray(rows) && rows.length < 129 && Array.isArray(children));
        return { rows, children };
    }
    function assertBodyPreserved(initial, observed) {
        for (const row of initial.rows.filter((entry) => entry.type !== "d")) {
            const current = observed.rows.find((entry) => entry.id === row.id);
            assert.ok(current, "Original body block missing");
            for (const key of ["id", "root_id", "parent_id", "type", "content", "markdown"]) assert.equal(current[key], row[key], `Original body ${key} changed`);
        }
    }
    try {
        await start();
        result.version = await request("/api/system/version");
        hooks = registerHooks({
            resolve(specifier, context, nextResolve) {
                if (specifier === "siyuan") return { shortCircuit: true, url: "data:text/javascript," + encodeURIComponent(
                    "export function fetchPost(route,body,callback,timeout,failure){globalThis.__lvctPersonFieldsSpike(route,body).then(callback,failure);}") };
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
        globalThis.__lvctPersonFieldsSpike = async (route, body) => {
            const payload = await envelope(route, body, source);
            if (discardOwnUpdateResponse && source === "service" && route === "/api/block/updateBlock") {
                discardOwnUpdateResponse = false;
                result.requests.at(-1).responseDeliberatelyDiscarded = true;
                throw new Error("This run deliberately discarded its own successful update response");
            }
            return payload;
        };
        const { loadPersonFields, savePersonFields, PersonFieldsProjectionUnknownError } = await import("../../src/services/person-fields.ts");
        const { buildPersonFieldsDom, emptyPersonFields, personFieldsKey } = await import("../../src/domain/person-fields.ts");
        const { allocatePersonFieldsBlockId, writePersonFieldsBlock } = await import("../../src/api/person-fields.ts");
        const notebookName = `Fictional person fields ${runId}`;
        await request("/api/notebook/createNotebook", { name: notebookName });
        const notebooks = (await request("/api/notebook/lsNotebooks")).notebooks.filter((entry) => entry.name === notebookName);
        assert.equal(notebooks.length, 1);
        const notebook = notebooks[0].id;
        assert.match(notebook, NODE_ID);
        const docs = [];
        for (const name of ["虚构甲", "虚构乙", "虚构副本"]) {
            const docId = await request("/api/filetree/createDocWithMd", { notebook, path: `/${name}`, markdown: `保留的虚构正文 ${name}\n\n## 补充资料\n\n补充资料：人工正文\n` });
            assert.match(docId, NODE_ID); docs.push(docId);
        }
        const [alpha, beta, copyDoc] = docs;
        result.docs = { alpha, beta, copyDoc };
        const originalBodies = new Map();
        for (const docId of docs) originalBodies.set(docId, await raw(docId));
        const groupA = randomUUID(), groupB = randomUUID();
        const special = '<b>保留 HTML</b>&amp; "引号"\'\\路径\\n字面\n\n  实际换行\t😀\n{: custom-fake="1"}';
        const alphaSnapshot = { schemaVersion: 1, ownerDocId: alpha, items: [
            { id: groupA, kind: "group", label: "联系方式" },
            { id: randomUUID(), kind: "entry", label: "电话", value: "+00 111", parentId: groupA },
            { id: randomUUID(), kind: "entry", label: "电话", value: "+00 111", parentId: groupA },
            { id: randomUUID(), kind: "entry", label: "微信", value: "fictional-one", parentId: groupA },
            { id: groupB, kind: "group", label: "家庭资料" },
            { id: randomUUID(), kind: "entry", label: "说明", value: special, parentId: groupB },
            { id: randomUUID(), kind: "entry", label: "QQ", value: "fictional-qq" },
        ] };
        const betaGroup = randomUUID();
        const betaSnapshot = { schemaVersion: 1, ownerDocId: beta, items: [
            { id: betaGroup, kind: "group", label: "联系方式" },
            { id: randomUUID(), kind: "entry", label: "邮箱", value: "same@example.test", parentId: betaGroup },
            { id: randomUUID(), kind: "entry", label: "邮箱", value: "same@example.test", parentId: betaGroup },
            { id: randomUUID(), kind: "entry", label: "留空", value: "" },
        ] };
        const emptyA = await loadPersonFields(alpha), emptyB = await loadPersonFields(beta);
        assert.deepEqual(emptyA.snapshot.items, []); assert.deepEqual(emptyB.snapshot.items, []);
        let aState = await savePersonFields(alpha, alphaSnapshot, emptyA);
        let bState = await savePersonFields(beta, betaSnapshot, emptyB);
        assert.deepEqual((await loadPersonFields(alpha)), aState); assert.deepEqual((await loadPersonFields(beta)), bState);
        result.checks.twoPeopleDuplicateAndGroupedValuesExact = true;
        result.checks.specialCharactersExact = true;
        result.checks.ordinaryHeadingNotMisclassified = true;
        result.observations.push({ phase: "created", alpha: aState, beta: bState, alphaRaw: await raw(alpha), betaRaw: await raw(beta) });
        const updated = structuredClone(aState.snapshot); updated.items[5].value = special + "\n服务更新";
        const originalAId = aState.blockId;
        aState = await savePersonFields(alpha, updated, aState); assert.equal(aState.blockId, originalAId);
        result.checks.updateRetainedBlockId = true;
        const stale = aState;
        const external = structuredClone(aState.snapshot); external.items[5].value = "显式外部夹具改值";
        source = "external-fixture";
        try { await writePersonFieldsBlock(alpha, external, aState.blockId); } finally { source = "service"; }
        const writesBeforeConflict = serviceWriteCount();
        await assert.rejects(savePersonFields(alpha, updated, stale), PersonFieldsProjectionUnknownError);
        assert.equal(serviceWriteCount(), writesBeforeConflict);
        aState = await loadPersonFields(alpha); assert.equal(personFieldsKey(aState.snapshot), personFieldsKey(external));
        result.checks.externalBaselineConflictZeroWrites = true;
        const unknownTarget = structuredClone(aState.snapshot); unknownTarget.items[5].value = special + "\n未知响应后核实";
        const unknownBaseline = aState;
        discardOwnUpdateResponse = true;
        await assert.rejects(savePersonFields(alpha, unknownTarget, unknownBaseline), PersonFieldsProjectionUnknownError);
        assert.equal(discardOwnUpdateResponse, false);
        const writesAfterUnknown = serviceWriteCount();
        aState = await savePersonFields(alpha, unknownTarget, unknownBaseline);
        assert.equal(serviceWriteCount(), writesAfterUnknown); assert.equal(aState.blockId, originalAId);
        assert.equal(personFieldsKey(aState.snapshot), personFieldsKey(unknownTarget));
        result.checks.ownUnknownResponseReadbackNoReplay = true;
        const originalBId = bState.blockId;
        bState = await savePersonFields(beta, emptyPersonFields(beta), bState);
        assert.equal(bState.blockId, originalBId); assert.deepEqual(bState.snapshot.items, []);
        result.checks.emptyItemsRetainedBlockId = true;
        const beforeCopyA = await raw(alpha);
        const copyId = allocatePersonFieldsBlockId();
        await request("/api/block/insertBlock", { parentID: copyDoc, dataType: "dom", data: buildPersonFieldsDom(aState.snapshot, copyId) }, "copy-fixture");
        const copyRaw = await raw(copyDoc);
        assert.equal(copyRaw.rows.find((entry) => entry.id === copyId)?.content, beforeCopyA.rows.find((entry) => entry.id === aState.blockId)?.content);
        await assert.rejects(loadPersonFields(copyDoc), PersonFieldsProjectionUnknownError);
        const writesBeforeCopySave = serviceWriteCount();
        await assert.rejects(savePersonFields(copyDoc, emptyPersonFields(copyDoc), { snapshot: emptyPersonFields(copyDoc) }));
        assert.equal(serviceWriteCount(), writesBeforeCopySave);
        result.checks.copiedBodyWrongOwnerBlockedZeroWrites = true;
        result.copyBoundary = "API copy of complete marked body with fresh block ID; no native clipboard/UI claim";
        result.observations.push({ phase: "before-restart", alpha: aState, beta: bState, alphaRaw: beforeCopyA, betaRaw: await raw(beta), copyRaw });
        for (const docId of docs) assertBodyPreserved(originalBodies.get(docId), await raw(docId));
        const serviceWritesBeforeRestart = serviceWriteCount();
        await stop(); await start();
        assert.deepEqual(await loadPersonFields(alpha), aState); assert.deepEqual(await loadPersonFields(beta), bState);
        await assert.rejects(loadPersonFields(copyDoc), PersonFieldsProjectionUnknownError);
        assert.equal(serviceWriteCount(), serviceWritesBeforeRestart);
        for (const docId of docs) assertBodyPreserved(originalBodies.get(docId), await raw(docId));
        result.checks.restartExactReadbackZeroWrites = true;
        result.checks.originalNativeBodiesPreserved = true;
        result.observations.push({ phase: "restarted-read-only", alpha: await loadPersonFields(alpha), beta: await loadPersonFields(beta),
            alphaRaw: await raw(alpha), betaRaw: await raw(beta), copyRaw: await raw(copyDoc) });
        result.serviceWrites = serviceWriteCount();
        result.serviceHostVerified = true;
    } catch (error) {
        result.error = redact(error); process.exitCode = 1;
    } finally {
        if (signalShutdown) await signalShutdown;
        await stop().catch((error) => { result.cleanup.error = redact(error); process.exitCode = 1; });
        hooks?.deregister(); delete globalThis.__lvctPersonFieldsSpike;
        process.removeListener("SIGINT", onSignal); process.removeListener("SIGTERM", onSignal);
        if (!child) process.removeListener("exit", onExit);
        result.completedAt = new Date().toISOString();
        const serialized = JSON.stringify(result, null, 2) + "\n";
        const uniqueOutput = path.join(path.dirname(OUTPUT), `person-fields-results-${runId}.json`);
        fs.writeFileSync(uniqueOutput, serialized, { encoding: "utf8", flag: "wx" });
        fs.writeFileSync(OUTPUT, serialized, "utf8");
        fs.writeFileSync(path.join(workspace, `person-fields-evidence-${runId}.json`), serialized, { encoding: "utf8", flag: "wx" });
        console.log(JSON.stringify({ runId, workspace, port, serviceHostVerified: result.serviceHostVerified, checks: result.checks,
            kernelRequests: result.kernelRequests, listenerOwnershipChecks: result.listenerOwnershipChecks,
            serviceWrites: result.serviceWrites, ownKernelPids: result.ownKernelPids, cleanup: result.cleanup,
            error: result.error ?? null, output: OUTPUT, uniqueOutput }, null, 2));
    }
    return result;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
    const args = process.argv.slice(2);
    assert.ok(args.every((arg) => arg === "--dry-run"), "Only --dry-run is supported");
    if (process.env.LVCT_RUN_PERSON_FIELDS_SPIKE === "1" && !args.includes("--dry-run")) await runPersonFieldsSpike();
    else console.log(JSON.stringify({ runEnabled: false, gate: "LVCT_RUN_PERSON_FIELDS_SPIKE=1", fictionalOnly: true,
        kernelRequests: 0, workspaceWrites: 0, uiVerified: false }, null, 2));
}
