import { test } from "node:test";
import assert from "node:assert/strict";
import {
    buildOccasionMarkdown,
    normalizeOccasionPlace,
    occasionDiaryPath,
    occasionMarkerAttr,
    occasionPlacePath,
} from "../src/domain/occasion-links.ts";

const sourceDocId = "20261002000000-src0001";
const diaryDocId = "20261002000000-day0001";
const placeDocId = "20261002000000-pla0001";
const people = [
    { docId: "20261002000000-per0001", name: "张三" },
    { docId: "20261002000000-per0002", name: "李[四]" },
];

test("事项文档路径按日期/地点确定且地点拒绝路径穿越字符", () => {
    assert.equal(occasionDiaryPath("人脉", "2026-10-02"), "/人脉/日记/2026-10-02");
    assert.equal(occasionPlacePath("人脉", "上海·静安"), "/人脉/地点/上海·静安");
    assert.equal(normalizeOccasionPlace("  餐厅  "), "餐厅");
    assert.throws(() => occasionPlacePath("人脉", "../秘密"), /不能包含/);
    assert.throws(() => occasionDiaryPath("人脉", "2026-02-30"), /有效/);
});

test("事项标记属性绑定来源笔记，重复捕获可更新同一块", () => {
    assert.equal(occasionMarkerAttr(sourceDocId), `custom-lvct-occasion-${sourceDocId}`);
});

test("事项投影同时包含来源、日期、地点与参与人双链", () => {
    const input = {
        sourceDocId,
        sourceLabel: "聚会记录",
        date: "2026-10-02",
        place: "上海·静安",
        diaryDocId,
        placeDocId,
        people,
    };
    const source = buildOccasionMarkdown("source", input);
    assert.match(source, /siyuan:\/\/blocks\/20261002000000-day0001/);
    assert.match(source, /siyuan:\/\/blocks\/20261002000000-pla0001/);
    assert.match(source, /siyuan:\/\/blocks\/20261002000000-per0001/);
    assert.match(source, /siyuan:\/\/blocks\/20261002000000-per0002/);

    const person = buildOccasionMarkdown("person", input, people[0].docId);
    assert.match(person, /共同事项/);
    assert.doesNotMatch(person, /同行人员.*20261002000000-per0001/);
    assert.match(person, /同行人员.*20261002000000-per0002/);
});
