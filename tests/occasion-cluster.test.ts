import assert from "node:assert/strict";
import test from "node:test";
import {
    deriveOccasionInteractionEvents,
    newOccasionId,
    validateOccasion,
    type OccasionEntity,
} from "../src/domain/occasion-cluster.ts";

const doc1 = "20261019000000-doc0001";
const doc2 = "20261019000000-doc0002";
const doc3 = "20261019000000-doc0003";

test("E-30 occasion: validateOccasion 严格校验约束", () => {
    // 1. 基础有效场合
    const valid: OccasionEntity = {
        id: "20261019000000-occ0001",
        title: "2026 年终技术研讨会",
        type: "meeting",
        date: "2026-10-19",
        place: "会议室 A",
        attendees: [
            { personDocId: doc1, name: "张三", role: "host" },
            { personDocId: doc2, name: "李四", role: "guest" },
        ],
        createdAt: 1700000000000,
        updatedAt: 1700000000000,
    };
    assert.deepEqual(validateOccasion(valid), []);

    // 2. 标题为空或超长
    assert.ok(validateOccasion({ ...valid, title: "" }).some((e) => e.includes("标题不能为空")));
    assert.ok(validateOccasion({ ...valid, title: "字".repeat(121) }).some((e) => e.includes("不能超过 120")));

    // 3. 非法日期
    assert.ok(validateOccasion({ ...valid, date: "2026-02-30" }).some((e) => e.includes("有效")));
    assert.ok(validateOccasion({ ...valid, date: "bad-date" }).some((e) => e.includes("有效")));

    // 4. 结束日期倒挂
    assert.ok(validateOccasion({ ...valid, date: "2026-10-19", endDate: "2026-10-18" }).some((e) => e.includes("不能早于发生日期")));

    // 5. 地点含斜杠或换行
    assert.ok(validateOccasion({ ...valid, place: "北京/上海" }).some((e) => e.includes("不能包含换行、控制字符或斜杠")));

    // 6. 参与人为空或重复
    assert.ok(validateOccasion({ ...valid, attendees: [] }).some((e) => e.includes("至少需要选择 1 位")));
    assert.ok(validateOccasion({
        ...valid,
        attendees: [
            { personDocId: doc1, name: "张三" },
            { personDocId: doc1, name: "张三" },
        ],
    }).some((e) => e.includes("存在重复参与人")));

    // 7. 参与人文档 ID 非法
    assert.ok(validateOccasion({
        ...valid,
        attendees: [{ personDocId: "bad-doc", name: "张三" }],
    }).some((e) => e.includes("文档 ID 无效")));
});

test("E-30 occasion: deriveOccasionInteractionEvents 投影为各参与者互动事件", () => {
    const occasion: OccasionEntity = {
        id: "20261019000000-occ0001",
        title: "新季度技术研讨与午餐交流",
        type: "meal",
        date: "2026-10-19",
        place: "西贝餐厅",
        attendees: [
            { personDocId: doc1, name: "张三" },
            { personDocId: doc2, name: "李四" },
            { personDocId: doc3, name: "王五" },
        ],
        note: "讨论了下一阶段的重构计划",
        createdAt: 1700000000000,
        updatedAt: 1700000000000,
    };

    const events = deriveOccasionInteractionEvents(occasion);
    assert.equal(events.length, 3, "每位参与者应生成一条互动事件");

    // 共用外部引用与来源
    for (const event of events) {
        assert.equal(event.externalRef, occasion.id, "必须共享同一个 externalRef 标识");
        assert.equal(event.source, "diary", "统一使用 diary 来源以便多参与者聚类");
        assert.equal(event.localDate, "2026-10-19");
        assert.ok(event.note?.includes("[聚餐] 新季度技术研讨与午餐交流 @ 西贝餐厅"));
        assert.ok(event.note?.includes("讨论了下一阶段的重构计划"));
    }

    // 张三的事件中同行者包含李四、王五，但不包含自己
    const eventDoc1 = events.find((e) => e.personDocId === doc1);
    assert.ok(eventDoc1?.note?.includes("（同行: 李四、王五）"));
    assert.ok(!eventDoc1?.note?.includes("（同行: 张三"));

    // 李四的事件中同行者包含张三、王五
    const eventDoc2 = events.find((e) => e.personDocId === doc2);
    assert.ok(eventDoc2?.note?.includes("（同行: 张三、王五）"));

    // 王五的事件中同行者包含张三、李四
    const eventDoc3 = events.find((e) => e.personDocId === doc3);
    assert.ok(eventDoc3?.note?.includes("（同行: 张三、李四）"));
});

test("E-30 occasion: newOccasionId 格式符合合法 ID", () => {
    const id = newOccasionId();
    assert.match(id, /^\d{14}-[0-9a-z]{7}$/);
});
