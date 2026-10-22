/**
 * vCard (.vcf) 导入导出的纯函数：折行展开、解析、序列化、转义。
 * 以主流导出器（iOS/Google 通讯录等）的 vCard 3.0 为主，兼容读取 4.0 的日期形式；
 * 只映射插件字段契约内的属性（docs/DATA-CONTRACT.md §7），其余属性忽略。
 * 映射语义决策见 docs/DECISIONS.md D-0013。
 */
import { isValidDateKey } from "./date-key.ts";

/** 源卡片中的联系方式候选；只供本次导入预览，不是持久条目身份。 */
export interface VCardMethodPreview {
    field: "phone" | "email" | "website";
    property: "TEL" | "EMAIL" | "URL";
    /** 同名属性在本卡中的 1-based 序号，包括前序空值。 */
    sourceIndex: number;
    /** TYPE 参数及 vCard 2.1 裸类型，按源顺序保留，不参与编码解码。 */
    types: string[];
    value: string;
    /** 空值仍可供核对来源，但不能作为本次单值导入候选。 */
    disabled: boolean;
}

export interface VCardMethodExportEntry {
    value: string;
    type?: string;
}

export interface VCardContact {
    name: string;
    wechat?: string;
    /** 多号码以 " / " 连接（电话是单值文本字段，保留数据优先） */
    phone: string;
    /** 解析阶段保留全部 TEL，供导入预览显示；不属于联系人持久化字段。 */
    phoneValues?: string[];
    /** 导出时可选的多电话详细列表（带 TYPE=WORK/HOME/CELL 标签） */
    extraPhones?: readonly VCardMethodExportEntry[];
    /** 取首个（邮箱字段有格式校验，不做多值拼接） */
    email: string;
    /** 解析阶段保留全部 EMAIL，供导入预览显示；当前只写入首项。 */
    emailValues?: string[];
    /** 导出时可选的多邮箱列表（带 TYPE=WORK/HOME 标签） */
    extraEmails?: readonly VCardMethodExportEntry[];
    /** 取首个 */
    website: string;
    /** 解析阶段保留全部 URL，供导入预览显示；当前只写入首项。 */
    websiteValues?: string[];
    /** 导出时可选的多网址列表 */
    extraWebsites?: readonly VCardMethodExportEntry[];
    /** 原卡含重复 TEL/EMAIL/URL 时保留全部候选；只在解析内存中使用。 */
    methodPreview?: VCardMethodPreview[];
    /** 组织/公司名称 */
    org?: string;
    /** 职位/头衔 */
    title?: string;
    /** 备注说明 */
    note?: string;
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
    /** 独立收集类型标签，避免重复 TYPE 覆盖或裸参数影响编码参数。 */
    types: string[];
    /** 已做 QP 解码、未做转义还原的值 */
    value: string;
}

/** 物理行展开：RFC 6350 折行（续行以空格/制表符开头）+ QP 软换行（续行不以空格开头的常见变体） */
export function unfoldVcfLines(text: string): string[] {
    // File.text() decodes UTF-8, preserving a leading BOM when the exporter
    // writes one.  Treat it as transport metadata so strict import does not
    // mistake `\uFEFFBEGIN:VCARD` for content outside a card (some mobile
    // contacts exporters, including common Android variants, do this).
    const raw = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
    const unfolded: string[] = [];
    for (const line of raw) {
        // A marker with accidental leading folding whitespace must retain its
        // card boundary. Otherwise tolerant parsing can append `BEGIN:VCARD`
        // or `END:VCARD` to a preceding QP value and silently lose a card.
        const marker = line.trim().toUpperCase();
        const isCardMarker = marker === "BEGIN:VCARD" || marker === "END:VCARD";
        const isContinuation = !isCardMarker && (line.startsWith(" ") || line.startsWith("\t")) && unfolded.length > 0;
        if (isContinuation) {
            const previous = unfolded[unfolded.length - 1];
            // Some exporters combine a QP soft break (`=`) with RFC 6350's
            // leading-space continuation. The soft-break marker is removed
            // before the RFC continuation whitespace so it is not doubled.
            unfolded[unfolded.length - 1] = hasQuotedPrintableEncoding(previous) && previous.endsWith("=")
                ? previous.slice(0, -1) + line.slice(1)
                : previous + line.slice(1);
            continue;
        }
        unfolded.push(line);
    }
    // 含 QP 编码参数的属性行以 = 结尾时并接下一逻辑行（大量导出器的
    // QP 软换行不走 RFC 折行）。只根据属性头判断，不能因为普通值里出现
    // "QUOTED-PRINTABLE" 就吞掉下一属性；BEGIN/END 和可识别属性头也必须保留。
    const merged: string[] = [];
    for (let i = 0; i < unfolded.length; i++) {
        let line = unfolded[i];
        while (hasQuotedPrintableEncoding(line) && line.endsWith("=") && i + 1 < unfolded.length) {
            const next = unfolded[i + 1];
            const marker = next.trim().toUpperCase();
            if (!next.trim() || marker === "BEGIN:VCARD" || marker === "END:VCARD" || looksLikePropertyLine(next)) break;
            i += 1;
            line = line.slice(0, -1) + unfolded[i];
        }
        merged.push(line);
    }
    return merged;
}

