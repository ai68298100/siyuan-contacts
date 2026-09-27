/** 存量文档收编的纯函数规则（不触碰思源 API）。 */

/** 将用户输入的 hpath 前缀规范化为 `/文件夹`；空值表示不筛选。 */
export function normalizeFolderPrefix(value: string): string {
    const trimmed = value.trim().replace(/\\/g, "/");
    if (!trimmed || trimmed === "/") return "";
    return `/${trimmed.replace(/^\/+|\/+$/g, "")}`;
}

/** hpath 必须位于目标文件夹之下，不把同名的兄弟文件夹误算进去。 */
export function matchesFolderPrefix(hpath: string, folderPrefix: string): boolean {
    const folder = normalizeFolderPrefix(folderPrefix);
    if (!folder) return true;
    const path = hpath.trim().replace(/\\/g, "/").replace(/\/+$/, "");
    return path.startsWith(`${folder}/`);
}

/** 标签输入按空白/中英文逗号切分，去空、去重并保留首次出现顺序。 */
export function normalizeImportTags(value: string): string[] {
    return [...new Set(value.split(/[，,、\s]+/).map((tag) => tag.trim()).filter(Boolean))];
}
