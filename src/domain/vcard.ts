/**
 * vCard (.vcf) 导入导出的纯函数：折行展开、解析、序列化、转义。
 * 以主流导出器（iOS/Google 通讯录等）的 vCard 3.0 为主，兼容读取 4.0 的日期形式；
 * 只映射插件字段契约内的属性（docs/DATA-CONTRACT.md §7），其余属性忽略。
 * 映射语义决策见 docs/DECISIONS.md D-0013。
 */
import { birthdayToMs } from "./person.ts";

export interface VCardContact {
    name: string;
    /** 多号码以 " / " 连接（电话是单值文本字段，保留数据优先） */
    phone: string;
    /** 取首个（邮箱字段有格式校验，不做多值拼接） */
    email: string;
    /** 取首个 */
    website: string;
    /** YYYY-MM-DD；无法表示的（无年份、文本形式）为空串 */
    birthday: string;
    /** 仅当读入 X-LVCT-BDAY-LUNAR（本插件导出的农历回写）时为 true；外部 vCard 一律公历 */
    isLunar: boolean;
    /** CATEGORIES 属性 */
    tags: string[];
    /** 输入卡片里未映射到联系人字段契约的属性名；仅提示，不写入。 */
    unsupportedProperties?: string[];
    /** 日期等已识别但无法安全映射的属性说明；仅提示，不猜测写入。 */
    needsReview?: string[];
}

export interface VcfDocumentCheckpoint {
    requestId: string;
    notebookId: string;
    avId: string;
    dbBlockId: string;
    name: string;
    path: string;
    draftKey: string;
    state: "new" | "unknown" | "rejected" | "verified";
    docId?: string;
    itemId?: string;
}

interface VCardProperty {
    /** 大写属性名（已剥离 item1. 之类分组前缀） */
    name: string;
    /** 参数名(大写) → 参数值 */
    params: Record<string, string>;
    /** 已做 QP 解码、未做转义还原的值 */
    value: string;
}

/** 物理行展开：RFC 6350 折行（续行以空格/制表符开头）+ QP 软换行（续行不以空格开头的常见变体） */
export function unfoldVcfLines(text: string): string[] {
    const raw = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
    const unfolded: string[] = [];
    for (const line of raw) {
        const isContinuation = (line.startsWith(" ") || line.startsWith("\t")) && unfolded.length > 0;
        if (isContinuation) {
            unfolded[unfolded.length - 1] += line.slice(1);
            continue;
        }
        unfolded.push(line);
    }
    // 含 QUOTED-PRINTABLE 的行以 = 结尾时并接下一行（大量导出器的 QP 软换行不走 RFC 折行）
    const merged: string[] = [];
    for (let i = 0; i < unfolded.length; i++) {
        let line = unfolded[i];
        while (/QUOTED-PRINTABLE/i.test(line) && line.endsWith("=") && i + 1 < unfolded.length) {
            i += 1;
            line = line.slice(0, -1) + unfolded[i];
        }
        merged.push(line);
    }
    return merged;
}

/** 解析 .vcf 文本为联系人列表；容错：坏行跳过，无姓名的卡片丢弃，永不抛错 */
export function parseVcf(text: string): VCardContact[] {
    const lines = unfoldVcfLines(text);
    const cards: string[][] = [];
    let current: string[] | null = null;
    for (const line of lines) {
        const upper = line.trim().toUpperCase();
        if (upper === "BEGIN:VCARD") {
            current = [];
            continue;
        }
        if (upper === "END:VCARD") {
            if (current !== null && current.length > 0) cards.push(current);
            current = null;
            continue;
        }
        if (current !== null) current.push(line);
    }
    const contacts: VCardContact[] = [];
    for (const card of cards) {
        const contact = contactFromCard(card);
        if (contact) contacts.push(contact);
    }
    return contacts;
}

