/**
 * AG-RF-004-D6: synthetic research for legacy-value migration, backups and
 * versioned data exits.  This file intentionally has no Kernel, Plugin or
 * production-storage dependency.  It exercises strict parsing and a zero
 * write preview/confirm planner against redacted fixtures only.
 *
 * `node scripts/spike/contact-methods-migration-exit-research.mjs`
 * writes the redacted result JSON beside this file. `--dry-run` and
 * `--import` run the checks without writing. Importing this module has no
 * side effects.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const RESULT_URL = new URL("./contact-methods-migration-exit-results.json", import.meta.url);
const BUNDLE_VERSION = 1;
const MODULE_VERSION = 1;
const ALLOWED_MODULES = new Set(["people", "methods", "interactions", "tombstones"]);
const CHECKPOINT_KEYS = new Set([
    "org-projection-checkpoints.json",
    "organization-operations.json",
    "bridge-requests.json",
    "settings-repair-checkpoint.json",
    "self-profile-checkpoint.json",
]);
const REDACTED_FLAGS = Object.freeze({
    writeAllowed: false,
    checkpointWrites: 0,
    productionChanges: false,
    D1Adopted: false,
    tombstoneResurrection: false,
});

function clone(value) { return structuredClone(value); }
function digest(value) { return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16); }
function isRecord(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function id(value) { return typeof value === "string" && /^[a-z][a-z0-9-]+$/.test(value); }
function moduleEnvelope(value, key) {
    if (!isRecord(value) || value.schemaVersion !== MODULE_VERSION || !Array.isArray(value.records)) {
        throw new Error(`${key} module invalid-or-unknown-version`);
    }
    return { schemaVersion: MODULE_VERSION, records: value.records.map(clone) };
}
function validateRecord(key, row) {
    if (!isRecord(row) || !id(row.id) || !id(row.personDocId)) throw new Error(`${key} record invalid-identity`);
    if (key === "people" && typeof row.name !== "string") throw new Error("people record invalid-name");
    if (key === "methods" && (typeof row.value !== "string" || typeof row.type !== "string")) throw new Error("methods record invalid-value");
    if (key === "interactions" && typeof row.body !== "string") throw new Error("interactions record invalid-body");
    if (key === "tombstones" && typeof row.kind !== "string") throw new Error("tombstones record invalid-kind");
}
function strictRecords(key, records) {
    const seen = new Set();
    for (const row of records) {
        validateRecord(key, row);
        if (seen.has(row.id)) throw new Error(`${key} duplicate-identity`);
        seen.add(row.id);
    }
    return records.map(clone);
}

/** Strictly parse a package. Missing modules are omitted, never empty. */
export function parseBundle(raw) {
    let parsed;
    try { parsed = typeof raw === "string" ? JSON.parse(raw) : clone(raw); }
    catch { throw new Error("bundle invalid-json"); }
    if (!isRecord(parsed) || parsed.bundleVersion !== BUNDLE_VERSION || !isRecord(parsed.modules)) {
        throw new Error("bundle unknown-version-or-envelope");
    }
    for (const key of Object.keys(parsed.modules)) if (!ALLOWED_MODULES.has(key)) throw new Error(`bundle unknown-module:${key}`);
    const modules = {};
    for (const key of Object.keys(parsed.modules)) {
        const envelope = moduleEnvelope(parsed.modules[key], key);
        modules[key] = { schemaVersion: MODULE_VERSION, records: strictRecords(key, envelope.records) };
    }
    return { bundleVersion: BUNDLE_VERSION, modules, coverage: isRecord(parsed.coverage) ? clone(parsed.coverage) : {} };
}

/** Build a loss-aware preview. No write is possible through this function. */
export function previewLegacyValue({ personDocId, legacyValue, currentValue, baseline }) {
    if (!id(personDocId) || typeof legacyValue !== "string") return { status: "invalid", writes: 0, proposals: [] };
    const proposals = legacyValue.includes(" / ") ? legacyValue.split(" / ").map((value, index) => ({
        id: `method-${personDocId}-${index + 1}`, personDocId, type: "phone", value,
        source: "legacy-value", suggested: true,
    })) : [{ id: `method-${personDocId}-1`, personDocId, type: "phone", value: legacyValue, source: "legacy-value", suggested: false }];
    return {
        status: "preview",
        baseline: baseline ?? digest({ personDocId, currentValue }),
        currentValue,
        legacyValue,
        proposals,
        warnings: legacyValue.includes(" / ") ? ["legacy-delimiter-only-suggestion"] : [],
        writes: 0,
        ...REDACTED_FLAGS,
    };
}

