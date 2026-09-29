/**
 * 联系人服务：新建（文档+绑行+写值）与列表查询。
 * 语义决策见 docs/DATA-CONTRACT.md §1.3 与 D-0007。
 */
import { createDocWithMd, listNotebooks } from "../api/client";
import { bindDocsAsRows, mapBoundDocIds, setCell, unbindRows } from "../api/av";
import { listNotebookDocs } from "../api/blocks";
import { getRoster, invalidateRoster } from "./roster";
import type { ContactsSettings } from "../domain/model";
import { birthdayToMs, validateDraft } from "../domain/person";
import type { ContactDraft, ContactSummary } from "../domain/person";
import type { FieldKey } from "../domain/fields";
import { resolveCandidateFields } from "../domain/contact-patch";
import type { CandidateFieldPatch } from "../domain/contact-patch";
import { matchesFolderPrefix } from "../domain/import";

const PRESET_GROUPS = ["家人", "朋友", "同事", "同学", "其他"] as const;

/** 分页大小（联系人列表客户端分页的块大小） */
export const PAGE_SIZE = 200;

/**
 * 全量名册（缓存优先，30s TTL，写操作立即失效）。
 * 搜索/筛选在名册上做客户端过滤——万级以内的字符串过滤远快于反复打内核。
 */
export function listContacts(settings: ContactsSettings): Promise<ContactSummary[]> {
    return getRoster(settings);
}

/** 客户端过滤：搜索词匹配姓名/电话/微信/邮箱/标签 */
export function filterContacts(people: readonly ContactSummary[], query: string, group: string = ""): ContactSummary[] {
    const keyword = query.trim().toLowerCase();
    return people.filter((person) => {
        if (group && person.group !== group) return false;
        if (!keyword) return true;
        return (
            person.name.toLowerCase().includes(keyword) ||
            person.phone.includes(keyword) ||
            person.wechat.toLowerCase().includes(keyword) ||
            person.email.toLowerCase().includes(keyword) ||
            person.tags.some((tag) => tag.toLowerCase().includes(keyword))
        );
    });
}

/**
 * 新建联系人：按姓名查重（renderAttributeView 精确名匹配），不存在才建文档绑行。
 * 注意 createDocWithMd 对同路径会再建新文档，防重必须走联系人查询而非文档 ID。
 */
/** FUNC-01.15：找上次建档尝试可能残留的「未绑定同名文档」——复用而非重建（重试不产生重复文档）。
 *  探测失败按无残留处理（不阻断正常建档）；已绑定的同名文档不在此列（查重已按名册拦截）。 */
async function findResumableDocId(settings: ContactsSettings, name: string): Promise<string> {
    try {
        const docs = await listNotebookDocs(settings.notebookId);
        const candidates = docs.filter((doc) => doc.content.trim() === name);
        for (const candidate of candidates) {
            const bound = (await mapBoundDocIds(settings.avId, [candidate.id]))[candidate.id];
            if (!bound) return candidate.id;
        }
    } catch {
        /* 残留探测失败：按无残留继续正常建档 */
    }
    return "";
}

