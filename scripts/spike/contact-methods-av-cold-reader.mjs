/** A2 cold reader: no fixture, file, HTTP or child-process imports. */
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const FIELDS = Object.freeze(["methodId", "ownerDocId", "sourceKey", "type", "label", "value", "primary", "order"]);
export const DEFAULT_BUDGET = Object.freeze({ carrierPageSize: 2, carrierMaxPages: 8, avPageSize: 2, avMaxPages: 8, maxRequests: 160, maxJsonBytes: 2097152, requestTimeoutMs: 15000 });
const ID = /^\d{14}-[a-z0-9]{7}$/, SOURCE = /^[a-z][a-z0-9-]{0,63}$/;
const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value, max, empty = false) => typeof value === "string" && value.length <= max && (empty || value.length > 0) && value.isWellFormed() && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u.test(value);
const canonical = (value) => JSON.stringify(value);
const refuse = (detail) => ({ ok: false, status: "unknown", detail });
export const carrierSQL = (cursor, size) => `SELECT id, root_id, parent_id, box, type, markdown FROM blocks WHERE type='av'${cursor ? ` AND id > '${cursor}'` : ""} ORDER BY id LIMIT ${size + 1}`;
export const documentSQL = (id) => `SELECT id, root_id, parent_id, box, type FROM blocks WHERE id = '${id}' LIMIT 2`;

