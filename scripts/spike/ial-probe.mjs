/* 临时探针：markdown 块的 IAL 属性落库行为。 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {spawn} from "node:child_process";

const PORT = 6831;
const BASE = `http://127.0.0.1:${PORT}`;
const workspace = path.join(os.homedir(), "SiYuan-Renmai-E2E");
let token = "";
async function api(route, body = {}) {
    const headers = {"Content-Type": "application/json"};
    if (token) headers.Authorization = `Token ${token}`;
    const response = await fetch(`${BASE}${route}`, {method: "POST", headers, body: JSON.stringify(body)});
    return JSON.parse(await response.text() || "{}");
}
async function apiChecked(route, body) {
    const p = await api(route, body);
    if (p.code !== 0) throw new Error(`${route} ${p.msg}`);
    return p.data;
}
function newNodeId() {
    const now = new Date();
    const pad = (n, w) => String(n).padStart(w, "0");
    const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1, 2)}${pad(now.getDate(), 2)}${pad(now.getHours(), 2)}${pad(now.getMinutes(), 2)}${pad(now.getSeconds(), 2)}`;
    const cs = "0123456789abcdefghijklmnopqrstuvwxyz";
    let r = "";
    for (let i = 0; i < 7; i += 1) r += cs[Math.floor(Math.random() * cs.length)];
    return `${stamp}-${r}`;
}

const kernelPath = "D:\\biji\\SiYuan\\resources\\kernel\\SiYuan-Kernel.exe";
const appDir = path.resolve(path.dirname(kernelPath), "..");
const child = spawn(kernelPath, ["--workspace", workspace, "serve", "--wd", appDir, "--port", String(PORT)], {stdio: "ignore", env: {...process.env, SIYUAN_WORKSPACE_PATH: workspace}});
try {
    const until = Date.now() + 60000;
    for (;;) {
        const p = await api("/api/system/bootProgress").catch(() => undefined);
        if (p?.code === 0 && Number(p?.data?.progress) >= 100) break;
        await new Promise((r) => setTimeout(r, 300));
    }
    token = JSON.parse(fs.readFileSync(path.join(workspace, "conf", "conf.json"), "utf8")).accessAuthCode || "";
    const notebooks = await apiChecked("/api/notebook/lsNotebooks", {});
    const nb = notebooks.notebooks[0].id;
    const docId = await apiChecked("/api/filetree/createDocWithMd", {notebook: nb, path: "/探针", markdown: "# 探针\n\n"});

    for (const [label, md] of [
        ["trailing-ial", `**相关人物**：[李四](siyuan://blocks/20260101111111-aaaaaaa) {: custom-lvct-related="1"}`],
        ["own-line-ial", `**测试二**\n{: custom-lvct-related="1"}`],
    ]) {
        const ins = await api("/api/block/insertBlock", {dataType: "markdown", parentID: docId, data: md});
        console.log(label, "insert code=", ins.code, "opId=", (ins.data?.[0]?.doOperations ?? [])[0]?.id);
    }
    await apiChecked("/api/sqlite/flushTransaction");
    for (let attempt = 0; attempt < 6; attempt += 1) {
        const rows = await apiChecked("/api/query/sql", {stmt: `SELECT id, type, markdown, ial FROM blocks WHERE root_id = '${docId}' ORDER BY sort`});
        console.log(`--- attempt ${attempt}: ${rows.length} blocks`);
        for (const row of rows) console.log(`  [${row.type}] ial=${(row.ial || "").slice(0, 90)} md=${(row.markdown || "").slice(0, 60)}`);
        if (rows.some((row) => (row.ial || "").includes("custom-lvct-related"))) break;
        await new Promise((r) => setTimeout(r, 800));
    }
} finally {
    await api("/api/system/exit", {force: true}).catch(() => undefined);
    await new Promise((r) => setTimeout(r, 1500));
    child.kill("SIGKILL");
}
