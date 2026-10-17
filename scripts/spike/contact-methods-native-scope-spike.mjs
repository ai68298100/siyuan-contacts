/**
 * AG-RF-004-N3: bounded native candidate discovery counterexamples only.
 * Default/--dry-run: no writes, HTTP, port binding or child processes.
 * LVCT_RUN_NATIVE_SCOPE=1: fictional UUID workspace and owned Kernel only.
 * No production schema, deletion intent, durable manifest, UI or repair.
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

const OUTPUT = fileURLToPath(new URL("./contact-methods-native-scope-results.json", import.meta.url));
const HOST = "127.0.0.1";
const MARKER = "contact-methods-native-scope-spike.json";
const CREATED_BY = "lvct native scope isolated Kernel probe";
const METHOD_MARKER = "custom-lvct-contact-method";
const METHOD_PREFIX = `${METHOD_MARKER}-`;
const BODY_PREFIX = "联系方式：";
const FORMAT = "n2-single-json-v1";
const ID = /^\d{14}-[a-z0-9]{7}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const FULL_BUDGET = 128;
const TRUNCATED_BUDGET = 1;
const ORDINARY_REPLACEMENT = "虚构普通笔记，已失去方法结构。";
const ROUTES = new Set([
    "/api/system/bootProgress", "/api/system/version", "/api/system/exit",
    "/api/notebook/createNotebook", "/api/notebook/lsNotebooks", "/api/filetree/createDocWithMd",
    "/api/block/insertBlock", "/api/attr/setBlockAttrs", "/api/block/updateBlock", "/api/block/deleteBlock",
    "/api/sqlite/flushTransaction", "/api/query/sql", "/api/block/getChildBlocks",
]);
const MUTATION_ROUTES = new Set([
    "/api/notebook/createNotebook", "/api/filetree/createDocWithMd", "/api/block/insertBlock",
    "/api/attr/setBlockAttrs", "/api/block/updateBlock", "/api/block/deleteBlock",
]);
const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const methodKey = (key) => key === METHOD_MARKER || key.startsWith(METHOD_PREFIX);
const html = (value) => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const unhtml = (value) => value.replace(/&(amp|lt|gt|quot|#39);/g, (_, key) => ({ amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'" })[key]);

function ialAttrs(ial) {
    assert.equal(typeof ial, "string", "IAL must be a string");
    assert.ok(ial.startsWith("{: ") && ial.endsWith("}"), "Unexpected IAL envelope");
    const attrs = Object.create(null), body = ial.slice(3, -1).trim();
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

/** Exact N2-HOST transport adapter, not body/identity normalization. */
export function adaptRow(row) {
    try {
        assert.ok(isRecord(row), "SQL row must be a record");
        for (const key of ["id", "root_id", "parent_id", "type", "content", "markdown", "ial"]) {
            assert.equal(typeof row[key], "string", `SQL ${key} must be a string`);
        }
        assert.match(row.id, ID);
        assert.match(row.root_id, ID);
        assert.ok(row.type.length > 0, "SQL block type must not be empty");
        if (row.id === row.root_id) {
            assert.equal(row.type, "d", "Root row must be a document");
            assert.equal(row.parent_id, "", "Document root parent must be empty");
        } else {
            assert.match(row.parent_id, ID, "Non-root parent must be a valid block ID");
            assert.notEqual(row.type, "d", "A non-root row cannot be another document");
        }
        const attrs = ialAttrs(row.ial), suffix = `\n${row.ial}`;
        if (Object.hasOwn(attrs, "id")) assert.equal(attrs.id, row.id, "IAL ID must match SQL row ID");
        const removedExactTerminalIal = row.markdown.endsWith(suffix);
        const block = {
            id: row.id, type: row.type, parentId: row.parent_id, content: row.content,
            markdown: removedExactTerminalIal ? row.markdown.slice(0, -suffix.length) : row.markdown, attrs,
        };
        return { ok: true, block, removedExactTerminalIal,
            adapter: "IAL-attributes-single-entity-decode; body-identity-or-exact-terminal-IAL-removal-only" };
    } catch (error) {
        return { ok: false, detail: String(error?.message ?? error), block: null };
    }
}

/**
 * These are diagnostic selectors. No selection is an authoritative historical
 * method scope, and no wrapper exposes a writable method collection.
 * A missing remembered ID withdraws the synthetic N2 enumeration premise;
 * it does not claim that the Kernel omitted rows or that a user deleted a method.
 */
