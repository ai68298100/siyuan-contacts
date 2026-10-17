/**
 * AG-RF-004-A1: detached native AV method-row capability research only.
 * Default/import/--dry-run: no writes, HTTP, port binding or child starts.
 * LVCT_RUN_AV_ROWS=1 enables this script's fictional UUID Kernel workspace.
 * No production schema, bound-row fallback, relation, identity repair or UI.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import assert from "node:assert/strict";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { assertIsolatedPath, assertTestPortAvailable, observeTestKernel, prepareIsolatedWorkspace } from "../e2e/kernel-safety.mjs";
import { fixtureMethod, counters, resetCounters } from "./contact-methods-native-editor-research.mjs";

const OUTPUT = fileURLToPath(new URL("./contact-methods-av-rows-results.json", import.meta.url));
const HOST = "127.0.0.1", MARKER = "contact-methods-av-rows-spike.json";
const CREATED_BY = "lvct detached AV rows isolated Kernel probe";
const ID = /^\d{14}-[a-z0-9]{7}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const METHOD_ID = /^method-[a-f0-9]{24}$/, SOURCE = /^[a-z][a-z0-9-]{0,63}$/;
const FIELDS = Object.freeze(["methodId", "ownerDocId", "sourceKey", "type", "label", "value", "primary", "order"]);
const TYPES = new Set(["phone", "email", "wechat", "url"]);
const PAGE_SIZE = 2, MAX_PAGES = 8;
const APPEND_VARIANT = "source-backed-primary";
const SOURCE_COMMIT = "2b31367098736be09e27edd3e8044518dd3919e8";
const COMPARISON_POLICY = "empty-host-select-generated-id-v1";
const EMPTY_SELECT_VALUE_KEYS = ["id", "keyID", "blockID", "type", "createdAt", "updatedAt"].sort();
const ROUTES = new Set([
    "/api/system/bootProgress", "/api/system/version", "/api/system/exit", "/api/notebook/createNotebook", "/api/notebook/lsNotebooks",
    "/api/filetree/createDocWithMd", "/api/block/insertBlock", "/api/av/renderAttributeView", "/api/av/addAttributeViewKey",
    "/api/av/appendAttributeViewDetachedBlocksWithValues", "/api/av/setAttributeViewBlockAttr", "/api/av/removeAttributeViewBlocks",
    "/api/sqlite/flushTransaction", "/api/query/sql",
]);
const MUTATIONS = new Set(["/api/notebook/createNotebook", "/api/filetree/createDocWithMd", "/api/block/insertBlock", "/api/av/addAttributeViewKey",
    "/api/av/appendAttributeViewDetachedBlocksWithValues", "/api/av/setAttributeViewBlockAttr", "/api/av/removeAttributeViewBlocks"]);
const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const stable = (value) => Array.isArray(value) ? value.map(stable) : record(value)
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])])) : value;
const json = (value) => JSON.stringify(stable(value));
const validText = (value, max, allowEmpty = false) => typeof value === "string" && value.length <= max
    && (allowEmpty || value.length > 0) && value.isWellFormed() && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u.test(value);
const columnShape = (column) => record(column) && typeof column.id === "string" && ID.test(column.id)
    && typeof column.name === "string" && typeof column.type === "string" && column.type.length > 0;
const columnSignature = (columns) => Array.isArray(columns) ? json(columns.map((column) => ({ id: column?.id, name: column?.name, type: column?.type }))) : "invalid";
function generatedEmptySelectCell(cell, row) {
    const value = cell?.value;
    return record(cell) && record(value) && Object.keys(value).sort().join(",") === EMPTY_SELECT_VALUE_KEYS.join(",")
        && cell.valueType === "select" && value.type === "select"
        && typeof cell.id === "string" && ID.test(cell.id) && cell.id === value.id
        && typeof value.keyID === "string" && ID.test(value.keyID)
        && typeof row?.id === "string" && ID.test(row.id) && value.blockID === row.id && value.id.slice(0, 14) === row.id.slice(0, 14)
        && Number.isSafeInteger(value.createdAt) && value.createdAt >= 0 && Number.isSafeInteger(value.updatedAt) && value.updatedAt >= 0;
}
function canonicalRows(rows, generatedEmptySelectKeyIDs = [], role = "", normalizedPaths = []) {
    const allowed = new Set(generatedEmptySelectKeyIDs);
    return json(rows.map((row) => ({ id: row.id, cells: row.cells.map((cell) => {
        let value = cell.value;
        if (allowed.has(value.keyID) && generatedEmptySelectCell(cell, row)) {
            value = { ...value, id: "[verified-empty-host-select-generated-id]" };
            normalizedPaths.push({ itemID: row.id, keyID: cell.value.keyID, path: "value.id", role });
        }
        return { valueType: cell.valueType, value };
    }).sort((a, b) => a.value.keyID.localeCompare(b.value.keyID)) })).sort((a, b) => a.id.localeCompare(b.id)));
}

function verifyPersonRows(personRows, expectedPersonDocIds, expectedNotebookId) {
    if (!Array.isArray(expectedPersonDocIds) || expectedPersonDocIds.length !== 2
        || typeof expectedNotebookId !== "string" || !ID.test(expectedNotebookId)
        || expectedPersonDocIds.some((id) => typeof id !== "string" || !ID.test(id)) || new Set(expectedPersonDocIds).size !== 2
        || !Array.isArray(personRows) || personRows.length !== 2 || new Set(personRows.map((row) => row?.id)).size !== 2) return false;
    return personRows.every((row) => record(row) && expectedPersonDocIds.includes(row.id) && row.root_id === row.id && row.type === "d" && row.parent_id === "" && row.box === expectedNotebookId);
}

function inspectView(data, schemaColumns, expectedKeys, generatedEmptySelectKeyIDs = []) {
    const reports = [], fail = (detail) => reports.push({ status: "unknown", detail });
    const view = record(data) && record(data.view) ? data.view : null;
    if (!view || !Array.isArray(view.columns) || !Array.isArray(view.rows) || !Number.isSafeInteger(view.rowCount) || view.rowCount < 0 || view.rowCount > PAGE_SIZE * MAX_PAGES) {
        return { ok: false, reports: [{ status: "unknown", detail: "view-shape-or-rowCount-budget" }], rows: [], rowCount: null };
    }
    if (!view.columns.every(columnShape) || new Set(view.columns.map((column) => column.id)).size !== view.columns.length
        || columnSignature(view.columns) !== columnSignature(schemaColumns)) fail("columns-invalid-or-drifted");
    if (!record(expectedKeys) || FIELDS.some((field) => typeof expectedKeys[field] !== "string" || !ID.test(expectedKeys[field]))
        || new Set(FIELDS.map((field) => expectedKeys[field])).size !== FIELDS.length) fail("expected-text-key-shape");
    for (const field of FIELDS) {
        const found = view.columns.filter((column) => column?.id === expectedKeys?.[field]);
        if (found.length !== 1 || found[0]?.type !== "text" || found[0]?.name !== field) fail(`required-column:${field}`);
    }
    const primary = view.columns.filter((column) => column?.type === "block");
    if (primary.length !== 1) fail("unique-host-block-column");
    for (const row of view.rows) {
        if (!record(row) || typeof row.id !== "string" || !ID.test(row.id) || !Array.isArray(row.cells) || row.cells.length > view.columns.length) { fail("row-shape"); continue; }
        const keys = new Set();
        for (const cell of row.cells) {
            const value = cell?.value, column = view.columns.find((item) => item?.id === value?.keyID);
            if (!record(cell) || !record(value) || typeof cell.valueType !== "string" || !column || value.type !== column.type || cell.valueType !== column.type
                || typeof value.keyID !== "string" || !ID.test(value.keyID)
                || value.blockID !== undefined && (typeof value.blockID !== "string" || !ID.test(value.blockID)) || keys.has(value.keyID)) { fail("typed-cell-shape-or-duplicate-key"); continue; }
            keys.add(value.keyID);
            if (generatedEmptySelectKeyIDs.includes(value.keyID) && !generatedEmptySelectCell(cell, row)) fail("allowlisted-empty-host-select-cell-shape");
            if (value.type === "block" && value.block !== undefined && !record(value.block)) fail("present-host-block-payload-not-record");
            if (["select", "mSelect"].includes(value.type) && value.mSelect !== undefined && (!Array.isArray(value.mSelect)
                || value.mSelect.some((option) => !record(option) || typeof option.content !== "string"
                    || option.color !== undefined && typeof option.color !== "string"))) fail("present-host-select-payload-invalid");
            // Host block/select payloads are preserved, never used to classify
            // detached rows or guessed into block.id/person references.
        }
    }
    return { ok: reports.length === 0, reports, rows: view.rows, rowCount: view.rowCount, columns: view.columns };
}

function parseMethodRow(row, expectedKeys, reachableDocIds) {
    const fail = (detail) => ({ ok: false, status: "unknown", detail, itemID: row?.id ?? null });
    if (!record(row) || !Array.isArray(row.cells)) return fail("method-row-shape");
    const fields = {};
    for (const field of FIELDS) {
        const cells = row.cells.filter((cell) => cell?.value?.keyID === expectedKeys?.[field]);
        if (cells.length !== 1 || cells[0].valueType !== "text" || cells[0].value?.type !== "text"
            || !record(cells[0].value.text) || typeof cells[0].value.text.content !== "string") return fail(`required-text-cell:${field}`);
        fields[field] = cells[0].value.text.content;
    }
    if (!METHOD_ID.test(fields.methodId) || !ID.test(fields.ownerDocId) || !reachableDocIds.includes(fields.ownerDocId)
        || !SOURCE.test(fields.sourceKey) || fields.methodId !== fixtureMethod(fields.ownerDocId, fields.sourceKey).id) return fail("method-identity-or-owner");
    if (!TYPES.has(fields.type) || !validText(fields.label, 256, true) || !validText(fields.value, 8192)
        || !["0", "1"].includes(fields.primary) || !/^(0|[1-9]\d*)$/.test(fields.order) || !Number.isSafeInteger(Number(fields.order))) return fail("method-fields-or-bounds");
    return { ok: true, method: { itemID: row.id, ...fields } };
}

/** Current default-view observation only; never a historical fact-set proof. */
export function diagnoseAvRows(input) {
    const { pages, extraPage, comparison, schemaColumns, expectedKeys, personRows, expectedPersonDocIds, expectedNotebookId,
        knownBaselineRowIds = [], generatedEmptySelectKeyIDs = [] } = record(input) ? input : {};
    const reports = [], fail = (detail) => reports.push({ status: "unknown", detail });
    const pageArray = Array.isArray(pages) ? pages : [];
    if (!Array.isArray(pages) || pages.length < 1 || pages.length > MAX_PAGES) fail("page-count-or-budget");
    if (!Array.isArray(schemaColumns) || !schemaColumns.every(columnShape) || new Set(schemaColumns.map((column) => column.id)).size !== schemaColumns.length) fail("schema-column-shape");
    const allowlistValid = Array.isArray(generatedEmptySelectKeyIDs) && new Set(generatedEmptySelectKeyIDs).size === generatedEmptySelectKeyIDs.length
        && generatedEmptySelectKeyIDs.every((keyID) => typeof keyID === "string" && ID.test(keyID)
            && !FIELDS.some((field) => expectedKeys?.[field] === keyID)
            && Array.isArray(schemaColumns) && schemaColumns.filter((column) => column?.id === keyID && column.type === "select").length === 1);
    if (!allowlistValid) fail("generated-empty-host-select-allowlist-shape");
    const allowedEmptySelectKeys = allowlistValid ? generatedEmptySelectKeyIDs : [];
    const inspected = pageArray.map((page) => inspectView(page?.data, schemaColumns, expectedKeys, allowedEmptySelectKeys));
    const total = inspected[0]?.rowCount ?? null, allRows = [];
    for (let index = 0; index < pageArray.length; index += 1) {
        const page = pageArray[index], checked = inspected[index];
        if (!record(page) || page.page !== index + 1 || page.pageSize !== PAGE_SIZE) fail("missing-duplicate-or-invalid-page-number");
        if (!checked.ok) reports.push(...checked.reports);
        if (checked.rowCount !== total) fail("rowCount-changed-between-pages");
        if (checked.rows.length === 0 && !(total === 0 && pageArray.length === 1) || checked.rows.length > PAGE_SIZE) fail("empty-nonterminal-or-oversized-page");
        if (index < pageArray.length - 1 && checked.rows.length !== PAGE_SIZE) fail("short-page-before-final-page");
        allRows.push(...checked.rows);
    }
    if (allRows.length !== total) fail("declared-total-not-observed-or-page-budget-exhausted");
    if (new Set(allRows.map((row) => row?.id)).size !== allRows.length) fail("duplicate-row-id-across-pages");
    const extra = inspectView(extraPage?.data, schemaColumns, expectedKeys, allowedEmptySelectKeys);
    if (!record(extraPage) || extraPage.page !== pageArray.length + 1 || extraPage.pageSize !== PAGE_SIZE || !extra.ok || extra.rowCount !== total || extra.rows.length !== 0) fail("extra-empty-page-not-verified");
    const contrasted = inspectView(comparison?.data, schemaColumns, expectedKeys, allowedEmptySelectKeys);
    if (!record(comparison) || comparison.page !== 1 || comparison.pageSize !== 500 || !contrasted.ok || contrasted.rowCount !== total
        || contrasted.rows.length !== total || new Set(contrasted.rows.map((row) => row?.id)).size !== contrasted.rows.length) fail("large-page-control-incomplete-or-drifted");
    const normalizedPaths = [];
    if (reports.length === 0 && canonicalRows(allRows, allowedEmptySelectKeys, "paged-observation", normalizedPaths)
        !== canonicalRows(contrasted.rows, allowedEmptySelectKeys, "large-page-control", normalizedPaths)) fail("small-pages-and-large-control-disagree");
    const currentViewObservationComplete = reports.length === 0;
    const personDocumentsVerified = verifyPersonRows(personRows, expectedPersonDocIds, expectedNotebookId);
    const methodReports = [], accepted = [], identities = new Set(), sources = new Set(), primaries = new Set();
    if (!personDocumentsVerified) methodReports.push({ status: "unknown", detail: "person-documents-not-independently-reachable" });
    const reachable = personDocumentsVerified ? expectedPersonDocIds : [];
    for (const row of allRows) {
        const parsed = parseMethodRow(row, expectedKeys, reachable);
        if (!parsed.ok) { methodReports.push(parsed); continue; }
        const method = parsed.method, source = `${method.ownerDocId}:${method.sourceKey}`, primary = `${method.ownerDocId}:${method.type}`;
        if (identities.has(method.methodId) || sources.has(source)) { methodReports.push({ status: "duplicate", detail: "method-id-or-owner-source", itemID: method.itemID }); continue; }
        identities.add(method.methodId); sources.add(source);
        if (method.primary === "1" && primaries.has(primary)) { methodReports.push({ status: "conflict", detail: "multiple-primary-for-owner-and-type", itemID: method.itemID }); continue; }
        if (method.primary === "1") primaries.add(primary);
        accepted.push(method);
    }
    const selectedMethodReadComplete = currentViewObservationComplete && methodReports.length === 0;
    const known = Array.isArray(knownBaselineRowIds) ? knownBaselineRowIds : [];
    const knownShapeVerified = Array.isArray(knownBaselineRowIds) && known.every((id) => typeof id === "string" && ID.test(id)) && new Set(known).size === known.length;
    const missing = known.filter((id) => !allRows.some((row) => row?.id === id));
    return {
        currentViewObservationComplete, selectedMethodReadComplete, personDocumentsVerified,
        comparisonPolicy: COMPARISON_POLICY, generatedEmptySelectKeyIDs: allowedEmptySelectKeys, normalizedPaths,
        generatedEmptySelectPremise: "Allowlist persistence/initial-schema proof belongs to the controlled producer and retained path/hash/key-count evidence; the pure diagnostic does not access disk",
        observedRowCount: allRows.length, declaredRowCount: total, nonemptyPages: inspected.filter((page) => page.rows.length > 0).length,
        observationReports: reports, methodReports, diagnosticAcceptedCount: accepted.length,
        selectedRead: { complete: selectedMethodReadComplete, methods: selectedMethodReadComplete ? accepted : [], writeAllowed: false },
        knownBaselineShapeVerified: knownShapeVerified,
        missingKnownReports: knownShapeVerified ? missing.map((itemID) => ({ status: "unknown-not-delete", detail: currentViewObservationComplete ? "known-item-not-in-current-view" : "not-observed-in-incomplete-view", itemID }))
            : [{ status: "unknown", detail: "known-baseline-shape" }],
        rawHostBlockCells: allRows.map((row) => ({ itemID: row?.id ?? null, cells: Array.isArray(row?.cells) ? row.cells.filter((cell) => cell?.valueType === "block") : [] })),
        scopeBoundary: "Fresh controlled default-view observation with stable columns/count and 500-row control; not atomic, filtered-history, foreign-key or deletion-intent proof",
        knownIdsBoundary: "Current experiment memory only, retained across this process's Kernel restart; no durable history reconstruction",
        historicalMethodScopeVerified: false, writeAllowed: false, methods: [], tombstones: [], repairedWrites: [], identityAllocations: 0,
    };
}

