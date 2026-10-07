/* M0 spike：在隔离内核上实证"思源数据库为人脉主干"的关键 API 假设。
   模式移植自 siyuan-checkin 的 E2E 基建（D-222）：独立临时工作区 + 标记文件 +
   回环校验，绝不触碰用户真实笔记。产出 scripts/spike/spike-results.json。 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import {spawn} from "node:child_process";
import { prepareIsolatedWorkspace, assertTestPortAvailable, observeTestKernel } from "../e2e/kernel-safety.mjs";

const WORKSPACE = path.join(os.tmpdir(), `SiYuan-Lvct-AvSpike-${randomUUID()}`);
const HOST = "127.0.0.1";
const PORT = 6828;
const BASE = `http://${HOST}:${PORT}`;
const MARKER = "renmai-spike.json";

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
    prepareIsolatedWorkspace(WORKSPACE, MARKER, "renmai av-spike");
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
    return payload.data;
}

function newNodeID() {
    const now = new Date();
    const pad = (n, w) => String(n).padStart(w, "0");
    const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1, 2)}${pad(now.getDate(), 2)}${pad(now.getHours(), 2)}${pad(now.getMinutes(), 2)}${pad(now.getSeconds(), 2)}`;
    const charset = "0123456789abcdefghijklmnopqrstuvwxyz";
    let rand = "";
    for (let i = 0; i < 7; i += 1) rand += charset[Math.floor(Math.random() * charset.length)];
    return `${stamp}-${rand}`;
}

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

/* ---------- 各项验证 ---------- */

async function verifyDbBlockCreation(notebookID) {
    // 假设①：insertBlock 插入 NodeAttributeView DOM 即创建数据库块（客户端先定 avID）
    const avID = newNodeID();
    const hostDoc = await apiChecked("/api/filetree/createDocWithMd", {
        notebook: notebookID, path: "/数据库宿主", markdown: "# 数据库宿主\n\n",
    });
    const dom = `<div data-type="NodeAttributeView" data-av-id="${avID}" data-av-type="table"></div>`;
    const inserted = await api("/api/block/insertBlock", {dataType: "dom", parentID: hostDoc, data: dom});
    if (inserted.code !== 0) return {avID, hostDoc, dbBlockID: "", detail: `insertBlock code=${inserted.code} msg=${inserted.msg}`, ok: false};
    const op = inserted.data?.[0]?.doOperations?.[0];
    const dbBlockID = op?.id || "";
    // renderAttributeView 物化数据库（默认视图+主键列）
    const rendered = await api("/api/av/renderAttributeView", {id: avID, blockID: dbBlockID, createIfNotExist: true});
    return {avID, hostDoc, dbBlockID, rendered, detail: `dbBlockID=${dbBlockID} av创建=${rendered.code === 0}`, ok: inserted.code === 0 && rendered.code === 0 && dbBlockID};
}

async function verifyAddFields(avID) {
    // 假设②：addAttributeViewKey 客户端生成 keyID 建各类字段
    const fields = [
        ["生日", "date"], ["电话", "phone"], ["邮箱", "email"], ["微信", "text"],
        ["网站", "url"], ["分组", "select"], ["标签", "mSelect"], ["农历生日", "checkbox"], ["相关人", "relation"],
    ];
    const keyIDs = {};
    let previousKeyID = "";
    for (const [name, type] of fields) {
        const keyID = newNodeID();
        const payload = await api("/api/av/addAttributeViewKey", {avID, keyID, keyName: name, keyType: type, keyIcon: "", previousKeyID});
        if (payload.code !== 0) return {keyIDs, detail: `建字段 ${name}(${type}) 失败 code=${payload.code} msg=${payload.msg}`, ok: false};
        keyIDs[name] = keyID;
        previousKeyID = keyID;
    }
    const av = await apiChecked("/api/av/getAttributeView", {id: avID});
    const keyCount = av.av?.keyValues?.length ?? 0;
    return {keyIDs, detail: `字段总数(含主键)=${keyCount}`, ok: keyCount >= fields.length + 1};
}

