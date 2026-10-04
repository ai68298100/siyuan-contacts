export class StoreIntegrityError extends Error {
    readonly module: string;
    readonly originalCount?: number;
    readonly entryIndex?: number;

    constructor(module: string, reason: string, originalCount?: number, entryIndex?: number) {
        const position = originalCount === undefined ? "" : `（原始 ${originalCount} 条${entryIndex === undefined ? "" : `，第 ${entryIndex + 1} 条`}）`;
        super(`${module}存储内容损坏${position}：${reason}；操作已停止，请先备份并检查原文件，修复后重试`);
        this.name = "StoreIntegrityError";
        this.module = module;
        this.originalCount = originalCount;
        this.entryIndex = entryIndex;
    }
}

export function parseStoreRecords<T extends { id: string }>(
    raw: unknown,
    module: string,
    key: string,
    parse: (record: unknown) => T | null,
): T[] {
    if (raw === null || raw === undefined || raw === "") return [];
    if (typeof raw !== "object" || Array.isArray(raw)) throw new StoreIntegrityError(module, "需要版本化对象");
    const container = raw as Record<string, unknown>;
    if (container.schemaVersion !== 1) throw new StoreIntegrityError(module, "版本不兼容");
    const entries = container[key];
    if (!Array.isArray(entries)) throw new StoreIntegrityError(module, "条目容器必须为数组");
    const seen = new Set<string>();
    return entries.map((entry, index) => {
        const parsed = parse(entry);
        if (!parsed) throw new StoreIntegrityError(module, "条目字段或业务规则无效", entries.length, index);
        if (seen.has(parsed.id)) throw new StoreIntegrityError(module, "记录 ID 重复", entries.length, index);
        seen.add(parsed.id);
        return parsed;
    });
}
