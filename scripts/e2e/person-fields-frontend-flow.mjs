/** One bounded real Chrome/person-fields UI run, only in a fresh owned Kernel. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { randomUUID, createHash } from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { assertIsolatedPath, assertTestPortAvailable, observeTestKernel, prepareIsolatedWorkspace } from "./kernel-safety.mjs";
import { stopIsolatedBrowser } from "./browser-cleanup.mjs";
import { verifyRealFrontend } from "./frontend-flow.mjs";

export async function runPersonFieldsRealFrontend() {
    assert.equal(process.env.LVCT_RUN_PERSON_FIELDS_REAL_UI, "1", "Explicit opt-in required");
    assert.equal(process.platform, "win32");
    const runId = randomUUID();
    const multiWindow = process.env.LVCT_PERSON_FIELDS_MULTIWINDOW === "1";
    const filterCopy = process.env.LVCT_PERSON_FIELDS_FILTER_COPY === "1";
    const lifecycle = process.env.LVCT_PERSON_FIELDS_LIFECYCLE === "1";
    const legacyRecovery = process.env.LVCT_PERSON_NOTE_LEGACY_RECOVERY === "1";
    const workspace = path.join(fs.realpathSync(os.tmpdir()), `SiYuan-Lvct-Person-Fields-UI-${runId}`);
    assert.equal(fs.existsSync(workspace), false);
    const markerName = "person-fields-real-ui.json";
    const createdBy = "lvct bounded fictional person fields real UI";
    const kernel = ["D:/biji/SiYuan/resources/kernel/SiYuan-Kernel.exe", "D:/RJ/SiYuan/resources/kernel/SiYuan-Kernel.exe"].find(fs.existsSync);
    assert.ok(kernel, "Isolated Kernel executable missing");
    const chrome = "C:/Program Files/Google/Chrome/Application/chrome.exe";
    assert.ok(fs.existsSync(chrome), "Chrome is required for this run");
    const port = await new Promise((resolve, reject) => {
        const server = net.createServer(); server.once("error", reject);
        server.listen({ host: "127.0.0.1", port: 0, exclusive: true }, () => { const selected = server.address().port; server.close(error => error ? reject(error) : resolve(selected)); });
    });
    await assertTestPortAvailable("127.0.0.1", port);
    prepareIsolatedWorkspace(workspace, markerName, createdBy);
    const marker = { createdBy, runId, workspace, kernel: fs.realpathSync(kernel), port };
    fs.writeFileSync(path.join(workspace, markerName), JSON.stringify(marker) + "\n");
    const storage = path.join(workspace, "data/storage/petal/lvct-isolated-test");
    fs.mkdirSync(storage, { recursive: true });
    const evidence = { runId, workspace, kernel: marker.kernel, port, chrome, startedAt: new Date().toISOString(), fictionalOnly: true,
        actualProductionServices: true, actualProductionUi: true, nativeEditorCasVerified: false, kernelRequests: 0, listenerOwnershipChecks: 0,
        ownKernelPid: null, requestRoutes: [], frontend: null, cleanup: { ownKernelExited: false, portReleased: false, workspaceRetained: true },
        dist: Object.fromEntries(["index.js", "index.css", "plugin.json"].map(name => [name, createHash("sha256").update(fs.readFileSync(path.resolve(import.meta.dirname, "../../dist", name))).digest("hex")])) };
    let child, assertRunning, token = "", hooks;
    const priorBrowser = process.env.LVCT_TEST_BROWSER;
    const priorArtifacts = process.env.LVCT_E2E_ARTIFACT_DIR;
    function owned() {
        assertIsolatedPath(workspace, path.join(workspace, "data"));
        assert.deepEqual(JSON.parse(fs.readFileSync(path.join(workspace, markerName), "utf8")), marker);
        assertRunning();
        const listing = execFileSync(path.join(process.env.SystemRoot || "C:/Windows", "System32/netstat.exe"), ["-ano", "-p", "tcp"], { encoding: "utf8", windowsHide: true, timeout: 5000 });
        const owners = new Set(listing.split(/\r?\n/).map(line => line.trim().split(/\s+/)).filter(parts => parts.length === 5 && parts[0] === "TCP" && parts[3] === "LISTENING" && Number(parts[1].match(/:(\d+)$/)?.[1]) === port).map(parts => Number(parts[4])));
        assert.ok(owners.size === 1 && owners.has(child.pid), "HTTP refused: listener is not the owned Kernel");
        evidence.listenerOwnershipChecks += 1;
    }
    async function envelope(route, body = {}) {
        owned(); assert.ok(evidence.kernelRequests < 500, "Bounded request budget exceeded");
        evidence.kernelRequests += 1; evidence.requestRoutes.push(route);
        const response = await fetch(`http://127.0.0.1:${port}${route}`, { method: "POST", redirect: "error", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Token ${token}` } : {}) }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
        assert.equal(response.ok, true, `HTTP ${response.status}`); return response.json();
    }
    async function request(route, body = {}) { const payload = await envelope(route, body); assert.equal(payload.code, 0, `${route}: ${payload.msg}`); return payload.data; }
    const plugin = {
        async loadData(name) { assert.match(name, /^[a-z0-9-]+\.json$/); const target = path.join(storage, name); assertIsolatedPath(workspace, target); return fs.existsSync(target) ? JSON.parse(fs.readFileSync(target, "utf8")) : null; },
        async saveData(name, value) { assert.match(name, /^[a-z0-9-]+\.json$/); const target = path.join(storage, name); assertIsolatedPath(workspace, target); fs.writeFileSync(target, JSON.stringify(value)); },
    };
    const killOnExit = () => { if (child && child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); };
    process.on("exit", killOnExit);
    try {
        child = spawn(marker.kernel, ["--workspace", workspace, "serve", "--wd", path.resolve(path.dirname(marker.kernel), ".."), "--port", String(port)], { stdio: "ignore", windowsHide: true, env: { ...process.env, SIYUAN_WORKSPACE_PATH: workspace } });
        evidence.ownKernelPid = child.pid; assertRunning = observeTestKernel(child);
        const deadline = Date.now() + 60000;
        while (true) {
            assertRunning();
            const config = path.join(workspace, "conf/conf.json"); assertIsolatedPath(workspace, config);
            if (fs.existsSync(config)) token = JSON.parse(fs.readFileSync(config, "utf8")).api?.token ?? "";
            const boot = await request("/api/system/bootProgress").catch(() => undefined);
            if (Number(boot?.progress) >= 100) break;
            assert.ok(Date.now() < deadline, "Owned Kernel startup timed out");
            await new Promise(resolve => setTimeout(resolve, 250));
        }
        assert.ok(token, "Kernel token unavailable"); evidence.kernelVersion = await request("/api/system/version");
        // Kernel boot initializes petal storage; create the controlled adapter
        // directory after boot, as in the existing services-flow runner.
        assertIsolatedPath(workspace, storage); fs.mkdirSync(storage, { recursive: true });
        globalThis.__lvctPersonFieldsRealUi = envelope;
        hooks = registerHooks({
            resolve(specifier, context, next) {
                if (specifier === "siyuan") return { shortCircuit: true, url: "data:text/javascript," + encodeURIComponent("export function fetchPost(route,body,callback,timeout,failure){globalThis.__lvctPersonFieldsRealUi(route,body).then(callback,failure);}") };
                if (specifier.startsWith(".") && context.parentURL?.startsWith("file:")) { const candidate = new URL(specifier + ".ts", context.parentURL); if (fs.existsSync(fileURLToPath(candidate))) return next(candidate.href, context); }
                return next(specifier, context);
            },
            load(url, context, next) { return url.startsWith("file:") && url.endsWith(".ts") ? { shortCircuit: true, format: "module", source: ts.transpileModule(fs.readFileSync(fileURLToPath(url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext } }).outputText } : next(url, context); },
        });
        const { initializeWorkspace } = await import("../../src/services/init.ts");
        const { createContact } = await import("../../src/services/contacts.ts");
        const { emptyDraft } = await import("../../src/domain/person.ts");
        const settings = await initializeWorkspace(plugin, { notebookName: `lvct-contacts-smoke-fields-${runId}`, createSelf: false }, () => {});
        const first = await createContact(settings, { ...emptyDraft(), name: "虚构补充资料UI甲" });
        const second = await createContact(settings, { ...emptyDraft(), name: multiWindow ? first.name : "虚构补充资料UI乙" }, { allowSameName: multiWindow });
        evidence.people = { first: { docId: first.docId, itemId: first.itemId, name: first.name }, second: { docId: second.docId, itemId: second.itemId, name: second.name } };
        let legacyFixture;
        if (legacyRecovery) {
            const person = await createContact(settings, { ...emptyDraft(), name: "虚构旧备注恢复UI丙" });
            const paragraphs = ["旧备注第一段：虚构偏好安静。", "旧备注第二段：下次见面准备虚构资料。", "旧备注末段：这里只是最后一段，不能冒认全文。"];
            // Reproduce the published old Markdown construction through the
            // real Kernel parser, rather than manufacturing block/SQL rows.
            const markdown = `**人物备注**\n\n${paragraphs.join("\n\n")}\n{: custom-lvct-person-note="1"}`;
            await request("/api/block/insertBlock", { parentID: person.docId, dataType: "markdown", data: markdown });
            await request("/api/sqlite/flushTransaction");
            const rows = await request("/api/query/sql", { stmt: `SELECT id, root_id, parent_id, type, content, markdown, ial FROM blocks WHERE root_id='${person.docId}' ORDER BY id LIMIT 129` });
            const marked = rows.filter(row => row.ial?.includes('custom-lvct-person-note="1"'));
            if (rows.length >= 129 || marked.length !== 1 || marked[0].type !== "p" || marked[0].parent_id !== person.docId || marked[0].content !== paragraphs.at(-1) || marked[0].ial.includes('custom-lvct-person-note-format="') || !paragraphs.every(value => rows.some(row => row.type === "p" && row.content === value)) || !rows.some(row => row.type === "p" && row.markdown === "**人物备注**")) throw new Error("旧Markdown未在真实内核形成预期多段末段标记，拒绝运行恢复场景");
            legacyFixture = { person: { docId: person.docId, itemId: person.itemId, name: person.name }, paragraphs, confirmedFullText: paragraphs.join("\n\n"), markedBlockId: marked[0].id, beforeRows: rows };
            evidence.legacyFixture = legacyFixture;
        }
        process.env.LVCT_TEST_BROWSER = chrome;
        process.env.LVCT_E2E_ARTIFACT_DIR = path.join(workspace, "person-fields-ui-artifacts");
        evidence.frontend = await verifyRealFrontend({ workspace, storage, baseURL: `http://127.0.0.1:${port}`, request: envelope, accessAuthCode: token, first, second, settings, personFieldsOnly: true, personFieldsMultiWindow: multiWindow, personFieldsFilterCopy: filterCopy, personFieldsLifecycle: lifecycle, personNoteLegacyRecovery: legacyFixture, deadlineMs: lifecycle || legacyRecovery ? 180000 : 120000 });
        if (!evidence.frontend.ok || evidence.frontend.failure || !evidence.frontend.browserProcess?.exited || !evidence.frontend.browserProcess?.profileRemoved) process.exitCode = 1;
    } catch (error) { evidence.error = String(error?.stack ?? error).replaceAll(token || "[NO-TOKEN]", "[REDACTED]"); process.exitCode = 1; }
    finally {
        if (priorBrowser === undefined) delete process.env.LVCT_TEST_BROWSER; else process.env.LVCT_TEST_BROWSER = priorBrowser;
        if (priorArtifacts === undefined) delete process.env.LVCT_E2E_ARTIFACT_DIR; else process.env.LVCT_E2E_ARTIFACT_DIR = priorArtifacts;
        if (child) {
            try { await stopIsolatedBrowser(child, { requestClose: () => envelope("/api/system/exit", { force: true }) }); evidence.cleanup.ownKernelExited = child.exitCode !== null || child.signalCode !== null; }
            catch (error) { evidence.cleanup.error = String(error); process.exitCode = 1; }
        }
        try { await assertTestPortAvailable("127.0.0.1", port); evidence.cleanup.portReleased = true; } catch (error) { evidence.cleanup.portError = String(error); process.exitCode = 1; }
        if (evidence.cleanup.ownKernelExited) process.removeListener("exit", killOnExit);
        hooks?.deregister(); delete globalThis.__lvctPersonFieldsRealUi;
        evidence.completedAt = new Date().toISOString();
        const content = JSON.stringify(evidence, null, 2) + "\n";
        const output = path.resolve(import.meta.dirname, `../../docs/verification/PERSON-FIELDS-REAL-UI-${runId}.json`);
        fs.writeFileSync(output, content, { encoding: "utf8", flag: "wx" });
        fs.writeFileSync(path.join(workspace, `person-fields-real-ui-evidence-${runId}.json`), content, { encoding: "utf8", flag: "wx" });
        const fields = evidence.frontend?.personFields;
        console.log(JSON.stringify({ runId, output, workspace, kernelRequests: evidence.kernelRequests, listenerOwnershipChecks: evidence.listenerOwnershipChecks, ownKernelPid: evidence.ownKernelPid, browserProcess: evidence.frontend?.browserProcess, ok: evidence.frontend?.ok ?? false, fields: fields ? { saved: fields.saved, detailClosed: fields.detailClosed, detailReopened: fields.detailReopened, blockId: fields.blockId, serviceAndSqlVerified: fields.serviceAndSqlVerified, originalNativeBodiesPreserved: fields.originalNativeBodiesPreserved } : null, lifecycle: evidence.frontend?.personFieldsLifecycle ? { completed: evidence.frontend.personFieldsLifecycle.completed ?? false, saves: evidence.frontend.personFieldsLifecycle.saves.map(item => item.step), emptyReopenedSameBlock: evidence.frontend.personFieldsLifecycle.emptyReopenedSameBlock, recreatedReopenedSameBlock: evidence.frontend.personFieldsLifecycle.recreatedReopenedSameBlock, noteClearedAndReopened: evidence.frontend.personFieldsLifecycle.noteClearedAndReopened } : null, failure: evidence.frontend?.failure ?? evidence.error ?? null, cleanup: evidence.cleanup }, null, 2));
    }
    return evidence;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    if (process.env.LVCT_RUN_PERSON_FIELDS_REAL_UI === "1") await runPersonFieldsRealFrontend();
    else console.log(JSON.stringify({ runEnabled: false, gate: "LVCT_RUN_PERSON_FIELDS_REAL_UI=1", kernelRequests: 0, workspaceWrites: 0 }));
}