export async function createContact(settings: ContactsSettings, draft: ContactDraft): Promise<ContactSummary> {
    const errors = validateDraft(draft);
    if (errors.length > 0) throw new Error(errors.join("；"));
    const name = draft.name.trim();

    const existing = await getRoster(settings);
    if (existing.some((item) => item.name === name)) {
        throw new Error(`联系人「${name}」已存在`);
    }

    /* FUNC-01.15 断点续做：有残留未绑定文档则复用（createDocWithMd 不再调用，不产生重复文档） */
    let docId = await findResumableDocId(settings, name);
    if (!docId) {
        docId = await createDocWithMd(settings.notebookId, `/${settings.notebookName}/${name}`, `# ${name}\n\n`);
        if (!docId) throw new Error(`创建人物文档「${name}」失败`);
    }

    /* 绑行幂等：已绑直接复用行 ID（上次尝试可能已完成绑定） */
    let itemId = (await mapBoundDocIds(settings.avId, [docId]))[docId];
    if (!itemId) {
        await bindDocsAsRows(settings.avId, settings.dbBlockId, [{ id: docId, content: name }]);
        itemId = (await mapBoundDocIds(settings.avId, [docId]))[docId];
    }
    if (!itemId) {
        throw new Error(`「${name}」绑定数据库失败（未获得行 ID）；人物文档 ${docId} 已保留，直接重试将复用该文档续做`);
    }

    /* 行已落库：先失效名册再写字段——字段失败后的重试会被「已存在」正确拦截（不重复建档） */
    invalidateRoster();

    /* 逐字段写入（隔离）：失败字段清单上浮为复合错误——已建文档/行保留，重试补写失败字段 */
    const failedFields = await writeDraftCells(settings, itemId, draft);
    if (failedFields.length > 0) {
        throw new Error(
            `「${name}」资料字段写入失败：${failedFields.join("、")}；人物文档与数据库行（${itemId}）已保留，该联系人已存在——请在编辑资料中补写失败字段（重试新建会被同名拦截，不产生重复文档）`,
        );
    }

    invalidateRoster();
    const summaries = await getRoster(settings);
    const created = summaries.find((item) => item.docId === docId);
    if (!created) throw new Error(`「${name}」已写入但回读失败，请刷新列表确认`);
    return created;
}

/** 草稿 → 单元格写入（不含查重/建行）。vCard 批量导入复用同一套写入语义。
 *  FUNC-01.15：逐字段隔离——单字段失败不阻断其余，返回失败字段清单（含原因）由调用方上浮；
 *  setCell 本身幂等，重试直接补写失败字段即可。 */
export async function writeDraftCells(settings: ContactsSettings, itemId: string, draft: ContactDraft): Promise<string[]> {
    const key = (field: FieldKey) => settings.fieldMap[field];
    const trimOrNull = (value: string) => {
        const trimmed = value.trim();
        return trimmed.length > 0 ? trimmed : null;
    };
    const failedFields: string[] = [];
    const run = async (label: string, task: Promise<unknown>): Promise<void> => {
        try {
            await task;
        } catch (error) {
            failedFields.push(`${label}（${error instanceof Error ? error.message : String(error)}）`);
        }
    };

    const writes: Promise<void>[] = [];
    const phone = trimOrNull(draft.phone);
    if (phone) writes.push(run("电话", setCell(settings.avId, key("phone"), itemId, { type: "phone", value: { phone: { content: phone } } })));

    const email = trimOrNull(draft.email);
    if (email) writes.push(run("邮箱", setCell(settings.avId, key("email"), itemId, { type: "email", value: { email: { content: email } } })));

    const wechat = trimOrNull(draft.wechat);
    if (wechat) writes.push(run("微信", setCell(settings.avId, key("wechat"), itemId, { type: "text", value: { text: { content: wechat } } })));

    const website = trimOrNull(draft.website);
    if (website) writes.push(run("网站", setCell(settings.avId, key("website"), itemId, { type: "url", value: { url: { content: website } } })));

    const birthdayMs = draft.birthday ? birthdayToMs(draft.birthday) : null;
    if (birthdayMs !== null) {
        writes.push(run("生日", setCell(settings.avId, key("birthday"), itemId, {
            type: "date",
            value: { date: { content: birthdayMs, isNotEmpty: true, isNotTime: true } },
        })));
    }
    if (draft.isLunar) {
        writes.push(run("农历标记", setCell(settings.avId, key("lunarBirthday"), itemId, { type: "checkbox", value: { checkbox: { checked: true } } })));
    }
    if (draft.group.trim()) {
        writes.push(run("分组", setCell(settings.avId, key("group"), itemId, {
            type: "select",
            value: { mSelect: [{ content: draft.group.trim(), color: "1" }] },
        })));
    }
    if (draft.tags.length > 0) {
        writes.push(run("标签", setCell(settings.avId, key("tags"), itemId, {
            type: "mSelect",
            value: { mSelect: draft.tags.filter((tag) => tag.trim()).map((tag, index) => ({ content: tag.trim(), color: String((index % 9) + 1) })) },
        })));
    }
    await Promise.all(writes);
    return failedFields;
}

