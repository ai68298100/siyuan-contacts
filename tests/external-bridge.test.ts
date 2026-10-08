import { test } from "node:test";
import assert from "node:assert/strict";
import {
    BRIDGE_PROTOCOL, BRIDGE_STORAGE_KEY, BridgeError, BridgePersonAmbiguityError, bridgeEventEvidence,
    normalizeBridgeEnsure, normalizeBridgeInteraction, normalizeBridgeRequestStore, resolveBridgePerson,
} from "../src/domain/external-bridge.ts";
import { createExternalBridgeApi } from "../src/services/external-bridge.ts";
import type { BridgeDependencies } from "../src/services/external-bridge.ts";
import type { BridgeRequestStore, BridgePerson } from "../src/domain/external-bridge.ts";
import type { ContactsSettings } from "../src/domain/model.ts";

const firstId = "20261004000000-person1";
const secondId = "20261004000000-person2";
const firstRow = "20261004000000-row0001";
const secondRow = "20261004000000-row0002";
const missingId = "20261004000000-missing";
const settings: ContactsSettings = {
    schemaVersion: 1, notebookId: "20261004000000-notebk1", notebookName: "人脉",
    hostDocId: "20261004000000-host001", avId: "20261004000000-av00001", dbBlockId: "20261004000000-block01",
    fieldMap: {} as ContactsSettings["fieldMap"], initializedAt: "2026-10-04",
};

function person(docId = firstId, itemId = firstRow, name = "同名人物"): BridgePerson {
    return { docId, itemId, name, group: "", tags: [] };
}

function fixture() {
    const state = {
        roster: [person(), person(secondId, secondRow)] as BridgePerson[],
        store: { schemaVersion: 1, requests: [] } as BridgeRequestStore,
        events: new Map<string, { date: string; note: string }>(),
        creates: 0, records: 0, saves: 0, active: true, initialized: true,
        failPeople: false, failRead: false, failSave: false, failSaveAfter: 0,
        failEvent: false, failEventFor: "", loseRecord: false, loseRecordBeforeApply: false,
        rejectRecord: false, loseCreate: false, hideCreated: false, rejectCreate: false,
        anchorSettings: settings,
        created: undefined as BridgePerson | undefined,
        missingDocuments: new Set<string>(),
    };
    let queue = Promise.resolve();
    const deps: BridgeDependencies = {
        settings: () => {
            if (!state.initialized) throw new BridgeError("not_initialized", "getPerson");
            return structuredClone(state.anchorSettings);
        },
        guard: (original) => {
            if (!state.active) throw new BridgeError("disposed", "getPerson");
            if (original && original.avId !== state.anchorSettings.avId) throw new BridgeError("configuration_changed", "getPerson");
        },
        lock: async (task) => {
            const pending = queue.then(task);
            queue = pending.then(() => {}, () => {});
            return pending;
        },
        readRequests: async () => {
            if (state.failRead) throw new Error("private read detail");
            return normalizeBridgeRequestStore(state.store);
        },
        saveRequests: async (store) => {
            state.saves += 1;
            if (state.failSave || state.failSaveAfter > 0 && state.saves > state.failSaveAfter) throw new Error("private write detail");
            state.store = normalizeBridgeRequestStore(store);
        },
        people: async () => {
            if (state.failPeople) throw new Error("private name and phone");
            return structuredClone(state.roster);
        },
        search: async (_settings, keyword) => state.roster.filter((entry) => entry.name.includes(keyword)),
        reachable: async (docId) => !state.missingDocuments.has(docId),
        newRequest: (original, name) => ({
            checkpoint: { requestId: "20261004000000-reques1", notebookId: original.notebookId, avId: original.avId,
                dbBlockId: original.dbBlockId, name, path: `/人脉/${name}`, draftKey: "[]", state: "new" },
            bindingState: "new",
        }),
        create: async (_settings, name, request) => {
            if (request.checkpoint.state !== "new" && request.checkpoint.state !== "rejected") {
                if (!state.created || state.hideCreated) throw new BridgeError("write_unknown", "ensurePerson", "unknown");
            } else {
                state.creates += 1;
                if (state.rejectCreate) {
                    request.checkpoint.state = "rejected";
                    throw new BridgeError("write_failed", "ensurePerson", "rejected");
                }
                request.checkpoint.state = "unknown";
                state.created = person("20261004000000-created", "20261004000000-newrow1", name);
                if (state.loseCreate) throw new Error("private create response");
            }
            const created = state.created!;
            request.checkpoint.docId = created.docId;
            request.checkpoint.itemId = created.itemId;
            request.checkpoint.state = "verified";
            request.bindingState = "verified";
            if (!state.roster.some((entry) => entry.docId === created.docId)) state.roster.push(created);
            return created;
        },
        event: async (docId, ref) => {
            if (state.failEvent || state.failEventFor === docId) throw new Error("private event detail");
            return state.events.get(JSON.stringify([docId, ref])) ?? null;
        },
        record: async (docId, ref, occurredAt, note) => {
            state.records += 1;
            if (state.rejectRecord) throw new BridgeError("write_failed", "recordInteraction", "rejected");
            if (state.loseRecordBeforeApply) throw new Error("private lost request");
            const key = JSON.stringify([docId, ref]);
            const recorded = !state.events.has(key);
            state.events.set(key, { date: new Date(occurredAt).toLocaleDateString("sv-SE"), note });
            if (state.loseRecord) throw new Error("private lost response");
            return { recorded };
        },
    };
    return { state, deps, api: createExternalBridgeApi(deps), restart: () => createExternalBridgeApi(deps) };
}

