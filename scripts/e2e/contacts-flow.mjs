/* M2 联系人流程集成验证：在隔离内核上按 services/init.ts 与 services/contacts.ts
   的同一 API 序列走完整链路（建库→建人→重复建→关系→读回）。
   HTTP 形状与 api/ 层一一对应，作为该层的契约回归。 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import {spawn} from "node:child_process";
import { prepareIsolatedWorkspace, assertTestPortAvailable, observeTestKernel } from "./kernel-safety.mjs";
import { guardScratch, kernelTokenFromConfig, makeApi, resolveTarget, sweepOrphans } from "../lib/smoke-kernel.mjs";

const HOST = "127.0.0.1";
const PORT = 6830;
const DEFAULT_BASE = `http://${HOST}:${PORT}`;
const MARKER = "renmai-e2e.json";

function readArg(name) {
    const index = process.argv.indexOf(name);
    return index >= 0 ? process.argv[index + 1] : undefined;
}

const cliBase = readArg("--base-url");
const cliToken = readArg("--token");
const cliWorkspace = readArg("--workspace");
const workspace = cliWorkspace || process.env.LVCT_E2E_WORKSPACE || path.join(os.tmpdir(), `SiYuan-Lvct-Contacts-${randomUUID()}`);

const results = [];
const record = (name, ok, detail) => {
    results.push({name, ok, detail});
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

let token = "";
let base = DEFAULT_BASE;
let assertKernelRunning;
let ownedNotebookId = "";
async function api(route, body = {}) {
    assertKernelRunning?.();
    const headers = {"Content-Type": "application/json"};
    if (token) headers.Authorization = `Token ${token}`;
    const response = await fetch(`${base}${route}`, {method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(5000)});
    const text = await response.text();
    assertKernelRunning?.();
    return text ? JSON.parse(text) : {};
}
async function apiChecked(route, body = {}) {
    const payload = await api(route, body);
    if (payload.code !== 0) throw new Error(`${route} code=${payload.code} msg=${payload.msg}`);
    return payload.data;
}

function newNodeId() {
    const now = new Date();
    const pad = (n, w) => String(n).padStart(w, "0");
    const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1, 2)}${pad(now.getDate(), 2)}${pad(now.getHours(), 2)}${pad(now.getMinutes(), 2)}${pad(now.getSeconds(), 2)}`;
    const charset = "0123456789abcdefghijklmnopqrstuvwxyz";
    let rand = "";
    for (let i = 0; i < 7; i += 1) rand += charset[Math.floor(Math.random() * charset.length)];
    return `${stamp}-${rand}`;
}

function resolveKernel() {
    const candidates = [
        "D:\\biji\\SiYuan\\resources\\kernel\\SiYuan-Kernel.exe",
        "D:\\RJ\\SiYuan\\resources\\kernel\\SiYuan-Kernel.exe",
        path.join(process.env.ProgramFiles || "C:\\Program Files", "SiYuan", "resources", "kernel", "SiYuan-Kernel.exe"),
    ];
    const kernel = candidates.find((candidate) => fs.existsSync(candidate));
    if (!kernel) throw new Error("未找到 SiYuan-Kernel.exe");
    return {kernel, appDir: path.resolve(path.dirname(kernel), "..")};
}

/* 以下与 src/services/init.ts + contacts.ts 保持同一序列 */

const FIELD_SPECS = [
    ["birthday", "生日", "date"], ["lunarBirthday", "农历生日", "checkbox"], ["phone", "电话", "phone"],
    ["email", "邮箱", "email"], ["wechat", "微信", "text"], ["website", "网站", "url"],
    ["group", "分组", "select"], ["tags", "标签", "mSelect"], ["related", "相关人", "relation"],
];

