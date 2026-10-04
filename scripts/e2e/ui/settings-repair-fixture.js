import { FIELD_SPECS } from "../../../src/domain/fields.ts";
import { SETTINGS_REPAIR_STORAGE_KEY } from "../../../src/domain/settings-repair.ts";
import { SETTINGS_REPAIR_LOCK_KEY } from "../../../src/data/settings-repair.ts";
import { withStoreLock } from "../../../src/data/storage.ts";
import { kernelConfig } from "../../../src/api/client";
import { previewMissingFields, rebuildMissingFields, previewRebindSettings, rebindSettings, repairFieldMap } from "../../../src/services/settings-health.ts";

export function configureSettingsRepairKernel(kernel, settings) {
    const columns = FIELD_SPECS.map((spec) => ({ id: settings.fieldMap[spec.key], name: spec.nameZh, type: spec.type }));
    const source = { notebookId: settings.notebookId, notebookName: settings.notebookName, hostDocId: settings.hostDocId,
        dbBlockId: settings.dbBlockId, avId: settings.avId, name: "原宿主", columns, keys: [] };
    const state = { store: new Map([["contacts-settings.json", structuredClone(settings)]]), jsonWrites: [], adds: [], relations: [],
        targets: [source], rejectAt: 0, loseAt: 0, unknownAt: 0, failRead: null, failStorage: null,
        failAfterMap: false, malformedKeys: false, duplicateAv: false, afterAdd: null, unknownRelation: false, loseRelation: false };
    state.plugin = {
        async loadData(key) {
            if (state.failStorage === key) throw new Error("严格读取注入失败");
            return structuredClone(state.store.get(key) ?? null);
        },
        async saveData(key, value) {
            state.jsonWrites.push(key);
            state.store.set(key, structuredClone(value));
            if (state.failAfterMap && key === "contacts-settings.json") { state.failAfterMap = false; throw new Error("映射保存响应丢失"); }
        },
    };
    state.addTarget = (notebookId = settings.notebookId) => {
        const target = { notebookId, notebookName: notebookId === settings.notebookId ? settings.notebookName : "明确跨本",
            hostDocId: "20261004000000-host002", dbBlockId: "20261004000000-table02", avId: "20261004000000-av00002", name: "新宿主",
            columns: columns.map((column, index) => ({ ...column, id: `20261004000000-key${String(index).padStart(4, "0")}` })), keys: [] };
        const forward = target.columns.find((column) => column.type === "relation").id;
        const backKeyId = "20261004000000-back002";
        target.columns.push({ id: backKeyId, name: "被相关人", type: "relation" });
        target.keys.push({ id: forward, relation: { avID: target.avId, isTwoWay: true, backKeyID: backKeyId } },
            { id: backKeyId, relation: { avID: target.avId, isTwoWay: true, backKeyID: forward } });
        state.targets.push(target);
        return target;
    };
    kernel.handler = async (route, body) => {
        if (state.failRead === route) throw new Error("目标读取注入失败");
        if (route === "/api/notebook/lsNotebooks") return { notebooks: [...new Map(state.targets.map((target) => [target.notebookId,
            { id: target.notebookId, name: target.notebookName }])).values()] };
        if (route === "/api/sqlite/flushTransaction") return null;
        if (route === "/api/query/sql") {
            if (body.stmt.includes("SELECT id, content FROM")) {
                return state.targets.filter((target) => body.stmt.includes(`box='${target.notebookId}'`) && body.stmt.includes(`id='${target.hostDocId}'`))
                    .map((target) => ({ id: target.hostDocId, content: target.name }));
            }
            if (body.stmt.includes("type = 'av'")) {
                const target = state.targets.find((entry) => body.stmt.includes(`parent_id = '${entry.hostDocId}'`));
                if (!target) return [];
                return [{ id: target.dbBlockId, parent_id: target.hostDocId, markdown: `<div data-av-id="${target.avId}"></div>` },
                    ...(state.duplicateAv ? [{ id: "20261004000000-dupl001", parent_id: target.hostDocId, markdown: `<div data-av-id="${target.avId}"></div>` }] : [])];
            }
            throw new Error("设置夹具拒绝未知 SQL");
        }
        if (route === "/api/av/renderAttributeView") {
            const target = state.targets.find((entry) => entry.avId === body.id && entry.dbBlockId === body.blockID);
            if (!target) throw new Error("渲染归属不符");
            return { view: { columns: structuredClone(target.columns), rows: [] } };
        }
        if (route === "/api/av/addAttributeViewKey") {
            state.adds.push(structuredClone(body));
            const checkpoint = state.store.get(SETTINGS_REPAIR_STORAGE_KEY);
            if (!checkpoint.steps.some((step) => step.keyId === body.keyID && step.columnState === "unknown")) throw new Error("建列前未持久原 ID");
            if (state.rejectAt === state.adds.length) throw new Error("明确拒绝第二列");
            if (state.unknownAt !== state.adds.length) state.targets.find((entry) => entry.avId === body.avID).columns.push({ id: body.keyID, name: body.keyName, type: body.keyType });
            await state.afterAdd?.();
            if (state.loseAt === state.adds.length || state.unknownAt === state.adds.length) return new Promise(() => {});
            return null;
        }
        if (route === "/api/av/getAttributeView") {
            if (state.malformedKeys) return { av: { keyValues: null } };
            const target = state.targets.find((entry) => entry.avId === body.id);
            return { av: { keyValues: target.columns.map((column) => ({ key: { ...column, ...target.keys.find((entry) => entry.id === column.id) } })) } };
        }
        if (route === "/api/transactions") {
            const operation = body.transactions[0].doOperations[0];
            state.relations.push(structuredClone(operation));
            const checkpoint = state.store.get(SETTINGS_REPAIR_STORAGE_KEY);
            if (!checkpoint.steps.some((step) => step.backKeyId === operation.backRelationKeyID && step.relationState === "unknown")) throw new Error("配置前未持久回链 ID");
            if (state.unknownRelation) return new Promise(() => {});
            const target = state.targets.find((entry) => entry.avId === operation.avID);
            target.columns.push({ id: operation.backRelationKeyID, name: operation.name, type: "relation" });
            target.keys.push({ id: operation.keyID, relation: { avID: operation.avID, isTwoWay: true, backKeyID: operation.backRelationKeyID } },
                { id: operation.backRelationKeyID, relation: { avID: operation.avID, isTwoWay: true, backKeyID: operation.keyID } });
            if (state.loseRelation) return new Promise(() => {});
            return null;
        }
        throw new Error(`设置夹具拒绝 ${route}`);
    };
    return state;
}

