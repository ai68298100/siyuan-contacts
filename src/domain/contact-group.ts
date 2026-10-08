/** 联系人分组选择器的内部选项值；这些值只用于 UI，禁止写入 AV。 */
export const GROUP_OPTION_PREFIX = "__lvct_group_option__:";
export const GROUP_CUSTOM_OPTION = `${GROUP_OPTION_PREFIX}custom`;
export const GROUP_KEEP_OPTION = `${GROUP_OPTION_PREFIX}keep`;
export const GROUP_CLEAR_OPTION = `${GROUP_OPTION_PREFIX}clear`;

export type CustomGroupValidation =
    | { ok: true; value: string }
    | { ok: false; reason: "empty" | "reserved" };

/** 自定义分组按普通短文本保存；仅去首尾空格并阻止空值与 UI 内部 sentinel 泄漏。 */
export function normalizeCustomGroupName(raw: string): CustomGroupValidation {
    const value = raw.trim();
    if (!value) return { ok: false, reason: "empty" };
    if (value.startsWith(GROUP_OPTION_PREFIX)) return { ok: false, reason: "reserved" };
    return { ok: true, value };
}
