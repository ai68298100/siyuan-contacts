import { test } from "node:test";
import assert from "node:assert/strict";
import { AiExtractionError, buildAiPreflight } from "../src/domain/ai-preflight.ts";
import { parseExtraction } from "../src/domain/ai-extract.ts";
import { acceptAiCandidateInCapture, aiCandidateCanAccept, buildAiCandidateDrafts, captureAiCandidateEffect, decideAiCandidate, resetAiCandidate, restoreAiCandidateInCapture } from "../src/domain/ai-candidates.ts";
import type { AiCaptureDraft } from "../src/domain/ai-candidates.ts";
import { emptyDraft } from "../src/domain/person.ts";
import type { ContactSummary } from "../src/domain/person.ts";

const sourceId = "20261004000000-source1";
function person(docId: string, name = "样例甲"): ContactSummary {
    return { ...emptyDraft(), name, docId, itemId: `row-${docId}`, relatedItemIds: [] };
}
function extraction(value: unknown) {
    const parsed = parseExtraction(JSON.stringify(value));
    assert.ok(parsed);
    return parsed;
}

test("AI 预检包含完整提示和精确规模，冻结字段与正文", () => {
    const preview = buildAiPreflight("review-1", sourceId, "虚构正文🙂");
    assert.equal(preview.endpoint, "/api/ai/chatGPT");
    assert.equal(preview.downstream, "host_pending");
    assert.ok(preview.msg.includes("虚构正文🙂"));
    assert.equal(preview.characters, Array.from(preview.msg).length);
    assert.equal(preview.bytes, new TextEncoder().encode(preview.msg).length);
    assert.ok(Object.isFrozen(preview) && Object.isFrozen(preview.fields) && Object.isFrozen(preview.removed));
    assert.throws(() => { (preview.fields as string[]).push("secret"); });
});

test("默认去除联系方式、思源目标和元数据，保留姓名与真实日期", () => {
    const source = '样例甲 2026-10-04 手机13800000000 邮箱sample@example.test 座机010-12345678\n'
        + '((20261004000000-person1 "样例乙")) [人物](siyuan://blocks/20261004000000-person1)\n'
        + '{: id="20261004000000-person1" custom-test="私有"}\n{{select * from blocks}}';
    const preview = buildAiPreflight("review-2", sourceId, source);
    assert.ok(preview.msg.includes("样例甲 2026-10-04"));
    assert.ok(preview.msg.includes("样例乙"));
    for (const hidden of ["13800000000", "sample@example.test", "010-12345678", "20261004000000-person1", "custom-test", "select *"]) {
        assert.ok(!preview.msg.includes(hidden), hidden);
    }
    assert.equal(preview.removed.contacts, 3);
    assert.equal(preview.removed.metadata, 4);
    assert.equal(preview.sourceText, source);
});

test("明确关闭去除后可提名资料；配置、名册、来源 ID 不会自动加入发送文本", () => {
    const preview = buildAiPreflight("review-3", sourceId, "样例甲 13800000000", { removeContacts: false, fields: ["people", "profile"] });
    assert.ok(preview.msg.includes("13800000000"));
    assert.ok(!preview.msg.includes(sourceId));
    assert.equal(preview.removed.contacts, 0);
    assert.deepEqual(preview.fields, ["people", "profile"]);
});

test("6000 Unicode 字符截断不破坏代理对，原文与最终文本区分", () => {
    const preview = buildAiPreflight("review-4", sourceId, "🙂".repeat(6002));
    assert.equal(Array.from(preview.sentText).length, 6000);
    assert.equal(preview.removed.truncated, 2);
    assert.ok(preview.msg.includes(preview.sentText));
    assert.ok(!preview.msg.includes("🙂".repeat(6001)));
});

test("选段/粘贴保持来源与所选字段，候选不越过确认范围", () => {
    for (const sourceKind of ["selection", "paste"] as const) {
        const preview = buildAiPreflight("review-scope", sourceId, "样例甲", { sourceKind, fields: ["people", "people"] });
        const parsed = extraction({ people: ["样例甲"], profileCandidates: [{ person: "样例甲", field: "phone", value: "13800000000" }], date: "2026-10-04" });
        const drafts = buildAiCandidateDrafts(parsed, preview, []);
        assert.deepEqual(preview.fields, ["people"]);
        assert.equal(drafts.length, 1);
        assert.equal(drafts[0].evidence.sourceKind, sourceKind);
        assert.equal(drafts[0].kind, "person");
    }
});

test("所有 AI 草稿初始未接受，精确引用保留稳定来源和 UTF-16 位置", () => {
    const content = "🙂样例甲今天交流。";
    const preview = buildAiPreflight("review-evidence", sourceId, content);
    const drafts = buildAiCandidateDrafts(extraction({ version: 2, people: [{ name: "样例甲", evidence: "样例甲今天交流" }] }), preview, [person("person-a")]);
    assert.equal(drafts[0].checked, false);
    assert.equal(drafts[0].decision, "pending");
    assert.equal(drafts[0].evidence.status, "verified");
    assert.equal(drafts[0].evidence.start, 2);
    assert.equal(content.slice(drafts[0].evidence.start!, drafts[0].evidence.end!), drafts[0].evidence.quote);
    assert.equal(drafts[0].evidence.sourceDocId, sourceId);
    assert.ok(!drafts[0].id.includes("样例甲"));
});