export function diagnoseScope({ docId, rows, children, budget, knownBaselineIds = [] }) {
    const inputReports = [];
    const validBudget = Number.isInteger(budget) && budget >= 1 && budget <= FULL_BUDGET;
    const rowArray = Array.isArray(rows) ? rows : [];
    const childArray = Array.isArray(children) ? children : [];
    const known = Array.isArray(knownBaselineIds) ? knownBaselineIds : [];
    if (typeof docId !== "string" || !ID.test(docId)) inputReports.push({ status: "unknown", detail: "document-id" });
    if (!validBudget || !Array.isArray(rows) || !Array.isArray(children)) inputReports.push({ status: "unknown", detail: "observation-shape-or-budget" });
    if (!Array.isArray(knownBaselineIds) || known.some((id) => typeof id !== "string" || !ID.test(id)) || new Set(known).size !== known.length) {
        inputReports.push({ status: "unknown", detail: "known-baseline-id-shape" });
    }
    const truncated = !validBudget || rowArray.length > budget;
    if (validBudget && rowArray.length > budget + 1) inputReports.push({ status: "unknown", detail: "SQL-limit-exceeded" });
    const adapted = rowArray.map((raw) => ({ raw, adaptation: adaptRow(raw) }));
    const rowIDs = rowArray.map((row) => row?.id);
    if (new Set(rowIDs).size !== rowIDs.length) inputReports.push({ status: "unknown", detail: "duplicate-SQL-id" });
    if (adapted.some(({ raw, adaptation }) => !adaptation.ok || raw.root_id !== docId)) {
        inputReports.push({ status: "unknown", detail: "row-shape-root-or-IAL" });
    }
    const documentRows = rowArray.filter((row) => row?.id === docId && row.type === "d");
    if (!truncated && documentRows.length !== 1) inputReports.push({ status: "unknown", detail: "document-root-not-observed" });
    if (childArray.some((child) => !isRecord(child) || typeof child.id !== "string" || !ID.test(child.id)
        || child.id === docId || typeof child.type !== "string" || child.type.length === 0 || child.type === "d")
        || new Set(childArray.map((child) => child?.id)).size !== childArray.length) {
        inputReports.push({ status: "unknown", detail: "child-shape-or-duplicate" });
    }
    if (childArray.some((child) => {
        const row = rowArray.find((item) => item?.id === child?.id);
        return row ? row.parent_id !== docId || row.type !== child.type : !truncated;
    })) inputReports.push({ status: "unknown", detail: "child-not-consistent-with-direct-SQL-child" });
    if (!truncated && rowArray.some((row) => row?.id !== docId && row?.parent_id === docId && !childArray.some((child) => child?.id === row.id))) {
        inputReports.push({ status: "unknown", detail: "SQL-direct-child-not-in-child-observation" });
    }
    const fullDocumentObservationComplete = !truncated && inputReports.length === 0;
    const knownSet = new Set(known.filter((id) => typeof id === "string" && ID.test(id)));
    const missingKnownIds = [...knownSet].filter((id) => !rowIDs.includes(id));
    const candidates = adapted.filter(({ raw }) => raw?.id !== docId).map(({ raw, adaptation }) => {
        const attrs = adaptation.ok ? adaptation.block.attrs : {};
        return {
            raw, adaptation,
            hasMainMarker: attrs[METHOD_MARKER] === "1",
            hasAnyMethodAttribute: Object.keys(attrs).some(methodKey) || (typeof raw?.ial === "string" && raw.ial.includes(METHOD_MARKER)),
            hasBodyPrefix: typeof raw?.content === "string" && raw.content.startsWith(BODY_PREFIX),
            knownBaselineId: knownSet.has(raw?.id),
        };
    });
    function select(label, predicate, usesRememberedIds, unsafeControlOnly = false) {
        const selected = candidates.filter(predicate);
        const missing = usesRememberedIds ? missingKnownIds : [];
        const enumerationPremiseForN2 = fullDocumentObservationComplete && missing.length === 0;
        const unchangedN2Read = readDocument({ docId, enumerationComplete: enumerationPremiseForN2,
            blocks: selected.map(({ adaptation }) => adaptation.ok ? adaptation.block : null) });
        return {
            selector: label, diagnosticOnly: true, unsafeControlOnly, authoritativeScope: false,
            selectedBlockIds: selected.map(({ raw }) => raw?.id ?? null),
            selectedCandidateReadComplete: unchangedN2Read.complete,
            enumerationPremiseForN2,
            premiseBoundary: "Current controlled row observation only; missing known IDs withdraw the synthetic N2 premise, not Kernel enumeration completeness",
            missingKnownReports: missing.map((blockId) => ({ status: "unknown-not-delete", detail: truncated ? "not-observed-in-truncated-scope" : "known-id-not-observed", blockId })),
            perCandidateStrictParse: selected.map(({ raw, adaptation }) => ({ blockId: raw?.id ?? null,
                parsed: parseBlock(adaptation.ok ? adaptation.block : null) })),
            unchangedN2Read, historicalMethodScopeVerified: false, writeAllowed: false, methods: [],
        };
    }
    const coldSuspicious = select("any-method-attribute OR content-prefix", (item) => item.hasAnyMethodAttribute || item.hasBodyPrefix, false);
    const rememberedSuspicious = select("any-method-attribute OR content-prefix OR current-experiment-known-ID", (item) => item.hasAnyMethodAttribute || item.hasBodyPrefix || item.knownBaselineId, true);
    return {
        docId, budget, sqlLimit: validBudget ? budget + 1 : null, returnedRowCount: rowArray.length, truncated,
        fullDocumentObservationComplete, documentEnumerationBoundary: "Bounded SQL plus child-response consistency in this controlled sequential fixture; not an atomic scan or historical method-set proof",
        inputReports, knownBaselineIds: [...knownSet], knownIdsBoundary: "Current experiment memory only; no durable manifest, restart reconstruction or uninstall guarantee",
        missingKnownIds, markerOnlyControl: select("main-marker-equals-1", (item) => item.hasMainMarker, false, true),
        coldSuspicious, rememberedSuspicious,
        featurelessKnownBlockIds: candidates.filter((item) => item.knownBaselineId && !item.hasAnyMethodAttribute && !item.hasBodyPrefix).map(({ raw }) => raw.id),
        coldReadObservability: "After all method attributes and visible prefix are erased, a cold read cannot distinguish this block from ordinary notes; no identity or value is guessed",
        selectedCandidateReadComplete: rememberedSuspicious.selectedCandidateReadComplete,
        historicalMethodScopeVerified: false, writeAllowed: false, methods: [], tombstones: [], repairedWrites: [], identityAllocations: 0,
    };
}

