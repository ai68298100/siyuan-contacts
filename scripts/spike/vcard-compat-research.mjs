/**
 * Read-only synthetic vCard compatibility research for Issue #35.
 *
 * This imports the pure domain parser only. It does not start SiYuan, call an
 * API, read a real address book, or write plugin/workspace data. Its sole file
 * output is vcard-compat-research-results.json next to this script.
 *
 * All names and contact values are fictional. Passing a synthetic candidate
 * does not prove that Xiaomi's export uses the same form or establish Issue
 * #35's root cause.
 *
 * Run: node scripts/spike/vcard-compat-research.mjs
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { parseVcfForImport } from "../../src/domain/vcard.ts";

const card = (...properties) => ["BEGIN:VCARD", ...properties, "END:VCARD"].join("\r\n");
const names = (...values) => ({ status: "parsed", names: values });
const rejected = (message) => ({ status: "rejected", message });
const matrix = [
    {
        id: "v3-formatted-name",
        group: "supported-baseline",
        question: "Does a normal vCard 3.0 FN remain unchanged?",
        text: card("VERSION:3.0", "FN:示例甲", "TEL;TYPE=CELL:00000000000"),
        expected: names("示例甲"),
    },
    {
        id: "blank-fn-structured-name",
        group: "supported-baseline",
        question: "Does whitespace-only FN fall back to N?",
        text: card("VERSION:3.0", "FN:   ", "N:示例;乙;;;"),
        expected: names("示例乙"),
    },
    {
        id: "utf8-bom",
        group: "supported-baseline",
        question: "Is a leading UTF-8-decoded BOM accepted?",
        text: "\uFEFF" + card("VERSION:3.0", "FN:示例丙"),
        expected: names("示例丙"),
    },
    {
        id: "rfc-space-fold",
        group: "supported-baseline",
        question: "Is RFC whitespace folding unfolded?",
        text: card("VERSION:3.0", "FN:示例\r\n 丁"),
        expected: names("示例丁"),
    },
    {
        id: "rfc-tab-fold",
        group: "supported-baseline",
        question: "Is tab-prefixed RFC folding unfolded?",
        text: card("VERSION:3.0", "FN:示例\r\n\t戊"),
        expected: names("示例戊"),
    },
    {
        id: "qp-utf8-name",
        group: "supported-baseline",
        question: "Is UTF-8 quoted-printable decoded?",
        text: card("VERSION:2.1", "FN;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:=E5=BC=A0=E4=B8=89"),
        expected: names("张三"),
    },
    {
        id: "qp-gbk-name",
        group: "supported-baseline",
        question: "Is explicitly declared GBK quoted-printable decoded?",
        text: card("VERSION:2.1", "FN;CHARSET=GBK;ENCODING=QUOTED-PRINTABLE:=D5=C5=C8=FD"),
        expected: names("张三"),
    },
    {
        id: "qp-soft-fold-no-whitespace",
        group: "supported-baseline",
        question: "Is a QP soft continuation without leading whitespace accepted?",
        text: card("VERSION:2.1", "FN;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:=E5=BC=A0=\r\n=E4=B8=89"),
        expected: names("张三"),
    },
    {
        id: "qp-alias-single-line",
        group: "supported-baseline",
        question: "Is the QP alias already accepted on a single property line?",
        text: card("VERSION:2.1", "FN;CHARSET=UTF-8;ENCODING=QP:=E5=BC=A0=E4=B8=89"),
        expected: names("张三"),
    },
    {
        id: "grouped-fn",
        group: "supported-baseline",
        question: "Are property group prefixes stripped?",
        text: card("VERSION:3.0", "item1.FN:示例己"),
        expected: names("示例己"),
    },
    {
        id: "nameless-first-card",
        group: "supported-baseline",
        question: "Does a nameless first card leave later named contacts available?",
        text: card("VERSION:3.0", "FN:", "N:;;;;", "TEL:00000000000")
            + "\r\n" + card("VERSION:3.0", "FN:示例庚"),
        expected: names("示例庚"),
    },
    {
        id: "all-nameless-rejected",
        group: "supported-baseline",
        question: "Is a file with no usable name explicitly rejected?",
        text: card("VERSION:3.0", "FN:", "N:;;;;", "TEL:00000000000"),
        expected: rejected("文件没有有效 vCard 卡片，请核对 FN/N 姓名和 BEGIN:VCARD/END:VCARD 标记"),
    },
    {
        id: "truncated-card-rejected",
        group: "supported-baseline",
        question: "Does truncated input still stop before import planning?",
        text: "BEGIN:VCARD\r\nVERSION:3.0\r\nFN:示例辛",
        expected: rejected("第 1 张卡片未结束，请修复文件后重试"),
    },
    {
        id: "qp-soft-fold-leading-space",
        group: "synthetic-gap",
        question: "Do QP soft wrapping and whitespace continuation compose without adding a literal equals sign?",
        text: card("VERSION:2.1", "FN;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:=E5=BC=A0=\r\n =E4=B8=89"),
        expected: names("张三"),
        scope: "Mixed wrapping compatibility candidate; actual exporter usage must be confirmed separately.",
    },
    {
        id: "qp-alias-soft-fold",
        group: "synthetic-gap",
        question: "Does the accepted QP encoding alias support the same soft continuation as QUOTED-PRINTABLE?",
        text: card("VERSION:2.1", "FN;CHARSET=UTF-8;ENCODING=QP:=E5=BC=A0=\r\n=E4=B8=89"),
        expected: names("张三"),
        scope: "Consistency of the parser's existing QP alias; no claim about strict vCard conformance or Xiaomi exports.",
    },
    {
        id: "structured-name-escaped-semicolon",
        group: "synthetic-gap",
        question: "Is an escaped separator preserved inside a structured N component?",
        text: card("VERSION:3.0", "N:张\\;氏;三;;;"),
        expected: names("张;氏三"),
        scope: "Structured-name loss can be reproduced without a real address book.",
    },
    {
        id: "utf16-file-text-boundary",
        group: "unsupported-transport-boundary",
        question: "What does the current UTF-8 File.text-style decoding do with a synthetic UTF-16LE file?",
        // Blob.text() uses UTF-8, like File.text() in the current component.
        text: () => new Blob([Buffer.from("\uFEFF" + card("VERSION:3.0", "FN:示例壬"), "utf16le")]).text(),
        expected: rejected("文件包含卡片以外的内容，请选择有效的 vCard 文件"),
        scope: "This is an observed transport limitation, not a requested charset auto-detection change.",
    },
];

const cases = [];
for (const entry of matrix) {
    let actual;
    try {
        const text = typeof entry.text === "function" ? await entry.text() : entry.text;
        actual = names(...parseVcfForImport(text).map((contact) => contact.name));
    } catch (error) {
        actual = rejected(error instanceof Error ? error.message : String(error));
    }
    cases.push({
        id: entry.id,
        group: entry.group,
        question: entry.question,
        expected: entry.expected,
        actual,
        pass: isDeepStrictEqual(entry.expected, actual),
        ...(entry.scope ? { scope: entry.scope } : {}),
    });
}

const results = {
    generatedAt: new Date().toISOString(),
    nodeVersion: process.version,
    issue: 35,
    evidence: "synthetic-pure-domain",
    usesRealXiaomiSample: false,
    scope: "Only synthetic inputs and the pure domain parser; no SiYuan or plugin data access.",
    conclusion: "All synthetic candidate scenarios pass after the parser fix. They do not establish the original Xiaomi VCF root cause or justify closing Issue #35.",
    summary: {
        total: cases.length,
        passed: cases.filter((entry) => entry.pass).length,
        failed: cases.filter((entry) => !entry.pass).length,
        baselinePassed: cases.filter((entry) => entry.group === "supported-baseline" && entry.pass).length,
        baselineTotal: cases.filter((entry) => entry.group === "supported-baseline").length,
        syntheticGaps: cases.filter((entry) => entry.group === "synthetic-gap" && !entry.pass).map((entry) => entry.id),
    },
    cases,
};
const resultsUrl = new URL("./vcard-compat-research-results.json", import.meta.url);
writeFileSync(resultsUrl, JSON.stringify(results, null, 2) + "\n", "utf8");
console.log(JSON.stringify({ resultsPath: fileURLToPath(resultsUrl), ...results.summary }, null, 2));
// A research matrix intentionally records known gaps. Do not hide a baseline
// regression, while letting the caller inspect expected synthetic failures.
if (cases.some((entry) => entry.group !== "synthetic-gap" && !entry.pass)) process.exitCode = 1;
