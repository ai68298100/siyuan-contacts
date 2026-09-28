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

test("reconcileDecisions：文档勾选→done、取消勾选→open、cancelled 不复活", () => {
    const blocks = [
        { blockId: "blk-1", followUpId: "fu-1", markdown: "- [X] 已勾选 📅2026-10-01" },
        { blockId: "blk-2", followUpId: "fu-2", markdown: "- [ ] 未勾选 📅2026-10-02" },
        { blockId: "blk-3", followUpId: "fu-3", markdown: "- [ ] 已取消但文档未勾 📅2026-10-03" },
    ];
    const decisions = reconcileDecisions(
        [
            { id: "fu-1", status: "open" },
            { id: "fu-2", status: "done" },
            { id: "fu-3", status: "cancelled" },
        ],
        blocks,
    );
    assert.deepEqual(decisions.toDone, ["fu-1"]);
    assert.deepEqual(decisions.toOpen, ["fu-2"]);
});
