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
