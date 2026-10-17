/**
 * AG-RF-004-D3D4-P: synthetic primary-value deletion, zero-primary projection,
 * explicit deletion/unbind distinction, tombstone and stale-projection study.
 *
 * This module is deliberately pure Node. It consumes only redacted synthetic
 * observations and never calls a Kernel, Plugin API, filesystem store or
 * production domain code. The result is a research matrix, not a production
 * contract or an implementation of writes.
 *
 * `node scripts/spike/contact-methods-primary-projection-research.mjs`
 * writes the redacted result beside this file. `--dry-run` and `--import`
 * run the same checks without writing the result. Importing has no side effects.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const RESULT_URL = new URL("./contact-methods-primary-projection-results.json", import.meta.url);
const PERSON_ID = /^person-[a-z]+$/;
const METHOD_ID = /^method-[a-z]+-[a-z0-9-]+$/;
const TOMBSTONE_ID = /^tombstone-[a-z]+-[a-z0-9-]+$/;

const REDACTED_FLAGS = Object.freeze({
    syntheticOnly: true,
    kernelRequests: 0,
    productionChanges: false,
    candidateContractAccepted: false,
    writeAllowed: false,
    tombstoneAllowed: false,
    projectionWrites: 0,
    D1Adopted: false,
});

function clone(value) { return structuredClone(value); }
function digest(value) { return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16); }
function isRecord(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function validPrimary(value) { return value === "0" || value === "1"; }

function validateSnapshot(snapshot) {
    if (!isRecord(snapshot) || snapshot.schemaVersion !== 1 || !Array.isArray(snapshot.methods)
        || !Array.isArray(snapshot.tombstones) || !Array.isArray(snapshot.roster)) {
        throw new Error("snapshot-invalid-or-unknown-version");
    }
    const methodIds = new Set();
    const tombstoneIds = new Set();
    const activeById = new Set();
    const primaries = new Set();
    for (const method of snapshot.methods) {
        if (!isRecord(method) || !METHOD_ID.test(method.methodId ?? "")
            || !PERSON_ID.test(method.personDocId ?? "") || typeof method.type !== "string"
            || method.type.length === 0 || typeof method.value !== "string" || method.value.length === 0
            || !validPrimary(method.primary) || !Number.isSafeInteger(method.order) || method.order < 0) {
            throw new Error("method-invalid");
        }
        if (methodIds.has(method.methodId)) throw new Error("duplicate-method-id");
        methodIds.add(method.methodId); activeById.add(method.methodId);
        if (method.primary === "1") {
            const key = `${method.personDocId}:${method.type}`;
            if (primaries.has(key)) throw new Error("duplicate-primary");
            primaries.add(key);
        }
    }
    for (const tombstone of snapshot.tombstones) {
        if (!isRecord(tombstone) || !TOMBSTONE_ID.test(tombstone.tombstoneId ?? "")
            || !METHOD_ID.test(tombstone.methodId ?? "") || !PERSON_ID.test(tombstone.personDocId ?? "")
            || typeof tombstone.type !== "string" || tombstone.type.length === 0) {
            throw new Error("tombstone-invalid");
        }
        if (tombstoneIds.has(tombstone.tombstoneId)) throw new Error("duplicate-tombstone-id");
        tombstoneIds.add(tombstone.tombstoneId);
        if (activeById.has(tombstone.methodId)) throw new Error("active-method-tombstone-collision");
    }
    for (const personDocId of snapshot.roster) {
        if (!PERSON_ID.test(personDocId)) throw new Error("roster-invalid");
    }
    return clone(snapshot);
}

function methodsFor(snapshot, personDocId, type) {
    return snapshot.methods
        .filter((method) => method.personDocId === personDocId && method.type === type)
        .toSorted((a, b) => a.order - b.order || a.methodId.localeCompare(b.methodId));
}

/** Return the selected primary or null. A zero-primary set is intentional. */
export function projectionTarget(snapshot, personDocId, type) {
    const state = validateSnapshot(snapshot);
    const rows = methodsFor(state, personDocId, type);
    const primary = rows.filter((method) => method.primary === "1");
    if (primary.length > 1) return { status: "unknown", reason: "duplicate-primary", desiredValue: null, methodId: null };
    if (primary.length === 0) return { status: "zero-primary", reason: "no-primary-selected", desiredValue: null, methodId: null };
    return { status: "selected", reason: "explicit-primary", desiredValue: primary[0].value, methodId: primary[0].methodId };
}

