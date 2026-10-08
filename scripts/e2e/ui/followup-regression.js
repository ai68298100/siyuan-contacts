import { loadFollowUpStore } from "../../../src/data/followups";
import { reconcileFollowUpTaskReport, syncFollowUpTasksToDoc } from "../../../src/services/followup-sync";

function taskId(index) {
    return `20261004000000-${index.toString(36).padStart(7, "0")}`;
}

function taskRows(blocks, cursor) {
    return Object.entries(blocks)
        .filter(([, block]) => block.followUpId)
        .map(([id, block]) => ({ id, ial: `{: custom-lvct-followup="${block.followUpId}"}`, markdown: block.markdown, type: "i", subtype: "t" }))
        .filter((row) => row.id > cursor)
        .sort((left, right) => left.id.localeCompare(right.id));
}

export async function runFollowupRegression({ test, assert, plugin, settings, personDocId, kernel }) {
    await test("AG-P0-008 全量历史任务与删除/改标题/改日期逐项对账", async () => {
        const items = Array.from({ length: 7 }, (_, index) => ({
            id: `fu-history-${index}`,
            personDocId,
            title: `历史任务 ${index}`,
            dueDate: "2026-10-01",
            status: "done",
            createdAt: index + 1,
            updatedAt: index + 1,
            ...(index === 0 ? { docBlockId: taskId(1) } : {}),
        }));
        const blocks = {
            [taskId(1)]: { followUpId: "fu-history-0", markdown: "- [X] 历史任务 0 📅2026-10-01" },
            [taskId(2)]: { followUpId: "fu-history-1", markdown: "- [X] 文档改标题 📅2026-11-05" },
        };
        const files = new Map([
            ["contacts-settings.json", settings],
            ["follow-ups.json", { schemaVersion: 1, items }],
        ]);
        const originalHandler = kernel.handler;
        kernel.handler = async (route, body) => {
            if (route === "/api/sqlite/flushTransaction") return undefined;
            if (route === "/api/query/sql") {
                if (body.stmt.includes("type = 'd'")) return [{ id: personDocId }];
                const cursorMatch = body.stmt.match(/id > '([^']+)'/);
                return taskRows(blocks, cursorMatch?.[1] ?? "").slice(0, 200);
            }
            return null;
        };
        plugin.loadData = async (key) => files.get(key) ?? "";
        plugin.saveData = async (key, value) => { files.set(key, value); };
        const report = await reconcileFollowUpTaskReport(plugin, personDocId);
        assert.equal(report.items.length, 7, `全量事项未逐项输出：${JSON.stringify(report)}`);
        assert.equal(report.items.find((item) => item.followUpId === "fu-history-0").document, "verified");
        assert.equal(report.items.find((item) => item.followUpId === "fu-history-1").changes.includes("title"), true);
        assert.equal(report.items.find((item) => item.followUpId === "fu-history-6").document, "not_created");
        const after = await loadFollowUpStore(plugin);
        assert.equal(after.items.length, 7);
        kernel.handler = originalHandler;
    });

    await test("AG-P0-008 文档失败安全重试与无重复任务", async () => {
        const item = {
            id: "fu-retry",
            personDocId,
            title: "重试任务",
            dueDate: "2026-10-08",
            status: "open",
            createdAt: 1,
            updatedAt: 1,
        };
        const files = new Map([
            ["contacts-settings.json", settings],
            ["follow-ups.json", { schemaVersion: 1, items: [item] }],
        ]);
        const blocks = {};
        let failInsert = true;
        let insertCount = 0;
        const originalHandler = kernel.handler;
        kernel.handler = async (route, body) => {
            if (route === "/api/sqlite/flushTransaction") return undefined;
            if (route === "/api/query/sql") {
                if (body.stmt.includes("type = 'd'")) return [{ id: personDocId }];
                const cursorMatch = body.stmt.match(/id > '([^']+)'/);
                return taskRows(blocks, cursorMatch?.[1] ?? "").slice(0, 200);
            }
            if (route === "/api/block/insertBlock") {
                if (failInsert) throw new Error("注入任务插入失败");
                insertCount += 1;
                const blockId = taskId(100 + insertCount);
                const match = body.data.match(/custom-lvct-followup="([^"]+)"/);
                blocks[blockId] = { followUpId: match[1], markdown: "- [ ] 重试任务 📅2026-10-08" };
                return [{ doOperations: [{ id: taskId(200 + insertCount), action: "insert" }] }];
            }
            return null;
        };
        plugin.loadData = async (key) => files.get(key) ?? "";
        plugin.saveData = async (key, value) => { files.set(key, value); };
        const first = await syncFollowUpTasksToDoc(plugin, personDocId);
        assert.equal(first.items[0].document, "unknown");
        assert.equal((await loadFollowUpStore(plugin)).items[0].docSyncPending, true);
        failInsert = false;
        const retry = await syncFollowUpTasksToDoc(plugin, personDocId);
        assert.equal(retry.failed.length, 0, JSON.stringify(retry));
        assert.equal(insertCount, 1);
        const settled = await syncFollowUpTasksToDoc(plugin, personDocId);
        assert.equal(settled.applied, 0);
        assert.equal(insertCount, 1);
        assert.equal((await loadFollowUpStore(plugin)).items[0].docSyncPending, undefined);
        kernel.handler = originalHandler;
    });
}
