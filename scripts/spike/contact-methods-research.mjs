/**
 * Issue #51/#54 research only: candidate identities, compatibility and search.
 * No SiYuan/API/plugin store access. All values are fictional. The only output
 * is contact-methods-research-results.json beside this script. This is not a
 * production schema, migration, vCard adapter or accepted performance budget.
 * Run: node --expose-gc scripts/spike/contact-methods-research.mjs
 */
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { performance } from "node:perf_hooks";
import { parseVcfForImport } from "../../src/domain/vcard.ts";

const PERSON_COUNT = 10_000;
const METHODS_PER_PERSON = 10;
const TOTAL_METHODS = PERSON_COUNT * METHODS_PER_PERSON;
const BUILD_TRIALS = 5;
const QUERY_TRIALS = 7;
const TYPES = new Set(["phone", "email", "wechat", "qq", "url", "custom"]);
const normalize = (value) => value.normalize("NFKC").toLowerCase();
const docId = (index) => `20261016000000-p${index.toString(36).padStart(6, "0")}`;
const ordinal = (index) => String(index).padStart(5, "0");
const gc = () => { if (typeof globalThis.gc === "function") globalThis.gc(); };
const bytesToMiB = (value) => Number((value / 1024 / 1024).toFixed(3));
const percentile = (values, fraction) => [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * fraction) - 1)] ?? 0;

function makeFixture() {
    return { researchFormat: 1, revision: 7, persons: Array.from({ length: PERSON_COUNT }, (_, index) => {
        const token = ordinal(index);
        const values = [
            ["phone", `+00 100 ${token}`, "工作", true], ["phone", `+00 200 ${token}`, "备用", false],
            ["email", `work-${token}@example.test`, "工作", true], ["email", `private-${token}@example.test`, "私人", false],
            ["wechat", `fictional-${token}-work`, "工作", true], ["wechat", `fictional-${token}-spare`, "备用", false],
            ["qq", `000-${token}`, "示例", true], ["url", `https://example.test/person/${token}/work`, "工作", true],
            ["url", `https://example.test/person/${token}/spare`, "备用", false], ["custom", `示例备用-${token}`, "自定义", true],
        ];
        return { personDocId: docId(index), itemId: `fictional-row-${index}`, name: `虚构人物 ${token}`,
            methods: values.map(([type, value, label, isPrimary], slot) => ({ id: `method-${token}-${slot}`, type, value, label, isPrimary, order: slot })) };
    }), tombstones: [] };
}

/** Candidate strict snapshot preview, not a plugin store parser. */
function snapshotPreview(raw) {
    if (!raw || raw.researchFormat !== 1 || !Array.isArray(raw.persons) || !Array.isArray(raw.tombstones)) throw new Error("research-snapshot-unknown");
    const people = new Set();
    const persons = raw.persons.map((person) => {
        if (!person || typeof person.personDocId !== "string" || !person.personDocId || people.has(person.personDocId) || !Array.isArray(person.methods)) throw new Error("research-person-invalid");
        people.add(person.personDocId);
        const ids = new Set();
        const primaries = new Set();
        return { ...person, methods: person.methods.map((method) => {
            if (!method || typeof method.id !== "string" || !method.id || ids.has(method.id)
                || !TYPES.has(method.type) || typeof method.value !== "string" || !method.value.trim()
                || typeof method.label !== "string" || typeof method.isPrimary !== "boolean"
                || !Number.isSafeInteger(method.order) || method.order < 0) throw new Error("research-method-invalid");
            ids.add(method.id);
            if (method.isPrimary && primaries.has(method.type)) throw new Error("research-primary-conflict");
            if (method.isPrimary) primaries.add(method.type);
            return { ...method };
        }) };
    });
    return { ...raw, persons, tombstones: raw.tombstones.map((item) => ({ ...item })) };
}

function makeLegacyFixture() {
    return Array.from({ length: PERSON_COUNT }, (_, index) => ({ personDocId: docId(index), itemId: `fictional-row-${index}`,
        phone: `+00 100 ${ordinal(index)} / +00 200 ${ordinal(index)}`,
        email: `legacy-${ordinal(index)}@example.test`, wechat: `legacy_${ordinal(index)}`, website: `https://example.test/legacy/${ordinal(index)}` }));
}

