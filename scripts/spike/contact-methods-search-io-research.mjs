/**
 * AG-RF-004-S4: pure JSON IO, contact-method search and result merging research.
 *
 * This is a research-only script. It creates a temporary JSON snapshot with
 * fictional values, reads/parses/serializes/writes it, and exercises a
 * rebuildable in-memory search index. It never calls SiYuan, Plugin storage,
 * the network, or production services. Result files contain counts, hashes,
 * and status codes only; they do not contain contact values.
 *
 * Run:
 *   node scripts/spike/contact-methods-search-io-research.mjs
 *   node scripts/spike/contact-methods-search-io-research.mjs --dry-run
 */
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

const PERSON_COUNT = 10_000;
const METHODS_PER_PERSON = 10;
const TOTAL_METHODS = PERSON_COUNT * METHODS_PER_PERSON;
const MAX_JSON_BYTES = 64 * 1024 * 1024;
const SCHEMA = 1;
const INDEX_SCHEMA = 1;
const TYPES = ["phone", "email", "wechat", "qq", "url", "custom"];
const TYPE_SET = new Set(TYPES);
const SCRIPT_PATH = new URL(import.meta.url);
const RESULT_PATH = path.join(path.dirname(fileURLToPath(SCRIPT_PATH)), "contact-methods-search-io-results.json");
const DRY_RUN = process.argv.includes("--dry-run");

function hash(value) {
    return crypto.createHash("sha256").update(String(value), "utf8").digest("hex").slice(0, 16);
}

function normalize(value) {
    return String(value).normalize("NFKC").toLowerCase();
}

function token(index) {
    return index.toString(36).padStart(6, "0");
}

function expectedKeys(value, keys, code) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(code);
    const actual = Object.keys(value).sort();
    const expected = [...keys].sort();
    if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) throw new Error(code);
}

function canonicalValue(value) {
    if (Array.isArray(value)) return value.map(canonicalValue);
    if (value && typeof value === "object") {
        return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]));
    }
    return value;
}

function canonicalJson(value) {
    return `${JSON.stringify(canonicalValue(value), null, 2)}\n`;
}

function containsControl(value) {
    return /[\u0000-\u001f\u007f]/u.test(value);
}

function validateSnapshot(raw) {
    expectedKeys(raw, ["researchFormat", "revision", "sourceAnchor", "persons", "tombstones"], "snapshot-shape");
    if (raw.researchFormat !== SCHEMA || !Number.isSafeInteger(raw.revision) || raw.revision < 1
        || typeof raw.sourceAnchor !== "string" || !raw.sourceAnchor
        || !Array.isArray(raw.persons) || !Array.isArray(raw.tombstones)) throw new Error("snapshot-header");
    const people = new Set();
    const methods = new Set();
    for (const person of raw.persons) {
        expectedKeys(person, ["personDocId", "itemId", "methods"], "person-shape");
        if (typeof person.personDocId !== "string" || !person.personDocId
            || typeof person.itemId !== "string" || !person.itemId || people.has(person.personDocId)
            || !Array.isArray(person.methods)) throw new Error("person-identity");
        people.add(person.personDocId);
        const primaryByType = new Set();
        const orders = new Set();
        for (const method of person.methods) {
            expectedKeys(method, ["id", "type", "value", "label", "isPrimary", "order"], "method-shape");
            if (typeof method.id !== "string" || !method.id || methods.has(method.id)
                || !TYPE_SET.has(method.type) || typeof method.value !== "string" || !method.value.trim()
                || containsControl(method.value) || typeof method.label !== "string" || containsControl(method.label)
                || typeof method.isPrimary !== "boolean" || !Number.isSafeInteger(method.order) || method.order < 0) {
                throw new Error("method-invalid");
            }
            if (method.isPrimary && primaryByType.has(method.type)) throw new Error("primary-conflict");
            if (method.isPrimary) primaryByType.add(method.type);
            if (orders.has(method.order)) {
                // Equal order is allowed in the candidate; ID supplies the tie-breaker.
            }
            orders.add(method.order);
            methods.add(method.id);
        }
    }
    for (const tombstone of raw.tombstones) {
        expectedKeys(tombstone, ["personDocId", "methodId", "deletedRevision"], "tombstone-shape");
        if (typeof tombstone.personDocId !== "string" || typeof tombstone.methodId !== "string"
            || !Number.isSafeInteger(tombstone.deletedRevision) || tombstone.deletedRevision < 1
            || tombstone.deletedRevision > raw.revision) throw new Error("tombstone-invalid");
    }
    return raw;
}

