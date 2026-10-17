/**
 * AG-RF-004-L2: pure identity-gate research for person lifecycle changes.
 *
 * This module consumes only synthetic observations.  It does not start a
 * Kernel, call an API, read a plugin store, or infer deletion/move intent.
 * Missing rows and changed locations are observations which remain unknown.
 *
 * `node scripts/spike/contact-methods-lifecycle-identity-research.mjs`
 * writes the redacted result beside this file. `--dry-run` and `--import`
 * run the checks without writing the result file. Importing the module has no
 * side effects.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const RESULT_URL = new URL("./contact-methods-lifecycle-identity-results.json", import.meta.url);
const DOC_ID = /^doc-[a-z]+$/;
const ITEM_ID = /^item-[a-z-]+$/;
const METHOD_ID = /^method-[a-z]+-[a-z-]+$/;

const REDACTED_FLAGS = Object.freeze({
    writeAllowed: false,
    tombstoneAllowed: false,
    projectionWrites: 0,
    productionGuardImplemented: false,
    D1Adopted: false,
    historicalCompleteness: false,
});

function clone(value) {
    return structuredClone(value);
}

function digest(value) {
    return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);
}

function sourceSignature(methods) {
    return digest(methods.map(({ methodId, ownerDocId, sourceKey, type, primary, order }) => ({
        methodId, ownerDocId, sourceKey, type, primary, order,
    })).toSorted((a, b) => a.methodId.localeCompare(b.methodId)));
}

function validMethodShape(row) {
    return row && typeof row === "object"
        && METHOD_ID.test(row.methodId ?? "")
        && DOC_ID.test(row.ownerDocId ?? "")
        && typeof row.sourceKey === "string" && row.sourceKey.length > 0
        && typeof row.type === "string" && row.type.length > 0
        && typeof row.primary === "string" && (row.primary === "0" || row.primary === "1")
        && Number.isSafeInteger(row.order) && row.order >= 0
        && typeof row.value === "string" && row.value.length > 0;
}

/**
 * Inspect only the rows in a caller-provided range. A missing known row is
 * reported as unknown-not-delete; it never becomes a tombstone or removal.
 */
export function inspectSource({ rows, expectedMethodIds, expectedOwners, rangeComplete = true } = {}) {
    const observed = Array.isArray(rows) ? rows : [];
    const expected = Array.isArray(expectedMethodIds) ? expectedMethodIds : [];
    const owners = expectedOwners && typeof expectedOwners === "object" ? expectedOwners : {};
    const reasons = [];
    const ids = new Set();
    const methods = [];
    for (const row of observed) {
        if (!validMethodShape(row)) {
            reasons.push("source-row-invalid");
            continue;
        }
        if (ids.has(row.methodId)) reasons.push("duplicate-method-id");
        ids.add(row.methodId);
        if (owners[row.methodId] && owners[row.methodId] !== row.ownerDocId) reasons.push("method-owner-conflict");
        methods.push(clone(row));
    }
    if (!rangeComplete) reasons.push("source-range-incomplete");
    const missingKnown = expected.filter((id) => !ids.has(id)).map((methodId) => ({ methodId, status: "unknown-not-delete" }));
    if (missingKnown.length) reasons.push("known-source-row-missing");
    if (!observed.length && expected.length) reasons.push("source-set-unknown");
    const complete = reasons.length === 0 && missingKnown.length === 0;
    return {
        complete,
        methods: complete ? methods : [],
        observedMethods: methods,
        missingKnown,
        reasons: [...new Set(reasons)],
        sourceSignature: sourceSignature(methods),
    };
}

export function inspectDocuments({ rows, expectedDocs, notebookId } = {}) {
    const observed = Array.isArray(rows) ? rows : [];
    const docs = Array.isArray(expectedDocs) ? expectedDocs : [];
    const reasons = [];
    const perDocument = docs.map((docId) => {
        const matches = observed.filter((row) => row && row.id === docId);
        if (matches.length !== 1) return { docId, status: "unreachable-or-unknown", reachable: false };
        const row = matches[0];
        const exactRoot = row.root_id === docId && row.type === "d" && row.box === notebookId;
        const atExpectedLocation = exactRoot && row.parent_id === "";
        if (!exactRoot) return { docId, status: "identity-mismatch", reachable: false };
        if (!atExpectedLocation) return { docId, status: "location-changed", reachable: false, parentId: row.parent_id };
        return { docId, status: "reachable", reachable: true };
    });
    for (const item of perDocument) {
        if (item.status === "unreachable-or-unknown") reasons.push("owner-unreachable-or-unknown");
        if (item.status === "identity-mismatch") reasons.push("document-identity-mismatch");
        if (item.status === "location-changed") reasons.push("owner-location-changed");
    }
    return { complete: reasons.length === 0, reasons: [...new Set(reasons)], perDocument };
}

