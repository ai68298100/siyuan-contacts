/**
 * AG-RF-004-N2: bounded, synthetic-only native-editor format research.
 * No SiYuan, browser, network, production model, or plugin storage access.
 * A complete enumeration is an explicit fixture premise, not a parser claim
 * that a real host response contains every block.
 */
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const OUTPUT = fileURLToPath(new URL("./contact-methods-native-editor-research-results.json", import.meta.url));
const PREFIX = "custom-lvct-contact-method-";
const MARKER = "custom-lvct-contact-method";
const NODE_ID = /^\d{14}-[0-9a-z]{7}$/;
const METHOD_ID = /^method-[0-9a-f]{24}$/;
const SOURCE = /^[a-z][a-z0-9-]{0,63}$/;
const TYPE_LABELS = { phone: "电话", email: "邮箱", wechat: "微信", qq: "QQ", url: "网址", custom: "自定义" };
export const FORMATS = Object.freeze(["n2-single-json-v1", "n2-editor-multiline-v1", "n2-sealed-multiline-v1"]);
const MAX_VALUE = 8192;
const MAX_LABEL = 256;
const MAX_BLOCKS = 128;
const clone = (value) => structuredClone(value);
const hash = (value) => createHash("sha256").update(value).digest("hex");
const expectedIdentity = (owner, sourceKey) => `method-${hash(`${owner}:${sourceKey}`).slice(0, 24)}`;
const json = (value) => JSON.stringify(value).replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
const attr = (block, key) => block?.attrs?.[`${PREFIX}${key}`];
const plain = (value) => value !== null && typeof value === "object" && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
let identityAllocations = 0;
const adoptionProposals = new Map(); // Bounded current-process proposals, not a durable request protocol.
export const resetCounters = () => { identityAllocations = 0; adoptionProposals.clear(); };
export const counters = () => ({ identityAllocations, automaticRepairs: 0, nativeWrites: 0, kernelRequests: 0 });

function validText(value, max, allowEmpty) {
    if (typeof value !== "string" || value.length > max || (!allowEmpty && value.length === 0) || !value.isWellFormed()) return false;
    // CR/LF/TAB are preserved data; all other C0/C1 controls are visibly refused.
    return !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u.test(value);
}
const validOrder = (order) => Number.isSafeInteger(order) && order >= 0;
function assertMethod(method) {
    if (!plain(method) || typeof method.owner !== "string" || !NODE_ID.test(method.owner)
        || typeof method.sourceKey !== "string" || !SOURCE.test(method.sourceKey)
        || typeof method.id !== "string" || !METHOD_ID.test(method.id) || method.id !== expectedIdentity(method.owner, method.sourceKey)
        || typeof method.blockId !== "string" || !NODE_ID.test(method.blockId) || typeof method.type !== "string" || !Object.hasOwn(TYPE_LABELS, method.type)
        || !validText(method.label, MAX_LABEL, true) || !validText(method.value, MAX_VALUE, false)
        || typeof method.primary !== "boolean" || !validOrder(method.order)) throw new Error("invalid-method");
}
function visibleObject(method) {
    return { 类型: TYPE_LABELS[method.type], 标签: method.label, 主值: method.primary, 值: method.value };
}
function bodyFor(method, format) {
    if (format === FORMATS[0]) return `联系方式：${json(visibleObject(method))}`;
    return `联系方式：${TYPE_LABELS[method.type]}\n标签：${json(method.label)}\n主值：${method.primary ? "是" : "否"}\n值：\n${method.value}`;
}
export function encode(method, format = FORMATS[0]) {
    assertMethod(method);
    if (!FORMATS.includes(format)) throw new Error("invalid-format");
    const content = bodyFor(method, format);
    const attrs = {
        [MARKER]: "1", [`${PREFIX}format`]: format, [`${PREFIX}id`]: method.id,
        [`${PREFIX}owner`]: method.owner, [`${PREFIX}source`]: method.sourceKey,
        [`${PREFIX}type`]: method.type, [`${PREFIX}label`]: method.label,
        [`${PREFIX}primary`]: method.primary ? "1" : "0", [`${PREFIX}order`]: String(method.order),
    };
    if (format === FORMATS[2]) attrs[`${PREFIX}body-sha256`] = hash(content);
    return { id: method.blockId, type: "p", parentId: method.owner, content, markdown: content, attrs };
}

