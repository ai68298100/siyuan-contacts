import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import type { Plugin } from "siyuan";
import type { ContactsSettings } from "../src/domain/model.ts";
import type { OrgMembership } from "../src/domain/org-membership.ts";

interface Fixture {
    organizations: { docId: string; archived: boolean; removed?: boolean }[];
    people: { docId: string }[];
    beforeRoster?: () => void;
    projectionReads: number;
}

let fixture: Fixture;
Object.assign(globalThis, { __lvctOrgMemberWriteFixture: () => fixture });
const moduleSource = (source: string) => ({ shortCircuit: true, url: "data:text/javascript," + encodeURIComponent(source) });
const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
        if (context.parentURL?.endsWith("/src/services/org-member-writes.ts")) {
            if (specifier === "./org") return moduleSource("export async function scanOrganizations(){return globalThis.__lvctOrgMemberWriteFixture().organizations;}");
            if (specifier === "./roster") return moduleSource("export function invalidateRoster(){} export async function getRoster(){const fixture=globalThis.__lvctOrgMemberWriteFixture();fixture.beforeRoster?.();return fixture.people;}");
            if (specifier === "./org-projections") return moduleSource("export async function previewOrganizationProjections(){globalThis.__lvctOrgMemberWriteFixture().projectionReads++;return {targets:[]};} export function repairOrganizationProjection(){throw new Error('No projection target was requested');}");
        }
        if (specifier === "../api/client" && context.parentURL?.endsWith("/src/data/org-membership.ts")) {
            return moduleSource("export function newNodeId(){return '20261018000000-new0001';}");
        }
        if (specifier.startsWith(".") && context.parentURL?.startsWith("file:")) {
            const candidate = new URL(specifier + ".ts", context.parentURL);
            if (existsSync(fileURLToPath(candidate))) return nextResolve(candidate.href, context);
        }
        return nextResolve(specifier, context);
    },
    load(url, context, nextLoad) {
        if (url.startsWith("file:") && url.endsWith(".ts")) return { shortCircuit: true, format: "module", source:
            ts.transpileModule(readFileSync(fileURLToPath(url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext } }).outputText };
        return nextLoad(url, context);
    },
});
test.after(() => {
    hooks.deregister();
    Reflect.deleteProperty(globalThis, "__lvctOrgMemberWriteFixture");
});

const { editOrganizationMember, saveOrganizationMember, moveOrganizationMemberWithProjection } = await import("../src/services/org-member-writes.ts");
const settings = {} as ContactsSettings;
const orgDocId = "20261018000000-orga001";
const personDocId = "20261018000000-person1";
const original: OrgMembership = {
    id: "20261018000000-member1", orgDocId, personDocId,
    department: "研发", title: "工程师", joinedOn: "2024-01-01", leftOn: "", status: "active", note: "原始备注",
};

function setup(member: OrgMembership = original, archived = true) {
    fixture = { organizations: [{ docId: orgDocId, archived }], people: [{ docId: personDocId }], projectionReads: 0 };
    const data = new Map<string, unknown>([["org-membership.json", { schemaVersion: 1, memberships: [structuredClone(member)] }]]);
    let writes = 0;
    const plugin = {
        loadData: async (key: string) => structuredClone(data.get(key)),
        saveData: async (key: string, value: unknown) => { writes += 1; data.set(key, structuredClone(value)); },
    } as unknown as Plugin;
    const read = () => structuredClone(data.get("org-membership.json") as { memberships: OrgMembership[] }).memberships;
    return { plugin, read, writes: () => writes, replace: (value: OrgMembership) => data.set("org-membership.json", { schemaVersion: 1, memberships: [structuredClone(value)] }) };
}

test("archived organization: editing existing active title and note preserves the member fact", async () => {
    const state = setup();
    const report = await editOrganizationMember(state.plugin, settings, original.id, { title: "负责人", note: "仅维护既有事实", status: "active" }, original);
    assert.equal(report.fact, "verified");
    assert.deepEqual(report.membership, { ...original, title: "负责人", note: "仅维护既有事实" });
    assert.deepEqual(state.read(), [report.membership]);
    assert.equal(state.writes(), 1);
    assert.equal(fixture.projectionReads, 1);
});