export function inspectRoster({ bindings, officialMap, expectedDocs } = {}) {
    const rows = Array.isArray(bindings) ? bindings : [];
    const map = officialMap && typeof officialMap === "object" ? officialMap : {};
    const docs = Array.isArray(expectedDocs) ? expectedDocs : [];
    const reasons = [];
    const seenDocs = new Set();
    const seenItems = new Set();
    const bound = [];
    for (const row of rows) {
        if (!row || !DOC_ID.test(row.docId ?? "") || !ITEM_ID.test(row.itemID ?? "")) {
            reasons.push("roster-row-invalid");
            continue;
        }
        if (seenDocs.has(row.docId) || seenItems.has(row.itemID)) reasons.push("duplicate-roster-binding");
        seenDocs.add(row.docId); seenItems.add(row.itemID);
        if (map[row.docId] !== row.itemID) reasons.push("official-native-mapping-disagreement");
        bound.push(clone(row));
    }
    for (const [docId, itemID] of Object.entries(map)) {
        if (!docs.includes(docId) || !ITEM_ID.test(itemID ?? "") || !bound.some((row) => row.docId === docId && row.itemID === itemID)) {
            reasons.push("official-map-without-binding");
        }
    }
    return {
        complete: reasons.length === 0,
        reasons: [...new Set(reasons)],
        bound,
        perDocument: docs.map((docId) => ({ docId, status: bound.some((row) => row.docId === docId) ? "bound" : "not-bound-in-current-observation" })),
    };
}

/**
 * Diagnostic-only lifecycle gate. It deliberately never returns writable
 * methods. Names and values are retained for reporting only, never identity.
 */
export function evaluateIdentityGate({ targetDocId, source, documents, roster, frozenPlan, observedUnboundDocIds = [] } = {}) {
    const reasons = [];
    const targetDocument = documents?.perDocument?.find((item) => item.docId === targetDocId);
    const targetBinding = roster?.bound?.filter((row) => row.docId === targetDocId) ?? [];
    const targetMethods = source?.observedMethods?.filter((row) => row.ownerDocId === targetDocId) ?? [];
    if (!source?.complete) reasons.push("source-set-unknown");
    if (!documents?.complete) reasons.push(...(documents?.reasons ?? ["owner-unreachable-or-unknown"]));
    if (!roster?.complete) reasons.push(...(roster?.reasons ?? ["roster-observation-unknown"]));
    if (!targetDocument?.reachable) reasons.push(targetDocument?.status === "location-changed" ? "owner-location-changed" : "owner-unreachable-or-unknown");
    if (targetBinding.length !== 1) reasons.push(targetBinding.length === 0 ? "roster-binding-missing" : "roster-binding-ambiguous");
    if (source?.complete && targetMethods.length === 0) reasons.push("source-owner-methods-missing");
    if (frozenPlan) {
        if (frozenPlan.docId !== targetDocId) reasons.push("frozen-target-doc-mismatch");
        if (targetBinding.length === 1 && targetBinding[0].itemID !== frozenPlan.itemID) reasons.push("target-item-changed");
        if (observedUnboundDocIds.includes(frozenPlan.docId)) reasons.push("observed-unbinding-invalidates-frozen-plan-even-if-itemID-reused");
        if (source?.complete && source.sourceSignature !== frozenPlan.sourceSignature) reasons.push("source-baseline-changed");
    }
    if (targetDocument?.status === "unreachable-or-unknown" && targetMethods.length > 0) reasons.push("source-remains-with-unreachable-owner");
    if (targetDocument?.status === "location-changed") reasons.push("location-change-not-a-delete-proof");
    if (source?.missingKnown?.length) reasons.push("missing-known-is-unknown-not-delete");
    const uniqueReasons = [...new Set(reasons)];
    const refused = uniqueReasons.length > 0;
    return {
        outcome: refused ? "refused" : "eligible-research-diagnostic-only",
        reasons: uniqueReasons,
        sourceStatus: source?.complete ? "complete" : "unknown",
        targetBinding: targetBinding.length === 1 ? "bound" : targetBinding.length === 0 ? "missing" : "ambiguous",
        observedMethodCount: targetMethods.length,
        methods: [],
        ...REDACTED_FLAGS,
    };
}

