import type { Plugin } from "siyuan";
import { assertContactWriteReady, listContacts } from "./contacts";
import { changeSelfIdentityVerified, loadSelfIdentity, saveSelfIdentity } from "../data/self-identity";
import { loadJsonStrict, saveJsonVerified, withStoreLock } from "../data/storage";
import type { SelfIdentity, SelfIdentityChangePreview, SelfProfileCheckpoint } from "../domain/self-identity";
import { excludeSelf, isSelfDoc, parseSelfIdentity, parseSelfProfileCheckpoint } from "../domain/self-identity";
import { toLocalDateKey } from "../domain/interactions";
import { invalidateRoster } from "./roster";
import type { ContactsSettings } from "../domain/model";
import { documentHPath, markdownHeading } from "../domain/format";
import { createDocWithMd, KernelResponseError, KernelPermissionError, newNodeId } from "../api/client";
import { documentExists, findCreationRequestDoc, flushBlockIndex, listNotebookDocs, NOTEBOOK_DOC_PAGE_SIZE, SELF_DRAFT_ATTR } from "../api/blocks";
import { bindDocsAsRows, mapBoundDocIds } from "../api/av";

export const SELF_PERSON_NAME = "我自己";
export const SELF_PROFILE_CHECKPOINT_KEY = "self-profile-checkpoint.json";
export const SELF_PROFILE_LOCK_KEY = "self-profile-init";

async function findUnboundSelfDocument(settings: ContactsSettings): Promise<string | null> {
    await flushBlockIndex();
    const candidates: string[] = [];
    let afterDocId: string | undefined;
    for (;;) {
        const docs = await listNotebookDocs(settings.notebookId, NOTEBOOK_DOC_PAGE_SIZE, 0, afterDocId);
        candidates.push(...docs.filter((doc) => doc.content.trim() === SELF_PERSON_NAME).map((doc) => doc.id));
        if (docs.length < NOTEBOOK_DOC_PAGE_SIZE) break;
        afterDocId = docs.at(-1)!.id;
    }
    const mapping = candidates.length ? await mapBoundDocIds(settings.avId, candidates) : {};
    const unbound = candidates.filter((docId) => !mapping[docId]);
    if (unbound.length > 1) throw new Error("发现多个未绑定的本人候选，未自动选择或新建；请在设置中收编并指定具体联系人");
    return unbound[0] ?? null;
}

async function ensureSelfDocument(plugin: Plugin, settings: ContactsSettings): Promise<SelfProfileCheckpoint> {
    let checkpoint = parseSelfProfileCheckpoint(await loadJsonStrict(plugin, SELF_PROFILE_CHECKPOINT_KEY));
    if (checkpoint && (checkpoint.notebookId !== settings.notebookId || checkpoint.avId !== settings.avId || checkpoint.dbBlockId !== settings.dbBlockId)) {
        throw new Error("本人建档目标与原断点不同，未创建第二份档案；请先核对原工作空间");
    }
    if (checkpoint) {
        if (checkpoint.docId) {
            if (!await documentExists(checkpoint.docId)) throw new Error("原本人请求文档不可达，未再次创建；请恢复原文档后重试");
            if (checkpoint.source === "created") {
                const original = await findCreationRequestDoc(settings.notebookId, checkpoint.requestId, SELF_DRAFT_ATTR);
                if (original?.docId !== checkpoint.docId) throw new Error("本人请求标记与原文档不一致，未再次创建或自动改绑");
            }
            return checkpoint;
        }
        const original = await findCreationRequestDoc(settings.notebookId, checkpoint.requestId, SELF_DRAFT_ATTR);
        if (original) {
            checkpoint = { ...checkpoint, state: "verified", docId: original.docId };
            await saveJsonVerified(plugin, SELF_PROFILE_CHECKPOINT_KEY, checkpoint);
            return checkpoint;
        }
        if (checkpoint.state !== "rejected") throw new Error("上次本人建档结果仍未知，未找到原请求文档；未再次创建，请核实后重试");
    } else {
        const docId = await findUnboundSelfDocument(settings);
        checkpoint = {
            schemaVersion: 1, notebookId: settings.notebookId, avId: settings.avId, dbBlockId: settings.dbBlockId,
            requestId: newNodeId(), source: docId ? "reused" : "created", state: docId ? "verified" : "unknown", ...(docId ? { docId } : {}),
        };
        await saveJsonVerified(plugin, SELF_PROFILE_CHECKPOINT_KEY, checkpoint);
        if (docId) return checkpoint;
    }
    checkpoint = { ...checkpoint, state: "unknown" };
    await saveJsonVerified(plugin, SELF_PROFILE_CHECKPOINT_KEY, checkpoint);
    let creationError: unknown;
    try {
        await createDocWithMd(settings.notebookId, documentHPath(settings.notebookName, SELF_PERSON_NAME),
            `${markdownHeading(SELF_PERSON_NAME).trimEnd()}\n{: ${SELF_DRAFT_ATTR}="${checkpoint.requestId}"}\n\n`);
    } catch (cause) {
        creationError = cause;
    }
    const original = await findCreationRequestDoc(settings.notebookId, checkpoint.requestId, SELF_DRAFT_ATTR);
    if (!original) {
        if (creationError instanceof KernelResponseError || creationError instanceof KernelPermissionError) {
            await saveJsonVerified(plugin, SELF_PROFILE_CHECKPOINT_KEY, { ...checkpoint, state: "rejected" });
            throw creationError;
        }
        throw new Error("本人建档请求已发出，但原请求文档尚未核实；结果未知，未再次创建", { cause: creationError });
    }
    checkpoint = { ...checkpoint, state: "verified", docId: original.docId };
    await saveJsonVerified(plugin, SELF_PROFILE_CHECKPOINT_KEY, checkpoint);
    return checkpoint;
}