async function verifyRelationConfig(avID, keyIDs) {
    // 假设③：relation 字段目标库经 transactions 的 updateAttrViewColRelation 配置（自关联双向）
    const backKeyID = newNodeID();
    const txn = await api("/api/transactions", {
        reqId: Date.now(),
        transactions: [{
            doOperations: [{
                action: "updateAttrViewColRelation",
                avID, keyID: keyIDs["相关人"], id: avID,
                isTwoWay: true, backRelationKeyID: backKeyID, name: "被相关人", format: "相关人",
            }],
            undoOperations: [],
        }],
    });
    const av = await apiChecked("/api/av/getAttributeView", {id: avID});
    const relKV = (av.av?.keyValues || []).find((kv) => kv.key.id === keyIDs["相关人"]);
    const rel = relKV?.key?.relation;
    const backKey = (av.av?.keyValues || []).find((kv) => kv.key.id === backKeyID);
    const detail = `txn 响应=${JSON.stringify(txn).slice(0, 300)} relation=${JSON.stringify(rel)} 回链字段=${backKey ? backKey.key.name : "无"}`;
    return {backKeyID, detail, ok: txn.code === 0 && rel?.avID === avID && rel?.isTwoWay === true && !!backKey};
}

async function verifyBindRows(avID, dbBlockID, notebookID) {
    // 假设④：addAttributeViewBlocks isDetached:false 把文档绑定为行；itemID↔文档ID 映射可查
    const docA = await apiChecked("/api/filetree/createDocWithMd", {notebook: notebookID, path: "/人脉/张三", markdown: "# 张三\n\n备注正文。"});
    const docB = await apiChecked("/api/filetree/createDocWithMd", {notebook: notebookID, path: "/人脉/李四", markdown: "# 李四\n\n"});
    const added = await api("/api/av/addAttributeViewBlocks", {
        avID, blockID: dbBlockID,
        srcs: [{id: docA, isDetached: false, content: "张三"}, {id: docB, isDetached: false, content: "李四"}],
    });
    if (added.code !== 0) return {docA, docB, detail: `addAttributeViewBlocks code=${added.code} msg=${added.msg}`, ok: false};
    const rendered = await apiChecked("/api/av/renderAttributeView", {id: avID, blockID: dbBlockID, pageSize: -1});
    const rows = rendered.view?.rows || [];
    const boundByBlock = {};
    for (const row of rows) {
        const pk = row.cells.find((c) => c.valueType === "block");
        const boundBlock = pk?.value?.block?.id;
        if (boundBlock) boundByBlock[boundBlock] = row.id;
    }
    const mapped = await apiChecked("/api/av/getAttributeViewItemIDsByBoundIDs", {avID, blockIDs: [docA, docB]});
    const mapOK = boundByBlock[docA] && boundByBlock[docB];
    const endpointOK = JSON.stringify((mapped.itemIDsByBoundBlockIDs?.[docA] || mapped[docA] || "")) === JSON.stringify(boundByBlock[docA]);
    const detail = `itemA=${boundByBlock[docA] || "未找到"} itemB=${boundByBlock[docB] || "未找到"} 映射端点返回=${JSON.stringify(mapped).slice(0, 200)}`;
    return {docA, docB, itemA: boundByBlock[docA], itemB: boundByBlock[docB], detail, ok: !!mapOK && rows.length >= 2 && endpointOK};
}