function legacyMigrationPreview(people) {
    return people.map((person) => ({ personDocId: person.personDocId, itemId: person.itemId,
        methods: [["phone", "phone"], ["email", "email"], ["wechat", "wechat"], ["website", "url"]]
            .filter(([field]) => person[field] !== "")
            .map(([field, type], order) => ({
                // Identity depends on the original person/field slot, never its value.
                id: `legacy-${createHash("sha256").update(JSON.stringify([person.personDocId, field])).digest("hex").slice(0, 24)}`,
                type, value: person[field], label: "旧值", isPrimary: true, order, source: { kind: "legacy-av", field },
                needsSplitReview: field === "phone" && person[field].includes(" / "),
            })) }));
}

function buildRows(fixture) {
    return fixture.persons.flatMap((person, personOrdinal) => person.methods.map((method) => ({
        personOrdinal, personDocId: person.personDocId, methodId: method.id, normalizedValue: normalize(method.value),
    })));
}

function trigrams(value) {
    const points = Array.from(value);
    return [...new Set(Array.from({ length: Math.max(0, points.length - 2) }, (_, i) => points.slice(i, i + 3).join("")))];
}

function buildIndex(fixture) {
    const rows = buildRows(fixture);
    const postings = new Map();
    rows.forEach((row, rowOrdinal) => {
        for (const gram of trigrams(row.normalizedValue)) {
            let posting = postings.get(gram);
            if (!posting) postings.set(gram, posting = []);
            posting.push(rowOrdinal);
        }
    });
    return { rows, postings, postingCount: [...postings.values()].reduce((sum, posting) => sum + posting.length, 0) };
}

/** Bounded, chunked fallback; incomplete/aborted is never an empty-success. */
async function boundedScan(rows, query, { maxMethods = TOTAL_METHODS, chunkSize = 2_000, cancelled = () => false } = {}) {
    const needle = normalize(query);
    const matches = new Set();
    let visited = 0;
    const limit = Math.min(rows.length, maxMethods);
    while (visited < limit) {
        if (cancelled()) return { personOrdinals: [...matches], visited, complete: false, status: "cancelled", fallback: true };
        const end = Math.min(limit, visited + chunkSize);
        for (; visited < end; visited += 1) {
            if (rows[visited].normalizedValue.includes(needle)) matches.add(rows[visited].personOrdinal);
        }
        if (visited < limit) await new Promise((resolve) => setImmediate(resolve));
    }
    return { personOrdinals: [...matches], visited, complete: limit === rows.length, status: limit === rows.length ? "complete" : "partial", fallback: true };
}

async function indexedSearch(index, query) {
    const needle = normalize(query);
    const grams = trigrams(needle);
    if (!grams.length) return boundedScan(index.rows, query);
    let smallest = null;
    for (const gram of grams) {
        const posting = index.postings.get(gram);
        if (!posting) return { personOrdinals: [], visited: 0, complete: true, status: "complete", fallback: false };
        if (!smallest || posting.length < smallest.length) smallest = posting;
    }
    const matches = new Set();
    for (const rowOrdinal of smallest) {
        const row = index.rows[rowOrdinal];
        // Trigrams select candidates only; final literal verification prevents false positives.
        if (row.normalizedValue.includes(needle)) matches.add(row.personOrdinal);
    }
    return { personOrdinals: [...matches], visited: smallest.length, complete: true, status: "complete", fallback: false };
}

const PROBES = [
    { id: "primary-phone-exact", value: "+00 100 09876", expectedCount: 1 },
    { id: "secondary-phone-exact", value: "+00 200 09876", expectedCount: 1 },
    { id: "secondary-email-case-insensitive", value: "PRIVATE-09876@EXAMPLE.TEST", expectedCount: 1 },
    { id: "secondary-wechat-substring", value: "9876-spare", expectedCount: 1 },
    { id: "secondary-url-exact", value: "https://example.test/person/09876/spare", expectedCount: 1 },
    { id: "unicode-value", value: "示例备用-09876", expectedCount: 1 },
    { id: "broad-email-substring", value: "@example.test", expectedCount: PERSON_COUNT },
    { id: "short-unicode-fallback", value: "备用", expectedCount: PERSON_COUNT },
    { id: "absent-value", value: "no-such-method-value", expectedCount: 0 },
];

