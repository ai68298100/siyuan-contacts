import { test } from "node:test";
import assert from "node:assert/strict";
import {
    beginCaptureCheckpoint,
    captureCheckpointComplete,
    captureDiagnosticSummary,
    capturePersonStatus,
    shouldWriteCaptureProjection,
} from "../src/domain/capture-checkpoint.ts";

const input = {
    personDocIds: ["20260927000000-person1", "20260927000000-person2"],
    newNames: ["新人"],
    date: "2026-10-04",
    place: "会议室",
    note: "回归",
};

test("捕获 checkpoint 保留每人的成功、失败和未知状态", () => {
    const checkpoint = beginCaptureCheckpoint("20260927000000-source1", "anchor", input, "request-1");
    checkpoint.people[0].contact = { status: "skipped" };
    checkpoint.people[0].interaction = { status: "applied" };
    checkpoint.people[1].contact = { status: "failed", code: "bind_failed", message: "绑定失败" };
    checkpoint.people[1].interaction = { status: "pending" };
    checkpoint.people[2].contact = { status: "applied" };
    checkpoint.people[2].interaction = { status: "unknown", code: "interaction_unknown", message: "回读失败" };

    assert.equal(capturePersonStatus(checkpoint.people[0]), "applied");
    assert.equal(capturePersonStatus(checkpoint.people[1]), "failed");
    assert.equal(capturePersonStatus(checkpoint.people[2]), "unknown");
    assert.equal(captureCheckpointComplete(checkpoint), false);
    assert.match(captureDiagnosticSummary(checkpoint), /interaction_unknown/);
});

test("重试沿用稳定输入并递增代次，不重新构造人物身份", () => {
    const first = beginCaptureCheckpoint("20260927000000-source1", "anchor", input, "request-1");
    first.people[0].personDocId = "20260927000000-person1";
    first.people[0].contact = { status: "skipped" };
    first.people[0].interaction = { status: "applied" };
    const retry = beginCaptureCheckpoint("20260927000000-source1", "anchor", input, "request-2", first);

    assert.equal(retry.generation, 2);
    assert.equal(retry.requestId, "request-2");
    assert.equal(retry.people[0].personDocId, "20260927000000-person1");
    assert.equal(retry.people[0].interaction.status, "applied");
    assert.throws(
        () => beginCaptureCheckpoint("20260927000000-source1", "anchor", { ...input, date: "2026-10-05" }, "request-3", first),
        /沿用原笔记、数据库和确认输入/,
    );
});

test("成功投影内容不再写入，相同内容的失败或未知投影可以重试", () => {
    assert.equal(shouldWriteCaptureProjection({ key: "source", status: "applied", markdown: "same" }, "same"), false);
    assert.equal(shouldWriteCaptureProjection({ key: "source", status: "failed", markdown: "same" }, "same"), true);
    assert.equal(shouldWriteCaptureProjection({ key: "source", status: "unknown", markdown: "same" }, "same"), true);
    assert.equal(shouldWriteCaptureProjection(undefined, "same"), true);
});