function parseSnapshot(text) {
    if (typeof text !== "string" || Buffer.byteLength(text, "utf8") > MAX_JSON_BYTES) throw new Error("snapshot-too-large");
    let raw;
    try { raw = JSON.parse(text); } catch { throw new Error("snapshot-json-invalid"); }
    return validateSnapshot(raw);
}

function makeSnapshot(personCount = PERSON_COUNT) {
    const persons = Array.from({ length: personCount }, (_, index) => {
        const id = token(index);
        const methods = [
            ["phone", `+00 100 ${id}`, "work", true], ["phone", `+00 200 ${id}`, "spare", false],
            ["email", `work-${id}@example.test`, "work", true], ["email", `private-${id}@example.test`, "private", false],
            ["wechat", `fictional-${id}-work`, "work", true], ["wechat", `fictional-${id}-spare`, "spare", false],
            ["qq", `000-${id}`, "example", true], ["url", `https://example.test/person/${id}/work`, "work", true],
            ["url", `https://example.test/person/${id}/spare`, "spare", false], ["custom", `example-spare-${id}`, "custom", true],
        ].map(([type, value, label, isPrimary], order) => ({
            id: `method-${id}-${order}`, type, value, label, isPrimary, order,
        }));
        return { personDocId: `person-${id}`, itemId: `row-${id}`, methods };
    });
    const snapshot = { researchFormat: SCHEMA, revision: 7, sourceAnchor: "fictional-av-anchor-v1", persons, tombstones: [] };
    validateSnapshot(snapshot);
    return snapshot;
}

function buildRows(snapshot) {
    return snapshot.persons.flatMap((person, personOrdinal) => person.methods.map((method) => ({
        personOrdinal, personDocId: person.personDocId, itemId: person.itemId, methodId: method.id,
        normalizedValue: normalize(method.value), valueHash: hash(method.value),
    })));
}

function trigrams(value) {
    const chars = Array.from(value);
    return [...new Set(Array.from({ length: Math.max(0, chars.length - 2) }, (_, index) => chars.slice(index, index + 3).join("")))];
}

function buildIndex(rows, snapshot, state = "valid") {
    const postings = new Map();
    rows.forEach((row, rowOrdinal) => {
        for (const gram of trigrams(row.normalizedValue)) {
            const posting = postings.get(gram) ?? [];
            posting.push(rowOrdinal);
            postings.set(gram, posting);
        }
    });
    return { indexFormat: INDEX_SCHEMA, methodsRevision: snapshot.revision, sourceAnchor: snapshot.sourceAnchor,
        state, rows, postings, postingCount: [...postings.values()].reduce((sum, values) => sum + values.length, 0) };
}

function indexState(index, snapshot) {
    if (!index) return "missing";
    if (index.state === "rebuilding" || index.state === "cancelled") return index.state;
    if (index.indexFormat !== INDEX_SCHEMA || !Array.isArray(index.rows) || !(index.postings instanceof Map)) return "invalid";
    if (index.methodsRevision !== snapshot.revision || index.sourceAnchor !== snapshot.sourceAnchor) return "stale";
    return "valid";
}

function percentile(values, fraction) {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? 0;
}

async function boundedScan(rows, query, options = {}) {
    const needle = normalize(query);
    const maxMethods = Math.max(0, Math.min(rows.length, options.maxMethods ?? rows.length));
    const chunkSize = Math.max(1, options.chunkSize ?? 2_000);
    const cancelAfter = options.cancelAfter ?? Number.POSITIVE_INFINITY;
    const matches = new Set();
    const matchedRows = [];
    let visited = 0;
    while (visited < maxMethods) {
        if (visited >= cancelAfter) return { rows: [], personOrdinals: [...matches], visited, complete: false, status: "cancelled", fallback: true };
        const end = Math.min(maxMethods, visited + chunkSize);
        for (; visited < end; visited += 1) {
            const row = rows[visited];
            if (row.normalizedValue.includes(needle)) { matches.add(row.personOrdinal); matchedRows.push(row); }
        }
        if (visited < maxMethods) await new Promise((resolve) => setImmediate(resolve));
    }
    const complete = maxMethods === rows.length;
    return { rows: matchedRows, personOrdinals: [...matches], visited,
        complete, status: complete ? "complete" : "partial", fallback: true };
}