export { PRESET_GROUPS };

/**
 * 编辑资料：全字段更新（含清空语义）。
 * 空字符串/空数组的写入即清空对应单元格——编辑弹窗依赖此语义。
 * CODE-02.4：写前与新建共用同一套预校验（validateDraft + 真实生日日期）——非法生日/邮箱
 * 在任何写入前拒绝（旧值不被清空）；字段写入逐项隔离，失败清单以复合错误上浮
 * （其余字段已更新，失败字段可直接重试保存补写）。
 */
export async function updateContactFields(settings: ContactsSettings, itemId: string, draft: ContactDraft): Promise<void> {
    const errors = validateDraft(draft);
    if (errors.length > 0) throw new Error(`资料校验失败，未做任何写入：${errors.join("；")}`);
    if (draft.birthday && birthdayToMs(draft.birthday) === null) {
        throw new Error(`资料校验失败，未做任何写入：生日不是真实存在的公历日期（${draft.birthday}）`);
    }

    const key = (field: FieldKey) => settings.fieldMap[field];
    const text = (value: string) => value.trim();
    const failedFields: string[] = [];
    const run = async (label: string, task: Promise<unknown>): Promise<void> => {
        try {
            await task;
        } catch (error) {
            failedFields.push(`${label}（${error instanceof Error ? error.message : String(error)}）`);
        }
    };

    const writes: Promise<void>[] = [
        run("电话", setCell(settings.avId, key("phone"), itemId, { type: "phone", value: { phone: { content: text(draft.phone) } } })),
        run("邮箱", setCell(settings.avId, key("email"), itemId, { type: "email", value: { email: { content: text(draft.email) } } })),
        run("微信", setCell(settings.avId, key("wechat"), itemId, { type: "text", value: { text: { content: text(draft.wechat) } } })),
        run("网站", setCell(settings.avId, key("website"), itemId, { type: "url", value: { url: { content: text(draft.website) } } })),
        run("农历标记", setCell(settings.avId, key("lunarBirthday"), itemId, { type: "checkbox", value: { checkbox: { checked: draft.isLunar } } })),
        run("分组", setCell(settings.avId, key("group"), itemId, {
            type: "select",
            value: { mSelect: draft.group.trim() ? [{ content: draft.group.trim(), color: "1" }] : [] },
        })),
        run("标签", setCell(settings.avId, key("tags"), itemId, {
            type: "mSelect",
            value: { mSelect: draft.tags.filter((tag) => tag.trim()).map((tag, index) => ({ content: tag.trim(), color: String((index % 9) + 1) })) },
        })),
    ];
    const birthdayMs = draft.birthday ? birthdayToMs(draft.birthday) : null;
    writes.push(run("生日", setCell(settings.avId, key("birthday"), itemId, {
        type: "date",
        value: { date: birthdayMs !== null ? { content: birthdayMs, isNotEmpty: true, isNotTime: true } : { content: 0, isNotEmpty: false } },
    })));
    await Promise.all(writes);
    if (failedFields.length > 0) {
        throw new Error(`字段写入失败：${failedFields.join("、")}；其余字段已更新，可直接重新保存补写失败字段`);
    }
    invalidateRoster();
}

export interface CandidateFieldApplyResult {
    applied: string[];
    skipped: string[];
    conflicts: string[];
}

/**
 * FUNC-01.14：AI 资料候选安全写。与 updateContactFields（编辑弹窗全字段语义）不同：
 * 只写补丁字段（其余字段零触碰，并发/他人字段不可能被回退）；写前失效名册回读**最新值**
 * 逐字段裁决（快照后字段被并发改动且与候选不同 → conflict 跳过并提示，不覆盖）；
 * 同一人多字段（电话+邮箱）各写各的互不影响。
 */
