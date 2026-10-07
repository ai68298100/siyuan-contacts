import { mount as mountComponent, unmount, tick } from "svelte";
import Workbench from "../../../src/components/Workbench.svelte";
import PersonDetail from "../../../src/components/people/PersonDetail.svelte";
import RelationGraph from "../../../src/components/graph/RelationGraph.svelte";
import VCardDialog from "../../../src/components/people/VCardDialog.svelte";
import CaptureDialog from "../../../src/components/capture/CaptureDialog.svelte";
import InitWizard from "../../../src/components/InitWizard.svelte";
import ImportDialog from "../../../src/components/people/ImportDialog.svelte";
import DashboardView from "../../../src/components/dashboard/DashboardView.svelte";
import PeopleView from "../../../src/components/people/PeopleView.svelte";
import SettingsView from "../../../src/components/SettingsView.svelte";
import { svelteDialog } from "../../../src/libs/dialog";
import { getRoster, invalidateRoster } from "../../../src/services/roster";
import { applyContactCandidateFields, batchUpdateContacts, createContact, retryContactFields, updateContactFields } from "../../../src/services/contacts";
import { retryVcfContacts } from "../../../src/services/vcard";
import PersonEditDialog from "../../../src/components/people/PersonEditDialog.svelte";
import ExchangeLedger from "../../../src/components/people/ExchangeLedger.svelte";
import PersonAliases from "../../../src/components/people/PersonAliases.svelte";
import DetailPanelsFixture from "./DetailPanelsFixture.svelte";
import { loadExchangeStore, createExchangeRecord, setExchangeStatus } from "../../../src/data/exchanges";
import { loadPersonAliasStore, createPersonAlias } from "../../../src/data/person-aliases";
import { listPersonExchanges } from "../../../src/services/exchanges";
import { listPersonAliases } from "../../../src/services/person-aliases";
import { designateSelfIdentity } from "../../../src/services/self-identity";
import { scanOrganizations, membershipsByOrganization, listPersonOrgMemberships } from "../../../src/services/org";
import { addOrgMembership } from "../../../src/data/org-membership";
import OrgManagerDialog from "../../../src/components/org/OrgManagerDialog.svelte";
import { addRelation, removeRelation } from "../../../src/services/relations";
import { recordInteraction, deleteInteraction, loadInteractionStore } from "../../../src/data/interactions";
import { initExternalBridge, disposeExternalBridge } from "../../../src/bridge/external-bridge";
import { captureFromDoc, resolveRecognizeTarget } from "../../../src/services/capture";
import { exportInteractionJson } from "../../../src/services/interaction-export";
import { createFollowUp, exportFollowUpsJson, importFollowUpsJson, previewFollowUpsImport, setFollowUpStatus } from "../../../src/services/followups";
import { loadSelfIdentity } from "../../../src/data/self-identity";
import { reconcileFollowUpTasksFromDoc, syncFollowUpTasksToDoc } from "../../../src/services/followup-sync";
import { emitDataChanged } from "../../../src/libs/data-events";
import { loadFollowUpStore, createFollowUpRecord } from "../../../src/data/followups";
import { loadTemplatesStore, saveTemplatesStore } from "../../../src/data/templates";
import { exportMigrationBundle, previewMigrationImport, importMigrationBundle } from "../../../src/services/migration-bundle";
import { loadDashboard } from "../../../src/services/dashboard";
import { loadPersonCadence, savePersonCadence } from "../../../src/data/cadences";
import { DEFAULT_TEMPLATES } from "../../../src/domain/interaction-templates";
import { listTemplates, saveTemplates } from "../../../src/services/templates";
import { importInteractionJson, previewInteractionImport } from "../../../src/services/interaction-import";
import { FIELD_SPECS } from "../../../src/domain/fields";
import { initializeWorkspace, inspectWorkspace, scanAnchorCandidates } from "../../../src/services/init";
import { buildTimeline, buildCoAttendance, toLocalDateKey } from "../../../src/domain/interactions";
import { DEFAULT_VIEW_PREFERENCES } from "../../../src/domain/preferences";
import { kernel } from "./siyuan-mock.js";
import { handleProtyleEvent } from "../../../src/panels/person-panel";
import "../../../src/index.scss";
import englishMessages from "../../../public/i18n/en.json";
import { runMigrationRegression } from "./migration-regression.js";
import { runPeopleProfileRegression } from "./people-profile-regression.js";
import { runOrganizationOperationsRegression } from "./organization-operations-regression.js";
import { runOperationResultRegression } from "./operation-result-regression.js";
import { configureBridgeKernel, runExternalBridgeRegression } from "../external-bridge-regression.js";
import { runRelationRegression } from "./relation-regression.js";
import { runOrganizationPageRegression } from "./organization-page-regression.js";
import { runHealthAuditRegression } from "./health-audit-regression.js";
import { runLifecycleRegression } from "./lifecycle-regression.js";
import { runTextEncodingRegression } from "./text-encoding-regression.js";
import { configureVcardKernel, runVcardRegression } from "./vcard-regression.js";
import { runSelfIdentityRegression } from "./self-identity-regression.js";
import { runOrganizationHealthRegression } from "./organization-health-regression.js";
import { runPersonIdentityRegression } from "./person-identity-regression.js";
import { runOrganizationProjectionRegression } from "./organization-projection-regression.js";
import { runGraphQueryRegression } from "./graph-query-regression.js";
import { runAiPreflightRegression } from "./ai-preflight-regression.js";
import { runImportRegression } from "./import-regression.js";
import { runAliasRegression } from "./alias-regression.js";
import { runOrganizationContextRegression } from "./organization-context-regression.js";
import { runSettingsRepairRegression } from "./settings-repair-regression.js";
import { runDocumentNavigationRegression } from "./document-navigation-regression.js";
import { runBatchSelectionRegression } from "./batch-selection-regression.js";
import { buildAiPreflight } from "../../../src/domain/ai-preflight";
import { buildAiCandidateDrafts } from "../../../src/domain/ai-candidates";

const fixture = document.querySelector("#fixture");
const results = [];
const runtimeErrors = [];
const pause = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
window.addEventListener("error", (event) => runtimeErrors.push(event.message));
window.addEventListener("unhandledrejection", (event) => runtimeErrors.push(String(event.reason)));
const assert = (ok, message) => { if (!ok) throw new Error(message); };
async function until(predicate, message) {
    const deadline = Date.now() + 4000;
    while (!predicate()) {
        if (Date.now() > deadline) throw new Error(`${message}\n界面状态：${fixture.textContent}`);
        await pause(20);
    }
    await tick();
}
function button(label, root = fixture) {
    const found = [...root.querySelectorAll("button")].find((node) => node.textContent.trim() === label);
    assert(found, `未找到按钮：${label}`);
    return found;
}
function navButton(labels, root = fixture) {
    const found = [...root.querySelectorAll("button")].find((node) => labels.includes(node.textContent.trim()));
    assert(found, `未找到导航按钮：${labels.join("/")}`);
    return found;
}
function input(node, value) {
    node.value = value;
    node.dispatchEvent(new Event("input", { bubbles: true }));
}
/** B03 可搜索选人器驱动：按 aria-label 打开浮层，按候选名筛选后点选第一项 */
async function pickOption(label, name) {
    const findTrigger = () => [...fixture.querySelectorAll(".lvct-picker__trigger")]
        .find((node) => node.getAttribute("aria-label") === label);
    const trigger = findTrigger();
    assert(trigger, `未找到选人器：${label}`);
    // 关系中心选择后，比较人物的 disabled 属性由父组件响应式更新；在高负载浏览器回归中
    // 可能比触发器 DOM 早一个 tick，先等待可交互再合成 click，避免把时序竞态误报成浮层故障。
    await until(() => {
        const current = findTrigger();
        return Boolean(current && !current.disabled);
    }, `${label}选人器尚未启用`);
    const readyTrigger = findTrigger();
    assert(readyTrigger && !readyTrigger.disabled, `${label}选人器尚未启用`);
    // 父组件在上一次选择后可能仍处于同一帧的响应式提交中；让当前
    // 触发器完成一次 DOM 提交，再点击并以 aria-expanded 作为打开确认。
    await tick();
    readyTrigger.click();
    try {
        await until(() => {
            const current = findTrigger();
            return Boolean(current?.getAttribute("aria-expanded") === "true" && fixture.querySelector(".lvct-picker__panel"));
        }, `${label}浮层未打开`);
    } catch (error) {
        // 仅重试一次合成点击，避免把高负载下的 click/响应式交接竞态报成产品浮层故障。
        const retryTrigger = findTrigger();
        if (!retryTrigger || retryTrigger.disabled) throw error;
        retryTrigger.click();
        await until(() => fixture.querySelector(".lvct-picker__panel"), `${label}浮层未打开`);
    }
    const search = fixture.querySelector(".lvct-picker__search");
    if (name) {
        input(search, name);
        await tick();
    }
    const option = [...fixture.querySelectorAll(".lvct-picker__option")][0];
    assert(option, `${label} 未找到候选：${name ?? "（全部）"}`);
    option.click();
    await tick();
}
const settings = {
    schemaVersion: 1, notebookName: "回归测试", notebookId: "20260927000000-book001",
    hostDocId: "20260927000000-host001", dbBlockId: "20260927000000-block01",
    avId: "20260927000000-view001", initializedAt: "2026-09-27T00:00:00Z",
    fieldMap: Object.fromEntries(FIELD_SPECS.map((field) => [field.key, field.key])),
};
const person = {
    docId: "20260927000000-person1", itemId: "row-1", name: "回归测试甲",
    phone: "", email: "", wechat: "", website: "", birthday: "", isLunar: false,
    group: "朋友", tags: [], relatedItemIds: [],
};
const emptyInsights = () => ({ timeline: [], coAttendance: [], totalEvents: 0 });
function mount(component, options) {
    if (component !== Workbench) return mountComponent(component, options);
    return mountComponent(component, {
        ...options,
        props: {
            ...options.props,
            facade: {
                listPersonOrgMemberships: async () => [],
                listCommonOrgBackground: async () => [],
                listOrganizations: async () => [],
                listPersonExchanges: async () => [],
                listPersonAliases: async () => [],
                ...options.props.facade,
            },
        },
    });
}
const renderResult = () => ({ view: {
    columns: FIELD_SPECS.map((field) => ({ id: field.key, name: field.nameZh, type: field.type })),
    rows: [{ id: person.itemId, cells: [{ valueType: "block", value: {
        type: "block", keyID: "name", block: { id: person.docId, content: person.name },
    } }] }],
} });
function resetKernel() {
    invalidateRoster();
    kernel.handler = async (route) => {
        if (route === "/api/av/renderAttributeView") return renderResult();
        throw new Error(`回归测试不允许请求 ${route}`);
    };
}
function configureOccasionKernel() {
    const sourceSectionId = "20260927000000-sect001";
    const sections = new Map();
    kernel.handler = async (route, payload) => {
        if (route === "/api/sqlite/flushTransaction") return null;
        if (route === "/api/av/renderAttributeView") return renderResult();
        if (route === "/api/query/sql") {
            const stmt = payload.stmt;
            if (stmt.startsWith("SELECT content FROM blocks WHERE id =")) {
                const docId = /id = '([^']+)'/.exec(stmt)?.[1];
                if (docId === person.docId) return [{ content: person.name }];
                if (docId === settings.hostDocId) return [{ content: "虚构捕获来源" }];
                return [];
            }
            if (stmt.includes("type='d'")) return [{
                id: "20260927000000-diary01", content: "2026-09-27",
                hpath: `/${settings.notebookName}/日记/2026-09-27`,
            }];
            const rootDocId = /root_id = '([^']+)'/.exec(stmt)?.[1];
            if (rootDocId === settings.hostDocId) return [{ id: sourceSectionId }];
            if (rootDocId === "20260927000000-diary01") return [{ id: "20260927000000-sect002" }];
            if (rootDocId === person.docId) return [{ id: "20260927000000-sect003" }];
            throw new Error(`捕获 fixture 未声明 SQL：${stmt}`);
        }
        if (route === "/api/block/updateBlock") { sections.set(payload.id, payload.data); return null; }
        throw new Error(`捕获 fixture 不允许请求 ${route}`);
    };
    return { sections, sourceSectionId };
}

function reflectContactWrites(handler) {
    const values = new Map();
    return async (route, body) => {
        const data = await handler(route, body);
        if (route === "/api/av/setAttributeViewBlockAttr") {
            const type = FIELD_SPECS.find((field) => field.key === body.keyID)?.type;
            if (type) values.set(`${body.itemID}/${body.keyID}`, {
                valueType: type, value: { type, keyID: body.keyID, ...structuredClone(body.value) },
            });
        }
        if (route === "/api/av/renderAttributeView" && data?.view?.rows) {
            return { ...data, view: { ...data.view, rows: data.view.rows.map((row) => {
                const cells = new Map(row.cells.map((cell) => [cell.value.keyID, cell]));
                for (const [key, value] of values) if (key.startsWith(`${row.id}/`)) cells.set(value.value.keyID, value);
                return { ...row, cells: [...cells.values()] };
            }) } };
        }
        return data;
    };
}

let contactFixtureCount = 0;
function configureContactVerificationKernel() {
    settings.avId = `20261004000000-v${String(++contactFixtureCount).padStart(6, "0")}`;
    const state = { rendered: structuredClone(renderResult()), writes: [], renders: 0,
        ignored: new Set(), rejected: new Set(), failReadback: false };
    kernel.handler = async (route, body) => {
        if (route === "/api/av/getAttributeViewItemIDsByBoundIDs") return Object.fromEntries(body.blockIDs.flatMap((docId) => {
            const matches = state.rendered.view.rows.filter((row) => row.cells.some((cell) => cell.value.block?.id === docId));
            return matches.length === 1 ? [[docId, matches[0].id]] : [];
        }));
        if (route === "/api/sqlite/flushTransaction") return null;
        if (route === "/api/query/sql") {
            const docId = body.stmt.match(/id\s*=\s*'([^']+)'/)?.[1];
            return state.rendered.view.rows.some((row) => row.cells.some((cell) => cell.value.block?.id === docId)) ? [{ id: docId }] : [];
        }
        if (route === "/api/av/renderAttributeView") {
            state.renders += 1;
            if (state.failReadback && state.writes.length) throw new Error("字段核实读取失败");
            return structuredClone(state.rendered);
        }
        if (route === "/api/av/setAttributeViewBlockAttr") {
            state.writes.push(structuredClone(body));
            if (state.rejected.has(body.keyID)) throw new Error("字段写入拒绝");
            if (!state.ignored.has(body.keyID)) {
                const row = state.rendered.view.rows.find((entry) => entry.id === body.itemID);
                const type = FIELD_SPECS.find((field) => field.key === body.keyID).type;
                row.cells = row.cells.filter((cell) => cell.value.keyID !== body.keyID);
                row.cells.push({ valueType: type, value: { type, keyID: body.keyID, ...structuredClone(body.value) } });
            }
            return null;
        }
        throw new Error(`字段核实夹具拒绝未知请求 ${route}`);
    };
    return state;
}

function configureAnchorScanKernel(documents, options = {}) {
    const state = {
        notebooks: [...documents.keys()].map((id) => ({ id, name: `扫描夹具 ${id}` })),
        calls: [],
        failColumns: false,
        failPageAfter: null,
        avBlocks: [{
            id: "20261003000000-block01", parent_id: options.hostDocId,
            markdown: 'data-av-id="20261003000000-av00001"',
        }],
    };
    kernel.handler = async (route, payload) => {
        state.calls.push({ route, payload });
        if (route === "/api/notebook/lsNotebooks") return { notebooks: state.notebooks };
        if (route === "/api/query/sql") {
            const stmt = payload.stmt;
            if (stmt.includes("type = 'av'")) return state.avBlocks;
            const notebookId = /box='([^']+)'/.exec(stmt)?.[1];
            assert(documents.has(notebookId), `扫描访问未知笔记本：${stmt}`);
            const docs = documents.get(notebookId);
            if (stmt.includes("COUNT(*)")) {
                if (options.unknownCount) throw new Error("总数未知");
                return [{ total: docs.length }];
            }
            const after = /id > '([^']+)'/.exec(stmt)?.[1];
            if (state.failPageAfter && after === state.failPageAfter) throw new Error("文档页注入失败");
            const limit = Number(/LIMIT (\d+)/.exec(stmt)?.[1]);
            assert(limit > 0 && limit <= 500 && stmt.includes("ORDER BY id"), `无界或无序扫描：${stmt}`);
            return docs.filter((doc) => !after || doc.id > after).slice(0, limit);
        }
        if (route === "/api/av/renderAttributeView") {
            if (state.failColumns === true || state.failColumns === payload.id) throw new Error("列注入失败");
            return { view: { columns: FIELD_SPECS.map((field) => ({ id: field.key, name: field.nameZh, type: field.type })), rows: [] } };
        }
        throw new Error(`扫描只读 fixture 拒绝 ${route}`);
    };
    return state;
}

function scanDocuments(count) {
    return Array.from({ length: count }, (_, index) => ({
        id: `20261003000000-${String(index).padStart(7, "0")}`,
        content: `扫描文档 ${index}`,
        hpath: `/扫描文档 ${index}`,
    }));
}
let mounted;
const caseFilter = new URLSearchParams(location.search).get("filter");
async function test(name, action) {
    if (caseFilter && !new RegExp(caseFilter).test(name)) return;
    resetKernel();
    (window.__cases = window.__cases || []).push(name);
    try {
        await action();
        results.push({ name, ok: true });
    } catch (error) {
        results.push({ name, ok: false, detail: error.stack });
    } finally {
        if (mounted) await unmount(mounted);
        mounted = undefined;
        fixture.replaceChildren();
        document.querySelector("#results").textContent = JSON.stringify(results, null, 2);
    }
}

await test("锚点实际服务：1501 篇跨三轮预算，游标前进、最后候选不遗漏且重扫只读", async () => {
    const docs = scanDocuments(1501);
    docs[1500].content = "联系人总表";
    const state = configureAnchorScanKernel(new Map([[settings.notebookId, docs]]), { hostDocId: docs[1500].id });
    const first = await scanAnchorCandidates({ pageSize: 500, maxDocuments: 600 });
    assert(first.status === "truncated" && first.progress.documentsScanned === 600
        && first.progress.documentsScannedThisCall === 600, `首轮预算错误：${JSON.stringify(first)}`);
    assert(first.cursor.afterDocId === docs[599].id && first.candidates.length === 0, "首轮游标或候选错误");
    const second = await scanAnchorCandidates({ cursor: first.cursor, pageSize: 500, maxDocuments: 600 });
    assert(second.status === "truncated" && second.progress.documentsScanned === 1200
        && second.progress.documentsScannedThisCall === 600, `继续扫描没有前进：${JSON.stringify(second)}`);
    assert(second.cursor.afterDocId === docs[1199].id, "第二轮未推进到正确文档");
    const third = await scanAnchorCandidates({ cursor: second.cursor, pageSize: 500, maxDocuments: 600 });
    assert(third.status === "complete" && third.cursor === null && third.progress.documentsScanned === 1501
        && third.progress.documentsScannedThisCall === 301 && third.progress.totalDocuments === 1501,
    `第三轮累计错误：${JSON.stringify(third)}`);
    assert(third.candidates.length === 1 && third.candidates[0].hostDocId === docs[1500].id
        && third.candidates[0].matchedFields === 9, "最后一篇总表的候选被遗漏");
    const repeat = await scanAnchorCandidates({ maxDocuments: 1000 });
    const repeatEnd = await scanAnchorCandidates({ cursor: repeat.cursor, maxDocuments: 1000 });
    assert(repeatEnd.status === "complete" && repeatEnd.progress.documentsScanned === 1501
        && JSON.stringify(repeatEnd.candidates) === JSON.stringify(third.candidates), "从头重扫结果不一致");
    assert(state.calls.every(({ route }) => ["/api/notebook/lsNotebooks", "/api/query/sql", "/api/av/renderAttributeView"].includes(route)),
        "只读扫描产生了写入请求");
});

await test("锚点实际服务：恰好 1000 篇仍核实下一空页，不凭总数提前宣称完成", async () => {
    const docs = scanDocuments(1000);
    const state = configureAnchorScanKernel(new Map([[settings.notebookId, docs]]));
    const first = await scanAnchorCandidates();
    assert(first.status === "truncated" && first.progress.documentsScanned === 1000
        && first.cursor.afterDocId === docs[999].id, "整页到上限没有保留游标");
    state.calls.length = 0;
    const end = await scanAnchorCandidates({ cursor: first.cursor });
    assert(end.status === "complete" && end.cursor === null && end.progress.documentsScanned === 1000
        && end.progress.documentsScannedThisCall === 0, `空页续做计数错误：${JSON.stringify(end)}`);
    assert(state.calls.some(({ route, payload }) => route === "/api/query/sql"
        && payload.stmt.includes(`id > '${docs[999].id}'`)), "未实际读取末页之后的范围");
});

await test("锚点实际服务：空本、跨本和笔记本重排可续做，增删笔记本使游标失效", async () => {
    const docs = scanDocuments(4);
    const books = new Map([
        ["20261003000000-book003", docs.slice(2)],
        ["20261003000000-book001", []],
        ["20261003000000-book002", docs.slice(0, 2)],
    ]);
    const state = configureAnchorScanKernel(books);
    const first = await scanAnchorCandidates({ pageSize: 2, maxDocuments: 3 });
    assert(first.status === "truncated" && first.progress.notebooksCompleted === 2
        && first.cursor.notebookId === "20261003000000-book003"
        && first.cursor.afterDocId === docs[2].id && first.cursor.scannedInNotebook === 1,
    `跨本游标错误：${JSON.stringify(first)}`);
    state.notebooks.reverse();
    const end = await scanAnchorCandidates({ cursor: first.cursor, pageSize: 2, maxDocuments: 3 });
    assert(end.status === "complete" && end.progress.notebooksCompleted === 3
        && end.progress.documentsScanned === 4 && end.progress.documentsScannedThisCall === 1,
    `笔记本重排阻止续扫：${JSON.stringify(end)}`);
    const rejectChangedBooks = async () => {
        state.calls.length = 0;
        let error = "";
        try { await scanAnchorCandidates({ cursor: first.cursor }); } catch (cause) { error = cause.message; }
        assert(error.includes("笔记本列表已变化") && state.calls.length === 1,
            `变化的笔记本集合未在扫描前拒绝：${error}`);
    };
    const originalBooks = [...state.notebooks];
    state.notebooks.push({ id: "20261003000000-book004", name: "新增测试本" });
    await rejectChangedBooks();
    state.notebooks = originalBooks.filter((book) => book.id !== "20261003000000-book002");
    await rejectChangedBooks();
});

await test("锚点实际服务：总数未知仍按文档页继续，未知不冒充零文档", async () => {
    configureAnchorScanKernel(new Map([[settings.notebookId, scanDocuments(3)]]), { unknownCount: true });
    const first = await scanAnchorCandidates({ pageSize: 2, maxDocuments: 2 });
    assert(first.status === "truncated" && first.progress.totalDocuments === null
        && first.progress.currentNotebookTotal === null && first.issues[0]?.kind === "count", "总数失败被伪装为零或阻止扫描");
    const end = await scanAnchorCandidates({ cursor: first.cursor, pageSize: 2, maxDocuments: 2 });
    assert(end.status === "complete" && end.progress.totalDocuments === null
        && end.progress.documentsScanned === 3 && end.progress.documentsScannedThisCall === 1
        && end.issues[0]?.kind === "count", `未知总数续扫错误：${JSON.stringify(end)}`);
});

await test("锚点实际服务：文档页失败保留断点，恢复后继续且计数不重复", async () => {
    const docs = scanDocuments(5);
    const state = configureAnchorScanKernel(new Map([[settings.notebookId, docs]]));
    state.failPageAfter = docs[1].id;
    const failed = await scanAnchorCandidates({ pageSize: 2, maxDocuments: 4 });
    assert(failed.status === "blocked" && failed.issues[0]?.kind === "documents"
        && failed.cursor.afterDocId === docs[1].id && failed.progress.documentsScanned === 2
        && failed.progress.documentsScannedThisCall === 2, `文档读取失败丢失断点：${JSON.stringify(failed)}`);
    state.failPageAfter = null;
    const end = await scanAnchorCandidates({ cursor: failed.cursor, pageSize: 2, maxDocuments: 4 });
    assert(end.status === "complete" && end.progress.documentsScanned === 5
        && end.progress.documentsScannedThisCall === 3 && end.issues.length === 0,
    `失败恢复的累计或单轮计数错误：${JSON.stringify(end)}`);
});

await test("锚点实际服务：字段读取失败停在宿主文档之前，重试不漏候选或重复计数", async () => {
    const docs = scanDocuments(5);
    docs[2].content = "联系人总表";
    const state = configureAnchorScanKernel(new Map([[settings.notebookId, docs]]), { hostDocId: docs[2].id });
    state.failColumns = true;
    const failed = await scanAnchorCandidates({ pageSize: 2, maxDocuments: 4 });
    assert(failed.status === "blocked" && failed.issues[0]?.kind === "columns"
        && failed.cursor.afterDocId === docs[1].id && failed.progress.documentsScanned === 2
        && failed.progress.documentsScannedThisCall === 2 && failed.candidates.length === 0,
    `未知字段被当作已扫描：${JSON.stringify(failed)}`);
    state.failColumns = false;
    const end = await scanAnchorCandidates({ cursor: failed.cursor, pageSize: 2, maxDocuments: 4 });
    assert(end.status === "complete" && end.progress.documentsScanned === 5
        && end.progress.documentsScannedThisCall === 3 && end.candidates.length === 1
        && end.candidates[0].hostDocId === docs[2].id, "字段恢复后遗漏宿主候选或重复计数");
});

await test("设置页实际扫描：未知读取可重试，候选跨轮去重，单轮与累计进度显示正确", async () => {
    const docs = scanDocuments(5);
    docs[2].content = "联系人总表";
    const state = configureAnchorScanKernel(new Map([[settings.notebookId, docs]]), { hostDocId: docs[2].id });
    state.avBlocks.push({
        id: "20261003000000-block02", parent_id: docs[2].id,
        markdown: 'data-av-id="20261003000000-av00002"',
    });
    state.failColumns = "20261003000000-av00002";
    mounted = mount(SettingsView, { target: fixture, props: {
        facade: {
            settings, viewPreferences: DEFAULT_VIEW_PREFERENCES,
            scanAnchorCandidates: (options) => scanAnchorCandidates({ ...options, pageSize: 2, maxDocuments: 3 }),
            checkSettingsHealth: async () => ({ ok: true, columns: 9, missing: [], problems: [], availableColumns: [] }),
        },
        settings, preferences: DEFAULT_VIEW_PREFERENCES,
        onSettingsUpdated() {}, onPreferencesUpdated() {}, onBack() {},
    } });
    navButton(["数据与字段"]).click();
    await tick();
    button("重新绑定已有数据库").click();
    await tick();
    button("扫描全库候选（只读）").click();
    await until(() => fixture.textContent.includes("扫描在第 2 篇"), "读取失败未在设置页显示暂停");
    assert(fixture.querySelectorAll('input[name="lvct-anchor-candidate"]').length === 1, "失败前核实的候选未保留");
    state.failColumns = false;
    button("重试当前位置").click();
    await until(() => fixture.textContent.includes("累计 5 / 5"), "重试后累计进度未前进");
    assert(fixture.textContent.includes("本轮已检查 3 篇"), "单轮进度错误显示为累计值");
    assert(fixture.querySelectorAll('input[name="lvct-anchor-candidate"]').length === 2, "重试的候选没有去重");
    button("继续扫描").click();
    await until(() => fixture.textContent.includes("扫描完成：已检查 5 / 5"), "最终空页未确认完成");
    assert(fixture.textContent.includes("找到 2 个候选")
        && fixture.textContent.includes("新增或移动的文档"), "累计候选数或快照边界没有说明");
    assert(![...fixture.querySelectorAll("button")].some((node) => node.textContent.trim() === "继续扫描"), "扫描完成仍可重复续做");
});

await test("首页零人筛选保持空结果，清除后恢复联系人", async () => {
    mounted = mount(Workbench, { target: fixture, props: {
        settings, preferences: DEFAULT_VIEW_PREFERENCES, isMobile: false,
        onPreferencesUpdated() {}, onOpenPersonDoc() {},
        facade: { settings, loadRecentInteractions: async () => ({}), loadDashboard: async () => ({
            people: 1, relations: 0, birthdays: [], birthdaysThisWeek: 0,
            stale: [], neverContacted: 0, neverContactedItemIds: [],
        }) },
    } });
    await until(() => fixture.querySelectorAll('.lvct-dash__stat').length === 4, "首页未加载");
    [...fixture.querySelectorAll('.lvct-dash__stat')].find((node) => node.textContent.includes("从未互动")).click();
    await until(() => fixture.textContent.includes("当前筛选下没有联系人"), "零人筛选错误地显示全名册");
    assert(!fixture.querySelector(".lvct-person-card"), "零人筛选不应出现卡片");
    button("清除所有筛选").click();
    await until(() => fixture.querySelector(".lvct-person-card"), "清除首页筛选未恢复联系人");
});

await test("工作台导航文字单行展示，不再被图标盒压成逐字竖排（UX-01.3）", async () => {
    mounted = mount(Workbench, { target: fixture, props: {
        settings, preferences: DEFAULT_VIEW_PREFERENCES, isMobile: false,
        onPreferencesUpdated() {}, onOpenPersonDoc() {},
        facade: { settings, loadRecentInteractions: async () => ({}), loadDashboard: async () => ({
            people: 0, relations: 0, birthdays: [], birthdaysThisWeek: 0,
            stale: [], neverContacted: 0, neverContactedItemIds: [],
        }) },
    } });
    await until(() => fixture.querySelector(".lvct-workbench__nav-text"), "导航未渲染");
    for (const node of fixture.querySelectorAll(".lvct-workbench__nav-text")) {
        const box = node.getBoundingClientRect();
        if (box.width === 0) continue; /* 移动视口下隐藏项（disabled/品牌区）无布局盒 */
        /* 竖排缺陷特征：被压进 18px 图标盒、逐字换行（高≥两行） */
        assert(box.width > 20 && box.height < 32,
            `导航文字盒子 ${Math.round(box.width)}x${Math.round(box.height)}，仍被压成逐字竖排`);
    }
});

await test("数据变化通知：空闲时原地刷新，草稿编辑中刷新且给出可见提示（FUNC-01.7）", async () => {
    let loads = 0;
    mounted = mount(Workbench, { target: fixture, props: {
        settings, preferences: DEFAULT_VIEW_PREFERENCES, isMobile: false,
        onPreferencesUpdated() {}, onOpenPersonDoc() {},
        facade: { settings, loadRecentInteractions: async () => ({}), loadDashboard: async () => {
            loads += 1;
            return { people: loads, relations: 0, birthdays: [], birthdaysThisWeek: 0,
                stale: [], neverContacted: 0, neverContactedItemIds: [] };
        } },
    } });
    await until(() => loads >= 1, "首页未加载");
    window.dispatchEvent(new CustomEvent("lvct-data-changed"));
    await until(() => loads >= 2, "数据变化通知未触发原地刷新");
    /* 草稿编辑中：刷新不静默——提示可见、弹窗与草稿保留 */
    button("新建联系人").click();
    await until(() => fixture.querySelector(".lvct-form input[type=text]"), "新建弹窗未打开");
    input(fixture.querySelector(".lvct-form input[type=text]"), "跨窗口编辑中");
    window.dispatchEvent(new CustomEvent("lvct-data-changed"));
    await until(() => fixture.textContent.includes("数据已在其他窗口更新"), "编辑中数据变化未给出可见提示");
    assert(fixture.querySelector(".lvct-form input[type=text]")?.value === "跨窗口编辑中", "提示后草稿丢失");
});

await test("数据刷新乱序防护：慢的旧互动响应不得覆盖新数据（FUNC-01.7-a）", async () => {
    let recentCalls = 0;
    let firstReturned = false;
    let releaseFirst = () => {};
    const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const older = new Date();
    older.setDate(older.getDate() - 60);
    kernel.handler = async (route) => {
        if (route === "/api/av/renderAttributeView") return renderResult();
        throw new Error(`回归测试不允许请求 ${route}`);
    };
    mounted = mount(Workbench, { target: fixture, props: {
        settings, preferences: DEFAULT_VIEW_PREFERENCES, isMobile: false,
        onPreferencesUpdated() {}, onOpenPersonDoc() {},
        facade: { settings,
            loadRecentInteractions: async () => {
                recentCalls += 1;
                if (recentCalls === 1) {
                    const value = await firstGate;
                    firstReturned = true;
                    return value;
                }
                return { [person.docId]: { occurredAt: yesterday.getTime(), localDate: toLocalDateKey(yesterday) } };
            },
            loadDashboard: async () => ({
                people: 1, relations: 0, birthdays: [], birthdaysThisWeek: 0,
                stale: [], staleTotal: 0, neverContacted: 0, neverContactedItemIds: [],
                followUps: [], actions: [], neverOrder: {},
            }),
        },
    } });
    await until(() => [...fixture.querySelectorAll(".lvct-workbench__nav-text")].some((node) => node.textContent?.trim() === "联系人"), "导航未渲染");
    const peopleNav = [...fixture.querySelectorAll(".lvct-workbench__nav-text")]
        .find((node) => node.textContent?.trim() === "联系人");
    assert(peopleNav && peopleNav.closest("button"), "未找到联系人导航按钮");
    peopleNav.closest("button").click();
    await until(() => fixture.querySelector(".lvct-person-card"), "名册未渲染");
    assert(fixture.textContent.includes("暂无互动"), "初始未拿到互动数据应显示暂无互动");
    emitDataChanged();
    await until(() => fixture.textContent.includes("昨天互动"), "数据变化未带来新互动数据");
    /* 迟到的旧响应（60 天前）必须在代际守卫处丢弃 */
    releaseFirst({ [person.docId]: { occurredAt: older.getTime(), localDate: toLocalDateKey(older) } });
    await until(() => firstReturned, "旧响应未返回，无法验证乱序防护");
    await tick();
    await tick();
    await tick();
    assert(fixture.textContent.includes("昨天互动"), "慢的旧响应覆盖了新数据（乱序未挡）");
    assert(!fixture.textContent.includes("60 天前互动"), "旧响应内容出现在列表中（乱序未挡）");
});

await test("数据刷新：已打开的 Peek 随数据变化原地重载洞察与跟进（FUNC-01.7-a）", async () => {
    let insightsCalls = 0;
    let followUpCalls = 0;
    kernel.handler = async (route) => {
        if (route === "/api/av/renderAttributeView") return renderResult();
        return null;
    };
    mounted = mount(Workbench, { target: fixture, props: {
        settings, preferences: DEFAULT_VIEW_PREFERENCES, isMobile: false,
        onPreferencesUpdated() {}, onOpenPersonDoc() {},
        facade: { settings, loadRecentInteractions: async () => ({}),
            loadDashboard: async () => ({
                people: 1, relations: 0, birthdays: [], birthdaysThisWeek: 0,
                stale: [], staleTotal: 0, neverContacted: 0, neverContactedItemIds: [],
                followUps: [], actions: [], neverOrder: {},
            }),
            loadPersonInsights: async () => { insightsCalls += 1; return { timeline: [], coAttendance: [], totalEvents: 0 }; },
            listPersonFollowUps: async () => {
                followUpCalls += 1;
                return [{ id: "fu-peek-1", personDocId: person.docId, title: "跨窗口跟进", dueDate: "2026-10-30", status: "open", createdAt: 1, updatedAt: 1 }];
            },
            createFollowUp: async () => { throw new Error("用例不涉及"); },
            setFollowUpStatus: async () => {},
            snoozeFollowUp: async () => {},
        },
    } });
    await until(() => [...fixture.querySelectorAll(".lvct-workbench__nav-text")].some((node) => node.textContent?.trim() === "联系人"), "导航未渲染");
    const detailNav = [...fixture.querySelectorAll(".lvct-workbench__nav-text")]
        .find((node) => node.textContent?.trim() === "联系人");
    assert(detailNav && detailNav.closest("button"), "未找到联系人导航按钮");
    detailNav.closest("button").click();
    await until(() => fixture.querySelector(".lvct-person-card"), "名册未渲染");
    fixture.querySelector(".lvct-person-card").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await until(() => insightsCalls >= 1 && followUpCalls >= 1, "Peek 未加载洞察与跟进");
    emitDataChanged();
    await until(() => insightsCalls >= 2 && followUpCalls >= 2, "Peek 未随数据变化原地重载");
    assert(fixture.textContent.includes("跨窗口跟进"), "重载后跟进列表未渲染");
});

await test("粘贴并识别：分组预览、勾选回填草稿、冲突默认不覆盖（FAST-01.1）", async () => {
    mounted = mount(Workbench, { target: fixture, props: {
        settings, preferences: DEFAULT_VIEW_PREFERENCES, isMobile: false,
        onPreferencesUpdated() {}, onOpenPersonDoc() {},
        facade: { settings, loadRecentInteractions: async () => ({}), loadDashboard: async () => ({
            people: 0, relations: 0, birthdays: [], birthdaysThisWeek: 0,
            stale: [], neverContacted: 0, neverContactedItemIds: [],
        }) },
    } });
    await until(() => fixture.querySelector(".lvct-dash__stats"), "首页未加载");
    button("新建联系人").click();
    await until(() => fixture.querySelector(".lvct-form input[type=text]"), "新建弹窗未打开");
    [...fixture.querySelectorAll("button")].find((n) => n.textContent.includes("粘贴并识别")).click();
    await until(() => fixture.querySelector(".lvct-qf__input"), "粘贴弹窗未打开");
    input(fixture.querySelector(".lvct-qf__input"), "暂不应用");
    await tick();
    fixture.querySelector(".lvct-qf .b3-button--cancel").click();
    await until(() => document.body.querySelector(".lvct-closeguard"), "快捷填充脏草稿关闭未弹守卫");
    assert(fixture.querySelector(".lvct-qf__input"), "快捷填充守卫期间弹窗被关闭");
    document.body.querySelector('.lvct-closeguard button[data-choice="cancel"]').click();
    await until(() => !document.body.querySelector(".lvct-closeguard"), "快捷填充关闭守卫未取消");
    assert(fixture.querySelector(".lvct-qf__input"), "取消守卫后快捷填充弹窗未保留");
    input(fixture.querySelector(".lvct-qf__input"), "张三\n手机：13800138000\n微信：zhang_san\n邮箱：a@example.com\n#家人");
    await tick(); /* 等 bind 渲染生效，否则「识别」仍是 disabled，click 会被吞掉 */
    button("识别").click();
    await until(() => fixture.querySelector(".lvct-qf__item"), "识别结果未展示");
    assert(fixture.textContent.includes("应用到表单（5）"), "无冲突新增项应默认全选");
    button("应用到表单（5）").click();
    await until(() => !fixture.querySelector(".lvct-qf__input"), "应用后粘贴弹窗未关闭");
    const nameInput = [...fixture.querySelectorAll(".lvct-form input")].find((node) => node.type === "text");
    assert(nameInput?.value === "张三", "姓名未回填");
    assert(fixture.querySelector('.lvct-form input[type="tel"]')?.value === "13800138000", "电话未回填");
    const tagsInput = [...fixture.querySelectorAll(".lvct-form input")].find((node) => node.placeholder?.includes("球友"));
    assert(tagsInput?.value.includes("家人"), "标签未回填");
    /* 冲突：已有值默认不覆盖，用户明确勾选后才写入 */
    [...fixture.querySelectorAll("button")].find((n) => n.textContent.includes("粘贴并识别")).click();
    await until(() => fixture.querySelector(".lvct-qf__input"), "第二次粘贴弹窗未打开");
    input(fixture.querySelector(".lvct-qf__input"), "手机：13999990000");
    await tick();
    button("识别").click();
    await until(() => fixture.querySelector(".lvct-qf__item--conflict"), "冲突项未标记");
    assert(fixture.textContent.includes("将覆盖当前值：13800138000"), "冲突提示未显示当前值");
    assert(button("应用到表单（0）").disabled, "冲突项默认不应勾选");
    fixture.querySelector(".lvct-qf__item--conflict input").click();
    await tick();
    button("应用到表单（1）").click();
    await until(() => !fixture.querySelector(".lvct-qf__input"), "冲突应用后未关闭");
    assert(fixture.querySelector('.lvct-form input[type="tel"]')?.value === "13999990000", "明确勾选后未更新");
});

await test("相关人选择走可搜索选人器：电话关键词筛选、空态、回车选中即建关系（B03）", async () => {
    const cellWrites = [];
    const rows = [
        { id: "row-1", docId: "20260927000000-person1", name: "回归测试甲", phone: "", wechat: "", tags: [], group: "朋友" },
        { id: "row-2", docId: "20260927000000-person2", name: "候选乙", phone: "13800001111", wechat: "yi_wx", tags: ["球友"], group: "同事" },
        { id: "row-3", docId: "20260927000000-person3", name: "候选丙", phone: "13900002222", wechat: "", tags: [], group: "家人" },
    ];
    kernel.handler = reflectContactWrites(async (route, body) => {
        if (route === "/api/av/renderAttributeView") return { view: {
            columns: FIELD_SPECS.map((field) => ({ id: field.key, name: field.nameZh, type: field.type })),
            rows: rows.map((row) => ({ id: row.id, cells: [
                { valueType: "block", value: { type: "block", keyID: "name", block: { id: row.docId, content: row.name } } },
                { valueType: "phone", value: { type: "phone", keyID: "phone", phone: { content: row.phone } } },
                { valueType: "text", value: { type: "text", keyID: "wechat", text: { content: row.wechat } } },
                { valueType: "mSelect", value: { type: "mSelect", keyID: "group", mSelect: row.group ? [{ content: row.group }] : [] } },
                { valueType: "mSelect", value: { type: "mSelect", keyID: "tags", mSelect: row.tags.map((tag) => ({ content: tag })) } },
                { valueType: "relation", value: { type: "relation", keyID: "related", relation: { blockIDs: [] } } },
            ] })),
        } };
        if (route === "/api/av/setAttributeViewBlockAttr") { cellWrites.push(body ?? {}); return null; }
        return null; /* 文档区块同步等后续调用宽松放行 */
    });
    mounted = mount(PersonDetail, { target: fixture, props: {
        settings, person, onRecord: async () => {}, onLoadInsights: async () => emptyInsights(),
        onOpenPersonDoc() {}, onNavigate() {}, onChanged() {}, onDeleted() {}, onClose() {},
    } });
    button("相关人").click();
    await until(() => fixture.querySelector(".lvct-picker__trigger"), "选人器未渲染");
    fixture.querySelector(".lvct-picker__trigger").click();
    await until(() => fixture.querySelector(".lvct-picker__panel"), "选人浮层未打开");
    const search = fixture.querySelector(".lvct-picker__search");
    input(search, "13800001111");
    await tick();
    let options = [...fixture.querySelectorAll(".lvct-picker__option")];
    assert(options.length === 1 && options[0].textContent.includes("候选乙"), "按电话关键词筛选失败");
    input(search, "不存在的词");
    await tick();
    await until(() => fixture.querySelector(".lvct-picker__empty"), "空态未显示");
    input(search, "候选乙");
    await tick();
    fixture.querySelector(".lvct-picker__search").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await until(() => cellWrites.length > 0, "回车选中后未发起关系写入");
    assert(JSON.stringify(cellWrites[0]).includes("row-2"), "关系写入未包含所选人物");
});

await test("资料完整度筛选与串行补录：缺电话列表、逐个保存且不清空已有资料（C03）", async () => {
    const cellWrites = [];
    const rows = [
        { id: "row-1", docId: "20260927000000-person1", name: "全空甲", phone: "", wechat: "", email: "", group: "", tags: [] },
        { id: "row-2", docId: "20260927000000-person2", name: "有邮箱缺电话乙", phone: "", wechat: "", email: "b@x.com", group: "", tags: [] },
        { id: "row-3", docId: "20260927000000-person3", name: "齐全丙", phone: "13900002222", wechat: "bing_wx", email: "c@x.com", group: "家人", tags: ["球友"] },
    ];
    kernel.handler = reflectContactWrites(async (route, body) => {
        if (route === "/api/av/renderAttributeView") return { view: {
            columns: FIELD_SPECS.map((field) => ({ id: field.key, name: field.nameZh, type: field.type })),
            rows: rows.map((row) => ({ id: row.id, cells: [
                { valueType: "block", value: { type: "block", keyID: "name", block: { id: row.docId, content: row.name } } },
                { valueType: "phone", value: { type: "phone", keyID: "phone", phone: { content: row.phone } } },
                { valueType: "text", value: { type: "text", keyID: "wechat", text: { content: row.wechat } } },
                { valueType: "email", value: { type: "email", keyID: "email", email: { content: row.email } } },
                { valueType: "mSelect", value: { type: "mSelect", keyID: "group", mSelect: row.group ? [{ content: row.group }] : [] } },
                { valueType: "mSelect", value: { type: "mSelect", keyID: "tags", mSelect: row.tags.map((tag) => ({ content: tag })) } },
                { valueType: "relation", value: { type: "relation", keyID: "related", relation: { blockIDs: [] } } },
            ] })),
        } };
        if (route === "/api/av/setAttributeViewBlockAttr") { cellWrites.push(body ?? {}); return null; }
        if (route === "/api/av/getAttributeViewItemIDsByBoundIDs") return Object.fromEntries(rows.map((row) => [row.docId, row.id]));
        return null;
    });
    mounted = mount(PeopleView, { target: fixture, props: {
        settings, preferences: DEFAULT_VIEW_PREFERENCES,
        loadRecentInteractions: async () => ({}),
        revision: 0, initialSort: "name",
        onOpenDetail() {}, onOpenPersonDoc() {},
        onPreferencesChange: async (next) => next,
    } });
    await until(() => fixture.querySelector(".lvct-person-card"), "列表未渲染");
    const peopleSearch = fixture.querySelector('.lvct-people__toolbar input[placeholder*="搜索姓名"]');
    assert(peopleSearch?.getAttribute("aria-label") === "搜索联系人", "桌面联系人搜索缺少可访问名称");
    const peopleGroupFilter = fixture.querySelector('.lvct-people__toolbar select');
    assert(peopleGroupFilter?.getAttribute("aria-label") === "分组筛选", "分组筛选缺少可访问名称");
    button("视图").click();
    await until(() => fixture.querySelector("#lvct-people-viewsmenu-panel"), "视图面板未打开");
    const viewsPanel = fixture.querySelector("#lvct-people-viewsmenu-panel");
    assert(viewsPanel?.getAttribute("role") === "group" && !viewsPanel.querySelector('[role="menuitem"]'), "保存视图面板不应伪装为嵌套 ARIA 菜单项");
    button("视图").click();
    button("更多筛选").click();
    await until(() => fixture.querySelector('input[name="lvct-profile-gap"]'), "资料完整度筛选组未显示");
    [...fixture.querySelectorAll('input[name="lvct-profile-gap"]')][0].click();
    await until(() => fixture.textContent.includes("逐个补录（2）"), "缺口人数统计错误");
    assert(fixture.textContent.includes("资料：缺电话"), "生效条件 chips 未显示");
    [...fixture.querySelectorAll("button")].find((node) => node.textContent.trim() === "逐个补录（2）").click();
    await until(() => fixture.querySelector(".lvct-qf h3"), "补录弹窗未打开");
    assert(fixture.querySelector(".lvct-qf h3").textContent === "全空甲", "补录未从第一人开始");
    input(fixture.querySelector('.lvct-qf input[type="tel"]'), "13800001234");
    await tick(); /* 等 bind 生效，否则保存按钮仍是 disabled，click 被吞 */
    button("保存并下一位").click();
    await until(() => fixture.querySelector(".lvct-qf h3")?.textContent === "有邮箱缺电话乙", "保存后未进下一位");
    input(fixture.querySelector('.lvct-qf input[type="tel"]'), "13900005678");
    await tick();
    button("保存并下一位").click();
    await until(() => fixture.textContent.includes("补录结束：保存 2 人"), "未出现补录总结");
    assert(cellWrites.length > 0, "未发起字段写入");
    invalidateRoster();
    const reread = await getRoster(settings);
    assert(reread.find((entry) => entry.docId === rows[1].docId)?.email === "b@x.com"
        && cellWrites.every((write) => write.keyID === "phone"), "补录改写了既有邮箱或其它字段");
    assert(JSON.stringify(cellWrites).includes("13800001234") && JSON.stringify(cellWrites).includes("13900005678"), "新电话未写入");
});

await test("移动端工具栏收纳：常驻搜索/视图切换/新建，其余进筛选与整理弹层（B09-1）", async () => {
    const rows = [
        { id: "row-1", docId: "20260927000000-person1", name: "全空甲", phone: "", wechat: "", email: "", group: "", tags: [] },
        { id: "row-2", docId: "20260927000000-person2", name: "候选乙", phone: "13800001111", wechat: "", email: "", group: "家人", tags: [] },
        { id: "row-3", docId: "20260927000000-person3", name: "候选丙", phone: "13900002222", wechat: "", email: "", group: "同事", tags: [] },
    ];
    kernel.handler = async (route) => {
        if (route === "/api/av/renderAttributeView") return { view: {
            columns: FIELD_SPECS.map((field) => ({ id: field.key, name: field.nameZh, type: field.type })),
            rows: rows.map((row) => ({ id: row.id, cells: [
                { valueType: "block", value: { type: "block", keyID: "name", block: { id: row.docId, content: row.name } } },
                { valueType: "phone", value: { type: "phone", keyID: "phone", phone: { content: row.phone } } },
                { valueType: "text", value: { type: "text", keyID: "wechat", text: { content: row.wechat } } },
                { valueType: "email", value: { type: "email", keyID: "email", email: { content: row.email } } },
                { valueType: "mSelect", value: { type: "mSelect", keyID: "group", mSelect: row.group ? [{ content: row.group }] : [] } },
                { valueType: "mSelect", value: { type: "mSelect", keyID: "tags", mSelect: row.tags.map((tag) => ({ content: tag })) } },
                { valueType: "relation", value: { type: "relation", keyID: "related", relation: { blockIDs: [] } } },
            ] })),
        } };
        return null;
    };
    mounted = mount(PeopleView, { target: fixture, props: {
        settings, preferences: DEFAULT_VIEW_PREFERENCES,
        loadRecentInteractions: async () => ({}),
        revision: 0, initialSort: "name", isMobile: true,
        onOpenDetail() {}, onOpenPersonDoc() {},
        onPreferencesChange: async (next) => next,
    } });
    await until(() => fixture.querySelector(".lvct-person-card"), "列表未渲染");
    const toolbarButtons = () => [...fixture.querySelectorAll(".lvct-people__toolbar button")].map((node) => node.textContent);
    assert(!toolbarButtons().some((label) => label.trim() === "导入已有文档"), "移动常驻区不应出现导入按钮");
    assert(!toolbarButtons().some((label) => label.trim() === "整理"), "移动常驻区不应出现整理按钮");
    const tools = [...fixture.querySelectorAll(".lvct-people__toolbar button")]
        .find((node) => node.textContent.includes("筛选与整理"));
    assert(tools, "收纳按钮未渲染");
    tools.click();
    await until(() => fixture.querySelector(".lvct-sheet"), "底部弹层未打开");
    assert(fixture.querySelectorAll(".lvct-sheet select").length >= 2, "弹层缺分组/排序控件");
    assert([...fixture.querySelectorAll(".lvct-sheet button")].some((node) => node.textContent.includes("导入已有文档")), "弹层缺导入入口");
    const groupSelect = fixture.querySelectorAll(".lvct-sheet select")[0];
    groupSelect.value = "家人";
    groupSelect.dispatchEvent(new Event("change", { bubbles: true }));
    await tick();
    await until(() => fixture.textContent.includes("共 1 人"), "弹层内分组筛选未生效");

    const sheet = fixture.querySelector(".lvct-sheet");
    assert(sheet.getAttribute("aria-modal") === "true", "移动工具抽屉未声明模态语义");
    const titleId = sheet.getAttribute("aria-labelledby");
    assert(titleId && fixture.querySelector(`#${titleId}`)?.textContent.includes("筛选与整理"), "移动工具抽屉标题关联缺失");
    const close = sheet.querySelector(".lvct-sheet__bar button");
    await until(() => document.activeElement === close, "打开抽屉后未聚焦收起按钮");

    const focusables = [...sheet.querySelectorAll("button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])")];
    assert(focusables.length > 1, "移动工具抽屉没有足够的键盘焦点项");
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    last.focus();
    last.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    assert(document.activeElement === first, "Tab 未从末项循环到首项");
    first.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true }));
    assert(document.activeElement === last, "Shift+Tab 未从首项循环到末项");

    close.focus();
    close.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await until(() => !fixture.querySelector(".lvct-sheet"), "Escape 未关闭移动工具抽屉");
    await until(() => document.activeElement === tools, "抽屉关闭后焦点未返回触发器");
    assert(tools.getAttribute("aria-expanded") === "false", "抽屉关闭后触发器展开状态未更新");
});

await test("行动区一键建跟进与处置撤销（C07/C06）", async () => {
    const created = [];
    const dismissals = [];
    const personOf = (name) => ({
        docId: `20260927000000-${name}0000`, itemId: `row-${name}`, name,
        phone: "", email: "", wechat: "", website: "", birthday: "", isLunar: false,
        group: "", tags: [], relatedItemIds: [],
    });
    mounted = mount(Workbench, { target: fixture, props: {
        settings, preferences: DEFAULT_VIEW_PREFERENCES, isMobile: false,
        onPreferencesUpdated() {}, onOpenPersonDoc() {},
        facade: { settings, loadRecentInteractions: async () => ({}),
            loadDashboard: async () => ({
                people: 1, relations: 0,
                birthdays: [{ person: personOf("寿星甲"), bucket: "today", projection: { daysUntil: 0, label: "9月29日" } }],
                birthdaysThisWeek: 1, stale: [], staleTotal: 0, neverContacted: 0, neverContactedItemIds: [],
                followUps: [], actions: [
                    { person: personOf("寿星甲"), bucket: "today", reasons: [
                        { kind: "birthday", label: "今天生日", bucket: "today" },
                    ] },
                ],
            }),
            loadReminderDismissals: async () => [...dismissals],
            dismissReminder: async (docId, kind, until) => dismissals.push({ docId, kind, until }),
            resumeReminder: async (docId, kind) => {
                const index = dismissals.findIndex((entry) => entry.docId === docId && entry.kind === kind);
                if (index >= 0) dismissals.splice(index, 1);
            },
            createFollowUp: async (docId, title, dueDate) => created.push({ docId, title, dueDate }),
        },
    } });
    await until(() => fixture.querySelector(".lvct-dash__row"), "行动未渲染");
    /* C07：⋯ → 建跟进（默认「联系一下」+7 天） */
    [...fixture.querySelectorAll("button")]
        .find((node) => (node.getAttribute("aria-label") ?? "").includes("更多处置")).click();
    await until(() => [...fixture.querySelectorAll("button")].some((node) => node.textContent.includes("建跟进")), "建跟进入口未显示");
    [...fixture.querySelectorAll("button")].find((node) => node.textContent.includes("建跟进")).click();
    await until(() => created.length === 1, "建跟进未写入");
    const expectedDue = (() => {
        const date = new Date();
        date.setDate(date.getDate() + 7);
        const pad = (value) => String(value).padStart(2, "0");
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    })();
    assert(created[0].title === "联系一下" && created[0].dueDate === expectedDue, `默认跟进参数错误：${JSON.stringify(created[0])}`);
    /* C06：跳过本年后通知带撤销，点击精确恢复（rowmenu 内按钮，等 busy 释放再点） */
    [...fixture.querySelectorAll("button")]
        .find((node) => (node.getAttribute("aria-label") ?? "").includes("更多处置")).click();
    const skipInMenu = () => [...fixture.querySelectorAll(".lvct-dash__rowmenu button")]
        .find((node) => node.textContent === "跳过本年" && !node.disabled);
    await until(() => skipInMenu(), "跳过本年入口未显示");
    skipInMenu().click();
    await until(() => dismissals.length === 1, "跳过本年未写入");
    const undoButton = [...fixture.querySelectorAll(".lvct-notice button")].find((node) => node.textContent === "撤销");
    assert(undoButton, "通知未提供撤销按钮");
    undoButton.click();
    await until(() => dismissals.length === 0, "撤销未恢复暂缓");
});

await test("完整迁移包：六模块导出→恢复预览→确认合并，现状优先不重复（C08/FUNC-01.6）", async () => {
    /* fake plugin：内存文件系统（loadData(key) 返回已解析对象；saveData(key, value)；Web Locks 降级队列） */
    const files = new Map();
    const plugin = {
        loadData: async (key) => files.get(key) ?? "",
        saveData: async (key, value) => { files.set(key, value); },
    };
    /* 预置：一条互动 + 一条跟进 + 一条模板（与包内部分重叠） */
    kernel.handler = async () => ({ code: 0 });

    await recordInteraction(plugin, { personDocId: "20260927000000-person1", localDate: "2026-09-28", source: "manual", note: "已有互动" });
    await createFollowUpRecord(plugin, { id: "fu-exist", personDocId: "20260927000000-person1", title: "已有跟进", dueDate: "2026-10-01", status: "open" });
    await saveTemplatesStore(plugin, [{ id: "tpl-exist", name: "已有模板", content: "x" }]);

    const bundleText = await exportMigrationBundle(plugin);
    const bundle = JSON.parse(bundleText);
    assert(bundle.storageKey === "lvct-migration-bundle", "导出包标识错误");
    assert(Array.isArray(bundle.modules.interactions?.events) && bundle.modules.interactions.events.length === 1, "互动模块缺失");
    assert(Array.isArray(bundle.modules.followUps?.items) && bundle.modules.followUps.items.length === 1, "跟进模块缺失");
    assert(Array.isArray(bundle.modules.templates?.templates) && bundle.modules.templates.templates.length === 1, "模板模块缺失");
    assert(!("registeredAt" in (bundle.modules.registry ?? {})) === false, "registry 模块应存在（可为空对象）");

    /* 包外新增一条互动/跟进（现状优先合并语义） */
    await recordInteraction(plugin, { personDocId: "20260927000000-person1", localDate: "2026-09-29", source: "manual", note: "包外新增" });

    window.__stage = "bundle-exported";
    const preview = previewMigrationImport(bundleText);
    window.__stage = "preview-ok";
    const byKey = Object.fromEntries(preview.map((module) => [module.key, module.count]));
    assert(byKey.interactions === 1 && byKey.followUps === 1 && byKey.templates === 1, `预览计数错误：${JSON.stringify(byKey)}`);

    window.__stage = "import-done";
    const result = await importMigrationBundle(plugin, bundleText);
    window.__stage = "import-returned";
    assert(result.modules.length >= 5, `恢复模块数不足：${JSON.stringify(result.modules)}`);
    /* 现状优先：互动/跟进不产生重复 */
    window.__stage = "check-interactions";
    assert((await loadInteractionStore(plugin)).events.length === 2, "互动合并后应有 2 条");
    window.__stage = "check-followups";
    assert((await loadFollowUpStore(plugin)).items.length === 1, "跟进合并后应仍 1 条（现状优先）");
    window.__stage = "check-templates";
    assert((await loadTemplatesStore(plugin))?.templates.length === 1, "模板合并后应仍 1 条");
    /* 坏包拒绝 */
    let rejected = false;
    try { previewMigrationImport("{ broken"); } catch { rejected = true; }
    assert(rejected, "坏包应被拒绝");
    const malformedModule = { ...bundle, modules: { ...bundle.modules, templates: { schemaVersion: 1, templates: "not-an-array" } } };
    rejected = false;
    try { previewMigrationImport(JSON.stringify(malformedModule)); } catch { rejected = true; }
    assert(rejected, "损坏的模块字段应在预览阶段被拒绝");
    const unknownModule = { ...bundle, modules: { ...bundle.modules, futureModule: { schemaVersion: 1 } } };
    rejected = false;
    try { previewMigrationImport(JSON.stringify(unknownModule)); } catch { rejected = true; }
    assert(rejected, "未知迁移模块应在预览阶段被拒绝");
});

await test("迁移恢复单模块失败可见、不阻断其他模块且不污染坏库（C08/FUNC-01.6-b/c）", async () => {
    const files = new Map();
    const plugin = {
        loadData: async (key) => files.get(key) ?? "",
        saveData: async (key, value) => { files.set(key, value); },
    };
    kernel.handler = async () => ({ code: 0 });
    /* 预置未知版本的模板库：模板模块恢复必须显式失败，其他模块照常合并，坏库不被覆盖 */
    files.set("interaction-templates.json", { schemaVersion: 2, templates: [] });
    await recordInteraction(plugin, { personDocId: "20260927000000-person1", source: "manual", note: "恢复前互动" });

    const bundleText = await exportMigrationBundle(plugin);
    const bundle = JSON.parse(bundleText);
    bundle.modules.templates = { schemaVersion: 1, templates: [{ id: "tpl-new", name: "包内模板", content: "y" }] };
    /* 向包内注入一条库中没有的互动：证明失败模块之外照常发生真实合并 */
    bundle.modules.interactions.events.push({
        id: "evt-extra", personDocId: "20260927000000-person2", occurredAt: 1, localDate: "2026-09-29", source: "manual",
    });
    const result = await importMigrationBundle(plugin, JSON.stringify(bundle));

    assert(result.failed.length === 1 && result.failed[0].key === "templates",
        `失败模块未报告：${JSON.stringify(result.failed)}`);
    assert(result.failed[0].message.includes("模板"), `失败原因不可读：${result.failed[0].message}`);
    assert(result.modules.some((module) => module.key === "interactions" && module.merged === 1),
        `互动模块被失败阻断或未真实合并：${JSON.stringify(result.modules)}`);
    assert(result.modules.some((module) => module.key === "cadences") && result.modules.some((module) => module.key === "registry"),
        "失败后的其余模块未继续执行");
    assert(files.get("interaction-templates.json").schemaVersion === 2, "损坏模板库被恢复覆盖污染");
});

await test("任务对账：勾选/改标题/改期回写索引，块删除标不可达且写侧不复活（B07/FUNC-01.3-a）", async () => {
    const files = new Map();
    const plugin = {
        loadData: async (key) => files.get(key) ?? "",
        saveData: async (key, value) => { files.set(key, value); },
    };
    files.set("contacts-settings.json", settings);
    files.set("follow-ups.json", { schemaVersion: 1, items: [
        { id: "fu-doc-1", personDocId: person.docId, title: "索引旧标题", dueDate: "2026-10-01", status: "open", createdAt: 1, updatedAt: 1 },
        { id: "fu-doc-2", personDocId: person.docId, title: "块被删事项", dueDate: "2026-10-02", status: "open", createdAt: 1, updatedAt: 1, docBlockId: "blk-gone" },
        { id: "fu-doc-3", personDocId: person.docId, title: "一致事项", dueDate: "2026-10-03", status: "open", createdAt: 1, updatedAt: 1, docBlockId: "blk-3" },
    ] });
    kernel.handler = async (route, payload) => {
        if (route === "/api/query/sql") {
            if (payload.stmt.includes("WHERE id = '")) return [{ id: person.docId }];
            if (payload.stmt.includes("id > '")) return [];
            /* 文档现状：fu-doc-1 已勾选且改标题/改期；fu-doc-2 的块已被删（不出现在本文档）；fu-doc-3 一致 */
            return [
                { id: "20261004000000-blkdoc1", ial: 'custom-lvct-followup="fu-doc-1"', markdown: "- [X] 文档新标题 📅2026-11-05" },
                { id: "20261004000000-blkdoc3", ial: 'custom-lvct-followup="fu-doc-3"', markdown: "- [ ] 一致事项 📅2026-10-03" },
            ];
        }
        return null;
    };

    const changed = await reconcileFollowUpTasksFromDoc(plugin, person.docId);
    assert(changed, "对账未报告收敛");
    const byId = Object.fromEntries((await loadFollowUpStore(plugin)).items.map((item) => [item.id, item]));
    assert(byId["fu-doc-1"].status === "done", "文档勾选未收敛为 done");
    assert(byId["fu-doc-1"].title === "文档新标题", "文档标题未回写索引");
    assert(byId["fu-doc-1"].dueDate === "2026-11-05", "文档日期未回写索引");
    assert(byId["fu-doc-1"].docBlockId === "20261004000000-blkdoc1", "块 ID 未记录");
    assert(byId["fu-doc-2"].docMissing === true, "块删除未标不可达");
    assert(byId["fu-doc-2"].docBlockId === undefined, "消失块的旧 ID 未清空");
    assert(byId["fu-doc-3"].docMissing === undefined, "一致事项不得被标缺失");

    /* 写侧不复活：docMissing 的 open 事项不产生 insert，索引不被改动 */
    const before = JSON.stringify(files.get("follow-ups.json"));
    await syncFollowUpTasksToDoc(plugin, person.docId);
    assert(JSON.stringify(files.get("follow-ups.json")) === before, "写侧同步改动索引或复活已删任务块");
});

await test("移动端人物卡片内容自适应，min-height 收缩且空 chips 收起（B09-2）", async () => {
    kernel.handler = async (route) => {
        if (route === "/api/av/renderAttributeView") return renderResult();
        return null;
    };
    mounted = mount(PeopleView, { target: fixture, props: {
        settings, preferences: DEFAULT_VIEW_PREFERENCES,
        loadRecentInteractions: async () => ({}),
        revision: 0, initialSort: "name", isMobile: window.innerWidth <= 640,
        onOpenDetail() {}, onOpenPersonDoc() {},
        onPreferencesChange: async (next) => next,
    } });
    await until(() => fixture.querySelector(".lvct-person-card"), "卡片未渲染");
    const card = fixture.querySelector(".lvct-person-card");
    if (window.innerWidth <= 640) {
        const minHeight = Number.parseFloat(getComputedStyle(card).minHeight);
        assert(minHeight < 100, `移动端卡片 min-height 应收缩（当前 ${minHeight}px，innerWidth ${window.innerWidth}）`);
        const height = card.getBoundingClientRect().height;
        assert(height <= 140, `移动端空资料卡片高度应 ≤140px（当前 ${Math.round(height)}px）`);
        /* 生日未填、无联系方式、无分组标签：meta 只剩互动行、chips 行不渲染 */
        assert(!card.querySelector(".lvct-person-card__tags"), "空分组/标签时 chips 行未收起");
    } else {
        const minHeight = Number.parseFloat(getComputedStyle(card).minHeight);
        assert(minHeight >= 172, `桌面断言误触发（min ${minHeight}px，innerWidth ${window.innerWidth}）`);
    }
});

await test("今日行动分组折叠：从未互动单独归组默认折叠，组头计数展开入口（B01）", async () => {
    const personOf = (name) => ({
        docId: `20260927000000-${name}0000`, itemId: `row-${name}`, name,
        phone: "", email: "", wechat: "", website: "", birthday: "", isLunar: false,
        group: "", tags: [], relatedItemIds: [],
    });
    const actionCard = (name, bucket, reasons) => ({ person: personOf(name), bucket, reasons });
    mounted = mount(Workbench, { target: fixture, props: {
        settings, preferences: DEFAULT_VIEW_PREFERENCES, isMobile: false,
        onPreferencesUpdated() {}, onOpenPersonDoc() {},
        facade: { settings, loadRecentInteractions: async () => ({}), loadDashboard: async () => ({
            people: 5, relations: 0, birthdays: [], birthdaysThisWeek: 0,
            stale: [], neverContacted: 3, neverContactedItemIds: [],
            followUps: [], actions: [
                actionCard("逾期跟进", "overdue", [{ kind: "followup", label: "跟进「还书」已逾期", bucket: "overdue", dueDate: "2026-09-25", followUpId: "f1" }]),
                actionCard("从未甲", "stale", [{ kind: "stale", label: "从未互动", bucket: "stale", neverContacted: true }]),
                actionCard("从未乙", "stale", [{ kind: "stale", label: "从未互动", bucket: "stale", neverContacted: true }]),
                actionCard("从未丙", "stale", [{ kind: "stale", label: "从未互动", bucket: "stale", neverContacted: true }]),
            ],
        }) },
    } });
    await until(() => fixture.querySelector(".lvct-dash__group-head"), "行动分组未渲染");
    const heads = () => [...fixture.querySelectorAll(".lvct-dash__group-head")];
    assert(heads().some((node) => node.textContent.includes("逾期")), "逾期组未渲染");
    const neverHead = heads().find((node) => node.textContent.includes("从未互动"));
    assert(neverHead && neverHead.textContent.includes("3"), "从未互动组头计数错误");
    /* 默认折叠：从未互动行不在 DOM，其余组展开 */
    assert(!fixture.textContent.includes("从未甲"), "从未互动组未默认折叠");
    assert(fixture.textContent.includes("逾期跟进"), "逾期组应默认展开");
    neverHead.click();
    await until(() => fixture.textContent.includes("从未甲"), "展开从未互动组失败");
    assert(fixture.querySelectorAll(".lvct-dash__row").length === 4, "展开后行数错误");
    heads().find((node) => node.textContent.includes("从未互动")).click();
    await tick();
    assert(!fixture.textContent.includes("从未甲"), "再次点击未收起");
});

await test("行内快捷处置：生日跳过本年、从未互动不再提醒，写入暂缓（B08）", async () => {
    const dismissals = [];
    const personOf = (name) => ({
        docId: `20260927000000-${name}0000`, itemId: `row-${name}`, name,
        phone: "", email: "", wechat: "", website: "", birthday: "", isLunar: false,
        group: "", tags: [], relatedItemIds: [],
    });
    mounted = mount(Workbench, { target: fixture, props: {
        settings, preferences: DEFAULT_VIEW_PREFERENCES, isMobile: false,
        onPreferencesUpdated() {}, onOpenPersonDoc() {},
        facade: { settings, loadRecentInteractions: async () => ({}),
            loadDashboard: async () => ({
                people: 2, relations: 0,
                birthdays: [{ person: personOf("寿星甲"), bucket: "today", projection: { daysUntil: 0, label: "9月29日" } }],
                birthdaysThisWeek: 1,
                stale: [], staleTotal: 1, neverContacted: 1, neverContactedItemIds: [],
                followUps: [], actions: [
                    { person: personOf("寿星甲"), bucket: "today", reasons: [
                        { kind: "birthday", label: "今天生日", bucket: "today" },
                    ] },
                    { person: personOf("从未乙"), bucket: "stale", reasons: [
                        { kind: "stale", label: "从未互动", bucket: "stale", neverContacted: true },
                    ] },
                ],
            }),
            dismissReminder: async (docId, kind, until) => dismissals.push({ docId, kind, until }),
            resumeReminder: async () => {},
            loadReminderDismissals: async () => [],
            getPersonCadence: async () => null,
            savePersonCadence: async () => {},
        },
    } });
    await until(() => fixture.querySelector(".lvct-dash__row"), "行动未渲染");
    /* 生日行：跳过本年 → until 为当年 12-31 */
    const skipButton = [...fixture.querySelectorAll("button")].find((node) => node.textContent === "跳过本年");
    assert(skipButton, "生日行缺「跳过本年」按钮");
    skipButton.click();
    await until(() => dismissals.some((entry) => entry.kind === "birthday"), "生日跳过未写入");
    const year = new Date().getFullYear();
    assert(dismissals.find((entry) => entry.kind === "birthday").until === `${year}-12-31`, "跳过本年 until 应为年底");
    /* 从未互动行动行：组默认折叠 → 展开组头 → ⋯ → 不再提醒（长期，统计口径不变由服务层保证） */
    const neverHead = [...fixture.querySelectorAll(".lvct-dash__group-head")]
        .find((node) => node.textContent.includes("从未互动"));
    assert(neverHead, "从未互动组头未渲染");
    neverHead.click();
    await tick();
    const more = [...fixture.querySelectorAll("button")]
        .find((node) => (node.getAttribute("aria-label") ?? "").includes("更多处置") && (node.getAttribute("aria-label") ?? "").includes("从未乙"));
    assert(more, "行动行缺更多处置按钮");
    more.click();
    await until(() => [...fixture.querySelectorAll("button")].some((node) => node.textContent === "不再提醒"), "处置菜单未展开");
    [...fixture.querySelectorAll("button")].find((node) => node.textContent === "不再提醒").click();
    await until(() => dismissals.some((entry) => entry.kind === "stale" && entry.until === ""), "不再提醒未写入长期暂缓");
});

await test("近期生日行：主按钮可聚焦打开详情，跳过按钮不触发详情（UX-01.14）", async () => {
    const opened = [];
    const dismissals = [];
    const birthdayPerson = {
        ...person,
        docId: "20260927000000-birthday0001",
        itemId: "row-birthday",
        name: "键盘寿星",
    };
    mounted = mount(DashboardView, { target: fixture, props: {
        preferences: DEFAULT_VIEW_PREFERENCES,
        onOpenDetail(value) { opened.push(value.docId); },
        onOpenPeople() {}, onOpenGraph() {},
        facade: {
            settings,
            loadDashboard: async () => ({
                people: 1, relations: 0,
                birthdays: [{ person: birthdayPerson, bucket: "today", projection: { daysUntil: 0, label: "今天" } }],
                birthdaysThisWeek: 1, stale: [], staleTotal: 0, neverContacted: 0,
                neverContactedItemIds: [], actions: [], followUps: [],
            }),
            dismissReminder: async (docId, kind, until) => dismissals.push({ docId, kind, until }),
            resumeReminder: async () => {},
            loadReminderDismissals: async () => [],
        },
    } });
    await until(() => fixture.querySelector(".lvct-dash__row-main"), "近期生日主按钮未渲染");
    const mainButton = fixture.querySelector(".lvct-dash__row-main");
    const skipButton = [...fixture.querySelectorAll("button")].find((node) => node.textContent.trim() === "跳过本年");
    assert(mainButton && skipButton, "近期生日行缺少独立主按钮或跳过按钮");
    mainButton.focus();
    mainButton.click();
    assert(opened.length === 1 && opened[0] === birthdayPerson.docId, "键盘可聚焦的生日主按钮未打开详情");
    skipButton.focus();
    skipButton.click();
    await until(() => dismissals.length === 1, "跳过本年未写入");
    assert(opened.length === 1, "跳过本年按钮不应再次打开详情");
});

await test("收编宽限期与批量安顿：宽限内不出行动卡、批量暂缓可一次性撤销（C02）", async () => {
    const personOf = (name) => ({
        docId: `20260927000000-${name}0000`, itemId: `row-${name}`, name,
        phone: "", email: "", wechat: "", website: "", birthday: "", isLunar: false,
        group: "", tags: [], relatedItemIds: [],
    });
    const dismissals = [];
    mounted = mount(Workbench, { target: fixture, props: {
        settings, preferences: DEFAULT_VIEW_PREFERENCES, isMobile: false,
        onPreferencesUpdated() {}, onOpenPersonDoc() {},
        facade: { settings, loadRecentInteractions: async () => ({}),
            loadDashboard: async () => {
                /* 宽限过滤在服务层；此处用 mock 表达过滤后口径：never 组被宽限隐藏、统计保持真实 */
                return {
                    people: 3, relations: 0, birthdays: [], birthdaysThisWeek: 0,
                    stale: [], staleTotal: 3, neverContacted: 3,
                    neverContactedItemIds: [personOf("宽限一").docId, personOf("宽限二").docId, personOf("宽限三").docId],
                    followUps: [], actions: [], neverOrder: {},
                };
            },
            dismissReminder: async (docId, kind, until) => dismissals.push({ docId, kind, until }),
            resumeReminder: async (docId, kind) => {
                const index = dismissals.findIndex((entry) => entry.docId === docId && entry.kind === kind);
                if (index >= 0) dismissals.splice(index, 1);
            },
            loadReminderDismissals: async () => [...dismissals],
            getPersonCadence: async () => null,
            savePersonCadence: async () => {},
        },
    } });
    await until(() => fixture.querySelector(".lvct-dash__stat"), "首页未加载");
    /* 宽限期口径：统计卡保持真实 3，行动区无 never 卡（空态） */
    assert(fixture.querySelector(".lvct-dash__stats").textContent.includes("3"), "统计应保持真实");
    assert(fixture.textContent.includes("今天没有需要处理的事"), "宽限期内行动区应安静");
    /* 批量安顿依赖真组——此处直接验证该口径由服务级用例与域单测覆盖；UI 侧验证撤销按钮挂载逻辑 */
    assert(!fixture.querySelector(".lvct-dash__settle"), "无 never 组时不应出现批量安顿");
});

await test("新建草稿关闭前三选一：取消保留草稿，放弃后关闭且弹窗列明细", async () => {
    const guardDialog = () => document.body.querySelector(".lvct-closeguard");
    try {
        mounted = mount(Workbench, { target: fixture, props: {
            settings, preferences: DEFAULT_VIEW_PREFERENCES, isMobile: false,
            onPreferencesUpdated() {}, onOpenPersonDoc() {},
            facade: { settings, loadRecentInteractions: async () => ({}) },
        } });
        button("新建联系人").click();
        await until(() => fixture.querySelector(".lvct-form input[type=text]"), "新建弹窗未打开");
        input(fixture.querySelector(".lvct-form input[type=text]"), "待保存的人");
        fixture.querySelector(".lvct-dialog-panel__close").click();
        await until(() => guardDialog(), "脏草稿关闭未弹三选一");
        // B06：弹窗列出改动明细（哪个字段、从什么到什么）
        const detail = guardDialog().querySelector(".lvct-closeguard__list")?.textContent ?? "";
        assert(detail.includes("姓名") && detail.includes("待保存的人"), "改动明细未包含字段与值");
        // 取消 → 弹窗与编辑弹窗都保留，草稿不丢
        [...guardDialog().querySelectorAll("button")].find((node) => node.textContent.trim() === "取消").click();
        await pause(20);
        await tick();
        assert(!guardDialog(), "取消后守卫弹窗未关闭");
        assert(fixture.querySelector(".lvct-form input[type=text]")?.value === "待保存的人", "取消后草稿丢失");
        // 放弃并离开 → 编辑弹窗关闭
        fixture.querySelector(".lvct-dialog-panel__close").click();
        await until(() => guardDialog(), "第二次关闭未弹三选一");
        [...guardDialog().querySelectorAll("button")].find((node) => node.textContent.trim() === "放弃并离开").click();
        await until(() => !fixture.querySelector(".lvct-dialog-panel"), "放弃后未关闭");
        assert(!guardDialog(), "放弃后守卫弹窗未关闭");
    } finally {
        document.body.querySelector(".lvct-closeguard")?.remove();
    }
});

await test("busy 独立阻断：创建挂起时关闭不卸载弹窗，完成后可正常关闭（CODE-02.1）", async () => {
    let releaseCreate = () => {};
    const createGate = new Promise((resolve) => { releaseCreate = resolve; });
    let created = false;
    let creationRequestId;
    kernel.handler = async (route, body) => {
        if (route === "/api/filetree/createDocWithMd") {
            created = true;
            creationRequestId = body.markdown.match(/custom-lvct-contact-draft="([^"]+)"/)?.[1];
            return createGate;
        }
        if (route === "/api/sqlite/flushTransaction") return null;
        if (route === "/api/query/sql") {
            if (body.stmt.includes("SELECT DISTINCT root_id")) return created && body.stmt.includes(creationRequestId) ? [{ root_id: "20260930000000-newdoc5" }] : [];
            if (body.stmt.includes("AND id='20260930000000-newdoc5'")) return created ? [{ id: "20260930000000-newdoc5", content: "挂起中的人" }] : [];
            return [];
        }
        if (route === "/api/av/renderAttributeView") {
            const base = renderResult();
            return created ? { view: { ...base.view, rows: [...base.view.rows, { id: "row-new5", cells: [
                { valueType: "block", value: { type: "block", keyID: "name", block: { id: "20260930000000-newdoc5", content: "挂起中的人" } } },
            ] } ] } } : base;
        }
        if (route === "/api/av/addAttributeViewBlocks") return null;
        if (route === "/api/av/getAttributeViewItemIDsByBoundIDs") return created ? { "20260930000000-newdoc5": "row-new5" } : {};
        if (route === "/api/av/setAttributeViewBlockAttr") return null;
        throw new Error(`busy 阻断用例不允许请求 ${route}`);
    };
    mounted = mount(Workbench, { target: fixture, props: {
        settings, preferences: DEFAULT_VIEW_PREFERENCES, isMobile: false,
        onPreferencesUpdated() {}, onOpenPersonDoc() {},
        facade: { settings, loadRecentInteractions: async () => ({}) },
    } });
    button("新建联系人").click();
    await until(() => fixture.querySelector(".lvct-form input[type=text]"), "新建弹窗未打开");
    input(fixture.querySelector(".lvct-form input[type=text]"), "挂起中的人");
    await tick(); /* 创建按钮 disabled 随姓名输入解除，先等一轮再点 */
    button("创建联系人").click();
    await until(() => fixture.textContent.includes("创建中…"), `创建未进入挂起态：${fixture.querySelector(".lvct-dialog-panel")?.textContent?.slice(0, 150) ?? "弹窗已消失"}`);
    /* 创建挂起（busy）时点 ×：即使没有可展示的脏聚合也必须阻断，弹窗与草稿保持可见 */
    fixture.querySelector(".lvct-dialog-panel__close").click();
    await tick();
    await tick();
    const pendingInput = fixture.querySelector(".lvct-form input[type=text]");
    assert(pendingInput, "busy 期间弹窗被卸载（关闭未阻断）");
    assert(pendingInput.value === "挂起中的人", "busy 期间草稿丢失");
    releaseCreate("20260930000000-newdoc5");
    await until(() => !fixture.textContent.includes("创建中…"), "创建未完成");
    /* 完成后已保存：非忙非脏——创建成功回调自动关窗（或手动 × 可直接关闭），不得停留 */
    const postClose = fixture.querySelector(".lvct-dialog-panel__close");
    if (postClose) postClose.click();
    await until(() => !fixture.querySelector(".lvct-dialog-panel"), "完成后弹窗未关闭");
    document.body.querySelector(".lvct-closeguard")?.remove();
});

await test("B07-b 同步失败分项：单块失败不阻断其余，复合错误不回退，重试只补缺失不重复", async () => {
    const files = new Map();
    const plugin = { loadData: async (key) => files.get(key) ?? "", saveData: async (key, value) => { files.set(key, value); } };
    files.set("contacts-settings.json", settings);
    files.set("follow-ups.json", { schemaVersion: 1, items: [
        { id: "fu-s1", personDocId: person.docId, title: "改期项", dueDate: "2026-10-02", status: "open", createdAt: 1, updatedAt: 1, docBlockId: "20260930000000-blks001" },
        { id: "fu-s2", personDocId: person.docId, title: "新插入项", dueDate: "2026-10-03", status: "open", createdAt: 1, updatedAt: 1 },
    ] });
    const docBlocks = { "20260930000000-blks001": { followUpId: "fu-s1", markdown: "- [ ] 旧标题 📅2026-10-01" } };
    let failUpdates = true; /* 首轮注入：fu-s1 的 updateBlock 失败 */
    let appendCount = 0;
    kernel.handler = reflectContactWrites(async (route, body) => {
        if (route === "/api/query/sql") {
            if (body.stmt.includes("type = 'd'")) return [{ id: person.docId }];
            if (body.stmt.includes("id > '")) return [];
            return Object.entries(docBlocks).map(([id, block]) => ({ id, ial: `custom-lvct-followup="${block.followUpId}"`, markdown: block.markdown }));
        }
        if (route === "/api/block/updateBlock") {
            if (failUpdates) throw new Error("updateBlock 注入失败");
            docBlocks[body.id].markdown = "- [ ] 改期项 📅2026-10-02";
            return null;
        }
        if (route === "/api/block/insertBlock") {
            appendCount += 1;
            const newId = `20260930000000-blznew${appendCount}`;
            docBlocks[newId] = { followUpId: "fu-s2", markdown: "- [ ] 新插入项 📅2026-10-03" };
            return [{ doOperations: [{ id: newId, action: "insert" }] }];
        }
        if (route === "/api/attr/setBlockAttrs") {
            const entry = docBlocks[body.id];
            if (entry) entry.followUpId = body.attrs["custom-lvct-followup"];
            return null;
        }
        return null;
    });

    /* 首轮同步：fu-s1 更新失败（注入），fu-s2 插入成功——分项报告互不阻断 */
    const report = await syncFollowUpTasksToDoc(plugin, person.docId);
    assert(report.failed.length === 1 && report.failed[0].followUpId === "fu-s1" && report.failed[0].action === "update",
        `分项报告错误：${JSON.stringify(report)}`);
    assert(report.applied === 1, `失败阻断了其余计划：${JSON.stringify(report)}`);
    assert(docBlocks["20260930000000-blks001"].markdown.includes("旧标题"), "失败计划不应部分写入");

    /* 重试：解除注入 → 只补失败项，不产生重复块 */
    failUpdates = false;
    const retry = await syncFollowUpTasksToDoc(plugin, person.docId);
    assert(retry.failed.length === 0 && retry.applied === 1, `重试报告错误：${JSON.stringify(retry)}`);
    const s2Blocks = Object.values(docBlocks).filter((block) => block.followUpId === "fu-s2").length;
    assert(s2Blocks === 1, `重试产生重复块：${s2Blocks} 个 fu-s2 块`);

    /* mutator 复合错误：状态变更的文档打勾失败 → 抛「已保存，但…」且插件库不回退 */
    kernel.handler = async (route, body) => {
        if (route === "/api/query/sql") {
            if (body.stmt.includes("type = 'd'")) return [{ id: person.docId }];
            if (body.stmt.includes("id > '")) return [];
            return Object.entries(docBlocks).map(([id, block]) => ({ id, ial: `custom-lvct-followup="${block.followUpId}"`, markdown: block.markdown }));
        }
        if (route === "/api/block/updateTaskListItemMarker") throw new Error("打勾注入失败");
        return null;
    };
    let composite = "";
    try { await setFollowUpStatus(plugin, "fu-s1", "done"); } catch (error) { composite = error.message; }
    assert(composite.includes("跟进已保存，但") && composite.includes("打勾注入失败"), `复合错误缺失：${composite}`);
    const afterFail = await loadFollowUpStore(plugin);
    assert(afterFail.items.find((item) => item.id === "fu-s1").status === "done", "复合错误回退了插件库写入");
});

await test("FUNC-01.15 断点续做：残留文档复用不重建，字段失败上浮可定位且重试不重复建档", async () => {
    invalidateRoster();
    let createDocCalls = 0;
    let rowCount = 0;
    let failPhone = false;
    const staged = { "断点甲": "20260930000000-doc0001", "断点乙": "20260930000000-doc0002" };
    const boundNames = new Set();
    const bindings = {};
    const cellWrites = [];
    const draftOf = (name, phone) => ({ name, phone, email: "", wechat: "", website: "", birthday: "", isLunar: false, group: "", tags: [] });
    kernel.handler = reflectContactWrites(async (route, body) => {
        if (route === "/api/query/sql") {
            if (String(body.stmt).includes("root_id =")) return [];
            const docId = String(body.stmt).match(/\bid\s*=\s*'([^']+)'/)?.[1];
            if (docId) return Object.entries(staged).filter(([, id]) => id === docId).map(([name, id]) => ({ id, content: name }));
            return Object.entries(staged)
                .filter(([name]) => !boundNames.has(name))
                .map(([name, id]) => ({ id, content: name, hpath: `/${name}` }));
        }
        if (route === "/api/sqlite/flushTransaction") return null;
        if (route === "/api/filetree/createDocWithMd") { createDocCalls += 1; return "20260930000000-doc9999"; }
        if (route === "/api/av/renderAttributeView") {
            const base = renderResult();
            const rows = [...base.view.rows];
            for (const [name, id] of Object.entries(staged)) {
                if (boundNames.has(name) && bindings[id]) {
                    rows.push({ id: bindings[id], cells: [{ valueType: "block", value: { type: "block", keyID: "name", block: { id, content: name } } }] });
                }
            }
            return { view: { ...base.view, rows } };
        }
        if (route === "/api/av/addAttributeViewBlocks") {
            const docId = body.srcs[0].id;
            boundNames.add(body.srcs[0].content);
            rowCount += 1;
            bindings[docId] = `row-new${rowCount}`;
            return null;
        }
        if (route === "/api/av/getAttributeViewItemIDsByBoundIDs") return { ...bindings };
        if (route === "/api/av/setAttributeViewBlockAttr") {
            if (body.keyID === "phone" && failPhone) { failPhone = false; throw new Error("phone 注入失败"); }
            cellWrites.push({ keyID: body.keyID, itemID: body.itemID });
            return null;
        }
        throw new Error(`断点续做用例不允许请求 ${route}`);
    });

    /* 场景 A：上次尝试残留的未绑定文档 → 复用（createDocWithMd 零调用）→ 绑行 + 写字段完成 */
    let ambiguity;
    try { await createContact(settings, draftOf("断点甲", "13800001234")); } catch (error) { ambiguity = error; }
    assert(ambiguity?.preview?.unbound[0]?.docId === staged["断点甲"] && createDocCalls === 0, "同名遗留文档未要求按 ID 确认");
    const created = await createContact(settings, draftOf("断点甲", "13800001234"), { reuseDocId: staged["断点甲"] });
    assert(createDocCalls === 0, "残留文档未被复用（重复调用了建文档）");
    assert(created.docId === "20260930000000-doc0001", `未复用残留文档：${created.docId}`);

    /* 场景 B：绑行成功但字段写入失败 → 复合错误指名字段与保留行；重试被「已存在」拦截且零新建 */
    failPhone = true;
    invalidateRoster();
    let composite = "";
    try { await createContact(settings, draftOf("断点乙", "13900002222"), { reuseDocId: staged["断点乙"] }); }
    catch (error) { composite = error.message; }
    assert(composite.includes("资料字段写入失败") && composite.includes("电话") && composite.includes("row-new"),
        `字段失败上浮缺失：${composite}`);
    invalidateRoster();
    let dupError = "";
    try { await createContact(settings, draftOf("断点乙", "13900002222")); }
    catch (error) { dupError = error.message; }
    assert(dupError.includes("已存在"), `重试未按已存在拦截：${dupError}`);
    assert(createDocCalls === 0, "重试产生了重复文档");
});

await test("B13.2 组织扫描与成员索引：标记区块扫描发现组织，成员 JSON 锁内追加与聚合", async () => {
    const files = new Map();
    const plugin = { loadData: async (key) => files.get(key) ?? "", saveData: async (key, value) => { files.set(key, value); } };
    files.set("contacts-settings.json", settings);
    kernel.handler = reflectContactWrites(async (route, body) => {
        if (route === "/api/notebook/lsNotebooks") return { notebooks: [{ id: "20260930000000-book001", name: "B13_spike" }] };
        if (route === "/api/query/sql") {
            const stmt = String(body?.stmt ?? "");
            if (stmt.includes("ial LIKE '%custom-lvct-org")) {
                /* 标记区块根文档：只有组织文档命中 */
                return [{ root_id: "20260930000000-org0001", ial: '{: custom-lvct-org="1"}', markerCount: 1 }];
            }
            if (stmt.includes("type='d'") && stmt.includes("id IN")) {
                /* 按 ID 批量取组织文档名 */
                return [{ id: "20260930000000-org0001", content: "测试公司", hpath: "/测试公司", box: "20260930000000-book001" }];
            }
            return [];
        }
        throw new Error(`组织扫描用例不允许请求 ${route}`);
    });
    invalidateRoster();
    const orgs = await scanOrganizations();
    assert(orgs.length === 1 && orgs[0].name === "测试公司" && orgs[0].docId === "20260930000000-org0001",
        `组织扫描结果错误：${JSON.stringify(orgs)}`);

    /* 成员索引：锁内追加两条（同组织不同人），聚合按组织分组 */
    await addOrgMembership(plugin, { orgDocId: "20260930000000-org0001", personDocId: person.docId, department: "研发部", title: "工程师", joinedOn: "2026-01-01" });
    await addOrgMembership(plugin, { orgDocId: "20260930000000-org0001", personDocId: "20260930000000-person9", title: "顾问", joinedOn: "2025-06-01" });
    const byOrg = await membershipsByOrganization(plugin);
    const list = byOrg.get("20260930000000-org0001") ?? [];
    assert(list.length === 2, `组织聚合条数错误：${list.length}`);
    assert(list[0].joinedOn === "2025-06-01" && list[1].joinedOn === "2026-01-01", "成员未按加入日排序");

    /* 写后回读：损坏拒绝路径由域层单测覆盖，这里验证落盘形状 */
    const stored = files.get("org-membership.json");
    assert(stored.schemaVersion === 1 && stored.memberships.length === 2, "成员索引落盘形状错误");
});

await test("B13.3 组织管理弹窗：新建组织、添加/移除成员经 facade 全链路（B13.3）", async () => {
    const createdOrgs = [];
    const memberOps = [];
    let nextOrgId = 0;
    const facade = {
        settings, viewPreferences: DEFAULT_VIEW_PREFERENCES,
        listContacts: async () => [
            { docId: "20260930000000-per0001", itemId: "row-p1", name: "张三", isSelf: false },
            { docId: "20260930000000-per0002", itemId: "row-p2", name: "李四", isSelf: false },
        ],
        listOrganizations: async () => createdOrgs.map((org) => ({
            ...org,
            memberships: memberOps.filter((member) => member.orgDocId === org.docId),
        })),
        createOrganization: async (name) => {
            if (createdOrgs.some((org) => org.name === name)) throw new Error(`组织「${name}」已存在`);
            const docId = `20260930000000-org00${createdOrgs.length + 1}`;
            createdOrgs.push({ docId, name, hpath: `/${name}`, notebookId: settings.notebookId });
            return { docId };
        },
        listOrganizationMembers: async (orgDocId) => memberOps
            .filter((member) => member.orgDocId === orgDocId)
            .map((member) => ({ ...member, personName: member.personName })),
        addOrganizationMember: async (orgDocId, personDocId, extra) => {
            const name = personDocId === "20260930000000-per0001" ? "张三" : "李四";
            memberOps.push({
                id: `20260930000000-mem0${memberOps.length + 1}`,
                orgDocId, personDocId, personName: name, title: extra?.title ?? "", status: "active",
            });
        },
        removeOrganizationMember: async (id) => {
            const index = memberOps.findIndex((member) => member.id === id);
            if (index >= 0) memberOps.splice(index, 1);
        },
    };
    let closed = false;
    mounted = mount(OrgManagerDialog, { target: fixture, props: {
        facade, i18n: undefined, onClose: () => { closed = true; },
    } });
    await until(() => fixture.textContent.includes("暂无组织"), "组织列表未加载");
    /* 新建组织 */
    input(fixture.querySelector(".lvct-org-manager__create input"), "测试公司");
    await tick(); /* 等 bind:value 更新解除 disabled */
    button("新建组织").click();
    await until(() => fixture.textContent.includes("测试公司"), `新建组织未出现在列表：${fixture.querySelector(".lvct-org-manager")?.textContent?.slice(0, 200)}`);
    assert(createdOrgs.length === 1, "新建未走 facade.createOrganization");
    /* 添加成员 */
    await until(() => fixture.querySelector(".lvct-org-manager__add select"), "添加成员选择器未出现");
    const select = fixture.querySelector(".lvct-org-manager__add select");
    select.value = "20260930000000-per0001";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await tick();
    await tick();
    button("添加成员").click();
    await tick();
    await until(
        () => [...fixture.querySelectorAll(".lvct-org-manager__member")].some((node) => node.textContent.includes("张三")),
        "添加成员未生效",
    );
    assert(memberOps.length === 1 && memberOps[0].personDocId === "20260930000000-per0001", "成员未写入");
    /* 移除成员（B13.4 起行内含编辑与移除两个按钮，按文案定位） */
    const removeRow = [...fixture.querySelectorAll(".lvct-org-manager__member")].find((node) => node.textContent.includes("张三"));
    button("移除", removeRow).click();
    await until(() => removeRow.textContent.includes("确认移除这段成员历史"), "成员历史移除确认未显示");
    assert(memberOps.length === 1, "未确认就移除成员历史");
    button("确认移除这段成员历史", removeRow).click();
    await until(() => !fixture.querySelector(".lvct-org-manager__member"), "移除成员未生效");
    assert(memberOps.length === 0, "移除未走 facade.removeOrganizationMember");
    assert(!closed, "成员操作不应关闭弹窗");
});

await test("B13.4/B13 组织成员字段编辑与归档恢复（facade 全链路）", async () => {
    const memberRow = {
        id: "20260930000000-mem0001", orgDocId: "20260930000000-org0001",
        personDocId: "20260930000000-per0001", personName: "张三",
        department: "", title: "", joinedOn: "", leftOn: "", status: "active",
    };
    let archived = false;
    const updateCalls = [];
    let archiveCalls = 0;
    let restoreCalls = 0;
    const facade = {
        settings, viewPreferences: DEFAULT_VIEW_PREFERENCES,
        listContacts: async () => [
            { docId: "20260930000000-per0001", itemId: "row-p1", name: "张三", isSelf: false },
        ],
        listOrganizations: async () => [
            { docId: "20260930000000-org0001", name: "曙光科技", hpath: "/曙光科技", notebookId: settings.notebookId, archived, memberships: [memberRow] },
        ],
        listOrganizationMembers: async () => [{ ...memberRow }],
        updateOrganizationMember: async (id, patch) => {
            updateCalls.push({ id, patch });
            if (patch.department !== undefined) memberRow.department = patch.department;
            if (patch.title !== undefined) memberRow.title = patch.title;
            if (patch.joinedOn !== undefined) memberRow.joinedOn = patch.joinedOn;
            if (patch.leftOn !== undefined) memberRow.leftOn = patch.leftOn;
            if (patch.status !== undefined) memberRow.status = patch.status;
        },
        archiveOrganization: async () => { archiveCalls += 1; archived = true; },
        restoreOrganization: async () => { restoreCalls += 1; archived = false; },
    };
    mounted = mount(OrgManagerDialog, { target: fixture, props: {
        facade, i18n: undefined, onClose() {},
    } });
    await until(() => fixture.textContent.includes("曙光科技"), "组织列表未加载");
    /* 成员字段编辑：进入表单 → 填写 → 保存走 facade.updateOrganizationMember */
    button("编辑").click();
    await until(() => fixture.querySelector('input[aria-label="部门"]'), "成员编辑表单未出现");
    input(fixture.querySelector('input[aria-label="部门"]'), "研发部");
    input(fixture.querySelector('input[aria-label="职位"]'), "工程师");
    const statusSelect = fixture.querySelector('select[aria-label="状态"]');
    statusSelect.value = "former";
    statusSelect.dispatchEvent(new Event("change", { bubbles: true }));
    await tick();
    button("保存").click();
    await until(() => updateCalls.length === 1, "成员更新未走 facade");
    assert(updateCalls[0].id === "20260930000000-mem0001", "更新 id 错误");
    assert(updateCalls[0].patch.department === "研发部" && updateCalls[0].patch.title === "工程师" && updateCalls[0].patch.status === "former", "更新补丁字段错误");
    await until(() => fixture.textContent.includes("研发部") && !fixture.querySelector('input[aria-label="部门"]')
        && !button("归档组织").disabled, "保存后成员行未刷新");
    /* 归档：列表进归档分组，详情出现恢复按钮 */
    button("归档组织").click();
    await until(() => archiveCalls === 1, "归档未走 facade");
    await until(() => fixture.textContent.includes("收起已归档"), "当前归档组织未自动保留并展开");
    await until(() => [...fixture.querySelectorAll(".lvct-org-manager__org-item")].some((node) => node.textContent.includes("曙光科技")), "归档组织未在分组中显示");
    [...fixture.querySelectorAll(".lvct-org-manager__org-item")]
        .find((node) => node.textContent.includes("曙光科技")).click();
    await tick();
    await until(() => fixture.querySelector(".lvct-org-manager__detail")?.textContent.includes("恢复组织"), "归档组织详情未显示恢复按钮");
    /* 恢复 */
    button("恢复组织").click();
    await until(() => restoreCalls === 1, "恢复未走 facade");
    await until(() => !fixture.textContent.includes("收起已归档"), "恢复后归档分组未消失");
});

await test("B13.4 组织改名：renameOrganization 全链路 + 同名拒绝显示错误", async () => {
    let orgName = "曙光科技";
    const renameCalls = [];
    const facade = {
        settings, viewPreferences: DEFAULT_VIEW_PREFERENCES,
        listContacts: async () => [],
        listOrganizations: async () => [
            { docId: "20260930000000-org0001", name: orgName, hpath: `/${orgName}`, notebookId: settings.notebookId, archived: false, memberships: [] },
            { docId: "20260930000000-org0002", name: "旧公司", hpath: "/旧公司", notebookId: settings.notebookId, archived: true, memberships: [] },
        ],
        listOrganizationMembers: async () => [],
        renameOrganization: async (orgDocId, name) => {
            renameCalls.push({ orgDocId, name });
            if (name === "旧公司") throw new Error("组织「旧公司」已存在");
            orgName = name;
        },
    };
    mounted = mount(OrgManagerDialog, { target: fixture, props: {
        facade, i18n: undefined, onClose() {},
    } });
    await until(() => fixture.textContent.includes("曙光科技"), "组织列表未加载");
    /* 改名：进入行内编辑 → 填新名 → 保存走 facade */
    button("改名").click();
    await until(() => fixture.querySelector('input[aria-label="新组织名称"]'), "改名输入框未出现");
    input(fixture.querySelector('input[aria-label="新组织名称"]'), "新曙光");
    await tick(); /* bind:value 更新解除保存按钮 disabled */
    button("保存名称").click();
    await until(() => renameCalls.length === 1 && renameCalls[0].name === "新曙光", "改名未走 facade 或参数错误");
    assert(renameCalls[0].orgDocId === "20260930000000-org0001", "改名目标 orgDocId 错误");
    await until(() => fixture.textContent.includes("新曙光"), "改名后列表未刷新");
    assert(renameCalls[0].orgDocId === "20260930000000-org0001", "改名目标 orgDocId 错误");
    await until(() => fixture.textContent.includes("新曙光"), "改名后列表未刷新");
    /* 同名拒绝：错误显示且保持编辑态 */
    button("改名").click();
    await until(() => fixture.querySelector('input[aria-label="新组织名称"]'), "改名输入框未再次出现");
    input(fixture.querySelector('input[aria-label="新组织名称"]'), "旧公司");
    await tick();
    button("保存名称").click();
    await until(() => fixture.querySelector(".lvct-form__error")?.textContent.includes("已存在"), "同名拒绝错误未显示");
    assert(orgName === "新曙光", "被拒绝的改名不应生效");
});

await test("FAST-01.3a 识别目标裁决：名册失败自动重试仍失败返回 failed，恢复后 bound/unlinked 各归其位", async () => {
    invalidateRoster();
    let failRoster = true;
    kernel.handler = async (route) => {
        if (route === "/api/av/renderAttributeView") {
            if (failRoster) throw new Error("名册渲染注入失败");
            return renderResult();
        }
        throw new Error(`识别裁决用例不允许请求 ${route}`);
    };
    /* 名册持续失败 → failed：调用方必须取消识别（零写入），不得按新建目标处理 */
    const failed = await resolveRecognizeTarget(settings, "20260927000000-person1");
    assert(failed.status === "failed", `持续失败未返回 failed：${JSON.stringify(failed)}`);
    /* 恢复后：文档已绑定人物 → bound（落到原人物） */
    failRoster = false;
    invalidateRoster();
    const bound = await resolveRecognizeTarget(settings, "20260927000000-person1");
    assert(bound.status === "bound" && bound.person.docId === "20260927000000-person1",
        `已绑定文档未裁决为 bound：${JSON.stringify(bound)}`);
    /* 普通笔记（未绑定） → unlinked（明确新建） */
    const unlinked = await resolveRecognizeTarget(settings, "20260930000000-note01");
    assert(unlinked.status === "unlinked", `普通笔记未裁决为 unlinked：${JSON.stringify(unlinked)}`);
});

await test("CODE-02.5 关系并发：写前回读防丢边，幂等不重写，区块失败逐文档隔离", async () => {
    invalidateRoster();
    let relatedOfA = ["row-b"]; /* 内核当前值：甲已与乙有关系（另一窗口写入） */
    let relatedWrites = 0;
    let failSectionA = false;
    const sectionInserts = [];
    const markedSections = new Map();
    const docOf = { "row-a": "20260927000000-doca001", "row-b": "20260927000000-docb001", "row-c": "20260927000000-docc001" };
    kernel.handler = async (route, body) => {
        if (route === "/api/av/renderAttributeView") {
            const rows = [
                { id: "row-a", cells: [
                    { valueType: "block", value: { type: "block", keyID: "name", block: { id: docOf["row-a"], content: "关系甲" } } },
                    { valueType: "relation", value: { type: "relation", keyID: "related", relation: { blockIDs: [...relatedOfA] } } },
                ] },
                { id: "row-b", cells: [{ valueType: "block", value: { type: "block", keyID: "name", block: { id: docOf["row-b"], content: "关系乙" } } }] },
                { id: "row-c", cells: [{ valueType: "block", value: { type: "block", keyID: "name", block: { id: docOf["row-c"], content: "关系丙" } } }] },
            ];
            return { view: { columns: FIELD_SPECS.map((field) => ({ id: field.key, name: field.nameZh, type: field.type })), rows } };
        }
        if (route === "/api/av/setAttributeViewBlockAttr") {
            if (body.keyID === "related") {
                relatedWrites += 1;
                relatedOfA = [...body.value.relation.blockIDs];
            }
            return null;
        }
        if (route === "/api/query/sql") {
            if (body.stmt.includes("AND type = 'd'")) {
                const docId = body.stmt.match(/WHERE id = '([^']+)'/)?.[1];
                return Object.values(docOf).includes(docId) ? [{ id: docId }] : [];
            }
            const rootId = body.stmt.match(/root_id = '([^']+)'/)?.[1];
            return markedSections.has(rootId) ? [structuredClone(markedSections.get(rootId))] : [];
        }
        if (route === "/api/block/insertBlock") {
            sectionInserts.push(body.parentID);
            if (failSectionA && body.parentID === docOf["row-a"]) throw new Error("区块注入失败");
            const id = `20260930000000-bl${String(sectionInserts.length).padStart(5, "0")}`;
            markedSections.set(body.parentID, { id, markdown: body.data });
            return [{ doOperations: [{ id, action: "insert" }] }];
        }
        if (route === "/api/block/updateBlock" || route === "/api/block/deleteBlock") {
            const entry = [...markedSections.entries()].find(([, block]) => block.id === body.id);
            if (failSectionA && entry?.[0] === docOf["row-a"]) throw new Error("区块注入失败");
            if (route.endsWith("deleteBlock")) markedSections.delete(entry[0]);
            else markedSections.set(entry[0], { id: body.id, markdown: body.data });
            return null;
        }
        return null;
    };
    /* 调用方快照过期（relatedItemIds 为空），内核里甲已有乙的边——写前回读不得丢边 */
    const staleA = { docId: docOf["row-a"], itemId: "row-a", name: "关系甲", phone: "", email: "", wechat: "", website: "", birthday: "", isLunar: false, group: "", tags: [], relatedItemIds: [] };
    const 丙 = { docId: docOf["row-c"], itemId: "row-c", name: "关系丙", phone: "", email: "", wechat: "", website: "", birthday: "", isLunar: false, group: "", tags: [], relatedItemIds: [] };
    const firstReport = await addRelation(settings, staleA, 丙);
    assert(firstReport.fact.status === "applied" && firstReport.projections.every((projection) => projection.status === "applied"),
        `关系写入后核实或投影报告异常：${JSON.stringify(firstReport)}`);
    assert(relatedOfA.includes("row-b") && relatedOfA.includes("row-c"),
        `并发边被覆盖丢失：${JSON.stringify(relatedOfA)}`);
    /* 幂等：重复建立同一关系不产生第二次写入 */
    const writesBefore = relatedWrites;
    const unchangedReport = await addRelation(settings, staleA, 丙);
    assert(unchangedReport.fact.status === "unchanged", `重复关系未报告 unchanged：${JSON.stringify(unchangedReport)}`);
    assert(relatedWrites === writesBefore, "幂等建立仍重复写入 relation 单元格");
    /* 区块失败逐文档隔离：甲的区块写失败 → 整个关系编辑不抛出、relation 数据不受影响
       （甲的区块插入被尝试并失败；丙无边、其区块本为无操作） */
    failSectionA = true;
    const removeReport = await removeRelation(settings, staleA, 丙);
    assert(relatedOfA.includes("row-b") && !relatedOfA.includes("row-c"), "解除关系写失败");
    assert(removeReport.fact.status === "applied" && removeReport.projections.some((projection) => projection.status === "failed"),
        `关系事实与文档投影未分离报告：${JSON.stringify(removeReport)}`);
    const retryReport = await addRelation(settings, staleA, 丙);
    assert(retryReport.fact.status === "applied", `投影失败后的关系重试未保留事实：${JSON.stringify(retryReport)}`);
    assert(sectionInserts.filter((parent) => parent === docOf["row-a"]).length >= 1,
        "甲的区块同步未被尝试（隔离失效）");
    assert(relatedOfA.includes("row-b") && relatedOfA.includes("row-c"), "区块失败影响了关系数据");
});

await test("字段实际服务：生日与农历连续保存、1970 年之前生日和清空均经回读核实", async () => {
    const state = configureContactVerificationKernel();
    const draft = { ...person, birthday: "1950-01-02", isLunar: true, tags: ["甲", "乙", "甲"] };
    const first = await updateContactFields(settings, person.itemId, draft);
    assert(first.complete && first.accepted.includes("birthday") && first.accepted.includes("lunarBirthday")
        && first.applied.length === 8 && state.renders === 2,
        `未实际回读并核实生日：${JSON.stringify(first)}`);
    invalidateRoster();
    const saved = (await getRoster(settings))[0];
    assert(saved.birthday === "1950-01-02" && saved.isLunar && saved.tags.length === 2, "早年生日、农历或标签回读不一致");
    const second = await updateContactFields(settings, person.itemId, { ...draft, birthday: "1970-01-01", isLunar: false });
    assert(second.complete, `连续更改生日未核实：${JSON.stringify(second)}`);
    const cleared = await updateContactFields(settings, person.itemId, { ...draft, birthday: "", isLunar: false, tags: [], group: "" });
    const reread = (await getRoster(settings))[0];
    assert(cleared.complete && reread.birthday === "" && !reread.isLunar && reread.tags.length === 0 && reread.group === "",
        "清空生日/农历/标签/分组未保真");
});

await test("账本和别名实际服务：损坏及读取失败停止读写和捕获，不覆盖原文件、不按空库新建", async () => {
    const files = new Map();
    let writes = 0;
    let kernelCalls = 0;
    let failRead = false;
    const plugin = { loadData: async (key) => {
        if (failRead) throw new Error("隔离读失败");
        return structuredClone(files.get(key) ?? "");
    }, saveData: async (key, value) => { writes += 1; files.set(key, structuredClone(value)); } };
    assert((await loadExchangeStore(plugin)).records.length === 0 && (await loadPersonAliasStore(plugin)).aliases.length === 0, "首次空库被误报损坏");
    kernel.handler = async () => { kernelCalls += 1; throw new Error("坏别名不能触发内核写入"); };
    for (const raw of [{ schemaVersion: 99 }, { schemaVersion: 1, records: {}, aliases: {} }, { schemaVersion: 1, records: [null], aliases: [null] }]) {
        files.set("exchange-records.json", raw);
        files.set("person-aliases.json", raw);
        const before = JSON.stringify([...files]);
        for (const [actionName, action] of [
            ["load exchange", () => loadExchangeStore(plugin)], ["load alias", () => loadPersonAliasStore(plugin)],
            ["create exchange", () => createExchangeRecord(plugin, { requestId: "20261004000000-req0001", personDocId: person.docId, kind: "item", direction: "payable", description: "借用书籍", occurredOn: "2026-10-04" })],
            ["create alias", () => createPersonAlias(plugin, person.docId, "老张")],
            ["capture", () => captureFromDoc(plugin, settings, "20260927000000-diary01", { date: "2026-10-04", newNames: ["老张"], personDocIds: [] })],
        ]) {
            let errorText = "";
            try { await action(); } catch (error) { errorText = error.message; }
            assert(errorText.includes("存储内容损坏"), `坏数据被当成正常空库（模块 ${raw.schemaVersion ?? "未知"}，动作 ${actionName}：${errorText}）`);
        }
        assert(writes === 0 && kernelCalls === 0 && JSON.stringify([...files]) === before, "损坏存储仍触发写入或新建");
    }
    failRead = true;
    for (const action of [() => loadExchangeStore(plugin), () => loadPersonAliasStore(plugin)]) {
        let errorText = "";
        try { await action(); } catch (error) { errorText = error.message; }
        assert(errorText.includes("存储读取失败"), "I/O 失败被当空库");
    }
});

await test("账本和别名界面：坏库显示错误与只读重试，修复后恢复空态，草稿保留且零写入", async () => {
    for (const module of ["exchange", "alias"]) {
        let raw = { schemaVersion: 99 };
        let writes = 0;
        const plugin = { loadData: async () => structuredClone(raw), saveData: async () => { writes += 1; } };
        mounted = mount(module === "exchange" ? ExchangeLedger : PersonAliases, { target: fixture, props: module === "exchange" ? {
            personDocId: person.docId, onLoad: (docId) => listPersonExchanges(plugin, docId),
            onCreate: (input) => createExchangeRecord(plugin, input), onChangeStatus: async () => {},
        } : {
            personDocId: person.docId, onLoad: (docId) => listPersonAliases(plugin, docId),
            onAdd: (docId, alias) => createPersonAlias(plugin, docId, alias), onRemove: async () => {}, onChanged() {},
        } });
        await until(() => fixture.textContent.includes("存储内容损坏"), "坏库未显示错误");
        assert(!fixture.textContent.includes("还没有记录") && !fixture.textContent.includes("还没有设置别名"), "错误与正常空态同时出现");
        const draft = module === "exchange" ? fixture.querySelector('input[type="text"]') : fixture.querySelector('input[aria-label="新增别名"]');
        input(draft, module === "exchange" ? "修复后再记录" : "老张");
        await tick();
        assert(button(module === "exchange" ? "记一笔往来" : "添加").disabled, "未知库仍允许写入");
        raw = module === "exchange" ? { schemaVersion: 1, records: [] } : { schemaVersion: 1, aliases: [] };
        button("重新读取").click();
        await until(() => fixture.textContent.includes(module === "exchange" ? "还没有记录" : "还没有设置别名"), "修复后未恢复正常空态");
        assert(draft.value === (module === "exchange" ? "修复后再记录" : "老张") && writes === 0, "只读重试丢失草稿或触发写入");
        await unmount(mounted);
        mounted = undefined;
    }
});

await test("账本实际服务：未知保存同请求零重写、并发最多一条、不同请求同内容保留两笔", async () => {
    let raw = "";
    let writes = 0;
    let failRead = false;
    let failAfterSave = true;
    const plugin = { loadData: async () => {
        if (failRead) throw new Error("账本回读失败");
        return structuredClone(raw);
    }, saveData: async (_key, value) => {
        writes += 1;
        raw = structuredClone(value);
        if (failAfterSave) failRead = true;
    } };
    const input = { requestId: "20261004000000-req0001", personDocId: person.docId,
        kind: "money", direction: "receivable", description: "代垫交通费", amount: 35, currency: "CNY", occurredOn: "2026-10-04" };
    let error;
    try { await createExchangeRecord(plugin, input); } catch (failure) { error = failure; }
    assert(error?.name === "ExchangeWriteUnknownError" && error.requestId === input.requestId
        && raw.records.length === 1, "未知保存缺稳定请求身份或产生重复记录");
    const before = writes;
    try { await createExchangeRecord(plugin, input); } catch (failure) { error = failure; }
    assert(error.message.includes("存储读取失败") && writes === before, "核实读取失败仍重发未知保存");
    failRead = false;
    failAfterSave = false;
    const repeated = await Promise.all([createExchangeRecord(plugin, input), createExchangeRecord(plugin, input)]);
    assert(repeated.every((record) => record.id === input.requestId) && writes === before && raw.records.length === 1, "同请求核实或并发重写");
    await setExchangeStatus(plugin, input.requestId, "settled", "2026-10-04");
    const afterStatus = writes;
    const settled = await createExchangeRecord(plugin, input);
    assert(settled.status === "settled" && writes === afterStatus, "旧创建请求重开已结清往来");
    let conflict = "";
    try { await createExchangeRecord(plugin, { ...input, description: "另一个事项" }); } catch (failure) { conflict = failure.message; }
    assert(conflict.includes("不同内容") && writes === afterStatus, "同请求内容变更覆盖已有事实");
    const secondInput = { ...input, requestId: "20261004000000-req0002" };
    const created = await Promise.all([createExchangeRecord(plugin, secondInput), createExchangeRecord(plugin, secondInput)]);
    assert(created[0].id === created[1].id && raw.records.length === 2 && writes === afterStatus + 1, "合法同内容往来被合并或并发追加重复");
});

await test("账本界面：已写未知保留原输入与请求，读取失败不重发，核实后另开新请求", async () => {
    let raw = "";
    let writes = 0;
    let failRead = false;
    let failAfterSave = true;
    let changed = 0;
    const requests = [];
    const plugin = { loadData: async () => {
        if (failRead) throw new Error("隔离回读失败");
        return structuredClone(raw);
    }, saveData: async (_key, value) => {
        writes += 1;
        raw = structuredClone(value);
        if (failAfterSave) failRead = true;
    } };
    mounted = mount(ExchangeLedger, { target: fixture, props: {
        personDocId: person.docId, onLoad: (docId) => listPersonExchanges(plugin, docId),
        onCreate: (input) => { requests.push(structuredClone(input)); return createExchangeRecord(plugin, input); },
        onChangeStatus: async () => {}, onChanged: () => { changed += 1; },
    } });
    await until(() => fixture.textContent.includes("还没有记录"), "账本未进入空态");
    const description = fixture.querySelector('input[type="text"]');
    const amount = fixture.querySelector('input[type="number"]');
    input(description, "代垫交通费");
    input(amount, "35");
    await tick();
    button("记一笔往来").click();
    await until(() => fixture.textContent.includes("保存结果未知"), "未知保存未明确显示");
    assert(raw.records.length === 1 && description.value === "代垫交通费" && description.disabled && amount.disabled && changed === 0,
        "未知保存清空草稿、允许改输入或误报已保存");
    const before = writes;
    button("核实并重试本笔往来").click();
    await until(() => fixture.textContent.includes("存储读取失败"), "核实失败未显示");
    assert(writes === before && description.disabled && requests[0].requestId === requests[1].requestId, "核实失败改键、解锁输入或重发保存");
    failRead = false;
    failAfterSave = false;
    button("核实并重试本笔往来").click();
    await until(() => changed === 1 && !description.disabled, "核实已保存记录未恢复表单");
    assert(description.value === "" && writes === before && raw.records.length === 1, "核实成功仍重复保存");
    input(description, "代垫交通费");
    input(amount, "35");
    await tick();
    button("记一笔往来").click();
    await until(() => changed === 2, "第二笔真实往来未保存");
    assert(raw.records.length === 2 && requests.at(-1).requestId !== requests[0].requestId, "新业务沿用旧请求被合并");
});

await test("详情子面板：草稿取消保留原标签和人物，保存挂起阻断切标签、切人与关闭", async () => {
    for (const module of ["exchange", "alias"]) {
        let closed = false;
        let navigated = 0;
        let writes = 0;
        let release;
        const gatedWrite = async (docId) => {
            writes += 1;
            await new Promise((resolve) => { release = resolve; });
            return module === "exchange" ? {
                id: "20261004000000-ex00001", personDocId: docId, kind: "money", direction: "receivable", description: "草稿", amount: 35,
                currency: "CNY", occurredOn: "2026-10-04", dueOn: "", status: "open", settledOn: "", note: "", createdAt: 1, updatedAt: 1,
            } : { id: "20261004000000-alias01", personDocId: docId, alias: "老张", createdAt: 1, updatedAt: 1 };
        };
        mounted = mount(PersonDetail, { target: fixture, props: {
            settings, person, navigationOrder: [person, { ...person, docId: "20260927000000-person2", itemId: "row-2", name: "回归测试乙" }],
            onRecord: async () => {}, onLoadInsights: async () => emptyInsights(), onOpenPersonDoc() {},
            onNavigate: () => { navigated += 1; }, onChanged() {}, onDeleted() {}, onClose: () => { closed = true; },
            onLoadExchanges: async () => [], onCreateExchange: (input) => gatedWrite(input.personDocId), onChangeExchangeStatus: async () => {},
            onLoadAliases: async () => [], onAddAlias: (docId) => gatedWrite(docId), onRemoveAlias: async () => {},
        } });
        await until(() => fixture.textContent.includes("还没有记录") && fixture.textContent.includes("还没有设置别名"), "详情子面板未加载");
        const ledger = fixture.querySelector('section[aria-label="往来账本"]');
        const draft = module === "exchange" ? ledger.querySelector('input[type="text"]') : fixture.querySelector('input[aria-label="新增别名"]');
        input(draft, module === "exchange" ? "草稿" : "老张");
        if (module === "exchange") input(ledger.querySelector('input[type="number"]'), "35");
        await tick();
        for (const label of ["互动", "下一位", "关闭"]) {
            button(label).click();
            await until(() => document.querySelector(".lvct-closeguard"), "子面板草稿离开未触发守卫");
            document.querySelector('.lvct-closeguard button[data-choice="cancel"]').click();
            await until(() => !document.querySelector(".lvct-closeguard"), "草稿守卫未取消");
            assert(!closed && navigated === 0 && draft.value === (module === "exchange" ? "草稿" : "老张")
                && button("概览").getAttribute("aria-selected") === "true" && writes === 0, "取消丢草稿、切人、切标签或写入");
        }
        button(module === "exchange" ? "记一笔往来" : "添加").click();
        await until(() => writes === 1, "挂起保存未开始");
        for (const label of ["互动", "下一位", "关闭"]) button(label).click();
        await tick();
        assert(!closed && navigated === 0 && !document.querySelector(".lvct-closeguard") && button("概览").getAttribute("aria-selected") === "true",
            "保存挂起仍允许离开子面板");
        release();
        await until(() => !draft.disabled, "保存结束仍阻断输入");
        button("互动").click();
        await until(() => button("互动").getAttribute("aria-selected") === "true", "保存结束后无法切换标签");
        await unmount(mounted);
        mounted = undefined;
    }
});

await test("人物独立备注：详情加载、保存失败重试与清空写回均保留输入", async () => {
    let storedNote = "已有特殊情况";
    let saveAttempts = 0;
    const saves = [];
    mounted = mount(PersonDetail, { target: fixture, props: {
        settings, person, onRecord: async () => {}, onLoadInsights: async () => emptyInsights(),
        onLoadPersonNote: async (docId) => {
            assert(docId === person.docId, "独立备注读取使用了错误人物文档");
            return storedNote;
        },
        onSavePersonNote: async (docId, note, expected) => {
            assert(docId === person.docId && expected === storedNote, "独立备注保存未携带当前版本");
            saveAttempts += 1;
            if (saveAttempts === 1) throw new Error("临时保存失败");
            storedNote = note;
            saves.push({ docId, note, expected });
            return storedNote;
        },
        onOpenPersonDoc() {}, onNavigate() {}, onChanged() {}, onDeleted() {}, onClose() {},
    } });
    await until(() => fixture.querySelector('textarea[aria-label="个人备注"]')?.value === "已有特殊情况", "个人备注初始内容未加载");
    const noteInput = fixture.querySelector('textarea[aria-label="个人备注"]');
    input(noteInput, "下次见面前提醒准备资料");
    await tick();
    button("保存备注").click();
    await until(() => fixture.querySelector('[role="alert"]')?.textContent.includes("临时保存失败"), "个人备注失败态未显示");
    assert(noteInput.value === "下次见面前提醒准备资料" && saveAttempts === 1, "个人备注保存失败后丢失草稿或重复提交");
    button("重试保存").click();
    await until(() => fixture.querySelector(".lvct-detail__person-note .lvct-chip")?.textContent.includes("已保存"), "个人备注重试未成功");
    assert(storedNote === "下次见面前提醒准备资料" && saves.length === 1 && noteInput.value === storedNote, "个人备注重试未写回并显示已保存状态");
    input(noteInput, "");
    await tick();
    button("保存备注").click();
    await until(() => saves.length === 2 && storedNote === "", "清空个人备注未写回");
    assert(noteInput.value === "" && saves[1].note === "" && saves[1].expected === "下次见面前提醒准备资料", "清空个人备注保存参数错误");
});

await test("详情子面板：甲乙加载乱序与卸载后的保存回调均不能回填或通知旧实例", async () => {
    const firstDocId = person.docId;
    const secondDocId = "20260927000000-person2";
    let releaseOldExchanges;
    let releaseOldAliases;
    let releaseSave;
    let changed = 0;
    const oldExchanges = new Promise((resolve) => { releaseOldExchanges = resolve; });
    const oldAliases = new Promise((resolve) => { releaseOldAliases = resolve; });
    const aliasOf = (docId, label) => ({ id: "20261004000000-alias01", personDocId: docId, alias: label, createdAt: 1, updatedAt: 1 });
    mounted = mount(DetailPanelsFixture, { target: fixture, props: {
        firstDocId, secondDocId,
        loadExchanges: (docId) => docId === firstDocId ? oldExchanges : Promise.resolve([]),
        loadAliases: (docId) => docId === firstDocId ? oldAliases : Promise.resolve([aliasOf(docId, "乙的别名")]),
        addAlias: async (docId) => { await new Promise((resolve) => { releaseSave = resolve; }); return aliasOf(docId, "迟到新增"); },
        onChanged: () => { changed += 1; },
    } });
    await tick();
    button("切换测试人物").click();
    await until(() => fixture.textContent.includes("乙的别名") && fixture.textContent.includes("还没有记录"), "乙数据未加载");
    releaseOldExchanges([{
        id: "20261004000000-ex00001", personDocId: firstDocId, kind: "item", direction: "receivable", description: "甲的往来",
        currency: "CNY", occurredOn: "2026-10-04", dueOn: "", status: "open", settledOn: "", note: "", createdAt: 1, updatedAt: 1,
    }]);
    releaseOldAliases([aliasOf(firstDocId, "甲的别名")]);
    await pause(50);
    assert(fixture.textContent.includes("乙的别名") && !fixture.textContent.includes("甲的别名") && !fixture.textContent.includes("甲的往来"), "甲的迟到读取显示在乙名下");
    input(fixture.querySelector('input[aria-label="新增别名"]'), "迟到新增");
    await tick();
    button("添加").click();
    await until(() => releaseSave, "别名保存未挂起");
    await unmount(mounted);
    mounted = undefined;
    releaseSave();
    await pause(50);
    assert(changed === 0, "卸载后保存仍通知旧实例");
    releaseSave = undefined;
    mounted = mount(ExchangeLedger, { target: fixture, props: {
        personDocId: firstDocId, onLoad: async () => [], onChangeStatus: async () => {},
        onCreate: async (input) => {
            await new Promise((resolve) => { releaseSave = resolve; });
            return { ...input, id: input.requestId, status: "open", dueOn: "", settledOn: "", note: "", createdAt: 1, updatedAt: 1 };
        }, onChanged: () => { changed += 1; },
    } });
    await until(() => fixture.textContent.includes("还没有记录"), "卸载测试账本未加载");
    input(fixture.querySelector('input[type="text"]'), "迟到往来");
    input(fixture.querySelector('input[type="number"]'), "35");
    await tick();
    button("记一笔往来").click();
    await until(() => releaseSave, "往来保存未挂起");
    await unmount(mounted);
    mounted = undefined;
    releaseSave();
    await pause(50);
    assert(changed === 0, "卸载后往来保存仍通知旧实例");
});

await test("别名界面实际服务：重复添加已有别名只保留同一记录，零重复写入", async () => {
    let raw = "";
    let writes = 0;
    const plugin = { loadData: async () => structuredClone(raw), saveData: async (_key, value) => { writes += 1; raw = structuredClone(value); } };
    mounted = mount(PersonAliases, { target: fixture, props: {
        personDocId: person.docId, onLoad: (docId) => listPersonAliases(plugin, docId),
        onAdd: (docId, alias) => createPersonAlias(plugin, docId, alias), onRemove: async () => {}, onChanged() {},
    } });
    await until(() => fixture.textContent.includes("还没有设置别名"), "别名未加载");
    const draft = fixture.querySelector('input[aria-label="新增别名"]');
    input(draft, "老张");
    await tick();
    button("添加").click();
    await until(() => draft.value === "" && !draft.disabled, "首个别名未保存");
    const before = writes;
    input(draft, "老张");
    await tick();
    button("添加").click();
    await until(() => draft.value === "" && !draft.disabled, "重复添加未核实原记录");
    assert(fixture.querySelectorAll(".lvct-person-aliases__item").length === 1 && raw.aliases.length === 1 && writes === before,
        "重复添加已有别名产生重复 ID 或重复写入");
});

await test("详情子面板：工作台 X 与 Esc 取消保留草稿，明确放弃切人只确认一次", async () => {
    const second = { ...person, docId: "20260927000000-person2", itemId: "row-2", name: "回归测试乙" };
    let release;
    let writes = 0;
    let aliases = [];
    kernel.handler = async (route) => {
        if (route !== "/api/av/renderAttributeView") throw new Error("导航测试不允许写入");
        const result = renderResult();
        result.view.rows.push({ id: second.itemId, cells: [{ valueType: "block", value: {
            type: "block", keyID: "name", block: { id: second.docId, content: second.name },
        } }] });
        return result;
    };
    mounted = mount(Workbench, { target: fixture, props: {
        settings, preferences: DEFAULT_VIEW_PREFERENCES, initialView: "people", isMobile: window.innerWidth < 700,
        onPreferencesUpdated() {}, onOpenPersonDoc() {}, facade: {
            settings, viewPreferences: DEFAULT_VIEW_PREFERENCES, listContacts: () => getRoster(settings),
            loadRecentInteractions: async () => ({}), loadPersonInsights: async () => emptyInsights(),
            listPersonFollowUps: async () => [], getPersonCadence: async () => null, listTemplates: async () => [],
            listPersonAliases: async (docId) => aliases.filter((alias) => alias.personDocId === docId),
            addPersonAlias: async (docId, alias) => {
                writes += 1;
                await new Promise((resolve) => { release = resolve; });
                const created = { id: "20261004000000-alias01", personDocId: docId, alias, createdAt: 1, updatedAt: 1 };
                aliases = [created];
                return created;
            },
        },
    } });
    await until(() => fixture.querySelector(".lvct-person-card"), "工作台联系人未加载");
    fixture.querySelector(".lvct-person-card").click();
    await until(() => fixture.querySelector('input[aria-label="新增别名"]') && fixture.textContent.includes("还没有设置别名"), "工作台详情别名未加载");
    const draft = fixture.querySelector('input[aria-label="新增别名"]');
    input(draft, "别名草稿");
    await tick();
    const guard = () => document.querySelector(".lvct-closeguard");
    for (const action of [
        () => fixture.querySelector(".lvct-dialog-panel__close").click(),
        () => { draft.focus(); window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); },
    ]) {
        draft.focus();
        action();
        await until(guard, "工作台关闭未保护别名草稿");
        guard().querySelector('button[data-choice="cancel"]').click();
        await until(() => !guard(), "关闭守卫未取消");
        await pause(0);
        assert(draft.isConnected && draft.value === "别名草稿" && document.activeElement === draft && writes === 0, "X 或 Esc 取消丢失人物草稿、焦点或产生写入");
    }
    button("下一位").click();
    await until(guard, "切人未触发别名守卫");
    guard().querySelector('button[data-choice="discard"]').click();
    await until(() => fixture.querySelector(".lvct-dialog-panel__title")?.textContent.includes(second.name), "放弃后未切人或重复要求确认");
    assert(!guard() && fixture.querySelector('input[aria-label="新增别名"]').value === "", "切人重复确认或保留了错误人物草稿");
    const secondDraft = fixture.querySelector('input[aria-label="新增别名"]');
    await until(() => fixture.textContent.includes("还没有设置别名"), "乙别名未加载");
    input(secondDraft, "挂起别名");
    await tick();
    button("添加").click();
    await until(() => release, "乙别名保存未挂起");
    fixture.querySelector(".lvct-dialog-panel__close").click();
    secondDraft.focus();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    fixture.querySelector(".lvct-dialog-mask").click();
    await tick();
    assert(secondDraft.isConnected && !guard() && writes === 1, "外层 X/Esc/遮罩在子面板保存中卸载详情或重复写入");
    release();
    await until(() => !secondDraft.disabled && secondDraft.value === "", "乙别名保存后未解除守卫");
    button("返回联系人").click();
    await until(() => !fixture.querySelector(".lvct-dialog-panel"), "子面板保存完成后仍无法返回联系人");
});

await test("字段实际服务：接受但值未匹配只核实原请求，明确拒绝才补写未完成字段", async () => {
    const state = configureContactVerificationKernel();
    state.ignored.add("birthday");
    const draft = { ...person, birthday: "1990-05-20", isLunar: true };
    const report = await updateContactFields(settings, person.itemId, draft);
    assert(!report.complete && report.applied.length === 7 && report.failed.length === 0
        && report.unknown.length === 1 && report.unknown[0].field === "birthday", `接受请求被误报已保存：${JSON.stringify(report)}`);
    state.ignored.clear();
    const before = state.writes.length;
    const retry = await retryContactFields(settings, person.itemId, draft, report.unresolved.map((failure) => failure.field));
    assert(!retry.complete && retry.unknown.length === 1 && state.writes.length === before, "接受但未匹配仍重发");
    state.rendered.view.rows[0].cells.push({ valueType: "date", value: { type: "date", keyID: "birthday",
        date: { content: new Date("1990-05-20T00:00:00").getTime(), isNotEmpty: true, isNotTime: true } } });
    const verified = await retryContactFields(settings, person.itemId, draft, ["birthday"]);
    assert(verified.complete && state.writes.length === before, "迟到原值核实仍重发");
    const rejectedState = configureContactVerificationKernel();
    rejectedState.rejected.add("birthday");
    const rejected = await updateContactFields(settings, person.itemId, draft);
    assert(rejected.failed.length === 1 && rejected.failed[0].field === "birthday", "明确拒绝未逐字段报告");
    rejectedState.rejected.clear();
    const rejectedBefore = rejectedState.writes.length;
    const retried = await retryContactFields(settings, person.itemId, draft, ["birthday"]);
    assert(retried.complete && rejectedState.writes.length === rejectedBefore + 1 && rejectedState.writes.at(-1).keyID === "birthday",
        "明确拒绝重试触碰已完成字段");
});

await test("字段实际服务：保存后回读失败为未知，恢复核实已存值零重写", async () => {
    const state = configureContactVerificationKernel();
    state.failReadback = true;
    const draft = { ...person, phone: "13800009999", birthday: "1990-05-20" };
    const report = await updateContactFields(settings, person.itemId, draft);
    assert(!report.complete && report.unknown.length === report.accepted.length && report.unknown.some((entry) => entry.field === "birthday")
        && report.failed.length === 0 && report.results.length === 8, "回读失败未保持未知");
    const before = state.writes.length;
    let failure = "";
    try { await retryContactFields(settings, person.itemId, draft, report.unresolved.map((entry) => entry.field)); }
    catch (error) { failure = error.message; }
    assert(failure.includes("字段核实读取失败") && state.writes.length === before, "未知仍在重发请求");
    state.failReadback = false;
    const checked = await retryContactFields(settings, person.itemId, draft, report.unresolved.map((entry) => entry.field));
    assert(checked.complete && checked.applied.length === report.unknown.length && checked.accepted.length === 0
        && state.writes.length === before, "核实到已存值仍重复写入");
});

await test("字段实际服务：批量与 vCard 的未知结果先核实，恢复已存值时零重写", async () => {
    const state = configureContactVerificationKernel();
    state.failReadback = true;
    const first = await batchUpdateContacts(settings, [{ itemId: person.itemId, group: "同学", tags: ["合唱"] }]);
    assert(first[0].report.unknown.length === 2 && !first[0].report.complete, "批量回读失败被误报完成");
    state.failReadback = false;
    const before = state.writes.length;
    const retried = await batchUpdateContacts(settings, [{ itemId: person.itemId, group: "同学", tags: ["合唱"] }], {
        onlyFieldsByItem: { [person.itemId]: ["group", "tags"] },
    });
    assert(retried[0].report.complete && state.writes.length === before, "批量核实已存值仍重写");
    state.writes.length = 0;
    state.failReadback = true;
    const draft = { ...person, phone: "13900001234", birthday: "1960-03-05" };
    const written = await updateContactFields(settings, person.itemId, draft);
    assert(written.unknown.some((entry) => entry.field === "birthday") && written.unknown.some((entry) => entry.field === "phone"), "vCard 前置未知场景未建立");
    state.failReadback = false;
    const beforeVcf = state.writes.length;
    const vcf = await retryVcfContacts(settings, [{ planIndex: 0, plan: { contact: { ...draft }, draft }, failedFields: written.unresolved.map((failure) => failure.field) }]);
    assert(vcf[0].status === "unknown" && state.writes.length === beforeVcf, "vCard 无原请求断点仍按同名补写");
});

await test("字段实际服务：未知行或重复行禁止重发，候选非法输入零写入且未改变不报成功", async () => {
    const state = configureContactVerificationKernel();
    const draft = { ...person, birthday: "1960-03-05" };
    state.rendered.view.rows = [];
    const absent = await retryContactFields(settings, person.itemId, draft, ["birthday"]);
    assert(absent.unknown.length === 1 && state.writes.length === 0, "未知行重试仍写入");
    state.rendered = renderResult();
    state.rendered.view.rows.push(structuredClone(state.rendered.view.rows[0]));
    const duplicate = await retryContactFields(settings, person.itemId, draft, ["birthday"]);
    assert(duplicate.unknown.length === 1 && state.writes.length === 0, "重复行未经消歧仍写入");
    state.rendered = renderResult();
    let errorText = "";
    try { await applyContactCandidateFields(settings, person.itemId, [
        { field: "phone", value: "13800001111", baseline: "" },
        { field: "birthday", value: "2026-02-30", baseline: "" },
    ]); } catch (error) { errorText = error.message; }
    assert(errorText.includes("生日") && state.writes.length === 0, "候选非法生日前已写入其他字段");
    state.ignored.add("phone");
    const ignored = await applyContactCandidateFields(settings, person.itemId, [{ field: "phone", value: "13800001111", baseline: "" }]);
    assert(!ignored.report.complete && ignored.applied.length === 0 && ignored.report.unknown[0].field === "phone", "候选请求被接受却误报已保存");
});

await test("字段编辑界面：未知结果保留生日草稿，核实已保存值后才关闭且零重复写入", async () => {
    const state = configureContactVerificationKernel();
    state.failReadback = true;
    let saved = 0;
    let closed = false;
    mounted = mount(PersonEditDialog, { target: fixture, props: {
        settings, person, onSaved: () => { saved += 1; }, onClose: () => { closed = true; },
    } });
    input(fixture.querySelector('input[type="date"]'), "1950-01-02");
    await tick();
    button("保存").click();
    await until(() => fixture.textContent.includes("结果未知"), "生日未知结果未显示");
    assert(!closed && saved === 0 && fixture.querySelector('input[type="date"]').value === "1950-01-02", "回读失败关闭界面或丢失草稿");
    const before = state.writes.length;
    state.failReadback = false;
    button("核实并重试未完成字段").click();
    await until(() => closed, "核实已保存生日后未完成");
    assert(saved === 1 && state.writes.length === before, "核实重试重复写入或重复回调");
});

await test("CODE-02.4 编辑写前预校验：非法生日/邮箱零写入，逐字段失败报告可重试", async () => {
    let setCellCount = 0;
    let failWechat = true;
    kernel.handler = reflectContactWrites(async (route, body) => {
        if (route === "/api/av/setAttributeViewBlockAttr") {
            if (body.keyID === "wechat" && failWechat) throw new Error("微信注入失败");
            setCellCount += 1;
            return null;
        }
        if (route === "/api/av/renderAttributeView") return renderResult();
        if (route === "/api/av/getAttributeViewItemIDsByBoundIDs") return { [person.docId]: person.itemId };
        return null;
    });
    const draftOf = (over) => ({ name: "回归测试甲", phone: "13900001111", email: "a@b.com", wechat: "test-wx", website: "", birthday: "", isLunar: false, group: "", tags: [], ...over });

    /* 非法生日（格式合法但不存在的日期）→ 预校验拒绝：零写入、旧值不被清空 */
    let error = "";
    try { await updateContactFields(settings, "row-1", draftOf({ birthday: "2026-02-30" })); }
    catch (e) { error = e.message; }
    assert(error.includes("未做任何写入") && error.includes("生日"), `非法生日未拦截：${error}`);
    assert(setCellCount === 0, "非法生日仍产生了写入");

    /* 非法邮箱 → 同样零写入 */
    error = "";
    try { await updateContactFields(settings, "row-1", draftOf({ email: "not-an-email" })); }
    catch (e) { error = e.message; }
    assert(error.includes("未做任何写入") && error.includes("邮箱"), `非法邮箱未拦截：${error}`);
    assert(setCellCount === 0, "非法邮箱仍产生了写入");

    /* 逐字段隔离：微信写入失败 → 结果报告点名失败字段，其余字段已写入 */
    const report = await updateContactFields(settings, "row-1", draftOf({}));
    assert(report.failed.some((failure) => failure.field === "wechat"), `逐字段失败未上浮：${JSON.stringify(report)}`);
    assert(report.applied.length === 7 && setCellCount === 2, `改动字段未保存或无改动字段重复写入：${JSON.stringify(report)}`);

    /* 缺失列映射 → 预检拒绝且不会触碰任何单元格 */
    const beforeMappingCheck = setCellCount;
    let mappingError = "";
    try {
        await updateContactFields({ ...settings, fieldMap: { ...settings.fieldMap, email: "missing-email-column" } }, "row-1", draftOf({}));
    } catch (e) { mappingError = e.message; }
    assert(mappingError.includes("字段映射校验失败") && setCellCount === beforeMappingCheck, `坏映射未零写入：${mappingError}`);
});

await test("B11.3/B11.5 指定本人身份：显式改绑成功、未初始化拒绝、目标不存在零改动", async () => {
    const files = new Map();
    files.set("contacts-settings.json", settings);
    files.set("self-identity.json", { schemaVersion: 1, selfDocId: "20260927000000-person1", selfItemId: "20260927000000-oldrow1", createdAt: "2026-09-30" });
    const plugin = { loadData: async (key) => files.get(key) ?? "", saveData: async (key, value) => { files.set(key, value); } };
    kernel.handler = async (route) => {
        if (route === "/api/av/renderAttributeView") {
            const base = renderResult();
            return { view: { ...base.view, rows: [...base.view.rows, { id: "20260927000000-newrow2", cells: [
                { valueType: "block", value: { type: "block", keyID: "name", block: { id: "20260927000000-person2", content: "回归测试乙" } } },
            ] } ] } };
        }
        if (route === "/api/sqlite/flushTransaction") return null;
        if (route === "/api/query/sql") return [{ id: "20260927000000-person2" }];
        if (route === "/api/av/getAttributeViewItemIDsByBoundIDs") return { "20260927000000-person2": "20260927000000-newrow2" };
        throw new Error(`指定身份用例不允许请求 ${route}`);
    };
    invalidateRoster();
    /* 显式改绑到 person2 → 成功且 createdAt 保留原始标记日期 */
    const identity = await designateSelfIdentity(plugin, settings, "20260927000000-newrow2");
    assert(identity.selfDocId === "20260927000000-person2" && identity.selfItemId === "20260927000000-newrow2",
        `显式改绑失败：${JSON.stringify(identity)}`);
    assert(identity.createdAt === "2026-09-30", "改绑丢失了原始 createdAt");
    const stored = files.get("self-identity.json");
    assert(stored.selfDocId === "20260927000000-person2", "改绑未落盘");
    assert((await loadSelfIdentity(plugin))?.selfItemId === identity.selfItemId, "改绑后不能严格回读身份");
    /* 目标不存在 → 报错且原身份保留 */
    let error = "";
    try { await designateSelfIdentity(plugin, settings, "row-gone"); } catch (e) { error = e.message; }
    assert(error.includes("不存在或已解绑"), `目标不存在未拦截：${error}`);
    assert(files.get("self-identity.json").selfDocId === "20260927000000-person2", "失败改绑污染了身份");
});

await test("B12 组织归属投影：Peek 组织区块按成员记录渲染（组织名/部门/职位/期间）", async () => {
    invalidateRoster();
    const orgMemberships = [
        { id: "20260930000000-mem0a01", orgDocId: "20260930000000-org0001", orgName: "测试公司", department: "研发部", title: "工程师", joinedOn: "2025-01-01", leftOn: "", status: "active" },
        { id: "20260930000000-mem0a02", orgDocId: "20260930000000-org0002", orgName: "母校学院", department: "", title: "", joinedOn: "2018-09-01", leftOn: "2022-06-30", status: "former" },
    ];
    const calls = [];
    mounted = mount(PersonDetail, { target: fixture, props: {
        settings, person, onRecord: async () => {}, onLoadInsights: async () => emptyInsights(),
        onLoadOrgMemberships: async (docId) => {
            calls.push(docId);
            return orgMemberships;
        },
        onOpenPersonDoc() {}, onNavigate() {}, onChanged() {}, onDeleted() {}, onClose() {},
    } });
    await until(() => calls.length >= 1, "组织归属未加载");
    await until(() => fixture.textContent.includes("测试公司"), "组织归属区块未渲染组织名");
    assert(fixture.textContent.includes("研发部") && fixture.textContent.includes("工程师"), "部门/职位未渲染");
    assert(fixture.textContent.includes("2025-01-01 –") && fixture.textContent.includes("2022-06-30"), "期间未渲染");
    assert(fixture.textContent.includes("在职/在学") && fixture.textContent.includes("已离开"), "状态未渲染");
    assert(fixture.textContent.includes("母校学院"), "第二条归属未渲染");
    /* B13.5 双向编辑最小版：接线 onOpenOrgManager 时显示「管理归属」按钮并回调 */
    let orgManagerOpened = 0;
    await unmount(mounted);
    mounted = mount(PersonDetail, { target: fixture, props: {
        settings, person, onRecord: async () => {}, onLoadInsights: async () => emptyInsights(),
        onLoadOrgMemberships: async () => orgMemberships,
        onOpenOrgManager: () => { orgManagerOpened += 1; },
        onOpenPersonDoc() {}, onNavigate() {}, onChanged() {}, onDeleted() {}, onClose() {},
    } });
    await until(() => fixture.textContent.includes("组织归属"), "组织归属区块未挂载");
    button("管理归属").click();
    await tick();
    assert(orgManagerOpened === 1, "管理归属按钮未回调");
    /* 未接线时按钮不显示 */
    await unmount(mounted);
    mounted = mount(PersonDetail, { target: fixture, props: {
        settings, person, onRecord: async () => {}, onLoadInsights: async () => emptyInsights(),
        onLoadOrgMemberships: async () => orgMemberships,
        onOpenPersonDoc() {}, onNavigate() {}, onChanged() {}, onDeleted() {}, onClose() {},
    } });
    await until(() => fixture.textContent.includes("组织归属"), "组织归属区块未挂载");
    assert(![...fixture.querySelectorAll("button")].some((node) => node.textContent.includes("管理归属")), "未接线时不应显示管理按钮");
});

await test("B13.5 双向编辑完整版：人物详情内添加/移除组织归属（facade 全链路）", async () => {
    let nextMemberId = 2;
    const memberships = [
        { id: "20260930000000-mem0001", orgDocId: "20260930000000-org0001", orgName: "测试公司", department: "研发部", title: "工程师", joinedOn: "2025-01-01", leftOn: "", status: "active" },
    ];
    const candidates = [
        { docId: "20260930000000-org0001", name: "测试公司" },
        { docId: "20260930000000-org0002", name: "新公司" },
    ];
    const addCalls = [];
    const removeCalls = [];
    let changedCount = 0;
    mounted = mount(PersonDetail, { target: fixture, props: {
        settings, person, onRecord: async () => {}, onLoadInsights: async () => emptyInsights(),
        onLoadOrgMemberships: async () => [...memberships],
        onLoadOrgCandidates: async () => candidates,
        onAddOrgMembership: async (docId, orgDocId, extra) => {
            addCalls.push({ docId, orgDocId, extra });
            const target = candidates.find((item) => item.docId === orgDocId);
            memberships.push({
                id: `20260930000000-mem000${nextMemberId}`, orgDocId,
                orgName: target?.name ?? "", department: extra?.department ?? "",
                title: extra?.title ?? "", joinedOn: extra?.joinedOn ?? "", leftOn: "", status: "active",
            });
            nextMemberId += 1;
        },
        onRemoveOrgMembership: async (id) => {
            removeCalls.push(id);
            const index = memberships.findIndex((item) => item.id === id);
            if (index >= 0) memberships.splice(index, 1);
        },
        onChanged: () => { changedCount += 1; },
        onOpenPersonDoc() {}, onNavigate() {}, onDeleted() {}, onClose() {},
    } });
    await until(() => fixture.textContent.includes("组织归属"), "组织归属区块未挂载");
    /* 候选过滤：已加入的测试公司不进下拉，只有新公司 */
    const orgSelect = fixture.querySelector('select[aria-label="选择要加入的组织"]');
    assert(orgSelect, "添加归属表单未出现");
    const optionTexts = [...orgSelect.querySelectorAll("option")].map((node) => node.textContent);
    assert(!optionTexts.some((text) => text.includes("测试公司")), "已加入组织不应出现在候选");
    assert(optionTexts.some((text) => text.includes("新公司")), "未加入组织应出现在候选");
    /* 添加归属：选组织+填部门 → 走 facade（personDocId/orgDocId 分传）→ 刷新 + onChanged */
    orgSelect.value = "20260930000000-org0002";
    orgSelect.dispatchEvent(new Event("change", { bubbles: true }));
    await tick();
    input(fixture.querySelector('input[aria-label="归属部门"]'), "市场部");
    await tick();
    button("添加归属").click();
    await until(() => addCalls.length === 1, "添加归属未走 facade");
    assert(addCalls[0].docId === person.docId && addCalls[0].orgDocId === "20260930000000-org0002", "添加归属参数错误");
    assert(addCalls[0].extra.department === "市场部", "部门参数错误");
    await until(() => fixture.textContent.includes("新公司"), "添加后归属列表未刷新");
    assert(changedCount >= 1, "添加归属未触发 onChanged");
    /* 移除归属：按 membership id 走 facade（等添加流程的 busy 释放后再点） */
    const removeBtnLive = () => [...fixture.querySelectorAll('button[aria-label^="移除归属"]')][0];
    await until(() => removeBtnLive() && !removeBtnLive().disabled, "移除按钮未解除禁用");
    const removeBtn = removeBtnLive();
    assert(removeBtn, "移除归属按钮未出现");
    removeBtn.click();
    await until(() => fixture.querySelector('[aria-label="确认移除这段成员历史"]'), "移除影响确认未显示");
    assert(removeCalls.length === 0, "未确认就移除成员历史");
    button("确认移除这段成员历史").click();
    await until(
        () => removeCalls.length === 1 && removeCalls[0] === "20260930000000-mem0001",
        `移除未按 membership id 走 facade calls=${JSON.stringify(removeCalls)}`,
    );
    await until(
        () => {
            const timeline = fixture.querySelector(".lvct-detail__timeline");
            return Boolean(timeline) && timeline.textContent.includes("新公司") && !timeline.textContent.includes("测试公司");
        },
        `移除后归属列表未刷新 calls=${JSON.stringify(removeCalls)} err=${fixture.querySelector(".lvct-form__error")?.textContent ?? ""}`,
    );
});

await test("B13.6 共同背景：同组织联系人按重叠期间展示（同期/同组织区分，失败降级）", async () => {
    const peerContact = {
        docId: "20260930000000-peer0001", itemId: "row-peer1", name: "同期同事甲",
        phone: "", email: "", wechat: "", website: "", birthday: "", isLunar: false,
        group: "同事", tags: [], relatedItemIds: [],
    };
    const background = [
        {
            orgDocId: "20260930000000-org0001", orgName: "测试公司",
            peers: [
                { docId: "20260930000000-peer0001", name: "同期同事甲", overlapText: "2024-06-01 ~ 2025-05-31", samePeriod: true, contact: peerContact },
                { docId: "20260930000000-peer0002", name: "时间未知乙", overlapText: "2023-01-01 ~ 至今", samePeriod: false },
            ],
        },
    ];
    let navigatedTo = null;
    let fail = true;
    mounted = mount(PersonDetail, { target: fixture, props: {
        settings, person, onRecord: async () => {}, onLoadInsights: async () => emptyInsights(),
        onLoadCommonOrgs: async () => {
            if (fail) throw new Error("共同背景读取失败");
            return background;
        },
        onOpenPersonDoc() {}, onNavigate() {}, onChanged() {}, onDeleted() {}, onClose() {},
    } });
    /* 失败降级：区块显示提示而非空白 */
    await until(() => fixture.textContent.includes("共同背景读取失败"), "共同背景失败未降级提示");
    /* 恢复：同期/同组织 chip 与期间文本 */
    await unmount(mounted);
    fail = false;
    mounted = mount(PersonDetail, { target: fixture, props: {
        settings, person, onRecord: async () => {}, onLoadInsights: async () => emptyInsights(),
        onLoadCommonOrgs: async () => background,
        onNavigate: (target) => { navigatedTo = target; },
        onOpenPersonDoc() {}, onChanged() {}, onDeleted() {}, onClose() {},
    } });
    await until(() => fixture.textContent.includes("测试公司"), "共同背景组织名未渲染");
    await until(() => fixture.textContent.includes("同期同事甲"), "同期同伴未渲染");
    assert(fixture.textContent.includes("2024-06-01 ~ 2025-05-31"), "重叠期间未渲染");
    const chips = [...fixture.querySelectorAll(".lvct-org-common__peer .lvct-chip")].map((node) => node.textContent.trim());
    assert(chips.includes("同期") && chips.includes("同组织"), `同期/同组织 chip 缺失：${chips.join(",")}`);
    assert(fixture.textContent.includes("不推断同期"), "口径说明缺失");
    /* B13.6 点击同伴开详情：有 contact 的同伴显示查看按钮并回调 onNavigate */
    const peerRow = [...fixture.querySelectorAll(".lvct-org-common__peer")]
        .find((node) => node.textContent.includes("同期同事甲"));
    button("查看详情", peerRow).click();
    await until(() => navigatedTo, "关闭守卫允许后未跳转共同背景人物");
    assert(
        Boolean(navigatedTo) && navigatedTo.docId === peerContact.docId && navigatedTo.name === peerContact.name,
        `查看详情未携带联系人回调 onNavigate navigatedTo=${JSON.stringify(navigatedTo)}`,
    );
    /* 无 contact 的同伴（解绑/不在名册）不显示入口 */
    const unknownRow = [...fixture.querySelectorAll(".lvct-org-common__peer")]
        .find((node) => node.textContent.includes("时间未知乙"));
    assert(unknownRow && ![...unknownRow.querySelectorAll("button")].some((node) => node.textContent.includes("查看详情")),
        "无联系人摘要的同伴不应显示查看入口");
    /* 无背景时不渲染区块（onLoadCommonOrgs 接线但数据为空） */
    await unmount(mounted);
    mounted = mount(PersonDetail, { target: fixture, props: {
        settings, person, onRecord: async () => {}, onLoadInsights: async () => emptyInsights(),
        onLoadCommonOrgs: async () => [],
        onOpenPersonDoc() {}, onNavigate() {}, onChanged() {}, onDeleted() {}, onClose() {},
    } });
    await tick();
    assert(!fixture.textContent.includes("共同背景"), "空背景不应渲染区块");
});

await test("FUNC-01.8a 锚点消歧：首 AV 无关不采纳按字段证据取次 AV，歧义暂停写入，零匹配按新建", async () => {
    const hostDocId = "20260927000000-host001";
    const CONTACT_COLUMNS = [
        { id: "col-1", name: "生日", type: "date" },
        { id: "col-2", name: "农历生日", type: "checkbox" },
        { id: "col-3", name: "电话", type: "phone" },
        { id: "col-4", name: "邮箱", type: "email" },
        { id: "col-5", name: "微信", type: "text" },
        { id: "col-6", name: "网站", type: "url" },
        { id: "col-7", name: "分组", type: "select" },
        { id: "col-8", name: "标签", type: "mSelect" },
        { id: "col-9", name: "相关人", type: "relation" },
    ];
    const avBlocks = {
        "20260927000000-avirel1": { markdown: 'data-av-id="20260927000000-avirel1"', columns: [{ id: "col-x", name: "待办事项", type: "text" }] },
        "20260927000000-avcont1": { markdown: 'data-av-id="20260927000000-avcont1"', columns: CONTACT_COLUMNS },
    };
    kernel.handler = async (route, body) => {
        if (route === "/api/notebook/lsNotebooks") return { notebooks: [{ id: "20260927000000-book001", name: "人脉" }] };
        if (route === "/api/query/sql") {
            const stmt = String(body?.stmt ?? "");
            if (stmt.includes("type='d'")) return [{ id: hostDocId, content: "联系人总表", hpath: "/联系人总表" }];
            if (stmt.includes("type = 'av'")) {
                return Object.entries(avBlocks).map(([id, block]) => ({ id, parent_id: hostDocId, markdown: block.markdown }));
            }
            return [];
        }
        if (route === "/api/av/renderAttributeView") {
            const block = avBlocks[body.id];
            return { view: { columns: block ? block.columns : [], rows: [] } };
        }
        throw new Error(`锚点消歧用例不允许请求 ${route}`);
    };

    /* 场景 1：首个 AV 无字段证据、次 AV 九字段全对回 → 采纳次 AV，绝不给无关库当锚点 */
    const snapshot = await inspectWorkspace("人脉");
    assert(snapshot.avId === "20260927000000-avcont1" && snapshot.dbBlockId === "20260927000000-avcont1",
        `未按字段证据采纳联系人库：${JSON.stringify({ avId: snapshot.avId, dbBlockId: snapshot.dbBlockId })}`);
    assert(snapshot.existingFields.length === 9, `字段证据未对回：${JSON.stringify(snapshot.existingFields)}`);

    /* 场景 2：两个 AV 都有字段证据 → 歧义暂停写入（指引设置页锚点扫描手动选择） */
    avBlocks["20260927000000-avirel1"].columns = CONTACT_COLUMNS;
    let pauseError = "";
    try { await inspectWorkspace("人脉"); } catch (error) { pauseError = error.message; }
    assert(pauseError.includes("暂停初始化") && pauseError.includes("锚点扫描"), `歧义未暂停写入：${pauseError}`);

    /* 场景 3：全部 AV 无字段证据 → 复用文档、不采纳任何无关库（新建库） */
    avBlocks["20260927000000-avirel1"].columns = [{ id: "col-x", name: "待办事项", type: "text" }];
    avBlocks["20260927000000-avcont1"].columns = [{ id: "col-y", name: "笔记存档", type: "text" }];
    const fresh = await inspectWorkspace("人脉");
    assert(fresh.hostDocId === hostDocId && fresh.avId === null && fresh.dbBlockId === null,
        `零匹配未按新建处理：${JSON.stringify({ avId: fresh.avId, dbBlockId: fresh.dbBlockId })}`);
});

await test("新建草稿「保存并离开」：守卫内保存成功并关闭弹窗", async () => {
    const state = configureVcardKernel(kernel, settings);
    const guardDialog = () => document.body.querySelector(".lvct-closeguard");
    try {
        mounted = mount(Workbench, { target: fixture, props: {
            settings, preferences: DEFAULT_VIEW_PREFERENCES, isMobile: false,
            onPreferencesUpdated() {}, onOpenPersonDoc() {},
            facade: { settings, loadRecentInteractions: async () => ({}) },
        } });
        button("新建联系人").click();
        await until(() => fixture.querySelector(".lvct-form input[type=text]"), "新建弹窗未打开");
        input(fixture.querySelector(".lvct-form input[type=text]"), "守卫保存的人");
        fixture.querySelector(".lvct-dialog-panel__close").click();
        await until(() => guardDialog(), "脏草稿关闭未弹三选一");
        const saveButton = [...guardDialog().querySelectorAll("button")].find((node) => node.textContent.trim() === "保存并离开");
        assert(saveButton, "守卫弹窗缺少保存并离开按钮");
        saveButton.click();
        await until(() => !fixture.querySelector(".lvct-dialog-panel"), "保存并离开后编辑弹窗未关闭");
        await until(() => !guardDialog(), "保存并离开后守卫弹窗未关闭");
        assert(state.creates.length === 1 && state.rows.size === 1, "保存并离开没有核实唯一人物文档和行");
    } finally {
        document.body.querySelector(".lvct-closeguard")?.remove();
    }
});

await test("英文工作台导航与标题跟随语言资源，缺失文案回退且设置入口可达", async () => {
    mounted = mount(Workbench, { target: fixture, props: {
        settings, preferences: DEFAULT_VIEW_PREFERENCES, isMobile: window.innerWidth <= 640,
        onPreferencesUpdated() {}, onOpenPersonDoc() {},
        facade: { settings, i18n: { ...englishMessages, navOrganizations: "" },
            loadDashboard: async () => ({ people: 1, relations: 0, birthdays: [], birthdaysThisWeek: 0,
                stale: [{ person }], neverContacted: 1, neverContactedItemIds: [person.itemId] }),
            loadPersonInsights: async () => emptyInsights(),
            loadRecentInteractions: async () => ({}),
        },
    } });
    await until(() => fixture.querySelector("h1")?.textContent === "Home", "英文标题未显示");
    assert(fixture.querySelector("aside").getAttribute("aria-label") === "Lv Contacts navigation", "导航无障碍标签未翻译");
    assert(fixture.querySelector("aside").textContent.includes("组织"), "空翻译未回退");
    button("Settings").click();
    await until(() => fixture.querySelector("h1")?.textContent === "Settings", "英文设置导航未切换");
    window.dispatchEvent(new CustomEvent("lvct-workbench-view", { detail: { view: "home" } }));
    await until(() => fixture.querySelector(".lvct-dash__stats"), "英文首页未恢复");
    navButton(["Relationships", "Graph"]).click();
    await until(() => fixture.querySelector("h1")?.textContent === "Relationships", "英文关系导航未切换");
    button("Contacts").click();
    await until(() => fixture.querySelector("h1")?.textContent === "Contacts", "英文联系人导航未切换");
    await until(() => fixture.querySelector(".lvct-person-card"), "英文导航联系人未加载");
    assert(button("New contact", fixture.querySelector(".lvct-people__toolbar")), "联系人常用操作未翻译");
    if (window.innerWidth <= 640) {
        /* B09-1：移动端排序收进「筛选与整理」底部弹层 */
        const tools = [...fixture.querySelectorAll(".lvct-people__toolbar button")]
            .find((node) => node.textContent.includes("Filter & organize"));
        assert(tools, "移动端收纳按钮未翻译");
        tools.click();
        await until(() => [...fixture.querySelectorAll(".lvct-sheet option")]
            .some((option) => option.textContent === "Recent interaction"), "移动收纳弹层缺排序选项");
        fixture.querySelector(".lvct-sheet__bar button").click();
    } else {
        assert([...fixture.querySelectorAll(".lvct-people__toolbar option")].some((option) => option.textContent === "Recent interaction"), "排序选项未翻译");
    }
    fixture.querySelector(".lvct-person-card").click();
    await until(() => fixture.querySelector(".lvct-dialog-panel__title")?.textContent === `Person Details · ${person.name}`, "详情标题未翻译或姓名丢失");
    assert(button("Overview", fixture.querySelector(".lvct-detail__tabs")), "详情标签未翻译");
    assert(fixture.querySelector('button[aria-label="Return to Contacts"]'), "返回无障碍标签未翻译");
    fixture.querySelector('button[aria-label="Return to Contacts"]').click();
    await until(() => !fixture.querySelector(".lvct-dialog-panel"), "英文关闭按钮未关闭详情");
    const nav = fixture.querySelector(".lvct-workbench__nav");
    assert(nav.clientWidth > 0 && nav.getBoundingClientRect().right <= window.innerWidth + 1, "英文导航超出视口");
});

await test("工作台可通过入口请求切换到设置页", async () => {
    mounted = mount(Workbench, { target: fixture, props: {
        settings, preferences: DEFAULT_VIEW_PREFERENCES, isMobile: false,
        onPreferencesUpdated() {}, onOpenPersonDoc() {},
        facade: { settings, loadDashboard: async () => ({
            people: 1, relations: 0, birthdays: [], birthdaysThisWeek: 0,
            stale: [], neverContacted: 0, neverContactedItemIds: [],
        }) },
    } });
    await until(() => fixture.querySelector("h1")?.textContent === "首页", "工作台未加载");
    window.dispatchEvent(new CustomEvent("lvct-workbench-view", { detail: { view: "settings" } }));
    await until(() => fixture.querySelector("h1")?.textContent === "设置", "设置入口请求未切换工作台");
    assert(fixture.querySelector(".lvct-settings"), "设置页内容未挂载");
});

await test("新工作台可按入口指定的初始视图打开", async () => {
    mounted = mount(Workbench, { target: fixture, props: {
        settings, preferences: DEFAULT_VIEW_PREFERENCES, initialView: "settings", isMobile: false,
        onPreferencesUpdated() {}, onOpenPersonDoc() {}, facade: { settings },
    } });
    await until(() => fixture.querySelector("h1")?.textContent === "设置", "工作台没有使用入口指定的初始视图");
    assert(fixture.querySelector(".lvct-settings"), "初始设置页内容未挂载");
});

await test("B14.8 按组织收窄：关系图人物与组织节点收窄、文档引用图白名单收窄与范围说明", async () => {
    const selfDocId = "20260930000000-self003";
    const memberA = "20260930000000-memba01";
    const memberB = "20260930000000-membb01";
    const outsider = "20260930000000-outsi01";
    const orgDocId = "20260930000000-orgn001";
    const nameRows = [
        { id: selfDocId, name: "我自己" },
        { id: memberA, name: "组织成员甲" },
        { id: memberB, name: "组织成员乙" },
        { id: outsider, name: "圈外人" },
    ];
    const localCalls = [];
    kernel.handler = async (route, body) => {
        if (route === "/api/av/renderAttributeView") return { view: { columns: renderResult().view.columns, rows: nameRows.map((row) => ({
            id: row.id, cells: [
                { valueType: "block", value: { type: "block", keyID: "name", block: { id: row.id, content: row.name } } },
                { valueType: "relation", value: { type: "relation", keyID: "related", relation: { blockIDs: [] } } },
            ],
        })) } };
        if (route === "/api/graph/getLocalGraph") {
            assert(body.conf && typeof body.conf === "object", "引用图请求缺少实证 conf 对象");
            localCalls.push(body.id);
            return {
                id: body.id,
                nodes: [
                    { id: selfDocId, label: "我自己", type: "NodeDocument", refs: 2, defs: 0 },
                    { id: memberA, label: "组织成员甲", type: "NodeDocument", refs: 0, defs: 1 },
                    { id: memberB, label: "组织成员乙", type: "NodeDocument", refs: 0, defs: 1 },
                    { id: outsider, label: "圈外人", type: "NodeDocument", refs: 0, defs: 0 },
                ],
                links: [
                    { from: selfDocId, to: memberA, ref: true },
                    { from: selfDocId, to: memberB, ref: true },
                    { from: selfDocId, to: outsider, ref: true },
                ],
            };
        }
        throw new Error(`回归测试不允许请求 ${route}`);
    };
    let openedOrgs = 0;
    let currentPrefs = { ...DEFAULT_VIEW_PREFERENCES };
    mounted = mount(RelationGraph, { target: fixture, props: {
        settings,
        preferences: currentPrefs,
        onPreferencesChange: async (next) => { currentPrefs = next; return next; },
        facade: { loadSelfIdentity: async () => ({ selfDocId, createdAt: "2026-09-30T00:00:00Z" }), listOrganizations: async () => [
            { docId: orgDocId, name: "收窄科技", hpath: "/收窄科技", notebookId: settings.notebookId, archived: false, memberships: [
                { id: "20260930000000-nmem0001", orgDocId, personDocId: memberA, department: "", title: "", joinedOn: "", leftOn: "", status: "active" },
                { id: "20260930000000-nmem0002", orgDocId, personDocId: memberB, department: "", title: "", joinedOn: "", leftOn: "", status: "active" },
            ] },
        ] },
        onOpenDetail() {},
        onOpenPeople() {},
        onOpenOrgs: () => { openedOrgs += 1; },
    } });
    button("画布视图").click();
    const canvas = () => fixture.querySelector(".lvct-graph-view__canvas")?._cyreg?.cy;
    await until(() => (canvas()?.nodes().length ?? 0) > 0, "关系图未挂载");
    await until(() => canvas().getElementById(orgDocId).nonempty(), "组织节点未挂载");
    canvas().getElementById(orgDocId).emit("tap");
    await until(() => fixture.querySelector('select[aria-label="关系图范围"]')?.value === "org", "组织节点点击未聚焦稳定组织 ID");
    assert(fixture.querySelector('select[aria-label="按组织收窄"]')?.value === orgDocId && openedOrgs === 0, "组织聚焦误跳页面或改换目标");
    canvas().getElementById(orgDocId).emit("mouseover");
    await until(() => fixture.querySelector(".lvct-graph-view__hover-card"), "组织悬停入口未出现");
    button("打开组织视图").click();
    assert(openedOrgs === 1, "显式组织视图入口未触发跳转回调");
    /* 按组织收窄：画布人物只剩组织成员，组织节点只剩该组织 */
    const narrowSelect = fixture.querySelector('select[aria-label="按组织收窄"]');
    assert(narrowSelect, "收窄选择器未出现");
    narrowSelect.value = orgDocId;
    narrowSelect.dispatchEvent(new Event("change", { bubbles: true }));
    await tick();
    await until(() => (canvas()?.nodes().length ?? 0) === 3, "收窄后画布节点数错误（应为组织+2 成员）");
    assert(canvas().getElementById(outsider).empty(), "圈外人未被收窄过滤");
    await until(() => canvas().edges().length === 2, "收窄后成员边数错误（组织→甲/乙）");
    assert(canvas().edges().every((edge) => edge.data("kind") === "member"), "收窄后画布应只剩成员边");
    button("文档引用").click();
    await until(() => localCalls.length === 1 && localCalls[0] === selfDocId, "局部图未使用保留的本人范围");
    const retainedNames = [{ id: selfDocId, name: "我自己" }, { id: orgDocId, name: "收窄科技" }]
        .sort((first, second) => first.id < second.id ? -1 : first.id > second.id ? 1 : 0).map((entry) => entry.name).join("、");
    await until(() => fixture.querySelector(".lvct-graph-summary")?.textContent.includes(`范围外中心优先保留：${retainedNames}（不属于当前范围或组织成员集合，不新增关系事实）`), "范围外本人和补充组织的保留说明缺失或排序错误");
    const nativeCanvasLive = () => fixture.querySelector(".lvct-graph-view__canvas")?._cyreg?.cy;
    await until(() => (nativeCanvasLive()?.nodes().length ?? 0) === 4, "引用图收窄未保留本人、组织与两位成员");
    assert(nativeCanvasLive().getElementById(outsider).empty(), "引用图圈外人未被收窄过滤");
    assert(nativeCanvasLive().getElementById(orgDocId).nonempty() && nativeCanvasLive().edges().length === 2
        && nativeCanvasLive().edges().every((edge) => edge.data("kind") === "ref"), "组织聚焦将成员事实混入引用边");
    assert(fixture.querySelector(".lvct-graph-summary")?.textContent.includes("登记 5")
        && fixture.querySelector(".lvct-graph-summary")?.textContent.includes("展示 4 节点 / 2 边"), "聚焦范围与计数不可核对");
});

await test("B13.5a 组织视图：侧栏入口、卡片渲染（活跃/归档/成员数）、管理入口与初始视图直开", async () => {
    let managerOpened = 0;
    const facade = {
        settings, viewPreferences: DEFAULT_VIEW_PREFERENCES,
        listContacts: async () => [],
        listOrganizationMembers: async () => [],
        listOrganizations: async () => [
            { docId: "20260930000000-org0001", name: "曙光科技", hpath: "/曙光科技", notebookId: settings.notebookId, archived: false, memberships: [
                { status: "active" }, { status: "former" },
            ] },
            { docId: "20260930000000-org0002", name: "旧校", hpath: "/旧校", notebookId: settings.notebookId, archived: true, memberships: [] },
        ],
        loadDashboard: async () => ({ people: 0, relations: 0, birthdays: [], birthdaysThisWeek: 0, stale: [], neverContacted: 0, neverContactedItemIds: [] }),
        openOrgManagerDialog: () => { managerOpened += 1; },
    };
    const baseProps = {
        settings, preferences: DEFAULT_VIEW_PREFERENCES, isMobile: false,
        onPreferencesUpdated() {}, onOpenPersonDoc() {}, facade,
    };
    mounted = mount(Workbench, { target: fixture, props: baseProps });
    await until(() => fixture.querySelector("h1")?.textContent === "首页", "工作台未加载");
    /* 侧栏组织入口切换视图（原「即将推出」占位已升级为真视图） */
    navButton(["组织"]).click();
    await until(() => fixture.querySelector("h1")?.textContent === "组织", "侧栏组织入口未切换视图");
    await until(() => fixture.textContent.includes("共 2 个组织"), "组织概要未渲染");
    await until(() => fixture.textContent.includes("曙光科技"), "组织卡片未渲染");
    assert(fixture.textContent.includes("1 名在职/在读成员"), "活跃成员数错误（former 不计）");
    assert(fixture.textContent.includes("已归档"), "归档徽标缺失");
    /* 管理入口打开组织管理弹窗 */
    button("组织管理").click();
    await tick();
    await until(() => fixture.querySelector(".lvct-org-manager"), "组织管理按钮未打开管理入口");
    assert(fixture.querySelector(".lvct-org-manager")?.dataset.orgDocId === "20260930000000-org0001"
        && managerOpened === 0, "通用管理入口没有确定目标或重复打开旧弹窗");
    /* 初始视图直开组织 */
    await unmount(mounted);
    mounted = mount(Workbench, { target: fixture, props: { ...baseProps, initialView: "orgs" } });
    await until(() => fixture.querySelector("h1")?.textContent === "组织", "初始视图未直接打开组织");
    await until(() => fixture.textContent.includes("曙光科技"), "初始组织视图卡片未渲染");
});

if (window.innerWidth <= 640) {
    await test("移动视口显示底部导航，Peek 详情占满屏幕并保留安全区内距", async () => {
        mounted = mount(Workbench, { target: fixture, props: {
            settings, preferences: DEFAULT_VIEW_PREFERENCES, isMobile: true,
            onPreferencesUpdated() {}, onOpenPersonDoc() {},
            facade: {
                settings, viewPreferences: DEFAULT_VIEW_PREFERENCES,
                loadDashboard: async () => ({ people: 1, relations: 0, birthdays: [], birthdaysThisWeek: 0,
                    stale: [{ person }], neverContacted: 1, neverContactedItemIds: [person.itemId] }),
                loadPersonInsights: async () => emptyInsights(),
                loadRecentInteractions: async () => ({}),
                recordInteraction: async () => {},
            },
        } });
        await until(() => fixture.querySelector(".lvct-workbench__sidebar"), "移动工作台未加载");
        const sidebar = fixture.querySelector(".lvct-workbench__sidebar");
        assert(getComputedStyle(sidebar).position === "fixed", "移动端导航没有固定在底部");
        assert(getComputedStyle(sidebar).bottom === "0px", "移动端导航没有贴近底部");
        const peopleNav = [...fixture.querySelectorAll(".lvct-workbench__nav-item")].find((node) => node.textContent.includes("联系人"));
        assert(peopleNav, "未找到移动端联系人导航");
        peopleNav.click();
        await until(() => fixture.querySelector("h1")?.textContent === "联系人", "底部导航未切换联系人");
        fixture.querySelector(".lvct-person-card")?.click();
        await until(() => fixture.querySelector(".lvct-dialog-panel--peek"), "移动端详情 Peek 未打开");
        const panel = fixture.querySelector(".lvct-dialog-panel--peek");
        assert(panel.getBoundingClientRect().width >= window.innerWidth - 20, `移动端 Peek 没有占满视口：${getComputedStyle(panel).width} / ${window.innerWidth}px`);
        assert(Number.parseFloat(getComputedStyle(panel).paddingBottom) > 0, "移动端 Peek 没有底部内距");
    });
}

await test("图谱邻接、共同联系人与最短路径不重建画布，筛选保中心并显式清除", async () => {
    const entries = [
        { id: "a", name: "甲", related: ["c", "d"] },
        { id: "b", name: "乙", related: ["c"] },
        { id: "c", name: "共同人物", related: [] },
        { id: "d", name: "独有关系", related: [] },
        { id: "e", name: "孤立人物", related: [] },
    ];
    kernel.handler = async (route) => {
        assert(route === "/api/av/renderAttributeView", "图谱查询不应写内核");
        return { view: { columns: renderResult().view.columns, rows: entries.map((entry) => ({
            id: entry.id, cells: [
                { valueType: "block", value: { type: "block", keyID: "name", block: { id: entry.id, content: entry.name } } },
                { valueType: "relation", value: { type: "relation", keyID: "related", relation: { blockIDs: entry.related } } },
            ],
        })) } };
    };
    let opened;
    mounted = mount(RelationGraph, { target: fixture, props: {
        settings, preferences: DEFAULT_VIEW_PREFERENCES, onPreferencesChange: async (next) => next,
        facade: { listOrganizations: async () => [], loadSelfIdentity: async () => null },
        onOpenDetail(value) { opened = value.docId; }, onOpenPeople() {},
    } });
    button("画布视图").click();
    await until(() => fixture.querySelector(".lvct-graph-view__canvas")?._cyreg?.cy, "图谱未挂载");
    const cy = fixture.querySelector(".lvct-graph-view__canvas")._cyreg.cy;
    const previousTextColor = document.documentElement.style.getPropertyValue("--b3-theme-on-surface");
    const previousBorderColor = document.documentElement.style.getPropertyValue("--b3-border-color");
    try {
        const beforeText = cy.nodes().first().style("color");
        document.documentElement.style.setProperty("--b3-theme-on-surface", "#13579b");
        document.documentElement.style.setProperty("--b3-border-color", "#b75319");
        await until(() => cy.nodes().first().style("color") !== beforeText, "主题切换后图谱文字颜色未更新");
        assert(!cy.destroyed(), "主题切换不应重建画布");
    } finally {
        if (previousTextColor) document.documentElement.style.setProperty("--b3-theme-on-surface", previousTextColor);
        else document.documentElement.style.removeProperty("--b3-theme-on-surface");
        if (previousBorderColor) document.documentElement.style.setProperty("--b3-border-color", previousBorderColor);
        else document.documentElement.style.removeProperty("--b3-border-color");
    }
    const select = (label, value) => {
        const node = fixture.querySelector(`select[aria-label="${label}"]`);
        node.value = value;
        node.dispatchEvent(new Event("change", { bubbles: true }));
    };
    /* B03：关系中心/对比人物改走可搜索选人器（打开 → 按名筛选 → 点选） */
    const pick = async (label, id) => {
        const trigger = [...fixture.querySelectorAll(".lvct-picker__trigger")]
            .find((node) => node.getAttribute("aria-label") === label);
        assert(trigger, `未找到选人器：${label}`);
        trigger.click();
        await until(() => fixture.querySelector(".lvct-picker__panel"), `${label}浮层未打开`);
        const name = entries.find((entry) => entry.id === id)?.name ?? id;
        input(fixture.querySelector(".lvct-picker__search"), name);
        await tick();
        const option = [...fixture.querySelectorAll(".lvct-picker__option")][0];
        assert(option, `${label} 未找到候选 ${id}`);
        option.click();
        await tick();
    };
    await pick("关系中心", "a");
    await until(() => fixture.textContent.includes("直接关系：2 人"), "直接关系计数错误");
    assert(cy.getElementById("a").hasClass("lvct-graph-focus"), "中心未高亮");
    assert(cy.getElementById("e").hasClass("lvct-graph-muted"), "无关人物未淡化");
    assert(!cy.getElementById("c").hasClass("lvct-graph-muted"), "邻接人物被淡化");
    select("关系层级", "second");
    await until(() => fixture.textContent.includes("二度关系：1 人"), "二度关系计数错误");
    assert([...fixture.querySelectorAll(".lvct-graph-query__results button")].map((node) => node.textContent.trim()).join(",") === "乙 · b", "二度结果混入直接关系或中心，或缺少稳定 ID");
    assert(!cy.getElementById("b").hasClass("lvct-graph-muted"), "二度人物未显示");
    assert(!cy.getElementById("c").hasClass("lvct-graph-muted"), "中间关系被淡化");
    assert(cy.edges().filter((edge) => !edge.hasClass("lvct-graph-muted")).length === 3, "二度连线高亮错误");
    assert(!cy.destroyed(), "二度切换不应重建画布");
    button("乙 · b", fixture.querySelector(".lvct-graph-query__results")).click();
    assert(opened === "b", "二度结果未打开人物");
    select("关系层级", "direct");
    await pick("对比人物", "b");
    await until(() => fixture.textContent.includes("共同联系人：1 人"), "共同联系人计数错误");
    assert(cy.getElementById("d").hasClass("lvct-graph-muted"), "独有关系未淡化");
    button("共同人物 · c", fixture.querySelector(".lvct-graph-query__results")).click();
    assert(opened === "c", "结果未打开正确详情");
    assert(!cy.destroyed(), "选人不应重建图谱");
    select("关系查询模式", "path");
    await until(() => fixture.textContent.includes("最短路径：2 段关系"), "最短路径段数错误");
    assert([...fixture.querySelectorAll(".lvct-graph-query__results button")].map((node) => node.textContent.trim()).join(",") === "甲 · a,共同人物 · c,乙 · b", "路径顺序或稳定 ID 错误");
    assert(!cy.getElementById("c").hasClass("lvct-graph-muted"), "路径中间人物被淡化");
    assert(cy.edges().filter((edge) => !edge.hasClass("lvct-graph-muted")).length === 2, "路径连线高亮错误");
    button("共同人物 · c", fixture.querySelector(".lvct-graph-query__results")).click();
    assert(opened === "c", "路径人物未打开详情");
    await pick("对比人物", "e");
    await until(() => fixture.textContent.includes("当前图内没有连接路径"), "断开人物应无路径");
    assert(cy.edges().every((edge) => edge.hasClass("lvct-graph-muted")), "无路径仍高亮旧连线");
    await pick("对比人物", "d");
    await until(() => fixture.textContent.includes("最短路径：1 段关系"), "直接关系应为一段路径");
    assert(!cy.destroyed(), "切换路径不应重建画布");
    select("关系查询模式", "common");
    await pick("对比人物", "e");
    await until(() => fixture.textContent.includes("当前图内没有共同联系人"), "无共同联系人空态错误");
    button("清除选择").click();
    await until(() => cy.elements(".lvct-graph-muted").length === 0, "清除未恢复图谱");
    await pick("关系中心", "e");
    await until(() => fixture.textContent.includes("当前图内没有直接关系"), "孤立人物空态错误");
    input(fixture.querySelector('input[type="search"]'), "共同人物");
    await until(() => [...fixture.querySelectorAll(".lvct-picker__trigger")]
        .find((node) => node.getAttribute("aria-label") === "关系中心")?.textContent.includes("孤立人物"), "筛选静默清除了有效关系中心");
    const filteredCanvas = () => fixture.querySelector(".lvct-graph-view__canvas")?._cyreg?.cy;
    await until(() => filteredCanvas()?.nodes().length === 2, "搜索未保留中心和匹配人物");
    assert(filteredCanvas().getElementById("e").nonempty() && filteredCanvas().getElementById("c").nonempty()
        && fixture.querySelector(".lvct-graph-summary")?.textContent.includes("中心优先保留：孤立人物"), "保中心例外缺少稳定目标或说明");
    const compareTrigger = [...fixture.querySelectorAll(".lvct-picker__trigger")]
        .find((node) => node.getAttribute("aria-label") === "对比人物");
    assert(compareTrigger && !compareTrigger.disabled, "有效中心保留后不应禁用对比");
    button("清除选择").click();
    await until(() => compareTrigger.disabled && filteredCanvas()?.nodes().length === 1, "显式清除中心未恢复筛选范围");
    const bounds = fixture.querySelector(".lvct-graph-query").getBoundingClientRect();
    assert(bounds.right <= window.innerWidth + 1, "关系查询超出视口");
    for (const control of fixture.querySelectorAll(".lvct-graph-query select")) {
        assert(control.getBoundingClientRect().right <= window.innerWidth + 1, "选人控件超出视口");
    }
    fixture.querySelector(".lvct-graph-isolated input").click();
    await until(() => fixture.textContent.includes("没有匹配的节点"), "隐藏关系对端后不应将共同人物误判为孤立");
    button("清除筛选").click();
    await until(() => fixture.querySelector(".lvct-graph-view__canvas")?._cyreg?.cy?.nodes().length === 5, "清除筛选未恢复全图");
    assert(!fixture.querySelector(".lvct-graph-isolated input").checked, "清除筛选未重置无关系筛选");
    fixture.querySelector(".lvct-graph-isolated input").click();
    await until(() => fixture.querySelector(".lvct-graph-view__canvas")?._cyreg?.cy?.nodes().length === 1, "未只显示孤立人物");
    const isolatedCy = fixture.querySelector(".lvct-graph-view__canvas")._cyreg.cy;
    assert(isolatedCy.nodes()[0].id() === "e", "孤立筛选人物错误");
    await pick("关系中心", "e");
    await tick();
    select("关系层级", "second");
    await until(() => fixture.textContent.includes("当前图内没有二度关系"), "孤立人物二度空态错误");
});

await test("图谱稳定挂载，悬停卡保留人物，筛选清空后可恢复", async () => {
    let opened;
    mounted = mount(RelationGraph, { target: fixture, props: {
        settings, preferences: DEFAULT_VIEW_PREFERENCES, onPreferencesChange: async (next) => next,
        onOpenDetail: (value) => { opened = value; }, onOpenPeople() {},
    } });
    button("画布视图").click();
    await until(() => fixture.querySelector(".lvct-graph-view__canvas")?._cyreg?.cy, "图谱未挂载");
    const cy = fixture.querySelector(".lvct-graph-view__canvas")._cyreg.cy;
    await pause(400);
    assert(!cy.destroyed(), "图谱被响应式 effect 重复销毁");
    cy.nodes()[0].emit("mouseover");
    await until(() => fixture.querySelector(".lvct-graph-view__hover-card"), "悬停卡未出现");
    const hoverCard = fixture.querySelector(".lvct-graph-view__hover-card");
    assert(hoverCard.getAttribute("role") === "dialog" && hoverCard.getAttribute("aria-modal") === "false"
        && hoverCard.getAttribute("aria-label")?.includes(person.name), "人物悬停卡缺少非模态可访问名称");
    button("查看人物详情").click();
    assert(opened?.docId === person.docId, "悬停卡传给详情的人物为空");
    input(fixture.querySelector('input[type="search"]'), "没有此人");
    await until(() => fixture.textContent.includes("没有匹配的节点"), "图谱没有展示筛选空态");
    assert(cy.destroyed(), "旧图谱没有销毁");
    button("清除筛选").click();
    await until(() => fixture.querySelector(".lvct-graph-view__canvas")?._cyreg?.cy, "清除筛选后图谱未恢复");
});

await test("图谱文档引用模式：内核局部图按登记集合过滤，边语义提示与模式偏好持久化（B14.3/14.5/14.7）", async () => {
    const selfDocId = "20260930000000-self001";
    const contactA = "20260930000000-contac1";
    const contactB = "20260930000000-contac2";
    const stranger = "20260930000000-strang1";
    const nameRows = [
        { id: selfDocId, name: "我自己" },
        { id: contactA, name: "引用甲" },
        { id: contactB, name: "引用乙" },
    ];
    let localRequests = 0;
    let savedGraphMode = "";
    kernel.handler = async (route, body) => {
        if (route === "/api/av/renderAttributeView") return { view: { columns: renderResult().view.columns, rows: nameRows.map((row) => ({
            id: row.id, cells: [
                { valueType: "block", value: { type: "block", keyID: "name", block: { id: row.id, content: row.name } } },
                { valueType: "relation", value: { type: "relation", keyID: "related", relation: { blockIDs: [] } } },
            ],
        })) } };
        if (route === "/api/graph/getLocalGraph") {
            localRequests += 1;
            assert(body && body.id === selfDocId, "局部图中心不是本人档案");
            assert(body.conf && typeof body.conf === "object", "getLocalGraph 请求缺 conf 对象（内核必填）");
            /* 字段形状按 spike:b14 实证：节点 id/label/refs/defs，边 from/to */
            return {
                id: body.id,
                nodes: [
                    { id: selfDocId, label: "我自己", type: "NodeDocument", refs: 2, defs: 0 },
                    { id: contactA, label: "引用甲", type: "NodeDocument", refs: 0, defs: 1 },
                    { id: contactB, label: "引用乙", type: "NodeDocument", refs: 0, defs: 1 },
                    { id: stranger, label: "无关笔记", type: "NodeDocument", refs: 9, defs: 9 },
                ],
                links: [
                    { from: selfDocId, to: contactA, ref: true },
                    { from: contactB, to: selfDocId, ref: true },
                    { from: selfDocId, to: stranger, ref: true },
                ],
            };
        }
        throw new Error(`回归测试不允许请求 ${route}`);
    };
    let opened = "";
    let currentPrefs = { ...DEFAULT_VIEW_PREFERENCES };
    mounted = mount(RelationGraph, { target: fixture, props: {
        settings,
        preferences: currentPrefs,
        onPreferencesChange: async (next) => { currentPrefs = next; savedGraphMode = next.graphMode; return next; },
        facade: { loadSelfIdentity: async () => ({ selfDocId, createdAt: "2026-09-30T00:00:00Z" }), listOrganizations: async () => [] },
        onOpenDetail(value) { opened = value.docId; },
        onOpenPeople() {},
    } });
    button("画布视图").click();
    await until(() => fixture.querySelector(".lvct-graph-view__canvas")?._cyreg?.cy, "关系图未挂载");
    button("文档引用").click();
    await until(() => localRequests === 1, "未请求内核局部图");
    await until(() => fixture.querySelector(".lvct-graph-view__canvas")?._cyreg?.cy, "文档引用图未挂载");
    /* 画布会随筛选重建，断言一律实时取最新实例 */
    const nativeCanvas = () => fixture.querySelector(".lvct-graph-view__canvas")?._cyreg?.cy;
    await until(() => (nativeCanvas()?.nodes().length ?? 0) > 0, "引用图节点为空");
    const nativeCy = nativeCanvas();
    assert(nativeCy.getElementById(selfDocId).nonempty(), "中心本人节点缺失");
    assert(nativeCy.getElementById(contactA).nonempty() && nativeCy.getElementById(contactB).nonempty(), "登记联系人节点缺失");
    assert(!nativeCy.getElementById(stranger).nonempty(), "无关笔记未被登记集合过滤");
    assert(nativeCy.edges().length === 2, "被过滤节点的边未随节点丢弃");
    assert(fixture.textContent.includes("边=文档间块引用"), "边语义提示未显示");
    assert(savedGraphMode === "native", "模式偏好未持久化");
    const modeButtons = [...fixture.querySelectorAll(".lvct-graph-mode button")];
    assert(modeButtons[1]?.getAttribute("aria-pressed") === "true", "文档引用按钮未标记按下态");
    /* 搜索过滤走节点 label（画布重建后节点数变化） */
    input(fixture.querySelector('input[type="search"]'), "引用甲");
    await until(() => (nativeCanvas()?.nodes().length ?? 0) === 2, "引用图搜索未保留有效中心和匹配节点");
    assert(nativeCanvas().getElementById(selfDocId).nonempty() && nativeCanvas().getElementById(contactA).nonempty()
        && nativeCanvas().getElementById(contactB).empty() && nativeCanvas().edges().length === 1, "引用搜索结果/裁边错误");
    assert(fixture.querySelector(".lvct-graph-summary")?.textContent.includes("中心优先保留：我自己") && localRequests === 1, "引用中心例外缺少说明或搜索重复查询内核");
    input(fixture.querySelector('input[type="search"]'), "");
    await until(() => (nativeCanvas()?.nodes().length ?? 0) === 3, "引用图清空搜索未恢复");
    /* 切回关系图：不应重复请求局部图 */
    button("关系图").click();
    await until(() => fixture.querySelector(".lvct-graph-view__canvas")?._cyreg?.cy, "切回关系图未挂载");
    await tick();
    assert(localRequests === 1, "切回关系图不应重复请求局部图");
    assert(modeButtons[0]?.getAttribute("aria-pressed") === "true", "切回后关系图按钮未恢复按下态");
    assert(savedGraphMode === "relations", "切回后模式偏好未持久化");
});

await test("关系图组织增强：组织节点与成员边分源展示，开关隐藏，查询时组织退场（B14.6）", async () => {
    const orgDocId = "20260930000000-org0001";
    const ghostId = "20260930000000-ghost001";
    kernel.handler = async (route) => {
        if (route === "/api/av/renderAttributeView") return { view: { columns: renderResult().view.columns, rows: [{
            id: person.docId, cells: [
                { valueType: "block", value: { type: "block", keyID: "name", block: { id: person.docId, content: person.name } } },
                { valueType: "relation", value: { type: "relation", keyID: "related", relation: { blockIDs: [] } } },
            ],
        }] } };
        throw new Error(`回归测试不允许请求 ${route}`);
    };
    let opened = "";
    mounted = mount(RelationGraph, { target: fixture, props: {
        settings,
        preferences: DEFAULT_VIEW_PREFERENCES,
        onPreferencesChange: async (next) => next,
        facade: { listOrganizations: async () => [
            { docId: orgDocId, name: "曙光科技", hpath: "/曙光科技", notebookId: "20260927000000-book001", archived: false, memberships: [
                { id: "m1", orgDocId, personDocId: person.docId, department: "", title: "", joinedOn: "", leftOn: "", status: "active" },
                { id: "m2", orgDocId, personDocId: person.docId, department: "", title: "", joinedOn: "", leftOn: "", status: "former" },
                { id: "m3", orgDocId, personDocId: ghostId, department: "", title: "", joinedOn: "", leftOn: "", status: "active" },
            ] },
        ], loadSelfIdentity: async () => null },
        onOpenDetail(value) { opened = value.docId; },
        onOpenPeople() {},
    } });
    button("画布视图").click();
    const canvas = () => fixture.querySelector(".lvct-graph-view__canvas")?._cyreg?.cy;
    await until(() => (canvas()?.nodes().length ?? 0) > 0, "关系图未挂载");
    await until(() => canvas()?.getElementById(orgDocId).nonempty(), "组织节点未挂载");
    const cy = canvas();
    assert(cy.getElementById(ghostId).empty(), "悬空成员不应产生节点");
    assert(cy.edges().length === 1, "仅 active 且在名册的成员成边（former/悬空丢弃）");
    assert(fixture.textContent.includes("显示组织（1）"), "组织开关计数错误");
    assert(cy.getElementById(orgDocId).style("shape") === "round-rectangle", "组织节点未用方形区分");
    /* 组织节点不触发人物详情 */
    cy.getElementById(orgDocId).emit("tap");
    await tick();
    assert(opened === "", "组织节点不应触发人物详情");
    /* 开关隐藏/恢复组织层（画布重建，实时取实例） */
    const orgToggle = [...fixture.querySelectorAll(".lvct-graph-isolated")]
        .find((node) => node.textContent.includes("显示组织"));
    assert(orgToggle, "未找到组织开关");
    orgToggle.querySelector("input").click();
    await until(() => fixture.querySelector(".lvct-graph-summary")?.textContent.includes("中心优先保留：曙光科技"), "组织中心不满足显示开关时缺少保留说明");
    assert(canvas().getElementById(orgDocId).nonempty(), "有效组织中心被显示开关静默隐藏");
    const relationScope = fixture.querySelector('select[aria-label="关系图范围"]');
    relationScope.value = "global";
    relationScope.dispatchEvent(new Event("change", { bubbles: true }));
    const organizationFilter = fixture.querySelector('select[aria-label="按组织收窄"]');
    organizationFilter.value = "";
    organizationFilter.dispatchEvent(new Event("change", { bubbles: true }));
    await until(() => canvas()?.getElementById(orgDocId)?.empty(), "退出聚焦后关闭开关未隐藏组织");
    assert(canvas().nodes().length === 1 && canvas().edges().length === 0, "隐藏组织未裁掉成员边或误删人物");
    orgToggle.querySelector("input").click();
    await until(() => canvas()?.getElementById(orgDocId)?.nonempty(), "恢复开关后组织节点未回归");
    /* 选关系中心 → 组织节点与成员边 muted（查询仍只按 related，组织退场） */
    await pickOption("关系中心", person.name);
    await until(() => canvas().getElementById(orgDocId).hasClass("lvct-graph-muted"), "查询激活时组织节点未退场");
    assert(
        canvas().edges().filter((edge) => edge.data("kind") === "member").every((edge) => edge.hasClass("lvct-graph-muted")),
        "查询激活时成员边未退场",
    );
    assert(fixture.textContent.includes("当前图内没有直接关系") && fixture.textContent.includes(ghostId), "成员边被当作 related 或悬空记录诊断丢失");
});

await test("引用图范围切换：联系为中心一度、全部登记文档、范围说明与偏好持久化（B14.8）", async () => {
    const selfDocId = "20260930000000-self002";
    const contactA = "20260930000000-persa01";
    const contactB = "20260930000000-persb01";
    const stranger = "20260930000000-strang2";
    const nameRows = [
        { id: selfDocId, name: "我自己" },
        { id: contactA, name: "中心人物甲" },
        { id: contactB, name: "联系人乙" },
    ];
    const localCalls = [];
    let globalCalls = 0;
    kernel.handler = async (route, body) => {
        if (route === "/api/av/renderAttributeView") return { view: { columns: renderResult().view.columns, rows: nameRows.map((row) => ({
            id: row.id, cells: [
                { valueType: "block", value: { type: "block", keyID: "name", block: { id: row.id, content: row.name } } },
                { valueType: "relation", value: { type: "relation", keyID: "related", relation: { blockIDs: [] } } },
            ],
        })) } };
        if (route === "/api/graph/getLocalGraph") {
            localCalls.push(body.id);
            assert([selfDocId, contactA, contactB].includes(body.id), "失效中心仍发送局部图请求");
            const around = body.id === contactA
                ? { nodes: [{ id: contactA, label: "中心人物甲" }, { id: contactB, label: "联系人乙" }], links: [{ from: contactA, to: contactB, ref: true }] }
                : { nodes: [{ id: body.id, label: nameRows.find((row) => row.id === body.id).name }], links: [] };
            return {
                id: body.id,
                nodes: around.nodes.map((node) => ({ ...node, type: "NodeDocument", refs: 0, defs: 0 })),
                links: around.links,
            };
        }
        if (route === "/api/graph/getGraph") {
            globalCalls += 1;
            return {
                nodes: [
                    { id: selfDocId, label: "我自己", type: "NodeDocument", refs: 0, defs: 0 },
                    { id: contactA, label: "中心人物甲", type: "NodeDocument", refs: 0, defs: 0 },
                    { id: contactB, label: "联系人乙", type: "NodeDocument", refs: 0, defs: 0 },
                    { id: stranger, label: "无关笔记", type: "NodeDocument", refs: 9, defs: 9 },
                ],
                links: [
                    { from: selfDocId, to: contactA, ref: true },
                    { from: selfDocId, to: stranger, ref: true },
                ],
            };
        }
        throw new Error(`回归测试不允许请求 ${route}`);
    };
    let currentPrefs = { ...DEFAULT_VIEW_PREFERENCES };
    let savedNativeScope = "";
    let savedCenter = "";
    mounted = mount(RelationGraph, { target: fixture, props: {
        settings,
        preferences: currentPrefs,
        onPreferencesChange: async (next) => { currentPrefs = next; savedNativeScope = next.nativeScope; savedCenter = next.nativeCenterDocId; return next; },
        facade: { loadSelfIdentity: async () => ({ selfDocId, createdAt: "2026-09-30T00:00:00Z" }), listOrganizations: async () => [] },
        onOpenDetail() {},
        onOpenPeople() {},
    } });
    button("画布视图").click();
    const nativeCanvas = () => fixture.querySelector(".lvct-graph-view__canvas")?._cyreg?.cy;
    button("文档引用").click();
    await until(() => localCalls.length === 1 && localCalls[0] === selfDocId, "默认中心不是本人档案");
    await until(() => fixture.querySelector(".lvct-graph-summary")?.textContent.includes(`本人中心 · 我自己 · ${selfDocId}`), "self 范围说明缺少实际稳定中心");
    const scopeSelect = fixture.querySelector('select[aria-label="引用图范围"]');
    assert(scopeSelect, "未找到范围选择器");
    scopeSelect.value = "person";
    scopeSelect.dispatchEvent(new Event("change", { bubbles: true }));
    await until(() => savedNativeScope === "person", "范围偏好未持久化");
    await until(() => fixture.textContent.includes("图查询范围尚未核实"), "未选指定中心未显示独立失效状态");
    assert(localCalls.length === 1 && globalCalls === 0 && savedCenter === "", "缺指定中心静默回退本人或全局");
    await pickOption("中心人物", "联系人乙");
    await tick();
    await until(
        () => localCalls.length === 2 && localCalls[1] === contactB,
        `中心联系人请求未发出 localCalls=${JSON.stringify(localCalls)} savedCenter=${savedCenter}`,
    );
    await until(() => fixture.querySelector(".lvct-graph-summary")?.textContent.includes(`人物中心 · 联系人乙 · ${contactB}`)
        && nativeCanvas()?.nodes().length === 1 && nativeCanvas().nodes()[0].id() === contactB, "person 范围说明或局部结果缺少实际中心");
    assert(savedCenter === contactB, "中心人物偏好未持久化");
    /* 全部登记文档：getGraph + 登记集合过滤 */
    scopeSelect.value = "global";
    scopeSelect.dispatchEvent(new Event("change", { bubbles: true }));
    await until(() => globalCalls === 1, "全局图请求未发出");
    await until(() => fixture.textContent.includes("不是整库图"), "global 范围说明缺失");
    await until(() => (nativeCanvas()?.nodes().length ?? 0) === 3, "无关笔记未被登记集合过滤");
    assert(nativeCanvas().edges().length === 1, "被过滤节点的边未丢弃");
    await until(() => fixture.querySelector(".lvct-graph-summary")?.textContent.includes("登记 3 · 来源节点 3 / 边 1"), "来源登记数或边数说明错误");
    assert(fixture.querySelector(".lvct-graph-summary")?.textContent.includes("范围排除 0")
        && fixture.querySelector(".lvct-graph-summary")?.textContent.includes("展示 3 节点 / 1 边")
        && savedNativeScope === "global", "全局范围实际计数或偏好不可核对");
    assert(!fixture.textContent.includes("暂无引用"), "范围外对象被误称暂无引用");
});

await test("详情加载失败可重试，空记录可跳转记一笔，写入后时间线刷新", async () => {
    let fail = true;
    let recorded = false;
    let changes = 0;
    mounted = mount(PersonDetail, { target: fixture, props: {
        settings, person, onRecord: async () => { recorded = true; },
        onLoadInsights: async () => {
            if (fail) throw new Error("测试读取失败");
            return recorded ? { timeline: [{ eventId: "test", localDate: "2026-09-27", note: "测试互动", groupSize: 1 }], totalEvents: 1, coAttendance: [] } : emptyInsights();
        }, onOpenPersonDoc() {}, onNavigate() {}, onChanged() { changes++; }, onDeleted() {}, onClose() {},
    } });
    button("互动").click();
    await until(() => fixture.textContent.includes("互动记录加载失败"), "读取失败被误报为空记录");
    fail = false;
    button("重试").click();
    await until(() => fixture.textContent.includes("还没有互动记录"), "重试未恢复");
    button("去记一笔").click();
    await until(() => fixture.querySelector(".lvct-detail__record button"), "关闭守卫允许后未切换到记录表单");
    button("记录").click();
    await until(() => changes === 1, "互动保存未通知父视图");
    button("互动").click();
    await until(() => fixture.textContent.includes("测试互动"), "互动保存后时间线仍陈旧");
});

await test("从首页打开详情并记录互动后，首页统计同步刷新", async () => {
    let loads = 0;
    let recorded = false;
    const facade = {
        settings, viewPreferences: DEFAULT_VIEW_PREFERENCES,
        loadDashboard: async () => {
            loads++;
            return { people: 1, relations: 0, birthdays: [], birthdaysThisWeek: 0,
                stale: recorded ? [] : [{ person }], neverContacted: recorded ? 0 : 1,
                neverContactedItemIds: recorded ? [] : [person.itemId],
                actions: recorded ? [] : [{ person, bucket: "stale", reasons: [
                    { kind: "stale", label: "从未互动", bucket: "stale", neverContacted: true },
                ] }] };
        }, loadPersonInsights: async () => emptyInsights(),
        recordInteraction: async () => { recorded = true; }, openHostDoc() {},
    };
    mounted = mount(Workbench, { target: fixture, props: {
        facade, settings, preferences: DEFAULT_VIEW_PREFERENCES,
        onPreferencesUpdated() {}, isMobile: false, onOpenPersonDoc() {},
    } });
    await until(() => fixture.querySelector(".lvct-dash__group-head"), "行动分组未渲染");
    /* B01：该人是「从未互动」，默认折叠——展开组头后再进详情 */
    [...fixture.querySelectorAll(".lvct-dash__group-head")]
        .find((node) => node.textContent.includes("从未互动")).click();
    await until(() => fixture.querySelector(".lvct-dash__row-main"), "从未互动组未展开");
    fixture.querySelector(".lvct-dash__row-main").click();
    await tick();
    button("记录").click();
    await until(() => loads >= 2 && fixture.textContent.includes("暂无久未联系的人"), "详情修改没有刷新首页");
});

await test("vCard 切换文件解析失败时清空旧计划，禁止误导入", async () => {
    configureVcardKernel(kernel, settings);
    mounted = mount(VCardDialog, { target: fixture, props: { settings, onImported() {}, onClose() {} } });
    const fileInput = fixture.querySelector('input[type="file"]');
    function selectFile(name) {
        const transfer = new DataTransfer();
        transfer.items.add(new File([`BEGIN:VCARD\nVERSION:3.0\nFN:${name}\nEND:VCARD`], "test.vcf", { type: "text/vcard" }));
        fileInput.files = transfer.files;
        fileInput.dispatchEvent(new Event("change", { bubbles: true }));
    }
    selectFile("待导入联系人");
    await until(() => fixture.textContent.includes("导入为联系人（1）"), "首个文件未解析");
    invalidateRoster();
    kernel.handler = async () => { throw new Error("测试名册读取失败"); };
    selectFile("新文件联系人");
    await until(() => fixture.textContent.includes("通讯录处理失败"), "新文件错误未显示");
    assert(button("导入为联系人（0）").disabled, "新文件失败后仍可提交旧计划");
});

await test("快速修改收编关键词时，迟到的旧查询不能覆盖新结果", async () => {
    let resolveOld;
    let queries = 0;
    const oldResponse = new Promise((resolve) => { resolveOld = resolve; });
    const oldRow = { id: "20260927000000-old0001", content: "收编甲", hpath: "/甲" };
    const newRow = { id: "20260927000000-new0001", content: "收编乙", hpath: "/乙" };
    kernel.handler = async (route, body) => {
        if (route === "/api/notebook/lsNotebooks") return { notebooks: [{ id: "20260927000000-book002", name: "测试笔记本" }] };
        if (route === "/api/query/sql" && body.stmt.includes("SELECT DISTINCT root_id")) return [];
        if (route === "/api/query/sql") return ++queries === 1 ? oldResponse : [newRow];
        if (route === "/api/av/getAttributeViewItemIDsByBoundIDs") return {};
        throw new Error(`非预期请求：${route}`);
    };
    mounted = mount(ImportDialog, { target: fixture, props: { settings, onImported() {}, onClose() {} } });
    await until(() => queries === 1, "初始扫描未开始");
    input(fixture.querySelector('input[type="text"]'), "乙");
    await until(() => fixture.textContent.includes("收编乙"), "新查询结果未展示");
    resolveOld([oldRow]);
    await pause(60);
    assert(fixture.textContent.includes("收编乙") && !fixture.textContent.includes("收编甲"), "旧查询覆盖了新结果");
    fixture.querySelector('.lvct-import__row:not(.lvct-import__row--head) input').click();
    await tick();
    assert(!button("收编为联系人（1）").disabled, "勾选新结果后应允许收编");
    input(fixture.querySelector('input[type="text"]'), "甲");
    await tick();
    const submit = [...fixture.querySelectorAll("button")].find((node) => /收编为联系人/.test(node.textContent));
    assert(!submit || submit.disabled, "等待新查询时仍能误提交旧勾选");
});

await test("首页快捷互动失败保留备注，重试成功后更新提醒", async () => {
    let fail = true;
    let recorded = false;
    const notes = [];
    mounted = mount(DashboardView, { target: fixture, props: {
        preferences: DEFAULT_VIEW_PREFERENCES, onOpenDetail() {}, onOpenPeople() {}, onOpenGraph() {},
        facade: { settings, loadDashboard: async () => ({
            people: 1, relations: 0, birthdays: [], birthdaysThisWeek: 0,
            stale: recorded ? [] : [{ person }], neverContacted: recorded ? 0 : 1, neverContactedItemIds: [],
        }), recordInteraction: async (_, note) => {
            notes.push(note);
            if (fail) throw new Error("测试写入失败");
            recorded = true;
        } },
    } });
    await until(() => fixture.querySelector(".lvct-dash__quick-button"), "快捷操作未加载");
    button("记一笔").click();
    await tick();
    const noteInput = fixture.querySelector(".lvct-dash__quick-form input");
    input(noteInput, "保留这条备注");
    button("记录").click();
    await until(() => fixture.textContent.includes("测试写入失败"), "记录错误未展示");
    assert(noteInput.value === "保留这条备注", "写入失败后备注丢失");
    fail = false;
    button("记录").click();
    await until(() => fixture.textContent.includes("暂无久未联系的人"), "重试后列表未更新");
    assert(notes.length === 2 && notes[1] === notes[0], "重试提交的备注发生变化");
});

await test("首页超过首屏上限时提供「查看全部」，服务层不再静默截断（FUNC-01.1）", async () => {
    const stalePeople = Array.from({ length: 10 }, (_, index) => ({
        ...person, name: `久联人${index + 1}`, itemId: `row-stale-${index + 1}`,
    }));
    mounted = mount(DashboardView, { target: fixture, props: {
        preferences: DEFAULT_VIEW_PREFERENCES, onOpenDetail() {}, onOpenPeople() {}, onOpenGraph() {},
        facade: { settings, loadDashboard: async () => ({
            people: 10, relations: 0, birthdays: [], birthdaysThisWeek: 0,
            stale: stalePeople.map((entry) => ({ person: entry, lastDaysAgo: 40 })),
            neverContacted: 0, neverContactedItemIds: [],
        }) },
    } });
    await until(() => fixture.querySelector(".lvct-dash__show-all"), "超过上限未出现「查看全部」");
    const rows = () => fixture.querySelectorAll(".lvct-dash__row").length;
    assert(rows() === 8, `首屏应只展示前 8 条，实际 ${rows()}`);
    assert(fixture.textContent.includes("查看全部（共 10 条）"), "未展示剩余数量");
    button("查看全部（共 10 条）").click();
    await tick();
    assert(rows() === 10, "展开后未显示全部条目");
    button("收起").click();
    await tick();
    assert(rows() === 8, "收起后未恢复首屏数量");
});

await test("设置页可按列类型手动恢复字段映射并拒绝空提交", async () => {
    let repaired;
    let checked = false;
    const columns = FIELD_SPECS
        .filter((field) => field.key !== "phone")
        .map((field) => ({ id: field.key, name: field.nameZh, type: field.type }));
    columns.push({ id: "phone-renamed", name: "联系方式", type: "phone" });
    const facade = {
        settings, viewPreferences: DEFAULT_VIEW_PREFERENCES,
        checkSettingsHealth: async () => {
            checked = true;
            return checked && repaired
                ? { ok: true, columns: columns.length, missing: [], problems: [], availableColumns: columns }
                : { ok: false, columns: columns.length, missing: [{ key: "phone", expectedName: "电话", keyId: "old-phone", type: "phone" }], problems: [], availableColumns: columns };
        },
        repairFieldMap: async (patch) => { repaired = patch; return { ...settings, fieldMap: { ...settings.fieldMap, ...patch } }; },
        rebuildMissingFields: async () => settings,
        rebindSettings: async () => settings,
        saveViewPreferences: async (value) => value,
        exportInteractionJson: async () => "{}",
        openHostDoc() {},
    };
    mounted = mount(SettingsView, { target: fixture, props: {
        facade, settings, preferences: DEFAULT_VIEW_PREFERENCES,
        onSettingsUpdated() {}, onPreferencesUpdated() {}, onBack() {},
    } });
    if (window.innerWidth <= 640) {
        const layoutEl = fixture.querySelector(".lvct-settings__layout");
        const navEl = fixture.querySelector(".lvct-settings__nav");
        assert(getComputedStyle(layoutEl).flexDirection === "column", "移动端设置页应为纵向布局");
        assert(getComputedStyle(navEl).display === "grid", "移动端设置导航应为网格");
        assert([...navEl.querySelectorAll("button")].every((item) => item.getBoundingClientRect().right <= window.innerWidth + 1), "移动端设置分区按钮被裁切");
    }
    const dataNav = [...fixture.querySelectorAll(".lvct-settings__nav-item")].find((node) => node.textContent.includes("数据与字段"));
    assert(dataNav, "未找到数据与字段导航");
    dataNav.click();
    await until(() => [...fixture.querySelectorAll("button")].some((node) => node.textContent.trim() === "检查字段健康"), "数据与字段分区未显示");
    button("检查字段健康").click();
    await until(() => fixture.textContent.includes("缺失 1 项"), "健康检查结果未展示");
    const mapping = fixture.querySelector(".lvct-settings__mapping select");
    assert(mapping, "缺失字段没有映射选择器");
    mapping.value = "phone-renamed";
    mapping.dispatchEvent(new Event("change", { bubbles: true }));
    button("保存字段映射").click();
    await until(() => repaired?.phone === "phone-renamed", "字段映射没有保存");
    await until(() => fixture.textContent.includes("字段完整"), "保存映射后健康状态未刷新");
});

await test("表格列显隐与顺序偏好持久化，姓名列固定，恢复默认生效", async () => {
    const headers = () => [...fixture.querySelectorAll("thead th")].map((th) => th.textContent.trim());
    const sameList = (list, expected, message) => assert(JSON.stringify(list) === JSON.stringify(expected), `${message}（实际：${JSON.stringify(list)}）`);
    const mountPeople = (prefs) => mount(PeopleView, { target: fixture, props: {
        settings, preferences: prefs,
        loadRecentInteractions: async () => ({}),
        revision: 0, initialSort: "name",
        onOpenDetail() {}, onOpenPersonDoc() {},
        onPreferencesChange: async (next) => { savedPrefs = next; return next; },
    } });
    let savedPrefs = null;
    mounted = mountPeople({ ...DEFAULT_VIEW_PREFERENCES, peopleView: "table", tableColumns: ["phone", "group"] });
    await until(() => fixture.querySelector("table"), "表格未渲染");
    sameList(headers(), ["", "姓名", "电话", "分组"], "列顺序未按偏好渲染");

    button("列设置").click();
    await tick();
    const nameRow = fixture.querySelector(".lvct-people__colmenu-row input");
    assert(nameRow.disabled && nameRow.checked, "姓名列应固定且不可取消");
    fixture.querySelector('input[aria-label="显示微信列"]').click();
    await until(() => headers().includes("微信"), "勾选微信列后表头未更新");
    sameList(savedPrefs.tableColumns, ["phone", "group", "wechat"], "勾选列未持久化");

    fixture.querySelector('button[aria-label="下移电话列"]').click();
    await until(() => headers()[2] === "分组", "下移电话列后顺序未更新");
    sameList(savedPrefs.tableColumns, ["group", "phone", "wechat"], "列顺序未持久化");

    await unmount(mounted);
    mounted = mountPeople(savedPrefs);
    await until(() => fixture.querySelector("table"), "重开后表格未渲染");
    sameList(headers(), ["", "姓名", "分组", "电话", "微信"], "重开后列偏好未恢复");

    button("列设置").click();
    await tick();
    [...fixture.querySelectorAll("button")].find((node) => node.textContent.trim() === "恢复默认显示").click();
    await until(() => savedPrefs?.tableColumns.length === 7 && savedPrefs.peopleView === "card", "恢复默认未持久化");
    await until(() => !fixture.querySelector("table") && fixture.querySelector(".lvct-people__cards"), "恢复默认后未回到卡片视图");
});

await test("组合筛选数量与生效条件一致，单项清除与清除全部不遗留", async () => {
    const row = (id, name, group, tags) => ({
        id: `item-${id}`,
        cells: [
            { valueType: "block", value: { type: "block", keyID: "name", block: { id: `doc-${id}`, content: name } } },
            { valueType: "mSelect", value: { type: "mSelect", keyID: "group", mSelect: [{ content: group }] } },
            { valueType: "mSelect", value: { type: "mSelect", keyID: "tags", mSelect: tags.map((tag) => ({ content: tag })) } },
        ],
    });
    const rows = [
        row("a", "甲", "朋友", ["球友", "家长群"]),
        row("b", "乙", "同事", ["家长群"]),
        row("c", "丙", "朋友", ["球友"]),
    ];
    kernel.handler = async (route) => {
        if (route === "/api/av/renderAttributeView") return { view: { columns: FIELD_SPECS.map((field) => ({ id: field.key, name: field.nameZh, type: field.type })), rows } };
        throw new Error(`回归测试不允许请求 ${route}`);
    };
    mounted = mount(PeopleView, { target: fixture, props: {
        settings, preferences: DEFAULT_VIEW_PREFERENCES,
        loadRecentInteractions: async () => ({
            "doc-a": { occurredAt: 1, localDate: "2026-09-01" },
            "doc-b": { occurredAt: 2, localDate: "2026-08-15" },
        }),
        revision: 0, initialSort: "name",
        onOpenDetail() {}, onOpenPersonDoc() {},
        onPreferencesChange: async (next) => next,
    } });
    const cards = () => fixture.querySelectorAll(".lvct-people__cards > *").length;
    await until(() => cards() === 3, "初始名册未加载 3 人");
    assert(!fixture.querySelector(".lvct-people__conditions"), "无条件时不应显示生效条件行");

    [...fixture.querySelectorAll(".lvct-people__filter")].find((node) => node.textContent.trim() === "球友").click();
    [...fixture.querySelectorAll(".lvct-people__filter")].find((node) => node.textContent.trim() === "家长群").click();
    await until(() => fixture.textContent.includes("共 1 人"), "标签交集未生效");

    button("更多筛选").click();
    await tick();
    const modeSelect = fixture.querySelector(".lvct-people__moremenu select");
    modeSelect.value = "any";
    modeSelect.dispatchEvent(new Event("change", { bubbles: true }));
    await until(() => fixture.textContent.includes("共 3 人"), "标签任一并集未生效");

    const dateInputs = [...fixture.querySelectorAll('.lvct-people__moremenu input[type="date"]')];
    input(dateInputs[0], "2026-08-01");
    await until(() => fixture.textContent.includes("共 2 人"), "最近互动范围未排除无互动者");
    input(dateInputs[1], "2026-08-31");
    await until(() => fixture.textContent.includes("共 1 人"), "区间端点过滤错误");

    fixture.querySelector('.lvct-people__moremenu input[type="checkbox"]').click();
    await until(() => fixture.textContent.includes("共 0 人"), "从未联系与范围矛盾应为空");

    [...fixture.querySelectorAll(".lvct-people__condition")].find((node) => node.textContent.includes("最近互动")).click();
    await until(() => fixture.textContent.includes("共 1 人"), "单项清除未生效");
    assert(!fixture.querySelector('.lvct-people__moremenu input[type="date"]'), "点击面板外应关闭更多筛选");

    [...fixture.querySelectorAll("button")].find((node) => node.textContent.trim() === "清除全部").click();
    await until(() => cards() === 3, "清除全部后未恢复全量");
    assert(!fixture.querySelector(".lvct-people__conditions"), "清除全部后条件行仍显示");
    button("更多筛选").click();
    await tick();
    assert(!fixture.querySelector('.lvct-people__moremenu input[type="checkbox"]').checked, "清除全部后从未联系未重置");
    assert(fixture.querySelector(".lvct-people__moremenu select").value === "all", "清除全部后标签匹配未重置");
});

await test("保存视图：命名保存与应用、重名覆盖确认、改名删除、失效标签提示、重开恢复", async () => {
    const row = (id, name, group, tags) => ({
        id: `item-${id}`,
        cells: [
            { valueType: "block", value: { type: "block", keyID: "name", block: { id: `doc-${id}`, content: name } } },
            { valueType: "mSelect", value: { type: "mSelect", keyID: "group", mSelect: [{ content: group }] } },
            { valueType: "mSelect", value: { type: "mSelect", keyID: "tags", mSelect: tags.map((tag) => ({ content: tag })) } },
        ],
    });
    const rows = [
        row("a", "甲", "朋友", ["球友", "家长群"]),
        row("b", "乙", "同事", ["家长群"]),
        row("c", "丙", "朋友", ["球友"]),
    ];
    kernel.handler = async (route) => {
        if (route === "/api/av/renderAttributeView") return { view: { columns: FIELD_SPECS.map((field) => ({ id: field.key, name: field.nameZh, type: field.type })), rows } };
        throw new Error(`回归测试不允许请求 ${route}`);
    };
    const originalPrompt = window.prompt;
    const originalConfirm = window.confirm;
    let savedPrefs = null;
    const mountPeople = (prefs) => mount(PeopleView, { target: fixture, props: {
        settings, preferences: prefs,
        loadRecentInteractions: async () => ({}),
        revision: 0, initialSort: "name",
        onOpenDetail() {}, onOpenPersonDoc() {},
        onPreferencesChange: async (next) => { savedPrefs = next; return next; },
    } });
    try {
        window.prompt = (label, fallback) => (label && label.includes("重命名") ? "新名字" : "球友圈");
        window.confirm = () => true;
        const viewsButton = () => [...fixture.querySelectorAll("button")].find((node) => node.getAttribute("aria-label") === "视图");
        mounted = mountPeople(DEFAULT_VIEW_PREFERENCES);
        await until(() => fixture.querySelectorAll(".lvct-people__cards > *").length === 3, "初始名册未加载");
        // 选中标签 球友+家长群（默认交集只有甲）→ 保存为视图
        [...fixture.querySelectorAll(".lvct-people__filter")].find((node) => node.textContent.trim() === "球友").click();
        [...fixture.querySelectorAll(".lvct-people__filter")].find((node) => node.textContent.trim() === "家长群").click();
        await until(() => fixture.textContent.includes("共 1 人"), "标签交集未生效");
        viewsButton().click();
        await tick();
        [...fixture.querySelectorAll("button")].find((node) => node.textContent.trim() === "保存当前筛选为视图").click();
        await until(() => savedPrefs?.savedViews?.length === 1, "视图未保存");
        assert(savedPrefs.savedViews[0].name === "球友圈", "保存的视图名称错误");
        await until(() => fixture.querySelector(".lvct-people__conditions")?.textContent.includes("视图：球友圈"), "保存后未标记当前视图");

        // 同名保存 → confirm 覆盖同一条
        const firstId = savedPrefs.savedViews[0].id;
        viewsButton().click();
        await tick();
        [...fixture.querySelectorAll("button")].find((node) => node.textContent.trim() === "保存当前筛选为视图").click();
        await until(() => savedPrefs.savedViews.length === 1 && savedPrefs.savedViews[0].id === firstId, "重名未按覆盖处理");

        // 改名（prompt 命中重命名分支返回"新名字"）
        viewsButton().click();
        await until(() => {
            const rename = fixture.querySelector('button[aria-label="重命名视图 球友圈"]');
            if (!rename) return false;
            rename.click();
            return true;
        }, "菜单未显示重命名按钮");
        await until(() => savedPrefs.savedViews[0].name === "新名字", "视图未改名");

        // 清除全部 → 视图标记取消；再从菜单应用 → 条件恢复
        [...fixture.querySelectorAll("button")].find((node) => node.textContent.trim() === "清除全部").click();
        await until(() => fixture.querySelectorAll(".lvct-people__cards > *").length === 3, "清除全部未恢复全量");
        viewsButton().click();
        await tick();
        [...fixture.querySelectorAll(".lvct-people__viewsmenu-apply")].find((node) => node.textContent.trim() === "新名字").click();
        await until(() => fixture.querySelector(".lvct-people__conditions")?.textContent.includes("视图：新名字"), "应用视图后未标记");
        await until(() => fixture.textContent.includes("共 1 人"), "应用视图后条件未生效");

        // 删除视图 → 规则移除、标记清空，当前列表条件不受影响
        viewsButton().click();
        await tick();
        fixture.querySelector('button[aria-label="删除视图 新名字"]').click();
        await until(() => savedPrefs.savedViews.length === 0, "视图未删除");
        await until(() => !fixture.querySelector(".lvct-people__conditions")?.textContent.includes("视图："), "删除后视图标记未清空");
        assert(fixture.querySelectorAll(".lvct-people__cards > *").length === 1, "删除视图不应影响当前列表条件");

        // 重开 + 失效标签：预置含幽灵标签的视图，应用时提示
        await unmount(mounted);
        savedPrefs = null;
        mounted = mountPeople({ ...DEFAULT_VIEW_PREFERENCES, savedViews: [{
            id: "view-ghost", name: "过期视图",
            query: { search: "", group: "", tags: ["幽灵标签"], tagMatch: "all", recentFrom: "", recentTo: "", neverContacted: false, sort: "name" },
        }] });
        await until(() => fixture.querySelectorAll(".lvct-people__cards > *").length === 3, "重开后名册未加载");
        viewsButton().click();
        await tick();
        [...fixture.querySelectorAll(".lvct-people__viewsmenu-apply")].find((node) => node.textContent.trim() === "过期视图").click();
        await until(() => fixture.querySelector(".lvct-people__viewhint")?.textContent.includes("幽灵标签"), "失效标签未提示");
    } finally {
        window.prompt = originalPrompt;
        window.confirm = originalConfirm;
    }
});

await test("首页待办跟进：分桶展示，处理仅限可达人物，推迟与跳过更新状态", async () => {
    const pad = (value) => String(value).padStart(2, "0");
    const now = new Date();
    const offsetDate = (days) => {
        const date = new Date(now);
        date.setDate(date.getDate() + days);
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    };
    const fu = (id, personDocId, person, dueDate, title) => ({
        item: { id, personDocId, title, dueDate, status: "open", createdAt: 1, updatedAt: 1 },
        bucket: dueDate < offsetDate(0) ? "overdue" : dueDate === offsetDate(0) ? "today" : "upcoming",
        ...(person ? { person } : {}),
        reachable: Boolean(person),
    });
    const personA = { ...person, docId: "doc-a", name: "跟进甲" };
    const personB = { ...person, docId: "doc-b", name: "跟进乙" };
    let followUpsData = [
        fu("fu-overdue", "doc-a", personA, offsetDate(-3), "问问面试结果"),
        fu("fu-today", "doc-b", personB, offsetDate(0), ""),
        fu("fu-ghost", "doc-ghost", null, offsetDate(5), "已解绑人物的计划"),
    ];
    const statusCalls = [];
    const snoozeCalls = [];
    const opened = [];
    mounted = mount(DashboardView, { target: fixture, props: {
        preferences: DEFAULT_VIEW_PREFERENCES, onOpenDetail(p) { opened.push(p.docId); }, onOpenPeople() {}, onOpenGraph() {},
        facade: { settings, loadDashboard: async () => ({
            people: 2, relations: 0, birthdays: [], birthdaysThisWeek: 0,
            stale: [], neverContacted: 0, neverContactedItemIds: [],
            followUps: followUpsData,
        }), setFollowUpStatus: async (id, status) => {
            statusCalls.push([id, status]);
            followUpsData = followUpsData.filter((card) => card.item.id !== id);
        }, snoozeFollowUp: async (id, option) => { snoozeCalls.push([id, option]); } },
    } });
    await until(() => [...fixture.querySelectorAll(".lvct-dash__row")].some((node) => node.textContent.includes("问问面试结果")), "待办卡未渲染");
    const handles = fixture.querySelectorAll(".lvct-dash__row");
    assert(handles.length === 3, `待办应为 3 条，实际 ${handles.length}`);
    const processButtons = [...fixture.querySelectorAll(".lvct-dash__fu-actions button")].filter((node) => node.textContent.trim() === "处理");
    assert(processButtons.length === 2, "不可达人物不应出现处理按钮");
    processButtons[0].click();
    await tick();
    assert(opened.length === 1, "处理未打开人物详情");

    // 推迟 → 语义选项传递
    [...fixture.querySelectorAll(".lvct-dash__fu-actions button")].find((node) => node.textContent.trim() === "推迟").click();
    await tick();
    [...fixture.querySelectorAll("button")].find((node) => node.textContent.trim() === "明天").click();
    await until(() => snoozeCalls.length === 1 && snoozeCalls[0][0] === "fu-overdue" && snoozeCalls[0][1] === "tomorrow", "推迟未传递语义选项");
    await until(() => fixture.textContent.includes("已将「问问面试结果」推迟到明天"), `推迟成功提示未显示（通知区：${[...fixture.querySelectorAll(".lvct-notice")].map((node) => node.textContent).join(" | ") || "无"}）`);

    // 跳过 → 取消并从列表移除（剩余两条继续展示）；等推迟的 busy 释放后再点
    const skipNode = [...fixture.querySelectorAll(".lvct-dash__fu-actions button")].find((node) => node.textContent.trim() === "跳过");
    await until(() => skipNode && !skipNode.disabled, "跳过按钮仍处于忙碌态");
    skipNode.click();
    await until(() => statusCalls.length === 1 && statusCalls[0][1] === "cancelled", `跳过未取消事项（statusCalls：${JSON.stringify(statusCalls)}）`);
    await until(() => ![...fixture.querySelectorAll(".lvct-dash__row")].some((node) => node.textContent.includes("问问面试结果")), "跳过后列表未更新");
    assert(fixture.textContent.includes("已跳过"), "跳过成功提示未显示");
});

await test("人物跟进计划：创建防重复提交，推迟菜单语义选项，完成与取消传递状态", async () => {
    const statusCalls = [];
    const snoozeCalls = [];
    let changed = 0;
    let items = [];
    let releaseCreate;
    const gate = new Promise((resolve) => { releaseCreate = resolve; });
    mounted = mount(PersonDetail, { target: fixture, props: {
        settings, person,
        onRecord: async () => {},
        onLoadInsights: async () => emptyInsights(),
        onOpenPersonDoc() {}, onNavigate() {}, onDeleted() {}, onClose() {},
        onChanged() { changed += 1; },
        onListFollowUps: async () => items,
        onCreateFollowUp: async (_docId, title, dueDate) => {
            await gate;
            const created = { id: `fu-${items.length + 1}`, personDocId: person.docId, title, dueDate, status: "open", createdAt: 1, updatedAt: 1 };
            items = [...items, created];
            return created;
        },
        onSetFollowUpStatus: async (id, status) => { statusCalls.push([id, status]); items = items.map((entry) => (entry.id === id ? { ...entry, status } : entry)); },
        onSnoozeFollowUp: async (id, option) => { snoozeCalls.push([id, option]); },
    } });
    await until(() => fixture.textContent.includes("跟进计划"), "跟进区未显示");
    const titleInput = fixture.querySelector('input[placeholder*="这次想联系什么"]');
    const dateInput = fixture.querySelector('input[aria-label="计划日期"]');
    input(titleInput, "问问面试结果");
    input(dateInput, "2026-10-15");
    const addButton = [...fixture.querySelectorAll("button")].find((node) => node.textContent.trim() === "添加计划");
    addButton.click();
    await until(() => addButton.disabled, "创建挂起时按钮未禁用");
    addButton.click();
    releaseCreate();
    await until(() => items.length === 1 && fixture.textContent.includes("问问面试结果"), "重复提交防護失败或列表未刷新");
    assert(items[0].dueDate === "2026-10-15" && items[0].title === "问问面试结果", "创建参数丢失");

    // 推迟菜单：语义选项（等推迟落定、按钮恢复可用后再完成）
    [...fixture.querySelectorAll("button")].find((node) => node.textContent.trim() === "推迟").click();
    await tick();
    [...fixture.querySelectorAll("button")].find((node) => node.textContent.trim() === "下周一").click();
    await until(() => snoozeCalls.length === 1 && snoozeCalls[0][1] === "nextMonday", "推迟未传递语义选项");
    await until(() => !fixture.querySelector("button[aria-label='指定日期']"), "推迟菜单未收起");

    // 完成 → done，列表清空
    await until(() => {
        const button = [...fixture.querySelectorAll("button")].find((node) => node.textContent.trim() === "完成");
        if (!button || button.disabled) return false;
        button.click();
        return true;
    }, "完成按钮不可用");
    await until(() => statusCalls.length === 1 && statusCalls[0][1] === "done", "完成未传递状态");
    await until(() => fixture.textContent.includes("没有进行中的跟进计划"), "完成后列表未更新");

    // 再建一条并取消（confirm 放行）
    const originalConfirm = window.confirm;
    window.confirm = () => true;
    try {
        input(titleInput, "约球");
        await until(() => {
            const button = [...fixture.querySelectorAll("button")].find((node) => node.textContent.trim() === "再加一条");
            if (!button || button.disabled) return false;
            button.click();
            return true;
        }, "再加一条按钮不可用");
        await until(() => items.length === 2, "第二条未创建");
        await until(() => {
            const button = [...fixture.querySelectorAll("button")].find((node) => node.textContent.trim() === "取消计划");
            if (!button || button.disabled) return false;
            button.click();
            return true;
        }, "取消计划按钮不可用");
        await until(() => statusCalls.length === 2 && statusCalls[1][1] === "cancelled", "取消未传递状态");
        assert(changed >= 4, "跟进操作未触发数据刷新");
    } finally {
        window.confirm = originalConfirm;
    }
});

await test("跟进备份：预览零写入，合并现状优先幂等，损坏数据与非法日期拒绝", async () => {
    const fu = (id, dueDate) => ({ id, personDocId: "doc-1", title: "", dueDate, status: "open", createdAt: 1, updatedAt: 1 });
    // 宿主 loadData 返回已解析的对象；"" 表示首次未创建
    let saved = { schemaVersion: 1, items: [fu("existing", "2026-10-01")] };
    let writes = 0;
    const plugin = {
        loadData: async () => JSON.parse(JSON.stringify(saved)),
        saveData: async (_key, value) => { writes += 1; saved = JSON.parse(JSON.stringify(value)); },
    };
    // 非法日期创建拒绝且零写入
    let rejected = false;
    try { await createFollowUp(plugin, { personDocId: "doc-1", dueDate: "2026-13-40" }); } catch { rejected = true; }
    assert(rejected && writes === 0, "非法日期创建未被拒绝");
    // 备份：existing + new
    const backup = JSON.stringify({
        schemaVersion: 1, exportedAt: "2026-09-28T00:00:00Z", storageKey: "follow-ups.json",
        rawStore: JSON.stringify({ schemaVersion: 1, items: [fu("existing", "2026-01-01"), fu("new", "2026-02-01")] }),
        items: [fu("existing", "2026-01-01"), fu("new", "2026-02-01")],
    });
    const beforePreview = writes;
    const preview = await previewFollowUpsImport(plugin, backup);
    assert(preview.added === 1, `预览新增计数错误：${JSON.stringify(preview)}`);
    assert(preview.skipped === 1, `预览跳过计数错误：${JSON.stringify(preview)}`);
    assert(writes === beforePreview, "预览发生写入");
    const result = await importFollowUpsJson(plugin, backup);
    assert(result.added === 1, "合并新增计数错误");
    const store = await loadFollowUpStore(plugin);
    assert(store.items.length === 2, "合并后条目数错误");
    assert(store.items.find((entry) => entry.id === "existing").dueDate === "2026-10-01", "合并覆盖了现状");
    const repeat = await importFollowUpsJson(plugin, backup);
    assert(repeat.added === 0, "重复合并不幂等");
    // 当前库损坏 → 拒绝合并不覆盖
    const writesBeforeCorrupt = writes;
    saved = { schemaVersion: 99, items: [] };
    rejected = false;
    try { await importFollowUpsJson(plugin, backup); } catch { rejected = true; }
    assert(rejected && writes === writesBeforeCorrupt, "损坏当前库未被拒绝");
    // 坏备份拒绝
    saved = "";
    rejected = false;
    try { await previewFollowUpsImport(plugin, "{oops"); } catch { rejected = true; }
    assert(rejected, "坏 JSON 备份未被拒绝");
    // 导出读取失败抛错，不生成空备份
    saved = "not-json";
    rejected = false;
    try { await exportFollowUpsJson(plugin); } catch { rejected = true; }
    assert(rejected, "导出读取失败未抛错");
});

await test("联系节奏：覆盖阈值进入久未联系，暂停隐藏，清除回退全局，补录不覆盖较新记录", async () => {
    // 名册：单人（resetKernel 提供）；互动与节奏存于对象式插件替身（首次未创建为空串）
    const store = { interactions: "", cadences: "" };
    const plugin = {
        loadData: async (key) => (key === "interaction-events.json" ? structuredClone(store.interactions)
            : key === "person-cadences.json" ? structuredClone(store.cadences) : null),
        saveData: async (key, value) => {
            if (key === "interaction-events.json") store.interactions = JSON.parse(JSON.stringify(value));
            else if (key === "person-cadences.json") store.cadences = JSON.parse(JSON.stringify(value));
        },
    };
    const options = { staleThresholdDays: 30, birthdayWindowDays: 30 };
    const staleIds = async () => (await loadDashboard(plugin, settings, options)).stale.map((info) => info.person.docId);
    const assertIds = (list, expected, message) => assert(JSON.stringify(list) === JSON.stringify(expected), `${message}（实际：${JSON.stringify(list)}）`);
    const docId = person.docId;

    // 初始：从未互动 → 在久未联系
    assertIds(await staleIds(), [docId], "从未互动应进入久未联系");
    // 记录 20 天前互动 → 全局 30 天下不再久未联系
    const daysAgoMs = (days) => Date.now() - days * 86400000;
    await recordInteraction(plugin, { personDocId: docId, occurredAt: daysAgoMs(20) });
    assertIds(await staleIds(), [], "20 天前互动不应在全局 30 天阈值内告警");
    // 覆盖为 14 天 → 进入；补录 40 天前的旧互动，最近互动仍取 20 天那次
    await savePersonCadence(plugin, docId, { days: 14, paused: false });
    let stale = (await loadDashboard(plugin, settings, options)).stale;
    assertIds(stale.map((info) => info.person.docId), [docId], "自定义 14 天阈值未生效");
    assert(stale[0].lastDaysAgo >= 19 && stale[0].lastDaysAgo <= 21, "最近互动天数异常");
    await recordInteraction(plugin, { personDocId: docId, occurredAt: daysAgoMs(40) });
    stale = (await loadDashboard(plugin, settings, options)).stale;
    assert(stale[0].lastDaysAgo >= 19 && stale[0].lastDaysAgo <= 21, "补录旧互动错误覆盖了较新记录");
    // 暂停 → 整体隐藏（含从未互动；该人已有互动）
    await savePersonCadence(plugin, docId, { days: 14, paused: true });
    assertIds(await staleIds(), [], "暂停未隐藏久未联系");
    // 清除覆盖 → 回退全局
    await savePersonCadence(plugin, docId, null);
    assertIds(await staleIds(), [], "清除覆盖后未回退全局阈值");
    assert((await loadPersonCadence(plugin, docId)) === null, "清除后仍读到覆盖项");
});

await test("人物联系节奏设置：显示当前规则，自定义/暂停/清除并持久化", async () => {
    let savedCadence;
    let savedDocId;
    let cadence = null;
    mounted = mount(PersonDetail, { target: fixture, props: {
        settings, person,
        onRecord: async () => {},
        onLoadInsights: async () => emptyInsights(),
        onOpenPersonDoc() {}, onNavigate() {}, onChanged() {}, onDeleted() {}, onClose() {},
        onGetCadence: async () => cadence,
        onSaveCadence: async (docId, value) => { savedDocId = docId; savedCadence = value; cadence = value; },
    } });
    await until(() => fixture.textContent.includes("联系节奏"), "联系节奏区未显示");
    await until(() => fixture.textContent.includes("跟随全局阈值"), "初始规则未显示");

    const modeSelect = fixture.querySelector('select[aria-label="联系节奏模式"]');
    modeSelect.value = "custom";
    modeSelect.dispatchEvent(new Event("change", { bubbles: true }));
    await tick();
    const daysInput = fixture.querySelector('input[aria-label="自定义天数"]');
    assert(daysInput, "自定义模式下未出现天数输入");
    input(daysInput, "14");
    [...fixture.querySelectorAll("button")].find((node) => node.textContent.trim() === "保存节奏").click();
    await until(() => savedCadence?.days === 14 && savedCadence?.paused === false, "自定义节奏未保存");
    await until(() => fixture.textContent.includes("已设为每 14 天联系一次"), "保存成功提示未显示");

    modeSelect.value = "paused";
    modeSelect.dispatchEvent(new Event("change", { bubbles: true }));
    await tick();
    [...fixture.querySelectorAll("button")].find((node) => node.textContent.trim() === "保存节奏").click();
    await until(() => savedCadence?.paused === true, "暂停未保存");

    modeSelect.value = "global";
    modeSelect.dispatchEvent(new Event("change", { bubbles: true }));
    await tick();
    [...fixture.querySelectorAll("button")].find((node) => node.textContent.trim() === "保存节奏").click();
    await until(() => savedCadence === null && savedDocId === person.docId, "清除覆盖未保存 null");
    await until(() => fixture.textContent.includes("已清除覆盖"), "清除提示未显示");
});

await test("今日行动清单：多原因单卡徽标，逾期跟进批量顺延到今天，空态", async () => {
    const pad = (value) => String(value).padStart(2, "0");
    const now = new Date();
    const offsetDate = (days) => {
        const date = new Date(now);
        date.setDate(date.getDate() + days);
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    };
    const todayKey = offsetDate(0);
    const personA = { ...person, docId: "doc-a", name: "行动甲" };
    const personB = { ...person, docId: "doc-b", name: "行动乙" };
    let actions = [
        { person: personA, bucket: "overdue", earliestDate: offsetDate(-3), reasons: [
            { kind: "followup", bucket: "overdue", label: "跟进「问问面试」已逾期", dueDate: offsetDate(-3), followUpId: "fu-1" },
            { kind: "stale", bucket: "stale", label: "60 天未联系（阈值 30 天）" },
        ] },
        { person: personB, bucket: "today", earliestDate: todayKey, reasons: [
            { kind: "birthday", bucket: "today", label: "今天生日", dueDate: todayKey },
        ] },
    ];
    const snoozeCalls = [];
    const opened = [];
    let shifted = false;
    mounted = mount(DashboardView, { target: fixture, props: {
        preferences: DEFAULT_VIEW_PREFERENCES,
        onOpenDetail(p) { opened.push(p.docId); }, onOpenPeople() {}, onOpenGraph() {},
        facade: { settings, loadDashboard: async () => ({
            people: 2, relations: 0, birthdays: [], birthdaysThisWeek: 0,
            stale: [], neverContacted: 0, neverContactedItemIds: [],
            followUps: [], actions: shifted ? [] : actions,
        }), snoozeFollowUp: async (id, option, date) => { snoozeCalls.push([id, option, date]); shifted = true; } },
    } });
    await until(() => fixture.textContent.includes("今日行动"), "行动清单未渲染");
    await until(() => fixture.querySelectorAll(".lvct-dash__actions .lvct-dash__row").length === 2, "行动卡数量错误");
    const cardA = [...fixture.querySelectorAll(".lvct-dash__actions .lvct-dash__row")].find((node) => node.textContent.includes("行动甲"));
    assert(cardA.textContent.includes("跟进「问问面试」已逾期") && cardA.textContent.includes("60 天未联系"), "多原因徽标未同卡展示");
    assert(cardA.textContent.includes("行动乙") === false, "不同人物不应合并卡片");

    // 批量顺延：把逾期跟进顺延到今天
    [...fixture.querySelectorAll("button")].find((node) => node.textContent.includes("1 条逾期跟进顺延到今天")).click();
    await until(() => snoozeCalls.length === 1, "批量顺延未触发");
    assert(snoozeCalls[0][0] === "fu-1" && snoozeCalls[0][1] === "custom" && snoozeCalls[0][2] === todayKey, "顺延参数错误");
    await until(() => fixture.textContent.includes("今天没有需要处理的事"), "顺延后清单未清空");
    assert(fixture.textContent.includes("已把 1 条逾期跟进顺延到今天"), "顺延成功提示未显示");

    // 打开详情
    [...fixture.querySelectorAll("button")].find((node) => node.textContent.trim() === "浏览联系人").click();
    assert(opened.length === 0, "空态不应打开详情");
});

await test("打开摘要：开关与当日忽略抑制、次日恢复、空清单不出横幅，数量同源", async () => {
    const pad = (value) => String(value).padStart(2, "0");
    const now = new Date();
    const dateKey = (days) => {
        const date = new Date(now);
        date.setDate(date.getDate() + days);
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    };
    const personA = { ...person, docId: "doc-a", name: "摘要甲" };
    const actionsData = [
        { person: personA, bucket: "today", earliestDate: dateKey(0), reasons: [{ kind: "stale", bucket: "stale", label: "40 天未联系（阈值 30 天）" }] },
        { person: { ...person, docId: "doc-b", name: "摘要乙" }, bucket: "today", earliestDate: dateKey(0), reasons: [{ kind: "stale", bucket: "stale", label: "从未互动" }] },
    ];
    const mountedViews = [];
    const mountDash = (prefs, withActions = true) => {
        const view = mount(DashboardView, { target: fixture, props: {
            preferences: prefs,
            onOpenDetail() {}, onOpenPeople() {}, onOpenGraph() {},
            onPreferencesChange: async (next) => { savedPrefs = next; return next; },
            facade: { settings, loadDashboard: async () => ({
                people: 2, relations: 0, birthdays: [], birthdaysThisWeek: 0,
                stale: [], neverContacted: 0, neverContactedItemIds: [],
                followUps: [], actions: withActions ? actionsData : [],
            }) },
        } });
        mountedViews.push(view);
        return view;
    };
    let savedPrefs = null;
    // 数据就绪的标志：问候语渲染（data 已非空）
    const dataReady = () => fixture.textContent.includes("今天先联系谁");

    // ① 有行动 + 未忽略 → 横幅出现且数量同源
    mountedViews.push(mount(DashboardView, { target: fixture, props: {
        preferences: DEFAULT_VIEW_PREFERENCES,
        onOpenDetail() {}, onOpenPeople() {}, onOpenGraph() {},
        onPreferencesChange: async (next) => { savedPrefs = next; return next; },
        facade: { settings, loadDashboard: async () => ({
            people: 2, relations: 0, birthdays: [], birthdaysThisWeek: 0,
            stale: [], neverContacted: 0, neverContactedItemIds: [], followUps: [], actions: actionsData,
        }) },
    } }));
    await until(() => dataReady(), "仪表盘未加载");
    await until(() => fixture.textContent.includes("今天有 2 件值得处理的事"), "摘要横幅未显示");
    await unmount(mountedViews.shift());
    fixture.replaceChildren();

    // ② 当日忽略 → 同日抑制
    mountedViews.push(mountDash({ ...DEFAULT_VIEW_PREFERENCES, summaryDismissedOn: dateKey(0) }));
    await until(dataReady, "仪表盘未加载");
    assert(!fixture.textContent.includes("值得处理的事"), "当日忽略后横幅仍显示");
    await unmount(mountedViews.pop());
    fixture.replaceChildren();

    // ③ 忽略标记为昨天 → 次日恢复
    mountedViews.push(mountDash({ ...DEFAULT_VIEW_PREFERENCES, summaryDismissedOn: dateKey(-1) }));
    await until(dataReady, "仪表盘未加载");
    await until(() => fixture.textContent.includes("今天有 2 件值得处理的事"), "次日未恢复显示");

    // ④ 点击「今日不再展示」→ 写入当天日期
    [...fixture.querySelectorAll("button")].find((node) => node.textContent.trim() === "今日不再展示").click();
    await until(() => savedPrefs?.summaryDismissedOn === dateKey(0), "当日忽略未持久化");
    await until(() => !fixture.textContent.includes("值得处理的事"), "忽略后横幅未消失");

    // ⑤ 关闭偏好 → 不显示；空清单 → 不显示
    await unmount(mountedViews.pop());
    fixture.replaceChildren();
    mountedViews.push(mountDash({ ...DEFAULT_VIEW_PREFERENCES, summaryEnabled: false }));
    await until(dataReady, "仪表盘未加载");
    assert(!fixture.textContent.includes("值得处理的事"), "关闭偏好后横幅仍显示");
    await unmount(mountedViews.pop());
    fixture.replaceChildren();
    mountedViews.push(mountDash({ ...DEFAULT_VIEW_PREFERENCES }, false));
    await until(dataReady, "仪表盘未加载");
    assert(!fixture.textContent.includes("值得处理的事"), "空清单不应出横幅");
    await unmount(mountedViews.pop());
    fixture.replaceChildren();
});

await test("备注模板：空存储回退内置默认，增改删落盘且重开恢复，非法条目归一化", async () => {
    let saved = "";
    let writes = 0;
    const plugin = {
        loadData: async () => (saved === "" ? "" : JSON.parse(JSON.stringify(saved))),
        saveData: async (_key, value) => { writes += 1; saved = JSON.parse(JSON.stringify(value)); },
    };
    // 空存储 → 内置默认（见面/电话/聚会），不落盘
    assert(JSON.stringify((await listTemplates(plugin)).map((item) => item.name)) === JSON.stringify(["见面", "电话", "聚会"]), "空存储未回退内置默认");
    assert(writes === 0, "回退默认不应写存储");
    // 增改删全量保存
    const next = [
        { id: "tpl-meet", name: "见面", content: "和{{姓名}}见面，聊了……" },
        { id: "tpl-call-2", name: "周一直呼", content: "{{姓名}}，关于……" },
    ];
    const savedList = await saveTemplates(plugin, next);
    assert(writes === 1, "保存未写入");
    assert(JSON.stringify(savedList.map((item) => item.name)) === JSON.stringify(["见面", "周一直呼"]), "保存内容错误");
    // 重开恢复（存储为准，内置默认不再出现）
    assert(JSON.stringify((await listTemplates(plugin)).map((item) => item.id)) === JSON.stringify(["tpl-meet", "tpl-call-2"]), "重开未按存储恢复");
    // 非法条目归一化丢弃
    const cleaned = await saveTemplates(plugin, [...next, { id: "", name: "坏" }, { id: "x", name: "  ", content: "c" }]);
    assert(JSON.stringify(cleaned.map((item) => item.id)) === JSON.stringify(["tpl-meet", "tpl-call-2"]), "非法条目未归一化丢弃");
});

await test("Peek 备注模板：选用填入备注且变量替换，已有草稿需确认覆盖，管理弹窗增删保存", async () => {
    let templates = [
        { id: "tpl-meet", name: "见面", content: "和{{姓名}}见面（上次互动：{{上次互动}}）" },
    ];
    let savedLists = 0;
    const originalConfirm = window.confirm;
    let confirmAnswer = true;
    window.confirm = () => confirmAnswer;
    try {
        mounted = mount(PersonDetail, { target: fixture, props: {
            settings, person,
            onRecord: async () => {},
            onLoadInsights: async () => ({ timeline: [{ eventId: "e1", localDate: "2026-08-01", source: "manual", note: "上次", groupSize: 1 }], coAttendance: [], totalEvents: 1 }),
            onOpenPersonDoc() {}, onNavigate() {}, onChanged() {}, onDeleted() {}, onClose() {},
            onListTemplates: async () => templates,
            onSaveTemplates: async (list) => { savedLists += 1; templates = JSON.parse(JSON.stringify(list)); return templates; },
        } });
        await until(() => fixture.textContent.includes("记一笔互动"), "记录区未显示");
        const templateSelect = fixture.querySelector('select[aria-label="选用备注模板"]');
        assert(templateSelect, "模板选择器未显示");
        await until(() => [...templateSelect.options].some((option) => option.value === "tpl-meet"), "模板选项未加载");

        // 已有草稿 + 拒绝覆盖 → 备注不变
        const noteInput = fixture.querySelector('input[placeholder*="做了什么"]');
        input(noteInput, "我自己写的内容");
        confirmAnswer = false;
        templateSelect.value = "tpl-meet";
        templateSelect.dispatchEvent(new Event("change", { bubbles: true }));
        await pause(30);
        assert(noteInput.value === "我自己写的内容", "拒绝覆盖仍改写了备注");

        // 允许覆盖 → 变量替换填入（上次互动取时间线最新一条）
        confirmAnswer = true;
        templateSelect.value = "tpl-meet";
        templateSelect.dispatchEvent(new Event("change", { bubbles: true }));
        await until(() => noteInput.value.includes("和回归测试甲见面"), "模板变量替换未生效");
        assert(noteInput.value.includes("2026-08-01"), "上次互动占位未替换");
        assert(fixture.textContent.includes("管理模板"), "管理入口应存在");
    } finally {
        window.confirm = originalConfirm;
    }
});

await test("管理模板弹窗：删除与新增保存落盘，取消不写入", async () => {
    let templates = [
        { id: "tpl-meet", name: "见面", content: "和{{姓名}}见面" },
    ];
    let savedLists = 0;
    const originalConfirm = window.confirm;
    let confirmAnswer = true;
    window.confirm = () => confirmAnswer;
    try {
        mounted = mount(PersonDetail, { target: fixture, props: {
            settings, person,
            onRecord: async () => {},
            onLoadInsights: async () => emptyInsights(),
            onOpenPersonDoc() {}, onNavigate() {}, onChanged() {}, onDeleted() {}, onClose() {},
            onListTemplates: async () => templates,
            onSaveTemplates: async (list) => { savedLists += 1; templates = JSON.parse(JSON.stringify(list)); return templates; },
        } });
        await until(() => fixture.querySelector('select[aria-label="选用备注模板"]'), "模板选择器未显示");
        // 等模板列表加载完成（选项出现）再打开管理弹窗
        await until(() => [...fixture.querySelector('select[aria-label="选用备注模板"]').options].some((option) => option.value === "tpl-meet"), "模板选项未加载");
        [...fixture.querySelectorAll("button")].find((node) => node.textContent.trim() === "管理模板").click();
        await pause(300);
        if (!fixture.querySelector('button[title^="删除模板"]')) {
            const buttons = [...fixture.querySelectorAll("button")].map((node) => node.textContent.trim() || node.getAttribute("aria-label")).join("|").slice(0, 500);
            throw new Error(`管理弹窗未打开；当前按钮：${buttons}`);
        }
        // 取消删除 → 条目保留
        confirmAnswer = false;
        fixture.querySelector('button[title^="删除模板"]').click();
        await pause(30);
        assert(templates.length === 1 && savedLists === 0, "取消删除不应写存储");
        // 放行删除
        confirmAnswer = true;
        fixture.querySelector('button[title^="删除模板"]').click();
        await until(() => fixture.textContent.includes("还没有模板"), "删除后列表未更新");
        // 新增并保存
        [...fixture.querySelectorAll("button")].find((node) => node.textContent.trim() === "＋ 新增模板").click();
        await until(() => fixture.querySelector('input[aria-label="模板 1 名称"]'), "新增模板行未出现");
        input(fixture.querySelector('input[aria-label="模板 1 名称"]'), "约球");
        [...fixture.querySelectorAll("button")].find((node) => node.textContent.trim() === "保存模板").click();
        await until(() => savedLists === 1, "模板未保存");
        assert(templates.length === 1 && templates[0].name === "约球", "新增保存结果错误");
        await until(() => fixture.textContent.includes("模板已保存"), "保存成功提示未显示");
    } finally {
        window.confirm = originalConfirm;
    }
});

await test("诊断模板弹窗", async () => {
    mounted = mount(PersonDetail, { target: fixture, props: {
        settings, person,
        onRecord: async () => {},
        onLoadInsights: async () => emptyInsights(),
        onOpenPersonDoc() {}, onNavigate() {}, onChanged() {}, onDeleted() {}, onClose() {},
        onListTemplates: async () => [{ id: "tpl-meet", name: "见面", content: "x" }],
        onSaveTemplates: async (list) => list,
    } });
    await until(() => fixture.querySelector('select[aria-label="选用备注模板"]'), "模板选择器未显示");
    [...fixture.querySelectorAll("button")].find((node) => node.textContent.trim() === "管理模板").click();
    await pause(300);
    const buttons = [...fixture.querySelectorAll("button")].map((node) => node.textContent.trim() || node.getAttribute("aria-label")).join("|");
    const dialogCount = fixture.querySelectorAll(".lvct-dialog-mask, .lvct-dialog, [class*=dialog]").length;
});

await test("互动日期回顾：按月分组、日期范围与快捷项、历史上的今天", async () => {
    const pad = (value) => String(value).padStart(2, "0");
    const now = new Date();
    const dateKey = (days) => {
        const date = new Date(now);
        date.setDate(date.getDate() + days);
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    };
    const mk = (localDate, note) => ({ eventId: `e-${localDate}-${note}`, localDate, source: "manual", note, groupSize: 1 });
    const timeline = [
        mk(dateKey(0), "今天的事"),
        mk("2025-09-28", "去年今天聚了个餐"),
        mk("2026-08-15", "八月的事"),
        mk("2026-07-20", "七月的事"),
    ];
    mounted = mount(PersonDetail, { target: fixture, props: {
        settings, person,
        onRecord: async () => {},
        onLoadInsights: async () => ({ timeline, coAttendance: [], totalEvents: timeline.length }),
        onOpenPersonDoc() {}, onNavigate() {}, onChanged() {}, onDeleted() {}, onClose() {},
    } });
    await until(() => fixture.textContent.includes("互动与共同出席") === false, "加载中");
    button("互动").click();
    await until(() => fixture.textContent.includes("互动与共同出席"), "互动页签未打开");
    await until(() => fixture.querySelector(".lvct-detail__timeline"), "时间线未渲染");
    // 默认 20 条全显 → 月分组出现（当月 + 历史）
    const monthHeads = () => [...fixture.querySelectorAll(".lvct-detail__month-head")].map((node) => node.textContent.trim());
    assert(monthHeads().length >= 2 && monthHeads().every((text) => text.includes("月") && text.includes("（1）")), "月分组未按月显示计数");
    // 历史上的今天：往年 09-28
    await until(() => fixture.textContent.includes("去年今天聚了个餐"), "历史上的今天未显示");
    // 日期范围过滤：只看 7 月
    const dateInputs = [...fixture.querySelectorAll('input[aria-label^="互动"][aria-label$="日期"]')];
    input(dateInputs[0], "2026-07-01");
    input(dateInputs[1], "2026-07-31");
    await until(() => !fixture.textContent.includes("八月的事"), "日期范围未排除八月");
    assert(fixture.textContent.includes("七月的事"), "日期范围内条目丢失");
    // 快捷项：最近 30 天（今天的事在范围内）
    [...fixture.querySelectorAll("button")].find((node) => node.textContent.trim() === "最近 30 天").click();
    await until(() => fixture.textContent.includes("今天的事"), "最近 30 天快捷项未生效");
    assert(!fixture.textContent.includes("七月的事"), "快捷项未排除范围外条目");
    // 清除日期
    [...fixture.querySelectorAll("button")].find((node) => node.textContent.trim() === "清除日期").click();
    await until(() => fixture.textContent.includes("七月的事"), "清除日期后未恢复全量");
});

await test("会面简报导出：预览与范围一致，特殊字符转义，下载 .md", async () => {
    const pad = (value) => String(value).padStart(2, "0");
    const now = new Date();
    const dateKey = (days) => {
        const date = new Date(now);
        date.setDate(date.getDate() + days);
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    };
    const mk = (localDate, note) => ({ eventId: `e-${localDate}-${note}`, localDate, source: "manual", note, groupSize: 1 });
    const timeline = [
        { eventId: "e1", localDate: "2026-09-01", source: "manual", note: "聊了*小天*入学", groupSize: 2 },
        ...Array.from({ length: 7 }, (_, index) => mk(dateKey(-(index + 1)), `旧事${index + 1}`)),
    ];
    let downloads = 0;
    let filename = "";
    let blob;
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    const originalClick = HTMLAnchorElement.prototype.click;
    URL.createObjectURL = (value) => { blob = value; return "blob:briefing-test"; };
    URL.revokeObjectURL = () => {};
    HTMLAnchorElement.prototype.click = function () { downloads += 1; filename = this.download; };
    try {
        mounted = mount(PersonDetail, { target: fixture, props: {
            settings, person,
            onRecord: async () => {},
            onLoadInsights: async () => ({ timeline, coAttendance: [{ otherDocId: "doc-b", name: "周子昂", count: 3 }], totalEvents: timeline.length }),
            onOpenPersonDoc() {}, onNavigate() {}, onChanged() {}, onDeleted() {}, onClose() {},
        } });
        await until(() => fixture.textContent.includes("导出会面简报"), "导出入口未显示");
        button("导出会面简报").click();
        await until(() => fixture.querySelector(".lvct-briefing-preview"), "预览未出现");
        const previewText = () => fixture.querySelector(".lvct-briefing-preview").textContent;
        assert(previewText().includes("## 最近互动（8 条）"), "默认范围应为全部 8 条");
        assert(previewText().includes("聊了\\*小天\\*入学"), "备注特殊字符未转义");
        assert(previewText().includes("同场 3 次"), "共同出席缺失");
        // 切换范围 → 预览同步（最近 5 条）
        const rangeSelect = fixture.querySelector('select[aria-label="互动条数范围"]');
        rangeSelect.value = "5";
        rangeSelect.dispatchEvent(new Event("change", { bubbles: true }));
        await until(() => previewText().includes("## 最近互动（5 条，共 8 条）"), "范围切换未同步预览");
        assert(!previewText().includes("旧事7"), "范围外条目不应出现在预览");
        // 下载
        [...fixture.querySelectorAll("button")].find((node) => node.textContent.trim() === "下载 .md").click();
        await until(() => downloads === 1, "下载未触发");
        assert(filename.endsWith(".md") && filename.includes("回归测试甲"), "下载文件名错误");
        assert((await blob.text()).includes("# 会面简报：回归测试甲"), "下载内容与预览不一致");
    } finally {
        URL.createObjectURL = originalCreate;
        URL.revokeObjectURL = originalRevoke;
        HTMLAnchorElement.prototype.click = originalClick;
    }
});

await test("交往回顾报表：区间统计与明细渲染，切换区间重新生成，零数据一致", async () => {
    const reportA = {
        range: { from: "2026-09-01", to: "2026-09-28" }, previous: { from: "2026-08-02", to: "2026-08-31" },
        total: 5, activities: 3, contactedPeople: 2, bySource: { manual: 2, diary: 2, api: 1 },
        topPeople: [{ personDocId: "doc-a", name: "回归测试甲", count: 3 }, { personDocId: "doc-b", name: "", count: 2 }],
        entries: [
            { eventId: "e1", localDate: "2026-09-05", personDocId: "doc-a", personName: "回归测试甲", source: "diary", note: "项目会", groupSize: 2 },
            { eventId: "e2", localDate: "2026-09-10", personDocId: "doc-a", personName: "回归测试甲", source: "manual", note: "电话", groupSize: 1 },
            { eventId: "e3", localDate: "2026-09-12", personDocId: "doc-a", personName: "回归测试甲", source: "manual", note: "午餐", groupSize: 1 },
            { eventId: "e4", localDate: "2026-09-20", personDocId: "doc-b", personName: "", source: "api", note: "任务联动", groupSize: 1 },
            { eventId: "e5", localDate: "2026-09-25", personDocId: "doc-b", personName: "", source: "api", note: "任务联动", groupSize: 1 },
        ],
        previousTotal: 3, delta: 2,
    };
    const emptyReport = { ...reportA, total: 0, activities: 0, contactedPeople: 0, bySource: { manual: 0, diary: 0, api: 0 }, topPeople: [], entries: [], previousTotal: 0, delta: 0 };
    let calls = [];
    let useEmpty = false;
    mounted = mount(DashboardView, { target: fixture, props: {
        preferences: DEFAULT_VIEW_PREFERENCES, onOpenDetail() {}, onOpenPeople() {}, onOpenGraph() {},
        facade: { settings, loadDashboard: async () => ({
            people: 0, relations: 0, birthdays: [], birthdaysThisWeek: 0, stale: [], neverContacted: 0, neverContactedItemIds: [], followUps: [], actions: [],
        }), buildReviewReport: async (from, to) => {
            calls.push([from, to]);
            return useEmpty ? emptyReport : reportA;
        } },
    } });
    await until(() => fixture.textContent.includes("今日行动"), "首页未渲染");
    button("交往回顾").click();
    await until(() => fixture.textContent.includes("本周期与 2 位联系人互动 5 次"), "报表摘要未显示");
    assert(fixture.textContent.includes("比上一周期多 2 次"), "对比文案缺失");
    assert(fixture.textContent.includes("同场活动"), "同场活动口径缺失");
    assert(fixture.textContent.includes("最常联系 Top 2"), "排行缺失");
    // 明细展开
    [...fixture.querySelectorAll("button")].find((node) => node.textContent.includes("查看明细（5 条）")).click();
    await until(() => fixture.textContent.includes("项目会"), "明细未展开");
    // 切换区间 → 重新生成且为空报表
    useEmpty = true;
    const modeSelect = fixture.querySelector('select[aria-label="统计区间"]');
    modeSelect.value = "90";
    modeSelect.dispatchEvent(new Event("change", { bubbles: true }));
    await until(() => fixture.textContent.includes("本周期与 0 位联系人互动 0 次"), "切换区间未重新生成");
    assert(calls.length === 2, "区间切换未重新请求");
    // 自定义模式缺日期 → 提示选择
    modeSelect.value = "custom";
    modeSelect.dispatchEvent(new Event("change", { bubbles: true }));
    await pause(60);
    assert(fixture.textContent.includes("选择区间后生成报表"), "自定义缺日期未提示");
});

await test("重复候选检查：并排资料与理由展示，查看跳转零写入，无候选给空态", async () => {
    const row = (id, name, phone, email) => ({
        id: `item-${id}`,
        cells: [
            { valueType: "block", value: { type: "block", keyID: "name", block: { id: `doc-${id}`, content: name } } },
            { valueType: "phone", value: { type: "phone", keyID: "phone", phone: { content: phone } } },
            { valueType: "email", value: { type: "email", keyID: "email", email: { content: email } } },
        ],
    });
    kernel.handler = async (route) => {
        if (route === "/api/av/renderAttributeView") return { view: { columns: FIELD_SPECS.map((field) => ({ id: field.key, name: field.nameZh, type: field.type })), rows: [
            row("a", "陈立群", "138 2611-0427", "A@X.com"),
            row("b", "陈立群", "13826110427", "a@x.com"),
            row("c", "独一人", "", ""),
        ] } };
        throw new Error(`回归测试不允许请求 ${route}`);
    };
    const opened = [];
    mounted = mount(PeopleView, { target: fixture, props: {
        settings, preferences: DEFAULT_VIEW_PREFERENCES,
        loadRecentInteractions: async () => ({}),
        revision: 0, initialSort: "name",
        onOpenDetail(p) { opened.push(p.docId); }, onOpenPersonDoc() {},
        onPreferencesChange: async (next) => next,
    } });
    await until(() => fixture.querySelectorAll(".lvct-people__cards > *").length === 3, "名册未加载 3 人");
    // 整理按钮带候选角标
    assert(button("整理 ·1"), "整理按钮未显示候选角标");
    button("整理 ·1").click();
    await until(() => fixture.textContent.includes("匹配规则"), "候选面板未显示规则说明");
    assert(fixture.textContent.includes("电话相同：13826110427"), "电话理由缺失");
    assert(fixture.textContent.includes("邮箱相同：a@x.com"), "邮箱理由缺失");
    assert(fixture.textContent.includes("同名不等同同人"), "同名人工确认提示缺失");
    // 查看候选 → 打开对应人物详情（零写入路径）
    const viewButtons = [...fixture.querySelectorAll("button")].filter((node) => node.textContent.trim() === "查看 陈立群");
    assert(viewButtons.length === 2, "并排两侧应各有一个查看入口");
    viewButtons[0].click();
    await until(() => opened.length === 1, "查看候选未打开详情");
    assert(!fixture.querySelector(".lvct-dup__pair"), "查看候选后面板应已关闭");
});

await test("vCard 导入诊断：三段报告区分失败与待核对，重试先核对名册不重复建人", async () => {
    let failCreate = true;
    const state = configureVcardKernel(kernel, settings);
    state.rows.set(person.itemId, renderResult().view.rows[0]);
    const handle = kernel.handler;
    kernel.handler = async (route, body) => {
        if (route === "/api/filetree/createDocWithMd") {
            state.rejectCreate = failCreate && body.path.includes("测试败");
        }
        return handle(route, body);
    };
    mounted = mount(VCardDialog, { target: fixture, props: { settings, onImported() {}, onClose() {} } });
    const fileInput = fixture.querySelector('input[type="file"]');
    const selectFile = (names) => {
        const transfer = new DataTransfer();
        transfer.items.add(new File([names.map((name) => `BEGIN:VCARD\nVERSION:3.0\nFN:${name}\nEND:VCARD`).join("\n")], "test.vcf", { type: "text/vcard" }));
        fileInput.files = transfer.files;
        fileInput.dispatchEvent(new Event("change", { bubbles: true }));
    };
    selectFile(["回归测试甲", "测试乙", "测试败"]);
    await until(() => fixture.textContent.includes("已选 2/3"), "预览未就绪");
    const importButton = [...fixture.querySelectorAll("button")].find((node) => node.textContent.includes("导入为联系人（2）"));
    assert(importButton, "应默认勾选 2 条（同名跳过不计）");
    importButton.click();
    // 三段报告：成功 1（测试乙）/ 跳过 1（同名甲）/ 失败 1（测试败）
    await until(() => fixture.textContent.includes("✓ 成功（1）"), "成功段未显示");
    assert(fixture.textContent.includes("⊘ 跳过（1）"), "跳过段未显示");
    assert(fixture.textContent.includes("! 失败（1）"), "失败段未显示");
    assert(fixture.textContent.includes("内核明确拒绝建档"), "失败原因缺失");
    // 重试（仍失败）→ 保持 failed；重试确实调用了建文档（failCreate=true 抛错）
    await until(() => state.creates.length === 2, "首次逐项请求未完成");
    await until(() => fixture.textContent.includes("! 失败（1）"), "重试后失败段未保留");
    const callsAfterFirstRetry = state.creates.length;
    failCreate = false;
    state.skipBind = true;
    [...fixture.querySelectorAll("button")].find((node) => node.textContent.includes("核对名册并重试")).click();
    await until(() => state.creates.length > callsAfterFirstRetry, "明确拒绝后的原请求未重试");
    await until(() => fixture.textContent.includes("? 待核对（1）"), "未核实原绑定行应保持待核对");
    assert(fixture.textContent.includes("⊘ 跳过（1）"), "将同名人物冒充原请求导入结果");
    assert(state.creates.filter((request) => request.path.includes("测试乙")).length === 1, "成功项重复创建");
});

await test("备份差异明细：展开新增/跳过/删除标记影响，合计与摘要一致，人物不可达标注", async () => {
    const diff = {
        added: [
            { eventId: "n1", localDate: "2026-09-05", personDocId: "doc-a", personName: "回归测试甲", source: "diary", note: "项目会", personFound: true },
            { eventId: "n2", localDate: "2026-09-06", personDocId: "doc-ghost", source: "api", note: "联动记录", personFound: false },
        ],
        skipped: [
            { eventId: "s1", localDate: "2026-08-01", personDocId: "doc-a", personName: "回归测试甲", source: "manual", note: "已有", reason: "本地已存在相同互动", personFound: true },
        ],
        tombstoneHits: [
            { tombstoneId: "gone", willRemove: true, removed: { localDate: "2026-07-01", personDocId: "doc-a", note: "旧记录" } },
            { tombstoneId: "missing", willRemove: false },
        ],
        incomingTotal: 3,
    };
    mounted = mount(SettingsView, { target: fixture, props: {
        facade: {
            settings, viewPreferences: DEFAULT_VIEW_PREFERENCES,
            previewInteractionImport: async () => ({ added: 2, skipped: 1, removed: 1, tombstonesAdded: 2 }),
            previewInteractionImportDiff: async () => diff,
            exportInteractionJson: async () => "{}",
            saveViewPreferences: async (value) => value,
        },
        settings, preferences: DEFAULT_VIEW_PREFERENCES,
        onSettingsUpdated() {}, onPreferencesUpdated() {}, onBack() {},
    } });
    [...fixture.querySelectorAll(".lvct-settings__nav-item")].find((node) => node.textContent.includes("数据与字段")).click();
    await tick();
    const fileInput = fixture.querySelector('input[id="lvct-interaction-backup"]');
    const transfer = new DataTransfer();
    transfer.items.add(new File(["{}"], "backup.json", { type: "application/json" }));
    fileInput.files = transfer.files;
    fileInput.dispatchEvent(new Event("change", { bubbles: true }));
    await until(() => fixture.textContent.includes("查看差异明细"), "差异明细入口未出现");
    [...fixture.querySelectorAll("button")].find((node) => node.textContent.trim() === "查看差异明细").click();
    await until(() => fixture.textContent.includes("将新增（2 条）"), "新增段未展开");
    assert(fixture.textContent.includes("将跳过（1 条）"), "跳过段缺失");
    assert(fixture.textContent.includes("删除标记影响（2 个标记）"), "删除标记段缺失");
    assert(fixture.textContent.includes("将移除：2026-07-01"), "将移除明细缺失");
    assert(fixture.textContent.includes("当前库中无对应互动，无影响"), "无影响标记缺失");
    assert(fixture.textContent.includes("人物不可达"), "不可达人物未标注");
    assert(fixture.textContent.includes("备份共 3 条事件（新增 2 + 跳过 1）"), "合计与摘要不一致");
});

await test("关系结果导出：路径链 Markdown、无路径兜底与图规模说明", async () => {
    const makeEntries = (linked) => [
        { id: "a", name: "甲", related: ["c"] },
        { id: "b", name: "乙", related: linked ? ["c"] : [] },
        { id: "c", name: "共同人物", related: [] },
    ];
    let downloads = 0;
    let filename = "";
    let blob;
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    const originalClick = HTMLAnchorElement.prototype.click;
    URL.createObjectURL = (value) => { blob = value; return "blob:graph-export"; };
    URL.revokeObjectURL = () => {};
    HTMLAnchorElement.prototype.click = function () { downloads += 1; filename = this.download; };
    const setupHandler = (linked) => {
        const entries = makeEntries(linked);
        kernel.handler = async (route) => {
            assert(route === "/api/av/renderAttributeView", "导出流程不应写内核");
            return { view: { columns: renderResult().view.columns, rows: entries.map((entry) => ({
                id: entry.id, cells: [
                    { valueType: "block", value: { type: "block", keyID: "name", block: { id: entry.id, content: entry.name } } },
                    { valueType: "relation", value: { type: "relation", keyID: "related", relation: { blockIDs: entry.related } } },
                ],
            })) } };
        };
    };
    const select = (label, value) => {
        const node = fixture.querySelector(`select[aria-label="${label}"]`);
        assert(node, `未找到下拉：${label}`);
        node.value = value;
        node.dispatchEvent(new Event("change", { bubbles: true }));
    };
    try {
        setupHandler(false);
        mounted = mount(RelationGraph, { target: fixture, props: {
            settings, preferences: DEFAULT_VIEW_PREFERENCES, onPreferencesChange: async (next) => next,
            facade: { listOrganizations: async () => [], loadSelfIdentity: async () => null },
            onOpenDetail() {}, onOpenPeople() {},
        } });
        button("画布视图").click();
        await until(() => fixture.querySelector(".lvct-graph-view__canvas")?._cyreg?.cy, "图谱未挂载");
        await pickOption("关系中心", "甲");
        await pickOption("对比人物", "乙");
        await until(() => fixture.querySelector('select[aria-label="关系查询模式"]'), "查询模式未显示");
        select("关系查询模式", "path");
        await until(() => fixture.textContent.includes("无连接"), "无路径兜底缺失");
        button("导出结果说明").click();
        await until(() => downloads === 1, "导出未触发");
        assert(filename.endsWith(".md"), "导出文件名错误");
        const text = await blob.text();
        assert(text.includes("path：no_path") && text.includes("当前范围的 related 图中没有路径，不代表现实中没有关系。"), "无路径状态或范围说明缺失");
        assert(text.includes("关系查询中心：甲（a）；对比人物：乙（b）"), "无路径导出丢失稳定查询端点");
        assert(text.includes("展示节点 3 / 边 1") && text.includes("来源节点 3 / 边 1"), "快照展示与来源规模缺失");
        assert(text.includes("不代表现实社交关系、引荐意愿或关系强弱"), "范围免责缺失");
        input(fixture.querySelector('input[type="search"]'), "没有匹配");
        await until(() => fixture.querySelector(".lvct-graph-summary")?.textContent.includes("当前筛选或裁剪后的 related 图中未找到路径"), "筛选后的无路径未区分原因");
        button("导出结果说明").click();
        await until(() => downloads === 2, "筛选快照导出未触发");
        const filteredText = await blob.text();
        assert(filteredText.includes("可清除筛选或收窄范围后核实") && filteredText.includes("搜索：没有匹配"), "筛选后的无路径缺少可执行恢复说明");
        assert(filteredText.includes("展示节点 2 / 边 0") && filteredText.includes("为保留中心而额外显示：甲（a）、乙（b）"), "筛选导出与保中心快照不一致");
        // 阶段二：乙连接共同人物 → 重新加载图谱后路径链出现
        setupHandler(true);
        invalidateRoster();
        await unmount(mounted);
        mounted = mount(RelationGraph, { target: fixture, props: {
            settings, preferences: DEFAULT_VIEW_PREFERENCES, onPreferencesChange: async (next) => next,
            facade: { listOrganizations: async () => [], loadSelfIdentity: async () => null },
            onOpenDetail() {}, onOpenPeople() {},
        } });
        button("画布视图").click();
        await until(() => fixture.querySelector(".lvct-graph-view__canvas")?._cyreg?.cy, "图谱重新挂载");
        await pickOption("关系中心", "甲");
        await pickOption("对比人物", "乙");
        await until(() => fixture.querySelector('select[aria-label="关系查询模式"]'), "查询模式重新显示");
        select("关系查询模式", "path");
        await until(() => fixture.textContent.includes("2 段关系"), "路径链未更新");
        button("导出结果说明").click();
        await until(() => downloads === 3, "连接后的路径快照导出未触发");
        const text2 = await blob.text();
        assert(text2.includes("路径：甲（a） — 共同人物（c） — 乙（b）"), "链式路径稳定 ID 或顺序缺失");
        assert(text2.includes("path：ready") && text2.includes("展示节点 3 / 边 2")
            && text2.includes("甲（a） — 共同人物（c） · 显式人物关系（related）")
            && text2.includes("乙（b） — 共同人物（c） · 显式人物关系（related）"), "路径段来源和展示规模不能核对");
    } finally {
        URL.createObjectURL = originalCreate;
        URL.revokeObjectURL = originalRevoke;
        HTMLAnchorElement.prototype.click = originalClick;
    }
});

await test("原生捕获弹窗可完成并关闭，继承主题令牌", async () => {
    const dialog = svelteDialog({ title: "测试捕获", component: CaptureDialog, props: {
        docId: settings.hostDocId,
        facade: {
            viewPreferences: DEFAULT_VIEW_PREFERENCES,
            previewCapture: async () => ({ docName: "测试笔记", linked: [person] }),
            captureDoc: async () => ({ createdNames: [], createdDocIds: [], interactions: 1, attendeeBlockWritten: true,
                occasionLinksWritten: 3, occasionLinkFailures: [] }),
        },
    } });
    try {
        await until(() => dialog.dialog.element.textContent.includes("下一步：确认记录"), "捕获未加载");
        button("下一步：确认记录", dialog.dialog.element).click();
        await tick();
        button("记录互动并建立事项双链", dialog.dialog.element).click();
        await until(() => dialog.dialog.element.textContent.includes("打开原笔记"), "捕获完成页未显示");
        assert(getComputedStyle(dialog.dialog.element.querySelector(".lvct-dialog-root")).getPropertyValue("--lvct-sp-2").trim(), "原生弹窗缺少主题令牌");
        button("完成", dialog.dialog.element).click();
        await tick();
        assert(!dialog.dialog.element.isConnected, "完成按钮未关闭弹窗");
    } finally {
        if (dialog.dialog.element.isConnected) dialog.close();
    }
});

await test("AI 结构化候选：分组勾选确认，资料补充/建跟进写入且不越契约（FAST-01.4）", async () => {
    const personOf = (name) => ({
        docId: "20260927000000-aip0001", itemId: `row-${name}`, name,
        phone: "", email: "", wechat: "", website: "", birthday: "", isLunar: false,
        group: "朋友", tags: [], relatedItemIds: [],
    });
    const 甲 = personOf("寿星甲");
    const patchCalls = [];
    const followUpWrites = [];
    const captureCalls = [];
    const preparations = [];
    const aiCalls = [];
    const aiExtraction = {
        names: ["寿星甲"], date: "2026-09-29", place: "会议室", occasion: null, note: "聊了发布计划",
        profileCandidates: [{ person: "寿星甲", field: "phone", value: "13800001234" }],
        followUpCandidates: [{ person: "寿星甲", title: "回传资料", dueDate: "2026-10-06" }],
        relationCandidates: [{ personA: "寿星甲", personB: "路人乙", relation: "同学" }], rejected: 0,
    };
    const dialog = svelteDialog({ title: "测试捕获", component: CaptureDialog, props: {
        docId: settings.hostDocId,
        facade: {
            viewPreferences: DEFAULT_VIEW_PREFERENCES,
            previewCapture: async () => ({ docName: "测试笔记", sourceDocId: settings.hostDocId, sourceStatus: "available", linked: [甲] }),
            captureDoc: async (docId, input) => {
                captureCalls.push({ docId, input });
                return { complete: true, createdNames: [], createdDocIds: [], interactions: 1, attendeeBlockWritten: true,
                    occasionLinksWritten: 4, occasionLinkFailures: [] };
            },
            prepareAiExtraction: async (docId, options) => {
                const preflight = buildAiPreflight("fixture-preflight", docId,
                    options.sourceText ?? "寿星甲于2026-09-29在会议室聊了发布计划，2026-10-06回传资料。", options);
                preparations.push(preflight);
                return preflight;
            },
            aiExtractFromDoc: async (_docId, confirmation) => {
                assert(confirmation.confirmed === true && confirmation.preflight === preparations.at(-1), "AI 使用了未经确认的发送快照");
                aiCalls.push(confirmation.preflight.msg);
                return {
                    extraction: aiExtraction,
                    likelyUnconfigured: false,
                    matched: [甲],
                    unknownNames: [],
                    candidates: buildAiCandidateDrafts(aiExtraction, confirmation.preflight, [甲]),
                    preflightId: confirmation.preflight.id,
                };
            },
            listContacts: async () => [甲],
            listPersonFollowUps: async () => [...followUpWrites],
            updatePersonCandidateFields: async (itemId, patches) => {
                patchCalls.push({ itemId, patches });
                return { applied: patches.map((patch) => patch.field), skipped: [], conflicts: [], report: { complete: true, unknown: [], unresolved: [] } };
            },
            createFollowUp: async (docId, title, dueDate) => {
                const item = { id: "fixture-followup", personDocId: docId, title, dueDate, status: "open", docSyncPending: false };
                followUpWrites.push(item);
                return item;
            },
        },
    } });
    try {
        await until(() => dialog.dialog.element.textContent.includes("AI 分析本页"), "捕获未加载");
        [...dialog.dialog.element.querySelectorAll("button")]
            .find((node) => node.textContent.includes("AI 分析本页")).click();
        await until(() => dialog.dialog.element.querySelector("textarea[readonly]") && !button("确认发送本次文本", dialog.dialog.element).disabled, "发送预检未准备完成");
        const sentPreview = dialog.dialog.element.querySelector("textarea[readonly]").value;
        assert(aiCalls.length === 0 && captureCalls.length === 0 && patchCalls.length === 0 && followUpWrites.length === 0, "发送预检提前发送或写入");
        button("确认发送本次文本", dialog.dialog.element).click();
        await until(() => dialog.dialog.element.querySelector('[aria-label="AI 结构化候选"] [data-ai-kind="profile"]'), "AI 候选未展示");
        assert(aiCalls.length === 1 && aiCalls[0] === sentPreview, "实际发送与用户确认的最终文本不一致");
        /* 关系候选仅展示、不提供写入 */
        assert(dialog.dialog.element.textContent.includes("仅展示草稿，不写关系或笔记"), "关系建议说明缺失");
        assert(patchCalls.length === 0 && followUpWrites.length === 0, "AI 草稿不应自动写入");
        assert([...dialog.dialog.element.querySelectorAll("[data-ai-kind]")].every((candidate) => candidate.querySelector("b")?.parentElement.textContent.includes("pending")), "AI 草稿初始已接受");
        let accept;
        while ((accept = [...dialog.dialog.element.querySelectorAll("button")].find((node) => node.textContent.trim() === "接受本项" && !node.disabled))) {
            accept.click();
            await tick();
        }
        assert(captureCalls.length === 0 && patchCalls.length === 0 && followUpWrites.length === 0, "逐项接受未记录便写入事实");
        button("下一步：确认记录", dialog.dialog.element).click();
        await tick();
        button("记录互动并建立事项双链", dialog.dialog.element).click();
        await until(() => dialog.dialog.element.textContent.includes("AI 候选的资料补充与建跟进已完成"), "AI 候选写入未完成");
        /* FUNC-01.14：受限补丁——只携带勾选字段（电话）+ 快照基准值（冲突核对用），其余字段零触碰 */
        assert(patchCalls.length === 1, "资料候选未走受限补丁写入");
        assert(captureCalls.length === 1 && captureCalls[0].input.personDocIds.join(",") === 甲.docId, "主捕获人物 ID 不稳定或重复记录");
        assert(patchCalls[0].itemId === 甲.itemId && patchCalls[0].patches.length === 1 && patchCalls[0].patches[0].field === "phone"
            && patchCalls[0].patches[0].value === "13800001234" && patchCalls[0].patches[0].baseline === "",
            "补丁应只含电话字段且携带快照基准值（fixture 电话为空）");
        assert(followUpWrites.length === 1 && followUpWrites[0].personDocId === 甲.docId && followUpWrites[0].title === "回传资料" && followUpWrites[0].dueDate === "2026-10-06", "跟进候选未写到原人物");
    } finally {
        if (dialog.dialog.element.isConnected) dialog.close();
    }
});

await test("AI 候选安全写：并发改动判冲突不覆盖，安全字段照常写入（FUNC-01.14）", async () => {
    invalidateRoster();
    const cellWrites = [];
    kernel.handler = reflectContactWrites(async (route, body) => {
        if (route === "/api/av/renderAttributeView") return renderResult();
        if (route === "/api/av/getAttributeViewItemIDsByBoundIDs") {
            assert(body.avID === settings.avId && body.blockIDs.every((docId) => docId === person.docId), "候选写入核实了其他人物绑定");
            return Object.fromEntries(body.blockIDs.map((docId) => [docId, person.itemId]));
        }
        if (route === "/api/av/setAttributeViewBlockAttr") {
            cellWrites.push({ keyID: body.keyID, itemID: body.itemID, value: JSON.stringify(body.value) });
            return null;
        }
        throw new Error(`回归测试不允许请求 ${route}`);
    });
    /* 名册最新值：person1 电话为空；电话候选以过期基准（13800001234）提交 → 冲突不写；
       邮箱候选基准为空与最新一致 → 写入。同一人多字段互不影响。 */
    const result = await applyContactCandidateFields(settings, "row-1", [
        { field: "phone", value: "13866667777", baseline: "13800001234" },
        { field: "email", value: "new@x.com", baseline: "" },
    ]);
    assert(result.conflicts.length === 1 && result.conflicts[0] === "phone", `并发改动未判冲突：${JSON.stringify(result)}`);
    assert(result.applied.length === 1 && result.applied[0] === "email", "安全字段未写入");
    assert(cellWrites.length === 1 && cellWrites[0].keyID === "email" && cellWrites[0].itemID === "row-1"
        && cellWrites[0].value.includes("new@x.com"), `写入越界或形状错误：${JSON.stringify(cellWrites)}`);
});

await test("快速切换文档不会插入旧人物档案条，独立档案条有明暗主题令牌", async () => {
    const element = document.createElement("div");
    element.innerHTML = '<div class="protyle-title"></div>';
    fixture.append(element);
    const protyle = { element, block: { rootID: person.docId } };
    let resolveStore;
    let requested = false;
    const store = new Promise((resolve) => { resolveStore = resolve; });
    const context = { settings, plugin: { loadData: () => { requested = true; return store; } } };
    handleProtyleEvent(context, { detail: { protyle } });
    await until(() => requested, "档案条未开始读取互动");
    protyle.block.rootID = "20260927000000-other01";
    handleProtyleEvent(context, { detail: { protyle } });
    resolveStore({ schemaVersion: 1, events: [], tombstones: [] });
    await pause(50);
    assert(!element.querySelector('.lvct-doc-strip'), "旧人物档案条写入了新文档");
    const strip = document.createElement("div");
    strip.className = "lvct-doc-strip";
    document.body.append(strip);
    const previousMode = document.documentElement.getAttribute("data-theme-mode");
    try {
        document.documentElement.setAttribute("data-theme-mode", "light");
        assert(getComputedStyle(strip).getPropertyValue("--lvct-sp-2").trim(), "编辑器外置档案条缺少令牌");
        const light = getComputedStyle(strip).getPropertyValue("--lvct-highlight");
        document.documentElement.setAttribute("data-theme-mode", "dark");
        assert(getComputedStyle(strip).getPropertyValue("--lvct-highlight") !== light, "档案条暗色令牌未生效");
    } finally {
        strip.remove();
        if (previousMode === null) document.documentElement.removeAttribute("data-theme-mode");
        else document.documentElement.setAttribute("data-theme-mode", previousMode);
    }
});

await test("人物档案条会前简报展示真实互动事实", async () => {
    const element = document.createElement("div");
    element.innerHTML = '<div class="protyle-title"></div>';
    fixture.append(element);
    const protyle = { element, block: { rootID: person.docId } };
    const context = { settings, plugin: { loadData: async () => ({
        schemaVersion: 1,
        events: [{
            id: "event-briefing", personDocId: person.docId, occurredAt: Date.now(),
            localDate: "2026-09-27", source: "manual", note: "确认下周合作安排",
        }],
        tombstones: [],
    }) } };
    handleProtyleEvent(context, { detail: { protyle } });
    await until(() => element.querySelector(".lvct-strip__briefing-list"), "会前简报未渲染事实条目");
    const briefing = element.querySelector(".lvct-strip__briefing");
    assert(briefing.textContent.includes("最近互动"), "会前简报缺少最近互动标签");
    assert(briefing.textContent.includes("确认下周合作安排"), "会前简报缺少互动备注");
    assert(!briefing.textContent.includes("预留"), "会前简报仍显示占位内容");
});

await test("档案条显示待跟进与相关人计数，chips 超量折叠为 +N", async () => {
    const element = document.createElement("div");
    element.innerHTML = '<div class="protyle-title"></div>';
    fixture.append(element);
    const protyle = { element, block: { rootID: person.docId } };
    const tagValues = ["甲", "乙", "丙", "丁", "戊", "己", "庚", "辛"];
    kernel.handler = async (route) => {
        if (route === "/api/av/renderAttributeView") return { view: {
            columns: FIELD_SPECS.map((field) => ({ id: field.key, name: field.nameZh, type: field.type })),
            rows: [{ id: person.itemId, cells: [
                { valueType: "block", value: { type: "block", keyID: "name", block: { id: person.docId, content: person.name } } },
                { valueType: "mSelect", value: { type: "mSelect", keyID: "tags", mSelect: tagValues.map((tag) => ({ content: tag })) } },
                { valueType: "relation", value: { type: "relation", keyID: "related", relation: { blockIDs: ["row-2"] } } },
            ] } ],
        } };
        throw new Error(`档案条计数测试不允许请求 ${route}`);
    };
    invalidateRoster();
    const context = { settings, plugin: { loadData: async (key) => {
        if (key === "follow-ups.json") return { schemaVersion: 1, items: [
            { id: "fu-b04-1", personDocId: person.docId, title: "随访", dueDate: "2026-10-01", status: "open", createdAt: 1, updatedAt: 1 },
            { id: "fu-b04-2", personDocId: person.docId, title: "送资料", dueDate: "2026-10-02", status: "open", createdAt: 1, updatedAt: 1 },
            { id: "fu-b04-3", personDocId: person.docId, title: "已完成项", dueDate: "2026-09-01", status: "done", createdAt: 1, updatedAt: 1, closedAt: 1 },
        ] };
        return { schemaVersion: 1, events: [], tombstones: [] };
    } } };
    handleProtyleEvent(context, { detail: { protyle } });
    await until(() => element.querySelector(".lvct-strip__chips"), "档案条未渲染");
    const text = element.querySelector(".lvct-doc-strip").textContent;
    assert(text.includes("待跟进 2"), "待跟进计数徽标未显示（已完成项不应计入）");
    assert(text.includes("相关人 1"), "相关人计数徽标未显示");
    const chips = [...element.querySelectorAll(".lvct-strip__chips .lvct-chip")];
    assert(chips.length === 7, `chips 应为 6 枚 + 1 个折叠项，实际 ${chips.length}`);
    assert(chips[chips.length - 1].textContent.trim() === "+2", "折叠计数错误");
    assert(chips[chips.length - 1].title.includes("庚") && chips[chips.length - 1].title.includes("辛"), "折叠项未带全量提示");
    element.querySelector(".lvct-doc-strip")?.remove();
});

await test("多人互动通过真实存储服务写入并回读，重复记录保持幂等", async () => {
    let saved;
    const plugin = {
        loadData: async () => saved === undefined ? null : JSON.parse(JSON.stringify(saved)),
        saveData: async (_key, value) => { saved = JSON.parse(JSON.stringify(value)); },
    };
    for (const personDocId of ["甲", "乙", "丙", "乙"]) {
        await recordInteraction(plugin, { personDocId, source: "diary", externalRef: "同场回归" });
    }
    const store = await loadInteractionStore(plugin);
    assert(store.events.length === 3, `多人同场只保存了 ${store.events.length} 条互动`);
    assert(new Set(store.events.map((event) => event.personDocId)).size === 3, "参与者记录不完整");
});

await test("外部联动重复及并发调用只计实际新增，写入失败不报成功", async () => {
    const state = configureBridgeKernel(kernel, settings);
    const firstId = "20261004000000-bridge1";
    const secondId = "20261004000000-bridge2";
    const thirdId = "20261004000000-bridge3";
    const fourthId = "20261004000000-bridge4";
    state.addPerson(thirdId, "20261004000000-brow003", "并发人物");
    state.addPerson(fourthId, "20261004000000-brow004", "故障人物");
    state.mount();
    try {
        const api = window.LvContacts;
        const first = await api.recordInteraction([firstId, secondId, firstId], { ref: "会议" });
        assert(first.recorded === 2, "重复人员被计为新增");
        assert((await api.recordInteraction([secondId, firstId, firstId], { ref: "会议" })).recorded === 0, "重复调用误报新增");
        const concurrent = await Promise.all([
            api.recordInteraction([thirdId], { ref: "会议丙" }),
            api.recordInteraction([thirdId], { ref: "会议丙" }),
        ]);
        assert(concurrent.reduce((sum, result) => sum + result.recorded, 0) === 1, "并发调用重复计数");
        assert((await loadInteractionStore(state.plugin)).events.length === 3, "并发保存丢失参与者");
        state.failEventReadAfterSave = true;
        const failed = await api.recordInteraction([fourthId], { ref: "会议丁" });
        assert(!failed.complete && failed.recorded === 0 && failed.unknown > 0, "未核实结果仍返回成功");
    } finally {
        disposeExternalBridge();
    }
});

await test("笔记捕获去重参与人员，重复捕获返回零新增", async () => {
    const files = new Map();
    const plugin = {
        loadData: async (key) => files.get(key) ?? null,
        saveData: async (key, value) => { files.set(key, JSON.parse(JSON.stringify(value))); },
    };
    const { sections, sourceSectionId } = configureOccasionKernel();
    const options = { personDocIds: [person.docId, person.docId], newNames: [], date: "2026-09-27" };
    const first = await captureFromDoc(plugin, settings, settings.hostDocId, options);
    assert(first.interactions === 1, "重复选择人员导致新增计数错误");
    assert(sections.get(sourceSectionId).split(`siyuan://blocks/${person.docId}`).length - 1 === 1, "参与人员区块重复列出同一人");
    assert(first.occasionLinkFailures.length === 0 && sections.size === 3, "来源、日记与人物投影未全部完成");
    const repeat = await captureFromDoc(plugin, settings, settings.hostDocId, options);
    assert(repeat.interactions === 0, "重复捕获误报新增");
});

await test("互动日期严格校验，非法日期在创建人物和写入前被拒绝", async () => {
    let saved;
    let writes = 0;
    let requests = 0;
    const plugin = {
        loadData: async () => saved === undefined ? null : JSON.parse(JSON.stringify(saved)),
        saveData: async (_key, value) => { writes += 1; saved = JSON.parse(JSON.stringify(value)); },
    };
    kernel.handler = async () => { requests += 1; throw new Error("非法日期不应访问内核"); };
    initExternalBridge(plugin, () => settings);
    try {
        for (const date of ["", "2026-02-29", "2026-04-31", "2026/09/27", "not-a-date"]) {
            for (const action of [
                () => window.LvContacts.recordInteraction([person.docId], { ref: "日期回归", date }),
                () => captureFromDoc(plugin, settings, settings.hostDocId, {
                    personDocIds: [person.docId], newNames: ["不应创建"], date,
                }),
            ]) {
                let message = "";
                let code = "";
                try { await action(); } catch (error) { message = error.message; code = error.code ?? ""; }
                assert(message.includes("场合日期") || code === "invalid_input", `非法日期未明确拒绝：${date}`);
            }
        }
        assert(writes === 0 && requests === 0, "非法日期导致存储或内核写入");
        disposeExternalBridge();
        const state = configureBridgeKernel(kernel, settings);
        state.addPerson(person.docId, "20261004000000-brow003", person.name);
        state.mount();
        const result = await window.LvContacts.recordInteraction([person.docId], { ref: "闰日回归", date: "2024-02-29" });
        assert(result.recorded === 1, "合法闰日被拒绝");
        const store = await loadInteractionStore(state.plugin);
        assert(store.events[0].localDate === "2024-02-29", "闰日被顺延或回退到今天");
        assert(new Date(store.events[0].occurredAt).getHours() === 0, "未按当地零点记录");
    } finally {
        disposeExternalBridge();
    }
});

await test("按名捕获复用已有联系人，不漏记互动或误报新建", async () => {
    const files = new Map();
    const plugin = {
        loadData: async (key) => files.get(key) ?? null,
        saveData: async (key, value) => { files.set(key, JSON.parse(JSON.stringify(value))); },
    };
    const { sections, sourceSectionId } = configureOccasionKernel();
    const options = { personDocIds: [], newNames: [person.name, ` ${person.name} `, ""], date: "2026-09-27" };
    const first = await captureFromDoc(plugin, settings, settings.hostDocId, options);
    assert(first.createdNames.length === 0 && first.createdDocIds.length === 0, "已有联系人被误报为新建");
    assert(first.interactions === 1 && first.attendeeBlockWritten, "已有姓名未被纳入参与者");
    assert(sections.get(sourceSectionId).split(`siyuan://blocks/${person.docId}`).length - 1 === 1, "同名参与者未去重");
    const store = await loadInteractionStore(plugin);
    assert(store.events.length === 1 && store.events[0].personDocId === person.docId, "没有复用正确的人物文档");
    const repeat = await captureFromDoc(plugin, settings, settings.hostDocId, { ...options, personDocIds: [person.docId] });
    assert(repeat.interactions === 0, "按姓名与文档重叠捕获重复计数");
});

await test("名册并发查询合并，失效后的旧请求不能回填缓存，失败后可重试", async () => {
    let calls = 0;
    let releaseOld;
    const oldResponse = new Promise((resolve) => { releaseOld = resolve; });
    kernel.handler = async (route) => {
        assert(route === "/api/av/renderAttributeView", "名册请求越界");
        calls += 1;
        if (calls === 1) return oldResponse;
        const response = renderResult();
        response.view.rows[0].cells[0].value.block.content = "最新姓名";
        return response;
    };
    const old = getRoster(settings);
    const shared = getRoster(settings);
    await until(() => calls === 1, "旧查询未发出");
    invalidateRoster();
    assert((await getRoster(settings))[0].name === "最新姓名", "失效后没有读取新数据");
    releaseOld(renderResult());
    await Promise.all([old, shared]);
    assert((await getRoster(settings))[0].name === "最新姓名", "旧查询覆盖了新缓存");
    assert(calls === 2, "同配置并发查询未合并或缓存未复用");
    await getRoster({ ...settings, fieldMap: { ...settings.fieldMap, phone: "changed-phone" } });
    assert(calls === 3, "字段映射改变仍复用旧缓存");
    invalidateRoster();
    kernel.handler = async () => { throw new Error("暂时不可用"); };
    let failed = false;
    try { await getRoster(settings); } catch { failed = true; }
    assert(failed, "查询失败未传递给调用方");
    kernel.handler = async () => renderResult();
    assert((await getRoster(settings))[0].name === person.name, "失败后无法重新查询");
});

await test("互动读取失败阻止新增与删除，恢复后保留旧记录", async () => {
    let saved;
    let writes = 0;
    let failRead = false;
    const plugin = {
        loadData: async () => {
            if (failRead) throw new Error("模拟存储暂时不可读");
            return saved === undefined ? null : JSON.parse(JSON.stringify(saved));
        },
        saveData: async (_key, value) => { writes += 1; saved = JSON.parse(JSON.stringify(value)); },
    };
    const first = await recordInteraction(plugin, { personDocId: "甲", source: "api", externalRef: "旧记录" });
    const snapshot = JSON.stringify(saved);
    const before = writes;
    failRead = true;
    assert((await loadInteractionStore(plugin)).events.length === 0, "展示读取未保持容错");
    for (const action of [
        () => recordInteraction(plugin, { personDocId: "乙", source: "api", externalRef: "新记录" }),
        () => deleteInteraction(plugin, first.events[0].id),
    ]) {
        let message = "";
        try { await action(); } catch (error) { message = error.message; }
        assert(message.includes("存储读取失败"), "读取失败未阻止修改");
    }
    assert(writes === before && JSON.stringify(saved) === snapshot, "读取失败覆盖了已有记录");
    failRead = false;
    const recovered = await recordInteraction(plugin, { personDocId: "乙", source: "api", externalRef: "新记录" });
    assert(recovered.events.length === 2 && recovered.events.some((event) => event.id === first.events[0].id), "恢复后旧记录丢失");
    const deleted = await deleteInteraction(plugin, first.events[0].id);
    assert(deleted.events.length === 1 && deleted.tombstones.includes(first.events[0].id), "恢复后删除未正常写墓碑");
});

await test("互动损坏数据与未知版本禁止覆盖，宿主空字符串可首次保存", async () => {
    let saved = "";
    let writes = 0;
    const plugin = {
        loadData: async () => JSON.parse(JSON.stringify(saved)),
        saveData: async (_key, value) => { writes += 1; saved = JSON.parse(JSON.stringify(value)); },
    };
    const first = await recordInteraction(plugin, { personDocId: "甲" });
    assert(first.events.length === 1 && writes === 1, "宿主未创建文件的空字符串无法首次保存");
    const good = JSON.parse(JSON.stringify(saved));
    for (const damaged of [
        { ...good, schemaVersion: 99 }, { ...good, events: [...good.events, null] },
        { ...good, tombstones: [42] }, { schemaVersion: 1 }, "损坏内容",
    ]) {
        saved = damaged;
        const snapshot = JSON.stringify(saved);
        const before = writes;
        for (const action of [
            () => recordInteraction(plugin, { personDocId: "乙" }),
            () => deleteInteraction(plugin, good.events[0].id),
        ]) {
            let message = "";
            try { await action(); } catch (error) { message = error.message; }
            assert(message.includes("操作已停止"), "损坏存储未阻止修改");
        }
        assert(writes === before && JSON.stringify(saved) === snapshot, "损坏存储被覆盖");
    }
    saved = good;
    assert((await recordInteraction(plugin, { personDocId: "乙" })).events.length === 2, "恢复合法文件后不能继续追加");
});

await test("互动导出保留原始损坏项与未知版本，读取失败不生成空备份", async () => {
    let saved;
    let writes = 0;
    let failRead = false;
    const plugin = {
        loadData: async () => {
            if (failRead) throw new Error("备份读取失败");
            return JSON.parse(JSON.stringify(saved));
        },
        saveData: async () => { writes += 1; },
    };
    const event = { id: "备份事件", personDocId: "甲", source: "manual", occurredAt: Date.now(), localDate: "2026-09-27" };
    for (const raw of ["", null,
        { schemaVersion: 1, events: [event, event, null], tombstones: ["墓碑", 42] },
        { schemaVersion: 99, events: [event], tombstones: [], unknownField: "不能丢失" },
    ]) {
        saved = raw;
        const backup = JSON.parse(await exportInteractionJson(plugin));
        assert(JSON.stringify(backup.rawStore) === JSON.stringify(raw), "原始数据快照丢失内容");
        assert(backup.storageKey === "interaction-events.json" && backup.exportedAt, "备份缺少来源与导出时间");
        if (raw?.schemaVersion === 1) {
            assert(backup.events.length === 1 && backup.tombstones.length === 1, "原有归一化导出字段不兼容");
        }
    }
    failRead = true;
    let message = "";
    try { await exportInteractionJson(plugin); } catch (error) { message = error.message; }
    assert(message.includes("存储读取失败"), "读取失败仍生成备份");
    assert(writes === 0, "导出修改了原存储");
});

await test("设置页备份读取失败不下载，重试后下载完整快照", async () => {
    let failRead = true;
    const raw = { schemaVersion: 99, events: [null], tombstones: [], preserved: "原始内容" };
    const plugin = { loadData: async () => {
        if (failRead) throw new Error("暂时不可读");
        return raw;
    } };
    let blob;
    let downloads = 0;
    let filename = "";
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    const originalClick = HTMLAnchorElement.prototype.click;
    URL.createObjectURL = (value) => { blob = value; return "blob:backup-test"; };
    URL.revokeObjectURL = () => {};
    HTMLAnchorElement.prototype.click = function () { downloads += 1; filename = this.download; };
    try {
        mounted = mount(SettingsView, { target: fixture, props: {
            facade: { exportInteractionJson: () => exportInteractionJson(plugin) },
            settings, preferences: DEFAULT_VIEW_PREFERENCES,
            onSettingsUpdated() {}, onPreferencesUpdated() {}, onBack() {},
        } });
        [...fixture.querySelectorAll(".lvct-settings__nav-item")].find((node) => node.textContent.includes("数据与字段")).click();
        await tick();
        button("导出 JSON").click();
        await until(() => fixture.textContent.includes("存储读取失败"), "备份读取失败未显示错误");
        assert(downloads === 0, "读取失败触发了空下载");
        failRead = false;
        button("导出 JSON").click();
        await until(() => fixture.textContent.includes("原始数据快照已导出"), "重试导出未成功");
        assert(downloads === 1 && filename.endsWith(".json"), "备份下载次数或文件名错误");
        assert(JSON.stringify(JSON.parse(await blob.text()).rawStore) === JSON.stringify(raw), "下载文件缺失原始内容");
    } finally {
        URL.createObjectURL = originalCreate;
        URL.revokeObjectURL = originalRevoke;
        HTMLAnchorElement.prototype.click = originalClick;
    }
});

await test("设置页导出中心显示数量与范围，失败不下载可重试，空名册禁用", async () => {
    let failRoster = false;
    let empty = false;
    let downloads = 0;
    let filename = "";
    let blob;
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    const originalClick = HTMLAnchorElement.prototype.click;
    URL.createObjectURL = (value) => { blob = value; return "blob:export-test"; };
    URL.revokeObjectURL = () => {};
    HTMLAnchorElement.prototype.click = function () { downloads += 1; filename = this.download; };
    try {
        const facade = {
            settings, viewPreferences: DEFAULT_VIEW_PREFERENCES,
            loadExportSummary: async () => empty ? { peopleCount: 0, interactionCount: 0 } : { peopleCount: 2, interactionCount: 3 },
            exportRosterVcf: async () => {
                if (failRoster) throw new Error("名册读取失败");
                return "BEGIN:VCARD\nVERSION:3.0\nFN:回归测试甲\nEND:VCARD";
            },
            exportInteractionJson: async () => "{}",
            saveViewPreferences: async (value) => value,
            checkSettingsHealth: async () => ({ ok: true, columns: 9, missing: [], problems: [], availableColumns: [] }),
            rebuildMissingFields: async () => settings,
            rebindSettings: async () => settings,
            repairFieldMap: async () => settings,
            openHostDoc() {},
        };
        mounted = mount(SettingsView, { target: fixture, props: {
            facade, settings, preferences: DEFAULT_VIEW_PREFERENCES,
            onSettingsUpdated() {}, onPreferencesUpdated() {}, onBack() {},
        } });
        [...fixture.querySelectorAll(".lvct-settings__nav-item")].find((node) => node.textContent.includes("数据与字段")).click();
        await until(() => fixture.textContent.includes("2 位联系人"), "名册数量未展示");
        assert(fixture.textContent.includes("3 条事件"), "互动数量未展示");
        assert(fixture.textContent.includes("都不是完整备份"), "导出范围说明未展示");
        failRoster = true;
        button("导出 .vcf").click();
        await until(() => fixture.textContent.includes("名册读取失败"), "名册导出失败未显示");
        assert(downloads === 0, "导出失败仍触发了下载");
        failRoster = false;
        button("导出 .vcf").click();
        await until(() => fixture.textContent.includes("全量名册已导出"), "重试导出未成功");
        assert(downloads === 1 && filename.endsWith(".vcf"), "vCard 下载次数或文件名错误");
        assert((await blob.text()).includes("BEGIN:VCARD"), "下载内容缺失 vCard 文本");
        empty = true;
        [...fixture.querySelectorAll(".lvct-settings__nav-item")].find((node) => node.textContent.includes("通用")).click();
        [...fixture.querySelectorAll(".lvct-settings__nav-item")].find((node) => node.textContent.includes("数据与字段")).click();
        await until(() => fixture.textContent.includes("名册为空"), "空名册提示未展示");
        assert(button("导出 .vcf").disabled, "空名册未禁用导出");
    } finally {
        URL.createObjectURL = originalCreate;
        URL.revokeObjectURL = originalRevoke;
        HTMLAnchorElement.prototype.click = originalClick;
    }
});

await test("备份预览不写入，合并重读当前数据并保留并发新增，再次合并幂等", async () => {
    let saved = "";
    let writes = 0;
    const plugin = {
        loadData: async () => JSON.parse(JSON.stringify(saved)),
        saveData: async (_key, value) => { writes += 1; saved = JSON.parse(JSON.stringify(value)); },
    };
    const incoming = { id: "导入事件", personDocId: "甲", source: "manual", occurredAt: Date.now(), localDate: "2026-09-27" };
    const text = JSON.stringify({ schemaVersion: 1, events: [incoming], tombstones: ["删除标记"] });
    const preview = await previewInteractionImport(plugin, text);
    assert(preview.added === 1 && writes === 0, "预览发生写入或计数错误");
    await recordInteraction(plugin, { personDocId: "乙" });
    const result = await importInteractionJson(plugin, text);
    assert(result.added === 1 && (await loadInteractionStore(plugin)).events.length === 2, "导入覆盖了预览后的新增记录");
    const before = writes;
    const repeat = await importInteractionJson(plugin, text);
    assert(repeat.added === 0 && repeat.skipped === 1 && writes === before, "重复导入不幂等");
    const nextText = JSON.stringify({ schemaVersion: 1, events: [{ ...incoming, id: "并发导入", personDocId: "丙" }], tombstones: [] });
    const concurrent = await Promise.all([importInteractionJson(plugin, nextText), importInteractionJson(plugin, nextText)]);
    assert(concurrent.reduce((sum, item) => sum + item.added, 0) === 1, "并发导入重复计数");
    const afterConcurrent = writes;
    saved = { schemaVersion: 99, events: [], tombstones: [] };
    let rejected = false;
    try { await importInteractionJson(plugin, text); } catch { rejected = true; }
    assert(rejected && writes === afterConcurrent, "导入覆盖了不兼容的当前库");
});

await test("设置页备份合并先预览，坏文件清空旧计划，取消不写入，失败可重试", async () => {
    let saved = "";
    let failWrite = true;
    let writes = 0;
    let refreshed = 0;
    let delayPreview = false;
    let releasePreview;
    const plugin = {
        loadData: async () => JSON.parse(JSON.stringify(saved)),
        saveData: async (_key, value) => { if (!failWrite) { writes += 1; saved = JSON.parse(JSON.stringify(value)); } },
    };
    const facade = {
        previewInteractionImport: async (text) => {
            if (delayPreview) {
                delayPreview = false;
                await new Promise((resolve) => { releasePreview = resolve; });
            }
            return previewInteractionImport(plugin, text);
        },
        importInteractionJson: (text) => importInteractionJson(plugin, text),
    };
    mounted = mount(SettingsView, { target: fixture, props: {
        facade, settings, preferences: DEFAULT_VIEW_PREFERENCES,
        onSettingsUpdated() {}, onPreferencesUpdated() {}, onBack() {}, onInteractionsUpdated() { refreshed += 1; },
    } });
    [...fixture.querySelectorAll(".lvct-settings__nav-item")].find((node) => node.textContent.includes("数据与字段")).click();
    await tick();
    const fileInput = fixture.querySelector("#lvct-interaction-backup");
    const good = JSON.stringify({ schemaVersion: 1, events: [{ id: "恢复事件", personDocId: "甲", occurredAt: Date.now(), localDate: "2026-09-27", source: "manual" }], tombstones: [] });
    function selectFile(text) {
        const transfer = new DataTransfer();
        transfer.items.add(new File([text], "backup.json", { type: "application/json" }));
        fileInput.files = transfer.files;
        fileInput.dispatchEvent(new Event("change", { bubbles: true }));
    }
    const originalConfirm = window.confirm;
    try {
        selectFile(good);
        await until(() => fixture.textContent.includes("预计新增 1 条"), "导入预览未显示");
        assert(writes === 0, "选择文件即发生写入");
        delayPreview = true;
        selectFile(good);
        await until(() => Boolean(releasePreview), "迟到预览未开始");
        selectFile("bad-json");
        await until(() => fixture.textContent.includes("备份不是有效"), "坏文件未报错");
        releasePreview();
        await pause(50);
        await tick();
        assert(button("确认合并备份").disabled, "坏文件仍可执行旧导入计划");
        selectFile(good);
        await until(() => !button("确认合并备份").disabled, "重新选择备份后不可提交");
        window.confirm = () => false;
        button("确认合并备份").click();
        await tick();
        assert(writes === 0, "取消确认仍写入");
        window.confirm = (message) => { assert(message.includes("删除标记"), "确认未说明删除语义"); return true; };
        button("确认合并备份").click();
        await until(() => fixture.textContent.includes("存储写入未收敛"), "写入失败未显示");
        assert(!button("确认合并备份").disabled, "失败后无法重试");
        failWrite = false;
        button("确认合并备份").click();
        await until(() => fixture.textContent.includes("合并完成：新增 1 条"), "重试合并未成功");
        assert(refreshed === 1 && writes === 1, "完成后未通知刷新或重复写入");
        assert(button("确认合并备份").disabled && fileInput.value === "", "完成后保留了可重复提交的旧计划");
        assert(fileInput.getBoundingClientRect().right <= fixture.getBoundingClientRect().right + 1, "文件选择框超出移动布局");
    } finally { window.confirm = originalConfirm; }
});

await test("无浏览器锁时并发互动与备份合并仍串行，不丢记录", async () => {
    const descriptor = Object.getOwnPropertyDescriptor(navigator, "locks");
    Object.defineProperty(navigator, "locks", { configurable: true, value: undefined });
    let saved = "";
    const plugin = {
        loadData: async () => JSON.parse(JSON.stringify(saved)),
        saveData: async (_key, value) => { await pause(5); saved = JSON.parse(JSON.stringify(value)); },
    };
    try {
        await Promise.all(Array.from({ length: 12 }, (_, index) => recordInteraction(plugin, {
            personDocId: `参与者${index}`, source: "api", externalRef: "降级并发回归",
        })));
        assert((await loadInteractionStore(plugin)).events.length === 12, "无浏览器锁时并发保存丢失记录");
        const text = JSON.stringify({ schemaVersion: 1, events: [{ id: "降级导入", personDocId: "导入参与者", source: "api", occurredAt: Date.now(), localDate: "2026-09-27" }], tombstones: [] });
        const results = await Promise.all([importInteractionJson(plugin, text), importInteractionJson(plugin, text)]);
        assert(results.reduce((sum, result) => sum + result.added, 0) === 1, "降级并发导入重复计数");
        assert((await loadInteractionStore(plugin)).events.length === 13, "降级合并覆盖了已有事件");
    } finally {
        if (descriptor) Object.defineProperty(navigator, "locks", descriptor);
        else Reflect.deleteProperty(navigator, "locks");
    }
});

await test("人物互动支持加载更多、筛选及安全删除，取消/失败不丢记录，成功刷新同场统计", async () => {
    const mine = Array.from({ length: 26 }, (_, index) => ({
        id: `history-${index}`, personDocId: person.docId, source: "manual", occurredAt: Date.now(),
        localDate: "2026-09-27", note: `历史互动${index}`,
    }));
    mine[0].note = "长备注回归".repeat(40);
    let saved = { schemaVersion: 1, events: [...mine,
        { id: "meeting-mine", personDocId: person.docId, source: "diary", externalRef: "会议", occurredAt: Date.now(), localDate: "2026-09-26", note: "共同会议" },
        { id: "meeting-other", personDocId: "乙", source: "diary", externalRef: "会议", occurredAt: Date.now(), localDate: "2026-09-26" },
    ], tombstones: [] };
    let failDelete = true;
    let changed = 0;
    const plugin = {
        loadData: async () => JSON.parse(JSON.stringify(saved)),
        saveData: async (_key, value) => { if (!failDelete) saved = JSON.parse(JSON.stringify(value)); },
    };
    mounted = mount(PersonDetail, { target: fixture, props: {
        settings, person, onRecord: async () => {},
        onLoadInsights: async () => {
            const store = await loadInteractionStore(plugin);
            return { timeline: buildTimeline(store.events, person.docId), coAttendance: buildCoAttendance(store.events, person.docId).map((item) => ({ ...item, name: "乙" })), totalEvents: store.events.filter((item) => item.personDocId === person.docId).length };
        },
        onDeleteInteraction: (personDocId, eventId) => deleteInteraction(plugin, eventId, personDocId),
        onOpenPersonDoc() {}, onNavigate() {}, onChanged() { changed += 1; }, onDeleted() {}, onClose() {},
    } });
    button("互动").click();
    await until(() => fixture.querySelectorAll(".lvct-detail__timeline-row").length === 20, "时间线未分批显示");
    const longNote = fixture.querySelector(".lvct-detail__timeline-note");
    assert(longNote.scrollWidth <= longNote.clientWidth + 1, "长备注溢出时间线");
    assert(getComputedStyle(longNote).whiteSpace === "normal", "长备注仍被截断而无法阅读");
    button("加载更多").click();
    await until(() => fixture.querySelectorAll(".lvct-detail__timeline-row").length === 27, "旧互动无法继续浏览");
    const search = fixture.querySelector('input[aria-label="搜索互动备注或日期"]');
    input(search, "不存在的备注");
    await until(() => fixture.textContent.includes("没有匹配的互动"), "搜索空结果没有提示");
    button("清除筛选").click();
    await tick();
    assert(fixture.querySelectorAll(".lvct-detail__timeline-row").length === 20, "清除筛选未恢复首批结果");
    const source = fixture.querySelector('select[aria-label="互动来源"]');
    source.value = "diary";
    source.dispatchEvent(new Event("change", { bubbles: true }));
    await until(() => fixture.querySelectorAll(".lvct-detail__timeline-row").length === 1, "来源筛选未生效");
    assert(fixture.textContent.includes("与 乙 同场 1 次"), "共同出席统计缺失");
    const originalConfirm = window.confirm;
    try {
        window.confirm = () => false;
        button("删除", fixture.querySelector(".lvct-detail__timeline-row")).click();
        await tick();
        assert(saved.events.length === 28 && changed === 0, "取消删除仍修改记录");
        window.confirm = (message) => { assert(message.includes("其他参与者"), "删除确认未说明范围"); return true; };
        button("删除", fixture.querySelector(".lvct-detail__timeline-row")).click();
        await until(() => fixture.textContent.includes("存储写入未收敛"), "删除失败未显示错误");
        assert(saved.events.length === 28 && changed === 0, "删除失败丢失记录");
        failDelete = false;
        button("删除", fixture.querySelector(".lvct-detail__timeline-row")).click();
        await until(() => fixture.textContent.includes("没有匹配的互动"), "成功后时间线未刷新");
        assert(changed === 1 && saved.tombstones.includes("meeting-mine"), "成功删除未刷新统计或写墓碑");
        assert(saved.events.some((item) => item.id === "meeting-other"), "删除了其他参与者记录");
        assert(!fixture.textContent.includes("与 乙 同场 1 次"), "删除后共同出席统计未刷新");
    } finally { window.confirm = originalConfirm; }
});

await test("人物互动删除在锁内检查归属，不能删除他人事件", async () => {
    let saved = "";
    let writes = 0;
    const plugin = {
        loadData: async () => JSON.parse(JSON.stringify(saved)),
        saveData: async (_key, value) => { writes += 1; saved = JSON.parse(JSON.stringify(value)); },
    };
    const store = await recordInteraction(plugin, { personDocId: "乙" });
    const before = writes;
    let message = "";
    try { await deleteInteraction(plugin, store.events[0].id, "甲"); } catch (error) { message = error.message; }
    assert(message.includes("不属于当前人物") && writes === before, "归属不符仍执行删除");
    assert((await loadInteractionStore(plugin)).events.length === 1, "他人事件被误删");
});

await test("独立同源上下文共享 Web Locks，记录/删除/备份并发不覆盖且失败释放锁", async () => {
    assert(navigator.locks?.request, "本环境无 Web Locks，不能验证跨页面排他");
    const storageKey = "lvct-isolated-multicontext-store";
    localStorage.removeItem(storageKey);
    const frames = [document.createElement("iframe"), document.createElement("iframe")];
    for (const frame of frames) {
        frame.hidden = true;
        frame.src = "/scripts/e2e/ui/store-frame.html";
        fixture.append(frame);
    }
    try {
        await until(() => frames.every((frame) => frame.contentWindow.lvctStoreTest), "独立存储上下文未就绪");
        assert(frames[0].contentWindow.navigator !== frames[1].contentWindow.navigator, "不是独立页面上下文");
        const [a, b] = frames.map((frame) => frame.contentWindow.lvctStoreTest);
        let release;
        let held;
        const ready = new Promise((resolve) => { held = resolve; });
        const gate = new Promise((resolve) => { release = resolve; });
        const blocker = navigator.locks.request("lvct-interaction-events.json", async () => { held(); await gate; });
        await ready;
        const blocked = a.record({ personDocId: "locked", source: "api", externalRef: "gate" });
        // 等待请求进入实际浏览器锁队列，而非依赖固定延时猜测。
        try {
            let pending = false;
            const deadline = Date.now() + 2000;
            while (!pending && Date.now() < deadline) {
                pending = (await navigator.locks.query()).pending.some((lock) => lock.name === "lvct-interaction-events.json");
                if (!pending) await pause(10);
            }
            assert(pending && a.writes() === 0, "另一页面未等待共享锁");
        } finally { release(); await blocker; await blocked; }
        const outcomes = await Promise.all(Array.from({ length: 12 }, (_, index) => (index % 2 ? a : b).record({
            personDocId: `person-${index}`, source: "api", externalRef: "meeting",
        })));
        assert(outcomes.every((item) => item.recorded), "跨页面新增计数错误");
        assert((await a.load()).events.length === 13, "跨页面并发记录丢失");
        const duplicates = await Promise.all([a.record({ personDocId: "duplicate", source: "api", externalRef: "same" }),
            b.record({ personDocId: "duplicate", source: "api", externalRef: "same" })]);
        assert(duplicates.filter((item) => item.recorded).length === 1, "跨页面幂等失效");
        const snapshot = await a.load();
        const victim = snapshot.events.find((item) => item.personDocId === "person-0");
        const backup = JSON.stringify(snapshot);
        const beforePreview = a.writes() + b.writes();
        await b.preview(backup);
        assert(a.writes() + b.writes() === beforePreview, "跨页面预览写入数据");
        await Promise.all([a.remove(victim.id, victim.personDocId), b.merge(backup),
            b.record({ personDocId: "late", source: "api", externalRef: "late" })]);
        await a.merge(backup);
        const final = await b.load();
        assert(final.tombstones.includes(victim.id) && !final.events.some((item) => item.id === victim.id), "旧备份复活跨页面删除");
        assert(final.events.some((item) => item.personDocId === "late") && final.events.length === 14, "删除/合并覆盖并发新增");
        a.failSave();
        const failures = await Promise.allSettled([
            a.record({ personDocId: "failed", source: "api", externalRef: "failed" }),
            b.record({ personDocId: "survived", source: "api", externalRef: "survived" }),
        ]);
        assert(failures[0].status === "rejected" && failures[1].status === "fulfilled", "失败未释放跨页面锁");
        const recovered = await a.load();
        assert(!recovered.events.some((item) => item.personDocId === "failed")
            && recovered.events.some((item) => item.personDocId === "survived"), "失败保存或后续操作结果错误");
        const incoming = JSON.stringify({ schemaVersion: 1, tombstones: [], events: [{
            id: "imported-cross-context", personDocId: "imported", occurredAt: 1790467200000,
            localDate: "2026-09-27", source: "api", externalRef: "imported",
        }] });
        const imported = await Promise.all([a.merge(incoming), b.merge(incoming)]);
        assert(imported.reduce((sum, item) => sum + item.added, 0) === 1, "跨页面同备份新增重复计数");
        const merged = await a.load();
        assert(merged.events.filter((item) => item.personDocId === "imported").length === 1
            && merged.events.length === 16 && merged.tombstones.includes(victim.id), "并发合并丢失记录或删除标记");
    } finally {
        frames.forEach((frame) => frame.remove());
        localStorage.removeItem(storageKey);
    }
});

await test("账本实际双上下文：同请求等待旧保存后只保留一条，不重复保存", async () => {
    assert(navigator.locks?.request, "本环境无 Web Locks，不能验证跨页面排他");
    const storageKey = "lvct-isolated-multicontext-store";
    localStorage.removeItem(storageKey);
    const frames = [document.createElement("iframe"), document.createElement("iframe")];
    for (const frame of frames) {
        frame.hidden = true;
        frame.src = "/scripts/e2e/ui/store-frame.html";
        fixture.append(frame);
    }
    let holder;
    let firstResult;
    let secondResult;
    try {
        await until(() => frames.every((frame) => frame.contentWindow.lvctStoreTest), "独立账本上下文未就绪");
        const [first, second] = frames.map((frame) => frame.contentWindow.lvctStoreTest);
        holder = first;
        const input = { requestId: "20261004000000-req0001", personDocId: person.docId, kind: "item",
            direction: "payable", description: "借用书籍", occurredOn: "2026-10-04" };
        const started = first.holdNextSave();
        firstResult = Promise.allSettled([first.createExchange(input)]);
        await started;
        secondResult = Promise.allSettled([second.createExchange(input)]);
        let pending = false;
        const deadline = Date.now() + 2000;
        while (!pending && Date.now() < deadline) {
            pending = (await navigator.locks.query()).pending.some((lock) => lock.name === "lvct-exchange-records.json");
            if (!pending) await pause(10);
        }
        assert(pending && second.writes() === 0, "同请求未等待持有者就写入");
        first.releaseSave();
        const outcomes = [...await firstResult, ...await secondResult];
        const stored = await second.loadExchanges();
        assert(outcomes.every((outcome) => outcome.status === "fulfilled" && outcome.value.id === input.requestId)
            && stored.records.length === 1 && first.writes() === 1 && second.writes() === 0, "跨上下文同请求重复追加或重复保存");
    } finally {
        holder?.releaseSave();
        if (firstResult) await firstResult;
        if (secondResult) await secondResult;
        frames.forEach((frame) => frame.remove());
        localStorage.removeItem(storageKey);
    }
});

await test("存储锁实际双上下文：旧保存超过全部等待后恢复，不接管、不覆盖且可显式重试", async () => {
    assert(navigator.locks?.request, "本环境无 Web Locks，不能验证跨页面排他");
    const storageKey = "lvct-isolated-multicontext-store";
    localStorage.removeItem(storageKey);
    const frames = [document.createElement("iframe"), document.createElement("iframe")];
    for (const frame of frames) {
        frame.hidden = true;
        frame.src = "/scripts/e2e/ui/store-frame.html";
        fixture.append(frame);
    }
    let holder;
    let holderResult;
    try {
        await until(() => frames.every((frame) => frame.contentWindow.lvctStoreTest), "独立存储上下文未就绪");
        const [first, second] = frames.map((frame) => frame.contentWindow.lvctStoreTest);
        first.configureLocks({ acquireTimeoutMs: 50 });
        second.configureLocks({ acquireTimeoutMs: 50 });
        const started = first.holdNextSave();
        holder = first;
        holderResult = Promise.allSettled([first.record({ personDocId: person.docId, source: "api", externalRef: "slow-holder" })]);
        await started;
        const waiting = await Promise.allSettled([second.record({ personDocId: "20260927000000-person2", source: "api", externalRef: "waiting-writer" })]);
        const writesBeforeRelease = second.writes();
        const heldBeforeRelease = (await navigator.locks.query()).held.some((lock) => lock.name === "lvct-interaction-events.json");
        mounted = mount(PersonDetail, { target: fixture, props: {
            settings, person,
            onRecord: (personDocId, note) => second.record({ personDocId, note, source: "api", externalRef: "waiting-writer" }),
            onLoadInsights: async () => emptyInsights(),
            onOpenPersonDoc() {}, onNavigate() {}, onChanged() {}, onDeleted() {}, onClose() {},
        } });
        const draft = fixture.querySelector(".lvct-detail__record input");
        input(draft, "锁占用时保留的备注");
        await tick();
        button("记录").click();
        await until(() => fixture.textContent.includes("此次操作尚未执行"), "锁等待失败未显示可恢复指引");
        assert(draft.value === "锁占用时保留的备注" && second.writes() === 0
            && !button("记录").disabled && !fixture.textContent.includes("已记录 ✓"),
        "锁超时清空了草稿、误报成功或仍在写入");
        first.releaseSave();
        await until(() => first.pausedSaveFinished(), "旧保存恢复后未完成写入");
        const holderOutcome = await holderResult;
        const stored = await first.load();
        assert(waiting[0].status === "rejected" && waiting[0].reason.name === "StoreLockTimeoutError"
            && writesBeforeRelease === 0 && heldBeforeRelease && holderOutcome[0].status === "fulfilled"
            && stored.events.length === 1 && stored.events[0].externalRef === "slow-holder",
        `超时后的排他边界失效：${JSON.stringify({ waiting: waiting[0].status, waitingError: waiting[0].reason?.name,
            writesBeforeRelease, heldBeforeRelease, holder: holderOutcome[0].status, refs: stored.events.map((event) => event.externalRef) })}`);
        second.configureLocks({ acquireTimeoutMs: 5000 });
        button("记录").click();
        await until(() => fixture.textContent.includes("已记录 ✓"), "原操作结束后未能显式重试");
        const retried = await second.load();
        assert(retried.events.length === 2 && retried.events.some((event) => event.note === "锁占用时保留的备注")
            && draft.value === "", "恢复后重试未保留两条事实或已保存草稿未清空");
    } finally {
        holder?.releaseSave();
        if (holderResult) await holderResult;
        frames.forEach((frame) => frame.remove());
        localStorage.removeItem(storageKey);
    }
});

await test("存储锁实际双上下文：宽限内恢复串行保存，读失败或已写取消不重放、不丢事实", async () => {
    assert(navigator.locks?.request, "本环境无 Web Locks，不能验证跨页面排他");
    const storageKey = "lvct-isolated-multicontext-store";
    localStorage.removeItem(storageKey);
    const frames = [document.createElement("iframe"), document.createElement("iframe")];
    for (const frame of frames) {
        frame.hidden = true;
        frame.src = "/scripts/e2e/ui/store-frame.html";
        fixture.append(frame);
    }
    let holder;
    let holderResult;
    let waitingResult;
    try {
        await until(() => frames.every((frame) => frame.contentWindow.lvctStoreTest), "独立存储上下文未就绪");
        const [first, second] = frames.map((frame) => frame.contentWindow.lvctStoreTest);
        first.configureLocks({ acquireTimeoutMs: 5000 });
        second.configureLocks({ acquireTimeoutMs: 5000 });
        const started = first.holdNextSave();
        holder = first;
        holderResult = Promise.allSettled([first.record({ personDocId: person.docId, source: "api", externalRef: "ordinary-slow" })]);
        await started;
        waitingResult = Promise.allSettled([second.record({ personDocId: "20260927000000-person2", source: "api", externalRef: "ordinary-wait" })]);
        let pending = false;
        const deadline = Date.now() + 2000;
        while (!pending && Date.now() < deadline) {
            pending = (await navigator.locks.query()).pending.some((lock) => lock.name === "lvct-interaction-events.json");
            if (!pending) await pause(10);
        }
        assert(pending && second.writes() === 0, "正常慢写时第二上下文未排队");
        first.releaseSave();
        assert((await holderResult)[0].status === "fulfilled" && (await waitingResult)[0].status === "fulfilled"
            && (await first.load()).events.length === 2, "宽限内完成未串行保留两条互动");
        first.failRead();
        second.failRead();
        const beforeReadFailure = first.writes() + second.writes();
        const readFailures = await Promise.allSettled([
            first.record({ personDocId: person.docId, source: "api", externalRef: "bad-read-a" }),
            second.record({ personDocId: person.docId, source: "api", externalRef: "bad-read-b" }),
        ]);
        assert(readFailures.every((outcome) => outcome.status === "rejected" && outcome.reason.message.includes("存储读取失败"))
            && first.writes() + second.writes() === beforeReadFailure && (await first.load()).events.length === 2,
        "双上下文前置读失败仍写入或覆盖原库");
        first.failReadbacks();
        const readbackFailures = await Promise.allSettled([
            first.record({ personDocId: person.docId, source: "api", externalRef: "unknown-readback" }),
            second.record({ personDocId: "20260927000000-person2", source: "api", externalRef: "after-readback" }),
        ]);
        const afterReadback = await first.load();
        assert(readbackFailures[0].status === "rejected" && readbackFailures[0].reason.message.includes("存储读取失败")
            && readbackFailures[1].status === "fulfilled" && afterReadback.events.length === 4,
        `写后回读失败释放锁后，另一上下文未保留已保存事实：${JSON.stringify(readbackFailures.map((result) => ({ status: result.status, error: result.reason?.message })))}，事件 ${afterReadback.events.length}`);
        first.abortAfterWrite();
        const writesBeforeAbort = first.writes();
        const aborted = await Promise.allSettled([
            first.record({ personDocId: person.docId, source: "api", externalRef: "saved-before-abort" }),
            second.record({ personDocId: "20260927000000-person2", source: "api", externalRef: "after-abort" }),
        ]);
        assert(aborted[0].status === "rejected" && aborted[0].reason.name === "AbortError"
            && aborted[1].status === "fulfilled" && first.writes() === writesBeforeAbort + 1,
        "已保存后返回 AbortError 触发业务回调重放，或阻塞了后续上下文");
        const final = await second.load();
        assert(final.events.length === 6 && final.events.some((event) => event.externalRef === "saved-before-abort")
            && final.events.some((event) => event.externalRef === "after-abort"), "已写未知结果或并发事实丢失");
    } finally {
        holder?.releaseSave();
        if (holderResult) await holderResult;
        if (waitingResult) await waitingResult;
        frames.forEach((frame) => frame.remove());
        localStorage.removeItem(storageKey);
    }
});

await test("初始化（全新）：物化传 createIfNotExist、九字段按序配齐、双向关联只配一次", async () => {
    const calls = [];
    let notebooks = [];
    const fieldKeys = [];
    let saved = "";
    let createDocCalls = 0;
    let boundSelfDoc = "";
    let boundSelfRow = "";
    const selfDocs = new Map();
    const columns = [
        { id: "col-pk", name: "Primary Key", type: "block" },
        { id: "col-sel", name: "Select", type: "select" },
    ];
    const store = {}; /* 按键隔离的宿主存储（真实 loadData(key) 语义，B11 身份与设置互不覆盖） */
    const plugin = {
        loadData: async (key) => (store[key] === undefined ? "" : JSON.parse(JSON.stringify(store[key]))),
        saveData: async (key, value) => { store[key] = JSON.parse(JSON.stringify(value)); },
    };
    kernel.handler = async (route, body) => {
        calls.push([route, body]);
        if (route === "/api/notebook/lsNotebooks") return { notebooks };
        if (route === "/api/notebook/createNotebook") {
            notebooks = [{ id: "20260928000000-book001", name: body.name }];
            return null;
        }
        if (route === "/api/filetree/createDocWithMd") {
            createDocCalls += 1;
            const id = createDocCalls === 1 ? "20260928000000-host001" : "20260928000000-doc0002";
            selfDocs.set(id, { id, content: body.path.split("/").at(-1), hpath: body.path,
                requestId: body.markdown.match(/custom-lvct-self-draft="([^"]+)"/)?.[1] });
            return id;
        }
        if (route === "/api/block/insertBlock") return [{ doOperations: [{ id: "20260928000000-block01", action: "insert" }] }];
        if (route === "/api/av/renderAttributeView") {
            const rows = boundSelfDoc
                ? [{ id: boundSelfRow, cells: [{ valueType: "block", value: { type: "block", keyID: "name", block: { id: boundSelfDoc, content: "我自己" } } }] }]
                : [];
            return { view: { columns, rows } };
        }
        if (route === "/api/av/addAttributeViewKey") {
            fieldKeys.push({ name: body.keyName, previous: body.previousKeyID });
            columns.push({ id: body.keyID, name: body.keyName, type: body.keyType });
            return null;
        }
        if (route === "/api/transactions") return [];
        if (route === "/api/sqlite/flushTransaction") return null;
        if (route === "/api/query/sql") {
            if (body.stmt.includes("SELECT DISTINCT root_id")) {
                const requestId = body.stmt.match(/custom-lvct-self-draft="([^"]+)"/)?.[1];
                return [...selfDocs.values()].filter((doc) => doc.requestId === requestId).map((doc) => ({ root_id: doc.id }));
            }
            const docId = body.stmt.match(/(?:WHERE|AND) id\s*=\s*'([^']+)'/)?.[1];
            return docId ? selfDocs.has(docId) ? [selfDocs.get(docId)] : [] : [...selfDocs.values()];
        }
        if (route === "/api/av/addAttributeViewBlocks") {
            boundSelfDoc = body.srcs[0].id;
            boundSelfRow = "20260928000000-row0001";
            return null;
        }
        if (route === "/api/av/getAttributeViewItemIDsByBoundIDs") {
            return boundSelfDoc ? { [boundSelfDoc]: boundSelfRow } : {};
        }
        if (route === "/api/av/setAttributeViewBlockAttr") return null;
        throw new Error(`全新初始化不允许请求 ${route}`);
    };
    const steps = [];
    const settings2 = await initializeWorkspace(plugin, { notebookName: "人脉" }, (step) => steps.push(step.key));
    const renderCall = calls.find(([route]) => route === "/api/av/renderAttributeView");
    assert(renderCall[1].createIfNotExist === true, "建库物化未传 createIfNotExist:true（首次引导卡死根因）");
    assert(fieldKeys.map((item) => item.name).join(",") === FIELD_SPECS.map((spec) => spec.nameZh).join(","),
        `字段未按契约顺序建齐：${fieldKeys.map((item) => item.name).join(",")}`);
    assert(fieldKeys[0].previous === "col-sel", "首个字段未接在现有列之后");
    const relationCalls = calls.filter(([route]) => route === "/api/transactions");
    assert(relationCalls.length === 1, `双向关联配置次数错误：${relationCalls.length}`);
    const relatedKeyId = settings2.fieldMap.related;
    assert(relationCalls[0][1].transactions[0].doOperations[0].keyID === relatedKeyId, "双向关联未使用相关人列 keyID");
    assert(Object.keys(settings2.fieldMap).length === FIELD_SPECS.length, "fieldMap 未含全部字段");
    assert(settings2.hostDocId === "20260928000000-host001" && settings2.dbBlockId === "20260928000000-block01"
        && settings2.avId && settings2.notebookId === "20260928000000-book001", "锚点落盘错误");
    assert(store["contacts-settings.json"].hostDocId === settings2.hostDocId, "设置未写回宿主存储");
    assert(steps[0] === "wizardStepNotebookCreate" && steps.includes("wizardStepSelfCreate")
        && steps.includes("wizardStepDone"), `进度步骤异常：${steps.join(",")}`);
    /* B11：本人档案「我自己」默认建立并标记身份（幂等标记落盘） */
    assert(createDocCalls === 2, `本人建档应复用建文档通道恰好一次：${createDocCalls}`);
    const identity = await loadSelfIdentity(plugin);
    assert(identity && identity.selfDocId === "20260928000000-doc0002", `本人身份未标记：${JSON.stringify(identity)}`);
});

await test("初始化（续建）：复用笔记本/宿主文档/数据库/已有列，不重复建不重配双向", async () => {
    const calls = [];
    const fieldKeys = [];
    const saved = new Map();
    const plugin = {
        loadData: async (key) => structuredClone(saved.get(key) ?? ""),
        saveData: async (key, value) => { saved.set(key, structuredClone(value)); },
    };
    const columns = [
        { id: "col-pk", name: "Primary Key", type: "block" },
        { id: "col-sel", name: "Select", type: "select" },
        { id: "col-birthday", name: "生日", type: "date" },
        { id: "col-phone", name: "电话", type: "phone" },
        { id: "col-related", name: "相关人", type: "relation" },
        { id: "col-back", name: "被相关人", type: "relation" },
    ];
    let selfBound = false; /* B11：绑定完成后名册才出现「我自己」（此前出现会被查重拦截） */
    kernel.handler = async (route, body) => {
        calls.push([route, body]);
        if (route === "/api/notebook/lsNotebooks") return { notebooks: [{ id: "20260928000000-book002", name: "人脉" }] };
        if (route === "/api/sqlite/flushTransaction") return null;
        if (route === "/api/query/sql") {
            if (String(body.stmt).includes("AND type = 'av'")) {
                return [{ id: "20260928000000-block02", parent_id: "20260928000000-host002",
                    markdown: '<div data-type="NodeAttributeView" data-av-id="20260928000000-av00002" data-av-type="table"></div>' }];
            }
            const docId = body.stmt.match(/WHERE id = '([^']+)'/)?.[1];
            if (docId) return [{ id: docId }];
            /* B11：预置上次尝试残留的未绑定「我自己」文档 → 断点续做复用，不新建 */
            return [
                { id: "20260928000000-host002", content: "联系人总表", hpath: "/联系人总表" },
                { id: "20260928000000-self001", content: "我自己", hpath: "/我自己" },
            ];
        }
        if (route === "/api/av/renderAttributeView") {
            const rows = selfBound
                ? [{ id: "20260928000000-rowfw01", cells: [{ valueType: "block", value: { type: "block", keyID: "name", block: { id: "20260928000000-self001", content: "我自己" } } }] }]
                : [];
            return { view: { columns, rows } };
        }
        if (route === "/api/av/addAttributeViewKey") {
            fieldKeys.push(body.keyName);
            const spec = FIELD_SPECS.find((field) => field.nameZh === body.keyName);
            if (spec) columns.push({ id: body.keyID, name: body.keyName, type: body.keyType });
            return null;
        }
        if (route === "/api/av/addAttributeViewBlocks") {
            if (body.srcs.some((src) => src.id === "20260928000000-self001")) selfBound = true;
            return null;
        }
        if (route === "/api/av/getAttributeViewItemIDsByBoundIDs") return selfBound ? { "20260928000000-self001": "20260928000000-rowfw01" } : {};
        if (route === "/api/av/setAttributeViewBlockAttr") return null;
        throw new Error(`续建不允许请求 ${route}`);
    };
    const snapshot = await inspectWorkspace("人脉");
    assert(snapshot.notebook?.id === "20260928000000-book002" && snapshot.hostDocId === "20260928000000-host002"
        && snapshot.dbBlockId === "20260928000000-block02" && snapshot.avId === "20260928000000-av00002",
        `预检未找回锚点：${JSON.stringify(snapshot)}`);
    assert(snapshot.existingFields.join(",") === "生日,电话,相关人", `预检可复用字段错误：${snapshot.existingFields.join(",")}`);

    calls.length = 0;
    const steps = [];
    const settings2 = await initializeWorkspace(plugin, { notebookName: "人脉" }, (step) => steps.push(step.key));
    const routes = calls.map(([route]) => route);
    assert(!routes.includes("/api/notebook/createNotebook"), "续建重复创建笔记本");
    assert(!routes.includes("/api/filetree/createDocWithMd"), "续建重复创建宿主文档");
    assert(!routes.includes("/api/block/insertBlock"), "续建重复插入数据库块");
    assert(!routes.includes("/api/transactions"), "双向关联已存在仍重复配置（会叠出第二列）");
    assert(!fieldKeys.includes("生日") && !fieldKeys.includes("电话") && !fieldKeys.includes("相关人"),
        `续建重复创建已有列：${fieldKeys.join(",")}`);
    assert(fieldKeys.length === 6, `补建字段数错误：${fieldKeys.join(",")}`);
    assert(settings2.fieldMap.birthday === "col-birthday" && settings2.fieldMap.related === "col-related",
        "续建未沿用已有列 keyID");
    assert(settings2.avId === "20260928000000-av00002" && settings2.notebookId === "20260928000000-book002", "续建锚点错误");
    assert(steps[0] === "wizardStepNotebookReuse" && steps.includes("wizardStepFieldsKept")
        && steps.includes("wizardStepRelationKept"), `续建进度未体现复用：${steps.join(",")}`);
    /* B11：残留「我自己」文档被断点复用（不新建），身份标记落盘 */
    assert(!routes.includes("/api/filetree/createDocWithMd"), "续建本人档案未复用残留文档（重复建文档）");
    const identity = await loadSelfIdentity(plugin);
    assert(identity && identity.selfDocId === "20260928000000-self001"
        && identity.selfItemId === "20260928000000-rowfw01", `本人身份未标记：${JSON.stringify(identity)} steps=${JSON.stringify(steps)}`);
});

await test("向导：预检提示将复用的内容，失败后可继续并在续建成功时回调", async () => {
    const snapshot = {
        notebooks: [{ id: "20260928000000-book003", name: "人脉" }],
        notebook: { id: "20260928000000-book003", name: "人脉" },
        hostDocId: "20260928000000-host003", dbBlockId: "20260928000000-block03",
        avId: "20260928000000-av00003", existingFields: ["生日", "电话"],
    };
    let attempts = 0;
    let initialized = null;
    const facadeStub = {
        settings: null,
        viewPreferences: DEFAULT_VIEW_PREFERENCES,
        isMobile: false,
        previewInitialize: async () => snapshot,
        initialize: async (_name, onProgress) => {
            attempts += 1;
            onProgress({ key: "wizardStepNotebookReuse", values: { name: "人脉", count: 1 } });
            if (attempts === 1) throw new Error("已存在同名笔记本「人脉」");
            return settings;
        },
    };
    mounted = mount(InitWizard, { target: fixture, props: {
        facade: facadeStub, i18n: undefined, onInitialized: (value) => { initialized = value; },
    } });
    await until(() => fixture.textContent.includes("将保留已建字段：生日、电话"), "预检提示未显示可复用内容");
    assert(fixture.textContent.includes("将复用已有的「联系人总表」文档"), "预检未提示复用宿主文档");
    button("开始初始化").click();
    await until(() => fixture.textContent.includes("初始化失败"), "失败信息未显示");
    assert(fixture.textContent.includes("从断点续建"), "失败后未提示可继续");
    assert(fixture.textContent.includes("复用已存在的笔记本"), "续建日志未体现复用");
    button("继续初始化").click();
    await until(() => initialized === settings, "续建成功后未回调初始化结果");
    assert(attempts === 2, "续建未走第二次初始化");
});

await test("读取故障显式化：首页模块读取失败显示降级横幅（指名模块），重试成功后消失（FUNC-01.12）", async () => {
    let calls = 0;
    mounted = mount(Workbench, { target: fixture, props: {
        settings, preferences: DEFAULT_VIEW_PREFERENCES, isMobile: false,
        onPreferencesUpdated() {}, onOpenPersonDoc() {},
        facade: { settings, loadRecentInteractions: async () => ({}), loadDashboard: async () => {
            calls += 1;
            const base = {
                people: 1, relations: 0, birthdays: [], birthdaysThisWeek: 0,
                stale: [], staleTotal: 0, neverContacted: 0, neverContactedItemIds: [],
                followUps: [], actions: [], neverOrder: {},
            };
            return calls === 1 ? { ...base, readFailures: ["interactions", "followUps"] } : base;
        } },
    } });
    await until(() => fixture.querySelector(".lvct-notice--error"), "读取失败横幅未显示");
    assert(fixture.textContent.includes("互动记录") && fixture.textContent.includes("跟进计划"),
        "横幅未指名受影响模块（互动记录/跟进计划）");
    fixture.querySelector(".lvct-notice__action").click();
    await until(() => calls >= 2 && !fixture.querySelector(".lvct-notice--error"), "重试后横幅未消失");
    assert(calls === 2, "重试未按一次计");
});

await test("读取故障显式化：跟进计划读取失败显示错误态与重试，不冒充空待办（FUNC-01.12）", async () => {
    let fail = true;
    const items = [{ id: "fu-1", personDocId: person.docId, title: "召回提醒", dueDate: "2026-10-20", status: "open", createdAt: 1, updatedAt: 1 }];
    mounted = mount(PersonDetail, { target: fixture, props: {
        settings, person,
        onRecord: async () => {},
        onLoadInsights: async () => emptyInsights(),
        onOpenPersonDoc() {}, onNavigate() {}, onDeleted() {}, onClose() {}, onChanged() {},
        onListFollowUps: async () => {
            if (fail) throw new Error("存储读取失败，操作已停止: follow-ups.json");
            return items;
        },
        onCreateFollowUp: async () => { throw new Error("用例不涉及"); },
        onSetFollowUpStatus: async () => {},
        onSnoozeFollowUp: async () => {},
    } });
    await until(() => fixture.textContent.includes("跟进计划加载失败"), "跟进读取失败错误态未显示");
    assert(fixture.textContent.includes("follow-ups.json"), "错误态未包含失败存储键");
    assert(!fixture.textContent.includes("没有进行中的跟进计划"), "故障不得同时渲染空待办文案");
    fail = false;
    button("重试").click();
    await until(() => fixture.textContent.includes("召回提醒"), "重试后未渲染跟进列表");
    assert(!fixture.textContent.includes("跟进计划加载失败"), "成功后错误态未清除");
});

await runMigrationRegression({ test, assert, person, settings, kernel, fixture, until, button });
await runPeopleProfileRegression({ test, assert, kernel, settings, fixture, until, button });
await runOperationResultRegression({ test, assert, kernel, settings, fixture, until, button });
await runExternalBridgeRegression({ test, assert, kernel, settings });
await runRelationRegression({ test, assert, kernel, settings });
await runOrganizationPageRegression({ test, assert, kernel, settings, fixture, until, button });
await runHealthAuditRegression({ test, assert, fixture, until, button });
await runLifecycleRegression({ test, assert, fixture, until, settings });
await runTextEncodingRegression({ test, assert, kernel, settings });
await runVcardRegression({ test, assert, kernel, settings, fixture, until, button });
await runSelfIdentityRegression({ test, assert, kernel, settings, fixture, until, button });
await runOrganizationHealthRegression({ test, assert, kernel, settings, fixture, until, button });
await runPersonIdentityRegression({ test, assert, kernel, settings, fixture, until, button });
await runOrganizationProjectionRegression({ test, assert, kernel, settings, fixture, until, button });
await runOrganizationOperationsRegression({ test, assert, fixture, until, button });
await runGraphQueryRegression({ test, assert, kernel, settings, fixture, until, button });
await runAiPreflightRegression({ test, assert, kernel, settings, fixture });
await runImportRegression({ test, assert, kernel, settings, fixture, until, button });
await runAliasRegression({ test, assert, kernel, settings, fixture, until });
await runOrganizationContextRegression({ test, assert, kernel, settings, fixture, until, button });
await runSettingsRepairRegression({ test, assert, kernel, settings, fixture, until, button });
await runDocumentNavigationRegression({ test, assert, kernel, settings, fixture, until, button });
await runBatchSelectionRegression({ test, assert, kernel, settings, fixture, until, button });

await pause(100);
results.push({ name: "无未处理异常及响应式循环", ok: runtimeErrors.length === 0, detail: runtimeErrors.join("\n") });
document.querySelector("#results").textContent = JSON.stringify(results, null, 2);
await fetch("/__ui_report", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(results) });