async function initWorkspace(notebookName) {
    await api("/api/notebook/createNotebook", {name: notebookName});
    const notebooks = await apiChecked("/api/notebook/lsNotebooks", {});
    const notebookId = notebooks.notebooks.find((n) => n.name === notebookName).id;
    if (!notebookId) throw new Error("笔记本创建失败");
    ownedNotebookId = notebookId;

    const hostDocId = await apiChecked("/api/filetree/createDocWithMd", {notebook: notebookId, path: "/联系人总表", markdown: "# 联系人总表\n\n"});
    const avId = newNodeId();
    const inserted = await api("/api/block/insertBlock", {
        dataType: "dom", parentID: hostDocId,
        data: `<div data-type="NodeAttributeView" data-av-id="${avId}" data-av-type="table"></div>`,
    });
    if (inserted.code !== 0) throw new Error(`insertBlock: ${inserted.msg}`);
    const dbBlockId = inserted.data[0].doOperations[0].id;
    await apiChecked("/api/av/renderAttributeView", {id: avId, blockID: dbBlockId, createIfNotExist: true});

    const fieldMap = {};
    let previousKeyID = "";
    for (const [key, name, type] of FIELD_SPECS) {
        const keyID = newNodeId();
        await apiChecked("/api/av/addAttributeViewKey", {avID: avId, keyID, keyName: name, keyType: type, keyIcon: "", previousKeyID});
        fieldMap[key] = keyID;
        previousKeyID = keyID;
    }
    await api("/api/transactions", {
        reqId: Date.now(),
        transactions: [{doOperations: [{action: "updateAttrViewColRelation", avID: avId, keyID: fieldMap.related, id: avId, isTwoWay: true, backRelationKeyID: newNodeId(), name: "被相关人", format: "相关人"}], undoOperations: []}],
    });
    return {notebookId, notebookName, hostDocId, avId, dbBlockId, fieldMap};
}

async function createContact(ctx, draft) {
    const list = await apiChecked("/api/av/renderAttributeView", {id: ctx.avId, blockID: ctx.dbBlockId, query: draft.name, pageSize: -1});
    const keyToField = Object.fromEntries(Object.entries(ctx.fieldMap).map(([k, v]) => [v, k]));
    for (const row of list.view.rows) {
        const pk = row.cells.find((c) => c.value.type === "block");
        if (pk?.value?.block?.content === draft.name) throw new Error(`联系人「${draft.name}」已存在`);
        void keyToField;
    }
    const docId = await apiChecked("/api/filetree/createDocWithMd", {notebook: ctx.notebookId, path: `/${ctx.notebookName}/${draft.name}`, markdown: `# ${draft.name}\n\n`});
    const bound = await apiChecked("/api/av/getAttributeViewItemIDsByBoundIDs", {avID: ctx.avId, blockIDs: [docId]});
    if (!bound[docId]) {
        await apiChecked("/api/av/addAttributeViewBlocks", {avID: ctx.avId, blockID: ctx.dbBlockId, srcs: [{id: docId, isDetached: false, content: draft.name}]});
    }
    const mapped = await apiChecked("/api/av/getAttributeViewItemIDsByBoundIDs", {avID: ctx.avId, blockIDs: [docId]});
    const itemId = mapped[docId];
    const writes = [];
    if (draft.phone) writes.push(api("/api/av/setAttributeViewBlockAttr", {avID: ctx.avId, keyID: ctx.fieldMap.phone, itemID: itemId, value: {phone: {content: draft.phone}}}));
    if (draft.birthdayMs) writes.push(api("/api/av/setAttributeViewBlockAttr", {avID: ctx.avId, keyID: ctx.fieldMap.birthday, itemID: itemId, value: {date: {content: draft.birthdayMs, isNotEmpty: true, isNotTime: true}}}));
    if (draft.isLunar) writes.push(api("/api/av/setAttributeViewBlockAttr", {avID: ctx.avId, keyID: ctx.fieldMap.lunarBirthday, itemID: itemId, value: {checkbox: {checked: true}}}));
    if (draft.group) writes.push(api("/api/av/setAttributeViewBlockAttr", {avID: ctx.avId, keyID: ctx.fieldMap.group, itemID: itemId, value: {mSelect: [{content: draft.group, color: "1"}]}}));
    if (draft.tags?.length) writes.push(api("/api/av/setAttributeViewBlockAttr", {avID: ctx.avId, keyID: ctx.fieldMap.tags, itemID: itemId, value: {mSelect: draft.tags.map((t, i) => ({content: t, color: String((i % 9) + 1)}))}}));
    for (const write of writes) {
        const payload = await write;
        if (payload.code !== 0) throw new Error(`写值失败: ${payload.msg}`);
    }
    return {docId, itemId};
}

function startKernel({kernel, appDir}) {
    const child = spawn(kernel, ["--workspace", workspace, "serve", "--wd", appDir, "--port", String(PORT)], {
        stdio: ["ignore", "pipe", "pipe"],
        env: {...process.env, SIYUAN_WORKSPACE_PATH: workspace},
    });
    const lines = [];
    for (const stream of [child.stdout, child.stderr]) {
        stream.on("data", (chunk) => {
            String(chunk).split(/\r?\n/).forEach((line) => { if (line) lines.push(line); });
        });
    }
    return {child, lines};
}

