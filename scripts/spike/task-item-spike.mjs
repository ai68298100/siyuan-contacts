/* 跟进事项 → 思源原生待办 的可行性 spike（隔离内核，端口 6832）。
   要回答的问题（用户建议：跟进计划要成为原生待办、写入对应文档、可双向同步）：
   ① 任务列表项在 SQL 里长什么样（其他任务管理器插件靠什么发现它）；
   ② 勾选状态存在哪一列、官方的 updateTaskListItemMarker 怎么用（单条与批量）；
   ③ 能否把插件自己的跟进 ID 挂到任务块上（setBlockAttrs 自定义属性）并在勾选后存活；
   ④ 日期标记（📅 / @）是否原样保留、是否被内核识别为日期。 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {spawn} from "node:child_process";
import { prepareIsolatedWorkspace, assertTestPortAvailable, observeTestKernel } from "../e2e/kernel-safety.mjs";

const WORKSPACE = path.join(os.tmpdir(), `lvct-task-spike-${process.pid}-${Date.now()}`);
const HOST = "127.0.0.1";
const PORT = 16832;
const BASE = `http://${HOST}:${PORT}`;
const MARKER = "renmai-task-spike.json";

const results = [];
const note = (name, detail, ok = true) => {
    results.push({name, ok, detail});
    console.log(`${ok ? "PASS" : "FAIL"}  ${name} — ${detail}`);
};

function resolveKernel() {
    const candidates = [
        "D:\\biji\\SiYuan\\resources\\kernel\\SiYuan-Kernel.exe",
        "D:\\RJ\\SiYuan\\resources\\kernel\\SiYuan-Kernel.exe",
        path.join(process.env.ProgramFiles || "C:\\Program Files", "SiYuan", "resources", "kernel", "SiYuan-Kernel.exe"),
    ];
    const kernel = candidates.find((c) => fs.existsSync(c));
    if (!kernel) throw new Error("未找到 SiYuan-Kernel.exe");
    return {kernel, appDir: path.resolve(path.dirname(kernel), "..")};
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
    return text ? JSON.parse(text) : {};
}
async function apiChecked(route, body = {}) {
    const payload = await api(route, body);
    if (payload.code !== 0) throw new Error(`${route} code=${payload.code} msg=${payload.msg}`);
    return payload.data;
}

async function waitForBoot(lines, assertRunning) {
    const until = Date.now() + 60000;
    while (Date.now() < until) {
        assertRunning();
        if (lines.some((line) => line.includes("lock workspace"))) throw new Error("工作区被锁定，先结束残留内核");
        const progress = await api("/api/system/bootProgress").catch(() => undefined);
        if (progress?.code === 0 && Number(progress?.data?.progress) >= 100) return apiChecked("/api/system/version");
        await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error(`内核启动超时:\n${lines.slice(-20).join("\n")}`);
}

async function rows(stmt) {
    return apiChecked("/api/query/sql", {stmt});
}

async function main() {
    const {kernel, appDir} = resolveKernel();
    await assertTestPortAvailable(HOST, PORT);
    prepareIsolatedWorkspace(WORKSPACE, MARKER, "renmai task spike");
    const child = spawn(kernel, ["--workspace", WORKSPACE, "serve", "--wd", appDir, "--port", String(PORT)], {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        env: {...process.env, SIYUAN_WORKSPACE_PATH: WORKSPACE},
    });
    const lines = [];
    for (const stream of [child.stdout, child.stderr]) {
        stream.on("data", (chunk) => String(chunk).split(/\r?\n/).forEach((line) => { if (line) lines.push(line); }));
    }
    const assertRunning = observeTestKernel(child);
    assertKernelRunning = assertRunning;
    let exitCode = 0;
    try {
        const version = await waitForBoot(lines, assertRunning);
        token = JSON.parse(fs.readFileSync(path.join(WORKSPACE, "conf", "conf.json"), "utf8")).accessAuthCode || "";
        note("内核启动", `v${version}`);

        const bookName = `任务-Spike-${Date.now().toString(36)}`;
        await apiChecked("/api/notebook/createNotebook", {name: bookName});
        const bookId = (await apiChecked("/api/notebook/lsNotebooks", {})).notebooks.find((n) => n.name === bookName).id;
        const docId = await apiChecked("/api/filetree/createDocWithMd", {notebook: bookId, path: "/孙甲", markdown: "# 孙甲\n\n"});

        // ① 插一条原生待办（带日期标记与“联系”语义），看 SQL 表示
        await apiChecked("/api/block/insertBlock", {
            dataType: "markdown", parentID: docId,
            data: "- [ ] 联系是否开中药 📅2026-09-29",
        });
        await apiChecked("/api/sqlite/flushTransaction", {});
        const docRows = await rows(`SELECT id, parent_id, type, subtype, content, markdown, ial FROM blocks WHERE root_id = '${docId}'`);
        console.log("【① 任务块结构】", JSON.stringify(docRows, null, 1));
        // 关键：subtype='t' 同时命中列表容器（type=l）与列表项（type=i）；官方标记端点只认列表项
        const taskRow = docRows.find((row) => row.type === "i" && row.subtype === "t");
        note("① 原生待办块可建且 SQL 可识别", `type=${taskRow?.type} subtype=${taskRow?.subtype} content=${JSON.stringify(taskRow?.content)} id=${taskRow?.id}`, Boolean(taskRow));

        // ② 其他插件视角：按 subtype='t' 扫全库任务
        const taskSweep = await rows(`SELECT id, type, subtype, content, markdown FROM blocks WHERE type = 'i' AND subtype = 't' AND box = '${bookId}'`);
        note("② 其他插件可按 type='i' + subtype='t' 扫到该待办", JSON.stringify(taskSweep), taskSweep.length === 1);

        // ②b 勾选状态存哪：官方 updateTaskListItemMarker
        const check = await api("/api/block/updateTaskListItemMarker", {id: taskRow.id, marker: "x"});
        await apiChecked("/api/sqlite/flushTransaction", {});
        const afterCheck = (await rows(`SELECT id, content, markdown, ial FROM blocks WHERE id = '${taskRow.id}'`))[0];
        note("②b updateTaskListItemMarker 勾选", `code=${check.code} msg=${check.msg} → ${JSON.stringify(afterCheck)}`, check.code === 0);

        const uncheck = await api("/api/block/updateTaskListItemMarker", {id: taskRow.id, marker: " "});
        await apiChecked("/api/sqlite/flushTransaction", {});
        const afterUncheck = (await rows(`SELECT id, markdown, ial FROM blocks WHERE id = '${taskRow.id}'`))[0];
        note("②c 反向取消勾选", `code=${uncheck.code} → ${JSON.stringify(afterUncheck)}`);

        // ②d 批量端点（同步多条时用）：两条任务一次打勾，逐条验证生效
        const batchDoc = await apiChecked("/api/filetree/createDocWithMd", {notebook: bookId, path: "/批量", markdown: "# 批量\n\n"});
        await apiChecked("/api/block/insertBlock", {dataType: "markdown", parentID: batchDoc, data: "- [ ] 甲事\n- [ ] 乙事\n"});
        await apiChecked("/api/sqlite/flushTransaction", {});
        const batchItems = (await rows(`SELECT id, content, markdown FROM blocks WHERE root_id = '${batchDoc}' AND type = 'i' AND subtype = 't'`));
        const batch = await api("/api/block/batchUpdateTaskListItemMarker", {
            items: batchItems.map((row) => ({id: row.id, marker: "x"})),
        });
        await apiChecked("/api/sqlite/flushTransaction", {});
        const batchAfter = (await rows(`SELECT id, markdown FROM blocks WHERE root_id = '${batchDoc}' AND type = 'i' AND subtype = 't'`));
        note("②d batchUpdateTaskListItemMarker 生效于每条", `code=${batch.code} items=${batchItems.length} → ${JSON.stringify(batchAfter.map((r) => r.markdown))}`,
            batch.code === 0 && batchAfter.every((row) => /- \[[Xx]\]/.test(row.markdown)));

        // ②e 第三种标记（半完成/取消？）内核是否接受
        const half = await api("/api/block/updateTaskListItemMarker", {id: taskRow.id, marker: "-"});
        await apiChecked("/api/sqlite/flushTransaction", {});
        const afterHalf = (await rows(`SELECT markdown FROM blocks WHERE id = '${taskRow.id}'`))[0];
        note("②e marker='-' 行为（未开工/无标记）", `code=${half.code} msg=${half.msg} markdown=${JSON.stringify(afterHalf?.markdown)}`);

        // ③ 把插件的跟进 ID 挂到任务块（自定义属性），验证勾选后存活
        const attrSet = await api("/api/attr/setBlockAttrs", {id: taskRow.id, attrs: {"custom-lvct-followup": "fu-123", "custom-lvct-kind": "followup"}});
        await apiChecked("/api/sqlite/flushTransaction", {});
        const withAttr = (await rows(`SELECT id, ial FROM blocks WHERE id = '${taskRow.id}'`))[0];
        note("③ setBlockAttrs 挂跟进 ID", `code=${attrSet.code} msg=${attrSet.msg} ial=${withAttr?.ial}`);

        await api("/api/block/updateTaskListItemMarker", {id: taskRow.id, marker: "x"});
        await apiChecked("/api/sqlite/flushTransaction", {});
        const afterToggle = (await rows(`SELECT id, ial, markdown FROM blocks WHERE id = '${taskRow.id}'`))[0];
        note("③b 勾选后自定义属性是否存活", `ial=${afterToggle?.ial}`, String(afterToggle?.ial ?? "").includes("custom-lvct-followup"));

        // ③c 按属性反查任务（归并/去重时用）
        const byAttr = await rows(`SELECT id, content FROM blocks WHERE ial LIKE '%custom-lvct-followup="%'`);
        note("③c 按自定义属性反查任务块", JSON.stringify(byAttr));

        // ④ 日期标记形态：📅 与 @ 原样保留？内核另行识别？
        await apiChecked("/api/block/insertBlock", {
            dataType: "markdown", parentID: docId,
            data: "- [ ] 送资料 @2026-10-01\n- [ ] 约饭 📅2026-10-05\n",
        });
        await apiChecked("/api/sqlite/flushTransaction", {});
        const markers = await rows(`SELECT id, content, markdown FROM blocks WHERE root_id = '${docId}' AND subtype = 't'`);
        note("④ 日期标记原样保留", JSON.stringify(markers.map((row) => ({content: row.content, markdown: row.markdown}))));

        // ④b 删除任务块（用户在思源里删掉）后按 ID 反查的结果，供双向同步的删除语义参考
        const second = markers.find((row) => String(row.content).includes("送资料"));
        if (second) {
            await apiChecked("/api/block/deleteBlock", {id: second.id});
            await apiChecked("/api/sqlite/flushTransaction", {});
            const gone = await rows(`SELECT id FROM blocks WHERE id = '${second.id}'`);
            note("④b 任务块被删后按 ID 反查为空", `rows=${gone.length}`, gone.length === 0);
        }

        const atomicId = "fu-atomic";
        const atomic = await apiChecked("/api/block/insertBlock", {
            dataType: "dom", parentID: docId,
            data: `<div data-node-id="20261004000000-atlist1" data-type="NodeList" data-subtype="t" class="list"><div data-node-id="20261004000000-attask1" data-type="NodeListItem" data-subtype="t" data-marker="*" data-task=" " class="li" custom-lvct-followup="${atomicId}"><div class="protyle-action protyle-action--task"><svg><use xlink:href="#iconUncheck"></use></svg></div><div data-node-id="20261004000000-atpara1" data-type="NodeParagraph" class="p"><div contenteditable="true">原子关联 📅2026-10-08</div></div></div></div>`,
        });
        await apiChecked("/api/sqlite/flushTransaction", {});
        const atomicRows = await rows(`SELECT id, type, subtype, markdown, ial FROM blocks WHERE root_id = '${docId}' AND ial LIKE '%custom-lvct-followup="${atomicId}"%'`);
        const atomicTask = atomicRows.find((row) => row.type === "i" && row.subtype === "t");
        note("⑤ 原子插入关联键挂在任务项", JSON.stringify({operations: atomic, rows: atomicRows}), Boolean(atomicTask) && atomicRows.length === 1);
        if (!atomicTask) throw new Error("原子任务项属性未经实证");
        await apiChecked("/api/block/updateBlock", {
            id: atomicTask.id, dataType: "dom",
            data: `<div data-node-id="${atomicTask.id}" data-type="NodeListItem" data-subtype="t" data-marker="*" data-task="x" class="li" custom-lvct-followup="${atomicId}"><div class="protyle-action protyle-action--task"><svg><use xlink:href="#iconCheck"></use></svg></div><div data-node-id="20261004000000-atpara2" data-type="NodeParagraph" class="p"><div contenteditable="true">改标题 📅2026-11-09</div></div></div>`,
        });
        await apiChecked("/api/sqlite/flushTransaction", {});
        const atomicUpdated = await rows(`SELECT id, type, subtype, markdown, ial FROM blocks WHERE id = '${atomicTask.id}'`);
        note("⑤b updateBlock 保留任务项关联键", JSON.stringify(atomicUpdated), atomicUpdated.length === 1 && atomicUpdated[0].ial.includes(`custom-lvct-followup="${atomicId}"`));
        const paged = await rows(`SELECT id, ial, markdown FROM blocks WHERE root_id = '${docId}' AND type = 'i' AND subtype = 't' AND ial LIKE '%custom-lvct-followup="%' ORDER BY id LIMIT 1`);
        const pagedNext = await rows(`SELECT id, ial, markdown FROM blocks WHERE root_id = '${docId}' AND type = 'i' AND subtype = 't' AND ial LIKE '%custom-lvct-followup="%' AND id > '${paged[0].id}' ORDER BY id LIMIT 1`);
        note("⑤c 任务扫描按 ID 分页", JSON.stringify({first: paged, next: pagedNext}), paged.length === 1 && pagedNext.length === 1 && paged[0].id < pagedNext[0].id);

        fs.writeFileSync(path.join(import.meta.dirname, "task-item-results.json"),
            JSON.stringify({kernel: version, ranAt: new Date().toISOString(), workspace: WORKSPACE, port: PORT, results}, null, 2) + "\n");
        if (results.some((result) => !result.ok)) exitCode = 1;
    } catch (error) {
        note("spike 异常", String(error?.message || error), false);
        exitCode = 1;
    } finally {
        child.kill();
        await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    process.exit(exitCode);
}

main();
