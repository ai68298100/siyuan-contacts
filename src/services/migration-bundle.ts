import type { Plugin } from "siyuan";
import { exportInteractionJson } from "./interaction-export";
import { exportFollowUpsJson } from "./followups";
import { loadCadenceMapStrict, mergeCadenceMap } from "../data/cadences";
import { loadReminderDismissalsStrict, mergeReminderDismissals } from "../data/reminder-dismissals";
import { loadRegistryStrict, mergeRegistryEntries } from "../data/registry";
import { loadTemplatesStore, mergeTemplatesStore } from "../data/templates";
import { normalizeTemplates } from "../domain/interaction-templates";
import { importInteractionJson } from "./interaction-import";
import { mergeFollowUpStore } from "../data/followups";
import { normalizeFollowUpStore } from "../domain/followups";
import { syncFollowUpTasksToDoc } from "./followup-sync";
import { EXCHANGE_STORAGE_KEY, loadExchangeStore, mergeExchangeStore } from "../data/exchanges";
import { PERSON_ALIAS_STORAGE_KEY, loadPersonAliasStore, mergePersonAliasStore } from "../data/person-aliases";
import { loadJsonStrict, withStoreLock } from "../data/storage";
import { parseExchangeStore } from "../domain/exchanges";
import type { ExchangeStore } from "../domain/exchanges";
import { parsePersonAliasStore } from "../domain/person-aliases";
import type { PersonAliasStore } from "../domain/person-aliases";
import { MigrationWriteUnknownError } from "../domain/migration-records";
import type { MigrationRecordIssue, MigrationRecordSummary } from "../domain/migration-records";
import { normalizeSettings, SETTINGS_STORAGE_KEY } from "../domain/model";
import { getRoster, invalidateRoster } from "./roster";
import { loadSelfIdentity, mergeSelfIdentity, SELF_IDENTITY_STORAGE_KEY } from "../data/self-identity";
import { parseSelfIdentity } from "../domain/self-identity.ts";
import type { SelfIdentity } from "../domain/self-identity.ts";
import { mapBoundDocIds } from "../api/av";
import { documentExists } from "../api/blocks";
import { loadOrgMembershipStore, mergeOrgMembershipStore, ORG_MEMBERSHIP_STORAGE_KEY } from "../data/org-membership";
import { normalizeOrgMembershipStoreForWrite } from "../domain/org-membership";
import type { OrgMembershipStore } from "../domain/org-membership";
import { scanOrganizations } from "./org";
import { loadRelationshipLabelStore, mergeRelationshipLabelStore, RELATIONSHIP_LABEL_STORAGE_KEY } from "../data/person-relationship-labels";
import { parsePersonRelationshipLabelStore } from "../domain/person-relationship-labels";
import type { PersonRelationshipLabelStore } from "../domain/person-relationship-labels";
import { loadOrganizationProfiles, saveOrganizationProfile, ORGANIZATION_PROFILES_STORAGE_KEY } from "../data/organization-profiles";
import { validateOrganizationProfile } from "../domain/organization-profile";
import type { OrganizationProfileDraft } from "../domain/organization-profile";
import { capturePeopleProfileLifetime, verifyRelationshipLabelReferences } from "./people-profiles";

const BUNDLE_SCHEMA_VERSION = 1;
export const MIGRATION_BUNDLE_STORAGE_KEY = "lvct-migration-bundle";

export interface MigrationModulePreview {
    key: "interactions" | "followUps" | "cadences" | "reminderDismissals" | "registry" | "templates" | "exchanges" | "aliases" | "selfIdentity" | "orgMemberships" | "organizationProfiles" | "relationshipLabels";
    label: string;
    count: number;
    tombstones?: number;
}

