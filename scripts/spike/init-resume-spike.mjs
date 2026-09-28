/* 初始化续建 spike：实证"失败后重跑向导"所需的检测端点（隔离内核，端口 6831）。
   背景：v0.2.0 首次引导实故——第一次初始化在中途失败后，第二次重试在建笔记本一步
   直接报"已存在同名笔记本"而卡死。续建需要能可靠找回：笔记本 → 宿主文档 → 数据库块 →
   avID → 已有字段列，本脚本逐项实证这些检测通道在 v3.8.5 真内核上的真实行为。
   产出 scripts/spike/init-resume-results.json。 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {spawn} from "node:child_process";
import { prepareIsolatedWorkspace, assertTestPortAvailable, observeTestKernel } from "../e2e/kernel-safety.mjs";

const WORKSPACE = path.join(os.homedir(), "SiYuan-Renmai-Resume-Spike");
const HOST = "127.0.0.1";
const PORT = 6831;
const BASE = `http://${HOST}:${PORT}`;
const MARKER = "renmai-resume-spike.json";

const results = [];
const record = (name, ok, detail) => {
    results.push({name, ok, detail});
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

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
    const response = await fetch(`${BASE}${route}`, {method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(10000)});
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

const FIELD_SPECS = [
    ["birthday", "生日", "date"], ["related", "相关人", "relation"],
];

async function main() {
    const {kernel, appDir} = resolveKernel();
    await assertTestPortAvailable(HOST, PORT);
    prepareIsolatedWorkspace(WORKSPACE, MARKER, "renmai init-resume spike");
    const {child, lines} = startKernel({kernel, appDir});
    const assertRunning = observeTestKernel(child);
    assertKernelRunning = assertRunning;
    let booted = false;
    let exitCode = 0;
    try {
        const version = await waitForBoot(lines, assertRunning);
        booted = true;
        token = JSON.parse(fs.readFileSync(path.join(WORKSPACE, "conf", "conf.json"), "utf8")).accessAuthCode || "";
        record("内核启动", true, `v${version}`);

        /* ---- 通道 9：全新 AV 块上 createIfNotExist:false 的行为（生产代码 createDatabaseInDoc 的真实形状） ---- */
        const probeNotebook = `人脉-Probe-${Date.now().toString(36)}`;
        await apiChecked("/api/notebook/createNotebook", {name: probeNotebook});
        const probeNotebooks = await apiChecked("/api/notebook/lsNotebooks", {});
        const probeNotebookId = probeNotebooks.notebooks.find((n) => n.name === probeNotebook).id;
        const probeDoc = await apiChecked("/api/filetree/createDocWithMd", {notebook: probeNotebookId, path: "/宿主", markdown: "# 宿主\n\n"});
        const probeAvId = newNodeID();
        const probeInsert = await apiChecked("/api/block/insertBlock", {
            dataType: "dom", parentID: probeDoc,
            data: `<div data-type="NodeAttributeView" data-av-id="${probeAvId}" data-av-type="table"></div>`,
        });
        const probeBlockId = probeInsert[0].doOperations[0].id;
        const renderFalse = await api("/api/av/renderAttributeView", {id: probeAvId, blockID: probeBlockId, query: "", pageSize: -1, createIfNotExist: false});
        record("通道9a：全新块 createIfNotExist:false（生产 current 形状）", true,
            `code=${renderFalse.code} msg=${renderFalse.msg} columns=${JSON.stringify(renderFalse.data?.view?.columns?.map((c) => c.name) ?? null)}`);
        const renderTrue = await api("/api/av/renderAttributeView", {id: probeAvId, blockID: probeBlockId, query: "", pageSize: -1, createIfNotExist: true});
        record("通道9b：随后 createIfNotExist:true 可物化", renderTrue.code === 0,
            `code=${renderTrue.code} msg=${renderTrue.msg} columns=${JSON.stringify(renderTrue.data?.view?.columns?.map((c) => c.name) ?? null)}`);
        const renderFalseAgain = await api("/api/av/renderAttributeView", {id: probeAvId, blockID: probeBlockId, query: "", pageSize: -1, createIfNotExist: false});
        record("通道9c：物化后 createIfNotExist:false 可读", renderFalseAgain.code === 0,
            `code=${renderFalseAgain.code} msg=${renderFalseAgain.msg}`);

        /* ---- 通道 10：insertBlock 的 data 形状（dom / markdown 都要能取到新块 ID） ---- */
        const shapeNotebook = `人脉-Shape-${Date.now().toString(36)}`;
        await apiChecked("/api/notebook/createNotebook", {name: shapeNotebook});
        const shapeBooks = await apiChecked("/api/notebook/lsNotebooks", {});
        const shapeBookId = shapeBooks.notebooks.find((n) => n.name === shapeNotebook).id;
        const shapeDoc = await apiChecked("/api/filetree/createDocWithMd", {notebook: shapeBookId, path: "/形状", markdown: "# 形状\n\n"});
        const domPayload = await api("/api/block/insertBlock", {
            dataType: "dom", parentID: shapeDoc,
            data: `<div data-type="NodeAttributeView" data-av-id="${newNodeID()}" data-av-type="table"></div>`,
        });
        const domShape = {
            isArray: Array.isArray(domPayload.data),
            id: domPayload.data?.[0]?.doOperations?.[0]?.id ?? domPayload.data?.doOperations?.[0]?.id ?? "",
        };
        record("通道10a：insertBlock(dom) data 为事务结果数组且可取其 id", domShape.isArray && /^\d{14}-[0-9a-z]{7}$/.test(domShape.id),
            JSON.stringify({isArray: domShape.isArray, id: domShape.id, keys: Object.keys(domPayload.data ?? {})}));
        const mdPayload = await api("/api/block/insertBlock", {
            dataType: "markdown", parentID: shapeDoc, data: "**相关人物**：测试\n{: custom-lvct-probe=\"1\"}",
        });
        const mdShape = {
            isArray: Array.isArray(mdPayload.data),
            id: mdPayload.data?.[0]?.doOperations?.[0]?.id ?? mdPayload.data?.doOperations?.[0]?.id ?? "",
        };
        record("通道10b：insertBlock(markdown) 同上", mdShape.isArray && /^\d{14}-[0-9a-z]{7}$/.test(mdShape.id),
            JSON.stringify({isArray: mdShape.isArray, id: mdShape.id}));

        /* ---- 通道 11：端到端续建——按修复后的算法在真实内核上重跑"用户卡死的现场" ---- */
        const FIELD_SPECS_2 = [
            ["生日", "date"], ["农历生日", "checkbox"], ["电话", "phone"], ["邮箱", "email"],
            ["微信", "text"], ["网站", "url"], ["分组", "select"], ["标签", "mSelect"], ["相关人", "relation"],
        ];
        const brokenBookName = `人脉-ResumeE2E-${Date.now().toString(36)}`;
        await apiChecked("/api/notebook/createNotebook", {name: brokenBookName});
        const brokenBooks = await apiChecked("/api/notebook/lsNotebooks", {});
        const brokenBookId = brokenBooks.notebooks.find((n) => n.name === brokenBookName).id;
        const brokenHostDoc = await apiChecked("/api/filetree/createDocWithMd", {
            notebook: brokenBookId, path: "/联系人总表", markdown: "# 联系人总表\n\n",
        });
        const brokenAvId = newNodeID();
        const brokenInsert = await apiChecked("/api/block/insertBlock", {
            dataType: "dom", parentID: brokenHostDoc,
            data: `<div data-type="NodeAttributeView" data-av-id="${brokenAvId}" data-av-type="table"></div>`,
        });
        const brokenDbBlockId = brokenInsert[0].doOperations[0].id;
        await apiChecked("/api/sqlite/flushTransaction", {});
        record("通道11·现场：半成品（笔记本+宿主文档+未物化数据库块，无字段）", true,
            `book=${brokenBookId} host=${brokenHostDoc} block=${brokenDbBlockId}`);

        async function recoveryRun() {
            const created = { notebook: 0, doc: 0, block: 0, fields: [], relation: 0 };
            // 1) 按名找回笔记本
            const books = (await apiChecked("/api/notebook/lsNotebooks", {})).notebooks.filter((n) => n.name === brokenBookName);
            const book = books[0];
            if (!book) throw new Error("续建未找回笔记本");
            // 2) 笔记本内按标题找回宿主文档
            const docs = await apiChecked("/api/query/sql", {stmt: `SELECT id, content, hpath FROM blocks WHERE type='d' AND box='${book.id}'`});
            const host = docs.find((doc) => doc.content === "联系人总表");
            if (!host) throw new Error("续建未找回宿主文档");
            // 3) 文档内找回数据库块并还原 avID
            const avRows = await apiChecked("/api/query/sql",
                {stmt: `SELECT id, parent_id, markdown FROM blocks WHERE parent_id = '${host.id}' AND type = 'av'`});
            const avRow = avRows[0];
            const avId = /data-av-id="(\d{14}-[0-9a-z]{7})"/.exec(avRow?.markdown ?? "")?.[1] ?? "";
            if (!avId) throw new Error("续建未还原 avID");
            // 4) 物化（createIfNotExist:true；旧版本在这里传 false 才卡的）
            const rendered = await apiChecked("/api/av/renderAttributeView",
                {id: avId, blockID: avRow.id, query: "", pageSize: -1, createIfNotExist: true});
            const columns = rendered.view.columns;
            // 5) 按列名对账，只补缺失列
            const fieldMap = {};
            let previousKeyID = columns.at(-1)?.id ?? "";
            for (const [name, type] of FIELD_SPECS_2) {
                const hit = columns.find((column) => column.name === name && column.type === type);
                if (hit) { fieldMap[name] = hit.id; continue; }
                const keyID = newNodeID();
                await apiChecked("/api/av/addAttributeViewKey", {avID: avId, keyID, keyName: name, keyType: type, keyIcon: "", previousKeyID});
                fieldMap[name] = keyID;
                previousKeyID = keyID;
                created.fields.push(name);
            }
            // 6) 双向关联：回链列已在则跳过（重配会叠出第二列）
            const backExists = columns.some((column) => column.name === "被相关人" && column.type === "relation");
            if (!backExists) {
                await apiChecked("/api/transactions", {
                    reqId: Date.now(),
                    transactions: [{doOperations: [{action: "updateAttrViewColRelation", avID: avId, keyID: fieldMap["相关人"], id: avId, isTwoWay: true, backRelationKeyID: newNodeID(), name: "被相关人", format: "相关人"}], undoOperations: []}],
                });
                created.relation = 1;
            }
            await apiChecked("/api/sqlite/flushTransaction", {});
            const finalView = await apiChecked("/api/av/renderAttributeView", {id: avId, blockID: avRow.id, pageSize: -1});
            return {created, avId, dbBlockId: avRow.id, columns: finalView.view.columns.map((column) => `${column.name}:${column.type}`)};
        }

        const firstRun = await recoveryRun();
        const namesAfterFirst = firstRun.columns;
        const expectedColumns = FIELD_SPECS_2.map(([name, type]) => `${name}:${type}`);
        const missingExpected = expectedColumns.filter((entry) => !namesAfterFirst.includes(entry));
        const duplicated = [...new Set(namesAfterFirst.filter((entry, index) => namesAfterFirst.indexOf(entry) !== index))];
        record("通道11a：续建补建九个字段、无重名列、双向回链列就位",
            firstRun.created.fields.length === FIELD_SPECS_2.length &&
            missingExpected.length === 0 && duplicated.length === 0 &&
            namesAfterFirst.includes("被相关人:relation"),
            `新建=${firstRun.created.fields.join(",")} 缺=${missingExpected.join(",")} 重=${duplicated.join(",")}`);

        const secondRun = await recoveryRun();
        record("通道11b：二次续建完全幂等（零新建字段、零重配双向）",
            secondRun.created.fields.length === 0 && secondRun.created.relation === 0 &&
            secondRun.columns.length === namesAfterFirst.length,
            `fields=${secondRun.created.fields.length} relation=${secondRun.created.relation} columns=${secondRun.columns.length}`);

        /* ---- 造一个"第一次初始化中途失败"的现场：笔记本 + 宿主文档 + 数据库 + 两个字段 + 双向关联 ---- */
        const notebookName = `人脉-Resume-${Date.now().toString(36)}`;
        await apiChecked("/api/notebook/createNotebook", {name: notebookName});
        const notebooks = await apiChecked("/api/notebook/lsNotebooks", {});
        const notebookId = notebooks.notebooks.find((n) => n.name === notebookName).id;

        const hostDocId = await apiChecked("/api/filetree/createDocWithMd", {
            notebook: notebookId, path: "/联系人总表", markdown: "# 联系人总表\n\n",
        });
        const avId = newNodeID();
        const inserted = await apiChecked("/api/block/insertBlock", {
            dataType: "dom", parentID: hostDocId,
            data: `<div data-type="NodeAttributeView" data-av-id="${avId}" data-av-type="table"></div>`,
        });
        const dbBlockId = inserted[0].doOperations[0].id;
        await apiChecked("/api/av/renderAttributeView", {id: avId, blockID: dbBlockId, createIfNotExist: true});

        const fieldMap = {};
        let previousKeyID = "";
        for (const [key, name, type] of FIELD_SPECS) {
            const keyID = newNodeID();
            await apiChecked("/api/av/addAttributeViewKey", {avID: avId, keyID, keyName: name, keyType: type, keyIcon: "", previousKeyID});
            fieldMap[key] = keyID;
            previousKeyID = keyID;
        }
        await apiChecked("/api/transactions", {
            reqId: Date.now(),
            transactions: [{doOperations: [{action: "updateAttrViewColRelation", avID: avId, keyID: fieldMap.related, id: avId, isTwoWay: true, backRelationKeyID: newNodeID(), name: "被相关人", format: "相关人"}], undoOperations: []}],
        });
        await apiChecked("/api/sqlite/flushTransaction", {});
        record("造现场", true, `notebook=${notebookId} host=${hostDocId} av=${avId} dbBlock=${dbBlockId}`);

        /* ---- 通道 1：按笔记本列文档找宿主文档（值仅 notebookId，JS 侧比对标题） ---- */
        const docs = await apiChecked("/api/query/sql", {stmt: `SELECT id, content, hpath FROM blocks WHERE type='d' AND box='${notebookId}'`});
        const hostHit = docs.find((doc) => doc.content === "联系人总表");
        record("通道1：笔记本内按标题找回宿主文档", hostHit?.id === hostDocId,
            `rows=${docs.length} hit=${hostHit?.id === hostDocId} hpath=${hostHit?.hpath}`);

        /* ---- 通道 1b：hpath 字面量查询（备选，参考用；铁律倾向不把非 ID 值拼进 SQL） ---- */
        const docsByHpath = await apiChecked("/api/query/sql", {stmt: `SELECT id FROM blocks WHERE type='d' AND box='${notebookId}' AND hpath='/联系人总表'`});
        record("通道1b：hpath 字面量可查到（仅记录）", docsByHpath.length > 0, `rows=${docsByHpath.length}`);

        /* ---- 通道 2：宿主文档内的数据库块 ---- */
        const children = await apiChecked("/api/query/sql", {stmt: `SELECT id, type, subtype, content FROM blocks WHERE parent_id='${hostDocId}'`});
        const avBlockRow = children.find((row) => row.type === "av" || row.subtype === "av");
        record("通道2：parent_id + type='av' 找回数据库块", avBlockRow?.id === dbBlockId,
            `children=${JSON.stringify(children)}`);

        /* ---- 通道 3：从数据库块反推 avID ---- */
        const blockRow = await apiChecked("/api/query/sql", {stmt: `SELECT id, type, subtype, content, markdown, ial FROM blocks WHERE id='${dbBlockId}'`});
        record("通道3a：blocks.markdown/ial 是否含 avID", JSON.stringify(blockRow).includes(avId), JSON.stringify(blockRow).slice(0, 500));

        const kramdown = await api("/api/block/getBlockKramdown", {id: dbBlockId});
        record("通道3b：getBlockKramdown 是否含 avID", kramdown.code === 0 && JSON.stringify(kramdown.data).includes(avId),
            `code=${kramdown.code} data=${JSON.stringify(kramdown.data).slice(0, 400)}`);

        const childBlocks = await api("/api/block/getChildBlocks", {id: hostDocId});
        record("通道3c：getChildBlocks 是否含 avID", childBlocks.code === 0 && JSON.stringify(childBlocks.data).includes(avId),
            `code=${childBlocks.code} data=${JSON.stringify(childBlocks.data).slice(0, 500)}`);

        /* ---- 通道 4：列定义可按 keyName 映射回 keyID（续建跳过已有字段） ---- */
        const rendered = await apiChecked("/api/av/renderAttributeView", {id: avId, blockID: dbBlockId, pageSize: -1});
        const columns = rendered.view.columns.map((column) => ({id: column.id, name: column.name, type: column.type}));
        const nameToId = Object.fromEntries(columns.map((column) => [column.name, column.id]));
        record("通道4：renderView 列名→keyID 映射（含双向回链列）", nameToId["生日"] === fieldMap.birthday && nameToId["相关人"] === fieldMap.related && Boolean(nameToId["被相关人"]),
            JSON.stringify(columns));

        /* ---- 通道 5：错误 avID + 正确 blockID 的行为（决定"猜错就建新库"是否安全） ---- */
        const wrongId = newNodeID();
        const wrongRender = await api("/api/av/renderAttributeView", {id: wrongId, blockID: dbBlockId, pageSize: -1, createIfNotExist: false});
        record("通道5：错误 avID+正确 blockID（createIfNotExist:false）", true,
            `code=${wrongRender.code} msg=${wrongRender.msg} columns=${JSON.stringify(wrongRender.data?.view?.columns?.map((c) => c.name) ?? null)}`);

        /* ---- 通道 6：重复 keyName 的行为（用于确认"续建必须跳过已有字段"） ---- */
        const dupKeyID = newNodeID();
        const dupAdd = await api("/api/av/addAttributeViewKey", {avID: avId, keyID: dupKeyID, keyName: "生日", keyType: "date", keyIcon: "", previousKeyID});
        const afterDup = await apiChecked("/api/av/renderAttributeView", {id: avId, blockID: dbBlockId, pageSize: -1});
        const birthdayCols = afterDup.view.columns.filter((column) => column.name === "生日");
        record("通道6：重复 keyName 不报错但会叠加同名列", dupAdd.code === 0 && birthdayCols.length === 2,
            `addCode=${dupAdd.code} birthdayCols=${birthdayCols.length}`);

        /* ---- 通道 7：二次 renderAttributeView(createIfNotExist:true) 幂等，不改列 ---- */
        await apiChecked("/api/av/renderAttributeView", {id: avId, blockID: dbBlockId, createIfNotExist: true});
        const afterSecond = await apiChecked("/api/av/renderAttributeView", {id: avId, blockID: dbBlockId, pageSize: -1});
        record("通道7：物化调用幂等", afterSecond.view.columns.length === afterDup.view.columns.length,
            `before=${afterDup.view.columns.length} after=${afterSecond.view.columns.length}`);

        /* ---- 通道 8：重名笔记本第二次 createNotebook 的真实返回 ---- */
        const secondCreate = await api("/api/notebook/createNotebook", {name: notebookName});
        const notebooksAfter = await apiChecked("/api/notebook/lsNotebooks", {});
        const sameNameCount = notebooksAfter.notebooks.filter((n) => n.name === notebookName).length;
        record("通道8：重名 createNotebook 行为", true,
            `code=${secondCreate.code} msg=${secondCreate.msg} sameNameCount=${sameNameCount}`);

        fs.writeFileSync(path.join(import.meta.dirname, "init-resume-results.json"),
            JSON.stringify({kernel: version, ranAt: new Date().toISOString(), results}, null, 2) + "\n");
        const failed = results.filter((r) => !r.ok);
        console.log(`\n${results.length - failed.length}/${results.length} 项判定为符合预期`);
    } catch (error) {
        record("spike 异常", false, String(error?.message || error));
        try {
            fs.writeFileSync(path.join(import.meta.dirname, "init-resume-results.json"),
                JSON.stringify({ranAt: new Date().toISOString(), results, booted}, null, 2) + "\n");
        } catch { /* 记录失败不遮蔽原始错误 */ }
        exitCode = 1;
    } finally {
        child.kill();
        await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    process.exit(exitCode);
}

main();