function projectionOutcome({ desired, baseline, observed, requestStatus, sameTarget = true }) {
    if (!sameTarget) return "target_conflict";
    if (observed === undefined) return "unknown";
    if (observed === desired) return "verified";
    if (observed !== baseline) return "native_edit_conflict";
    return requestStatus === "rejected" ? "explicit_retry_allowed" : "unknown";
}

function backupMergePreview(current, incoming) {
    const currentCopy = snapshotPreview(current);
    const backup = snapshotPreview(incoming);
    const key = (personDocId, id) => JSON.stringify([personDocId, id]);
    const deleted = new Set([...currentCopy.tombstones, ...backup.tombstones].map((entry) => key(entry.personDocId, entry.methodId)));
    const byPerson = new Map(currentCopy.persons.map((person) => [person.personDocId, person]));
    const conflicts = [];
    let skippedDeleted = 0;
    for (const person of currentCopy.persons) person.methods = person.methods.filter((method) => !deleted.has(key(person.personDocId, method.id)));
    for (const person of backup.persons) {
        let target = byPerson.get(person.personDocId);
        if (!target) { target = { ...person, methods: [] }; currentCopy.persons.push(target); byPerson.set(person.personDocId, target); }
        for (const method of person.methods) {
            if (deleted.has(key(person.personDocId, method.id))) { skippedDeleted += 1; continue; }
            const previous = target.methods.find((entry) => entry.id === method.id);
            if (!previous) target.methods.push({ ...method });
            else if (!isDeepStrictEqual(previous, method)) conflicts.push({ personDocId: person.personDocId, methodId: method.id });
        }
    }
    return { preview: currentCopy, conflicts, skippedDeleted };
}