/** 解析 .vcf 文本为联系人列表；容错：坏行跳过，无姓名的卡片丢弃，永不抛错 */
export function parseVcf(text: string, options: ContactFromCardOptions = {}): VCardContact[] {
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
        const contact = contactFromCard(card, options);
        if (contact) contacts.push(contact);
    }
    return contacts;
}

export function parseVcfForImport(text: string, options: ContactFromCardOptions = {}): VCardContact[] {
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
            const contact = contactFromCard(current, options);
            // Android/AOSP exporters may emit a valid phone-only card with
            // empty FN/N.  The vCard contract says such cards are discarded;
            // do that per card so a later named contact can still be imported.
            if (contact) contacts.push(contact);
            current = null;
        } else if (current) {
            if (line.trim() && !parsePropertyLine(line)) throw new Error(`第 ${cardNumber} 张卡片含损坏属性行，请核对原文件`);
            current.push(line);
        } else if (line.trim()) {
            throw new Error("文件包含卡片以外的内容，请选择有效的 vCard 文件");
        }
    }
    if (current) throw new Error(`第 ${cardNumber} 张卡片未结束，请修复文件后重试`);
    if (!contacts.length) throw new Error("文件没有有效 vCard 卡片，请核对 FN/N 姓名和 BEGIN:VCARD/END:VCARD 标记");
    return contacts;
}

export interface ContactFromCardOptions {
    /**
     * 当无 FN/N/NICKNAME/ORG 时，是否允许以主要电话或邮箱智能暂代姓名，
     * 避免特定手机通讯录导出纯号码卡片或无名名片时导致整包文件导入被拒（解决 Issue #35）。
     */
    fallbackToPhoneOrEmail?: boolean;
}