async function verifyCellValues(avID, dbBlockID, ctx) {
    // 假设⑤：各类型单元格值经 setAttributeViewBlockAttr 写入并可回读
    const k = ctx.keyIDs;
    const birthday = Date.UTC(1990, 4, 20);
    const writes = [
        ["电话", "phone", {phone: {content: "13800138000"}}],
        ["邮箱", "email", {email: {content: "zhangsan@example.com"}}],
        ["微信", "text", {text: {content: "zhangsan_wx"}}],
        ["网站", "url", {url: {content: "https://example.com"}}],
        ["生日", "date", {date: {content: birthday, isNotEmpty: true, isNotTime: true}}],
        ["分组", "select", {mSelect: [{content: "朋友", color: "1"}]}],
        ["标签", "mSelect", {mSelect: [{content: "球友", color: "2"}, {content: "重点", color: "3"}]}],
        ["农历生日", "checkbox", {checkbox: {checked: true}}],
    ];
    for (const [name, , value] of writes) {
        const payload = await api("/api/av/setAttributeViewBlockAttr", {avID, keyID: k[name], itemID: ctx.itemA, value});
        if (payload.code !== 0) return {...ctx, detail: `写 ${name} 失败 code=${payload.code} msg=${payload.msg}`, ok: false};
    }
    const relWrite = await api("/api/av/setAttributeViewBlockAttr", {
        avID, keyID: k["相关人"], itemID: ctx.itemA, value: {relation: {blockIDs: [ctx.itemB]}},
    });
    if (relWrite.code !== 0) return {...ctx, detail: `写 相关人 失败 code=${relWrite.code} msg=${relWrite.msg}`, ok: false};
    // 回读
    const rendered = await apiChecked("/api/av/renderAttributeView", {id: avID, blockID: dbBlockID, pageSize: -1});
    const row = (rendered.view?.rows || []).find((r) => r.id === ctx.itemA);
    if (!row) return {...ctx, detail: "回读未找到行", ok: false};
    const cell = (name) => row.cells.find((c) => c.value?.keyID === k[name])?.value;
    const checks = {
        电话: cell("电话")?.phone?.content === "13800138000",
        生日: cell("生日")?.date?.content === birthday && cell("生日")?.date?.isNotTime === true,
        分组: cell("分组")?.mSelect?.[0]?.content === "朋友",
        标签: (cell("标签")?.mSelect || []).length === 2,
        农历: cell("农历生日")?.checkbox?.checked === true,
        相关人: JSON.stringify(cell("相关人")?.relation?.blockIDs || []) === JSON.stringify([ctx.itemB]),
    };
    const options = (rendered.view.columns || []).find((c) => c.name === "分组")?.options || [];
    const allOK = Object.values(checks).every(Boolean);
    const detail = JSON.stringify({checks, 分组选项: options.map((o) => o.name)});
    return {...ctx, detail, ok: allOK};
}

async function verifyUnbind(avID, dbBlockID, ctx) {
    // 假设⑥：removeAttributeViewBlocks 对绑定行只解绑不删文档
    const itemB = ctx.itemB;
    const removed = await api("/api/av/removeAttributeViewBlocks", {avID, srcIDs: [itemB]});
    await apiChecked("/api/sqlite/flushTransaction");
    const docB = await api("/api/query/sql", {stmt: `SELECT id, root_id FROM blocks WHERE id = (SELECT root_id FROM blocks WHERE id='${ctx.docB}') LIMIT 1`});
    const rendered = await apiChecked("/api/av/renderAttributeView", {id: avID, blockID: dbBlockID, pageSize: -1});
    const stillThere = (rendered.view?.rows || []).some((r) => r.id === itemB);
    const docAlive = (docB.data || []).length > 0;
    // 恢复绑定，保持后续验证数据完整
    await api("/api/av/addAttributeViewBlocks", {avID, blockID: dbBlockID, srcs: [{id: ctx.docB, isDetached: false, content: "李四"}]});
    return {detail: `删除行 code=${removed.code} 文档仍在=${docAlive} 行已移除=${!stillThere}`, ok: removed.code === 0 && docAlive && !stillThere};
}

async function verifyDetachedWithValues(avID, ctx) {
    // 假设⑦：appendAttributeViewDetachedBlocksWithValues 带值建独立行（批量导入通道）
    const payload = await api("/api/av/appendAttributeViewDetachedBlocksWithValues", {
        avID,
        blocksValues: [[
            {keyID: ctx.keyIDs["微信"], type: "text", text: {content: "独立行测试"}},
            {keyID: ctx.keyIDs["分组"], type: "mSelect", mSelect: [{content: "同事", color: "4"}]},
        ]],
    });
    return {detail: `code=${payload.code} msg=${payload.msg}`, ok: payload.code === 0};
}

async function verifySqlOnAv(avID) {
    // 假设⑧（预期为否）：数据库是否暴露为 SQL 表——决定仪表盘读取走 renderAttributeView
    const probes = [`SELECT * FROM "av_${avID}" LIMIT 1`, `SELECT * FROM "av${avID}" LIMIT 1`, `SELECT * FROM "${avID}" LIMIT 1`];
    const outcomes = [];
    for (const stmt of probes) {
        const payload = await api("/api/query/sql", {stmt});
        outcomes.push(`${stmt.slice(14, 26)}…→ code=${payload.code}${payload.msg ? ` (${payload.msg.slice(0, 60)})` : ` rows=${(payload.data || []).length}`}`);
    }
    return {detail: outcomes.join(" | "), ok: true};
}