function serializeIal(attrs) {
    return `{: ${Object.entries(attrs).map(([key, value]) => `${key}="${html(value)}"`).join(" ")}}`;
}
function syntheticRow(block, docId) {
    return { id: block.id, root_id: docId, parent_id: block.parentId, type: block.type,
        content: block.content, markdown: block.markdown, ial: serializeIal(block.attrs) };
}
/** Pure counterexamples; running these never creates results or host state. */
export function runSyntheticChecks() {
    const checks = [], check = (name, pass) => { checks.push({ name, pass: Boolean(pass) }); assert.ok(pass, name); };
    const docId = "20261017000000-0000001", otherDoc = "20261017000000-0000002";
    const phone = encode(fixtureMethod(docId, "scope-phone", { blockId: "20261017000000-0000101" }));
    const email = encode(fixtureMethod(docId, "scope-email", { blockId: "20261017000000-0000102", type: "email", order: 1, value: "fiction@example.test" }));
    const root = (id) => ({ id, root_id: id, parent_id: "", type: "d", content: "虚构文档", markdown: "虚构文档", ial: serializeIal({ id }) });
    const note = { id: "20261017000000-0000103", root_id: docId, parent_id: docId, type: "p", content: "虚构普通正文。", markdown: "虚构普通正文。", ial: serializeIal({ id: "20261017000000-0000103" }) };
    const knownBaselineIds = [phone.id, email.id];
    const observe = (rows, budget = FULL_BUDGET, known = knownBaselineIds, owner = docId) => diagnoseScope({ docId: owner, rows,
        children: rows.filter((row) => row.parent_id === owner).map((row) => ({ id: row.id, type: row.type })), budget, knownBaselineIds: known });
    const baselineRows = [root(docId), syntheticRow(phone, docId), syntheticRow(email, docId), note];
    const before = JSON.stringify(baselineRows), baseline = observe(baselineRows);
    check("valid-two-method-current-scope", baseline.fullDocumentObservationComplete && baseline.selectedCandidateReadComplete && baseline.rememberedSuspicious.unchangedN2Read.methods.length === 2);
    check("outer-result-never-writable", !baseline.writeAllowed && !baseline.markerOnlyControl.writeAllowed && baseline.methods.length === 0 && !baseline.historicalMethodScopeVerified);
    const noMarker = structuredClone(phone); delete noMarker.attrs[METHOD_MARKER];
    const markerLost = observe([root(docId), syntheticRow(noMarker, docId), syntheticRow(email, docId), note]);
    check("marker-only-control-can-hide-marker-loss", markerLost.markerOnlyControl.unsafeControlOnly && markerLost.markerOnlyControl.unchangedN2Read.complete && markerLost.markerOnlyControl.unchangedN2Read.methods.length === 1);
    check("remaining-attrs-diagnose-marker-loss", !markerLost.coldSuspicious.selectedCandidateReadComplete && markerLost.coldSuspicious.unchangedN2Read.methods.length === 0);
    const noAttrs = structuredClone(phone); noAttrs.attrs = {};
    const attrsLost = observe([root(docId), syntheticRow(noAttrs, docId), syntheticRow(email, docId), note]);
    check("body-prefix-diagnoses-all-attribute-loss", !attrsLost.coldSuspicious.selectedCandidateReadComplete && attrsLost.coldSuspicious.selectedBlockIds.includes(phone.id));
    const ordinary = syntheticRow({ ...noAttrs, content: ORDINARY_REPLACEMENT, markdown: ORDINARY_REPLACEMENT }, docId);
    const featureless = observe([root(docId), ordinary, syntheticRow(email, docId), note]);
    check("cold-read-featureless-loss-is-unobservable", featureless.coldSuspicious.selectedCandidateReadComplete && featureless.coldSuspicious.selectedBlockIds.length === 1 && featureless.featurelessKnownBlockIds.includes(phone.id) && !featureless.historicalMethodScopeVerified);
    check("remembered-ID-keeps-featureless-block-unknown", !featureless.rememberedSuspicious.selectedCandidateReadComplete && featureless.rememberedSuspicious.unchangedN2Read.methods.length === 0);
    const deleted = observe([root(docId), syntheticRow(email, docId), note]);
    check("known-ID-missing-not-delete-with-complete-row-observation", deleted.fullDocumentObservationComplete && !deleted.selectedCandidateReadComplete && deleted.rememberedSuspicious.missingKnownReports[0]?.status === "unknown-not-delete" && deleted.tombstones.length === 0);
    const prefixNote = { ...note, id: "20261017000000-0000201", root_id: otherDoc, parent_id: otherDoc,
        content: "联系方式：这是普通正文，用于反例。", markdown: "联系方式：这是普通正文，用于反例。", ial: serializeIal({ id: "20261017000000-0000201" }) };
    const falsePositive = observe([root(otherDoc), prefixNote], FULL_BUDGET, [], otherDoc);
    check("ordinary-prefix-is-visible-unknown-false-positive", falsePositive.fullDocumentObservationComplete && !falsePositive.coldSuspicious.selectedCandidateReadComplete && falsePositive.coldSuspicious.unchangedN2Read.reports[0]?.status === "unknown");
    const truncated = observe(baselineRows.slice(0, 2), 1);
    check("budget-plus-one-withdraws-enumeration-premise", truncated.truncated && !truncated.fullDocumentObservationComplete && !truncated.markerOnlyControl.enumerationPremiseForN2 && !truncated.selectedCandidateReadComplete);
    const divergent = structuredClone(baselineRows); divergent[1].markdown = "被改写的 Markdown";
    check("no-content-markdown-substitution", !observe(divergent).selectedCandidateReadComplete);
    const duplicated = [root(docId), syntheticRow(phone, docId), syntheticRow(phone, docId)];
    check("duplicate-SQL-ID-unknown", !observe(duplicated).fullDocumentObservationComplete && !observe(duplicated).selectedCandidateReadComplete);
    const malformed = structuredClone(baselineRows); malformed[1].ial = '{: id="broken" unexpected}';
    check("bad-IAL-not-repaired", !observe(malformed).fullDocumentObservationComplete && !observe(malformed).selectedCandidateReadComplete);
    const doubleEncoded = structuredClone(baselineRows); doubleEncoded[1].ial = doubleEncoded[1].ial.replace('label="工作 / 主线"', 'label="&amp;quot;"');
    check("entity-decoded-once-only", adaptRow(doubleEncoded[1]).block.attrs[`${METHOD_PREFIX}label`] === "&quot;");
    for (const [name, mutate] of [
        ["missing-child-type", (input) => { delete input.children[0].type; }],
        ["null-child-type", (input) => { input.children[0].type = null; }],
        ["child-type-mismatch", (input) => { input.children[0].type = "h"; }],
        ["document-root-as-child", (input) => { input.children.push({ id: docId, type: "d" }); }],
        ["ordinary-row-bad-parent", (input) => { input.rows.at(-1).parent_id = "garbage"; }],
        ["ordinary-row-empty-type", (input) => { input.rows.at(-1).type = ""; }],
        ["IAL-ID-mismatch", (input) => { input.rows.at(-1).ial = serializeIal({ id: email.id }); }],
    ]) {
        const input = { docId, rows: structuredClone(baselineRows), children: baselineRows.filter((row) => row.parent_id === docId).map((row) => ({ id: row.id, type: row.type })), budget: FULL_BUDGET, knownBaselineIds };
        mutate(input); const result = diagnoseScope(input);
        check(`${name}-withdraws-enumeration`, !result.fullDocumentObservationComplete && !result.selectedCandidateReadComplete && !result.writeAllowed);
    }
    check("input-immutable-and-no-business-effects", JSON.stringify(baselineRows) === before && counters().identityAllocations === 0 && counters().automaticRepairs === 0 && counters().nativeWrites === 0 && counters().kernelRequests === 0);
    return { total: checks.length, passed: checks.length, failed: 0, checks, pureCounters: counters(), kernelRequests: 0,
        filesystemWrites: 0, portBinds: 0, childProcesses: 0, historicalMethodScopeVerified: false, writeAllowed: false };
}