export async function applyContactCandidateFields(
    settings: ContactsSettings,
    itemId: string,
    patches: readonly CandidateFieldPatch[],
): Promise<CandidateFieldApplyResult> {
    invalidateRoster(); /* 候选依据的是 UI 快照——裁决必须基于最新名册 */
    const roster = await getRoster(settings);
    const person = roster.find((entry) => entry.itemId === itemId);
    if (!person) throw new Error("联系人不存在或已解绑，资料候选未写入");
    const outcomes = resolveCandidateFields(
        { phone: person.phone, wechat: person.wechat, email: person.email, website: person.website, birthday: person.birthday },
        patches,
    );
    const key = (field: string) => settings.fieldMap[field as FieldKey];
    for (const outcome of outcomes) {
        if (outcome.action !== "apply") continue;
        if (outcome.field === "birthday") {
            const birthdayMs = birthdayToMs(outcome.value);
            if (birthdayMs === null) throw new Error(`生日候选不是有效的 YYYY-MM-DD 公历日期：${outcome.value}`);
            await setCell(settings.avId, key("birthday"), itemId, {
                type: "date",
                value: { date: { content: birthdayMs, isNotEmpty: true, isNotTime: true } },
            });
        } else if (outcome.field === "phone") {
            await setCell(settings.avId, key("phone"), itemId, { type: "phone", value: { phone: { content: outcome.value } } });
        } else if (outcome.field === "email") {
            await setCell(settings.avId, key("email"), itemId, { type: "email", value: { email: { content: outcome.value } } });
        } else if (outcome.field === "wechat") {
            await setCell(settings.avId, key("wechat"), itemId, { type: "text", value: { text: { content: outcome.value } } });
        } else {
            await setCell(settings.avId, key("website"), itemId, { type: "url", value: { url: { content: outcome.value } } });
        }
    }
    if (outcomes.some((outcome) => outcome.action === "apply")) invalidateRoster();
    return {
        applied: outcomes.filter((outcome) => outcome.action === "apply").map((outcome) => outcome.field),
        skipped: outcomes.filter((outcome) => outcome.action === "skip").map((outcome) => outcome.field),
        conflicts: outcomes.filter((outcome) => outcome.action === "conflict").map((outcome) => outcome.field),
    };
}

/**
 * 从人脉名册移除联系人：只解绑数据库行，保留人物文档内容。
 * 文档仍可在思源中搜索，也可以之后重新收编；这是数据契约 §1.3 的删除语义。
 */
export async function removeContact(settings: ContactsSettings, person: Pick<ContactSummary, "itemId">): Promise<void> {
    await unbindRows(settings.avId, [person.itemId]);
    invalidateRoster();
}

/** 批量安全移除：只解绑数据库行，保留人物文档和插件互动审计记录。 */
export async function removeContacts(settings: ContactsSettings, itemIds: readonly string[]): Promise<number> {
    const ids = [...new Set(itemIds.map((itemId) => itemId.trim()).filter(Boolean))];
    if (ids.length === 0) return 0;
    const CHUNK = 200;
    for (let start = 0; start < ids.length; start += CHUNK) {
        await unbindRows(settings.avId, ids.slice(start, start + CHUNK));
    }
    invalidateRoster();
    return ids.length;
}

export interface ContactBatchUpdate {
    itemId: string;
    /** undefined = 不修改；空字符串 = 清空分组 */
    group?: string;
    /** undefined = 不修改；空数组 = 清空标签 */
    tags?: string[];
}

/** 批量更新联系人轻量字段；失败统一向 UI 抛错，内核不提供跨行原子事务。 */
export async function batchUpdateContacts(settings: ContactsSettings, updates: readonly ContactBatchUpdate[]): Promise<void> {
    const key = (field: FieldKey) => settings.fieldMap[field];
    const writes: Promise<unknown>[] = [];
    for (const update of updates) {
        if (update.group !== undefined) {
            writes.push(setCell(settings.avId, key("group"), update.itemId, {
                type: "select",
                value: { mSelect: update.group.trim() ? [{ content: update.group.trim(), color: "1" }] : [] },
            }));
        }
        if (update.tags !== undefined) {
            writes.push(setCell(settings.avId, key("tags"), update.itemId, {
                type: "mSelect",
                value: { mSelect: update.tags.filter((tag) => tag.trim()).map((tag, index) => ({ content: tag.trim(), color: String((index % 9) + 1) })) },
            }));
        }
    }
    await Promise.all(writes);
    invalidateRoster();
}

