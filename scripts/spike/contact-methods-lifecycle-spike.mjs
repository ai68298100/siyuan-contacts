/**
 * AG-RF-004-L1: controlled two-AV lifecycle observations, never production repair.
 * Import/default/--dry-run: zero file writes, HTTP, port binds or child starts.
 * Only LVCT_RUN_CONTACT_LIFECYCLE=1 enables a fresh fictional UUID workspace.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { assertIsolatedPath, assertTestPortAvailable, observeTestKernel, prepareIsolatedWorkspace } from "../e2e/kernel-safety.mjs";
import { FIELDS, inspectRender, aggregateMethods } from "./contact-methods-av-cold-reader.mjs";

const OUTPUT = fileURLToPath(new URL("./contact-methods-lifecycle-results.json", import.meta.url));
const HOST = "127.0.0.1", MARKER = "contact-methods-lifecycle-spike.json";
const CREATED_BY = "lvct two AV lifecycle isolated Kernel probe";
const ID = /^\d{14}-[a-z0-9]{7}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PAGE_SIZE = 2, MAX_PAGES = 8, MAX_REQUESTS = 180, MAX_JSON_BYTES = 2 * 1024 * 1024;
const ROUTES = new Set([
    "/api/system/bootProgress", "/api/system/version", "/api/system/exit", "/api/notebook/createNotebook", "/api/notebook/lsNotebooks",
    "/api/filetree/createDocWithMd", "/api/block/insertBlock", "/api/av/renderAttributeView", "/api/av/addAttributeViewKey",
    "/api/av/addAttributeViewBlocks", "/api/av/getAttributeViewItemIDsByBoundIDs", "/api/av/setAttributeViewBlockAttr",
    "/api/av/appendAttributeViewDetachedBlocksWithValues", "/api/av/removeAttributeViewBlocks", "/api/sqlite/flushTransaction", "/api/query/sql",
]);
const MUTATIONS = new Set(["/api/notebook/createNotebook", "/api/filetree/createDocWithMd", "/api/block/insertBlock", "/api/av/addAttributeViewKey",
    "/api/av/addAttributeViewBlocks", "/api/av/setAttributeViewBlockAttr", "/api/av/appendAttributeViewDetachedBlocksWithValues", "/api/av/removeAttributeViewBlocks"]);
const record = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const stable = (v) => Array.isArray(v) ? v.map(stable) : record(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, stable(v[k])])) : v;
const json = (v) => JSON.stringify(stable(v));
const sortedMethods = (methods) => methods.toSorted((a, b) => a.itemID.localeCompare(b.itemID));
const semantic = (methods) => json(sortedMethods(methods));
const nodeId = () => `${new Date().toISOString().slice(0, 19).replace(/\D/g, "")}-${randomBytes(4).toString("hex").slice(0, 7)}`;
const checkedId = (id) => { assert.equal(typeof id, "string"); assert.match(id, ID); return id; };
const refuse = (detail) => ({ status: "unknown", detail });
const frozenViewMatches = (checked, frozen) => !frozen || checked.viewID === frozen.viewID && checked.signature === frozen.signature;

export function methodFixtures(owners) {
    return owners.flatMap((ownerDocId, index) => ["phone-main", "phone-extra"].map((sourceKey, n) => ({
        methodId: `method-${createHash("sha256").update(`${ownerDocId}:${sourceKey}`).digest("hex").slice(0, 24)}`,
        ownerDocId, sourceKey, type: "phone", label: n ? "虚构次电话" : "虚构主电话",
        value: n ? `+00 ${index ? "200" : "100"} 222` : "+00 100 111", primary: n ? "0" : "1", order: String(n),
    })));
}

/** All other host cells stay raw. Only native rowID + eight text fields compare. */
export function diagnoseMethods({ pages, extraPage, comparison, carrier, keys, frozenView, knownRows = [] } = {}) {
    const reports = [], fail = (s) => reports.push(refuse(s)), allRows = [];
    if (!record(carrier) || !ID.test(carrier.avID ?? "")) fail("method-carrier");
    if (!record(keys) || Object.keys(keys).sort().join() !== [...FIELDS].sort().join()
        || FIELDS.some((k) => !ID.test(keys[k] ?? "")) || new Set(Object.values(keys)).size !== FIELDS.length) fail("method-key-map");
    if (!Array.isArray(pages) || pages.length < 1 || pages.length > MAX_PAGES) fail("method-page-budget-or-shape");
    const input = Array.isArray(pages) ? pages : [];
    let first, total;
    for (let n = 0; n < input.length; n += 1) {
        const page = input[n], check = inspectRender(page?.data, carrier ?? {} , first);
        if (page?.page !== n + 1 || page?.pageSize !== PAGE_SIZE || !check.ok) { fail("method-page-number-or-render"); continue; }
        first ??= check; total ??= check.rowCount;
        if (!frozenViewMatches(check, frozenView) || check.schema.classification !== "matching" || json(check.schema.keys) !== json(keys)) fail("method-view-schema-or-keys-drift");
        if (check.rows.length > PAGE_SIZE || check.rows.length === 0 && !(total === 0 && input.length === 1)
            || n < input.length - 1 && check.rows.length !== PAGE_SIZE) fail("method-short-empty-or-oversized-page");
        allRows.push(...check.rows);
    }
    if (allRows.length !== total || new Set(allRows.map((r) => r.id)).size !== allRows.length) fail("method-total-or-duplicate-row");
    const extra = inspectRender(extraPage?.data, carrier ?? {}, first), control = inspectRender(comparison?.data, carrier ?? {}, first);
    if (extraPage?.page !== input.length + 1 || extraPage?.pageSize !== PAGE_SIZE || !extra.ok || extra.rows.length !== 0) fail("method-extra-empty-page");
    if (comparison?.page !== 1 || comparison?.pageSize !== 500 || !control.ok || control.rows.length !== total
        || new Set((control.rows ?? []).map((r) => r.id)).size !== (control.rows ?? []).length) fail("method-500-control");
    const aggregate = aggregateMethods(allRows, keys ?? {}), large = aggregateMethods(control.ok ? control.rows : [], keys ?? {});
    if (!aggregate.complete || !large.complete || semantic(aggregate.methods) !== semantic(large.methods)) fail("method-semantic-control-or-fields");
    if (!Array.isArray(knownRows) || knownRows.some((r) => !record(r) || !ID.test(r.itemID ?? ""))
        || new Set((Array.isArray(knownRows) ? knownRows : []).map((r) => r.itemID)).size !== (Array.isArray(knownRows) ? knownRows.length : 0)) fail("known-method-baseline");
    const complete = reports.length === 0, missing = (Array.isArray(knownRows) ? knownRows : []).filter((r) => !allRows.some((row) => row.id === r.itemID));
    return { currentViewObservationComplete: complete, observedRowCount: allRows.length, declaredRowCount: total ?? null,
        diagnosticMethods: complete ? aggregate.methods : [], reports, parserReports: [...aggregate.reports, ...large.reports],
        missingKnownReports: missing.map(({ itemID, methodId, ownerDocId, sourceKey }) => ({ status: "unknown-not-delete", itemID, methodId, ownerDocId, sourceKey,
            detail: complete ? "known-row-not-in-current-view" : "not-observed-in-unknown-view" })),
        sourceSetReadComplete: complete && missing.length === 0, methods: [], writeAllowed: false, tombstoneAllowed: false,
        historicalMethodScopeVerified: false, comparisonPolicy: "native-rowID-and-eight-method-text-fields-only", view: first ? { viewID: first.viewID, signature: first.signature } : null };
}

