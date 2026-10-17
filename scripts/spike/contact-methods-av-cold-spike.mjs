/**
 * AG-RF-004-A2: cold discovery of native method AVs.
 *
 * Import, default and --dry-run are pure.  LVCT_RUN_AV_COLD=1 is the only
 * path that starts an isolated Kernel and creates fictional research data.
 * The reader is a separate process; this file is its broker, producer and
 * evidence owner.  It never changes production files or marketplace state.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
    DEFAULT_BUDGET, FIELDS, carrierSQL, documentSQL, parseCarrier, inspectCarrierPage,
    inspectRender, aggregateMethods, discoveryStatus, runChecks as readerChecks, discover,
    main as readerMain,
} from "./contact-methods-av-cold-reader.mjs";

const HOST = "127.0.0.1";
const ID = /^\d{14}-[a-z0-9]{7}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const TYPES = new Set(["phone", "email", "wechat", "url"]);
const SCRIPT = fileURLToPath(import.meta.url);
const READER_SCRIPT = fileURLToPath(new URL("./contact-methods-av-cold-reader.mjs", import.meta.url));
const OUTPUT = path.resolve(path.dirname(SCRIPT), "contact-methods-av-cold-results.json");
const MARKER = "contact-methods-av-cold-marker.json";
const CREATED_BY = "lvct A2 fictional cold AV discovery";
const ROUTES = new Set([
    "/api/system/bootProgress", "/api/system/version", "/api/system/exit", "/api/notebook/createNotebook",
    "/api/notebook/lsNotebooks", "/api/filetree/createDocWithMd", "/api/block/insertBlock",
    "/api/av/renderAttributeView", "/api/av/addAttributeViewKey", "/api/av/appendAttributeViewDetachedBlocksWithValues",
    "/api/sqlite/flushTransaction", "/api/query/sql",
]);
const MUTATIONS = new Set(["/api/notebook/createNotebook", "/api/filetree/createDocWithMd", "/api/block/insertBlock",
    "/api/av/addAttributeViewKey", "/api/av/appendAttributeViewDetachedBlocksWithValues"]);
const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const canonical = (value) => JSON.stringify(value);
const jsonBytes = (value) => { try { return Buffer.byteLength(JSON.stringify(value)); } catch { return Infinity; } };
const checkedID = (value) => { assert.equal(typeof value, "string"); assert.match(value, ID); return value; };
const nodeID = () => `${new Date().toISOString().slice(0, 19).replace(/\D/g, "")}-${randomBytes(4).toString("hex").slice(0, 7)}`;
const sourceKey = (owner, source) => `method-${createHash("sha256").update(`${owner}:${source}`).digest("hex").slice(0, 24)}`;
const stable = (value) => Array.isArray(value) ? value.map(stable) : record(value)
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])])) : value;

/** Reader/broker provenance is created fresh for every cold reader. */
export function createReaderState(budget = DEFAULT_BUDGET) {
    return { budget, seq: 0, pending: false, requests: 0, bytes: 0, expectedCursor: "", carrierPairs: new Map(), roots: new Set(), owners: new Set(), provenance: [] };
}
const exact = (value, keys) => record(value) && Object.keys(value).sort().join() === keys.slice().sort().join();
const allowedError = new Set(["broker-rejected", "transport", "timeout", "request-budget", "request-bytes", "response-bytes", "malformed-response", "host-http", "host-parse"]);

/** Validate only the frozen SQL/render templates; no oracle or title is consulted. */
export function validateReaderRequest(state, message) {
    const budget = state.budget;
    if (state.requests >= budget.maxRequests) return { ok: false, errorClass: "request-budget" };
    if (state.pending || !record(message) || !exact(message, ["body", "kind", "route", "seq"])
        || message.kind !== "request" || message.seq !== state.seq + 1 || !ROUTES.has(message.route)
        || jsonBytes(message) > budget.maxJsonBytes) return { ok: false, errorClass: "broker-rejected" };
    if (message.route === "/api/query/sql") {
        if (!exact(message.body, ["stmt"]) || typeof message.body.stmt !== "string") return { ok: false, errorClass: "broker-rejected" };
        const expectedCarrier = carrierSQL(state.expectedCursor, budget.carrierPageSize);
        if (message.body.stmt === expectedCarrier) return { ok: true, kind: "carrier", pageSize: budget.carrierPageSize };
        const match = /^SELECT id, root_id, parent_id, box, type FROM blocks WHERE id = '(\d{14}-[a-z0-9]{7})' LIMIT 2$/.exec(message.body.stmt);
        if (match && (state.roots.has(match[1]) || state.owners.has(match[1]))) return { ok: true, kind: "document", id: match[1], pageSize: 2 };
        return { ok: false, errorClass: "broker-rejected" };
    }
    if (message.route === "/api/av/renderAttributeView") {
        if (!exact(message.body, ["blockID", "createIfNotExist", "id", "page", "pageSize", "query"])
            || message.body.query !== "" || message.body.createIfNotExist !== false || !Number.isSafeInteger(message.body.page)
            || message.body.page < 1 || message.body.page > budget.avMaxPages + 1
            || ![budget.avPageSize, 500].includes(message.body.pageSize)
            || message.body.pageSize === 500 && message.body.page !== 1) return { ok: false, errorClass: "broker-rejected" };
        // A single AV can legally be mounted by more than one carrier block.
        // Key by the observed carrier, then bind the requested AV ID to that
        // exact pair; an avID-only map would overwrite the first carrier and
        // make the first source unreadable.
        const pair = state.carrierPairs.get(message.body.blockID);
        if (!pair || pair.avID !== message.body.id) return { ok: false, errorClass: "broker-rejected" };
        return { ok: true, kind: "render", pair, pageSize: message.body.pageSize };
    }
    return { ok: false, errorClass: "broker-rejected" };
}
export function acceptReaderRequest(state, message, validated) {
    assert.ok(validated?.ok && !state.pending); state.seq = message.seq; state.pending = { ...validated, seq: message.seq, route: message.route, body: message.body }; state.requests += 1; return state.pending;
}

