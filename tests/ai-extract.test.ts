import { test } from "node:test";
import assert from "node:assert/strict";
import { buildExtractionPrompt, parseExtraction } from "../src/domain/ai-extract.ts";
import { defaultBridgeRef } from "../src/domain/interactions.ts";

test("buildExtractionPrompt：包含笔记内容、名册与 JSON 输出约定", () => {
    const prompt = buildExtractionPrompt("今天和张三开会", ["张三", "李四"]);
    assert.ok(prompt.includes("张三开会"));
    assert.ok(prompt.includes("已知人脉名单：张三、李四"));
    assert.ok(prompt.includes('"people"'));
});

test("parseExtraction：裸 JSON / 围栏 JSON / 混杂文本都能解析", () => {
    const bare = parseExtraction('{"people":["张三","李四"],"date":"2026-09-27","place":"会议室"}');
    assert.deepEqual(bare?.names, ["张三", "李四"]);
    assert.equal(bare?.date, "2026-09-27");
    assert.equal(bare?.place, "会议室");

    const fenced = parseExtraction('结果如下：\n```json\n{"people":["王五"]}\n```\n以上。');
    assert.deepEqual(fenced?.names, ["王五"]);

    assert.equal(parseExtraction("抱歉，我无法处理"), null);
    assert.equal(parseExtraction(""), null);
    assert.equal(parseExtraction('{"people":"不是数组"}')?.names?.length, 0);
});

test("parseExtraction：去重、去空、去纯数字、上限 20", () => {
    const names = Array.from({ length: 30 }, (_, i) => `人${i + 1}`);
    const parsed = parseExtraction(JSON.stringify({ people: ["张三", "张三", "", "123", ...names] }));
    assert.ok(parsed);
    assert.equal(parsed.names.length, 20);
    assert.equal(parsed.names[0], "张三");
    assert.ok(!parsed.names.includes("123"));
});

test("defaultBridgeRef：确定性幂等键（与人员顺序无关）", () => {
    const a = defaultBridgeRef(["d-b", "d-a"], "2026-09-27");
    const b = defaultBridgeRef(["d-a", "d-b"], "2026-09-27");
    assert.equal(a, b);
    assert.ok(a.startsWith("bridge:2026-09-27:"));
});

test("FAST-01.4：结构化候选解析——profile/followUp/relation 分组、字段白名单、非法丢弃并计数", () => {
    const reply = JSON.stringify({
        version: 1,
        people: ["张三", "李四"],
        date: "2026-09-27",
        place: "会议室",
        occasion: "产品评审",
        note: "聊了发布计划",
        profileCandidates: [
            { person: "张三", field: "phone", value: "13800000000" },
            { person: "张三", field: "company", value: "不该出现的字段" },
            { person: "李四", field: "birthday", value: "1990-01-01" },
            { person: "李四", field: "email", value: "" },
        ],
        followUpCandidates: [
            { person: "张三", title: "回传资料", dueDate: "2026-10-08" },
            { person: "李四", title: "没有日期", dueDate: null },
        ],
        relationCandidates: [
            { personA: "张三", personB: "李四", relation: "同事" },
        ],
    });
    const result = parseExtraction(`好的，以下是抽取结果：${reply}`);
    assert.ok(result);
    assert.deepEqual(result.profileCandidates, [
        { person: "张三", field: "phone", value: "13800000000" },
        { person: "李四", field: "birthday", value: "1990-01-01" },
    ]);
    assert.deepEqual(result.followUpCandidates, [{ person: "张三", title: "回传资料", dueDate: "2026-10-08" }]);
    assert.deepEqual(result.relationCandidates, [{ personA: "张三", personB: "李四", relation: "同事" }]);
    assert.equal(result.rejected, 3, "company 非白名单、email 空值、followup 缺日期各计一次");
    assert.equal(result.occasion, "产品评审");
});

test("FAST-01.4：旧格式（无候选字段）兼容解析，生日日期非法被丢弃", () => {
    const result = parseExtraction('{"people":["王五"],"date":"2026-09-27","place":"餐厅"}');
    assert.ok(result);
    assert.deepEqual(result.names, ["王五"]);
    assert.deepEqual(result.profileCandidates, []);
    assert.deepEqual(result.followUpCandidates, []);
    assert.deepEqual(result.relationCandidates, []);
    assert.equal(result.rejected, 0);
    const bad = parseExtraction('{"people":["王五"],"profileCandidates":[{"person":"王五","field":"birthday","value":"1990-13-40"}]}');
    assert.deepEqual(bad?.profileCandidates, [], "生日日期无法解析时应丢弃候选");
    assert.equal(bad?.rejected, 1);
});
