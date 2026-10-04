import { recordInteractionWithResult, deleteInteraction, loadInteractionStore } from "../../../src/data/interactions";
import { importInteractionJson, previewInteractionImport } from "../../../src/services/interaction-import";
import { storeLockConfig } from "../../../src/data/storage";
import { createExchangeRecord, loadExchangeStore } from "../../../src/data/exchanges";

const key = "lvct-isolated-multicontext-store";
const pause = () => new Promise((resolve) => setTimeout(resolve, 10));
let writes = 0;
let failNextSave = false;
let failNextRead = false;
let failReadbacksAfterSave = false;
let readbackFailures = 0;
let failAfterWrite = false;
let saveGate;
let saveEntered;
let releaseSave;
let pausedSaveFinished = false;
// localStorage 替代宿主文件，延迟 IO 放大读改写竞态；每个 frame 独立加载真实模块。
const plugin = {
    async loadData() {
        await pause();
        if (failNextRead || readbackFailures > 0) {
            failNextRead = false;
            if (readbackFailures > 0) readbackFailures -= 1;
            throw new Error("隔离读取失败");
        }
        return JSON.parse(localStorage.getItem(key) ?? "null");
    },
    async saveData(_storageKey, value) {
        await pause();
        if (saveGate) {
            const gate = saveGate;
            saveGate = undefined;
            saveEntered();
            await gate;
            writes += 1;
            localStorage.setItem(key, JSON.stringify(value));
            pausedSaveFinished = true;
            return;
        }
        if (failNextSave) { failNextSave = false; throw new Error("隔离保存失败"); }
        writes += 1;
        localStorage.setItem(key, JSON.stringify(value));
        if (failReadbacksAfterSave) {
            failReadbacksAfterSave = false;
            readbackFailures = 1;
        }
        if (failAfterWrite) {
            failAfterWrite = false;
            throw new DOMException("隔离保存已执行但返回取消", "AbortError");
        }
    },
};

window.lvctStoreTest = {
    createExchange: (input) => createExchangeRecord(plugin, input),
    loadExchanges: () => loadExchangeStore(plugin),
    record: (input) => recordInteractionWithResult(plugin, input),
    remove: (id, person) => deleteInteraction(plugin, id, person),
    load: () => loadInteractionStore(plugin),
    merge: (text) => importInteractionJson(plugin, text),
    preview: (text) => previewInteractionImport(plugin, text),
    writes: () => writes,
    failSave: () => { failNextSave = true; },
    failRead: () => { failNextRead = true; },
    failReadbacks: () => { failReadbacksAfterSave = true; },
    abortAfterWrite: () => { failAfterWrite = true; },
    configureLocks: (config) => Object.assign(storeLockConfig, config),
    holdNextSave: () => {
        pausedSaveFinished = false;
        saveGate = new Promise((resolve) => { releaseSave = resolve; });
        return new Promise((resolve) => { saveEntered = resolve; });
    },
    releaseSave: () => releaseSave?.(),
    pausedSaveFinished: () => pausedSaveFinished,
};