export const MIGRATION_COVERAGE = [
    { key: "interaction-events.json", status: "included", module: "interactions" },
    { key: "follow-ups.json", status: "included", module: "followUps" },
    { key: "person-cadences.json", status: "included", module: "cadences" },
    { key: "reminder-dismissals.json", status: "included", module: "reminderDismissals" },
    { key: "person-registry.json", status: "included", module: "registry" },
    { key: "interaction-templates.json", status: "included", module: "templates" },
    { key: EXCHANGE_STORAGE_KEY, status: "included", module: "exchanges" },
    { key: PERSON_ALIAS_STORAGE_KEY, status: "included", module: "aliases" },
    { key: SELF_IDENTITY_STORAGE_KEY, status: "included", module: "selfIdentity" },
    { key: ORG_MEMBERSHIP_STORAGE_KEY, status: "included", module: "orgMemberships" },
    { key: ORGANIZATION_PROFILES_STORAGE_KEY, status: "included", module: "organizationProfiles" },
    { key: RELATIONSHIP_LABEL_STORAGE_KEY, status: "included", module: "relationshipLabels" },
    { key: "org-projection-checkpoints.json", status: "excluded", reason: "本工作区未完成文档投影请求，不跨库重放" },
    { key: "organization-operations.json", status: "excluded", reason: "本工作区组织创建/改名操作断点，不跨库重放" },
    { key: "bridge-requests.json", status: "excluded", reason: "本工作区外部桥请求断点，不跨库重放" },
    { key: "view-preferences.json", status: "excluded", reason: "个人界面配置" },
    { key: SETTINGS_STORAGE_KEY, status: "excluded", reason: "数据库锚点需显式重绑" },
] as const;

interface BundleModules {
    interactions?: { events?: unknown[]; tombstones?: unknown[]; rawStore?: unknown };
    followUps?: { items?: unknown[] };
    cadences?: { cadences?: Record<string, unknown> };
    reminderDismissals?: { dismissals?: unknown[] };
    registry?: { registeredAt?: Record<string, unknown> };
    templates?: { templates?: unknown[] };
    exchanges?: ExchangeStore;
    aliases?: PersonAliasStore;
    selfIdentity?: { schemaVersion: 1; identity: SelfIdentity | null };
    orgMemberships?: OrgMembershipStore;
    organizationProfiles?: { schemaVersion: 1; profiles: Record<string, OrganizationProfileDraft> };
    relationshipLabels?: PersonRelationshipLabelStore;
}

interface MigrationBundle {
    schemaVersion: number;
    exportedAt?: string;
    storageKey?: string;
    modules?: BundleModules;
}

