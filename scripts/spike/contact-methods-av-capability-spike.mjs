/**
 * AG-RF-004-S3-A0: existing scalar AV endpoint capabilities only.
 * Default/--dry-run performs no HTTP, file writes or child-process starts.
 * LVCT_RUN_AV_CAPABILITY=1 explicitly enables a new UUID temporary Kernel.
 * No production services, methods schema, UI, browser, CAS or D1 adoption.
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

const OUTPUT = fileURLToPath(new URL("./contact-methods-av-capability-results.json", import.meta.url));
const HOST = "127.0.0.1";
const MARKER = "contact-methods-av-capability-spike.json";
const CREATED_BY = "lvct scalar AV capability isolated Kernel probe";
const ID = /^\d{14}-[a-z0-9]{7}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const TYPES = ["phone", "email", "url", "text"];
const args = process.argv.slice(2);
assert.ok(args.every((arg) => arg === "--dry-run"), "Only --dry-run is supported; workspace/port cannot be supplied");
const runEnabled = process.env.LVCT_RUN_AV_CAPABILITY === "1" && !args.includes("--dry-run");
const runId = randomUUID();
const tempRoot = fs.realpathSync(os.tmpdir());
const workspace = path.join(tempRoot, `SiYuan-Lvct-Av-Capability-${runId}`);
assert.equal(path.dirname(workspace), tempRoot);
assert.match(path.basename(workspace), /^SiYuan-Lvct-Av-Capability-[0-9a-f-]{36}$/);
assert.match(runId, UUID);
assert.equal(fs.existsSync(workspace), false, "The generated UUID workspace must not exist");
const foundKernel = [
    "D:/biji/SiYuan/resources/kernel/SiYuan-Kernel.exe",
    "D:/RJ/SiYuan/resources/kernel/SiYuan-Kernel.exe",
    path.join(process.env.ProgramFiles || "C:/Program Files", "SiYuan/resources/kernel/SiYuan-Kernel.exe"),
].find((candidate) => fs.existsSync(candidate));
const kernel = foundKernel ? fs.realpathSync(foundKernel) : null;
const appDir = kernel ? path.resolve(path.dirname(kernel), "..") : null;
const kernelReady = Boolean(kernel && path.basename(kernel) === "SiYuan-Kernel.exe" && fs.statSync(kernel).isFile()
    && ["stage", "appearance"].every((name) => fs.existsSync(path.join(appDir, name))));
const preflight = {
    research: "AG-RF-004-S3-A0", mode: runEnabled ? "explicit-isolated-kernel" : "dry-run",
    gate: "LVCT_RUN_AV_CAPABILITY=1", runEnabled, runId, workspace, workspaceExists: false,
    host: HOST, port: null, randomPortChecked: false, kernel, kernelReady,
    fictionalOnly: true, scalarTypes: TYPES, kernelStarted: false, kernelRequests: 0,
    workspaceWrites: 0, browserCalls: 0, productionChanges: false, realPluginFileWrites: 0,
    hostVerified: false, uiVerified: false, multiWindowVerified: false, D1Adopted: false,
    status: "not_run",
};
if (!runEnabled) {
    console.log(JSON.stringify({ preflight }, null, 2));
} else {
    assert.equal(process.platform, "win32", "Listener attribution is Windows-only");
    assert.ok(kernelReady, "No validated Kernel executable/resources found");
    await runHost();
}

function nodeId() {
    return `${new Date().toISOString().slice(0, 19).replace(/\D/g, "")}-${randomBytes(4).toString("hex").slice(0, 7)}`;
}
function checkedId(value) { assert.equal(typeof value, "string"); assert.match(value, ID); return value; }
function checkedMappingItem(value) {
    assert.equal(typeof value, "string", "Mapping itemID must be a string");
    if (value !== "") checkedId(value);
    return value;
}
function record(value, message) {
    assert.ok(value !== null && typeof value === "object" && !Array.isArray(value), message);
    return value;
}
function scalarFixture(type, person, phase) {
    const suffix = ({ baseline: "111", desired: "222", third: "333" })[phase];
    assert.ok(suffix && TYPES.includes(type) && ["a", "b"].includes(person));
    return ({
        phone: `+00 ${person === "a" ? "100" : "200"} ${suffix}`,
        email: `fiction-${person}-${suffix}@example.test`,
        url: `https://example.test/fiction-${person}/${suffix}`,
        text: `虚构-${person}-${phase}`,
    })[type];
}
function validCellShape(cell) {
    if (!cell || typeof cell !== "object" || Array.isArray(cell)
        || typeof cell.valueType !== "string" || !cell.valueType) return false;
    const value = cell.value;
    return Boolean(value && typeof value === "object" && !Array.isArray(value)
        && typeof value.keyID === "string" && ID.test(value.keyID)
        && typeof value.type === "string" && value.type && value.type === cell.valueType
        && (value.blockID === undefined || typeof value.blockID === "string" && ID.test(value.blockID)));
}
function scalarValue(row, keyID, type) {
    if (!row || !Array.isArray(row.cells)) return { verified: false, reason: "row-shape" };
    if (row.cells.some((cell) => !validCellShape(cell))) return { verified: false, reason: "cell-shape" };
    const cells = row.cells.filter((cell) => cell.value.keyID === keyID);
    if (cells.length === 0) return { verified: true, value: "", source: "absent-cell-means-empty-only" };
    if (cells.length !== 1) return { verified: false, reason: "duplicate-cell" };
    const cell = cells[0], value = cell.value;
    if (cell.valueType !== type || value.type !== type) return { verified: false, reason: "cell-type" };
    const payload = value[type];
    // A present cell with an omitted/malformed scalar payload is unknown.
    // Do not guess that it means empty or borrow another scalar member.
    if (!payload || typeof payload !== "object" || Array.isArray(payload) || typeof payload.content !== "string") {
        return { verified: false, reason: "scalar-payload-unknown" };
    }
    return { verified: true, value: payload.content, source: "typed-content" };
}

async function runHost() {
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
    const result = {
        ...preflight, port, randomPortChecked: true, generatedAt: new Date().toISOString(), preflight,
        status: "running_isolated", isolatedKernelApi: true, endpointCapabilitiesVerified: false,
        requests: [], observations: [], listenerOwnershipChecks: 0,
        scalarWrites: { fixture: 0, actor: 0, projection: 0 },
        checkpointWrites: 0, automaticResends: 0, cleanup: { ownKernelExited: false, portReleased: false, workspaceRetained: true },
        isolationBoundary: "UUID workspace and owned-child/port checks are detection guards, not OS-level isolation",
        limits: [
            "Existing scalar endpoint probe; production services are not invoked or integrated",
            "Received-success response discard is caller-side injection, not a real network failure",
            "TOCTOU is a controlled sequential API-writer interleaving, not UI or simultaneous multi-window evidence",
            "The tested assignment carries no expected-value precondition; other unresearched host capabilities are not ruled out",
            "Research checkpoint is not a proposed production methods/projection schema or durable recovery guarantee",
            "Applied only means the fresh value equals desired; it does not establish causal ownership by this checkpoint or absence of intervening writes",
            "No facts-source, D1/D4/D5 adoption, method identities, JSON/AV transaction or CAS is implemented",
        ],
    };
    let child, assertRunning, token = "", shutdownPromise, interrupted = false;
    const markerValue = { createdBy: CREATED_BY, runId, workspace, port, kernel };
    prepareIsolatedWorkspace(workspace, MARKER, CREATED_BY);
    fs.writeFileSync(path.join(workspace, MARKER), JSON.stringify(markerValue) + "\n", "utf8");
    result.workspaceWrites = 2; // Direct marker metadata only, not all Kernel-created files.
    function assertOwnedWorkspace() {
        assert.equal(fs.lstatSync(workspace).isSymbolicLink(), false);
        assert.equal(fs.realpathSync(workspace), workspace);
        assertIsolatedPath(workspace, path.join(workspace, MARKER));
        assertIsolatedPath(workspace, path.join(workspace, "data"));
        assert.deepEqual(JSON.parse(fs.readFileSync(path.join(workspace, MARKER), "utf8")), markerValue);
    }
    function redact(error) {
        const text = String(error?.message ?? error);
        return (token ? text.replaceAll(token, "[REDACTED]") : text)
            .replace(/(Authorization\s*[:=]\s*|Token\s+)[^\s,;]+/gi, "$1[REDACTED]");
    }
    function assertOwnedListener() {
        assertRunning();
        const listing = execFileSync(path.join(process.env.SystemRoot || "C:/Windows", "System32", "netstat.exe"), ["-ano", "-p", "tcp"], {
            encoding: "utf8", windowsHide: true, timeout: 5000, maxBuffer: 2 * 1024 * 1024,
        });
        const owners = new Set(listing.split(/\r?\n/).map((line) => line.trim().split(/\s+/))
            .filter((columns) => columns.length === 5 && columns[0] === "TCP" && columns[3] === "LISTENING"
                && Number(columns[1].match(/:(\d+)$/)?.[1]) === port)
            .map((columns) => Number(columns[4])));
        assert.ok(owners.size === 1 && owners.has(child.pid), "Random-port listener is not this probe's live child; refusing HTTP");
        assertRunning();
        result.listenerOwnershipChecks += 1;
    }
    async function request(route, body = {}, timeout = 15000, scalarWriteCategory) {
        assertOwnedWorkspace();
        assert.ok(!interrupted || route === "/api/system/exit", "Interrupted; refusing further work");
        assertOwnedListener();
        if (scalarWriteCategory !== undefined) {
            assert.ok(["fixture", "actor", "projection"].includes(scalarWriteCategory));
            assert.equal(route, "/api/av/setAttributeViewBlockAttr");
            result.scalarWrites[scalarWriteCategory] += 1; // Increment only after every dispatch guard, immediately before fetch.
        }
        result.kernelRequests += 1;
        const requestNo = result.kernelRequests;
        const response = await fetch(`http://${HOST}:${port}${route}`, {
            method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Token ${token}` } : {}) },
            body: JSON.stringify(body), signal: AbortSignal.timeout(timeout),
        });
        assertRunning();
        assert.equal(response.ok, true, `${route}: HTTP ${response.status}`);
        const payload = await response.json();
        result.requests.push({ requestNo, route, body, ...(scalarWriteCategory ? { scalarWriteCategory } : {}), response: payload });
        assert.equal(payload.code, 0, `${route}: Kernel code ${payload.code}`);
        return payload.data;
    }
    async function start() {
        assert.equal(interrupted, false, "Interrupted; refusing restart");
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
            ownedChild.kill("SIGKILL"); // Only this exact ChildProcess, never process-name cleanup.
            await new Promise((resolveExit) => {
                if (exited()) return resolveExit();
                const timer = setTimeout(resolveExit, 3000);
                ownedChild.once("exit", () => { clearTimeout(timer); resolveExit(); });
            });
        }
        assert.ok(exited(), "Owned child did not exit; no unrelated process will be stopped");
        child = undefined;
        assertRunning = undefined;
        result.cleanup.ownKernelExited = true;
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

    let anchors, keyIDs, docs;
    async function snapshot(label, docIds = docs) {
        const rendered = record(await request("/api/av/renderAttributeView", {
            id: anchors.avID, blockID: anchors.dbBlockID, query: "", page: 1, pageSize: 500, createIfNotExist: false,
        }), "render data must be an object");
        const view = record(rendered.view, "render view must be an object");
        assert.ok(Array.isArray(view.columns) && view.columns.length <= 8);
        for (const column of view.columns) {
            record(column, "Column must be an object");
            checkedId(column.id);
            assert.ok(typeof column.name === "string" && typeof column.type === "string" && column.type);
        }
        assert.equal(new Set(view.columns.map((column) => column.id)).size, view.columns.length, "Column IDs must be globally unique");
        const primaryColumns = view.columns.filter((column) => column.type === "block");
        assert.equal(primaryColumns.length, 1, "Exactly one primary block column is required");
        assert.ok(Array.isArray(view.rows) && view.rows.length <= 2, "Only two controlled rows are allowed");
        assert.equal(new Set(view.rows.map((row) => checkedId(row.id))).size, view.rows.length);
        assert.equal(typeof view.rowCount, "number", "Controlled full scope requires the known rowCount shape");
        assert.equal(view.rowCount, view.rows.length, "No partial or truncated AV scope is accepted");
        for (const row of view.rows) {
            assert.ok(Array.isArray(row.cells) && row.cells.length <= 8);
            assert.ok(row.cells.every(validCellShape), "Malformed cell must not be mistaken for an absent empty cell");
            assert.equal(new Set(row.cells.map((cell) => cell.value.keyID)).size, row.cells.length, "Duplicate column cells");
            for (const cell of row.cells) {
                const column = view.columns.find((entry) => entry.id === cell.value.keyID);
                assert.ok(column, "Cell references an unknown column");
                assert.equal(cell.valueType, column.type, "Cell type differs from column type");
                assert.equal(cell.value.type, column.type, "Value type differs from column type");
            }
        }
        const rawMapping = record(await request("/api/av/getAttributeViewItemIDsByBoundIDs", {
            avID: anchors.avID, blockIDs: docIds.map(checkedId),
        }), "mapping response must be an object");
        // Only the two response envelopes already decoded by src/api/client.ts.
        const mapping = record(Object.hasOwn(rawMapping, "itemIDsByBoundBlockIDs")
            ? rawMapping.itemIDsByBoundBlockIDs : rawMapping, "mapping must be a string map");
        for (const [docId, itemId] of Object.entries(mapping)) {
            checkedId(docId); checkedMappingItem(itemId);
            assert.ok(docIds.includes(docId), "Mapping returned an unrequested document");
        }
        const bound = [];
        for (const row of view.rows) {
            const primary = row.cells.filter((cell) => cell?.valueType === "block" && cell?.value?.type === "block");
            assert.equal(primary.length, 1, "Each controlled row needs one unambiguous primary cell");
            const value = primary[0].value;
            assert.equal(value.keyID, primaryColumns[0].id, "Primary key must match the unique block column");
            const docId = checkedId(value.block?.id);
            assert.equal(value.blockID, row.id, "Primary blockID must equal row itemID");
            assert.ok(docs.includes(docId), "An unrelated document appeared in this controlled AV");
            bound.push({ docId, itemId: row.id });
            if (docIds.includes(docId)) assert.equal(mapping[docId], row.id, "Official mapping differs from render binding");
        }
        assert.equal(new Set(bound.map((entry) => entry.docId)).size, bound.length, "Duplicate document bindings");
        for (const [docId, itemId] of Object.entries(mapping)) {
            if (itemId === "") assert.equal(bound.some((entry) => entry.docId === docId), false, "Explicit empty mapping requires no rendered binding");
            else assert.ok(bound.some((entry) => entry.docId === docId && entry.itemId === itemId));
        }
        for (const type of TYPES) {
            const columns = view.columns.filter((column) => column.id === keyIDs[type]);
            assert.equal(columns.length, 1, "Field ID must identify one column");
            assert.equal(columns[0].type, type, "Stable field type changed");
        }
        const evidence = { label, rendered, rawMapping, mapping, bound };
        result.observations.push(evidence);
        return evidence;
    }
    function target(state, docId, frozenItemID) {
        const matches = state.bound.filter((entry) => entry.docId === docId);
        if (matches.length !== 1 || state.mapping[docId] !== matches[0].itemId
            || frozenItemID && matches[0].itemId !== frozenItemID) return undefined;
        const rows = state.rendered.view.rows.filter((row) => row.id === matches[0].itemId);
        return rows.length === 1 ? rows[0] : undefined;
    }
    function exact(state, docId, type, expected, frozenItemID) {
        const actual = scalarValue(target(state, docId, frozenItemID), keyIDs[type], type);
        assert.equal(actual.verified, true, `Unknown scalar shape: ${actual.reason ?? ""}`);
        assert.equal(actual.value, expected, `${type}: independent render differs from expected`);
        return actual;
    }
    async function writeScalar(category, itemID, type, value) {
        assert.ok(["fixture", "actor", "projection"].includes(category));
        checkedId(itemID);
        assert.ok(TYPES.includes(type) && typeof value === "string");
        return request("/api/av/setAttributeViewBlockAttr", { avID: anchors.avID, keyID: keyIDs[type], itemID, value: { [type]: { content: value } } }, 15000, category);
    }
    function checkpointPath(requestId) {
        assert.match(requestId, UUID);
        const targetPath = path.join(workspace, `av-capability-checkpoint-${requestId}.json`);
        assertOwnedWorkspace();
        assertIsolatedPath(workspace, targetPath);
        if (fs.existsSync(targetPath)) assert.equal(fs.lstatSync(targetPath).isSymbolicLink(), false);
        return targetPath;
    }
    function issueCheckpoint(docId, itemID, type, baseline, desired) {
        const requestId = randomUUID();
        const checkpoint = { researchOnly: true, schema: 1, runId, requestId, state: "issued", anchors: structuredClone(anchors), docId, itemID, keyID: keyIDs[type], type, baseline, desired };
        const targetPath = checkpointPath(requestId);
        assert.equal(fs.existsSync(targetPath), false);
        fs.writeFileSync(targetPath, JSON.stringify(checkpoint) + "\n", { encoding: "utf8", flag: "wx" });
        result.workspaceWrites += 1;
        result.checkpointWrites += 1;
        assert.deepEqual(JSON.parse(fs.readFileSync(targetPath, "utf8")), checkpoint);
        return { requestId, path: targetPath };
    }
    function readCheckpoint(requestId) {
        const value = record(JSON.parse(fs.readFileSync(checkpointPath(requestId), "utf8")), "Research checkpoint must be an object");
        assert.deepEqual(Object.keys(value).sort(), ["researchOnly", "schema", "runId", "requestId", "state", "anchors", "docId", "itemID", "keyID", "type", "baseline", "desired"].sort());
        assert.equal(value.researchOnly, true); assert.equal(value.schema, 1); assert.equal(value.runId, runId);
        assert.equal(value.requestId, requestId); assert.equal(value.state, "issued");
        assert.deepEqual(value.anchors, anchors);
        checkedId(value.docId); checkedId(value.itemID); checkedId(value.keyID);
        assert.ok(docs.includes(value.docId) && TYPES.includes(value.type) && value.keyID === keyIDs[value.type]);
        assert.ok(typeof value.baseline === "string" && typeof value.desired === "string" && value.baseline !== value.desired);
        return value;
    }
    async function verifyIssuedFromDisk(reference) {
        const checkpoint = readCheckpoint(reference.requestId);
        const writesBefore = structuredClone(result.scalarWrites);
        const state = await snapshot(`restart-readonly-${checkpoint.requestId}`);
        const row = target(state, checkpoint.docId, checkpoint.itemID);
        const actual = scalarValue(row, checkpoint.keyID, checkpoint.type);
        const outcome = actual.verified && actual.value === checkpoint.desired ? "applied"
            : "unknown";
        // Reading baseline (or a third value) cannot prove an issued request was never sent/applied.
        assert.deepEqual(result.scalarWrites, writesBefore);
        return { path: reference.path, checkpoint, stateLabel: state.label, actual, outcome, businessWrites: 0, automaticResends: 0 };
    }

    try {
        await start();
        result.version = await request("/api/system/version");
        const notebookName = `AV capability fictional ${runId}`;
        await request("/api/notebook/createNotebook", { name: notebookName });
        const notebooks = (await request("/api/notebook/lsNotebooks")).notebooks.filter((entry) => entry.name === notebookName);
        assert.equal(notebooks.length, 1);
        const notebook = checkedId(notebooks[0].id);
        const hostDocID = checkedId(await request("/api/filetree/createDocWithMd", { notebook, path: "/AV-capability-host", markdown: "Only fictional AV capability fixtures.\n" }));
        const avID = nodeId();
        const inserted = await request("/api/block/insertBlock", {
            dataType: "dom", parentID: hostDocID,
            data: `<div data-type="NodeAttributeView" data-av-id="${avID}" data-av-type="table"></div>`,
        });
        const dbBlockID = checkedId(inserted?.[0]?.doOperations?.[0]?.id);
        anchors = { notebook, hostDocID, avID, dbBlockID };
        result.anchors = structuredClone(anchors);
        await request("/api/av/renderAttributeView", { id: avID, blockID: dbBlockID, query: "", page: 1, pageSize: 500, createIfNotExist: true });
        keyIDs = {};
        let previousKeyID = "";
        for (const type of TYPES) {
            const keyID = nodeId(); keyIDs[type] = keyID;
            await request("/api/av/addAttributeViewKey", { avID, keyID, keyName: `fiction-${type}`, keyType: type, keyIcon: "", previousKeyID });
            previousKeyID = keyID;
        }
        assert.equal(new Set(Object.values(keyIDs)).size, TYPES.length);
        result.keyIDs = structuredClone(keyIDs);
        result.rawKeys = await request("/api/av/getAttributeView", { id: avID });
        assert.ok(Array.isArray(result.rawKeys?.av?.keyValues) && result.rawKeys.av.keyValues.length <= 8);
        for (const type of TYPES) {
            const columns = result.rawKeys.av.keyValues.filter((entry) => entry?.key?.id === keyIDs[type]);
            assert.equal(columns.length, 1); assert.equal(columns[0].key.type, type);
        }
        await request("/api/sqlite/flushTransaction");
        result.rawCarrierSQL = await request("/api/query/sql", { stmt: `SELECT id, root_id, parent_id, type, markdown FROM blocks WHERE id='${dbBlockID}' LIMIT 2` });
        assert.equal(result.rawCarrierSQL.length, 1);
        const carrier = result.rawCarrierSQL[0];
        assert.equal(carrier.id, dbBlockID); assert.equal(carrier.root_id, hostDocID); assert.equal(carrier.parent_id, hostDocID); assert.equal(carrier.type, "av");
        assert.equal(/data-av-id="(\d{14}-[0-9a-z]{7})"/.exec(carrier.markdown)?.[1], avID);
        docs = [];
        for (const name of ["a", "b"]) docs.push(checkedId(await request("/api/filetree/createDocWithMd", { notebook, path: `/fiction-person-${name}`, markdown: `Fictional person ${name}.\n` })));
        await request("/api/av/addAttributeViewBlocks", { avID, blockID: dbBlockID, srcs: docs.map((id, index) => ({ id, isDetached: false, content: `fiction-person-${index}` })) });
        result.docs = [...docs];
        const initial = await snapshot("initial-bindings");
        assert.equal(initial.bound.length, 2);
        const items = docs.map((docId) => checkedId(initial.mapping[docId]));
        assert.equal(new Set(items).size, 2);
        result.initialItems = [...items];
        result.scalarRoundTrips = [];
        for (let index = 0; index < docs.length; index += 1) for (const type of TYPES) {
            const docId = docs[index], itemID = items[index], person = index === 0 ? "a" : "b";
            const phases = [];
            for (const phase of ["baseline", "desired", "clear", "baseline"]) {
                const expected = phase === "clear" ? "" : scalarFixture(type, person, phase);
                const acknowledgement = await writeScalar("fixture", itemID, type, expected);
                const state = await snapshot(`roundtrip-${person}-${type}-${phases.length}-${phase}`);
                phases.push({ phase, expected, acknowledgement, stateLabel: state.label, verification: exact(state, docId, type, expected, itemID) });
            }
            result.scalarRoundTrips.push({ docId, itemID, type, phases });
        }

        const type = "phone", docId = docs[0], itemID = items[0];
        const baseline = scalarFixture(type, "a", "baseline"), desired = scalarFixture(type, "a", "desired"), third = scalarFixture(type, "a", "third");
        await writeScalar("actor", itemID, type, third);
        const fresh = await snapshot("fresh-third-value-before-guard");
        const freshActual = scalarValue(target(fresh, docId, itemID), keyIDs[type], type);
        const guardStart = structuredClone(result.scalarWrites);
        const guardedOutcome = !freshActual.verified ? "unknown" : freshActual.value !== baseline ? "conflict" : "eligible";
        assert.equal(guardedOutcome, "conflict");
        assert.deepEqual(result.scalarWrites, guardStart);
        result.freshConflict = { baseline, desired, third, actual: freshActual, outcome: guardedOutcome, businessWrites: 0 };

        await writeScalar("fixture", itemID, type, baseline);
        const checked = await snapshot("toctou-baseline-checked");
        exact(checked, docId, type, baseline, itemID);
        const actorResponse = await writeScalar("actor", itemID, type, third);
        const thirdState = await snapshot("toctou-actor-third-value");
        exact(thirdState, docId, type, third, itemID);
        const staleResponse = await writeScalar("projection", itemID, type, desired);
        const staleState = await snapshot("toctou-stale-assignment-overwrites-third");
        exact(staleState, docId, type, desired, itemID);
        result.toctou = { baseline, desired, third, actorResponse, staleResponse, thirdObserved: true, finalDesiredObserved: true,
            controlledSequentialInterleaving: true, actualUIWriter: false, simultaneousWritersVerified: false,
            conclusion: "This existing assignment request does not carry the checked baseline as a precondition; the controlled third value was overwritten" };

        await writeScalar("fixture", itemID, type, baseline);
        exact(await snapshot("before-issued-response-discard"), docId, type, baseline, itemID);
        const responseDiscardReference = issueCheckpoint(docId, itemID, type, baseline, desired);
        const observedSuccess = await writeScalar("projection", itemID, type, desired);
        // Only the experiment observer retains this already received successful response.
        // The simulated caller keeps the on-disk checkpoint issued and performs no resend.
        result.responseDiscard = { reference: responseDiscardReference, observerOnlyAlreadyReceivedSuccess: observedSuccess,
            callerOutcome: "unknown", injection: "discard-already-received-success-in-caller", realTransportLossVerified: false };
        const unissuedBaseline = scalarFixture(type, "b", "baseline"), unissuedDesired = scalarFixture(type, "b", "desired");
        exact(await snapshot("before-issued-but-not-sent"), docs[1], type, unissuedBaseline, items[1]);
        const beforeSendReference = issueCheckpoint(docs[1], items[1], type, unissuedBaseline, unissuedDesired);
        result.issuedBeforeSend = { reference: beforeSendReference, actualExperimentDispatches: 0, callerOutcome: "unknown" };
        await stop();
        await start();
        // Reconstruct solely from the saved research files and fresh Kernel responses.
        const afterRestartApplied = await verifyIssuedFromDisk(responseDiscardReference);
        const afterRestartUnknown = await verifyIssuedFromDisk(beforeSendReference);
        assert.equal(afterRestartApplied.outcome, "applied");
        assert.equal(afterRestartUnknown.actual.verified, true);
        assert.equal(afterRestartUnknown.actual.value, unissuedBaseline);
        assert.equal(afterRestartUnknown.outcome, "unknown");
        result.restartReadOnlyRecovery = { applied: afterRestartApplied, baselineStillUnknown: afterRestartUnknown, businessWrites: 0, automaticResends: 0 };

        const frozenTarget = { docId: docs[0], itemID: items[0], keyID: keyIDs[type], desired };
        await request("/api/av/removeAttributeViewBlocks", { avID, srcIDs: [frozenTarget.itemID] });
        const unbound = await snapshot("frozen-target-unbound");
        assert.ok(!Object.hasOwn(unbound.mapping, frozenTarget.docId) || unbound.mapping[frozenTarget.docId] === "", "Unbound mapping must be absent or explicitly empty");
        const beforeBlockedWrite = structuredClone(result.scalarWrites);
        const allowedAfterUnbind = Boolean(target(unbound, frozenTarget.docId, frozenTarget.itemID));
        assert.equal(allowedAfterUnbind, false);
        assert.deepEqual(result.scalarWrites, beforeBlockedWrite);
        result.unbindGuard = { frozenTarget, mapping: unbound.mapping, outcome: "unknown-target-binding", businessWrites: 0 };
        await request("/api/av/addAttributeViewBlocks", { avID, blockID: dbBlockID, srcs: [{ id: frozenTarget.docId, isDetached: false, content: "fiction-person-rebound" }] });
        const rebound = await snapshot("frozen-target-rebound-observation");
        const reboundItemID = checkedId(rebound.mapping[frozenTarget.docId]);
        result.rebindObservation = { oldItemID: frozenTarget.itemID, newItemID: reboundItemID, itemIDChanged: reboundItemID !== frozenTarget.itemID,
            rawBinding: rebound.bound, oldPlanAutomaticallyResumed: false, businessWrites: 0,
            conclusion: "Actual identity reuse/change is recorded; this probe does not require itemID to change or replay the frozen plan" };
        assert.deepEqual(result.scalarWrites, beforeBlockedWrite);
        result.endpointCapabilitiesVerified = true;
        result.status = "done_isolated";
    } catch (error) {
        result.error = redact(error);
        result.status = "failed_isolated";
        process.exitCode = 1;
    } finally {
        if (shutdownPromise) await shutdownPromise;
        await stop().catch((error) => { result.cleanup.error = redact(error); result.status = "failed_isolated"; process.exitCode = 1; });
        process.removeListener("SIGINT", onSignal);
        process.removeListener("SIGTERM", onSignal);
        if (!child) process.removeListener("exit", onExit);
        result.completedAt = new Date().toISOString();
        // Defense in depth: prevent an accidental temporary token appearing in raw API evidence.
        const serialized = JSON.stringify(result, null, 2);
        assert.ok(!token || !serialized.includes(token), "Refusing to persist evidence containing the temporary token");
        fs.writeFileSync(OUTPUT, serialized + "\n", "utf8");
    }
    console.log(JSON.stringify({ endpointCapabilitiesVerified: result.endpointCapabilitiesVerified, status: result.status,
        scalarWrites: result.scalarWrites, checkpointWrites: result.checkpointWrites, automaticResends: result.automaticResends,
        hostVerified: false, uiVerified: false, multiWindowVerified: false, D1Adopted: false,
        cleanup: result.cleanup, error: result.error ?? null, output: OUTPUT }, null, 2));
}
