import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { randomUUID } from "node:crypto";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import ts from "typescript";
import { assertIsolatedPath, assertTestPortAvailable, observeTestKernel, prepareIsolatedWorkspace } from "./kernel-safety.mjs";
import { stopIsolatedBrowser } from "./browser-cleanup.mjs";
import { verifyRealFrontend } from "./frontend-flow.mjs";

const workspace = process.env.LVCT_E2E_WORKSPACE
    ? path.resolve(process.env.LVCT_E2E_WORKSPACE)
    : path.join(os.tmpdir(), `SiYuan-Lvct-Services-${randomUUID()}`);
const kernel = ["D:/biji/SiYuan/resources/kernel/SiYuan-Kernel.exe", "D:/RJ/SiYuan/resources/kernel/SiYuan-Kernel.exe",
    path.join(process.env.ProgramFiles || "C:/Program Files", "SiYuan/resources/kernel/SiYuan-Kernel.exe")].find(fs.existsSync);
if (!kernel) throw new Error("未找到独立测试内核");
const configuredPort = Number(process.env.LVCT_E2E_PORT || 0);
const port = configuredPort > 0 ? configuredPort : await new Promise((resolvePort, rejectPort) => {
    const server = net.createServer();
    server.once("error", rejectPort);
    server.listen({ host: "127.0.0.1", port: 0, exclusive: true }, () => {
        const assigned = server.address().port;
        server.close((error) => error ? rejectPort(error) : resolvePort(assigned));
    });
});
await assertTestPortAvailable("127.0.0.1", port);
prepareIsolatedWorkspace(workspace, "lvct-services-test.json", "lvct actual services regression");
const storage = path.join(workspace, "data/storage/petal/lvct-isolated-test");
let storageWrites = 0;
const requestedRoutes = [];
assertIsolatedPath(workspace, storage);
fs.mkdirSync(storage, { recursive: true });
const plugin = {
    async loadData(key) {
        assert.match(key, /^[a-z0-9-]+\.json$/);
        const target = path.join(storage, key);
        assertIsolatedPath(workspace, target);
        return fs.existsSync(target) ? JSON.parse(fs.readFileSync(target, "utf8")) : null;
    },
    async saveData(key, value) {
        assert.match(key, /^[a-z0-9-]+\.json$/);
        const target = path.join(storage, key);
        assertIsolatedPath(workspace, target);
        fs.writeFileSync(target, JSON.stringify(value));
        storageWrites += 1;
    },
};
let child;
let assertRunning;
let accessToken = "";
async function envelope(route, body = {}) {
    assertRunning?.();
    requestedRoutes.push(route);
    const response = await fetch(`http://127.0.0.1:${port}${route}`, {
        method: "POST", headers: { "Content-Type": "application/json", ...(accessToken ? { Authorization: `Token ${accessToken}` } : {}) },
        body: JSON.stringify(body), signal: AbortSignal.timeout(10000),
    });
    assertRunning?.();
    const payload = await response.json();
    if (route === "/api/av/setAttributeViewBlockAttr" && !evidence.cellWriteShape) evidence.cellWriteShape = payload;
    if (route === "/api/av/renderAttributeView" && payload.data?.view?.rows?.length && !evidence.emptyOptionShape) {
        evidence.emptyOptionShape = payload.data.view.rows[0].cells.filter((cell) => ["select", "mSelect"].includes(cell.valueType));
    }
    return payload;
}
async function request(route, body = {}) {
    const response = await envelope(route, body);
    assert.equal(response.code, 0, `${route}: ${response.msg}`);
    return response.data;
}
globalThis.__lvctServiceKernelRequest = envelope;
const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
        if (specifier === "siyuan") return { shortCircuit: true, url: "data:text/javascript," + encodeURIComponent(
            "export function fetchPost(route,body,callback,timeout,failure){globalThis.__lvctServiceKernelRequest(route,body).then(callback,failure);}") };
        if (specifier.startsWith(".") && context.parentURL?.startsWith("file:")) {
            const candidate = new URL(specifier + ".ts", context.parentURL);
            if (fs.existsSync(fileURLToPath(candidate))) return nextResolve(candidate.href, context);
        }
        return nextResolve(specifier, context);
    },
    load(url, context, nextLoad) {
        if (url.startsWith("file:") && url.endsWith(".ts")) return { shortCircuit: true, format: "module", source:
            ts.transpileModule(fs.readFileSync(fileURLToPath(url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext } }).outputText };
        return nextLoad(url, context);
    },
});
async function boot() {
    child = spawn(kernel, ["--workspace", workspace, "serve", "--wd", path.resolve(path.dirname(kernel), ".."), "--port", String(port)], {
        stdio: "ignore", windowsHide: true, env: { ...process.env, SIYUAN_WORKSPACE_PATH: workspace },
    });
    assertRunning = observeTestKernel(child);
    const deadline = Date.now() + 60000;
    while (true) {
        assertRunning();
        const result = await envelope("/api/system/bootProgress").catch(() => undefined);
        if (result?.code === 0 && result.data?.progress >= 100) break;
        if (Date.now() > deadline) throw new Error("独立内核启动超时");
        await new Promise((resolveWait) => setTimeout(resolveWait, 250));
    }
    accessToken = JSON.parse(fs.readFileSync(path.join(workspace, "conf/conf.json"), "utf8")).accessAuthCode || "";
    assertIsolatedPath(workspace, storage);
    fs.mkdirSync(storage, { recursive: true });
}
async function stop() {
    if (child) await stopIsolatedBrowser(child, { requestClose: () => envelope("/api/system/exit", { force: true }) });
    child = undefined;
    assertRunning = undefined;
}
const evidence = { isolated: true, randomPort: true, uuidWorkspace: true, actualProductServices: true, realFrontend: false,
    storageAdapter: "controlled files in isolated workspace", results: [] };
