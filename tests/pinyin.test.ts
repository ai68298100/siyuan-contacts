import { test } from "node:test";
import assert from "node:assert/strict";
import {
    getPinyinInitials,
    getChineseCharInitial,
    getPersonNameInitial,
    groupPeopleByAlphabet
} from "../src/domain/pinyin.ts";

test("getPinyinInitials: 常见中文姓名与常用词首字母准确提取", () => {
    assert.equal(getPinyinInitials("张三"), "zs");
    assert.equal(getPinyinInitials("李四"), "ls");
    assert.equal(getPinyinInitials("王五"), "ww");
    assert.equal(getPinyinInitials("欧阳修"), "oyx");
    assert.equal(getPinyinInitials("曾国藩"), "zgf");
    assert.equal(getPinyinInitials("北京"), "bj");
    assert.equal(getPinyinInitials("深圳"), "sz");
    assert.equal(getPinyinInitials("上海"), "sh");
    assert.equal(getPinyinInitials("广州"), "gz");
});

test("getPinyinInitials: 中英混合与数字保留", () => {
    assert.equal(getPinyinInitials("Alice张"), "alicez");
    assert.equal(getPinyinInitials("AI顾问"), "aigw");
    assert.equal(getPinyinInitials("第1名"), "d1m");
});

test("getPinyinInitials: 空值与异常边界", () => {
    assert.equal(getPinyinInitials(""), "");
    assert.equal(getPinyinInitials("   "), "");
    assert.equal(getChineseCharInitial(""), "");
});

test("groupPeopleByAlphabet: 按拼音首字母聚合联系人与激活字母集", () => {
    const list = [
        { name: "白晓华" }, // B
        { name: "陈欣艳" }, // C
        { name: "陈芸" },   // C
        { name: "杜秀芝" }, // D
        { name: "段小光" }, // D
        { name: "蒋国胜" }, // J
        { name: "95555客服" } // #
    ];

    assert.equal(getPersonNameInitial("白晓华"), "B");
    assert.equal(getPersonNameInitial("陈芸"), "C");
    assert.equal(getPersonNameInitial("95555"), "#");

    const result = groupPeopleByAlphabet(list);
    assert.ok(result.activeLetters.has("B"));
    assert.ok(result.activeLetters.has("C"));
    assert.ok(result.activeLetters.has("D"));
    assert.ok(result.activeLetters.has("J"));
    assert.ok(result.activeLetters.has("#"));
    assert.ok(!result.activeLetters.has("A"));

    const cGroup = result.groups.find(g => g.letter === "C");
    assert.equal(cGroup?.count, 2);
    assert.equal(cGroup?.items[0].name, "陈欣艳");
});
