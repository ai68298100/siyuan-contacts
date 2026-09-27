import assert from "node:assert/strict";
import test from "node:test";
import { findSavedViewByName, missingTags, normalizeSavedViews, SAVED_VIEWS_LIMIT } from "../src/domain/saved-views.ts";

const validView = {
    id: "view-1",
    name: "球友圈",
    query: {
        search: "", group: "", tags: ["球友"], tagMatch: "any",
        recentFrom: "", recentTo: "", neverContacted: false, sort: "name",
    },
};

test("保存视图：正常条目保留，非法条目丢弃，坏日期容错为不限制", () => {
    const result = normalizeSavedViews([
        validView,
        { id: "", name: "缺 ID", query: validView.query },
        { id: "view-2", query: validView.query },
        { id: "view-3", name: "   ", query: validView.query },
        { id: "view-4", name: "缺 query" },
        { id: "view-5", name: "坏 query", query: { ...validView.query, tagMatch: "some" } },
        { id: "view-6", name: "坏日期", query: { ...validView.query, recentFrom: "2026/08/01" } },
        "垃圾项",
        null,
    ]);
    assert.deepEqual(result.map((view) => view.id), ["view-1", "view-6"]);
    assert.deepEqual(result[0].name, "球友圈");
    assert.equal(result[1].query.recentFrom, "");
});

test("保存视图：name 去首尾空白，按 id 去重，截断到上限", () => {
    const padded = { ...validView, name: "  球友圈  " };
    const duplicateId = { ...validView, name: "另一条" };
    assert.equal(normalizeSavedViews([padded])[0].name, "球友圈");
    assert.deepEqual(normalizeSavedViews([validView, duplicateId]).length, 1);
    const many = Array.from({ length: SAVED_VIEWS_LIMIT + 10 }, (_, index) => ({
        id: `view-${index}`,
        name: `视图 ${index}`,
        query: validView.query,
    }));
    assert.equal(normalizeSavedViews(many).length, SAVED_VIEWS_LIMIT);
    assert.deepEqual(normalizeSavedViews("not-an-array"), []);
});

test("保存视图：按名称精确查找（输入去空白后比对）", () => {
    const views = normalizeSavedViews([validView, { ...validView, id: "view-2", name: " 家长群 " }]);
    assert.equal(findSavedViewByName(views, "球友圈")?.id, "view-1");
    assert.equal(findSavedViewByName(views, " 家长群 ")?.id, "view-2");
    assert.equal(findSavedViewByName(views, "球友"), undefined);
});

test("失效标签：只报视图中已不存在的标签", () => {
    assert.deepEqual(missingTags(validView.query, ["球友", "家长群"]), []);
    assert.deepEqual(missingTags(validView.query, ["家长群"]), ["球友"]);
    assert.deepEqual(missingTags({ ...validView.query, tags: [] }, []), []);
});