export function parseBlock(block) {
    const fail = (detail, status = "unknown") => ({ ok: false, status, detail, blockId: block?.id ?? "" });
    if (!plain(block) || block.type !== "p" || typeof block.id !== "string" || !NODE_ID.test(block.id)
        || typeof block.parentId !== "string" || !NODE_ID.test(block.parentId)
        || typeof block.content !== "string" || block.content.length > 16 * MAX_VALUE
        || block.markdown !== block.content || !plain(block.attrs)) return fail("block-shape");
    if (block.attrs[MARKER] !== "1") return fail("marker");
    const format = attr(block, "format");
    if (!FORMATS.includes(format)) return fail("format");
    const id = attr(block, "id"), owner = attr(block, "owner"), sourceKey = attr(block, "source");
    const type = attr(block, "type"), label = attr(block, "label"), primary = attr(block, "primary"), order = attr(block, "order");
    if (typeof id !== "string" || !METHOD_ID.test(id) || typeof owner !== "string" || !NODE_ID.test(owner)
        || typeof sourceKey !== "string" || !SOURCE.test(sourceKey) || id !== expectedIdentity(owner, sourceKey)
        || typeof type !== "string" || !Object.hasOwn(TYPE_LABELS, type) || !validText(label, MAX_LABEL, true)
        || !["0", "1"].includes(primary) || typeof order !== "string" || !/^(0|[1-9]\d*)$/.test(order) || !validOrder(Number(order))) return fail("identity-or-attributes");
    const allowed = new Set([MARKER, ...["format", "id", "owner", "source", "type", "label", "primary", "order"].map((key) => `${PREFIX}${key}`)]);
    if (format === FORMATS[2]) allowed.add(`${PREFIX}body-sha256`);
    if (Object.keys(block.attrs).some((key) => (key === MARKER || key.startsWith(PREFIX)) && !allowed.has(key))) return fail("unknown-method-attribute");
    let value;
    if (format === FORMATS[0]) {
        if (!block.content.startsWith("联系方式：") || /[\r\n\u2028\u2029]/u.test(block.content)) return fail("single-line-boundary");
        try {
            const body = JSON.parse(block.content.slice("联系方式：".length));
            if (!plain(body) || Object.keys(body).join(",") !== "类型,标签,主值,值"
                || body.类型 !== TYPE_LABELS[type] || body.标签 !== label || body.主值 !== (primary === "1")
                || block.content !== `联系方式：${json(body)}`) return fail("single-json-shape-or-canonical");
            value = body.值;
        } catch { return fail("single-json-invalid"); }
    } else {
        const header = `联系方式：${TYPE_LABELS[type]}\n标签：${json(label)}\n主值：${primary === "1" ? "是" : "否"}\n值：\n`;
        if (!block.content.startsWith(header)) return fail("multiline-header");
        if (format === FORMATS[2] && attr(block, "body-sha256") !== hash(block.content)) return fail("sealed-body-changed");
        value = block.content.slice(header.length);
    }
    if (!validText(value, MAX_VALUE, false)) return fail(value === "" ? "empty-value" : "value-invalid-or-bound");
    return { ok: true, status: "accepted", detail: "strict-body", method: { id, owner, sourceKey, type, label, primary: primary === "1", order: Number(order), value, blockId: block.id, parentId: block.parentId, format } };
}

/**
 * Input is an already-selected candidate-method-block scope, NOT every block
 * in a person document. Selection and trustworthy full enumeration are not
 * implemented here. No accepted subset becomes a complete method list.
 */
export function readDocument(document) {
    const reports = [];
    const finish = (accepted) => {
        const complete = reports.length === 0;
        return { complete, writeAllowed: complete, scope: "selected-candidate-method-blocks-only", scopeDiscoveryVerified: false,
            methods: complete ? accepted.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id)) : [],
            diagnosticAcceptedCount: accepted.length, reports, identityAllocations: 0 };
    };
    if (!plain(document) || typeof document.docId !== "string" || !NODE_ID.test(document.docId) || !Array.isArray(document.blocks)
        || document.blocks.length > MAX_BLOCKS || document.enumerationComplete !== true) {
        reports.push({ status: "unknown", detail: "document-shape-or-enumeration-incomplete" });
        return finish([]);
    }
    const accepted = [], ids = new Set(), blockIds = new Set(), primaries = new Set();
    for (const block of document.blocks) {
        const parsed = parseBlock(block);
        if (!parsed.ok) { reports.push(parsed); continue; }
        const method = parsed.method;
        if (method.parentId !== document.docId || method.owner !== document.docId) {
            reports.push({ status: "conflict", detail: "owner-or-parent", methodId: method.id }); continue;
        }
        if (ids.has(method.id) || blockIds.has(method.blockId)) {
            reports.push({ status: "duplicate", detail: ids.has(method.id) ? "method-id" : "block-id", methodId: method.id }); continue;
        }
        ids.add(method.id); blockIds.add(method.blockId);
        if (method.primary && primaries.has(method.type)) {
            reports.push({ status: "conflict", detail: "multiple-primary", methodId: method.id }); continue;
        }
        if (method.primary) primaries.add(method.type);
        accepted.push(method);
    }
    return finish(accepted);
}

const stable = (value) => Array.isArray(value) ? value.map(stable) : plain(value)
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])])) : value;
const fingerprint = (value) => hash(json(stable(value)));
const methodData = (method) => ({ type: method.type, label: method.label, primary: method.primary, order: method.order, value: method.value });
function adoptionPlan(request) {
    const refuse = (detail) => ({ ok: false, status: "unknown", detail });
    if (!plain(request)) return refuse("adoption-request");
    const source = parseBlock(request.sourcePayload);
    if (!source.ok || source.method.owner !== source.method.parentId) return refuse("source-payload-unverified");
    const target = readDocument(request.targetBefore);
    if (!target.complete || !target.writeAllowed) return refuse("target-snapshot-incomplete");
    if (typeof request.requestId !== "string" || !SOURCE.test(request.requestId)
        || typeof request.sourceKey !== "string" || !SOURCE.test(request.sourceKey)
        || typeof request.blockId !== "string" || !NODE_ID.test(request.blockId)
        || !FORMATS.includes(request.format)) return refuse("new-target-fields-invalid");
    if (target.methods.length >= MAX_BLOCKS) return refuse("target-capacity-exhausted");
    if (target.methods.some((method) => method.sourceKey === request.sourceKey || method.blockId === request.blockId)) return refuse("target-identity-already-exists");
    if (source.method.primary && target.methods.some((method) => method.primary && method.type === source.method.type)) return refuse("target-primary-conflict");
    const preview = { requestId: request.requestId, sourceFingerprint: fingerprint(request.sourcePayload), targetFingerprint: fingerprint(request.targetBefore),
        targetDocId: request.targetBefore.docId, sourceKey: request.sourceKey, blockId: request.blockId, format: request.format, content: methodData(source.method) };
    return { ok: true, status: "preview", preview, confirmationFingerprint: fingerprint(preview) };
}
export function previewAdoption(request) { return adoptionPlan(request); }

