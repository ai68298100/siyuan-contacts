import { test } from "node:test";
import assert from "node:assert/strict";
import {
    parseVcf,
    serializeVcf,
    normalizeVcfDate,
    unfoldVcfLines,
    escapeVcf,
    unescapeVcf,
    splitUnescaped,
} from "../src/domain/vcard.ts";
import type { VCardContact } from "../src/domain/vcard.ts";

const base = (overrides: Partial<VCardContact> = {}): VCardContact => ({
    name: "张三",
    phone: "",
    email: "",
    website: "",
    birthday: "",
    isLunar: false,
    tags: [],
    ...overrides,
});

test("unfoldVcfLines：RFC 折行（空格续行）与 QP 软换行（无空格续行）都展开为单行", () => {
    const rfc = "BEGIN:VCARD\r\nFN:很长很长的\r\n 续行名字\r\nEND:VCARD";
    assert.deepEqual(unfoldVcfLines(rfc), ["BEGIN:VCARD", "FN:很长很长的续行名字", "END:VCARD"]);

    const qp = "N;ENCODING=QUOTED-PRINTABLE;CHARSET=UTF-8:=E5=B0=8F=\r\n=E9=A9=B4";
    assert.deepEqual(unfoldVcfLines(qp), ["N;ENCODING=QUOTED-PRINTABLE;CHARSET=UTF-8:=E5=B0=8F=E9=A9=B4"]);
});

test("parseVcf：vCard 3.0 基本卡片，多 TEL 以 ' / ' 连接、EMAIL/URL 取首个、CATEGORIES 进标签", () => {
    const vcf = [
        "BEGIN:VCARD",
        "VERSION:3.0",
        "N:张;三;;;",
        "FN:张三",
        "TEL;TYPE=CELL:13800138000",
        "TEL;TYPE=WORK:021-12345678",
        "EMAIL;TYPE=INTERNET:zhang@example.com",
        "EMAIL;TYPE=HOME:zhang2@example.com",
        "URL:https://zhang.example.com",
        "CATEGORIES:球友,重点",
        "END:VCARD",
    ].join("\r\n");
    const [contact] = parseVcf(vcf);
    assert.ok(contact);
    assert.equal(contact.name, "张三");
    assert.equal(contact.phone, "13800138000 / 021-12345678");
    assert.equal(contact.email, "zhang@example.com");
    assert.equal(contact.website, "https://zhang.example.com");
    assert.deepEqual(contact.tags, ["球友", "重点"]);
    assert.equal(contact.isLunar, false);
});

test("parseVcf：BDAY 接受紧凑/ISO/带时间三种形式，无年份（--0520）与文本形式丢弃", () => {
    const build = (bday: string) => `BEGIN:VCARD\r\nFN:李四\r\nBDAY:${bday}\r\nEND:VCARD`;
    assert.equal(parseVcf(build("19900520"))[0].birthday, "1990-05-20");
    assert.equal(parseVcf(build("1990-05-20"))[0].birthday, "1990-05-20");
    assert.equal(parseVcf(build("1990-05-20T08:30:00Z"))[0].birthday, "1990-05-20");
    assert.equal(parseVcf(build("--0520"))[0].birthday, "");
    assert.equal(parseVcf(build("五月二十"))[0].birthday, "");
    assert.equal(parseVcf(build("1990-13-40"))[0].birthday, "", "日历不存在的日期丢弃");
});

test("parseVcf：本插件导出的 X-LVCT-BDAY-LUNAR 回读为农历生日", () => {
    const vcf = "BEGIN:VCARD\r\nFN:王五\r\nX-LVCT-BDAY-LUNAR:1990-05-20\r\nEND:VCARD";
    const [contact] = parseVcf(vcf);
    assert.equal(contact.birthday, "1990-05-20");
    assert.equal(contact.isLunar, true);
});

test("parseVcf：不支持字段明确列出，非法日期进入人工核对且不猜测", () => {
    const [contact] = parseVcf("BEGIN:VCARD\r\nFN:王五\r\nORG:示例公司\r\nADR:地址\r\nPHOTO:data\r\nBDAY:五月二十\r\nEND:VCARD");
    assert.deepEqual(contact.unsupportedProperties, ["ORG", "ADR", "PHOTO"]);
    assert.deepEqual(contact.needsReview, ["BDAY"]);
    assert.equal(contact.birthday, "");
});

