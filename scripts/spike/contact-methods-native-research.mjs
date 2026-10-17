/**
 * AG-RF-004-N1：人物原生文档保存全量联系方式的纯研究实验。
 *
 * This file deliberately models native blocks in memory. It does not call a
 * SiYuan kernel, write plugin storage, parse production contact data, or
 * define a production schema. The candidate only asks a readable paragraph
 * to carry the value and meaning; machine identity and validation metadata
 * live in an explicit custom-attribute boundary.
 *
 * Run:
 *   node scripts/spike/contact-methods-native-research.mjs
 *   node --check scripts/spike/contact-methods-native-research.mjs
 */
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const OUTPUT = fileURLToPath(new URL("./contact-methods-native-research-results.json", import.meta.url));
const FORMAT = "1";
const MARKER = "1";
const TYPES = new Set(["phone", "email", "wechat", "qq", "url", "custom"]);
const TYPE_LABELS = new Map([
    ["phone", "电话"], ["email", "邮箱"], ["wechat", "微信"],
    ["qq", "QQ"], ["url", "网址"], ["custom", "自定义"],
]);
const ID_RE = /^method-[0-9a-f]{24}$/;
const NODE_ID_RE = /^\d{14}-[0-9a-z]{7}$/;
const SOURCE_KEY_RE = /^[a-z][a-z0-9-]{0,63}$/;

function hasForbiddenControl(value, allowLf = false) {
    if (typeof value !== "string") return true;
    for (const char of value) {
        const code = char.codePointAt(0);
        if (code === 0x0a && allowLf) continue;
        if (code <= 0x1f || code >= 0x7f && code <= 0x9f || code === 0x2028 || code === 0x2029) return true;
    }
    return false;
}

const clone = (value) => structuredClone(value);
const digest = (value) => createHash("sha256").update(value).digest("hex").slice(0, 24);
const methodId = (personDocId, sourceKey) => `method-${digest(`${personDocId}:${sourceKey}`)}`;
const docId = (ordinal) => `20261017000000-${String(ordinal).padStart(7, "0").slice(-7)}`;
const escapeDetail = (value) => String(value).replace(/[\r\n]/g, (char) => char === "\n" ? "\\n" : "\\r");

function attrsFor(method) {
    return {
        "custom-lvct-contact-method": MARKER,
        "custom-lvct-contact-method-format": FORMAT,
        "custom-lvct-contact-method-id": method.id,
        "custom-lvct-contact-method-owner": method.personDocId,
        "custom-lvct-contact-method-source": method.sourceKey,
        "custom-lvct-contact-method-type": method.type,
        "custom-lvct-contact-method-label": method.label,
        "custom-lvct-contact-method-primary": method.primary ? "1" : "0",
        "custom-lvct-contact-method-order": String(method.order),
    };
}

/**
 * Candidate body: the visible text contains every value and its meaning.
 * The value starts after a dedicated line, so embedded newlines remain data.
 * IDs and validation fields stay in attrsFor(), never in a user value.
 */
function encodeMethod(method) {
    if (!method || typeof method.id !== "string" || !ID_RE.test(method.id)) throw new Error("method-id-invalid");
    if (typeof method.personDocId !== "string" || !NODE_ID_RE.test(method.personDocId)) throw new Error("method-owner-invalid");
    if (typeof method.sourceKey !== "string" || !SOURCE_KEY_RE.test(method.sourceKey) || method.id !== methodId(method.personDocId, method.sourceKey)) throw new Error("method-identity-invalid");
    if (!TYPES.has(method.type)) throw new Error("method-type-invalid");
    if (typeof method.label !== "string" || hasForbiddenControl(method.label)) throw new Error("method-label-has-control");
    if (typeof method.value !== "string" || method.value.length === 0) throw new Error("method-value-empty");
    if (hasForbiddenControl(method.value, true)) throw new Error("method-value-has-control");
    if (!Number.isSafeInteger(method.order) || method.order < 0) throw new Error("method-order-invalid");
    const typeLabel = TYPE_LABELS.get(method.type);
    const body = [
        `联系方式：${typeLabel}`,
        `标签：${method.label || "未标记"}`,
        `主值：${method.primary ? "是" : "否"}`,
        "值：",
        method.value,
    ].join("\n");
    return {
        id: method.blockId,
        type: "p",
        parentId: method.personDocId,
        markdown: body,
        content: body,
        attrs: attrsFor(method),
    };
}