async function verifyCandidate() {
    const checks = [];
    const check = (id, pass, detail = "") => checks.push({ id, pass: Boolean(pass), ...(detail ? { detail } : {}) });
    const fixture = makeFixture();
    const index = buildIndex(fixture);
    check("fixture-counts", fixture.persons.length === PERSON_COUNT && index.rows.length === TOTAL_METHODS);
    for (const probe of PROBES) {
        const scan = await boundedScan(index.rows, probe.value);
        const indexed = await indexedSearch(index, probe.value);
        check(`search-equivalence:${probe.id}`, scan.complete && indexed.complete
            && isDeepStrictEqual(scan.personOrdinals, indexed.personOrdinals) && indexed.personOrdinals.length === probe.expectedCount,
        `expected=${probe.expectedCount}, scanned=${scan.personOrdinals.length}, indexed=${indexed.personOrdinals.length}`);
    }
    check("secondary-email-not-in-av-primary", !fixture.persons[9876].methods.filter((method) => method.isPrimary).some((method) => normalize(method.value).includes("private-09876")));
    const partial = await boundedScan(index.rows, PROBES[2].value, { maxMethods: 2_000 });
    check("bounded-scan-is-explicitly-incomplete", !partial.complete && partial.status === "partial" && partial.personOrdinals.length === 0 && partial.visited === 2_000);
    const cancelled = await boundedScan(index.rows, "anything", { cancelled: () => true });
    check("cancelled-scan-is-not-empty-success", !cancelled.complete && cancelled.status === "cancelled" && cancelled.visited === 0);
    const original = fixture.persons[0];
    const updated = { ...original, name: "虚构人物改名", methods: original.methods.map((method) => ({ ...method, label: "改过标签", value: `${method.value}-edited`, order: 20 - method.order })).reverse() };
    check("identity-survives-rename-value-label-order", isDeepStrictEqual(original.methods.map((method) => method.id).sort(), updated.methods.map((method) => method.id).sort()));
    const legacy = makeLegacyFixture();
    const migrated = legacyMigrationPreview(legacy);
    check("legacy-delimiter-preserved-not-split", migrated.length === PERSON_COUNT && migrated.every((person, i) => person.methods.length === 4 && person.methods[0].value === legacy[i].phone && person.methods[0].needsSplitReview));
    const changedLegacy = legacyMigrationPreview([{ ...legacy[0], phone: "+00 changed / still one" }])[0];
    check("legacy-slot-identity-not-derived-from-value", changedLegacy.methods[0].id === migrated[0].methods[0].id);
    check("same-value-different-person-is-not-same-identity", legacyMigrationPreview([{ ...legacy[0], personDocId: docId(1) }])[0].methods[0].id !== migrated[0].methods[0].id);
    const mini = { researchFormat: 1, revision: 1, persons: [{ ...original, methods: original.methods.map((method) => ({ ...method })) }], tombstones: [] };
    for (const [id, mutate] of [
        ["unknown-format-rejected", (raw) => { raw.researchFormat = 999; }],
        ["unknown-type-rejected", (raw) => { raw.persons[0].methods[0].type = "unknown"; }],
        ["duplicate-method-id-rejected", (raw) => { raw.persons[0].methods[1].id = raw.persons[0].methods[0].id; }],
        ["multiple-primary-rejected", (raw) => { raw.persons[0].methods[1].isPrimary = true; }],
    ]) {
        const raw = structuredClone(mini); mutate(raw); const before = JSON.stringify(raw); let rejected = false;
        try { snapshotPreview(raw); } catch { rejected = true; }
        check(id, rejected && before === JSON.stringify(raw));
    }
    const deleted = structuredClone(mini);
    const removed = deleted.persons[0].methods.splice(1, 1)[0];
    deleted.tombstones.push({ personDocId: original.personDocId, methodId: removed.id, deletedRevision: 2 });
    const merge = backupMergePreview(deleted, mini);
    check("old-backup-does-not-resurrect-tombstoned-id", merge.skippedDeleted === 1 && !merge.preview.persons[0].methods.some((method) => method.id === removed.id));
    const conflictBackup = structuredClone(mini); conflictBackup.persons[0].methods[0].value = "+00 changed";
    const conflicts = backupMergePreview(mini, conflictBackup);
    check("same-id-backup-conflict-preserves-current", conflicts.conflicts.length === 1 && conflicts.preview.persons[0].methods[0].value === original.methods[0].value);
    check("projection-response-loss-readback-verifies", projectionOutcome({ desired: "new", baseline: "old", observed: "new", requestStatus: "unknown" }) === "verified");
    check("projection-unconfirmed-does-not-replay", projectionOutcome({ desired: "new", baseline: "old", observed: "old", requestStatus: "unknown" }) === "unknown");
    check("native-edit-becomes-conflict", projectionOutcome({ desired: "new", baseline: "old", observed: "external", requestStatus: "accepted" }) === "native_edit_conflict");
    check("target-rebinding-stops-projection", projectionOutcome({ desired: "new", baseline: "old", observed: "new", requestStatus: "accepted", sameTarget: false }) === "target_conflict");
    const vcard = ["BEGIN:VCARD", "VERSION:3.0", "FN:虚构多值人物", "TEL;TYPE=WORK,CELL:+00 111", "TEL;TYPE=HOME:+00 222", "EMAIL;TYPE=WORK:work@example.test", "EMAIL;TYPE=HOME:home@example.test", "URL:https://example.test/work", "URL:https://example.test/home", "END:VCARD"].join("\r\n");
    const observed = parseVcfForImport(vcard)[0];
    check("production-vcard-limit-observed", observed.phone === "+00 111 / +00 222" && observed.email === "work@example.test" && observed.website === "https://example.test/work");
    return { checks, summary: { total: checks.length, passed: checks.filter((entry) => entry.pass).length, failed: checks.filter((entry) => !entry.pass).length },
        vcardObservation: { input: { TEL: 2, EMAIL: 2, URL: 2 }, currentOutput: { phone: observed.phone, email: observed.email, website: observed.website },
            tested: "Existing pure parser only; candidate full vCard parser/serializer and arbitrary labels are not implemented." },
        legacyObservation: { input: legacy[0].phone, migratedValue: migrated[0].methods[0].value, methodCount: migrated[0].methods.length, stableMethodId: migrated[0].methods[0].id } };
}

