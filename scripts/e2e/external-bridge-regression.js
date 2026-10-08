import { initExternalBridge, disposeExternalBridge } from "../../src/bridge/external-bridge";
import { BRIDGE_STORAGE_KEY } from "../../src/domain/external-bridge.ts";
import { FIELD_SPECS } from "../../src/domain/fields.ts";
import { INTERACTION_STORAGE_KEY } from "../../src/data/interactions";
import { invalidateRoster } from "../../src/services/roster";
import { kernelConfig } from "../../src/api/client";

const firstId = "20261004000000-bridge1";
const secondId = "20261004000000-bridge2";

export function configureBridgeKernel(kernel, originalSettings) {
    invalidateRoster();
    const settings = { ...originalSettings, fieldMap: Object.fromEntries(FIELD_SPECS.map((field) => [field.key, field.key])) };
    const state = {
        docs: new Map(), rows: new Map(), files: new Map(), creates: [], binds: [], eventWrites: 0,
        loseCreate: false, hideMarker: false, rejectCreate: false, failEventRead: false,
        failEventReadAfterSave: false, failRequestSave: false, failRoster: false,
    };
    state.addPerson = (docId, itemId, name) => {
        state.docs.set(docId, { id: docId, name });
        state.rows.set(itemId, { id: itemId, cells: [{ valueType: "block", value: {
            type: "block", keyID: "name", block: { id: docId, content: name },
        } }] });
    };
    state.addPerson(firstId, "20261004000000-brow001", "桥同名");
    state.addPerson(secondId, "20261004000000-brow002", "桥同名");
    state.plugin = {
        loadData: async (key) => {
            if (key === INTERACTION_STORAGE_KEY && (state.failEventRead || state.failEventReadAfterSave && state.eventWrites > 0)) {
                throw new Error("PRIVATE_INTERACTION_DETAILS");
            }
            return structuredClone(state.files.has(key) ? state.files.get(key) : "");
        },
        saveData: async (key, value) => {
            if (key === BRIDGE_STORAGE_KEY && state.failRequestSave) throw new Error("PRIVATE_BRIDGE_DETAILS");
            if (key === INTERACTION_STORAGE_KEY) state.eventWrites += 1;
            state.files.set(key, structuredClone(value));
        },
    };
    kernel.handler = async (route, body) => {
        if (route === "/api/av/renderAttributeView") {
            if (state.failRoster) throw new Error("PRIVATE_ROSTER_DETAILS");
            return { view: { columns: FIELD_SPECS.map((field) => ({ id: field.key, name: field.nameZh, type: field.type })),
                rows: structuredClone([...state.rows.values()]) } };
        }
        if (route === "/api/sqlite/flushTransaction") return null;
        if (route === "/api/query/sql") {
            if (body.stmt.includes("SELECT DISTINCT root_id")) {
                if (state.hideMarker) return [];
                const requestId = body.stmt.match(/custom-lvct-contact-draft="([^"]+)"/)?.[1];
                return [...state.docs.values()].filter((doc) => doc.requestId === requestId).map((doc) => ({ root_id: doc.id }));
            }
            if (body.stmt.includes("SELECT id, content, hpath")) {
                const afterId = body.stmt.match(/id > '([^']+)'/)?.[1] ?? "";
                return [...state.docs.values()].filter((doc) => doc.id > afterId).sort((left, right) => left.id.localeCompare(right.id))
                    .slice(0, 500).map((doc) => ({ id: doc.id, content: doc.name, hpath: `/人脉/${doc.name}` }));
            }
            if (body.stmt.includes("root_id =")) return [];
            const docId = body.stmt.match(/\bid\s*=\s*'([^']+)'/)?.[1];
            const doc = state.docs.get(docId);
            return doc ? [{ id: doc.id, content: doc.name }] : [];
        }
        if (route === "/api/filetree/createDocWithMd") {
            state.creates.push(structuredClone(body));
            if (state.rejectCreate) throw new Error("内核明确拒绝");
            const docId = `20261004000000-bdoc${String(state.creates.length).padStart(3, "0")}`;
            const requestId = body.markdown.match(/custom-lvct-contact-draft="([^"]+)"/)?.[1];
            state.docs.set(docId, { id: docId, requestId, name: body.path.split("/").at(-1) });
            if (state.loseCreate) return new Promise(() => {});
            return docId;
        }
        if (route === "/api/av/getAttributeViewItemIDsByBoundIDs") {
            return Object.fromEntries(body.blockIDs.flatMap((docId) => {
                const row = [...state.rows.values()].find((candidate) => candidate.cells[0].value.block.id === docId);
                return row ? [[docId, row.id]] : [];
            }));
        }
        if (route === "/api/av/addAttributeViewBlocks") {
            state.binds.push(structuredClone(body));
            for (const source of body.srcs) {
                const itemId = `20261004000000-brow${String(state.binds.length + 2).padStart(3, "0")}`;
                state.rows.set(itemId, { id: itemId, cells: [{ valueType: "block", value: {
                    type: "block", keyID: "name", block: { id: source.id, content: source.content },
                } }] });
            }
            return null;
        }
        throw new Error(`独立桥夹具拒绝未知端点 ${route}`);
    };
    state.mount = () => {
        initExternalBridge(state.plugin, () => settings);
        return window.LvContacts;
    };
    return state;
}