function validateCurrent(current) {
    if (!isRecord(current) || current.schemaVersion !== 1 || !Array.isArray(current.people)
        || !Array.isArray(current.methods) || !Array.isArray(current.tombstones)) throw new Error("current corrupt-or-unknown-version");
    for (const key of ["people", "methods", "tombstones"]) strictRecords(key, current[key]);
    return clone(current);
}

/**
 * Plan confirmation from a frozen preview. Current state always wins for an
 * existing identity. Unknown/unreachable identities are never restored by
 * name. Tombstones suppress incoming records with the same identity.
 */
export function planConfirm({ current, incoming, baselineDigest, targetPersonDocId } = {}) {
    let state;
    try { state = validateCurrent(current); }
    catch (error) { return { status: "blocked", reason: "current-corrupt", message: error.message, writes: 0, ...REDACTED_FLAGS }; }
    let bundle;
    try { bundle = parseBundle(incoming); }
    catch (error) { return { status: "blocked", reason: "incoming-invalid", message: error.message, writes: 0, ...REDACTED_FLAGS }; }
    const nowDigest = digest(state);
    if (baselineDigest && baselineDigest !== nowDigest) return { status: "stale", reason: "current-changed-after-preview", writes: 0, ...REDACTED_FLAGS };
    const issues = [];
    const existingPeople = new Map(state.people.map((row) => [row.id, row]));
    const existingMethods = new Map(state.methods.map((row) => [row.id, row]));
    const tombstones = new Set(state.tombstones.map((row) => row.id));
    const reachable = new Set(state.people.map((row) => row.id));
    const accepted = [];
    for (const [key, target] of [["people", state.people], ["methods", state.methods], ["interactions", state.interactions ?? []]]) {
        const module = bundle.modules[key];
        if (!module) { issues.push({ key, status: "omitted", reason: "missing-module-preserves-current" }); continue; }
        for (const row of module.records) {
            if (tombstones.has(row.id)) { issues.push({ key, id: row.id, status: "skipped", reason: "tombstone-no-resurrection" }); continue; }
            if (key !== "people" && !reachable.has(row.personDocId)) {
                issues.push({ key, id: row.id, status: "skipped", reason: "person-unreachable-no-name-recovery" });
                continue;
            }
            const existing = key === "people" ? existingPeople.get(row.id) : key === "methods" ? existingMethods.get(row.id) : target.find((item) => item.id === row.id);
            if (existing) {
                if (digest(existing) !== digest(row)) issues.push({ key, id: row.id, status: "conflict", reason: "current-wins" });
                else issues.push({ key, id: row.id, status: "skipped", reason: "already-current" });
                continue;
            }
            accepted.push({ key, row: clone(row) });
        }
    }
    if (targetPersonDocId && !reachable.has(targetPersonDocId)) issues.push({ key: "people", id: targetPersonDocId, status: "blocked", reason: "target-person-unreachable" });
    const applied = accepted.length;
    return {
        status: "planned",
        writes: 0,
        applyOnConfirm: applied,
        accepted,
        issues,
        currentDigest: nowDigest,
        ...REDACTED_FLAGS,
    };
}

function baseCurrent() {
    return {
        schemaVersion: 1,
        people: [
            { id: "person-a", personDocId: "person-a", name: "虚构甲" },
            { id: "person-b", personDocId: "person-b", name: "虚构乙" },
        ],
        methods: [
            { id: "method-a-phone", personDocId: "person-a", type: "phone", value: "fictional-current" },
        ],
        interactions: [],
        tombstones: [{ id: "method-a-old", personDocId: "person-a", kind: "method" }],
    };
}
function bundle(modules) {
    return { bundleVersion: BUNDLE_VERSION, modules: Object.fromEntries(Object.entries(modules).map(([key, records]) => [key, { schemaVersion: MODULE_VERSION, records }])), coverage: { checkpoints: "excluded" } };
}
function check(checks, id, run) {
    try { run(); checks.push({ id, pass: true }); }
    catch (error) { checks.push({ id, pass: false, detail: error instanceof Error ? error.message : String(error) }); }
}