/**
 * Plan a projection after checking the last verified AV value. The planner
 * never writes. A changed AV value is a conflict, including when the desired
 * value is empty because the primary was deleted or cleared.
 */
export function planProjection({ snapshot, personDocId, type, lastVerifiedAv, observedAv, rosterBound = true } = {}) {
    let state;
    try { state = validateSnapshot(snapshot); }
    catch (error) { return { status: "blocked", reason: error.message, writes: 0, ...REDACTED_FLAGS }; }
    if (!PERSON_ID.test(personDocId ?? "") || typeof type !== "string" || type.length === 0) {
        return { status: "blocked", reason: "target-invalid", writes: 0, ...REDACTED_FLAGS };
    }
    if (!rosterBound) return { status: "blocked", reason: "person-unbound-no-projection", writes: 0, ...REDACTED_FLAGS };
    if (!state.roster.includes(personDocId)) {
        return { status: "blocked", reason: "person-not-observed", writes: 0, ...REDACTED_FLAGS };
    }
    if (typeof observedAv !== "string" || typeof lastVerifiedAv !== "string") {
        return { status: "unknown", reason: "av-baseline-missing", writes: 0, ...REDACTED_FLAGS };
    }
    if (observedAv !== lastVerifiedAv) {
        return { status: "conflict", reason: "av-changed-since-last-verification", writes: 0, ...REDACTED_FLAGS };
    }
    const target = projectionTarget(state, personDocId, type);
    if (target.status === "unknown") return { status: "unknown", reason: target.reason, writes: 0, ...REDACTED_FLAGS };
    const desiredAv = target.desiredValue ?? "";
    return {
        status: observedAv === desiredAv ? "already-current" : "ready-for-explicit-confirmation",
        reason: target.reason,
        desiredAv,
        methodId: target.methodId,
        writes: 0,
        ...REDACTED_FLAGS,
    };
}

/** Apply a synthetic explicit method deletion; this is never a production write. */
export function explicitDelete(snapshot, methodId) {
    const state = validateSnapshot(snapshot);
    const method = state.methods.find((row) => row.methodId === methodId);
    if (!method) return { status: "unknown", reason: "method-not-observed", state, tombstone: null };
    const next = {
        ...state,
        methods: state.methods.filter((row) => row.methodId !== methodId),
        tombstones: [...state.tombstones, {
            tombstoneId: `tombstone-${method.personDocId}-${method.methodId.replace(/^method-[^-]+-/, "")}`,
            methodId: method.methodId,
            personDocId: method.personDocId,
            type: method.type,
        }],
    };
    return {
        status: "deleted",
        state: validateSnapshot(next),
        tombstone: next.tombstones.at(-1),
        writes: 0,
        ...REDACTED_FLAGS,
    };
}

/** Unbinding only changes roster eligibility; it does not delete methods or tombstone them. */
export function explicitUnbind(snapshot, personDocId) {
    const state = validateSnapshot(snapshot);
    if (!state.roster.includes(personDocId)) return { status: "unknown", reason: "person-not-bound", state };
    return {
        status: "unbound",
        state: { ...state, roster: state.roster.filter((id) => id !== personDocId) },
        methodsRetained: state.methods.filter((method) => method.personDocId === personDocId).length,
        tombstonesAdded: 0,
        writes: 0,
        ...REDACTED_FLAGS,
    };
}