test("姓名片段不能证明电话，伪造引用不会成为证据", () => {
    const preview = buildAiPreflight("review-weak", sourceId, "样例甲交流。", { removeContacts: false });
    const drafts = buildAiCandidateDrafts(extraction({ profileCandidates: [
        { person: "样例甲", field: "phone", value: "13800000000", evidence: "样例甲" },
        { person: "样例乙", field: "phone", value: "13900000000", evidence: "不存在的原文" },
    ] }), preview, []);
    assert.equal(drafts[0].evidence.status, "weak");
    assert.equal(drafts[1].evidence.status, "missing");
    assert.ok(drafts.every((candidate) => !candidate.checked));
});

test("同名展示全部稳定目标、未选目标不接受人物，新人资料/跟进不丢弃", () => {
    const preview = buildAiPreflight("review-ambiguity", sourceId, "样例甲与新人交流");
    const drafts = buildAiCandidateDrafts(extraction({ people: ["样例甲", "新人"],
        profileCandidates: [{ person: "新人", field: "wechat", value: "fictional" }],
        followUpCandidates: [{ person: "新人", title: "回传样例", dueDate: "2026-10-08" }],
    }), preview, [person("person-a"), person("person-b")]);
    assert.equal(drafts[0].targets.length, 2);
    assert.equal(drafts[0].selectedDocId, "");
    assert.equal(aiCandidateCanAccept(drafts[0]), false);
    assert.ok(!decideAiCandidate(drafts, drafts[0].id, "accepted")[0].checked);
    drafts[0].selectedDocId = "person-b";
    assert.ok(decideAiCandidate(drafts, drafts[0].id, "accepted")[0].checked);
    assert.equal(drafts.filter((candidate) => candidate.personName === "新人").length, 3);
});

test("相同建议合并，同字段冲突只接受其一，编辑重置决定并保留 ID", () => {
    const preview = buildAiPreflight("review-conflict", sourceId, "样例甲", { removeContacts: false });
    let drafts = buildAiCandidateDrafts(extraction({ profileCandidates: [
        { person: "样例甲", field: "wechat", value: "sample-one" },
        { person: "样例甲", field: "wechat", value: "sample-one" },
        { person: "样例甲", field: "wechat", value: "sample-two" },
    ] }), preview, [person("person-a")]);
    assert.equal(drafts.length, 2);
    assert.ok(drafts.every((candidate) => candidate.conflict));
    drafts = decideAiCandidate(drafts, drafts[0].id, "accepted");
    drafts = decideAiCandidate(drafts, drafts[1].id, "accepted");
    assert.equal(drafts.filter((candidate) => candidate.checked).length, 1);
    assert.equal(drafts[0].decision, "rejected");
    const id = drafts[1].id;
    resetAiCandidate(drafts[1]);
    drafts[1].value = "edited";
    assert.equal(drafts[1].id, id);
    assert.equal(drafts[1].checked, false);
});

test("null/原始值/非法版本/非法日期/邮箱和自指关系不会变成有效事实", () => {
    assert.equal(parseExtraction("null"), null);
    assert.equal(parseExtraction("[]"), null);
    assert.equal(parseExtraction('{"version":99,"people":["样例甲"]}'), null);
    const result = extraction({ date: "2026-02-30", profileCandidates: [null, 123, "bad", [], { person: "样例甲", field: "email", value: "bad" }],
        followUpCandidates: [null, false, { person: "样例甲", dueDate: "2026-02-30" }],
        relationCandidates: [null, { personA: "样例甲", personB: "样例甲", relation: "同事" }],
    });
    assert.equal(result.date, undefined);
    assert.deepEqual(result.profileCandidates, []);
    assert.deepEqual(result.followUpCandidates, []);
    assert.deepEqual(result.relationCandidates, []);
    assert.equal(result.rejected, 11);
});

test("关系只作不可接受草稿；未接受的場合没有写入动作", () => {
    const preview = buildAiPreflight("review-relation", sourceId, "样例甲和样例乙是同事");
    const drafts = buildAiCandidateDrafts(extraction({ date: "2026-10-04", relationCandidates: [{ personA: "样例甲", personB: "样例乙", relation: "同事" }] }), preview, []);
    const relation = drafts.find((candidate) => candidate.kind === "relation")!;
    assert.equal(aiCandidateCanAccept(relation), false);
    assert.ok(decideAiCandidate(drafts, relation.id, "accepted").every((candidate) => !candidate.checked));
});