export function validBudget(budget) {
    return record(budget) && Object.keys(budget).sort().join() === Object.keys(DEFAULT_BUDGET).sort().join()
        && Object.entries(budget).every(([key, value]) => Number.isInteger(value) && value >= 1 && value <= DEFAULT_BUDGET[key])
        && [1, 2].includes(budget.carrierPageSize) && budget.avPageSize === 2 && budget.maxJsonBytes >= 4096 && budget.requestTimeoutMs >= 100;
}
export function parseCarrier(row) {
    if (!record(row) || !["id", "root_id", "parent_id", "box"].every((key) => typeof row[key] === "string" && ID.test(row[key]))
        || row.type !== "av" || row.parent_id !== row.root_id || !text(row.markdown, 4096)) return refuse("carrier-shape-or-not-direct");
    // Require whitespace between declarations; adjacent attributes are not a
    // native NodeAttributeView envelope.
    const match = /^<div ([a-z][a-z0-9-]*="[^"<>]*"(?:\s+[a-z][a-z0-9-]*="[^"<>]*")*)><\/div>$/.exec(row.markdown);
    if (!match) return refuse("carrier-markdown-envelope");
    const attrs = {}, body = match[1]; let cursor = 0;
    for (const entry of body.matchAll(/([a-z][a-z0-9-]*)="([^"<>]*)"/g)) {
        if (body.slice(cursor, entry.index).length && !/^\s+$/u.test(body.slice(cursor, entry.index))) return refuse("carrier-attribute-syntax-or-duplicate");
        if (Object.hasOwn(attrs, entry[1])) return refuse("carrier-attribute-syntax-or-duplicate");
        attrs[entry[1]] = entry[2]; cursor = entry.index + entry[0].length;
    }
    if (body.slice(cursor).trim() || Object.keys(attrs).sort().join() !== ["data-type", "data-av-id", "data-av-type"].sort().join()
        || attrs["data-type"] !== "NodeAttributeView" || attrs["data-av-type"] !== "table" || !ID.test(attrs["data-av-id"])) return refuse("carrier-attributes-or-av-ID");
    return { ok: true, carrierID: row.id, avID: attrs["data-av-id"], rootID: row.root_id, notebookID: row.box };
}
export function inspectCarrierPage(rows, cursor, size, already = []) {
    if (!Array.isArray(rows) || rows.length > size + 1 || cursor && !ID.test(cursor)) return refuse("carrier-page-shape");
    let previous = cursor;
    for (const row of rows) {
        if (!record(row) || typeof row.id !== "string" || !ID.test(row.id) || previous && row.id <= previous || already.includes(row.id)) return refuse("carrier-page-ID-order-or-duplicate");
        previous = row.id;
        if (!["root_id", "parent_id", "box"].every((key) => typeof row[key] === "string" && ID.test(row[key])) || row.type !== "av" || typeof row.markdown !== "string") return refuse("carrier-page-fields");
    }
    const processed = rows.slice(0, size);
    return { ok: true, processed, hasLookahead: rows.length > size, nextCursor: processed.at(-1)?.id ?? cursor };
}
export function schemaOf(columns) {
    if (!Array.isArray(columns) || columns.length > 32 || !columns.every((column) => record(column) && typeof column.id === "string" && ID.test(column.id)
        && typeof column.name === "string" && typeof column.type === "string" && column.type) || new Set(columns.map((column) => column.id)).size !== columns.length) return refuse("schema-column-shape");
    const matched = columns.filter((column) => FIELDS.includes(column.name));
    if (!matched.length) return { ok: true, classification: "unrelated", keys: {} };
    const keys = {};
    for (const field of FIELDS) {
        const found = columns.filter((column) => column.name === field);
        if (found.length !== 1 || found[0].type !== "text") return refuse("partial-duplicate-or-typed-method-mapping");
        keys[field] = found[0].id;
    }
    if (columns.filter((column) => column.type === "block").length !== 1) return refuse("unique-block-column");
    return { ok: true, classification: "matching", keys };
}
function filterFree(data) {
    const view = data.view;
    return data.isMirror === false && data.contextFilter === null && Array.isArray(data.contextFilterFields) && data.contextFilterFields.length === 0
        && view.group === null && view.groupHidden === 0 && Array.isArray(view.sorts) && view.sorts.length === 0
        && Array.isArray(view.filters) && view.filters.length <= 1 && view.filters.every((filter) => record(filter)
            && Object.keys(filter).sort().join() === "column,combination,operator,value"
            && filter.column === "" && filter.operator === "" && filter.value === null && filter.combination === "and");
}
export function inspectRender(data, carrier, previous) {
    if (!record(data) || data.id !== carrier.avID || data.viewType !== "table" || typeof data.viewID !== "string" || !ID.test(data.viewID)
        || !record(data.view) || data.view.id !== data.viewID || !filterFree(data) || !Array.isArray(data.view.rows)
        || !Number.isSafeInteger(data.view.rowCount) || data.view.rowCount < 0 || data.view.rowCount > 16) return refuse("render-shape-view-or-filter");
    const schema = schemaOf(data.view.columns); if (!schema.ok) return schema;
    const signature = canonical(data.view.columns.map((column) => ({ id: column.id, name: column.name, type: column.type })));
    if (previous && (previous.viewID !== data.viewID || previous.signature !== signature || previous.rowCount !== data.view.rowCount)) return refuse("render-view-column-or-count-drift");
    for (const row of data.view.rows) {
        if (!record(row) || typeof row.id !== "string" || !ID.test(row.id) || !Array.isArray(row.cells) || row.cells.length > data.view.columns.length) return refuse("native-row-shape");
        const seen = new Set();
        for (const cell of row.cells) {
            const value = cell?.value, column = data.view.columns.find((entry) => entry.id === value?.keyID);
            if (!record(cell) || !record(value) || !column || cell.valueType !== column.type || value.type !== column.type
                || seen.has(value.keyID) || value.blockID !== undefined && (typeof value.blockID !== "string" || !ID.test(value.blockID))) return refuse("native-cell-shape");
            seen.add(value.keyID);
            if (value.block !== undefined && !record(value.block) || value.mSelect !== undefined && (!Array.isArray(value.mSelect)
                || value.mSelect.some((option) => !record(option) || typeof option.content !== "string" || option.color !== undefined && typeof option.color !== "string"))) return refuse("native-host-payload-shape");
        }
    }
    return { ok: true, schema, rows: data.view.rows, viewID: data.viewID, signature, rowCount: data.view.rowCount };
}
export function methodRow(row, keys) {
    if (!record(row) || typeof row.id !== "string" || !ID.test(row.id) || !Array.isArray(row.cells)) return refuse("required-method-text-cell");
    const fields = {};
    for (const field of FIELDS) {
        const cells = row?.cells?.filter((cell) => cell?.value?.keyID === keys?.[field]);
        if (!Array.isArray(cells) || cells.length !== 1 || cells[0].valueType !== "text" || cells[0].value.type !== "text"
            || cells[0].value.blockID !== row.id
            || !record(cells[0].value.text) || typeof cells[0].value.text.content !== "string") return refuse("required-method-text-cell");
        fields[field] = cells[0].value.text.content;
    }
    if (!ID.test(fields.ownerDocId) || !SOURCE.test(fields.sourceKey) || fields.methodId !== `method-${createHash("sha256").update(`${fields.ownerDocId}:${fields.sourceKey}`).digest("hex").slice(0, 24)}`
        || !["phone", "email", "wechat", "url"].includes(fields.type) || !text(fields.label, 256, true) || !text(fields.value, 8192)
        || !["0", "1"].includes(fields.primary) || !/^(0|[1-9]\d*)$/.test(fields.order) || !Number.isSafeInteger(Number(fields.order))) return refuse("method-identity-fields-or-bounds");
    return { ok: true, method: { itemID: row.id, ...fields } };
}
export function aggregateMethods(rows, keys) {
    const reports = [], methods = [], identities = new Set(), primaries = new Set();
    for (const row of rows) {
        const parsed = methodRow(row, keys);
        if (!parsed.ok) { reports.push(parsed); continue; }
        const method = parsed.method, primary = `${method.ownerDocId}:${method.type}`;
        if (identities.has(method.methodId)) { reports.push(refuse("duplicate-method-ID")); continue; }
        identities.add(method.methodId);
        if (method.primary === "1" && primaries.has(primary)) { reports.push(refuse("multiple-primary")); continue; }
        if (method.primary === "1") primaries.add(primary); methods.push(method);
    }
    return { complete: reports.length === 0, reports, methods: reports.length ? [] : methods };
}
const semantic = (methods) => canonical(methods.toSorted((a, b) => a.itemID.localeCompare(b.itemID)));
export function discoveryStatus(candidates, unknown, truncated, complete) {
    if (truncated) return "truncated";
    if (unknown || !complete) return "unknown";
    return candidates.length === 0 ? "not_found_in_observed_scope" : candidates.length === 1 ? "unique_unowned" : "ambiguous";
}

