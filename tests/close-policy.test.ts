import assert from "node:assert/strict";
import test from "node:test";
import { decideClose } from "../src/domain/close-policy.ts";

test("关闭策略：忙碌时无论是否有草稿都阻断", () => {
    assert.equal(decideClose({ busy: true, dirty: false }), "blocked");
    assert.equal(decideClose({ busy: true, dirty: true }), "blocked");
});

test("关闭策略：空闲但有草稿时进入统一确认", () => {
    assert.equal(decideClose({ busy: false, dirty: true }), "prompt");
});

test("关闭策略：空闲且无草稿时直接放行", () => {
    assert.equal(decideClose({ busy: false, dirty: false }), "allow");
});