test("所有公开错误仅含固定类别，无正文、姓名、路径或服务回复", () => {
    for (const code of ["confirmation_required", "disabled", "source_unavailable", "unconfigured", "permission", "timeout", "cancelled", "protocol", "request_failed"] as const) {
        const error = new AiExtractionError(code);
        assert.equal(error.code, code);
        assert.ok(!/样例甲|13800000000|Token|C:\\|D:\\/.test(error.message));
    }
});

test("超限和坏人名有准确计数，原型属性名不冒充证据", () => {
    const result = extraction({ version: 2, people: [{ name: "样例甲", evidence: "样例甲" }, "constructor", "__proto__", null, 17, "123", ...Array.from({ length: 20 }, (_, index) => `人物${index}`)],
        profileCandidates: Array.from({ length: 22 }, (_, index) => ({ person: "样例甲", field: "wechat", value: `fictional-${index}` })),
    });
    assert.equal(result.names.length, 20);
    assert.equal(result.profileCandidates.length, 20);
    assert.equal(result.rejected, 8);
    const drafts = buildAiCandidateDrafts(result, buildAiPreflight("prototype-names", sourceId, "样例甲 constructor __proto__"), []);
    assert.equal(drafts.find((candidate) => candidate.personName === "constructor")?.evidence.status, "weak");
    assert.equal(parseExtraction('[{"people":["样例甲"]}]'), null);
});

function captureDraft(): AiCaptureDraft {
    return { checked: { "person-a": true }, newNamesText: "手动新人", date: "2026-10-01", place: "手动地点", note: "手动备注" };
}

test("拒绝或编辑已接受人物保留原双链勾选，撤销 AI 新增勾选", () => {
    const drafts = buildAiCandidateDrafts(extraction({ people: ["样例甲"] }), buildAiPreflight("undo-linked", sourceId, "样例甲"), [person("person-a")]);
    const accepted = decideAiCandidate(drafts, drafts[0].id, "accepted")[0];
    for (const previouslyChecked of [true, false]) {
        const initial = captureDraft();
        initial.checked["person-a"] = previouslyChecked;
        const effect = captureAiCandidateEffect(accepted, initial);
        const filled = acceptAiCandidateInCapture(accepted, initial);
        assert.equal(filled.checked["person-a"], true);
        const restored = restoreAiCandidateInCapture(accepted, effect, filled);
        assert.deepEqual(restored, initial);
        assert.equal(initial.checked["person-a"], previouslyChecked);
    }
});

test("接受新人后撤销仅去掉 AI 添加名单，保留原手动输入和后续新增", () => {
    const drafts = buildAiCandidateDrafts(extraction({ people: ["手动新人", "AI新人"] }), buildAiPreflight("undo-new", sourceId, "手动新人 AI新人"), []);
    for (const candidate of drafts) {
        const accepted = decideAiCandidate(drafts, candidate.id, "accepted").find((entry) => entry.id === candidate.id)!;
        const initial = captureDraft();
        const effect = captureAiCandidateEffect(accepted, initial);
        const filled = acceptAiCandidateInCapture(accepted, initial);
        filled.newNamesText += " 后续手动新人";
        const restored = restoreAiCandidateInCapture(accepted, effect, filled);
        assert.equal(restored.newNamesText, "手动新人 后续手动新人");
        assert.equal(initial.newNamesText, "手动新人");
    }
});

test("撤销场合恢复原日期/地点/备注，不覆盖接受后人工编辑", () => {
    const initial = captureDraft();
    const drafts = buildAiCandidateDrafts(extraction({ date: "2026-10-04", place: "AI地点", occasion: "AI备注" }), buildAiPreflight("undo-occasion", sourceId, "样例场合"), []);
    for (const candidate of drafts) {
        const accepted = decideAiCandidate(drafts, candidate.id, "accepted").find((entry) => entry.id === candidate.id)!;
        const effect = captureAiCandidateEffect(accepted, initial);
        const filled = acceptAiCandidateInCapture(accepted, initial);
        assert.deepEqual(restoreAiCandidateInCapture(accepted, effect, filled), initial);
        const manual = { ...filled, date: "2026-10-02", place: "后续人工地点", note: "后续人工备注" };
        assert.deepEqual(restoreAiCandidateInCapture(accepted, effect, manual), manual);
    }
});

test("未接受候选不填草稿；编辑撤销接受后需再确认", () => {
    const drafts = buildAiCandidateDrafts(extraction({ place: "AI地点" }), buildAiPreflight("undo-edit", sourceId, "样例场合"), []);
    const initial = captureDraft();
    assert.equal(acceptAiCandidateInCapture(drafts[0], initial), initial);
    const accepted = decideAiCandidate(drafts, drafts[0].id, "accepted")[0];
    const effect = captureAiCandidateEffect(accepted, initial);
    const filled = acceptAiCandidateInCapture(accepted, initial);
    const restored = restoreAiCandidateInCapture(accepted, effect, filled);
    resetAiCandidate(accepted);
    accepted.value = "修改后AI地点";
    assert.equal(acceptAiCandidateInCapture(accepted, restored), restored);
    assert.deepEqual(restored, initial);
});