async function failure(task) {
    try { await task(); }
    catch (error) { return error; }
    throw new Error("预期桥接拒绝，但实际成功");
}

export async function runExternalBridgeRegression({ test, assert, kernel, settings }) {
    const originalHandler = kernel.handler;
    const originalTimeout = kernelConfig.timeoutMs;
    const isolated = async (name, scenario) => test(name, async () => {
        const state = configureBridgeKernel(kernel, settings);
        try { await scenario(state, state.mount()); }
        finally { disposeExternalBridge(); invalidateRoster(); }
    });
    try {
        kernelConfig.timeoutMs = 80;
        await isolated("AG-P0-010 桥 v2 精确能力，同名稳定 ID 消歧", async (state, bridge) => {
            assert(bridge.protocol === 2 && bridge.capabilities.length === 4, "协议或能力不准确");
            const candidates = await bridge.searchPeople("桥同名");
            assert(candidates.length === 2 && candidates.every((person) => /^\d{14}-[0-9a-z]{7}$/.test(person.itemId)), "候选没有稳定行 ID");
            const error = await failure(() => bridge.ensurePerson("桥同名"));
            assert(error.code === "person_ambiguous" && error.candidates.length === 2, "同名未明确拒绝");
            const selected = await bridge.ensurePerson("旧名称", { docId: secondId });
            assert(selected.docId === secondId && !selected.created && state.creates.length === 0, "显式 ID 被姓名替换");
        });
        await isolated("AG-P0-010 真服务同键并发建档与重挂载零重复", async (state, bridge) => {
            const results = await Promise.all([bridge.ensurePerson("桥新人", { ref: "fixture:person:1" }), bridge.ensurePerson("桥新人", { ref: "fixture:person:1" })]);
            assert(results[0].docId === results[1].docId && state.creates.length === 1 && state.binds.length === 1, "并发重复建档或绑定");
            const restored = await state.mount().ensurePerson("桥新人", { ref: "fixture:person:1" });
            assert(restored.docId === results[0].docId && state.creates.length === 1, "持久请求重挂载失效");
        });
        await isolated("AG-P0-010 未绑定同名文档停止自动收编", async (state, bridge) => {
            state.docs.set("20261004000000-unbound", { id: "20261004000000-unbound", name: "旧文档" });
            const error = await failure(() => bridge.ensurePerson("旧文档", { ref: "fixture:person:1" }));
            assert(error.code === "person_ambiguous" && error.unboundCandidates[0].docId === "20261004000000-unbound"
                && state.creates.length === 0 && state.binds.length === 0, "桥自动收编同名文档或丢失候选 ID");
        });
        await isolated("AG-P0-010 未知创建持久核实，不换请求重建", async (state, bridge) => {
            state.loseCreate = true;
            state.hideMarker = true;
            const first = await failure(() => bridge.ensurePerson("桥未知新人", { ref: "fixture:person:1" }));
            assert(first.code === "write_unknown" && first.writeState === "unknown", "未知创建被当明确失败");
            await failure(() => state.mount().ensurePerson("桥未知新人", { ref: "fixture:person:1" }));
            await failure(() => window.LvContacts.ensurePerson("桥未知新人", { ref: "fixture:person:2" }));
            assert(state.creates.length === 1 && state.binds.length === 0, "未知写重放或换键重建");
            state.hideMarker = false;
            state.loseCreate = false;
            const verified = await window.LvContacts.ensurePerson("桥未知新人", { ref: "fixture:person:1" });
            assert(verified.docId === "20261004000000-bdoc001" && state.creates.length === 1 && state.binds.length === 1, "原请求未核实续做");
        });
        await isolated("AG-P0-010 明确拒绝同请求重试", async (state, bridge) => {
            state.rejectCreate = true;
            const error = await failure(() => bridge.ensurePerson("桥拒绝新人", { ref: "fixture:person:1" }));
            assert(error.code === "write_failed" && error.writeState === "rejected", "明确拒绝状态丢失");
            const requestId = state.files.get(BRIDGE_STORAGE_KEY).requests[0].request.checkpoint.requestId;
            state.rejectCreate = false;
            await state.mount().ensurePerson("桥拒绝新人", { ref: "fixture:person:1" });
            assert(state.creates.length === 2 && state.creates.every((request) => request.markdown.includes(requestId)), "拒绝后改用了新请求");
        });
        await isolated("AG-P0-010 逐项结果与孤儿保护，并发事件零重复", async (state, bridge) => {
            const result = await bridge.recordInteraction([firstId, "bad", "20261004000000-missing", firstId, secondId], { date: "2026-10-04", ref: "fixture:event:1" });
            assert(result.recorded === 2 && result.failed === 2 && result.skipped === 1 && !result.complete, "部分结果被当全部成功");
            const changed = await failure(() => bridge.recordInteraction([firstId, secondId], { date: "2026-10-04", ref: "fixture:event:1" }));
            assert(changed.code === "idempotency_conflict" && state.eventWrites === 2, "同键换输入未拒绝");
            const ids = [firstId, "20261004000000-missing", secondId];
            const repeats = await Promise.all([bridge.recordInteraction(ids, { date: "2026-10-04", ref: "fixture:event:1" }), bridge.recordInteraction([...ids].reverse(), { date: "2026-10-04", ref: "fixture:event:1" })]);
            assert(repeats.every((item) => item.recorded === 0) && state.eventWrites === 2, "幂等重放重复写事件");
            const restored = await state.mount().recordInteraction(ids, { date: "2026-10-04", ref: "fixture:event:1" });
            assert(restored.recorded === 0 && restored.skipped === 2 && restored.failed === 1 && state.eventWrites === 2, "重挂载未保留逐项结果或重复写事件");
            state.docs.delete(firstId);
            const orphan = await window.LvContacts.recordInteraction([firstId], { date: "2026-10-04", ref: "fixture:event:2" });
            assert(orphan.failed === 1 && state.eventWrites === 2, "名册残留被写成孤儿互动");
        });
        await isolated("AG-P0-010 事件写后读失败，重启只核实原事件", async (state, bridge) => {
            state.failEventReadAfterSave = true;
            const first = await bridge.recordInteraction([firstId], { date: "2026-10-04", ref: "fixture:event:1", note: "PRIVATE_NOTE" });
            assert(first.unknown === 1 && first.recorded === 0 && state.eventWrites === 1, "存储未知显示成功或重发");
            state.failEventReadAfterSave = false;
            const verified = await state.mount().recordInteraction([firstId], { date: "2026-10-04", ref: "fixture:event:1", note: "PRIVATE_NOTE" });
            assert(verified.skipped === 1 && verified.recorded === 0 && state.eventWrites === 1, "未知事件被再次发送");
            assert(!JSON.stringify(first).includes("PRIVATE_NOTE") && !JSON.stringify(first).includes("PRIVATE_INTERACTION_DETAILS"), "诊断泄露私人输入");
        });
        await isolated("AG-P0-010 读取未知与请求保存失败零业务写", async (state, bridge) => {
            state.failEventRead = true;
            const read = await bridge.recordInteraction([firstId], { ref: "fixture:event:1" });
            assert(read.unknown === 1 && state.eventWrites === 0, "读失败被当空库覆盖");
            state.failEventRead = false;
            state.failRequestSave = true;
            const write = await bridge.recordInteraction([firstId], { ref: "fixture:event:1" });
            assert(write.unknown === 1 && state.eventWrites === 0, "断点未核实仍写入业务");
        });
        await isolated("AG-P0-010 坏请求库停止与旧桥卸载失效", async (state, bridge) => {
            state.files.set(BRIDGE_STORAGE_KEY, { schemaVersion: 9, requests: [] });
            const corrupted = await failure(() => bridge.recordInteraction([firstId]));
            assert(corrupted.code === "storage_unknown" && state.eventWrites === 0, "坏请求库降级空库");
            disposeExternalBridge();
            const stale = await failure(() => bridge.getPerson(firstId));
            assert(stale.code === "disposed" && !window.LvContacts, "旧桥引用仍可调用");
        });
    } finally {
        kernel.handler = originalHandler;
        kernelConfig.timeoutMs = originalTimeout;
        disposeExternalBridge();
        invalidateRoster();
    }
}