function nodeId() { return `${new Date().toISOString().slice(0, 19).replace(/\D/g, "")}-${randomBytes(4).toString("hex").slice(0, 7)}`; }
function checkedId(value) { assert.equal(typeof value, "string"); assert.match(value, ID); return value; }
function domFor(block) {
    const attrs = Object.entries(block.attrs).map(([key, value]) => `${key}="${html(value)}"`).join(" ");
    return `<div data-node-id="${block.id}" data-type="NodeParagraph" class="p" ${attrs}><div contenteditable="true">${html(block.content)}</div></div>`;
}

function preflightFor(runEnabled) {
    const runId = randomUUID(), tempRoot = fs.realpathSync(os.tmpdir());
    const workspace = path.join(tempRoot, `SiYuan-Lvct-Native-Scope-${runId}`);
    assert.match(runId, UUID);
    assert.equal(path.dirname(workspace), tempRoot);
    assert.equal(fs.existsSync(workspace), false, "Generated UUID workspace must not exist");
    const found = ["D:/biji/SiYuan/resources/kernel/SiYuan-Kernel.exe", "D:/RJ/SiYuan/resources/kernel/SiYuan-Kernel.exe",
        path.join(process.env.ProgramFiles || "C:/Program Files", "SiYuan/resources/kernel/SiYuan-Kernel.exe")].find((candidate) => fs.existsSync(candidate));
    const kernel = found ? fs.realpathSync(found) : null, appDir = kernel ? path.resolve(path.dirname(kernel), "..") : null;
    const kernelReady = Boolean(kernel && path.basename(kernel) === "SiYuan-Kernel.exe" && fs.statSync(kernel).isFile()
        && ["stage", "appearance"].every((name) => fs.existsSync(path.join(appDir, name))));
    return { research: "AG-RF-004-N3", mode: runEnabled ? "explicit-isolated-kernel" : "dry-run", gate: "LVCT_RUN_NATIVE_SCOPE=1",
        runEnabled, runId, workspace, tempRoot, workspaceExists: false, kernel, appDir, kernelReady, host: HOST, port: null,
        kernelStarted: false, kernelRequests: 0, workspaceWrites: 0, portBinds: 0, childProcesses: 0,
        fictionalOnly: true, browserCalls: 0, productionChanges: false, realPluginFileWrites: 0,
        hostVerified: false, uiVerified: false, historicalMethodScopeVerified: false, writeAllowed: false, status: "not_run" };
}