function baselineFixture() {
    const notebookId = "box-main";
    const docs = ["doc-a", "doc-b"];
    const methods = [
        { methodId: "method-a-phone", ownerDocId: "doc-a", sourceKey: "phone-main", type: "phone", value: "fictional-a", primary: "1", order: 0 },
        { methodId: "method-a-extra", ownerDocId: "doc-a", sourceKey: "phone-extra", type: "phone", value: "fictional-a-extra", primary: "0", order: 1 },
        { methodId: "method-b-phone", ownerDocId: "doc-b", sourceKey: "phone-main", type: "phone", value: "fictional-a", primary: "1", order: 0 },
    ];
    const expectedOwners = Object.fromEntries(methods.map((row) => [row.methodId, row.ownerDocId]));
    const docRows = docs.map((id) => ({ id, root_id: id, parent_id: "", box: notebookId, type: "d" }));
    const bindings = [
        { docId: "doc-a", itemID: "item-a", phone: "fictional-a" },
        { docId: "doc-b", itemID: "item-b", phone: "fictional-a" },
    ];
    const source = inspectSource({ rows: methods, expectedMethodIds: methods.map((row) => row.methodId), expectedOwners });
    const documents = inspectDocuments({ rows: docRows, expectedDocs: docs, notebookId });
    const roster = inspectRoster({ bindings, officialMap: { "doc-a": "item-a", "doc-b": "item-b" }, expectedDocs: docs });
    return { notebookId, docs, methods, expectedOwners, docRows, bindings, source, documents, roster,
        frozenPlan: { docId: "doc-a", itemID: "item-a", sourceSignature: source.sourceSignature } };
}

function state(fixture, overrides = {}) {
    const sourceRows = overrides.sourceRows ?? fixture.methods;
    const docRows = overrides.docRows ?? fixture.docRows;
    const bindings = overrides.bindings ?? fixture.bindings;
    const expectedDocs = overrides.expectedDocs ?? fixture.docs;
    const expectedMethodIds = overrides.expectedMethodIds ?? fixture.methods.map((row) => row.methodId);
    const source = inspectSource({ rows: sourceRows, expectedMethodIds, expectedOwners: fixture.expectedOwners, rangeComplete: overrides.rangeComplete ?? true });
    const documents = inspectDocuments({ rows: docRows, expectedDocs, notebookId: fixture.notebookId });
    const roster = inspectRoster({ bindings, officialMap: overrides.officialMap ?? Object.fromEntries(bindings.map((row) => [row.docId, row.itemID])), expectedDocs });
    return { source, documents, roster };
}

function check(checks, id, run) {
    try { run(); checks.push({ id, pass: true }); }
    catch (error) { checks.push({ id, pass: false, detail: error instanceof Error ? error.message : String(error) }); }
}

