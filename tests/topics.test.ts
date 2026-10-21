import assert from "node:assert/strict";
import test from "node:test";
import {
    addTopicToStore,
    emptyTopicStore,
    mergeTopicStore,
    newTopicId,
    normalizeTopicStore,
    normalizeTopicStoreForWrite,
    normalizeTopicText,
    parseTopicStore,
    removeTopicFromStore,
    MAX_TOPICS_PER_PERSON,
    MAX_TOPIC_TEXT_LENGTH,
} from "../src/domain/topics.ts";
import { buildBriefingMarkdown } from "../src/domain/briefing-export.ts";
import { StoreIntegrityError } from "../src/domain/store-integrity.ts";
import type { ContactSummary } from "../src/domain/person.ts";

const personDocId = "20261019000000-doc0001";

test("E-32 topics 纯函数：新增、置顶、移除与文本规范化", () => {
    let store = emptyTopicStore();
    assert.deepEqual(store.topics, {});

    // 规范化多行文本
    assert.equal(normalizeTopicText("  第一行\r\n第二行  "), "第一行 第二行");

    // 新增一条
    store = addTopicToStore(store, personDocId, "下次聊聊思源插件开发");
    assert.equal(store.topics[personDocId].length, 1);
    assert.equal(store.topics[personDocId][0].text, "下次聊聊思源插件开发");
    const firstId = store.topics[personDocId][0].id;

    // 新增第二条，必须置顶在最前
    store = addTopicToStore(store, personDocId, "带一本关于设计的书");
    assert.equal(store.topics[personDocId].length, 2);
    assert.equal(store.topics[personDocId][0].text, "带一本关于设计的书");
    assert.equal(store.topics[personDocId][1].text, "下次聊聊思源插件开发");

    // 移除第一条
    store = removeTopicFromStore(store, personDocId, firstId);
    assert.equal(store.topics[personDocId].length, 1);
    assert.equal(store.topics[personDocId][0].text, "带一本关于设计的书");

    // 移除剩余的一条，该人物的 key 安全清理
    store = removeTopicFromStore(store, personDocId, store.topics[personDocId][0].id);
    assert.equal(store.topics[personDocId], undefined);
});

test("E-32 topics 边界校验：单条超长与单人条数上限保护", () => {
    let store = emptyTopicStore();
    // 空文本拒绝
    assert.throws(() => addTopicToStore(store, personDocId, ""), /1–140/);
    assert.throws(() => addTopicToStore(store, personDocId, "   "), /1–140/);

    // 超长文本（>140 字符）拒绝
    const tooLong = "字".repeat(MAX_TOPIC_TEXT_LENGTH + 1);
    assert.throws(() => addTopicToStore(store, personDocId, tooLong), /1–140/);

    // 达到单人上限拒绝
    for (let i = 0; i < MAX_TOPICS_PER_PERSON; i++) {
        store = addTopicToStore(store, personDocId, `话题 ${i}`);
    }
    assert.equal(store.topics[personDocId].length, MAX_TOPICS_PER_PERSON);
    assert.throws(() => addTopicToStore(store, personDocId, "第 16 条话题"), /最多记录 15 条/);
});

test("E-32 topics 存储严格校验：坏版本与损坏数据抛出 StoreIntegrityError", () => {
    // 坏版本拒绝
    assert.throws(() => normalizeTopicStoreForWrite({ schemaVersion: 99, topics: {} }), StoreIntegrityError);

    // 容器非对象拒绝
    assert.throws(() => normalizeTopicStoreForWrite({ schemaVersion: 1, topics: "invalid" }), StoreIntegrityError);

    // 坏 docId 拒绝并指名
    assert.throws(() => normalizeTopicStoreForWrite({
        schemaVersion: 1,
        topics: { "invalid-doc": [] },
    }), /人物文档 ID 无效/);

    // 条目损坏指名索引
    assert.throws(() => normalizeTopicStoreForWrite({
        schemaVersion: 1,
        topics: { [personDocId]: [{ id: "bad", text: "" }] },
    }), /话题内容格式无效或超长/);

    // 合法空值可首次保存
    assert.deepEqual(normalizeTopicStoreForWrite(null), emptyTopicStore());
    assert.deepEqual(normalizeTopicStoreForWrite(""), emptyTopicStore());
});