test("archived organization: former history remains former and an explicit end remains available", async () => {
    const former: OrgMembership = { ...original, status: "former", leftOn: "2025-12-31" };
    const state = setup(former);
    const report = await editOrganizationMember(state.plugin, settings, former.id, { title: "历史职位更正", note: "补录说明" }, former);
    assert.equal(report.membership.status, "former");
    assert.equal(report.membership.leftOn, former.leftOn);
    const active = setup();
    const ended = await editOrganizationMember(active.plugin, settings, original.id, { status: "former", leftOn: "2026-10-18" }, original);
    assert.equal(ended.membership.status, "former");
    assert.equal(ended.membership.leftOn, "2026-10-18");
});

test("archived organization: new active, former restoration and moving active in are rejected without writes", async () => {
    const state = setup();
    await assert.rejects(saveOrganizationMember(state.plugin, settings, { orgDocId, personDocId, status: "active" }), /已归档/);
    assert.equal(state.writes(), 0);
    const former: OrgMembership = { ...original, status: "former", leftOn: "2025-12-31" };
    state.replace(former);
    await assert.rejects(editOrganizationMember(state.plugin, settings, former.id, { status: "active", leftOn: "" }, former), /已归档/);
    assert.equal(state.writes(), 0);
    const sourceOrgId = "20261018000000-orgb001";
    state.replace({ ...original, orgDocId: sourceOrgId });
    fixture.organizations.push({ docId: sourceOrgId, archived: false });
    await assert.rejects(moveOrganizationMemberWithProjection(state.plugin, settings, original.id, orgDocId), /不能移动到已归档组织/);
    assert.equal(state.writes(), 0);
    assert.equal(fixture.projectionReads, 0);
});

test("archived organization: a stale editor and a fact changed during target checks never overwrite newer data", async () => {
    const state = setup();
    const newer = { ...original, note: "其他窗口的新备注" };
    state.replace(newer);
    await assert.rejects(editOrganizationMember(state.plugin, settings, original.id, { title: "旧窗口草稿" }, original), /未覆盖新事实，本地草稿保留/);
    assert.deepEqual(state.read(), [newer]);
    assert.equal(state.writes(), 0);
    state.replace(original);
    fixture.beforeRoster = () => state.replace(newer);
    await assert.rejects(editOrganizationMember(state.plugin, settings, original.id, { title: "检查期间的草稿" }, original), /未覆盖新事实，本地草稿保留/);
    assert.deepEqual(state.read(), [newer]);
    assert.equal(state.writes(), 0);
    assert.equal(fixture.projectionReads, 0);
});

test("existing active maintenance still rejects a removed organization or a missing/ambiguous person", async () => {
    for (const invalid of ["removed", "missing-person", "ambiguous-person", "organization-person"] as const) {
        const state = setup();
        if (invalid === "removed") fixture.organizations[0].removed = true;
        if (invalid === "missing-person") fixture.people = [];
        if (invalid === "ambiguous-person") fixture.people.push({ docId: personDocId });
        if (invalid === "organization-person") fixture.organizations.push({ docId: personDocId, archived: false });
        await assert.rejects(editOrganizationMember(state.plugin, settings, original.id, { title: "不应保存" }, original), /未登记当前成员|未唯一绑定/);
        assert.equal(state.writes(), 0, invalid);
        assert.equal(fixture.projectionReads, 0, invalid);
    }
});

test("active organization: restoring a former record remains supported", async () => {
    const former: OrgMembership = { ...original, status: "former", leftOn: "2025-12-31" };
    const state = setup(former, false);
    const report = await editOrganizationMember(state.plugin, settings, former.id, { status: "active", leftOn: "" }, former);
    assert.equal(report.membership.status, "active");
    assert.equal(report.membership.leftOn, "");
    assert.equal(state.writes(), 1);
});