export function documentReachability(rows, docs, notebook) {
    const valid = Array.isArray(rows) && Array.isArray(docs) && docs.length === 2 && new Set(docs).size === 2 && docs.every((id) => ID.test(id)) && ID.test(notebook ?? "")
        && rows.length === 2 && new Set(rows.map((r) => r?.id)).size === 2;
    const perDocument = (Array.isArray(docs) ? docs : []).map((docId) => ({ docId, reachable: valid && rows.some((r) => record(r)
        && r.id === docId && r.root_id === docId && r.parent_id === "" && r.type === "d" && r.box === notebook) }));
    return { complete: valid && perDocument.every((r) => r.reachable), perDocument,
        boundary: "Current SQL document reachability, not roster membership, ownership or historical method completeness" };
}

export function phoneValue(row, phoneKeyID) {
    if (!record(row) || !Array.isArray(row.cells)) return { verified: false, detail: "phone-row-unknown" };
    const matches = row.cells.filter((cell) => cell?.value?.keyID === phoneKeyID);
    if (matches.length === 0) return { verified: true, value: "", source: "absent-cell-means-empty-only" };
    if (matches.length !== 1 || matches[0].valueType !== "phone" || matches[0].value?.type !== "phone" || matches[0].value.blockID !== row.id
        || !record(matches[0].value.phone) || typeof matches[0].value.phone.content !== "string") return { verified: false, detail: "present-phone-cell-unknown" };
    return { verified: true, value: matches[0].value.phone.content, source: "typed-content" };
}

export function diagnoseRoster({ data, rawMapping, docs, carrier, phoneKeyID, frozenView } = {}) {
    const reports = [], fail = (s) => reports.push(refuse(s)), inspected = inspectRender(data, carrier ?? {});
    const rows = inspected.ok ? inspected.rows : [];
    if (!inspected.ok || !frozenViewMatches(inspected, frozenView) || rows.length !== inspected.rowCount || rows.length > 2) fail("roster-render-scope-or-view");
    if (!Array.isArray(docs) || docs.length !== 2 || docs.some((id) => !ID.test(id)) || new Set(docs).size !== 2) fail("roster-requested-documents");
    const expectedDocs = Array.isArray(docs) ? docs : [], columns = Array.isArray(data?.view?.columns) ? data.view.columns : [];
    const blockColumns = columns.filter((c) => c?.type === "block"), phoneColumns = columns.filter((c) => c?.id === phoneKeyID && c?.type === "phone");
    if (blockColumns.length !== 1 || phoneColumns.length !== 1 || !ID.test(phoneKeyID ?? "")) fail("roster-block-or-phone-column");
    const mapping = record(rawMapping) && Object.hasOwn(rawMapping, "itemIDsByBoundBlockIDs") ? rawMapping.itemIDsByBoundBlockIDs : rawMapping;
    if (!record(mapping)) fail("roster-mapping-envelope");
    for (const [docId, itemID] of Object.entries(record(mapping) ? mapping : {})) {
        if (!expectedDocs.includes(docId) || typeof itemID !== "string" || itemID !== "" && !ID.test(itemID)) fail("roster-mapping-key-or-item");
    }
    const bound = [];
    for (const row of rows) {
        const primary = row.cells.filter((cell) => cell?.valueType === "block");
        if (primary.length !== 1 || primary[0].value?.keyID !== blockColumns[0]?.id || primary[0].value.blockID !== row.id
            || !ID.test(primary[0].value.block?.id ?? "") || !expectedDocs.includes(primary[0].value.block.id)) { fail("roster-native-binding"); continue; }
        const docId = primary[0].value.block.id, itemID = row.id;
        if (!record(mapping) || mapping[docId] !== itemID) fail("roster-official-map-render-disagreement");
        const phone = phoneValue(row, phoneKeyID); if (!phone.verified) fail("roster-phone-typed-content-unknown");
        bound.push({ docId, itemID, phone });
    }
    if (new Set(bound.map((r) => r.docId)).size !== bound.length || new Set(bound.map((r) => r.itemID)).size !== bound.length) fail("roster-duplicate-binding");
    for (const [docId, itemID] of Object.entries(record(mapping) ? mapping : {})) {
        if (itemID === "" ? bound.some((r) => r.docId === docId) : !bound.some((r) => r.docId === docId && r.itemID === itemID)) fail("roster-map-without-matching-binding");
    }
    return { complete: reports.length === 0, reports, bound, mapping: record(mapping) ? mapping : null,
        perDocument: expectedDocs.map((docId) => ({ docId, qualification: reports.length ? "unknown" : bound.some((r) => r.docId === docId) ? "bound" : "not-bound-in-current-observation" })),
        view: inspected.ok ? { viewID: inspected.viewID, signature: inspected.signature } : null, writeAllowed: false };
}