export function methodFixtures(owners) {
    return owners.flatMap((owner, person) => [
        ["phone-main", "phone", "+00 111 222", true], ["phone-extra", "phone", `+00 ${person + 3}00 444`, false],
        ["email-main", "email", `fiction-${person}@example.test`, true],
        ["wechat-main", "wechat", `虚构-${person}\n引号" \\路径 <b>文本</b> & 🙂`, true],
        ["url-main", "url", `https://example.test/fiction-${person}`, true],
    ].map(([sourceKey, type, value, primary], order) => {
        const method = fixtureMethod(owner, sourceKey, { type, value, primary, order, label: `虚构 ${sourceKey}` });
        return { methodId: method.id, ownerDocId: owner, sourceKey, type, label: method.label, value, primary: primary ? "1" : "0", order: String(order) };
    }));
}

export function syntheticFixture() {
    const id = (n) => `20261017000000-${String(n).padStart(7, "0")}`;
    const owners = [id(1), id(2)], methods = methodFixtures(owners), expectedKeys = Object.fromEntries(FIELDS.map((field, index) => [field, id(100 + index)]));
    const schemaColumns = [{ id: id(90), name: "Primary Key", type: "block" }, { id: id(91), name: "Select", type: "select" }, ...FIELDS.map((field) => ({ id: expectedKeys[field], name: field, type: "text" }))];
    const rows = methods.map((method, index) => ({ id: id(200 + index), cells: [
        { valueType: "block", value: { keyID: id(90), type: "block", block: { opaqueHostPayload: true } } },
        { valueType: "select", value: { keyID: id(91), type: "select" } },
        ...FIELDS.map((field) => ({ valueType: "text", value: { keyID: expectedKeys[field], type: "text", text: { content: method[field] } } })),
    ] }));
    const data = (part) => ({ view: { columns: structuredClone(schemaColumns), rowCount: rows.length, rows: structuredClone(part) } });
    const pages = Array.from({ length: 5 }, (_, index) => ({ page: index + 1, pageSize: PAGE_SIZE, data: data(rows.slice(index * PAGE_SIZE, (index + 1) * PAGE_SIZE)) }));
    return { pages, extraPage: { page: 6, pageSize: PAGE_SIZE, data: data([]) }, comparison: { page: 1, pageSize: 500, data: data(rows) },
        schemaColumns, expectedKeys, personRows: owners.map((owner) => ({ id: owner, root_id: owner, parent_id: "", type: "d", box: id(3) })), expectedPersonDocIds: owners, expectedNotebookId: id(3), knownBaselineRowIds: rows.map((row) => row.id) };
}