/** Register IDs only after the raw response has been captured by the parent. */
export function registerReaderResponse(state, request, envelope) {
    assert.ok(state.pending && state.pending.seq === request.seq);
    state.pending = false; state.bytes += jsonBytes(envelope); assert.ok(state.bytes <= state.budget.maxJsonBytes, "reader-response-budget");
    if (!record(envelope) || !Object.hasOwn(envelope, "data") || envelope.code !== 0) return { ok: true, registered: 0 };
    let registered = 0;
    if (request.kind === "carrier") {
        if (!Array.isArray(envelope.data)) return { ok: false, detail: "carrier-response-array" };
        const checked = inspectCarrierPage(envelope.data, state.expectedCursor, request.pageSize);
        if (!checked.ok) return { ok: false, detail: checked.detail };
        for (const row of checked.processed) {
            if (record(row) && typeof row.root_id === "string" && ID.test(row.root_id) && row.type === "av") {
                state.roots.add(row.root_id); state.provenance.push({ seq: request.seq, route: request.route, kind: "root", id: row.root_id, source: "carrier.root_id" }); registered += 1;
            }
            const carrier = parseCarrier(row);
            if (carrier.ok) {
                state.carrierPairs.set(carrier.carrierID, { avID: carrier.avID, carrierID: carrier.carrierID, rootID: carrier.rootID, notebookID: carrier.notebookID });
                state.provenance.push({ seq: request.seq, route: request.route, kind: "carrier-av-pair", avID: carrier.avID, carrierID: carrier.carrierID, source: "carrier.markdown" }); registered += 1;
            }
        }
        state.expectedCursor = checked.nextCursor;
    } else if (request.kind === "render" && record(envelope.data)) {
        const data = envelope.data, columns = data.view?.columns;
        const ownerKey = Array.isArray(columns) ? columns.find((column) => column?.name === "ownerDocId" && column?.type === "text")?.id : undefined;
        if (ownerKey && Array.isArray(data.view?.rows)) for (const row of data.view.rows) for (const cell of row?.cells ?? []) {
            const content = cell?.value?.keyID === ownerKey ? cell.value?.text?.content : undefined;
            if (typeof content === "string" && ID.test(content)) { state.owners.add(content); state.provenance.push({ seq: request.seq, route: request.route, kind: "owner", id: content, source: "ownerDocId.text" }); registered += 1; }
        }
    }
    return { ok: true, registered };
}