/** A disposable diagnostic only: no projection executor or production claim. */
export function freezeProjectionPlan(state, docId) {
    assert.ok(state.methods.currentViewObservationComplete && state.methods.sourceSetReadComplete && state.documents.complete && state.roster.complete);
    const bound = state.roster.bound.filter((r) => r.docId === docId), primary = state.methods.diagnosticMethods.filter((r) => r.ownerDocId === docId && r.type === "phone" && r.primary === "1");
    assert.ok(bound.length === 1 && primary.length === 1 && bound[0].phone.verified && bound[0].phone.value === primary[0].value, "Freeze requires a verified unique target and matching source baseline");
    return { researchOnly: true, docId, itemID: bound[0].itemID, phoneBaseline: bound[0].phone.value,
        methodBaseline: structuredClone(primary[0]), sourceSignature: semantic(state.methods.diagnosticMethods),
        rosterView: structuredClone(state.roster.view), methodView: structuredClone(state.methods.view) };
}
export function diagnoseFrozenPlan(plan, state, observedUnboundDocIds = []) {
    const reasons = [];
    if (!record(plan) || plan.researchOnly !== true || !ID.test(plan.docId ?? "") || !ID.test(plan.itemID ?? "")
        || typeof plan.phoneBaseline !== "string" || !record(plan.methodBaseline) || typeof plan.sourceSignature !== "string") reasons.push("invalid-frozen-plan");
    if (!state?.methods?.currentViewObservationComplete || !state.methods.sourceSetReadComplete) reasons.push("source-set-unknown");
    if (!state?.documents?.complete || !state.documents.perDocument.some((r) => r.docId === plan?.docId && r.reachable)) reasons.push("owner-unreachable-or-unknown");
    if (!state?.roster?.complete) reasons.push("roster-unknown");
    const bound = state?.roster?.bound?.filter((r) => r.docId === plan?.docId) ?? [];
    if (bound.length !== 1) reasons.push("target-not-unique-current-binding");
    else {
        if (bound[0].itemID !== plan?.itemID) reasons.push("target-item-changed");
        if (!bound[0].phone.verified || bound[0].phone.value !== plan?.phoneBaseline) reasons.push("scalar-baseline-changed-or-unknown");
    }
    if (!Array.isArray(observedUnboundDocIds) || observedUnboundDocIds.some((id) => !ID.test(id))) reasons.push("lifecycle-observation-unknown");
    else if (observedUnboundDocIds.includes(plan?.docId)) reasons.push("observed-unbinding-invalidates-frozen-plan-even-if-itemID-reused");
    if (json(state?.methods?.view) !== json(plan?.methodView) || json(state?.roster?.view) !== json(plan?.rosterView)) reasons.push("frozen-view-or-schema-changed");
    const current = state?.methods?.diagnosticMethods ?? [];
    if (semantic(current) !== plan?.sourceSignature) reasons.push("source-baseline-changed");
    if (!current.some((r) => json(r) === json(plan?.methodBaseline))) reasons.push("frozen-primary-method-not-observed-exactly");
    return { outcome: reasons.length ? "refused" : "eligible-research-diagnostic-only", reasons, researchOnly: true,
        productionGuardImplemented: false, writeAllowed: false, projectionWrites: 0 };
}

function syntheticFixture() {
    const id = (n) => `20261017000000-${String(n).padStart(7, "0")}`, docs = [id(1), id(2)], notebook = id(3), carrier = { avID: id(4) };
    const keys = Object.fromEntries(FIELDS.map((f, n) => [f, id(20 + n)])), blockKey = id(10), phoneKeyID = id(11);
    const columns = [{ id: blockKey, name: "Name", type: "block" }, ...FIELDS.map((name) => ({ id: keys[name], name, type: "text" }))];
    const methods = methodFixtures(docs).map((m, n) => ({ itemID: id(100 + n), ...m }));
    const render = (rows, cols, avID = carrier.avID) => ({ id: avID, viewType: "table", viewID: id(6), isMirror: false, contextFilter: null, contextFilterFields: [],
        view: { id: id(6), columns: cols, rows, rowCount: rows.length, group: null, groupHidden: 0, sorts: [], filters: [] } });
    const nativeRows = methods.map((m) => ({ id: m.itemID, cells: FIELDS.map((field) => ({ valueType: "text", value: { keyID: keys[field], type: "text", blockID: m.itemID, text: { content: m[field] } } })) }));
    const all = render(nativeRows, columns), page = (n, rows, pageSize = 2) => ({ page: n, pageSize, data: { ...structuredClone(all), view: { ...structuredClone(all.view), rows: structuredClone(rows) } } });
    const input = { pages: [page(1, nativeRows.slice(0, 2)), page(2, nativeRows.slice(2))], extraPage: page(3, []), comparison: page(1, nativeRows, 500), carrier, keys, knownRows: methods };
    const mainRows = docs.map((docId, n) => ({ id: id(200 + n), cells: [
        { valueType: "block", value: { keyID: blockKey, type: "block", blockID: id(200 + n), block: { id: docId } } },
        { valueType: "phone", value: { keyID: phoneKeyID, type: "phone", blockID: id(200 + n), phone: { content: methods[n * 2].value } } },
    ] }));
    const rosterInput = { data: render(mainRows, [{ id: blockKey, name: "Name", type: "block" }, { id: phoneKeyID, name: "phone", type: "phone" }]),
        carrier, docs, phoneKeyID, rawMapping: Object.fromEntries(docs.map((docId, n) => [docId, mainRows[n].id])) };
    const docRows = docs.map((docId) => ({ id: docId, root_id: docId, parent_id: "", box: notebook, type: "d" }));
    const state = { methods: diagnoseMethods(input), roster: diagnoseRoster(rosterInput), documents: documentReachability(docRows, docs, notebook) };
    return { id, docs, notebook, input, rosterInput, docRows, state };
}
export function runSyntheticChecks() {
    const checks = [], check = (name, pass) => { checks.push({ name, pass: Boolean(pass) }); assert.ok(pass, name); };
    const f = syntheticFixture(), baseline = f.state, plan = freezeProjectionPlan(baseline, f.docs[0]);
    const mutateMethods = (fn) => { const copy = structuredClone(f.input); fn(copy); return diagnoseMethods(copy); };
    const mutateRoster = (fn) => { const copy = structuredClone(f.rosterInput); fn(copy); return diagnoseRoster(copy); };
    const guard = (state, history = []) => diagnoseFrozenPlan(plan, state, history);
    check("baseline-four-methods-and-two-bindings", baseline.methods.currentViewObservationComplete && baseline.methods.sourceSetReadComplete && baseline.roster.complete && baseline.documents.complete);
    check("baseline-research-guard-reachable-but-never-writable", guard(baseline).outcome === "eligible-research-diagnostic-only" && !guard(baseline).writeAllowed);
    check("same-value-cross-person-retains-distinct-identity", baseline.methods.diagnosticMethods[0].value === baseline.methods.diagnosticMethods[2].value && baseline.methods.diagnosticMethods[0].methodId !== baseline.methods.diagnosticMethods[2].methodId);
    check("bad-official-mapping-refused", !mutateRoster((c) => { c.rawMapping[f.docs[0]] = f.id(999); }).complete);
    check("unrequested-mapping-refused", !mutateRoster((c) => { c.rawMapping[f.id(998)] = f.id(999); }).complete);
    check("duplicate-native-doc-binding-refused", !mutateRoster((c) => { c.data.view.rows[1].cells[0].value.block.id = f.docs[0]; }).complete);
    check("duplicate-native-item-refused", !mutateRoster((c) => { c.data.view.rows[1].id = c.data.view.rows[0].id; }).complete);
    check("missing-phone-column-refused", !mutateRoster((c) => { c.data.view.columns.pop(); }).complete);
    check("malformed-column-container-is-unknown", !mutateRoster((c) => { c.data.view.columns = {}; }).complete);
    check("null-column-is-unknown", !mutateRoster((c) => { c.data.view.columns.push(null); }).complete);
    check("present-malformed-phone-is-unknown", !mutateRoster((c) => { delete c.data.view.rows[0].cells[1].value.phone; }).complete);
    check("absent-phone-cell-empty-only", phoneValue({ id: f.id(700), cells: [] }, f.rosterInput.phoneKeyID).value === "");
    check("typed-phone-is-not-text", !mutateRoster((c) => { c.data.view.rows[0].cells[1].valueType = "text"; }).complete);
    check("missing-method-column-refused", !mutateMethods((c) => { c.pages[0].data.view.columns.pop(); }).currentViewObservationComplete);
    check("bad-method-key-mapping-refused", !mutateMethods((c) => { c.keys.value = c.keys.label; }).currentViewObservationComplete);
    check("missing-method-cell-refused", !mutateMethods((c) => { c.pages[0].data.view.rows[0].cells.pop(); }).currentViewObservationComplete);
    check("duplicate-method-row-page-refused", !mutateMethods((c) => { c.pages[1].data.view.rows[0] = structuredClone(c.pages[0].data.view.rows[0]); }).currentViewObservationComplete);
    check("missing-method-page-refused", !mutateMethods((c) => { c.pages.pop(); }).currentViewObservationComplete);
    check("nonempty-extra-page-refused", !mutateMethods((c) => { c.extraPage.data.view.rows = c.pages[0].data.view.rows; }).currentViewObservationComplete);
    check("500-control-value-mismatch-refused", !mutateMethods((c) => { c.comparison.data.view.rows[0].cells[5].value.text.content = "different"; }).currentViewObservationComplete);
    check("view-filter-refused", !mutateMethods((c) => { c.pages[0].data.view.sorts = [{ column: f.id(20) }]; }).currentViewObservationComplete);
    check("owner-unreachable-independent-of-readable-methods", baseline.methods.currentViewObservationComplete && !documentReachability(f.docRows.slice(1), f.docs, f.notebook).complete);
    const unreachable = structuredClone(baseline); unreachable.documents = documentReachability(f.docRows.slice(1), f.docs, f.notebook);
    check("owner-unreachable-refuses-frozen-plan", guard(unreachable).reasons.includes("owner-unreachable-or-unknown"));
    const missing = mutateMethods((c) => { const removed = c.pages[0].data.view.rows.shift(); const rows = c.comparison.data.view.rows.filter((r) => r.id !== removed.id);
        c.pages = [1, 2].map((page) => ({ page, pageSize: 2, data: { ...structuredClone(c.comparison.data), view: { ...structuredClone(c.comparison.data.view), rowCount: 3, rows: structuredClone(rows.slice((page - 1) * 2, page * 2)) } } }));
        c.extraPage.data.view.rowCount = 3; c.comparison.data.view.rows = rows; c.comparison.data.view.rowCount = 3; });
    check("removed-primary-current-observation-still-readable", missing.currentViewObservationComplete && missing.diagnosticMethods.length === 3);
    check("known-primary-missing-is-unknown-not-delete", !missing.sourceSetReadComplete && missing.missingKnownReports.length === 1 && missing.missingKnownReports[0].status === "unknown-not-delete" && missing.methods.length === 0);
    check("missing-primary-with-unchanged-scalar-refused", guard({ ...baseline, methods: missing }).outcome === "refused");
    const changed = structuredClone(baseline); changed.roster.bound[0].phone.value = "third";
    check("scalar-baseline-mismatch-refused", guard(changed).reasons.includes("scalar-baseline-changed-or-unknown"));
    check("mismatch-cannot-freeze", (() => { try { freezeProjectionPlan(changed, f.docs[0]); return false; } catch { return true; } })());
    const unbound = structuredClone(baseline); unbound.roster.bound.shift();
    check("unbound-target-refused", guard(unbound).reasons.includes("target-not-unique-current-binding"));
    const rebound = structuredClone(baseline); rebound.roster.bound[0].itemID = f.id(800);
    check("changed-rowID-with-intact-source-refused", guard(rebound).reasons.includes("target-item-changed"));
    check("same-rowID-rebind-after-observed-unbind-refused", guard(baseline, [f.docs[0]]).reasons.includes("observed-unbinding-invalidates-frozen-plan-even-if-itemID-reused"));
    check("unrelated-person-unbind-history-does-not-invalidate-this-target", guard(baseline, [f.docs[1]]).outcome === "eligible-research-diagnostic-only");
    const alteredSource = structuredClone(baseline); alteredSource.methods.diagnosticMethods[0].value = "changed";
    check("source-baseline-change-refused", guard(alteredSource).reasons.includes("source-baseline-changed"));
    check("all-outer-capabilities-stay-false", !baseline.methods.writeAllowed && !baseline.methods.tombstoneAllowed && !baseline.methods.historicalMethodScopeVerified && !baseline.roster.writeAllowed);
    return { total: checks.length, passed: checks.length, failed: 0, checks };
}