function parseMethodBlock(block) {
    const report = (status, detail, extra = {}) => ({ status, detail, blockId: block?.id ?? "", ...extra });
    if (!block || block.type !== "p" || typeof block.id !== "string" || !NODE_ID_RE.test(block.id)
        || typeof block.parentId !== "string" || !NODE_ID_RE.test(block.parentId)
        || typeof block.content !== "string" || typeof block.markdown !== "string"
        || block.markdown !== block.content || typeof block.attrs !== "object" || block.attrs === null) {
        return { ok: false, report: report("unknown", "block-shape") };
    }
    const attrs = block.attrs;
    if (attrs["custom-lvct-contact-method"] !== MARKER) return { ok: false, report: report("unknown", "marker") };
    if (attrs["custom-lvct-contact-method-format"] !== FORMAT) return { ok: false, report: report("unknown", "format") };
    const id = attrs["custom-lvct-contact-method-id"];
    const owner = attrs["custom-lvct-contact-method-owner"];
    const sourceKey = attrs["custom-lvct-contact-method-source"];
    const type = attrs["custom-lvct-contact-method-type"];
    const label = attrs["custom-lvct-contact-method-label"];
    const primary = attrs["custom-lvct-contact-method-primary"];
    const order = attrs["custom-lvct-contact-method-order"];
    const parsedOrder = Number(order);
    if (!ID_RE.test(id ?? "") || !NODE_ID_RE.test(owner ?? "") || !SOURCE_KEY_RE.test(sourceKey ?? "")
        || id !== methodId(owner, sourceKey) || !TYPES.has(type) || typeof label !== "string" || hasForbiddenControl(label)
        || !["0", "1"].includes(primary) || !/^\d+$/.test(order ?? "") || !Number.isSafeInteger(parsedOrder) || parsedOrder < 0) {
        return { ok: false, report: report("unknown", "attributes") };
    }
    const lines = block.content.split("\n");
    if (lines.length < 5 || lines[0] !== `联系方式：${TYPE_LABELS.get(type)}`
        || lines[1] !== `标签：${label || "未标记"}` || lines[2] !== `主值：${primary === "1" ? "是" : "否"}`
        || lines[3] !== "值：") {
        return { ok: false, report: report("unknown", "body-header") };
    }
    const value = lines.slice(4).join("\n");
    if (!value || hasForbiddenControl(value, true)) return { ok: false, report: report("unknown", value ? "value-control" : "empty-value") };
    return {
        ok: true,
        method: { id, owner, sourceKey, type, label, primary: primary === "1", order: parsedOrder, value, blockId: block.id, parentId: block.parentId },
        report: report("accepted", "readable-body"),
    };
}

function readPersonDocument(document) {
    if (!document || typeof document.docId !== "string" || !NODE_ID_RE.test(document.docId) || !Array.isArray(document.blocks)) {
        return { docId: document?.docId ?? "", methods: [], reports: [{ status: "unknown", detail: "document-shape" }] };
    }
    const seen = new Set();
    const methods = [];
    const reports = [];
    for (const block of document.blocks) {
        const parsed = parseMethodBlock(block);
        if (!parsed.ok) {
            if (block?.attrs?.["custom-lvct-contact-method"] === MARKER) reports.push(parsed.report);
            continue;
        }
        if (parsed.method.parentId !== document.docId || parsed.method.owner !== document.docId) {
            reports.push({ ...parsed.report, status: "conflict", detail: "parent-mismatch", methodId: parsed.method.id });
            continue;
        }
        if (seen.has(parsed.method.id)) {
            reports.push({ ...parsed.report, status: "duplicate", detail: "duplicate-method-id", methodId: parsed.method.id });
            continue;
        }
        seen.add(parsed.method.id);
        methods.push(parsed.method);
    }
    methods.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
    const primaries = new Set();
    for (const method of methods) {
        if (!method.primary) continue;
        if (primaries.has(method.type)) {
            reports.push({ status: "conflict", detail: "multiple-primary", methodId: method.id, blockId: method.blockId });
        } else primaries.add(method.type);
    }
    return { docId: document.docId, methods, reports };
}

function makeMethod(personDocId, sourceKey, type, value, label, primary, order = 0) {
    const id = methodId(personDocId, sourceKey);
    return { id, blockId: `20261017000000-${personDocId.slice(-2)}${String(order).padStart(5, "0")}`, personDocId, sourceKey, type, value, label, primary, order };
}

function makePerson(ordinal, name, values) {
    const personDocId = docId(ordinal);
    const methods = values.map((entry, slot) => {
        const [type, value, label, primary, sourceKey] = entry;
        return makeMethod(personDocId, sourceKey, type, value, label, primary, slot);
    });
    return {
        docId: personDocId,
        name,
        blocks: methods.map(encodeMethod),
        methods,
    };
}