function brokerChecks() {
    const checks = [], check = (name, pass) => { assert.ok(pass, name); checks.push({ name, pass: true }); };
    const id = (n) => `20261017000000-${String(n).padStart(7, "0")}`;
    const c = { id: id(10), root_id: id(1), parent_id: id(1), box: id(2), type: "av", markdown: `<div data-type="NodeAttributeView" data-av-id="${id(3)}" data-av-type="table"></div>` };
    const s = createReaderState(); let m = { kind: "request", seq: 1, route: "/api/query/sql", body: { stmt: carrierSQL("", 2) } };
    let v = validateReaderRequest(s, m); check("carrier-template-accepted", v.ok); acceptReaderRequest(s, m, v); check("response-registers-root-and-pair", registerReaderResponse(s, s.pending, { code: 0, msg: "", data: [c, { ...c, id: id(11) }, { ...c, id: id(12) }] }).ok && s.carrierPairs.has(id(10)) && s.carrierPairs.has(id(11)) && s.expectedCursor === id(11));
    const firstRender = { kind: "request", seq: 2, route: "/api/av/renderAttributeView", body: { id: id(3), blockID: id(10), query: "", page: 1, pageSize: 2, createIfNotExist: false } };
    const secondRender = { ...firstRender, seq: 3, body: { ...firstRender.body, blockID: id(11) } };
    const firstRenderValidation = validateReaderRequest(s, firstRender); check("same-av-first-carrier-accepted", firstRenderValidation.ok); acceptReaderRequest(s, firstRender, firstRenderValidation); s.pending = false;
    const secondRenderValidation = validateReaderRequest(s, secondRender); check("same-av-second-carrier-accepted", secondRenderValidation.ok);
    check("cursor-sentinel-never-becomes-cursor", s.expectedCursor !== id(12));
    const bad = createReaderState(); check("arbitrary-sql-rejected", !validateReaderRequest(bad, { ...m, body: { stmt: "SELECT * FROM blocks" } }).ok);
    check("render-before-pair-rejected", !validateReaderRequest(bad, { kind: "request", seq: 1, route: "/api/av/renderAttributeView", body: { id: id(3), blockID: id(10), query: "", page: 1, pageSize: 2, createIfNotExist: false } }).ok);
    check("nonreader-route-rejected", !validateReaderRequest(bad, { kind: "request", seq: 1, route: "/api/block/insertBlock", body: {} }).ok);
    check("sequence-gap-rejected", !validateReaderRequest(s, { ...m, seq: 3 }).ok);
    const ownerState = createReaderState(); ownerState.owners.add(id(20)); check("owner-document-requires-observed-owner", validateReaderRequest(ownerState, { kind: "request", seq: 1, route: "/api/query/sql", body: { stmt: documentSQL(id(20)) } }).ok);
    const limited = createReaderState({ ...DEFAULT_BUDGET, maxRequests: 1 });
    const lastAllowed = validateReaderRequest(limited, m);
    check("last-budgeted-request-accepted", lastAllowed.ok);
    acceptReaderRequest(limited, m, lastAllowed);
    registerReaderResponse(limited, limited.pending, { code: 0, msg: "", data: [] });
    const afterLimit = validateReaderRequest(limited, { ...m, seq: 2 });
    check("parent-request-budget-exhaustion-refused", !afterLimit.ok && afterLimit.errorClass === "request-budget"
        && limited.requests === 1 && limited.seq === 1 && limited.pending === false);
    const renderBoundary = (page, pageSize = 2) => ({ ...secondRender, body: { ...secondRender.body, page, pageSize } });
    check("small-extra-page-at-upper-bound-accepted", validateReaderRequest(s, renderBoundary(DEFAULT_BUDGET.avMaxPages + 1)).ok);
    check("small-page-beyond-upper-bound-refused", !validateReaderRequest(s, renderBoundary(DEFAULT_BUDGET.avMaxPages + 2)).ok);
    check("large-control-first-page-accepted", validateReaderRequest(s, renderBoundary(1, 500)).ok);
    check("large-control-nonfirst-page-refused", !validateReaderRequest(s, renderBoundary(2, 500)).ok);
    const legal = createReaderState();
    const legalStart = validateReaderRequest(legal, m); acceptReaderRequest(legal, m, legalStart);
    registerReaderResponse(legal, legal.pending, { code: 0, msg: "", data: [c] });
    // The reader may use all eight small pages, then page nine as an empty
    // check, followed by a page-one 500-row control.  The parent bounds must
    // preserve that complete legal request sequence.
    let legalSequenceAccepted = true;
    for (const [page, pageSize] of [...Array.from({ length: DEFAULT_BUDGET.avMaxPages + 1 }, (_, index) => [index + 1, 2]), [1, 500]]) {
        const message = { ...firstRender, seq: legal.seq + 1, body: { ...firstRender.body, page, pageSize } };
        const validation = validateReaderRequest(legal, message);
        if (!validation.ok) { legalSequenceAccepted = false; break; }
        acceptReaderRequest(legal, message, validation);
        registerReaderResponse(legal, legal.pending, { code: 0, msg: "", data: {} });
    }
    check("full-small-pages-empty-check-control-sequence-accepted", legalSequenceAccepted
        && legal.requests === DEFAULT_BUDGET.avMaxPages + 3 && legal.pending === false);
    return { total: checks.length, passed: checks.length, failed: 0, checks };
}