/** Produces a proposal only. No native or plugin write is performed. */
export function adopt(request) {
    const refuse = (detail, status = "unknown") => ({ ok: false, status, detail, identityAllocated: false, proposal: null });
    if (request?.confirmed !== true) return refuse("explicit-confirmation-required", "cancelled");
    const prior = adoptionProposals.get(request.requestId);
    if (request.writeOutcome === "unknown") return { ...refuse("write-outcome-unknown-no-new-proposal"), existingIdentity: prior?.method.id ?? null };
    const plan = adoptionPlan(request);
    if (!plan.ok) return refuse(plan.detail);
    if (request.confirmationFingerprint !== plan.confirmationFingerprint) return refuse("confirmation-preview-changed");
    if (prior) {
        if (prior.confirmationFingerprint !== plan.confirmationFingerprint) return { ...refuse("same-request-content-changed"), existingIdentity: prior.method.id };
        return { ok: true, status: "existing-proposal", identityAllocated: false, existingIdentity: prior.method.id, method: clone(prior.method), proposal: null, writeAllowed: false };
    }
    const current = readDocument(request.targetNow);
    if (!current.complete || !current.writeAllowed || fingerprint(request.targetNow) !== plan.preview.targetFingerprint) return refuse("target-changed-or-unverified");
    if ([...adoptionProposals.values()].some((entry) => entry.method.blockId === plan.preview.blockId
        || (entry.method.owner === plan.preview.targetDocId && entry.method.sourceKey === plan.preview.sourceKey))) return refuse("session-target-identity-already-proposed");
    if (adoptionProposals.size >= MAX_BLOCKS) return refuse("bounded-proposal-session-full");
    const method = { ...plan.preview.content, owner: plan.preview.targetDocId, sourceKey: plan.preview.sourceKey,
        id: expectedIdentity(plan.preview.targetDocId, plan.preview.sourceKey), blockId: plan.preview.blockId };
    const proposal = encode(method, plan.preview.format);
    const pending = [...adoptionProposals.values()].filter((entry) => entry.method.owner === plan.preview.targetDocId);
    const missingPending = [];
    for (const entry of pending) {
        const observed = current.methods.find((value) => value.id === entry.method.id || value.blockId === entry.method.blockId);
        if (!observed) missingPending.push(entry.proposal);
        else if (observed.id !== entry.method.id || observed.blockId !== entry.method.blockId
            || fingerprint(methodData(observed)) !== fingerprint(methodData(entry.method))) return refuse("session-proposal-observation-conflict");
    }
    // Validate the complete prospective set, including unobserved proposals
    // reserved by this process, before allocating/returning a new identity.
    const prospective = readDocument({ ...request.targetNow, blocks: [...request.targetNow.blocks, ...missingPending, proposal] });
    if (!prospective.complete || !prospective.writeAllowed) return refuse("prospective-target-incomplete-or-conflicting");
    // This is the only allocation path. All validation, full target reread,
    // confirmation binding and collision checks precede it.
    identityAllocations += 1;
    adoptionProposals.set(request.requestId, { method: clone(method), proposal: clone(proposal), confirmationFingerprint: plan.confirmationFingerprint });
    return { ok: true, status: "proposal", identityAllocated: true, method, proposal };
}

export function dedicatedEdit(request) {
    const refuse = (detail) => ({ ok: false, status: "unknown", detail, proposal: null });
    if (request?.confirmed !== true) return { ...refuse("explicit-confirmation-required"), status: "cancelled" };
    const before = readDocument(request.before), now = readDocument(request.now);
    if (!before.complete || !now.complete || fingerprint(request.before) !== fingerprint(request.now)) return refuse("snapshot-changed-or-incomplete");
    const method = now.methods.find((entry) => entry.id === request.methodId);
    if (!method || method.format !== FORMATS[1] || !validText(request.value, MAX_VALUE, false)) return refuse("editor-input-or-method-invalid");
    return { ok: true, status: "proposal", proposal: encode({ ...method, value: request.value }, FORMATS[1]) };
}

const docId = (n) => `20261017000000-${String(n).padStart(7, "0")}`;
export function fixtureMethod(owner = docId(1), sourceKey = "phone-primary", overrides = {}) {
    return { owner, sourceKey, id: expectedIdentity(owner, sourceKey), blockId: docId(101), type: "phone", label: "工作 / 主线", primary: false, order: 0, value: "+00 111 / +00 222", ...overrides };
}
const fixtureDocument = (blocks, owner = docId(1)) => ({ docId: owner, enumerationComplete: true, blocks });
const bodyChanged = (block, value) => ({ ...clone(block), content: value, markdown: value });