test("E-32 会面简报置顶导出：当包含谈资备忘时高亮输出", () => {
    const mockPerson: ContactSummary = {
        docId: personDocId,
        itemId: "item-1",
        name: "测试联系人",
        phone: "13800000000",
        email: "",
        wechat: "",
        website: "",
        birthday: "",
        isLunar: false,
        group: "朋友",
        tags: [],
        relatedItemIds: [],
    };

    // 带有话题时
    const markdown = buildBriefingMarkdown({
        person: mockPerson,
        timeline: [],
        followUps: [],
        relatedNames: [],
        coAttendance: [],
        limit: 10,
        generatedAt: "2026-10-19 10:00",
        topics: ["上次提到的开源项目进展", "询问最近工作近况"],
    });

    assert.ok(markdown.includes("## 会面谈资与备忘（2 条）"), "必须生成置顶谈资备忘小节");
    assert.ok(markdown.includes("- 📌 上次提到的开源项目进展"));
    assert.ok(markdown.includes("- 📌 询问最近工作近况"));

    // 不带话题时
    const cleanMarkdown = buildBriefingMarkdown({
        person: mockPerson,
        timeline: [],
        followUps: [],
        relatedNames: [],
        coAttendance: [],
        limit: 10,
        generatedAt: "2026-10-19 10:00",
        topics: [],
    });
    assert.ok(!cleanMarkdown.includes("## 会面谈资与备忘"), "空话题不生成该节");
});

test("E-32 topics 迁移合并：现状优先、条目去重与上限保护", () => {
    const current = addTopicToStore(emptyTopicStore(), personDocId, "已存话题 A");
    const existingId = current.topics[personDocId][0].id;

    const incoming = {
        schemaVersion: 1 as const,
        topics: {
            [personDocId]: [
                { id: existingId, text: "已存话题 A（修改版）", createdAt: Date.now() },
                { id: "20261019000000-newtop1", text: "新导入话题 B", createdAt: Date.now() },
            ],
            "20261019000000-other01": [
                { id: "20261019000000-othertp", text: "其他人物话题 C", createdAt: Date.now() },
            ],
        },
    };

    const result = mergeTopicStore(current, incoming);
    assert.equal(result.merged, 2, "新话题 B 和 C 应该合并成功");
    assert.equal(result.skipped, 1, "同 ID 的已有话题 A 应该跳过（现状优先）");

    // 现状优先：personDocId 的第一个话题文本仍是未修改的原值
    assert.equal(result.store.topics[personDocId][0].text, "已存话题 A");
    assert.equal(result.store.topics[personDocId].length, 2);
    assert.equal(result.store.topics["20261019000000-other01"].length, 1);
});

test("E-32 topics parseTopicStore 严格解析：合法包解析与坏数据防御", () => {
    const valid = {
        schemaVersion: 1,
        topics: {
            [personDocId]: [
                { id: "20261019000000-top0001", text: "话题 1", createdAt: 1700000000000 },
            ],
        },
    };
    const parsed = parseTopicStore(valid);
    assert.equal(parsed.schemaVersion, 1);
    assert.equal(parsed.topics[personDocId].length, 1);
    assert.equal(parsed.topics[personDocId][0].text, "话题 1");

    // 坏版本抛出 StoreIntegrityError
    assert.throws(() => parseTopicStore({ schemaVersion: 2, topics: {} }), StoreIntegrityError);

    // 坏 docId 抛出 StoreIntegrityError
    assert.throws(() => parseTopicStore({
        schemaVersion: 1,
        topics: { "invalid-id": [] },
    }), StoreIntegrityError);
});
