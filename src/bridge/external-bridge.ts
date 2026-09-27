/**
 * 对外人员服务桥 v1（window.LvContacts）——D-0012：人脉插件作为"人员服务"提供方。
 * 其他插件（任务管理等）可：搜索人、查或建人（ensurePerson）、给一批人记共同交集
 * （recordInteraction，externalRef 幂等）。协议文档见 docs/BRIDGE.md。
 * 纪律：只提供服务，不读取/监听其他插件的私有存储。
 */
import type { Plugin } from "siyuan";
import { createContact, filterContacts, listContacts } from "../services/contacts";
import { recordInteractionWithResult } from "../data/interactions";
import { toLocalDateKey, defaultBridgeRef } from "../domain/interactions";
import { birthdayToMs, emptyDraft } from "../domain/person";
import type { ContactsSettings } from "../domain/model";

export { defaultBridgeRef };

export const BRIDGE_PROTOCOL = 1;

export interface BridgePerson {    docId: string;
    itemId: string;
    name: string;
    group: string;
    tags: string[];
}

export interface BridgeInteractionMeta {
    /** 场合身份（幂等键）。缺省 = `bridge:<日期>:<排序后的人员>`，同批重复调用不会重复记录 */
    ref?: string;
    /** 场合日期 YYYY-MM-DD，缺省今天 */
    date?: string;
    place?: string;
    note?: string;
}

export interface LvContactsBridgeApi {
    readonly protocol: number;
    readonly capabilities: readonly string[];
    searchPeople(keyword?: string): Promise<BridgePerson[]>;
    getPerson(docId: string): Promise<BridgePerson | null>;
    /** 按名查人，不存在则创建；返回 created 标记新建 */
    ensurePerson(name: string): Promise<BridgePerson & { created: boolean }>;
    /** 给一批人记录共同交集（幂等） */
    recordInteraction(
        personDocIds: readonly string[],
        meta?: BridgeInteractionMeta,
    ): Promise<{ recorded: number }>;
}

declare global {
    interface Window {
        LvContacts?: LvContactsBridgeApi;
    }
}

function toBridgePerson(person: {
    docId: string;
    itemId: string;
    name: string;
    group: string;
    tags: string[];
}): BridgePerson {
    return { docId: person.docId, itemId: person.itemId, name: person.name, group: person.group, tags: person.tags };
}

/** 初始化对外桥。settings 经 getter 延迟读取（向导完成后自动可用） */
export function initExternalBridge(plugin: Plugin, getSettings: () => ContactsSettings | null): void {
    const requireSettings = (): ContactsSettings => {
        const settings = getSettings();
        if (!settings) throw new Error("人脉工作空间尚未初始化（请先在小驴人脉中完成初始化）");
        return settings;
    };

    const api: LvContactsBridgeApi = {
        protocol: BRIDGE_PROTOCOL,
        capabilities: ["searchPeople", "getPerson", "ensurePerson", "recordInteraction"],

        async searchPeople(keyword = "") {
            const people = await listContacts(requireSettings());
            return filterContacts(people, keyword ?? "").map(toBridgePerson);
        },

        async getPerson(docId) {
            const people = await listContacts(requireSettings());
            const hit = people.find((person) => person.docId === docId);
            return hit ? toBridgePerson(hit) : null;
        },

        async ensurePerson(name) {
            const trimmed = (name ?? "").trim();
            if (!trimmed) throw new Error("姓名不能为空");
            const settings = requireSettings();
            const people = await listContacts(settings);
            const existing = people.find((person) => person.name === trimmed);
            if (existing) return { ...toBridgePerson(existing), created: false };
            const created = await createContact(settings, { ...emptyDraft(), name: trimmed });
            return { ...toBridgePerson(created), created: true };
        },

        async recordInteraction(personDocIds, meta = {}) {
            requireSettings();
            const occurredAt = meta.date === undefined ? Date.now() : birthdayToMs(meta.date);
            if (occurredAt === null) throw new Error("场合日期必须是有效的 YYYY-MM-DD 公历日期");
            const docIds = [...new Set([...personDocIds].filter((id) => typeof id === "string" && id))];
            if (docIds.length === 0) return { recorded: 0 };
            const externalRef = meta.ref?.trim() || defaultBridgeRef(docIds, toLocalDateKey(new Date(occurredAt)));
            const noteParts = [meta.place?.trim() ? `@${meta.place.trim()}` : "", meta.note?.trim() ?? ""].filter(
                (part) => part.length > 0,
            );
            let recorded = 0;
            for (const personDocId of docIds) {
                const result = await recordInteractionWithResult(plugin, {
                    personDocId,
                    source: "api",
                    externalRef,
                    occurredAt,
                    note: noteParts.length > 0 ? noteParts.join(" ") : undefined,
                });
                if (result.recorded) {
                    recorded += 1;
                }
            }
            return { recorded };
        },
    };

    window.LvContacts = api;
    console.info("[lvct] 人员服务桥已挂载：window.LvContacts protocol", BRIDGE_PROTOCOL);
}

export function disposeExternalBridge(): void {
    delete window.LvContacts;
}
