import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import net from "node:net";

const DEFAULT_MAX_CONCURRENCY = 2;
const DEFAULT_GRACE_MS = 15000;

function asPositiveInteger(value, fallback) {
    const number = Number(value);
    return Number.isSafeInteger(number) && number > 0 ? number : fallback;
}

export function sanitizeJobName(value) {
    const safe = String(value ?? "job").trim().replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
    return safe || "job";
}

export function loadParallelConfig(configFile) {
    const absolute = path.resolve(configFile);
    const parsed = JSON.parse(fs.readFileSync(absolute, "utf8"));
    if (!parsed || !Array.isArray(parsed.jobs) || parsed.jobs.length === 0) {
        throw new Error("E2E 编排配置必须包含非空 jobs 数组");
    }
    const maxConcurrency = asPositiveInteger(parsed.maxConcurrency, DEFAULT_MAX_CONCURRENCY);
    if (maxConcurrency > parsed.jobs.length) return { ...parsed, maxConcurrency: parsed.jobs.length };
    return { ...parsed, maxConcurrency };
}

function resolveCommand(command) {
    if (typeof command === "string" && command.trim()) {
        const normalized = command.trim();
        if (normalized === "node") return process.execPath;
        if (process.platform === "win32" && ["pnpm", "npm", "npx", "yarn"].includes(normalized)) return `${normalized}.cmd`;
        return normalized;
    }
    throw new Error("E2E 作业 command 必须是非空字符串");
}