test("桥只声明四个既有能力，版本精确匹配且声明不可修改", () => {
    const { api } = fixture();
    assert.equal(BRIDGE_PROTOCOL, 2);
    assert.equal(BRIDGE_STORAGE_KEY, "bridge-requests.json");
    assert.deepEqual(api.capabilities, ["searchPeople", "getPerson", "ensurePerson", "recordInteraction"]);
    assert.equal(api.safety.unknownWrites, "verify_first");
    assert.ok(Object.isFrozen(api) && Object.isFrozen(api.capabilities) && Object.isFrozen(api.safety));
});

test("日期、参数形状及文本边界写前拒绝", () => {
    for (const date of ["", "2026-02-30", "2026-2-01", 123, null]) {
        assert.throws(() => normalizeBridgeInteraction([firstId], { date }), { code: "invalid_input" });
    }
    for (const ids of [null, "person", Array(201).fill(firstId)]) {
        assert.throws(() => normalizeBridgeInteraction(ids), { code: "invalid_input" });
    }
    for (const meta of [null, [], { unknown: true }, { ref: " " }, { note: 123 }, { place: "\u0000" }]) {
        assert.throws(() => normalizeBridgeInteraction([], meta), { code: "invalid_input" });
    }
    assert.throws(() => normalizeBridgeEnsure("a/b", { ref: "source:1" }), { code: "invalid_input" });
    assert.throws(() => normalizeBridgeEnsure("名字", { docId: firstRow, ref: "source:1" }), { code: "invalid_input" });
});

test("默认事件键排序去重，冻结本地日并保留备注语义", () => {
    const first = normalizeBridgeInteraction([secondId, firstId, firstId], { place: " 场所 ", note: " 备注 " }, new Date(2026, 9, 4, 23));
    const second = normalizeBridgeInteraction([firstId, secondId], {}, new Date(2026, 9, 4));
    assert.equal(first.ref, second.ref);
    assert.equal(first.date, "2026-10-04");
    assert.equal(first.note, "@场所 备注");
});

