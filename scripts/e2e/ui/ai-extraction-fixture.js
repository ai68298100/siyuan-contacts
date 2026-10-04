import { proxy } from "svelte/internal/client";
import { prepareAiExtraction, extractFromDoc } from "../../../src/services/ai-extract";
import { invalidateRoster } from "../../../src/services/roster";
import { FIELD_SPECS } from "../../../src/domain/fields";
import { emptyDraft } from "../../../src/domain/person";

export const aiFixtureSourceDocId = "20261004000000-source1";

export function configureAiKernel(kernel, settings) {
    invalidateRoster();
    const person = { ...emptyDraft(), name: "样例甲", docId: "20261004000000-person1", itemId: "row-person1", relatedItemIds: [] };
    const state = { source: "样例甲于2026-10-04在样例厅交流。", requests: [], captures: [],
        reply: JSON.stringify({ version: 2, people: [{ name: "样例甲", evidence: "样例甲" }], place: "样例厅", occasionEvidence: "样例甲于2026-10-04在样例厅交流。",
            profileCandidates: [{ person: "新人", field: "wechat", value: "fictional-new", evidence: "新人" }] }),
        delayed: null, timeoutMs: 1000, person, linked: [], preparedOriginal: null, confirmedPreflight: null, failureCode: "" };
    const preflightStore = proxy({ nested: { current: null } });
    kernel.handler = async (route, body) => {
        state.requests.push({ route, body });
        if (route === "/api/sqlite/flushTransaction") return null;
        if (route === "/api/export/exportMdContent") {
            if (body.id !== aiFixtureSourceDocId) throw new Error("拒绝读取其他文档");
            return { hPath: "/虚构来源", content: state.source };
        }
        if (route === "/api/ai/chatGPT") return state.delayed ?? state.reply;
        if (route === "/api/av/renderAttributeView") return { view: {
            columns: [{ id: "name", name: "姓名", type: "block" }, ...FIELD_SPECS.map((field) => ({ id: settings.fieldMap[field.key], name: field.nameZh, type: field.type }))],
            rows: [{ id: person.itemId, cells: [{ valueType: "block", value: { keyID: "name", type: "block", block: { id: person.docId, content: person.name } } }] }],
        } };
        throw new Error("AI 夹具拒绝额外读取或写入");
    };
    state.facade = {
        viewPreferences: { aiEnabled: true },
        previewCapture: async () => ({ docName: "虚构来源", sourceDocId: aiFixtureSourceDocId, sourceStatus: "available", linked: state.linked }),
        prepareAiExtraction: async (docId, options) => {
            const preflight = await prepareAiExtraction(settings, docId, options);
            state.preparedOriginal = preflight;
            preflightStore.nested.current = preflight;
            return preflightStore.nested.current;
        },
        aiExtractFromDoc: async (docId, confirmation) => {
            state.confirmedPreflight = confirmation.preflight;
            state.failureCode = "";
            try { return await extractFromDoc(settings, docId, { ...confirmation, timeoutMs: state.timeoutMs }); }
            catch (error) { state.failureCode = error.code ?? "request_failed"; throw error; }
        },
        listContacts: async () => [person],
        captureDoc: async (_docId, input) => {
            state.captures.push(input);
            return { complete: true, createdNames: [], createdDocIds: [], interactions: input.personDocIds.length,
                attendeeBlockWritten: false, occasionLinksWritten: 0, occasionLinkFailures: [],
                checkpoint: { requestId: "fixture-request", generation: 1, sourceDocId: aiFixtureSourceDocId, anchor: "fixture", input, people: [], projections: [] } };
        },
        openDoc: async () => {}, openPersonDoc: async () => {},
    };
    return state;
}