export function preflightFor(runEnabled) {
    const runId = randomUUID(), tempRoot = fs.realpathSync(os.tmpdir()), workspace = path.join(tempRoot, `SiYuan-Lvct-Lifecycle-${runId}`);
    assert.match(runId, UUID); assert.equal(path.dirname(workspace), tempRoot); assert.equal(fs.existsSync(workspace), false);
    const found = ["D:/biji/SiYuan/resources/kernel/SiYuan-Kernel.exe", "D:/RJ/SiYuan/resources/kernel/SiYuan-Kernel.exe",
        path.join(process.env.ProgramFiles || "C:/Program Files", "SiYuan/resources/kernel/SiYuan-Kernel.exe")].find((candidate) => fs.existsSync(candidate));
    const kernel = found ? fs.realpathSync(found) : null, appDir = kernel ? path.resolve(path.dirname(kernel), "..") : null;
    return { research: "AG-RF-004-L1", mode: runEnabled ? "explicit-isolated-kernel" : "dry-run", gate: "LVCT_RUN_CONTACT_LIFECYCLE=1", runEnabled,
        runId, tempRoot, workspace, kernel, appDir, kernelReady: Boolean(kernel && path.basename(kernel) === "SiYuan-Kernel.exe" && fs.statSync(kernel).isFile()
            && ["stage", "appearance"].every((name) => fs.existsSync(path.join(appDir, name)))), host: HOST, port: null,
        kernelStarted: false, kernelRequests: 0, workspaceWrites: 0, portBinds: 0, childProcesses: 0, listenerProbeProcesses: 0,
        fixtureMutations: 0, fixtureScalarWrites: 0, projectionWrites: 0, automaticResends: 0, identityAllocations: 0,
        requestBudget: MAX_REQUESTS, maxJsonBytes: MAX_JSON_BYTES, fictionalOnly: true, productionChanges: false, browserCalls: 0,
        hostVerified: false, uiVerified: false, multiWindowVerified: false, D1Adopted: false, historicalMethodScopeVerified: false,
        writeAllowed: false, tombstoneAllowed: false, status: "not_run" };
}

