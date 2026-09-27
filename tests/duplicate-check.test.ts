import assert from "node:assert/strict";
import test from "node:test";
import {
    findDuplicatePairs,
    normalizeEmailKey,
    normalizePhoneKey,
} from "../src/domain/duplicate-check.ts";
import type { ContactSummary } from "../src/domain/person.ts";

function person(partial: Partial<ContactSummary> & { docId: string; name: string }): ContactSummary {
    return {
        docId: partial.docId, itemId: `item-${partial.docId}`, name: partial.name,
        phone: partial.phone ?? "", email: partial.email ?? "", wechat: "",
        website: "", birthday: "", isLunar: false, group: partial.group ?? "",
        tags: partial.tags ?? [], relatedItemIds: [],
    };
}

test("电话规范化：去格式纯数字比较，短号与空号不参与，国家码不猜测补全", () => {
    assert.equal(normalizePhoneKey("138 2611-0427"), "13826110427");
    assert.equal(normalizePhoneKey("+86 138 2611 0427"), "8613826110427");
    // 不猜测补全：13826110427 与 8613826110427 数字串不同 → 不视为同一号码
    assert.equal(normalizePhoneKey("138 2611-0427") === normalizePhoneKey("+86 138 2611 0427"), false);
    assert.equal(normalizePhoneKey("138-2611 0427"), "13826110427");
    assert.equal(normalizePhoneKey("12345"), "");
    assert.equal(normalizePhoneKey(""), "");
});

test("邮箱规范化：忽略大小写与首尾空白", () => {
    assert.equal(normalizeEmailKey(" A@X.com "), "a@x.com");
    assert.equal(normalizeEmailKey("a@x.com"), normalizeEmailKey("A@X.COM"));
});

test("候选发现：电话格式差异命中、同名标注人工确认、多理由合并为一对", () => {
    const pairs = findDuplicatePairs([
        person({ docId: "doc-a", name: "陈立群", phone: "138 2611-0427", email: "A@X.com" }),
        person({ docId: "doc-b", name: "陈立群", phone: "13826110427", email: "a@x.com" }),
        person({ docId: "doc-c", name: "林晓梅", phone: "" }),
    ]);
    assert.equal(pairs.length, 1, "应只发现一组候选");
    assert.deepEqual(pairs[0].reasons.map((reason) => reason.kind), ["phone", "email", "name"]);
    assert(pairs[0].reasons[2].label.includes("同名不等同同人"), "同名理由缺少人工确认提示");
});

test("空字段不匹配：两人都无电话/邮箱不构成候选", () => {
    const pairs = findDuplicatePairs([
        person({ docId: "doc-a", name: "甲" }),
        person({ docId: "doc-b", name: "乙" }),
    ]);
    assert.equal(pairs.length, 0);
});

test("排序：理由多者优先；空名册返回空数组", () => {
    const pairs = findDuplicatePairs([
        person({ docId: "doc-a", name: "同名者" }),
        person({ docId: "doc-b", name: "同名者" }),
        person({ docId: "doc-c", name: "双证", phone: "13900001111", email: "z@x.com" }),
        person({ docId: "doc-d", name: "双证", phone: "139-0000-1111", email: "z@x.com" }),
    ]);
    assert.equal(pairs[0].reasons.length, 3);
    assert.equal(findDuplicatePairs([]).length, 0);
});
