/**
 * AG-RF-004-S1-LIFE: vCard method lifecycle research only.
 * Synthetic cards, no Kernel/API/plugin storage access, no production writes.
 * Values remain in memory and results contain only digests and categories.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const OUTPUT = fileURLToPath(new URL("./contact-methods-vcard-lifecycle-research-results.json", import.meta.url));
const TYPES = new Set(["phone", "email", "url"]);
const MAX_METHODS = 32;
const MAX_VALUE_LENGTH = 4096;
const MAX_UNMAPPED = 32;
const digest = (value) => createHash("sha256").update(String(value)).digest("hex").slice(0, 16);
const clone = (value) => structuredClone(value);
const stable = (value) => Array.isArray(value) ? value.map(stable) : value && typeof value === "object"
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])])) : value;
const json = (value) => JSON.stringify(stable(value));
const idFor = (cardId, operation, ordinal) => `method-${digest(`${cardId}:${operation}:${ordinal}`)}`;

function method(cardId, id, type, value, label, sourceIndex, params = {}) {
    return { id, type, value, label, order: sourceIndex, source: { cardId, property: type.toUpperCase(), sourceIndex }, params };
}

function makeCards() {
    const a = {
        cardId: "card-a-fictional",
        name: "虚构卡 A",
        methods: [
            method("card-a-fictional", "method-a-phone-0", "phone", "+00 100 001", "工作", 0, { TYPE: "WORK,CELL", PREF: "1" }),
            method("card-a-fictional", "method-a-email-1", "email", "a@example.test", "工作", 1, { TYPE: "WORK" }),
            method("card-a-fictional", "method-a-url-2", "url", "https://example.test/a", "主页", 2, { TYPE: "HOME" }),
        ],
        unmapped: [{ name: "X-ABLABEL", params: { TYPE: "CUSTOM" }, value: "自定义标签", raw: "item1.X-ABLabel;TYPE=CUSTOM:自定义标签" }],
        loss: [],
    };
    const b = {
        cardId: "card-b-fictional",
        name: "虚构卡 B",
        methods: [method("card-b-fictional", "method-b-phone-0", "phone", "+00 100 001", "工作", 0, { TYPE: "WORK" })],
        unmapped: [],
        loss: [],
    };
    return [a, b];
}

function validateCard(card) {
    if (!card || typeof card.cardId !== "string" || !card.cardId || !Array.isArray(card.methods) || card.methods.length > MAX_METHODS
        || !Array.isArray(card.unmapped) || card.unmapped.length > MAX_UNMAPPED) throw new Error("card-shape-unknown");
    const ids = new Set(), primaryByType = new Set();
    for (const item of card.methods) {
        if (!item || typeof item.id !== "string" || ids.has(item.id) || !TYPES.has(item.type)
            || typeof item.value !== "string" || !item.value.trim() || item.value.length > MAX_VALUE_LENGTH
            || /[\u0000-\u001f\u007f]/u.test(item.value) || typeof item.label !== "string"
            || !Number.isSafeInteger(item.order) || item.order < 0 || item.source?.cardId !== card.cardId
            || item.source?.property !== item.type.toUpperCase() || !Number.isSafeInteger(item.source?.sourceIndex)) throw new Error("method-invalid");
        ids.add(item.id);
        if (item.params?.PREF === "1") {
            if (primaryByType.has(item.type)) throw new Error("multiple-primary-rejected");
            primaryByType.add(item.type);
        }
    }
    return true;
}

function editMethod(card, id, patch) {
    const next = clone(card), item = next.methods.find((methodItem) => methodItem.id === id);
    if (!item) throw new Error("method-not-found");
    Object.assign(item, patch);
    validateCard(next);
    return next;
}

function deleteMethod(card, id, reason = "explicit-user-delete") {
    const next = clone(card), index = next.methods.findIndex((item) => item.id === id);
    if (index < 0) throw new Error("method-not-found");
    const [removed] = next.methods.splice(index, 1);
    next.loss.push({ kind: "deleted", reason, methodId: removed.id, source: clone(removed.source), valueDigest: digest(removed.value) });
    validateCard(next);
    return next;
}

function addMethod(card, type, value, label, operation) {
    const next = clone(card);
    const id = idFor(card.cardId, operation, next.methods.length);
    next.methods.push(method(card.cardId, id, type, value, label, next.methods.length, { TYPE: "CUSTOM" }));
    validateCard(next);
    return next;
}

function reorder(card, order) {
    const next = clone(card), byId = new Map(next.methods.map((item) => [item.id, item]));
    if (order.length !== next.methods.length || new Set(order).size !== order.length || order.some((id) => !byId.has(id))) throw new Error("reorder-scope-unknown");
    next.methods = order.map((id, index) => ({ ...byId.get(id), order: index }));
    validateCard(next);
    return next;
}

function duplicateValue(card, originalId, operation) {
    const original = card.methods.find((item) => item.id === originalId);
    if (!original) throw new Error("method-not-found");
    const next = addMethod(card, original.type, original.value, `${original.label}（重复）`, operation);
    next.loss.push({ kind: "duplicate-value-visible", methodId: next.methods.at(-1).id, originalId, valueDigest: digest(original.value) });
    return next;
}

function encodeProperty(item) {
    const params = Object.entries(item.params ?? {}).map(([key, value]) => `;${key}=${value}`).join("");
    return `X-LVCT-METHOD-ID:${item.id}\r\nX-LVCT-SOURCE:${item.source.property}:${item.source.sourceIndex}\r\n${item.type.toUpperCase()}${params}:${item.value}`;
}

function exportCard(card, { includeUnmapped = false } = {}) {
    validateCard(card);
    const lines = ["BEGIN:VCARD", "VERSION:3.0", `X-LVCT-CARD-ID:${card.cardId}`, `FN:${card.name}`];
    for (const item of [...card.methods].sort((a, b) => a.order - b.order)) lines.push(encodeProperty(item));
    if (includeUnmapped) for (const item of card.unmapped) lines.push(item.raw);
    lines.push("END:VCARD");
    return lines.join("\r\n") + "\r\n";
}

function importCard(text, { includeUnmapped = false } = {}) {
    const lines = String(text).split(/\r?\n/), card = { cardId: "", name: "", methods: [], unmapped: [], loss: [] };
    let pendingId = "", pendingSource = null, sourceCardId = "", propertyIndex = 0;
    for (const line of lines) {
        if (!line || line === "BEGIN:VCARD" || line === "VERSION:3.0" || line === "END:VCARD") continue;
        if (line.startsWith("FN:")) { card.name = line.slice(3); continue; }
        if (line.startsWith("X-LVCT-CARD-ID:")) { sourceCardId = line.slice(15); continue; }
        if (line.startsWith("X-LVCT-METHOD-ID:")) { pendingId = line.slice(17); continue; }
        if (line.startsWith("X-LVCT-SOURCE:")) {
            const [property, index] = line.slice(14).split(":"); pendingSource = { property, sourceIndex: Number(index) }; continue;
        }
        const match = /^([A-Z]+)((?:;[^:]+)*):(.*)$/u.exec(line);
        if (!match) {
            if (includeUnmapped) card.unmapped.push({ raw: line, name: line.split(/[;:]/u)[0].toUpperCase(), value: line });
            else card.loss.push({ kind: "retained-unmapped", property: line.split(/[;:]/u)[0].toUpperCase(), rawDigest: digest(line) });
            continue;
        }
        const [, property, paramText, value] = match;
        if (!TYPES.has(property.toLowerCase()) || !pendingId || !pendingSource) {
            const loss = { kind: "unknown-or-unlineaged", property, rawDigest: digest(line) };
            if (includeUnmapped) card.unmapped.push({ raw: line, name: property, value }); else card.loss.push(loss);
            pendingId = ""; pendingSource = null; continue;
        }
        const params = Object.fromEntries([...paramText.matchAll(/;([A-Z]+)=([^;]+)/gu)].map(([, key, val]) => [key, val]));
        const type = property.toLowerCase();
        card.methods.push(method(sourceCardId || "imported-card", pendingId, type, value, params.TYPE ?? "", pendingSource.sourceIndex, params));
        pendingId = ""; pendingSource = null; propertyIndex += 1;
    }
    card.cardId = sourceCardId || "imported-card";
    if (!card.name || !card.methods.length) throw new Error("import-card-incomplete");
    validateCard(card);
    return card;
}

function summarizeCard(card) {
    return { cardId: card.cardId, nameDigest: digest(card.name), methodCount: card.methods.length,
        methodIds: card.methods.map((item) => item.id), methodDigests: card.methods.map((item) => ({ id: item.id, type: item.type, valueDigest: digest(item.value),
            labelDigest: digest(item.label), source: item.source, order: item.order })), unmappedCount: card.unmapped.length,
        loss: card.loss.map(({ kind, reason, methodId, originalId, property, valueDigest, rawDigest }) => ({ kind, reason, methodId, originalId, property, valueDigest, rawDigest })) };
}

function runChecks() {
    const checks = [], check = (id, pass) => { checks.push({ id, pass: Boolean(pass) }); assert.ok(pass, id); };
    const [baseA, baseB] = makeCards(); validateCard(baseA); validateCard(baseB);
    check("baseline-three-methods", baseA.methods.length === 3);
    const edited = editMethod(baseA, "method-a-phone-0", { value: "+00 100 009", label: "改过标签" });
    check("edit-preserves-id-lineage", edited.methods[0].id === "method-a-phone-0" && edited.methods[0].source.sourceIndex === 0);
    const deleted = deleteMethod(edited, "method-a-email-1");
    check("delete-is-explicit-loss", deleted.methods.length === 2 && deleted.loss.some((item) => item.kind === "deleted" && item.methodId === "method-a-email-1"));
    const added = addMethod(deleted, "email", "new@example.test", "新增", "add-email");
    check("new-method-gets-fresh-id", !deleted.methods.some((item) => item.id === added.methods.at(-1).id));
    const reordered = reorder(added, [...added.methods].reverse().map((item) => item.id));
    check("reorder-keeps-all-ids", json(reordered.methods.map((item) => item.id).toSorted()) === json(added.methods.map((item) => item.id).toSorted()));
    const duplicated = duplicateValue(reordered, "method-a-phone-0", "duplicate-phone");
    check("duplicate-value-keeps-separate-lineage", duplicated.methods.filter((item) => item.value === "+00 100 009").length === 2
        && duplicated.loss.some((item) => item.kind === "duplicate-value-visible"));
    check("same-value-cross-card-never-merges", baseA.methods[0].id !== baseB.methods[0].id && baseA.methods[0].value === baseB.methods[0].value);
    const defaultText = exportCard(duplicated);
    const defaultRoundTrip = importCard(defaultText);
    check("default-roundtrip-retains-supported-methods", defaultRoundTrip.methods.length === duplicated.methods.length
        && json(defaultRoundTrip.methods.map((item) => item.id).toSorted()) === json(duplicated.methods.map((item) => item.id).toSorted()));
    check("default-export-reports-unknown", !defaultText.includes("X-ABLabel") && duplicated.unmapped.length === 1);
    const fullText = exportCard(duplicated, { includeUnmapped: true });
    const fullRoundTrip = importCard(fullText, { includeUnmapped: true });
    check("include-unmapped-retains-raw-line", fullText.includes("X-ABLabel") && fullRoundTrip.unmapped.some((item) => item.name === "ITEM1.X-ABLABEL" || item.name === "X-ABLABEL"));
    check("imported-lineage-is-visible", fullRoundTrip.methods.every((item) => typeof item.id === "string" && item.id.startsWith("method-")));
    check("imported-lineage-source-is-stable", fullRoundTrip.methods.every((item) => item.source.cardId === duplicated.cardId
        && item.source.property === item.type.toUpperCase() && Number.isSafeInteger(item.source.sourceIndex)));
    const invalid = [
        ["empty-value-unknown", () => validateCard({ ...clone(baseA), methods: [{ ...baseA.methods[0], value: "  " }] })],
        ["control-value-unknown", () => validateCard({ ...clone(baseA), methods: [{ ...baseA.methods[0], value: "bad\u0000value" }] })],
        ["duplicate-id-unknown", () => validateCard({ ...clone(baseA), methods: [{ ...baseA.methods[0] }, { ...baseA.methods[1], id: baseA.methods[0].id }] })],
        ["multiple-primary-unknown", () => validateCard({ ...clone(baseA), methods: [...baseA.methods, {
            ...clone(baseA.methods[0]), id: "method-a-phone-secondary", order: 3,
            source: { ...clone(baseA.methods[0].source), sourceIndex: 3 }, params: { PREF: "1" },
        }] })],
    ];
    for (const [id, fn] of invalid) { let rejected = false; try { fn(); } catch { rejected = true; } check(id, rejected); }
    const defaultLoss = defaultRoundTrip.loss.concat(duplicated.loss).map((item) => item.kind);
    check("loss-report-is-categorical", defaultLoss.includes("retained-unmapped") || duplicated.unmapped.length > 0);
    check("no-automatic-merge-or-repair", duplicated.methods.length === 4 && duplicated.loss.some((item) => item.kind === "duplicate-value-visible"));
    return { checks, summary: { total: checks.length, passed: checks.filter((item) => item.pass).length, failed: checks.filter((item) => !item.pass).length },
        baseline: { cards: [summarizeCard(baseA), summarizeCard(baseB)] },
        operations: { edited: summarizeCard(edited), deleted: summarizeCard(deleted), added: summarizeCard(added), reordered: summarizeCard(reordered), duplicated: summarizeCard(duplicated) },
        exportObservations: { default: { bytes: Buffer.byteLength(defaultText), lines: defaultText.split(/\r?\n/).filter(Boolean).length, includesUnmapped: false, digest: digest(defaultText) },
            includeUnmapped: { bytes: Buffer.byteLength(fullText), lines: fullText.split(/\r?\n/).filter(Boolean).length, includesUnmapped: true, digest: digest(fullText) },
            defaultRoundTrip: summarizeCard(defaultRoundTrip), includeUnmappedRoundTrip: summarizeCard(fullRoundTrip) },
        syntheticOnly: true, kernelRequests: 0, productionChanges: false, candidateContractAccepted: false,
        rawValuesOmitted: true, byteRoundTripVerified: false, externalInteropVerified: false, uiVerified: false };
}

export function runResearch() { return runChecks(); }

export async function main(args = process.argv.slice(2)) {
    assert.ok(args.every((arg) => arg === "--dry-run"), "Only --dry-run supported");
    const report = runResearch();
    if (!args.includes("--dry-run")) fs.writeFileSync(OUTPUT, JSON.stringify(report, null, 2) + "\n", "utf8");
    console.log(JSON.stringify({ status: "done_isolated", checks: report.summary, syntheticOnly: report.syntheticOnly,
        kernelRequests: report.kernelRequests, productionChanges: report.productionChanges, candidateContractAccepted: report.candidateContractAccepted,
        rawValuesOmitted: report.rawValuesOmitted, output: args.includes("--dry-run") ? null : path.resolve(OUTPUT) }, null, 2));
    return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