export function runSyntheticChecks() {
    const checks = [], check = (name, pass) => { assert.ok(pass, name); checks.push({ name, pass: true }); };
    const base = syntheticFixture(), before = json(base), valid = diagnoseAvRows(base);
    check("ten-valid-methods-five-real-pages-and-empty-check", valid.currentViewObservationComplete && valid.selectedMethodReadComplete && valid.nonemptyPages === 5 && valid.selectedRead.methods.length === 10);
    check("host-primary-payload-is-opaque", valid.rawHostBlockCells.every((row) => row.cells[0].value.block.opaqueHostPayload));
    check("same-value-across-people-not-merged", valid.selectedRead.methods.filter((method) => method.value === "+00 111 222").length === 2);
    function mutate(name, change, expected = "semantic") {
        const input = structuredClone(base); change(input); const result = diagnoseAvRows(input);
        check(name, !result.writeAllowed && result.methods.length === 0 && result.tombstones.length === 0
            && (expected === "observation" ? !result.currentViewObservationComplete : !result.selectedMethodReadComplete));
    }
    const allRowCopies = (input, index = 0) => [input.pages[Math.floor(index / 2)].data.view.rows[index % 2], input.comparison.data.view.rows[index]];
    const cell = (input, row, field) => row.cells.find((entry) => entry.value.keyID === input.expectedKeys[field]);
    for (const field of FIELDS) mutate(`missing-required-text-cell:${field}`, (input) => { for (const row of allRowCopies(input)) row.cells = row.cells.filter((entry) => entry.value.keyID !== input.expectedKeys[field]); });
    mutate("present-text-cell-without-typed-payload", (input) => { for (const row of allRowCopies(input)) delete cell(input, row, "value").value.text; });
    mutate("nonstring-typed-content", (input) => { for (const row of allRowCopies(input)) cell(input, row, "value").value.text.content = 42; });
    mutate("empty-method-ID-is-visible-unknown", (input) => { for (const row of allRowCopies(input)) cell(input, row, "methodId").value.text.content = ""; });
    mutate("owner-change-with-old-hash-is-unknown", (input) => { for (const row of allRowCopies(input)) cell(input, row, "ownerDocId").value.text.content = input.expectedPersonDocIds[1]; });
    mutate("unreachable-owner-is-unknown", (input) => { input.personRows.pop(); });
    mutate("person-outside-notebook-is-unknown", (input) => { input.personRows[0].box = "20261017000000-0000004"; });
    mutate("duplicate-valid-hash-and-source-aggregates-to-refusal", (input) => { for (const row of allRowCopies(input, 1)) {
        cell(input, row, "methodId").value.text.content = cell(input, input.pages[0].data.view.rows[0], "methodId").value.text.content;
        cell(input, row, "sourceKey").value.text.content = "phone-main";
    } });
    mutate("same-owner-type-primary-conflict", (input) => { for (const row of allRowCopies(input, 1)) cell(input, row, "primary").value.text.content = "1"; });
    mutate("noncanonical-order-refused", (input) => { for (const row of allRowCopies(input)) cell(input, row, "order").value.text.content = "01"; });
    mutate("duplicate-row-across-pages", (input) => { input.pages[1].data.view.rows[0] = structuredClone(input.pages[0].data.view.rows[0]); }, "observation");
    mutate("missing-page-refused", (input) => { input.pages.splice(1, 1); }, "observation");
    mutate("rowCount-drift-refused", (input) => { input.pages[2].data.view.rowCount = 9; }, "observation");
    mutate("column-type-drift-refused", (input) => { input.pages[2].data.view.columns[2].type = "url"; }, "observation");
    mutate("extra-page-not-empty-refused", (input) => { input.extraPage.data.view.rows.push(structuredClone(input.pages[0].data.view.rows[0])); }, "observation");
    mutate("page-budget-exhaustion-refused", (input) => { input.pages = input.pages.slice(0, 2); input.extraPage.page = 3; }, "observation");
    mutate("large-control-content-mismatch-refused", (input) => { cell(input, input.comparison.data.view.rows[0], "value").value.text.content = "另一值"; }, "observation");
    mutate("bad-generic-cell-type-refused", (input) => { input.pages[0].data.view.rows[0].cells[0].value.type = "text"; }, "observation");
    mutate("combined-bad-keys-and-null-column-returns-unknown", (input) => { input.expectedKeys = null; input.pages[0].data.view.columns = [null]; }, "observation");
    mutate("present-host-block-payload-must-be-record", (input) => { input.pages[0].data.view.rows[0].cells[0].value.block = 42; }, "observation");
    mutate("present-host-select-payload-must-be-array", (input) => { input.pages[0].data.view.rows[0].cells[1].value.mSelect = 42; }, "observation");
    const removed = structuredClone(base), missingID = removed.pages[0].data.view.rows[1].id;
    const remaining = removed.comparison.data.view.rows.filter((row) => row.id !== missingID);
    removed.pages = Array.from({ length: 5 }, (_, index) => ({ page: index + 1, pageSize: 2, data: { view: { columns: structuredClone(removed.schemaColumns), rowCount: 9, rows: remaining.slice(index * 2, (index + 1) * 2) } } }));
    removed.extraPage.data.view.rowCount = 9; removed.comparison.data.view.rows = remaining; removed.comparison.data.view.rowCount = 9;
    const absent = diagnoseAvRows(removed);
    check("current-nine-row-read-complete-but-missing-known-is-not-delete", absent.currentViewObservationComplete && absent.selectedMethodReadComplete && absent.missingKnownReports[0]?.status === "unknown-not-delete" && !absent.historicalMethodScopeVerified && absent.tombstones.length === 0);
    const generated = structuredClone(base), defaultSelectKeyID = generated.schemaColumns.find((column) => column.type === "select").id;
    generated.generatedEmptySelectKeyIDs = [defaultSelectKeyID];
    for (const [rows, suffixOffset] of [[generated.pages.flatMap((page) => page.data.view.rows), 500], [generated.comparison.data.view.rows, 700]]) {
        rows.forEach((row, index) => {
            const selected = row.cells.find((entry) => entry.value.keyID === defaultSelectKeyID), generatedID = `${row.id.slice(0, 14)}-${String(suffixOffset + index).padStart(7, "0")}`;
            selected.id = generatedID;
            selected.value = { id: generatedID, keyID: defaultSelectKeyID, blockID: row.id, type: "select", createdAt: 1792195200000, updatedAt: 1792195200000 };
        });
    }
    const generatedBefore = json(generated), generatedRead = diagnoseAvRows(generated);
    check("only-verified-empty-select-generated-value-ID-difference-is-equivalent", generatedRead.currentViewObservationComplete && generatedRead.selectedMethodReadComplete
        && generatedRead.comparisonPolicy === COMPARISON_POLICY && generatedRead.normalizedPaths.length === 20 && generatedRead.normalizedPaths.every((entry) => entry.path === "value.id" && entry.keyID === defaultSelectKeyID));
    const noAllowlist = structuredClone(generated); delete noAllowlist.generatedEmptySelectKeyIDs;
    check("empty-select-normalization-requires-explicit-allowlist", !diagnoseAvRows(noAllowlist).currentViewObservationComplete);
    const generatedCopies = (input) => [input.pages[0].data.view.rows[0], input.comparison.data.view.rows[0]];
    const generatedCell = (row) => row.cells.find((entry) => entry.value.keyID === defaultSelectKeyID);
    function rejectGenerated(name, change) {
        const input = structuredClone(generated); change(input); const result = diagnoseAvRows(input);
        check(name, !result.currentViewObservationComplete && !result.selectedMethodReadComplete && !result.writeAllowed && result.methods.length === 0);
    }
    for (const [name, change] of [
        ["missing-ID", (entry) => { delete entry.value.id; }],
        ["illegal-ID", (entry) => { entry.id = entry.value.id = "bad-id"; }],
        ["cell-ID-not-value-ID", (entry) => { entry.id = "20261017000000-0000999"; }],
        ["ID-wrong-time-prefix", (entry) => { entry.id = entry.value.id = "20261018000000-0000999"; }],
        ["missing-timestamp", (entry) => { delete entry.value.updatedAt; }],
        ["negative-timestamp", (entry) => { entry.value.createdAt = -1; }],
        ["fractional-timestamp", (entry) => { entry.value.updatedAt = 1.5; }],
        ["extra-field", (entry) => { entry.value.future = true; }],
        ["mSelect-present-empty", (entry) => { entry.value.mSelect = []; }],
        ["mSelect-nonempty-options", (entry) => { entry.value.mSelect = [{ content: "不可忽略", color: "1" }]; }],
        ["wrong-blockID", (entry) => { entry.value.blockID = "20261017000000-0000999"; }],
        ["wrong-type", (entry) => { entry.value.type = "text"; }],
    ]) rejectGenerated(`both-sides-same-bad-empty-select-${name}-still-unknown`, (input) => { for (const row of generatedCopies(input)) change(generatedCell(row)); });
    rejectGenerated("empty-select-timestamp-difference-still-compared", (input) => { generatedCell(input.comparison.data.view.rows[0]).value.updatedAt += 1; });
    rejectGenerated("empty-select-key-difference-refused", (input) => { generatedCell(input.comparison.data.view.rows[0]).value.keyID = "20261017000000-0000999"; });
    rejectGenerated("row-identity-difference-refused", (input) => { input.comparison.data.view.rows[0].id = "20261017000000-0000999"; });
    rejectGenerated("method-text-value-ID-remains-strict", (input) => { cell(input, input.comparison.data.view.rows[0], "value").value.id = "20261017000000-0000999"; });
    rejectGenerated("block-primary-value-ID-remains-strict", (input) => { input.comparison.data.view.rows[0].cells.find((entry) => entry.valueType === "block").value.id = "20261017000000-0000999"; });
    rejectGenerated("method-column-cannot-be-allowlisted", (input) => { input.generatedEmptySelectKeyIDs = [input.expectedKeys.value]; });
    rejectGenerated("block-column-cannot-be-allowlisted", (input) => { input.generatedEmptySelectKeyIDs = [input.schemaColumns.find((column) => column.type === "block").id]; });
    rejectGenerated("unknown-select-key-cannot-be-allowlisted", (input) => { input.generatedEmptySelectKeyIDs = ["20261017000000-0000999"]; });
    rejectGenerated("duplicate-allowlist-refused", (input) => { input.generatedEmptySelectKeyIDs.push(defaultSelectKeyID); });
    rejectGenerated("nonarray-allowlist-refused", (input) => { input.generatedEmptySelectKeyIDs = defaultSelectKeyID; });
    check("comparison-normalization-preserves-all-raw-input", json(generated) === generatedBefore);
    check("pure-input-immutable-no-business-effects", json(base) === before && counters().identityAllocations === 0 && counters().nativeWrites === 0 && counters().kernelRequests === 0);
    return { total: checks.length, passed: checks.length, failed: 0, checks, pureCounters: counters(), kernelRequests: 0, filesystemWrites: 0, portBinds: 0, childProcesses: 0 };
}

