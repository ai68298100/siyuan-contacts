/**
 * CSV / Excel 导出的联系人表格纯函数解析器与模板生成器。
 * 遵循 RFC 4180 规范并兼容带有 UTF-8 BOM 的中文 Excel 文件。
 * 纯函数，零外部依赖（严格遵守 domain/ 架构约束）。
 */
import type { VCardContact } from "./vcard.ts";
import { isValidDateKey } from "./date-key.ts";

/** 解析标准 CSV 格式文本（处理双引号转义、逗号分隔、换行） */
export function parseCsvRows(text: string): string[][] {
    // 移除 UTF-8 BOM（若存在）
    const cleanText = text.replace(/^\uFEFF/, "");
    const rows: string[][] = [];
    let currentRow: string[] = [];
    let currentField = "";
    let inQuotes = false;

    for (let i = 0; i < cleanText.length; i++) {
        const char = cleanText[i];
        const nextChar = cleanText[i + 1];

        if (inQuotes) {
            if (char === '"') {
                if (nextChar === '"') {
                    // 转义双引号 "" -> "
                    currentField += '"';
                    i++;
                } else {
                    // 离开引号
                    inQuotes = false;
                }
            } else {
                currentField += char;
            }
        } else {
            if (char === '"') {
                inQuotes = true;
            } else if (char === ",") {
                currentRow.push(currentField.trim());
                currentField = "";
            } else if (char === "\r") {
                if (nextChar === "\n") i++;
                currentRow.push(currentField.trim());
                if (currentRow.some((field) => field.length > 0)) {
                    rows.push(currentRow);
                }
                currentRow = [];
                currentField = "";
            } else if (char === "\n") {
                currentRow.push(currentField.trim());
                if (currentRow.some((field) => field.length > 0)) {
                    rows.push(currentRow);
                }
                currentRow = [];
                currentField = "";
            } else {
                currentField += char;
            }
        }
    }

    if (currentField.length > 0 || currentRow.length > 0) {
        currentRow.push(currentField.trim());
        if (currentRow.some((field) => field.length > 0)) {
            rows.push(currentRow);
        }
    }

    return rows;
}

const COLUMN_ALIASES: Record<string, string[]> = {
    name: ["姓名", "名字", "联系人", "全名", "name", "fullname", "full name", "contact"],
    phone: ["电话", "手机", "手机号", "电话号码", "移动电话", "手机号码", "phone", "mobile", "tel", "cell"],
    wechat: ["微信", "微信号", "wechat", "weixin", "wx"],
    email: ["邮箱", "电子邮箱", "邮件", "email", "mail"],
    birthday: ["生日", "出生日期", "公历生日", "birthday", "bday"],
    isLunar: ["是否农历", "农历", "阴历", "是否阴历", "islunar", "lunar"],
    group: ["分组", "群组", "类别", "分类", "group", "category"],
    tags: ["标签", "tag", "tags"],
    org: ["组织", "公司", "单位", "学校", "工作单位", "机构", "organization", "company", "org", "school"],
    department: ["部门", "科室", "院系", "department", "dept"],
    title: ["职位", "职务", "头衔", "职称", "title", "position"],
    note: ["备注", "说明", "个人备注", "note", "notes", "remark"],
};