export async function ensureSelfIdentity(plugin: Plugin, settings: ContactsSettings): Promise<SelfIdentity> {
    return withStoreLock(SELF_PROFILE_LOCK_KEY, async () => {
        const existing = await loadSelfIdentity(plugin);
        invalidateRoster();
        const roster = await listContacts(settings);
        if (existing) {
            const matches = roster.filter((person) => isSelfDoc(existing, person.docId));
            if (matches.length !== 1 || matches[0].itemId !== existing.selfItemId) {
                throw new Error("本人身份与当前名册绑定不一致，未重建或改绑；请先核对原文档和数据库，再在设置中显式修复");
            }
            if (!await documentExists(existing.selfDocId)) throw new Error("本人原文档不可达，身份未改动；请恢复原文档或显式修复");
            return existing;
        }
        const checkpoint = parseSelfProfileCheckpoint(await loadJsonStrict(plugin, SELF_PROFILE_CHECKPOINT_KEY));
        if (!checkpoint) {
            const candidates = roster.filter((person) => person.name === SELF_PERSON_NAME);
            if (candidates.length > 1) throw new Error("发现多个同名本人候选，未自动选择；请在设置中指定具体联系人");
            if (candidates.length === 1) {
                const person = candidates[0];
                if (!await documentExists(person.docId)) throw new Error("同名候选文档不可达，未认定本人");
                const result = await saveSelfIdentity(plugin, { selfDocId: person.docId, selfItemId: person.itemId });
                invalidateRoster();
                return result;
            }
        }
        await assertContactWriteReady(settings);
        const current = await ensureSelfDocument(plugin, settings);
        const docId = current.docId!;
        let itemId = (await mapBoundDocIds(settings.avId, [docId]))[docId];
        if (current.itemId && current.itemId !== itemId) throw new Error("原本人文档的绑定行已变化，未按新行自动认定；请显式修复");
        if (!itemId) {
            let bindingError: unknown;
            try { await bindDocsAsRows(settings.avId, settings.dbBlockId, [{ id: docId, content: SELF_PERSON_NAME }]); }
            catch (cause) { bindingError = cause; }
            itemId = (await mapBoundDocIds(settings.avId, [docId]))[docId];
            if (!itemId) throw new Error("本人文档已保留，但绑定结果尚未核实；可在设置中继续，不重复建档", { cause: bindingError });
        }
        await saveJsonVerified(plugin, SELF_PROFILE_CHECKPOINT_KEY, { ...current, itemId });
        invalidateRoster();
        const matches = (await listContacts(settings)).filter((person) => person.docId === docId && person.itemId === itemId);
        if (matches.length !== 1 || !await documentExists(docId)) throw new Error("本人文档/数据库行回读尚未核实，身份未写入；请核对后继续");
        const identity = await saveSelfIdentity(plugin, { selfDocId: docId, selfItemId: itemId });
        invalidateRoster();
        return identity;
    });
}