function nodeId() { return `${new Date().toISOString().slice(0, 19).replace(/\D/g, "")}-${randomBytes(4).toString("hex").slice(0, 7)}`; }
function checkedId(value) { assert.equal(typeof value, "string"); assert.match(value, ID); return value; }

function preflightFor(runEnabled) {
    const runId = randomUUID(), tempRoot = fs.realpathSync(os.tmpdir());
    const workspace = path.join(tempRoot, `SiYuan-Lvct-Av-Rows-${runId}`);
    assert.match(runId, UUID); assert.equal(path.dirname(workspace), tempRoot);
    assert.equal(fs.existsSync(workspace), false, "Generated UUID workspace must not exist");
    const found = ["D:/biji/SiYuan/resources/kernel/SiYuan-Kernel.exe", "D:/RJ/SiYuan/resources/kernel/SiYuan-Kernel.exe",
        path.join(process.env.ProgramFiles || "C:/Program Files", "SiYuan/resources/kernel/SiYuan-Kernel.exe")].find((candidate) => fs.existsSync(candidate));
    const kernel = found ? fs.realpathSync(found) : null, appDir = kernel ? path.resolve(path.dirname(kernel), "..") : null;
    const kernelReady = Boolean(kernel && path.basename(kernel) === "SiYuan-Kernel.exe" && fs.statSync(kernel).isFile() && ["stage", "appearance"].every((name) => fs.existsSync(path.join(appDir, name))));
    return { research: "AG-RF-004-A1", mode: runEnabled ? "explicit-isolated-kernel" : "dry-run", gate: "LVCT_RUN_AV_ROWS=1", runEnabled,
        appendVariant: APPEND_VARIANT, sourceCommit: SOURCE_COMMIT,
        comparisonPolicy: COMPARISON_POLICY,
        runId, workspace, tempRoot, workspaceExists: false, kernel, appDir, kernelReady, host: HOST, port: null,
        kernelStarted: false, kernelRequests: 0, workspaceWrites: 0, portBinds: 0, childProcesses: 0,
        fictionalOnly: true, browserCalls: 0, productionChanges: false, realPluginFileWrites: 0,
        hostVerified: false, uiVerified: false, historicalMethodScopeVerified: false, writeAllowed: false, status: "not_run" };
}

