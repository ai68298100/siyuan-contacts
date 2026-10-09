import type { Plugin } from "siyuan";
import { loadJsonStrict, saveJsonVerified, withStoreLock } from "./storage.ts";
import {
    normalizeOrganizationProfileDraft,
    validateOrganizationProfile,
    type OrganizationProfileDraft,
} from "../domain/organization-profile.ts";

export const ORGANIZATION_PROFILES_STORAGE_KEY = "organization-profiles.json";
const DOC_ID = /^\d{14}-[0-9a-z]{7}$/;

type ProfileStore = { schemaVersion: 1; profiles: Record<string, OrganizationProfileDraft> };

function decodeStore(raw: unknown): ProfileStore {
    if (raw === null || raw === "") return { schemaVersion: 1, profiles: {} };
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new Error("组织资料存储格式不正确，操作已停止");
    const record = raw as Record<string, unknown>;
    if (record.schemaVersion !== 1 || typeof record.profiles !== "object" || record.profiles === null || Array.isArray(record.profiles)) {
        throw new Error("组织资料存储版本或结构不兼容，操作已停止");
    }
    const profiles: Record<string, OrganizationProfileDraft> = {};
    for (const [docId, value] of Object.entries(record.profiles as Record<string, unknown>)) {
        if (!DOC_ID.test(docId)) throw new Error(`组织资料包含非法文档 ID：${docId}`);
        const validation = validateOrganizationProfile(value as OrganizationProfileDraft);
        if (!validation.valid) throw new Error(`组织资料损坏（${docId}）：${validation.errors.join("、")}`);
        profiles[docId] = normalizeOrganizationProfileDraft(value as OrganizationProfileDraft);
    }
    return { schemaVersion: 1, profiles };
}

export async function loadOrganizationProfiles(plugin: Plugin): Promise<Record<string, OrganizationProfileDraft>> {
    return decodeStore(await loadJsonStrict(plugin, ORGANIZATION_PROFILES_STORAGE_KEY)).profiles;
}

export async function loadOrganizationProfile(plugin: Plugin, docId: string): Promise<OrganizationProfileDraft | null> {
    if (!DOC_ID.test(docId)) throw new Error("组织文档 ID 无效");
    const profiles = await loadOrganizationProfiles(plugin);
    return profiles[docId] ? { ...profiles[docId], departments: profiles[docId].departments.map((item) => ({ ...item })), customFields: profiles[docId].customFields.map((item) => ({ ...item })) } : null;
}

export async function saveOrganizationProfile(plugin: Plugin, docId: string, draft: OrganizationProfileDraft): Promise<OrganizationProfileDraft> {
    if (!DOC_ID.test(docId)) throw new Error("组织文档 ID 无效");
    const validation = validateOrganizationProfile(draft);
    if (!validation.valid) throw new Error(validation.errors.join("、"));
    const normalized = normalizeOrganizationProfileDraft(draft);
    await withStoreLock(ORGANIZATION_PROFILES_STORAGE_KEY, async () => {
        const raw = await loadJsonStrict(plugin, ORGANIZATION_PROFILES_STORAGE_KEY);
        const store = decodeStore(raw);
        store.profiles[docId] = normalized;
        await saveJsonVerified(plugin, ORGANIZATION_PROFILES_STORAGE_KEY, store);
    });
    return normalized;
}
