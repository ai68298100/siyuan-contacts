import { recordInteractionWithResult, deleteInteraction, loadInteractionStore } from "../../../src/data/interactions";
import { importInteractionJson, previewInteractionImport } from "../../../src/services/interaction-import";

const key = "lvct-isolated-multicontext-store";
const pause = () => new Promise((resolve) => setTimeout(resolve, 10));
let writes = 0;
let failNextSave = false;
// localStorage 替代宿主文件，延迟 IO 放大读改写竞态；每个 frame 独立加载真实模块。
const plugin = {
    async loadData() {
        await pause();
        return JSON.parse(localStorage.getItem(key) ?? "null");
    },
    async saveData(_storageKey, value) {
        await pause();
        if (failNextSave) { failNextSave = false; throw new Error("隔离保存失败"); }
        writes += 1;
        localStorage.setItem(key, JSON.stringify(value));
    },
};

window.lvctStoreTest = {
    record: (input) => recordInteractionWithResult(plugin, input),
    remove: (id, person) => deleteInteraction(plugin, id, person),
    load: () => loadInteractionStore(plugin),
    merge: (text) => importInteractionJson(plugin, text),
    preview: (text) => previewInteractionImport(plugin, text),
    writes: () => writes,
    failSave: () => { failNextSave = true; },
};