function fixtureMethods(owners) {
    return owners.flatMap((owner, person) => [
        { ownerDocId: owner, sourceKey: "phone-main", type: "phone", label: "手机", value: "+00 111 222", primary: "1", order: "0" },
        { ownerDocId: owner, sourceKey: "phone-extra", type: "phone", label: "备用", value: `+00 333 ${person + 1}44`, primary: "0", order: "1" },
        { ownerDocId: owner, sourceKey: "email-main", type: "email", label: "工作", value: `person-${person + 1}@example.invalid`, primary: "1", order: "0" },
        { ownerDocId: owner, sourceKey: "wechat-main", type: "wechat", label: "微信", value: `wx-${person + 1}\n特殊`, primary: "1", order: "0" },
        { ownerDocId: owner, sourceKey: "url-main", type: "url", label: "主页", value: `https://example.invalid/p/${person + 1}`, primary: "1", order: "0" },
    ].map((method) => ({ methodId: sourceKey(method.ownerDocId, method.sourceKey), ...method })));
}
function assertOwnedPath(workspace, target) {
    const root = fs.realpathSync(workspace), absolute = path.resolve(target);
    assert.equal(absolute.startsWith(root + path.sep), true); assert.equal(fs.existsSync(absolute) && fs.lstatSync(absolute).isSymbolicLink(), false); return absolute;
}
function kernelPath() {
    const candidates = ["D:/RJ/SiYuan/resources/kernel/SiYuan-Kernel.exe", "D:/biji/SiYuan/resources/kernel/SiYuan-Kernel.exe", path.join(process.env.ProgramFiles || "C:/Program Files", "SiYuan/resources/kernel/SiYuan-Kernel.exe")];
    const found = candidates.find((item) => fs.existsSync(item)); return found ? fs.realpathSync(found) : null;
}

async function makePort() {
    return await new Promise((resolvePort, rejectPort) => { const server = net.createServer(); server.once("error", rejectPort); server.listen({ host: HOST, port: 0, exclusive: true }, () => { const port = server.address().port; server.close((error) => error ? rejectPort(error) : resolvePort(port)); }); });
}
function netstatOwners(port) {
    const exe = path.join(process.env.SystemRoot || "C:/Windows", "System32", "netstat.exe");
    const output = execFileSync(exe, ["-ano", "-p", "tcp"], { encoding: "utf8", windowsHide: true, timeout: 5000, maxBuffer: 2 * 1024 * 1024 });
    return new Set(output.split(/\r?\n/).map((line) => line.trim().split(/\s+/)).filter((parts) => parts.length === 5 && parts[0] === "TCP" && parts[3] === "LISTENING" && Number(parts[1].match(/:(\d+)$/)?.[1]) === port).map((parts) => Number(parts[4])));
}
function methodSemantic(methods) {
    return (methods ?? []).map((method) => Object.fromEntries(FIELDS.map((field) => [field, method[field]])))
        .sort((left, right) => canonical(left).localeCompare(canonical(right)));
}
/** Parent-only oracle audit.  No oracle value is ever sent to a reader. */
function compareReaderToOracle(result, oracles, expectedStatus, expectedCount) {
    const expected = new Map(), readable = new Map(), unknown = new Set();
    for (const oracle of oracles) for (const anchor of oracle?.anchors ?? []) {
        if (anchor.classification !== "unrelated") expected.set(anchor.avID, methodSemantic(anchor.methods));
        if (anchor.classification === "matching") readable.set(anchor.avID, methodSemantic(anchor.methods));
        if (anchor.classification === "partial") unknown.add(anchor.avID);
    }
    const observed = new Map((result.candidates ?? []).map((candidate) => [candidate.avID, methodSemantic(candidate.observedMethods)]));
    assert.equal(result.status, expectedStatus); assert.equal(expected.size, expectedCount); assert.equal(observed.size, readable.size); assert.deepEqual([...observed.keys()].sort(), [...readable.keys()].sort());
    for (const [avID, methods] of readable) assert.deepEqual(observed.get(avID), methods, `oracle semantic mismatch:${avID}`);
    assert.equal([...unknown].some((avID) => observed.has(avID)), false, "partial schema must stay excluded");
    return { expectedAVIDs: [...expected.keys()].sort(), readableAVIDs: [...readable.keys()].sort(), unknownAVIDs: [...unknown].sort(), observedAVIDs: [...observed.keys()].sort(), methodSemanticsMatch: true, candidateCount: observed.size };
}

