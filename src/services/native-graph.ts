/**
 * B14 原生图数据源服务：取内核图数据（局部图双向一度 / 全图），过滤到登记集合
 * （本人+联系人 docId 白名单，B14.3——组织文档不在此列：文档引用边与成员边语义
 * 不同源，混显违 B14.8 边来源标识纪律，随组织入口单独设计）。
 * 中心缺失（局部图模式且未指定本人档案）抛独立错误，供 UI 区分降级提示（B14.9）；
 * 读失败显式上抛，不归一为空图（读故障显式化纪律）。
 */
import { fetchGlobalGraph, fetchLocalGraph } from "../api/graph";
import { mapNativeGraph } from "../domain/native-graph";
import type { PersonGraph } from "../domain/graph";
import type { SelfIdentity } from "../domain/self-identity";
import type { ContactsSettings } from "../domain/model";
import { listContacts } from "./contacts";

export class NativeGraphCenterMissingError extends Error {
    constructor() {
        super("未指定本人档案，无法定位文档引用图中心");
        this.name = "NativeGraphCenterMissingError";
    }
}

export interface NativePersonGraphOptions {
    /** 中心文档 ID；缺省用本人档案（B14.4 人物入口默认一度） */
    centerDocId?: string;
    /** B14.8 按组织收窄：在登记集合内再取交集（中心节点始终保留） */
    restrictDocIds?: ReadonlySet<string>;
}

/** 收窄交集：保留中心（如有），其余节点必须同时命中收窄集合 */
function applyRestrict(allowedDocIds: Set<string>, restrictDocIds?: ReadonlySet<string>, keepId?: string): Set<string> {
    if (!restrictDocIds) return allowedDocIds;
    const restricted = new Set<string>();
    for (const id of allowedDocIds) {
        if ((keepId !== undefined && id === keepId) || restrictDocIds.has(id)) restricted.add(id);
    }
    return restricted;
}

/** 以指定（或本人）文档为中心的局部图，登记集合过滤（可按组织收窄） */
export async function loadNativePersonGraph(
    settings: ContactsSettings,
    identity: SelfIdentity | null,
    options?: NativePersonGraphOptions,
): Promise<PersonGraph> {
    /* B14.14：「指定人物中心」与「本人中心」是独立前置——显式传入有效 centerDocId 时
       不要求本人档案已建立（旧工作空间未建档/本人读取失败仍可看人物图）；
       仅当回落本人中心（未传 centerDocId）且本人缺失时才阻断。 */
    const explicitCenter = options?.centerDocId ?? "";
    const selfDocId = identity && identity.selfDocId !== "" ? identity.selfDocId : "";
    if (explicitCenter === "" && selfDocId === "") throw new NativeGraphCenterMissingError();
    const centerDocId = explicitCenter !== "" ? explicitCenter : selfDocId;
    const roster = await listContacts(settings);
    const baseDocIds = new Set<string>(roster.map((person) => person.docId));
    if (selfDocId !== "") baseDocIds.add(selfDocId);
    if (!baseDocIds.has(centerDocId)) throw new NativeGraphCenterMissingError();
    const allowedDocIds = applyRestrict(baseDocIds, options?.restrictDocIds, centerDocId);
    const docGroups = new Map(roster.map((person) => [person.docId, person.group] as const));
    const native = await fetchLocalGraph(centerDocId);
    return mapNativeGraph(native, { allowedDocIds, docGroups });
}

/**
 * 全部登记文档之间的引用图（B14.8「按范围查看」入口）：getGraph 全图 + 登记集合过滤。
 * 全图无中心概念——本人档案缺失不抛错（白名单只少本人节点）；
 * 载荷是整库图，15s 内核超时兜底，UI 侧必须保留「不是整库图」的范围说明（B14.9）。
 */
export async function loadNativeRegisteredGraph(
    settings: ContactsSettings,
    identity: SelfIdentity | null,
    restrictDocIds?: ReadonlySet<string>,
): Promise<PersonGraph> {
    const roster = await listContacts(settings);
    const allowedDocIds = applyRestrict(new Set<string>(roster.map((person) => person.docId)), restrictDocIds);
    const docGroups = new Map(roster.map((person) => [person.docId, person.group] as const));
    if (identity && identity.selfDocId !== "" && (!restrictDocIds || restrictDocIds.has(identity.selfDocId))) {
        allowedDocIds.add(identity.selfDocId);
    }
    const native = await fetchGlobalGraph();
    return mapNativeGraph(native, { allowedDocIds, docGroups });
}