function contactFromCard(lines: string[], options: ContactFromCardOptions = {}): VCardContact | null {
    const props: VCardProperty[] = [];
    for (const line of lines) {
        const prop = parsePropertyLine(line);
        if (prop) props.push(prop);
    }
    const rawFirst = (name: string) => {
        const hit = props.find((prop) => prop.name === name);
        return hit ? hit.value : "";
    };
    const first = (name: string) => unescapeVcf(rawFirst(name));
    const all = (name: string) => props.filter((prop) => prop.name === name).map((prop) => prop.value);

    // Empty or whitespace-only FN values are not usable names; allow a valid
    // structured N value to serve as the fallback in that case.
    // If both FN and N are missing, allow NICKNAME or ORG (company/organization name,
    // frequently emitted by Xiaomi/Android contact exports) to serve as fallback.
    const fn = first("FN").trim();
    const nickname = first("NICKNAME").trim();
    const org = first("ORG").split(";")[0]?.trim() || "";

    const phones = all("TEL")
        .map((value) => unescapeVcf(value).trim())
        .filter((value) => value.length > 0);
    const emails = all("EMAIL").map((value) => unescapeVcf(value).trim()).filter((value) => value.length > 0);

    let name = fn || structuredName(rawFirst("N")).trim() || nickname || org;
    const isFallbackName = !name && Boolean(options.fallbackToPhoneOrEmail);
    if (!name && options.fallbackToPhoneOrEmail) {
        const title = first("TITLE").trim();
        const rawNote = first("NOTE").trim();
        const noteFirstLine = rawNote ? rawNote.split("\n")[0].trim().slice(0, 30) : "";
        name = title || noteFirstLine || (phones.length > 0 ? `未命名 (${phones[0]})` : emails.length > 0 ? `未命名 (${emails[0]})` : "");
    }
    if (!name) return null;

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
    if (isFallbackName) needsReview.push("姓名：原卡片缺少姓名属性，已智能暂代");
    if (first("BDAY") && !bday) needsReview.push("BDAY");
    if (first("X-LVCT-BDAY-LUNAR") && !isLunar && !birthday) needsReview.push("X-LVCT-BDAY-LUNAR");

    // Keep source order and duplicate values for the import preview. The
    // legacy scalar phone field still de-duplicates before joining, so this
    // does not change the existing AV-compatible value.
    const uniquePhones = [...new Set(phones)];
    const websites = all("URL").map((value) => unescapeVcf(value).trim()).filter((value) => value.length > 0);
    const methodPreview = contactMethodPreview(props);
    if (phones.length > 1) needsReview.push("TEL（多项已合并到电话字段）");
    return {
        name,
        phone: uniquePhones.join(" / "),
        ...(phones.length > 1 ? { phoneValues: phones } : {}),
        email: emails[0] ?? "",
        ...(emails.length > 1 ? { emailValues: emails } : {}),
        website: websites[0] ?? "",
        ...(websites.length > 1 ? { websiteValues: websites } : {}),
        ...(methodPreview ? { methodPreview } : {}),
        birthday,
        isLunar,
        tags,
        ...(unsupportedProperties.length > 0 ? { unsupportedProperties } : {}),
        ...(needsReview.length > 0 ? { needsReview } : {}),
    };
}

function contactMethodPreview(props: readonly VCardProperty[]): VCardMethodPreview[] | undefined {
    const fields = { TEL: "phone", EMAIL: "email", URL: "website" } as const;
    const sourceIndexes = { TEL: 0, EMAIL: 0, URL: 0 };
    const candidates: VCardMethodPreview[] = [];
    for (const prop of props) {
        if (prop.name !== "TEL" && prop.name !== "EMAIL" && prop.name !== "URL") continue;
        const value = unescapeVcf(prop.value).trim();
        candidates.push({
            field: fields[prop.name], property: prop.name, sourceIndex: ++sourceIndexes[prop.name],
            types: [...prop.types], value, disabled: value.length === 0,
        });
    }
    // Preserve the single-value parse/serialize shape. Source cardinality,
    // including empty properties, decides whether the richer preview is needed.
    return Object.values(sourceIndexes).some((count) => count > 1) ? candidates : undefined;
}

/** 属性行 → 名称/参数/值；值与名称以第一个不在引号内的冒号为界 */
function parsePropertyLine(line: string): VCardProperty | null {
    const colon = findValueColon(line);
    if (colon <= 0) return null;
    const segments = line.slice(0, colon).split(";");
    let name = segments[0].trim().toUpperCase();
    const dot = name.indexOf(".");
    if (dot >= 0) name = name.slice(dot + 1);
    if (!name) return null;

    const params: Record<string, string> = {};
    const types: string[] = [];
    for (const segment of segments.slice(1)) {
        const eq = segment.indexOf("=");
        if (eq < 0) {
            types.push(...splitPreviewTypes(segment));
            continue;
        }
        const key = segment.slice(0, eq).trim().toUpperCase();
        const value = segment.slice(eq + 1).replace(/^"|"$/g, "");
        if (key === "TYPE") types.push(...splitPreviewTypes(value));
        if (key) params[key] = value;
    }

    let value = line.slice(colon + 1);
    const encoding = (params.ENCODING ?? "").toUpperCase();
    if (encoding === "QUOTED-PRINTABLE" || encoding === "QP") {
        if (!isValidQuotedPrintable(value)) return null;
        value = decodeQuotedPrintable(value, params.CHARSET ?? "");
    }
    return { name, params, types, value };
}

