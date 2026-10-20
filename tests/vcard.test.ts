import { test } from "node:test";
import assert from "node:assert/strict";
import {
    parseVcf,
    parseVcfForImport,
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

test("QP 全名/别名的软换行与空格、Tab、无空白续行组合均保真", () => {
    for (const encoding of ["QUOTED-PRINTABLE", "QP", '"qp"']) {
        for (const prefix of ["", " ", "\t"]) {
            const vcf = ["BEGIN:VCARD", "VERSION:2.1",
                `FN;CHARSET=UTF-8;ENCODING=${encoding}:=E5=BC=A0=\r\n${prefix}=E4=B8=89`,
                "TEL:00000000000", "END:VCARD"].join("\r\n");
            for (const parse of [parseVcf, parseVcfForImport]) {
                const [contact] = parse(vcf);
                assert.equal(contact.name, "张三", `${encoding}, ${JSON.stringify(prefix)}`);
                assert.equal(contact.phone, "00000000000");
            }
        }
    }
});

test("QP 属性头可先 RFC 折行，后续带冒号的数据仍正常续接", () => {
    const vcf = ["BEGIN:VCARD", "FN;ENCODING=\r\n QP;CHARSET=UTF-8:=E5=BC=A0=",
        "=E4=B8=89:sample=3D", "END:VCARD"].join("\r\n");
    assert.equal(parseVcfForImport(vcf)[0].name, "张三:sample=");
});

test("普通字段值中的编码名称不触发 QP 合并", () => {
    const vcf = "BEGIN:VCARD\r\nFN:QUOTED-PRINTABLE=\r\nTEL:00000000000\r\nEND:VCARD";
    const [contact] = parseVcfForImport(vcf);
    assert.equal(contact.name, "QUOTED-PRINTABLE=");
    assert.equal(contact.phone, "00000000000");
});

test("未完成 QP 软行不能吞掉下一独立属性，含未知、分组和折行属性头", () => {
    for (const property of ["TEL:00000000000", "X-EXAMPLE:value", "item1.EMAIL:sample@example.com",
        "TEL;\r\n TYPE=CELL:00000000000", "ambiguous:continuation"]) {
        const vcf = ["BEGIN:VCARD", "FN;ENCODING=QUOTED-PRINTABLE:=E5=BC=A0=",
            property, "END:VCARD"].join("\r\n");
        assert.throws(() => parseVcfForImport(vcf), /第 1 张卡片.*损坏属性行/, property);
        assert.ok(unfoldVcfLines(vcf).includes("FN;ENCODING=QUOTED-PRINTABLE:=E5=BC=A0="));
    }
});

test("未完成 QP 在卡片标记、空行或 EOF 前拒绝，不能返回前面已解析的卡片", () => {
    const valid = "BEGIN:VCARD\r\nFN:前卡\r\nEND:VCARD\r\n";
    for (const next of ["END:VCARD", "BEGIN:VCARD\r\nFN:后卡\r\nEND:VCARD", "", "\r\nEND:VCARD",
        " END:VCARD"]) {
        const vcf = valid + "BEGIN:VCARD\r\nFN;ENCODING=QP:=E5=BC=A0=\r\n" + next;
        assert.throws(() => parseVcfForImport(vcf), /第 2 张卡片(未结束|含损坏属性行)/);
        assert.doesNotThrow(() => parseVcf(vcf), "容错入口仍不抛错");
    }
});

test("带前导空格的卡片标记不被上一行 QP 吞掉，容错解析仍保留后继卡", () => {
    const vcf = [
        "BEGIN:VCARD",
        "FN;ENCODING=QP:=E5=BC=A0=",
        " BEGIN:VCARD",
        "FN:后卡",
        "END:VCARD",
        "END:VCARD",
    ].join("\r\n");
    assert.deepEqual(parseVcf(vcf).map((contact) => contact.name), ["后卡"]);
    assert.throws(() => parseVcfForImport(vcf), /第 1 张卡片(含损坏属性行|缺少 END:VCARD)/);
});

test("严格导入拒绝 QP 半个字节与非法等号，编码后的等号正常保留", () => {
    for (const value of ["=E5=BC=A0=E", "=E5=BC=A0=ZZ"]) {
        const vcf = `BEGIN:VCARD\r\nFN;ENCODING=QP:${value}\r\nEND:VCARD`;
        assert.throws(() => parseVcfForImport(vcf), /损坏属性行/);
    }
    const valid = "BEGIN:VCARD\r\nFN;ENCODING=QP:sample=3D\r\nEND:VCARD";
    assert.equal(parseVcfForImport(valid)[0].name, "sample=");
});

test("N 结构名先分列后反转义，分号、逗号与反斜杠不丢失", () => {
    const cases = [
        ["张\\;氏;三;;;", "张;氏三"],
        ["Back\\\\;Given\\;name;;;", "Back\\Given;name"],
        ["Family\\,X;Given\\\\end;;;", "Family,XGiven\\end"],
    ];
    for (const [raw, expected] of cases) {
        const vcf = `BEGIN:VCARD\r\nFN:   \r\nN:${raw}\r\nEND:VCARD`;
        for (const parse of [parseVcf, parseVcfForImport]) assert.equal(parse(vcf)[0].name, expected);
    }
    const fallback = serializeVcf([base({ name: "张;三,记\\号" })]).split("\r\n")
        .filter((line) => !line.startsWith("FN:")).join("\r\n");
    assert.equal(parseVcfForImport(fallback)[0].name, "张;三,记\\号");
});

test("parseVcf：vCard 3.0 基本卡片，多 TEL 以 ' / ' 连接、EMAIL/URL 取首个、CATEGORIES 进标签", () => {
    const vcf = [
        "BEGIN:VCARD",
        "VERSION:3.0",
        "N:张;三;;;",
        "FN:张三",
        "TEL;TYPE=CELL:13800138000",
        "TEL;TYPE=WORK:021-12345678",
        "TEL;TYPE=HOME:13800138000",
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

test("parseVcf：多联系方式在兼容主值之外保留预览值，并明确提示有损映射", () => {
    const vcf = [
        "BEGIN:VCARD",
        "FN:多联系方式",
        "TEL;TYPE=CELL:13800138000",
        "TEL;TYPE=WORK:021-12345678",
        "TEL;TYPE=HOME:13800138000",
        "EMAIL;TYPE=INTERNET:first@example.com",
        "EMAIL;TYPE=HOME:second@example.com",
        "URL:https://first.example.com",
        "URL:https://second.example.com",
        "END:VCARD",
    ].join("\r\n");
    const [contact] = parseVcfForImport(vcf);
    assert.equal(contact.phone, "13800138000 / 021-12345678");
    assert.deepEqual(contact.phoneValues, ["13800138000", "021-12345678", "13800138000"]);
    assert.deepEqual(contact.emailValues, ["first@example.com", "second@example.com"]);
    assert.deepEqual(contact.websiteValues, ["https://first.example.com", "https://second.example.com"]);
    assert.ok(contact.needsReview?.includes("TEL（多项已合并到电话字段）"));
    assert.ok(contact.unsupportedProperties?.includes("EMAIL（第 2 项起）"));
    assert.ok(contact.unsupportedProperties?.includes("URL（第 2 项起）"));
});

test("多值预览保留源顺序、重复项和空项，同属性序号包含空项", () => {
    const vcf = [
        "BEGIN:VCARD", "FN:预览候选",
        "TEL;TYPE=HOME:",
        "EMAIL;TYPE=WORK:first@example.test",
        "item1.TEL;TYPE=CELL:+00 111",
        "URL;TYPE=WORK:https://work.example.test",
        "TEL;TYPE=WORK:+00 111",
        "EMAIL;TYPE=HOME:   ",
        "URL:https://personal.example.test",
        "EMAIL;TYPE=OTHER:second@example.test",
        "END:VCARD",
    ].join("\r\n");
    for (const parse of [parseVcf, parseVcfForImport]) {
        const [contact] = parse(vcf);
        assert.deepEqual(contact.methodPreview, [
            { field: "phone", property: "TEL", sourceIndex: 1, types: ["HOME"], value: "", disabled: true },
            { field: "email", property: "EMAIL", sourceIndex: 1, types: ["WORK"], value: "first@example.test", disabled: false },
            { field: "phone", property: "TEL", sourceIndex: 2, types: ["CELL"], value: "+00 111", disabled: false },
            { field: "website", property: "URL", sourceIndex: 1, types: ["WORK"], value: "https://work.example.test", disabled: false },
            { field: "phone", property: "TEL", sourceIndex: 3, types: ["WORK"], value: "+00 111", disabled: false },
            { field: "email", property: "EMAIL", sourceIndex: 2, types: ["HOME"], value: "", disabled: true },
            { field: "website", property: "URL", sourceIndex: 2, types: [], value: "https://personal.example.test", disabled: false },
            { field: "email", property: "EMAIL", sourceIndex: 3, types: ["OTHER"], value: "second@example.test", disabled: false },
        ]);
        assert.equal(contact.phone, "+00 111", "兼容电话仍去重后拼接");
        assert.deepEqual(contact.phoneValues, ["+00 111", "+00 111"], "现有预览数组保留重复非空值");
        assert.equal(contact.email, "first@example.test");
        assert.equal(contact.website, "https://work.example.test");
    }
    const [single] = parseVcfForImport("BEGIN:VCARD\r\nFN:单值\r\nTEL:+00 222\r\nEMAIL:single@example.test\r\nURL:https://single.example.test\r\nEND:VCARD");
    assert.equal(Object.hasOwn(single, "methodPreview"), false, "单值卡片不增加预览元数据");
});

test("预览 TYPE 汇集 2.1 裸参数、重复 TYPE 和逗号列表，不改变 QP 解码", () => {
    const vcf = [
        "BEGIN:VCARD", "VERSION:2.1", "FN:类型候选",
        'TEL;HOME;VOICE;TYPE=WORK,VOICE;type="CELL,pref";ENCODING=QP;CHARSET=UTF-8:=2B00=20111',
        "TEL;TYPE=OTHER:+00 222",
        'EMAIL;TYPE="WORK,INTERNET";TYPE=HOME:first@example.test',
        "EMAIL;HOME;INTERNET:second@example.test",
        "END:VCARD",
    ].join("\r\n");
    const [contact] = parseVcfForImport(vcf);
    assert.deepEqual(contact.methodPreview?.map(({ types, value }) => ({ types, value })), [
        { types: ["HOME", "VOICE", "WORK", "VOICE", "CELL", "pref"], value: "+00 111" },
        { types: ["OTHER"], value: "+00 222" },
        { types: ["WORK", "INTERNET", "HOME"], value: "first@example.test" },
        { types: ["HOME", "INTERNET"], value: "second@example.test" },
    ]);
    assert.equal(contact.phone, "+00 111 / +00 222");
    assert.equal(contact.email, "first@example.test");
});

test("前序空联系方式只进入禁用预览，不改变首个非空标量的兼容选择", () => {
    const vcf = [
        "BEGIN:VCARD", "FN:空值候选",
        "TEL:", "EMAIL:", "URL:",
        "TEL:+00 333", "EMAIL:available@example.test", "URL:https://available.example.test",
        "END:VCARD",
    ].join("\r\n");
    const [contact] = parseVcfForImport(vcf);
    assert.equal(contact.phone, "+00 333");
    assert.equal(contact.email, "available@example.test");
    assert.equal(contact.website, "https://available.example.test");
    assert.deepEqual(contact.methodPreview?.map(({ property, sourceIndex, disabled }) => ({ property, sourceIndex, disabled })), [
        { property: "TEL", sourceIndex: 1, disabled: true },
        { property: "EMAIL", sourceIndex: 1, disabled: true },
        { property: "URL", sourceIndex: 1, disabled: true },
        { property: "TEL", sourceIndex: 2, disabled: false },
        { property: "EMAIL", sourceIndex: 2, disabled: false },
        { property: "URL", sourceIndex: 2, disabled: false },
    ]);
    assert.equal(contact.phoneValues, undefined);
    assert.equal(contact.emailValues, undefined);
    assert.equal(contact.websiteValues, undefined);
});

test("parseVcf：BDAY 接受紧凑/ISO/带时间三种形式，无年份（--0520）与文本形式丢弃", () => {
    const build = (bday: string) => `BEGIN:VCARD\r\nFN:李四\r\nBDAY:${bday}\r\nEND:VCARD`;
    assert.equal(parseVcf(build("19900520"))[0].birthday, "1990-05-20");
    assert.equal(parseVcf(build("1990-05-20"))[0].birthday, "1990-05-20");
    assert.equal(parseVcf(build("1990-05-20T08:30:00Z"))[0].birthday, "1990-05-20");
    assert.equal(parseVcf(build("--0520"))[0].birthday, "");
    assert.equal(parseVcf(build("五月二十"))[0].birthday, "");
    assert.equal(parseVcf(build("1990-13-40"))[0].birthday, "", "日历不存在的日期丢弃");
    /* C-30：公历闰年与平年边界 */
    assert.equal(parseVcf(build("20240229"))[0].birthday, "2024-02-29", "闰年2月29日合法");
    assert.equal(parseVcf(build("20230229"))[0].birthday, "", "平年2月29日非法必须丢弃");
    assert.equal(parseVcf(build("1900-02-29"))[0].birthday, "", "百年不闰二月29日非法丢弃");
    assert.equal(parseVcf(build("2000-02-29"))[0].birthday, "2000-02-29", "四百年一闰2月29日合法");
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

test("parseVcf：空白 FN 回退 N，且接受 UTF-8 BOM 文件头", () => {
    const vcf = "\uFEFFBEGIN:VCARD\r\nVERSION:3.0\r\nN;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:=E5=BC=A0=3B=E4=B8=89;;;\r\nFN:   \r\nTEL;TYPE=CELL:13800138000\r\nEND:VCARD";
    const [contact] = parseVcf(vcf);
    assert.ok(contact);
    assert.equal(contact.name, "张三");
    assert.equal(contact.phone, "13800138000");
    assert.equal(parseVcfForImport(vcf)[0].name, "张三");
});

test("parseVcfForImport：BOM 不会被当作卡片外的非法内容", () => {
    const vcf = "\uFEFFBEGIN:VCARD\r\nVERSION:3.0\r\nFN:小米联系人\r\nEND:VCARD\r\n";
    assert.deepEqual(parseVcfForImport(vcf).map((contact) => contact.name), ["小米联系人"]);
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

test("serializeVcf 只导出现有标量，不把预览候选或 TYPE 元数据当作已保存值", () => {
    const person = base({
        phone: "+00 selected", email: "selected@example.test", website: "https://selected.example.test",
        phoneValues: ["preview-phone-a", "preview-phone-b"],
        emailValues: ["preview-a@example.test", "preview-b@example.test"],
        websiteValues: ["https://preview-a.example.test", "https://preview-b.example.test"],
        methodPreview: [
            { field: "phone", property: "TEL", sourceIndex: 7, types: ["preview-type"], value: "preview-phone", disabled: false },
            { field: "email", property: "EMAIL", sourceIndex: 2, types: ["preview-type"], value: "preview@example.test", disabled: false },
        ],
    });
    const before = structuredClone(person);
    const text = serializeVcf([person]);
    assert.equal(text.split("\r\n").filter((line) => line.startsWith("TEL;")).length, 1);
    assert.equal(text.split("\r\n").filter((line) => line.startsWith("EMAIL;")).length, 1);
    assert.equal(text.split("\r\n").filter((line) => line.startsWith("URL:")).length, 1);
    assert.ok(!text.includes("preview"));
    assert.deepEqual(parseVcf(text), [base({ phone: person.phone, email: person.email, website: person.website })]);
    assert.deepEqual(person, before, "导出不修改本次预览或标量输入");
});

test("normalizeVcfDate / escapeVcf / unescapeVcf / splitUnescaped：边界行为", () => {
    assert.equal(normalizeVcfDate("19900520"), "1990-05-20");
    assert.equal(normalizeVcfDate("1990-05-20T00:00:00+08:00"), "1990-05-20");
    assert.equal(normalizeVcfDate(""), "");
    assert.equal(escapeVcf("a,b;c\nd\\e"), "a\\,b\\;c\\nd\\\\e");
    assert.equal(unescapeVcf("a\\,b\\;c\\nd\\\\e"), "a,b;c\nd\\e");
    assert.deepEqual(splitUnescaped("a\\,b,c", ","), ["a\\,b", "c"]);
});

test("AG-VCF-ROBUST: QP 解码支持 Windows \\r\\n 软折行与字节序列完整保真", () => {
    // 汉字 "你好" 的 UTF-8 编码为 =E4=BD=A0=E5=A5=BD，中间在 =E4=BD=A0 处软折行 =\r\n
    const vcf = [
        "BEGIN:VCARD",
        "VERSION:2.1",
        "FN;ENCODING=QUOTED-PRINTABLE;CHARSET=UTF-8:=E4=BD=A0=\r\n=E5=A5=BD",
        "TEL:13800000000",
        "END:VCARD",
    ].join("\r\n");
    const [contact] = parseVcf(vcf);
    assert.equal(contact.name, "你好");
    assert.equal(contact.phone, "13800000000");
});

test("AG-VCF-ROBUST: 无名卡片智能从 ORG 或 NICKNAME 兜底识别，纯电话卡片按契约安全跳过", () => {
    const vcf = [
        // 卡片 1：只有 ORG（公司客服，常见于小米/安卓通讯录导出）
        "BEGIN:VCARD",
        "VERSION:2.1",
        "ORG:招商银行信用卡客服",
        "TEL:95555",
        "END:VCARD",

        // 卡片 2：只有 NICKNAME
        "BEGIN:VCARD",
        "VERSION:3.0",
        "NICKNAME:老王",
        "TEL:13911112222",
        "END:VCARD",

        // 卡片 3：纯 TEL 无姓名无组织（按契约安全跳过，避免建立无名孤儿文档）
        "BEGIN:VCARD",
        "VERSION:3.0",
        "TEL:10086",
        "END:VCARD",

        // 卡片 4：完全空白卡片
        "BEGIN:VCARD",
        "VERSION:3.0",
        "END:VCARD",
    ].join("\r\n");

    const contacts = parseVcf(vcf);
    assert.equal(contacts.length, 2, "仅含有效身份（ORG/NICKNAME）的卡片被保留，纯号码及空白卡片被丢弃");
    assert.equal(contacts[0].name, "招商银行信用卡客服");
    assert.equal(contacts[0].phone, "95555");

    assert.equal(contacts[1].name, "老王");
    assert.equal(contacts[1].phone, "13911112222");
});

test("AG-E35-VCARD-EXPORT-SCOPE: serializeVcf 支持多联系人范围子集导出，CRLF 与 RFC 6350 保真", () => {
    const people = [
        base({ name: "联系人甲", phone: "13800000001" }),
        base({ name: "联系人乙", phone: "13800000002" }),
        base({ name: "联系人丙", phone: "13800000003" }),
    ];
    // 局部子集导出（如筛选后的甲和丙）
    const subset = [people[0], people[2]];
    const vcf = serializeVcf(subset);
    assert.match(vcf, /FN:联系人甲/);
    assert.match(vcf, /FN:联系人丙/);
    assert.doesNotMatch(vcf, /FN:联系人乙/);
    assert.equal(vcf.split("BEGIN:VCARD").length - 1, 2);
    assert.ok(vcf.endsWith("END:VCARD\r\n"));
});

test("AG-E20-METHODS-EXPORT: serializeVcf 支持多电话/邮箱/网址及 ORG/TITLE/NOTE 保真序列化", () => {
    const person: VCardContact = base({
        name: "李四",
        phone: "13800000001 / 010-88888888",
        extraPhones: [
            { value: "13800000001", type: "CELL" },
            { value: "010-88888888", type: "WORK" },
            { value: "010-66666666", type: "FAX" },
        ],
        extraEmails: [
            { value: "lisi@work.com", type: "WORK" },
            { value: "lisi@home.com", type: "HOME" },
        ],
        org: "思源科技",
        title: "首席架构师",
        note: "项目核心负责人",
    });

    const vcf = serializeVcf([person]);
    assert.match(vcf, /FN:李四/);
    assert.match(vcf, /ORG:思源科技/);
    assert.match(vcf, /TITLE:首席架构师/);
    assert.match(vcf, /NOTE:项目核心负责人/);
    assert.match(vcf, /TEL;TYPE=CELL:13800000001/);
    assert.match(vcf, /TEL;TYPE=WORK:010-88888888/);
    assert.match(vcf, /TEL;TYPE=FAX:010-66666666/);
    assert.match(vcf, /EMAIL;TYPE=WORK:lisi@work\.com/);
    assert.match(vcf, /EMAIL;TYPE=HOME:lisi@home\.com/);
});