async function producerMain() {
    const init = await new Promise((resolveInit, rejectInit) => { const timer = setTimeout(() => rejectInit(new Error("timeout")), 5000); process.once("message", (message) => { clearTimeout(timer); resolveInit(message); }); });
    assert.ok(record(init) && init.kind === "init" && init.version === 1 && exact(init, ["canary", "configPath", "kind", "marker", "phase", "seed", "version", "workspace"]));
    let sequence = 0, pending;
    process.on("message", (message) => { if (!pending || message?.kind !== "response" || message.seq !== pending.seq) { pending?.reject(new Error("malformed-response")); return; } const done = pending; pending = undefined; clearTimeout(done.timer); message.errorClass ? done.reject(new Error(allowedError.has(message.errorClass) ? message.errorClass : "malformed-response")) : done.resolve(message.envelope); });
    const request = (route, body) => new Promise((resolveRequest, rejectRequest) => { if (pending) return rejectRequest(new Error("request-budget")); const seq = ++sequence; const timer = setTimeout(() => { pending = undefined; rejectRequest(new Error("timeout")); }, 15000); pending = { seq, resolve: resolveRequest, reject: rejectRequest, timer }; process.send({ kind: "producer-request", seq, route, body }); });
    const dataOf = async (route, body) => { const envelope = await request(route, body); assert.ok(record(envelope) && envelope.code === 0 && Object.hasOwn(envelope, "data")); return envelope.data; };
    const createAV = async (notebook, label, methods, options = {}) => {
        const hostDocID = checkedID(await dataOf("/api/filetree/createDocWithMd", { notebook, path: `/${label}-${randomBytes(3).toString("hex")}`, markdown: `${label}，仅研究。\n` }));
        const avID = nodeID(), inserted = await dataOf("/api/block/insertBlock", { dataType: "dom", parentID: hostDocID, data: `<div data-type="NodeAttributeView" data-av-id="${avID}" data-av-type="table"></div>` });
        const carrierID = checkedID(inserted?.[0]?.doOperations?.[0]?.id ?? inserted?.[0]?.id);
        const initial = await dataOf("/api/av/renderAttributeView", { id: avID, blockID: carrierID, query: "", page: 1, pageSize: 500, createIfNotExist: true });
        const blockColumn = initial?.view?.columns?.find((column) => column.type === "block"); assert.ok(blockColumn?.id);
        const keys = {}; let previousKeyID = "";
        if (options.classification !== "unrelated") for (const field of FIELDS) { if (options.partial && field === "order") continue; const keyID = nodeID(); keys[field] = keyID; await dataOf("/api/av/addAttributeViewKey", { avID, keyID, keyName: field, keyType: "text", keyIcon: "", previousKeyID }); previousKeyID = keyID; }
        if (methods?.length) await dataOf("/api/av/appendAttributeViewDetachedBlocksWithValues", { avID, blocksValues: methods.map((method, index) => [
            { keyID: blockColumn.id, block: { content: `虚构方法显示 ${index + 1}` } },
            ...FIELDS.filter((field) => keys[field]).map((field) => ({ keyID: keys[field], type: "text", text: { content: method[field] } })),
        ]) });
        return { avID, carrierID, hostDocID, keys, methods: methods ? structuredClone(methods) : [], partial: Boolean(options.partial), classification: options.partial ? "partial" : options.classification ?? "matching" };
    };
    try {
        const phase = init.phase, seed = init.seed ?? {};
        let notebook = seed.notebookID, owners = seed.ownerDocIDs, methods = seed.methods;
        if (phase === 1) {
            const notebookName = `A2 fictional ${randomBytes(4).toString("hex")}`;
            await dataOf("/api/notebook/createNotebook", { name: notebookName });
            const listed = await dataOf("/api/notebook/lsNotebooks", {});
            const matching = listed?.notebooks?.filter((entry) => entry?.name === notebookName) ?? [];
            assert.equal(matching.length, 1); notebook = checkedID(matching[0].id);
            owners = []; for (const label of ["A", "B"]) owners.push(checkedID(await dataOf("/api/filetree/createDocWithMd", { notebook, path: `/A2-fiction-person-${label}`, markdown: `虚构人物 ${label}，仅研究。\n` })));
            methods = fixtureMethods(owners);
        }
        assert.ok(typeof notebook === "string" && Array.isArray(owners) && Array.isArray(methods));
        const anchors = [];
        if (phase === 1) {
            anchors.push(await createAV(notebook, "A2-methods-primary", methods));
            anchors.push(await createAV(notebook, "A2-unrelated", [], { classification: "unrelated" }));
        } else if (phase === 2) {
            // The first method AV remains in the workspace.  This producer adds
            // exactly one duplicate AV plus one empty matching-schema AV.
            anchors.push(await createAV(notebook, "A2-methods-copy", methods));
            anchors.push(await createAV(notebook, "A2-empty-match", []));
        } else if (phase === 3) anchors.push(await createAV(notebook, "A2-partial", methods, { partial: true }));
        await dataOf("/api/sqlite/flushTransaction", {});
        const manifest = { version: 1, phase, notebookID: notebook, ownerDocIDs: owners, avIDs: anchors.map((a) => a.avID), carrierIDs: anchors.map((a) => a.carrierID), keyMaps: anchors.map((a) => ({ avID: a.avID, keys: a.keys })), knownMethodIDs: methods.map((m) => m.methodId), creatorOnlyCanary: init.canary };
        const configPath = assertOwnedPath(init.workspace, init.configPath); assert.equal(fs.existsSync(configPath), false); fs.writeFileSync(configPath, `${JSON.stringify(manifest)}\n`, { encoding: "utf8", flag: "wx" });
        const bytes = fs.readFileSync(configPath); process.send({ kind: "producer-result", phase, oracle: { phase, notebookID: notebook, ownerDocIDs: owners, methods, anchors }, manifest, configPath, manifestBytes: bytes.length, manifestSha256: createHash("sha256").update(bytes).digest("hex") }, () => process.disconnect());
    } catch (error) { process.send({ kind: "producer-failure", errorClass: allowedError.has(error?.message) ? error.message : "transport" }, () => process.disconnect()); process.exitCode = 1; }
}