function matchColumn(header: string): string | null {
    const normalized = header.toLowerCase().replace(/[\s*_#()（）*]/g, "").trim();
    for (const [key, aliases] of Object.entries(COLUMN_ALIASES)) {
        for (const alias of aliases) {
            const normalizedAlias = alias.toLowerCase().replace(/[\s*_#()（）*]/g, "").trim();
            if (normalized === normalizedAlias || normalized.startsWith(normalizedAlias)) {
                return key;
            }
        }
    }
    return null;
}

function parseBooleanValue(val: string): boolean {
    const s = val.trim().toLowerCase();
    return ["是", "对", "yes", "y", "true", "1", "农历", "阴历"].includes(s);
}

function normalizeBirthday(raw: string): string {
    const trimmed = raw.trim();
    if (!trimmed) return "";
    let match = /^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?$/.exec(trimmed);
    if (match) {
        const y = match[1];
        const m = match[2].padStart(2, "0");
        const d = match[3].padStart(2, "0");
        const ymd = `${y}-${m}-${d}`;
        return isValidDateKey(ymd) ? ymd : "";
    }
    match = /^(\d{4})(\d{2})(\d{2})$/.exec(trimmed);
    if (match) {
        const ymd = `${match[1]}-${match[2]}-${match[3]}`;
        return isValidDateKey(ymd) ? ymd : "";
    }
    return "";
}

/** 解析 CSV 内容为标准联系人列表（兼容各种别名与中英文表头） */
export function parseCsvContacts(csvText: string): VCardContact[] {
    const rows = parseCsvRows(csvText);
    if (rows.length < 2) {
        throw new Error("CSV 文件缺少有效数据行，请核对后重试");
    }

    // 寻找表头行
    let headerRowIndex = -1;
    let fieldIndices: Record<string, number> = {};

    for (let r = 0; r < Math.min(rows.length, 5); r++) {
        const row = rows[r];
        const mapping: Record<string, number> = {};
        for (let c = 0; c < row.length; c++) {
            const matched = matchColumn(row[c]);
            if (matched && mapping[matched] === undefined) {
                mapping[matched] = c;
            }
        }
        if (mapping.name !== undefined) {
            headerRowIndex = r;
            fieldIndices = mapping;
            break;
        }
    }

    if (headerRowIndex === -1 || fieldIndices.name === undefined) {
        throw new Error("CSV 文件未找到「姓名」列，请下载标准模板核对表头");
    }

    const contacts: VCardContact[] = [];

    for (let r = headerRowIndex + 1; r < rows.length; r++) {
        const row = rows[r];
        const nameCol = fieldIndices.name;
        const name = (row[nameCol] ?? "").trim();
        if (!name) continue; // 姓名为空跳过

        const phone = fieldIndices.phone !== undefined ? (row[fieldIndices.phone] ?? "").trim() : "";
        const email = fieldIndices.email !== undefined ? (row[fieldIndices.email] ?? "").trim() : "";
        const wechat = fieldIndices.wechat !== undefined ? (row[fieldIndices.wechat] ?? "").trim() : "";
        const bdayRaw = fieldIndices.birthday !== undefined ? (row[fieldIndices.birthday] ?? "").trim() : "";
        const isLunarRaw = fieldIndices.isLunar !== undefined ? (row[fieldIndices.isLunar] ?? "").trim() : "";
        const tagsRaw = fieldIndices.tags !== undefined ? (row[fieldIndices.tags] ?? "").trim() : "";
        const org = fieldIndices.org !== undefined ? (row[fieldIndices.org] ?? "").trim() : undefined;
        const title = fieldIndices.title !== undefined ? (row[fieldIndices.title] ?? "").trim() : undefined;
        const note = fieldIndices.note !== undefined ? (row[fieldIndices.note] ?? "").trim() : undefined;

        const birthday = normalizeBirthday(bdayRaw);
        const isLunar = parseBooleanValue(isLunarRaw);

        const tags = tagsRaw
            ? tagsRaw.split(/[\s,、，#]+/).map((t) => t.trim()).filter(Boolean)
            : [];

        contacts.push({
            name,
            phone,
            email,
            wechat,
            website: "",
            birthday,
            isLunar,
            tags,
            org,
            title,
            note,
        });
    }

    if (contacts.length === 0) {
        throw new Error("CSV 文件中未读取到任何有效联系人数据");
    }

    return contacts;
}

/** 生成自带 UTF-8 BOM 的标准 CSV 模版，Excel 双击打开绝不乱码 */
export function generateCsvTemplate(): string {
    const BOM = "\uFEFF";
    const header = "姓名*,电话,微信号,邮箱,生日(YYYY-MM-DD),是否农历(是/否),分组,标签(空格分隔),组织/公司,部门,职位,备注";
    const row1 = "张三,13800138000,zhangsan_wx,zhangsan@example.com,1992-05-20,否,同事,投资 业务,金雨茂物,投资部,副总裁,大学同学";
    const row2 = "李四,13900139000,lisi_wx,lisi@example.com,1995-08-15,是,朋友,老乡,,技术部,资深工程师,";
    return `${BOM}${header}\r\n${row1}\r\n${row2}\r\n`;
}
