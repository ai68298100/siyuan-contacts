import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { assertTestPortAvailable, observeTestKernel, prepareIsolatedWorkspace } from "../e2e/kernel-safety.mjs";

const workspace = path.join(os.tmpdir(), `SiYuan-Contacts-Text-Spike-${randomUUID()}`);
const host = "127.0.0.1";
const candidates = [
    "D:/biji/SiYuan/resources/kernel/SiYuan-Kernel.exe",
    "D:/RJ/SiYuan/resources/kernel/SiYuan-Kernel.exe",
    path.join(process.env.ProgramFiles || "C:/Program Files", "SiYuan/resources/kernel/SiYuan-Kernel.exe"),
];
const kernel = candidates.find((candidate) => fs.existsSync(candidate));
if (!kernel) throw new Error("未找到隔离测试内核");
const appDir = path.resolve(path.dirname(kernel), "..");
for (const required of ["stage", "appearance"]) {
    if (!fs.existsSync(path.join(appDir, required))) throw new Error(`app 缺少 ${required}`);
}
const port = await new Promise((resolvePort, rejectPort) => {
    const server = net.createServer();
    server.once("error", rejectPort);
    server.listen({ host, port: 0 }, () => {
        const assigned = server.address().port;
        server.close((error) => error ? rejectPort(error) : resolvePort(assigned));
    });
});
await assertTestPortAvailable(host, port);
prepareIsolatedWorkspace(workspace, "text-encoding-spike.json", "lvct text encoding spike");
const child = spawn(kernel, ["--workspace", workspace, "serve", "--wd", appDir, "--port", String(port)], {
    stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
    env: { ...process.env, SIYUAN_WORKSPACE_PATH: workspace },
});
const assertRunning = observeTestKernel(child);
const lines = [];
for (const stream of [child.stdout, child.stderr]) stream.on("data", (chunk) => {
    lines.push(...String(chunk).split(/\r?\n/).filter(Boolean));
    if (lines.length > 300) lines.splice(0, lines.length - 300);
});
const results = { workspace, kernel, port, observations: [] };
let token = "";
async function request(route, body = {}) {
    assertRunning();
    const response = await fetch(`http://${host}:${port}${route}`, {
        method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Token ${token}` } : {}) },
        body: JSON.stringify(body), signal: AbortSignal.timeout(30000),
    });
    assertRunning();
    const payload = await response.json();
    if (payload.code !== 0) throw new Error(`${route}: ${payload.msg}`);
    return payload.data;
}
async function readDoc(docId) {
    if (!/^\d{14}-[a-z0-9]{7}$/.test(docId)) throw new Error("内核没有返回合法文档 ID");
    await request("/api/sqlite/flushTransaction");
    const rows = await request("/api/query/sql", { stmt: `SELECT id, content, hpath, path FROM blocks WHERE type='d' AND id='${docId}'` });
    if (rows.length !== 1) throw new Error("文档回读未核实");
    return rows[0];
}
try {
    const deadline = Date.now() + 60000;
    while (true) {
        assertRunning();
        if (lines.some((line) => line.includes("lock workspace"))) throw new Error("本轮隔离工作区被占用");
        const configPath = path.join(workspace, "conf", "conf.json");
        if (fs.existsSync(configPath)) token = JSON.parse(fs.readFileSync(configPath, "utf8")).api?.token ?? "";
        const boot = await request("/api/system/bootProgress").catch(() => undefined);
        if (Number(boot?.progress) >= 100) break;
        if (Date.now() > deadline) throw new Error("隔离内核启动超时");
        await new Promise((resolveWait) => setTimeout(resolveWait, 500));
    }
    results.version = await request("/api/system/version");
    await request("/api/notebook/createNotebook", { name: "文本编码隔离验证" });
    const notebooks = await request("/api/notebook/lsNotebooks");
    const notebook = notebooks.notebooks.find((item) => item.name === "文本编码隔离验证");
    if (!notebook) throw new Error("未核实本轮笔记本");
    for (const title of ["中文 空格 [甲](乙)#", "斜/杠\\与%字符", "换\n行\r姓名"]) {
        for (const kind of ["raw", "encoded"]) {
            const segment = kind === "raw" ? title : encodeURIComponent(title);
            try {
                const docId = await request("/api/filetree/createDocWithMd", {
                    notebook: notebook.id, path: `/${kind}/${segment}`, markdown: "测试正文\n",
                });
                const before = await readDoc(docId);
                let renameError;
                try { await request("/api/filetree/renameDoc", { notebook: notebook.id, path: before.path, title }); }
                catch (error) { renameError = error.message; }
                const after = await readDoc(docId);
                results.observations.push({ title, kind, before, after, renameError });
            } catch (error) {
                results.observations.push({ title, kind, error: error.message });
            }
            console.log(JSON.stringify(results.observations.at(-1)));
        }
    }
    const requestId = "20261004000000-vcfreq1";
    const markedDocId = await request("/api/filetree/createDocWithMd", {
        notebook: notebook.id, path: "/标记联系人",
        markdown: `# 标记联系人\n{: custom-lvct-vcard="${requestId}"}\n\n`,
    });
    await request("/api/sqlite/flushTransaction");
    const markers = await request("/api/query/sql", {
        stmt: `SELECT root_id, box, ial FROM blocks WHERE box='${notebook.id}' AND ial LIKE '%custom-lvct-vcard="${requestId}"%'`,
    });
    results.requestMarker = { markedDocId, requestId, markers };
    if (markers.length !== 1 || markers[0].root_id !== markedDocId) throw new Error("vCard 请求标记没有与文档原子创建");
    console.log(JSON.stringify(results.requestMarker));
    results.contactRequestMarker = [];
    for (const attrName of ["custom-lvct-contact-draft", "custom-lvct-self-draft"]) {
        const draftRequestId = `20261004000000-${attrName.includes("self") ? "self001" : "cont001"}`;
        const docId = await request("/api/filetree/createDocWithMd", {
            notebook: notebook.id, path: `/稳定请求/${attrName}`,
            markdown: `# 稳定请求\n{: ${attrName}="${draftRequestId}"}\n\n`,
        });
        await request("/api/sqlite/flushTransaction");
        const roots = await request("/api/query/sql", {
            stmt: `SELECT DISTINCT root_id FROM blocks WHERE box='${notebook.id}' AND ial LIKE '%${attrName}="${draftRequestId}"%' LIMIT 2`,
        });
        if (roots.length !== 1 || roots[0].root_id !== docId) throw new Error(`${attrName} 请求标记没有与文档原子创建`);
        results.contactRequestMarker.push({ attrName, requestId: draftRequestId, docId, roots });
    }
    console.log(JSON.stringify(results.contactRequestMarker));
} catch (error) {
    results.error = error.message;
    results.kernelLogTail = lines.slice(-15);
    process.exitCode = 1;
} finally {
    fs.writeFileSync(path.join(import.meta.dirname, "text-encoding-results.json"), JSON.stringify(results, null, 2) + "\n");
    await request("/api/system/exit", { force: true }).catch(() => {});
    if (child.exitCode === null && child.signalCode === null) child.kill();
}
