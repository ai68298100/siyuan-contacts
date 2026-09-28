/**
 * FAST-01.1 粘贴文本快速填充：本地确定性识别（纯函数，无 DOM、无 IO、不发网络）。
 * 设计原则（docs/FEEDBACK-BACKLOG.md FAST-01）：
 * - 显式「键: 值」= certain；无键按格式推断（姓名/裸号码等）= likely；
 *   任何结果只进预览，写入必须经用户确认，不静默覆盖已有资料。
 * - 同一字段出现多个值时全部保留为候选条目，不拼接、不覆盖。
 * - 契约外或无法识别的内容进入 unrecognized，不做无提示丢弃。
 * - 微信号不做裸词猜测：仅在出现「微信/微信号/WX/WeChat」等键时识别。
 */

export type QuickFillField =
    | "name"
    | "phone"
    | "wechat"
    | "email"
    | "website"
    | "birthday"
    | "group"
    | "tags";

export interface QuickFillItem {
    field: QuickFillField;
    /** 规范化后的值：电话去空格/短横线/括号/国家码；生日统一 YYYY-MM-DD 或 MM-DD */
    value: string;
    /** 原文片段（预览核对与审计用） */
    raw: string;
    /** certain = 显式键值对；likely = 无键按格式推断 */
    confidence: "certain" | "likely";
    /** 识别说明：已去国家码、含分机、未提供年份、农历标记、候选序号等 */
    note?: string;
}

export interface QuickFillResult {
    items: QuickFillItem[];
    /** 无法识别的非空行原文（不静默丢弃） */
    unrecognized: string[];
}

/** 中英键名别名表：识别规则由别名表驱动，不散落在分支里（FAST-01.2） */
const KEY_ALIASES: Readonly<Record<string, QuickFillField>> = {
    姓名: "name", 名字: "name", 称呼: "name", name: "name",
    手机: "phone", 手机号: "phone", 电话: "phone", 电话号码: "phone", 座机: "phone",
    tel: "phone", mobile: "phone", phone: "phone",
    微信: "wechat", 微信号: "wechat", wx: "wechat", wechat: "wechat", weixin: "wechat",
    邮箱: "email", 邮件: "email", 电邮: "email", email: "email",
    网址: "website", 网站: "website", 主页: "website", url: "website", website: "website",
    生日: "birthday", 出生日期: "birthday", 生辰: "birthday", birthday: "birthday",
    分组: "group", group: "group",
    标签: "tags", 标签组: "tags", tags: "tags",
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_RE = /^(?:https?:\/\/|www\.)\S+$/i;
/** 农历前缀（公历为默认，无需标记） */
const LUNAR_PREFIX_RE = /^(?:农历|阴历|夏历)/;

function lookupKey(raw: string): QuickFillField | null {
    const key = raw.trim().toLowerCase().replace(/[\s]/g, "");
    return KEY_ALIASES[key] ?? null;
}

function pad2(value: string): string {
    return value.padStart(2, "0");
}

function isNumericToken(token: string): boolean {
    return /^[\d\s\-().+转分机xXext,，]+$/.test(token) && /\d/.test(token);
}

/** 电话规范化：去空格/短横线/括号、剥 +86/86 国家码、保留分机；无法构成 7–15 位号码时返回 null */
export function normalizePhone(raw: string): { value: string; note?: string } | null {
    let main = raw.trim();
    let extension = "";
    const extMatch = main.match(/(?:转|分机|ext\.?|x)\s*(\d{1,6})$/i);
    if (extMatch) {
        extension = extMatch[1];
        main = main.slice(0, extMatch.index).trim();
    }
    let digits = main.replace(/[\s\-().，,]/g, "");
    let note: string | undefined;
    if ( /^\+?861[3-9]\d{9}$/.test(digits)) {
        digits = digits.slice(digits.startsWith("+") ? 3 : 2);
        note = "已去国家码 86";
    }
    if (!/^\+?\d{7,15}$/.test(digits)) return null;
    if (extension) {
        digits = `${digits} 转 ${extension}`;
        note = note ? `${note}；含分机` : "含分机";
    }
    return { value: digits, note };
}

/** 生日规范化：YYYY-MM-DD 完整校验；无年份给 MM-DD 并加说明；支持农历前缀 */
export function normalizeBirthday(raw: string): { value: string; note?: string } | null {
    let body = raw.trim();
    let note: string | undefined;
    const lunar = body.match(LUNAR_PREFIX_RE);
    if (lunar) {
        note = "农历生日";
        body = body.slice(lunar[0].length).trim();
    }
    let m = body.match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?$/);
    if (m) {
        const [, year, month, day] = m;
        const date = new Date(Number(year), Number(month) - 1, Number(day));
        if (date.getMonth() !== Number(month) - 1 || date.getDate() !== Number(day)) return null;
        return { value: `${year}-${pad2(month)}-${pad2(day)}`, ...(lunar ? { note } : {}) };
    }
    m = body.match(/^(\d{1,2})[-/.月](\d{1,2})日?$/);
    if (m) {
        const month = Number(m[1]);
        const day = Number(m[2]);
        if (month < 1 || month > 12 || day < 1 || day > 31) return null;
        const noYearNote = "未提供年份";
        return { value: `${pad2(m[1])}-${pad2(m[2])}`, note: note ? `${note}；${noYearNote}` : noYearNote };
    }
    return null;
}