async function runHost(preflight) {
    assert.equal(process.platform, "win32", "Listener attribution is Windows-only");
    assert.ok(preflight.kernelReady, "Validated Kernel executable/resources not found");
    const { runId, workspace, kernel, appDir } = preflight;
    const port = await new Promise((resolvePort, rejectPort) => {
        const server = net.createServer(); server.once("error", rejectPort);
        server.listen({ host: HOST, port: 0, exclusive: true }, () => {
            const assigned = server.address().port;
            server.close((error) => error ? rejectPort(error) : resolvePort(assigned));
        });
    });
    assert.ok(Number.isInteger(port) && port > 0 && port <= 65535);
    await assertTestPortAvailable(HOST, port);
    const result = { ...preflight, preflight, generatedAt: new Date().toISOString(), port, randomPortChecked: true, portBinds: 2,
        status: "running_isolated", isolatedKernelApi: true, endpointSequenceVerified: false, allRequestedCounterexamplesObserved: false, restartReadbackVerified: false,
        requests: [], observations: [], listenerOwnershipChecks: 0, fixtureMutations: 0, automaticResends: 0,
        cleanup: { ownKernelExited: false, portReleased: false, workspaceRetained: true },
        isolationBoundary: "UUID path/marker/owned-child/listener guards detect mistakes; they are not OS-level isolation",
        limits: [
            "Only two fictional documents and direct paragraph fixtures; no nested/move behavior or performance claim",
            "Full document observation means a bounded sequential SQL/child-response check; no atomic enumeration or concurrent consistency is proved",
            "All selectors are diagnostic and historicalMethodScopeVerified/writeAllowed always remain false",
            "The unchanged N2 marker-only control can say complete/writeAllowed for an unsafe subset; this is explicitly unsafeControlOnly",
            "Missing remembered IDs are unknown-not-delete; no tombstone, method identity, projection or repaired write is produced",
            "Known baseline IDs exist only in this experiment's memory; restart readback retains that memory and is not durable discovery recovery",
            "Cold reads cannot identify ordinary text after all method attributes and the visible prefix have been removed",
            "False-positive ordinary prefix text is reported unknown, never adopted as a method",
        ] };
    let child, assertRunning, token = "", interrupted = false, shutdownPromise;
    const markerValue = { createdBy: CREATED_BY, runId, workspace, port, kernel };
    prepareIsolatedWorkspace(workspace, MARKER, CREATED_BY);
    fs.writeFileSync(path.join(workspace, MARKER), JSON.stringify(markerValue) + "\n", "utf8");
    result.workspaceWrites = 2; // Direct marker metadata, not all Kernel-created files.
    function assertOwnedWorkspace() {
        assert.equal(fs.lstatSync(workspace).isSymbolicLink(), false);
        assert.equal(fs.realpathSync(workspace), workspace);
        assert.equal(path.dirname(workspace), preflight.tempRoot);
        assertIsolatedPath(workspace, path.join(workspace, MARKER));
        assertIsolatedPath(workspace, path.join(workspace, "data"));
        assert.deepEqual(JSON.parse(fs.readFileSync(path.join(workspace, MARKER), "utf8")), markerValue);
    }
    function redact(error) {
        const text = String(error?.message ?? error);
        return (token ? text.replaceAll(token, "[REDACTED]") : text).replace(/(Authorization\s*[:=]\s*|Token\s+)[^\s,;]+/gi, "$1[REDACTED]");
    }
    function assertOwnedListener() {
        assertRunning();
        const listing = execFileSync(path.join(process.env.SystemRoot || "C:/Windows", "System32", "netstat.exe"), ["-ano", "-p", "tcp"], {
            encoding: "utf8", windowsHide: true, timeout: 5000, maxBuffer: 2 * 1024 * 1024,
        });
        const owners = new Set(listing.split(/\r?\n/).map((line) => line.trim().split(/\s+/))
            .filter((columns) => columns.length === 5 && columns[0] === "TCP" && columns[3] === "LISTENING"
                && Number(columns[1].match(/:(\d+)$/)?.[1]) === port).map((columns) => Number(columns[4])));
        assert.ok(owners.size === 1 && owners.has(child.pid), "Random-port listener is not this probe's live child; refusing HTTP");
        assertRunning(); result.listenerOwnershipChecks += 1;
    }
    async function request(route, body = {}, timeout = 15000) {
        assert.ok(ROUTES.has(route), "Only the reviewed endpoint set is allowed");
        assertOwnedWorkspace();
        assert.ok(!interrupted || route === "/api/system/exit", "Interrupted; refusing further work");
        assertOwnedListener();
        result.kernelRequests += 1;
        const requestNo = result.kernelRequests;
        if (MUTATION_ROUTES.has(route)) result.fixtureMutations += 1;
        const response = await fetch(`http://${HOST}:${port}${route}`, { method: "POST", redirect: "error",
            headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Token ${token}` } : {}) },
            body: JSON.stringify(body), signal: AbortSignal.timeout(timeout) });
        assertRunning(); assert.equal(response.ok, true, `${route}: HTTP ${response.status}`);
        const payload = await response.json();
        result.requests.push({ requestNo, route, body, response: payload });
        assert.equal(payload.code, 0, `${route}: Kernel code ${payload.code}`);
        return payload.data;
    }
    async function start() {
        assert.equal(interrupted, false, "Interrupted; refusing restart");
        assertOwnedWorkspace(); await assertTestPortAvailable(HOST, port); result.portBinds += 1;
        token = "";
        child = spawn(kernel, ["--workspace", workspace, "serve", "--wd", appDir, "--port", String(port)], {
            stdio: ["ignore", "pipe", "pipe"], windowsHide: true, env: { ...process.env, SIYUAN_WORKSPACE_PATH: workspace },
        });
        result.kernelStarted = true; result.childProcesses += 1;
        result.ownKernelPids = [...(result.ownKernelPids ?? []), child.pid].filter(Number.isInteger);
        result.cleanup.ownKernelExited = false; result.cleanup.portReleased = false;
        assertRunning = observeTestKernel(child);
        for (const stream of [child.stdout, child.stderr]) stream.on("data", () => {}); // Never persist raw logs/tokens.
        const deadline = Date.now() + 60000;
        while (true) {
            assertRunning(); assert.equal(interrupted, false, "Interrupted during startup");
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
        const ownedChild = child, exited = () => ownedChild.exitCode !== null || ownedChild.signalCode !== null;
        if (!exited()) await request("/api/system/exit", { force: true }, 2000).catch((error) => { result.cleanup.httpExitSkippedOrFailed = redact(error); });
        if (!exited()) await new Promise((resolveExit) => {
            const timer = setTimeout(resolveExit, 3000);
            ownedChild.once("exit", () => { clearTimeout(timer); resolveExit(); });
        });
        if (!exited()) {
            ownedChild.kill("SIGKILL"); // Exact ChildProcess only; no names/PID enumeration cleanup.
            await new Promise((resolveExit) => {
                if (exited()) return resolveExit();
                const timer = setTimeout(resolveExit, 3000);
                ownedChild.once("exit", () => { clearTimeout(timer); resolveExit(); });
            });
        }
        assert.ok(exited(), "Owned child did not exit; no unrelated process will be stopped");
        child = undefined; assertRunning = undefined; result.cleanup.ownKernelExited = true;
        await assertTestPortAvailable(HOST, port); result.portBinds += 1; result.cleanup.portReleased = true;
    }
    const onSignal = () => { interrupted = true; process.exitCode = 130;
        shutdownPromise ??= stop().catch((error) => { result.cleanup.error = redact(error); }); };
    const onExit = () => { if (child && child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); };
    process.on("SIGINT", onSignal); process.on("SIGTERM", onSignal); process.on("exit", onExit);
    let docs, phone, email, knownByDoc;
    async function snapshot(docId, budget = FULL_BUDGET) {
        checkedId(docId); assert.ok([FULL_BUDGET, TRUNCATED_BUDGET].includes(budget));
        await request("/api/sqlite/flushTransaction");
        const rows = await request("/api/query/sql", { stmt: `SELECT id, root_id, parent_id, type, content, markdown, ial FROM blocks WHERE root_id='${docId}' ORDER BY id LIMIT ${budget + 1}` });
        const children = await request("/api/block/getChildBlocks", { id: docId });
        return { rows, children, diagnosis: diagnoseScope({ docId, rows, children, budget, knownBaselineIds: knownByDoc?.[docId] ?? [] }) };
    }
    async function phase(label, budget = FULL_BUDGET) {
        const documents = [];
        for (const docId of docs) documents.push({ docId, state: await snapshot(docId, budget) });
        const entry = { phase: label, budget, documents, historicalMethodScopeVerified: false, writeAllowed: false,
            pureCounters: counters(), fixtureMutationsSoFar: result.fixtureMutations };
        result.observations.push(entry); return entry;
    }
    function phoneObservation(entry) {
        const state = entry.documents.find((item) => item.docId === docs[0]).state;
        const row = state.rows.find((item) => item.id === phone.blockId);
        const adapted = row ? adaptRow(row) : null;
        return { blockObserved: Boolean(row), remainingMethodAttributes: adapted?.ok ? Object.fromEntries(Object.entries(adapted.block.attrs).filter(([key]) => methodKey(key))) : null,
            prefixStillObserved: typeof row?.content === "string" && row.content.startsWith(BODY_PREFIX), row: row ?? null };
    }
    function verifyObservedPhone(entry, scenario) {
        const state = entry.documents[0].state, diagnosis = state.diagnosis;
        const actual = phoneObservation(entry);
        assert.ok(actual.blockObserved && diagnosis.fullDocumentObservationComplete, "Phone row must remain observed in the complete bounded fixture");
        const block = adaptRow(actual.row); assert.equal(block.ok, true);
        const strict = parseBlock(block.block), keys = Object.keys(actual.remainingMethodAttributes);
        const observed = scenario === "main-marker-loss" ? actual.remainingMethodAttributes[METHOD_MARKER] !== "1"
            : scenario === "all-method-attributes-absent" ? keys.length === 0
                : keys.length === 0 && actual.row.content === ORDINARY_REPLACEMENT && !actual.prefixStillObserved;
        if (observed) {
            assert.equal(strict.ok, false, "An observed erased-method fixture must remain unknown under the unchanged parser");
            assert.equal(diagnosis.rememberedSuspicious.selectedCandidateReadComplete, false);
            assert.equal(diagnosis.rememberedSuspicious.unchangedN2Read.methods.length, 0);
            if (scenario === "featureless-ordinary-body") {
                assert.ok(diagnosis.coldSuspicious.selectedCandidateReadComplete && !diagnosis.coldSuspicious.selectedBlockIds.includes(phone.blockId));
                assert.ok(diagnosis.featurelessKnownBlockIds.includes(phone.blockId));
            } else assert.equal(diagnosis.coldSuspicious.selectedCandidateReadComplete, false);
        }
        assert.equal(diagnosis.writeAllowed, false);
        return { ...actual, scenario, observed, outcome: observed ? "observed" : "not-reproduced-host-kept-observable-structure",
            strictParse: strict, requestedEmptyAttributesAreNotAssumedToBeDeleted: true };
    }
    try {
        resetCounters(); result.syntheticChecks = runSyntheticChecks();
        await start(); result.version = await request("/api/system/version");
        const notebookName = `N3 fictional ${runId}`;
        await request("/api/notebook/createNotebook", { name: notebookName });
        const notebooks = (await request("/api/notebook/lsNotebooks")).notebooks.filter((item) => item.name === notebookName);
        assert.equal(notebooks.length, 1); const notebook = checkedId(notebooks[0].id);
        docs = [
            checkedId(await request("/api/filetree/createDocWithMd", { notebook, path: "/N3-fiction-A", markdown: "虚构普通笔记 A。\n" })),
            checkedId(await request("/api/filetree/createDocWithMd", { notebook, path: "/N3-fiction-B", markdown: "虚构普通笔记 B。\n\n联系方式：这是普通正文，用于反例。\n" })),
        ];
        phone = fixtureMethod(docs[0], "scope-phone", { blockId: nodeId(), label: "虚构电话", value: "+00 111 222" });
        email = fixtureMethod(docs[0], "scope-email", { blockId: nodeId(), type: "email", label: "虚构邮箱", value: "fiction-scope@example.test", order: 1 });
        result.fixtures = { docs, phone, email, format: FORMAT, ordinaryReplacement: ORDINARY_REPLACEMENT };
        for (const method of [phone, email]) {
            const block = encode(method, FORMAT); assert.equal(parseBlock(block).ok, true);
            await request("/api/block/insertBlock", { dataType: "dom", parentID: method.owner, data: domFor(block) });
        }
        knownByDoc = { [docs[0]]: [phone.blockId, email.blockId], [docs[1]]: [] };
        const baseline = await phase("baseline");
        const baseA = baseline.documents[0].state.diagnosis, baseB = baseline.documents[1].state.diagnosis;
        assert.ok(baseA.fullDocumentObservationComplete && baseA.selectedCandidateReadComplete);
        assert.equal(baseA.rememberedSuspicious.unchangedN2Read.methods.length, 2);
        assert.ok(baseB.fullDocumentObservationComplete && !baseB.coldSuspicious.selectedCandidateReadComplete,
            "Ordinary prefix fixture must be a visible unknown false positive");
        await request("/api/attr/setBlockAttrs", { id: phone.blockId, attrs: { [METHOD_MARKER]: "" } });
        const markerGone = await phase("phone-main-marker-set-empty"); markerGone.actualPhone = verifyObservedPhone(markerGone, "main-marker-loss");
        await request("/api/attr/setBlockAttrs", { id: phone.blockId,
            attrs: Object.fromEntries(Object.keys(encode(phone, FORMAT).attrs).map((key) => [key, ""])) });
        const attrsGone = await phase("phone-all-method-attributes-set-empty"); attrsGone.actualPhone = verifyObservedPhone(attrsGone, "all-method-attributes-absent");
        await request("/api/block/updateBlock", { id: phone.blockId, dataType: "dom",
            data: domFor({ id: phone.blockId, content: ORDINARY_REPLACEMENT, attrs: {} }) });
        const ordinary = await phase("phone-same-ID-ordinary-body-without-method-attributes"); ordinary.actualPhone = verifyObservedPhone(ordinary, "featureless-ordinary-body");
        assert.equal(ordinary.actualPhone.row.content, ORDINARY_REPLACEMENT, "updateBlock must read back the requested ordinary body");
        await request("/api/block/deleteBlock", { id: phone.blockId });
        const deleted = await phase("known-phone-block-deleted"); deleted.actualPhone = phoneObservation(deleted);
        const deletedA = deleted.documents[0].state.diagnosis;
        assert.ok(deletedA.fullDocumentObservationComplete && deletedA.missingKnownIds.includes(phone.blockId));
        assert.equal(deletedA.selectedCandidateReadComplete, false); assert.equal(deletedA.tombstones.length, 0);
        const truncated = await phase("SQL-budget-truncation", TRUNCATED_BUDGET);
        assert.ok(truncated.documents.every(({ state }) => state.diagnosis.truncated && !state.diagnosis.selectedCandidateReadComplete));
        result.endpointSequenceVerified = true;
        result.allRequestedCounterexamplesObserved = [markerGone, attrsGone, ordinary].every((entry) => entry.actualPhone.observed);
        await stop(); await start();
        const restarted = await phase("restart-read-only-full-budget");
        for (let index = 0; index < docs.length; index += 1) {
            assert.deepEqual(restarted.documents[index].state.rows, deleted.documents[index].state.rows, "Read-only restart changed raw SQL rows");
            assert.deepEqual(restarted.documents[index].state.children, deleted.documents[index].state.children, "Read-only restart changed children");
        }
        result.restartReadbackVerified = true; result.pureCounters = counters();
        assert.equal(result.pureCounters.identityAllocations, 0);
        assert.ok(result.observations.every((entry) => !entry.writeAllowed && entry.documents.every(({ state }) => !state.diagnosis.writeAllowed && !state.diagnosis.historicalMethodScopeVerified)));
        assert.equal(interrupted, false, "Interrupted; refusing successful completion");
        result.status = "done_isolated";
    } catch (error) { result.error = redact(error); result.status = "failed_isolated"; process.exitCode = interrupted ? 130 : 1; }
    finally {
        if (shutdownPromise) await shutdownPromise;
        await stop().catch((error) => { result.cleanup.error = redact(error); result.status = "failed_isolated"; process.exitCode = 1; });
        if (interrupted) result.status = "interrupted_isolated";
        else if (result.cleanup.error || !result.cleanup.ownKernelExited || !result.cleanup.portReleased) result.status = "failed_isolated";
        process.removeListener("SIGINT", onSignal); process.removeListener("SIGTERM", onSignal);
        if (!child) process.removeListener("exit", onExit);
        result.completedAt = new Date().toISOString();
        const serialized = JSON.stringify(result, null, 2) + "\n";
        assert.ok(!token || !serialized.includes(token), "Evidence unexpectedly contains private temporary token; refusing output");
        fs.writeFileSync(OUTPUT, serialized, "utf8");
    }
    console.log(JSON.stringify({ status: result.status, endpointSequenceVerified: result.endpointSequenceVerified,
        allRequestedCounterexamplesObserved: result.allRequestedCounterexamplesObserved,
        restartReadbackVerified: result.restartReadbackVerified, kernelRequests: result.kernelRequests, listenerOwnershipChecks: result.listenerOwnershipChecks,
        fixtureMutations: result.fixtureMutations, automaticResends: result.automaticResends, historicalMethodScopeVerified: false, writeAllowed: false,
        hostVerified: false, uiVerified: false, cleanup: result.cleanup, error: result.error ?? null, output: OUTPUT }, null, 2));
}

export async function main(args = process.argv.slice(2)) {
    assert.ok(args.every((arg) => arg === "--dry-run"), "Only --dry-run is supported; no workspace/port overrides");
    const runEnabled = process.env.LVCT_RUN_NATIVE_SCOPE === "1" && !args.includes("--dry-run");
    const preflight = preflightFor(runEnabled);
    if (!runEnabled) console.log(JSON.stringify({ preflight, syntheticChecks: runSyntheticChecks() }, null, 2));
    else await runHost(preflight);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