export function runChecks() {
    const checks = [];
    const check = (name, pass, detail = "") => checks.push({ name, pass: Boolean(pass), ...(detail ? { detail } : {}) });
    const blocked = (read, status) => !read.complete && !read.writeAllowed && read.methods.length === 0
        && (!status || read.reports.some((entry) => entry.status === status));
    const specialValues = [
        "+00 111 / +00 222", " leading and trailing  ", "第一行\n第二行\n", "CRLF\r\nTAB\t尾",
        '引号" 反斜杠\\ 字面\\n 与真实\n双重\\\\n', "**粗体** _斜体_ [链接](https://example.test/a?b=1&c=2) `代码` # 标题 | <保留>",
        "值：\n联系方式：电话\n标签：伪头\n主值：是", "分隔\u2028符\u2029与🙂𠮷", "同值 same@example.test",
    ];
    const base = fixtureMethod();
    const candidateSummary = [];
    resetCounters();
    for (const format of FORMATS) {
        for (let index = 0; index < specialValues.length; index += 1) {
            const method = { ...base, value: specialValues[index], label: index === 3 ? '标签"\\\n新行' : base.label };
            const block = encode(method, format), read = readDocument(fixtureDocument([block]));
            check(`${format}:exact-value-${index + 1}`, read.complete && read.methods[0]?.value === method.value && read.methods[0]?.label === method.label);
            if (format === FORMATS[0]) check(`${format}:physical-single-line-${index + 1}`, !/[\r\n\u2028\u2029]/u.test(block.content));
        }
        const encoded = encode(base, format);
        check(`${format}:empty-value-visible-refusal`, (() => { try { encode({ ...base, value: "" }, format); return false; } catch { return true; } })());
        check(`${format}:control-value-visible-refusal`, (() => { try { encode({ ...base, value: "a\u0000b" }, format); return false; } catch { return true; } })());
        check(`${format}:lone-surrogate-visible-refusal`, (() => { try { encode({ ...base, value: "\ud800" }, format); return false; } catch { return true; } })());
        const collapsed = bodyChanged(encoded, encoded.content.replace(/[\r\n]/g, ""));
        const collapsedRead = readDocument(fixtureDocument([collapsed]));
        check(`${format}:modeled-newline-collapse`, format === FORMATS[0] ? collapsedRead.complete && collapsedRead.methods[0].value === base.value : blocked(collapsedRead, "unknown"));
        candidateSummary.push({ format, syntheticRoundtrip: true, modeledNewlineCollapse: format === FORMATS[0] ? "unchanged-canonical-body" : "refused-unknown", hostVerified: false });
    }
    const valid = encode(base), goodDoc = fixtureDocument([valid]);
    const second = encode(fixtureMethod(docId(1), "email-secondary", { blockId: docId(102), type: "email", value: "same@example.test", order: 1 }));
    const mixedDoc = fixtureDocument([valid, second]);
    check("single-json-readable-type-label-primary-and-value", valid.content.includes('"类型":"电话"') && valid.content.includes('"标签":"工作 / 主线"') && valid.content.includes('"值":"+00 111 / +00 222"'));
    const doubleEscaped = encode({ ...base, value: "literal\\n" });
    check("double-escape-is-literal-not-recursively-decoded", readDocument(fixtureDocument([doubleEscaped])).methods[0].value === "literal\\n");
    const duplicateKey = bodyChanged(valid, valid.content.replace('"值":"', '"值":"silently discarded","值":"'));
    check("json-duplicate-key-cannot-silently-discard-first-value", blocked(readDocument(fixtureDocument([duplicateKey])), "unknown"));
    check("json-unknown-field-refused", blocked(readDocument(fixtureDocument([bodyChanged(valid, valid.content.replace(/}$/, ',"未知":1}'))])), "unknown"));
    check("json-wrong-value-type-refused", blocked(readDocument(fixtureDocument([bodyChanged(valid, valid.content.replace(json(base.value), "42"))])), "unknown"));
    check("json-malformed-escape-refused", blocked(readDocument(fixtureDocument([bodyChanged(valid, valid.content.replace(json(base.value), '"bad\\q"'))])), "unknown"));
    const bodyTypeMismatch = bodyChanged(valid, valid.content.replace('"类型":"电话"', '"类型":"邮箱"'));
    check("body-attribute-meaning-mismatch-refused", blocked(readDocument(fixtureDocument([bodyTypeMismatch])), "unknown"));
    const uiId = clone(valid); uiId.attrs[`${PREFIX}id`] = "ui-phone-primary";
    check("legacy-ui-fixture-does-not-pass-strict-method-hash", blocked(readDocument(fixtureDocument([uiId])), "unknown"));
    const unknownFormat = clone(second); unknownFormat.attrs[`${PREFIX}format`] = "future-unknown";
    const badSource = clone(second); badSource.attrs[`${PREFIX}source`] = "email-other-source";
    const samePersonCopy = clone(valid); samePersonCopy.id = docId(103);
    const crossPersonCopy = clone(valid); crossPersonCopy.id = docId(104); crossPersonCopy.parentId = docId(2);
    const rewrittenOwnerCopy = clone(crossPersonCopy); rewrittenOwnerCopy.attrs[`${PREFIX}owner`] = docId(2);
    check("same-person-raw-copy-preserves-identity-and-is-duplicate", blocked(readDocument(fixtureDocument([valid, samePersonCopy])), "duplicate"));
    check("cross-person-raw-copy-original-owner-is-conflict", blocked(readDocument(fixtureDocument([crossPersonCopy], docId(2))), "conflict"));
    check("cross-person-rewritten-owner-old-id-is-unknown", blocked(readDocument(fixtureDocument([rewrittenOwnerCopy], docId(2))), "unknown"));
    check("rewritten-source-old-id-is-unknown", blocked(readDocument(fixtureDocument([valid, badSource])), "unknown"));
    const subsetRead = readDocument(fixtureDocument([valid, unknownFormat]));
    check("unknown-with-valid-subset-never-complete-or-writable", blocked(subsetRead, "unknown") && subsetRead.diagnosticAcceptedCount === 1);
    const mixedDuplicate = readDocument(fixtureDocument([valid, second, samePersonCopy]));
    check("duplicate-with-valid-subset-never-complete-or-writable", blocked(mixedDuplicate, "duplicate") && mixedDuplicate.diagnosticAcceptedCount === 2);
    const crossWithValid = readDocument(fixtureDocument([encode(fixtureMethod(docId(2), "phone-existing", { blockId: docId(105) })), crossPersonCopy], docId(2)));
    check("conflict-with-valid-subset-never-complete-or-writable", blocked(crossWithValid, "conflict") && crossWithValid.diagnosticAcceptedCount === 1);
    const unknownAttrs = clone(valid); unknownAttrs.attrs[`${PREFIX}future-field`] = "do not discard";
    check("unknown-method-attribute-blocks-entire-read", blocked(readDocument(fixtureDocument([unknownAttrs])), "unknown"));
    const absentMarker = clone(valid); delete absentMarker.attrs[MARKER];
    check("method-scope-missing-marker-not-skipped-as-irrelevant", blocked(readDocument(fixtureDocument([absentMarker])), "unknown"));
    check("incomplete-enumeration-cannot-infer-deletion", blocked(readDocument({ ...mixedDoc, enumerationComplete: false, blocks: [valid] }), "unknown"));
    check("missing-enumeration-proof-is-unknown", blocked(readDocument({ docId: goodDoc.docId, blocks: [valid] }), "unknown"));
    check("empty-verified-scope-is-complete-without-auto-tombstones", readDocument(fixtureDocument([])).complete && counters().nativeWrites === 0);
    check("bounded-block-count-refused", blocked(readDocument(fixtureDocument(Array(MAX_BLOCKS + 1).fill(valid))), "unknown"));
    check("malformed-document-is-unknown-not-thrown", blocked(readDocument(null), "unknown"));
    check("malformed-block-is-unknown-not-thrown", blocked(readDocument(fixtureDocument([null])), "unknown"));
    check("markdown-content-divergence-is-unknown", blocked(readDocument(fixtureDocument([{ ...valid, markdown: "changed" }])), "unknown"));
    const duplicateBlock = clone(second); duplicateBlock.id = valid.id;
    check("different-methods-same-block-id-is-duplicate", blocked(readDocument(fixtureDocument([valid, duplicateBlock])), "duplicate"));
    const primaryA = encode({ ...base, primary: true });
    const primaryB = encode(fixtureMethod(docId(1), "phone-other", { blockId: docId(106), primary: true }));
    check("multiple-primary-blocks-entire-read", blocked(readDocument(fixtureDocument([primaryA, primaryB])), "conflict"));
    const unsafeOrder = clone(valid); unsafeOrder.attrs[`${PREFIX}order`] = "9007199254740992";
    check("unsafe-order-refused", blocked(readDocument(fixtureDocument([unsafeOrder])), "unknown"));
    const unknownType = clone(valid); unknownType.attrs[`${PREFIX}type`] = "fax";
    check("unknown-type-refused", blocked(readDocument(fixtureDocument([unknownType])), "unknown"));
    const coercedType = clone(valid); coercedType.attrs[`${PREFIX}type`] = ["phone"];
    check("coercible-nonstring-type-refused", blocked(readDocument(fixtureDocument([coercedType])), "unknown"));
    check("coercible-nonstring-document-id-refused", blocked(readDocument({ ...goodDoc, docId: [goodDoc.docId] }), "unknown"));
    const tooLarge = bodyChanged(valid, valid.content.replace(json(base.value), json("x".repeat(MAX_VALUE + 1))));
    check("bounded-value-size-refused", blocked(readDocument(fixtureDocument([tooLarge])), "unknown"));
    const beforeReads = json(mixedDoc);
    for (let repeat = 0; repeat < 4; repeat += 1) { readDocument(mixedDoc); readDocument(fixtureDocument([valid, unknownFormat])); }
    check("read-and-refresh-zero-identity-allocation-and-mutation", counters().identityAllocations === 0 && json(mixedDoc) === beforeReads && counters().automaticRepairs === 0);

    const editorBlock = encode({ ...base, value: "原文\n第二行" }, FORMATS[1]);
    const editorDoc = fixtureDocument([editorBlock]);
    const editorRequest = { confirmed: true, before: editorDoc, now: clone(editorDoc), methodId: base.id, value: specialValues[4] };
    const edited = dedicatedEdit(editorRequest);
    check("dedicated-editor-proposal-retains-id-and-exact-value", edited.ok && readDocument(fixtureDocument([edited.proposal])).methods[0]?.value === editorRequest.value && attr(edited.proposal, "id") === base.id);
    const staleEditor = clone(editorDoc); staleEditor.blocks[0] = encode({ ...base, value: "外部第三值" }, FORMATS[1]);
    check("dedicated-editor-stale-full-snapshot-refused", !dedicatedEdit({ ...editorRequest, now: staleEditor }).ok);
    check("dedicated-editor-incomplete-snapshot-refused", !dedicatedEdit({ ...editorRequest, now: { ...editorDoc, enumerationComplete: false } }).ok);
    check("dedicated-editor-cancel-and-empty-value-zero-repair", !dedicatedEdit({ ...editorRequest, confirmed: false }).ok && !dedicatedEdit({ ...editorRequest, value: "" }).ok && counters().automaticRepairs === 0);
    const sealed = encode(base, FORMATS[2]);
    check("sealed-multiline-raw-free-edit-is-refused", blocked(readDocument(fixtureDocument([bodyChanged(sealed, `${sealed.content}人工修改`)])), "unknown"));
    check("sealed-multiline-parse-does-not-reseal-or-repair", json(sealed) === json(encode(base, FORMATS[2])) && counters().automaticRepairs === 0);
    check("dedicated-edit-never-allocates-identity", counters().identityAllocations === 0);

    const sourcePayload = encode(fixtureMethod(docId(1), "source-copy", { blockId: docId(107), value: specialValues[4] }));
    const targetBefore = fixtureDocument([second]);
    const adoptionRequest = { requestId: "same-person-copy-request", sourcePayload, targetBefore, targetNow: clone(targetBefore), sourceKey: "confirmed-copy", blockId: docId(108), format: FORMATS[0] };
    const preview = previewAdoption(adoptionRequest);
    check("adoption-preview-zero-allocation", preview.ok && counters().identityAllocations === 0 && !Object.hasOwn(preview.preview, "id"));
    const confirmed = { ...adoptionRequest, confirmed: true, confirmationFingerprint: preview.confirmationFingerprint };
    const refusalChecks = [
        ["cancelled", { ...confirmed, confirmed: false }],
        ["missing-confirmation-binding", { ...confirmed, confirmationFingerprint: "" }],
        ["changed-source-after-confirmation", { ...confirmed, sourcePayload: encode(fixtureMethod(docId(1), "source-copy", { blockId: docId(107), value: "changed" })) }],
        ["unknown-source-format", { ...confirmed, sourcePayload: unknownFormat }],
        ["source-owner-not-parent", { ...confirmed, sourcePayload: crossPersonCopy }],
        ["incomplete-target-before", { ...confirmed, targetBefore: { ...targetBefore, enumerationComplete: false } }],
        ["unknown-target-now", { ...confirmed, targetNow: fixtureDocument([second, unknownFormat]) }],
        ["duplicate-target-now", { ...confirmed, targetNow: fixtureDocument([second, second]) }],
        ["incomplete-target-now", { ...confirmed, targetNow: { ...targetBefore, enumerationComplete: false } }],
        ["target-third-value", { ...confirmed, targetNow: fixtureDocument([encode(fixtureMethod(docId(1), "email-secondary", { blockId: docId(102), type: "email", value: "third@example.test", order: 1 }))]) }],
        ["target-deletion-race", { ...confirmed, targetNow: fixtureDocument([]) }],
        ["target-owner-changed", { ...confirmed, targetNow: fixtureDocument([], docId(2)) }],
        ["invalid-new-source", { ...confirmed, sourceKey: "value/from/name" }],
        ["source-key-already-exists", { ...confirmed, sourceKey: "email-secondary" }],
        ["block-id-already-exists", { ...confirmed, blockId: second.id }],
        ["unknown-new-format", { ...confirmed, format: "unknown" }],
        ["unknown-write-with-no-prior-identity", { ...confirmed, writeOutcome: "unknown" }],
    ];
    for (const [name, request] of refusalChecks) {
        const original = json(request), refused = adopt(request);
        check(`adoption:${name}:zero-allocation-no-proposal-or-mutation`, !refused.ok && !refused.identityAllocated && refused.proposal === null && counters().identityAllocations === 0 && original === json(request));
    }
    const primaryRequest = { ...adoptionRequest, sourcePayload: primaryA, targetBefore: fixtureDocument([primaryB]), targetNow: fixtureDocument([primaryB]) };
    check("adoption-primary-collision-refused-before-allocation", !previewAdoption(primaryRequest).ok && counters().identityAllocations === 0);
    const adoptedSame = adopt(confirmed);
    const sameRead = readDocument(fixtureDocument([...targetBefore.blocks, adoptedSame.proposal]));
    check("explicit-same-person-adoption-new-id-source-and-exact-value", adoptedSame.ok && adoptedSame.method.id !== attr(sourcePayload, "id") && sameRead.complete && sameRead.methods.find((method) => method.id === adoptedSame.method.id)?.value === specialValues[4] && counters().identityAllocations === 1);
    const reused = adopt(confirmed);
    check("same-request-retains-identity-without-reissuing-proposal", reused.status === "existing-proposal" && !reused.identityAllocated && reused.existingIdentity === adoptedSame.method.id && reused.proposal === null && !reused.writeAllowed && counters().identityAllocations === 1);
    const unknownIssued = adopt({ ...confirmed, writeOutcome: "unknown", sourceKey: "must-not-bypass-unknown" });
    check("unknown-write-retains-original-request-identity-zero-new-proposal", !unknownIssued.ok && unknownIssued.status === "unknown" && unknownIssued.existingIdentity === adoptedSame.method.id && unknownIssued.proposal === null && counters().identityAllocations === 1);
    const changedRequest = { ...adoptionRequest, sourceKey: "changed-same-request" };
    const changedPreview = previewAdoption(changedRequest);
    check("same-request-cannot-change-source-to-create-another-identity", !adopt({ ...changedRequest, confirmed: true, confirmationFingerprint: changedPreview.confirmationFingerprint }).ok && counters().identityAllocations === 1);
    const targetCross = fixtureDocument([], docId(2));
    const crossRequest = { ...adoptionRequest, requestId: "cross-person-copy-request", targetBefore: targetCross, targetNow: clone(targetCross), sourceKey: "cross-confirmed-copy", blockId: docId(109) };
    const crossPreview = previewAdoption(crossRequest);
    const adoptedCross = adopt({ ...crossRequest, confirmed: true, confirmationFingerprint: crossPreview.confirmationFingerprint });
    const crossRead = readDocument(fixtureDocument([adoptedCross.proposal], docId(2)));
    check("explicit-cross-person-adoption-rewrites-owner-source-and-id", adoptedCross.ok && adoptedCross.method.owner === docId(2) && adoptedCross.method.sourceKey === crossRequest.sourceKey && adoptedCross.method.id !== attr(sourcePayload, "id") && crossRead.complete && counters().identityAllocations === 2);
    check("read-adopted-proposal-does-not-allocate-again", readDocument(fixtureDocument([adoptedCross.proposal], docId(2))).complete && counters().identityAllocations === 2);
    const repeated = { ...confirmed, targetBefore: fixtureDocument([...targetBefore.blocks, adoptedSame.proposal]), targetNow: fixtureDocument([...targetBefore.blocks, adoptedSame.proposal]) };
    check("adoption-existing-source-not-reallocated-on-retry", !previewAdoption(repeated).ok && counters().identityAllocations === 2);
    const newRequestSameSource = { ...adoptionRequest, requestId: "new-request-same-source" };
    const sameSourcePreview = previewAdoption(newRequestSameSource);
    check("different-request-stale-target-same-owner-source-refused", !adopt({ ...newRequestSameSource, confirmed: true, confirmationFingerprint: sameSourcePreview.confirmationFingerprint }).ok && counters().identityAllocations === 2);
    const newRequestSameBlock = { ...adoptionRequest, requestId: "new-request-same-block", sourceKey: "new-request-new-source" };
    const sameBlockPreview = previewAdoption(newRequestSameBlock);
    check("different-request-stale-target-same-block-refused", !adopt({ ...newRequestSameBlock, confirmed: true, confirmationFingerprint: sameBlockPreview.confirmationFingerprint }).ok && counters().identityAllocations === 2);
    const crossOwnerSameBlock = { ...newRequestSameBlock, requestId: "cross-owner-same-block", targetBefore: targetCross, targetNow: clone(targetCross) };
    const crossOwnerSameBlockPreview = previewAdoption(crossOwnerSameBlock);
    check("different-owner-same-proposed-block-id-refused", !adopt({ ...crossOwnerSameBlock, confirmed: true, confirmationFingerprint: crossOwnerSameBlockPreview.confirmationFingerprint }).ok && counters().identityAllocations === 2);
    const fullBlocks = Array.from({ length: MAX_BLOCKS }, (_, index) => encode(fixtureMethod(docId(3), `full-${index}`, { blockId: docId(300 + index), order: index })));
    const fullRequest = { ...adoptionRequest, requestId: "full-scope-request", targetBefore: fixtureDocument(fullBlocks, docId(3)), targetNow: fixtureDocument(fullBlocks, docId(3)), blockId: docId(500) };
    check("already-full-target-refused-in-preview-before-allocation", !previewAdoption(fullRequest).ok && counters().identityAllocations === 2);
    const almostFullDoc = fixtureDocument(fullBlocks.slice(0, -1), docId(3));
    const lastSlotRequest = { ...fullRequest, requestId: "last-slot-first-request", targetBefore: almostFullDoc, targetNow: clone(almostFullDoc) };
    const lastSlotPreview = previewAdoption(lastSlotRequest);
    const lastSlot = adopt({ ...lastSlotRequest, confirmed: true, confirmationFingerprint: lastSlotPreview.confirmationFingerprint });
    check("last-target-slot-proposal-has-complete-prospective-set", lastSlot.ok && readDocument({ ...almostFullDoc, blocks: [...almostFullDoc.blocks, lastSlot.proposal] }).complete && counters().identityAllocations === 3);
    const overPendingCapacity = { ...lastSlotRequest, requestId: "last-slot-second-request", sourceKey: "second-last-slot", blockId: docId(501) };
    const overPendingPreview = previewAdoption(overPendingCapacity);
    check("unobserved-session-proposal-consumes-target-capacity", !adopt({ ...overPendingCapacity, confirmed: true, confirmationFingerprint: overPendingPreview.confirmationFingerprint }).ok && counters().identityAllocations === 3);
    const pendingPrimaryDoc = fixtureDocument([], docId(4));
    const pendingPrimaryRequest = { ...adoptionRequest, requestId: "pending-primary-first", sourcePayload: primaryA, targetBefore: pendingPrimaryDoc, targetNow: clone(pendingPrimaryDoc), sourceKey: "pending-primary-first", blockId: docId(601) };
    const pendingPrimaryPreview = previewAdoption(pendingPrimaryRequest);
    const pendingPrimaryFirst = adopt({ ...pendingPrimaryRequest, confirmed: true, confirmationFingerprint: pendingPrimaryPreview.confirmationFingerprint });
    check("first-session-primary-valid-proposal", pendingPrimaryFirst.ok && counters().identityAllocations === 4);
    const pendingPrimarySecondRequest = { ...pendingPrimaryRequest, requestId: "pending-primary-second", sourceKey: "pending-primary-second", blockId: docId(602) };
    const pendingPrimarySecondPreview = previewAdoption(pendingPrimarySecondRequest);
    check("unobserved-session-primary-participates-in-conflict-check", !adopt({ ...pendingPrimarySecondRequest, confirmed: true, confirmationFingerprint: pendingPrimarySecondPreview.confirmationFingerprint }).ok && counters().identityAllocations === 4);
    const otherOwnerPrimaryTarget = fixtureDocument([], docId(5));
    const otherOwnerPrimaryRequest = { ...pendingPrimaryRequest, requestId: "other-owner-primary", targetBefore: otherOwnerPrimaryTarget, targetNow: clone(otherOwnerPrimaryTarget), sourceKey: "other-owner-primary", blockId: docId(603) };
    const otherOwnerPrimaryPreview = previewAdoption(otherOwnerPrimaryRequest);
    const otherOwnerPrimary = adopt({ ...otherOwnerPrimaryRequest, confirmed: true, confirmationFingerprint: otherOwnerPrimaryPreview.confirmationFingerprint });
    check("same-type-primary-is-allowed-for-different-owner", otherOwnerPrimary.ok && counters().identityAllocations === 5);
    check("all-research-paths-zero-automatic-repair-native-write-network", counters().automaticRepairs === 0 && counters().nativeWrites === 0 && counters().kernelRequests === 0);
    return { checks, candidateSummary, counters: counters(), bounds: { maxMethodsPerFixture: MAX_BLOCKS, maxValueUtf16Units: MAX_VALUE, maxLabelUtf16Units: MAX_LABEL, specialValues: specialValues.length } };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const run = runChecks(), failed = run.checks.filter((entry) => !entry.pass);
    const result = {
        research: "AG-RF-004-N2", generatedAt: "2026-10-17", syntheticOnly: true,
        candidateContractAccepted: false, productionChanges: false, hostVerified: false, status: "host_pending",
        kernelRequests: 0, realPluginFileWrites: 0, actualNativeWrites: 0, browserCalls: 0,
        uiControlChannel: "unavailable-for-this-research", ...run,
        summary: { total: run.checks.length, passed: run.checks.length - failed.length, failed: failed.length },
        limitations: [
            "All editor transformations are explicit in-memory models; no real editor stability has been proved for any N2 format.",
            "readDocument reads only already-selected candidate method blocks, never an entire person document. complete/writeAllowed refer only to that synthetic scope. Scope discovery/filtering is not implemented.",
            "enumerationComplete=true is a synthetic verified-full-scope premise; production host enumeration, missing-marker discovery and concurrent revalidation remain unproved.",
            "A SHA256 seal detects accidental changes, is not an authorization signature, and may be recomputed by an external writer.",
            "Adoption and dedicated editing return proposals only; native write atomicity, CAS, delayed writes and post-write reread are not implemented.",
            "The bounded same-process proposal memo retains request identity, refuses caller-declared unknown-write reissuance and blocks owner/source or block collisions in that session. It is not persistent recovery or proof against changing both source and request IDs, or restarting.",
            "The full-snapshot comparison does not provide a lock or prevent a write after the final reread.",
            "Legacy UI ui-* IDs do not pass strict method-hash identity checks and cannot prove N1/N2 parsing.",
            "No production facts, AV projections, migration, vCard mapping, large-library search or marketplace release is changed.",
        ],
    };
    if (failed.length) { console.error(json({ summary: result.summary, failed })); process.exitCode = 1; }
    else {
        writeFileSync(OUTPUT, `${JSON.stringify(result, null, 2)}\n`, "utf8");
        console.log(`total ${result.summary.total}, passed ${result.summary.passed}, failed ${result.summary.failed}`);
        console.log(`syntheticOnly=true, hostVerified=false, status=host_pending, candidates=${FORMATS.length}`);
        console.log(`identityAllocations=${run.counters.identityAllocations} (explicit adoption proposals only), automaticRepairs=0, nativeWrites=0, kernelRequests=0, browserCalls=0`);
    }
}
