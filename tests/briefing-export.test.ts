import assert from "node:assert/strict";
import test from "node:test";
import { buildBriefingMarkdown, escapeMarkdown, sanitizeFileName, buildBriefingFilename } from "../src/domain/briefing-export.ts";
import type { BriefingExportInput } from "../src/domain/briefing-export.ts";
import type { ContactSummary } from "../src/domain/person.ts";

const person: ContactSummary = {
    docId: "doc-1", itemId: "item-1", name: "林<晓梅>*", phone: "139 0225 7716", email: "",
    wechat: "", website: "", birthday: "1968-09-27", isLunar: true, group: "家人",
    tags: ["#紧急联系人"], relatedItemIds: [],
};

const base: BriefingExportInput = {
    person,
    timeline: [
        { localDate: "2026-09-01", note: "聊了*小天*入学", source: "manual", groupSize: 2 },
        { localDate: "2026-08-01", note: "", source: "diary", groupSize: 1 },
    ],
    followUps: [{ title: "问问面试结果", dueDate: "2026-10-15" }],
    relatedNames: ["许伯言", "林父"],
    coAttendance: [{ name: "周子昂", count: 3 }],
    limit: 10,
    generatedAt: "2026-09-28 14:30",
};

test("简报导出：固定骨架完整且相同输入与时间产出一致", () => {
    const first = buildBriefingMarkdown(base);
    const second = buildBriefingMarkdown(base);
    assert.equal(first, second, "相同输入应产出一致内容");
    assert(first.includes("# 会面简报：林\\<晓梅\\>\\*"), "标题缺失或未转义");
    assert(first.includes("生成时间：2026-09-28 14:30"), "生成时间缺失");
    assert(first.includes("## 最近互动（2 条"), "最近互动节缺失");
    assert(first.includes("## 未完成跟进（1 条）"), "跟进节缺失");
    assert(first.includes("## 重要日期"), "重要日期节缺失");
    assert(first.includes("## 相关人物"), "相关人物节缺失");
    assert(first.includes("## 共同出席"), "共同出席节缺失");
    assert(first.includes("同场 3 次"), "共同出席计数缺失");
    assert(first.includes("不代表关系亲疏"), "免责脚注缺失");
});

test("简报导出：limit 控制互动条数并注明总数", () => {
    const limited = buildBriefingMarkdown({ ...base, limit: 1 });
    assert(limited.includes("## 最近互动（1 条，共 2 条）"), "范围说明缺失");
    assert(!limited.includes("2026-08-01"), "超出范围的条目不应出现");
    const all = buildBriefingMarkdown({ ...base, limit: 0 });
    assert(all.includes("## 最近互动（2 条）"), "limit 0 应导出全部");
});

test("简报导出：特殊字符转义，空事实不生成空节", () => {
    const markdown = buildBriefingMarkdown(base);
    assert(markdown.includes("聊了\\*小天\\*入学"), "备注特殊字符未转义");
    const empty = buildBriefingMarkdown({
        person: { ...person, phone: "", group: "", tags: [] },
        timeline: [], followUps: [], relatedNames: [], coAttendance: [],
        limit: 10, generatedAt: "2026-09-28 14:30",
    });
    assert(!empty.includes("## 最近互动"), "无互动不应生成互动节");
    assert(!empty.includes("## 未完成跟进"), "无跟进不应生成跟进节");
    assert(!empty.includes("## 相关人物"), "无相关人不应生成相关人节");
    assert(empty.includes("# 会面简报：林\\<晓梅\\>\\*"), "空事实仍应有标题");
});

test("简报导出：农历生日与跟进标题转义", () => {
    const markdown = buildBriefingMarkdown(base);
    assert(markdown.includes("· 农历"), "农历标注缺失");
    const tricky = buildBriefingMarkdown({
        ...base,
        followUps: [{ title: "问 [他] 的近况 #重要", dueDate: "2026-10-15" }],
    });
    assert(tricky.includes("问 \\[他\\] 的近况 \\#重要"), "跟进标题特殊字符未转义");
});

test("K-11：简报文件名跨平台清洗、Windows保留名与超长截断保护", () => {
    /* 1. 非法路径字符转下划线，且输出绝不包含非法字符 */
    const unsafeName = '张/三\\:*"<>|?';
    const cleanedUnsafe = sanitizeFileName(unsafeName);
    assert.equal(cleanedUnsafe, "张_三________");
    assert.ok(!/[<>:"/\\|?*\u0000-\u001F\u007F]/.test(cleanedUnsafe));

    /* 2. 尾随点号、空格和控制字符剥离 */
    assert.equal(sanitizeFileName("李四...  \r\n"), "李四");

    /* 3. Windows 保留设备名称避让 */
    assert.equal(sanitizeFileName("CON"), "_CON");
    assert.equal(sanitizeFileName("aux"), "_aux");
    assert.equal(sanitizeFileName("NUL"), "_NUL");

    /* 4. 空值与空白回退 */
    assert.equal(sanitizeFileName("", "联系人"), "联系人");
    assert.equal(sanitizeFileName("   ", "默认"), "默认");

    /* 5. 超长截断并在截断点剥离尾随点/空格 */
    const veryLongName = "超长名字".repeat(25) + "... ";
    const truncated = sanitizeFileName(veryLongName, "联系人", 20);
    assert(truncated.length <= 20);
    assert(!truncated.endsWith("."));
    assert(!truncated.endsWith(" "));

    /* 6. buildBriefingFilename 集成验证 */
    const filename = buildBriefingFilename('王*五/经理', '2026-10-19');
    assert.equal(filename, "小驴人脉_简报_王_五_经理_2026-10-19.md");

    const fallbackFilename = buildBriefingFilename('   ', '2026-10-19');
    assert.equal(fallbackFilename, "小驴人脉_简报_联系人_2026-10-19.md");
});
