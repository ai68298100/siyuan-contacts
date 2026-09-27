/** 缺失或空翻译回退；插值使用回调，人物姓名中的 $ 等字符按字面保留。 */
export function translateText(
    messages: Readonly<Record<string, string>> | undefined,
    key: string,
    fallback: string,
    values: Readonly<Record<string, string | number>> = {},
): string {
    const message = messages?.[key];
    const template = typeof message === "string" && message.trim() ? message : fallback;
    return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, name: string) =>
        Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : match);
}