async function indexedSearch(index, query, options = {}) {
    const needle = normalize(query);
    const grams = trigrams(needle);
    if (!grams.length) return boundedScan(index.rows, query, options);
    let smallest = null;
    for (const gram of grams) {
        const posting = index.postings.get(gram);
        if (!posting) return { rows: [], personOrdinals: [], visited: 0, complete: true, status: "complete", fallback: false };
        if (!smallest || posting.length < smallest.length) smallest = posting;
    }
    const rows = [];
    const people = new Set();
    for (const rowOrdinal of smallest) {
        const row = index.rows[rowOrdinal];
        if (row.normalizedValue.includes(needle)) { rows.push(row); people.add(row.personOrdinal); }
    }
    return { rows, personOrdinals: [...people], visited: smallest.length, complete: true, status: "complete", fallback: false };
}

async function searchMethods(snapshot, rows, query, index, options = {}) {
    const state = indexState(index, snapshot);
    if (state === "valid") return { indexState: state, ...(await indexedSearch(index, query, options)) };
    if (state === "cancelled" && options.cancelIndexFallback !== false) {
        const fallback = await boundedScan(rows, query, options);
        return { indexState: state, ...fallback, status: fallback.complete ? "complete-fallback" : fallback.status };
    }
    const fallback = await boundedScan(rows, query, options);
    return { indexState: state, ...fallback, status: fallback.complete ? "complete-fallback" : fallback.status };
}

function methodHitsFromSearch(search) {
    return search.rows.map((row) => ({ personDocId: row.personDocId, itemId: row.itemId, methodId: row.methodId, source: "method" }));
}

function mergeSearchResults({ avHits = [], methodHits = [], relatedHits = [], methodSearch }) {
    const merge = (hits) => {
        const byKey = new Map();
        const conflicts = [];
        for (const hit of hits) {
            if (!hit || typeof hit.personDocId !== "string" || typeof hit.itemId !== "string") { conflicts.push("invalid-hit"); continue; }
            // The person document is the stable result identity. An itemId change
            // is retained as a conflict rather than creating a second person row.
            const key = hit.personDocId;
            let item = byKey.get(key);
            if (!item) {
                item = { personDocId: hit.personDocId, itemIds: new Set(), sources: new Set(), methodIds: new Set() };
                byKey.set(key, item);
            }
            const beforeItemIds = item.itemIds.size;
            item.itemIds.add(hit.itemId);
            if (item.itemIds.size > beforeItemIds && item.itemIds.size > 1) conflicts.push("item-id-conflict");
            item.sources.add(hit.source ?? "unknown");
            if (hit.methodId) item.methodIds.add(hash(hit.methodId));
        }
        return {
            hits: [...byKey.values()].map((item) => ({ personDocIdHash: hash(item.personDocId), itemIdHashes: [...item.itemIds].sort().map(hash),
                sources: [...item.sources].sort(), methodIdHashes: [...item.methodIds].sort() })),
            conflicts,
        };
    };
    const own = merge([...avHits, ...methodHits]);
    const related = merge(relatedHits.map((hit) => ({ ...hit, source: "related" })));
    return {
        own, related,
        ownCount: own.hits.length,
        relatedCount: related.hits.length,
        complete: Boolean(methodSearch?.complete) && own.conflicts.length === 0,
        status: methodSearch?.status ?? "complete",
        indexState: methodSearch?.indexState ?? "missing",
        fallback: methodSearch?.fallback ?? true,
    };
}

function paginateHits(hits, { pageSize = 200, cancelAfterPages = Number.POSITIVE_INFINITY } = {}) {
    if (!Number.isSafeInteger(pageSize) || pageSize < 1) throw new Error("page-size-invalid");
    const pages = [];
    let visited = 0;
    while (visited < hits.length) {
        if (pages.length >= cancelAfterPages) return { pages, visited, complete: false, status: "cancelled" };
        const end = Math.min(hits.length, visited + pageSize);
        pages.push({ page: pages.length + 1, count: end - visited, hasMore: end < hits.length });
        visited = end;
    }
    return { pages, visited, complete: true, status: "complete" };
}

function redactError(error) {
    return error instanceof Error ? error.message.replace(/[+\w@.:-]{8,}/g, "<redacted>") : "unknown-error";
}

