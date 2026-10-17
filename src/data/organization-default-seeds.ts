import type { Plugin } from "siyuan";
import { loadJsonStrict, saveJsonVerified } from "./storage.ts";

export const ORGANIZATION_DEFAULT_SEEDS_STORAGE_KEY = "organization-default-seeds.json";
export interface DefaultOrganizationSeed {
    state: "claimed" | "created" | "unknown" | "failed" | "skipped";
    docId: string;
    requestId: string;
    updatedAt: number;
}
export interface DefaultOrganizationSeeds {
    schemaVersion: 1;
    seeds: Record<string, DefaultOrganizationSeed>;
}
const ID = /^\d{14}-[a-z0-9]{7}$/;

/** 严格读取：未知领取记录不能当作缺失后再次自动创建。 */
export async function loadDefaultOrganizationSeeds(plugin: Plugin): Promise<DefaultOrganizationSeeds> {
    const raw = await loadJsonStrict(plugin, ORGANIZATION_DEFAULT_SEEDS_STORAGE_KEY);
    if (raw === null || raw === "") return { schemaVersion: 1, seeds: {} };
    const invalid = () => new Error("默认组织初始化记录损坏或版本不兼容，未自动创建组织");
    if (typeof raw !== "object" || Array.isArray(raw)) throw invalid();
    const value = raw as Record<string, unknown>;
    if (value.schemaVersion !== 1 || !value.seeds || typeof value.seeds !== "object" || Array.isArray(value.seeds)) throw invalid();
    const seeds: Record<string, DefaultOrganizationSeed> = {};
    for (const [notebookId, entry] of Object.entries(value.seeds)) {
        if (!ID.test(notebookId) || !entry || typeof entry !== "object" || Array.isArray(entry)) throw invalid();
        const seed = entry as DefaultOrganizationSeed;
        if (!["claimed", "created", "unknown", "failed", "skipped"].includes(seed.state)
            || typeof seed.docId !== "string" || seed.docId !== "" && !ID.test(seed.docId)
            || typeof seed.requestId !== "string" || seed.requestId !== "" && !ID.test(seed.requestId)
            || seed.state === "created" && !ID.test(seed.docId)
            || !Number.isSafeInteger(seed.updatedAt) || seed.updatedAt < 0) throw invalid();
        seeds[notebookId] = { state: seed.state, docId: seed.docId, requestId: seed.requestId, updatedAt: seed.updatedAt };
    }
    return { schemaVersion: 1, seeds };
}

/** 调用方持 organization-default-seeds.json 锁，避免同工作空间并发领取。 */
export async function saveDefaultOrganizationSeeds(plugin: Plugin, store: DefaultOrganizationSeeds): Promise<void> {
    await saveJsonVerified(plugin, ORGANIZATION_DEFAULT_SEEDS_STORAGE_KEY, store);
}