/** Explicitly select one existing method as primary and clear peers of that type. */
export function explicitSwitchPrimary(snapshot, personDocId, type, methodId) {
    const state = validateSnapshot(snapshot);
    const candidates = methodsFor(state, personDocId, type);
    if (!candidates.some((method) => method.methodId === methodId)) {
        return { status: "blocked", reason: "replacement-method-not-observed", writes: 0, ...REDACTED_FLAGS };
    }
    const methods = state.methods.map((method) => method.personDocId === personDocId && method.type === type
        ? { ...method, primary: method.methodId === methodId ? "1" : "0" }
        : method);
    return { status: "switched", state: validateSnapshot({ ...state, methods }), selectedMethodId: methodId, writes: 0, ...REDACTED_FLAGS };
}

function baseSnapshot() {
    return {
        schemaVersion: 1,
        roster: ["person-a", "person-b"],
        methods: [
            { methodId: "method-a-phone", personDocId: "person-a", type: "phone", value: "redacted-a-phone", primary: "1", order: 0 },
            { methodId: "method-a-phone2", personDocId: "person-a", type: "phone", value: "redacted-a-phone-2", primary: "0", order: 1 },
            { methodId: "method-a-email", personDocId: "person-a", type: "email", value: "redacted-a-email", primary: "1", order: 0 },
            { methodId: "method-b-phone", personDocId: "person-b", type: "phone", value: "redacted-b-phone", primary: "1", order: 0 },
        ],
        tombstones: [],
    };
}

function check(checks, id, run) {
    try { run(); checks.push({ id, pass: true }); }
    catch (error) { checks.push({ id, pass: false, detail: error instanceof Error ? error.message : String(error) }); }
}

