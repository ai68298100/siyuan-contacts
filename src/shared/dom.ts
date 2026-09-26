/** DOM 辅助：HTML 转义（联系人字段是用户数据，注入 innerHTML 前必须转义） */

const ESCAPE_MAP: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
};

export function escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, (ch) => ESCAPE_MAP[ch] ?? ch);
}