/* ---------- 主流程 ---------- */

async function main() {
    assertLoopback();
    await assertTestPortAvailable(HOST, PORT);
    prepareWorkspace();
    const {kernel, appDir} = resolveKernel();
    const {child, lines} = startKernel({kernel, appDir});
    const assertRunning = observeTestKernel(child);
    assertKernelRunning = assertRunning;
    let booted = false;
    let exitCode = 0;
    try {
        const version = await waitForBoot(lines, assertRunning);
        assertRunning();
        booted = true;
        record("内核启动", true, `v${version}`);
        token = (JSON.parse(fs.readFileSync(path.join(WORKSPACE, "conf", "conf.json"), "utf8")).accessAuthCode) || "";

        const notebooks = await apiChecked("/api/notebook/lsNotebooks", {});
        let notebookID = (notebooks.notebooks || []).find((n) => n.name === "RenmaiSpike")?.id;
        if (!notebookID) {
            await apiChecked("/api/notebook/createNotebook", {name: "RenmaiSpike"});
            const refreshed = await apiChecked("/api/notebook/lsNotebooks", {});
            notebookID = (refreshed.notebooks || []).find((n) => n.name === "RenmaiSpike")?.id;
        }
        if (!notebookID || typeof notebookID !== "string") throw new Error(`笔记本 ID 异常: ${JSON.stringify(notebookID)}`);

        const step1 = await verifyDbBlockCreation(notebookID);
        record("① DOM 插库块 + createIfNotExist 建库", step1.ok, step1.detail);
        if (!step1.ok) throw new Error("建库失败，后续验证无意义");

        const step2 = await verifyAddFields(step1.avID);
        record("② addAttributeViewKey 建九类字段", step2.ok, step2.detail);

        let step3 = {ok: false, detail: "跳过（字段未建齐）"};
        if (step2.ok) {
            step3 = await verifyRelationConfig(step1.avID, step2.keyIDs);
            record("③ transactions 配置 relation 自关联双向", step3.ok, step3.detail);
        }

        const step4 = await verifyBindRows(step1.avID, step1.dbBlockID, notebookID);
        record("④ 绑定文档为行 + itemID 映射", step4.ok, step4.detail);

        let step5 = {ok: false, detail: "跳过（绑定失败）"};
        if (step4.ok) {
            step5 = await verifyCellValues(step1.avID, step1.dbBlockID, {...step4, keyIDs: step2.keyIDs});
            record("⑤ 九类单元格值写入回读", step5.ok, step5.detail);
        }

        let step6 = {ok: false, detail: "跳过（绑定失败）"};
        if (step4.ok) {
            step6 = await verifyUnbind(step1.avID, step1.dbBlockID, step4);
            record("⑥ 解绑不删文档", step6.ok, step6.detail);
        }

        let step7 = {ok: false, detail: "跳过（字段未建齐）"};
        if (step2.ok) {
            step7 = await verifyDetachedWithValues(step1.avID, {keyIDs: step2.keyIDs});
            record("⑦ 带值建独立行（导入通道）", step7.ok, step7.detail);
        }

        const step8 = await verifySqlOnAv(step1.avID);
        record("⑧ 数据库 SQL 表探测（预期不存在）", step8.ok, step8.detail);

        const failures = results.filter((r) => !r.ok);
        exitCode = failures.length > 0 ? 1 : 0;
        fs.writeFileSync(path.join(process.cwd(), "scripts", "spike", "spike-results.json"),
            `${JSON.stringify({version, at: new Date().toISOString(), results}, null, 2)}\n`);
        console.log(`\n== spike 完成：${results.length - failures.length}/${results.length} 通过，结果已写入 scripts/spike/spike-results.json ==`);
    } finally {
        if (booted && child.exitCode === null && child.signalCode === null) {
            await api("/api/system/exit", {force: true}).catch(() => undefined);
        }
        const exited = await Promise.race([
            new Promise((resolve) => child.exitCode !== null || child.signalCode !== null ? resolve(true) : child.once("exit", () => resolve(true))),
            new Promise((resolve) => setTimeout(() => resolve(false), 8000)),
        ]);
        if (!exited) child.kill("SIGKILL");
    }
    process.exit(exitCode);
}

main().catch((error) => {
    console.error("SPIKE ERROR:", error.message);
    process.exit(2);
});