test("姓名一个或多个候选均拒绝自动选中，显式 docId 不随姓名变化", async () => {
    const { api, state } = fixture();
    await assert.rejects(api.ensurePerson("同名人物"), (error: BridgePersonAmbiguityError) => {
        assert.ok(error instanceof BridgePersonAmbiguityError);
        assert.deepEqual(error.candidates.map((entry) => entry.docId), [firstId, secondId]);
        return true;
    });
    state.roster.pop();
    await assert.rejects(api.ensurePerson("同名人物", { ref: "source:1" }), { code: "person_ambiguous" });
    const selected = await api.ensurePerson("旧显示名", { docId: firstId });
    assert.equal(selected.docId, firstId);
    assert.equal(selected.created, false);
    assert.equal(state.creates, 0);
});

test("新建缺稳定键拒绝，读接口返回副本且不落请求库", async () => {
    const { api, state } = fixture();
    await assert.rejects(api.ensurePerson("新人"), { code: "invalid_input" });
    assert.equal(await api.getPerson(missingId), null);
    const found = await api.getPerson(firstId);
    found!.tags.push("外部改动");
    assert.deepEqual(state.roster[0].tags, []);
    assert.equal(state.saves, 0);
});

test("行 ID 不能充当文档 ID，重复绑定身份未知", async () => {
    const { api, state } = fixture();
    assert.equal(await api.getPerson(firstRow), null);
    state.roster.push(person(firstId, secondRow));
    await assert.rejects(api.getPerson(firstId), { code: "identity_unknown" });
    assert.throws(() => resolveBridgePerson([person(firstId, firstId)], firstId, "getPerson"), { code: "identity_unknown" });
    assert.throws(() => resolveBridgePerson([person(), person(secondId, firstRow)], firstId, "getPerson"), { code: "identity_unknown" });
});

test("同键并发建档一次，重启与改名保留原文档身份", async () => {
    const { api, state, restart } = fixture();
    const results = await Promise.all([api.ensurePerson("新人", { ref: "plugin:person:1" }), api.ensurePerson("新人", { ref: "plugin:person:1" })]);
    assert.equal(state.creates, 1);
    assert.equal(results[0].docId, results[1].docId);
    state.roster.find((entry) => entry.docId === results[0].docId)!.name = "已改名";
    const restored = await restart().ensurePerson("新人", { ref: "plugin:person:1" });
    assert.equal(restored.docId, results[0].docId);
    assert.equal(restored.name, "已改名");
    assert.equal(state.creates, 1);
});

test("成功建档同键换输入或锚点拒绝，解绑不创建替代", async () => {
    const { api, state, restart } = fixture();
    const created = await api.ensurePerson("新人", { ref: "plugin:person:1" });
    await assert.rejects(api.ensurePerson("另一人", { ref: "plugin:person:1" }), { code: "idempotency_conflict" });
    state.anchorSettings = { ...settings, avId: "20261004000000-av00002" };
    await assert.rejects(restart().ensurePerson("新人", { ref: "plugin:person:1" }), { code: "idempotency_conflict" });
    state.anchorSettings = settings;
    state.roster = state.roster.filter((entry) => entry.docId !== created.docId);
    await assert.rejects(api.ensurePerson("新人", { ref: "plugin:person:1" }), { code: "identity_unknown" });
    assert.equal(state.creates, 1);
});

test("未知建档重启只核实同请求，不换键重建", async () => {
    const { api, state, restart } = fixture();
    state.loseCreate = true;
    state.hideCreated = true;
    await assert.rejects(api.ensurePerson("新人", { ref: "plugin:person:1" }), { code: "write_unknown", writeState: "unknown" });
    await assert.rejects(restart().ensurePerson("新人", { ref: "plugin:person:1" }), { code: "write_unknown" });
    await assert.rejects(restart().ensurePerson("新人", { ref: "plugin:person:2" }), { code: "write_unknown" });
    assert.equal(state.creates, 1);
    state.hideCreated = false;
    state.loseCreate = false;
    const verified = await restart().ensurePerson("新人", { ref: "plugin:person:1" });
    assert.equal(verified.docId, state.created!.docId);
    assert.equal(state.creates, 1);
});

