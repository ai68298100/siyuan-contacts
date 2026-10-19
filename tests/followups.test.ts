import assert from "node:assert/strict";
import test from "node:test";
import {
    addDaysToDate,
    appendFollowUp,
    daysBetween,
    dueLabel,
    emptyFollowUpStore,
    followUpsForPerson,
    groupFollowUps,
    hasFollowUpDraft,
    isValidDateKey,
    nextMondayFrom,
    normalizeFollowUpStore,
    normalizeFollowUpStoreForWrite,
    isFollowUpRequestId,
    matchesFollowUpCreateRequest,
    projectOpenFollowUps,
    sameDayNextMonth,
    snoozedDueDate,
    updateFollowUp,
} from "../src/domain/followups.ts";
import type { FollowUpItem } from "../src/domain/followups.ts";

function item(partial: Partial<FollowUpItem> & { id: string }): FollowUpItem {
    return {
        personDocId: "doc-1", title: "", dueDate: "2026-09-28", status: "open",
        createdAt: 1, updatedAt: 1, ...partial,
    };
}

test("日期工具：加天、下周一、次月收敛与闰日校验", () => {
    assert.equal(addDaysToDate("2026-09-28", 3), "2026-10-01");
    assert.equal(addDaysToDate("2026-12-31", 1), "2027-01-01");
    // 2026-09-28 是周一 → 下周一 +7；周日的下周一 +1
    assert.equal(nextMondayFrom("2026-09-28"), "2026-10-05");
    assert.equal(nextMondayFrom("2026-09-27"), "2026-09-28");
    assert.equal(sameDayNextMonth("2026-01-31"), "2026-02-28");
    assert.equal(sameDayNextMonth("2026-09-28"), "2026-10-28");
    assert.equal(isValidDateKey("2026-02-29"), false);
    assert.equal(isValidDateKey("2028-02-29"), true);
    assert.equal(isValidDateKey(""), false);
    assert.equal(isValidDateKey("2026-02-30"), false);
    assert.equal(isValidDateKey("2028-02-29"), true);
    assert.equal(daysBetween("2026-09-28", "2026-09-30"), 2);
});

test("跟进创建幂等：同一 requestId 只接受同一不可变输入，重试不生成第二条", () => {
    const requestId = "20261014000000-req0001";
    const current = item({ id: requestId, personDocId: "20261002000000-per0001", title: "回电", dueDate: "2026-10-20" });
    assert.equal(isFollowUpRequestId(requestId), true);
    assert.equal(isFollowUpRequestId("new-key"), false);
    assert.equal(matchesFollowUpCreateRequest(current, {
        requestId, personDocId: current.personDocId, title: "回电", dueDate: current.dueDate,
    }), true);
    assert.equal(matchesFollowUpCreateRequest(current, {
        requestId, personDocId: current.personDocId, title: "其他", dueDate: current.dueDate,
    }), false);
});

test("推迟语义：明天/三天/下周一/次月/指定日期；非法指定日期返回空串", () => {
    const today = "2026-09-28";
    assert.equal(snoozedDueDate("tomorrow", today), "2026-09-29");
    assert.equal(snoozedDueDate("threeDays", today), "2026-10-01");
    assert.equal(snoozedDueDate("nextMonday", today), "2026-10-05");
    assert.equal(snoozedDueDate("nextMonth", today), "2026-10-28");
    assert.equal(snoozedDueDate("nextMonth", "2026-01-31"), "2026-02-28");
    assert.equal(snoozedDueDate("custom", today, "2026-10-15"), "2026-10-15");
    assert.equal(snoozedDueDate("custom", today, "2026-10-32"), "");
    assert.equal(snoozedDueDate("custom", today), "");
});

test("详情草稿判断：仅比较未提交字段，不把成功创建后的保留日期误报为草稿", () => {
    const baseline = { title: "", dueDate: "2026-09-28", savedTitle: "", savedDueDate: "2026-09-28", snoozeCustomDate: "" };
    assert.equal(hasFollowUpDraft(baseline), false);
    assert.equal(hasFollowUpDraft({ ...baseline, title: "   " }), false);
    assert.equal(hasFollowUpDraft({ ...baseline, title: "下周联系" }), true);
    assert.equal(hasFollowUpDraft({ ...baseline, dueDate: "2026-10-01" }), true);
    // 创建成功后标题会清空，但表单保留日期供连续添加；更新基线后不应再次拦截。
    assert.equal(hasFollowUpDraft({ ...baseline, dueDate: "2026-10-01", savedDueDate: "2026-10-01" }), false);
    assert.equal(hasFollowUpDraft({ ...baseline, snoozeCustomDate: "2026-10-15" }), true);
});