export function parseVcfForImport(text: string): VCardContact[] {
    if (!text.trim()) throw new Error("vCard 文件为空，请选择包含姓名的通讯录文件");
    let current: string[] | null = null;
    let cardNumber = 0;
    const contacts: VCardContact[] = [];
    for (const line of unfoldVcfLines(text)) {
        const marker = line.trim().toUpperCase();
        if (marker === "BEGIN:VCARD") {
            if (current) throw new Error(`第 ${cardNumber} 张卡片缺少 END:VCARD，请修复文件后重试`);
            current = [];
            cardNumber += 1;
        } else if (marker === "END:VCARD") {
            if (!current) throw new Error("vCard 的开始/结束标记不匹配，请修复文件后重试");
            const contact = contactFromCard(current);
            if (!contact) throw new Error(`第 ${cardNumber} 张卡片缺少 FN/N 姓名，未生成空联系人`);
            contacts.push(contact);
            current = null;
        } else if (current) {
            if (line.trim() && !parsePropertyLine(line)) throw new Error(`第 ${cardNumber} 张卡片含损坏属性行，请核对原文件`);
            current.push(line);
        } else if (line.trim()) {
            throw new Error("文件包含卡片以外的内容，请选择有效的 vCard 文件");
        }
    }
    if (current) throw new Error(`第 ${cardNumber} 张卡片未结束，请修复文件后重试`);
    if (!contacts.length) throw new Error("文件没有有效 vCard 卡片，请核对 BEGIN:VCARD/END:VCARD 标记");
    return contacts;
}

function contactFromCard(lines: string[]): VCardContact | null {
    const props: VCardProperty[] = [];
    for (const line of lines) {
        const prop = parsePropertyLine(line);
        if (prop) props.push(prop);
    }
    const first = (name: string) => {
        const hit = props.find((prop) => prop.name === name);
        return hit ? unescapeVcf(hit.value) : "";
    };
    const all = (name: string) => props.filter((prop) => prop.name === name).map((prop) => prop.value);

    const fn = first("FN");
    const name = (fn || structuredName(first("N"))).trim();
    if (!name) return null;

    const phones = all("TEL")
        .map((value) => unescapeVcf(value).trim())
        .filter((value) => value.length > 0);
    const tags = all("CATEGORIES")
        .flatMap((value) => splitUnescaped(value, ","))
        .map((value) => unescapeVcf(value).trim())
        .filter((value) => value.length > 0);

    const bday = normalizeVcfDate(first("BDAY"));
    let birthday = bday;
    let isLunar = false;
    if (!bday) {
        const lunar = normalizeVcfDate(first("X-LVCT-BDAY-LUNAR"));
        if (lunar) {
            birthday = lunar;
            isLunar = true;
        }
    }

    const supported = new Set(["VERSION", "FN", "N", "TEL", "EMAIL", "URL", "BDAY", "CATEGORIES", "X-LVCT-BDAY-LUNAR"]);
    const unsupportedProperties = [...new Set(props.map((prop) => prop.name).filter((name) => !supported.has(name)))];
    for (const property of ["EMAIL", "URL"]) {
        if (all(property).length > 1) unsupportedProperties.push(`${property}（第 2 项起）`);
    }
    const needsReview: string[] = [];
    if (first("BDAY") && !bday) needsReview.push("BDAY");
    if (first("X-LVCT-BDAY-LUNAR") && !isLunar && !birthday) needsReview.push("X-LVCT-BDAY-LUNAR");

    return {
        name,
        phone: [...new Set(phones)].join(" / "),
        email: first("EMAIL").trim(),
        website: first("URL").trim(),
        birthday,
        isLunar,
        tags,
        ...(unsupportedProperties.length > 0 ? { unsupportedProperties } : {}),
        ...(needsReview.length > 0 ? { needsReview } : {}),
    };
}

/** 属性行 → 名称/参数/值；值与名称以第一个不在引号内的冒号为界 */
function parsePropertyLine(line: string): VCardProperty | null {
    let inQuotes = false;
    let colon = -1;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') inQuotes = !inQuotes;
        else if (ch === ":" && !inQuotes) {
            colon = i;
            break;
        }
    }
    if (colon <= 0) return null;
    const segments = line.slice(0, colon).split(";");
    let name = segments[0].trim().toUpperCase();
    const dot = name.indexOf(".");
    if (dot >= 0) name = name.slice(dot + 1);
    if (!name) return null;

    const params: Record<string, string> = {};
    for (const segment of segments.slice(1)) {
        const eq = segment.indexOf("=");
        if (eq < 0) continue;
        const key = segment.slice(0, eq).trim().toUpperCase();
        const value = segment.slice(eq + 1).replace(/^"|"$/g, "");
        if (key) params[key] = value;
    }

    let value = line.slice(colon + 1);
    const encoding = (params.ENCODING ?? "").toUpperCase();
    if (encoding === "QUOTED-PRINTABLE" || encoding === "QP") {
        value = decodeQuotedPrintable(value, params.CHARSET ?? "");
    }
    return { name, params, value };
}

