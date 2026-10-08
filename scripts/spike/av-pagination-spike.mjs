import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { prepareIsolatedWorkspace, assertTestPortAvailable, observeTestKernel } from "../e2e/kernel-safety.mjs";

const workspace = path.join(os.tmpdir(), `SiYuan-Lvct-AvPage-${randomUUID()}`);
const host = "127.0.0.1";
const kernel = [
    "D:/biji/SiYuan/resources/kernel/SiYuan-Kernel.exe",
    "D:/RJ/SiYuan/resources/kernel/SiYuan-Kernel.exe",
    path.join(process.env.ProgramFiles || "C:/Program Files", "SiYuan/resources/kernel/SiYuan-Kernel.exe"),
].find((candidate) => fs.existsSync(candidate));
if (!kernel) throw new Error("未找到 SiYuan-Kernel.exe");

const port = await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen({ host, port: 0 }, () => {
        const assigned = server.address().port;
        server.close((error) => error ? reject(error) : resolve(assigned));
    });
});
await assertTestPortAvailable(host, port);
prepareIsolatedWorkspace(workspace, "lvct-av-page-spike.json", "lvct av pagination spike");

let child;
let assertRunning;
let token = "";
const base = `http://${host}:${port}`;
const results = [];
const record = (name, ok, detail) => {
    results.push({ name, ok, detail });
    console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

async function api(route, body = {}) {
    assertRunning?.();
    const response = await fetch(`${base}${route}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Token ${token}` } : {}) },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15000),
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