test("归一化：坏条目容错过滤、按 id 去重；写前严格模式抛错；空串可首次保存", () => {
    const store = normalizeFollowUpStore({
        schemaVersion: 1,
        items: [
            item({ id: "a" }),
            item({ id: "a", dueDate: "2026-10-01" }),
            item({ id: "b", dueDate: "bogus" }),
            item({ id: "bad-date", dueDate: "2026-02-30" }),
            item({ id: "c", status: "weird" }),
            null,
        ],
    });
    assert.deepEqual(store.items.map((entry) => entry.id), ["a"]);
    assert.throws(() => normalizeFollowUpStoreForWrite({ schemaVersion: 99, items: [] }));
    assert.throws(() => normalizeFollowUpStoreForWrite({ schemaVersion: 1, items: [{ id: "x" }] }));
    assert.throws(() => normalizeFollowUpStoreForWrite({ schemaVersion: 1, items: [item({ id: "a" }), item({ id: "a", title: "另一条" })] }), /重复 ID/);
    assert.deepEqual(normalizeFollowUpStoreForWrite(""), emptyFollowUpStore());
    assert.deepEqual(normalizeFollowUpStoreForWrite(null), emptyFollowUpStore());
});

test("状态与投影：完成写 closedAt、重开清除；逾期/今天/未来分桶稳定排序", () => {
    let store = normalizeFollowUpStore({ schemaVersion: 1, items: [item({ id: "a" })] });
    store = updateFollowUp(store, "a", { status: "done", closedAt: 99, updatedAt: 99 });
    assert.equal(store.items[0].status, "done");
    assert.equal(store.items[0].closedAt, 99);
    store = updateFollowUp(store, "a", { status: "open", closedAt: undefined, updatedAt: 100 });
    assert.equal(store.items[0].closedAt, undefined);
    assert.equal(updateFollowUp(store, "missing", { status: "done" }), store);
    assert.equal(appendFollowUp(store, store.items[0]), store);

    const today = "2026-09-28";
    const items = [
        item({ id: "u1", dueDate: "2026-10-05" }),
        item({ id: "o2", dueDate: "2026-09-20" }),
        item({ id: "d1", dueDate: "2026-09-28", status: "done" as const }),
        item({ id: "t1", dueDate: "2026-09-28" }),
        item({ id: "o1", dueDate: "2026-09-21" }),
    ];
    const buckets = projectOpenFollowUps(items, today);
    assert.deepEqual(buckets.overdue.map((entry) => entry.id), ["o2", "o1"]);
    assert.deepEqual(buckets.today.map((entry) => entry.id), ["t1"]);
    assert.deepEqual(buckets.upcoming.map((entry) => entry.id), ["u1"]);
});

test("到期文案与人物过滤：逾期/今天/还有 N 天；closed 置后", () => {
    const today = "2026-09-28";
    assert.equal(dueLabel("2026-09-21", today), "逾期 7 天");
    assert.equal(dueLabel("2026-09-28", today), "今天");
    assert.equal(dueLabel("2026-10-02", today), "还有 4 天");
    const items = [
        item({ id: "closed", status: "cancelled" as const, closedAt: 5, dueDate: "2026-10-01" }),
        item({ id: "open-later", dueDate: "2026-10-10" }),
        item({ id: "other", personDocId: "doc-2", dueDate: "2026-09-29" }),
        item({ id: "open-soon", dueDate: "2026-09-29" }),
    ];
    assert.deepEqual(followUpsForPerson(items, "doc-1").map((entry) => entry.id), ["open-soon", "open-later", "closed"]);
});