async function roundTripJson(directory, fileName, value, options = {}) {
    const target = path.join(directory, fileName);
    const temp = `${target}.tmp`;
    const serializeStarted = performance.now();
    const canonical = canonicalJson(value);
    const serializeMs = performance.now() - serializeStarted;
    const start = performance.now();
    let parsed;
    try {
        if (options.writeFailure) throw new Error("write-rejected");
        const writeStarted = performance.now();
        await fs.writeFile(temp, canonical, "utf8");
        if (options.tamperBeforeReadBack) await fs.writeFile(temp, canonical.replace('"revision": 7', '"revision": 8'), "utf8");
        await fs.rename(temp, target);
        const writeMs = performance.now() - writeStarted;
        const readStarted = performance.now();
        const bytes = await fs.readFile(target, "utf8");
        parsed = options.invalidReadBack ? `${bytes.slice(0, Math.max(1, bytes.length - 7))}` : bytes;
        const readMs = performance.now() - readStarted;
        const parseStarted = performance.now();
        const reparsed = parseSnapshot(parsed);
        const parseMs = performance.now() - parseStarted;
        const rereadSerializeStarted = performance.now();
        const canonicalRead = canonicalJson(reparsed);
        const rereadSerializeMs = performance.now() - rereadSerializeStarted;
        const expectedDigest = hash(canonical);
        const actualDigest = hash(canonicalRead);
        const status = expectedDigest === actualDigest ? "verified" : "unknown";
        return { file: fileName, status, bytes: Buffer.byteLength(bytes, "utf8"), canonicalBytes: Buffer.byteLength(canonical, "utf8"),
            expectedDigest, actualDigest, serializeMs, writeMs, readMs, parseMs, rereadSerializeMs, milliseconds: performance.now() - start };
    } catch (error) {
        return { file: fileName, status: options.writeFailure ? "rejected" : "unknown", bytes: 0,
            errorCode: options.writeFailure ? "write-rejected" : redactError(error), milliseconds: performance.now() - start };
    } finally {
        await fs.rm(temp, { force: true }).catch(() => {});
    }
}

async function ioMatrix(directory, snapshot) {
    const verified = await roundTripJson(directory, "methods.json", snapshot);
    const largeSnapshot = makeSnapshot();
    const largeVerified = await roundTripJson(directory, "methods-large.json", largeSnapshot);
    const tampered = await roundTripJson(directory, "methods-tampered.json", snapshot, { tamperBeforeReadBack: true });
    const rejected = await roundTripJson(directory, "methods-rejected.json", snapshot, { writeFailure: true });
    const invalidTexts = [
        ["bad-json", "{\"researchFormat\":1"],
        ["truncated", canonicalJson(snapshot).slice(0, -23)],
        ["unknown-field", canonicalJson({ ...snapshot, unexpected: true })],
    ];
    const parseChecks = invalidTexts.map(([id, text]) => {
        try { parseSnapshot(text); return { id, status: "unexpected-accepted", pass: false }; }
        catch (error) { return { id, status: "rejected", errorCode: redactError(error), pass: true }; }
    });
    return { verified, largeVerified, tampered, rejected, parseChecks };
}

function fixtureSearchRows(snapshot, rows) {
    const first = snapshot.persons[1];
    const second = snapshot.persons[2];
    const third = snapshot.persons[3];
    const avHits = [{ personDocId: first.personDocId, itemId: first.itemId, source: "av" }, { personDocId: third.personDocId, itemId: third.itemId, source: "av" }];
    const samePersonMethod = rows.filter((row) => row.personDocId === first.personDocId && row.methodId.endsWith("-1"))[0];
    const otherPersonMethod = rows.filter((row) => row.personDocId === second.personDocId && row.methodId.endsWith("-1"))[0];
    const sameValueA = { personDocId: "person-same-a", itemId: "row-same-a", methodId: "method-same-a", source: "method" };
    const sameValueB = { personDocId: "person-same-b", itemId: "row-same-b", methodId: "method-same-b", source: "method" };
    return { avHits, samePersonMethod: { ...samePersonMethod, source: "method" }, otherPersonMethod: { ...otherPersonMethod, source: "method" },
        sameValueA, sameValueB, relatedHits: [{ personDocId: second.personDocId, itemId: second.itemId }] };
}

function check(id, pass, details = {}) {
    return { id, pass: Boolean(pass), ...details };
}

