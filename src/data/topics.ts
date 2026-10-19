/**
 * E-32 会面谈资与备忘存储（插件自管 JSON）：Web Lock 临界区 + 写后回读。
 * 键：person-topics.json
 */

import type { Plugin } from "siyuan";
import { loadJson, loadJsonStrict, saveJsonVerified, withStoreLock } from "./storage.ts";
import {
    addTopicToStore,
    normalizeTopicStore,
    normalizeTopicStoreForWrite,
    removeTopicFromStore,
} from "../domain/topics.ts";
import type { PersonTopicItem, PersonTopicStore } from "../domain/topics.ts";

export const TOPICS_STORAGE_KEY = "person-topics.json";

/** 容错读取（展示使用） */
export async function loadTopicsStore(plugin: Plugin): Promise<PersonTopicStore> {
    return normalizeTopicStore(await loadJson(plugin, TOPICS_STORAGE_KEY));
}

/** 严格读取（写前检查与健康巡检使用） */
export async function loadTopicsStoreStrict(plugin: Plugin): Promise<PersonTopicStore> {
    return normalizeTopicStoreForWrite(await loadJsonStrict(plugin, TOPICS_STORAGE_KEY));
}

/** 读取指定人物的谈资备忘列表 */
export async function loadPersonTopics(plugin: Plugin, personDocId: string): Promise<PersonTopicItem[]> {
    const store = await loadTopicsStore(plugin);
    return store.topics[personDocId] ? [...store.topics[personDocId]] : [];
}

/** 为指定人物新增一条备忘话题并落盘 */
export async function addPersonTopic(
    plugin: Plugin,
    personDocId: string,
    text: string,
): Promise<PersonTopicItem[]> {
    return withStoreLock(TOPICS_STORAGE_KEY, async () => {
        const store = normalizeTopicStoreForWrite(await loadJsonStrict(plugin, TOPICS_STORAGE_KEY));
        const updated = addTopicToStore(store, personDocId, text);
        await saveJsonVerified(plugin, TOPICS_STORAGE_KEY, updated);
        return updated.topics[personDocId] ? [...updated.topics[personDocId]] : [];
    });
}

/** 移除指定人物的某条备忘话题并落盘 */
export async function removePersonTopic(
    plugin: Plugin,
    personDocId: string,
    topicId: string,
): Promise<PersonTopicItem[]> {
    return withStoreLock(TOPICS_STORAGE_KEY, async () => {
        const store = normalizeTopicStoreForWrite(await loadJsonStrict(plugin, TOPICS_STORAGE_KEY));
        const updated = removeTopicFromStore(store, personDocId, topicId);
        await saveJsonVerified(plugin, TOPICS_STORAGE_KEY, updated);
        return updated.topics[personDocId] ? [...updated.topics[personDocId]] : [];
    });
}