async function waitForBoot(lines, assertRunning) {
    const until = Date.now() + 60000;
    while (Date.now() < until) {
        assertRunning();
        if (lines.some((line) => line.includes("lock workspace"))) throw new Error("测试工作区已被锁定");
        const progress = await api("/api/system/bootProgress").catch(() => undefined);
        if (progress?.code === 0 && Number(progress?.data?.progress) >= 100) return;
        await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error(`内核启动超时:\n${lines.slice(-15).join("\n")}`);
}

async function main() {
    const external = Boolean(cliBase || cliToken || process.env.SIYUAN_BASE_URL || process.env.SIYUAN_TOKEN);
    let child = null;
    const lines = [];
    if (external) {
        const target = resolveTarget({ baseArg: cliBase, tokenArg: cliToken });
        base = target.base;
        token = target.token;
        const guardedApi = makeApi(base, token);
        await sweepOrphans(guardedApi);
        await guardScratch(guardedApi, { base });
    } else {
        const {kernel, appDir} = resolveKernel();
        await assertTestPortAvailable(HOST, PORT);
        prepareIsolatedWorkspace(workspace, MARKER, "renmai e2e");
        const started = startKernel({kernel, appDir});
        child = started.child;
        lines.push(...started.lines);
        const assertRunning = observeTestKernel(child);
        assertKernelRunning = assertRunning;
    }
    let booted = false;
    let exitCode = 0;
    let ctx;
    try {
        if (!external) {
            await waitForBoot(lines, assertKernelRunning);
            assertKernelRunning();
            booted = true;
            token = kernelTokenFromConfig(JSON.parse(fs.readFileSync(path.join(workspace, "conf", "conf.json"), "utf8")));
            const guardedApi = makeApi(base, token);
            await sweepOrphans(guardedApi);
            await guardScratch(guardedApi, { base });
        } else {
            booted = true;
        }
        record("内核启动", true, "");

        ctx = await initWorkspace(`lvct-contacts-e2e-${Date.now()}`);
        record("初始化工作空间", true, `avId=${ctx.avId}`);

        const birthdayMs = new Date(1990, 4, 20).getTime();
        const zhang = await createContact(ctx, {name: "张三", phone: "13800138000", birthdayMs, isLunar: true, group: "朋友", tags: ["球友", "重点"]});
        const li = await createContact(ctx, {name: "李四"});
        record("新建两个联系人", !!zhang.itemId && !!li.itemId, `itemA=${zhang.itemId}`);

        let duplicateRejected = false;
        try {
            await createContact(ctx, {name: "张三"});
        } catch (error) {
            duplicateRejected = String(error.message).includes("已存在");
        }
        record("重复创建被拒绝", duplicateRejected, "");

        const rendered = await apiChecked("/api/av/renderAttributeView", {id: ctx.avId, blockID: ctx.dbBlockId, pageSize: -1});
        const rows = rendered.view.rows;
        const rowByName = new Map();
        for (const row of rows) {
            const pk = row.cells.find((c) => c.value.type === "block");
            rowByName.set(pk?.value?.block?.content, row);
        }
        const zhangRow = rowByName.get("张三");
        const zhangChecks = {
            rows: rows.length === 2,
            phone: zhangRow?.cells.some((c) => c.value.keyID === ctx.fieldMap.phone && c.value.phone?.content === "13800138000"),
            lunar: zhangRow?.cells.some((c) => c.value.keyID === ctx.fieldMap.lunarBirthday && c.value.checkbox?.checked === true),
            birthday: zhangRow?.cells.some((c) => c.value.keyID === ctx.fieldMap.birthday && c.value.date?.content === birthdayMs),
            group: zhangRow?.cells.some((c) => c.value.keyID === ctx.fieldMap.group && c.value.mSelect?.[0]?.content === "朋友"),
            tags: zhangRow?.cells.some((c) => c.value.keyID === ctx.fieldMap.tags && (c.value.mSelect?.length ?? 0) === 2),
        };
        record("列表读回与字段投影", Object.values(zhangChecks).every(Boolean), JSON.stringify(zhangChecks));

        // 双向关联：张三 related → 李四，则李四的回链列应出现张三
        const relSet = await api("/api/av/setAttributeViewBlockAttr", {avID: ctx.avId, keyID: ctx.fieldMap.related, itemID: zhang.itemId, value: {relation: {blockIDs: [li.itemId]}}});
        if (relSet.code !== 0) throw new Error(`写关系失败: ${relSet.msg}`);
        const reRendered = await apiChecked("/api/av/renderAttributeView", {id: ctx.avId, blockID: ctx.dbBlockId, pageSize: -1});
        const liRowFresh = reRendered.view.rows.find((row) => row.id === li.itemId);
        const backCell = liRowFresh?.cells.find((c) => c.value.keyID !== ctx.fieldMap.related && c.value.type === "relation");
        record("双向关联回链生效", (backCell?.value.relation?.blockIDs ?? []).includes(zhang.itemId),
            `back=[${(backCell?.value.relation?.blockIDs ?? []).join(",")}]`);

        // 相关人物双链区块：插入带 custom-lvct-related 标记的段落（services/doc-section.ts 同序列）
        const ATTR = "custom-lvct-related";
        const sectionMd = `**相关人物**：[李四](siyuan://blocks/${li.docId})\n{: ${ATTR}="1"}`;
        const inserted = await api("/api/block/insertBlock", {dataType: "markdown", parentID: zhang.docId, data: sectionMd});
        if (inserted.code !== 0) throw new Error(`区块插入失败: ${inserted.msg}`);
        const sectionBlockId = (inserted.data?.[0]?.doOperations ?? inserted.data?.[0]?.operations)?.[0]?.id;
        await apiChecked("/api/sqlite/flushTransaction");
        const found = await apiChecked("/api/query/sql", {
            stmt: `SELECT id, markdown, ial FROM blocks WHERE root_id = '${zhang.docId}' AND ial LIKE '%${ATTR}="%' LIMIT 1`,
        });
        record("相关人物区块可按属性检索",
            found.length === 1 && (found[0].markdown || "").includes(`siyuan://blocks/${li.docId}`) && (found[0].ial || "").includes(ATTR),
            `blocks=${found.length} ial=${(found[0]?.ial || "").slice(0, 80)}`);

        // 关系清空 → 区块删除
        await api("/api/block/deleteBlock", {id: sectionBlockId});
        await apiChecked("/api/sqlite/flushTransaction");
        const afterRemove = await apiChecked("/api/query/sql", {
            stmt: `SELECT id FROM blocks WHERE root_id = '${zhang.docId}' AND ial LIKE '%${ATTR}="%' LIMIT 1`,
        });
        record("区块移除干净", afterRemove.length === 0, `left=${afterRemove.length}`);

        // 从笔记捕获：会议文档块引张三/李四 → refs 索引识别 → 参与人区块写入
        const meetingDoc = await apiChecked("/api/filetree/createDocWithMd", {
            notebook: ctx.notebookId, path: "/会议记录", markdown: "# 产品发布会\n\n今天和张三、李四开会。\n\n",
        });
        const refMd = `参会：(((${zhang.docId} "张三")))、(((${li.docId} "李四")))`;
        const refIns = await api("/api/block/insertBlock", {dataType: "markdown", parentID: meetingDoc, data: refMd});
        if (refIns.code !== 0) throw new Error(`块引插入失败: ${refIns.msg}`);
        await apiChecked("/api/sqlite/flushTransaction");
        const linked = await apiChecked("/api/query/sql", {
            stmt: `SELECT DISTINCT def_block_root_id AS docId FROM refs WHERE root_id = '${meetingDoc}' AND def_block_root_id != ''`,
        });
        const linkedSet = new Set(linked.map((row) => row.docId));
        record("refs 识别出链联系人", linkedSet.has(zhang.docId) && linkedSet.has(li.docId), `found=${[...linkedSet].join(",")}`);

        const attendeesMd = `**参与人员**（2026-09-27）：[张三](siyuan://blocks/${zhang.docId})、[李四](siyuan://blocks/${li.docId})\n{: ${"custom-lvct-attendees"}="1"}`;
        await api("/api/block/insertBlock", {dataType: "markdown", parentID: meetingDoc, data: attendeesMd});
        await apiChecked("/api/sqlite/flushTransaction");
        const attendees = await apiChecked("/api/query/sql", {
            stmt: `SELECT id, markdown FROM blocks WHERE root_id = '${meetingDoc}' AND ial LIKE '%custom-lvct-attendees="%' LIMIT 1`,
        });
        record("参与人员区块写入", attendees.length === 1 && (attendees[0].markdown || "").includes(`siyuan://blocks/${zhang.docId}`),
            `blocks=${attendees.length}`);

        // B13.7 组织归属链接区块：人物文档单标记块（services/org.ts 同序列）——写入/原地更新保 IAL/移除
        const orgDoc = await apiChecked("/api/filetree/createDocWithMd", {
            notebook: ctx.notebookId, path: "/曙光科技", markdown: "# 曙光科技\n\n",
        });
        await api("/api/block/insertBlock", {dataType: "markdown", parentID: orgDoc, data: `**组织**：曙光科技\n{: custom-lvct-org="1"}`});
        const ORG_LINKS_ATTR = "custom-lvct-org-links";
        const orgLinksMd = `**所属组织**：[曙光科技](siyuan://blocks/${orgDoc})（研发部 · 工程师）\n{: ${ORG_LINKS_ATTR}="1"}`;
        const orgLinksIns = await api("/api/block/insertBlock", {dataType: "markdown", parentID: zhang.docId, data: orgLinksMd});
        if (orgLinksIns.code !== 0) throw new Error(`组织链接区块插入失败: ${orgLinksIns.msg}`);
        const orgLinksBlockId = (orgLinksIns.data?.[0]?.doOperations ?? orgLinksIns.data?.[0]?.operations)?.[0]?.id;
        await apiChecked("/api/sqlite/flushTransaction");
        const orgLinksFound = await apiChecked("/api/query/sql", {
            stmt: `SELECT id, markdown, ial FROM blocks WHERE root_id = '${zhang.docId}' AND ial LIKE '%${ORG_LINKS_ATTR}="%' LIMIT 1`,
        });
        record("组织归属链接区块写入",
            orgLinksFound.length === 1 && (orgLinksFound[0].markdown || "").includes(`siyuan://blocks/${orgDoc}`),
            `blocks=${orgLinksFound.length}`);
        // 改名同步走整块更新：markdown 换新、IAL 关联键保留
        await api("/api/block/updateBlock", {
            id: orgLinksBlockId, dataType: "markdown",
            data: `**所属组织**：[新曙光](siyuan://blocks/${orgDoc})（研发部 · 工程师）\n{: ${ORG_LINKS_ATTR}="1"}`,
        });
        await apiChecked("/api/sqlite/flushTransaction");
        const renamedFound = await apiChecked("/api/query/sql", {
            stmt: `SELECT id, markdown, ial FROM blocks WHERE root_id = '${zhang.docId}' AND ial LIKE '%${ORG_LINKS_ATTR}="%' LIMIT 1`,
        });
        record("组织链接区块原地更新保 IAL",
            renamedFound.length === 1 && renamedFound[0].id === orgLinksBlockId
                && (renamedFound[0].markdown || "").includes("新曙光") && (renamedFound[0].ial || "").includes(ORG_LINKS_ATTR),
            `ial=${(renamedFound[0]?.ial || "").slice(0, 60)}`);
        await api("/api/block/deleteBlock", {id: orgLinksBlockId});
        await apiChecked("/api/sqlite/flushTransaction");
        const orgLinksGone = await apiChecked("/api/query/sql", {
            stmt: `SELECT id FROM blocks WHERE root_id = '${zhang.docId}' AND ial LIKE '%${ORG_LINKS_ATTR}="%' LIMIT 1`,
        });
        record("组织链接区块移除干净", orgLinksGone.length === 0, `left=${orgLinksGone.length}`);

        const failures = results.filter((r) => !r.ok);
        exitCode = failures.length > 0 ? 1 : 0;
        console.log(`\n== 联系人流程验证：${results.length - failures.length}/${results.length} 通过 ==`);
    } catch (error) {
        exitCode = 1;
        console.error("E2E FAIL:", error.message);
        console.error(lines.slice(-15).join("\n"));
    } finally {
        if (ownedNotebookId) {
            await api("/api/notebook/removeNotebook", { notebook: ownedNotebookId }).catch((error) => {
                console.warn(`WARN 临时库清理失败：${String(error).slice(0, 120)}`);
            });
        }
        if (child && booted && child.exitCode === null && child.signalCode === null) {
            await api("/api/system/exit", {force: true}).catch(() => undefined);
        }
        const exited = child ? await Promise.race([
            new Promise((resolve) => child.exitCode !== null || child.signalCode !== null ? resolve(true) : child.once("exit", () => resolve(true))),
            new Promise((resolve) => setTimeout(() => resolve(false), 8000)),
        ]) : true;
        if (child && !exited) child.kill("SIGKILL");
    }
    process.exit(exitCode);
}

main().catch((error) => {
    console.error("E2E ERROR:", error.message);
    process.exit(2);
});