function measureBuild(fn) {
    const samples = [];
    let output = null;
    for (let trial = 0; trial < BUILD_TRIALS; trial += 1) {
        output = null; gc();
        const before = process.memoryUsage();
        const start = performance.now();
        output = fn();
        const milliseconds = performance.now() - start;
        const after = process.memoryUsage();
        gc(); const retained = process.memoryUsage();
        samples.push({ milliseconds, observedHeapGrowthBytes: Math.max(0, after.heapUsed - before.heapUsed), retainedHeapGrowthBytes: Math.max(0, retained.heapUsed - before.heapUsed), observedRssBytes: after.rss });
    }
    return { output, measurement: { trials: BUILD_TRIALS, medianMs: percentile(samples.map((entry) => entry.milliseconds), 0.5), p95Ms: percentile(samples.map((entry) => entry.milliseconds), 0.95),
        maxObservedHeapGrowthBytes: Math.max(...samples.map((entry) => entry.observedHeapGrowthBytes)), maxRetainedHeapGrowthBytes: Math.max(...samples.map((entry) => entry.retainedHeapGrowthBytes)), samples } };
}

async function worker(strategy) {
    const fixture = makeFixture(); gc();
    const baseline = process.memoryUsage();
    if (strategy === "migration") {
        const snapshot = measureBuild(() => snapshotPreview(fixture));
        snapshot.output = null; gc();
        const legacy = makeLegacyFixture();
        const preview = measureBuild(() => legacyMigrationPreview(legacy));
        return { strategy, fixturePersonCount: PERSON_COUNT, fixtureMethodCount: TOTAL_METHODS,
            strictSnapshotPreview100kMethods: snapshot.measurement, legacyPreview10kPeople40kMethods: preview.measurement,
            baseline, finalMemory: process.memoryUsage(), processPeakRssBytes: process.resourceUsage().maxRSS * 1024 };
    }
    const build = measureBuild(() => strategy === "index" ? buildIndex(fixture) : buildRows(fixture));
    const queries = [];
    for (const probe of PROBES) {
        const samples = [];
        let result;
        for (let trial = 0; trial < QUERY_TRIALS; trial += 1) {
            const start = performance.now();
            result = strategy === "index" ? await indexedSearch(build.output, probe.value) : await boundedScan(build.output, probe.value);
            samples.push(performance.now() - start);
        }
        queries.push({ id: probe.id, trials: QUERY_TRIALS, medianMs: percentile(samples, 0.5), p95Ms: percentile(samples, 0.95), count: result.personOrdinals.length,
            expectedCount: probe.expectedCount, complete: result.complete, visitedMethods: result.visited, usedFallback: result.fallback, samples });
    }
    return { strategy, fixturePersonCount: PERSON_COUNT, fixtureMethodCount: TOTAL_METHODS, build: build.measurement, queries,
        ...(strategy === "index" ? { trigramCount: build.output.postings.size, postingCount: build.output.postingCount } : {}),
        baseline, finalMemory: process.memoryUsage(), processPeakRssBytes: process.resourceUsage().maxRSS * 1024 };
}