function nodeId() {
    const date = new Date();
    const pad = (value, width) => String(value).padStart(width, "0");
    const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1, 2)}${pad(date.getDate(), 2)}${pad(date.getHours(), 2)}${pad(date.getMinutes(), 2)}${pad(date.getSeconds(), 2)}`;
    const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";
    let suffix = "";
    for (let index = 0; index < 7; index += 1) suffix += alphabet[Math.floor(Math.random() * alphabet.length)];
    return `${stamp}-${suffix}`;
}

async function stop() {
    if (!child) return;
    await api("/api/system/exit", { force: true }).catch(() => undefined);
    await new Promise((resolve) => {
        if (child.exitCode !== null || child.signalCode !== null) return resolve();
        const timer = setTimeout(() => {
            child.kill();
            resolve();
        }, 10000);
        child.once("exit", () => {
            clearTimeout(timer);
            resolve();
        });
    });
    child = undefined;
}

async function main() {
    const appDir = path.resolve(path.dirname(kernel), "..");
    child = spawn(kernel, ["--workspace", workspace, "serve", "--wd", appDir, "--port", String(port)], {
        stdio: "ignore",
        windowsHide: true,
        env: { ...process.env, SIYUAN_WORKSPACE_PATH: workspace },
    });
    assertRunning = observeTestKernel(child);
    const deadline = Date.now() + 60000;
    while (true) {
        assertRunning();
        const progress = await api("/api/system/bootProgress").catch(() => undefined);
        if (progress?.code === 0 && progress.data?.progress >= 100) break;
        if (Date.now() > deadline) throw new Error("独立内核启动超时");
        await new Promise((resolve) => setTimeout(resolve, 250));
    }
    token = JSON.parse(fs.readFileSync(path.join(workspace, "conf", "conf.json"), "utf8")).accessAuthCode || "";

    const notebooks = await request("/api/notebook/lsNotebooks");
    const notebookName = `lvct-av-page-${randomUUID().slice(0, 8)}`;
    await request("/api/notebook/createNotebook", { name: notebookName });
    const refreshed = await request("/api/notebook/lsNotebooks");
    const notebook = refreshed.notebooks.find((entry) => entry.name === notebookName);
    if (!notebook?.id) throw new Error(`隔离笔记本创建后未找到：${JSON.stringify(notebooks)}`);

    const avId = nodeId();
    const hostDocId = await request("/api/filetree/createDocWithMd", {
        notebook: notebook.id,
        path: "/分页宿主",
        markdown: "# 分页宿主\n\n",
    });
    const inserted = await request("/api/block/insertBlock", {
        dataType: "dom",
        parentID: hostDocId,
        data: `<div data-type="NodeAttributeView" data-av-id="${avId}" data-av-type="table"></div>`,
    });
    const dbBlockId = inserted?.[0]?.doOperations?.[0]?.id;
    if (!dbBlockId) throw new Error(`数据库块创建响应缺少 ID：${JSON.stringify(inserted)}`);
    await request("/api/av/renderAttributeView", { id: avId, blockID: dbBlockId, pageSize: -1, createIfNotExist: true });

    const nameKeyId = nodeId();
    await request("/api/av/addAttributeViewKey", {
        avID: avId,
        keyID: nameKeyId,
        keyName: "分页标记",
        keyType: "text",
        keyIcon: "",
        previousKeyID: "",
    });

    const total = Number(process.env.LVCT_PAGE_TOTAL || 2);
    if (!Number.isSafeInteger(total) || total < 1 || total > 1001) throw new Error("LVCT_PAGE_TOTAL 必须在 1-1001 之间");
    const docs = await Promise.all(Array.from({ length: total }, (_, index) => request("/api/filetree/createDocWithMd", {
        notebook: notebook.id,
        path: `/分页联系人/${String(index).padStart(4, "0")}`,
        markdown: `# 分页联系人 ${index}\n\n`,
    })));
    for (let start = 0; start < docs.length; start += 200) {
        await request("/api/av/addAttributeViewBlocks", {
            avID: avId,
            blockID: dbBlockId,
            srcs: docs.slice(start, start + 200).map((id, offset) => ({
                id,
                isDetached: false,
                content: `分页联系人 ${String(start + offset).padStart(4, "0")}`,
            })),
        });
    }
    await request("/api/sqlite/flushTransaction");

    const started = performance.now();
    const full = await request("/api/av/renderAttributeView", { id: avId, blockID: dbBlockId, pageSize: -1 });
    const fullMs = Math.round(performance.now() - started);
    record("全量基线", full.view.rows.length === total, `rows=${full.view.rows.length} ms=${fullMs}`);

    const pages = [];
    const pageNumbers = [...new Set([1, 2, Math.ceil(total / 200)])];
    for (const page of pageNumbers) {
        const pageStarted = performance.now();
        const rendered = await request("/api/av/renderAttributeView", {
            id: avId,
            blockID: dbBlockId,
            query: "",
            page,
            pageSize: 200,
        });
        pages.push({ page, rows: rendered.view.rows.length, ids: rendered.view.rows.map((row) => row.id), rowCount: rendered.view.rowCount });
        record(`分页 page=${page}`, rendered.view.rows.length <= 200, `rows=${rendered.view.rows.length} rowCount=${rendered.view.rowCount ?? "缺失"} ms=${Math.round(performance.now() - pageStarted)}`);
    }
    const ids = pages.flatMap((page) => page.ids);
    const uniqueIds = new Set(ids);
    record("页间不重叠", uniqueIds.size === ids.length && pages[0].ids.length > 0, `rows=${ids.length} unique=${uniqueIds.size}`);
    record("页序符合总数", pages.every(({ rows }) => rows <= 200) && pages[0].rows > 0, JSON.stringify(pages.map(({ page, rows }) => ({ page, rows }))));

    const searched = await request("/api/av/renderAttributeView", {
        id: avId,
        blockID: dbBlockId,
        query: String(Math.min(total - 1, 1)).padStart(4, "0"),
        page: 1,
        pageSize: 200,
    });
    const searchNeedle = String(Math.min(total - 1, 1)).padStart(4, "0");
    const searchMatched = searched.view.rows[0]?.cells.some((cell) =>
        cell.value?.text?.content?.includes(searchNeedle) || cell.value?.block?.content?.includes(searchNeedle));
    record("分页搜索", searched.view.rows.length === 1 && searchMatched, `rows=${searched.view.rows.length} needle=${searchNeedle}`);

    const evidence = {
        isolated: true,
        workspace,
        kernelVersion: await request("/api/system/version"),
        total,
        full: { rows: full.view.rows.length, milliseconds: fullMs },
        pages: pages.map(({ page, rows, rowCount }) => ({ page, rows, rowCount })),
        searchedRows: searched.view.rows.length,
        results,
        at: new Date().toISOString(),
    };
    fs.writeFileSync(path.resolve("scripts/spike/av-pagination-results.json"), `${JSON.stringify(evidence, null, 2)}\n`);
    if (results.some((result) => !result.ok)) process.exitCode = 1;
}

try {
    await main();
} catch (error) {
    console.error(error.stack || error);
    process.exitCode = 1;
} finally {
    await stop();
}