async function verify(name, run) {
    await run();
    evidence.results.push({ name, ok: true });
    console.log(`PASS ${name}`);
}
const init = await import("../../src/services/init.ts");
const contacts = await import("../../src/services/contacts.ts");
const roster = await import("../../src/services/roster.ts");
const { emptyDraft } = await import("../../src/domain/person.ts");
const { createDocWithMd } = await import("../../src/api/client.ts");
const { fetchDocMarkdown } = await import("../../src/api/blocks.ts");
const aliases = await import("../../src/services/person-aliases.ts");
const { bindContactAliasStorage } = await import("../../src/services/contact-aliases.ts");
const exchanges = await import("../../src/services/exchanges.ts");
const { captureFromDoc } = await import("../../src/services/capture.ts");
const { loadInteractionStore } = await import("../../src/data/interactions.ts");
const organizations = await import("../../src/services/org.ts");
const memberWrites = await import("../../src/services/org-member-writes.ts");
const { loadOrgMembershipStore } = await import("../../src/data/org-membership.ts");
const { exportMigrationBundle, previewMigrationImport, importMigrationBundle } = await import("../../src/services/migration-bundle.ts");
const settingsHealth = await import("../../src/services/settings-health.ts");
const detachAliases = bindContactAliasStorage(plugin);
let settings;
let first;
let second;
let captured;
let exchange;
let org;
let replacement;
try {
    await boot();
    evidence.kernelVersion = await request("/api/system/version");
    await verify("实际初始化与稳定人物创建", async () => {
        settings = await init.initializeWorkspace(plugin, { notebookName: "虚构服务验收", createSelf: false }, () => {});
        first = await contacts.createContact(settings, { ...emptyDraft(), name: "虚构服务甲" });
        second = await contacts.createContact(settings, { ...emptyDraft(), name: "虚构服务乙" });
        assert.notEqual(first.docId, second.docId);
        assert.notEqual(first.itemId, second.itemId);
    });
    await verify("设置补列与四层重绑只读预览及确认回读", async () => {
        const beforeWrites = storageWrites;
        const beforeRequests = requestedRoutes.length;
        const fields = await settingsHealth.previewMissingFields(plugin, settings);
        assert.equal(fields.missing.length, 0);
        const anchors = { notebookId: settings.notebookId, hostDocId: settings.hostDocId,
            dbBlockId: settings.dbBlockId, avId: settings.avId };
        const rebind = await settingsHealth.previewRebindSettings(plugin, settings, anchors);
        assert.equal(rebind.impacts.every((field) => !field.changed), true);
        assert.equal(storageWrites, beforeWrites, "只读预览写了插件数据");
        const readRoutes = new Set(["/api/notebook/lsNotebooks", "/api/query/sql", "/api/sqlite/flushTransaction",
            "/api/av/renderAttributeView", "/api/av/getAttributeView"]);
        const previewRoutes = requestedRoutes.slice(beforeRequests);
        assert.equal(previewRoutes.every((route) => readRoutes.has(route)), true, JSON.stringify(previewRoutes));
        settings = await settingsHealth.rebindSettings(plugin, settings, anchors, rebind);
        assert.deepEqual(settings.fieldMap, rebind.target.fieldMap);
        assert.equal((await settingsHealth.checkSettingsHealth(settings)).ok, true);
        evidence.settingsPreviewRoutes = previewRoutes;
    });
    await verify("生日早年、公历农历连续保存与清空回读", async () => {
        for (const [birthday, isLunar] of [["1950-01-02", true], ["2024-02-29", false], ["", false]]) {
            const report = await contacts.updateContactFields(settings, first.itemId, { ...emptyDraft(), name: "虚构服务甲", birthday, isLunar });
            assert.equal(report.complete, true, JSON.stringify(report));
            roster.invalidateRoster();
            const saved = (await roster.getRoster(settings)).find((person) => person.docId === first.docId);
            assert.equal(saved.birthday, birthday);
            assert.equal(saved.isLunar, isLunar);
        }
    });
    await verify("多人事项来源、当日日记、地点和双方人物投影及重复捕获", async () => {
        const sourceDocId = await createDocWithMd(settings.notebookId, "/虚构多人会议", "用户原文保留\n");
        const options = { personDocIds: [first.docId, second.docId], newNames: [], date: "2026-10-04", place: "虚构会议室", note: "虚构协作" };
        captured = { ...(await captureFromDoc(plugin, settings, sourceDocId, options)), sourceDocId };
        assert.equal(captured.complete, true, JSON.stringify(captured));
        assert.equal(captured.interactions, 2);
        for (const docId of [sourceDocId, captured.dateDocId, captured.placeDocId, first.docId, second.docId]) {
            assert.ok(docId);
            const content = (await fetchDocMarkdown(docId)).content;
            assert.ok(content.includes("siyuan://blocks/"), `未找到事项引用 ${docId}`);
        }
        assert.ok((await fetchDocMarkdown(sourceDocId)).content.includes("用户原文保留"));
        const repeated = await captureFromDoc(plugin, settings, sourceDocId, options);
        assert.equal(repeated.complete, true);
        assert.equal(repeated.interactions, 0);
        assert.equal((await loadInteractionStore(plugin)).events.length, 2);
    });
    await verify("往来账本稳定请求、结清与重新打开", async () => {
        const input = { requestId: exchanges.newExchangeRequestId(), personDocId: first.docId, kind: "money", direction: "receivable",
            description: "虚构借款", amount: 123, currency: "CNY", occurredOn: "2026-10-04" };
        exchange = await exchanges.createPersonExchange(plugin, input);
        assert.equal((await exchanges.createPersonExchange(plugin, input)).id, exchange.id);
        assert.equal((await exchanges.changePersonExchangeStatus(plugin, exchange.id, "settled", "2026-10-04")).status, "settled");
        assert.equal((await exchanges.changePersonExchangeStatus(plugin, exchange.id, "open")).status, "open");
        assert.equal((await exchanges.listPersonExchanges(plugin, first.docId)).length, 1);
    });
    await verify("别名唯一核实、重复幂等、泛称拒绝与列表搜索", async () => {
        const alias = await aliases.addPersonAlias(plugin, first.docId, "服务昵称甲", settings);
        assert.equal((await aliases.addPersonAlias(plugin, first.docId, "服务昵称甲", settings)).id, alias.id);
        assert.equal((await aliases.resolveAlias(plugin, "服务昵称甲", settings)).personDocId, first.docId);
        await assert.rejects(() => aliases.addPersonAlias(plugin, second.docId, "王总", settings));
        assert.equal(contacts.filterContacts(await contacts.listContacts(settings), "服务昵称甲")[0].docId, first.docId);
    });
    await verify("组织员工接替保留旧历史与双方文档投影", async () => {
        org = { ...(await organizations.createOrganization(settings, "虚构公司", plugin)), name: "虚构公司" };
        const original = await memberWrites.saveOrganizationMember(plugin, settings, { orgDocId: org.docId, personDocId: first.docId,
            joinedOn: "2026-01-01", affiliationKind: "work", title: "对接人" });
        assert.equal(original.fact, "verified");
        replacement = await memberWrites.replaceOrganizationMemberWithProjection(plugin, settings, { formerId: original.membership.id,
            personDocId: second.docId, joinedOn: "2026-10-04", leftOn: "2026-10-03", affiliationKind: "work", title: "新对接人" }, original.membership);
        assert.equal(replacement.fact, "verified");
        assert.ok(replacement.projections.every((projection) => projection.status === "applied" || projection.status === "skipped"), JSON.stringify(replacement));
        const members = (await loadOrgMembershipStore(plugin)).memberships;
        assert.equal(members.find((member) => member.personDocId === first.docId).status, "former");
        assert.equal(members.find((member) => member.personDocId === second.docId).status, "active");
        const organizationBody = await request("/api/query/sql", { stmt: `SELECT markdown FROM blocks WHERE root_id='${org.docId}'` });
        evidence.organizationProjection = organizationBody.map((block) => block.markdown).join("\n");
        assert.ok(evidence.organizationProjection.includes(second.docId));
    });
    await verify("迁移包新模块覆盖、预览与现状优先重复恢复", async () => {
        const bundle = await exportMigrationBundle(plugin);
        const preview = await previewMigrationImport(bundle);
        assert.ok(preview.some((module) => module.key === "aliases"));
        const result = await importMigrationBundle(plugin, bundle);
        assert.equal(result.failed.length, 0, JSON.stringify(result));
        assert.equal((await exchanges.listPersonExchanges(plugin, first.docId)).length, 1);
    });
    await stop();
    await boot();
    await verify("真实内核重启后的原人物、双链、账本、别名和组织历史回读", async () => {
        roster.invalidateRoster();
        assert.equal((await contacts.listContacts(settings)).length, 2);
        assert.equal((await aliases.resolveAlias(plugin, "服务昵称甲", settings)).personDocId, first.docId);
        assert.equal((await exchanges.listPersonExchanges(plugin, first.docId))[0].id, exchange.id);
        assert.equal((await loadOrgMembershipStore(plugin)).memberships.length, 2);
        assert.ok((await fetchDocMarkdown(captured.placeDocId)).content.includes(first.docId));
    });
    if (process.env.LVCT_REAL_FRONTEND === "1") {
        evidence.frontend = await verifyRealFrontend({
            workspace, storage, baseURL: `http://127.0.0.1:${port}`, request: envelope, first, second, captureSourceDocId: captured.sourceDocId, organization: org, settings,
        });
        evidence.realFrontend = evidence.frontend.ok;
        console.log(`真实 browser-desktop 前端验收：${evidence.frontend.ok ? "PASS" : "LIMITED"}`);
    }
} catch (error) {
    evidence.results.push({ name: "未完成步骤", ok: false, detail: error.stack });
    process.exitCode = 1;
    console.error(error);
} finally {
    try { await stop(); } catch (error) { evidence.cleanupFailure = String(error); process.exitCode = 1; }
    detachAliases();
    hooks.deregister();
    delete globalThis.__lvctServiceKernelRequest;
    const evidenceFile = process.env.LVCT_E2E_EVIDENCE_FILE
        ? path.resolve(process.env.LVCT_E2E_EVIDENCE_FILE)
        : path.resolve(import.meta.dirname, "../../docs/verification/SERVICE-KERNEL-2026-10-04.json");
    fs.mkdirSync(path.dirname(evidenceFile), { recursive: true });
    fs.writeFileSync(evidenceFile, JSON.stringify(evidence, null, 2) + "\n");
}
console.log(`实际服务内核验收：${evidence.results.filter((result) => result.ok).length}/${evidence.results.length}`);
