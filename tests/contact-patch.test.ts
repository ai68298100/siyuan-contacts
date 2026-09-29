import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveCandidateFields } from "../src/domain/contact-patch.ts";
import type { CandidateFieldPatch } from "../src/domain/contact-patch.ts";

const FRESH = { phone: "13900001111", wechat: "", email: "old@x.com", website: "", birthday: "1990-01-01" };

test("FUNC-01.14 裁决：无并发改动 → apply；已等于候选值 → skip（幂等）", () => {
    const patches: CandidateFieldPatch[] = [
        { field: "phone", value: "13800001234", baseline: "13900001111" },
        { field: "wechat", value: "bing_wx" },
    ];
    const outcomes = resolveCandidateFields(FRESH, patches);
    assert.deepEqual(outcomes.map((outcome) => [outcome.field, outcome.action]), [
        ["phone", "apply"],
        ["wechat", "apply"],
    ], "微信无快照基准（fresh 为空）时直接应用");
    const idempotent = resolveCandidateFields(FRESH, [{ field: "email", value: "old@x.com", baseline: "old@x.com" }]);
    assert.deepEqual(idempotent.map((outcome) => outcome.action), ["skip"]);
});

test("FUNC-01.14 裁决：快照后字段被并发改动 → conflict 不覆盖；同字段已被人改成候选值 → skip", () => {
    const concurrent = resolveCandidateFields(
        { ...FRESH, phone: "13777772222" },
        [{ field: "phone", value: "13800001234", baseline: "13900001111" }],
    );
    assert.deepEqual(concurrent.map((outcome) => [outcome.field, outcome.action]), [["phone", "conflict"]]);
    const alreadyNew = resolveCandidateFields(
        { ...FRESH, phone: "13800001234" },
        [{ field: "phone", value: "13800001234", baseline: "13900001111" }],
    );
    assert.deepEqual(alreadyNew.map((outcome) => outcome.action), ["skip"], "终态一致视为已应用");
});

test("FUNC-01.14 裁决：电话+邮箱同勾各自裁决互不影响；空候选兜底跳过；未知字段忽略", () => {
    const outcomes = resolveCandidateFields(FRESH, [
        { field: "phone", value: "13800001234", baseline: "13900001111" },
        { field: "email", value: "new@x.com", baseline: "old@x.com" },
        { field: "birthday", value: "   " },
        { field: "group" as never, value: "同事" } as never,
    ]);
    assert.deepEqual(outcomes.map((outcome) => [outcome.field, outcome.action]), [
        ["phone", "apply"],
        ["email", "apply"],
    ], "空候选与未知字段不产生写入");
});