test("明确建档拒绝可用原请求重试，持久 pending 崩溃不再创建", async () => {
    const { api, state, deps, restart } = fixture();
    state.rejectCreate = true;
    await assert.rejects(api.ensurePerson("新人", { ref: "plugin:person:1" }), { code: "write_failed", writeState: "rejected" });
    const requestId = (state.store.requests[0] as any).request.checkpoint.requestId;
    state.rejectCreate = false;
    await restart().ensurePerson("新人", { ref: "plugin:person:1" });
    assert.equal((state.store.requests[0] as any).request.checkpoint.requestId, requestId);
    const crashed = fixture();
    crashed.state.store.requests.push({ kind: "ensurePerson", ref: "crash:1", anchors: { notebookId: settings.notebookId, avId: settings.avId, dbBlockId: settings.dbBlockId },
        name: "崩溃新人", state: "pending", request: deps.newRequest(settings, "崩溃新人") });
    await assert.rejects(crashed.restart().ensurePerson("崩溃新人", { ref: "crash:1" }), { code: "write_unknown" });
    assert.equal(crashed.state.creates, 0);
    assert.equal((crashed.state.store.requests[0] as any).request.bindingState, "unknown");
});

test("批量部分成功逐项返回：未知 ID、行 ID、非法 ID 与重复项不写孤儿", async () => {
    const { api, state } = fixture();
    const result = await api.recordInteraction([firstId, missingId, firstRow, "bad", firstId, secondId], { ref: "plugin:event:1", date: "2026-10-04" });
    assert.equal(result.recorded, 2);
    assert.equal(result.applied, 2);
    assert.equal(result.failed, 3);
    assert.equal(result.skipped, 1);
    assert.equal(result.complete, false);
    assert.deepEqual(result.results.map((entry) => entry.index), [0, 1, 2, 3, 4, 5]);
    assert.equal(state.events.size, 2);
    assert.equal(result.results[3].docId, undefined);
});

test("并发互动与重启重放零重复，重排人员仍为同请求", async () => {
    const { api, state, restart } = fixture();
    const results = await Promise.all([api.recordInteraction([firstId, secondId], { ref: "plugin:event:1", date: "2026-10-04" }), api.recordInteraction([secondId, firstId], { ref: "plugin:event:1", date: "2026-10-04" })]);
    assert.equal(results.reduce((sum, result) => sum + result.recorded, 0), 2);
    assert.equal(state.records, 2);
    const replay = await restart().recordInteraction([firstId, secondId], { ref: "plugin:event:1", date: "2026-10-04" });
    assert.equal(replay.recorded, 0);
    assert.equal(replay.skipped, 2);
    assert.equal(state.records, 2);
});

test("同键日期、人员、备注变化拒绝，已有事件内容不覆盖", async () => {
    const { api, state } = fixture();
    await api.recordInteraction([firstId], { ref: "plugin:event:1", date: "2026-10-04", note: "原备注" });
    for (const input of [
        { ids: [firstId], date: "2026-10-05", note: "原备注" },
        { ids: [secondId], date: "2026-10-04", note: "原备注" },
        { ids: [firstId], date: "2026-10-04", note: "新备注" },
    ]) await assert.rejects(api.recordInteraction(input.ids, { ref: "plugin:event:1", date: input.date, note: input.note }), { code: "idempotency_conflict" });
    assert.equal(state.records, 1);
});

test("显式事件键省略日期的重放冻结首次日期", async () => {
    const { api, state } = fixture();
    await api.recordInteraction([firstId], { ref: "plugin:event:1", date: "2026-09-01" });
    const replay = await api.recordInteraction([firstId], { ref: "plugin:event:1" });
    assert.equal(replay.recorded, 0);
    assert.equal(state.records, 1);
});