export async function discover(request, budget = DEFAULT_BUDGET) {
    assert.ok(validBudget(budget), "invalid-budget");
    const result = { status: "unknown", carrierScanComplete: false, currentAVMethodsComplete: false, carriers: [], candidates: [], unrelated: [], issues: [],
        ownershipVerified: false, historicalMethodScopeVerified: false, writeAllowed: false, rebindAllowed: false, newLibraryAllowed: false, tombstoneAllowed: false,
        methods: [], tombstones: [], recoveryWrites: 0, fullHostCellCrossReadEqualityVerified: false };
    let cursor = "", truncated = false;
    async function call(route, body) {
        const envelope = await request(route, body);
        if (!record(envelope) || envelope.code !== 0 || !Object.hasOwn(envelope, "data")) throw new Error("kernel-response");
        return envelope.data;
    }
    try {
        for (let page = 0; page < budget.carrierMaxPages; page += 1) {
            const rows = await call("/api/query/sql", { stmt: carrierSQL(cursor, budget.carrierPageSize) });
            const checked = inspectCarrierPage(rows, cursor, budget.carrierPageSize, result.carriers.map((row) => row.id));
            if (!checked.ok) throw new Error(checked.detail);
            result.carriers.push(...checked.processed); cursor = checked.nextCursor;
            if (!checked.hasLookahead) {
                const terminal = await call("/api/query/sql", { stmt: carrierSQL(cursor, budget.carrierPageSize) });
                if (!Array.isArray(terminal) || terminal.length !== 0) throw new Error("carrier-terminal-page-not-empty");
                result.carrierScanComplete = true; break;
            }
            if (page === budget.carrierMaxPages - 1) truncated = true;
        }
        for (const raw of result.carriers) {
            const carrier = parseCarrier(raw);
            if (!carrier.ok) {
                result.issues.push({ ...carrier, carrierID: raw.id });
                const possibleAV = typeof raw.markdown === "string" ? raw.markdown.match(/data-av-id="(\d{14}-[a-z0-9]{7})"/)?.[1] : undefined;
                const existing = possibleAV && result.candidates.find((candidate) => candidate.avID === possibleAV);
                if (existing) existing.sources.push({ ...raw, readStatus: "unknown", issue: carrier.detail });
                continue;
            }
            try {
                const roots = await call("/api/query/sql", { stmt: documentSQL(carrier.rootID) });
                if (!Array.isArray(roots) || roots.length !== 1 || roots[0].id !== carrier.rootID || roots[0].root_id !== carrier.rootID || roots[0].parent_id !== "" || roots[0].type !== "d" || roots[0].box !== carrier.notebookID) throw new Error("carrier-root-unreachable");
                const render = async (page, pageSize) => call("/api/av/renderAttributeView", { id: carrier.avID, blockID: carrier.carrierID, query: "", page, pageSize, createIfNotExist: false });
                let previous, allRows = [], done = false, first;
                for (let page = 1; page <= budget.avMaxPages; page += 1) {
                    const data = await render(page, budget.avPageSize), checked = inspectRender(data, carrier, previous);
                    if (!checked.ok) throw new Error(checked.detail);
                    first ??= checked; previous = checked;
                    if (checked.schema.classification === "unrelated") {
                        if (result.candidates.some((candidate) => candidate.avID === carrier.avID)) throw new Error("same-av-carrier-unrelated");
                        result.unrelated.push({ ...carrier, classification: "unrelated" }); done = true; break;
                    }
                    if (checked.rows.length > budget.avPageSize || !checked.rows.length && checked.rowCount !== 0
                        || new Set([...allRows, ...checked.rows].map((row) => row.id)).size !== allRows.length + checked.rows.length) throw new Error("method-page-progress-or-duplicate");
                    allRows.push(...checked.rows);
                    if (allRows.length >= checked.rowCount) {
                        if (allRows.length !== checked.rowCount) throw new Error("method-total-mismatch");
                        const extra = inspectRender(await render(page + 1, budget.avPageSize), carrier, previous);
                        if (!extra.ok || extra.rows.length) throw new Error("method-extra-page-not-empty");
                        const control = inspectRender(await render(1, 500), carrier, previous);
                        if (!control.ok || control.rows.length !== checked.rowCount || new Set(control.rows.map((row) => row.id)).size !== control.rows.length) throw new Error("method-large-control-incomplete");
                        const small = aggregateMethods(allRows, first.schema.keys), large = aggregateMethods(control.rows, first.schema.keys);
                        if (!small.complete || !large.complete || semantic(small.methods) !== semantic(large.methods)) throw new Error("method-semantic-collection-unknown");
                        for (const owner of new Set(small.methods.map((method) => method.ownerDocId))) {
                            const owners = await call("/api/query/sql", { stmt: documentSQL(owner) });
                            if (!Array.isArray(owners) || owners.length !== 1 || owners[0].id !== owner || owners[0].root_id !== owner || owners[0].type !== "d" || owners[0].parent_id !== "" || owners[0].box !== carrier.notebookID) throw new Error("method-owner-reference-unreachable");
                        }
                        const existing = result.candidates.find((candidate) => candidate.avID === carrier.avID);
                        if (result.unrelated.some((entry) => entry.avID === carrier.avID)) throw new Error("same-av-carrier-unrelated");
                        if (existing) {
                            if (existing.viewID !== first.viewID || existing.signature !== first.signature
                                || canonical(existing.schemaKeys) !== canonical(first.schema.keys)
                                || semantic(existing.observedMethods) !== semantic(small.methods)) throw new Error("same-AV-carriers-disagree");
                            existing.sources.push(carrier);
                        } else result.candidates.push({ avID: carrier.avID, sources: [carrier], currentMethodReadComplete: true,
                            ownerReferencesReachable: true, ownershipVerified: false, observedMethods: small.methods, schemaKeys: first.schema.keys,
                            viewID: first.viewID, signature: first.signature, rowCount: first.rowCount });
                        done = true; break;
                    }
                    if (checked.rows.length !== budget.avPageSize) throw new Error("method-short-nonterminal-page");
                }
                if (!done) { truncated = true; result.issues.push(refuse("method-page-budget")); }
            } catch (error) {
                const issue = { ...refuse("candidate-read-unknown"), category: text(error?.message, 100) ? error.message : "reader-error", carrierID: carrier.carrierID };
                result.issues.push(issue);
                const existing = result.candidates.find((candidate) => candidate.avID === carrier.avID);
                if (existing) existing.sources.push({ ...carrier, readStatus: "unknown", issue: issue.detail, issueCategory: issue.category });
            }
        }
    } catch (error) { result.issues.push({ ...refuse("carrier-read-unknown"), category: text(error?.message, 100) ? error.message : "reader-error" }); }
    result.currentAVMethodsComplete = result.issues.length === 0 && !truncated;
    result.status = discoveryStatus(result.candidates, result.issues.length > 0, truncated, result.carrierScanComplete);
    return result;
}

