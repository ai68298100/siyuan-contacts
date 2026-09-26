/**
 * 联系人服务：新建（文档+绑行+写值）与列表查询。
 * 语义决策见 docs/DATA-CONTRACT.md §1.3 与 D-0007。
 */
import { createDocWithMd, listNotebooks, querySql } from "../api/client";
import type { DocRow } from "../api/client";
import { bindDocsAsRows, mapBoundDocIds, renderView, setCell } from "../api/av";
import type { ContactsSettings } from "../domain/model";
import {
    birthdayToMs,
    invertFieldMap,
    summaryFromRow,
    validateDraft,
} from "../domain/person";
import type { ContactDraft, ContactSummary } from "../domain/person";
import type { FieldKey } from "../domain/fields";

const PRESET_GROUPS = ["家人", "朋友", "同事", "同学", "其他"] as const;

export async function listContacts(settings: ContactsSettings, query: string = ""): Promise<ContactSummary[]> {
    const rendered = await renderView(settings.avId, settings.dbBlockId, query);
    const keyToField = invertFieldMap(settings.fieldMap);
    return (rendered.view?.rows ?? []).map((row) => summaryFromRow(row, keyToField));
}

/**
 * 新建联系人：按姓名查重（renderAttributeView 精确名匹配），不存在才建文档绑行。
 * 注意 createDocWithMd 对同路径会再建新文档，防重必须走联系人查询而非文档 ID。
 */
export async function createContact(settings: ContactsSettings, draft: ContactDraft): Promise<ContactSummary> {
    const errors = validateDraft(draft);
    if (errors.length > 0) throw new Error(errors.join("；"));
    const name = draft.name.trim();

    const existing = await listContacts(settings, name);
    if (existing.some((item) => item.name === name)) {
        throw new Error(`联系人「${name}」已存在`);
    }

    const docId = await createDocWithMd(settings.notebookId, `/${settings.notebookName}/${name}`, `# ${name}\n\n`);
    if (!docId) throw new Error(`创建人物文档「${name}」失败`);

    const bound = await mapBoundDocIds(settings.avId, [docId]);
    if (!bound[docId]) {
        // 未绑定（全新或同名未收编文档）→ 绑行为联系人
        await bindDocsAsRows(settings.avId, settings.dbBlockId, [{ id: docId, content: name }]);
    }
    const itemId = (await mapBoundDocIds(settings.avId, [docId]))[docId];
    if (!itemId) throw new Error(`「${name}」绑定数据库失败（未获得行 ID）`);

    await writeDraftCells(settings, itemId, draft);
    const summaries = await listContacts(settings, name);
    const created = summaries.find((item) => item.docId === docId);
    if (!created) throw new Error(`「${name}」已写入但回读失败，请刷新列表确认`);
    return created;
}

async function writeDraftCells(settings: ContactsSettings, itemId: string, draft: ContactDraft): Promise<void> {
    const key = (field: FieldKey) => settings.fieldMap[field];
    const trimOrNull = (value: string) => {
        const trimmed = value.trim();
        return trimmed.length > 0 ? trimmed : null;
    };

    const writes: Promise<unknown>[] = [];
    const phone = trimOrNull(draft.phone);
    if (phone) writes.push(setCell(settings.avId, key("phone"), itemId, { type: "phone", value: { phone: { content: phone } } }));

    const email = trimOrNull(draft.email);
    if (email) writes.push(setCell(settings.avId, key("email"), itemId, { type: "email", value: { email: { content: email } } }));

    const wechat = trimOrNull(draft.wechat);
    if (wechat) writes.push(setCell(settings.avId, key("wechat"), itemId, { type: "text", value: { text: { content: wechat } } }));

    const website = trimOrNull(draft.website);
    if (website) writes.push(setCell(settings.avId, key("website"), itemId, { type: "url", value: { url: { content: website } } }));

    const birthdayMs = draft.birthday ? birthdayToMs(draft.birthday) : null;
    if (birthdayMs !== null) {
        writes.push(setCell(settings.avId, key("birthday"), itemId, {
            type: "date",
            value: { date: { content: birthdayMs, isNotEmpty: true, isNotTime: true } },
        }));
    }
    if (draft.isLunar) {
        writes.push(setCell(settings.avId, key("lunarBirthday"), itemId, { type: "checkbox", value: { checkbox: { checked: true } } }));
    }
    if (draft.group.trim()) {
        writes.push(setCell(settings.avId, key("group"), itemId, {
            type: "select",
            value: { mSelect: [{ content: draft.group.trim(), color: "1" }] },
        }));
    }
    if (draft.tags.length > 0) {
        writes.push(setCell(settings.avId, key("tags"), itemId, {
            type: "mSelect",
            value: { mSelect: draft.tags.filter((tag) => tag.trim()).map((tag, index) => ({ content: tag.trim(), color: String((index % 9) + 1) })) },
        }));
    }
    await Promise.all(writes);
}

export { PRESET_GROUPS };

/* ---------- 存量文档收编（需求②：把已有"人名"文档批量转为联系人） ---------- */

export interface ImportCandidate {
    docId: string;
    name: string;
    hpath: string;
}

/** 可选笔记本（排除人脉笔记本自己） */
export async function listImportNotebooks(settings: ContactsSettings): Promise<{ id: string; name: string }[]> {
    const notebooks = await listNotebooks();
    return notebooks
        .filter((notebook) => notebook.id !== settings.notebookId)
        .map((notebook) => ({ id: notebook.id, name: notebook.name }));
}

/** 列出可收编候选：某笔记本下的文档，排除已绑定行、排除宿主文档与空名 */
export async function discoverImportCandidates(settings: ContactsSettings, notebookId: string, keyword: string = ""): Promise<ImportCandidate[]> {
    const keywordClause = keyword.trim() ? ` AND content LIKE '%${keyword.trim().replace(/'/g, "''")}%'` : "";
    const rows = await querySql<DocRow>(
        `SELECT id, content, hpath FROM blocks WHERE type='d' AND box='${notebookId}'${keywordClause} LIMIT 500`,
    );
    const excluded = new Set([settings.hostDocId]);
    const docIds = rows
        .map((row) => row.id)
        .filter((id) => !excluded.has(id) && id.length > 0);
    const boundMap = await mapBoundDocIds(settings.avId, docIds);
    return rows
        .filter((row) => !excluded.has(row.id) && row.content.trim().length > 0 && !boundMap[row.id])
        .map((row) => ({ docId: row.id, name: row.content.trim(), hpath: row.hpath }));
}

/** 批量收编：绑行为联系人（文档标题即主键显示名）。返回成功数 */
export async function adoptDocs(settings: ContactsSettings, candidates: readonly ImportCandidate[]): Promise<number> {
    let adopted = 0;
    for (const candidate of candidates) {
        const bound = await mapBoundDocIds(settings.avId, [candidate.docId]);
        if (bound[candidate.docId]) continue; // 并发下已被绑定，跳过
        await bindDocsAsRows(settings.avId, settings.dbBlockId, [{ id: candidate.docId, content: candidate.name }]);
        adopted += 1;
    }
    return adopted;
}
