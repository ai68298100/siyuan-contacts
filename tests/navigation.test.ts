import assert from "node:assert/strict";
import test from "node:test";
import { acceptDataChange, mergeDataChanges, normalizeDataChange, personReturnContext, resolveNavigationPerson } from "../src/domain/navigation.ts";
import { emptyDraft } from "../src/domain/person.ts";
import { requestPersonNavigation, subscribePersonNavigation } from "../src/libs/data-events.ts";
import { createLifecycleToken } from "../src/domain/lifecycle.ts";

const person = { ...emptyDraft(), name: "同名", docId: "20261004000000-person1", itemId: "20261004000000-item001", relatedItemIds: [] };

test("导航只按稳定文档身份解析，重复或失效人物不按同名回退", () => {
    const peer = { ...person, docId: "20261004000000-person2", itemId: "20261004000000-item002" };
    assert.equal(resolveNavigationPerson([person, peer], peer.docId), peer);
    assert.throws(() => resolveNavigationPerson([person], peer.docId), /唯一核实/);
    assert.throws(() => resolveNavigationPerson([person, person], person.docId), /唯一核实/);
    assert.throws(() => resolveNavigationPerson([{ ...person, itemId: "unknown" }], person.docId), /唯一核实/);
    assert.throws(() => personReturnContext("orgs", { orgDocId: "invalid" }), /非法/);
    assert.deepEqual(personReturnContext("orgs", { orgDocId: "20261004000000-org0001" }), { kind: "organization", view: "orgs", orgDocId: "20261004000000-org0001" });
});

test("数据事件按来源修订去重，新窗口低修订仍可刷新", () => {
    const seen = new Map<string, number>();
    assert.equal(acceptDataChange(seen, { sourceId: "first", revision: 20 }), true);
    assert.equal(acceptDataChange(seen, { sourceId: "first", revision: 20 }), false);
    assert.equal(acceptDataChange(seen, { sourceId: "first", revision: 19 }), false);
    assert.equal(acceptDataChange(seen, { sourceId: "second", revision: 1 }), true);
    assert.equal(normalizeDataChange({ version: 2, revision: 21 }), null);
    assert.equal(normalizeDataChange({ revision: 0 }), null);
    assert.equal(normalizeDataChange({ revision: 21, docIds: ["unknown"] }), null);
    assert.equal(normalizeDataChange({ revision: 21, topics: ["unknown"] }), null);
});

test("连续事件合并保持最高偏好修订、失败证据和全部失效范围", () => {
    const change = mergeDataChanges({ sourceId: "first", revision: 3, preferencesRevision: 8, preferencesError: "未核实", topics: ["organizations"], docIds: [person.docId] },
        { sourceId: "second", revision: 1, preferencesRevision: 2, topics: ["memberships"], docIds: [person.docId, "20261004000000-person2"] });
    assert.equal(change.preferencesRevision, 8);
    assert.equal(change.preferencesError, "未核实");
    assert.deepEqual(change.topics, ["organizations", "memberships"]);
    assert.deepEqual(change.docIds, [person.docId, "20261004000000-person2"]);
    assert.deepEqual(mergeDataChanges(change, { revision: 5 }).topics, ["organizations", "memberships", "all"]);
});

test("文档导航请求支持冷挂载，只由同插件消费一次，销毁后不投递旧请求", () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
    Object.defineProperty(globalThis, "window", { configurable: true, value: new EventTarget() });
    const token = createLifecycleToken();
    const owner = {};
    const unrelated = {};
    let received = 0;
    let otherReceived = 0;
    const cleanups: Array<() => void> = [];
    try {
        requestPersonNavigation(owner, { docId: person.docId, source: "document" }, token);
        cleanups.push(subscribePersonNavigation(unrelated, () => { otherReceived += 1; }));
        cleanups.push(subscribePersonNavigation(owner, (request) => {
            assert.equal(request.docId, person.docId);
            received += 1;
        }, token));
        cleanups.push(subscribePersonNavigation(owner, () => { received += 1; }, token));
        assert.equal(received, 1);
        assert.equal(otherReceived, 0);
        token.invalidate();
        requestPersonNavigation(owner, { docId: person.docId, source: "document" }, token);
        cleanups.push(subscribePersonNavigation(owner, () => { received += 1; }));
        assert.equal(received, 1);
    } finally {
        for (const cleanup of cleanups) cleanup();
        token.invalidate();
        if (descriptor) Object.defineProperty(globalThis, "window", descriptor);
        else Reflect.deleteProperty(globalThis, "window");
    }
});