export function runChecks() {
    const checks = [], check = (name, pass) => { assert.ok(pass, name); checks.push({ name, pass: true }); };
    const id = (n) => `20261017000000-${String(n).padStart(7, "0")}`;
    const carrier = { id: id(10), root_id: id(1), parent_id: id(1), box: id(2), type: "av", markdown: `<div data-type="NodeAttributeView" data-av-id="${id(3)}" data-av-type="table"></div>` };
    check("strict-native-carrier", parseCarrier(carrier).ok);
    for (const [name, change] of [
        ["duplicate-attribute", (x) => { x.markdown = x.markdown.replace('data-type="', 'data-av-id="20261017000000-0000003" data-type="'); }],
        ["multiple-declarations", (x) => { x.markdown += x.markdown; }], ["unknown-attribute", (x) => { x.markdown = x.markdown.replace("<div ", '<div unknown="1" '); }],
        ["invalid-av-ID", (x) => { x.markdown = x.markdown.replace(id(3), "bad"); }], ["nested-carrier", (x) => { x.parent_id = id(4); }],
    ]) { const input = structuredClone(carrier); change(input); check(name, !parseCarrier(input).ok); }
    const page = [carrier, { ...carrier, id: id(11) }, { ...carrier, id: id(12) }], p = inspectCarrierPage(page, "", 2);
    check("lookahead-cursor-is-last-processed-never-sentinel", p.ok && p.nextCursor === id(11) && p.processed.length === 2);
    check("duplicate-page-IDs-refused", !inspectCarrierPage([carrier, carrier], "", 2).ok);
    check("backward-cursor-refused", !inspectCarrierPage([carrier], id(11), 2).ok);
    check("oversized-page-refused", !inspectCarrierPage([...page, { ...carrier, id: id(13) }], "", 2).ok);
    const columns = [{ id: id(90), type: "block", name: "Primary Key" }, ...FIELDS.map((name, n) => ({ id: id(100 + n), name, type: "text" }))];
    check("all-eight-fields-map", schemaOf(columns).classification === "matching");
    check("empty-host-schema-is-unrelated", schemaOf(columns.slice(0, 1)).classification === "unrelated");
    for (const field of FIELDS) check(`missing-field-${field}`, !schemaOf(columns.filter((column) => column.name !== field)).ok);
    check("duplicate-field-refused", !schemaOf([...columns, { id: id(200), name: "order", type: "text" }]).ok);
    check("changed-field-type-refused", !schemaOf(columns.map((column) => column.name === "value" ? { ...column, type: "url" } : column)).ok);
    const emptyView = { id: id(3), viewType: "table", viewID: id(301), isMirror: false, contextFilter: null, contextFilterFields: [],
        view: { id: id(301), columns, rows: [], rowCount: 0, filters: [], sorts: [], group: null, groupHidden: 0 } };
    check("free-view-shape-accepted", inspectRender(emptyView, { avID: id(3) }).ok);
    check("hidden-group-refused", !inspectRender({ ...emptyView, view: { ...emptyView.view, groupHidden: 1 } }, { avID: id(3) }).ok);
    check("sort-refused", !inspectRender({ ...emptyView, view: { ...emptyView.view, sorts: [{ column: id(90) }] } }, { avID: id(3) }).ok);
    check("nonarray-method-cells-refused", !methodRow({ id: id(400), cells: {} }, Object.fromEntries(FIELDS.map((name, n) => [name, id(100 + n)]))).ok);
    const methodOwner = id(401), methodSource = "phone-main", methodKeys = Object.fromEntries(FIELDS.map((name, n) => [name, id(100 + n)]));
    const methodValues = { methodId: `method-${createHash("sha256").update(`${methodOwner}:${methodSource}`).digest("hex").slice(0, 24)}`, ownerDocId: methodOwner,
        sourceKey: methodSource, type: "qq", label: "", value: "v", primary: "1", order: "0" };
    const qqRow = { id: id(402), cells: FIELDS.map((field) => ({ valueType: "text", value: { keyID: methodKeys[field], type: "text", blockID: id(402), text: { content: methodValues[field] } } })) };
    check("unsupported-method-type-refused", !methodRow(qqRow, methodKeys).ok);
    check("unknown-overrides-unique", discoveryStatus([{}], true, false, true) === "unknown");
    check("empty-matching-candidate-still-counts", discoveryStatus([{}], false, false, true) === "unique_unowned");
    check("same-content-different-AV-stays-ambiguous", discoveryStatus([{}, {}, {}], false, false, true) === "ambiguous");
    check("empty-current-index-is-not-history", discoveryStatus([], false, false, true) === "not_found_in_observed_scope");
    check("truncated-never-unique", discoveryStatus([{}], false, true, false) === "truncated");
    check("budget-shape-no-extra-context", !validBudget({ ...DEFAULT_BUDGET, oracle: [] }) && validBudget(DEFAULT_BUDGET));
    return { total: checks.length, passed: checks.length, failed: 0, checks };
}