test("互动写响应丢失：首次未知，重启先核实而不再次发送", async () => {
    const { api, state, restart } = fixture();
    state.loseRecord = true;
    const first = await api.recordInteraction([firstId], { ref: "plugin:event:1", date: "2026-10-04" });
    assert.equal(first.unknown, 1);
    assert.equal(first.recorded, 0);
    state.loseRecord = false;
    const replay = await restart().recordInteraction([firstId], { ref: "plugin:event:1", date: "2026-10-04" });
    assert.equal(replay.skipped, 1);
    assert.equal(replay.recorded, 0);
    assert.equal(state.records, 1);
});

test("未知互动无事件证据不得重发，其他已成功项保持核实", async () => {
    const { api, state, restart } = fixture();
    state.loseRecordBeforeApply = true;
    const first = await api.recordInteraction([firstId], { ref: "plugin:event:1", date: "2026-10-04" });
    assert.equal(first.unknown, 1);
    state.loseRecordBeforeApply = false;
    const second = await restart().recordInteraction([firstId], { ref: "plugin:event:1", date: "2026-10-04" });
    assert.equal(second.unknown, 1);
    assert.equal(state.records, 1);
    state.failEvent = true;
    const unreadable = await restart().recordInteraction([firstId], { ref: "plugin:event:1", date: "2026-10-04" });
    assert.equal(unreadable.results[0].writeState, "unknown");
});

test("明确拒绝互动可重试同项，删除已核实事件不复活", async () => {
    const { api, state } = fixture();
    state.rejectRecord = true;
    const first = await api.recordInteraction([firstId], { ref: "plugin:event:1", date: "2026-10-04" });
    assert.equal(first.failed, 1);
    assert.equal(first.results[0].writeState, "rejected");
    state.rejectRecord = false;
    const second = await api.recordInteraction([firstId], { ref: "plugin:event:1", date: "2026-10-04" });
    assert.equal(second.recorded, 1);
    state.events.clear();
    const deleted = await api.recordInteraction([firstId], { ref: "plugin:event:1", date: "2026-10-04" });
    assert.equal(deleted.unknown, 1);
    assert.equal(state.records, 2);
});

test("绑定变化、重复身份及来源读失败保持未知且零事件写", async () => {
    const { api, state } = fixture();
    await api.recordInteraction([firstId], { ref: "plugin:event:1", date: "2026-10-04" });
    state.roster[0].itemId = "20261004000000-row0003";
    const changed = await api.recordInteraction([firstId], { ref: "plugin:event:1", date: "2026-10-04" });
    assert.equal(changed.unknown, 1);
    state.failPeople = true;
    const unreadable = await api.recordInteraction([secondId], { ref: "plugin:event:2", date: "2026-10-04" });
    assert.equal(unreadable.unknown, 1);
    assert.equal(state.records, 1);
});

test("单项事件读失败不阻断另一项，读失败不能视为空库", async () => {
    const { api, state } = fixture();
    state.failEventFor = firstId;
    const partial = await api.recordInteraction([firstId, secondId], { ref: "plugin:event:1", date: "2026-10-04" });
    assert.equal(partial.unknown, 1);
    assert.equal(partial.recorded, 1);
    assert.equal(state.records, 1);
});

test("名册残留但人物文档已删除，不写孤儿互动", async () => {
    const { api, state } = fixture();
    state.missingDocuments.add(firstId);
    assert.equal(await api.getPerson(firstId), null);
    const result = await api.recordInteraction([firstId, secondId], { ref: "plugin:event:1", date: "2026-10-04" });
    assert.equal(result.failed, 1);
    assert.equal(result.recorded, 1);
    assert.equal(result.results[0].code, "person_not_found");
    assert.equal(state.records, 1);
});

test("存储写前故障阻止业务，写后断点保存故障保持未知", async () => {
    const first = fixture();
    first.state.failSave = true;
    await assert.rejects(first.api.ensurePerson("新人", { ref: "plugin:person:1" }), { code: "storage_unknown", writeState: "not_sent" });
    const batch = await first.api.recordInteraction([firstId, secondId], { ref: "plugin:event:1", date: "2026-10-04" });
    assert.equal(batch.unknown, 2);
    assert.equal(first.state.creates + first.state.records, 0);
    const second = fixture();
    second.state.failSaveAfter = 1;
    const unknown = await second.api.recordInteraction([firstId], { ref: "plugin:event:1", date: "2026-10-04" });
    assert.equal(unknown.unknown, 1);
    second.state.failSaveAfter = 0;
    const verified = await second.restart().recordInteraction([firstId], { ref: "plugin:event:1", date: "2026-10-04" });
    assert.equal(verified.skipped, 1);
    assert.equal(second.state.records, 1);
});