const MIGRATION_MODULE_KEYS = new Set<MigrationModulePreview["key"]>([
    "interactions", "followUps", "cadences", "reminderDismissals", "registry", "templates", "exchanges", "aliases", "selfIdentity", "orgMemberships", "organizationProfiles", "relationshipLabels",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireModuleEnvelope(value: unknown, label: string): Record<string, unknown> {
    if (!isRecord(value) || value.schemaVersion !== 1) {
        throw new Error(label + "模块格式或版本不兼容，拒绝导入");
    }
    return value;
}

function validateBundleModules(value: unknown): asserts value is BundleModules {
    if (!isRecord(value)) throw new Error("迁移包 modules 结构损坏，拒绝导入");
    for (const key of Object.keys(value)) {
        if (!MIGRATION_MODULE_KEYS.has(key as MigrationModulePreview["key"])) {
            throw new Error("迁移包包含未知模块「" + key + "」，拒绝导入");
        }
    }
    if (value.interactions !== undefined) {
        const module = requireModuleEnvelope(value.interactions, "互动");
        if (!Array.isArray(module.events) || !Array.isArray(module.tombstones)) {
            throw new Error("互动模块字段损坏，拒绝导入");
        }
    }
    if (value.followUps !== undefined) {
        const module = requireModuleEnvelope(value.followUps, "跟进");
        if (!Array.isArray(module.items)) throw new Error("跟进模块字段损坏，拒绝导入");
    }
    if (value.cadences !== undefined) {
        const module = requireModuleEnvelope(value.cadences, "联系节奏");
        if (!isRecord(module.cadences)) throw new Error("联系节奏模块字段损坏，拒绝导入");
    }
    if (value.reminderDismissals !== undefined) {
        const module = requireModuleEnvelope(value.reminderDismissals, "提醒暂缓");
        if (!Array.isArray(module.dismissals)) throw new Error("提醒暂缓模块字段损坏，拒绝导入");
    }
    if (value.registry !== undefined) {
        const module = requireModuleEnvelope(value.registry, "收编时间索引");
        if (!isRecord(module.registeredAt)) throw new Error("收编时间索引模块字段损坏，拒绝导入");
    }
    if (value.templates !== undefined) {
        const module = requireModuleEnvelope(value.templates, "备注模板");
        if (!Array.isArray(module.templates)) throw new Error("备注模板模块字段损坏，拒绝导入");
    }
    if (value.exchanges !== undefined) parseExchangeStore(requireModuleEnvelope(value.exchanges, "往来账本"));
    if (value.aliases !== undefined) parsePersonAliasStore(requireModuleEnvelope(value.aliases, "人物别名"));
    if (value.orgMemberships !== undefined) normalizeOrgMembershipStoreForWrite(requireModuleEnvelope(value.orgMemberships, "组织成员"));
    if (value.organizationProfiles !== undefined) {
        const module = requireModuleEnvelope(value.organizationProfiles, "组织资料");
        if (!isRecord(module.profiles)) throw new Error("组织资料模块字段损坏，拒绝导入");
        for (const [docId, profile] of Object.entries(module.profiles)) {
            if (!/^\d{14}-[0-9a-z]{7}$/.test(docId)) throw new Error("组织资料包含非法文档 ID，拒绝导入");
            const checked = validateOrganizationProfile(profile as OrganizationProfileDraft);
            if (!checked.valid) throw new Error(`组织资料 ${docId} 校验失败：${checked.errors.join("、")}`);
        }
    }
    if (value.relationshipLabels !== undefined) parsePersonRelationshipLabelStore(requireModuleEnvelope(value.relationshipLabels, "与我的关系"));
    if (value.selfIdentity !== undefined) {
        const module = requireModuleEnvelope(value.selfIdentity, "本人身份");
        if (!("identity" in module)) throw new Error("本人身份模块缺少 identity，拒绝导入");
        parseSelfIdentity(module.identity);
    }
}

function parseBundle(text: string): MigrationBundle {
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        throw new Error("迁移包不是合法 JSON");
    }
    const bundle = parsed as MigrationBundle;
    if (!isRecord(bundle) || bundle.schemaVersion !== BUNDLE_SCHEMA_VERSION
        || bundle.storageKey !== MIGRATION_BUNDLE_STORAGE_KEY || typeof bundle.modules !== "object" || bundle.modules === null) {
        throw new Error("迁移包格式或版本不兼容，拒绝导入");
    }
    if (bundle.exportedAt !== undefined && typeof bundle.exportedAt !== "string") {
        throw new Error("迁移包导出时间字段损坏，拒绝导入");
    }
    validateBundleModules(bundle.modules);
    return bundle;
}

export async function exportMigrationBundle(plugin: Plugin): Promise<string> {
    const [interactions, followUps, cadences, reminderDismissals, registry, templatesStore, exchanges, aliases, identity, orgMemberships, organizationProfiles, relationshipLabels] = await Promise.all([
        JSON.parse(await exportInteractionJson(plugin)) as BundleModules["interactions"],
        JSON.parse(await exportFollowUpsJson(plugin)) as BundleModules["followUps"],
        loadCadenceMapStrict(plugin),
        loadReminderDismissalsStrict(plugin),
        loadRegistryStrict(plugin),
        loadTemplatesStore(plugin),
        withStoreLock(EXCHANGE_STORAGE_KEY, () => loadExchangeStore(plugin)),
        withStoreLock(PERSON_ALIAS_STORAGE_KEY, () => loadPersonAliasStore(plugin)),
        withStoreLock(SELF_IDENTITY_STORAGE_KEY, () => loadSelfIdentity(plugin)),
        withStoreLock(ORG_MEMBERSHIP_STORAGE_KEY, () => loadOrgMembershipStore(plugin)),
        withStoreLock(ORGANIZATION_PROFILES_STORAGE_KEY, () => loadOrganizationProfiles(plugin)),
        withStoreLock(RELATIONSHIP_LABEL_STORAGE_KEY, () => loadRelationshipLabelStore(plugin)),
    ]);
    return JSON.stringify({
        schemaVersion: BUNDLE_SCHEMA_VERSION,
        exportedAt: new Date().toISOString(),
        storageKey: MIGRATION_BUNDLE_STORAGE_KEY,
        coverage: MIGRATION_COVERAGE,
        modules: {
            interactions,
            followUps,
            cadences: { schemaVersion: 1, cadences },
            reminderDismissals: { schemaVersion: 1, dismissals: reminderDismissals },
            registry: { schemaVersion: 1, registeredAt: registry.registeredAt },
            templates: { schemaVersion: 1, templates: templatesStore?.templates ?? [] },
            exchanges,
            aliases,
            selfIdentity: { schemaVersion: 1, identity },
            orgMemberships,
            organizationProfiles: { schemaVersion: 1, profiles: organizationProfiles },
            relationshipLabels,
        },
    }, null, 2);
}

/** 预览：解析包并给出各模块条目计数（零写入）；坏包/版本不兼容抛错 */
export function previewMigrationImport(text: string): MigrationModulePreview[] {
    const bundle = parseBundle(text);
    const modules = bundle.modules as BundleModules;
    const previews: MigrationModulePreview[] = [];
    const push = (key: MigrationModulePreview["key"], label: string, count: number): void => {
        if (count > 0) previews.push({ key, label, count });
    };
    push("interactions", "互动事件", Array.isArray(modules.interactions?.events) ? modules.interactions!.events!.length : 0);
    push("followUps", "跟进事项", Array.isArray(modules.followUps?.items) ? modules.followUps!.items!.length : 0);
    push("cadences", "联系节奏", Object.keys(modules.cadences?.cadences ?? {}).length);
    push("reminderDismissals", "提醒暂缓", Array.isArray(modules.reminderDismissals?.dismissals) ? modules.reminderDismissals!.dismissals!.length : 0);
    push("registry", "收编时间索引", Object.keys(modules.registry?.registeredAt ?? {}).length);
    push("templates", "备注模板", Array.isArray(modules.templates?.templates) ? modules.templates!.templates!.length : 0);
    push("exchanges", "往来账本", modules.exchanges?.records.length ?? 0);
    if (modules.aliases) {
        const store = parsePersonAliasStore(modules.aliases);
        if (store.aliases.length > 0 || (store.tombstones?.length ?? 0) > 0) {
            previews.push({ key: "aliases", label: "人物别名", count: store.aliases.length, tombstones: store.tombstones?.length ?? 0 });
        }
    }
    if (modules.selfIdentity) push("selfIdentity", "本人身份", modules.selfIdentity.identity ? 1 : 0);
    if (modules.relationshipLabels) push("relationshipLabels", "与我的关系", modules.relationshipLabels.labels.length);
    if (modules.orgMemberships) {
        const store = normalizeOrgMembershipStoreForWrite(modules.orgMemberships);
        if (store.memberships.length > 0 || (store.tombstones?.length ?? 0) > 0) {
            previews.push({ key: "orgMemberships", label: "组织成员", count: store.memberships.length, tombstones: store.tombstones?.length ?? 0 });
        }
    }
    if (modules.organizationProfiles) push("organizationProfiles", "组织资料", Object.keys(modules.organizationProfiles.profiles ?? {}).length);
    return previews;
}

export interface MigrationModuleFailure {
    key: MigrationModulePreview["key"];
    label: string;
    message: string;
    status?: "failed" | "unknown";
}

export interface MigrationImportResult {
    modules: { key: MigrationModulePreview["key"]; label: string; merged: number; skipped?: number; removed?: number }[];
    /** FUNC-01.6-b：合并失败模块（含原因）；失败不阻断其他模块，也不得报整包成功 */
    failed: MigrationModuleFailure[];
    /** 跟进合并/互动合并各自的跳过数（现状优先未计入 merged） */
    skipped: { followUps: number; interactions: number };
    issues: (MigrationRecordIssue & { key: MigrationModulePreview["key"]; label: string })[];
    retryBundle?: string;
}

/** 确认导入：逐模块合并（互动/跟进复用既有合并纪律），失败模块记录原因不阻断其他模块 */
export async function importMigrationBundle(plugin: Plugin, text: string): Promise<MigrationImportResult> {
    previewMigrationImport(text); /* 合并前再校验一次包合法性 */
    const modules = parseBundle(text).modules as BundleModules;
    const result: MigrationImportResult = { modules: [], failed: [], skipped: { followUps: 0, interactions: 0 }, issues: [] };
    const runModule = async (key: MigrationModulePreview["key"], label: string, run: () => Promise<void>): Promise<void> => {
        try {
            await run();
        } catch (error) {
            result.failed.push({ key, label, message: error instanceof Error ? error.message : String(error), status: error instanceof MigrationWriteUnknownError ? "unknown" : "failed" });
        }
    };

    if (Array.isArray(modules.interactions?.events)) {
        await runModule("interactions", "互动事件", async () => {
            const summary = await importInteractionJson(plugin, JSON.stringify({
                schemaVersion: 1,
                events: modules.interactions!.events,
                tombstones: Array.isArray(modules.interactions!.tombstones) ? modules.interactions!.tombstones : [],
            }));
            result.modules.push({ key: "interactions", label: "互动事件", merged: summary.added });
            result.skipped.interactions = summary.skipped;
        });
    }
    if (Array.isArray(modules.followUps?.items)) {
        await runModule("followUps", "跟进事项", async () => {
            const incoming = normalizeFollowUpStore({
                schemaVersion: 1,
                items: modules.followUps!.items,
                tombstones: [],
            });
            const summary = await mergeFollowUpStore(plugin, incoming.items);
            result.modules.push({ key: "followUps", label: "跟进事项", merged: summary.added });
            result.skipped.followUps = summary.skipped;
            /* FUNC-01.6-b：恢复后对新增人物触发安全任务同步（settings 未初始化/文档不可达在 sync 内降级） */
            for (const personDocId of summary.personDocIds) {
                await syncFollowUpTasksToDoc(plugin, personDocId);
            }
        });
    }
    if (modules.cadences?.cadences && typeof modules.cadences.cadences === "object") {
        await runModule("cadences", "联系节奏", async () => {
            const merged = await mergeCadenceMap(plugin, modules.cadences!.cadences as Record<string, { days: number; paused: boolean }>);
            result.modules.push({ key: "cadences", label: "联系节奏", merged });
        });
    }
    if (Array.isArray(modules.reminderDismissals?.dismissals)) {
        await runModule("reminderDismissals", "提醒暂缓", async () => {
            const merged = await mergeReminderDismissals(plugin, modules.reminderDismissals!.dismissals as never[]);
            result.modules.push({ key: "reminderDismissals", label: "提醒暂缓", merged });
        });
    }
    if (modules.registry?.registeredAt && typeof modules.registry.registeredAt === "object") {
        await runModule("registry", "收编时间索引", async () => {
            const merged = await mergeRegistryEntries(plugin, modules.registry!.registeredAt as Record<string, string>);
            result.modules.push({ key: "registry", label: "收编时间索引", merged });
        });
    }
    if (Array.isArray(modules.templates?.templates)) {
        await runModule("templates", "备注模板", async () => {
            const incoming = normalizeTemplates(modules.templates!.templates);
            if (incoming.length > 0) {
                /* FUNC-01.6-c：读取、合并、保存同一存储锁临界区（并发恢复不丢模板） */
                const added = await mergeTemplatesStore(plugin, incoming);
                result.modules.push({ key: "templates", label: "备注模板", merged: added });
            }
        });
    }
    let reachable: Promise<ReadonlySet<string>> | undefined;
    const reachablePeople = (): Promise<ReadonlySet<string>> => {
        reachable ??= (async () => {
            const settings = normalizeSettings(await loadJsonStrict(plugin, SETTINGS_STORAGE_KEY));
            if (!settings) throw new Error("无法核实人物归属：请先恢复思源原文档并重绑人脉数据库");
            invalidateRoster();
            const counts = new Map<string, number>();
            for (const person of await getRoster(settings)) counts.set(person.docId, (counts.get(person.docId) ?? 0) + 1);
            return new Set([...counts].filter(([, count]) => count === 1).map(([docId]) => docId));
        })();
        return reachable;
    };
    const addSummary = (key: MigrationModulePreview["key"], label: string, summary: MigrationRecordSummary): void => {
        result.modules.push({ key, label, merged: summary.merged, skipped: summary.skipped, removed: summary.removed });
        result.issues.push(...summary.issues.map((entry) => ({ ...entry, key, label })));
    };
    if (modules.exchanges) {
        await runModule("exchanges", "往来账本", async () => {
            const incoming = parseExchangeStore(modules.exchanges);
            const people = incoming.records.length > 0 ? await reachablePeople() : new Set<string>();
            addSummary("exchanges", "往来账本", await mergeExchangeStore(plugin, incoming, people));
        });
    }
    if (modules.aliases) {
        await runModule("aliases", "人物别名", async () => {
            const incoming = parsePersonAliasStore(modules.aliases);
            const people = incoming.aliases.length > 0 ? await reachablePeople() : new Set<string>();
            addSummary("aliases", "人物别名", await mergePersonAliasStore(plugin, incoming, people));
        });
    }
    if (modules.selfIdentity) {
        await runModule("selfIdentity", "本人身份", async () => {
            const incoming = parseSelfIdentity(modules.selfIdentity!.identity);
            if (!incoming) {
                addSummary("selfIdentity", "本人身份", { merged: 0, skipped: 0, removed: 0, issues: [] });
                return;
            }
            const current = await loadSelfIdentity(plugin);
            if (current && current.selfDocId !== incoming.selfDocId) {
                addSummary("selfIdentity", "本人身份", await mergeSelfIdentity(plugin, incoming, null));
                return;
            }
            const settings = normalizeSettings(await loadJsonStrict(plugin, SETTINGS_STORAGE_KEY));
            if (!settings) throw new Error("请先恢复原文档并重绑数据库，再恢复本人身份");
            invalidateRoster();
            const people = (await getRoster(settings)).filter((person) => person.docId === incoming.selfDocId);
            const itemMap = await mapBoundDocIds(settings.avId, [incoming.selfDocId]);
            if (people.length > 1 || people.length === 1 && itemMap[incoming.selfDocId] !== people[0].itemId) {
                throw new Error("本人文档与目标绑定映射不一致，身份未恢复；请核对数据库");
            }
            const targetItemId = people.length === 1 && await documentExists(incoming.selfDocId) ? people[0].itemId : null;
            const summary = await mergeSelfIdentity(plugin, incoming, targetItemId);
            if (summary.merged > 0) {
                try {
                    const verified = await mapBoundDocIds(settings.avId, [incoming.selfDocId]);
                    if (verified[incoming.selfDocId] !== targetItemId || !await documentExists(incoming.selfDocId)) throw new Error("本人身份写后绑定未收敛");
                } catch (cause) {
                    throw new MigrationWriteUnknownError(cause);
                } finally { invalidateRoster(); }
            }
            addSummary("selfIdentity", "本人身份", summary);
        });
    }
    if (modules.orgMemberships) {
        await runModule("orgMemberships", "组织成员", async () => {
            const incoming = normalizeOrgMembershipStoreForWrite(modules.orgMemberships);
            const organizations = incoming.memberships.length > 0 ? await scanOrganizations() : [];
            const people = incoming.memberships.length > 0 ? await reachablePeople() : new Set<string>();
            const organizationIds = new Set(organizations.map((organization) => organization.docId));
            const personIds = new Set([...people].filter((docId) => !organizationIds.has(docId)));
            addSummary("orgMemberships", "组织成员", await mergeOrgMembershipStore(plugin, incoming, personIds, organizationIds));
        });
    }
    if (modules.organizationProfiles) {
        await runModule("organizationProfiles", "组织资料", async () => {
            if (Object.keys(modules.organizationProfiles!.profiles ?? {}).length === 0) {
                result.modules.push({ key: "organizationProfiles", label: "组织资料", merged: 0 });
                return;
            }
            const organizations = await scanOrganizations();
            const reachable = new Set(organizations.map((organization) => organization.docId));
            const current = await loadOrganizationProfiles(plugin);
            let merged = 0;
            let skipped = 0;
            for (const [docId, profile] of Object.entries(modules.organizationProfiles!.profiles)) {
                if (!reachable.has(docId) || current[docId]) { skipped += 1; continue; }
                await saveOrganizationProfile(plugin, docId, profile);
                merged += 1;
            }
            result.modules.push({ key: "organizationProfiles", label: "组织资料", merged, skipped });
        });
    }
    if (modules.relationshipLabels) {
        await runModule("relationshipLabels", "与我的关系", async () => {
            const incoming = parsePersonRelationshipLabelStore(modules.relationshipLabels);
            const assertActive = capturePeopleProfileLifetime(plugin);
            await withStoreLock(SELF_IDENTITY_STORAGE_KEY, async () => {
                assertActive();
                if (incoming.labels.length === 0) {
                    addSummary("relationshipLabels", "与我的关系", await mergeRelationshipLabelStore(plugin, incoming, null, new Set(), assertActive));
                    return;
                }
                const settings = normalizeSettings(await loadJsonStrict(plugin, SETTINGS_STORAGE_KEY));
                if (!settings) throw new Error("请先重绑数据库，再核实本人参照与关系称谓");
                const references = await verifyRelationshipLabelReferences(plugin, settings, incoming.labels.map((record) => record.personDocId));
                const selfDocId = references.identity?.selfDocId ?? null;
                const reachable = references.reachable;
                const eligible = incoming.labels.filter((record) => record.selfDocId === selfDocId && reachable.has(record.selfDocId) && reachable.has(record.personDocId));
                const verifiedDocIds = new Set([selfDocId, ...eligible.map((record) => record.personDocId)]);
                const writtenReferences = { ...references, itemIds: new Map([...references.itemIds].filter(([docId]) => verifiedDocIds.has(docId))) };
                const summary = await mergeRelationshipLabelStore(plugin, { schemaVersion: 1, labels: eligible }, selfDocId, reachable, assertActive);
                const excluded = incoming.labels.filter((record) => !eligible.includes(record));
                summary.skipped += excluded.length;
                summary.issues.push(...excluded.map((record): MigrationRecordIssue => ({
                    id: record.id, selfDocId: record.selfDocId, personDocId: record.personDocId, reason: "unreachable",
                    message: "原本人或人物文档不可达、绑定映射不一致，未恢复称谓；请核对稳定文档 ID",
                })));
                if (summary.merged > 0) {
                    try {
                        const currentSettings = normalizeSettings(await loadJsonStrict(plugin, SETTINGS_STORAGE_KEY));
                        if (JSON.stringify(currentSettings) !== JSON.stringify(settings)) throw new Error("称谓写后数据库锚点已变化");
                        await verifyRelationshipLabelReferences(plugin, settings, eligible.map((record) => record.personDocId), writtenReferences);
                        assertActive();
                    } catch (cause) { throw new MigrationWriteUnknownError(cause); }
                }
                addSummary("relationshipLabels", "与我的关系", summary);
            });
        });
    }
    const pending = new Set([...result.failed.map((module) => module.key), ...result.issues.map((entry) => entry.key)]);
    if (pending.size > 0) {
        result.retryBundle = JSON.stringify({
            schemaVersion: BUNDLE_SCHEMA_VERSION,
            storageKey: MIGRATION_BUNDLE_STORAGE_KEY,
            modules: Object.fromEntries(Object.entries(modules).filter(([key]) => pending.has(key as MigrationModulePreview["key"]))),
        });
    }
    return result;
}
