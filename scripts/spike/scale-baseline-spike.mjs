import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
        if (specifier === "siyuan") return {
            shortCircuit: true,
            url: "data:text/javascript," + encodeURIComponent("export function fetchPost(){throw new Error('scale spike must not call kernel');}")
        };
        if (specifier.startsWith(".") && context.parentURL?.startsWith("file:")) {
            const candidate = new URL(specifier + ".ts", context.parentURL);
            if (fs.existsSync(fileURLToPath(candidate))) return nextResolve(candidate.href, context);
        }
        return nextResolve(specifier, context);
    },
    load(url, context, nextLoad) {
        if (url.startsWith("file:") && url.endsWith(".ts")) return {
            shortCircuit: true,
            format: "module",
            source: ts.transpileModule(fs.readFileSync(fileURLToPath(url), "utf8"), {
                compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext }
            }).outputText,
        };
        return nextLoad(url, context);
    },
});

const { rosterFromRender } = await import("../../src/domain/roster.ts");
const { filterContacts } = await import("../../src/services/contacts.ts");
const { organizationMarkerStates, organizationsFromDocs } = await import("../../src/domain/organization-scan.ts");

const PAGE_SIZE = 200;
const SIZES = [1_000, 10_000];
const FIELD_MAP = {
    birthday: "birthday", lunarBirthday: "lunarBirthday", phone: "phone", email: "email",
    wechat: "wechat", website: "website", group: "group", tags: "tags", related: "related",
};

function stableId(prefix, index) {
    return `20261005000000-${prefix}${index.toString(36).padStart(6, "0")}`;
}

function contactRow(index) {
    const docId = stableId("p", index);
    const name = `规模联系人 ${String(index).padStart(5, "0")}`;
    return {
        id: `row-${index}`,
        cells: [
            { valueType: "block", value: { type: "block", keyID: "name", block: { id: docId, content: name } } },
            { valueType: "phone", value: { type: "phone", keyID: "phone", phone: { content: `138000${String(index).padStart(5, "0")}` } } },
            { valueType: "email", value: { type: "email", keyID: "email", email: { content: `scale-${index}@example.test` } } },
            { valueType: "text", value: { type: "text", keyID: "wechat", text: { content: `scale_${index}` } } },
            { valueType: "select", value: { type: "select", keyID: "group", mSelect: [{ content: index % 2 ? "朋友" : "同事" }] } },
            { valueType: "mSelect", value: { type: "mSelect", keyID: "tags", mSelect: [{ content: index % 3 ? "规模" : "目标" }, { content: `批次-${index % 10}` }] } },
        ],
    };
}

function contactRender(rows) {
    return { view: { columns: [], rows, rowCount: rows.length } };
}

function profileFor(index) {
    return {
        readAt: 0,
        affiliations: { state: "known", value: {
            work: [{ orgName: `组织 ${index % 20}`, department: "研发", title: "成员" }],
            education: [], unspecified: [],
        } },
        relationship: { state: "known", labels: index % 2 ? ["朋友"] : ["同事"] },
    };
}

function addProfiles(people) {
    return people.map((person, index) => ({ ...person, profile: profileFor(index), aliasProfile: { state: "known", values: [`规模别名${index}`] } }));
}

function organizationRows(size) {
    return Array.from({ length: size }, (_, index) => ({
        root_id: stableId("o", index),
        ial: '{: custom-lvct-org="1"}',
        maxIal: '{: custom-lvct-org="1"}',
        markerCount: 1,
    }));
}

function organizationDocs(size) {
    return Array.from({ length: size }, (_, index) => ({
        id: stableId("o", index), content: `规模组织 ${String(index).padStart(5, "0")}`,
        hpath: `/规模组织/${index}`, box: stableId("b", 1),
    }));
}

function percentile(values, fraction) {
    const sorted = [...values].sort((left, right) => left - right);
    return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1))] ?? 0;
}

