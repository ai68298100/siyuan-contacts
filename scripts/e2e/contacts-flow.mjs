/* M2 联系人流程集成验证：在隔离内核上按 services/init.ts 与 services/contacts.ts
   的同一 API 序列走完整链路（建库→建人→重复建→关系→读回）。
   HTTP 形状与 api/ 层一一对应，作为该层的契约回归。 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {spawn} from "node:child_process";

const HOST = "127.0.0.1";
const PORT = 6830;
const BASE = `http://${HOST}:${PORT}`;
const MARKER = "renmai-e2e.json";
const workspace = process.env.LVCT_E2E_WORKSPACE || path.join(os.homedir(), "SiYuan-Renmai-E2E");

const results = [];
const record = (name, ok, detail) => {
    results.push({name, ok, detail});
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

let token = "";
async function api(route, body = {}) {
    const headers = {"Content-Type": "application/json"};
    if (token) headers.Authorization = `Token ${token}`;
    const response = await fetch(`${BASE}${route}`, {method: "POST", headers, body: JSON.stringify(body)});
    const text = await response.text();
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
    return {notebookId, hostDocId, avId, dbBlockId, fieldMap};
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

async function waitForBoot(lines) {
    const until = Date.now() + 60000;
    while (Date.now() < until) {
        const progress = await api("/api/system/bootProgress").catch(() => undefined);
        if (progress?.code === 0 && Number(progress?.data?.progress) >= 100) return;
        await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error(`内核启动超时:\n${lines.slice(-15).join("\n")}`);
}

async function main() {
    const kernelPath = ["D:\\biji\\SiYuan\\resources\\kernel\\SiYuan-Kernel.exe"].find((c) => fs.existsSync(c));
    if (!kernelPath) throw new Error("未找到内核");
    if (!fs.existsSync(workspace)) {
        fs.mkdirSync(path.join(workspace, "data"), {recursive: true});
        fs.writeFileSync(path.join(workspace, MARKER), JSON.stringify({createdBy: "renmai e2e"}) + "\n");
    }
    const appDir = path.resolve(path.dirname(kernelPath), "..");
    const {child, lines} = startKernel({kernel: kernelPath, appDir});
    let exitCode = 0;
    try {
        await waitForBoot(lines);
        token = JSON.parse(fs.readFileSync(path.join(workspace, "conf", "conf.json"), "utf8")).accessAuthCode || "";
        record("内核启动", true, "");

        const ctx = await initWorkspace("人脉-E2E");
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

        const failures = results.filter((r) => !r.ok);
        exitCode = failures.length > 0 ? 1 : 0;
        console.log(`\n== 联系人流程验证：${results.length - failures.length}/${results.length} 通过 ==`);
    } catch (error) {
        exitCode = 1;
        console.error("E2E FAIL:", error.message);
        console.error(lines.slice(-15).join("\n"));
    } finally {
        await api("/api/system/exit", {force: true}).catch(() => undefined);
        const exited = await Promise.race([
            new Promise((resolve) => child.once("exit", () => resolve(true))),
            new Promise((resolve) => setTimeout(() => resolve(false), 8000)),
        ]);
        if (!exited) child.kill("SIGKILL");
    }
    process.exit(exitCode);
}

main().catch((error) => {
    console.error("E2E ERROR:", error.message);
    process.exit(2);
});