// The owned-child Kernel harness below is copied from N3, with this card's
// endpoint allowlist and raw-before-assert evidence capture. No old script changes.
async function runHost(preflight) {
    assert.equal(process.platform, "win32", "Listener attribution is Windows-only"); assert.ok(preflight.kernelReady, "Validated Kernel executable/resources not found");
    const { runId, workspace, kernel, appDir } = preflight;
    const port = await new Promise((resolvePort, rejectPort) => {
        const server = net.createServer(); server.once("error", rejectPort);
        server.listen({ host: HOST, port: 0, exclusive: true }, () => { const assigned = server.address().port;
            server.close((error) => error ? rejectPort(error) : resolvePort(assigned)); });
    });
    assert.ok(Number.isInteger(port) && port > 0 && port <= 65535); await assertTestPortAvailable(HOST, port);
    const result = { ...preflight, preflight, generatedAt: new Date().toISOString(), port, randomPortChecked: true, portBinds: 2,
        status: "running_isolated", endpointSequenceVerified: false, appendRowsReadbackVerified: false, restartReadbackVerified: false,
        requests: [], observations: [], listenerOwnershipChecks: 0, fixtureMutations: 0, automaticResends: 0,
        cleanup: { ownKernelExited: false, portReleased: false, workspaceRetained: true },
        isolationBoundary: "UUID/marker/owned-child/listener checks are detection guards, not OS-level isolation",
        limits: ["Only appendDetached-with-values is tested; no bound-row fallback, relation, production schema or D1 adoption",
            "Positive bounded pages and an extra empty page verify the fresh controlled default view, not an atomic or historical full scan",
            "Raw host block primary payload is opaque; no block.id, foreign-key or back-link semantics are guessed",
            "Known itemIDs and fixture oracle exist only in this process; missing rows are unknown-not-delete and never tombstones",
            "Explicit fault injection/restoration is experimental fixture mutation, never automatic identity repair",
            "The disposable research cache contains no facts; deleting it while retaining AV anchors/baseline is not uninstall or rediscovery after all configuration loss",
            "UI/native editor/concurrent multi-window/CAS/search/main-contact projection and large-library performance remain unverified"] };
    let child, assertRunning, token = "", interrupted = false, shutdownPromise, stoppingPromise;
    const markerValue = { createdBy: CREATED_BY, runId, workspace, port, kernel };
    prepareIsolatedWorkspace(workspace, MARKER, CREATED_BY); fs.writeFileSync(path.join(workspace, MARKER), JSON.stringify(markerValue) + "\n", "utf8"); result.workspaceWrites = 2;
    function assertOwnedWorkspace() {
        assert.equal(fs.lstatSync(workspace).isSymbolicLink(), false); assert.equal(fs.realpathSync(workspace), workspace); assert.equal(path.dirname(workspace), preflight.tempRoot);
        assertIsolatedPath(workspace, path.join(workspace, MARKER)); assertIsolatedPath(workspace, path.join(workspace, "data"));
        assert.deepEqual(JSON.parse(fs.readFileSync(path.join(workspace, MARKER), "utf8")), markerValue);
    }
    function redact(error) { const text = String(error?.message ?? error);
        return (token ? text.replaceAll(token, "[REDACTED]") : text).replace(/(Authorization\s*[:=]\s*|Token\s+)[^\s,;]+/gi, "$1[REDACTED]"); }
    function assertOwnedListener() {
        assertRunning();
        const listing = execFileSync(path.join(process.env.SystemRoot || "C:/Windows", "System32", "netstat.exe"), ["-ano", "-p", "tcp"], { encoding: "utf8", windowsHide: true, timeout: 5000, maxBuffer: 2 * 1024 * 1024 });
        const owners = new Set(listing.split(/\r?\n/).map((line) => line.trim().split(/\s+/)).filter((columns) => columns.length === 5 && columns[0] === "TCP" && columns[3] === "LISTENING"
            && Number(columns[1].match(/:(\d+)$/)?.[1]) === port).map((columns) => Number(columns[4])));
        assert.ok(owners.size === 1 && owners.has(child.pid), "Random-port listener is not this probe's live child; refusing HTTP"); assertRunning(); result.listenerOwnershipChecks += 1;
    }
    async function request(route, body = {}, timeout = 15000) {
        assert.ok(ROUTES.has(route), "Only reviewed endpoints allowed"); assertOwnedWorkspace();
        assert.ok(!interrupted || route === "/api/system/exit", "Interrupted; refusing further work"); assertOwnedListener();
        result.kernelRequests += 1; if (MUTATIONS.has(route)) result.fixtureMutations += 1;
        const entry = { requestNo: result.kernelRequests, route, body, dispatched: true, outcome: "unknown" }; result.requests.push(entry);
        try {
            const response = await fetch(`http://${HOST}:${port}${route}`, { method: "POST", redirect: "error",
                headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Token ${token}` } : {}) }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeout) });
            entry.httpStatus = response.status; entry.response = await response.json(); assertRunning();
            assert.equal(response.ok, true, `${route}: HTTP ${response.status}`); assert.equal(entry.response.code, 0, `${route}: Kernel code ${entry.response.code}`);
            entry.outcome = "received-code0-not-application-proof"; return entry.response.data;
        } catch (error) { entry.error = redact(error); throw error; }
    }
    async function start() {
        assert.equal(interrupted, false, "Interrupted; refusing restart"); assertOwnedWorkspace(); await assertTestPortAvailable(HOST, port); result.portBinds += 1; token = "";
        child = spawn(kernel, ["--workspace", workspace, "serve", "--wd", appDir, "--port", String(port)], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true, env: { ...process.env, SIYUAN_WORKSPACE_PATH: workspace } });
        result.kernelStarted = true; result.childProcesses += 1; result.ownKernelPids = [...(result.ownKernelPids ?? []), child.pid].filter(Number.isInteger);
        result.cleanup.ownKernelExited = false; result.cleanup.portReleased = false; assertRunning = observeTestKernel(child);
        for (const stream of [child.stdout, child.stderr]) stream.on("data", () => {});
        const deadline = Date.now() + 60000;
        while (true) {
            assertRunning(); assert.equal(interrupted, false, "Interrupted during startup");
            const configPath = path.join(workspace, "conf", "conf.json"); assertIsolatedPath(workspace, configPath);
            if (fs.existsSync(configPath)) token = JSON.parse(fs.readFileSync(configPath, "utf8")).api?.token ?? "";
            const boot = await request("/api/system/bootProgress", {}, 2000).catch(() => undefined);
            if (Number(boot?.progress) >= 100) return;
            if (Date.now() > deadline) throw new Error("Isolated Kernel startup timed out");
            await new Promise((resolveWait) => setTimeout(resolveWait, 250));
        }
    }
    async function stop() {
        if (stoppingPromise) return stoppingPromise; if (!child) return;
        const ownedChild = child;
        stoppingPromise = (async () => {
            const exited = () => ownedChild.exitCode !== null || ownedChild.signalCode !== null;
            if (!exited()) await request("/api/system/exit", { force: true }, 2000).catch((error) => { result.cleanup.httpExitSkippedOrFailed = redact(error); });
            if (!exited()) await new Promise((resolveExit) => { const timer = setTimeout(resolveExit, 3000); ownedChild.once("exit", () => { clearTimeout(timer); resolveExit(); }); });
            if (!exited()) { ownedChild.kill("SIGKILL"); await new Promise((resolveExit) => { if (exited()) return resolveExit(); const timer = setTimeout(resolveExit, 3000); ownedChild.once("exit", () => { clearTimeout(timer); resolveExit(); }); }); }
            assert.ok(exited(), "Owned child did not exit; no unrelated process will be stopped"); child = undefined; assertRunning = undefined; result.cleanup.ownKernelExited = true;
            await assertTestPortAvailable(HOST, port); result.portBinds += 1; result.cleanup.portReleased = true;
        })();
        try { await stoppingPromise; } finally { stoppingPromise = undefined; }
    }
    const onSignal = () => { interrupted = true; process.exitCode = 130; shutdownPromise ??= stop().catch((error) => { result.cleanup.error = redact(error); }); };
    const onExit = () => { if (child && child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); };
    process.on("SIGINT", onSignal); process.on("SIGTERM", onSignal); process.on("exit", onExit);
    let anchors, expectedKeys, docs, schemaColumns, defaultSelectColumns = [], knownBaselineRowIds = [];
    async function render(page, pageSize) { return { page, pageSize, data: await request("/api/av/renderAttributeView", { id: anchors.avID, blockID: anchors.dbBlockID, query: "", page, pageSize, createIfNotExist: false }) }; }
    function verifyUnpersistedDefaultSelect(snapshotEntry) {
        assertOwnedWorkspace(); assertRunning();
        const avPath = path.join(workspace, "data", "storage", "av", `${checkedId(anchors.avID)}.json`);
        assertIsolatedPath(workspace, avPath);
        assert.equal(fs.lstatSync(avPath).isSymbolicLink(), false); assert.equal(fs.lstatSync(avPath).isFile(), true);
        assert.equal(fs.realpathSync(avPath), avPath, "Only this run's exact AV file may be observed");
        assert.ok(fs.statSync(avPath).size <= 4 * 1024 * 1024, "Controlled AV file read must remain bounded");
        const bytes = fs.readFileSync(avPath), stored = JSON.parse(bytes.toString("utf8"));
        const evidence = { path: avPath, sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length,
            keyCounts: [], generatedEmptySelectKeyIDs: [], defaultKeysFromInitialSchema: true, producerWritesToTheseKeys: 0, verified: false,
            boundary: "Read-only exact owned AV persistence observation; not a general external-writer or atomic snapshot guarantee" };
        snapshotEntry.generatedEmptySelectEvidence = evidence;
        assert.ok(record(stored) && stored.id === anchors.avID && Array.isArray(stored.keyValues), "Exact owned AV file shape required");
        const generatedEmptySelectKeyIDs = defaultSelectColumns.map((column) => column.id);
        assert.equal(new Set(generatedEmptySelectKeyIDs).size, generatedEmptySelectKeyIDs.length);
        for (const keyID of generatedEmptySelectKeyIDs) {
            assert.ok(!FIELDS.some((field) => expectedKeys[field] === keyID), "Default select cannot be a method column");
            assert.ok(!result.requests.some((entry) => entry.route === "/api/av/setAttributeViewBlockAttr" && entry.body.keyID === keyID
                || entry.route === "/api/av/appendAttributeViewDetachedBlocksWithValues" && entry.body.blocksValues.some((values) => values.some((value) => value.keyID === keyID))), "This producer must never write the default select column");
        }
        for (const column of defaultSelectColumns) {
            const matches = stored.keyValues.filter((entry) => entry?.key?.id === column.id);
            evidence.keyCounts.push({ keyID: column.id, type: "select", matches: matches.length,
                valuesPresent: matches.length === 1 && Object.hasOwn(matches[0], "values"),
                valueCount: matches.length === 1 ? !Object.hasOwn(matches[0], "values") ? 0 : Array.isArray(matches[0].values) ? matches[0].values.length : null : null });
            assert.equal(matches.length, 1, "Default select persisted key must be unique");
            const entry = matches[0];
            assert.ok(entry.key.type === "select" && entry.key.name === column.name, "Default select key definition changed");
            assert.ok(!Object.hasOwn(entry, "values") || Array.isArray(entry.values) && entry.values.length === 0, "Default select has persisted or malformed values; normalization forbidden");
        }
        assertRunning();
        evidence.generatedEmptySelectKeyIDs = generatedEmptySelectKeyIDs; evidence.verified = true;
        return evidence;
    }
    async function snapshot(label) {
        const entry = { label, pages: [], historicalMethodScopeVerified: false, writeAllowed: false, fixtureMutationsBeforeRead: result.fixtureMutations }; result.observations.push(entry);
        await request("/api/sqlite/flushTransaction");
        let count = 0;
        for (let page = 1; page <= MAX_PAGES; page += 1) {
            const rendered = await render(page, PAGE_SIZE); entry.pages.push(rendered);
            const rows = rendered.data?.view?.rows, total = rendered.data?.view?.rowCount;
            if (!Array.isArray(rows) || !Number.isSafeInteger(total) || total < 0) break;
            count += rows.length; if (rows.length === 0 || count >= total) break;
        }
        entry.extraPage = await render(entry.pages.length + 1, PAGE_SIZE); entry.comparison = await render(1, 500);
        entry.personRows = await request("/api/query/sql", { stmt: `SELECT id, root_id, parent_id, type, box FROM blocks WHERE id IN ('${docs.map(checkedId).join("','")}') ORDER BY id LIMIT 3` });
        entry.generatedEmptySelectEvidence = verifyUnpersistedDefaultSelect(entry);
        entry.diagnosis = diagnoseAvRows({ ...entry, schemaColumns, expectedKeys, expectedPersonDocIds: docs, expectedNotebookId: anchors.notebook, knownBaselineRowIds,
            generatedEmptySelectKeyIDs: entry.generatedEmptySelectEvidence.generatedEmptySelectKeyIDs });
        entry.fixtureMutationsAfterRead = result.fixtureMutations; assert.equal(entry.fixtureMutationsAfterRead, entry.fixtureMutationsBeforeRead, "Snapshot must be read-only");
        return entry;
    }
    const rowsOf = (snapshot) => snapshot.diagnosis.selectedRead.methods;
    const assertExpected = (snapshot, expected) => {
        assert.ok(snapshot.diagnosis.currentViewObservationComplete && snapshot.diagnosis.selectedMethodReadComplete, "Independent paged method read must be complete");
        const actual = rowsOf(snapshot).map(({ itemID, ...fields }) => fields).sort((a, b) => a.methodId.localeCompare(b.methodId));
        assert.deepEqual(actual, expected.toSorted((a, b) => a.methodId.localeCompare(b.methodId)), "Every semantic field must exactly match the fictional oracle");
    };
    async function assign(itemID, field, value) {
        checkedId(itemID); assert.ok(FIELDS.includes(field)); assert.equal(typeof value, "string");
        return request("/api/av/setAttributeViewBlockAttr", { avID: anchors.avID, keyID: expectedKeys[field], itemID, value: { text: { content: value } } });
    }
    try {
        resetCounters(); result.syntheticChecks = runSyntheticChecks(); await start(); result.version = await request("/api/system/version");
        const notebookName = `A1 fictional ${runId}`; await request("/api/notebook/createNotebook", { name: notebookName });
        const notebooks = (await request("/api/notebook/lsNotebooks")).notebooks.filter((entry) => entry.name === notebookName); assert.equal(notebooks.length, 1); const notebook = checkedId(notebooks[0].id);
        docs = [checkedId(await request("/api/filetree/createDocWithMd", { notebook, path: "/A1-fiction-person-A", markdown: "虚构人物 A，仅研究。\n" })),
            checkedId(await request("/api/filetree/createDocWithMd", { notebook, path: "/A1-fiction-person-B", markdown: "虚构人物 B，仅研究。\n" }))];
        const hostDocID = checkedId(await request("/api/filetree/createDocWithMd", { notebook, path: "/A1-fiction-method-AV", markdown: "虚构方法 AV，仅研究。\n" })), avID = nodeId();
        const inserted = await request("/api/block/insertBlock", { dataType: "dom", parentID: hostDocID, data: `<div data-type="NodeAttributeView" data-av-id="${avID}" data-av-type="table"></div>` });
        const dbBlockID = checkedId(inserted?.[0]?.doOperations?.[0]?.id); anchors = { notebook, hostDocID, avID, dbBlockID }; result.anchors = anchors;
        result.initialHostView = await request("/api/av/renderAttributeView", { id: avID, blockID: dbBlockID, query: "", page: 1, pageSize: 500, createIfNotExist: true });
        const initialColumns = result.initialHostView?.view?.columns;
        assert.ok(Array.isArray(initialColumns) && initialColumns.every(columnShape) && new Set(initialColumns.map((column) => column.id)).size === initialColumns.length, "Initial host schema must have unique valid columns");
        defaultSelectColumns = initialColumns.filter((column) => column.type === "select");
        result.generatedEmptySelectDefaultKeyIDs = defaultSelectColumns.map((column) => column.id);
        expectedKeys = {}; let previousKeyID = "";
        for (const field of FIELDS) { const keyID = nodeId(); expectedKeys[field] = keyID;
            await request("/api/av/addAttributeViewKey", { avID, keyID, keyName: field, keyType: "text", keyIcon: "", previousKeyID }); previousKeyID = keyID; }
        result.expectedKeys = expectedKeys; result.schemaView = (await render(1, 500)).data; schemaColumns = result.schemaView?.view?.columns; result.schemaColumns = schemaColumns;
        assert.ok(Array.isArray(schemaColumns) && schemaColumns.every(columnShape));
        const emptySchema = inspectView(result.schemaView, schemaColumns, expectedKeys);
        assert.ok(emptySchema.ok && emptySchema.rowCount === 0 && emptySchema.rows.length === 0, "Validate the fresh empty schema and all method keys before append");
        const blockColumns = schemaColumns.filter((column) => column.type === "block");
        assert.equal(blockColumns.length, 1, "Source-backed append requires one real host block column");
        const primaryKeyID = checkedId(blockColumns[0].id); result.appendPrimaryKeyID = primaryKeyID;
        const expected = methodFixtures(docs); result.fixtures = { docs, methods: structuredClone(expected) };
        await request("/api/av/appendAttributeViewDetachedBlocksWithValues", { avID, blocksValues: expected.map((method, index) => [
            { keyID: primaryKeyID, block: { content: `虚构方法显示 ${index + 1}` } },
            ...FIELDS.map((field) => ({ keyID: expectedKeys[field], type: "text", text: { content: method[field] } })),
        ]) });
        const baseline = await snapshot("single-batch-append-baseline"); assertExpected(baseline, expected);
        assert.ok(baseline.diagnosis.nonemptyPages >= 2, "Must observe multiple nonempty pageSize2 pages");
        result.appendRowsReadbackVerified = true; knownBaselineRowIds = rowsOf(baseline).map((method) => method.itemID); result.knownBaselineRowIds = knownBaselineRowIds;
        const target = expected.find((method) => method.ownerDocId === docs[0] && method.sourceKey === "phone-extra"), main = expected.find((method) => method.ownerDocId === docs[0] && method.sourceKey === "phone-main");
        const itemID = checkedId(rowsOf(baseline).find((method) => method.methodId === target.methodId).itemID); result.target = { itemID, methodId: target.methodId, ownerDocId: target.ownerDocId, sourceKey: target.sourceKey };
        const originalIdentity = { methodId: target.methodId, ownerDocId: target.ownerDocId, sourceKey: target.sourceKey };
        for (const [field, value] of [["value", '+00 999\n"改值" \\路径'], ["label", "虚构修改标签"], ["order", "9"]]) { await assign(itemID, field, value); target[field] = value; }
        const edited = await snapshot("API-value-label-order-edit"); assertExpected(edited, expected);
        assert.deepEqual(Object.fromEntries(Object.keys(originalIdentity).map((key) => [key, rowsOf(edited).find((method) => method.itemID === itemID)[key]])), originalIdentity);
        await assign(itemID, "methodId", ""); const empty = await snapshot("explicit-empty-method-ID-injection");
        assert.ok(empty.diagnosis.currentViewObservationComplete && !empty.diagnosis.selectedMethodReadComplete && empty.diagnosis.methodReports.some((report) => report.itemID === itemID));
        await assign(itemID, "methodId", target.methodId); assertExpected(await snapshot("explicit-empty-ID-fixture-restored"), expected);
        await assign(itemID, "sourceKey", main.sourceKey); await assign(itemID, "methodId", main.methodId);
        const duplicate = await snapshot("explicit-two-individually-valid-identities-duplicate-injection");
        assert.ok(duplicate.diagnosis.currentViewObservationComplete && !duplicate.diagnosis.selectedMethodReadComplete && duplicate.diagnosis.methodReports.some((report) => report.status === "duplicate"));
        await assign(itemID, "sourceKey", target.sourceKey); await assign(itemID, "methodId", target.methodId); assertExpected(await snapshot("explicit-duplicate-fixture-restored"), expected);
        await assign(itemID, "ownerDocId", docs[1]); const owner = await snapshot("explicit-owner-change-retaining-old-ID-injection");
        assert.ok(owner.diagnosis.currentViewObservationComplete && owner.diagnosis.personDocumentsVerified && !owner.diagnosis.selectedMethodReadComplete);
        await assign(itemID, "ownerDocId", target.ownerDocId); assertExpected(await snapshot("explicit-owner-fixture-restored"), expected);
        assert.equal(target.primary, "0"); await request("/api/av/removeAttributeViewBlocks", { avID, srcIDs: [itemID] });
        const remaining = expected.filter((method) => method.methodId !== target.methodId), removed = await snapshot("known-nonprimary-row-removed"); assertExpected(removed, remaining);
        const baselineItemIDs = new Map(rowsOf(baseline).map((method) => [method.methodId, method.itemID]));
        for (const method of rowsOf(removed)) assert.equal(method.itemID, baselineItemIDs.get(method.methodId), "Removing one row must preserve every survivor itemID");
        removed.survivingItemIDsMatchBaseline = true;
        assert.ok(removed.diagnosis.missingKnownReports.some((report) => report.itemID === itemID && report.status === "unknown-not-delete"));
        const cachePath = path.join(workspace, `av-rows-non-factual-cache-${runId}.json`), cacheText = JSON.stringify({ researchOnly: true, nonFactual: true, runId, purpose: "disposable experiment cache; no method facts or anchors" }) + "\n";
        assertOwnedWorkspace(); assertIsolatedPath(workspace, cachePath); assert.equal(path.dirname(cachePath), workspace); assert.equal(fs.existsSync(cachePath), false);
        fs.writeFileSync(cachePath, cacheText, { encoding: "utf8", flag: "wx" }); result.workspaceWrites += 1;
        assert.equal(fs.lstatSync(cachePath).isFile(), true); assert.equal(fs.lstatSync(cachePath).isSymbolicLink(), false); assert.equal(fs.realpathSync(cachePath), cachePath); assert.equal(fs.readFileSync(cachePath, "utf8"), cacheText);
        fs.unlinkSync(cachePath); assert.equal(fs.existsSync(cachePath), false); result.cacheDeletion = { exactPath: cachePath, createdAndContentVerified: true, deleted: true, nonFactual: true, recursiveDeletion: false };
        const afterCache = await snapshot("non-factual-cache-deleted-readback"); assertExpected(afterCache, remaining);
        await stop(); await start(); const mutationsBeforeRestartRead = result.fixtureMutations;
        const restarted = await snapshot("restart-read-only-after-cache-deletion"); assertExpected(restarted, remaining);
        assert.equal(result.fixtureMutations, mutationsBeforeRestartRead); assert.deepEqual(rowsOf(restarted).toSorted((a, b) => a.itemID.localeCompare(b.itemID)), rowsOf(afterCache).toSorted((a, b) => a.itemID.localeCompare(b.itemID)));
        result.restartReadbackVerified = true; result.endpointSequenceVerified = true; result.pureCounters = counters();
        assert.equal(result.pureCounters.identityAllocations, 0); assert.equal(interrupted, false, "Interrupted; refusing success"); result.status = "done_isolated";
    } catch (error) { result.error = redact(error); result.status = interrupted ? "interrupted_isolated" : "failed_isolated"; process.exitCode = interrupted ? 130 : 1; }
    finally {
        if (shutdownPromise) await shutdownPromise;
        await stop().catch((error) => { result.cleanup.error = redact(error); result.status = "failed_isolated"; process.exitCode = 1; });
        if (interrupted) result.status = "interrupted_isolated"; else if (result.cleanup.error || !result.cleanup.ownKernelExited || !result.cleanup.portReleased) result.status = "failed_isolated";
        process.removeListener("SIGINT", onSignal); process.removeListener("SIGTERM", onSignal); if (!child) process.removeListener("exit", onExit);
        result.completedAt = new Date().toISOString(); const serialized = JSON.stringify(result, null, 2) + "\n";
        assert.ok(!token || !serialized.includes(token), "Evidence contains private temporary token; refusing output");
        assertOwnedWorkspace(); const retainedEvidence = path.join(workspace, `av-rows-evidence-${runId}.json`); assertIsolatedPath(workspace, retainedEvidence);
        fs.writeFileSync(retainedEvidence, serialized, { encoding: "utf8", flag: "wx" }); fs.writeFileSync(OUTPUT, serialized, "utf8");
    }
    console.log(JSON.stringify({ status: result.status, appendRowsReadbackVerified: result.appendRowsReadbackVerified, endpointSequenceVerified: result.endpointSequenceVerified,
        restartReadbackVerified: result.restartReadbackVerified, kernelRequests: result.kernelRequests, listenerOwnershipChecks: result.listenerOwnershipChecks, fixtureMutations: result.fixtureMutations,
        automaticResends: 0, hostVerified: false, uiVerified: false, historicalMethodScopeVerified: false, writeAllowed: false, cleanup: result.cleanup, error: result.error ?? null, output: OUTPUT }, null, 2));
}

export async function main(args = process.argv.slice(2)) {
    assert.ok(args.every((arg) => arg === "--dry-run"), "Only --dry-run is supported; no workspace/port overrides");
    const runEnabled = process.env.LVCT_RUN_AV_ROWS === "1" && !args.includes("--dry-run"), preflight = preflightFor(runEnabled);
    if (!runEnabled) console.log(JSON.stringify({ preflight, syntheticChecks: runSyntheticChecks() }, null, 2)); else await runHost(preflight);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