function checkFixture() {
    const special = "+00 111 / +00 222\n分机：7 | 备注：<保留> & 🙂";
    const personA = makePerson("p001", "虚构人物甲", [
        ["phone", special, "工作 / 主线", true, "phone-primary"],
        ["email", "same@example.test", "共享邮箱", true, "email-shared"],
        ["wechat", "微信_甲\n第二行", "私用🙂", false, "wechat-secondary"],
    ]);
    const personB = makePerson("p002", "虚构人物乙", [
        ["phone", "same-value", "工作", true, "phone-primary"],
        ["email", "same@example.test", "共享邮箱", true, "email-shared"],
        ["custom", "旧 slash 原文 / 不拆分", "旧资料", false, "custom-legacy"],
    ]);
    return { personA, personB, special };
}

function runChecks() {
    const checks = [];
    const check = (id, pass, detail = "") => checks.push({ id, pass: Boolean(pass), ...(detail ? { detail } : {}) });
    const fixture = checkFixture();
    const documents = [fixture.personA, fixture.personB];
    const firstReads = documents.map(readPersonDocument);
    check("fixture-two-persons-three-methods", firstReads.every((read) => read.methods.length === 3));
    check("readable-body-keeps-type-label-primary-and-value", firstReads[0].methods[0].value === fixture.special
        && firstReads[0].methods[0].type === "phone" && firstReads[0].methods[0].label === "工作 / 主线" && firstReads[0].methods[0].primary === true);
    check("embedded-newline-and-markdown-punctuation-roundtrip", firstReads[0].methods[0].value.includes("\n") && firstReads[0].methods[0].value.includes("<保留>") && firstReads[0].methods[0].value.includes("&"));
    check("legacy-slash-value-stays-one-method", firstReads[1].methods.find((method) => method.type === "custom")?.value === "旧 slash 原文 / 不拆分");
    check("same-value-across-people-has-scoped-identities", firstReads[0].methods[1].value === firstReads[1].methods[1].value && firstReads[0].methods[1].id !== firstReads[1].methods[1].id);
    check("machine-id-is-in-explicit-attrs-boundary", fixture.personA.blocks[0].content.includes("联系方式：电话") && !fixture.personA.blocks[0].content.includes(fixture.personA.methods[0].id)
        && fixture.personA.blocks[0].attrs["custom-lvct-contact-method-id"] === fixture.personA.methods[0].id);

    const reordered = clone(fixture.personA); reordered.blocks.reverse();
    const reorderedRead = readPersonDocument(reordered);
    check("block-order-does-not-change-stable-ids", reorderedRead.methods.map((m) => m.id).sort().join(",") === firstReads[0].methods.map((m) => m.id).sort().join(","));
    check("same-order-is-deterministic-by-id", readPersonDocument({ ...reordered, blocks: reordered.blocks.map((block) => ({ ...block, attrs: { ...block.attrs, "custom-lvct-contact-method-order": "1" } })) }).methods.map((m) => m.id).join(",")
        === [...reorderedRead.methods].sort((a, b) => a.id.localeCompare(b.id)).map((m) => m.id).join(","));

    const edited = clone(fixture.personA);
    edited.blocks[0].content = edited.blocks[0].content.replace(fixture.special, "改过的值 / 仍保留换行\n下一行");
    edited.blocks[0].markdown = edited.blocks[0].content;
    const editedRead = readPersonDocument(edited);
    check("native-body-edit-preserves-method-id", editedRead.methods.find((m) => m.id === fixture.personA.methods[0].id)?.value === "改过的值 / 仍保留换行\n下一行");
    const deleted = clone(fixture.personA); deleted.blocks.splice(1, 1);
    const deletedRead = readPersonDocument(deleted);
    check("native-block-delete-is-observable", deletedRead.methods.length === 2 && !deletedRead.methods.some((m) => m.id === fixture.personA.methods[1].id));
    const copied = clone(fixture.personA); copied.blocks.push(clone(copied.blocks[0])); copied.blocks.at(-1).id = "20261017000000-copy001";
    const copiedRead = readPersonDocument(copied);
    check("copied-marker-is-duplicate-not-silent-new-method", copiedRead.reports.some((r) => r.status === "duplicate" && r.detail === "duplicate-method-id"));
    const unknown = clone(fixture.personA); unknown.blocks[0].attrs["custom-lvct-contact-method-format"] = "999";
    const unknownRead = readPersonDocument(unknown);
    check("unknown-format-is-reported", unknownRead.reports.some((r) => r.status === "unknown" && r.detail === "format"));
    const unknownType = clone(fixture.personA); unknownType.blocks[0].attrs["custom-lvct-contact-method-type"] = "fax";
    check("unknown-type-is-reported", readPersonDocument(unknownType).reports.some((r) => r.status === "unknown" && r.detail === "attributes"));
    const wrongParent = clone(fixture.personA); wrongParent.blocks[0].parentId = fixture.personB.docId;
    check("rebound-block-is-conflict", readPersonDocument(wrongParent).reports.some((r) => r.status === "conflict" && r.detail === "parent-mismatch"));
    const reboundOwner = clone(fixture.personA); reboundOwner.blocks[0].parentId = fixture.personB.docId; reboundOwner.blocks[0].attrs["custom-lvct-contact-method-owner"] = fixture.personB.docId;
    check("rebound-owner-cannot-reuse-old-id", readPersonDocument(reboundOwner).reports.some((r) => r.status === "unknown" && r.detail === "attributes"));
    const twoPrimary = clone(fixture.personA); twoPrimary.blocks[2].attrs["custom-lvct-contact-method-type"] = "phone"; twoPrimary.blocks[2].content = twoPrimary.blocks[2].content.replace("联系方式：微信", "联系方式：电话").replace("主值：否", "主值：是"); twoPrimary.blocks[2].markdown = twoPrimary.blocks[2].content; twoPrimary.blocks[2].attrs["custom-lvct-contact-method-primary"] = "1";
    check("multiple-primary-is-conflict", readPersonDocument(twoPrimary).reports.some((r) => r.status === "conflict" && r.detail === "multiple-primary"));

    const deletedAndRebuilt = makePerson("p001", "虚构人物甲", [
        ["phone", fixture.special, "工作 / 主线", true, "phone-primary"],
        ["wechat", "微信_甲\n第二行", "私用🙂", false, "wechat-secondary"],
    ]);
    check("delete-does-not-drift-following-method-id", deletedAndRebuilt.methods[1].id === fixture.personA.methods[2].id);
    const insertedAndRebuilt = makePerson("p001", "虚构人物甲", [
        ["phone", fixture.special, "工作 / 主线", true, "phone-primary"],
        ["custom", "新插入", "临时", false, "inserted"],
        ["email", "same@example.test", "共享邮箱", true, "email-shared"],
        ["wechat", "微信_甲\n第二行", "私用🙂", false, "wechat-secondary"],
    ]);
    check("insert-does-not-drift-existing-method-ids", insertedAndRebuilt.methods[2].id === fixture.personA.methods[1].id
        && insertedAndRebuilt.methods[3].id === fixture.personA.methods[2].id);

    const malformedDocument = readPersonDocument({ docId: fixture.personA.docId, blocks: null });
    check("malformed-document-is-reported-not-thrown", malformedDocument.methods.length === 0 && malformedDocument.reports.some((r) => r.detail === "document-shape"));
    const malformedBlock = clone(fixture.personA); delete malformedBlock.blocks[0].parentId;
    check("malformed-block-parent-is-reported", readPersonDocument(malformedBlock).reports.some((r) => r.detail === "block-shape"));
    const malformedBlockId = clone(fixture.personA); malformedBlockId.blocks[0].id = "not-a-node-id";
    check("malformed-block-id-is-reported", readPersonDocument(malformedBlockId).reports.some((r) => r.detail === "block-shape"));
    const mismatchedBody = clone(fixture.personA); mismatchedBody.blocks[0].markdown = "被篡改的 markdown";
    check("markdown-content-mismatch-is-reported", readPersonDocument(mismatchedBody).reports.some((r) => r.detail === "block-shape"));
    const unicodeLabel = clone(fixture.personA); unicodeLabel.blocks[0].attrs["custom-lvct-contact-method-label"] = "工作\u2028主线"; unicodeLabel.blocks[0].content = unicodeLabel.blocks[0].content.replace("工作 / 主线", "工作\u2028主线"); unicodeLabel.blocks[0].markdown = unicodeLabel.blocks[0].content;
    check("unicode-line-separator-label-is-rejected", readPersonDocument(unicodeLabel).reports.some((r) => r.detail === "attributes"));
    const controlValue = clone(fixture.personA); controlValue.blocks[0].content = controlValue.blocks[0].content.replace("+00 111", "+00 111\u0000"); controlValue.blocks[0].markdown = controlValue.blocks[0].content;
    check("control-character-value-is-rejected", readPersonDocument(controlValue).reports.some((r) => r.detail === "value-control"));
    const unsafeOrder = clone(fixture.personA); unsafeOrder.blocks[0].attrs["custom-lvct-contact-method-order"] = "9007199254740992";
    check("unsafe-order-is-rejected", readPersonDocument(unsafeOrder).reports.some((r) => r.detail === "attributes"));

    const cache = { pluginFacts: { stale: true }, requests: [{ id: "fictional-request" }] };
    delete cache.pluginFacts; delete cache.requests;
    const afterCacheClear = documents.map(readPersonDocument);
    check("clearing-experimental-plugin-cache-keeps-native-facts", afterCacheClear.every((read) => read.methods.length === 3)
        && afterCacheClear.flatMap((read) => read.methods).some((m) => m.value === fixture.special));
    check("cache-clear-does-not-rebind-same-value", afterCacheClear[0].methods[1].id !== afterCacheClear[1].methods[1].id);

    let rejectedLabel = false;
    try { encodeMethod(makeMethod(fixture.personA.docId, "rejected-label", "phone", "v", "bad\nlabel", false)); } catch { rejectedLabel = true; }
    check("newline-label-rejected-to-protect-boundary", rejectedLabel);
    let rejectedEmpty = false;
    try { encodeMethod(makeMethod(fixture.personA.docId, "rejected-empty", "phone", "", "空", false)); } catch { rejectedEmpty = true; }
    check("empty-value-rejected", rejectedEmpty);
    let rejectedControl = false;
    try { encodeMethod(makeMethod(fixture.personA.docId, "rejected-control", "phone", "a\u0000b", "控", false)); } catch { rejectedControl = true; }
    check("control-character-value-rejected-on-encode", rejectedControl);
    const sourceIds = documents.flatMap((document) => document.blocks.map((block) => block.attrs["custom-lvct-contact-method-id"]));
    check("all-source-ids-unique-within-person-scope", new Set(sourceIds).size === sourceIds.length);
    return { fixture, checks };
}

