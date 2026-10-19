import assert from "node:assert/strict";
import test from "node:test";
import {
    addTopicToStore,
    emptyTopicStore,
    newTopicId,
    normalizeTopicStore,
    normalizeTopicStoreForWrite,
    normalizeTopicText,
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