export function runSyntheticChecks() {
    const checks = [];
    const fixture = baselineFixture();
    const base = state(fixture);
    const baseGate = evaluateIdentityGate({ targetDocId: "doc-a", ...base, frozenPlan: fixture.frozenPlan });
    check(checks, "baseline-doc-source-roster-identity", () => {
        assert.equal(base.source.complete, true); assert.equal(base.documents.complete, true); assert.equal(base.roster.complete, true);
        assert.equal(baseGate.outcome, "eligible-research-diagnostic-only"); assert.equal(baseGate.writeAllowed, false);
    });
    check(checks, "same-name-new-doc-does-not-transfer-methods", () => {
        const replacement = state(fixture, { bindings: [{ docId: "doc-b", itemID: "item-b", phone: "fictional-a" }], officialMap: { "doc-b": "item-b" } });
        const gate = evaluateIdentityGate({ targetDocId: "doc-a", ...replacement, frozenPlan: fixture.frozenPlan });
        assert.ok(gate.reasons.includes("roster-binding-missing"));
        assert.equal(replacement.source.observedMethods.filter((row) => row.ownerDocId === "doc-b").length, 1);
        assert.equal(replacement.source.observedMethods.filter((row) => row.ownerDocId === "doc-a").length, 2);
        assert.equal(gate.methods.length, 0);
    });
    check(checks, "same-value-cross-person-keeps-distinct-method-ids", () => {
        const same = fixture.methods.filter((row) => row.value === "fictional-a");
        assert.equal(same.length, 2); assert.notEqual(same[0].methodId, same[1].methodId);
    });
    check(checks, "same-name-new-doc-cannot-freeze-old-source", () => {
        const replacement = state(fixture, { bindings: [{ docId: "doc-b", itemID: "item-b", phone: "fictional-a" }], officialMap: { "doc-b": "item-b" } });
        const gate = evaluateIdentityGate({ targetDocId: "doc-b", ...replacement, frozenPlan: fixture.frozenPlan });
        assert.ok(gate.reasons.includes("frozen-target-doc-mismatch")); assert.ok(gate.reasons.includes("source-baseline-changed") === false);
        assert.equal(gate.methods.length, 0);
    });
    check(checks, "same-item-reuse-after-unbind-refuses-old-plan", () => {
        const reused = state(fixture, { bindings: [{ docId: "doc-b", itemID: "item-a", phone: "fictional-a" }], officialMap: { "doc-b": "item-a" } });
        const gate = evaluateIdentityGate({ targetDocId: "doc-a", ...reused, frozenPlan: fixture.frozenPlan, observedUnboundDocIds: ["doc-a"] });
        assert.ok(gate.reasons.includes("observed-unbinding-invalidates-frozen-plan-even-if-itemID-reused"));
        assert.ok(gate.reasons.includes("roster-binding-missing"));
    });
    check(checks, "unreachable-old-doc-is-unknown-not-delete", () => {
        const unreachable = state(fixture, { docRows: [fixture.docRows[1]] });
        const gate = evaluateIdentityGate({ targetDocId: "doc-a", ...unreachable, frozenPlan: fixture.frozenPlan });
        assert.ok(gate.reasons.includes("owner-unreachable-or-unknown")); assert.ok(gate.reasons.includes("source-remains-with-unreachable-owner"));
        assert.ok(gate.reasons.includes("location-change-not-a-delete-proof") === false); assert.equal(gate.methods.length, 0);
    });
    check(checks, "unreachable-source-owner-unknown-stays-empty", () => {
        const sourceRows = fixture.methods.map((row) => row.ownerDocId === "doc-a" ? { ...row, ownerDocId: "" } : row);
        const unknown = state(fixture, { sourceRows });
        const gate = evaluateIdentityGate({ targetDocId: "doc-a", ...unknown, frozenPlan: fixture.frozenPlan });
        assert.ok(gate.reasons.includes("source-set-unknown")); assert.equal(gate.methods.length, 0);
    });
    check(checks, "location-change-is-not-delete-proof", () => {
        const movedObservation = state(fixture, { docRows: fixture.docRows.map((row) => row.id === "doc-a" ? { ...row, parent_id: "parent-x" } : row) });
        const gate = evaluateIdentityGate({ targetDocId: "doc-a", ...movedObservation, frozenPlan: fixture.frozenPlan });
        assert.ok(gate.reasons.includes("owner-location-changed")); assert.ok(gate.reasons.includes("location-change-not-a-delete-proof"));
        assert.equal(gate.methods.length, 0);
    });
    check(checks, "owner-mismatch-does-not-rewrite-method-id", () => {
        const conflictRows = fixture.methods.map((row) => row.methodId === "method-a-phone" ? { ...row, ownerDocId: "doc-b" } : row);
        const conflicting = state(fixture, { sourceRows: conflictRows });
        const gate = evaluateIdentityGate({ targetDocId: "doc-a", ...conflicting, frozenPlan: fixture.frozenPlan });
        assert.ok(conflicting.source.reasons.includes("method-owner-conflict")); assert.ok(gate.reasons.includes("source-set-unknown"));
        assert.equal(gate.methods.length, 0); assert.equal(conflictRows[0].methodId, "method-a-phone");
    });
    check(checks, "duplicate-method-id-refuses-set", () => {
        const duplicateRows = [...fixture.methods, { ...fixture.methods[0], itemID: "item-a-duplicate" }];
        const duplicate = state(fixture, { sourceRows: duplicateRows });
        assert.ok(duplicate.source.reasons.includes("duplicate-method-id"));
        assert.equal(evaluateIdentityGate({ targetDocId: "doc-a", ...duplicate }).methods.length, 0);
    });
    check(checks, "missing-known-row-is-unknown-not-delete", () => {
        const partial = state(fixture, { sourceRows: fixture.methods.slice(1), expectedMethodIds: fixture.methods.map((row) => row.methodId) });
        assert.ok(partial.source.reasons.includes("known-source-row-missing")); assert.equal(partial.source.missingKnown[0].status, "unknown-not-delete");
        assert.equal(evaluateIdentityGate({ targetDocId: "doc-a", ...partial }).methods.length, 0);
    });
    check(checks, "truncated-range-is-not-complete", () => {
        const truncated = state(fixture, { sourceRows: fixture.methods.slice(0, 2), rangeComplete: false });
        assert.ok(truncated.source.reasons.includes("source-range-incomplete")); assert.equal(truncated.source.complete, false);
    });
    check(checks, "new-item-rebind-refuses-old-target", () => {
        const rebound = state(fixture, { bindings: [{ docId: "doc-a", itemID: "item-a-new", phone: "fictional-a" }, fixture.bindings[1]], officialMap: { "doc-a": "item-a-new", "doc-b": "item-b" } });
        const gate = evaluateIdentityGate({ targetDocId: "doc-a", ...rebound, frozenPlan: fixture.frozenPlan });
        assert.ok(gate.reasons.includes("target-item-changed")); assert.equal(gate.methods.length, 0);
    });
    check(checks, "official-native-mapping-disagreement-refuses", () => {
        const mismatch = state(fixture, { officialMap: { "doc-a": "item-other", "doc-b": "item-b" } });
        assert.ok(mismatch.roster.reasons.includes("official-map-without-binding"));
        assert.equal(evaluateIdentityGate({ targetDocId: "doc-a", ...mismatch }).methods.length, 0);
    });
    check(checks, "reloaded-observation-keeps-reasons-stable", () => {
        const moved = state(fixture, { docRows: fixture.docRows.map((row) => row.id === "doc-a" ? { ...row, parent_id: "parent-x" } : row) });
        const first = evaluateIdentityGate({ targetDocId: "doc-a", ...moved, frozenPlan: fixture.frozenPlan });
        const second = evaluateIdentityGate({ targetDocId: "doc-a", ...clone(moved), frozenPlan: fixture.frozenPlan });
        assert.deepEqual(first.reasons, second.reasons); assert.equal(second.projectionWrites, 0);
    });
    check(checks, "all-unknown-paths-never-enable-write", () => {
        const scenarios = [
            state(fixture, { docRows: [] }),
            state(fixture, { sourceRows: [], expectedMethodIds: fixture.methods.map((row) => row.methodId) }),
            state(fixture, { bindings: [] }),
        ];
        for (const observation of scenarios) {
            const gate = evaluateIdentityGate({ targetDocId: "doc-a", ...observation, frozenPlan: fixture.frozenPlan });
            assert.equal(gate.writeAllowed, false); assert.equal(gate.tombstoneAllowed, false); assert.equal(gate.projectionWrites, 0);
        }
    });
    const passed = checks.filter((entry) => entry.pass).length;
    return { total: checks.length, passed, failed: checks.length - passed, checks };
}

