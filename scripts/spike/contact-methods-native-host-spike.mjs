/**
 * AG-RF-004-N1：真实隔离思源内核的原生联系方式块探针。
 *
 * 只使用 UUID 临时工作区和虚构人物/联系方式。脚本创建原生人物文档，
 * 通过 insertBlock 写入候选段落与属性，SQL/getChildBlocks 回读，重启内核，
 * 再清理本轮自己创建的插件缓存目录后回读。它不会安装插件、读取日常库，
 * 也不会把结果写入生产联系人模型。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { assertTestPortAvailable, observeTestKernel, prepareIsolatedWorkspace } from "../e2e/kernel-safety.mjs";

const workspace = path.join(os.tmpdir(), `SiYuan-Lvct-Contact-Native-${randomUUID()}`);
const host = "127.0.0.1";
const kernel = [
    "D:/biji/SiYuan/resources/kernel/SiYuan-Kernel.exe",
    "D:/RJ/SiYuan/resources/kernel/SiYuan-Kernel.exe",
    path.join(process.env.ProgramFiles || "C:/Program Files", "SiYuan/resources/kernel/SiYuan-Kernel.exe"),
].find((candidate) => fs.existsSync(candidate));
if (!kernel) throw new Error("未找到隔离测试内核");
const appDir = path.resolve(path.dirname(kernel), "..");
const port = await new Promise((resolvePort, rejectPort) => {
    const server = net.createServer();
    server.once("error", rejectPort);
    server.listen({ host, port: 0 }, () => {
        const assigned = server.address().port;
        server.close((error) => error ? rejectPort(error) : resolvePort(assigned));
    });
});
await assertTestPortAvailable(host, port);
prepareIsolatedWorkspace(workspace, "contact-methods-native-host-spike.json", "lvct native contact host spike");

const results = {
    research: "AG-RF-004-N1",
    generatedAt: new Date().toISOString(),
    syntheticOnly: false,
    isolatedHost: true,
    productionChanges: false,
    candidateContractAccepted: false,
    kernelRequests: 0,
    realPluginFileWrites: 0,
    workspace,
    kernel,
    port,
    hostVerified: false,
    observations: [],
};
let child;
let assertRunning;
let token = "";
const lines = [];

function digest(value) {
    return createHash("sha256").update(value).digest("hex").slice(0, 24);
}
function methodId(personDocId, sourceKey) {
    return `method-${digest(`${personDocId}:${sourceKey}`)}`;
}
function attrsFor(personDocId, sourceKey, type, label, primary, order) {
    return [
        `custom-lvct-contact-method="1"`,
        `custom-lvct-contact-method-format="1"`,
        `custom-lvct-contact-method-id="${methodId(personDocId, sourceKey)}"`,
        `custom-lvct-contact-method-owner="${personDocId}"`,
        `custom-lvct-contact-method-source="${sourceKey}"`,
        `custom-lvct-contact-method-type="${type}"`,
        `custom-lvct-contact-method-label="${label}"`,
        `custom-lvct-contact-method-primary="${primary ? "1" : "0"}"`,
        `custom-lvct-contact-method-order="${order}"`,
    ].join(" ");
}
function methodMarkdown(personDocId, method) {
    return [
        `联系方式：${method.typeLabel}`,
        `标签：${method.label}`,
        `主值：${method.primary ? "是" : "否"}`,
        "值：",
        method.value,
        `{: ${attrsFor(personDocId, method.sourceKey, method.type, method.label, method.primary, method.order)}}`,
    ].join("\n");
}
async function request(route, body = {}) {
    results.kernelRequests += 1;
    assertRunning?.();
    const response = await fetch(`http://${host}:${port}${route}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Token ${token}` } : {}) },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30000),
    });
    assertRunning?.();
    const payload = await response.json();
    if (payload.code !== 0) throw new Error(`${route}: ${payload.msg}`);
    return payload.data;
}
async function start() {
    child = spawn(kernel, ["--workspace", workspace, "serve", "--wd", appDir, "--port", String(port)], {
        stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
        env: { ...process.env, SIYUAN_WORKSPACE_PATH: workspace },
    });
    assertRunning = observeTestKernel(child);
    for (const stream of [child.stdout, child.stderr]) stream.on("data", (chunk) => {
        lines.push(...String(chunk).split(/\r?\n/).filter(Boolean));
        if (lines.length > 200) lines.splice(0, lines.length - 200);
    });
    const deadline = Date.now() + 60000;
    while (true) {
        assertRunning();
        const configPath = path.join(workspace, "conf", "conf.json");
        if (fs.existsSync(configPath)) token = JSON.parse(fs.readFileSync(configPath, "utf8")).api?.token ?? "";
        const boot = await request("/api/system/bootProgress").catch(() => undefined);
        if (Number(boot?.progress) >= 100) return;
        if (Date.now() > deadline) throw new Error("隔离内核启动超时");
        await new Promise((resolveWait) => setTimeout(resolveWait, 500));
    }
}
async function stop() {
    if (!child) return;
    await request("/api/system/exit", { force: true }).catch(() => {});
    const exited = child.exitCode !== null || child.signalCode !== null
        ? Promise.resolve() : new Promise((resolveExit) => child.once("exit", resolveExit));
    const timeout = setTimeout(() => child.kill(), 5000);
    await exited;
    clearTimeout(timeout);
    child = undefined;
    assertRunning = undefined;
    await assertTestPortAvailable(host, port);
}
async function flush() {
    await request("/api/sqlite/flushTransaction");
}
async function readMethods(docId) {
    await flush();
    const rows = await request("/api/query/sql", {
        stmt: `SELECT id, parent_id, type, content, markdown, ial FROM blocks WHERE root_id='${docId}' AND ial LIKE '%custom-lvct-contact-method="1"%' ORDER BY id`,
    });
    const children = await request("/api/block/getChildBlocks", { id: docId });
    return { rows, children };
}
function assertMethods(docId, expected, snapshot, phase) {
    assert.equal(snapshot.rows.length, expected.length, `${phase}: 标记块数量`);
    for (const method of expected) {
        const id = methodId(docId, method.sourceKey);
        const row = snapshot.rows.find((item) => item.ial.includes(`custom-lvct-contact-method-source="${method.sourceKey}"`));
        assert.ok(row, `${phase}: 缺少 ${method.sourceKey}`);
        assert.equal(row.parent_id, docId, `${phase}: parent_id`);
        assert.equal(row.type, "p", `${phase}: block type`);
        assert.match(row.ial, new RegExp(`custom-lvct-contact-method-id="${id}"`));
        assert.match(row.ial, /custom-lvct-contact-method="1"/);
        assert.match(row.content, new RegExp(method.value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
        assert.match(row.content, /值：/);
    }
    assert.equal(snapshot.children.filter((item) => snapshot.rows.some((row) => row.id === item.id)).length, expected.length, `${phase}: 子块回读`);
    results.observations.push({ phase, docId, rows: snapshot.rows, children: snapshot.children });
}

const people = [
    {
        name: "虚构人物甲",
        methods: [
            { sourceKey: "phone-primary", type: "phone", typeLabel: "电话", label: "工作 / 主线", primary: true, order: 0, value: "+00 111 / +00 222\n分机：7 | 备注：<保留> & 🙂" },
            { sourceKey: "email-shared", type: "email", typeLabel: "邮箱", label: "共享邮箱", primary: true, order: 1, value: "same@example.test" },
            { sourceKey: "wechat-secondary", type: "wechat", typeLabel: "微信", label: "私用🙂", primary: false, order: 2, value: "微信_甲\n第二行" },
        ],
    },
    {
        name: "虚构人物乙",
        methods: [
            { sourceKey: "phone-primary", type: "phone", typeLabel: "电话", label: "工作", primary: true, order: 0, value: "same-value" },
            { sourceKey: "email-shared", type: "email", typeLabel: "邮箱", label: "共享邮箱", primary: true, order: 1, value: "same@example.test" },
            { sourceKey: "custom-legacy", type: "custom", typeLabel: "自定义", label: "旧资料", primary: false, order: 2, value: "旧 slash 原文 / 不拆分" },
        ],
    },
];

try {
    await start();
    results.version = await request("/api/system/version");
    await request("/api/notebook/createNotebook", { name: "联系方式原生隔离验证" });
    const notebook = (await request("/api/notebook/lsNotebooks")).notebooks.find((item) => item.name === "联系方式原生隔离验证");
    assert.ok(notebook, "隔离笔记本未核实");
    const docs = [];
    for (const person of people) {
        const docId = await request("/api/filetree/createDocWithMd", { notebook: notebook.id, path: `/${person.name}`, markdown: `# ${person.name}\n\n原生人物文档：${person.name}\n` });
        assert.match(docId, /^\d{14}-[a-z0-9]{7}$/);
        for (const method of person.methods) {
            await request("/api/block/insertBlock", { dataType: "markdown", parentID: docId, data: methodMarkdown(docId, method) });
        }
        const snapshot = await readMethods(docId);
        assertMethods(docId, person.methods, snapshot, "首次写入");
        docs.push({ ...person, docId });
    }
    results.nativeWriteRead = { docs: docs.map(({ name, docId, methods }) => ({ name, docId, methods })) };
    const firstSnapshot = await readMethods(docs[0].docId);
    const phoneRow = firstSnapshot.rows.find((row) => row.ial.includes('custom-lvct-contact-method-source="phone-primary"'));
    assert.ok(phoneRow, "编辑探针缺少电话块");
    const editedValue = "改过的值 / 仍保留换行\n下一行";
    const editedBody = [
        "联系方式：电话",
        "标签：工作 / 主线",
        "主值：是",
        "值：",
        editedValue,
    ].join("\n");
    await request("/api/block/updateBlock", { id: phoneRow.id, dataType: "markdown", data: `${editedBody}\n${phoneRow.ial}` });
    const secondSnapshot = await readMethods(docs[1].docId);
    const deletedRow = secondSnapshot.rows.find((row) => row.ial.includes('custom-lvct-contact-method-source="custom-legacy"'));
    assert.ok(deletedRow, "删除探针缺少自定义块");
    await request("/api/block/deleteBlock", { id: deletedRow.id });
    docs[0].methods[0] = { ...docs[0].methods[0], value: editedValue };
    docs[1].methods = docs[1].methods.filter((method) => method.sourceKey !== "custom-legacy");
    assertMethods(docs[0].docId, docs[0].methods, await readMethods(docs[0].docId), "内核 API 改值后");
    assertMethods(docs[1].docId, docs[1].methods, await readMethods(docs[1].docId), "内核 API 删块后");
    results.nativeApiEditDelete = { editedSourceKey: "phone-primary", editedValue, deletedSourceKey: "custom-legacy", deletedBlockId: deletedRow.id };
    await stop();
    await start();
    for (const person of docs) assertMethods(person.docId, person.methods, await readMethods(person.docId), "内核重启后");
    results.restartReadback = true;
    await stop();

    const pluginStorage = path.join(workspace, "data", "storage", "petal", "siyuan-contacts");
    fs.mkdirSync(pluginStorage, { recursive: true });
    fs.writeFileSync(path.join(pluginStorage, "native-host-spike-cache.json"), JSON.stringify({ fictional: true, methods: 6 }) + "\n", "utf8");
    results.realPluginFileWrites = 1;
    fs.rmSync(pluginStorage, { recursive: true, force: true });
    results.pluginCacheClear = { path: pluginStorage, removed: !fs.existsSync(pluginStorage), fictionalOnly: true };
    await start();
    for (const person of docs) assertMethods(person.docId, person.methods, await readMethods(person.docId), "清理插件缓存后");
    results.afterPluginCacheClear = true;
    results.hostVerified = true;
} catch (error) {
    results.error = error.message;
    results.kernelLogTail = lines.slice(-20);
    process.exitCode = 1;
} finally {
    fs.writeFileSync(path.join(import.meta.dirname, "contact-methods-native-host-results.json"), JSON.stringify(results, null, 2) + "\n", "utf8");
    await stop().catch(() => {});
}

console.log(JSON.stringify({
    hostVerified: results.hostVerified,
    workspace: results.workspace,
    port: results.port,
    docs: results.nativeWriteRead?.docs?.length ?? 0,
    methods: results.nativeWriteRead?.docs?.reduce((sum, doc) => sum + doc.methods.length, 0) ?? 0,
    restartReadback: Boolean(results.restartReadback),
    afterPluginCacheClear: Boolean(results.afterPluginCacheClear),
    error: results.error ?? null,
}, null, 2));