function resolveInvocation(command, args) {
    const normalized = String(command).trim();
    const normalizedArgs = Array.isArray(args) ? args.map(String) : [];
    if (process.platform !== "win32" || !["pnpm", "npm", "npx", "yarn"].includes(normalized)) {
        return { command: resolveCommand(normalized), args: normalizedArgs };
    }
    const commandLine = [`${normalized}.cmd`, ...normalizedArgs].map((value) => {
        const text = String(value);
        return /[\s"&|<>^]/.test(text) ? `"${text.replace(/(["^])/g, "^$1")}"` : text;
    }).join(" ");
    return { command: process.env.ComSpec || "cmd.exe", args: ["/d", "/s", "/c", commandLine] };
}

export function createJobPlans(config, { cwd = process.cwd(), runId = randomUUID() } = {}) {
    if (!config || !Array.isArray(config.jobs) || config.jobs.length === 0) {
        throw new Error("E2E 编排配置必须包含非空 jobs 数组");
    }
    const names = new Set();
    const runRoot = fs.mkdtempSync(path.join(os.tmpdir(), `lvct-e2e-${sanitizeJobName(runId)}-`));
    const artifactRoot = path.resolve(cwd, "output", "e2e-parallel", sanitizeJobName(runId));
    fs.mkdirSync(artifactRoot, { recursive: true });
    try {
        const plans = config.jobs.map((definition, index) => {
            if (!definition || typeof definition !== "object") throw new Error(`E2E 作业 ${index + 1} 不是对象`);
            const name = sanitizeJobName(definition.name || `job-${index + 1}`);
            if (names.has(name)) throw new Error(`E2E 作业名称重复：${name}`);
            names.add(name);
            const jobRoot = path.join(runRoot, `${String(index + 1).padStart(2, "0")}-${name}`);
            const artifactDir = path.join(artifactRoot, name);
            fs.mkdirSync(jobRoot, { recursive: true });
            fs.mkdirSync(artifactDir, { recursive: true });
            const jobCwd = path.resolve(cwd, definition.cwd || ".");
            if (!fs.existsSync(jobCwd) || !fs.statSync(jobCwd).isDirectory()) {
                throw new Error(`E2E 作业 cwd 不存在：${jobCwd}`);
            }
            const evidenceFile = path.join(artifactDir, "evidence.json");
            const logFile = path.join(artifactDir, "process.log");
            const invocation = resolveInvocation(definition.command, definition.args);
            return {
                ...definition,
                name,
                cwd: jobCwd,
                command: invocation.command,
                args: invocation.args,
                jobRoot,
                artifactDir,
                evidenceFile,
                logFile,
                env: {
                    ...definition.env,
                    LVCT_E2E_RUN_ID: String(runId),
                    LVCT_E2E_JOB_ID: name,
                    LVCT_E2E_JOB_ROOT: jobRoot,
                    LVCT_E2E_ARTIFACT_DIR: artifactDir,
                    LVCT_E2E_EVIDENCE_FILE: evidenceFile,
                },
            };
        });
        return { runId: String(runId), runRoot, artifactRoot, maxConcurrency: Math.min(asPositiveInteger(config.maxConcurrency, DEFAULT_MAX_CONCURRENCY), plans.length), plans };
    } catch (error) {
        fs.rmSync(runRoot, { recursive: true, force: true });
        throw error;
    }
}

export function assertDistinctJobIsolation(plans) {
    const fields = ["jobRoot", "artifactDir", "evidenceFile", "logFile"];
    for (const field of fields) {
        const values = plans.map((plan) => path.resolve(plan[field]));
        if (new Set(values).size !== values.length) throw new Error(`E2E 作业共享了隔离路径：${field}`);
    }
    const roots = plans.map((plan) => path.resolve(plan.jobRoot));
    for (let left = 0; left < roots.length; left += 1) {
        for (let right = left + 1; right < roots.length; right += 1) {
            if (roots[left].startsWith(`${roots[right]}${path.sep}`) || roots[right].startsWith(`${roots[left]}${path.sep}`)) {
                throw new Error("E2E 作业隔离目录存在嵌套，拒绝并发运行");
            }
        }
    }
    return true;
}

function appendLine(stream, logFile, prefix, chunk) {
    const text = String(chunk);
    fs.appendFileSync(logFile, text, "utf8");
    for (const line of text.split(/\r?\n/).filter(Boolean)) process.stdout.write(`[${prefix}] ${line}\n`);
}

async function allocatePort(usedPorts) {
    while (true) {
        const port = await new Promise((resolve, reject) => {
            const server = net.createServer();
            server.once("error", reject);
            server.listen({ host: "127.0.0.1", port: 0, exclusive: true }, () => {
                const assigned = server.address().port;
                server.close((error) => error ? reject(error) : resolve(assigned));
            });
        });
        if (!usedPorts.has(port)) {
            usedPorts.add(port);
            return port;
        }
    }
}

function waitForChild(child, timeoutMs) {
    if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`E2E 子进程未在 ${timeoutMs}ms 内退出`)), timeoutMs);
        const finish = (error) => {
            clearTimeout(timer);
            child.removeListener("exit", onExit);
            child.removeListener("error", onError);
            if (error) reject(error); else resolve();
        };
        const onExit = () => finish();
        const onError = (error) => finish(error);
        child.once("exit", onExit);
        child.once("error", onError);
    });
}

export async function stopOwnedProcess(child, { platform = process.platform, spawnProcess = spawn, graceMs = DEFAULT_GRACE_MS } = {}) {
    if (!child || (child.exitCode !== null && child.exitCode !== undefined) || (child.signalCode !== null && child.signalCode !== undefined)) return;
    if (!Number.isSafeInteger(child.pid) || child.pid <= 0) throw new Error("E2E 子进程 PID 无效，拒绝终止");
    if (platform === "win32") {
        const helper = spawnProcess("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
        await Promise.all([waitForChild(child, graceMs), waitForChild(helper, graceMs)]);
        return;
    }
    child.kill("SIGTERM");
    try { await waitForChild(child, graceMs); }
    catch {
        child.kill("SIGKILL");
        await waitForChild(child, graceMs);
    }
}

function runOne(plan, { spawnProcess = spawn, graceMs = DEFAULT_GRACE_MS } = {}) {
    const startedAt = new Date().toISOString();
    fs.writeFileSync(plan.logFile, `command=${plan.command} ${plan.args.join(" ")}\ncwd=${plan.cwd}\n`, "utf8");
    let child;
    try {
        child = spawnProcess(plan.command, plan.args, {
            cwd: plan.cwd,
            env: { ...process.env, ...plan.env },
            stdio: ["ignore", "pipe", "pipe"],
            windowsHide: true,
            shell: false,
        });
    } catch (error) {
        const result = Promise.resolve({ name: plan.name, ok: false, pid: null, error: error.message, exitCode: null, signal: null, startedAt, finishedAt: new Date().toISOString() });
        return { child: null, result, stop: async () => {} };
    }
    appendLine(child.stdout, plan.logFile, plan.name, "");
    appendLine(child.stderr, plan.logFile, `${plan.name}:stderr`, "");
    child.stdout.on("data", (chunk) => appendLine(child.stdout, plan.logFile, plan.name, chunk));
    child.stderr.on("data", (chunk) => appendLine(child.stderr, plan.logFile, `${plan.name}:stderr`, chunk));
    const result = new Promise((resolve) => {
        let settled = false;
        const finish = (value) => {
            if (settled) return;
            settled = true;
            resolve(value);
        };
        const timeout = setTimeout(async () => {
            try { await stopOwnedProcess(child, { graceMs }); }
            catch (error) { finish({ name: plan.name, ok: false, pid: child.pid, error: `timeout: ${error.message}`, exitCode: null, signal: null, startedAt, finishedAt: new Date().toISOString() }); return; }
            finish({ name: plan.name, ok: false, pid: child.pid, error: `timeout: ${plan.timeoutMs}ms`, exitCode: null, signal: "TIMEOUT", startedAt, finishedAt: new Date().toISOString() });
        }, plan.timeoutMs);
        const settle = (value) => { clearTimeout(timeout); finish(value); };
        child.once("error", (error) => settle({ name: plan.name, ok: false, pid: child.pid, error: error.message, exitCode: null, signal: null, startedAt, finishedAt: new Date().toISOString() }));
        child.once("exit", (exitCode, signal) => settle({ name: plan.name, ok: exitCode === 0, pid: child.pid, error: exitCode === 0 ? null : `exit=${exitCode} signal=${signal ?? "none"}`, exitCode, signal, startedAt, finishedAt: new Date().toISOString() }));
    });
    return { child, result, stop: () => stopOwnedProcess(child, { graceMs }) };
}

export async function runParallel(config, { cwd = process.cwd(), runId = randomUUID(), spawnProcess = spawn, graceMs = DEFAULT_GRACE_MS } = {}) {
    const prepared = createJobPlans(config, { cwd, runId });
    assertDistinctJobIsolation(prepared.plans);
    const usedPorts = new Set();
    for (const plan of prepared.plans) {
        if (!plan.env.LVCT_E2E_PORT) plan.env.LVCT_E2E_PORT = String(await allocatePort(usedPorts));
        plan.env.LVCT_E2E_WORKSPACE = path.join(plan.jobRoot, "workspace");
        plan.timeoutMs = asPositiveInteger(plan.timeoutMs, 30 * 60 * 1000);
    }
    const active = new Map();
    const results = [];
    let nextIndex = 0;
    let stopping = false;
    const launch = (plan) => {
        const running = runOne(plan, { spawnProcess, graceMs });
        active.set(plan.name, running);
        running.result.then((result) => { active.delete(plan.name); results.push(result); });
        return running;
    };
    const stopAll = async () => {
        stopping = true;
        await Promise.allSettled([...active.values()].map((running) => running.stop()));
    };
    const signalHandler = () => { void stopAll(); };
    process.once("SIGINT", signalHandler);
    process.once("SIGTERM", signalHandler);
    try {
        while (nextIndex < prepared.plans.length || active.size > 0) {
            while (!stopping && nextIndex < prepared.plans.length && active.size < prepared.maxConcurrency) launch(prepared.plans[nextIndex++]);
            if (active.size === 0) break;
            await Promise.race([...active.values()].map((running) => running.result));
            if (stopping) await stopAll();
        }
    } finally {
        process.removeListener("SIGINT", signalHandler);
        process.removeListener("SIGTERM", signalHandler);
        await stopAll();
    }
    const ordered = prepared.plans.map((plan) => results.find((result) => result.name === plan.name)
        ?? { name: plan.name, ok: false, error: "作业未产生退出结果" });
    const summary = { runId: prepared.runId, maxConcurrency: prepared.maxConcurrency, startedAt: ordered.map((item) => item.startedAt).filter(Boolean).sort()[0] ?? null, finishedAt: new Date().toISOString(), ok: ordered.every((item) => item.ok), jobs: ordered.map((item) => {
        const plan = prepared.plans.find((candidate) => candidate.name === item.name);
        return { ...item, port: Number(plan.env.LVCT_E2E_PORT), workspace: plan.env.LVCT_E2E_WORKSPACE, artifactDir: plan.artifactDir, evidenceFile: plan.evidenceFile, logFile: plan.logFile };
    }) };
    fs.writeFileSync(path.join(prepared.artifactRoot, "summary.json"), JSON.stringify(summary, null, 2) + "\n", "utf8");
    return { ...summary, runRoot: prepared.runRoot, artifactRoot: prepared.artifactRoot };
}

async function main() {
    const configIndex = process.argv.indexOf("--config");
    const configFile = configIndex >= 0 ? process.argv[configIndex + 1] : undefined;
    if (!configFile) throw new Error("用法：node scripts/e2e/parallel-runner.mjs --config <json>");
    const summary = await runParallel(loadParallelConfig(configFile));
    console.log(`E2E 并行编排：${summary.jobs.filter((job) => job.ok).length}/${summary.jobs.length}`);
    console.log(`证据目录：${summary.artifactRoot}`);
    if (!summary.ok) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])) {
    main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
}