function measure(name, fn, iterations = 7) {
    const samples = [];
    let output;
    for (let iteration = 0; iteration < iterations; iteration += 1) {
        if (typeof globalThis.gc === "function") globalThis.gc();
        const before = process.memoryUsage().heapUsed;
        const start = process.hrtime.bigint();
        output = fn();
        const milliseconds = Number(process.hrtime.bigint() - start) / 1e6;
        const after = process.memoryUsage().heapUsed;
        samples.push({ milliseconds, heapDeltaBytes: Math.max(0, after - before) });
    }
    return {
        name,
        iterations,
        outputCount: Array.isArray(output) ? output.length : output?.count ?? 0,
        medianMs: percentile(samples.map((sample) => sample.milliseconds), 0.5),
        p95Ms: percentile(samples.map((sample) => sample.milliseconds), 0.95),
        peakHeapDeltaBytes: Math.max(...samples.map((sample) => sample.heapDeltaBytes)),
        gcAvailable: typeof globalThis.gc === "function",
    };
}

function runContactBenchmarks(size) {
    const rows = Array.from({ length: size }, (_, index) => contactRow(index));
    const firstRows = rows.slice(0, PAGE_SIZE);
    const projected = addProfiles(rosterFromRender(contactRender(rows), FIELD_MAP));
    return {
        fixtureSize: size,
        rows: [
            measure("contacts.firstPageProjection", () => rosterFromRender(contactRender(firstRows), FIELD_MAP)),
            measure("contacts.fullProjection", () => rosterFromRender(contactRender(rows), FIELD_MAP)),
            measure("contacts.clientFilter", () => filterContacts(projected, "规模别名")),
            measure("contacts.groupFilter", () => filterContacts(projected, "", "同事")),
        ],
    };
}

function runOrganizationBenchmarks(size) {
    const markers = organizationRows(size);
    const docs = organizationDocs(size);
    const firstMarkers = markers.slice(0, PAGE_SIZE);
    const firstDocs = docs.slice(0, PAGE_SIZE);
    return {
        fixtureSize: size,
        rows: [
            measure("organizations.firstPageProjection", () => organizationsFromDocs(organizationMarkerStates(firstMarkers), firstDocs)),
            measure("organizations.fullProjection", () => organizationsFromDocs(organizationMarkerStates(markers), docs)),
        ],
    };
}

const startedAt = new Date().toISOString();
const evidence = {
    isolated: true,
    syntheticOnly: true,
    kernelRequests: 0,
    kernelCallsForbidden: true,
    node: process.version,
    platform: `${process.platform}/${process.arch}`,
    cpu: os.cpus()[0]?.model ?? "unknown",
    memoryBytes: os.totalmem(),
    pageSize: PAGE_SIZE,
    budgets: {
        firstPageProjectionP95Ms: 100,
        fullProjectionP95Ms: 2_000,
        clientFilterP95Ms: 100,
        peakHeapDeltaBytes: 128 * 1024 * 1024,
    },
    contacts: SIZES.map(runContactBenchmarks),
    organizations: SIZES.map(runOrganizationBenchmarks),
    at: startedAt,
};

function budgetStatus() {
    const rows = [...evidence.contacts, ...evidence.organizations].flatMap((fixture) => fixture.rows.map((row) => ({ fixtureSize: fixture.fixtureSize, ...row })));
    return rows.map((row) => ({
        name: row.name,
        fixtureSize: row.fixtureSize,
        ok: row.name.endsWith("clientFilter")
            ? row.p95Ms <= evidence.budgets.clientFilterP95Ms
            : row.name.includes("firstPage")
                ? row.p95Ms <= evidence.budgets.firstPageProjectionP95Ms
                : row.p95Ms <= evidence.budgets.fullProjectionP95Ms && row.peakHeapDeltaBytes <= evidence.budgets.peakHeapDeltaBytes,
        p95Ms: row.p95Ms,
        peakHeapDeltaBytes: row.peakHeapDeltaBytes,
    }));
}

evidence.budgetChecks = budgetStatus();
evidence.ok = evidence.budgetChecks.every((check) => check.ok);
const output = path.resolve(import.meta.dirname, "scale-baseline-results.json");
fs.writeFileSync(output, JSON.stringify(evidence, null, 2) + "\n");
for (const check of evidence.budgetChecks) console.log(`${check.ok ? "PASS" : "FAIL"} ${check.name} ${check.fixtureSize} p95=${check.p95Ms.toFixed(2)}ms heap=${check.peakHeapDeltaBytes}`);
console.log(`规模隔离基线：${evidence.budgetChecks.filter((check) => check.ok).length}/${evidence.budgetChecks.length}`);
if (!evidence.ok) process.exitCode = 1;
hooks.deregister();