const { fixture, checks } = runChecks();
const failed = checks.filter((entry) => !entry.pass);
const result = {
    research: "AG-RF-004-N1",
    generatedAt: "2026-10-17",
    syntheticOnly: true,
    candidateContractAccepted: false,
    productionChanges: false,
    kernelRequests: 0,
    realPluginFileWrites: 0,
    candidate: {
        name: "readable-native-contact-method-v1",
        body: "正文逐方法可读：类型、标签、主值和‘值：’之后的完整原文；换行属于值内容",
        machineBoundary: "custom-lvct-contact-method-* attrs",
        identity: "method-{sha256(personDocId + ':' + stableSourceKey)[0:24]}; owner/source attrs are checked; research-only",
        ordering: "order ascending, then method ID for deterministic ties",
        legacyRule: "旧 AV slash 原文保留为一个值，不静默拆分",
    },
    checks,
    summary: { total: checks.length, passed: checks.length - failed.length, failed: failed.length },
    fixture: {
        persons: 2,
        methodsPerPerson: 3,
        values: "fictional only",
        sourceDocuments: [fixture.personA.docId, fixture.personB.docId],
        specialValuePreview: escapeDetail(fixture.special),
    },
    observations: [
        "可读正文保留所有值和含义；机器 ID、类型、标签、主值和排序位于显式属性边界。",
        "同值跨人物不合并；固定来源键、owner 重写、复制标记、未知格式、未知类型和错误父文档均报告。",
        "原生改值和删块可被识别；本实验不自动生成删除墓碑，也不把缺块升级为确认删除。",
        "清除实验插件缓存后仍可从人物文档回读全部方法；这是内存模型证据，不是实际宿主持久化。",
    ],
    limitations: [
        "没有访问真实 SiYuan 内核、编辑器、原生工作区或插件存储。",
        "没有证明块写入、重启、多窗口并发、原生手工编辑后的持久性。",
        "正文格式、属性命名、方法 ID 和 stable source key 只是候选研究格式，不是生产数据契约。",
        "未知格式、删除和冲突只报告，不自动修复、不按姓名或值重连。",
        "没有验证全文搜索、备份迁移、AV 主值投影、vCard 往返或大规模 IO 预算。",
    ],
};

if (failed.length) {
    console.error(JSON.stringify({ summary: result.summary, failed }, null, 2));
    throw new Error(`${failed.length} native contact research checks failed`);
}
writeFileSync(OUTPUT, `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log(`total ${result.summary.total}, passed ${result.summary.passed}, failed ${result.summary.failed}`);
console.log(`2 fictional persons, 6 methods, syntheticOnly=${result.syntheticOnly}`);
