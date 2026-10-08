import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import { createJobPlans, assertDistinctJobIsolation, runParallel, sanitizeJobName, stopOwnedProcess } from "../scripts/e2e/parallel-runner.mjs";

test("E2E 并行编排：作业名称和临时证据路径隔离", () => {
    assert.equal(sanitizeJobName("插件 A / mobile"), "A-mobile");
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lvct-runner-test-"));
    try {
        const prepared = createJobPlans({ maxConcurrency: 4, jobs: [
            { name: "one", command: process.execPath },
            { name: "two", command: process.execPath },
        ] }, { cwd: root, runId: "isolation" });
        assert.equal(prepared.maxConcurrency, 2);
        assertDistinctJobIsolation(prepared.plans);
        assert.notEqual(prepared.plans[0].jobRoot, prepared.plans[1].jobRoot);
        assert.notEqual(prepared.plans[0].artifactDir, prepared.plans[1].artifactDir);
        assert.equal(prepared.plans[0].env.LVCT_E2E_JOB_ID, "one");
        assert.equal(prepared.plans[1].env.LVCT_E2E_EVIDENCE_FILE, prepared.plans[1].evidenceFile);
        fs.rmSync(prepared.runRoot, { recursive: true, force: true });
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("E2E 并行编排：两个作业同时运行并各自保存退出结果", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lvct-runner-run-"));
    try {
        const summary = await runParallel({ maxConcurrency: 2, jobs: [
            { name: "fast", command: process.execPath, args: ["-e", "setTimeout(() => process.exit(0), 30)"] },
            { name: "slow", command: process.execPath, args: ["-e", "setTimeout(() => process.exit(0), 60)"] },
        ] }, { cwd: root, runId: "parallel" });
        assert.equal(summary.ok, true);
        assert.deepEqual(summary.jobs.map((job) => job.ok), [true, true]);
        assert.ok(fs.existsSync(path.join(summary.artifactRoot, "summary.json")));
        for (const job of summary.jobs) assert.ok(fs.existsSync(job.logFile));
        fs.rmSync(summary.runRoot, { recursive: true, force: true });
        fs.rmSync(summary.artifactRoot, { recursive: true, force: true });
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("E2E 并行编排：一个作业失败不取消其他作业", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lvct-runner-failure-"));
    try {
        const marker = path.join(root, "survivor.txt");
        const summary = await runParallel({ maxConcurrency: 2, jobs: [
            { name: "failed", command: process.execPath, args: ["-e", "process.exit(7)"] },
            { name: "survivor", command: process.execPath, args: ["-e", `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ran'); setTimeout(() => process.exit(0), 40)`] },
        ] }, { cwd: root, runId: "failure-isolated" });
        assert.equal(summary.ok, false);
        assert.equal(summary.jobs[0].ok, false);
        assert.equal(summary.jobs[1].ok, true);
        assert.equal(fs.readFileSync(marker, "utf8"), "ran");
        fs.rmSync(summary.runRoot, { recursive: true, force: true });
        fs.rmSync(summary.artifactRoot, { recursive: true, force: true });
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("E2E 并行编排：停止只使用被编排器持有的 PID", async () => {
    const child = Object.assign(new EventEmitter(), { pid: 1234, exitCode: null, signalCode: null });
    await assert.rejects(stopOwnedProcess(child, {
        platform: "win32",
        spawnProcess: () => { throw new Error("test helper"); },
        graceMs: 1,
    }), /test helper/);
});
