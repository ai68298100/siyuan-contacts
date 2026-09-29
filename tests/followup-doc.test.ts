import assert from "node:assert/strict";
import test from "node:test";
import {
    buildTaskMarkdown,
    parseTaskMarkdown,
    planTaskSync,
    reconcileDecisions,
} from "../src/domain/followup-doc.ts";

test("buildTaskMarkdown/parseTaskMarkdown：序列化与解析往返，含勾选与空标题兜底", () => {
    const open = buildTaskMarkdown("回电", "2026-10-01", false);
    assert.equal(open, "- [ ] 回电 📅2026-10-01");
    const parsed = parseTaskMarkdown(open);
    assert.deepEqual(parsed, { done: false, title: "回电", dueDate: "2026-10-01" });
    const done = buildTaskMarkdown("回电", "2026-10-01", true);
    assert.equal(done, "- [X] 回电 📅2026-10-01");
    assert.equal(parseTaskMarkdown(done).done, true);
    assert.equal(buildTaskMarkdown("  ", "2026-10-01", false), "- [ ] 保持联系 📅2026-10-01");
    assert.equal(parseTaskMarkdown("- [ ] 无日期任务").dueDate, null);
});

test("planTaskSync：新建/更新/打勾/删除四类计划，不触碰用户手工任务", () => {
    const blocks = [
        { blockId: "blk-old", followUpId: "fu-old", markdown: "- [ ] 旧标题 📅2026-09-01" },
        { blockId: "blk-done", followUpId: "fu-done", markdown: "- [ ] 已完成事项 📅2026-09-02" },
        { blockId: "blk-cancel", followUpId: "fu-cancel", markdown: "- [ ] 要取消的事项 📅2026-09-03" },
        { blockId: "blk-manual", followUpId: "manual-1", markdown: "- [ ] 用户手工任务" },
    ];
    const plans = planTaskSync(
        [
            { id: "fu-new", title: "新跟进", dueDate: "2026-10-05", status: "open" },
            { id: "fu-old", title: "新标题", dueDate: "2026-10-06", status: "open" },
            { id: "fu-done", title: "已完成事项", dueDate: "2026-09-02", status: "done" },
            { id: "fu-cancel", title: "要取消的事项", dueDate: "2026-09-03", status: "cancelled" },
            { id: "fu-unrelated", title: "库里有但文档无", dueDate: "2026-10-07", status: "done" },
        ],
        blocks,
    );
    assert.deepEqual(plans.map((plan) => plan.action), ["insert", "update", "done", "delete"]);
    assert.equal(plans[0].markdown, "- [ ] 新跟进 📅2026-10-05");
    assert.equal(plans[1].blockId, "blk-old");
    assert.equal(plans[2].blockId, "blk-done");
    assert.equal(plans[3].blockId, "blk-cancel");
    /* 用户手工任务（manual-1）不出现在任何计划里 */
    assert.ok(!JSON.stringify(plans).includes("blk-manual"));
});

test("planTaskSync：一致的开任务不产生计划（幂等）", () => {
    const blocks = [{ blockId: "blk-1", followUpId: "fu-1", markdown: "- [ ] 回电 📅2026-10-01" }];
    const plans = planTaskSync(
        [{ id: "fu-1", title: "回电", dueDate: "2026-10-01", status: "open" }],
        blocks,
    );
    assert.deepEqual(plans, []);
});

test("planTaskSync：docMissing 的事项不再自动 insert（不复活删掉的块），块重现仍走 update", () => {
    /* 块已删且标记 docMissing → 无计划 */
    assert.deepEqual(planTaskSync(
        [{ id: "fu-1", title: "被删事项", dueDate: "2026-10-01", status: "open", docMissing: true }],
        [],
    ), []);
    /* 用户撤销删除、块重新出现 → 恢复 update 跟踪 */
    const plans = planTaskSync(
        [{ id: "fu-1", title: "被删事项", dueDate: "2026-10-01", status: "open", docMissing: true }],
        [{ blockId: "blk-back", followUpId: "fu-1", markdown: "- [ ] 被删事项 📅2026-10-01" }],
    );
    assert.deepEqual(plans, []);
    const drifted = planTaskSync(
        [{ id: "fu-1", title: "被删事项", dueDate: "2026-10-02", status: "open", docMissing: true }],
        [{ blockId: "blk-back", followUpId: "fu-1", markdown: "- [ ] 被删事项 📅2026-10-01" }],
    );
    assert.deepEqual(drifted.map((plan) => plan.action), ["update"]);
});