export async function runSettingsRepairServiceRegression({ test, assert, kernel, settings }) {
    await test("AG-P0-003 第二列明确失败后原列 ID 重试，已核实映射不重建", async () => {
        const state = configureSettingsRepairKernel(kernel, settings);
        state.targets[0].columns = state.targets[0].columns.filter((column) => ![settings.fieldMap.phone, settings.fieldMap.email].includes(column.id));
        const preview = await previewMissingFields(state.plugin, settings);
        assert(state.jsonWrites.length === 0 && state.adds.length === 0, "预览产生写入");
        state.rejectAt = 2;
        let failure;
        try { await rebuildMissingFields(state.plugin, settings, preview); } catch (error) { failure = error; }
        assert(failure instanceof Error && failure.message.includes("明确拒绝")
            && state.store.get(SETTINGS_REPAIR_STORAGE_KEY).steps.find((step) => step.field === "email")?.columnState === "rejected",
        "明确拒绝被误判为未知结果");
        assert(state.adds.length === 2 && state.store.get("contacts-settings.json").fieldMap.phone === state.adds[0].keyID, "第一列映射丢失或第二列误成功");
        state.rejectAt = 0;
        const resumedPreview = await previewMissingFields(state.plugin, settings);
        assert(resumedPreview.requestId === state.store.get(SETTINGS_REPAIR_STORAGE_KEY).requestId
            && resumedPreview.source.fieldMap.phone === state.adds[0].keyID && settings.fieldMap.phone !== state.adds[0].keyID,
        "旧 facade 未从持久原断点核实前进");
        const updated = await rebuildMissingFields(state.plugin, settings, resumedPreview);
        assert(state.adds.length === 3 && state.adds[1].keyID === state.adds[2].keyID && updated.fieldMap.phone === state.adds[0].keyID, "失败重试换 ID 或重建成功列");
        await rebuildMissingFields(state.plugin, updated, preview);
        assert(state.adds.length === 3, "完成核实重复建列");
    });

    await test("AG-P0-003 建列超时已写按原 ID 收口；未发现原 ID 禁止盲重发", async () => {
        const previousTimeout = kernelConfig.timeoutMs;
        kernelConfig.timeoutMs = 20;
        try {
            for (const applied of [true, false]) {
                const state = configureSettingsRepairKernel(kernel, settings);
                state.targets[0].columns = state.targets[0].columns.filter((column) => column.id !== settings.fieldMap.phone);
                const preview = await previewMissingFields(state.plugin, settings);
                if (applied) state.loseAt = 1;
                else state.unknownAt = 1;
                let updated;
                try { updated = await rebuildMissingFields(state.plugin, settings, preview); } catch {}
                if (applied) assert(updated?.fieldMap.phone === state.adds[0].keyID, "已写超时未核实");
                else {
                    let stopped = false;
                    try { await rebuildMissingFields(state.plugin, settings, preview); } catch { stopped = true; }
                    assert(stopped && state.adds.length === 1
                        && state.store.get(SETTINGS_REPAIR_STORAGE_KEY).steps[0].columnState === "unknown", "未知未写换 ID 重建或误判明确拒绝");
                }
            }
        } finally { kernelConfig.timeoutMs = previousTimeout; }
    });

    await test("AG-P0-003 映射保存丢响应，持久断点和原列核实继续零重复", async () => {
        const state = configureSettingsRepairKernel(kernel, settings);
        state.targets[0].columns = state.targets[0].columns.filter((column) => column.id !== settings.fieldMap.phone);
        const preview = await previewMissingFields(state.plugin, settings);
        state.failAfterMap = true;
        try { await rebuildMissingFields(state.plugin, settings, preview); } catch {}
        const restoredPreview = await previewMissingFields(state.plugin, settings);
        const updated = await rebuildMissingFields(state.plugin, settings, restoredPreview);
        assert(state.adds.length === 1 && updated.fieldMap.phone === state.adds[0].keyID, "映射未知重复建列");
    });

    await test("AG-P0-003 建列后读取失败保留原 checkpoint，恢复后只核实原 ID", async () => {
        const state = configureSettingsRepairKernel(kernel, settings);
        state.targets[0].columns = state.targets[0].columns.filter((column) => column.id !== settings.fieldMap.phone);
        const preview = await previewMissingFields(state.plugin, settings);
        state.afterAdd = () => { state.failRead = "/api/av/renderAttributeView"; };
        let stopped = false;
        try { await rebuildMissingFields(state.plugin, settings, preview); } catch { stopped = true; }
        assert(stopped && state.adds.length === 1 && state.store.get(SETTINGS_REPAIR_STORAGE_KEY).steps[0].columnState === "unknown", "建列读失败丢断点或假成功");
        state.afterAdd = null;
        state.failRead = null;
        const resumed = await previewMissingFields(state.plugin, settings);
        const updated = await rebuildMissingFields(state.plugin, settings, resumed);
        assert(state.adds.length === 1 && updated.fieldMap.phone === state.adds[0].keyID, "读恢复重新建列");
    });

    await test("AG-P0-003 相关人持久双 ID，回读双向事实而非同名回链", async () => {
        const state = configureSettingsRepairKernel(kernel, settings);
        state.targets[0].columns = state.targets[0].columns.filter((column) => column.id !== settings.fieldMap.related);
        const preview = await previewMissingFields(state.plugin, settings);
        const updated = await rebuildMissingFields(state.plugin, settings, preview);
        const step = state.store.get(SETTINGS_REPAIR_STORAGE_KEY).steps[0];
        assert(updated.fieldMap.related === step.keyId && state.relations.length === 1 && state.relations[0].backRelationKeyID === step.backKeyId, "回链断点或双向未核实");
        state.targets[0].keys[1].relation.backKeyID = "wrong";
        let stopped = false;
        try { await rebuildMissingFields(state.plugin, updated, preview); } catch { stopped = true; }
        assert(stopped && state.relations.length === 1 && state.adds.length === 1, "坏双向配置触发重建");
    });

    await test("AG-P0-003 严格读取和陈旧设置零写，旧完整映射冲突拒绝", async () => {
        const state = configureSettingsRepairKernel(kernel, settings);
        state.failStorage = "contacts-settings.json";
        let stopped = false;
        try { await repairFieldMap(state.plugin, settings, { phone: settings.fieldMap.phone }); } catch { stopped = true; }
        assert(stopped && state.jsonWrites.length === 0, "读取失败覆盖设置");
        state.failStorage = null;
        state.store.set("contacts-settings.json", { ...settings, fieldMap: { ...settings.fieldMap, phone: settings.fieldMap.email } });
        stopped = false;
        try { await repairFieldMap(state.plugin, state.store.get("contacts-settings.json"), { website: settings.fieldMap.website }); } catch { stopped = true; }
        assert(stopped && state.jsonWrites.length === 0, "保留旧重复映射");
        stopped = false;
        try { await repairFieldMap(state.plugin, settings, { phone: settings.fieldMap.phone }); } catch { stopped = true; }
        assert(stopped && state.jsonWrites.length === 0, "陈旧设置覆盖最新映射");
    });

    await test("AG-P0-003 相关人未知配置只核实原回链 ID，迟到结果零重建", async () => {
        const state = configureSettingsRepairKernel(kernel, settings);
        state.targets[0].columns = state.targets[0].columns.filter((column) => column.id !== settings.fieldMap.related);
        const preview = await previewMissingFields(state.plugin, settings);
        const previousTimeout = kernelConfig.timeoutMs;
        kernelConfig.timeoutMs = 20;
        try {
            state.unknownRelation = true;
            try { await rebuildMissingFields(state.plugin, settings, preview); } catch {}
            let stopped = false;
            try { await rebuildMissingFields(state.plugin, settings, preview); } catch { stopped = true; }
            assert(stopped && state.relations.length === 1 && state.adds.length === 1, "未知回链重发配置或重建原列");
            const step = state.store.get(SETTINGS_REPAIR_STORAGE_KEY).steps[0];
            state.targets[0].columns.push({ id: step.backKeyId, name: "被相关人", type: "relation" });
            state.targets[0].keys.push({ id: step.keyId, relation: { avID: settings.avId, isTwoWay: true, backKeyID: step.backKeyId } },
                { id: step.backKeyId, relation: { avID: settings.avId, isTwoWay: true, backKeyID: step.keyId } });
            const resumed = await previewMissingFields(state.plugin, settings);
            const updated = await rebuildMissingFields(state.plugin, settings, resumed);
            assert(updated.fieldMap.related === step.keyId && state.relations.length === 1 && state.adds.length === 1, "迟到回链未核实或被重建");
        } finally { kernelConfig.timeoutMs = previousTimeout; }
    });

    await test("AG-P0-003 预览过期与损坏断点保留原文件零内核写入", async () => {
        const state = configureSettingsRepairKernel(kernel, settings);
        state.targets[0].columns = state.targets[0].columns.filter((column) => column.id !== settings.fieldMap.phone);
        const preview = await previewMissingFields(state.plugin, settings);
        state.targets[0].columns[0].name = "外部改列";
        let stopped = false;
        try { await rebuildMissingFields(state.plugin, settings, preview); } catch { stopped = true; }
        assert(stopped && state.jsonWrites.length === 0 && state.adds.length === 0, "过期预览仍补列");
        state.store.set(SETTINGS_REPAIR_STORAGE_KEY, { schemaVersion: 99 });
        stopped = false;
        try { await previewMissingFields(state.plugin, settings); } catch { stopped = true; }
        assert(stopped && state.store.get(SETTINGS_REPAIR_STORAGE_KEY).schemaVersion === 99 && state.jsonWrites.length === 0, "损坏断点被覆盖");
    });

    await test("AG-P0-003 重绑四层归属与跨本显式确认，目标读失败零保存", async () => {
        const state = configureSettingsRepairKernel(kernel, settings);
        const target = state.addTarget("20261004000000-book002");
        const patch = { hostDocId: target.hostDocId, dbBlockId: target.dbBlockId, avId: target.avId };
        let stopped = false;
        try { await previewRebindSettings(state.plugin, settings, patch); } catch { stopped = true; }
        assert(stopped && state.jsonWrites.length === 0, "跨本未明确仍沿用旧本");
        const explicit = { ...patch, notebookId: target.notebookId };
        const preview = await previewRebindSettings(state.plugin, settings, explicit);
        assert(preview.matchedFields === FIELD_SPECS.length && state.jsonWrites.length === 0, "只读影响预览不完整");
        state.failRead = "/api/query/sql";
        stopped = false;
        try { await rebindSettings(state.plugin, settings, explicit, preview); } catch { stopped = true; }
        assert(stopped && state.jsonWrites.length === 0, "目标读失败保存锚点");
        state.failRead = null;
        state.duplicateAv = true;
        stopped = false;
        try { await rebindSettings(state.plugin, settings, explicit, preview); } catch { stopped = true; }
        assert(stopped && state.jsonWrites.length === 0, "多重 AV 归属允许保存");
        state.duplicateAv = false;
        const updated = await rebindSettings(state.plugin, settings, explicit, preview);
        assert(updated.notebookId === target.notebookId && updated.notebookName === target.notebookName && updated.avId === target.avId, "明确跨本未写入目标配置");
    });

    await test("AG-P0-003 同本旧 patch 兼容，改变目标列/设置后必须重新预览", async () => {
        const state = configureSettingsRepairKernel(kernel, settings);
        const target = state.addTarget();
        const patch = { hostDocId: target.hostDocId, dbBlockId: target.dbBlockId, avId: target.avId };
        const preview = await previewRebindSettings(state.plugin, settings, patch);
        target.columns[0].name = "目标已改名";
        let stopped = false;
        try { await rebindSettings(state.plugin, settings, patch, preview); } catch { stopped = true; }
        assert(stopped && state.jsonWrites.length === 0, "目标变化旧预览仍生效");
        target.columns[0].name = FIELD_SPECS[0].nameZh;
        state.store.set("contacts-settings.json", { ...settings, notebookName: "外部设置改变" });
        stopped = false;
        try { await rebindSettings(state.plugin, settings, patch, preview); } catch { stopped = true; }
        assert(stopped && state.jsonWrites.length === 0, "旧设置覆盖外部改变");
    });

    await test("AG-P0-003 笔记本/宿主/块/AV 四层错配与坏双向配置均拒绝", async () => {
        const state = configureSettingsRepairKernel(kernel, settings);
        const target = state.addTarget();
        const correct = { notebookId: target.notebookId, hostDocId: target.hostDocId, dbBlockId: target.dbBlockId, avId: target.avId };
        for (const patch of [
            { ...correct, notebookId: "20261004000000-miss001" },
            { ...correct, hostDocId: settings.hostDocId },
            { ...correct, dbBlockId: settings.dbBlockId },
            { ...correct, avId: settings.avId },
        ]) {
            let stopped = false;
            try { await previewRebindSettings(state.plugin, settings, patch); } catch { stopped = true; }
            assert(stopped && state.jsonWrites.length === 0 && state.adds.length === 0, "错配锚点产生写入");
        }
        target.keys[1].relation.backKeyID = "other";
        let stopped = false;
        try { await previewRebindSettings(state.plugin, settings, correct); } catch { stopped = true; }
        assert(stopped && state.jsonWrites.length === 0, "目标坏双向配置仍可绑定");
    });

    await test("AG-P0-003 缺显式确认及排队页面卸载零写入", async () => {
        const state = configureSettingsRepairKernel(kernel, settings);
        const target = state.addTarget();
        const patch = { hostDocId: target.hostDocId, dbBlockId: target.dbBlockId, avId: target.avId };
        let stopped = false;
        try { await rebuildMissingFields(state.plugin, settings); } catch { stopped = true; }
        assert(stopped, "补列未确认即执行");
        stopped = false;
        try { await rebindSettings(state.plugin, settings, patch); } catch { stopped = true; }
        assert(stopped, "重绑未确认即执行");
        let release;
        const gate = new Promise((resolve) => { release = resolve; });
        const holding = withStoreLock(SETTINGS_REPAIR_LOCK_KEY, () => gate);
        let alive = true;
        const queued = repairFieldMap(state.plugin, settings, { phone: settings.fieldMap.phone }, () => alive);
        const settled = queued.then(() => false, () => true);
        alive = false;
        release();
        await holding;
        assert(await settled && state.jsonWrites.length === 0 && state.adds.length === 0, "页面卸载排队仍写入");
    });
}
