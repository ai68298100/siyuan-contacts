import { test } from "node:test";
import assert from "node:assert/strict";
import { assertSafeBlockId, escapeSqlString, BLOCK_ID_REGEX } from "../src/domain/format.ts";
import type { BacklinkMentionItem } from "../src/api/blocks.ts";
import type { PersonInsights } from "../src/services/insights.ts";

test("BLOCK_ID_REGEX：严格匹配 14 位日期加 7 位字母数字 ID", () => {
    assert.equal(BLOCK_ID_REGEX.test("20261023150000-abcdef1"), true);
    assert.equal(BLOCK_ID_REGEX.test("20240521195059-yayub76"), true);
    assert.equal(BLOCK_ID_REGEX.test(""), false);
    assert.equal(BLOCK_ID_REGEX.test("20261023150000"), false);
    assert.equal(BLOCK_ID_REGEX.test("20261023150000-abcdef1' OR '1'='1"), false);
    assert.equal(BLOCK_ID_REGEX.test("20261023150000-ABCDEF1"), false); // 小写约束
});

test("assertSafeBlockId：非法 ID 触发异常保护", () => {
    assert.doesNotThrow(() => assertSafeBlockId("20261023150000-abcdef1"));
    assert.throws(() => assertSafeBlockId("malicious-id' OR 1=1 --"), /不是合法的思源块 ID/);
    assert.throws(() => assertSafeBlockId(""), /不是合法的思源块 ID/);
});

test("escapeSqlString：正确转义 SQL 单引号防注入", () => {
    assert.equal(escapeSqlString("O'Reilly"), "O''Reilly");
    assert.equal(escapeSqlString("normal_text"), "normal_text");
    assert.equal(escapeSqlString("admin'--"), "admin''--");
});

test("BacklinkMentionItem 与 PersonInsights 类型契约完备", () => {
    const item: BacklinkMentionItem = {
        blockId: "20261023150000-blk0001",
        rootId: "20261023150000-doc0001",
        content: "今天与 ((20261023150000-person1 '张三')) 开会讨论方案",
        docTitle: "2026-10-23 工作日记",
        hpath: "/日记/2026-10-23 工作日记",
        updated: "20261023153000",
        date: "2026-10-23",
    };
    assert.equal(item.blockId, "20261023150000-blk0001");
    assert.equal(item.date, "2026-10-23");
    assert.equal(item.docTitle, "2026-10-23 工作日记");

    const insights: PersonInsights = {
        timeline: [],
        coAttendance: [],
        totalEvents: 0,
        backlinks: [item],
    };
    assert.equal(insights.backlinks.length, 1);
    assert.equal(insights.backlinks[0].rootId, "20261023150000-doc0001");
});