const IPC_ERROR_CLASSES = new Set(["broker-rejected", "transport", "timeout", "request-budget", "request-bytes", "response-bytes", "malformed-response", "host-http", "host-parse"]);
async function ipcReader() {
    let sequence = 0, pending;
    const init = await new Promise((resolveInit, rejectInit) => { const timer = setTimeout(() => rejectInit(new Error("init-timeout")), 5000);
        process.once("message", (message) => { clearTimeout(timer); resolveInit(message); }); });
    assert.ok(record(init) && Object.keys(init).sort().join() === "budget,kind,version" && init.kind === "init" && init.version === 1 && validBudget(init.budget), "invalid-init");
    const budget = init.budget;
    process.on("message", (message) => {
        if (!pending || !record(message) || message.kind !== "response" || message.seq !== pending.seq) { process.exitCode = 1; pending?.reject(new Error("malformed-response")); return; }
        let responseBytes;
        try { responseBytes = Buffer.byteLength(JSON.stringify(message)); } catch { responseBytes = Infinity; }
        if (responseBytes > budget.maxJsonBytes) { const current = pending; pending = undefined; clearTimeout(current.timer); current.reject(new Error("response-bytes")); process.exitCode = 1; return; }
        const keys = Object.keys(message).sort().join();
        if (keys !== "envelope,kind,seq" && keys !== "errorClass,kind,seq") { const current = pending; pending = undefined; clearTimeout(current.timer); current.reject(new Error("malformed-response")); process.exitCode = 1; return; }
        const current = pending; pending = undefined; clearTimeout(current.timer);
        if (message.errorClass) {
            if (typeof message.errorClass !== "string" || !IPC_ERROR_CLASSES.has(message.errorClass)) current.reject(new Error("malformed-response"));
            else current.reject(new Error(message.errorClass));
        } else current.resolve(message.envelope);
    });
    process.on("disconnect", () => { if (pending) { clearTimeout(pending.timer); pending.reject(new Error("IPC-disconnect")); pending = undefined; } });
    const request = (route, body) => new Promise((resolveRequest, rejectRequest) => {
        if (pending || sequence >= budget.maxRequests) return rejectRequest(new Error("IPC-request-budget"));
        const seq = ++sequence, message = { kind: "request", seq, route, body };
        let requestBytes;
        try { requestBytes = Buffer.byteLength(JSON.stringify(message)); } catch { requestBytes = Infinity; }
        if (requestBytes > budget.maxJsonBytes) return rejectRequest(new Error("request-bytes"));
        const timer = setTimeout(() => { pending = undefined; rejectRequest(new Error("IPC-timeout")); }, budget.requestTimeoutMs);
        pending = { seq, resolve: resolveRequest, reject: rejectRequest, timer };
        try { process.send(message); } catch { pending = undefined; clearTimeout(timer); rejectRequest(new Error("transport")); }
    });
    const result = await discover(request, budget);
    let resultBytes;
    try { resultBytes = Buffer.byteLength(JSON.stringify({ kind: "result", result })); } catch { resultBytes = Infinity; }
    assert.ok(resultBytes <= budget.maxJsonBytes, "result-bytes");
    await new Promise((resolveSent, rejectSent) => process.send({ kind: "result", result }, (error) => error ? rejectSent(new Error("transport")) : resolveSent())); process.disconnect();
}
export async function main(args = process.argv.slice(2)) {
    if (args.length === 1 && args[0] === "--ipc-reader" && typeof process.send === "function") await ipcReader();
    else { assert.ok(args.every((arg) => arg === "--dry-run"), "only-dry-run-outside-owned-IPC"); console.log(JSON.stringify({ research: "AG-RF-004-A2-reader", dryRun: true, checks: runChecks(), filesystemWrites: 0, kernelRequests: 0, childProcesses: 0 }, null, 2)); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