export async function designateSelfIdentity(plugin: Plugin, settings: ContactsSettings, personItemId: string): Promise<SelfIdentity> {
    const preview = await previewSelfIdentityChange(plugin, settings, personItemId);
    const identity = await applySelfIdentityChange(plugin, settings, preview);
    if (!identity) throw new Error("本人身份未指定");
    return identity;
}

function selfAnchorKey(settings: ContactsSettings): string {
    return JSON.stringify([settings.notebookId, settings.avId, settings.dbBlockId]);
}

export async function previewSelfIdentityChange(plugin: Plugin, settings: ContactsSettings, targetItemId: string | null): Promise<SelfIdentityChangePreview> {
    const previous = await loadSelfIdentity(plugin);
    invalidateRoster();
    const roster = await listContacts(settings);
    const matches = targetItemId === null ? [] : roster.filter((entry) => entry.itemId === targetItemId);
    if (targetItemId !== null && matches.length !== 1) throw new Error("目标联系人不存在或已解绑，或目标不唯一；身份未改动");
    const person = matches[0];
    if (person && (roster.filter((entry) => entry.docId === person.docId).length !== 1
        || !await documentExists(person.docId) || (await mapBoundDocIds(settings.avId, [person.docId]))[person.docId] !== person.itemId)) {
        throw new Error("目标人物文档或绑定行尚未核实，未生成修复计划");
    }
    return {
        schemaVersion: 1, anchorKey: selfAnchorKey(settings), previous,
        target: person ? { docId: person.docId, itemId: person.itemId, name: person.name } : null,
        previousName: roster.find((entry) => entry.docId === previous?.selfDocId)?.name ?? previous?.selfDocId ?? "未指定",
        ordinaryBefore: excludeSelf(roster, previous).length,
        ordinaryAfter: roster.filter((entry) => entry.docId !== person?.docId).length,
        createdAt: previous?.createdAt ?? toLocalDateKey(new Date()),
    };
}

export async function applySelfIdentityChange(plugin: Plugin, settings: ContactsSettings, preview: SelfIdentityChangePreview): Promise<SelfIdentity | null> {
    if (preview.schemaVersion !== 1 || preview.anchorKey !== selfAnchorKey(settings)) throw new Error("修复目标工作空间已变化，请重新预览");
    const previous = parseSelfIdentity(preview.previous);
    const next = preview.target ? parseSelfIdentity({
        schemaVersion: 1, selfDocId: preview.target.docId, selfItemId: preview.target.itemId,
        createdAt: preview.createdAt,
    }) : null;
    return withStoreLock(SELF_PROFILE_LOCK_KEY, async () => {
        const current = await loadSelfIdentity(plugin);
        if (JSON.stringify(current) !== JSON.stringify(previous) && JSON.stringify(current) !== JSON.stringify(next)) {
            throw new Error("本人身份已在预览后变化，未覆盖；请重新预览");
        }
        invalidateRoster();
        const roster = await listContacts(settings);
        if (next) {
            const matches = roster.filter((entry) => entry.docId === next.selfDocId);
            if (matches.length !== 1 || matches[0].itemId !== next.selfItemId
                || !await documentExists(next.selfDocId)
                || (await mapBoundDocIds(settings.avId, [next.selfDocId]))[next.selfDocId] !== next.selfItemId) {
                throw new Error("预览目标文档或绑定行已变化，身份未改动；请重新预览");
            }
        }
        await withStoreLock(SELF_PROFILE_CHECKPOINT_KEY, async () => {
            const checkpoint = await loadJsonStrict(plugin, SELF_PROFILE_CHECKPOINT_KEY);
            if (checkpoint !== null && checkpoint !== "") await saveJsonVerified(plugin, SELF_PROFILE_CHECKPOINT_KEY, null);
        });
        const identity = await changeSelfIdentityVerified(plugin, previous, next);
        invalidateRoster();
        return identity;
    });
}