async function runResearch() {
    const checks = [];
    const small = makeSnapshot(4);
    checks.push(check("strict-canonical-roundtrip", (() => {
        const text = canonicalJson(small); return canonicalJson(parseSnapshot(text)) === text;
    })()));
    checks.push(check("strict-unknown-field-rejected", (() => {
        try { parseSnapshot(canonicalJson({ ...small, nope: 1 })); return false; } catch { return true; }
    })()));
    checks.push(check("cross-person-same-value-not-merged", (() => {
        const merged = mergeSearchResults({ avHits: [], methodHits: [{ personDocId: "a", itemId: "ra", methodId: "ma", source: "method" }, { personDocId: "b", itemId: "rb", methodId: "mb", source: "method" }], methodSearch: { complete: true, status: "complete", indexState: "valid" } });
        return merged.ownCount === 2;
    })()));
    checks.push(check("same-person-av-and-method-dedup", (() => {
        const merged = mergeSearchResults({ avHits: [{ personDocId: "a", itemId: "ra", source: "av" }], methodHits: [{ personDocId: "a", itemId: "ra", methodId: "ma", source: "method" }], methodSearch: { complete: true, status: "complete", indexState: "valid" } });
        return merged.ownCount === 1 && merged.own.hits[0].sources.join(",") === "av,method";
    })()));
    checks.push(check("stable-doc-dedup-item-conflict", (() => {
        const merged = mergeSearchResults({ avHits: [{ personDocId: "a", itemId: "old-row", source: "av" }], methodHits: [{ personDocId: "a", itemId: "new-row", methodId: "ma", source: "method" }], methodSearch: { complete: true, status: "complete", indexState: "valid" } });
        return merged.ownCount === 1 && merged.own.conflicts.includes("item-id-conflict") && !merged.complete;
    })()));
    checks.push(check("related-kept-separate", (() => {
        const merged = mergeSearchResults({ avHits: [{ personDocId: "a", itemId: "ra", source: "av" }], relatedHits: [{ personDocId: "b", itemId: "rb" }], methodSearch: { complete: true, status: "complete", indexState: "valid" } });
        return merged.ownCount === 1 && merged.relatedCount === 1;
    })()));

    const snapshot = makeSnapshot();
    const rows = buildRows(snapshot);
    const buildSamples = [];
    let index;
    for (let trial = 0; trial < 3; trial += 1) {
        const started = performance.now(); index = buildIndex(rows, snapshot); buildSamples.push(performance.now() - started);
    }
    const fixtures = fixtureSearchRows(snapshot, rows);
    const query = snapshot.persons[2].methods[1].value;
    const valid = await searchMethods(snapshot, rows, query, index);
    const missing = await searchMethods(snapshot, rows, query, null);
    const stale = await searchMethods({ ...snapshot, revision: snapshot.revision + 1 }, rows, query, index);
    const invalid = await searchMethods(snapshot, rows, query, { indexFormat: 999, rows: [], postings: new Map(), methodsRevision: snapshot.revision, sourceAnchor: snapshot.sourceAnchor });
    const rebuilding = await searchMethods(snapshot, rows, query, { ...index, state: "rebuilding" }, { maxMethods: 50 });
    const cancelled = await searchMethods(snapshot, rows, query, { ...index, state: "cancelled" }, { cancelAfter: 0 });
    const partial = await searchMethods(snapshot, rows, query, null, { maxMethods: 500, chunkSize: 100 });
    checks.push(check("valid-index-complete", valid.complete && valid.status === "complete" && valid.indexState === "valid"));
    checks.push(check("missing-index-fallback-complete", missing.complete && missing.status === "complete-fallback" && missing.indexState === "missing"));
    checks.push(check("stale-index-fallback-complete", stale.complete && stale.status === "complete-fallback" && stale.indexState === "stale"));
    checks.push(check("invalid-index-fallback-complete", invalid.complete && invalid.status === "complete-fallback" && invalid.indexState === "invalid"));
    checks.push(check("rebuilding-budget-partial", !rebuilding.complete && rebuilding.status === "partial" && rebuilding.indexState === "rebuilding"));
    checks.push(check("cancelled-never-fake-empty", !cancelled.complete && cancelled.status === "cancelled" && cancelled.indexState === "cancelled"));
    checks.push(check("budget-partial-never-complete", !partial.complete && partial.status === "partial" && partial.visited === 500));
    const merged = mergeSearchResults({ avHits: fixtures.avHits, methodHits: [fixtures.samePersonMethod, fixtures.otherPersonMethod], relatedHits: fixtures.relatedHits, methodSearch: valid });
    checks.push(check("merge-cross-source-summary", merged.ownCount === 3 && merged.relatedCount === 1));
    checks.push(check("merge-preserves-method-source", merged.own.hits.some((hit) => hit.sources.includes("av") && hit.sources.includes("method"))));
    checks.push(check("merge-same-value-cross-person", mergeSearchResults({ methodHits: [fixtures.sameValueA, fixtures.sameValueB], methodSearch: valid }).ownCount === 2));
    const paged = paginateHits(rows.slice(0, 401), { pageSize: 200 });
    const cancelledPages = paginateHits(rows.slice(0, 401), { pageSize: 200, cancelAfterPages: 1 });
    checks.push(check("pagination-complete-pages", paged.complete && paged.status === "complete" && paged.pages.length === 3
        && paged.pages[1].hasMore === true && paged.pages[2].hasMore === false && paged.visited === 401));
    checks.push(check("pagination-cancelled-not-complete", !cancelledPages.complete && cancelledPages.status === "cancelled"
        && cancelledPages.pages.length === 1 && cancelledPages.visited === 200));

    const parent = await fs.mkdtemp(path.join(os.tmpdir(), "lvct-s4-"));
    let io;
    try { io = await ioMatrix(parent, small); }
    finally { await fs.rm(parent, { recursive: true, force: true }); }
    checks.push(check("io-verified-write-readback", io.verified.status === "verified" && io.verified.bytes > 0));
    checks.push(check("io-readback-mismatch-unknown", io.tampered.status === "unknown"));
    checks.push(check("io-write-rejection-separated", io.rejected.status === "rejected"));
    checks.push(...io.parseChecks.map((entry) => check(`io-${entry.id}-rejected`, entry.pass)));

    const measurements = {
        fixturePersons: PERSON_COUNT, fixtureMethods: TOTAL_METHODS,
        snapshotCanonicalBytes: Buffer.byteLength(canonicalJson(snapshot), "utf8"),
        indexBuild: { trials: buildSamples.length, medianMs: percentile(buildSamples, 0.5), p95Ms: percentile(buildSamples, 0.95), postingCount: index.postingCount },
        searchStatuses: [valid, missing, stale, invalid, rebuilding, cancelled, partial].map((entry) => ({ indexState: entry.indexState, status: entry.status, complete: entry.complete, visited: entry.visited, matchCount: entry.rows.length })),
        io: { small: { bytes: io.verified.bytes, canonicalBytes: io.verified.canonicalBytes, milliseconds: io.verified.milliseconds },
            large: { bytes: io.largeVerified.bytes, canonicalBytes: io.largeVerified.canonicalBytes, milliseconds: io.largeVerified.milliseconds,
                serializeMs: io.largeVerified.serializeMs, writeMs: io.largeVerified.writeMs, readMs: io.largeVerified.readMs,
                parseMs: io.largeVerified.parseMs, rereadSerializeMs: io.largeVerified.rereadSerializeMs },
            tamperedStatus: io.tampered.status, rejectedStatus: io.rejected.status },
    };
    const output = {
        generatedAt: new Date().toISOString(), issues: [51, 54], evidence: "synthetic-json-io-search-research",
        syntheticOnly: true, kernelRequests: 0, productionChanges: false, candidateContractAccepted: false,
        fixture: { persons: PERSON_COUNT, methods: TOTAL_METHODS, methodsPerPerson: METHODS_PER_PERSON, valuesRedacted: true },
        invariants: ["stable personDocId deduplicates AV and method hits while itemId changes are conflicts", "cross-person same values remain separate", "index candidates are finally verified", "partial/cancelled/invalid index states never become fake empty complete", "JSON read/write mismatch is unknown", "pagination cancellation is not complete", "related expansion remains separate from own hits"],
        measurements, checks, summary: { total: checks.length, passed: checks.filter((entry) => entry.pass).length, failed: checks.filter((entry) => !entry.pass).length },
        scope: { noHostIO: true, noPluginStorage: true, noNetwork: true, noProductionFiles: true,
            exclusions: ["Plugin loadData/saveData and Web Locks", "SiYuan AV query and UI debounce", "cross-window cache invalidation", "D1 fact-source choice", "production search or migration schema"] },
        ok: checks.every((entry) => entry.pass),
    };
    return output;
}

const result = await runResearch();
if (!DRY_RUN) {
    await fs.writeFile(RESULT_PATH, `${JSON.stringify(result, null, 2)}\n`, "utf8");
}
console.log(JSON.stringify({ resultPath: DRY_RUN ? null : RESULT_PATH, dryRun: DRY_RUN, summary: result.summary,
    io: result.measurements.io, searchStatuses: result.measurements.searchStatuses, ok: result.ok }, null, 2));
if (!result.ok) process.exitCode = 1;