async function runColdReader(requestKernel, options = {}) {
    const state = createReaderState(options.budget ?? DEFAULT_BUDGET), initialProvenanceEmpty = state.provenance.length === 0, resultPromise = new Promise((resolveResult, rejectResult) => {
        const child = spawn(process.execPath, [READER_SCRIPT, "--ipc-reader"], { stdio: ["ignore", "ignore", "ignore", "ipc"], windowsHide: true, env: { SystemRoot: process.env.SystemRoot || "C:/Windows", WINDIR: process.env.WINDIR || process.env.SystemRoot || "C:/Windows" }, execArgv: [] });
        let result, childError, injected = false;
        const workerTimer = setTimeout(() => { childError ??= new Error("timeout"); if (child.exitCode === null) child.kill("SIGKILL"); }, 120000);
        const finish = () => { if (childError) rejectResult(childError); else if (result) resolveResult({ result, state, child }); else rejectResult(new Error("reader-no-result")); };
        child.on("message", async (message) => {
            try {
                if (message?.kind === "request") {
                    const validation = validateReaderRequest(state, message);
                    if (!validation.ok || options.injectRenderReject && validation.kind === "render" && !injected) { injected = true; child.send({ kind: "response", seq: message.seq, errorClass: "broker-rejected" }); return; }
                    const pending = acceptReaderRequest(state, message, validation);
                    let envelope;
                    try { envelope = await requestKernel(message.route, message.body); registerReaderResponse(state, pending, envelope); child.send({ kind: "response", seq: message.seq, envelope }); }
                    catch (error) { state.pending = false; child.send({ kind: "response", seq: message.seq, errorClass: allowedError.has(error?.message) ? error.message : "transport" }); }
                } else if (message?.kind === "result") result = message.result;
            } catch (error) { childError = error; child.kill(); }
        });
        child.on("error", (error) => { childError = error; }); child.on("exit", (code) => { clearTimeout(workerTimer); if (code !== 0 && !result) childError ??= new Error("reader-exit"); finish(); });
        child.send({ kind: "init", version: 1, budget: options.budget ?? DEFAULT_BUDGET });
    });
    const completed = await resultPromise; return { ...completed, initialProvenanceEmpty };
}