test("E-28 groupFollowUps 跨组织/部门/来源文档去重分组投影", () => {
    const items: FollowUpItem[] = [
        // 张三：曙光科技 + 前端组
        item({ id: "i1", personDocId: "d-zhangsan", dueDate: "2026-09-30", status: "open" }),
        item({ id: "i2", personDocId: "d-zhangsan", dueDate: "2026-09-21", status: "open" }),
        // 李四：曙光科技 + 后端组
        item({ id: "i3", personDocId: "d-lisi", dueDate: "2026-09-28", status: "open" }),
        // 王五：独立联系人
        item({ id: "i4", personDocId: "d-wangwu", dueDate: "2026-09-29", status: "open" }),
    ];
    const personNames = new Map<string, string>([
        ["d-zhangsan", "张三"],
        ["d-lisi", "李四"],
        ["d-wangwu", "王五"],
    ]);
    const orgNames = new Map<string, string>([
        ["d-zhangsan", "曙光科技"],
        ["d-lisi", "曙光科技"],
    ]);
    const deptNames = new Map<string, string>([
        ["d-zhangsan", "前端组"],
        ["d-lisi", "后端组"],
    ]);
    const sourceLabels = new Map<string, string>([
        ["i1", "Q3 OKR 评审"],
        ["i3", "Q3 OKR 评审"],
    ]);

    const groups = groupFollowUps(items, personNames, {
        orgNameByDocId: orgNames,
        departmentByDocId: deptNames,
        sourceLabelByFollowUpId: sourceLabels,
    });

    // 期望 7 个分组：3 人物 + 1 组织（曙光科技归一） + 2 部门（前端组/后端组） + 1 来源
    assert.equal(groups.length, 7, `应输出 7 个分组，实际 ${groups.length}`);

    // 人物分组：每人独立，组内按 open 升序与 createdAt 稳定排序
    const personGroups = groups.filter((g) => g.key === "person");
    assert.equal(personGroups.length, 3);
    assert.deepEqual(personGroups.map((g) => g.label), ["人物：张三", "人物：李四", "人物：王五"]);
    const zhangsanGroup = personGroups.find((g) => g.label === "人物：张三")!;
    assert.deepEqual(zhangsanGroup.items.map((i) => i.id), ["i2", "i1"], "组内按 dueDate 升序（i2 9-21 早于 i1 9-30）");

    // 组织分组：曙光科技合并张三与李四，组内按 dueDate 升序
    const orgGroups = groups.filter((g) => g.key === "org");
    assert.equal(orgGroups.length, 1, "独立联系人王五不挂任何组织，曙光科技按名归一为单组");
    const sgb = orgGroups.find((g) => g.label === "组织：曙光科技")!;
    assert.deepEqual(sgb.items.map((i) => i.id), ["i2", "i3", "i1"], "按 dueDate 升序（9-21 < 9-28 < 9-30）");

    // 部门分组：每人独立
    const deptGroups = groups.filter((g) => g.key === "department");
    assert.equal(deptGroups.length, 2);
    assert.deepEqual(deptGroups.map((g) => g.label), ["部门：前端组", "部门：后端组"]);

    // 来源文档分组：Q3 OKR 评审 合并 i1 和 i3，去重后只出现一次
    const sourceGroups = groups.filter((g) => g.key === "source");
    assert.equal(sourceGroups.length, 1);
    const sourceGroup = sourceGroups[0];
    assert.equal(sourceGroup.label, "来源：Q3 OKR 评审");
    assert.deepEqual(sourceGroup.items.map((i) => i.id), ["i3", "i1"], "同一来源合并去重，按 dueDate 升序");
});

test("E-28 groupFollowUps 边界：空数据、仅人物、无组织无来源", () => {
    const personNames = new Map<string, string>([["d-a", "甲"]]);
    assert.deepEqual(groupFollowUps([], personNames), [], "空数据应返回空数组");

    const noOrg = groupFollowUps([item({ id: "i1", personDocId: "d-a" })], personNames);
    assert.equal(noOrg.length, 1);
    assert.equal(noOrg[0].key, "person");
});


test("B07-a 对账字段：updateFollowUp 支持 docBlockId/docMissing；归一化接受合法值、过滤非法值", () => {
    let store = normalizeFollowUpStore({ schemaVersion: 1, items: [item({ id: "a" })] });
    store = updateFollowUp(store, "a", { docBlockId: "blk-1", docMissing: false });
    assert.equal(store.items[0].docBlockId, "blk-1");
    store = updateFollowUp(store, "a", { docMissing: true, docBlockId: undefined });
    assert.equal(store.items[0].docMissing, true);
    assert.equal(store.items[0].docBlockId, undefined);
    /* 非法类型：读归一化过滤（坏条目整条丢弃），写前严格检查拒绝 */
    assert.throws(() => normalizeFollowUpStoreForWrite({
        schemaVersion: 1,
        items: [item({ id: "bad" }), { ...item({ id: "ok" }), docBlockId: 42 }],
    }), /存储内容损坏/);
    const filtered = normalizeFollowUpStore({
        schemaVersion: 1,
        items: [{ ...item({ id: "ok" }), docBlockId: "blk-9", docMissing: true }, { ...item({ id: "bad" }), docMissing: "yes" }],
    });
    assert.deepEqual(filtered.items.map((entry) => entry.id), ["ok"]);
    assert.equal(filtered.items[0].docMissing, true);
});

test("AG-P0-008 文档同步字段：pending 与预期块 ID 可严格归一化", () => {
    const store = normalizeFollowUpStore({
        schemaVersion: 1,
        items: [{ ...item({ id: "pending" }), docSyncPending: true, docSyncBlockId: "20261004000000-abc1234" }],
    });
    assert.equal(store.items[0].docSyncPending, true);
    assert.equal(store.items[0].docSyncBlockId, "20261004000000-abc1234");
    assert.throws(() => normalizeFollowUpStoreForWrite({
        schemaVersion: 1,
        items: [{ ...item({ id: "bad" }), docSyncBlockId: "bad" }],
    }), /损坏/);
});
