/**
 * AG-RF-004-N2 isolated Kernel transport probe; no production integration.
 * Default/--dry-run prints preflight only. LVCT_RUN_NATIVE_EDITOR_HOST=1 is
 * required to create a UUID temporary workspace and launch this script's Kernel.
 * No browser/CDP connection is made. Kernel evidence never means UI evidence.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { assertIsolatedPath, assertTestPortAvailable, observeTestKernel, prepareIsolatedWorkspace } from "../e2e/kernel-safety.mjs";
import { encode, fixtureMethod, parseBlock, readDocument, counters, resetCounters } from "./contact-methods-native-editor-research.mjs";

const OUTPUT = fileURLToPath(new URL("./contact-methods-native-editor-host-results.json", import.meta.url));
const HOST = "127.0.0.1";
const PREFIX = "custom-lvct-contact-method";
const NODE_ID = /^\d{14}-[a-z0-9]{7}$/;
const MARKER = "contact-methods-native-editor-host-spike.json";
const CREATED_BY = "lvct native editor isolated Kernel probe";
const FORMAT = "n2-single-json-v1";
const args = process.argv.slice(2);
assert.ok(args.every((arg) => arg === "--dry-run"), "Only --dry-run is supported; host execution requires the environment gate");
const runEnabled = process.env.LVCT_RUN_NATIVE_EDITOR_HOST === "1" && !args.includes("--dry-run");
const runId = randomUUID();
const tempRoot = fs.realpathSync(os.tmpdir());
const workspace = path.join(tempRoot, `SiYuan-Lvct-Native-Editor-${runId}`);
const kernelCandidates = [
    "D:/biji/SiYuan/resources/kernel/SiYuan-Kernel.exe",
    "D:/RJ/SiYuan/resources/kernel/SiYuan-Kernel.exe",
    path.join(process.env.ProgramFiles || "C:/Program Files", "SiYuan/resources/kernel/SiYuan-Kernel.exe"),
];
const foundKernel = kernelCandidates.find((candidate) => fs.existsSync(candidate));
const kernel = foundKernel ? fs.realpathSync(foundKernel) : null;
const appDir = kernel ? path.resolve(path.dirname(kernel), "..") : null;
const kernelReady = Boolean(kernel && path.basename(kernel) === "SiYuan-Kernel.exe" && fs.statSync(kernel).isFile()
    && ["stage", "appearance"].every((name) => fs.existsSync(path.join(appDir, name))));
assert.equal(path.dirname(workspace), tempRoot, "Workspace must be a direct child of the canonical temporary root");
assert.match(path.basename(workspace), /^SiYuan-Lvct-Native-Editor-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
assert.equal(fs.existsSync(workspace), false, "A newly generated UUID workspace must not already exist");
const port = await new Promise((resolvePort, rejectPort) => {
    const server = net.createServer();
    server.once("error", rejectPort);
    server.listen({ host: HOST, port: 0, exclusive: true }, () => {
        const assigned = server.address().port;
        server.close((error) => error ? rejectPort(error) : resolvePort(assigned));
    });
});
assert.ok(Number.isInteger(port) && port > 0 && port <= 65535);
await assertTestPortAvailable(HOST, port);

const preflight = {
    research: "AG-RF-004-N2", mode: runEnabled ? "explicit-isolated-kernel" : "dry-run",
    gate: "LVCT_RUN_NATIVE_EDITOR_HOST=1", runEnabled, runId, workspace, workspaceExists: false,
    host: HOST, port, randomPortChecked: true, kernel, kernelReady,
    fictionalOnly: true, format: FORMAT, paths: ["markdown", "dom"], scenariosPerPath: 4,
    kernelStarted: false, kernelRequests: 0, workspaceWrites: 0, browserCalls: 0,
    uiControlChannel: "unavailable", uiVerified: false, hostVerified: false,
    productionChanges: false, realPluginFileWrites: 0, status: "host_pending",
};
if (!runEnabled) {
    console.log(JSON.stringify({ preflight }, null, 2));
} else {
    assert.equal(process.platform, "win32", "This probe's listener ownership verification is Windows-only");
    assert.ok(kernelReady, "No validated Kernel executable/resources found; refusing host execution");
    await runHost();
}

function html(value) {
    return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}
function unhtml(value) {
    return value.replace(/&(amp|lt|gt|quot|#39);/g, (_, key) => ({ amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'" })[key]);
}
function ialAttrs(ial) {
    assert.equal(typeof ial, "string", "IAL must be a string");
    assert.ok(ial.startsWith("{: ") && ial.endsWith("}"), "Unexpected IAL envelope");
    const attrs = Object.create(null);
    const body = ial.slice(3, -1).trim();
    let cursor = 0;
    for (const match of body.matchAll(/([a-zA-Z0-9_-]+)="([^"]*)"/g)) {
        assert.equal(body.slice(cursor, match.index).trim(), "", "Unexpected IAL syntax");
        assert.equal(Object.hasOwn(attrs, match[1]), false, "Duplicate IAL attribute");
        attrs[match[1]] = unhtml(match[2]);
        cursor = match.index + match[0].length;
    }
    assert.equal(body.slice(cursor).trim(), "", "Unparsed IAL text");
    return attrs;
}
function nodeId() {
    return `${new Date().toISOString().slice(0, 19).replace(/\D/g, "")}-${randomBytes(4).toString("hex").slice(0, 7)}`;
}
function checkId(id) { assert.equal(typeof id, "string"); assert.match(id, NODE_ID); return id; }
function markdownFor(block) {
    const attrs = Object.entries(block.attrs).map(([key, value]) => `${key}="${html(value)}"`).join(" ");
    return `${block.content}\n{: ${attrs}}`;
}
function domFor(block) {
    const attrs = Object.entries(block.attrs).map(([key, value]) => `${key}="${html(value)}"`).join(" ");
    return `<div data-node-id="${block.id}" data-type="NodeParagraph" class="p" ${attrs}><div contenteditable="true">${html(block.content)}</div></div>`;
}
function inspect(row, expected) {
    const attrs = ialAttrs(row.ial);
    const raw = { id: row.id, type: row.type, parentId: row.parent_id, content: row.content, markdown: row.markdown, attrs };
    // Never substitute markdown for content or decode Markdown speculatively.
    // Only an exact terminal IAL (if present) can be removed for this adapter.
    const suffix = `\n${row.ial}`;
    const removedExactTerminalIal = row.markdown.endsWith(suffix);
    const markdownBody = removedExactTerminalIal ? row.markdown.slice(0, -suffix.length) : row.markdown;
    const adapted = { ...raw, markdown: markdownBody };
    const parsed = parseBlock(adapted);
    const aggregate = readDocument({ docId: expected.owner, enumerationComplete: true, blocks: [adapted] });
    const exactValueMatch = parsed.ok && parsed.method.value === expected.value;
    return {
        ialDecodedRawBodyParse: parseBlock(raw), adapter: "IAL-attributes-single-entity-decode; body-identity-or-exact-terminal-IAL-removal-only", removedExactTerminalIal,
        contentMatchesExpected: row.content === expected.content, markdownBodyMatchesContent: markdownBody === row.content,
        parsed, aggregate, exactValueMatch,
        candidateVerified: parsed.ok && exactValueMatch && aggregate.complete && row.content === expected.content,
        scopeBoundary: "Only this controlled fixture's expected candidate block; production discovery is not implemented",
    };
}

async function runHost() {
    const result = {
        ...preflight, generatedAt: new Date().toISOString(), preflight,
        isolatedKernelApi: true, kernelApiWriteReadVerified: false, kernelCandidateVerified: false,
        allCandidatePathsVerified: false, restartReadbackVerified: false, observations: [],
        cleanup: { ownKernelExited: false, portReleased: false, workspaceRetained: true },
        isolationBoundary: "UUID workspace and owned-child/port checks are detection guards, not OS-level isolation",
    };
    let child, assertRunning, token = "", shutdownPromise, interrupted = false;
    prepareIsolatedWorkspace(workspace, MARKER, CREATED_BY);
    fs.writeFileSync(path.join(workspace, MARKER), JSON.stringify({ createdBy: CREATED_BY, runId, workspace, port, kernel }) + "\n", "utf8");
    result.workspaceWrites = 2;
    function assertOwnedWorkspace() {
        assert.equal(fs.lstatSync(workspace).isSymbolicLink(), false);
        assert.equal(fs.realpathSync(workspace), workspace);
        assertIsolatedPath(workspace, path.join(workspace, MARKER));
        assertIsolatedPath(workspace, path.join(workspace, "data"));
        const marker = JSON.parse(fs.readFileSync(path.join(workspace, MARKER), "utf8"));
        assert.deepEqual(marker, { createdBy: CREATED_BY, runId, workspace, port, kernel });
    }
    function redact(error) {
        const text = String(error?.message ?? error);
        return (token ? text.replaceAll(token, "[REDACTED]") : text)
            .replace(/(Authorization\s*[:=]\s*|Token\s+)[^\s,;]+/gi, "$1[REDACTED]");
    }
    function assertOwnedListener() {
        assertRunning();
        // Read-only OS listener attribution. Never persist unrelated ports/PIDs.
        const listing = execFileSync(path.join(process.env.SystemRoot || "C:/Windows", "System32", "netstat.exe"), ["-ano", "-p", "tcp"], {
            encoding: "utf8", windowsHide: true, timeout: 5000, maxBuffer: 2 * 1024 * 1024,
        });
        const owners = new Set(listing.split(/\r?\n/).map((line) => line.trim().split(/\s+/))
            .filter((columns) => columns.length === 5 && columns[0] === "TCP" && columns[3] === "LISTENING"
                && Number(columns[1].match(/:(\d+)$/)?.[1]) === port)
            .map((columns) => Number(columns[4])));
        assert.ok(owners.size === 1 && owners.has(child.pid), "Random-port listener is not verified as this probe's live Kernel; refusing HTTP");
        assertRunning();
        result.listenerOwnershipChecks = (result.listenerOwnershipChecks ?? 0) + 1;
    }
    async function request(route, body = {}, timeout = 15000) {
        assertOwnedWorkspace();
        assert.ok(!interrupted || route === "/api/system/exit", "Probe interrupted; refusing further work");
        assertOwnedListener();
        result.kernelRequests += 1;
        const response = await fetch(`http://${HOST}:${port}${route}`, {
            method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Token ${token}` } : {}) },
            body: JSON.stringify(body), signal: AbortSignal.timeout(timeout),
        });
        assertRunning();
        assert.equal(response.ok, true, `${route}: HTTP ${response.status}`);
        const payload = await response.json();
        assert.equal(payload.code, 0, `${route}: Kernel code ${payload.code}`);
        return payload.data;
    }
    async function start() {
        assert.equal(interrupted, false, "Probe interrupted; refusing restart");
        assertOwnedWorkspace();
        await assertTestPortAvailable(HOST, port);
        token = "";
        child = spawn(kernel, ["--workspace", workspace, "serve", "--wd", appDir, "--port", String(port)], {
            stdio: ["ignore", "pipe", "pipe"], windowsHide: true, env: { ...process.env, SIYUAN_WORKSPACE_PATH: workspace },
        });
        result.kernelStarted = true;
        result.ownKernelPids = [...(result.ownKernelPids ?? []), child.pid].filter(Number.isInteger);
        result.cleanup.ownKernelExited = false;
        result.cleanup.portReleased = false;
        assertRunning = observeTestKernel(child);
        // Drain output to prevent pipe backpressure; raw logs may contain tokens.
        for (const stream of [child.stdout, child.stderr]) stream.on("data", () => {});
        const deadline = Date.now() + 60000;
        while (true) {
            assertRunning();
            const configPath = path.join(workspace, "conf", "conf.json");
            assertIsolatedPath(workspace, configPath);
            if (fs.existsSync(configPath)) token = JSON.parse(fs.readFileSync(configPath, "utf8")).api?.token ?? "";
            const boot = await request("/api/system/bootProgress", {}, 2000).catch(() => undefined);
            if (Number(boot?.progress) >= 100) return;
            if (Date.now() > deadline) throw new Error("Isolated Kernel startup timed out");
            await new Promise((resolveWait) => setTimeout(resolveWait, 250));
        }
    }
    async function stop() {
        if (!child) return;
        const ownedChild = child;
        const exited = () => ownedChild.exitCode !== null || ownedChild.signalCode !== null;
        if (!exited()) await request("/api/system/exit", { force: true }, 2000).catch((error) => {
            result.cleanup.httpExitSkippedOrFailed = redact(error);
        });
        if (!exited()) await new Promise((resolveExit) => {
            const timer = setTimeout(resolveExit, 3000);
            ownedChild.once("exit", () => { clearTimeout(timer); resolveExit(); });
        });
        if (!exited()) {
            ownedChild.kill("SIGKILL"); // Only the ChildProcess created above; never process-name/taskkill.
            await new Promise((resolveExit) => {
                if (exited()) return resolveExit();
                const timer = setTimeout(resolveExit, 3000);
                ownedChild.once("exit", () => { clearTimeout(timer); resolveExit(); });
            });
        }
        assert.ok(exited(), "Owned Kernel did not exit; no unrelated process will be stopped");
        result.cleanup.ownKernelExited = true;
        child = undefined;
        assertRunning = undefined;
        await assertTestPortAvailable(HOST, port);
        result.cleanup.portReleased = true;
    }
    const onSignal = () => {
        interrupted = true;
        process.exitCode = 130;
        shutdownPromise ??= stop().catch((error) => { result.cleanup.error = redact(error); });
    };
    const onExit = () => { if (child && child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); };
    process.on("SIGINT", onSignal);
    process.on("SIGTERM", onSignal);
    process.on("exit", onExit);
    async function snapshot(docId) {
        checkId(docId);
        await request("/api/sqlite/flushTransaction");
        const rows = await request("/api/query/sql", { stmt: `SELECT id, root_id, parent_id, type, content, markdown, ial FROM blocks WHERE root_id='${docId}' ORDER BY id LIMIT 129` });
        const children = await request("/api/block/getChildBlocks", { id: docId });
        assert.ok(Array.isArray(rows) && rows.length < 129, "Controlled fixture enumeration must be bounded and complete");
        assert.ok(Array.isArray(children));
        for (const row of rows) assert.equal(row.root_id, docId);
        return { rows, children };
    }
    try {
        resetCounters();
        await start();
        result.version = await request("/api/system/version");
        const notebookName = `N2 fictional ${runId}`;
        await request("/api/notebook/createNotebook", { name: notebookName });
        const notebooks = (await request("/api/notebook/lsNotebooks")).notebooks.filter((item) => item.name === notebookName);
        assert.equal(notebooks.length, 1, "Only this run's unique notebook is allowed");
        const notebook = checkId(notebooks[0].id);
        const fixtures = [
            { name: "plain", value: "+00 111 / +00 222" },
            { name: "escapes", value: '第一行\n第二行\t"引号"\\路径\\n字面🙂' },
            { name: "markdown", value: '**虚构** _文本_ [链接](https://example.test) `code` <b>原文</b> & {: custom-fake="1"}' },
            { name: "whitespace-crlf", value: "  虚构首空格\r\n中间\r\n尾空格  " },
        ];
        const saved = [];
        for (const transport of ["markdown", "dom"]) for (const fixture of fixtures) {
            const docId = checkId(await request("/api/filetree/createDocWithMd", { notebook, path: `/N2-${transport}-${fixture.name}`, markdown: "Only fictional N2 fixture.\n" }));
            const method = fixtureMethod(docId, `${transport}-${fixture.name}`, { blockId: nodeId(), label: "隔离 JSON", value: fixture.value });
            const candidate = encode(method, FORMAT);
            assert.equal(parseBlock(candidate).ok, true, "Input candidate must pass the unchanged strict pure parser");
            const inserted = await request("/api/block/insertBlock", { dataType: transport, parentID: docId, data: transport === "dom" ? domFor(candidate) : markdownFor(candidate) });
            const state = await snapshot(docId);
            const marked = state.rows.filter((row) => row.ial.includes(`${PREFIX}="1"`));
            assert.equal(marked.length, 1, "This controlled fixture must contain exactly one marked method block");
            const row = marked[0];
            assert.equal(row.parent_id, docId);
            assert.equal(row.type, "p");
            assert.ok(state.children.some((entry) => entry.id === row.id));
            assert.equal(ialAttrs(row.ial)[`${PREFIX}-id`], method.id, "Valid method-hash identity must survive transport");
            const expected = { ...method, content: candidate.content };
            const observed = inspect(row, expected);
            const entry = { transport, fixture: fixture.name, docId, expected, inserted, state, inspection: observed };
            result.observations.push(entry);
            saved.push({ entry, expected, row });
        }
        result.kernelApiWriteReadVerified = true;
        await stop();
        await start();
        for (const fixture of saved) {
            const state = await snapshot(fixture.expected.owner);
            const row = state.rows.find((entry) => entry.id === fixture.row.id);
            assert.ok(row, "Expected fixture block missing after restart");
            for (const key of ["id", "root_id", "parent_id", "type", "content", "markdown"]) assert.equal(row[key], fixture.row[key], `Restart changed ${key}`);
            assert.deepEqual(ialAttrs(row.ial), ialAttrs(fixture.row.ial));
            fixture.entry.afterRestart = { state, inspection: inspect(row, fixture.expected) };
        }
        result.restartReadbackVerified = true;
        result.strictCandidateCount = saved.filter(({ entry }) => entry.inspection.candidateVerified && entry.afterRestart.inspection.candidateVerified).length;
        result.kernelCandidateVerified = result.strictCandidateCount > 0;
        result.allCandidatePathsVerified = result.strictCandidateCount === saved.length;
        result.pureCounters = counters();
        assert.equal(result.pureCounters.identityAllocations, 0, "Reading may not allocate method identity");
    } catch (error) {
        result.error = redact(error);
        process.exitCode = 1;
    } finally {
        if (shutdownPromise) await shutdownPromise;
        await stop().catch((error) => { result.cleanup.error = redact(error); process.exitCode = 1; });
        process.removeListener("SIGINT", onSignal);
        process.removeListener("SIGTERM", onSignal);
        if (!child) process.removeListener("exit", onExit);
        result.completedAt = new Date().toISOString();
        fs.writeFileSync(OUTPUT, JSON.stringify(result, null, 2) + "\n", "utf8");
    }
    console.log(JSON.stringify({ kernelApiWriteReadVerified: result.kernelApiWriteReadVerified, restartReadbackVerified: result.restartReadbackVerified,
        kernelCandidateVerified: result.kernelCandidateVerified, strictCandidateCount: result.strictCandidateCount ?? 0,
        allCandidatePathsVerified: result.allCandidatePathsVerified, uiControlChannel: result.uiControlChannel,
        uiVerified: false, hostVerified: false, status: result.status, cleanup: result.cleanup, error: result.error ?? null, output: OUTPUT }, null, 2));
}