export function buildResult() {
    const synthetic = runSyntheticChecks();
    return {
        researchFormat: 1,
        syntheticOnly: true,
        kernelRequests: 0,
        productionChanges: false,
        productionGuardImplemented: false,
        D1Adopted: false,
        writeAllowed: false,
        tombstoneAllowed: false,
        projectionWrites: 0,
        candidateContractAccepted: false,
        redacted: true,
        identityRules: ["docId", "methodId", "sourceKey", "itemID"],
        unknownPolicy: "missing-or-incomplete-observation-is-unknown-not-delete",
        forbiddenAssumptions: ["name/value ownership", "deleteDoc", "moveDoc", "persistent tombstone", "CAS", "durable unbind history"],
        boundary: "Synthetic identity gate only; no user deletion or document move was executed.",
        summary: synthetic,
    };
}

function main() {
    const args = new Set(process.argv.slice(2));
    const allowed = new Set(["--dry-run", "--import"]);
    for (const arg of args) if (!allowed.has(arg)) throw new Error(`unknown argument: ${arg}`);
    const result = buildResult();
    if (result.summary.failed) {
        console.error(JSON.stringify(result.summary, null, 2));
        process.exitCode = 1;
        return;
    }
    if (!args.has("--dry-run") && !args.has("--import")) writeFileSync(RESULT_URL, `${JSON.stringify(result, null, 2)}\n`, "utf8");
    console.log(JSON.stringify({ summary: result.summary, wroteResult: !args.has("--dry-run") && !args.has("--import") }, null, 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
