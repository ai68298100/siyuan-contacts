/**
 * C08/FUNC-01.6 完整迁移包：跟进/节奏/暂缓/收编索引/模板/互动 六模块合并导出与恢复。
 * 契约见 docs/DATA-CONTRACT.md §3「lvct-migration-bundle」——文件而非存储键；
 * 不含 settings 锚点与 view-preferences；明示非思源原生数据字节级备份。
 * 互动/跟进恢复复用既有合并（id 去重、现状优先、墓碑优先）；合并后由 B07 写侧同步收敛文档任务块。
 */
import type { Plugin } from "siyuan";
import { exportInteractionJson } from "./interaction-export";
import { exportFollowUpsJson } from "./followups";
import { loadCadenceMap, mergeCadenceMap } from "../data/cadences";
import { loadReminderDismissals, mergeReminderDismissals } from "../data/reminder-dismissals";
import { loadRegistry, mergeRegistryEntries } from "../data/registry";
import { loadTemplatesStore, saveTemplatesStore } from "../data/templates";
import { normalizeTemplates } from "../domain/interaction-templates";
import { importInteractionJson } from "./interaction-import";
import { mergeFollowUpStore } from "../data/followups";
import { normalizeFollowUpStore } from "../domain/followups";

const BUNDLE_SCHEMA_VERSION = 1;
export const MIGRATION_BUNDLE_STORAGE_KEY = "lvct-migration-bundle";

export interface MigrationModulePreview {
    key: "interactions" | "followUps" | "cadences" | "reminderDismissals" | "registry" | "templates";
    label: string;
    count: number;
}

interface BundleModules {
    interactions?: { events?: unknown[]; tombstones?: unknown[]; rawStore?: unknown };
    followUps?: { items?: unknown[] };
    cadences?: { cadences?: Record<string, unknown> };
    reminderDismissals?: { dismissals?: unknown[] };
    registry?: { registeredAt?: Record<string, unknown> };
    templates?: { templates?: unknown[] };
}

interface MigrationBundle {
    schemaVersion: number;
    exportedAt?: string;
    storageKey?: string;
    modules?: BundleModules;
}

function parseBundle(text: string): MigrationBundle {
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        throw new Error("迁移包不是合法 JSON");
    }
    const bundle = parsed as MigrationBundle;
    if (bundle === null || typeof bundle !== "object" || bundle.schemaVersion !== BUNDLE_SCHEMA_VERSION
        || bundle.storageKey !== MIGRATION_BUNDLE_STORAGE_KEY || bundle.modules === null || typeof bundle.modules !== "object") {
        throw new Error("迁移包格式或版本不兼容，拒绝导入");
    }
    return bundle;
}

/** 导出：六模块聚合（互动/跟进在各自锁内严格读取，坏数据原样随包 rawStore/rawValue） */
export async function exportMigrationBundle(plugin: Plugin): Promise<string> {
    const [interactions, followUps, cadences, reminderDismissals, registry, templatesStore] = await Promise.all([
        JSON.parse(await exportInteractionJson(plugin)) as BundleModules["interactions"],
        JSON.parse(await exportFollowUpsJson(plugin)) as BundleModules["followUps"],
        loadCadenceMap(plugin),
        loadReminderDismissals(plugin),
        loadRegistry(plugin),
        loadTemplatesStore(plugin),
    ]);
    return JSON.stringify({
        schemaVersion: BUNDLE_SCHEMA_VERSION,
        exportedAt: new Date().toISOString(),
        storageKey: MIGRATION_BUNDLE_STORAGE_KEY,
        modules: {
            interactions,
            followUps,
            cadences: { schemaVersion: 1, cadences },
            reminderDismissals: { schemaVersion: 1, dismissals: reminderDismissals },
            registry: { schemaVersion: 1, registeredAt: registry.registeredAt },
            templates: { schemaVersion: 1, templates: templatesStore?.templates ?? [] },
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
    return previews;
}

export interface MigrationImportResult {
    modules: { key: MigrationModulePreview["key"]; label: string; merged: number }[];
    /** 跟进合并/互动合并各自的跳过数（现状优先未计入 merged） */
    skipped: { followUps: number; interactions: number };
}

/** 确认导入：逐模块合并（互动/跟进复用既有合并纪律），失败模块不阻断其他模块 */
export async function importMigrationBundle(plugin: Plugin, text: string): Promise<MigrationImportResult> {
    previewMigrationImport(text); /* 合并前再校验一次包合法性 */
    const modules = parseBundle(text).modules as BundleModules;
    const result: MigrationImportResult = { modules: [], skipped: { followUps: 0, interactions: 0 } };

    if (Array.isArray(modules.interactions?.events)) {
        try {
            const summary = await importInteractionJson(plugin, JSON.stringify({
                schemaVersion: 1,
                events: modules.interactions!.events,
                tombstones: Array.isArray(modules.interactions!.tombstones) ? modules.interactions!.tombstones : [],
            }));
            result.modules.push({ key: "interactions", label: "互动事件", merged: summary.added });
            result.skipped.interactions = summary.skipped;
        } catch (error) {
            console.warn("[lvct] 迁移包互动模块导入失败:", error);
        }
    }
    if (Array.isArray(modules.followUps?.items)) {
        try {
            const incoming = normalizeFollowUpStore({
                schemaVersion: 1,
                items: modules.followUps!.items,
                tombstones: [],
            });
            const summary = await mergeFollowUpStore(plugin, incoming.items);
            result.modules.push({ key: "followUps", label: "跟进事项", merged: summary.added });
            result.skipped.followUps = summary.skipped;
        } catch (error) {
            console.warn("[lvct] 迁移包跟进模块导入失败:", error);
        }
    }
    if (modules.cadences?.cadences && typeof modules.cadences.cadences === "object") {
        const merged = await mergeCadenceMap(plugin, modules.cadences.cadences as Record<string, { days: number; paused: boolean }>);
        result.modules.push({ key: "cadences", label: "联系节奏", merged });
    }
    if (Array.isArray(modules.reminderDismissals?.dismissals)) {
        const merged = await mergeReminderDismissals(plugin, modules.reminderDismissals.dismissals as never[]);
        result.modules.push({ key: "reminderDismissals", label: "提醒暂缓", merged });
    }
    if (modules.registry?.registeredAt && typeof modules.registry.registeredAt === "object") {
        const merged = await mergeRegistryEntries(plugin, modules.registry.registeredAt as Record<string, string>);
        result.modules.push({ key: "registry", label: "收编时间索引", merged });
    }
    if (Array.isArray(modules.templates?.templates)) {
        const incoming = normalizeTemplates(modules.templates!.templates);
        if (incoming.length > 0) {
            /* 锁守护（withStoreLock 5s 超时 + steal 接管）落地后回归锁内写；
               此前因回归环境偶发锁假死曾绕锁手工读改写（已修复根因） */
            const store = await loadTemplatesStore(plugin);
            const byId = new Map((store?.templates ?? []).map((template) => [template.id, template]));
            let added = 0;
            for (const template of incoming) {
                if (byId.has(template.id)) continue;
                byId.set(template.id, template);
                added += 1;
            }
            await saveTemplatesStore(plugin, [...byId.values()].slice(0, 50));
            result.modules.push({ key: "templates", label: "备注模板", merged: added });
        }
    }
    return result;
}