test("坏请求库与未知版本停止，不能归一空库或覆盖", async () => {
    const { api, state } = fixture();
    for (const raw of [{ schemaVersion: 2, requests: [] }, { schemaVersion: 1, requests: [null] }, [], "bad"]) {
        assert.throws(() => normalizeBridgeRequestStore(raw), { code: "storage_unknown" });
    }
    state.store = { schemaVersion: 9, requests: [] } as unknown as BridgeRequestStore;
    await assert.rejects(api.recordInteraction([firstId]), { code: "storage_unknown" });
    assert.equal(state.records + state.saves, 0);
});

test("请求库严格拒绝重复键和非法状态组合", async () => {
    const { api, state } = fixture();
    await api.ensurePerson("新人", { ref: "plugin:person:1" });
    const duplicated = structuredClone(state.store);
    duplicated.requests.push(structuredClone(duplicated.requests[0]));
    assert.throws(() => normalizeBridgeRequestStore(duplicated), { code: "storage_unknown" });
    const invalid = structuredClone(state.store);
    (invalid.requests[0] as any).request.checkpoint.docId = undefined;
    assert.throws(() => normalizeBridgeRequestStore(invalid), { code: "storage_unknown" });
});

test("互动证据坏结构和同键重复不猜测，墓碑阻止复活", () => {
    const event = { id: "20261004000000-event01", personDocId: firstId, source: "api", externalRef: "plugin:event:1",
        occurredAt: Date.now(), localDate: "2026-10-04", note: "原备注" };
    const store = { schemaVersion: 1, events: [event], tombstones: [] };
    assert.deepEqual(bridgeEventEvidence(store, firstId, "plugin:event:1"), { date: "2026-10-04", note: "原备注" });
    assert.throws(() => bridgeEventEvidence({ ...store, events: [event, { ...event, id: "20261004000000-event02" }] }, firstId, "plugin:event:1"), { code: "storage_unknown" });
    assert.throws(() => bridgeEventEvidence({ ...store, schemaVersion: 9 }, firstId, "plugin:event:1"));
    assert.equal(bridgeEventEvidence({ ...store, tombstones: [event.id] }, firstId, "plugin:event:1"), null);
});

test("初始化和卸载失败不落数据，诊断不包含私人输入及原始 cause", async () => {
    const { api, state } = fixture();
    state.initialized = false;
    await assert.rejects(api.getPerson(firstId), { code: "not_initialized" });
    state.initialized = true;
    state.active = false;
    await assert.rejects(api.recordInteraction([firstId]), { code: "disposed" });
    state.active = true;
    state.failPeople = true;
    await assert.rejects(api.getPerson(firstId), (error: BridgeError) => {
        assert.deepEqual(error.diagnostic, { operation: "getPerson", code: "unavailable", writeState: "not_sent" });
        assert.equal("cause" in error, false);
        assert.doesNotMatch(JSON.stringify(error), /private|phone|同名人物/);
        return true;
    });
    assert.equal(state.saves, 0);
});

test("队列等待中卸载或锚点变化阻止迟到写入", async () => {
    const { api, state, deps } = fixture();
    let release: () => void;
    const pending = deps.lock(async () => new Promise<void>((resolve) => { release = resolve; }));
    await Promise.resolve();
    const write = api.recordInteraction([firstId], { ref: "plugin:event:1", date: "2026-10-04" });
    state.active = false;
    release!();
    await pending;
    await assert.rejects(write, { code: "disposed" });
    assert.equal(state.records, 0);
});
