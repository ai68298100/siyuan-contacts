import assert from "node:assert/strict";

/**
 * Incremental AG-HOST-003 evidence in the services runner's UUID workspace.
 * The caller owns kernel lifecycle, the isolated plugin adapter and cleanup.
 * This checks real product services against a real kernel; it does not claim
 * daily-workspace, native editor UI, task-manager-plugin or mobile acceptance.
 */
export async function prepareFollowUpsFlow({ plugin, settings, first, request }) {
    assert.ok(plugin && settings && first?.docId && typeof request === "function", "跟进隔离验收参数不完整");
    const followups = await import("../../src/services/followups.ts");
    const sync = await import("../../src/services/followup-sync.ts");
    const { loadDashboard } = await import("../../src/services/dashboard.ts");
    const { readFollowUpTaskBlocks, writeFollowUpTask } = await import("../../src/api/followup-tasks.ts");
    const { taskMatchesItem } = await import("../../src/domain/followup-doc.ts");

    const today = new Date();
    today.setHours(12, 0, 0, 0);
    const dateAt = (offset) => {
        const date = new Date(today);
        date.setDate(date.getDate() + offset);
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    };
    const evidence = {
        isolated: true,
        actualProductServices: true,
        actualKernel: true,
        nativeEditorUi: false,
        dashboardServiceOnly: true,
        personDocId: first.docId,
        taskCount: 9,
        stages: [],
        faultInjection: null,
        restartVerified: false,
        limitations: ["真实用户工作区、原生编辑器交互及其他任务管理器互读不由本验收覆盖"],
    };
    const ids = [];
    const owned = new Set(ids);
    async function kernel(route, body = {}) {
        const response = await request(route, body);
        assert.equal(response?.code, 0, `${route}: ${response?.msg ?? "内核响应不可用"}`);
        return response.data;
    }
    const indexItems = async () => (await sync.readFollowUpIndex(plugin)).items.filter((item) => owned.has(item.id));
    function assertFullReport(report) {
        assert.equal(report.items.length, ids.length, "全量对账漏掉关闭历史事项");
        assert.deepEqual(new Set(report.items.map((item) => item.followUpId)), owned, "对账 ID 与本轮任务不一致");
    }
    async function snapshot(name, report) {
        assertFullReport(report);
        assert.equal(report.failed.length, 0, `${name}: ${JSON.stringify(report.failed)}`);
        const items = await indexItems();
        assert.equal(items.length, ids.length);
        const tasks = (await readFollowUpTaskBlocks(first.docId)).filter((task) => owned.has(task.followUpId));
        const dashboard = await loadDashboard(plugin, settings);
        assert.ok(!dashboard.readFailures?.length, `首页服务读取失败：${dashboard.readFailures}`);
        const cards = dashboard.followUps.filter((card) => owned.has(card.item.id));
        const expectedCards = items.filter((item) => item.status === "open" && item.dueDate <= dateAt(7));
        assert.deepEqual(new Set(cards.map((card) => card.item.id)), new Set(expectedCards.map((item) => item.id)), "首页与索引的开放任务不一致");
        const results = new Map(report.items.map((item) => [item.followUpId, item]));
        for (const item of items) {
            assert.equal(results.get(item.id)?.index, "verified");
            if (item.docMissing) {
                assert.equal(results.get(item.id)?.document, "missing");
                assert.ok(!tasks.some((task) => task.followUpId === item.id), "已删除任务被自动复活");
            } else {
                assert.equal(results.get(item.id)?.document, "verified");
                assert.ok(taskMatchesItem(item, tasks), `文档与索引不一致：${item.id}`);
            }
            const card = cards.find((entry) => entry.item.id === item.id);
            if (card) {
                assert.equal(card.documentSync, item.docMissing ? "missing" : "verified");
                assert.equal(card.reachable, true);
            }
        }
        const stage = {
            name,
            indexCount: items.length,
            documentTaskCount: tasks.length,
            dashboardCount: cards.length,
            report: report.items,
            index: items,
            document: tasks,
            dashboard: cards.map((card) => ({ id: card.item.id, bucket: card.bucket, documentSync: card.documentSync, reachable: card.reachable })),
        };
        evidence.stages.push(stage);
        return stage;
    }

    for (let index = 0; index < evidence.taskCount; index += 1) {
        const requestId = followups.newFollowUpRequestId();
        const created = await followups.createFollowUp(plugin, {
            requestId,
            personDocId: first.docId,
            title: `虚构全量任务 ${index + 1}`,
            dueDate: dateAt(index - 5),
        });
        assert.equal(created.id, requestId);
        ids.push(created.id);
        owned.add(created.id);
    }
    assert.equal(new Set((await indexItems()).map((item) => item.dueDate)).size, evidence.taskCount, "任务未跨日期创建");
    await snapshot("created-nine-cross-date-tasks", await sync.reconcileFollowUpTaskReport(plugin, first.docId));

    const created = await indexItems();
    for (const id of ids.slice(0, 6)) {
        const item = created.find((entry) => entry.id === id);
        assert.ok(item?.docBlockId, "已创建任务没有真实块 ID");
        await kernel("/api/block/updateTaskListItemMarker", { id: item.docBlockId, marker: "x" });
    }
    const completed = await snapshot("native-completion-six-closed-history", await sync.reconcileFollowUpTaskReport(plugin, first.docId));
    assert.equal(completed.index.filter((item) => item.status === "done").length, 6);
    const visible = await followups.listPersonFollowUps(plugin, first.docId);
    assert.equal(visible.filter((item) => owned.has(item.id) && item.status === "done").length, 5, "人物展示列表应只保留最近五条关闭事项");
    const omittedHistory = completed.index.find((item) => item.status === "done" && !visible.some((entry) => entry.id === item.id));
    assert.ok(omittedHistory, "没有找到最近五条以外的历史事项");
    evidence.historyOutsideFive = omittedHistory.id;
    await kernel("/api/block/updateTaskListItemMarker", { id: omittedHistory.docBlockId, marker: " " });
    const reopened = await snapshot("native-reopen-history-outside-visible-five", await sync.reconcileFollowUpTaskReport(plugin, first.docId));
    assert.equal(reopened.index.find((item) => item.id === omittedHistory.id)?.status, "open");
    await kernel("/api/block/updateTaskListItemMarker", { id: omittedHistory.docBlockId, marker: "x" });
    await snapshot("native-reclose-history", await sync.reconcileFollowUpTaskReport(plugin, first.docId));

    const editable = (await indexItems()).find((item) => item.id === ids[6]);
    await writeFollowUpTask(first.docId, { ...editable, title: "虚构文档改标题", dueDate: dateAt(2) }, editable.docBlockId, false);
    const deleted = (await indexItems()).find((item) => item.id === ids[7]);
    await kernel("/api/block/deleteBlock", { id: deleted.docBlockId });
    const edited = await snapshot("native-title-date-edit-and-deletion", await sync.reconcileFollowUpTaskReport(plugin, first.docId));
    assert.equal(edited.index.find((item) => item.id === editable.id)?.title, "虚构文档改标题");
    assert.equal(edited.index.find((item) => item.id === editable.id)?.dueDate, dateAt(2));
    assert.equal(edited.index.find((item) => item.id === deleted.id)?.docMissing, true);

    await followups.setFollowUpStatus(plugin, ids[8], "cancelled");
    const cancelled = await snapshot("product-cancellation-and-no-deletion-resurrection", await sync.reconcileFollowUpTaskReport(plugin, first.docId));
    assert.equal(cancelled.index.find((item) => item.id === ids[8])?.status, "cancelled");
    assert.equal(cancelled.documentTaskCount, 7);

    // Scope this one rejected response to the controlled person's task SELECT.
    // A thrown transport failure would be retried by the product's read policy;
    // a nonzero response deterministically exercises its unknown-state path.
    const originalTransport = globalThis.__lvctServiceKernelRequest;
    assert.equal(typeof originalTransport, "function", "缺少隔离服务传输边界，不能注入读取失败");
    const beforeFault = JSON.stringify(await sync.readFollowUpIndex(plugin));
    let injected = 0;
    let delegated = 0;
    globalThis.__lvctServiceKernelRequest = async (route, body) => {
        if (injected === 0 && route === "/api/query/sql" && typeof body?.stmt === "string"
            && body.stmt.includes(`root_id = '${first.docId}'`)
            && body.stmt.includes("type = 'i' AND subtype = 't'")
            && body.stmt.includes("custom-lvct-followup")) {
            injected += 1;
            return { code: -1, msg: "lvct isolated task-read fault injection", data: null };
        }
        delegated += 1;
        return originalTransport(route, body);
    };
    try {
        const report = await sync.reconcileFollowUpTaskReport(plugin, first.docId);
        assertFullReport(report);
        assert.equal(injected, 1, "没有命中指定任务读取");
        assert.equal(report.failed.length, ids.length, "读取失败未逐项报告");
        assert.ok(report.items.every((item) => item.index === "verified" && item.document === "unknown"));
        assert.equal(JSON.stringify(await sync.readFollowUpIndex(plugin)), beforeFault, "读取失败改动了原索引");
        evidence.faultInjection = {
            kind: "test-transport-nonzero-response",
            route: "/api/query/sql",
            target: "one task-scan SELECT for the controlled person",
            injectedResponses: injected,
            delegatedRequests: delegated,
            indexUnchanged: true,
            report: report.items,
        };
    } finally {
        globalThis.__lvctServiceKernelRequest = originalTransport;
    }
    await snapshot("read-fault-recovered-real-kernel", await sync.reconcileFollowUpTaskReport(plugin, first.docId));
    const finalIndex = JSON.stringify(await indexItems());
    return {
        evidence,
        async verifyAfterRestart() {
            const report = await sync.reconcileFollowUpTaskReport(plugin, first.docId);
            const restarted = await snapshot("kernel-restart-full-reconciliation", report);
            assert.equal(JSON.stringify(restarted.index), finalIndex, "重启后跟进事实发生变化");
            assert.equal(restarted.index.filter((item) => item.status === "done").length, 6);
            assert.equal(restarted.documentTaskCount, 7);
            assert.equal(restarted.dashboardCount, 2);
            assert.equal(restarted.index.find((item) => item.id === deleted.id)?.docMissing, true);
            evidence.restartVerified = true;
            return evidence;
        },
    };
}
