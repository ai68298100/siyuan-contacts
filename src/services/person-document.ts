import { createDocWithMd, KernelResponseError, KernelPermissionError, newNodeId } from "../api/client";
import { CONTACT_DRAFT_ATTR, findCreationRequestDoc, VCARD_REQUEST_ATTR } from "../api/blocks";
import { buildContactWritePlan } from "../domain/contact-write.ts";
import { documentHPath, markdownHeading } from "../domain/format";
import type { ContactsSettings } from "../domain/model";
import type { ContactDraft } from "../domain/person";
import type { VcfDocumentCheckpoint } from "../domain/vcard.ts";

export class PersonCreationUnknownError extends Error {
    constructor(message: string, options?: ErrorOptions) {
        super(message, options);
        this.name = "PersonCreationUnknownError";
    }
}

export interface PersonDocumentRequest {
    draft: ContactDraft;
    checkpoint?: VcfDocumentCheckpoint;
}

export async function ensurePersonRequestDocument(
    settings: ContactsSettings,
    plan: PersonDocumentRequest,
    attrName: typeof VCARD_REQUEST_ATTR | typeof CONTACT_DRAFT_ATTR,
): Promise<string> {
    const name = plan.draft.name.trim();
    const path = documentHPath(settings.notebookName, name);
    const draftKey = JSON.stringify(buildContactWritePlan(plan.draft, "create").writes);
    const previous = plan.checkpoint;
    if (previous && (previous.notebookId !== settings.notebookId || previous.avId !== settings.avId || previous.dbBlockId !== settings.dbBlockId
        || previous.name !== name || previous.path !== path || previous.draftKey !== draftKey
        || !["new", "unknown", "rejected", "verified"].includes(previous.state)
        || !/^\d{14}-[0-9a-z]{7}$/.test(previous.requestId)
        || previous.docId !== undefined && !/^\d{14}-[0-9a-z]{7}$/.test(previous.docId))) {
        throw new PersonCreationUnknownError("建档目标或输入与原请求不同，未复用旧断点或创建新人物");
    }
    const checkpoint: VcfDocumentCheckpoint = previous ? { ...previous } : {
        requestId: newNodeId(), notebookId: settings.notebookId, avId: settings.avId, dbBlockId: settings.dbBlockId,
        name, path, draftKey, state: "new",
    };
    plan.checkpoint = checkpoint;
    const lookup = async () => {
        const verified = await findCreationRequestDoc(settings.notebookId, checkpoint.requestId, attrName);
        if (verified && checkpoint.docId && checkpoint.docId !== verified.docId) {
            throw new PersonCreationUnknownError("请求文档与原断点不一致，未按同名改绑");
        }
        if (verified) {
            checkpoint.docId = verified.docId;
            checkpoint.state = "verified";
        }
        return verified?.docId;
    };
    if (checkpoint.state !== "new") {
        let docId;
        try { docId = await lookup(); }
        catch (cause) { throw new PersonCreationUnknownError("原请求文档读取失败，结果未知；未再次创建", { cause }); }
        if (docId) return docId;
        if (checkpoint.state !== "rejected") throw new PersonCreationUnknownError("上次建档结果尚未核实，未找到原请求文档；未再次创建");
    }
    checkpoint.state = "unknown";
    let creationError: unknown;
    try {
        const docId = await createDocWithMd(settings.notebookId, path, `${markdownHeading(name).trimEnd()}\n{: ${attrName}="${checkpoint.requestId}"}\n\n`);
        if (/^\d{14}-[0-9a-z]{7}$/.test(docId)) checkpoint.docId = docId;
        else creationError = new Error("建档未返回合法文档 ID");
    } catch (error) { creationError = error; }
    try {
        const docId = await lookup();
        if (docId) return docId;
    } catch (cause) { throw new PersonCreationUnknownError("建档请求已发出，但请求文档回读失败，结果未知；未再次创建", { cause }); }
    if (creationError instanceof KernelResponseError || creationError instanceof KernelPermissionError) {
        checkpoint.state = "rejected";
        throw creationError;
    }
    throw new PersonCreationUnknownError("建档请求已发出，但请求文档尚未核实，结果未知；未再次创建", { cause: creationError });
}