async function runLive() {
    assert.equal(process.platform, "win32", "A2 listener attribution requires Windows");
    const kernel = kernelPath(); assert.ok(kernel, "validated SiYuan-Kernel.exe not found");
    const appDir = path.resolve(path.dirname(kernel), ".."); const runUUID = randomUUID(); assert.match(runUUID, UUID);
    const tempRoot = fs.realpathSync(os.tmpdir()), workspace = path.join(tempRoot, `SiYuan-Lvct-Av-Cold-${runUUID}`); assert.equal(fs.existsSync(workspace), false); fs.mkdirSync(workspace, { recursive: false });
    const markerPath = path.join(workspace, MARKER), marker = { createdBy: CREATED_BY, runUUID, workspace, kernel }; fs.writeFileSync(markerPath, `${JSON.stringify(marker)}\n`, { flag: "wx" });
    const port = await makePort(); let child; const evidence = { research: "AG-RF-004-A2", runUUID, workspace, kernel, appDir, port, rawRequests: [], readerAudits: [], stages: [], fixtureMutations: 0, cleanup: { workspaceRetained: true, ownKernelExited: false }, productionChanges: false };
    // The parent broker alone may read the isolated Kernel token.  The token
    // never crosses IPC and is scrubbed from evidence/errors.
    const tokenRef = { value: "" };
    const readOwnedToken = () => {
        const configPath = path.join(workspace, "conf", "conf.json");
        assertOwnedPath(workspace, configPath);
        if (!fs.existsSync(configPath)) return;
        const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
        assert.ok(record(config) && (config.api?.token === undefined || typeof config.api.token === "string"));
        tokenRef.value = config.api?.token ?? "";
    };
    const requestKernel = async (route, body) => {
        assert.ok(ROUTES.has(route)); assert.equal(fs.realpathSync(workspace), workspace); assert.deepEqual(JSON.parse(fs.readFileSync(markerPath, "utf8")), marker); assert.ok(child && child.exitCode === null); assert.deepEqual(netstatOwners(port), new Set([child.pid]));
        const entry = { requestNo: evidence.rawRequests.length + 1, route, body, outcome: "unknown" }; evidence.rawRequests.push(entry); if (MUTATIONS.has(route)) evidence.fixtureMutations += 1;
        const confPath = path.join(workspace, "conf", "conf.json");
        if (!tokenRef.value && fs.existsSync(confPath)) { try { tokenRef.value = JSON.parse(fs.readFileSync(confPath, "utf8")).api?.token ?? ""; } catch { tokenRef.value = ""; } }
        const response = await fetch(`http://${HOST}:${port}${route}`, { method: "POST", redirect: "error", headers: { "Content-Type": "application/json", ...(tokenRef.value ? { Authorization: `Token ${tokenRef.value}` } : {}) }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
        entry.httpStatus = response.status; const rawText = await response.text(); assert.ok(Buffer.byteLength(rawText) <= DEFAULT_BUDGET.maxJsonBytes); let envelope; try { envelope = JSON.parse(rawText); } catch { entry.outcome = "host-parse"; throw new Error("host-parse"); } entry.response = envelope; entry.outcome = "raw-envelope-captured";
        if (!response.ok) throw new Error("host-http"); return envelope;
    };
    const startKernel = async () => { child = spawn(kernel, ["--workspace", workspace, "serve", "--wd", appDir, "--port", String(port)], { stdio: ["ignore", "ignore", "ignore"], windowsHide: true, env: { ...process.env, SIYUAN_WORKSPACE_PATH: workspace } }); const deadline = Date.now() + 60000; while (Date.now() < deadline) { if (child.exitCode !== null) throw new Error("kernel-exit"); readOwnedToken(); const progress = await requestKernel("/api/system/bootProgress", {}).catch(() => null); if (progress?.code === 0 && Number(progress.data?.progress) >= 100) return; await new Promise((resolveWait) => setTimeout(resolveWait, 250)); } throw new Error("kernel-start-timeout"); };
    const stopKernel = async () => { if (!child || child.exitCode !== null) return; await requestKernel("/api/system/exit", { force: true }).catch(() => {}); const owned = child; await new Promise((resolveExit) => { const timer = setTimeout(resolveExit, 5000); owned.once("exit", () => { clearTimeout(timer); resolveExit(); }); }); if (owned.exitCode === null) owned.kill("SIGKILL"); evidence.cleanup.ownKernelExited = true; const deadline = Date.now() + 5000; while (Date.now() < deadline && netstatOwners(port).size) await new Promise((resolveWait) => setTimeout(resolveWait, 100)); evidence.cleanup.portReleased = netstatOwners(port).size === 0; assert.equal(evidence.cleanup.portReleased, true); };
    const onSignal = () => { evidence.interrupted = true; process.exitCode = 130; void stopKernel().catch(() => {}); };
    process.once("SIGINT", onSignal); process.once("SIGTERM", onSignal);
    const researchConfigPaths = [];
    const producer = async (phase, seed, canary) => {
        const configPath = path.join(workspace, `research-config-${phase}.json`); assert.equal(fs.existsSync(configPath), false); const producerChild = spawn(process.execPath, [SCRIPT, "--ipc-producer"], { stdio: ["ignore", "ignore", "ignore", "ipc"], windowsHide: true, env: { SystemRoot: process.env.SystemRoot || "C:/Windows", WINDIR: process.env.WINDIR || process.env.SystemRoot || "C:/Windows" }, execArgv: [] });
        let report, failure; producerChild.on("message", async (message) => { if (message?.kind === "producer-request") { try { const envelope = await requestKernel(message.route, message.body); producerChild.send({ kind: "response", seq: message.seq, envelope }); } catch (error) { producerChild.send({ kind: "response", seq: message.seq, errorClass: allowedError.has(error?.message) ? error.message : "transport" }); } } else if (message?.kind === "producer-result") report = message; else if (message?.kind === "producer-failure") failure = message; }); producerChild.send({ kind: "init", version: 1, phase, workspace, marker: MARKER, configPath, seed: seed ? { notebookID: seed.notebookID, ownerDocIDs: seed.ownerDocIDs, methods: seed.methods } : null, canary });
        const producerTimer = setTimeout(() => { if (producerChild.exitCode === null) producerChild.kill("SIGKILL"); }, 90000);
        await new Promise((resolveExit) => producerChild.once("exit", () => { clearTimeout(producerTimer); resolveExit(); })); assert.equal(failure, undefined, `producer-failure:${failure?.errorClass ?? "missing"}`); assert.ok(report, "producer-report-missing"); assert.equal(producerChild.exitCode, 0, "producer-exit-failed"); const exactPath = assertOwnedPath(workspace, configPath); const stat = fs.lstatSync(exactPath); assert.equal(stat.isFile(), true); const bytes = fs.readFileSync(exactPath); assert.equal(bytes.toString("utf8"), `${JSON.stringify(report.manifest)}\n`); assert.equal(bytes.length, report.manifestBytes); assert.equal(createHash("sha256").update(bytes).digest("hex"), report.manifestSha256); fs.unlinkSync(exactPath); assert.equal(fs.existsSync(exactPath), false); researchConfigPaths.push(exactPath); return report.oracle;
    };
    try {
        await startKernel();
        const readStage = async (name, budget = DEFAULT_BUDGET, options = {}) => { const previousResearchConfigsAbsent = researchConfigPaths.every((configPath) => !fs.existsSync(configPath)); assert.ok(previousResearchConfigsAbsent, "previous producer config must be absent before every reader"); const read = await runColdReader(requestKernel, { budget, ...options }); assert.equal(read.initialProvenanceEmpty, true, "reader must start with empty provenance"); evidence.readerAudits.push({ name, initialIPCOnly: read.initialProvenanceEmpty, initialProvenanceEmpty: read.initialProvenanceEmpty, previousResearchConfigsAbsent, provenance: read.state.provenance, requests: read.state.requests, bytes: read.state.bytes }); evidence.stages.push({ name, status: read.result.status, candidateCount: read.result.candidates.length, candidates: read.result.candidates, issues: read.result.issues, ownershipVerified: read.result.ownershipVerified, historicalMethodScopeVerified: read.result.historicalMethodScopeVerified, writeAllowed: read.result.writeAllowed, rebindAllowed: read.result.rebindAllowed, newLibraryAllowed: read.result.newLibraryAllowed, tombstoneAllowed: read.result.tombstoneAllowed, fullHostCellCrossReadEqualityVerified: read.result.fullHostCellCrossReadEqualityVerified, rawRequestCount: evidence.rawRequests.length }); return read.result; };
        const empty = await readStage("empty"); assert.equal(empty.status, "not_found_in_observed_scope"); const oracle1 = await producer(1, null, `producer-only-${runUUID}`); const one = await readStage("unique"); evidence.stages.at(-1).oracle = compareReaderToOracle(one, [oracle1], "unique_unowned", 1); const low = await readStage("low-budget", { ...DEFAULT_BUDGET, carrierPageSize: 1, carrierMaxPages: 1, maxRequests: 20 }); assert.equal(low.status, "truncated"); const fault = await readStage("injected-broker-rejection", DEFAULT_BUDGET, { injectRenderReject: true }); assert.equal(fault.status, "unknown"); const oracle2 = await producer(2, oracle1, `producer-only-${runUUID}-2`); const many = await readStage("ambiguous"); evidence.stages.at(-1).oracle = compareReaderToOracle(many, [oracle1, oracle2], "ambiguous", 3); const oracle3 = await producer(3, oracle2, `producer-only-${runUUID}-3`); const partial = await readStage("partial-schema"); evidence.stages.at(-1).oracle = compareReaderToOracle(partial, [oracle1, oracle2, oracle3], "unknown", 4);
        await stopKernel(); const evidencePath = path.join(workspace, `av-cold-evidence-${runUUID}.json`); assertOwnedPath(workspace, evidencePath); const serialized = `${JSON.stringify(stable(evidence))}\n`; assert.ok(!tokenRef.value || !serialized.includes(tokenRef.value), "token-leaked-to-evidence"); fs.writeFileSync(evidencePath, serialized, { flag: "wx" }); fs.writeFileSync(OUTPUT, serialized, "utf8"); return evidence;
    } finally { process.removeListener("SIGINT", onSignal); process.removeListener("SIGTERM", onSignal); await stopKernel().catch(() => {}); }
}

export async function main(args = process.argv.slice(2)) {
    assert.ok(args.length === 0 || args.every((arg) => arg === "--dry-run"), "only --dry-run outside owned modes");
    if (args.includes("--dry-run") || process.env.LVCT_RUN_AV_COLD !== "1") { console.log(JSON.stringify({ research: "AG-RF-004-A2", dryRun: true, checks: { reader: readerChecks(), broker: brokerChecks() }, filesystemWrites: 0, kernelRequests: 0, portBinds: 0, childProcesses: 0 }, null, 2)); return; }
    console.log(JSON.stringify(await runLive(), null, 2));
}
if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT) {
    if (process.argv.includes("--ipc-reader")) await readerMain(["--ipc-reader"]);
    else if (process.argv.includes("--ipc-producer")) await producerMain();
    else await main();
}
