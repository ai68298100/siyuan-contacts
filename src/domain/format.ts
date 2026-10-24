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

/**
 * C-14：Markdown 链接标签文本转义。
 * 保证含 `[`、`]`、`\` 或换行的人名/组织名不会破坏 `[标签](siyuan://blocks/...)` 的 Markdown 链接语法结构。
 */
export function escapeLinkLabel(value: string): string {
    return value.trim().replace(/[\r\n]+/g, " ").replace(/([\\\[\]])/g, "\\$1");
}

export function markdownHeading(title: string): string {
    return `# ${escapeMarkdown(title.trim())}\n\n`;
}

/**
 * 生成合法节点 ID（yyyyMMddHHmmss-xxxxxxx，同 Lute.NewNodeID 格式）。
 * 仅作标识符使用，无加密语义，随机性要求与内核同源。
 */
export function newNodeId(now: Date = new Date()): string {
    const pad = (value: number, width: number) => String(value).padStart(width, "0");
    const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1, 2)}${pad(now.getDate(), 2)}${pad(now.getHours(), 2)}${pad(now.getMinutes(), 2)}${pad(now.getSeconds(), 2)}`;
    const charset = "0123456789abcdefghijklmnopqrstuvwxyz";
    let rand = "";
    for (let i = 0; i < 7; i += 1) {
        rand += charset[Math.floor(Math.random() * charset.length)];
    }
    return `${stamp}-${rand}`;
}

const WINDOWS_RESERVED_NAMES = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;

/**
 * K-11：跨平台安全文件名清洗。
 * 过滤 Windows/macOS/Linux 非法字符（/\:*?"<>|）、控制字符、尾随空格/点号，并做安全长度截断。
 */
export function sanitizeFileName(name: string, fallback = "未命名", maxLength = 64): string {
    const raw = typeof name === "string" ? name.trim() : "";
    if (!raw) return fallback;
    let cleaned = raw
        .replace(/[<>:"/\\|?*\u0000-\u001F\u007F]/g, "_")
        .trim()
        .replace(/[. ]+$/g, "");
    if (WINDOWS_RESERVED_NAMES.test(cleaned)) {
        cleaned = `_${cleaned}`;
    }
    if (cleaned.length > maxLength) {
        cleaned = cleaned.slice(0, maxLength).trim().replace(/[. ]+$/g, "");
    }
    return cleaned || fallback;
}

export const BLOCK_ID_REGEX = /^\d{14}-[a-z0-9]{7}$/;

export function assertSafeBlockId(id: string, label = "块 ID"): void {
    if (typeof id !== "string" || !BLOCK_ID_REGEX.test(id)) {
        throw new Error(`${label}不是合法的思源块 ID: ${id}`);
    }
}

export function escapeSqlString(value: string): string {
    return String(value ?? "").replace(/'/g, "''");
}