test("parseVcf：无 FN 时回退 N 结构名（姓+名连写）；转义的逗号/分号/换行正确还原", () => {
    const noFn = "BEGIN:VCARD\r\nVERSION:3.0\r\nN:欧阳;锋;;;item1.TEL:13900000000\r\nEND:VCARD";
    assert.equal(parseVcf(noFn)[0].name, "欧阳锋");

    const escaped = 'BEGIN:VCARD\r\nFN:Morrissey\\, St.\\;John\\\\end\\nnext\r\nEND:VCARD';
    const [contact] = parseVcf(escaped);
    assert.equal(contact.name, "Morrissey, St.;John\\end\nnext");
});

test("parseVcf：QP 编码的 UTF-8 中文名解码（CHARSET 参数）", () => {
    // "小驴" = E5 B0 8F E9 A9 B4（UTF-8）
    const vcf = "BEGIN:VCARD\r\nN;ENCODING=QUOTED-PRINTABLE;CHARSET=UTF-8:=E5=B0=8F=E9=A9=B4\r\nEND:VCARD";
    const [contact] = parseVcf(vcf);
    assert.equal(contact.name, "小驴");
});

test("parseVcf：多卡片一次解析；同名卡片都保留（查重交给服务层对名册做）；空文件/垃圾输入返回空数组", () => {
    const two = "BEGIN:VCARD\r\nFN:甲\r\nEND:VCARD\r\nBEGIN:VCARD\r\nFN:乙\r\nEND:VCARD";
    assert.deepEqual(parseVcf(two).map((contact) => contact.name), ["甲", "乙"]);
    assert.deepEqual(parseVcf(""), []);
    assert.deepEqual(parseVcf("这不是 vCard 内容\r\nrandom text without colon"), []);
    assert.equal(parseVcf("BEGIN:VCARD\r\nTEL:13800138000\r\nEND:VCARD").length, 0, "无姓名的卡片丢弃");
});

test("serializeVcf：vCard 3.0 CRLF 输出，农历走 X-LVCT-BDAY-LUNAR，标签逗号连接且转义", () => {
    const text = serializeVcf([
        base({ name: "张三", phone: "13800138000", email: "zhang@example.com", website: "https://example.com", birthday: "1990-05-20", tags: ["球友,重点"] }),
        base({ name: "王五", birthday: "1990-05-20", isLunar: true }),
    ]);
    assert.ok(text.includes("BEGIN:VCARD\r\nVERSION:3.0"));
    assert.ok(text.includes("FN:张三"));
    assert.ok(text.includes("TEL;TYPE=CELL:13800138000"));
    assert.ok(text.includes("EMAIL;TYPE=INTERNET:zhang@example.com"));
    assert.ok(text.includes("URL:https://example.com"));
    assert.ok(text.includes("BDAY:1990-05-20"));
    assert.ok(text.includes("CATEGORIES:球友\\,重点"));
    assert.ok(text.includes("X-LVCT-BDAY-LUNAR:1990-05-20"), "农历生日不写 BDAY（语义是公历）");
    assert.ok(!text.split("X-LVCT-BDAY-LUNAR")[0].includes("王五\r\nBDAY"), "王五卡片不得出现 BDAY");
    assert.ok(text.endsWith("END:VCARD\r\n"));
    assert.equal(serializeVcf([]), "");
    assert.equal(serializeVcf([base({ name: "  " })]).length, 0, "空白名跳过");
});

test("serializeVcf → parseVcf 往返：公历与农历卡片的字段都不丢", () => {
    const people = [
        base({ name: "张:三,记", phone: "13800138000 / 021-12345678", email: "zhang@example.com", website: "https://example.com", birthday: "1990-05-20", tags: ["球友", "重点"] }),
        base({ name: "王五", birthday: "2000-02-15", isLunar: true, tags: ["家人"] }),
    ];
    const parsed = parseVcf(serializeVcf(people));
    assert.deepEqual(parsed, people);
});

test("normalizeVcfDate / escapeVcf / unescapeVcf / splitUnescaped：边界行为", () => {
    assert.equal(normalizeVcfDate("19900520"), "1990-05-20");
    assert.equal(normalizeVcfDate("1990-05-20T00:00:00+08:00"), "1990-05-20");
    assert.equal(normalizeVcfDate(""), "");
    assert.equal(escapeVcf("a,b;c\nd\\e"), "a\\,b\\;c\\nd\\\\e");
    assert.equal(unescapeVcf("a\\,b\\;c\\nd\\\\e"), "a,b;c\nd\\e");
    assert.deepEqual(splitUnescaped("a\\,b,c", ","), ["a\\,b", "c"]);
});