function splitPreviewTypes(value: string): string[] {
    return value.trim().replace(/^"|"$/g, "").split(",")
        .map((type) => type.trim().replace(/^"|"$/g, ""))
        .filter((type) => type.length > 0);
}

function findValueColon(line: string): number {
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') inQuotes = !inQuotes;
        else if (ch === ":" && !inQuotes) return i;
    }
    return -1;
}

function hasQuotedPrintableEncoding(line: string): boolean {
    const colon = findValueColon(line);
    if (colon <= 0) return false;
    const segments = line.slice(0, colon).split(";");
    for (const segment of segments.slice(1)) {
        const eq = segment.indexOf("=");
        if (eq < 0) continue;
        const key = segment.slice(0, eq).trim().toUpperCase();
        const value = segment.slice(eq + 1).trim().replace(/^"|"$/g, "").toUpperCase();
        if (key === "ENCODING" && (value === "QP" || value === "QUOTED-PRINTABLE")) return true;
    }
    return false;
}

function looksLikePropertyLine(line: string): boolean {
    const colon = findValueColon(line);
    if (colon <= 0) return false;
    const head = line.slice(0, colon).trim();
    // RFC property/group tokens and parameter text. A QP data continuation
    // normally starts with '=', so this intentionally treats alphabetic
    // `name:value` as an independent (possibly unknown) property.
    return /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)?(?:;[^\r\n:]*)*$/.test(head);
}

function isValidQuotedPrintable(value: string): boolean {
    for (let i = 0; i < value.length; i++) {
        if (value[i] !== "=") continue;
        if (!/^[0-9a-fA-F]{2}$/.test(value.slice(i + 1, i + 3))) return false;
        i += 2;
    }
    return true;
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
    return isValidDateKey(ymd) ? ymd : "";
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
            if (value[i + 1] === "\r" && value[i + 2] === "\n") {
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

        // 组织与职位
        if (person.org?.trim()) {
            lines.push(`ORG:${escapeVcf(person.org.trim())}`);
        }
        if (person.title?.trim()) {
            lines.push(`TITLE:${escapeVcf(person.title.trim())}`);
        }

        // 电话多值与 TYPE 标签保真导出
        if (person.extraPhones && person.extraPhones.length > 0) {
            for (const ep of person.extraPhones) {
                const val = ep.value.trim();
                if (!val) continue;
                const typeTag = ep.type?.trim().toUpperCase() || "CELL";
                lines.push(`TEL;TYPE=${escapeVcf(typeTag)}:${escapeVcf(val)}`);
            }
        } else {
            const phone = person.phone.trim();
            if (phone) lines.push(`TEL;TYPE=CELL:${escapeVcf(phone)}`);
        }

        // 邮箱多值与 TYPE 标签保真导出
        if (person.extraEmails && person.extraEmails.length > 0) {
            for (const ee of person.extraEmails) {
                const val = ee.value.trim();
                if (!val) continue;
                const typeTag = ee.type?.trim().toUpperCase() || "INTERNET";
                lines.push(`EMAIL;TYPE=${escapeVcf(typeTag)}:${escapeVcf(val)}`);
            }
        } else {
            const email = person.email.trim();
            if (email) lines.push(`EMAIL;TYPE=INTERNET:${escapeVcf(email)}`);
        }

        // 网址多值保真导出
        if (person.extraWebsites && person.extraWebsites.length > 0) {
            for (const ew of person.extraWebsites) {
                const val = ew.value.trim();
                if (!val) continue;
                lines.push(`URL:${escapeVcf(val)}`);
            }
        } else {
            const website = person.website.trim();
            if (website) lines.push(`URL:${escapeVcf(website)}`);
        }

        if (person.birthday) {
            if (person.isLunar) lines.push(`X-LVCT-BDAY-LUNAR:${person.birthday}`);
            else lines.push(`BDAY:${person.birthday}`);
        }
        if (person.tags.length > 0) {
            lines.push(`CATEGORIES:${person.tags.map((tag) => escapeVcf(tag)).join(",")}`);
        }
        if (person.note?.trim()) {
            lines.push(`NOTE:${escapeVcf(person.note.trim())}`);
        }
        lines.push("END:VCARD");
    }
    return lines.length > 0 ? lines.join("\r\n") + "\r\n" : "";
}
