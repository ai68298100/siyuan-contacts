import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { assertTestPortAvailable, observeTestKernel, prepareIsolatedWorkspace } from "../e2e/kernel-safety.mjs";

const workspace = path.join(os.tmpdir(), `SiYuan-Lvct-OrgPage-${randomUUID()}`);
const host = "127.0.0.1";
const kernel = [
    "D:/biji/SiYuan/resources/kernel/SiYuan-Kernel.exe",
    "D:/RJ/SiYuan/resources/kernel/SiYuan-Kernel.exe",
    path.join(process.env.ProgramFiles || "C:/Program Files", "SiYuan/resources/kernel/SiYuan-Kernel.exe"),
].find((candidate) => fs.existsSync(candidate));
if (!kernel) throw new Error("未找到隔离测试内核");

const port = await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen({ host, port: 0 }, () => {
        const assigned = server.address().port;
        server.close((error) => error ? reject(error) : resolve(assigned));
    });
});
await assertTestPortAvailable(host, port);
prepareIsolatedWorkspace(workspace, "lvct-org-page-spike.json", "lvct organization pagination spike");

const results = { isolated: true, workspace, kernelVersion: "", notebookId: "", pages: [], checks: [], at: new Date().toISOString() };
let child;
let assertRunning;
let token = "";
const record = (name, ok, detail) => {
    results.checks.push({ name, ok, detail });
    console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
    if (!ok) throw new Error(`${name}: ${detail}`);
};
async function api(route, body = {}) {
    assertRunning?.();
    const response = await fetch(`http://${host}:${port}${route}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Token ${token}` } : {}) },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30000),
    });
    const payload = await response.json();
    assertRunning?.();
    return payload;
}
async function request(route, body = {}) {
    const payload = await api(route, body);
    if (payload.code !== 0) throw new Error(`${route} code=${payload.code} msg=${payload.msg}`);
    return payload.data;
}
async function start() {
    child = spawn(kernel, ["--workspace", workspace, "serve", "--wd", path.resolve(path.dirname(kernel), ".."), "--port", String(port)], {
        stdio: "ignore", windowsHide: true, env: { ...process.env, SIYUAN_WORKSPACE_PATH: workspace },
    });
    assertRunning = observeTestKernel(child);
    const deadline = Date.now() + 60000;
    while (true) {
        assertRunning();
        const configPath = path.join(workspace, "conf", "conf.json");
        if (fs.existsSync(configPath)) {
            const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
            token = config.api?.token ?? config.accessAuthCode ?? "";
        }
        const progress = await api("/api/system/bootProgress").catch(() => undefined);
        if (progress?.code === 0 && progress.data?.progress >= 100) return;
        if (Date.now() > deadline) throw new Error("隔离内核启动超时");
        await new Promise((resolve) => setTimeout(resolve, 300));
    }
}
async function stop() {
    if (!child) return;
    await api("/api/system/exit", { force: true }).catch(() => undefined);
    await new Promise((resolve) => {
        if (child.exitCode !== null || child.signalCode !== null) return resolve();
        const timer = setTimeout(() => child.kill(), 5000);
        child.once("exit", () => { clearTimeout(timer); resolve(); });
    });
    child = undefined;
}

try {
    await start();
    results.kernelVersion = await request("/api/system/version");
    await request("/api/notebook/createNotebook", { name: "组织分页隔离验证" });
    const notebooks = await request("/api/notebook/lsNotebooks");
    const notebook = notebooks.notebooks.find((entry) => entry.name === "组织分页隔离验证");
    if (!notebook?.id) throw new Error("隔离笔记本创建后未找到");
    results.notebookId = notebook.id;
    const docs = [];
    for (const [index, name] of ["组织甲", "组织乙", "组织丙"].entries()) {
        docs.push(await request("/api/filetree/createDocWithMd", {
            notebook: notebook.id,
            path: `/组织分页/${String(index).padStart(4, "0")}`,
            markdown: `# ${name}\n\n组织正文\n{: custom-lvct-org="${index === 1 ? "archived" : "1"}"}\n`,
        }));
    }
    await request("/api/sqlite/flushTransaction");
    const select = `SELECT root_id, MIN(ial) AS ial, MAX(ial) AS maxIal, COUNT(*) AS markerCount FROM blocks WHERE box='${notebook.id}' AND ial LIKE '%custom-lvct-org="%'`;
    const finish = "GROUP BY root_id ORDER BY root_id LIMIT 2";
    const first = await request("/api/query/sql", { stmt: `${select} ${finish}` });
    record("组织标记首页稳定排序与 LIMIT", first.length === 2 && first.every((row) => row.markerCount === 1 && row.ial === row.maxIal), `rows=${first.length}`);
    const cursor = first.at(-1)?.root_id;
    if (typeof cursor !== "string") throw new Error("第一页缺少 root_id");
    const second = await request("/api/query/sql", { stmt: `${select} AND root_id > '${cursor}' ${finish}` });
    record("root_id keyset 游标不重叠", second.length === 1 && second.every((row) => row.root_id > cursor), `rows=${second.length}`);
    const third = await request("/api/query/sql", { stmt: `${select} AND root_id > '${second.at(-1)?.root_id ?? cursor}' ${finish}` });
    record("短页确认组织标记读取结束", third.length === 0, `rows=${third.length}`);
    const returnedIds = [...first, ...second].map((row) => row.root_id);
    const returnedDocs = await request("/api/query/sql", { stmt: `SELECT id, content, hpath, box FROM blocks WHERE type='d' AND id IN (${returnedIds.map((id) => `'${id}'`).join(",")})` });
    record("分页返回根 ID 可唯一回读文档", returnedDocs.length === 3 && returnedDocs.every((row) => returnedIds.includes(row.id) && row.box === notebook.id), `docs=${returnedDocs.length}`);
    results.pages = [{ rows: first.length, cursor }, { rows: second.length, cursor: second.at(-1)?.root_id ?? null }, { rows: third.length }];
} catch (error) {
    results.error = error instanceof Error ? error.message : String(error);
    process.exitCode = 1;
} finally {
    fs.writeFileSync(path.join(import.meta.dirname, "organization-pagination-results.json"), JSON.stringify(results, null, 2) + "\n");
    if (child && child.exitCode === null && child.signalCode === null) await stop();
}