/** N 结构名（姓;名;…）→ 全名；中文姓名惯例姓+名连写 */
function structuredName(raw: string): string {
    if (!raw) return "";
    const [family = "", given = ""] = splitUnescaped(raw, ";").map((part) => unescapeVcf(part));
    return (family + given).trim();
}

/** BDAY 值 → YYYY-MM-DD；接受 19900520 / 1990-05-20 / 带 T 时间后缀；无年份（--0520）与文本形式返回空串 */
export function normalizeVcfDate(raw: string): string {
    const value = raw.trim().toUpperCase();
    let match = /^(\d{4})(\d{2})(\d{2})(?:T.*)?$/.exec(value);
    if (!match) match = /^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/.exec(value);
    if (!match) return "";
    const ymd = `${match[1]}-${match[2]}-${match[3]}`;
    return birthdayToMs(ymd) !== null ? ymd : "";
}

/** QP 解码：=XX 十六进制字节序列按字符集还原；残留软换行（=后接换行）剔除 */
function decodeQuotedPrintable(value: string, charset: string): string {
    const bytes: number[] = [];
    for (let i = 0; i < value.length; i++) {
        const ch = value[i];
        if (ch === "=") {
            const hex = value.slice(i + 1, i + 3);
            if (/^[0-9a-fA-F]{2}$/.test(hex)) {
                bytes.push(parseInt(hex, 16));
                i += 2;
                continue;
            }
            if (value[i + 1] === "\n" || value[i + 1] === "\r") {
                i += 1;
                continue;
            }
        }
        bytes.push(ch.charCodeAt(0) & 0xff);
    }
    try {
        return new TextDecoder(charset.trim() || "utf-8").decode(new Uint8Array(bytes));
    } catch {
        return new TextDecoder("utf-8").decode(new Uint8Array(bytes));
    }
}

/** 按未转义的分隔符切分（\, 与 \; 不切），保留转义序列待后续还原 */
export function splitUnescaped(value: string, separator: string): string[] {
    const parts: string[] = [];
    let current = "";
    for (let i = 0; i < value.length; i++) {
        const ch = value[i];
        if (ch === "\\" && i + 1 < value.length) {
            current += ch + value[i + 1];
            i += 1;
            continue;
        }
        if (ch === separator) {
            parts.push(current);
            current = "";
            continue;
        }
        current += ch;
    }
    parts.push(current);
    return parts;
}

/** 还原 vCard 转义：\n \N → 换行，其余（\, \; \\）去反斜杠 */
export function unescapeVcf(value: string): string {
    return value.replace(/\\(.)/g, (_, ch: string) => (ch === "n" || ch === "N" ? "\n" : ch));
}

/** vCard 转义：反斜杠、换行、逗号、分号 */
export function escapeVcf(value: string): string {
    return value
        .replace(/\\/g, "\\\\")
        .replace(/\r?\n/g, "\\n")
        .replace(/,/g, "\\,")
        .replace(/;/g, "\\;");
}

/** 序列化为 vCard 3.0 文本（CRLF 行尾）；农历生日写 X-LVCT-BDAY-LUNAR 以便回导不丢语义 */
export function serializeVcf(people: readonly VCardContact[]): string {
    const lines: string[] = [];
    for (const person of people) {
        const name = person.name.trim();
        if (!name) continue;
        lines.push("BEGIN:VCARD", "VERSION:3.0", `N:;${escapeVcf(name)};;;`, `FN:${escapeVcf(name)}`);
        const phone = person.phone.trim();
        if (phone) lines.push(`TEL;TYPE=CELL:${escapeVcf(phone)}`);
        const email = person.email.trim();
        if (email) lines.push(`EMAIL;TYPE=INTERNET:${escapeVcf(email)}`);
        const website = person.website.trim();
        if (website) lines.push(`URL:${escapeVcf(website)}`);
        if (person.birthday) {
            if (person.isLunar) lines.push(`X-LVCT-BDAY-LUNAR:${person.birthday}`);
            else lines.push(`BDAY:${person.birthday}`);
        }
        if (person.tags.length > 0) {
            lines.push(`CATEGORIES:${person.tags.map((tag) => escapeVcf(tag)).join(",")}`);
        }
        lines.push("END:VCARD");
    }
    return lines.length > 0 ? lines.join("\r\n") + "\r\n" : "";
}