test("reconcileDecisions：文档勾选→done、取消勾选→open、cancelled 不复活", () => {
    const blocks = [
        { blockId: "blk-1", followUpId: "fu-1", markdown: "- [X] 已勾选 📅2026-10-01" },
        { blockId: "blk-2", followUpId: "fu-2", markdown: "- [ ] 未勾选 📅2026-10-02" },
        { blockId: "blk-3", followUpId: "fu-3", markdown: "- [ ] 已取消但文档未勾 📅2026-10-03" },
    ];
    const decisions = reconcileDecisions(
        [
            { id: "fu-1", status: "open", title: "已勾选", dueDate: "2026-10-01" },
            { id: "fu-2", status: "done", title: "未勾选", dueDate: "2026-10-02" },
            { id: "fu-3", status: "cancelled", title: "已取消但文档未勾", dueDate: "2026-10-03" },
        ],
        blocks,
    );
    assert.deepEqual(decisions.toDone, ["fu-1"]);
    assert.deepEqual(decisions.toOpen, ["fu-2"]);
    /* 首见块要记录 docBlockId（blockId-only 更新）；勾选/标题/日期一致所以无其他字段 */
    assert.deepEqual(decisions.updates, [
        { id: "fu-1", blockId: "blk-1" },
        { id: "fu-2", blockId: "blk-2" },
    ]);
    assert.deepEqual(decisions.missing, []);
});

test("reconcileDecisions：文档改标题/改期回写索引，无差异不写；空标题/无日期不回写", () => {
    const blocks = [
        { blockId: "blk-1", followUpId: "fu-1", markdown: "- [ ] 文档新标题 📅2026-11-05" },
        { blockId: "blk-2", followUpId: "fu-2", markdown: "- [ ] 空标题事项 📅2026-10-02" },
        { blockId: "blk-3", followUpId: "fu-3", markdown: "- [ ] 无日期任务" },
        { blockId: "blk-4", followUpId: "fu-4", markdown: "- [ ] 一致事项 📅2026-10-04" },
    ];
    const decisions = reconcileDecisions(
        [
            { id: "fu-1", status: "open", title: "索引旧标题", dueDate: "2026-10-01" },
            { id: "fu-2", status: "open", title: "", dueDate: "2026-10-02" },
            { id: "fu-3", status: "open", title: "无日期任务", dueDate: "2026-10-03" },
            { id: "fu-4", status: "open", title: "一致事项", dueDate: "2026-10-04", docBlockId: "blk-4" },
        ],
        blocks,
    );
    assert.deepEqual(decisions.updates, [
        { id: "fu-1", blockId: "blk-1", title: "文档新标题", dueDate: "2026-11-05" },
        { id: "fu-2", blockId: "blk-2", title: "空标题事项" },
        { id: "fu-3", blockId: "blk-3" },
    ], "文档空标题/无日期不回写对应字段（fu-2 是索引空、文档有标题 → 文档为准回写）；块 ID 记录仍要发生");
    assert.deepEqual(decisions.missing, []);
    /* 全一致且已记录块 → 零更新（幂等） */
    const settled = reconcileDecisions(
        [{ id: "fu-4", status: "open", title: "一致事项", dueDate: "2026-10-04", docBlockId: "blk-4" }],
        [blocks[3]],
    );
    assert.deepEqual(settled.updates, []);
});

test("reconcileDecisions：曾记录块的事项块消失判 missing；从未记录不判缺失", () => {
    const noBlocks: { blockId: string; followUpId: string; markdown: string }[] = [];
    const decisions = reconcileDecisions(
        [
            { id: "fu-seen", status: "open", title: "曾同步", dueDate: "2026-10-01", docBlockId: "blk-gone" },
            { id: "fu-never", status: "open", title: "从未同步", dueDate: "2026-10-02" },
            { id: "fu-already-missing", status: "open", title: "已标缺失", dueDate: "2026-10-03", docMissing: true },
            { id: "fu-cancelled", status: "cancelled", title: "已取消", dueDate: "2026-10-04", docBlockId: "blk-gone-2" },
        ],
        noBlocks,
    );
    assert.deepEqual(decisions.missing, ["fu-seen"], "已标缺失的不再重复报，取消的不参与");
    assert.deepEqual(decisions.updates, []);
});
