/**
 * B14 原生图数据源服务：以本人档案为中心取内核局部图（双向一度），过滤到登记集合。
 * 中心缺失（未指定本人档案）抛独立错误，供 UI 区分降级提示（B14.9）；
 * 读失败显式上抛，不归一为空图（读故障显式化纪律）。
 */
import { fetchLocalGraph } from "../api/graph";
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

export async function loadNativePersonGraph(settings: ContactsSettings, identity: SelfIdentity | null): Promise<PersonGraph> {
    if (!identity || identity.selfDocId === "") throw new NativeGraphCenterMissingError();
    const roster = await listContacts(settings);
    const allowedDocIds = new Set<string>([identity.selfDocId, ...roster.map((person) => person.docId)]);
    const docGroups = new Map(roster.map((person) => [person.docId, person.group] as const));
    const native = await fetchLocalGraph(identity.selfDocId);
    return mapNativeGraph(native, { allowedDocIds, docGroups });
}