async function runHost(preflight) {
    assert.equal(process.platform, "win32", "Windows listener attribution required"); assert.ok(preflight.kernelReady, "Validated Kernel/resources unavailable");
    const { workspace, runId, kernel, appDir } = preflight, tokens = new Set();
    const result = { ...preflight, preflight, generatedAt: new Date().toISOString(), status: "running_isolated", requests: [], observations: [],
        listenerOwnershipChecks: 0, ownKernelPids: [], cleanup: { ownKernelExited: false, portReleased: false, workspaceRetained: true },
        isolationBoundary: "UUID/path/marker/own-child/listener detection guards, not OS-level isolation",
        limits: ["primary is research text, not a host primary-value rule", "Current bounded sequential observations, not atomic or historical method completeness",
            "Missing known rows are unknown-not-delete; zero promotion, clearing, projection, tombstone or identity repair",
            "Frozen-plan refusal is research diagnosis, not an implemented production guard", "No UI/copy/concurrency/rename/deleteDoc/moveDoc/uninstall/same-name-new-doc evidence"] };
    let child, assertRunning, token = "", interrupted = false, stoppingPromise, shutdownPromise, port;
    const markerValue = { createdBy: CREATED_BY, runId, workspace, kernel };
    prepareIsolatedWorkspace(workspace, MARKER, CREATED_BY); fs.writeFileSync(path.join(workspace, MARKER), JSON.stringify(markerValue) + "\n"); result.workspaceWrites = 2;
    function assertOwnedWorkspace() {
        assert.equal(fs.lstatSync(workspace).isSymbolicLink(), false); assert.equal(fs.realpathSync(workspace), workspace); assert.equal(path.dirname(workspace), preflight.tempRoot);
        assertIsolatedPath(workspace, path.join(workspace, MARKER)); assertIsolatedPath(workspace, path.join(workspace, "data"));
        assert.equal(fs.lstatSync(path.join(workspace, MARKER)).isSymbolicLink(), false);
        assert.deepEqual(JSON.parse(fs.readFileSync(path.join(workspace, MARKER), "utf8")), markerValue);
    }
    function redact(error) { let text = String(error?.message ?? error); for (const secret of tokens) text = text.replaceAll(secret, "[REDACTED]"); return text.replace(/(Authorization\s*[:=]\s*|Token\s+)[^\s,;]+/gi, "$1[REDACTED]"); }
    function assertOwnedListener() {
        assertRunning(); result.listenerProbeProcesses += 1;
        const listing = execFileSync(path.join(process.env.SystemRoot || "C:/Windows", "System32", "netstat.exe"), ["-ano", "-p", "tcp"], { encoding: "utf8", windowsHide: true, timeout: 5000, maxBuffer: MAX_JSON_BYTES });
        const owners = new Set(listing.split(/\r?\n/).map((line) => line.trim().split(/\s+/)).filter((c) => c.length === 5 && c[0] === "TCP" && c[3] === "LISTENING" && Number(c[1].match(/:(\d+)$/)?.[1]) === port).map((c) => Number(c[4])));
        assert.ok(owners.size === 1 && owners.has(child.pid), "Listener is not this probe's live child; refusing HTTP"); assertRunning(); result.listenerOwnershipChecks += 1;
        return { port, pid: child.pid, uniqueListenerOwner: true };
    }
    async function request(route, body = {}, timeout = 15000) {
        assert.ok(ROUTES.has(route), "Unreviewed route"); assertOwnedWorkspace(); assert.ok(!interrupted || route === "/api/system/exit", "Interrupted");
        assert.ok(result.kernelRequests < MAX_REQUESTS, "Hard request budget exhausted");
        // Reserve one request for owned shutdown; no mutation or read can consume it.
        if (route !== "/api/system/exit") assert.ok(result.kernelRequests < MAX_REQUESTS - 1, "Work budget exhausted; shutdown request reserved");
        const encoded = JSON.stringify(body); assert.ok(Buffer.byteLength(encoded) <= MAX_JSON_BYTES, "Request-byte budget");
        const ownership = assertOwnedListener(), entry = { requestNo: ++result.kernelRequests, route, body, ownership, dispatched: true, outcome: "unknown" }; result.requests.push(entry);
        if (MUTATIONS.has(route)) result.fixtureMutations += 1;
        if (route === "/api/av/setAttributeViewBlockAttr") result.fixtureScalarWrites += 1;
        try {
            const response = await fetch(`http://${HOST}:${port}${route}`, { method: "POST", redirect: "error", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Token ${token}` } : {}) }, body: encoded, signal: AbortSignal.timeout(timeout) });
            entry.httpStatus = response.status; const chunks = []; let bytes = 0;
            for await (const chunk of response.body) { bytes += chunk.byteLength; assert.ok(bytes <= MAX_JSON_BYTES, "Response-byte budget"); chunks.push(chunk); }
            const responseText = Buffer.concat(chunks).toString("utf8"); entry.responseBytes = bytes;
            try { entry.response = JSON.parse(responseText); } catch { entry.rawResponseText = responseText; throw new Error("Kernel response is not JSON"); }
            if (route !== "/api/system/exit") assertRunning();
            assert.ok(response.ok, `${route}: HTTP ${response.status}`); assert.equal(entry.response.code, 0, `${route}: Kernel code ${entry.response.code}`);
            entry.outcome = "received-code0-not-application-proof"; return entry.response.data;
        } catch (error) { entry.error = redact(error); throw error; }
    }
    async function start() {
        assert.ok(!interrupted); assertOwnedWorkspace(); await assertTestPortAvailable(HOST, port); result.portBinds += 1; token = "";
        child = spawn(kernel, ["--workspace", workspace, "serve", "--wd", appDir, "--port", String(port)], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true, env: { ...process.env, SIYUAN_WORKSPACE_PATH: workspace } });
        assertRunning = observeTestKernel(child);
        result.kernelStarted = true; result.childProcesses += 1; assert.ok(Number.isInteger(child.pid)); result.ownKernelPids.push(child.pid);
        result.cleanup.ownKernelExited = false; result.cleanup.portReleased = false;
        for (const stream of [child.stdout, child.stderr]) stream.on("data", () => {});
        const deadline = Date.now() + 60000;
        while (true) {
            assertRunning(); assert.ok(!interrupted); const confPath = path.join(workspace, "conf", "conf.json"); assertIsolatedPath(workspace, confPath);
            if (fs.existsSync(confPath)) { assert.equal(fs.lstatSync(confPath).isSymbolicLink(), false); token = JSON.parse(fs.readFileSync(confPath, "utf8")).api?.token ?? "";
                assert.equal(typeof token, "string"); if (token) tokens.add(token); }
            const boot = await request("/api/system/bootProgress", {}, 2000).catch(() => undefined);
            if (Number(boot?.progress) >= 100) return;
            if (Date.now() > deadline) throw new Error("Owned Kernel startup timed out");
            await new Promise((resolve) => setTimeout(resolve, 250));
        }
    }
    async function stop() {
        if (stoppingPromise) return stoppingPromise; if (!child) return;
        const ownChild = child;
        stoppingPromise = (async () => {
            if (!Number.isInteger(ownChild.pid)) {
                // A failed spawn owns no process PID: never request/kill by a guessed ID.
                await new Promise((resolve) => { const timer = setTimeout(resolve, 3000);
                    const done = () => { clearTimeout(timer); resolve(); }; ownChild.once("error", done); ownChild.once("close", done); });
                child = undefined; assertRunning = undefined; result.cleanup.ownKernelExited = true; result.cleanup.spawnFailedWithoutPID = true;
                await assertTestPortAvailable(HOST, port); result.portBinds += 1; result.cleanup.portReleased = true;
                return;
            }
            const exited = () => ownChild.exitCode !== null || ownChild.signalCode !== null;
            const awaitExit = () => new Promise((resolve) => { if (exited()) return resolve(); const timer = setTimeout(resolve, 3000); ownChild.once("exit", () => { clearTimeout(timer); resolve(); }); });
            if (!exited()) await request("/api/system/exit", { force: true }, 2000).catch((error) => { result.cleanup.httpExitSkippedOrFailed = redact(error); });
            if (!exited()) await awaitExit(); if (!exited()) { ownChild.kill("SIGKILL"); await awaitExit(); }
            assert.ok(exited(), "Owned child did not exit; unrelated processes will not be stopped"); child = undefined; assertRunning = undefined; result.cleanup.ownKernelExited = true;
            await assertTestPortAvailable(HOST, port); result.portBinds += 1; result.cleanup.portReleased = true;
        })();
        try { await stoppingPromise; } finally { stoppingPromise = undefined; }
    }
    const onSignal = () => { interrupted = true; process.exitCode = 130; shutdownPromise ??= stop().catch((error) => { result.cleanup.error = redact(error); }); };
    const onExit = () => { if (child && child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); };
    process.on("SIGINT", onSignal); process.on("SIGTERM", onSignal); process.on("exit", onExit);
    let anchors, docs, notebook, methodKeys, phoneKeyID, knownRows = [], methodView, rosterView;
    const unboundHistory = [];
    const render = (anchor, page, pageSize, createIfNotExist = false) => request("/api/av/renderAttributeView", { id: anchor.avID, blockID: anchor.dbBlockID, query: "", page, pageSize, createIfNotExist });
    async function createAV(title) {
        const hostDocID = checkedId(await request("/api/filetree/createDocWithMd", { notebook, path: `/${title}`, markdown: "Only fictional L1 AV fixtures.\n" })), avID = nodeId();
        const inserted = await request("/api/block/insertBlock", { dataType: "dom", parentID: hostDocID, data: `<div data-type="NodeAttributeView" data-av-id="${avID}" data-av-type="table"></div>` });
        const anchor = { hostDocID, avID, dbBlockID: checkedId(inserted?.[0]?.doOperations?.[0]?.id) };
        return { anchor, initial: await render(anchor, 1, 500, true) };
    }
    async function snapshot(label) {
        const entry = { label, requestNoBefore: result.kernelRequests, fixtureMutationsBefore: result.fixtureMutations, pages: [] }; result.observations.push(entry);
        await request("/api/sqlite/flushTransaction"); let count = 0;
        for (let page = 1; page <= MAX_PAGES; page += 1) {
            const data = await render(anchors.methods, page, PAGE_SIZE); entry.pages.push({ page, pageSize: PAGE_SIZE, data });
            const checked = inspectRender(data, anchors.methods); if (!checked.ok) break;
            count += checked.rows.length; if (!checked.rows.length || count >= checked.rowCount) break;
        }
        entry.extraPage = { page: entry.pages.length + 1, pageSize: PAGE_SIZE, data: await render(anchors.methods, entry.pages.length + 1, PAGE_SIZE) };
        entry.comparison = { page: 1, pageSize: 500, data: await render(anchors.methods, 1, 500) };
        entry.rosterRender = await render(anchors.roster, 1, 500);
        entry.rawMapping = await request("/api/av/getAttributeViewItemIDsByBoundIDs", { avID: anchors.roster.avID, blockIDs: docs.map(checkedId) });
        entry.personSQL = await request("/api/query/sql", { stmt: `SELECT id, root_id, parent_id, box, type FROM blocks WHERE id IN ('${docs.map(checkedId).join("','")}') ORDER BY id LIMIT 3` });
        entry.diagnosis = { methods: diagnoseMethods({ ...entry, carrier: anchors.methods, keys: methodKeys, frozenView: methodView, knownRows }),
            roster: diagnoseRoster({ data: entry.rosterRender, rawMapping: entry.rawMapping, docs, carrier: anchors.roster, phoneKeyID, frozenView: rosterView }),
            documents: documentReachability(entry.personSQL, docs, notebook) };
        entry.requestNoAfter = result.kernelRequests; entry.fixtureMutationsAfter = result.fixtureMutations;
        assert.equal(entry.fixtureMutationsBefore, entry.fixtureMutationsAfter, "Snapshot must be read-only");
        entry.perPerson = docs.map((docId) => ({ docId, observedMethods: entry.diagnosis.methods.diagnosticMethods.filter((m) => m.ownerDocId === docId),
            observedPrimaryText: entry.diagnosis.methods.diagnosticMethods.filter((m) => m.ownerDocId === docId && m.primary === "1").map((m) => ({ methodId: m.methodId, value: m.value })),
            currentBinding: entry.diagnosis.roster.bound.filter((r) => r.docId === docId), primaryMeaning: "research-text-only-no-host-rule" }));
        return entry;
    }
    function assertSnapshot(entry, expected, expectedBoundDocs, baseline) {
        const state = entry.diagnosis; assert.ok(state.methods.currentViewObservationComplete && state.roster.complete && state.documents.complete, "Independent observations must be complete");
        assert.deepEqual(state.methods.diagnosticMethods.map(({ itemID, ...fields }) => fields).toSorted((a, b) => a.methodId.localeCompare(b.methodId)), expected.toSorted((a, b) => a.methodId.localeCompare(b.methodId)));
        assert.deepEqual(state.roster.bound.map((r) => r.docId).sort(), [...expectedBoundDocs].sort(), "Unique official/render bindings must match the explicit phase");
        if (baseline) {
            const bDoc = docs[1]; assert.deepEqual(state.methods.diagnosticMethods.filter((m) => m.ownerDocId === bDoc), baseline.diagnosis.methods.diagnosticMethods.filter((m) => m.ownerDocId === bDoc), "Person B method facts must remain exact");
            assert.deepEqual(state.roster.bound.find((r) => r.docId === bDoc), baseline.diagnosis.roster.bound.find((r) => r.docId === bDoc), "Person B binding/phone must remain exact");
            const rowByMethod = new Map(baseline.diagnosis.methods.diagnosticMethods.map((m) => [m.methodId, m.itemID]));
            for (const m of state.methods.diagnosticMethods) assert.equal(m.itemID, rowByMethod.get(m.methodId), "Survivor method native rowID must remain exact");
        }
    }
    try {
        result.syntheticChecks = runSyntheticChecks();
        port = await new Promise((resolve, reject) => { const server = net.createServer(); server.once("error", reject); server.listen({ host: HOST, port: 0, exclusive: true }, () => { const assigned = server.address().port; server.close((error) => error ? reject(error) : resolve(assigned)); }); });
        assert.ok(Number.isInteger(port) && port > 0 && port <= 65535); result.port = port; result.portBinds += 1;
        assertOwnedWorkspace(); markerValue.port = port;
        fs.writeFileSync(path.join(workspace, MARKER), JSON.stringify(markerValue) + "\n"); result.workspaceWrites += 1;
        await start(); result.version = await request("/api/system/version");
        const notebookName = `L1 fictional ${runId}`; await request("/api/notebook/createNotebook", { name: notebookName });
        const notebooks = (await request("/api/notebook/lsNotebooks")).notebooks.filter((n) => n.name === notebookName); assert.equal(notebooks.length, 1); notebook = checkedId(notebooks[0].id);
        docs = []; for (const name of ["A", "B"]) docs.push(checkedId(await request("/api/filetree/createDocWithMd", { notebook, path: `/L1-fiction-person-${name}`, markdown: `Fictional person ${name}; lifecycle research only.\n` })));
        result.docs = docs; result.notebook = notebook;
        const roster = await createAV("L1-fiction-roster"), methods = await createAV("L1-fiction-methods"); anchors = { roster: roster.anchor, methods: methods.anchor }; result.anchors = anchors; result.initialViews = { roster: roster.initial, methods: methods.initial };
        phoneKeyID = nodeId(); await request("/api/av/addAttributeViewKey", { avID: anchors.roster.avID, keyID: phoneKeyID, keyName: "fiction-phone", keyType: "phone", keyIcon: "", previousKeyID: "" });
        methodKeys = {}; let previousKeyID = "";
        for (const field of FIELDS) { const keyID = nodeId(); methodKeys[field] = keyID; await request("/api/av/addAttributeViewKey", { avID: anchors.methods.avID, keyID, keyName: field, keyType: "text", keyIcon: "", previousKeyID }); previousKeyID = keyID; }
        result.methodKeys = methodKeys; result.phoneKeyID = phoneKeyID;
        result.emptyMethodSchema = await render(anchors.methods, 1, 500); const empty = inspectRender(result.emptyMethodSchema, anchors.methods);
        assert.ok(empty.ok && empty.schema.classification === "matching" && empty.rows.length === 0 && empty.rowCount === 0 && json(empty.schema.keys) === json(methodKeys)); methodView = { viewID: empty.viewID, signature: empty.signature };
        const blockColumns = result.emptyMethodSchema.view.columns.filter((c) => c.type === "block"); assert.equal(blockColumns.length, 1); const primaryKeyID = checkedId(blockColumns[0].id); result.appendPrimaryKeyID = primaryKeyID;
        await request("/api/av/addAttributeViewBlocks", { avID: anchors.roster.avID, blockID: anchors.roster.dbBlockID, srcs: docs.map((id, n) => ({ id, isDetached: false, content: `L1-fiction-person-${n}` })) });
        const initialRoster = await render(anchors.roster, 1, 500), initialMapping = await request("/api/av/getAttributeViewItemIDsByBoundIDs", { avID: anchors.roster.avID, blockIDs: docs });
        result.beforePhoneAssignment = { initialRoster, initialMapping };
        const binding = diagnoseRoster({ data: initialRoster, rawMapping: initialMapping, docs, carrier: anchors.roster, phoneKeyID }); assert.ok(binding.complete && binding.bound.length === 2); rosterView = binding.view;
        const expected = methodFixtures(docs); result.fixtures = expected;
        for (const docId of docs) { const main = expected.find((m) => m.ownerDocId === docId && m.primary === "1"), target = binding.bound.find((b) => b.docId === docId);
            await request("/api/av/setAttributeViewBlockAttr", { avID: anchors.roster.avID, keyID: phoneKeyID, itemID: target.itemID, value: { phone: { content: main.value } } }); }
        await request("/api/av/appendAttributeViewDetachedBlocksWithValues", { avID: anchors.methods.avID, blocksValues: expected.map((m, n) => [
            { keyID: primaryKeyID, block: { content: `L1 fictional method ${n + 1}` } }, ...FIELDS.map((f) => ({ keyID: methodKeys[f], type: "text", text: { content: m[f] } })),
        ]) });
        const baseline = await snapshot("baseline"); assertSnapshot(baseline, expected, docs); knownRows = structuredClone(baseline.diagnosis.methods.diagnosticMethods); result.knownRows = knownRows;
        for (const docId of docs) assert.equal(baseline.diagnosis.roster.bound.find((r) => r.docId === docId).phone.value, expected.find((m) => m.ownerDocId === docId && m.primary === "1").value);
        const plan = freezeProjectionPlan(baseline.diagnosis, docs[0]); result.frozenPlan = plan; baseline.frozenPlanDiagnosis = diagnoseFrozenPlan(plan, baseline.diagnosis); assert.equal(baseline.frozenPlanDiagnosis.outcome, "eligible-research-diagnostic-only");
        const target = knownRows.find((m) => m.ownerDocId === docs[0] && m.primary === "1"), remaining = expected.filter((m) => m.methodId !== target.methodId);
        await request("/api/av/removeAttributeViewBlocks", { avID: anchors.methods.avID, srcIDs: [checkedId(target.itemID)] });
        const removed = await snapshot("A-known-primary-method-row-removed"); assertSnapshot(removed, remaining, docs, baseline);
        assert.ok(!removed.diagnosis.methods.sourceSetReadComplete && removed.diagnosis.methods.missingKnownReports.some((r) => r.itemID === target.itemID && r.status === "unknown-not-delete"));
        removed.frozenPlanDiagnosis = diagnoseFrozenPlan(plan, removed.diagnosis); assert.equal(removed.frozenPlanDiagnosis.outcome, "refused");
        removed.actualAPhoneComparedWithBaseline = { actual: removed.diagnosis.roster.bound.find((r) => r.docId === docs[0]).phone,
            baseline: plan.phoneBaseline, equal: removed.diagnosis.roster.bound.find((r) => r.docId === docs[0]).phone.value === plan.phoneBaseline, implication: "observation-only-no-projection-permission" };
        await request("/api/av/removeAttributeViewBlocks", { avID: anchors.roster.avID, srcIDs: [checkedId(plan.itemID)] });
        const unbound = await snapshot("A-unbound-from-main-roster"); assertSnapshot(unbound, remaining, [docs[1]], baseline); unboundHistory.push(docs[0]);
        unbound.frozenPlanDiagnosis = diagnoseFrozenPlan(plan, unbound.diagnosis, unboundHistory); assert.equal(unbound.frozenPlanDiagnosis.outcome, "refused");
        assert.ok(unbound.frozenPlanDiagnosis.reasons.includes("target-not-unique-current-binding"), "Missing method alone cannot prove the binding guard ran");
        result.bindingDiscontinuityObserved = { docIds: [...unboundHistory], boundary: "Current experiment's volatile observation only, not a durable production invalidation protocol" };
        await request("/api/av/addAttributeViewBlocks", { avID: anchors.roster.avID, blockID: anchors.roster.dbBlockID, srcs: [{ id: docs[0], isDetached: false, content: "L1-fiction-person-A-rebound-same-doc" }] });
        const rebound = await snapshot("A-same-doc-rebound-no-phone-reassignment"); assertSnapshot(rebound, remaining, docs, baseline);
        rebound.frozenPlanDiagnosis = diagnoseFrozenPlan(plan, rebound.diagnosis, unboundHistory); assert.equal(rebound.frozenPlanDiagnosis.outcome, "refused");
        assert.ok(rebound.frozenPlanDiagnosis.reasons.includes("observed-unbinding-invalidates-frozen-plan-even-if-itemID-reused"));
        const newTarget = rebound.diagnosis.roster.bound.find((r) => r.docId === docs[0]);
        result.rebindObservation = { docId: docs[0], oldItemID: plan.itemID, actualItemID: newTarget.itemID, itemIDChanged: plan.itemID !== newTarget.itemID,
            actualPhone: newTarget.phone, originalPhone: plan.phoneBaseline, oldPlanRefused: true, observedUnboundDocIds: [...unboundHistory] };
        await stop(); result.restartBoundaryRequestNo = result.kernelRequests; result.restartFixtureMutationsBefore = result.fixtureMutations; await start();
        const restarted = await snapshot("restart-readonly"); assertSnapshot(restarted, remaining, docs, baseline);
        restarted.frozenPlanDiagnosis = diagnoseFrozenPlan(plan, restarted.diagnosis, unboundHistory); assert.equal(restarted.frozenPlanDiagnosis.outcome, "refused");
        assert.equal(semantic(restarted.diagnosis.methods.diagnosticMethods), semantic(rebound.diagnosis.methods.diagnosticMethods));
        assert.deepEqual(restarted.diagnosis.roster.bound.toSorted((a, b) => a.docId.localeCompare(b.docId)), rebound.diagnosis.roster.bound.toSorted((a, b) => a.docId.localeCompare(b.docId)));
        assert.deepEqual(restarted.diagnosis.methods.missingKnownReports, rebound.diagnosis.methods.missingKnownReports);
        result.restartFixtureMutationsAfter = result.fixtureMutations; assert.equal(result.restartFixtureMutationsAfter, result.restartFixtureMutationsBefore);
        assert.equal(result.requests.filter((r) => r.requestNo > result.restartBoundaryRequestNo && MUTATIONS.has(r.route)).length, 0);
        assert.equal(result.fixtureScalarWrites, 2); assert.equal(result.projectionWrites, 0); assert.ok(!interrupted);
        result.endpointSequenceVerified = true; result.restartReadbackVerified = true; result.status = "done_isolated";
    } catch (error) { result.error = redact(error); result.status = interrupted ? "interrupted_isolated" : "failed_isolated"; process.exitCode = interrupted ? 130 : 1; }
    finally {
        if (shutdownPromise) await shutdownPromise;
        await stop().catch((error) => { result.cleanup.error = redact(error); result.status = "failed_isolated"; process.exitCode = 1; });
        if (!result.kernelStarted) {
            result.cleanup.ownKernelExited = true;
            if (port) await assertTestPortAvailable(HOST, port).then(() => { result.portBinds += 1; result.cleanup.portReleased = true; })
                .catch((error) => { result.cleanup.error = redact(error); result.cleanup.portReleased = false; });
            else result.cleanup.portReleased = true;
        }
        if (interrupted) result.status = "interrupted_isolated";
        else if (result.cleanup.error || !result.cleanup.ownKernelExited || !result.cleanup.portReleased) { result.status = "failed_isolated"; process.exitCode = 1; }
        process.removeListener("SIGINT", onSignal); process.removeListener("SIGTERM", onSignal); if (!child) process.removeListener("exit", onExit);
        result.completedAt = new Date().toISOString(); result.evidencePath = path.join(workspace, `lifecycle-evidence-${runId}.json`);
        result.runOutputPath = path.join(path.dirname(OUTPUT), `contact-methods-lifecycle-results-${runId}.json`);
        result.canonicalOutputUpdated = result.status === "done_isolated";
        const serialized = JSON.stringify(result, null, 2) + "\n";
        for (const secret of tokens) assert.ok(!serialized.includes(secret), "Temporary token in evidence; refusing output");
        assertOwnedWorkspace(); assertIsolatedPath(workspace, result.evidencePath);
        fs.writeFileSync(result.evidencePath, serialized, { encoding: "utf8", flag: "wx" });
        fs.writeFileSync(result.runOutputPath, serialized, { encoding: "utf8", flag: "wx" });
        if (result.canonicalOutputUpdated) { if (fs.existsSync(OUTPUT)) assert.equal(fs.lstatSync(OUTPUT).isSymbolicLink(), false); fs.writeFileSync(OUTPUT, serialized, "utf8"); }
    }
    console.log(JSON.stringify({ status: result.status, runId, kernelRequests: result.kernelRequests, listenerOwnershipChecks: result.listenerOwnershipChecks,
        fixtureMutations: result.fixtureMutations, fixtureScalarWrites: result.fixtureScalarWrites, projectionWrites: result.projectionWrites,
        endpointSequenceVerified: Boolean(result.endpointSequenceVerified), restartReadbackVerified: Boolean(result.restartReadbackVerified), cleanup: result.cleanup,
        error: result.error ?? null, runOutputPath: result.runOutputPath, canonicalOutputUpdated: result.canonicalOutputUpdated }, null, 2));
    return result;
}

export async function main(args = process.argv.slice(2)) {
    assert.ok(args.every((arg) => arg === "--dry-run"), "Only --dry-run supported; no workspace, port or endpoint overrides");
    const runEnabled = process.env.LVCT_RUN_CONTACT_LIFECYCLE === "1" && !args.includes("--dry-run"), preflight = preflightFor(runEnabled);
    if (!runEnabled) { const checks = runSyntheticChecks(); console.log(JSON.stringify({ preflight, checks: { total: checks.total, passed: checks.passed, failed: checks.failed },
        filesystemWrites: 0, kernelRequests: 0, portBinds: 0, childProcesses: 0 }, null, 2)); return; }
    await runHost(preflight);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