const workerMode = process.argv.find((arg) => arg.startsWith("--worker="))?.slice("--worker=".length);
if (workerMode) {
    if (!["scan", "index", "migration"].includes(workerMode)) throw new Error("unknown-research-worker");
    process.stdout.write(JSON.stringify(await worker(workerMode)));
} else {
    const measurements = [];
    for (const strategy of ["scan", "index", "migration"]) {
        const child = spawnSync(process.execPath, ["--expose-gc", fileURLToPath(import.meta.url), `--worker=${strategy}`], { encoding: "utf8", windowsHide: true, maxBuffer: 4 * 1024 * 1024, timeout: 120_000 });
        if (child.status !== 0) throw new Error(`Research worker ${strategy} failed: ${child.error?.message ?? child.stderr}`);
        measurements.push(JSON.parse(child.stdout));
    }
    const verification = await verifyCandidate();
    const provisionalBudgets = { acceptedForProduction: false, indexBuildP95Ms: 2_000, normalizedScanBuildP95Ms: 1_000,
        fullScanQueryP95Ms: 250, indexedSelectiveQueryP95Ms: 50, snapshotPreviewP95Ms: 1_000, legacyPreviewP95Ms: 1_000,
        indexRetainedHeapGrowthBytes: 128 * 1024 * 1024 };
    const scan = measurements.find((entry) => entry.strategy === "scan");
    const index = measurements.find((entry) => entry.strategy === "index");
    const migration = measurements.find((entry) => entry.strategy === "migration");
    const budgetChecks = [
        { id: "normalized-scan-build", value: scan.build.p95Ms, limit: provisionalBudgets.normalizedScanBuildP95Ms },
        { id: "index-build", value: index.build.p95Ms, limit: provisionalBudgets.indexBuildP95Ms },
        { id: "scan-all-query-probes", value: Math.max(...scan.queries.map((entry) => entry.p95Ms)), limit: provisionalBudgets.fullScanQueryP95Ms },
        { id: "index-selective-query-probes", value: Math.max(...index.queries.filter((entry) => entry.expectedCount < PERSON_COUNT && !entry.usedFallback).map((entry) => entry.p95Ms)), limit: provisionalBudgets.indexedSelectiveQueryP95Ms },
        { id: "index-retained-heap-growth", value: index.build.maxRetainedHeapGrowthBytes, limit: provisionalBudgets.indexRetainedHeapGrowthBytes },
        { id: "strict-snapshot-preview", value: migration.strictSnapshotPreview100kMethods.p95Ms, limit: provisionalBudgets.snapshotPreviewP95Ms },
        { id: "legacy-migration-preview", value: migration.legacyPreview10kPeople40kMethods.p95Ms, limit: provisionalBudgets.legacyPreviewP95Ms },
    ].map((entry) => ({ ...entry, withinProvisionalBudget: entry.value <= entry.limit }));
    const results = { generatedAt: new Date().toISOString(), issues: [51, 54], evidence: "synthetic-in-memory-research", syntheticOnly: true, kernelRequests: 0,
        productionChanges: false, candidateContractAccepted: false, environment: { nodeVersion: process.version, platform: `${process.platform}/${process.arch}`, cpu: os.cpus()[0]?.model ?? "unknown", totalMemoryBytes: os.totalmem(), gcExposedInWorkers: true },
        scope: { persons: PERSON_COUNT, methods: TOTAL_METHODS, methodsPerPerson: METHODS_PER_PERSON, indexedFields: ["method.value"],
            noHostIO: true, noRealContactData: true, matching: "NFKC + lowercase + literal substring; per-person results deduplicated by stable identity", scanChunkMethods: 2_000,
            exclusions: ["SiYuan read/write and AV query", "UI rendering, debounce and cancellation wiring", "JSON disk read/parse/write", "cross-window cache invalidation", "real vCard multi-value parser/serializer", "legacy-row inference from names or values"] },
        memoryMethod: "Fresh process per strategy. Heap growth is sampled immediately after each operation; retained growth is sampled after explicit GC. maxRSS is the worker-process lifetime high-water mark including fixture, runtime and repeated trials, not incremental index memory or exact JS transient allocation.",
        provisionalBudgets, budgetChecks, measurements, verification,
        interpretation: "A rebuildable normalized-value/trigram index is a candidate for repeated selective searches. Short queries use a bounded scan; broad matches retain O(candidate count) work. Performance budgets and storage/search integration remain research proposals requiring real-host measurement.",
        ok: verification.summary.failed === 0 && measurements.filter((entry) => entry.queries).every((entry) => entry.queries.every((query) => query.complete && query.count === query.expectedCount)) };
    const resultUrl = new URL("./contact-methods-research-results.json", import.meta.url);
    writeFileSync(resultUrl, JSON.stringify(results, null, 2) + "\n", "utf8");
    console.log(JSON.stringify({ resultPath: fileURLToPath(resultUrl), verification: verification.summary, scanBuildP95Ms: scan.build.p95Ms,
        indexBuildP95Ms: index.build.p95Ms, indexRetainedHeapMiB: bytesToMiB(index.build.maxRetainedHeapGrowthBytes),
        scanWorstQueryP95Ms: Math.max(...scan.queries.map((query) => query.p95Ms)), indexWorstQueryP95Ms: Math.max(...index.queries.map((query) => query.p95Ms)),
        strictSnapshotPreviewP95Ms: migration.strictSnapshotPreview100kMethods.p95Ms, legacyMigrationPreviewP95Ms: migration.legacyPreview10kPeople40kMethods.p95Ms,
        provisionalBudgetChecks: `${budgetChecks.filter((entry) => entry.withinProvisionalBudget).length}/${budgetChecks.length}`, ok: results.ok }, null, 2));
    if (!results.ok) process.exitCode = 1;
}