export function runSyntheticChecks() {
    const checks = [];
    const snapshot = baseSnapshot();
    check(checks, "baseline-selects-explicit-primary", () => {
        const target = projectionTarget(snapshot, "person-a", "phone");
        assert.equal(target.status, "selected"); assert.equal(target.methodId, "method-a-phone");
    });
    check(checks, "switch-primary-requires-explicit-existing-method", () => {
        const result = explicitSwitchPrimary(snapshot, "person-a", "phone", "method-a-phone2");
        assert.equal(result.status, "switched");
        assert.equal(projectionTarget(result.state, "person-a", "phone").methodId, "method-a-phone2");
        assert.equal(result.state.methods.filter((row) => row.personDocId === "person-a" && row.type === "phone" && row.primary === "1").length, 1);
    });
    check(checks, "switch-primary-does-not-touch-other-person", () => {
        const result = explicitSwitchPrimary(snapshot, "person-a", "phone", "method-a-phone2");
        assert.equal(projectionTarget(result.state, "person-b", "phone").methodId, "method-b-phone");
    });
    check(checks, "delete-primary-does-not-auto-promote", () => {
        const result = explicitDelete(snapshot, "method-a-phone");
        const target = projectionTarget(result.state, "person-a", "phone");
        assert.equal(target.status, "zero-primary"); assert.equal(target.desiredValue, null);
    });
    check(checks, "zero-primary-projects-empty-only-after-fresh-baseline", () => {
        const deleted = explicitDelete(snapshot, "method-a-phone").state;
        const plan = planProjection({ snapshot: deleted, personDocId: "person-a", type: "phone", lastVerifiedAv: "redacted-a-phone", observedAv: "redacted-a-phone" });
        assert.equal(plan.status, "ready-for-explicit-confirmation"); assert.equal(plan.desiredAv, ""); assert.equal(plan.projectionWrites, 0);
    });
    check(checks, "delete-primary-emits-tombstone", () => {
        const result = explicitDelete(snapshot, "method-a-phone");
        assert.equal(result.tombstone.methodId, "method-a-phone"); assert.equal(result.state.tombstones.length, 1);
    });
    check(checks, "tombstone-blocks-old-method-resurrection", () => {
        const result = explicitDelete(snapshot, "method-a-phone");
        assert.throws(() => validateSnapshot({ ...result.state, methods: [...result.state.methods, snapshot.methods[0]] }), /active-method-tombstone-collision/);
    });
    check(checks, "unbind-retains-methods-and-adds-no-tombstone", () => {
        const result = explicitUnbind(snapshot, "person-a");
        assert.equal(result.status, "unbound"); assert.equal(result.methodsRetained, 3); assert.equal(result.tombstonesAdded, 0);
        assert.equal(result.state.methods.length, snapshot.methods.length); assert.equal(result.state.tombstones.length, 0);
    });
    check(checks, "unbind-blocks-projection-without-deleting-methods", () => {
        const result = explicitUnbind(snapshot, "person-a");
        const plan = planProjection({ snapshot: result.state, personDocId: "person-a", type: "phone", lastVerifiedAv: "redacted-a-phone", observedAv: "redacted-a-phone", rosterBound: false });
        assert.equal(plan.status, "blocked"); assert.equal(plan.reason, "person-unbound-no-projection"); assert.equal(plan.projectionWrites, 0);
    });
    check(checks, "delete-and-unbind-are-distinct", () => {
        const deleted = explicitDelete(snapshot, "method-a-phone");
        const unbound = explicitUnbind(snapshot, "person-a");
        assert.equal(deleted.state.methods.length, snapshot.methods.length - 1); assert.equal(unbound.state.methods.length, snapshot.methods.length);
        assert.equal(deleted.state.tombstones.length, 1); assert.equal(unbound.state.tombstones.length, 0);
    });
    check(checks, "stale-av-value-is-conflict-even-when-clearing", () => {
        const deleted = explicitDelete(snapshot, "method-a-phone").state;
        const plan = planProjection({ snapshot: deleted, personDocId: "person-a", type: "phone", lastVerifiedAv: "redacted-a-phone", observedAv: "redacted-external-phone" });
        assert.equal(plan.status, "conflict"); assert.equal(plan.reason, "av-changed-since-last-verification"); assert.equal(plan.projectionWrites, 0);
    });
    check(checks, "fresh-baseline-allows-explicit-empty-projection", () => {
        const deleted = explicitDelete(snapshot, "method-a-phone").state;
        const plan = planProjection({ snapshot: deleted, personDocId: "person-a", type: "phone", lastVerifiedAv: "redacted-external-phone", observedAv: "redacted-external-phone" });
        assert.equal(plan.status, "ready-for-explicit-confirmation"); assert.equal(plan.desiredAv, "");
    });
    check(checks, "unchanged-primary-is-idempotent", () => {
        const plan = planProjection({ snapshot, personDocId: "person-a", type: "phone", lastVerifiedAv: "redacted-a-phone", observedAv: "redacted-a-phone" });
        assert.equal(plan.status, "already-current"); assert.equal(plan.projectionWrites, 0);
    });
    check(checks, "unknown-baseline-does-not-clear-av", () => {
        const plan = planProjection({ snapshot, personDocId: "person-a", type: "phone", observedAv: "redacted-a-phone" });
        assert.equal(plan.status, "unknown"); assert.equal(plan.projectionWrites, 0);
    });
    check(checks, "invalid-target-blocks-zero-write", () => {
        const plan = planProjection({ snapshot, personDocId: "person-ghost", type: "phone", lastVerifiedAv: "", observedAv: "" });
        assert.equal(plan.status, "blocked"); assert.equal(plan.reason, "person-not-observed");
    });
    check(checks, "replacement-must-be-observed", () => {
        const result = explicitSwitchPrimary(snapshot, "person-a", "phone", "method-a-missing");
        assert.equal(result.status, "blocked"); assert.equal(result.reason, "replacement-method-not-observed");
    });
    check(checks, "duplicate-primary-is-unknown", () => {
        const invalid = { ...snapshot, methods: snapshot.methods.map((row) => row.methodId === "method-a-phone2" ? { ...row, primary: "1" } : row) };
        assert.throws(() => validateSnapshot(invalid), /duplicate-primary/);
    });
    check(checks, "duplicate-tombstone-is-rejected", () => {
        const deleted = explicitDelete(snapshot, "method-a-phone").state;
        assert.throws(() => validateSnapshot({ ...deleted, tombstones: [...deleted.tombstones, deleted.tombstones[0]] }), /duplicate-tombstone-id/);
    });
    check(checks, "person-b-projection-remains-independent", () => {
        const deleted = explicitDelete(snapshot, "method-a-phone").state;
        const plan = planProjection({ snapshot: deleted, personDocId: "person-b", type: "phone", lastVerifiedAv: "redacted-b-phone", observedAv: "redacted-b-phone" });
        assert.equal(plan.status, "already-current"); assert.equal(plan.methodId, "method-b-phone");
    });
    check(checks, "stale-method-snapshot-requires-repreview", () => {
        const baseline = digest(snapshot);
        const changed = explicitSwitchPrimary(snapshot, "person-a", "phone", "method-a-phone2").state;
        assert.notEqual(digest(changed), baseline);
        const plan = planProjection({ snapshot: changed, personDocId: "person-a", type: "phone", lastVerifiedAv: "redacted-a-phone", observedAv: "redacted-a-phone" });
        assert.equal(plan.status, "ready-for-explicit-confirmation"); assert.equal(plan.desiredAv, "redacted-a-phone-2");
    });
    check(checks, "all-plans-and-transitions-report-zero-production-writes", () => {
        const deleted = explicitDelete(snapshot, "method-a-phone");
        const unbound = explicitUnbind(snapshot, "person-a");
        const switched = explicitSwitchPrimary(snapshot, "person-a", "phone", "method-a-phone2");
        for (const value of [deleted, unbound, switched, planProjection({ snapshot, personDocId: "person-a", type: "phone", lastVerifiedAv: "redacted-a-phone", observedAv: "redacted-a-phone" })]) {
            assert.equal(value.writes, 0); assert.equal(value.writeAllowed, false); assert.equal(value.projectionWrites, 0);
        }
    });
    return {
        researchFormat: 1,
        ...REDACTED_FLAGS,
        redacted: true,
        coverage: {
            primaryDelete: true,
            primarySwitch: true,
            zeroPrimary: true,
            explicitDeleteVsUnbind: true,
            tombstoneNoResurrection: true,
            staleProjectionConflict: true,
            crossPersonIsolation: true,
        },
        comparedEvidence: {
            S2: "general snapshot/recovery tombstones and stale confirmation; no primary projection planner",
            L1: "isolated AV lifecycle observation of missing primary and unbind; no explicit zero-primary/tombstone contract",
            L2: "identity gate for owner/item/doc changes; no primary projection state machine",
        },
        policy: {
            deletePrimary: "explicit-delete-produces-tombstone-and-zero-primary; never-auto-promote",
            switchPrimary: "explicit-existing-method-only; exactly-one-primary-per-person-type",
            zeroPrimary: "desired-projection-is-empty; requires-fresh-baseline-and-explicit-confirmation",
            unbind: "remove-roster-eligibility; retain-methods; no-tombstone; block-projection",
            staleProjection: "observed-av-differs-from-last-verified-baseline -> conflict-zero-write",
            tombstone: "same-method-id-cannot-return-as-active",
        },
        summary: {
            total: checks.length,
            passed: checks.filter((entry) => entry.pass).length,
            failed: checks.filter((entry) => !entry.pass).length,
            checks,
        },
    };
}

function main() {
    const args = new Set(process.argv.slice(2));
    const allowed = new Set(["--dry-run", "--import"]);
    for (const arg of args) if (!allowed.has(arg)) throw new Error(`unknown argument: ${arg}`);
    const result = runSyntheticChecks();
    result.summary = {
        total: result.summary.checks.length,
        passed: result.summary.checks.filter((entry) => entry.pass).length,
        failed: result.summary.checks.filter((entry) => !entry.pass).length,
        checks: result.summary.checks,
    };
    if (result.summary.failed) { console.error(JSON.stringify(result.summary, null, 2)); process.exitCode = 1; return; }
    const write = !args.has("--dry-run") && !args.has("--import");
    if (write) writeFileSync(RESULT_URL, `${JSON.stringify(result, null, 2)}\n`, "utf8");
    console.log(JSON.stringify({ summary: result.summary, wroteResult: write }, null, 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();