/** 一行内解析出一个键值对条目（certain） */
function parseKeyedValue(field: QuickFillField, rawValue: string, raw: string): QuickFillItem[] {
    const value = rawValue.trim();
    if (!value) return [];
    const withNote = (item: Omit<QuickFillItem, "raw" | "confidence">): QuickFillItem[] => [{
        ...item, raw, confidence: "certain",
    }];
    if (field === "phone") {
        const phone = normalizePhone(value);
        return phone ? withNote({ field, value: phone.value, ...(phone.note ? { note: phone.note } : {}) }) : [];
    }
    if (field === "birthday") {
        const birthday = normalizeBirthday(value);
        return birthday ? withNote({ field, value: birthday.value, ...(birthday.note ? { note: birthday.note } : {}) }) : [];
    }
    if (field === "tags") {
        const tags = value.split(/[,，、/;；\s]+/).map((tag) => tag.trim()).filter(Boolean);
        return tags.map((tag, index) => ({
            field, value: tag, raw,
            confidence: "certain" as const,
            ...(tags.length > 1 ? { note: `共 ${tags.length} 个标签（第 ${index + 1} 个）` } : {}),
        }));
    }
    return withNote({ field, value });
}

/** 无键 token 推断（likely）：邮箱/网址/电话/#标签/姓名；微信号裸词一律不猜 */
function parseBareToken(token: string, isFirstNameCandidate: boolean): QuickFillItem | null {
    if (EMAIL_RE.test(token)) return { field: "email", value: token.toLowerCase(), raw: token, confidence: "likely" };
    if (URL_RE.test(token)) {
        const value = /^www\./i.test(token) ? `https://${token}` : token;
        return { field: "website", value, raw: token, confidence: "likely" };
    }
    if (token.startsWith("#") && token.length > 1) {
        return { field: "tags", value: token.slice(1), raw: token, confidence: "likely" };
    }
    if (isNumericToken(token)) {
        const phone = normalizePhone(token);
        if (phone) return { field: "phone", value: phone.value, raw: token, confidence: "likely", ...(phone.note ? { note: phone.note } : {}) };
    }
    if (isFirstNameCandidate && /^[^\d@:：#，。；！？,.;!?]{1,20}$/.test(token)) {
        return { field: "name", value: token, raw: token, confidence: "likely" };
    }
    return null;
}

/** 行首列表序号/项目符号：`1.` `、` `)` `•` `-` 等 */
const LIST_MARKER_RE = /^(?:\d{1,3}[.、)）]|[•·\-–*])\s+/;

/**
 * 解析粘贴文本（FAST-01.1）。多行键值与单行 `张三 13800138000 wx:zhang_san` 均可；
 * 同一输入解析结果稳定（重复粘贴幂等）；取消预览不产生任何写入。
 */
export function parseContactText(text: string): QuickFillResult {
    const items: QuickFillItem[] = [];
    const unrecognized: string[] = [];
    const lines = text.split(/\r?\n/);
    for (const line of lines) {
        const trimmed = line.trim().replace(LIST_MARKER_RE, "");
        if (!trimmed) continue;

        /* 1) 行级「键: 值」 */
        const lineKV = trimmed.match(/^([^：:＝=｜|]{1,8})[：:＝=｜|]\s*(.+)$/);
        if (lineKV) {
            const field = lookupKey(lineKV[1]);
            if (field) {
                const parsed = parseKeyedValue(field, lineKV[2], trimmed);
                if (parsed.length) { items.push(...parsed); continue; }
                unrecognized.push(trimmed);
                continue;
            }
        }

        /* 2) 无键行：逐 token 推断（第一个非格式 token 记姓名候选） */
        const tokens = trimmed.split(/\s+/);
        let nameTaken = false;
        let matchedAny = false;
        for (const token of tokens) {
            /* token 内联键值（wx:zhang_san / 微信：zhang_san） */
            const inlineKV = token.match(/^([^\s：:]{1,6})[：:](.+)$/);
            if (inlineKV) {
                const field = lookupKey(inlineKV[1]);
                if (field) {
                    const parsed = parseKeyedValue(field, inlineKV[2], token);
                    if (parsed.length) { items.push(...parsed); matchedAny = true; continue; }
                }
            }
            const item = parseBareToken(token, !nameTaken);
            if (item) {
                if (item.field === "name") nameTaken = true;
                items.push(item);
                matchedAny = true;
            }
        }
        if (!matchedAny) unrecognized.push(trimmed);
    }
    return { items, unrecognized };
}

/** 从解析结果取某字段的候选值列表（预览 UI 用） */
export function quickFillValues(result: QuickFillResult, field: QuickFillField): string[] {
    return result.items.filter((item) => item.field === field).map((item) => item.value);
}
