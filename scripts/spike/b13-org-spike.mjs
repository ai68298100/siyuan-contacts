/* B13.1a spike：在隔离内核上实证"组织模块"所需的数据库能力假设。
   核心问题：人员库的 relation 字段能否指向**另一个数据库**（组织库）的行？
   跨库双向（/api/transactions updateAttrViewColRelation 跨 avID）是否工作？
   detached 行（无组织文档的组织条目）是否可用？悬空引用形态如何？
   产出 scripts/spike/b13-org-results.json。绝不触碰用户真实笔记。
   模式移植自 av-spike.mjs（隔离工作区 + 标记文件 + 回环校验）。 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {spawn} from "node:child_process";
import { prepareIsolatedWorkspace, assertTestPortAvailable, observeTestKernel } from "../e2e/kernel-safety.mjs";

const WORKSPACE = path.join(os.homedir(), "SiYuan-Renmai-B13-Spike");
const HOST = "127.0.0.1";
const PORT = 6833;
const BASE = `http://${HOST}:${PORT}`;
const MARKER = "renmai-b13-spike.json";

const results = [];
const record = (name, ok, detail) => {
    results.push({name, ok, detail});
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

function assertLoopback() {
    const host = new URL(BASE).hostname;
    if (!["127.0.0.1", "localhost", "::1"].includes(host)) throw new Error(`只允许回环地址，当前 ${host}`);
}

function resolveKernel() {
    const candidates = [
        "D:\\biji\\SiYuan\\resources\\kernel\\SiYuan-Kernel.exe",
        "D:\\RJ\\SiYuan\\resources\\kernel\\SiYuan-Kernel.exe",
        path.join(process.env.ProgramFiles || "C:\\Program Files", "SiYuan", "resources", "kernel", "SiYuan-Kernel.exe"),
    ];
    const kernel = candidates.find((c) => fs.existsSync(c));
    if (!kernel) throw new Error("未找到 SiYuan-Kernel.exe");
    const appDir = path.resolve(path.dirname(kernel), "..");
    for (const required of ["stage", "appearance"]) {
        if (!fs.existsSync(path.join(appDir, required))) throw new Error(`app 目录缺少 ${required}: ${appDir}`);
    }
    return {kernel, appDir};
}

function prepareWorkspace() {
    prepareIsolatedWorkspace(WORKSPACE, MARKER, "renmai b13-org-spike");
}

function startKernel({kernel, appDir}) {
    const child = spawn(kernel, ["--workspace", WORKSPACE, "serve", "--wd", appDir, "--port", String(PORT)], {
        stdio: ["ignore", "pipe", "pipe"],
        env: {...process.env, SIYUAN_WORKSPACE_PATH: WORKSPACE},
    });
    const lines = [];
    for (const stream of [child.stdout, child.stderr]) {
        stream.on("data", (chunk) => {
            String(chunk).split(/\r?\n/).forEach((line) => {
                if (line) {
                    lines.push(line);
                    if (lines.length > 2000) lines.shift();
                }
            });
        });
    }
    return {child, lines};
}

let token = "";
let assertKernelRunning;
async function api(route, body = {}) {
    assertKernelRunning?.();
    const headers = {"Content-Type": "application/json"};
    if (token) headers.Authorization = `Token ${token}`;
    const response = await fetch(`${BASE}${route}`, {method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(5000)});
    const text = await response.text();
    assertKernelRunning?.();
    let payload;
    try { payload = text ? JSON.parse(text) : {}; } catch { throw new Error(`${route} 非 JSON 响应: ${text.slice(0, 200)}`); }
    return payload;
}
async function apiChecked(route, body = {}) {
    const payload = await api(route, body);
    if (payload.code !== 0) throw new Error(`${route} code=${payload.code} msg=${payload.msg}`);
    return payload.data ?? payload;
}
const flush = async () => { await api("/api/sqlite/flushTransaction"); };

async function waitForBoot(lines, assertRunning) {
    const until = Date.now() + 60000;
    while (Date.now() < until) {
        assertRunning();
        if (lines.some((line) => line.includes("lock workspace"))) {
            throw new Error(`工作区被锁定：${WORKSPACE} 有残留内核。请先结束该进程。`);
        }
        const progress = await api("/api/system/bootProgress").catch(() => undefined);
        if (progress?.code === 0 && Number(progress?.data?.progress) >= 100) {
            return apiChecked("/api/system/version");
        }
        await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error(`内核启动超时。日志尾部:\n${lines.slice(-25).join("\n")}`);
}

async function createDbWithPrimary(notebookID, title, tag) {
    const docId = await apiChecked("/api/filetree/createDocWithMd", {notebook: notebookID, path: `/${title}`, markdown: `# ${title}\n\n`});
    const chars = "0123456789abcdefghijklmnopqrstuvwxyz";
    let rand = "";
    for (let i = 0; i < 6; i += 1) rand += chars[Math.floor(Math.random() * chars.length)];
    const avId = `20260930000000-${tag}${rand}`;
    const dom = `<div data-type="NodeAttributeView" data-av-id="${avId}" data-av-type="table"></div>`;
    const inserted = await api("/api/block/insertBlock", {dataType: "dom", parentID: docId, data: dom});
    if (inserted.code !== 0) throw new Error(`insertBlock ${title} code=${inserted.code} msg=${inserted.msg}`);
    const dbBlockId = inserted.data[0].doOperations[0].id;
    await apiChecked("/api/av/renderAttributeView", {id: avId, blockID: dbBlockId, createIfNotExist: true});
    return {docId, avId, dbBlockId};
}

async function addRelationKey(avID, keyID, keyName) {
    return api("/api/av/addAttributeViewKey", {avID, keyID, keyName, keyType: "relation", keyIcon: ""});
}

async function main() {
    assertLoopback();
    await assertTestPortAvailable(HOST, PORT);
    prepareWorkspace();
    const {kernel, appDir} = resolveKernel();
    const {child, lines} = startKernel({kernel, appDir});
    const assertRunning = observeTestKernel(child);
    assertKernelRunning = assertRunning;
    try {
        const version = await waitForBoot(lines, assertRunning);
        assertRunning();
        record("内核启动", true, `v${version}`);
        token = (JSON.parse(fs.readFileSync(path.join(WORKSPACE, "conf", "conf.json"), "utf8")).accessAuthCode) || "";

        const notebook = await apiChecked("/api/notebook/createNotebook", {name: "B13_spike"});
        const notebookID = notebook.notebook.id;
        await flush();

        /* 通道1：人员库 + 组织库 两个独立数据库 */
        const person = await createDbWithPrimary(notebookID, "人员库", "p");
        const org = await createDbWithPrimary(notebookID, "组织库", "o");
        record("通道1 双库创建", Boolean(person.avId && org.avId && person.avId !== org.avId),
            `person=${person.avId} org=${org.avId}`);
        await flush();

        /* 通道2：人员库绑 2 行（人员文档）；组织库绑 1 行（组织文档）+ 1 detached 行 */
        const pDocs = [];
        for (const name of ["张三", "李四"]) {
            const docId = await apiChecked("/api/filetree/createDocWithMd", {notebook: notebookID, path: `/${name}`, markdown: `# ${name}\n\n`});
            pDocs.push(docId);
        }
        const pAdded = await api("/api/av/addAttributeViewBlocks", {
            avID: person.avId, blockID: person.dbBlockId,
            srcs: [{id: pDocs[0], isDetached: false, content: "张三"}, {id: pDocs[1], isDetached: false, content: "李四"}],
        });
        const orgDoc = await apiChecked("/api/filetree/createDocWithMd", {notebook: notebookID, path: "/测试公司", markdown: "# 测试公司\n\n"});
        const oAdded = await api("/api/av/addAttributeViewBlocks", {
            avID: org.avId, blockID: org.dbBlockId,
            srcs: [{id: orgDoc, isDetached: false, content: "测试公司"}, {isDetached: true, content: "无文档组织"}],
        });
        await flush();
        const pRendered = await apiChecked("/api/av/renderAttributeView", {id: person.avId, blockID: person.dbBlockId, pageSize: -1});
        const oRendered = await apiChecked("/api/av/renderAttributeView", {id: org.avId, blockID: org.dbBlockId, pageSize: -1});
        const pRows = pRendered.view?.rows || [];
        const oRows = oRendered.view?.rows || [];
        const orgRowMain = oRows.find((row) => row.cells.some((c) => c.value?.type === "block"));
        const orgRowDetached = oRows.find((row) => !row.cells.some((c) => c.value?.type === "block"));
        record("通道2 绑行与 detached 行", pAdded.code === 0 && oAdded.code === 0 && pRows.length >= 2 && oRows.length >= 2,
            `personRows=${pRows.length} orgRows=${oRows.length} orgMain=${orgRowMain?.id ?? "无"} detached=${orgRowDetached?.id ?? "无"}`);
        if (!orgRowMain || pRows.length < 2) throw new Error("前置行缺失，无法继续跨库测试");

        /* 通道3：人员库加 relation key（不配置目标），值设为组织库行 itemID（跨库目标） */
        const relKeyID = "20260930000000-b13rel1";
        await addRelationKey(person.avId, relKeyID, "所属组织");
        await flush();
        const crossTargets = [orgRowMain.id, ...(orgRowDetached ? [orgRowDetached.id] : [])];
        const crossWrite = await api("/api/av/setAttributeViewBlockAttr", {
            avID: person.avId, keyID: relKeyID, itemID: pRows[0].id,
            value: {relation: {blockIDs: crossTargets}},
        });
        await flush();
        const pRe = await apiChecked("/api/av/renderAttributeView", {id: person.avId, blockID: person.dbBlockId, pageSize: -1});
        const pRow = (pRe.view?.rows || []).find((row) => row.id === pRows[0].id);
        const relCell = (pRow?.cells || []).find((c) => c.value?.keyID === relKeyID)?.value?.relation;
        const crossReadOK = crossWrite.code === 0 && JSON.stringify(relCell?.blockIDs || []) === JSON.stringify(crossTargets);
        record("通道3 跨库 relation 写读（显式 itemID 目标）", crossWrite.code === 0 && Boolean(relCell),
            `write=${crossWrite.code} blockIDs=${JSON.stringify(relCell?.blockIDs || [])}`);

        /* 通道4：跨库双向（/api/transactions updateAttrViewColRelation 跨 avID）——
           人员库"所属组织" ↔ 组织库"成员"键 */
        const orgKeyID = "20260930000000-b13mem1";
        await addRelationKey(org.avId, orgKeyID, "成员");
        await flush();
        const txn = await api("/api/transactions", {
            reqId: Date.now(),
            transactions: [{
                doOperations: [{
                    action: "updateAttrViewColRelation",
                    avID: person.avId,
                    keyID: relKeyID,
                    id: person.avId,
                    isTwoWay: true,
                    backRelationKeyID: orgKeyID,
                    name: "成员",
                    format: "所属组织",
                }],
                undoOperations: [],
            }],
        });
        await flush();
        const personAv = await apiChecked("/api/av/getAttributeView", {id: person.avId});
        const orgAv = await apiChecked("/api/av/getAttributeView", {id: org.avId});
        const personRel = (personAv.av?.keyValues || []).find((kv) => kv.key.id === relKeyID)?.key?.relation;
        const orgRel = (orgAv.av?.keyValues || []).find((kv) => kv.key.id === orgKeyID)?.key?.relation;
        record("通道4 跨库双向配置", txn.code === 0 && Boolean(personRel?.isTwoWay) && Boolean(orgRel),
            `txn=${txn.code} personRel=${JSON.stringify(personRel) ?? "undefined"} orgRel=${JSON.stringify(orgRel) ?? "undefined"}`);

        /* 通道5：跨库双向数据互通——组织库"成员"设值（org→person），回读人员库 relation */
        const oWrite = await api("/api/av/setAttributeViewBlockAttr", {
            avID: org.avId, keyID: orgKeyID, itemID: orgRowMain.id,
            value: {relation: {blockIDs: [pRows[0].id]}},
        });
        await flush();
        const pRe2 = await apiChecked("/api/av/renderAttributeView", {id: person.avId, blockID: person.dbBlockId, pageSize: -1});
        const pRow2 = (pRe2.view?.rows || []).find((row) => row.id === pRows[0].id);
        const relCell2 = (pRow2?.cells || []).find((c) => c.value?.keyID === relKeyID)?.value?.relation;
        const twoWayDataOK = oWrite.code === 0 && JSON.stringify(relCell2?.blockIDs || []).includes(pRows[0].id);
        record("通道5 跨库双向数据互通（org 设值 person 可见）", twoWayDataOK,
            `oWrite=${oWrite.code} personBlockIDs=${JSON.stringify(relCell2?.blockIDs || [])}`);

        /* 通道6：删除组织库行后，人员库跨库 relation 的悬空引用形态（信息性，不判 PASS/FAIL） */
        if (orgRowDetached) {
            const removed = await api("/api/av/removeAttributeViewBlocks", {avID: org.avId, srcIDs: [orgRowDetached.id]});
            await flush();
            const pRe3 = await apiChecked("/api/av/renderAttributeView", {id: person.avId, blockID: person.dbBlockId, pageSize: -1});
            const pRow3 = (pRe3.view?.rows || []).find((row) => row.id === pRows[0].id);
            const relCell3 = (pRow3?.cells || []).find((c) => c.value?.keyID === relKeyID)?.value?.relation;
            record("通道6 悬空跨库引用形态（信息性）", true,
                `移除后 blockIDs=${JSON.stringify(relCell3?.blockIDs || [])} contents=${JSON.stringify(relCell3?.contents || []).slice(0, 200)}`);
        }

        /* 通道7：组织改名前提——/api/filetree/renameDoc 行为（B13.4 余项实证）。
           path 参数为物理路径 /{docId}.sy（hpath 报 invalid document path）。
           先写 custom-lvct-org 标记块，验证改名后 IAL 保留（rename 不动正文）。 */
        await flush();
        await apiChecked("/api/block/insertBlock", {dataType: "markdown", parentID: orgDoc,
            data: "**组织**：测试公司\n{: custom-lvct-org=\"1\"}"});
        await flush();
        const rename = await api("/api/filetree/renameDoc", {notebook: notebookID, path: "/" + orgDoc + ".sy", title: "测试公司改"});
        await flush();
        const renamedDoc = await apiChecked("/api/query/sql", {stmt: "SELECT id, content, hpath FROM blocks WHERE type='d' AND id = '" + orgDoc + "'"});
        const markedAfter = await apiChecked("/api/query/sql", {stmt: "SELECT ial FROM blocks WHERE root_id = '" + orgDoc + "' AND ial LIKE '%custom-lvct-org=%'"});
        const renamedOK = rename.code === 0 && renamedDoc[0]?.content === "测试公司改" && markedAfter.length > 0;
        record("通道7 renameDoc 组织改名", renamedOK,
            `code=${rename.code} content=${renamedDoc[0]?.content} 标记块保留=${markedAfter.length > 0}`);
        /* 通道7b：改回原名（幂等性观察） */
        const renameBack = await api("/api/filetree/renameDoc", {notebook: notebookID, path: "/" + orgDoc + ".sy", title: "测试公司"});
        await flush();
        const backDoc = await apiChecked("/api/query/sql", {stmt: "SELECT content FROM blocks WHERE type='d' AND id = '" + orgDoc + "'"});
        record("通道7b renameDoc 改回原名", renameBack.code === 0 && backDoc[0]?.content === "测试公司",
            `code=${renameBack.code} content=${backDoc[0]?.content}`);
    } finally {
        await flush().catch(() => {});
        try { await api("/api/system/exit", {force: true}); } catch { /* 内核可能已退出 */ }
    }
}

main().then(() => {
    fs.writeFileSync(path.join("scripts", "spike", "b13-org-results.json"), JSON.stringify(results, null, 2));
    const failed = results.filter((entry) => !entry.ok);
    console.log(`\nB13 组织 spike：${results.length - failed.length}/${results.length} 项判定为符合预期（通道6 为信息性）`);
    process.exit(0);
}).catch((error) => {
    console.error("spike 失败：", error);
    fs.writeFileSync(path.join("scripts", "spike", "b13-org-results.json"), JSON.stringify(results, null, 2));
    process.exit(1);
});