export function runSyntheticChecks() {
    const checks = [];
    const current = baseCurrent();
    check(checks, "legacy-delimiter-is-preview-only", () => {
        const result = previewLegacyValue({ personDocId: "person-a", legacyValue: "fictional-one / fictional-two", currentValue: "fictional-one / fictional-two" });
        assert.equal(result.status, "preview"); assert.equal(result.proposals.length, 2); assert.equal(result.writes, 0); assert.equal(result.writeAllowed, false);
    });
    check(checks, "legacy-single-value-remains-one-value", () => assert.equal(previewLegacyValue({ personDocId: "person-a", legacyValue: "fictional-one", currentValue: "fictional-one" }).proposals.length, 1));
    check(checks, "unknown-bundle-version-rejected", () => assert.throws(() => parseBundle({ bundleVersion: 9, modules: {} }), /unknown-version/));
    check(checks, "unknown-module-rejected", () => assert.throws(() => parseBundle({ bundleVersion: 1, modules: { mystery: { schemaVersion: 1, records: [] } } }), /unknown-module/));
    check(checks, "missing-module-is-omitted-not-empty", () => {
        const plan = planConfirm({ current, incoming: bundle({ people: [] }) });
        assert.equal(plan.status, "planned"); assert.ok(plan.issues.some((issue) => issue.key === "methods" && issue.reason === "missing-module-preserves-current"));
    });
    check(checks, "corrupt-current-blocks-zero-write", () => {
        const plan = planConfirm({ current: { ...current, methods: "bad" }, incoming: bundle({ methods: [] }) });
        assert.equal(plan.status, "blocked"); assert.equal(plan.writes, 0);
    });
    check(checks, "duplicate-incoming-identity-rejected", () => {
        const raw = bundle({ people: [{ id: "person-c", personDocId: "person-c", name: "虚构丙" }, { id: "person-c", personDocId: "person-c", name: "虚构丙二" }] });
        assert.throws(() => parseBundle(raw), /duplicate-identity/);
    });
    check(checks, "same-id-content-conflict-current-wins", () => {
        const plan = planConfirm({ current, incoming: bundle({ methods: [{ id: "method-a-phone", personDocId: "person-a", type: "phone", value: "fictional-incoming" }] }) });
        assert.ok(plan.issues.some((issue) => issue.reason === "current-wins")); assert.equal(plan.applyOnConfirm, 0);
    });
    check(checks, "same-id-same-content-is-idempotent", () => {
        const plan = planConfirm({ current, incoming: bundle({ methods: [current.methods[0]] }) });
        assert.ok(plan.issues.some((issue) => issue.reason === "already-current")); assert.equal(plan.applyOnConfirm, 0);
    });
    check(checks, "preview-zero-write", () => {
        const plan = planConfirm({ current, incoming: bundle({ methods: [{ id: "method-a-new", personDocId: "person-a", type: "email", value: "fictional@example.test" }] }) });
        assert.equal(plan.writes, 0); assert.equal(plan.writeAllowed, false); assert.equal(plan.applyOnConfirm, 1);
    });
    check(checks, "confirm-recomputes-baseline-before-apply", () => {
        const baseline = digest(current);
        const changed = { ...current, methods: [...current.methods, { id: "method-a-late", personDocId: "person-a", type: "phone", value: "fictional-late" }] };
        const plan = planConfirm({ current: changed, incoming: bundle({ methods: [{ id: "method-a-new", personDocId: "person-a", type: "email", value: "fictional@example.test" }] }), baselineDigest: baseline });
        assert.equal(plan.status, "stale"); assert.equal(plan.writes, 0);
    });
    check(checks, "tombstone-prevents-resurrection", () => {
        const plan = planConfirm({ current, incoming: bundle({ methods: [{ id: "method-a-old", personDocId: "person-a", type: "phone", value: "fictional-old" }] }) });
        assert.ok(plan.issues.some((issue) => issue.reason === "tombstone-no-resurrection")); assert.equal(plan.applyOnConfirm, 0); assert.equal(plan.tombstoneResurrection, false);
    });
    check(checks, "unreachable-person-is-not-restored-by-name", () => {
        const plan = planConfirm({ current, incoming: bundle({ methods: [{ id: "method-ghost", personDocId: "person-ghost", type: "phone", value: "虚构甲" }] }) });
        assert.ok(plan.issues.some((issue) => issue.reason === "person-unreachable-no-name-recovery")); assert.equal(plan.applyOnConfirm, 0);
    });
    check(checks, "current-state-priority-with-new-record", () => {
        const plan = planConfirm({ current, incoming: bundle({ methods: [{ id: "method-a-new", personDocId: "person-a", type: "email", value: "fictional@example.test" }, { id: "method-a-phone", personDocId: "person-a", type: "phone", value: "fictional-old" }] }) });
        assert.equal(plan.applyOnConfirm, 1); assert.ok(plan.issues.some((issue) => issue.reason === "current-wins"));
    });
    check(checks, "checkpoint-excluded-from-backup", () => {
        const backup = { included: ["methods", "tombstones"], excluded: [...CHECKPOINT_KEYS] };
        assert.ok(backup.excluded.includes("org-projection-checkpoints.json")); assert.equal(backup.included.includes("org-projection-checkpoints.json"), false);
    });
    check(checks, "old-package-explicit-envelope", () => {
        const parsed = parseBundle(bundle({ people: [{ id: "person-c", personDocId: "person-c", name: "虚构丙" }] }));
        assert.equal(parsed.bundleVersion, 1); assert.equal(parsed.modules.people.schemaVersion, 1);
    });
    check(checks, "invalid-module-version-is-rejected", () => assert.throws(() => parseBundle({ bundleVersion: 1, modules: { people: { schemaVersion: 7, records: [] } } }), /invalid-or-unknown-version/));
    check(checks, "invalid-record-is-rejected", () => assert.throws(() => parseBundle(bundle({ methods: [{ id: "bad", personDocId: "person-a", value: 7, type: "phone" }] })), /invalid-value/));
    check(checks, "unknown-person-target-stays-blocked", () => {
        const plan = planConfirm({ current, incoming: bundle({ people: [{ id: "person-z", personDocId: "person-z", name: "虚构新" }] }), targetPersonDocId: "person-z" });
        assert.ok(plan.issues.some((issue) => issue.reason === "target-person-unreachable"));
    });
    check(checks, "retry-plan-is-deterministic", () => {
        const incoming = bundle({ methods: [{ id: "method-a-new", personDocId: "person-a", type: "email", value: "fictional@example.test" }] });
        const first = planConfirm({ current, incoming }); const second = planConfirm({ current: clone(current), incoming: clone(incoming) });
        assert.deepEqual(first.issues, second.issues); assert.equal(first.applyOnConfirm, second.applyOnConfirm);
    });
    return {
        researchFormat: 1,
        syntheticOnly: true,
        kernelRequests: 0,
        productionChanges: false,
        candidateContractAccepted: false,
        productionGuardImplemented: false,
        D1Adopted: false,
        redacted: true,
        backupPolicy: { included: ["people", "methods", "interactions", "tombstones"], excluded: [...CHECKPOINT_KEYS], checkpointWrites: 0 },
        migrationPolicy: {
            oldValue: "keep-one-value; delimiter-only-suggestion; explicit-confirm-required",
            unknownVersion: "reject-before-preview",
            missingModule: "omitted-preserves-current",
            corruptStore: "block-zero-write",
            conflict: "current-wins-and-report",
            stalePreview: "recompute-before-confirm-zero-write",
            tombstone: "never-resurrect",
            unreachablePerson: "no-name-based-recovery",
        },
        forbiddenAssumptions: ["name/value identity", "checkpoint replay", "automatic split", "tombstone resurrection", "silent filtering", "cross-workspace ID guessing"],
        summary: { total: checks.length, passed: checks.filter((entry) => entry.pass).length, failed: checks.filter((entry) => !entry.pass).length, checks },
        ...REDACTED_FLAGS,
    };
}

function main() {
    const args = new Set(process.argv.slice(2));
    const allowed = new Set(["--dry-run", "--import"]);
    for (const arg of args) if (!allowed.has(arg)) throw new Error(`unknown argument: ${arg}`);
    const result = runSyntheticChecks();
    if (result.summary.failed) { console.error(JSON.stringify(result.summary, null, 2)); process.exitCode = 1; return; }
    const write = !args.has("--dry-run") && !args.has("--import");
    if (write) writeFileSync(RESULT_URL, `${JSON.stringify(result, null, 2)}\n`, "utf8");
    console.log(JSON.stringify({ summary: result.summary, wroteResult: write }, null, 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