/* ---------- 存量文档收编（需求②：把已有"人名"文档批量转为联系人） ---------- */

export interface ImportCandidate {
    docId: string;
    name: string;
    hpath: string;
}

export interface AdoptOptions {
    /** 收编后统一写入的分组；空值表示不写入分组。 */
    group?: string;
    /** 收编后统一追加的标签；空数组表示不写入标签。 */
    tags?: readonly string[];
}

/** 可选笔记本（排除人脉笔记本自己） */
export async function listImportNotebooks(settings: ContactsSettings): Promise<{ id: string; name: string }[]> {
    const notebooks = await listNotebooks();
    return notebooks
        .filter((notebook) => notebook.id !== settings.notebookId)
        .map((notebook) => ({ id: notebook.id, name: notebook.name }));
}

/** 列出可收编候选：某笔记本下的文档，排除已绑定行、排除宿主文档与空名。 */
export async function discoverImportCandidates(
    settings: ContactsSettings,
    notebookId: string,
    keyword: string = "",
    folderPrefix: string = "",
): Promise<ImportCandidate[]> {
    const rows = await listNotebookDocs(notebookId);
    const excluded = new Set([settings.hostDocId]);
    const needle = keyword.trim().toLowerCase();
    const docIds = rows
        .map((row) => row.id)
        .filter((id) => !excluded.has(id) && id.length > 0);
    const boundMap = await mapBoundDocIds(settings.avId, docIds);
    return rows
        .filter((row) => !excluded.has(row.id) && row.content.trim().length > 0 && !boundMap[row.id])
        .filter((row) => matchesFolderPrefix(row.hpath, folderPrefix))
        .filter((row) => !needle || row.content.toLowerCase().includes(needle) || row.hpath.toLowerCase().includes(needle))
        .map((row) => ({ docId: row.id, name: row.content.trim(), hpath: row.hpath }));
}

/**
 * 批量收编：绑行为联系人（文档标题即主键显示名）。返回成功数。
 * 性能：先一次批量映射过滤已绑定，再按 200/批合并绑定——
 * 500 篇文档 = 1 次映射 + 3 次绑定，而不是 1500 次逐个调用。
 */
export async function adoptDocs(
    settings: ContactsSettings,
    candidates: readonly ImportCandidate[],
    options: AdoptOptions = {},
): Promise<number> {
    if (candidates.length === 0) return 0;
    const boundMap = await mapBoundDocIds(settings.avId, candidates.map((candidate) => candidate.docId));
    const unbound = candidates.filter((candidate) => !boundMap[candidate.docId]);
    const CHUNK = 200;
    for (let start = 0; start < unbound.length; start += CHUNK) {
        const chunk = unbound.slice(start, start + CHUNK);
        await bindDocsAsRows(
            settings.avId,
            settings.dbBlockId,
            chunk.map((candidate) => ({ id: candidate.docId, content: candidate.name })),
        );
    }
    const group = options.group?.trim() ?? "";
    const tags = [...new Set((options.tags ?? []).map((tag) => tag.trim()).filter(Boolean))];
    if (unbound.length > 0 && (group || tags.length > 0)) {
        // 绑定完成后再换算 itemID；一次映射覆盖整批，避免逐文档往返。
        const itemIds = await mapBoundDocIds(settings.avId, unbound.map((candidate) => candidate.docId));
        await batchUpdateContacts(
            settings,
            unbound
                .map((candidate) => itemIds[candidate.docId])
                .filter((itemId): itemId is string => Boolean(itemId))
                .map((itemId) => ({
                    itemId,
                    ...(group ? { group } : {}),
                    ...(tags.length > 0 ? { tags } : {}),
                })),
        );
    }
    invalidateRoster();
    return unbound.length;
}
