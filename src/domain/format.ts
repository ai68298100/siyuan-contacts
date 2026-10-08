/**
 * UX-01.11 展示格式统一：相对互动时间与月日格式的共享助手。
 * 纯函数：无 DOM、无 IO，node --test 直接可测。
 */

/** 相对互动时间文案：0=今天互动、1=昨天互动、其余 N 天前互动 */
export function formatRelativeInteraction(daysAgo: number): string {
    if (daysAgo <= 0) return "今天互动";
    if (daysAgo === 1) return "昨天互动";
    return `${daysAgo} 天前互动`;
}

/** YYYY-MM-DD → "M月D日"（非契约格式原样返回） */
export function formatMonthDay(iso: string): string {
    const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return iso;
    return `${Number(match[2])}月${Number(match[3])}日`;
}

export function validateDocumentTitle(title: string): string | null {
    if (!title.trim()) return "文档名称不能为空";
    if (/[\/\u0000-\u001f\u007f]/.test(title)) return "文档名称不能包含斜杠或控制字符（含换行），思源内核无法原文保留这类名称";
    return null;
}

export function documentHPath(...segments: readonly string[]): string {
    if (!segments.length) throw new Error("文档路径不能为空");
    return "/" + segments.map((segment) => {
        const error = validateDocumentTitle(segment);
        if (error) throw new Error(error);
        return segment.trim();
    }).join("/");
}

export function escapeMarkdown(text: string): string {
    return text.replace(/([\\`*_\[\]#<>])/g, "\\$1");
}

export function markdownHeading(title: string): string {
    return `# ${escapeMarkdown(title.trim())}\n\n`;
}
